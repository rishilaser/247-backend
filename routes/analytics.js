const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

// Import models
const Inquiry = require('../models/Inquiry');
const Quotation = require('../models/Quotation');
const Order = require('../models/Order');
const User = require('../models/User');

// Import middleware
const { authenticateToken } = require('../middleware/auth');
const { getPaymentAnalytics } = require('../services/paymentService');

// Middleware to check if user is admin/backoffice
const requireBackOffice = (req, res, next) => {
  if (req.userRole !== 'admin' && req.userRole !== 'backoffice') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin/Back Office role required.'
    });
  }
  next();
};

// Get dashboard analytics
router.get('/dashboard', authenticateToken, requireBackOffice, async (req, res) => {
  try {
    const { period = '30' } = req.query; // Default to last 30 days
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get basic counts
    const [
      totalInquiries,
      totalQuotations,
      totalOrders,
      totalCustomers,
      recentInquiries,
      recentOrders
    ] = await Promise.all([
      Inquiry.countDocuments(),
      Quotation.countDocuments(),
      Order.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      Inquiry.find({ createdAt: { $gte: startDate } }).sort({ createdAt: -1 }).limit(5),
      Order.find({ createdAt: { $gte: startDate } }).sort({ createdAt: -1 }).limit(5)
    ]);

    // Get status breakdowns
    const inquiryStatusBreakdown = await Inquiry.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const orderStatusBreakdown = await Inquiry.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Get monthly trends
    const monthlyTrends = await Inquiry.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Get revenue analytics
    const revenueData = await Order.aggregate([
      {
        $match: {
          status: { $in: ['confirmed', 'in_production', 'ready_for_dispatch', 'dispatched', 'delivered'] }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          averageOrderValue: { $avg: '$totalAmount' },
          totalOrders: { $sum: 1 }
        }
      }
    ]);

    // Get top customers
    const topCustomers = await Order.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'customer',
          foreignField: '_id',
          as: 'customerInfo'
        }
      },
      {
        $unwind: '$customerInfo'
      },
      {
        $group: {
          _id: '$customer',
          customerName: { $first: { $concat: ['$customerInfo.firstName', ' ', '$customerInfo.lastName'] } },
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' }
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 10 }
    ]);

    // Get conversion rates
    const conversionRates = await Promise.all([
      Inquiry.countDocuments({ status: 'quoted' }),
      Quotation.countDocuments({ status: 'accepted' }),
      Order.countDocuments({ status: { $in: ['confirmed', 'in_production', 'ready_for_dispatch', 'dispatched', 'delivered'] } })
    ]);

    const inquiryToQuoteRate = totalInquiries > 0 ? (conversionRates[0] / totalInquiries * 100).toFixed(2) : 0;
    const quoteToOrderRate = conversionRates[0] > 0 ? (conversionRates[1] / conversionRates[0] * 100).toFixed(2) : 0;
    const overallConversionRate = totalInquiries > 0 ? (conversionRates[2] / totalInquiries * 100).toFixed(2) : 0;

    res.json({
      success: true,
      analytics: {
        overview: {
          totalInquiries,
          totalQuotations,
          totalOrders,
          totalCustomers,
          period: `${days} days`
        },
        revenue: {
          totalRevenue: revenueData[0]?.totalRevenue || 0,
          averageOrderValue: revenueData[0]?.averageOrderValue || 0,
          totalRevenueOrders: revenueData[0]?.totalOrders || 0
        },
        conversionRates: {
          inquiryToQuote: parseFloat(inquiryToQuoteRate),
          quoteToOrder: parseFloat(quoteToOrderRate),
          overallConversion: parseFloat(overallConversionRate)
        },
        statusBreakdown: {
          inquiries: inquiryStatusBreakdown,
          orders: orderStatusBreakdown
        },
        trends: {
          monthly: monthlyTrends
        },
        topCustomers,
        recentActivity: {
          inquiries: recentInquiries,
          orders: recentOrders
        }
      }
    });

  } catch (error) {
    console.error('Dashboard analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get sales analytics
router.get('/sales', authenticateToken, requireBackOffice, async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'month' } = req.query;
    
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
    }

    let groupFormat;
    switch (groupBy) {
      case 'day':
        groupFormat = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
        break;
      case 'week':
        groupFormat = {
          year: { $year: '$createdAt' },
          week: { $week: '$createdAt' }
        };
        break;
      case 'month':
      default:
        groupFormat = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        };
        break;
    }

    const salesData = await Order.aggregate([
      { $match: { ...dateFilter, status: { $in: ['confirmed', 'in_production', 'ready_for_dispatch', 'dispatched', 'delivered'] } } },
      {
        $group: {
          _id: groupFormat,
          totalRevenue: { $sum: '$totalAmount' },
          orderCount: { $sum: 1 },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      success: true,
      salesData,
      period: { startDate, endDate, groupBy }
    });

  } catch (error) {
    console.error('Sales analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get customer analytics
router.get('/customers', authenticateToken, requireBackOffice, async (req, res) => {
  try {
    const customerAnalytics = await User.aggregate([
      { $match: { role: 'customer' } },
      {
        $lookup: {
          from: 'orders',
          localField: '_id',
          foreignField: 'customer',
          as: 'orders'
        }
      },
      {
        $addFields: {
          totalOrders: { $size: '$orders' },
          totalSpent: { $sum: '$orders.totalAmount' },
          lastOrderDate: { $max: '$orders.createdAt' }
        }
      },
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          activeCustomers: {
            $sum: {
              $cond: [
                { $gt: ['$totalOrders', 0] },
                1,
                0
              ]
            }
          },
          averageOrdersPerCustomer: { $avg: '$totalOrders' },
          averageSpentPerCustomer: { $avg: '$totalSpent' }
        }
      }
    ]);

    const customerSegments = await User.aggregate([
      { $match: { role: 'customer' } },
      {
        $lookup: {
          from: 'orders',
          localField: '_id',
          foreignField: 'customer',
          as: 'orders'
        }
      },
      {
        $addFields: {
          totalSpent: { $sum: '$orders.totalAmount' }
        }
      },
      {
        $bucket: {
          groupBy: '$totalSpent',
          boundaries: [0, 1000, 5000, 10000, 50000, Infinity],
          default: 'Other',
          output: {
            count: { $sum: 1 },
            totalSpent: { $sum: '$totalSpent' }
          }
        }
      }
    ]);

    res.json({
      success: true,
      analytics: customerAnalytics[0] || {},
      segments: customerSegments
    });

  } catch (error) {
    console.error('Customer analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get payment analytics
router.get('/payments', authenticateToken, requireBackOffice, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        'payment.paidAt': {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
    }

    const paymentAnalytics = await Order.aggregate([
      { $match: { ...dateFilter, 'payment.status': 'completed' } },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$payment.amount' },
          averagePayment: { $avg: '$payment.amount' }
        }
      }
    ]);

    const paymentMethods = await Order.aggregate([
      { $match: { ...dateFilter, 'payment.status': 'completed' } },
      {
        $group: {
          _id: '$payment.method',
          count: { $sum: 1 },
          totalAmount: { $sum: '$payment.amount' }
        }
      }
    ]);

    res.json({
      success: true,
      analytics: paymentAnalytics[0] || {},
      methods: paymentMethods
    });

  } catch (error) {
    console.error('Payment analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get performance metrics
router.get('/performance', authenticateToken, requireBackOffice, async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Average response time (inquiry to quotation)
    const responseTimeData = await Inquiry.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['quoted', 'accepted', 'rejected'] }
        }
      },
      {
        $lookup: {
          from: 'quotations',
          localField: '_id',
          foreignField: 'inquiryId',
          as: 'quotation'
        }
      },
      {
        $unwind: '$quotation'
      },
      {
        $addFields: {
          responseTime: {
            $divide: [
              { $subtract: ['$quotation.createdAt', '$createdAt'] },
              1000 * 60 * 60 * 24 // Convert to days
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          averageResponseTime: { $avg: '$responseTime' },
          minResponseTime: { $min: '$responseTime' },
          maxResponseTime: { $max: '$responseTime' }
        }
      }
    ]);

    // Order fulfillment time
    const fulfillmentData = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['dispatched', 'delivered'] }
        }
      },
      {
        $addFields: {
          fulfillmentTime: {
            $divide: [
              { $subtract: ['$updatedAt', '$createdAt'] },
              1000 * 60 * 60 * 24 // Convert to days
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          averageFulfillmentTime: { $avg: '$fulfillmentTime' },
          minFulfillmentTime: { $min: '$fulfillmentTime' },
          maxFulfillmentTime: { $max: '$fulfillmentTime' }
        }
      }
    ]);

    res.json({
      success: true,
      performance: {
        responseTime: responseTimeData[0] || {},
        fulfillment: fulfillmentData[0] || {}
      }
    });

  } catch (error) {
    console.error('Performance analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
