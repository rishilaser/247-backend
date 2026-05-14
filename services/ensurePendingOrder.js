const Order = require('../models/Order');

/**
 * Build order line items from quotation items or inquiry parts (same rules as routes/order.js).
 */
function buildOrderParts(quotation, inquiry, totalAmount) {
  let orderParts = quotation.items && quotation.items.length ? [...quotation.items] : null;
  if (!orderParts || orderParts.length === 0) {
    if (inquiry.parts && inquiry.parts.length > 0) {
      const ta = totalAmount || quotation.totalAmount || 0;
      const totalQuantity = inquiry.parts.reduce((sum, part) => sum + (part.quantity || 0), 0);
      orderParts = inquiry.parts.map((part) => {
        const quantity = part.quantity || 0;
        const itemTotalPrice =
          totalQuantity > 0 ? (ta * quantity) / totalQuantity : ta / inquiry.parts.length;
        const unitPrice = quantity > 0 ? itemTotalPrice / quantity : itemTotalPrice;
        return {
          partName: part.partName || part.partRef || 'N/A',
          partRef: part.partRef || part.partName || 'N/A',
          material: part.material || 'N/A',
          thickness: part.thickness || 'N/A',
          quantity,
          remarks: part.remarks || '',
          unitPrice,
          totalPrice: itemTotalPrice,
        };
      });
    }
  }
  return orderParts || [];
}

/**
 * Ensures a pending online-payment order exists for an accepted quotation.
 * Idempotent: returns existing pending order or throws if already paid.
 *
 * @param {import('mongoose').Document} quotation — live quotation doc (will be saved)
 * @param {import('mongoose').Document} inquiry — inquiry doc with parts
 * @param {string|import('mongoose').Types.ObjectId} customerId
 */
async function ensurePendingOnlineOrder(quotation, inquiry, customerId) {
  const existing = await Order.findOne({ quotation: quotation._id });
  if (existing) {
    if (existing.payment?.status === 'completed') {
      const err = new Error('Order is already paid');
      err.code = 'ORDER_PAID';
      throw err;
    }
    return { order: existing, created: false };
  }

  const totalAmount = quotation.totalAmount;
  const orderParts = buildOrderParts(quotation, inquiry, totalAmount);

  const order = new Order({
    quotation: quotation._id,
    inquiry: inquiry._id,
    customer: customerId,
    parts: orderParts,
    totalAmount,
    payment: {
      method: 'credit_card',
      status: 'pending',
      amount: totalAmount,
      paidAt: null,
    },
    status: 'pending',
    confirmedAt: null,
    deliveryAddress: inquiry.deliveryAddress,
    specialInstructions: inquiry.specialInstructions,
  });

  await order.save();

  // Keep quotation as "accepted" until gateway confirms payment success.
  // This prevents false "Paid" display on simple redirect/return from checkout.
  quotation.order = order._id;
  quotation.orderCreatedAt = new Date();
  await quotation.save();

  return { order, created: true };
}

module.exports = {
  ensurePendingOnlineOrder,
  buildOrderParts,
};
