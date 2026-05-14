const express = require('express');
const axios = require('axios');
const { authenticateToken } = require('../middleware/auth');
const Quotation = require('../models/Quotation');
const Inquiry = require('../models/Inquiry');
const Payment = require('../models/Payment');
const { applyPaymentSuccess } = require('../services/zohoPaymentSettlement');
const { syncInquiryWithQuotationPayment } = require('../services/inquiryPaymentSyncHelper');
const { ensurePendingOnlineOrder } = require('../services/ensurePendingOrder');

const router = express.Router();

/** Ensures frontend can call sync after redirect (dashboard or custom URL without placeholders). */
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
  const tpl = (process.env.ZOHO_PAYMENTS_RETURN_URL || '').trim();
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

async function refreshZohoAccessToken() {
  const refreshToken = process.env.ZOHO_PAYMENTS_REFRESH_TOKEN;
  const clientId = process.env.ZOHO_PAYMENTS_CLIENT_ID;
  const clientSecret = process.env.ZOHO_PAYMENTS_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) return null;

  const tokenResp = await axios.post(
    'https://accounts.zoho.in/oauth/v2/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    }).toString(),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      timeout: 30000
    }
  );

  const accessToken = tokenResp.data?.access_token;
  if (!accessToken) return null;
  process.env.ZOHO_PAYMENTS_ACCESS_TOKEN = accessToken;
  return accessToken;
}

async function fetchZohoPaymentLink(paymentLinkId, accessToken) {
  const accountId = process.env.ZOHO_PAYMENTS_ACCOUNT_ID;
  const zohoBase = (process.env.ZOHO_PAYMENTS_API_BASE || 'https://payments.zoho.in').trim().replace(/\/+$/, '');
  const url = `${zohoBase}/api/v1/paymentlinks/${encodeURIComponent(paymentLinkId)}?account_id=${encodeURIComponent(accountId)}`;
  async function get(token) {
    return axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      timeout: 30000,
    });
  }
  try {
    return await get(accessToken);
  } catch (e) {
    if (e?.response?.status === 401) {
      const newToken = await refreshZohoAccessToken();
      if (newToken) return await get(newToken);
    }
    throw e;
  }
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isZohoPaid(paymentLinkPayload) {
  const pl = paymentLinkPayload || {};

  const candidateStatuses = [
    pl.status,
    pl.payment_status,
    pl.payment_link_status,
    pl.link_status,
    pl.last_payment_status,
    pl.last_payment?.status,
    pl.data?.status,
    pl.data?.payment_status,
  ].map(normalizeStatus).filter(Boolean);

  const paidStatuses = new Set(['paid', 'success', 'succeeded', 'completed']);
  if (candidateStatuses.some((s) => paidStatuses.has(s))) {
    return { paid: true, statuses: candidateStatuses };
  }

  // Some Zoho payloads expose payment attempts as an array.
  const paymentAttempts = Array.isArray(pl.payments) ? pl.payments : [];
  if (
    paymentAttempts.some((p) =>
      paidStatuses.has(normalizeStatus(p?.status)) ||
      paidStatuses.has(normalizeStatus(p?.payment_status))
    )
  ) {
    return { paid: true, statuses: candidateStatuses };
  }

  // Fallback heuristic: if due amount is zero and amount paid is positive.
  const amountDue = Number(pl.amount_due ?? pl.balance_due ?? NaN);
  const amountPaid = Number(pl.amount_paid ?? NaN);
  if (Number.isFinite(amountDue) && Number.isFinite(amountPaid) && amountDue <= 0 && amountPaid > 0) {
    return { paid: true, statuses: candidateStatuses };
  }

  return { paid: false, statuses: candidateStatuses };
}

