const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const { sendQuoteFormEmail } = require('../services/emailService');

// Ping to verify contact API is reachable (for debugging 404 on live)
router.get('/ping', (req, res) => {
  res.status(200).json({ ok: true, message: 'Contact API is reachable' });
});

// Contact form submission
router.post('/', [
  body('name').notEmpty().trim().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('company').optional().trim(),
  body('phone').optional().trim(),
  body('service').optional().trim(),
  body('message').notEmpty().trim().withMessage('Message is required')
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, email, company, phone, service, message } = req.body;

    // Log the contact form submission
    console.log('=== CONTACT FORM SUBMISSION ===');
    console.log('Name:', name);
    console.log('Email:', email);
    console.log('Company:', company);
    console.log('Phone:', phone);
    console.log('Service:', service);
    console.log('Message:', message);
    console.log('Timestamp:', new Date().toISOString());

    // Prepare quote data for email
    const quoteData = {
      name,
      email,
      phone: phone || 'Not provided',
      services: service ? [service] : [],
      message
    };

    const contactFormSentTo = process.env.CONTACTFORM_EMAIL || 'sales@247cutbend.in';

    try {
      await sendQuoteFormEmail(quoteData);
      return res.status(200).json({
        success: true,
        message: 'Quote request received successfully',
        data: {
          name,
          email,
          company,
          phone,
          service,
          submittedAt: new Date().toISOString(),
          contactFormSentTo
        }
      });
    } catch (emailError) {
      console.error('Contact form email failed:', emailError);
      return res.status(500).json({
        success: false,
        message: 'We received your request but could not send the confirmation email. Our team will still contact you.',
        reason: process.env.NODE_ENV === 'development' ? emailError.message : undefined
      });
    }
  } catch (error) {
    console.error('Contact form submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again later.'
    });
  }
});

// Get contact information
router.get('/info', (req, res) => {
  try {
    const contactInfo = {
      contactFormEmail: process.env.CONTACTFORM_EMAIL || 'sales@247cutbend.in',
      company: {
        name: 'Komacut',
        description: 'Leading sheet metal fabrication company specializing in custom metal parts, precision cutting, and manufacturing solutions.',
        founded: '2008',
        employees: '50+',
        certifications: ['ISO 9001:2015', 'AS9100D', 'IATF 16949']
      },
      contact: {
        phone: '+1 (555) 123-4567',
        email: 'info@komacut.com',
        address: {
          street: '123 Industrial Blvd',
          city: 'Manufacturing District',
          state: 'City',
          zipCode: '12345',
          country: 'United States'
        },
        businessHours: {
          monday: '8:00 AM - 6:00 PM',
          tuesday: '8:00 AM - 6:00 PM',
          wednesday: '8:00 AM - 6:00 PM',
          thursday: '8:00 AM - 6:00 PM',
          friday: '8:00 AM - 6:00 PM',
          saturday: '9:00 AM - 2:00 PM',
          sunday: 'Closed'
        }
      },
      services: [
        'Sheet Metal Fabrication',
        'CNC Laser Cutting',
        'Bending & Forming',
        'Welding Services',
        'Prototype Development',
        'Production Manufacturing'
      ],
      industries: [
        'Automotive Industry',
        'Aerospace & Defense',
        'Electronics & Telecommunications',
        'Medical Equipment',
        'Construction & Architecture',
        'Food & Beverage Processing',
        'Energy & Power Generation',
        'HVAC & Ventilation',
        'Furniture & Interior Design',
        'Agricultural Equipment'
      ],
      capabilities: {
        materials: ['Steel', 'Aluminum', 'Stainless Steel', 'Copper', 'Brass', 'Galvanized Steel'],
        thickness: '0.5mm - 25mm',
        maxSize: '4000mm x 2000mm',
        tolerance: '±0.1mm',
        finish: ['Powder Coating', 'Anodizing', 'Plating', 'Brushing', 'Polishing']
      }
    };

    res.json({
      success: true,
      data: contactInfo
    });

  } catch (error) {
    console.error('Contact info error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
