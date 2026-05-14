const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const http = require('http');
const websocketService = require('./services/websocketService');
require('dotenv').config();

// Routes will be imported after mongoose connection

const app = express();
const PORT = process.env.PORT || 5000;

// Increase timeout for large file uploads
app.timeout = 300000; // 5 minutes
app.keepAliveTimeout = 300000; // 5 minutes
app.headersTimeout = 300000; // 5 minutes

// ✅ VPS-Ready: Ensure uploads directory exists using centralized config
const { ensureUploadsDirectories, getUploadsBasePath, verifyUploadsPermissions } = require('./config/uploadConfig');
const uploadsDir = ensureUploadsDirectories();
verifyUploadsPermissions();
console.log('📁 Uploads base path:', uploadsDir);

// Compression middleware - compress all responses for faster transfer
app.use(compression({
  level: 6, // Balance between compression and CPU usage
  filter: (req, res) => {
    // Don't compress if client doesn't support it
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Use compression for all text-based responses
    return compression.filter(req, res);
  }
}));

// Security middleware with CSP configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));


// CORS configuration for production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000', // Development
      'http://localhost:3001', // Alternative development port
      'https://247cutbend.in', // Production frontend (without www)
      'https://www.247cutbend.in', // Production frontend (with www)
      'http://247cutbend.in', // HTTP version (without www)
      'http://www.247cutbend.in', // HTTP version (with www)
      // 'http://127.0.0.1:3000', // Alternative localhost
      // 'http://127.0.0.1:3001', // Alternative localhost port
      // 'https://komacut-frontend.onrender.com', // Production frontend
      // 'https://comcat-frontend.onrender.com', // Alternative frontend URL
      // 'https://comcat-frontends.onrender.com', // Your actual frontend URL
      process.env.CLIENT_URL, // From environment variable
    ].filter(Boolean); // Remove undefined values
    
    // Check if origin matches any allowed origin
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else if (origin.includes('247cutbend.in') || origin.includes('.onrender.com') || origin.includes('.netlify.app') || origin.includes('.vercel.app')) {
      // Allow all 247cutbend.in subdomains, Render, Netlify, and Vercel subdomains
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Content-Length'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400 // 24 hours
};

// Use more permissive CORS in development
if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
  app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
} else {
  app.use(cors(corsOptions));
}
app.use(express.json({
  limit: '500mb',
  verify: (req, res, buf) => {
    // Preserve raw body for webhook signature verification (e.g., Zoho)
    req.rawBody = buf;
  }
})); // Increased to handle multiple large PDFs
app.use(express.urlencoded({ extended: true, limit: '500mb' })); // Increased to handle multiple large PDFs

// Add response caching headers for static and API responses
app.use((req, res, next) => {
  // List of endpoints that should NOT be cached (dynamic data)
  const noCachePaths = [
    '/api/admin/dashboard/stats',
    '/api/admin/inquiries',
    '/api/admin/quotations',
    '/api/admin/orders',
    '/api/inquiry/admin/all',
    '/api/quotation',
    '/api/orders',
    '/api/inquiries',
    '/api/quotations'
  ];
  
  const shouldCache = req.method === 'GET' && 
                     req.path.startsWith('/api/') && 
                     !noCachePaths.some(path => req.path.startsWith(path));
  
  if (shouldCache) {
    // Static or less frequently changing data - cache for 30 seconds
    res.set('Cache-Control', 'private, max-age=30');
  } else if (req.method === 'GET' && req.path.startsWith('/api/')) {
    // Dynamic data - no cache to ensure fresh data
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  
  // Add ETag support
  res.set('ETag', 'W/"' + Date.now() + '"');
  next();
});

// ✅ VPS-Ready: Static file serving with proper headers
app.use('/uploads', (req, res, next) => {
  // Set proper CORS headers for file access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/pdf');
  // Cache control for better performance
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  next();
}, express.static(getUploadsBasePath(), {
  // Enable dotfiles (hidden files) if needed
  dotfiles: 'ignore',
  // Set proper index
  index: false,
  // Enable ETag for caching
  etag: true,
  // Enable last modified
  lastModified: true
}));

app.use('/test-files', express.static(path.join(__dirname, 'test-files')));

// Routes will be loaded after mongoose connection

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Cutbend Server is running' });
});

