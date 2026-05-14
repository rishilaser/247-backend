const mongoose = require('mongoose');
const { sendInquiryNotification } = require('../services/emailService');
const Inquiry = require('../models/Inquiry');
const User = require('../models/User');
require('dotenv').config();

// Test email notification with attachments
async function testEmailNotification() {
  try {
    console.log('=== TESTING EMAIL NOTIFICATION WITH ATTACHMENTS ===');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/komacut', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    // Find a recent inquiry with files
    const inquiry = await Inquiry.findOne({ 
      files: { $exists: true, $not: { $size: 0 } } 
    }).populate('customer', 'firstName lastName email companyName phoneNumber');
    
    if (!inquiry) {
      console.log('No inquiry with files found. Creating a test inquiry...');
      
      // Find any user to use as customer
      const customer = await User.findOne({ role: 'customer' });
      if (!customer) {
        console.log('No customer found. Please create a customer first.');
        return;
      }
      
      // Create a test inquiry with mock files
      const testInquiry = new Inquiry({
        customer: customer._id,
        inquiryNumber: 'TEST' + Date.now(),
        files: [
          {
            originalName: 'test-drawing.pdf',
            fileName: 'files-test-drawing.pdf',
            filePath: './uploads/inquiries/files-test-drawing.pdf',
            fileSize: 1024,
            fileType: '.pdf',
            uploadedAt: new Date()
          },
          {
            originalName: 'technical-specs.dwg',
            fileName: 'files-technical-specs.dwg',
            filePath: './uploads/inquiries/files-technical-specs.dwg',
            fileSize: 2048,
            fileType: '.dwg',
            uploadedAt: new Date()
          }
        ],
        parts: [
          {
            partRef: 'PART001',
            material: 'Steel',
            thickness: '2mm',
            quantity: 10,
            remarks: 'Test part'
          }
        ],
        totalAmount: 100,
        deliveryAddress: {
          street: '123 Test Street',
          city: 'Test City',
          state: 'Test State',
          country: 'Test Country',
          zipCode: '12345'
        },
        status: 'pending'
      });
      
      await testInquiry.save();
      await testInquiry.populate('customer', 'firstName lastName email companyName phoneNumber');
      
      console.log('Test inquiry created:', testInquiry.inquiryNumber);
      console.log('Files in test inquiry:', testInquiry.files.length);
      
      // Test the email notification
      console.log('Sending test email notification...');
      await sendInquiryNotification(testInquiry);
      console.log('Test email notification sent successfully!');
      
      // Clean up test inquiry
      await Inquiry.findByIdAndDelete(testInquiry._id);
      console.log('Test inquiry cleaned up');
      
    } else {
      console.log('Found inquiry with files:', inquiry.inquiryNumber);
      console.log('Files in inquiry:', inquiry.files.length);
      inquiry.files.forEach((file, index) => {
        console.log(`  File ${index + 1}: ${file.originalName} (${file.fileType})`);
      });
      
      // Test the email notification
      console.log('Sending email notification...');
      await sendInquiryNotification(inquiry);
      console.log('Email notification sent successfully!');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the test
testEmailNotification();
