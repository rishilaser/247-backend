const Inquiry = require('../models/Inquiry');
const User = require('../models/User');
const {
  sendInquiryStatusUpdateEmail,
  sendInquiryStatusStaffEmail,
} = require('./emailService');

const STAFF_NOTIFY_STATUSES = new Set(['accepted', 'payment_received', 'rejected']);

/**
 * Send customer (and optionally staff) emails once per inquiry status transition.
 */
async function sendInquiryStatusEmailsOnce(inquiry, oldStatus, newStatus) {
  if (!inquiry?._id || !newStatus || oldStatus === newStatus) {
    return { sent: false, reason: 'no_transition' };
  }

  const claimed = await Inquiry.findOneAndUpdate(
    { _id: inquiry._id, statusEmailsSent: { $ne: newStatus } },
    { $addToSet: { statusEmailsSent: newStatus } }
  ).select('_id');

  if (!claimed) {
    return { sent: false, reason: 'already_sent' };
  }

  let full = await Inquiry.findById(inquiry._id)
    .populate('customer', 'firstName lastName email companyName')
    .lean();

  if (!full) {
    return { sent: false, reason: 'inquiry_not_found' };
  }

  if (!full.customer?.email && full.customer) {
    const customer = await User.findById(full.customer).select('firstName lastName email').lean();
    if (customer) {
      full = { ...full, customer };
    }
  }

  try {
    await sendInquiryStatusUpdateEmail(full, newStatus, oldStatus);
  } catch (err) {
    console.error('Inquiry status customer email failed:', err.message);
  }

  if (STAFF_NOTIFY_STATUSES.has(newStatus)) {
    try {
      await sendInquiryStatusStaffEmail(full, newStatus, oldStatus);
    } catch (err) {
      console.error('Inquiry status staff email failed:', err.message);
    }
  }

  return { sent: true, status: newStatus };
}

module.exports = {
  sendInquiryStatusEmailsOnce,
};
