const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../index');
const User = require('../models/User');
const Inquiry = require('../models/Inquiry');
require('dotenv').config();

// Test inquiry submission speed
async function testInquirySpeed() {
  try {
    console.log('=== TESTING INQUIRY SUBMISSION SPEED ===');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/komacut', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    // Find a test customer
    const customer = await User.findOne({ role: 'customer' });
    if (!customer) {
      console.log('No customer found. Please create a customer first.');
      return;
    }

    // Login to get token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: customer.email,
        password: 'password123' // Default password
      });

    if (!loginResponse.body.success) {
      console.log('Login failed:', loginResponse.body.message);
      return;
    }

    const token = loginResponse.body.token;
    console.log('Login successful, token obtained');

    // Test inquiry submission with timing
    const testInquiryData = {
      parts: JSON.stringify([
        {
          partRef: 'TEST001',
          material: 'Steel',
          thickness: '2mm',
          quantity: 10,
          remarks: 'Test part for speed testing'
        }
      ]),
      deliveryAddress: JSON.stringify({
        street: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        country: 'Test Country',
        zipCode: '12345'
      }),
      specialInstructions: 'Speed test inquiry'
    };

    console.log('Starting inquiry submission test...');
    const startTime = Date.now();

    const inquiryResponse = await request(app)
      .post('/api/inquiry')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('test file content'), 'test-drawing.pdf')
      .field('parts', testInquiryData.parts)
      .field('deliveryAddress', testInquiryData.deliveryAddress)
      .field('specialInstructions', testInquiryData.specialInstructions);

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    console.log('=== INQUIRY SUBMISSION RESULTS ===');
    console.log(`Response Time: ${responseTime}ms (${(responseTime/1000).toFixed(2)} seconds)`);
    console.log(`Status Code: ${inquiryResponse.status}`);
    console.log(`Success: ${inquiryResponse.body.success}`);
    
    if (inquiryResponse.body.success) {
      console.log(`Inquiry Number: ${inquiryResponse.body.inquiry.inquiryNumber}`);
      console.log(`Inquiry ID: ${inquiryResponse.body.inquiry._id}`);
      
      // Clean up test inquiry
      await Inquiry.findByIdAndDelete(inquiryResponse.body.inquiry._id);
      console.log('Test inquiry cleaned up');
    } else {
      console.log('Error:', inquiryResponse.body.message);
    }

    // Performance analysis
    if (responseTime < 2000) {
      console.log('✅ EXCELLENT: Response time under 2 seconds');
    } else if (responseTime < 5000) {
      console.log('✅ GOOD: Response time under 5 seconds');
    } else if (responseTime < 10000) {
      console.log('⚠️  ACCEPTABLE: Response time under 10 seconds');
    } else {
      console.log('❌ SLOW: Response time over 10 seconds');
    }

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the test
testInquirySpeed();
