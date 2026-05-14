const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const Inquiry = require('../models/Inquiry');
const Quotation = require('../models/Quotation');
const Order = require('../models/Order');

// Get customer dashboard statistics - OPTIMIZED
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    // OPTIMIZED: Get all counts in parallel
    const [
      totalInquiries,
      customerInquiries,
      totalOrders,
      completedOrders,
      activeOrders
    ] = await Promise.all([
      Inquiry.countDocuments({ customer: userId }),
      Inquiry.find({ customer: userId }).select('_id').lean(), // Use lean for faster query
      Order.countDocuments({ customer: userId }),
      Order.countDocuments({ customer: userId, status: 'completed' }),
      Order.countDocuments({ customer: userId, status: { $in: ['confirmed', 'in_production', 'dispatched'] } })
    ]);

    // Get inquiry IDs for quotation count
    const inquiryIds = customerInquiries.map(inquiry => inquiry._id);
    const totalQuotations = inquiryIds.length > 0 
      ? await Quotation.countDocuments({ inquiryId: { $in: inquiryIds } })
      : 0;

    res.json({
      success: true,
      stats: {
        inquiries: totalInquiries,
        quotations: totalQuotations,
        orders: activeOrders,
        completed: completedOrders
      }
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get recent activity for customer dashboard
router.get('/activity', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const activities = [];

    // Get recent inquiries
    const recentInquiries = await Inquiry.find({ customer: userId })
      .sort({ createdAt: -1 })
      .limit(3)
      .select('inquiryNumber title status createdAt');

    recentInquiries.forEach(inquiry => {
      activities.push({
        id: inquiry._id,
        type: 'inquiry',
        title: 'New inquiry submitted',
        description: inquiry.title || `Inquiry #${inquiry.inquiryNumber}`,
        time: getTimeAgo(inquiry.createdAt),
        status: inquiry.status || 'pending'
      });
    });

    // Get recent quotations
    const customerInquiries = await Inquiry.find({ customer: userId }).select('_id');
    const inquiryIds = customerInquiries.map(inquiry => inquiry._id.toString());
    
    const recentQuotations = await Quotation.find({ 
      inquiryId: { $in: inquiryIds } 
    })
    .sort({ createdAt: -1 })
    .limit(3);

    recentQuotations.forEach(quotation => {
      activities.push({
        id: quotation._id,
        type: 'quotation',
        title: 'Quotation prepared',
        description: `Quotation #${quotation.quotationNumber}`,
        time: getTimeAgo(quotation.createdAt),
        status: quotation.status || 'sent'
      });
    });

    // Get recent orders
    const recentOrders = await Order.find({ customer: userId })
      .sort({ createdAt: -1 })
      .limit(3)
      .select('orderNumber status createdAt');

    recentOrders.forEach(order => {
      activities.push({
        id: order._id,
        type: 'order',
        title: 'Order confirmed',
        description: `Order #${order.orderNumber}`,
        time: getTimeAgo(order.createdAt),
        status: order.status || 'confirmed'
      });
    });

    // Sort all activities by time and take latest 5
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));
    const recentActivity = activities.slice(0, 5);

    res.json({
      success: true,
      activities: recentActivity
    });

  } catch (error) {
    console.error('Dashboard activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Helper function to get time ago
function getTimeAgo(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  
  if (diffInSeconds < 60) {
    return 'Just now';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
}

module.exports = router;
