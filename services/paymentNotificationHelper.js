const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Quotation = require('../models/Quotation');
const Order = require('../models/Order');
const Inquiry = require('../models/Inquiry');
const Payment = require('../models/Payment');

async function paymentSuccessNotificationExists(userId, relatedEntity, title) {
  if (!userId || !relatedEntity?.entityId) return false;
  const existing = await Notification.findOne({
    userId,
    title,
    'relatedEntity.type': relatedEntity.type,
    'relatedEntity.entityId': relatedEntity.entityId,
  })
    .select('_id')
    .lean();
  return Boolean(existing);
}

async function markCompletePaymentPromptsRead(customerUserId, orderId) {
  if (!customerUserId || !orderId) return;
  await Notification.updateMany(
    {
      userId: customerUserId,
      read: false,
      title: 'Complete Your Payment',
      'relatedEntity.type': 'order',
      'relatedEntity.entityId': orderId,
    },
    { $set: { read: true, readAt: new Date() } }
  );
}

/**
 * Idempotent: creates in-app notifications if missing (handles duplicate Zoho settlement).
 */
async function ensurePaymentSuccessNotifications(quotationId, opts = {}) {
  try {
    await createPaymentSuccessNotifications(quotationId, opts);
  } catch (err) {
    console.error('Payment success in-app notifications failed:', err.message);
  }
}

/**
 * In-app notifications when payment succeeds (Zoho webhook / sync / manual).
 */
async function createPaymentSuccessNotifications(quotationId, opts = {}) {
  const quotation = await Quotation.findById(quotationId).lean();
  if (!quotation) {
    console.warn('Payment notifications: quotation not found', quotationId);
    return;
  }

  const txnId =
    opts.zoho_payment_id != null
      ? String(opts.zoho_payment_id)
      : opts.payment_link_id != null
        ? String(opts.payment_link_id)
        : opts.transactionId != null
          ? String(opts.transactionId)
          : '';

  let customerUserId = null;
  let orderId = quotation.order || null;
  let orderNumber = quotation.quotationNumber;
  let amount =
    typeof opts.amount === 'number' && !Number.isNaN(opts.amount)
      ? opts.amount
      : quotation.totalAmount;

  let orderForWs = null;

  if (orderId) {
    const order = await Order.findById(orderId)
      .populate('customer', 'firstName lastName email')
      .lean();
    if (order) {
      orderForWs = order;
      customerUserId = order.customer?._id || order.customer;
      orderNumber = order.orderNumber || orderNumber;
      amount = order.totalAmount ?? amount;
    }
  }

  if (!customerUserId && quotation.inquiryId) {
    let inquiryId = quotation.inquiryId;
    if (typeof inquiryId === 'object' && inquiryId._id) {
      inquiryId = inquiryId._id;
    }
    if (mongoose.Types.ObjectId.isValid(String(inquiryId))) {
      const inquiry = await Inquiry.findById(inquiryId).select('customer inquiryNumber').lean();
      if (inquiry?.customer) {
        customerUserId = inquiry.customer;
        if (!orderNumber && inquiry.inquiryNumber) {
          orderNumber = inquiry.inquiryNumber;
        }
      }
    }
  }

  if (!customerUserId) {
    const payRow = await Payment.findOne({
      quotation: quotation._id,
      payment_status: 'success',
    })
      .sort({ createdAt: -1 })
      .select('user_id')
      .lean();
    if (payRow?.user_id) {
      customerUserId = payRow.user_id;
    }
  }

  const displayRef =
    orderForWs?.orderNumber ||
    quotation.quotationNumber ||
    orderNumber ||
    'your order';
  const relatedEntity = orderId
    ? { type: 'order', entityId: orderId }
    : { type: 'quotation', entityId: quotation._id };

  if (customerUserId) {
    const alreadySent = await paymentSuccessNotificationExists(
      customerUserId,
      relatedEntity,
      'Payment Successful'
    );
    if (!alreadySent) {
      await Notification.createNotification({
        title: 'Payment Successful',
        message: `Your payment of ₹${amount} for ${displayRef} has been received successfully. Your order will be confirmed by our team shortly.`,
        type: 'success',
        userId: customerUserId,
        relatedEntity,
        metadata: {
          orderNumber: orderForWs?.orderNumber,
          quotationNumber: quotation.quotationNumber,
          totalAmount: amount,
          paymentStatus: 'completed',
          transactionId: txnId,
          paidAt: new Date(),
        },
      });
      console.log('Payment success notification created for customer', customerUserId);
    }
    if (orderId) {
      await markCompletePaymentPromptsRead(customerUserId, orderId);
    }
  } else {
    console.warn('Payment success notification: no customer userId for quotation', quotationId);
  }

  const adminUsers = await User.find({
    role: { $in: ['admin', 'backoffice', 'subadmin'] },
  })
    .select('_id')
    .lean();

  for (const admin of adminUsers) {
    const adminAlreadySent = await paymentSuccessNotificationExists(
      admin._id,
      relatedEntity,
      'Payment Received'
    );
    if (adminAlreadySent) continue;

    await Notification.createNotification({
      title: 'Payment Received',
      message: `Payment of ₹${amount} received for ${displayRef}.${txnId ? ` Transaction ID: ${txnId}` : ''}`,
      type: 'success',
      userId: admin._id,
      relatedEntity,
      metadata: {
        orderNumber: orderForWs?.orderNumber,
        quotationNumber: quotation.quotationNumber,
        paymentAmount: amount,
        transactionId: txnId,
        paidAt: new Date(),
      },
    });
  }

  if (orderForWs) {
    try {
      const websocketService = require('./websocketService');
      websocketService.notifyPaymentReceived(orderForWs, amount, txnId);
    } catch (wsErr) {
      console.error('WebSocket payment notification failed:', wsErr.message);
    }
  }

  console.log('Payment success notifications created', { quotationId, displayRef });
}

/**
 * Create missing "Payment Successful" notifications for all paid quotations belonging to a customer.
 */
async function backfillPaidPaymentNotificationsForUser(userId) {
  if (!userId) return { backfilled: 0 };

  const inquiries = await Inquiry.find({ customer: userId }).select('_id').lean();
  const inquiryIds = inquiries.map((i) => i._id);
  if (!inquiryIds.length) return { backfilled: 0 };

  const paidQuotations = await Quotation.find({
    inquiryId: { $in: inquiryIds },
    orderPaymentWorkflowStatus: 'Paid',
    payment_status: 'Success',
  })
    .select('_id')
    .lean();

  for (const q of paidQuotations) {
    await ensurePaymentSuccessNotifications(String(q._id), {});
  }

  return { checked: paidQuotations.length };
}

module.exports = {
  createPaymentSuccessNotifications,
  ensurePaymentSuccessNotifications,
  backfillPaidPaymentNotificationsForUser,
};
