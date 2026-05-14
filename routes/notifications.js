const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const Notification = require('../models/Notification');

const router = express.Router();

// Import the shared auth middleware
const { authenticateToken } = require('../middleware/auth');

// Mock notifications data (in production, this would come from a database)
const mockNotifications = [
  {
    _id: '1',
    title: 'Inquiry Submitted',
    message: 'Your inquiry INQ241201001 has been submitted successfully and is under review.',
    type: 'success',
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
    userId: 'user123'
  },
  {
    _id: '2',
    title: 'Quotation Ready',
    message: 'Quotation QT241201001 is ready for your inquiry INQ241201001.',
    type: 'info',
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
    userId: 'user123'
  },
  {
    _id: '3',
    title: 'Order Confirmed',
    message: 'Order ORD241201001 has been confirmed and production has started.',
    type: 'success',
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    userId: 'user123'
  }
];

// Get user notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const notifications = await Notification.getUserNotifications(req.userId, 50);
    
    res.json({
      success: true,
      notifications
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Mark notification as read
router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('=== MARK NOTIFICATION AS READ ===');
    console.log('Notification ID:', id);
    console.log('User ID:', req.userId);
    
    const notification = await Notification.findOne({ _id: id, userId: req.userId });
    
    if (!notification) {
      console.log('Notification not found for user:', req.userId);
      
      // Check if notification exists at all
      const anyNotification = await Notification.findOne({ _id: id });
      if (anyNotification) {
        console.log('Notification exists but belongs to different user:', anyNotification.userId);
      } else {
        console.log('Notification does not exist in database');
      }
      
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }
    
    await notification.markAsRead();
    
    res.json({
      success: true,
      message: 'Notification marked as read',
      notification
    });

  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Mark all notifications as read
router.patch('/read-all', authenticateToken, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.userId, read: false },
      { read: true, readAt: new Date() }
    );
    
    res.json({
      success: true,
      message: 'All notifications marked as read'
    });

  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create notification (for internal use)
router.post('/', authenticateToken, [
  body('title').notEmpty().withMessage('Title is required'),
  body('message').notEmpty().withMessage('Message is required'),
  body('type').isIn(['success', 'warning', 'error', 'info']).withMessage('Invalid notification type'),
  body('userId').notEmpty().withMessage('User ID is required')
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

    const { title, message, type, userId, relatedEntity, metadata } = req.body;

    const notification = await Notification.createNotification({
      title,
      message,
      type,
      userId,
      relatedEntity,
      metadata
    });

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      notification
    });

  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
