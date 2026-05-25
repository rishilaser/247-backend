const express = require('express');
const XLSX = require('xlsx');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { buildAttachmentContentDisposition } = require('../utils/contentDisposition');

const router = express.Router();

const CUSTOMER_SELECT = '-password';

const formatUserResponse = (user) => {
  if (!user) return user;
  const doc = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  const { password, ...safe } = doc;
  return {
    ...safe,
    gstNumber: safe.gstNumber || safe.gst || null
  };
};

const buildUserListFilter = (query) => {
  const { role, search, status } = query;
  const filter = {};

  if (role) {
    filter.role = role;
  }

  if (status === 'active') {
    filter.isActive = true;
  } else if (status === 'inactive') {
    filter.isActive = false;
  }

  if (search && String(search).trim()) {
    const regex = new RegExp(String(search).trim(), 'i');
    filter.$or = [
      { email: regex },
      { firstName: regex },
      { lastName: regex },
      { companyName: regex },
      { phoneNumber: regex },
      { gstNumber: regex }
    ];
  }

  return filter;
};

const formatAddressForExport = (address) => {
  if (!address || typeof address !== 'object') return '';
  return [address.street, address.city, address.state, address.zipCode, address.country]
    .filter(Boolean)
    .join(', ');
};

const formatExportDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

// Export customers to Excel
router.get('/export/excel', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const filter = buildUserListFilter({ ...req.query, role: req.query.role || 'customer' });

    const users = await User.find(filter, CUSTOMER_SELECT)
      .sort({ createdAt: -1 })
      .lean();

    const headers = [
      'First Name',
      'Last Name',
      'Email',
      'Phone',
      'Company',
      'GSTIN Number',
      'Department',
      'Country',
      'Address',
      'Status',
      'Registered Date',
      'Last Login'
    ];

    const rows = users.map((user) => {
      const formatted = formatUserResponse(user);
      return [
        formatted.firstName || '',
        formatted.lastName || '',
        formatted.email || '',
        formatted.phoneNumber || '',
        formatted.companyName || '',
        formatted.gstNumber || '',
        formatted.department || '',
        formatted.country || '',
        formatAddressForExport(formatted.address),
        formatted.isActive ? 'Active' : 'Inactive',
        formatExportDate(formatted.createdAt),
        formatExportDate(formatted.lastLogin)
      ];
    });

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    worksheet['!cols'] = [
      { wch: 14 },
      { wch: 14 },
      { wch: 28 },
      { wch: 14 },
      { wch: 22 },
      { wch: 18 },
      { wch: 16 },
      { wch: 12 },
      { wch: 36 },
      { wch: 10 },
      { wch: 14 },
      { wch: 14 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Customers');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `customers_${stamp}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', buildAttachmentContentDisposition(filename));
    res.send(buffer);
  } catch (error) {
    console.error('Export customers Excel error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export customers to Excel'
    });
  }
});

// List users (admin/backoffice)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = '1', limit = '50' } = req.query;
    const filter = buildUserListFilter(req.query);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(filter, CUSTOMER_SELECT)
        .populate('createdBy', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter)
    ]);

    res.json({
      success: true,
      users: users.map(formatUserResponse),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get single user
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id, CUSTOMER_SELECT)
      .populate('createdBy', 'firstName lastName email');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Activate/deactivate customer account
router.put('/:id/status', authenticateToken, requireAdmin, [
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
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role !== 'customer') {
      return res.status(400).json({
        success: false,
        message: 'Status can only be updated for customer accounts'
      });
    }

    user.isActive = isActive;
    await user.save();

    res.json({
      success: true,
      message: `Customer ${isActive ? 'activated' : 'deactivated'} successfully`,
      user: user.getProfile()
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
