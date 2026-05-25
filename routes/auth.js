const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const PasswordResetOtp = require('../models/PasswordResetOtp');
const { sendWelcomeEmail, sendLoginNotificationEmail } = require('../services/emailService');

const router = express.Router();

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-here-make-it-very-long-and-secure-for-production-use';
const PASSWORD_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

// Generate JWT Token
const generateToken = (userId, role) => {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '7d' });
};

const hashOtp = (otp) =>
  crypto
    .createHash('sha256')
    .update(`${otp}:${process.env.OTP_HASH_SECRET || JWT_SECRET}`)
    .digest('hex');

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const createEmailTransporter = () => {
  const hasUser = process.env.SMTP_USER && process.env.SMTP_USER !== 'your-email@gmail.com';
  const hasPass = process.env.SMTP_PASS && process.env.SMTP_PASS !== 'your-app-password-here';
  if (!hasUser || !hasPass) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};

const sendForgotPasswordOtpEmail = async (email, otp) => {
  const transporter = createEmailTransporter();
  if (!transporter) throw new Error('SMTP is not configured');

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
    to: email,
    subject: '247 CutBend Password Reset OTP',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <div style="background:#2563eb;color:#fff;padding:18px;border-radius:10px 10px 0 0;">
          <h2 style="margin:0;">Reset Your Password</h2>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:18px;border-radius:0 0 10px 10px;">
          <p style="margin:0 0 12px 0;color:#374151;">Use this OTP to reset your password:</p>
          <div style="font-size:28px;font-weight:700;letter-spacing:4px;color:#111827;margin:8px 0 14px 0;">
            ${otp}
          </div>
          <p style="margin:0;color:#6b7280;">This OTP is valid for 10 minutes.</p>
          <p style="margin:10px 0 0 0;color:#6b7280;">If you did not request this, please ignore this email.</p>
        </div>
      </div>
    `
  });
};

// Customer Signup
router.post('/signup', [
  body('email').isEmail().normalizeEmail(),
  body('firstName').trim().isLength({ min: 1 }),
  body('lastName').trim().isLength({ min: 1 }),
  body('phoneNumber').trim().isLength({ min: 10 }),
  body('companyName').trim().isLength({ min: 2 }),
  body('gstNumber')
    .trim()
    .toUpperCase()
    .matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .withMessage('Invalid GSTIN format'),
  body('department').isIn(['Engineering', 'Procurement', 'Design', 'Manufacturing', 'Quality Control', 'Other']),
  body('country').trim().isLength({ min: 2 }),
  body('address.street').trim().notEmpty().withMessage('Delivery street address is required'),
  body('address.city').trim().notEmpty().withMessage('Delivery city is required'),
  body('address.state').trim().notEmpty().withMessage('Delivery state is required'),
  body('address.zipCode').trim().notEmpty().withMessage('Delivery PIN/ZIP code is required'),
  body('address.country').optional().trim(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Validation failed',
        errors: errors.array() 
      });
    }

    const { email, firstName, lastName, phoneNumber, companyName, gstNumber, department, country, address, password } = req.body;

    console.log('=== SIGNUP REQUEST ===');
    console.log('Email:', email);
    console.log('Address data:', address);
    console.log('=====================');

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Process address data
    const processedAddress = {
      street: address?.street || '',
      city: address?.city || '',
      state: address?.state || '',
      zipCode: address?.zipCode || '',
      country: address?.country || country || ''
    };

    console.log('Processed address:', processedAddress);

    // Create new user
    const user = new User({
      email,
      firstName,
      lastName,
      phoneNumber,
      companyName,
      gstNumber: gstNumber.toUpperCase(),
      department,
      country,
      address: processedAddress,
      password
    });

    await user.save();

    // Send welcome email
    try {
      await sendWelcomeEmail(user.email, user.firstName);
    } catch (emailError) {
      console.error('Welcome email failed:', emailError);
      // Don't fail the signup if email fails
    }

    // Generate token
    const token = generateToken(user._id, user.role);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: user.getProfile()
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Customer Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
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

    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Update last login without re-validating legacy user documents
    await User.updateOne({ _id: user._id }, { lastLogin: new Date() });
    user.lastLogin = new Date();

    // Generate token
    const token = generateToken(user._id, user.role);
    console.log('Login successful for user:', user.email);
    console.log('User role:', user.role);
    console.log('Token generated:', token ? 'Yes' : 'No');

    // Send login notification email to customer
    if (user.role === 'customer') {
      try {
        await sendLoginNotificationEmail(user);
      } catch (emailError) {
        console.error('Login notification email failed:', emailError);
        // Don't fail the login if email fails
      }
    }

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: user.getProfile()
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.post('/forgot-password/send-otp', [body('email').isEmail().normalizeEmail()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }

    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.json({
        success: true,
        message: 'If this email is registered, an OTP has been sent'
      });
    }

    const otp = generateOtp();
    await PasswordResetOtp.findOneAndUpdate(
      { email },
      {
        $set: {
          otpHash: hashOtp(otp),
          expiresAt: new Date(Date.now() + PASSWORD_OTP_TTL_MS),
          attempts: 0,
          verified: false
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await sendForgotPasswordOtpEmail(email, otp);

    return res.json({ success: true, message: 'OTP sent to your email' });
  } catch (error) {
    console.error('Forgot password send OTP error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send OTP. Please try again.' });
  }
});

router.post(
  '/forgot-password/verify-otp',
  [body('email').isEmail().normalizeEmail(), body('otp').isLength({ min: 6, max: 6 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Invalid email or OTP' });
      }

      const { email, otp } = req.body;
      const record = await PasswordResetOtp.findOne({ email });
      if (!record) {
        return res.status(400).json({ success: false, message: 'OTP not found. Please request a new OTP.' });
      }

      if (record.expiresAt < new Date()) {
        await PasswordResetOtp.deleteOne({ email });
        return res.status(400).json({ success: false, message: 'OTP expired. Please request a new OTP.' });
      }

      if (record.attempts >= MAX_OTP_ATTEMPTS) {
        await PasswordResetOtp.deleteOne({ email });
        return res.status(400).json({ success: false, message: 'Too many attempts. Request a new OTP.' });
      }

      const isMatch = hashOtp(otp) === record.otpHash;
      if (!isMatch) {
        record.attempts += 1;
        await record.save();
        return res.status(400).json({ success: false, message: 'Invalid OTP' });
      }

      record.verified = true;
      await record.save();

      return res.json({ success: true, message: 'OTP verified' });
    } catch (error) {
      console.error('Forgot password verify OTP error:', error);
      return res.status(500).json({ success: false, message: 'Failed to verify OTP' });
    }
  }
);

router.post(
  '/forgot-password/reset',
  [
    body('email').isEmail().normalizeEmail(),
    body('otp').isLength({ min: 6, max: 6 }),
    body('newPassword')
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Please enter valid reset details' });
      }

      const { email, otp, newPassword } = req.body;
      const record = await PasswordResetOtp.findOne({ email });
      if (!record) {
        return res.status(400).json({ success: false, message: 'OTP not found. Please request a new OTP.' });
      }
      if (record.expiresAt < new Date()) {
        await PasswordResetOtp.deleteOne({ email });
        return res.status(400).json({ success: false, message: 'OTP expired. Please request a new OTP.' });
      }

      const isMatch = hashOtp(otp) === record.otpHash;
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Invalid OTP' });
      }

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      user.password = newPassword;
      await user.save();
      await PasswordResetOtp.deleteOne({ email });

      return res.json({ success: true, message: 'Password reset successful. Please login.' });
    } catch (error) {
      console.error('Forgot password reset error:', error);
      return res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
  }
);

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    console.log('=== GET PROFILE REQUEST ===');
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Decoded token:', decoded);
    const user = await User.findById(decoded.id || decoded.userId);
    
    if (!user) {
      console.log('⚠️ User not found for ID:', decoded.id || decoded.userId);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const userProfile = user.getProfile();
    console.log('Sending user profile:', userProfile);
    res.json(userProfile);

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    console.error('Profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    console.log('=== UPDATE PROFILE REQUEST ===');
    console.log('Request body:', req.body);
    
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Decoded token:', decoded);
    const user = await User.findById(decoded.id || decoded.userId);
    
    if (!user) {
      console.log('⚠️ User not found for ID:', decoded.id || decoded.userId);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('Current user data:', {
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      companyName: user.companyName,
      address: user.address
    });

    // Update allowed fields
    const { firstName, lastName, email, phoneNumber, companyName, gstNumber, department, country, address } = req.body;
    
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (companyName) user.companyName = companyName;
    if (department) user.department = department;
    if (country) user.country = country;

    if (gstNumber !== undefined) {
      const gst = String(gstNumber || '').trim().toUpperCase();
      if (gst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gst)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid GSTIN format'
        });
      }
      user.gstNumber = gst;
    }

    if (email !== undefined && email !== null && String(email).trim()) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid email address'
        });
      }
      if (normalizedEmail !== user.email) {
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser && existingUser._id.toString() !== user._id.toString()) {
          return res.status(400).json({
            success: false,
            message: 'Email is already in use by another account'
          });
        }
        user.email = normalizedEmail;
      }
    }
    
    // Update address if provided
    if (address) {
      console.log('Updating address with:', address);
      if (address.street !== undefined) user.address.street = address.street;
      if (address.city !== undefined) user.address.city = address.city;
      if (address.state !== undefined) user.address.state = address.state;
      if (address.zipCode !== undefined) user.address.zipCode = address.zipCode;
      if (address.country !== undefined) user.address.country = address.country;
    }

    await user.save();
    console.log('✅ Profile updated successfully!');
    console.log('Updated user data:', {
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      companyName: user.companyName,
      address: user.address
    });

    const updatedProfile = user.getProfile();
    console.log('Sending updated profile:', updatedProfile);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedProfile
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
