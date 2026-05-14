const mongoose = require('mongoose');

const nomenclatureConfigSchema = new mongoose.Schema({
  inquiryPrefix: {
    type: String,
    default: 'INQ',
    maxlength: 6
  },
  inquiryStartNumber: {
    type: Number,
    default: 1200,
    min: 0
  },
  quotationPrefix: {
    type: String,
    default: 'QTN',
    maxlength: 6
  },
  quotationStartNumber: {
    type: Number,
    default: 500,
    min: 0
  },
  orderPrefix: {
    type: String,
    default: 'ORD',
    maxlength: 6
  },
  orderStartNumber: {
    type: Number,
    default: 800,
    min: 0
  },
  separator: {
    type: String,
    default: '-',
    maxlength: 2
  },
  includeYearSuffix: {
    type: Boolean,
    default: true
  },
  // Track current running numbers for each type
  currentInquiryNumber: {
    type: Number,
    default: 1200
  },
  currentQuotationNumber: {
    type: Number,
    default: 500
  },
  currentOrderNumber: {
    type: Number,
    default: 800
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Ensure only one document exists
nomenclatureConfigSchema.statics.getConfig = async function() {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({});
  }
  return config;
};

// Generate ID based on type and config
nomenclatureConfigSchema.statics.generateId = async function(type) {
  const config = await this.getConfig();
  
  let prefix, currentNumber, startNumber;
  
  switch(type) {
    case 'inquiry':
      prefix = config.inquiryPrefix || 'INQ';
      currentNumber = config.currentInquiryNumber || config.inquiryStartNumber || 1200;
      startNumber = config.inquiryStartNumber || 1200;
      break;
    case 'quotation':
      prefix = config.quotationPrefix || 'QTN';
      currentNumber = config.currentQuotationNumber || config.quotationStartNumber || 500;
      startNumber = config.quotationStartNumber || 500;
      break;
    case 'order':
      prefix = config.orderPrefix || 'ORD';
      currentNumber = config.currentOrderNumber || config.orderStartNumber || 800;
      startNumber = config.orderStartNumber || 800;
      break;
    default:
      throw new Error(`Unknown type: ${type}`);
  }
  
  // Increment current number
  const nextNumber = currentNumber + 1;
  
  // Build ID
  let id = prefix;
  
  // Add separator if provided
  if (config.separator) {
    id += config.separator;
  }
  
  // Add padded number (minimum 4 digits)
  const paddedNumber = nextNumber.toString().padStart(4, '0');
  id += paddedNumber;
  
  // Add year suffix if enabled
  if (config.includeYearSuffix) {
    const year = new Date().getFullYear();
    if (config.separator) {
      id += config.separator + year;
    } else {
      id += '-' + year;
    }
  }
  
  // Update current number in config
  const updateField = `current${type.charAt(0).toUpperCase() + type.slice(1)}Number`;
  await this.updateOne(
    { _id: config._id },
    { 
      [updateField]: nextNumber,
      updatedAt: new Date()
    }
  );
  
  return id;
};

module.exports = mongoose.model('NomenclatureConfig', nomenclatureConfigSchema);

