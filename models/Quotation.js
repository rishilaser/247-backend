const mongoose = require('mongoose');

const quotationSchema = new mongoose.Schema({
  quotationNumber: {
    type: String,
    unique: true,
    sparse: true
  },
  inquiryId: {
    type: String,
    required: true,
    unique: true
  },
  customerInfo: {
    name: {
      type: String,
      required: true
    },
    company: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    phone: {
      type: String,
      required: true
    }
  },
  totalAmount: {
    type: Number,
    required: true
  },
  items: [{
    partRef: String,
    material: String,
    thickness: String,
    grade: String,
    quantity: Number,
    unitPrice: Number,
    totalPrice: Number,
    remark: String
  }],
  quotationPdf: {
    type: String,
    required: false
    // ✅ BEST PRACTICE: Store filename only. File is stored on disk at /uploads/quotations/
    // Access file via: /uploads/quotations/{quotationPdf}
  },
  quotationPdfFilename: {
    type: String,
    required: false
    // Original filename for display purposes
  },
  // ⚠️ DEPRECATED: These fields store PDF as Buffer in database (NOT RECOMMENDED)
  // Kept for backward compatibility with existing records
  // New uploads should NOT use these fields - files are stored on disk instead
  quotationPdfData: {
    type: Buffer,
    required: false
  },
  quotationPdfBuffer: {
    type: Buffer,
    required: false
  },
  quotationPdfContentType: {
    type: String,
    required: false
  },
  status: {
    type: String,
    enum: ['draft', 'created', 'uploaded', 'sent', 'accepted', 'rejected', 'order_created'],
    default: 'draft'
  },
  /** Customer checkout lifecycle (Zoho). Do not set to Paid from redirect alone; webhooks only. */
  orderPaymentWorkflowStatus: {
    type: String,
    enum: ['Quoted', 'Payment Pending', 'Paid', 'Failed'],
    required: false,
    index: true
  },
  /** Gateway outcome for the hosted checkout flow (webhook-driven). */
  payment_status: {
    type: String,
    enum: ['Pending', 'Success', 'Failed'],
    required: false
  },
  payment_date: {
    type: Date,
    required: false
  },
  zohoPaymentLinkId: {
    type: String,
    required: false,
    index: true
  },
  sentAt: {
    type: Date
  },
  acceptedAt: {
    type: Date
  },
  rejectedAt: {
    type: Date
  },
  rejectionReason: {
    type: String
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  orderCreatedAt: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  validUntil: {
    type: Date,
    required: false
  },
  terms: {
    type: String,
    default: 'Standard manufacturing terms apply. Payment required before production begins.'
  },
  notes: {
    type: String,
    default: ''
  },
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

// Generate quotation number using nomenclature config
quotationSchema.pre('save', async function() {
  if (this.isNew && !this.quotationNumber) {
    try {
      const NomenclatureConfig = require('./NomenclatureConfig');
      this.quotationNumber = await NomenclatureConfig.generateId('quotation');
    } catch (error) {
      console.error('Error generating quotation number:', error);
      // Fallback to old format if nomenclature fails
      const date = new Date();
      const year = date.getFullYear().toString().slice(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      this.quotationNumber = `QUO${year}${month}${day}${random}`;
    }
  }
});

// Exclude PDF buffer from JSON responses (too large)
// Note: This only affects API responses, NOT database storage
quotationSchema.methods.toJSON = function() {
  const obj = this.toObject();
  // Remove PDF buffers from JSON responses to avoid huge payloads
  // The data is still stored in the database, just excluded from JSON responses
  if (obj.quotationPdfData) {
    delete obj.quotationPdfData;
  }
  if (obj.quotationPdfBuffer) {
    delete obj.quotationPdfBuffer;
  }
  // Also handle old format where quotationPdf is an object
  if (obj.quotationPdf && typeof obj.quotationPdf === 'object' && obj.quotationPdf.data) {
    // Keep metadata but remove binary data
    obj.quotationPdf = {
      fileName: obj.quotationPdf.fileName,
      contentType: obj.quotationPdf.contentType,
      generatedAt: obj.quotationPdf.generatedAt,
      _note: 'PDF data stored in database (excluded from JSON response)'
    };
  }
  return obj;
};

// Index for better query performance
// Note: inquiryId and quotationNumber already have unique: true which creates indexes automatically
quotationSchema.index({ 'customerInfo.email': 1 });
quotationSchema.index({ status: 1 });
quotationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Quotation', quotationSchema);