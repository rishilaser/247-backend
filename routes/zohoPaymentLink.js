const express = require('express');
const axios = require('axios');
const { authenticateToken } = require('../middleware/auth');
const Quotation = require('../models/Quotation');
const Inquiry = require('../models/Inquiry');
const Payment = require('../models/Payment');
const { applyPaymentSuccess, applyPaymentFailure } = require('../services/zohoPaymentSettlement');
const { ensurePaymentSuccessNotifications } = require('../services/paymentNotificationHelper');
const { syncInquiryWithQuotationPayment } = require('../services/inquiryPaymentSyncHelper');
const { ensurePendingOnlineOrder } = require('../services/ensurePendingOrder');
const {
  normalizeStatus,
  extractZohoPaymentLinkPayload,
  isZohoPaid,
  isZohoFailedOrCancelled,
  refreshZohoAccessToken,
  getZohoAccessToken,
  fetchZohoPaymentLink,
  verifyZohoReturnUrlSignature,
  canTrustReturnWithoutSignature,
  canTrustZohoReturnForPaid,
  isZohoReturnPaidStatus,
  isZohoReturnFailedStatus,
  testZohoPaymentsAuth,
} = require('../services/zohoPaymentHelpers');
const { logZohoPaymentEvent } = require('../services/zohoPaymentLogger');

const router = express.Router();

/**
 * Zoho Payments (IN) expects `phone` as local digits (e.g. 9890705524) with `phone_country_code` "IN".
 * Stored values like "09890705524" or "+91 98907 05524" must be normalized or Zoho returns 400.
 */
function normalizePhoneForZohoPayments(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return { phone: undefined, phone_country_code: undefined };
  let local = digits;
  if (local.startsWith('91') && local.length === 12) {
    local = local.slice(2);
  }
  if (local.startsWith('0') && local.length === 11) {
    local = local.slice(1);
  }
  if (local.length !== 10) {
    return { phone: digits, phone_country_code: undefined };
  }
  return { phone: local, phone_country_code: 'IN' };
}

/** Appends orderId to return URL when missing so post-checkout sync can resolve the quotation. */
function appendOrderIdToReturnUrl(url, quotationId) {
  if (!url) return url;
  const ref = String(quotationId);
  try {
    const u = String(url);
    if (/\b(orderId|quotationId)=/i.test(u.split('?')[1] || '')) return url;
    const sep = u.includes('?') ? '&' : '?';
    return `${u}${sep}orderId=${encodeURIComponent(ref)}`;
  } catch {
    return url;
  }
}

/**
 * After Zoho Checkout, customer is sent here. Placeholders: {quotationId} or {orderId} (same internal quotation id).
 * Example: https://app.example.com/payment-success?orderId={quotationId}
 */
function buildZohoReturnUrl(quotationId) {
  const ref = String(quotationId);
  const isDev = process.env.NODE_ENV !== 'production';
  const localTpl = (process.env.ZOHO_PAYMENTS_RETURN_URL_LOCAL || '').trim();
  const prodTpl = (process.env.ZOHO_PAYMENTS_RETURN_URL || '').trim();
  // In dev, prefer LOCAL return URL so Zoho redirects to localhost with ?status=... (not live site).
  const tpl = isDev && localTpl ? localTpl : prodTpl;
  let out;
  if (tpl) {
    const url = tpl
      .replace(/\{quotationId\}/gi, encodeURIComponent(ref))
      .replace(/\{orderId\}/gi, encodeURIComponent(ref));
    if (!/^https?:\/\//i.test(url) || /\s/.test(url)) {
      return undefined;
    }
    out = url;
  } else {
    const clientBase = (process.env.CLIENT_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(clientBase) && !/\s/.test(clientBase)) {
      out = `${clientBase}/payment-success?orderId=${encodeURIComponent(ref)}`;
    }
  }
  return appendOrderIdToReturnUrl(out, quotationId);
}

/**
 * POST /api/zoho/sync-payment-status
 * After redirect from Zoho: ask Zoho for payment-link status and update DB if paid (same outcome as webhook).
 */
