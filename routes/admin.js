const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Order = require('../models/Order');
const Inquiry = require('../models/Inquiry');
const Quotation = require('../models/Quotation');
const NomenclatureConfig = require('../models/NomenclatureConfig');
const { authenticateToken, requireAdmin, requireBackOffice } = require('../middleware/auth');
const router = express.Router();

// Get dashboard statistics (Admin/Back Office)
router.get('/dashboard/stats', authenticateToken, requireBackOffice, async (req, res) => {
  try {
    // Get counts in parallel for better performance
    const [
      totalInquiries,
      totalQuotations,
      activeOrders,
      completedOrders
    ] = await Promise.all([
      Inquiry.countDocuments(),
      Quotation.countDocuments(),
      Order.countDocuments({ 
        status: { $in: ['confirmed', 'in_production', 'ready_for_dispatch', 'dispatched'] } 
      }),
      Order.countDocuments({ status: 'delivered' })
    ]);

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

// Get all orders (Admin/Back Office) - ULTRA OPTIMIZED for <1s response
router.get('/orders', authenticateToken, requireBackOffice, async (req, res) => {
  try {
    const { limit = 100 } = req.query; // Reduced to 100 for <1s response
    
    // ULTRA OPTIMIZED: Minimal populate, batch fetch, limit results
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit) || 100, 100))
      .lean()
      .select('orderNumber status customer quotation inquiry totalAmount createdAt updatedAt payment.status dispatch.courier dispatch.trackingNumber');

    // Batch fetch customer, quotation, inquiry data
    const customerIds = [...new Set(orders.map(o => o.customer).filter(Boolean))];
    const quotationIds = [...new Set(orders.map(o => o.quotation).filter(Boolean))];
    const inquiryIds = [...new Set(orders.map(o => o.inquiry).filter(Boolean))];

    const [customers, quotations, inquiries] = await Promise.all([
      customerIds.length > 0 ? User.find({ _id: { $in: customerIds } }).select('firstName lastName email companyName').lean() : [],
      quotationIds.length > 0 ? Quotation.find({ _id: { $in: quotationIds } }).select('quotationNumber').lean() : [],
      inquiryIds.length > 0 ? Inquiry.find({ _id: { $in: inquiryIds } }).select('inquiryNumber').lean() : []
    ]);

    // Create lookup maps
    const customerMap = {};
    customers.forEach(c => { customerMap[c._id.toString()] = c; });
    const quotationMap = {};
    quotations.forEach(q => { quotationMap[q._id.toString()] = q; });
    const inquiryMap = {};
    inquiries.forEach(i => { inquiryMap[i._id.toString()] = i; });

    // Map orders with populated data
    const ordersWithData = orders.map(order => ({
      ...order,
      customer: order.customer ? customerMap[order.customer.toString()] || null : null,
      quotation: order.quotation ? quotationMap[order.quotation.toString()] || null : null,
      inquiry: order.inquiry ? inquiryMap[order.inquiry.toString()] || null : null
    }));

    res.json({
      success: true,
      orders: ordersWithData
    });

  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update order status (Admin/Back Office)
router.put('/orders/:id/status', authenticateToken, requireBackOffice, [
  body('status').isIn(['pending', 'confirmed', 'in_production', 'ready_for_dispatch', 'dispatched', 'delivered', 'cancelled']).withMessage('Invalid status'),
  body('notes').optional().isString(),
  body('estimatedDelivery').optional().isISO8601().withMessage('Valid delivery date is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { status, notes, estimatedDelivery } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId)
      .populate('customer', 'firstName lastName email phoneNumber');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const oldStatus = order.status;

    // If status is same, allow it (idempotent operation - no change needed)
    if (oldStatus === status) {
      // Status is already set, just return success
      return res.json({
        success: true,
        message: 'Order status is already set to this value',
        order: {
          id: order._id,
          orderNumber: order.orderNumber,
          status: order.status,
          updatedAt: order.updatedAt
        }
      });
    }

    // Validate status transition
    const validTransitions = {
      'pending': ['confirmed', 'cancelled'],
      'confirmed': ['in_production', 'cancelled'],
      'in_production': ['ready_for_dispatch', 'cancelled'],
      'ready_for_dispatch': ['dispatched', 'cancelled'],
      'dispatched': ['delivered'],
      'delivered': [],
      'cancelled': []
    };

    if (validTransitions[oldStatus] && !validTransitions[oldStatus].includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from ${oldStatus} to ${status}`
      });
    }

    order.status = status;
    order.updatedAt = new Date();

    // Update payment status based on order status
    if (!order.payment) {
      order.payment = {};
    }
    
    // Set payment status based on order status
    if (status === 'delivered' || status === 'dispatched' || status === 'ready_for_dispatch' || status === 'in_production' || status === 'confirmed') {
      order.payment.status = 'completed';
      if (!order.payment.paidAt) {
        order.payment.paidAt = new Date();
      }
      if (!order.payment.method || order.payment.method === 'pending') {
        order.payment.method = 'bank_transfer';
      }
    } else if (status === 'cancelled') {
      order.payment.status = 'refunded';
    }

    // Set specific timestamps based on status
    if (status === 'confirmed' && !order.confirmedAt) {
      order.confirmedAt = new Date();
    } else if (status === 'in_production') {
      // Initialize production object if it doesn't exist
      if (!order.production) {
        order.production = {};
      }
      if (!order.production.startDate) {
        order.production.startDate = new Date();
      }
      // Set estimated delivery time if provided
      if (estimatedDelivery) {
        order.production.estimatedCompletion = new Date(estimatedDelivery);
      }
    } else if (status === 'ready_for_dispatch') {
      // Initialize production object if it doesn't exist
      if (!order.production) {
        order.production = {};
      }
      order.production.actualCompletion = new Date();
    } else if (status === 'dispatched') {
      // Initialize dispatch object if it doesn't exist
      if (!order.dispatch) {
        order.dispatch = {};
      }
      if (!order.dispatch.dispatchedAt) {
        order.dispatch.dispatchedAt = new Date();
      }
    } else if (status === 'delivered') {
      // Initialize dispatch object if it doesn't exist
      if (!order.dispatch) {
        order.dispatch = {};
      }
      order.dispatch.actualDelivery = new Date();
    }

    if (notes) {
      order.notes = notes;
    }

    await order.save();

    // Send response immediately for fast user experience
    // Emails will be sent in background (non-blocking)
    res.json({
      success: true,
      message: 'Order status updated successfully',
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        updatedAt: order.updatedAt
      }
    });

    // Send emails asynchronously in background (non-blocking)
    // This doesn't block the API response
    (async () => {
      try {
        // Re-fetch order with populated customer for email
        const updatedOrder = await Order.findById(order._id)
          .populate('customer', 'firstName lastName email phoneNumber');

        if (!updatedOrder) {
          console.error('Order not found for email sending:', order._id);
          return;
        }

        // Send order confirmation email to customer when admin confirms the order
        if (status === 'confirmed' && oldStatus !== 'confirmed') {
          try {
            console.log('📧 Sending order confirmation email to customer...');
            const { sendOrderConfirmation } = require('../services/emailService');
            await sendOrderConfirmation(updatedOrder);
            console.log('✅ Order confirmation email sent successfully to customer:', updatedOrder.customer?.email);
          } catch (emailError) {
            console.error('❌ Order confirmation email failed:', emailError);
            // Don't fail the operation if email fails
          }
        }

        // Send production started email to customer when admin starts production
        if (status === 'in_production' && oldStatus !== 'in_production') {
          try {
            console.log('📧 Sending production started email to customer...');
            const { sendProductionStartedEmail } = require('../services/emailService');
            await sendProductionStartedEmail(updatedOrder);
            console.log('✅ Production started email sent successfully to customer:', updatedOrder.customer?.email);
          } catch (emailError) {
            console.error('❌ Production started email failed:', emailError);
            // Don't fail the operation if email fails
          }
        }

        // Note: Order ready email removed - customer will only receive email when order is dispatched

        // Send dispatch notification email to customer when admin dispatches the order
        if (status === 'dispatched' && oldStatus !== 'dispatched') {
          try {
            console.log('📧 Sending dispatch notification email to customer...');
            console.log('Order dispatch details:', {
              courier: updatedOrder.dispatch?.courier,
              trackingNumber: updatedOrder.dispatch?.trackingNumber,
              dispatchedAt: updatedOrder.dispatch?.dispatchedAt
            });
            console.log('Customer email:', updatedOrder.customer?.email);
            
            const { sendDispatchNotification } = require('../services/emailService');
            await sendDispatchNotification(updatedOrder);
            console.log('✅ Dispatch notification email sent successfully to customer:', updatedOrder.customer?.email);
          } catch (emailError) {
            console.error('❌ Dispatch notification email failed:', emailError);
            console.error('Email error details:', emailError.message);
            console.error('Email error stack:', emailError.stack);
            // Don't fail the operation if email fails
          }
        }
      } catch (error) {
        console.error('Error in background email sending:', error);
        // Silently fail - don't affect the main response
      }
    })();

  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update delivery details (Admin/Back Office)
router.put('/orders/:id/delivery', authenticateToken, requireBackOffice, [
  body('courier').notEmpty().withMessage('Courier name is required'),
  body('trackingNumber').notEmpty().withMessage('Tracking number is required'),
  body('estimatedDelivery').optional().isISO8601().withMessage('Valid delivery date is required'),
  body('notes').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { courier, trackingNumber, estimatedDelivery, notes } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId)
      .populate('customer', 'firstName lastName email phoneNumber');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Update dispatch details
    order.dispatch.courier = courier;
    order.dispatch.trackingNumber = trackingNumber;
    order.dispatch.dispatchedAt = new Date();
    order.status = 'dispatched';
    
    if (estimatedDelivery) {
      order.dispatch.estimatedDelivery = new Date(estimatedDelivery);
    }
    
    if (notes) {
      order.dispatch.notes = notes;
    }

    // Initialize dispatch object if it doesn't exist
    if (!order.dispatch) {
      order.dispatch = {};
    }

    order.updatedAt = new Date();
    await order.save();

    // Re-fetch order from database to ensure all fields are properly loaded
    const updatedOrder = await Order.findById(order._id)
      .populate('customer', 'firstName lastName email phoneNumber');

    if (!updatedOrder) {
      return res.status(404).json({
        success: false,
        message: 'Order not found after update'
      });
    }

    // Send dispatch notification email to customer
    try {
      console.log('📧 Sending dispatch notification email to customer...');
      console.log('Order dispatch details:', {
        courier: updatedOrder.dispatch?.courier,
        trackingNumber: updatedOrder.dispatch?.trackingNumber,
        dispatchedAt: updatedOrder.dispatch?.dispatchedAt,
        estimatedDelivery: updatedOrder.dispatch?.estimatedDelivery
      });
      console.log('Customer email:', updatedOrder.customer?.email);
      
      const { sendDispatchNotification } = require('../services/emailService');
      await sendDispatchNotification(updatedOrder);
      console.log('✅ Dispatch notification email sent successfully to customer:', updatedOrder.customer?.email);
    } catch (emailError) {
      console.error('❌ Dispatch notification email failed:', emailError);
      console.error('Email error details:', emailError.message);
      console.error('Email error stack:', emailError.stack);
      // Don't fail the operation if email fails
    }

    res.json({
      success: true,
      message: 'Delivery details updated successfully',
      order: {
        id: updatedOrder._id,
        orderNumber: updatedOrder.orderNumber,
        status: updatedOrder.status,
        dispatch: updatedOrder.dispatch
      }
    });

  } catch (error) {
    console.error('Update delivery details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Test Email service (Admin only)
router.post('/test-email', authenticateToken, requireAdmin, [
  body('email').isEmail().withMessage('Valid email is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { email } = req.body;
    
    const { testEmailService } = require('../services/emailService');
    const result = await testEmailService(email);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Test email sent successfully',
        messageId: result.messageId
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message || 'Failed to send test email',
        error: result.error
      });
    }
    
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Test SMS service (Admin only)
router.post('/test-sms', authenticateToken, requireAdmin, [
  body('phoneNumber').notEmpty().withMessage('Phone number is required'),
  body('message').notEmpty().withMessage('Message is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { phoneNumber, message } = req.body;
    const { sendSMS, isTwilioConfigured } = require('../services/smsService');

    if (!isTwilioConfigured) {
      return res.status(400).json({
        success: false,
        message: 'SMS service not configured. Please check Twilio credentials.'
      });
    }

    const result = await sendSMS(phoneNumber, message);
    
    res.json({
      success: result.success,
      message: result.success ? 'SMS sent successfully' : 'Failed to send SMS',
      result: result
    });

  } catch (error) {
    console.error('Test SMS error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all users (Admin only)
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, '-password')
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create sub-admin
router.post('/subadmin', authenticateToken, requireAdmin, [
  body('email').isEmail().normalizeEmail(),
  body('firstName').trim().isLength({ min: 1 }),
  body('lastName').trim().isLength({ min: 1 }),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/),
  body('permissions.canCreateQuotations').optional().isBoolean(),
  body('permissions.canManageUsers').optional().isBoolean(),
  body('permissions.canViewAllInquiries').optional().isBoolean(),
  body('permissions.canManageOrders').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { 
      email, 
      firstName, 
      lastName, 
      password,
      permissions = {}
    } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create sub-admin user
    const user = new User({
      email,
      firstName,
      lastName,
      phoneNumber: '0000000000', // Default phone number
      companyName: 'Sub-Admin Company', // Default company name
      department: 'Engineering', // Default department
      country: 'India', // Default country
      address: {
        street: '',
        city: '',
        state: '',
        zipCode: '',
        country: 'India'
      },
      password,
      role: 'subadmin',
      permissions: {
        canCreateQuotations: permissions.canCreateQuotations || false,
        canManageUsers: permissions.canManageUsers || false,
        canViewAllInquiries: permissions.canViewAllInquiries || false,
        canManageOrders: permissions.canManageOrders || false
      },
      createdBy: req.userId
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'Sub-admin created successfully',
      user: user.getProfile()
    });

  } catch (error) {
    console.error('Create sub-admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update sub-admin permissions
router.put('/subadmin/:id/permissions', authenticateToken, requireAdmin, [
  body('permissions.canCreateQuotations').optional().isBoolean(),
  body('permissions.canManageUsers').optional().isBoolean(),
  body('permissions.canViewAllInquiries').optional().isBoolean(),
  body('permissions.canManageOrders').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { permissions } = req.body;
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role !== 'subadmin') {
      return res.status(400).json({
        success: false,
        message: 'User is not a sub-admin'
      });
    }

    // Update permissions
    if (permissions.canCreateQuotations !== undefined) {
      user.permissions.canCreateQuotations = permissions.canCreateQuotations;
    }
    if (permissions.canManageUsers !== undefined) {
      user.permissions.canManageUsers = permissions.canManageUsers;
    }
    if (permissions.canViewAllInquiries !== undefined) {
      user.permissions.canViewAllInquiries = permissions.canViewAllInquiries;
    }
    if (permissions.canManageOrders !== undefined) {
      user.permissions.canManageOrders = permissions.canManageOrders;
    }

    await user.save();

    res.json({
      success: true,
      message: 'Sub-admin permissions updated successfully',
      user: user.getProfile()
    });

  } catch (error) {
    console.error('Update permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Deactivate/Activate sub-admin
router.put('/subadmin/:id/status', authenticateToken, requireAdmin, [
  body('isActive').isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { isActive } = req.body;
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role !== 'subadmin') {
      return res.status(400).json({
        success: false,
        message: 'User is not a sub-admin'
      });
    }

    user.isActive = isActive;
    await user.save();

    res.json({
      success: true,
      message: `Sub-admin ${isActive ? 'activated' : 'deactivated'} successfully`,
      user: user.getProfile()
    });

  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete sub-admin
router.delete('/subadmin/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role !== 'subadmin') {
      return res.status(400).json({
        success: false,
        message: 'User is not a sub-admin'
      });
    }

    await User.findByIdAndDelete(userId);

    res.json({
      success: true,
      message: 'Sub-admin deleted successfully'
    });

  } catch (error) {
    console.error('Delete sub-admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Change user role (for development/testing purposes)
router.post('/change-role', async (req, res) => {
  try {
    const { email, newRole } = req.body;
    
    if (!email || !newRole) {
      return res.status(400).json({
        success: false,
        message: 'Email and new role are required'
      });
    }
    
    // Find user by email
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Change role
    user.role = newRole;
    await user.save();
    
    res.json({
      success: true,
      message: 'User role changed successfully',
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('Change role error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get material data - ULTRA OPTIMIZED for <1s response
router.get('/materials', async (req, res) => {
  try {
    const Settings = require('../models/Settings');
    
    // OPTIMIZED: Use lean() and select only materialData field for faster query
    const settings = await Settings.findOne()
      .select('materialData')
      .lean()
      .limit(1);
    
    // Return response immediately
    res.json({
      success: true,
      materialData: settings?.materialData || []
    });

  } catch (error) {
    console.error('❌ Get material data error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      materialData: [] // Return empty array on error
    });
  }
});

// Update material data (Admin/Back Office)
router.put('/materials', authenticateToken, requireBackOffice, async (req, res) => {
  try {
    console.log('📤 PUT /api/admin/materials - Request received');
    const { materialData } = req.body;
    
    console.log('📦 Material data to save:', materialData?.length || 0, 'items');
    
    if (!Array.isArray(materialData)) {
      console.log('❌ Invalid data: not an array');
      return res.status(400).json({
        success: false,
        message: 'Material data must be an array'
      });
    }

    const Settings = require('../models/Settings');
    let settings = await Settings.findOne();
    
    console.log('📊 Existing settings found:', settings ? 'Yes' : 'No');
    
    if (!settings) {
      console.log('🆕 Creating new settings document');
      // Create new settings with material data
      settings = new Settings({
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
        materialData: materialData,
        updatedBy: req.userId
      });
    } else {
      console.log('📝 Updating existing settings');
      settings.materialData = materialData;
      settings.updatedBy = req.userId;
      settings.updatedAt = new Date();
    }
    
    await settings.save();
    console.log('✅ Material data saved to database:', settings.materialData.length, 'items');

    res.json({
      success: true,
      message: 'Material data updated successfully',
      materialData: settings.materialData
    });

  } catch (error) {
    console.error('❌ Update material data error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Get nomenclature configuration (Admin/Back Office)
router.get('/nomenclature', authenticateToken, requireBackOffice, async (req, res) => {
  try {
    const config = await NomenclatureConfig.getConfig();
    
    res.json({
      success: true,
      config: {
        inquiryPrefix: config.inquiryPrefix,
        inquiryStartNumber: config.inquiryStartNumber,
        quotationPrefix: config.quotationPrefix,
        quotationStartNumber: config.quotationStartNumber,
        orderPrefix: config.orderPrefix,
        orderStartNumber: config.orderStartNumber,
        separator: config.separator,
        includeYearSuffix: config.includeYearSuffix,
        currentInquiryNumber: config.currentInquiryNumber,
        currentQuotationNumber: config.currentQuotationNumber,
        currentOrderNumber: config.currentOrderNumber
      }
    });
  } catch (error) {
    console.error('Get nomenclature config error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update nomenclature configuration (Admin/Back Office)
router.put('/nomenclature', authenticateToken, requireBackOffice, [
  body('inquiryPrefix').optional().isString().isLength({ max: 6 }),
  body('inquiryStartNumber').optional().isInt({ min: 0 }),
  body('quotationPrefix').optional().isString().isLength({ max: 6 }),
  body('quotationStartNumber').optional().isInt({ min: 0 }),
  body('orderPrefix').optional().isString().isLength({ max: 6 }),
  body('orderStartNumber').optional().isInt({ min: 0 }),
  body('separator').optional().isString().isLength({ max: 2 }),
  body('includeYearSuffix').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      inquiryPrefix,
      inquiryStartNumber,
      quotationPrefix,
      quotationStartNumber,
      orderPrefix,
      orderStartNumber,
      separator,
      includeYearSuffix
    } = req.body;

    const config = await NomenclatureConfig.getConfig();
    
    // Update fields if provided
    if (inquiryPrefix !== undefined) config.inquiryPrefix = inquiryPrefix.toUpperCase();
    if (inquiryStartNumber !== undefined) {
      config.inquiryStartNumber = inquiryStartNumber;
      // If current number is less than start number, update it
      if (config.currentInquiryNumber < inquiryStartNumber) {
        config.currentInquiryNumber = inquiryStartNumber;
      }
    }
    if (quotationPrefix !== undefined) config.quotationPrefix = quotationPrefix.toUpperCase();
    if (quotationStartNumber !== undefined) {
      config.quotationStartNumber = quotationStartNumber;
      if (config.currentQuotationNumber < quotationStartNumber) {
        config.currentQuotationNumber = quotationStartNumber;
      }
    }
    if (orderPrefix !== undefined) config.orderPrefix = orderPrefix.toUpperCase();
    if (orderStartNumber !== undefined) {
      config.orderStartNumber = orderStartNumber;
      if (config.currentOrderNumber < orderStartNumber) {
        config.currentOrderNumber = orderStartNumber;
      }
    }
    if (separator !== undefined) config.separator = separator;
    if (includeYearSuffix !== undefined) config.includeYearSuffix = includeYearSuffix;
    
    config.updatedBy = req.userId;
    config.updatedAt = new Date();
    
    await config.save();

    res.json({
      success: true,
      message: 'Nomenclature configuration updated successfully',
      config: {
        inquiryPrefix: config.inquiryPrefix,
        inquiryStartNumber: config.inquiryStartNumber,
        quotationPrefix: config.quotationPrefix,
        quotationStartNumber: config.quotationStartNumber,
        orderPrefix: config.orderPrefix,
        orderStartNumber: config.orderStartNumber,
        separator: config.separator,
        includeYearSuffix: config.includeYearSuffix,
        currentInquiryNumber: config.currentInquiryNumber,
        currentQuotationNumber: config.currentQuotationNumber,
        currentOrderNumber: config.currentOrderNumber
      }
    });
  } catch (error) {
    console.error('Update nomenclature config error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Get settings (Admin only)
router.get('/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const Settings = require('../models/Settings');
    const settings = await Settings.getSettings();
    
    res.json({
      success: true,
      settings: {
        backOfficeEmails: settings?.backOfficeEmails || [],
        backOfficeMobileNumbers: settings?.backOfficeMobileNumbers || []
      }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update settings (Admin only)
router.put('/settings', authenticateToken, requireAdmin, [
  body('backOfficeEmails').optional().isArray(),
  body('backOfficeMobileNumbers').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const Settings = require('../models/Settings');
    let settings = await Settings.findOne();
    
    if (!settings) {
      // Create new settings with defaults if arrays are empty
      const emails = req.body.backOfficeEmails && req.body.backOfficeEmails.length > 0 
        ? req.body.backOfficeEmails 
        : ['backoffice1@example.com', 'backoffice2@example.com', 'backoffice3@example.com', 'backoffice4@example.com'];
      const numbers = req.body.backOfficeMobileNumbers && req.body.backOfficeMobileNumbers.length > 0
        ? req.body.backOfficeMobileNumbers
        : ['+91-0000000000', '+91-1111111111'];
      
      settings = new Settings({
        backOfficeEmails: emails,
        backOfficeMobileNumbers: numbers,
        updatedBy: req.userId
      });
    } else {
      // Update existing settings, but ensure minimum requirements
      if (req.body.backOfficeEmails !== undefined) {
        settings.backOfficeEmails = req.body.backOfficeEmails.length >= 4 
          ? req.body.backOfficeEmails 
          : [...req.body.backOfficeEmails, ...Array(4 - req.body.backOfficeEmails.length).fill('')];
      }
      if (req.body.backOfficeMobileNumbers !== undefined) {
        settings.backOfficeMobileNumbers = req.body.backOfficeMobileNumbers.length >= 2
          ? req.body.backOfficeMobileNumbers
          : [...req.body.backOfficeMobileNumbers, ...Array(2 - req.body.backOfficeMobileNumbers.length).fill('')];
      }
      settings.updatedBy = req.userId;
      settings.updatedAt = new Date();
    }
    
    await settings.save();

    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings: {
        backOfficeEmails: settings.backOfficeEmails,
        backOfficeMobileNumbers: settings.backOfficeMobileNumbers
      }
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;
