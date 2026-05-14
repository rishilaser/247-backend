const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Store connected clients by userId
    this.rooms = new Map(); // Store room subscriptions
  }

  initialize(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws',
      verifyClient: this.verifyClient.bind(this)
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('WebSocket server initialized');
  }

  verifyClient(info) {
    try {
      const url = new URL(info.req.url, `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (!token) {
        return false;
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      info.req.userId = decoded.userId;
      info.req.userRole = decoded.role;
      return true;
    } catch (error) {
      console.error('WebSocket authentication failed:', error);
      return false;
    }
  }

  handleConnection(ws, req) {
    const userId = req.userId;
    const userRole = req.userRole;
    
    console.log(`WebSocket client connected: ${userId} (${userRole})`);
    
    // Store client connection
    this.clients.set(userId, {
      ws,
      userId,
      userRole,
      connectedAt: new Date()
    });

    // Send welcome message
    this.sendToUser(userId, {
      type: 'connection',
      message: 'Connected to real-time notifications',
      timestamp: new Date().toISOString()
    });

    // Handle messages from client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleMessage(userId, message);
      } catch (error) {
        console.error('Invalid WebSocket message:', error);
        this.sendToUser(userId, {
          type: 'error',
          message: 'Invalid message format'
        });
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      console.log(`WebSocket client disconnected: ${userId}`);
      this.clients.delete(userId);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error);
      this.clients.delete(userId);
    });
  }

  handleMessage(userId, message) {
    switch (message.type) {
      case 'subscribe':
        this.subscribeToRoom(userId, message.room);
        break;
      case 'unsubscribe':
        this.unsubscribeFromRoom(userId, message.room);
        break;
      case 'ping':
        this.sendToUser(userId, { type: 'pong', timestamp: new Date().toISOString() });
        break;
      default:
        console.log(`Unknown message type from ${userId}:`, message.type);
    }
  }

  subscribeToRoom(userId, room) {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room).add(userId);
    console.log(`User ${userId} subscribed to room: ${room}`);
  }

  unsubscribeFromRoom(userId, room) {
    if (this.rooms.has(room)) {
      this.rooms.get(room).delete(userId);
      console.log(`User ${userId} unsubscribed from room: ${room}`);
    }
  }

  // Send message to specific user
  sendToUser(userId, message) {
    const client = this.clients.get(userId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error(`Failed to send message to user ${userId}:`, error);
        this.clients.delete(userId);
        return false;
      }
    }
    return false;
  }

  // Send message to all users in a room
  sendToRoom(room, message) {
    if (!this.rooms.has(room)) {
      return 0;
    }

    let sentCount = 0;
    const userIds = Array.from(this.rooms.get(room));
    
    userIds.forEach(userId => {
      if (this.sendToUser(userId, message)) {
        sentCount++;
      }
    });

    console.log(`Message sent to ${sentCount} users in room: ${room}`);
    return sentCount;
  }

  // Send message to all connected clients
  broadcast(message) {
    let sentCount = 0;
    this.clients.forEach((client, userId) => {
      if (this.sendToUser(userId, message)) {
        sentCount++;
      }
    });
    console.log(`Broadcast message sent to ${sentCount} clients`);
    return sentCount;
  }

  // Send message to users by role
  sendToRole(role, message) {
    let sentCount = 0;
    this.clients.forEach((client, userId) => {
      if (client.userRole === role && this.sendToUser(userId, message)) {
        sentCount++;
      }
    });
    console.log(`Message sent to ${sentCount} users with role: ${role}`);
    return sentCount;
  }

  // Notification methods
  notifyNewInquiry(inquiry) {
    const message = {
      type: 'notification',
      category: 'inquiry',
      title: 'New Inquiry Received',
      message: `Inquiry ${inquiry.inquiryNumber} received from ${inquiry.customer.firstName} ${inquiry.customer.lastName}`,
      data: {
        inquiryId: inquiry._id,
        inquiryNumber: inquiry.inquiryNumber,
        customerName: `${inquiry.customer.firstName} ${inquiry.customer.lastName}`,
        partsCount: inquiry.parts.length,
        filesCount: inquiry.files.length
      },
      timestamp: new Date().toISOString()
    };

    // Send to back office users
    this.sendToRole('admin', message);
    this.sendToRole('backoffice', message);
  }

  notifyQuotationCreated(quotation) {
    const message = {
      type: 'notification',
      category: 'quotation',
      title: 'Quotation Created',
      message: `Quotation ${quotation.quotationNumber} created for inquiry ${quotation.inquiry.inquiryNumber}`,
      data: {
        quotationId: quotation._id,
        quotationNumber: quotation.quotationNumber,
        inquiryNumber: quotation.inquiry.inquiryNumber,
        totalAmount: quotation.totalAmount
      },
      timestamp: new Date().toISOString()
    };

    // Send to customer
    this.sendToUser(quotation.customer, message);
  }

  notifyOrderCreated(order) {
    const message = {
      type: 'notification',
      category: 'order',
      title: 'Order Created',
      message: `Order ${order.orderNumber} created successfully`,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        status: order.status
      },
      timestamp: new Date().toISOString()
    };

    // Send to customer
    this.sendToUser(order.customer, message);
    
    // Send to back office
    this.sendToRole('admin', message);
    this.sendToRole('backoffice', message);
  }

  notifyPaymentReceived(order, amount, transactionId) {
    const message = {
      type: 'notification',
      category: 'payment',
      title: 'Payment Received',
      message: `Payment of ₹${amount} received for order ${order.orderNumber}. Transaction ID: ${transactionId}`,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        paymentAmount: amount,
        transactionId: transactionId,
        customerName: `${order.customer?.firstName || 'Unknown'} ${order.customer?.lastName || ''}`,
        status: order.status
      },
      timestamp: new Date().toISOString()
    };

    // Send to all admin users
    this.sendToRole('admin', message);
    this.sendToRole('backoffice', message);
    this.sendToRole('subadmin', message);
  }

  notifyOrderStatusUpdate(order, oldStatus, newStatus) {
    const message = {
      type: 'notification',
      category: 'order_update',
      title: 'Order Status Updated',
      message: `Order ${order.orderNumber} status changed from ${oldStatus} to ${newStatus}`,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        oldStatus,
        newStatus,
        updatedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    };

    // Send to customer
    this.sendToUser(order.customer, message);
    
    // Send to back office
    this.sendToRole('admin', message);
    this.sendToRole('backoffice', message);
  }

  notifyPaymentReceived(order) {
    const message = {
      type: 'notification',
      category: 'payment',
      title: 'Payment Received',
      message: `Payment received for order ${order.orderNumber}`,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        amount: order.payment.amount,
        transactionId: order.payment.transactionId
      },
      timestamp: new Date().toISOString()
    };

    // Send to back office
    this.sendToRole('admin', message);
    this.sendToRole('backoffice', message);
  }

  notifyDispatchUpdate(order) {
    const message = {
      type: 'notification',
      category: 'dispatch',
      title: 'Order Dispatched',
      message: `Order ${order.orderNumber} has been dispatched`,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        trackingNumber: order.dispatch.trackingNumber,
        courier: order.dispatch.courier,
        estimatedDelivery: order.dispatch.estimatedDelivery
      },
      timestamp: new Date().toISOString()
    };

    // Send to customer
    this.sendToUser(order.customer, message);
  }

  // Get connection statistics
  getStats() {
    return {
      totalConnections: this.clients.size,
      rooms: Array.from(this.rooms.keys()),
      connections: Array.from(this.clients.keys())
    };
  }

  // Cleanup inactive connections
  cleanup() {
    const now = new Date();
    this.clients.forEach((client, userId) => {
      if (client.ws.readyState === WebSocket.CLOSED || 
          (now - client.connectedAt) > 24 * 60 * 60 * 1000) { // 24 hours
        this.clients.delete(userId);
      }
    });
  }
}

// Create singleton instance
const websocketService = new WebSocketService();

module.exports = websocketService;