function isZohoFailedOrCancelled(paymentLinkPayload) {
  const pl = paymentLinkPayload || {};
  const candidateStatuses = [
    pl.status,
    pl.payment_status,
    pl.payment_link_status,
    pl.link_status,
    pl.last_payment_status,
    pl.last_payment?.status,
    pl.data?.status,
    pl.data?.payment_status,
  ].map(normalizeStatus).filter(Boolean);

  const failedStatuses = new Set([
    'failed',
    'failure',
    'cancelled',
    'canceled',
    'expired',
    'declined',
    'aborted',
  ]);

  if (candidateStatuses.some((s) => failedStatuses.has(s))) {
    return { failed: true, statuses: candidateStatuses };
  }

  const paymentAttempts = Array.isArray(pl.payments) ? pl.payments : [];
  if (
    paymentAttempts.some((p) =>
      failedStatuses.has(normalizeStatus(p?.status)) ||
      failedStatuses.has(normalizeStatus(p?.payment_status))
    )
  ) {
    return { failed: true, statuses: candidateStatuses };
  }

  return { failed: false, statuses: candidateStatuses };
}

/**
 * POST /api/zoho/sync-payment-status
 * After redirect from Zoho: ask Zoho for payment-link status and update DB if paid (same outcome as webhook).
 */
router.post('/sync-payment-status', authenticateToken, async (req, res) => {
  try {
    const { quotationId } = req.body || {};
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

    const paymentLinkId = quotation.zohoPaymentLinkId;
    if (!paymentLinkId) {
      return res.status(400).json({
        success: false,
        message: 'No Zoho payment link on this quotation; create a payment link first',
      });
    }

    let accessToken = process.env.ZOHO_PAYMENTS_ACCESS_TOKEN;
    const accountId = process.env.ZOHO_PAYMENTS_ACCOUNT_ID;
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
      console.error('Zoho sync payment link fetch error:', { status, data: data || e?.message });
      return res.status(502).json({
        success: false,
        message: data?.message || 'Could not verify payment with Zoho',
      });
    }

    const pl =
      zohoResp.data?.payment_link ||
      zohoResp.data?.paymentlink ||
      zohoResp.data?.data?.payment_link ||
      zohoResp.data;
    const zohoPaymentCheck = isZohoPaid(pl);

    if (!zohoPaymentCheck.paid) {
      const zohoFailureCheck = isZohoFailedOrCancelled(pl);

      // Healing path: if older records were incorrectly marked as paid/order_created
      // but Zoho shows no successful payment, move them back to accepted.
      const shouldRollbackFalsePaid =
        quotation.orderPaymentWorkflowStatus === 'Paid' ||
        quotation.payment_status === 'Success' ||
        quotation.status === 'order_created';

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

      return res.json({
        success: true,
        updated: false,
        zohoStatus: normalizeStatus(pl?.status) || 'unknown',
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

    const inquiryAfter = await Inquiry.findById(quotation.inquiryId).lean();
    if (inquiryAfter) {
      await syncInquiryWithQuotationPayment(inquiryAfter);
    }

    return res.json({
      success: true,
      updated: true,
      quotationId: String(quotationId),
    });
  } catch (error) {
    console.error('sync-payment-status error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
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

    const accessToken = process.env.ZOHO_PAYMENTS_ACCESS_TOKEN;
    const accountId = process.env.ZOHO_PAYMENTS_ACCOUNT_ID;

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
    const reference_id = String(quotationId);
    const reference_number = reference_id;
    const return_url = buildZohoReturnUrl(reference_id);

    const payload = {
      amount,
      currency: 'INR',
      description: `Payment for Quotation #${quotation.quotationNumber || quotationId}`,
      reference_id,
      reference_number,
      ...(inquiry.customer?.email ? { email: inquiry.customer.email } : {}),
      ...(inquiry.customer?.phoneNumber ? { phone: inquiry.customer.phoneNumber } : {}),
      ...(return_url ? { return_url } : {}),
      notify_customer: { email: true }
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

    const paymentLink =
      zohoResp.data?.payment_link ||
      zohoResp.data?.paymentlink ||
      zohoResp.data?.payment_links ||
      zohoResp.data;
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
    const status = error?.response?.status;
    const data = error?.response?.data;
    console.error('Zoho payment link error:', { status, data: data || error?.message || error });
    return res.status(500).json({
      success: false,
      message: data?.message || 'Failed to create payment link'
    });
  }
});

module.exports = router;

