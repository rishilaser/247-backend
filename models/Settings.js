const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  backOfficeEmails: {
    type: [String],
    required: true,
    validate: {
      validator: function(emails) {
        return emails.length >= 4;
      },
      message: 'At least 4 back-office email addresses are required'
    }
  },
  backOfficeMobileNumbers: {
    type: [String],
    required: true,
    validate: {
      validator: function(numbers) {
        return numbers.length >= 2;
      },
      message: 'At least 2 back-office mobile numbers are required'
    }
  },
  materialData: {
    type: [{
      material: {
        type: String,
        required: true
      },
      thickness: {
        type: String,
        required: true
      },
      grade: {
        type: String,
        default: ''
      },
      status: {
        type: String,
        enum: ['Active', 'Inactive'],
        default: 'Active'
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
    default: []
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Ensure only one settings document exists
settingsSchema.statics.getSettings = async function() {
  try {
    let settings = await this.findOne();
    if (!settings) {
      console.log('No settings found, creating default settings...');
      // Create default settings if none exist
      settings = await this.create({
        backOfficeEmails: [
          'backoffice1@example.com',
          'backoffice2@example.com',
          'backoffice3@example.com',
          'backoffice4@example.com'
        ],
        backOfficeMobileNumbers: [
          '+91-0000000000',
          '+91-1111111111'
        ],
        materialData: [],
        updatedBy: null
      });
      console.log('Default settings created');
    }
    return settings;
  } catch (error) {
    console.error('Error in getSettings:', error);
    throw error;
  }
};

module.exports = mongoose.model('Settings', settingsSchema);


