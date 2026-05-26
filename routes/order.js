const express = require('express');
const { body, validationResult } = require('express-validator');
const Order = require('../models/Order');
const Notification = require('../models/Notification');
const { sendOrderConfirmation } = require('../services/emailService');

const router = express.Router();

// Import middleware from auth.js
const { authenticateToken, requireBackOffice, requireStaffPermission } = require('../middleware/auth');

// Get customer orders (Customer access) - OPTIMIZED
router.get('/customer', authenticateToken, async (req, res) => {
  try {
    // OPTIMIZED: Use lean() and select only essential fields
    const orders = await Order.find({ customer: req.userId })
      .populate('customer', 'firstName lastName email companyName')
      .populate('quotation', 'quotationNumber')
      .populate('inquiry', 'inquiryNumber')
      .sort({ createdAt: -1 })
      .lean()
      .select('orderNumber status customer quotation inquiry totalAmount createdAt updatedAt payment.status dispatch.courier dispatch.trackingNumber');

    res.json({
      success: true,
      orders
    });

  } catch (error) {
    console.error('Get customer orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all orders (Back Office) - ULTRA OPTIMIZED
router.get('/', authenticateToken, requireStaffPermission('canManageOrders'), async (req, res) => {
  try {
    const { limit = 500 } = req.query; // Default limit to 500 for faster response
    
    // OPTIMIZED: Select only essential fields and limit results
    const orders = await Order.find()
      .populate('customer', 'firstName lastName email companyName')
      .populate('quotation', 'quotationNumber')
      .populate('inquiry', 'inquiryNumber')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean()
      .select('orderNumber status customer quotation inquiry totalAmount createdAt updatedAt payment.status dispatch.courier dispatch.trackingNumber');

    res.json({
      success: true,
      orders
    });

  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create order from quotation
router.post('/', authenticateToken, [
  body('quotationId').notEmpty().withMessage('Quotation ID is required'),
  body('paymentMethod').isIn(['online', 'cod', 'direct']).withMessage('Valid payment method is required'),
  body('totalAmount').isFloat({ min: 0 }).withMessage('Valid total amount is required')
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

    const { quotationId, paymentMethod, totalAmount, parts, customer, deliveryAddress } = req.body;

    // Check if quotation exists and is accepted
    const Quotation = require('../models/Quotation');
    const quotation = await Quotation.findById(quotationId);

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    if (quotation.status !== 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'Quotation must be accepted before creating order'
      });
    }

    const existingOrder = await Order.findOne({ quotation: quotation._id });
    if (existingOrder) {
      if (existingOrder.payment?.status === 'completed') {
        return res.status(409).json({
          success: false,
          message: 'This order is already paid.',
        });
      }
      return res.status(200).json({
        success: true,
        existing: true,
        message: 'Pending order already exists for this quotation.',
        order: {
          _id: existingOrder._id,
          id: existingOrder._id.toString(),
          orderNumber: existingOrder.orderNumber,
          status: existingOrder.status,
          totalAmount: existingOrder.totalAmount,
          payment: existingOrder.payment,
          parts: existingOrder.parts,
        },
      });
    }

    // Get inquiry data separately since quotation.inquiryId is a string
    const Inquiry = require('../models/Inquiry');
    const inquiry = await Inquiry.findById(quotation.inquiryId)
      .populate('customer', 'firstName lastName email companyName phoneNumber');

    if (!inquiry) {
      return res.status(404).json({
        success: false,
        message: 'Associated inquiry not found'
      });
    }

    console.log('=== ORDER CREATION DEBUG ===');
    console.log('Quotation items:', quotation.items);
    console.log('Quotation items length:', quotation.items ? quotation.items.length : 0);
    console.log('Inquiry parts:', inquiry.parts);
    console.log('Inquiry parts length:', inquiry.parts ? inquiry.parts.length : 0);

    // Determine parts to use for order
    let orderParts = parts || quotation.items;
    
    // If quotation has no items, use inquiry parts
    if (!orderParts || orderParts.length === 0) {
      console.log('Quotation has no items, using inquiry parts');
      if (inquiry.parts && inquiry.parts.length > 0) {
        const totalAmount = quotation.totalAmount || 0;
        const totalQuantity = inquiry.parts.reduce((sum, part) => sum + (part.quantity || 0), 0);
        
        // Calculate prices proportionally based on quantity
        orderParts = inquiry.parts.map(part => {
          const quantity = part.quantity || 0;
          const itemTotalPrice = totalQuantity > 0 
            ? (totalAmount * quantity) / totalQuantity 
            : totalAmount / inquiry.parts.length;
          const unitPrice = quantity > 0 ? itemTotalPrice / quantity : itemTotalPrice;
          
          return {
            partName: part.partName || part.partRef || 'N/A',
            partRef: part.partRef || part.partName || 'N/A',
            material: part.material || 'N/A',
            thickness: part.thickness || 'N/A',
            quantity: quantity,
            remarks: part.remarks || '',
            unitPrice: unitPrice,
            totalPrice: itemTotalPrice
          };
        });
        console.log('Calculated order parts from inquiry:', orderParts);
      }
    }

    console.log('Final order parts:', orderParts);
    console.log('Final order parts length:', orderParts ? orderParts.length : 0);
    console.log('Final order parts JSON:', JSON.stringify(orderParts, null, 2));

    // Create order
    const order = new Order({
      quotation: quotationId,
      inquiry: inquiry._id,
      customer: req.userId,
      parts: orderParts || [],
      totalAmount: totalAmount || quotation.totalAmount,
      payment: {
        method: paymentMethod === 'online' ? 'credit_card' : paymentMethod === 'direct' ? 'direct' : 'pending',
        status: paymentMethod === 'online' ? 'pending' : 'completed',
        amount: totalAmount || quotation.totalAmount,
        paidAt: paymentMethod !== 'online' ? new Date() : null
      },
      status: paymentMethod === 'online' ? 'pending' : 'confirmed',
      confirmedAt: paymentMethod !== 'online' ? new Date() : null,
      deliveryAddress: deliveryAddress || inquiry.deliveryAddress,
      specialInstructions: inquiry.specialInstructions
    });

    await order.save();

    if (order.payment?.status === 'completed') {
      const { markInquiryPaymentReceivedForOrder } = require('../services/inquiryPaymentStatusHelper');
      await markInquiryPaymentReceivedForOrder(order);
    }
    
    console.log('✅ Order saved! Order ID:', order._id);
    console.log('✅ Order parts after save:', order.parts);
    console.log('✅ Order parts length after save:', order.parts ? order.parts.length : 0);

    // Populate customer data for email
    await order.populate('customer', 'firstName lastName email companyName phoneNumber');

    // For online flow, payment is still pending here; do not mark order_created/paid-like status yet.
    // Keep quotation accepted until gateway/webhook confirms payment success.
    quotation.status = paymentMethod === 'online' ? 'accepted' : 'order_created';
    if (paymentMethod === 'online') {
      quotation.orderPaymentWorkflowStatus = 'Payment Pending';
      quotation.payment_status = 'Pending';
    }
    quotation.order = order._id;
    quotation.orderCreatedAt = new Date();
    await quotation.save();

    // Send response immediately (don't wait for emails/notifications)
    console.log('✅ ORDER CREATED SUCCESSFULLY - Sending response');
    console.log('Order ID:', order._id);
    console.log('Order Number:', order.orderNumber);
    
    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: {
        _id: order._id,
        id: order._id.toString(),
        orderNumber: order.orderNumber,
        status: order.status,
        totalAmount: order.totalAmount,
        parts: order.parts
      }
    });

    // Send emails, notifications, and WebSocket updates asynchronously (don't block response)
    setImmediate(async () => {
      try {
        const paymentCompleted = order.payment?.status === 'completed';

        // Payment-success emails only after money is received (COD/direct on create, or via Zoho settlement)
        if (paymentCompleted) {
          try {
            const { sendPaymentSuccessEmailsOnce } = require('../services/paymentEmailHelper');
            await sendPaymentSuccessEmailsOnce(order._id);
          } catch (emailError) {
            console.error('Payment success emails failed:', emailError);
          }
        } else if (paymentMethod === 'online') {
          try {
            const { notifyOrderAwaitingPayment } = require('../services/statusNotificationService');
            await notifyOrderAwaitingPayment(order);
          } catch (notifyErr) {
            console.error('Awaiting payment notification failed:', notifyErr.message);
          }
        }

        // Create notification for customer about payment/order
        try {
          const Notification = require('../models/Notification');
          let customerTitle;
          let customerMessage;
          if (paymentMethod === 'cod') {
            customerTitle = 'Order Created';
            customerMessage = `Your order ${order.orderNumber} has been created. Payment will be collected on delivery.`;
          } else if (paymentMethod === 'online' && !paymentCompleted) {
            customerTitle = 'Complete Your Payment';
            customerMessage = `Your order ${order.orderNumber} is ready. Complete payment via the Zoho link to confirm your order.`;
          } else {
            customerTitle = 'Payment Successful';
            customerMessage = `Your payment of ₹${order.totalAmount} for order ${order.orderNumber} has been received successfully. Your order will be confirmed by our team shortly.`;
          }
          await Notification.createNotification({
            title: customerTitle,
            message: customerMessage,
            type: paymentCompleted || paymentMethod === 'cod' ? 'success' : 'info',
            userId: order.customer,
            relatedEntity: {
              type: 'order',
              entityId: order._id
            },
            metadata: {
              orderNumber: order.orderNumber,
              totalAmount: order.totalAmount,
              paymentMethod: paymentMethod,
              status: order.status,
              confirmedAt: paymentCompleted ? new Date() : null
            }
          });
        } catch (notificationError) {
          console.error('Failed to create customer order confirmation notification:', notificationError);
        }

        if (!paymentCompleted && paymentMethod === 'online') {
          try {
            const User = require('../models/User');
            const Notification = require('../models/Notification');
            const adminUsers = await User.find({ role: { $in: ['admin', 'backoffice', 'subadmin'] } });

            for (const admin of adminUsers) {
              await Notification.createNotification({
                title: 'Order Awaiting Payment',
                message: `Order ${order.orderNumber} created; awaiting online payment from ${order.customer?.firstName || 'Unknown'} ${order.customer?.lastName || ''}.`,
                type: 'info',
                userId: admin._id,
                relatedEntity: {
                  type: 'order',
                  entityId: order._id,
                },
                metadata: {
                  orderNumber: order.orderNumber,
                  paymentAmount: order.totalAmount,
                  paymentMethod: paymentMethod,
                  customerName: `${order.customer?.firstName || 'Unknown'} ${order.customer?.lastName || ''}`,
                },
              });
            }
          } catch (notificationError) {
            console.error('Failed to create admin awaiting-payment notifications:', notificationError);
          }
        }

        try {
          const websocketService = require('../services/websocketService');
          websocketService.notifyOrderCreated(order);
        } catch (wsError) {
          console.error('WebSocket order notification failed:', wsError);
        }

        if (paymentCompleted) {
          try {
            const websocketService = require('../services/websocketService');
            websocketService.notifyPaymentReceived(
              order,
              order.totalAmount,
              order.payment?.transactionId || `order_${order._id}`
            );
          } catch (wsError) {
            console.error('WebSocket payment notification failed:', wsError);
          }
        }
      } catch (error) {
        console.error('Error in async order creation tasks:', error);
      }
    });

  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
});

// Get order by ID or Order Number
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    let order;

    console.log('=== FETCHING ORDER ===');
    console.log('Order ID:', id);

    // Check if id is a MongoDB ObjectId (24 hex characters) or order number
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    
    // OPTIMIZED: Use lean() for faster queries
    // Include all fields needed for order tracking timeline
    if (isObjectId) {
      // Search by MongoDB ObjectId
      order = await Order.findById(id)
        .populate('customer', 'firstName lastName email companyName phone address')
        .populate('quotation', 'quotationNumber parts totalAmount createdAt')
        .populate('inquiry', 'inquiryNumber files parts deliveryAddress specialInstructions')
        .lean();
      
      // Exclude file data from inquiry if it exists
      if (order && order.inquiry && order.inquiry.files) {
        order.inquiry.files = order.inquiry.files.map(file => {
          const { fileData, ...fileWithoutData } = file;
          return fileWithoutData;
        });
      }
    } else {
      // Search by order number
      order = await Order.findOne({ orderNumber: id })
        .populate('customer', 'firstName lastName email companyName phone address')
        .populate('quotation', 'quotationNumber parts totalAmount createdAt')
        .populate('inquiry', 'inquiryNumber files parts deliveryAddress specialInstructions')
        .lean();
      
      // Exclude file data from inquiry if it exists
      if (order && order.inquiry && order.inquiry.files) {
        order.inquiry.files = order.inquiry.files.map(file => {
          const { fileData, ...fileWithoutData } = file;
          return fileWithoutData;
        });
      }
    }

    if (!order) {
      console.log('Order not found!');
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    console.log('Order found:', order.orderNumber);
    console.log('Order parts:', order.parts);
    console.log('Order parts length:', order.parts ? order.parts.length : 0);
    console.log('Quotation items:', order.quotation?.items);
    console.log('Inquiry parts:', order.inquiry?.parts);
    console.log('Order deliveryAddress:', order.deliveryAddress);
    console.log('Inquiry deliveryAddress:', order.inquiry?.deliveryAddress);
    console.log('Customer address:', order.customer?.address);
    console.log('Customer phone:', order.customer?.phoneNumber);

    // Check if user has access to this order
    if (req.userRole !== 'admin' && req.userRole !== 'backoffice' && order.customer._id.toString() !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    console.log('Sending order response with', order.parts?.length || 0, 'parts');
    res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
});

// Update order delivery time (Back Office)
router.put('/:id/delivery-time', authenticateToken, requireStaffPermission('canManageOrders'), [
  body('estimatedDelivery').isISO8601().withMessage('Valid delivery date is required'),
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

    const { estimatedDelivery, notes } = req.body;

    const order = await Order.findById(req.params.id)
      .populate('customer', 'firstName lastName email phoneNumber');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Initialize production object if it doesn't exist
    if (!order.production) {
      order.production = {};
    }

    // Update order with delivery time
    order.production.estimatedCompletion = new Date(estimatedDelivery);
    if (notes) {
      order.production.notes = notes;
    }

    // Only change status to in_production if order is confirmed or pending
    // Don't change status if already in production or later stages
    if (order.status === 'pending' || order.status === 'confirmed') {
      order.status = 'in_production';
      if (!order.production.startDate) {
        order.production.startDate = new Date();
      }
    }
    order.updatedAt = new Date();

    await order.save();

    // Note: Delivery time notification email removed - customer will only receive email when order is dispatched

    // Create notification for customer about delivery time update
    try {
      const Notification = require('../models/Notification');
      await Notification.createNotification({
        title: 'Delivery Time Updated',
        message: `Delivery time has been updated for order ${order.orderNumber}. Estimated delivery: ${new Date(estimatedDelivery).toLocaleDateString()}. Your order is now in production.`,
        type: 'info',
        userId: order.customer._id,
        relatedEntity: {
          type: 'order',
          entityId: order._id
        },
        metadata: {
          orderNumber: order.orderNumber,
          estimatedDelivery: estimatedDelivery,
          status: order.status,
          updatedAt: new Date()
        }
      });
    } catch (notificationError) {
      console.error('Failed to create delivery time notification:', notificationError);
    }

    res.json({
      success: true,
      message: 'Delivery time updated and customer notified',
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        estimatedDelivery: order.production.estimatedCompletion
      }
    });

  } catch (error) {
    console.error('Update delivery time error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update order status (Back Office)
router.put('/:id/status', authenticateToken, requireStaffPermission('canManageOrders'), [
  body('status').isIn(['pending', 'confirmed', 'in_production', 'ready_for_dispatch', 'dispatched', 'delivered', 'cancelled']).withMessage('Invalid status'),
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

    const { status, notes } = req.body;

    const order = await Order.findById(req.params.id)
      .populate('customer', 'firstName lastName email phoneNumber');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const oldStatus = order.status;
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
    } else if (status === 'in_production' && !order.production.startDate) {
      order.production.startDate = new Date();
    } else if (status === 'ready_for_dispatch') {
      order.production.actualCompletion = new Date();
    } else if (status === 'dispatched') {
      order.dispatch.dispatchedAt = new Date();
    } else if (status === 'delivered') {
      order.dispatch.actualDelivery = new Date();
    }

    if (notes) {
      order.notes = notes;
    }

    await order.save();

    // Send response immediately (don't wait for emails/notifications)
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

    // Send emails, notifications, and WebSocket updates asynchronously (don't block response)
    setImmediate(async () => {
      try {
        // Send real-time WebSocket notification for status update
        try {
          const websocketService = require('../services/websocketService');
          websocketService.notifyOrderStatusUpdate(order, oldStatus, status);
        } catch (wsError) {
          console.error('WebSocket status update notification failed:', wsError);
        }

        // Send status update email to customer
        try {
          const { sendOrderConfirmation } = require('../services/emailService');
          await sendOrderConfirmation(order);
          console.log('Order status update email sent to customer:', order.customer.email);
        } catch (emailError) {
          console.error('Status update email failed:', emailError);
        }

        // Note: Delivery time notification email removed - customer will only receive email when order is dispatched

        try {
          const { notifyOrderStatusChange } = require('../services/statusNotificationService');
          await notifyOrderStatusChange(order, oldStatus, status, {
            trackingNumber: order.dispatch?.trackingNumber,
            courier: order.dispatch?.courier,
          });
        } catch (notificationError) {
          console.error('Failed to create order status notification:', notificationError);
        }
      } catch (error) {
        console.error('Error in async order status update tasks:', error);
      }
    });

  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update dispatch details (Back Office)
router.put('/:id/dispatch', authenticateToken, requireStaffPermission('canManageOrders'), [
  body('courier').notEmpty().withMessage('Courier name is required'),
  body('trackingNumber').notEmpty().withMessage('Tracking number is required'),
  body('estimatedDelivery')
    .optional()
    .custom((value) => {
      // If value is empty, null, or undefined, it's valid (optional field)
      if (!value || value === '' || value === null || value === undefined) {
        return true;
      }
      // If value exists, validate it's a valid date
      const date = new Date(value);
      return !isNaN(date.getTime());
    })
    .withMessage('Valid delivery date is required'),
  body('notes').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', errors.array());
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { courier, trackingNumber, estimatedDelivery, notes } = req.body;

    const order = await Order.findById(req.params.id)
      .populate('customer', 'firstName lastName email phoneNumber');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Initialize dispatch object if it doesn't exist
    if (!order.dispatch) {
      order.dispatch = {};
    }

    // Update dispatch details
    order.dispatch.courier = courier;
    order.dispatch.trackingNumber = trackingNumber;
    order.dispatch.dispatchedAt = new Date();
    order.status = 'dispatched';
    
    // Only set estimatedDelivery if it's provided and not empty
    if (estimatedDelivery && estimatedDelivery.trim() !== '') {
      order.dispatch.estimatedDelivery = new Date(estimatedDelivery);
    }
    
    if (notes) {
      order.dispatch.notes = notes;
    }

    order.updatedAt = new Date();
    await order.save();

    // Return response immediately for fast API response (< 1 second)
    res.json({
      success: true,
      message: 'Dispatch details updated and customer notified',
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        dispatch: order.dispatch
      }
    });

    // Send notifications asynchronously in the background (non-blocking)
    setImmediate(async () => {
      try {
        // Re-fetch order from database to ensure all fields are properly loaded for notifications
        const updatedOrder = await Order.findById(order._id)
          .populate('customer', 'firstName lastName email phoneNumber');

        if (!updatedOrder) {
          console.error('Order not found after update for notifications:', order._id);
          return;
        }

        // Send real-time WebSocket notification for dispatch update
        try {
          const websocketService = require('../services/websocketService');
          websocketService.notifyDispatchUpdate(updatedOrder);
        } catch (wsError) {
          console.error('WebSocket dispatch notification failed:', wsError);
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
          // Don't fail the operation if email fails
        }

        // Create notification for customer about dispatch details update
        try {
          const Notification = require('../models/Notification');
          await Notification.createNotification({
            title: 'Dispatch Details Updated',
            message: `Dispatch details have been updated for order ${updatedOrder.orderNumber}. Tracking Number: ${updatedOrder.dispatch.trackingNumber}, Courier: ${updatedOrder.dispatch.courier}. Estimated delivery: ${updatedOrder.dispatch.estimatedDelivery ? new Date(updatedOrder.dispatch.estimatedDelivery).toLocaleDateString() : 'TBD'}.`,
            type: 'info',
            userId: updatedOrder.customer._id,
            relatedEntity: {
              type: 'order',
              entityId: updatedOrder._id
            },
            metadata: {
              orderNumber: updatedOrder.orderNumber,
              trackingNumber: updatedOrder.dispatch.trackingNumber,
              courier: updatedOrder.dispatch.courier,
              estimatedDelivery: updatedOrder.dispatch.estimatedDelivery,
              updatedAt: new Date()
            }
          });
          
          console.log(`Created dispatch details update notification for customer: ${updatedOrder.customer.email}`);
        } catch (notificationError) {
          console.error('Failed to create dispatch details update notification:', notificationError);
          // Don't fail the operation if notification creation fails
        }
      } catch (error) {
        console.error('Error in background dispatch notifications:', error);
      }
    });

  } catch (error) {
    console.error('Update dispatch details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get customer orders by customer ID (Admin/Back Office or own orders)
router.get('/customer/:customerId', authenticateToken, async (req, res) => {
  try {
    const { customerId } = req.params;

    // Check if user is accessing their own orders or is admin/backoffice
    if (req.userId.toString() !== customerId.toString() && !['admin', 'backoffice', 'subadmin'].includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // OPTIMIZED: Use lean() and select only essential fields
    const orders = await Order.find({ customer: customerId })
      .populate('customer', 'firstName lastName email companyName')
      .populate('quotation', 'quotationNumber')
      .populate('inquiry', 'inquiryNumber')
      .sort({ createdAt: -1 })
      .lean()
      .select('orderNumber status customer quotation inquiry totalAmount createdAt updatedAt payment.status dispatch.courier dispatch.trackingNumber');

    res.json({
      success: true,
      orders: orders || []
    });

  } catch (error) {
    console.error('Get customer orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;