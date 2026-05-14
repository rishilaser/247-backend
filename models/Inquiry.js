const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  inquiryNumber: {
    type: String,
    required: false, // Will be auto-generated in pre-save hook
    unique: true
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'quoted', 'accepted', 'payment_received', 'rejected', 'cancelled'],
    default: 'pending'
  },
  quotation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quotation'
  },
  files: [{
    originalName: String,
    fileName: String,
    filePath: String, // Keep for backward compatibility
    fileSize: Number,
    fileType: String,
    fileData: { type: Buffer, required: false }, // Store file as binary in database
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  parts: [{
    partRef: String,
    material: {
      type: String,
      required: true
    },
    thickness: {
      type: String,
      required: true
    },
    grade: String,
    quantity: {
      type: Number,
      required: true
    },
    remarks: String,
    price: {
      type: Number,
      default: 0
    },
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
    default: 0
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
  expectedDeliveryDate: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  backOfficeNotes: String,
  customerNotes: String
}, {
  timestamps: true
});

// Add indexes for faster queries
// Note: inquiryNumber already has unique: true which creates an index automatically
inquirySchema.index({ customer: 1, createdAt: -1 }); // For customer inquiries list
inquirySchema.index({ status: 1, createdAt: -1 }); // For filtering by status
inquirySchema.index({ quotation: 1 }); // For quotation lookups
inquirySchema.index({ createdAt: -1 }); // For admin/all endpoint - fast sorting

// Generate inquiry number using nomenclature config
inquirySchema.pre('save', async function() {
  if (this.isNew && !this.inquiryNumber) {
    try {
      const NomenclatureConfig = require('./NomenclatureConfig');
      this.inquiryNumber = await NomenclatureConfig.generateId('inquiry');
    } catch (error) {
      console.error('Error generating inquiry number:', error);
      // Fallback to old format if nomenclature fails
      const date = new Date();
      const year = date.getFullYear().toString().slice(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      this.inquiryNumber = `INQ${year}${month}${day}${random}`;
    }
  }
});

// Calculate total amount
inquirySchema.methods.calculateTotal = function() {
  this.totalAmount = this.parts.reduce((total, part) => total + (part.price * part.quantity), 0);
  return this.totalAmount;
};

// Exclude fileData from JSON responses to prevent large payloads
inquirySchema.methods.toJSON = function() {
  const obj = this.toObject();
  if (obj.files && Array.isArray(obj.files)) {
    obj.files = obj.files.map(file => {
      const { fileData, ...fileWithoutData } = file;
      return fileWithoutData;
    });
  }
  return obj;
};

module.exports = mongoose.model('Inquiry', inquirySchema);
