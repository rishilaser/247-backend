const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const Quotation = require('../models/Quotation');
const Inquiry = require('../models/Inquiry');
require('dotenv').config();

async function listOrders() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/komacut');
    console.log('Connected to MongoDB');

    console.log('\n=== ALL ORDERS IN DATABASE ===\n');

    const orders = await Order.find()
      .populate('customer', 'firstName lastName email')
      .populate('quotation', 'quotationNumber')
      .populate('inquiry', 'inquiryNumber')
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${orders.length} orders:`);
    
    orders.forEach((order, index) => {
      console.log(`\n${index + 1}. Order Details:`);
      console.log(`   ID: ${order._id}`);
      console.log(`   Order Number: ${order.orderNumber}`);
      console.log(`   Status: ${order.status}`);
      console.log(`   Total Amount: $${order.totalAmount?.toFixed(2) || '0.00'}`);
      console.log(`   Customer: ${order.customer?.firstName} ${order.customer?.lastName}`);
      console.log(`   Quotation: ${order.quotation?.quotationNumber}`);
      console.log(`   Inquiry: ${order.inquiry?.inquiryNumber}`);
      console.log(`   Parts: ${order.parts?.length || 0}`);
      console.log(`   Created: ${order.createdAt}`);
    });

    if (orders.length > 0) {
      console.log('\n=== TESTING API ENDPOINTS ===');
      console.log('Try these URLs in your browser:');
      orders.forEach(order => {
        console.log(`   http://localhost:3000/order/${order._id}`);
        console.log(`   http://localhost:3000/order/${order.orderNumber}`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

listOrders();
