const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Inquiry = require('../models/Inquiry');

function statusTransitionKey(entityType, entityId, newStatus) {
  return `${entityType}:${String(entityId)}:${newStatus}`;
}

async function statusNotificationExists(userId, statusKey) {
  if (!userId || !statusKey) return false;
  const existing = await Notification.findOne({
    userId,
    'metadata.statusKey': statusKey,
  })
    .select('_id')
    .lean();
  return Boolean(existing);
}

async function createStatusNotification({
  userId,
  title,
  message,
  type = 'info',
  relatedEntity,
  statusKey,
  metadata = {},
}) {
  if (!userId || !title || !message) return null;

  if (statusKey && (await statusNotificationExists(userId, statusKey))) {
    return null;
  }

  return Notification.createNotification({
    title,
    message,
    type,
    userId,
    relatedEntity,
    metadata: {
      ...metadata,
      statusKey,
    },
  });
}

async function notifyStaff({ title, message, type, relatedEntity, statusKey, metadata }) {
  const staff = await User.find({ role: { $in: ['admin', 'backoffice', 'subadmin'] } })
    .select('_id')
    .lean();

  for (const admin of staff) {
    await createStatusNotification({
      userId: admin._id,
      title,
      message,
      type,
      relatedEntity,
      statusKey: statusKey ? `${statusKey}:staff:${admin._id}` : undefined,
      metadata,
    });
  }
}

const INQUIRY_MESSAGES = {
  reviewed: {
    title: 'Inquiry Under Review',
    message: (n) => `Your inquiry ${n} is being reviewed by our team.`,
    type: 'info',
  },
  quoted: {
    title: 'Quotation Being Prepared',
    message: (n) => `Your inquiry ${n} has been quoted. You will be notified when the quotation is ready.`,
    type: 'info',
  },
  accepted: {
    title: 'Quote Accepted',
    message: (n) => `You accepted the quote for inquiry ${n}. Proceed to payment when ready.`,
    type: 'success',
  },
  payment_received: {
    title: 'Payment Received',
    message: (n) => `Payment for inquiry ${n} has been received. Your order will be confirmed shortly.`,
    type: 'success',
  },
  rejected: {
    title: 'Inquiry Rejected',
    message: (n) => `Inquiry ${n} was marked as rejected.`,
    type: 'warning',
  },
  cancelled: {
    title: 'Inquiry Cancelled',
    message: (n) => `Inquiry ${n} has been cancelled.`,
    type: 'warning',
  },
};

const QUOTATION_MESSAGES = {
  sent: {
    title: 'Quotation Ready',
    message: (n) => `Quotation ${n} is ready for your review. Please accept or reject the quote.`,
    type: 'info',
    notifyStaff: true,
    staffTitle: 'Quotation Sent',
    staffMessage: (n) => `Quotation ${n} was sent to the customer.`,
  },
  accepted: {
    title: 'Quotation Accepted',
    message: (n) => `You accepted quotation ${n}. You can complete payment from your dashboard.`,
    type: 'success',
    notifyStaff: true,
    staffTitle: 'Quotation Accepted',
    staffMessage: (n) => `Customer accepted quotation ${n}.`,
  },
  rejected: {
    title: 'Quotation Rejected',
    message: (n) => `Quotation ${n} was rejected.`,
    type: 'warning',
    notifyStaff: true,
    staffTitle: 'Quotation Rejected',
    staffMessage: (n) => `Customer rejected quotation ${n}.`,
  },
  order_created: {
    title: 'Order Created',
    message: (n) => `Order for quotation ${n} has been created. Complete payment to confirm.`,
    type: 'info',
  },
};

const ORDER_MESSAGES = {
  confirmed: {
    title: 'Order Confirmed',
    message: (n) => `Your order ${n} has been confirmed by our team.`,
    type: 'success',
    notifyStaff: true,
    staffTitle: 'Order Confirmed',
    staffMessage: (n) => `Order ${n} was confirmed.`,
  },
  in_production: {
    title: 'Production Started',
    message: (n) => `Your order ${n} is now in production.`,
    type: 'info',
  },
  ready_for_dispatch: {
    title: 'Ready for Dispatch',
    message: (n) => `Your order ${n} is ready for dispatch.`,
    type: 'info',
  },
  dispatched: {
    title: 'Order Dispatched',
    message: (n, ctx) =>
      ctx?.trackingNumber
        ? `Your order ${n} has been dispatched. Tracking: ${ctx.trackingNumber}${ctx.courier ? ` (${ctx.courier})` : ''}.`
        : `Your order ${n} has been dispatched. Tracking details will be shared soon.`,
    type: 'success',
  },
  delivered: {
    title: 'Order Delivered',
    message: (n) => `Your order ${n} has been delivered. Thank you for choosing us!`,
    type: 'success',
  },
  cancelled: {
    title: 'Order Cancelled',
    message: (n) => `Your order ${n} has been cancelled.`,
    type: 'warning',
    notifyStaff: true,
    staffTitle: 'Order Cancelled',
    staffMessage: (n) => `Order ${n} was cancelled.`,
  },
};

/**
 * Notify customer (and optionally staff) when inquiry status changes.
 */
