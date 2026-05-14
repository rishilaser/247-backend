// Razorpay integration removed.
// This module remains as a minimal stub to avoid breaking existing imports.

module.exports = {
  isRazorpayConfigured: false,
  razorpayInstance: null,
  createPaymentOrder: async () => ({ success: false, message: 'Razorpay integration removed' }),
  verifyPayment: () => ({ success: false, message: 'Razorpay integration removed' }),
  getPaymentDetails: async () => ({ success: false, message: 'Razorpay integration removed' }),
  refundPayment: async () => ({ success: false, message: 'Razorpay integration removed' }),
  getPaymentAnalytics: async () => ({ success: false, message: 'Razorpay integration removed' })
};
