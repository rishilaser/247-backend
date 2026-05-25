const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: false, // Will be auto-generated in pre-save hook
    unique: true
  },
  inquiry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inquiry',
    required: true
  },
  quotation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quotation',
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'in_production', 'ready_for_dispatch', 'dispatched', 'delivered', 'cancelled'],
    default: 'pending'
  },
  parts: [{
    partName: String,
    partRef: String,
    material: String,
    thickness: String,
    quantity: Number,
    remarks: String,
    unitPrice: Number,
    totalPrice: Number,
    created: {
      type: Date,
      default: Date.now
    },
    modified: {
      type: Date,
      default: Date.now
    }
  }],
  totalAmount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'INR'
  },
  deliveryAddress: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String
  },
  specialInstructions: String,
  payment: {
    method: {
      type: String,
      enum: ['pending', 'credit_card', 'debit_card', 'bank_transfer', 'paypal'],
      default: 'pending'
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    transactionId: String,
    amount: Number,
    paidAt: Date,
    gateway: String,
    confirmationEmailSentAt: Date
  },
  production: {
    startDate: Date,
    estimatedCompletion: Date,
    actualCompletion: Date,
    notes: String
  },
  dispatch: {
    courier: String,
    trackingNumber: String,
    dispatchedAt: Date,
    estimatedDelivery: Date,
    actualDelivery: Date,
    notes: String
  },
  timeline: [{
    status: String,
    description: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  acceptedAt: Date,
  confirmedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Generate order number using nomenclature config
orderSchema.pre('save', async function() {
  if (this.isNew && !this.orderNumber) {
    try {
      const NomenclatureConfig = require('./NomenclatureConfig');
      this.orderNumber = await NomenclatureConfig.generateId('order');
    } catch (error) {
      console.error('Error generating order number:', error);
      // Fallback to old format if nomenclature fails
      const date = new Date();
      const year = date.getFullYear().toString().slice(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      this.orderNumber = `ORD${year}${month}${day}${random}`;
    }
  }
});

// Add timeline entry when status changes
orderSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    const statusDescriptions = {
      'pending': 'Order placed, awaiting confirmation',
      'confirmed': 'Order confirmed, payment verified',
      'in_production': 'Production started',
      'ready_for_dispatch': 'Production completed, ready for dispatch',
      'dispatched': 'Order dispatched',
      'delivered': 'Order delivered successfully',
      'cancelled': 'Order cancelled'
    };
    
    this.timeline.push({
      status: this.status,
      description: statusDescriptions[this.status] || `Status changed to ${this.status}`,
      timestamp: new Date()
    });
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