// Test endpoint for debugging
app.get('/api/test', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Test endpoint working',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// Serve test HTML file
app.get('/test-inquiry', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-inquiry.html'));
});

// Serve role change tool
app.get('/change-role', (req, res) => {
  res.sendFile(path.join(__dirname, 'change-role.html'));
});

// Serve role change JavaScript file
app.get('/change-role.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'change-role.js'));
});

// Serve test files download page
app.get('/download-test-files', (req, res) => {
  res.sendFile(path.join(__dirname, 'download-test-files.html'));
});

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://abhishekm:ouRpXr0E4NnlT7Me@cluster0.mwqeffk.mongodb.net/komacut?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
  // Modern MongoDB driver options
  serverSelectionTimeoutMS: 30000, // Keep trying to send operations for 30 seconds
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  connectTimeoutMS: 30000, // Connection timeout
  maxPoolSize: 10, // Maximum number of connections in the connection pool
  minPoolSize: 2, // Minimum number of connections in the connection pool
  retryWrites: true, // Retry write operations on network errors
  retryReads: true, // Retry read operations on network errors
})
.then(() => {
  
  // Import models first
  require('./models/User');
  require('./models/Inquiry');
  require('./models/Quotation');
  require('./models/Order');
  require('./models/Payment');
  require('./models/PasswordResetOtp');
  require('./models/Notification');
  
  // Import routes after mongoose connection
  const authRoutes = require('./routes/auth');
  const inquiryRoutes = require('./routes/inquiry');
  const quotationRoutes = require('./routes/quotation');
  const orderRoutes = require('./routes/order');
  const paymentRoutes = require('./routes/payment');
  const dispatchRoutes = require('./routes/dispatch');
  const notificationRoutes = require('./routes/notifications');
  const contactRoutes = require('./routes/contact');
  const adminRoutes = require('./routes/admin');
  const pdfExtractRoutes = require('./routes/pdfExtract');
  const zipExtractRoutes = require('./routes/zipExtract');
  const dashboardRoutes = require('./routes/dashboard');
  const analyticsRoutes = require('./routes/analytics');
  const uploadRoutes = require('./routes/upload');
  const zohoWebhookRoutes = require('./routes/zohoWebhook');
  const zohoCheckoutRoutes = require('./routes/zohoCheckout');
  const zohoPaymentLinkRoutes = require('./routes/zohoPaymentLink');
  
  // Use routes
  app.use('/api/auth', authRoutes);
  app.use('/api/inquiry', inquiryRoutes);
  app.use('/api/quotation', quotationRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/payment', paymentRoutes);
  app.use('/api/dispatch', dispatchRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/contact', contactRoutes);
  app.use('/contact', contactRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/inquiry', pdfExtractRoutes);
  app.use('/api/inquiry', zipExtractRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api', uploadRoutes);
  app.use('/api/zoho', zohoWebhookRoutes);
  app.use('/api/zoho', zohoCheckoutRoutes);
  app.use('/api/zoho', zohoPaymentLinkRoutes);
  
  // Error handling middleware (must be last)
  const errorHandler = require('./middleware/errorHandler');
  app.use(errorHandler);
  
  // Create HTTP server
  const server = http.createServer(app);
  
  // Initialize WebSocket service
  websocketService.initialize(server);
  
  // Test Cloudinary Connection
  const { testConnection } = require('./config/cloudinary');
  testConnection();
  
  server.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📡 WebSocket server running on /ws`);
    console.log(`📁 Uploads directory: ${uploadsDir}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️  MongoDB URI: ${MONGODB_URI}\n`);
  });
})
.catch((error) => {
  console.error('MongoDB connection error:', error);
 
  // Exit process if MongoDB connection fails
  process.exit(1);
});
