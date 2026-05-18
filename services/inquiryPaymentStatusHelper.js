const mongoose = require('mongoose');
const Inquiry = require('../models/Inquiry');
const { notifyInquiryStatusChange } = require('./statusNotificationService');

/**
 * When Zoho confirms payment for a quotation (before or without an Order record),
 * move inquiry to payment_received for admin visibility.
 */
async function markInquiryPaymentReceivedForQuotation(quotationDoc) {
  try {
    if (!quotationDoc?.inquiryId) return;
    let inquiryId = quotationDoc.inquiryId;
    if (typeof inquiryId === 'object' && inquiryId._id) {
      inquiryId = inquiryId._id;
    }
    if (!mongoose.Types.ObjectId.isValid(inquiryId)) {
      return;
    }

    const inquiry = await Inquiry.findById(inquiryId)
      .select('status inquiryNumber customer')
      .lean();
    if (!inquiry || inquiry.status === 'payment_received') {
      return;
    }

    const oldStatus = inquiry.status;
    await Inquiry.updateOne(
      {
        _id: inquiryId,
        status: { $nin: ['rejected', 'cancelled'] },
      },
      { $set: { status: 'payment_received', updatedAt: new Date() } }
    );

    await notifyInquiryStatusChange(
      { _id: inquiryId, inquiryNumber: inquiry.inquiryNumber, customer: inquiry.customer },
      oldStatus,
      'payment_received'
    );
  } catch (err) {
    console.error('markInquiryPaymentReceivedForQuotation:', err.message);
  }
}

/**
 * When customer payment completes for an order, update the linked inquiry so admin lists show "Payment received".
 */
async function markInquiryPaymentReceivedForOrder(orderDoc) {
  try {
    if (!orderDoc?.payment || orderDoc.payment.status !== 'completed') {
      return;
    }

    let inquiryId = orderDoc.inquiry;
    if (!inquiryId) return;
    if (typeof inquiryId === 'object' && inquiryId._id) {
      inquiryId = inquiryId._id;
    }

    if (!mongoose.Types.ObjectId.isValid(inquiryId)) {
      return;
    }

    const inquiry = await Inquiry.findById(inquiryId)
      .select('status inquiryNumber customer')
      .lean();
    if (!inquiry || inquiry.status === 'payment_received') {
      return;
    }

    const oldStatus = inquiry.status;
    await Inquiry.updateOne(
      {
        _id: inquiryId,
        status: { $nin: ['rejected', 'cancelled'] },
      },
      { $set: { status: 'payment_received', updatedAt: new Date() } }
    );

    await notifyInquiryStatusChange(
      { _id: inquiryId, inquiryNumber: inquiry.inquiryNumber, customer: inquiry.customer },
      oldStatus,
      'payment_received'
    );
  } catch (err) {
    console.error('markInquiryPaymentReceivedForOrder:', err.message);
  }
}

module.exports = {
  markInquiryPaymentReceivedForOrder,
  markInquiryPaymentReceivedForQuotation,
};