async function notifyInquiryStatusChange(inquiry, oldStatus, newStatus) {
  if (!inquiry?._id || !newStatus || oldStatus === newStatus) return;

  const tpl = INQUIRY_MESSAGES[newStatus];
  if (!tpl) return;

  let customerId = inquiry.customer?._id || inquiry.customer;
  if (!customerId) {
    const row = await Inquiry.findById(inquiry._id).select('customer').lean();
    customerId = row?.customer;
  }
  if (!customerId) return;

  const ref = inquiry.inquiryNumber || String(inquiry._id);
  const statusKey = statusTransitionKey('inquiry', inquiry._id, newStatus);

  await createStatusNotification({
    userId: customerId,
    title: tpl.title,
    message: tpl.message(ref),
    type: tpl.type,
    relatedEntity: { type: 'inquiry', entityId: inquiry._id },
    statusKey,
    metadata: { inquiryNumber: ref, oldStatus, newStatus },
  });

  setImmediate(() => {
    const { sendInquiryStatusEmailsOnce } = require('./inquiryStatusEmailHelper');
    sendInquiryStatusEmailsOnce(inquiry, oldStatus, newStatus).catch((err) => {
      console.error('Inquiry status email failed:', err.message);
    });
  });
}

/**
 * Notify when quotation status changes (sent, accepted, rejected, order_created).
 */
async function notifyQuotationStatusChange(quotation, oldStatus, newStatus, options = {}) {
  if (!quotation?._id || !newStatus || oldStatus === newStatus) return;

  const tpl = QUOTATION_MESSAGES[newStatus];
  if (!tpl) return;

  let customerId = options.customerId;
  if (!customerId && quotation.inquiryId) {
    const inquiry = await Inquiry.findById(quotation.inquiryId).select('customer inquiryNumber').lean();
    customerId = inquiry?.customer;
  }
  if (!customerId) return;

  const ref = quotation.quotationNumber || String(quotation._id);
  const statusKey = statusTransitionKey('quotation', quotation._id, newStatus);

  await createStatusNotification({
    userId: customerId,
    title: tpl.title,
    message: tpl.message(ref),
    type: tpl.type,
    relatedEntity: { type: 'quotation', entityId: quotation._id },
    statusKey,
    metadata: { quotationNumber: ref, oldStatus, newStatus },
  });

  if (tpl.notifyStaff) {
    const staffKey = statusTransitionKey('quotation', quotation._id, `${newStatus}:staff`);
    await notifyStaff({
      title: tpl.staffTitle,
      message: tpl.staffMessage(ref),
      type: tpl.type,
      relatedEntity: { type: 'quotation', entityId: quotation._id },
      statusKey: staffKey,
      metadata: { quotationNumber: ref, oldStatus, newStatus },
    });
  }
}

/**
 * Notify when order status changes.
 */
async function notifyOrderStatusChange(order, oldStatus, newStatus, context = {}) {
  if (!order?._id || !newStatus || oldStatus === newStatus) return;

  const tpl = ORDER_MESSAGES[newStatus];
  if (!tpl) return;

  const customerId = order.customer?._id || order.customer;
  if (!customerId) return;

  const ref = order.orderNumber || String(order._id);
  const statusKey = statusTransitionKey('order', order._id, newStatus);

  await createStatusNotification({
    userId: customerId,
    title: tpl.title,
    message: tpl.message(ref, context),
    type: tpl.type,
    relatedEntity: { type: 'order', entityId: order._id },
    statusKey,
    metadata: {
      orderNumber: ref,
      oldStatus,
      newStatus,
      ...context,
    },
  });

  if (tpl.notifyStaff) {
    const staffKey = statusTransitionKey('order', order._id, `${newStatus}:staff`);
    await notifyStaff({
      title: tpl.staffTitle,
      message: tpl.staffMessage(ref),
      type: tpl.type,
      relatedEntity: { type: 'order', entityId: order._id },
      statusKey: staffKey,
      metadata: { orderNumber: ref, oldStatus, newStatus },
    });
  }
}

/**
 * Customer reminder when online order is created and awaiting Zoho payment.
 */
async function notifyOrderAwaitingPayment(order) {
  const customerId = order.customer?._id || order.customer;
  if (!customerId || !order?._id) return;

  const ref = order.orderNumber || String(order._id);
  const statusKey = statusTransitionKey('order', order._id, 'awaiting_payment');

  await createStatusNotification({
    userId: customerId,
    title: 'Complete Your Payment',
    message: `Your order ${ref} is ready. Complete payment via the Zoho link to confirm your order.`,
    type: 'info',
    relatedEntity: { type: 'order', entityId: order._id },
    statusKey,
    metadata: { orderNumber: ref, paymentStatus: 'pending' },
  });
}

/**
 * Fire-and-forget wrapper for route handlers (non-blocking).
 */
function scheduleStatusNotification(fn) {
  setImmediate(() => {
    fn().catch((err) => {
      console.error('Status notification failed:', err.message);
    });
  });
}

module.exports = {
  notifyInquiryStatusChange,
  notifyQuotationStatusChange,
  notifyOrderStatusChange,
  notifyOrderAwaitingPayment,
  scheduleStatusNotification,
  statusTransitionKey,
};
