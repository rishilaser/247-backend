const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Quotation = require('../models/Quotation');
const Order = require('../models/Order');
const { markInquiryPaymentReceivedForQuotation } = require('./inquiryPaymentStatusHelper');

/**
 * Persist successful Zoho payment (used by webhook and post-redirect API verification).
 */
async function applyPaymentSuccess(quotationId, opts) {
  const now = new Date();
  const { payment_link_id, zoho_payment_id, amount } = opts;

  const q = await Quotation.findById(quotationId);
  if (!q) {
    console.warn('Zoho payment: quotation not found', quotationId);
    return { ok: false, reason: 'quotation_not_found' };
  }

  if (q.orderPaymentWorkflowStatus === 'Paid' && q.payment_status === 'Success') {
    console.log('Zoho payment: duplicate success (idempotent)', quotationId);
    return { ok: true, duplicate: true };
  }

  await Quotation.updateOne(
    { _id: quotationId },
    {
      $set: {
        status: 'order_created',
        orderPaymentWorkflowStatus: 'Paid',
        payment_status: 'Success',
        payment_date: now,
      },
    }
  );

  // Payment row is usually created with transaction_id = payment_link_id. Webhooks may send only payment_id —
  // a single-ID findOne miss leaves payment_status stuck at "pending". Match link id, payment id, or pending row for this quotation.
  const plStr = payment_link_id != null ? String(payment_link_id) : '';
  const zpStr = zoho_payment_id != null ? String(zoho_payment_id) : '';
  const canonicalTxn =
    plStr ||
    zpStr ||
    (q.zohoPaymentLinkId != null ? String(q.zohoPaymentLinkId) : '');

  const paySet = {
    payment_status: 'success',
    quotation: q._id,
  };
  if (canonicalTxn) {
    paySet.transaction_id = canonicalTxn;
  }
  if (typeof amount === 'number' && !Number.isNaN(amount)) {
    paySet.amount = amount;
  }

  const orFilter = [];
  if (plStr) orFilter.push({ transaction_id: plStr });
  if (zpStr && zpStr !== plStr) orFilter.push({ transaction_id: zpStr });
  orFilter.push({ quotation: q._id, payment_status: 'pending' });

  const paidDoc = await Payment.findOneAndUpdate(
    { $or: orFilter },
    { $set: paySet },
    { sort: { createdAt: -1 }, new: true }
  );

  if (!paidDoc && canonicalTxn) {
    await Payment.findOneAndUpdate(
      { transaction_id: canonicalTxn },
      { $set: paySet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  const txnId = plStr || zpStr || canonicalTxn || null;

  if (q.order) {
    const orderSet = {
      'payment.status': 'completed',
      'payment.paidAt': now,
      'payment.transactionId': txnId || String(zoho_payment_id || ''),
      'payment.gateway': 'zoho',
      status: 'confirmed',
      confirmedAt: now,
    };
    if (typeof amount === 'number' && !Number.isNaN(amount)) {
      orderSet['payment.amount'] = amount;
    }
    await Order.updateOne({ _id: q.order }, { $set: orderSet });
  }

  const refreshed = await Quotation.findById(quotationId).lean();
  await markInquiryPaymentReceivedForQuotation(refreshed || q);

  console.log('Zoho payment: quotation marked Paid', { quotationId, txnId });

  return { ok: true, duplicate: false };
}

async function applyPaymentFailure(quotationId, opts) {
  const { payment_link_id } = opts;
  const q = await Quotation.findById(quotationId).select('order orderPaymentWorkflowStatus').lean();

  await Quotation.updateOne(
    {
      _id: quotationId,
      orderPaymentWorkflowStatus: { $nin: ['Paid'] },
    },
    {
      $set: {
        status: 'accepted',
        orderPaymentWorkflowStatus: 'Failed',
        payment_status: 'Failed',
      },
    }
  );

  if (payment_link_id) {
    await Payment.findOneAndUpdate(
      { transaction_id: String(payment_link_id) },
      { $set: { payment_status: 'failed', quotation: new mongoose.Types.ObjectId(quotationId) } },
      { upsert: false }
    );
  }

  if (q?.order) {
    await Order.updateOne(
      { _id: q.order },
      {
        $set: {
          'payment.status': 'failed',
          'payment.gateway': 'zoho',
        },
      }
    );
  }

  console.log('Zoho payment: quotation marked Failed (non-paid only)', { quotationId });
}

module.exports = {
  applyPaymentSuccess,
  applyPaymentFailure,
};