async function finalizeSyncSuccess(res, quotationId, quotation, plOrMeta) {
  const inquiryAfter = await Inquiry.findById(quotation.inquiryId).lean();
  if (inquiryAfter) {
    await syncInquiryWithQuotationPayment(inquiryAfter);
  }
  const qAfter = await Quotation.findById(quotationId)
    .select('orderPaymentWorkflowStatus payment_status status')
    .lean();
  return res.json({
    success: true,
    updated: true,
    gatewayPaid: true,
    syncMethod: plOrMeta?.syncMethod || 'api',
    quotationId: String(quotationId),
    inquiryStatus: inquiryAfter?.status,
    orderPaymentWorkflowStatus: qAfter?.orderPaymentWorkflowStatus,
    payment_status: qAfter?.payment_status,
    zohoStatus: plOrMeta?.zohoStatus || 'paid',
  });
}

router.post('/sync-payment-status', authenticateToken, async (req, res) => {
  try {
    const { quotationId, zohoReturn } = req.body || {};
    if (!quotationId) {
      return res.status(400).json({ success: false, message: 'quotationId is required' });
    }

    const quotation = await Quotation.findById(quotationId).lean();
    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }

    const inquiry = await Inquiry.findById(quotation.inquiryId).select('customer').lean();
    if (!inquiry) {
      return res.status(404).json({ success: false, message: 'Inquiry not found' });
    }

    const isStaff = ['admin', 'backoffice', 'subadmin'].includes(req.userRole);
    if (!isStaff && inquiry.customer.toString() !== req.userId.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Path A: Zoho redirect query params (works without ZohoPay.payments.READ scope).
    if (zohoReturn && (zohoReturn.status || zohoReturn.payment_link_id)) {
      const sig = verifyZohoReturnUrlSignature(zohoReturn);
      const trustedPaid = canTrustZohoReturnForPaid(zohoReturn, quotation, sig);
      if (isZohoReturnPaidStatus(zohoReturn.status) && !trustedPaid) {
        logZohoPaymentEvent('sync', 'error', {
          quotationId: String(quotationId),
          paymentLinkId: zohoReturn.payment_link_id,
          error: `return_url_signature_${sig.reason}`,
          zohoPayload: zohoReturn,
        });
        return res.status(400).json({
          success: false,
          message: 'Invalid payment return signature',
          signatureCheck: sig.reason,
        });
      }

      if (sig.reason === 'signature_mismatch' && trustedPaid) {
        console.warn('[Zoho sync] signature_mismatch but trusting paid return (check Payments signing key in .env)', {
          quotationId: String(quotationId),
          paymentLinkId: zohoReturn.payment_link_id,
        });
      }

      if (isZohoReturnPaidStatus(zohoReturn.status) && trustedPaid) {
        const amountRaw = zohoReturn.amount;
        const amount =
          typeof amountRaw === 'string' ? Number(amountRaw) : typeof amountRaw === 'number' ? amountRaw : undefined;

        await applyPaymentSuccess(String(quotationId), {
          payment_link_id: zohoReturn.payment_link_id || quotation.zohoPaymentLinkId,
          zoho_payment_id: zohoReturn.payment_id,
          amount: Number.isFinite(amount) ? amount : undefined,
        });

        logZohoPaymentEvent('sync', 'paid', {
          quotationId: String(quotationId),
          paymentLinkId: zohoReturn.payment_link_id,
          zohoStatus: zohoReturn.status,
          zohoPayload: zohoReturn,
          dbUpdated: true,
          syncMethod: 'return_url',
        });

        return finalizeSyncSuccess(res, quotationId, quotation, {
          syncMethod: 'return_url',
          zohoStatus: normalizeStatus(zohoReturn.status),
        });
      }

      if (isZohoReturnFailedStatus(zohoReturn.status)) {
        await applyPaymentFailure(String(quotationId), {
          payment_link_id: zohoReturn.payment_link_id || quotation.zohoPaymentLinkId,
        });
        logZohoPaymentEvent('sync', 'failed', {
          quotationId: String(quotationId),
          paymentLinkId: zohoReturn.payment_link_id,
          zohoStatus: zohoReturn.status,
          zohoPayload: zohoReturn,
          dbUpdated: true,
          syncMethod: 'return_url',
        });
        return res.json({
          success: true,
          updated: true,
          gatewayPaid: false,
          syncMethod: 'return_url',
          message: 'Payment failed or cancelled',
        });
      }

      return res.json({
        success: true,
        updated: false,
        gatewayPaid: false,
        syncMethod: 'return_url',
        zohoStatus: normalizeStatus(zohoReturn.status),
        message: 'Payment not completed yet',
      });
    }

    const hasReturnParams =
      zohoReturn && (zohoReturn.status || zohoReturn.payment_link_id);

    if (
      !hasReturnParams &&
      quotation.orderPaymentWorkflowStatus === 'Paid' &&
      quotation.payment_status === 'Success'
    ) {
      await ensurePaymentSuccessNotifications(String(quotationId), {});
      return res.json({
        success: true,
        updated: false,
        gatewayPaid: true,
        notificationsEnsured: true,
        orderPaymentWorkflowStatus: quotation.orderPaymentWorkflowStatus,
        payment_status: quotation.payment_status,
      });
    }

    const paymentLinkId = quotation.zohoPaymentLinkId;
    if (!paymentLinkId) {
      return res.json({
        success: true,
        updated: false,
        needsZohoReturnParams: true,
        gatewayPaid: false,
        message:
          'No Zoho payment link on this quotation. Complete checkout from the quotation payment page first.',
      });
    }

    const accountId = process.env.ZOHO_PAYMENTS_ACCOUNT_ID;
    const accessToken = await getZohoAccessToken();
    if (!accessToken || !accountId) {
      return res.status(500).json({
        success: false,
        message: 'Zoho Payments not configured on server',
      });
    }

    let zohoResp;
    try {
      zohoResp = await fetchZohoPaymentLink(String(paymentLinkId), accessToken);
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      logZohoPaymentEvent('sync', 'error', {
        quotationId: String(quotationId),
        paymentLinkId: String(paymentLinkId),
        zohoHttpStatus: status,
        error: data?.message || data?.error_description || e?.message,
        zohoResponse: data,
      });
      const rateLimited =
        status === 400 &&
        /too many requests/i.test(String(data?.error_description || data?.message || ''));
      if (rateLimited) {
        return res.json({
          success: true,
          updated: false,
          rateLimited: true,
          message: 'Zoho rate limit; try again shortly',
        });
      }
      // Never return 401 here — the axios client treats 401 as "user logged out" and redirects to /login.
      return res.status(502).json({
        success: false,
        zohoError: true,
        zohoHttpStatus: status,
        message: data?.message || data?.error_description || 'Could not verify payment with Zoho',
        authHint:
          status === 401
            ? 'OAuth token lacks ZohoPay.payments.READ. Regenerate refresh token with READ scope, or rely on return_url params / webhook.'
            : undefined,
      });
    }

    const pl = extractZohoPaymentLinkPayload(zohoResp.data);
    const zohoPaymentCheck = isZohoPaid(pl);

    if (!zohoPaymentCheck.paid) {
      const zohoFailureCheck = isZohoFailedOrCancelled(pl);

      // Only heal rows that were marked Paid/Success in DB while Zoho shows no payment.
      const shouldRollbackFalsePaid =
        quotation.orderPaymentWorkflowStatus === 'Paid' ||
        quotation.payment_status === 'Success';

      if (shouldRollbackFalsePaid) {
        const rollbackSet = {
          status: 'accepted',
          orderPaymentWorkflowStatus: zohoFailureCheck.failed ? 'Failed' : 'Payment Pending',
          payment_status: zohoFailureCheck.failed ? 'Failed' : 'Pending',
        };
        await Quotation.updateOne({ _id: quotation._id }, { $set: rollbackSet });

        await Payment.updateMany(
          { quotation: quotation._id, payment_status: { $ne: 'success' } },
          { $set: { payment_status: zohoFailureCheck.failed ? 'failed' : 'pending' } }
        );

        await Inquiry.updateOne(
          { _id: quotation.inquiryId, status: { $nin: ['rejected', 'cancelled'] } },
          { $set: { status: 'accepted', updatedAt: new Date() } }
        );
      }

      const outcome = zohoFailureCheck.failed ? 'failed' : 'pending';
      logZohoPaymentEvent('sync', outcome, {
        quotationId: String(quotationId),
        paymentLinkId: String(paymentLinkId),
        zohoStatus: normalizeStatus(pl?.status),
        amount: pl?.amount,
        amount_paid: pl?.amount_paid,
        observedStatuses: zohoPaymentCheck.statuses,
        zohoPayload: pl,
        dbUpdated: false,
      });

      return res.json({
        success: true,
        updated: false,
        gatewayPaid: false,
        zohoStatus: normalizeStatus(pl?.status) || 'unknown',
        amount: pl?.amount,
        amount_paid: pl?.amount_paid,
        observedStatuses: zohoPaymentCheck.statuses,
        message: zohoFailureCheck.failed
          ? 'Payment failed/cancelled in Zoho'
          : 'Payment not completed in Zoho yet',
      });
    }

    const amountRaw = pl?.amount_paid ?? pl?.amount ?? quotation.totalAmount;
    const amount =
      typeof amountRaw === 'string' ? Number(amountRaw) : typeof amountRaw === 'number' ? amountRaw : Number(quotation.totalAmount);

    await applyPaymentSuccess(String(quotationId), {
      payment_link_id: String(paymentLinkId),
      zoho_payment_id: pl?.payment_id || pl?.last_payment_id || undefined,
      amount: Number.isFinite(amount) ? amount : undefined,
    });

    logZohoPaymentEvent('sync', 'paid', {
      quotationId: String(quotationId),
      paymentLinkId: String(paymentLinkId),
      zohoStatus: normalizeStatus(pl?.status) || 'paid',
      amount: pl?.amount,
      amount_paid: pl?.amount_paid,
      zohoPayload: pl,
      dbUpdated: true,
      syncMethod: 'api',
    });

    return finalizeSyncSuccess(res, quotationId, quotation, {
      syncMethod: 'api',
      zohoStatus: normalizeStatus(pl?.status) || 'paid',
    });
  } catch (error) {
    console.error('sync-payment-status error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/** GET /api/zoho/auth-diagnostics — staff only: test CREATE vs READ OAuth scopes */
router.get('/auth-diagnostics', authenticateToken, async (req, res) => {
  const isStaff = ['admin', 'backoffice', 'subadmin'].includes(req.userRole);
  if (!isStaff) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  try {
    const result = await testZohoPaymentsAuth();
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Diagnostics failed' });
  }
});

// POST /api/zoho/payment-link
// Creates Zoho Payments "Payment Link" (hosted URL) and returns { url }.
router.post('/payment-link', authenticateToken, async (req, res) => {
  try {
    const { quotationId } = req.body || {};
    if (!quotationId) {
      return res.status(400).json({ success: false, message: 'quotationId is required' });
    }

    const accountId = process.env.ZOHO_PAYMENTS_ACCOUNT_ID;
    const accessToken = await getZohoAccessToken();

    if (!accessToken || !accountId) {
      return res.status(500).json({
        success: false,
        message: 'Missing Zoho OAuth config (ZOHO_PAYMENTS_ACCESS_TOKEN / ZOHO_PAYMENTS_ACCOUNT_ID)'
      });
    }

    const quotation = await Quotation.findById(quotationId);
    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }

    const inquiry = await Inquiry.findById(quotation.inquiryId).populate(
      'customer',
      'firstName lastName email phoneNumber'
    );
    if (!inquiry) {
      return res.status(404).json({ success: false, message: 'Associated inquiry not found' });
    }

    const isStaff = ['admin', 'backoffice', 'subadmin'].includes(req.userRole);
    const customerId = inquiry.customer?._id || inquiry.customer;
    if (
      !isStaff &&
      customerId &&
      customerId.toString() !== req.userId.toString()
    ) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (quotation.status !== 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'Accept the quotation first (Accept Quote on the inquiry), then pay.',
      });
    }

    try {
      await ensurePendingOnlineOrder(quotation, inquiry, customerId || req.userId);
    } catch (e) {
      if (e.code === 'ORDER_PAID') {
        return res.status(409).json({
          success: false,
          message: 'This order is already paid.',
        });
      }
      throw e;
    }

    const amount = Number(quotation.totalAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid quotation amount' });
    }

    // Zoho Payments accepts reference_id on the link; webhooks echo it as reference_id / payment_link_reference.
    // Do not send reference_number — it is not part of the Payment Links create API and triggers 400 Invalid data.
    const reference_id = String(quotationId);
    let return_url = buildZohoReturnUrl(reference_id);
    if (return_url && !return_url.includes('payment-success') && !return_url.includes('orderId=')) {
      const base = (process.env.CLIENT_URL || 'https://247cutbend.in').trim().replace(/\/+$/, '');
      return_url = `${base}/payment-success?orderId=${encodeURIComponent(reference_id)}`;
    }

    const customerEmail = inquiry.customer?.email ? String(inquiry.customer.email).trim() : '';
    const { phone: zohoPhone, phone_country_code } = normalizePhoneForZohoPayments(
      inquiry.customer?.phoneNumber
    );

    const payload = {
      amount,
      currency: 'INR',
      description: `Payment for Quotation #${quotation.quotationNumber || quotationId}`,
      reference_id,
      ...(customerEmail ? { email: customerEmail } : {}),
      ...(zohoPhone ? { phone: zohoPhone, ...(phone_country_code ? { phone_country_code } : {}) } : {}),
      ...(return_url ? { return_url } : {}),
      // Do not ask Zoho to email the customer — we send payment-success mail only after gateway confirms payment.
    };

    const zohoBase =
      (process.env.ZOHO_PAYMENTS_API_BASE || 'https://payments.zoho.in').trim().replace(/\/+$/, '');

    async function createPaymentLinkWithToken(token) {
      return axios.post(
        `${zohoBase}/api/v1/paymentlinks?account_id=${encodeURIComponent(accountId)}`,
        payload,
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            'content-type': 'application/json'
          },
          timeout: 30000
        }
      );
    }

    let zohoResp;
    try {
      zohoResp = await createPaymentLinkWithToken(accessToken);
    } catch (e) {
      // If token expired/unauthorized, refresh once and retry.
      if (e?.response?.status === 401) {
        const newToken = await refreshZohoAccessToken();
        if (newToken) {
          zohoResp = await createPaymentLinkWithToken(newToken);
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    const paymentLink = extractZohoPaymentLinkPayload(zohoResp.data);
    const url = paymentLink?.url;
    const payment_link_id = paymentLink?.payment_link_id;

    if (!url || !payment_link_id) {
      console.error('Zoho payment link unexpected response:', zohoResp.data);
      return res.status(502).json({ success: false, message: 'Failed to create payment link' });
    }

    await Payment.findOneAndUpdate(
      { transaction_id: payment_link_id },
      {
        $set: {
          transaction_id: payment_link_id,
          payment_status: 'pending',
          amount,
          user_id: inquiry.customer?._id,
          quotation: quotation._id
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await Quotation.findByIdAndUpdate(quotation._id, {
      $set: {
        orderPaymentWorkflowStatus: 'Payment Pending',
        payment_status: 'Pending',
        zohoPaymentLinkId: payment_link_id
      }
    });

    return res.json({ success: true, url, payment_link_id });
  } catch (error) {
    const zohoStatus = error?.response?.status;
    const data = error?.response?.data;
    console.error('Zoho payment link error:', { status: zohoStatus, data: data || error?.message || error });
    const httpStatus =
      zohoStatus === 400 || zohoStatus === 422 ? 400 : zohoStatus >= 400 && zohoStatus < 500 ? zohoStatus : 502;
    return res.status(httpStatus).json({
      success: false,
      message: data?.message || error?.message || 'Failed to create payment link',
      ...(process.env.NODE_ENV !== 'production' && data ? { zoho: data } : {})
    });
  }
});

module.exports = router;

