const Order = require('../models/Order');
const Quotation = require('../models/Quotation');
const {
  sendPaymentConfirmation,
  sendCustomerPaymentConfirmation,
} = require('./emailService');

/**
 * Send payment-success emails once per order, only when payment is actually completed.
 * For Zoho online flow, also requires quotation gateway fields Paid/Success.
 */
async function sendPaymentSuccessEmailsOnce(orderId) {
  const order = await Order.findById(orderId).populate(
    'customer',
    'firstName lastName email companyName phoneNumber'
  );
  if (!order) return { sent: false, reason: 'order_not_found' };

  if (order.payment?.status !== 'completed') {
    return { sent: false, reason: 'payment_not_completed' };
  }

  if (order.payment?.confirmationEmailSentAt) {
    return { sent: false, reason: 'already_sent' };
  }

  if (order.quotation) {
    const quotation = await Quotation.findById(order.quotation)
      .select('zohoPaymentLinkId orderPaymentWorkflowStatus payment_status')
      .lean();

    const isManualSettlement =
      order.payment?.gateway === 'manual' || order.payment?.gateway === 'cod';

    if (
      quotation?.zohoPaymentLinkId &&
      !isManualSettlement &&
      !(
        quotation.orderPaymentWorkflowStatus === 'Paid' &&
        quotation.payment_status === 'Success'
      )
    ) {
      return { sent: false, reason: 'zoho_not_confirmed' };
    }
  }

  try {
    await sendPaymentConfirmation(order);
  } catch (err) {
    console.error('Backoffice payment confirmation email failed:', err.message);
  }

  try {
    await sendCustomerPaymentConfirmation(order);
  } catch (err) {
    console.error('Customer payment confirmation email failed:', err.message);
  }

  await Order.updateOne(
    { _id: order._id },
    { $set: { 'payment.confirmationEmailSentAt': new Date() } }
  );

  return { sent: true };
}

module.exports = {
  sendPaymentSuccessEmailsOnce,
};
