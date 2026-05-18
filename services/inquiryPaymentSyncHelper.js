const mongoose = require('mongoose');
const Inquiry = require('../models/Inquiry');
const Quotation = require('../models/Quotation');
const { notifyInquiryStatusChange } = require('./statusNotificationService');

const STATUSES_SYNC_TO_PAYMENT_RECEIVED = new Set([
  'pending',
  'reviewed',
  'quoted',
  'accepted',
]);

function isGatewayPaid(quotationDoc) {
  if (!quotationDoc) return false;
  return (
    quotationDoc.orderPaymentWorkflowStatus === 'Paid' && quotationDoc.payment_status === 'Success'
  );
}

/**
 * Load quotation row for an inquiry (by ref or by inquiryId).
 */
async function findQuotationForInquiry(inquiryLean) {
  if (!inquiryLean) return null;
  const ref = inquiryLean.quotation;
  const quotationRefId =
    ref && typeof ref === 'object' && ref._id ? ref._id : ref || null;

  if (quotationRefId) {
    const q = await Quotation.findById(quotationRefId)
      .select(
        'orderPaymentWorkflowStatus payment_status payment_date inquiryId quotationNumber status totalAmount validUntil'
      )
      .lean();
    if (q) return q;
  }
  return Quotation.findOne({ inquiryId: String(inquiryLean._id) })
    .select(
      'orderPaymentWorkflowStatus payment_status payment_date inquiryId quotationNumber status totalAmount validUntil'
    )
    .lean();
}

/**
 * If Zoho webhook updated the quotation but the inquiry row still says "quoted",
 * align inquiry.status to payment_received (source of truth: webhook → quotation).
 */
async function syncInquiryWithQuotationPayment(inquiryLean) {
  if (!inquiryLean || !inquiryLean._id) return inquiryLean;

  const q = await findQuotationForInquiry(inquiryLean);
  if (q) {
    inquiryLean.quotationPayment = {
      orderPaymentWorkflowStatus: q.orderPaymentWorkflowStatus,
      payment_status: q.payment_status,
      gatewayPaid: isGatewayPaid(q),
    };
    if (inquiryLean.quotation && typeof inquiryLean.quotation === 'object' && inquiryLean.quotation !== null) {
      inquiryLean.quotation.orderPaymentWorkflowStatus = q.orderPaymentWorkflowStatus;
      inquiryLean.quotation.payment_status = q.payment_status;
      inquiryLean.quotation.payment_date = q.payment_date;
    }
  }

  if (
    q &&
    isGatewayPaid(q) &&
    inquiryLean.status &&
    STATUSES_SYNC_TO_PAYMENT_RECEIVED.has(inquiryLean.status)
  ) {
    const oldStatus = inquiryLean.status;
    await Inquiry.updateOne(
      { _id: inquiryLean._id },
      { $set: { status: 'payment_received', updatedAt: new Date() } }
    );
    inquiryLean.status = 'payment_received';
    await notifyInquiryStatusChange(
      {
        _id: inquiryLean._id,
        inquiryNumber: inquiryLean.inquiryNumber,
        customer: inquiryLean.customer,
      },
      oldStatus,
      'payment_received'
    );
  }

  return inquiryLean;
}

function quotationIdKey(ref) {
  if (!ref) return null;
  if (ref instanceof mongoose.Types.ObjectId) return ref.toString();
  if (typeof ref === 'object' && ref._id) return ref._id.toString();
  return String(ref);
}

/**
 * Batch: fix inquiry.status from quotation payment for list endpoints (admin/customer).
 */
async function syncInquiryListStatusesFromQuotations(inquiriesLean, quotationRowsById) {
  if (!inquiriesLean || !inquiriesLean.length) return inquiriesLean;

  const quotationRowsByIdSafe = quotationRowsById || {};
  const candidates = inquiriesLean.filter((inq) =>
    STATUSES_SYNC_TO_PAYMENT_RECEIVED.has(inq.status)
  );
  const inquiryIds = candidates.map((i) => String(i._id));

  const byInquiryId = {};
  if (inquiryIds.length > 0) {
    const qrows = await Quotation.find({ inquiryId: { $in: inquiryIds } })
      .select('inquiryId orderPaymentWorkflowStatus payment_status')
      .lean();
    qrows.forEach((row) => {
      if (row && row.inquiryId) {
        byInquiryId[String(row.inquiryId)] = row;
      }
    });
  }

  const ops = [];

  for (const inq of inquiriesLean) {
    if (!STATUSES_SYNC_TO_PAYMENT_RECEIVED.has(inq.status)) continue;

    const refKey = quotationIdKey(inq.quotation);
    const qByRef = refKey ? quotationRowsByIdSafe[refKey] : null;
    const qByInq = byInquiryId[String(inq._id)];
    const q = qByRef || qByInq;

    if (q && isGatewayPaid(q)) {
      ops.push({
        updateOne: {
          filter: { _id: inq._id },
          update: { $set: { status: 'payment_received', updatedAt: new Date() } },
        },
      });
      inq.status = 'payment_received';
    }
  }

  if (ops.length > 0) {
    try {
      await Inquiry.bulkWrite(ops);
    } catch (e) {
      console.error('syncInquiryListStatusesFromQuotations bulkWrite:', e.message);
    }
  }

  return inquiriesLean;
}

module.exports = {
  findQuotationForInquiry,
  syncInquiryWithQuotationPayment,
  syncInquiryListStatusesFromQuotations,
  isGatewayPaid,
  STATUSES_SYNC_TO_PAYMENT_RECEIVED,
};
