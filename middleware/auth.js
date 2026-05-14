const jwt = require('jsonwebtoken');

// JWT Secret - must match the one used in auth.js
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-here-make-it-very-long-and-secure-for-production-use';

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  
  // Only log in development
  if (process.env.NODE_ENV === 'development') {
    console.log('Auth Middleware:', {
      url: req.url,
      method: req.method,
      hasToken: !!token
    });
  }
  
  if (!token) {
    return res.status(401).json({ 
      success: false,
      message: 'Access token required' 
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      // Only log in development
      if (process.env.NODE_ENV === 'development') {
        console.log('Token verification failed:', err.message);
      }
      
      // If token expired, return 401 instead of 403
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          success: false,
          message: 'Token expired. Please login again.' 
        });
      }
      
      return res.status(403).json({ 
        success: false,
        message: 'Invalid token' 
      });
    }
    
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  });
};

// Middleware to check if user is admin/backoffice
const requireAdmin = (req, res, next) => {
  if (!['admin', 'backoffice'].includes(req.userRole)) {
    return res.status(403).json({ 
      success: false,
      message: 'Admin access required' 
    });
  }
  next();
};

// Middleware to check if user is back office/admin/subadmin
const requireBackOffice = (req, res, next) => {
  if (!['admin', 'backoffice', 'subadmin'].includes(req.userRole)) {
    return res.status(403).json({ 
      success: false,
      message: 'Back office access required' 
    });
  }
  next();
};

// Middleware to check quotation creation permission
const requireQuotationPermission = async (req, res, next) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Admin and backoffice always have permission
    if (['admin', 'backoffice'].includes(user.role)) {
      return next();
    }

    // Sub-admin needs specific permission
    if (user.role === 'subadmin' && user.permissions.canCreateQuotations) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Insufficient permissions to create quotations'
    });
  } catch (error) {
    console.error('Permission check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireBackOffice,
  requireQuotationPermission
};
