const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Quotation = require('../models/Quotation');
const { applyPaymentSuccess, applyPaymentFailure } = require('../services/zohoPaymentSettlement');

const router = express.Router();

const SUCCESS_EVENTS = new Set([
  'payment.success',
  'payment.succeeded',
  'payment_link.paid',
  'payment_link.success',
  'payment_link.payment_succeeded',
]);

const FAILURE_EVENTS = new Set([
  'payment.failed',
  'payment.failure',
  'payment_link.failed',
  'payment_link.expired',
  'payment_link.canceled',
  'payment_link.cancelled',
]);

function eventVariants(eventType) {
  if (!eventType) return [];
  const et = String(eventType).trim().toLowerCase();
  const noUnderscore = et.replace(/_/g, '');
  return et === noUnderscore ? [et] : [et, noUnderscore];
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function computeSignatureHex(signingKey, rawBody) {
  return crypto.createHmac('sha256', signingKey).update(rawBody).digest('hex');
}

function computeSignatureB64(signingKey, rawBody) {
  return crypto.createHmac('sha256', signingKey).update(rawBody).digest('base64');
}

function normalizeSignature(sig) {
  if (!sig || typeof sig !== 'string') return '';
  const parts = sig.split('=');
  return (parts.length === 2 ? parts[1] : sig).trim();
}

function detectEventType(payload) {
  const raw =
    payload?.event_type ||
    payload?.event?.type ||
    payload?.event?.event_type ||
    payload?.type ||
    payload?.eventName ||
    payload?.event?.event_name ||
    '';
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function pickFirstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function deepRefs(payload) {
  const p = payload || {};
  const data = p.data || p.payload || {};
  const ev = p.event_object || p.eventObject || {};
  const pay = ev.payment || data.payment || {};
  const pl = ev.payment_link || data.payment_link || ev.paymentlink || data.paymentlink || {};

  const reference = pickFirstDefined(
    pay.reference_number,
    pay.reference_id,
    pay.payment_link_reference,
    pl.reference_number,
    pl.reference_id,
    pl.payment_link_reference,
    data.reference_number,
    data.reference_id,
    data.payment_link_reference,
    data.order_id,
    ev.reference_number,
    ev.reference_id,
    p.reference_number,
    p.reference_id,
    p.payment_link_reference,
    p.order_id
  );

  const payment_link_id = pickFirstDefined(
    pay.payment_link_id,
    pl.payment_link_id,
    data.payment_link_id,
    ev.payment_link_id,
    p.payment_link_id
  );

  const zoho_payment_id = pickFirstDefined(
    pay.payment_id,
    pay.id,
    data.payment_id,
    data.id,
    p.payment_id,
    p.paymentId
  );

  return { reference, payment_link_id, zoho_payment_id };
}

function parseQuotationIdFromReference(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  const prefixed = /^quotation_(.+)$/i.exec(trimmed);
  const candidate = prefixed ? prefixed[1] : trimmed;
  if (mongoose.Types.ObjectId.isValid(candidate)) {
    return candidate;
  }
  return null;
}

async function resolveQuotationId(payload, deep) {
  let qid = parseQuotationIdFromReference(deep.reference);
  if (qid) return qid;

  if (deep.payment_link_id) {
    const payDoc = await Payment.findOne({ transaction_id: String(deep.payment_link_id) })
      .select('quotation')
      .lean();
    if (payDoc?.quotation) return String(payDoc.quotation);
  }

  if (deep.zoho_payment_id) {
    const payDoc = await Payment.findOne({ transaction_id: String(deep.zoho_payment_id) })
      .select('quotation')
      .lean();
    if (payDoc?.quotation) return String(payDoc.quotation);
  }

  return null;
}

function verifySignatureIfConfigured(req) {
  const signingKey = process.env.ZOHO_WEBHOOK_SIGNING_KEY;
  const signatureHeader = normalizeSignature(
    req.headers['x-zc-webhook-signature'] ||
      req.headers['x-zc-signature'] ||
      req.headers['x-zoho-webhook-signature'] ||
      req.headers['x-webhook-signature'] ||
      req.headers['x-zoho-signature']
  );

  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : Buffer.from(JSON.stringify(req.body || {}));

  if (!signingKey) {
    console.warn(
      'ZOHO_WEBHOOK_SIGNING_KEY is not set; Zoho webhook signature verification is disabled'
    );
    return { ok: true, skipped: true, rawBody };
  }

  if (!signatureHeader) {
    return { ok: false, status: 400, message: 'Missing signature', rawBody };
  }

  const computedHex = computeSignatureHex(signingKey, rawBody);
  const computedB64 = computeSignatureB64(signingKey, rawBody);
  const matches =
    safeEqual(signatureHeader, computedHex) ||
    safeEqual(signatureHeader, computedB64) ||
    safeEqual(signatureHeader.toLowerCase(), computedHex.toLowerCase());

  if (!matches) {
    return { ok: false, status: 400, message: 'Invalid signature', rawBody };
  }

  return { ok: true, skipped: false, rawBody };
}

// POST /api/zoho/webhook
router.post('/webhook', async (req, res) => {
  const verify = verifySignatureIfConfigured(req);
  if (!verify.ok) {
    return res.status(verify.status).json({ success: false, message: verify.message });
  }

  res.status(200).json({ success: true, received: true });

  setImmediate(async () => {
    try {
      const payload = req.body || {};
      const eventType = detectEventType(payload);
      const deep = deepRefs(payload);

      const isSuccess = eventVariants(eventType).some((v) => SUCCESS_EVENTS.has(v));
      const isFailure = eventVariants(eventType).some((v) => FAILURE_EVENTS.has(v));

      if (!isSuccess && !isFailure) {
        console.log('Zoho webhook ignored event type:', eventType || '[empty]');
        return;
      }

      const quotationId = await resolveQuotationId(payload, deep);
      if (!quotationId) {
        console.warn('Zoho webhook: could not resolve quotation from payload', {
          eventType,
          reference: deep.reference,
          payment_link_id: deep.payment_link_id,
        });
        return;
      }

      const amountRaw = pickFirstDefined(
        payload?.data?.amount,
        payload?.event_object?.payment?.amount,
        payload?.amount
      );
      const amount =
        typeof amountRaw === 'string' ? Number(amountRaw) : typeof amountRaw === 'number' ? amountRaw : undefined;

      if (isSuccess) {
        await applyPaymentSuccess(quotationId, {
          payment_link_id: deep.payment_link_id,
          zoho_payment_id: deep.zoho_payment_id,
          amount,
        });
      } else if (isFailure) {
        await applyPaymentFailure(quotationId, {
          payment_link_id: deep.payment_link_id,
        });
      }
    } catch (err) {
      console.error('Zoho webhook processing error:', err);
    }
  });
});

module.exports = router;
