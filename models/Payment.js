const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    transaction_id: { type: String, required: true, index: true, unique: true },
    payment_status: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
      index: true
    },
    amount: { type: Number },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    quotation: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);

