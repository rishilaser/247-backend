const express = require('express');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const Quotation = require('../models/Quotation');
const Inquiry = require('../models/Inquiry');
const Payment = require('../models/Payment');

const router = express.Router();

function makeReferenceId() {
  return `ref_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

// POST /api/zoho/init
// Creates a local Payment record (pending) and returns reference_id + amount for frontend widget.
router.post('/init', authenticateToken, async (req, res) => {
  try {
    const { quotationId } = req.body || {};
    if (!quotationId) {
      return res.status(400).json({ success: false, message: 'quotationId is required' });
    }

    const quotation = await Quotation.findById(quotationId);
    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }

    const inquiry = await Inquiry.findById(quotation.inquiryId).populate(
      'customer',
      'firstName lastName email phoneNumber'
    );
    if (!inquiry) {
      return res.status(404).json({ success: false, message: 'Associated inquiry not found' });
    }

    const amount = Number(quotation.totalAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid quotation amount' });
    }

    const reference_id = makeReferenceId();

    await Payment.create({
      transaction_id: reference_id,
      payment_status: 'pending',
      amount,
      user_id: inquiry.customer?._id
    });

    return res.json({
      success: true,
      reference_id,
      amount,
      currency: 'INR',
      customer: {
        name: `${inquiry.customer?.firstName || ''} ${inquiry.customer?.lastName || ''}`.trim(),
        email: inquiry.customer?.email,
        phone: inquiry.customer?.phoneNumber
      }
    });
  } catch (error) {
    console.error('Zoho init payment error:', error);
    return res.status(500).json({ success: false, message: 'Failed to initialize payment' });
  }
});

module.exports = router;

