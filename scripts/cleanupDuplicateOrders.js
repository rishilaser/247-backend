const mongoose = require('mongoose');
const Order = require('../models/Order');
const Quotation = require('../models/Quotation');
require('dotenv').config();

async function cleanupDuplicateOrders() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/komacut');
    console.log('Connected to MongoDB');

    // Find all orders
    const orders = await Order.find({}).populate('quotation');
    console.log(`Found ${orders.length} orders`);

    // Group orders by quotation
    const ordersByQuotation = {};
    const duplicateOrders = [];

    for (const order of orders) {
      const quotationId = order.quotation?._id?.toString();
      if (quotationId) {
        if (!ordersByQuotation[quotationId]) {
          ordersByQuotation[quotationId] = [];
        }
        ordersByQuotation[quotationId].push(order);
      }
    }

    // Find duplicates
    for (const quotationId in ordersByQuotation) {
      const quotationOrders = ordersByQuotation[quotationId];
      if (quotationOrders.length > 1) {
        console.log(`\n--- Quotation ${quotationId} has ${quotationOrders.length} orders ---`);
        
        // Sort by creation date (keep the latest one)
        quotationOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        // Keep the first (latest) order, mark others for deletion
        const keepOrder = quotationOrders[0];
        const deleteOrders = quotationOrders.slice(1);
        
        console.log(`Keeping order: ${keepOrder.orderNumber} (${keepOrder.status})`);
        
        for (const deleteOrder of deleteOrders) {
          console.log(`Deleting duplicate order: ${deleteOrder.orderNumber} (${deleteOrder.status})`);
          duplicateOrders.push(deleteOrder);
        }
      }
    }

    // Delete duplicate orders
    if (duplicateOrders.length > 0) {
      console.log(`\n🗑️ Deleting ${duplicateOrders.length} duplicate orders...`);
      
      for (const order of duplicateOrders) {
        await Order.findByIdAndDelete(order._id);
        console.log(`✅ Deleted order: ${order.orderNumber}`);
      }
      
      console.log(`\n🎉 Cleanup completed! Deleted ${duplicateOrders.length} duplicate orders.`);
    } else {
      console.log('\n✅ No duplicate orders found!');
    }

    // Show final order count
    const finalOrders = await Order.find({});
    console.log(`\n📊 Final order count: ${finalOrders.length}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

cleanupDuplicateOrders();
