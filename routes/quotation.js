const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { sendQuotationSentEmail } = require('../services/emailService');
const pdfService = require('../services/pdfService');

const ADMIN_ROLES = ['admin', 'backoffice', 'subadmin'];
const { isQuotationVisibleToCustomer } = require('../utils/quotationVisibility');

/** Customer email/SMS — only from POST /api/quotation/:id/send (Quotations tab → Send). */
const dispatchQuotationToCustomer = async (quotation) => {
  let inquiryNumber = null;
  try {
    const inquiry = await Inquiry.findById(quotation.inquiryId).select('inquiryNumber').lean();
    if (inquiry) {
      inquiryNumber = inquiry.inquiryNumber;
    }
  } catch (inquiryError) {
    console.warn('Could not fetch inquiry number for quotation email:', inquiryError.message);
  }

  const quotationForEmail = quotation.toObject ? quotation.toObject() : quotation;
  await sendQuotationSentEmail(quotationForEmail, inquiryNumber);
};
const Quotation = require('../models/Quotation');
const Inquiry = require('../models/Inquiry');
// ✅ CLOUDINARY: No local uploads directory needed - all files go to Cloudinary
const { uploadFileToCloudinary, uploadPdfToCloudinary, isCloudinaryConfigured } = require('../services/cloudinaryService');
const axios = require('axios');
const mongoose = require('mongoose');

// ✅ CLOUDINARY: Use memory storage - ALL files go directly to Cloudinary, NOT local disk
// Supported file types: PDF, DWG, DXF, ZIP, XLSX, XLS

if (isCloudinaryConfigured()) {
  console.log('✅ CLOUDINARY: Configured - All files will be uploaded directly to Cloudinary ☁️');
  console.log('   - Supported: PDF, DWG, DXF, ZIP, XLSX, XLS');
} else {
  console.warn('⚠️  CLOUDINARY: Not configured - Please set CLOUD_NAME, CLOUD_KEY, and CLOUD_SECRET in .env');
}

// Configure multer to use MEMORY storage (not disk) - files go directly to Cloudinary
const storage = multer.memoryStorage(); // ✅ Store in memory, upload to Cloudinary directly

// Allowed file types and their MIME types
const allowedFileTypes = {
  '.pdf': 'application/pdf',
  '.dwg': 'application/acad',
  '.dxf': 'application/dxf',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel'
};

const allowedExtensions = Object.keys(allowedFileTypes);

const upload = multer({
  storage: storage, // ✅ Memory storage - no local files
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for all file types
  },
  fileFilter: (req, file, cb) => {
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed. Allowed types: ${allowedExtensions.join(', ')}. Maximum file size is 50MB.`), false);
    }
  }
});

// @route   POST /api/quotation/create
// @desc    Create a new quotation
// @access  Private (Admin/Back Office)
router.post('/create', [
  authenticateToken,
  upload.single('uploadedFile'), // Add multer middleware for file upload
  body('inquiryId').notEmpty().withMessage('Inquiry ID is required'),
  body('totalAmount').isNumeric().withMessage('Total amount must be a number')
], async (req, res) => {
  try {
    console.log('=== QUOTATION CREATE REQUEST START ===');
    console.log('User ID:', req.userId);
    console.log('User Role:', req.userRole);
    console.log('Request Body:', JSON.stringify(req.body, null, 2));
    console.log('Uploaded File:', req.file ? {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : 'No file uploaded');

    console.log('=== STEP 2: VALIDATING REQUEST ===');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    console.log('=== STEP 3: VALIDATION PASSED ===');

    const { inquiryId, parts, totalAmount, isUploadQuotation, uploadedFile, terms, notes, validUntil } = req.body;
    console.log('=== STEP 4: EXTRACTED REQUEST DATA ===');
    console.log('inquiryId:', inquiryId);
    console.log('parts:', parts);
    console.log('parts type:', typeof parts);
    console.log('parts is array:', Array.isArray(parts));
    console.log('parts length:', parts ? parts.length : 'undefined');
    console.log('parts content:', JSON.stringify(parts, null, 2));
    console.log('totalAmount:', totalAmount);

    console.log('=== STEP 5: FETCHING INQUIRY ===');
    // Get customer info from inquiry
    const inquiry = await Inquiry.findById(inquiryId).populate('customer', 'firstName lastName email companyName phoneNumber');
    console.log('=== STEP 6: INQUIRY FETCHED ===');
    if (!inquiry) {
      console.log('Inquiry not found:', inquiryId);
      return res.status(404).json({
        success: false,
        message: 'Inquiry not found'
      });
    }

    console.log('Found inquiry:', {
      id: inquiry._id,
      customer: inquiry.customer,
      customerType: typeof inquiry.customer,
      customerKeys: inquiry.customer ? Object.keys(inquiry.customer) : 'No customer object'
    });
    console.log('=== STEP 7: INQUIRY FOUND ===');

    // Check if quotation already exists for this inquiry
    console.log('=== STEP 7.5: CHECKING FOR EXISTING QUOTATION ===');
    const existingQuotation = await Quotation.findOne({ inquiryId: inquiryId.toString() });
    if (existingQuotation) {
      console.log('Quotation already exists for this inquiry:', existingQuotation._id);
      return res.status(400).json({
        success: false,
        message: 'A quotation already exists for this inquiry',
        existingQuotationId: existingQuotation._id,
        quotationNumber: existingQuotation.quotationNumber
      });
    }
    console.log('=== STEP 7.6: NO EXISTING QUOTATION FOUND ===');

    console.log('=== STEP 8: CREATING QUOTATION DATA ===');
    // Create quotation object with proper data structure
    let customerInfo;
    try {
      customerInfo = {
        name: (inquiry.customer?.firstName || '') + ' ' + (inquiry.customer?.lastName || '') || 'Customer',
        company: inquiry.customer?.companyName || 'Company',
        email: inquiry.customer?.email || 'customer@example.com',
        phone: inquiry.customer?.phoneNumber || '+1234567890'
      };
      console.log('Customer info extracted:', customerInfo);
    } catch (customerError) {
      console.error('Error extracting customer info:', customerError);
      customerInfo = {
        name: 'Customer',
        company: 'Company',
        email: 'customer@example.com',
        phone: '+1234567890'
      };
    }
    
    const quotationData = {
      inquiryId: inquiryId.toString(), // Convert ObjectId to string
      customerInfo: customerInfo,
      totalAmount: parseFloat(totalAmount),
      items: Array.isArray(parts) ? parts.map(part => ({
        partRef: part.partRef || '',
        material: part.material || 'Zintec',
        thickness: part.thickness || '1.5',
        grade: part.grade || '',
        quantity: part.quantity || 1,
        unitPrice: part.unitPrice || 0,
        totalPrice: part.totalPrice || 0,
        remark: part.remarks || part.remark || ''
      })) : [],
      quotationPdf: req.file ? req.file.filename : null, // Use actual uploaded filename from multer
      status: 'draft',
      validUntil: req.body.validUntil ? new Date(req.body.validUntil) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now if not provided
      terms: req.body.terms || 'Standard manufacturing terms apply. Payment required before production begins.',
      notes: req.body.notes || '',
      createdBy: req.userId
    };

    console.log('Quotation data to save:', JSON.stringify(quotationData, null, 2));
    console.log('Items array in quotation data:', quotationData.items);
    console.log('Items array length:', quotationData.items ? quotationData.items.length : 'undefined');
    console.log('Quotation PDF filename:', quotationData.quotationPdf);
    console.log('=== STEP 9: QUOTATION DATA CREATED ===');

    console.log('=== STEP 10: SAVING TO DATABASE ===');
    // Save quotation to database
    let savedQuotation;
    try {
      savedQuotation = await Quotation.create(quotationData);
      console.log('Quotation saved successfully:', savedQuotation._id);
      console.log('=== STEP 11: DATABASE SAVE COMPLETE ===');
    } catch (dbError) {
      console.error('Database save error:', dbError);
      console.error('Error name:', dbError.name);
      console.error('Error message:', dbError.message);
      console.error('Error code:', dbError.code);
      if (dbError.name === 'ValidationError') {
        console.error('Validation errors:', dbError.errors);
      }
      throw dbError; // Re-throw to be caught by outer try-catch
    }

    // Generate PDF for the quotation (only if not already uploaded)
    console.log('=== STEP 11.5: CHECKING PDF ===');
    console.log('Uploaded file:', req.file ? req.file.filename : 'None');
    console.log('Current quotationPdf:', savedQuotation.quotationPdf);
    
    if (!savedQuotation.quotationPdf || savedQuotation.quotationPdf === null) {
      console.log('No PDF uploaded, generating PDF...');
      try {
        // Prepare quotation data for PDF generation
        const pdfQuotationData = {
          parts: Array.isArray(parts) ? parts.map(part => ({
            partRef: part.partRef || '',
            material: part.material || 'Zintec',
            thickness: part.thickness || '1.5',
            quantity: part.quantity || 1,
            price: part.unitPrice || 0,
            remarks: part.remarks || part.remark || ''
          })) : [],
          totalAmount: parseFloat(totalAmount),
          currency: 'INR',
          validUntil: validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          terms: terms || 'Standard manufacturing terms apply. Payment required before production begins.'
        };

        // Generate PDF
        const pdfResult = await pdfService.generateQuotationPDF(inquiry, pdfQuotationData);
        console.log('PDF generated successfully:', pdfResult.fileName);

        // ✅ BEST PRACTICE: Keep generated PDF on disk, store only filename in database
        if (fs.existsSync(pdfResult.filePath)) {
          // Ensure file is in the correct location
          const permanentPath = path.join(__dirname, '../uploads/quotations', pdfResult.fileName);
          if (pdfResult.filePath !== permanentPath) {
            // Move to permanent location if needed
            if (!fs.existsSync(permanentPath)) {
              fs.renameSync(pdfResult.filePath, permanentPath);
              console.log('Generated PDF moved to permanent location');
            }
          }
          
          // Update quotation with filename only (file stays on disk)
          savedQuotation.quotationPdf = pdfResult.fileName; // Store filename - file is on disk
          savedQuotation.quotationPdfFilename = pdfResult.fileName; // Store original filename
          // Note: quotationPdfData (Buffer) is deprecated
          await savedQuotation.save();
          
          console.log('Quotation updated with PDF filename, file stored on disk');
        } else {
          console.warn('Generated PDF file not found at:', pdfResult.filePath);
          // Still save the filename
          savedQuotation.quotationPdf = pdfResult.fileName;
          await savedQuotation.save();
        }
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError);
        // Don't fail the request if PDF generation fails
      }
    } else {
      console.log('✅ PDF already uploaded, skipping generation:', savedQuotation.quotationPdf);
      
      // ✅ BEST PRACTICE: Keep uploaded PDF on disk, store only filename in database
      if (req.file && req.file.path) {
        try {
          // File is already in the correct location (uploads/quotations/)
          // Just update the filename in database
          savedQuotation.quotationPdf = req.file.filename; // Store filename - file is on disk
          savedQuotation.quotationPdfFilename = req.file.filename;
          // Note: quotationPdfData (Buffer) is deprecated
          await savedQuotation.save();
          
          console.log('Uploaded PDF filename stored, file remains on disk:', req.file.path);
        } catch (readError) {
          console.error('Error reading uploaded PDF file:', readError);
        }
      }
    }

    // Update inquiry status to 'quoted'
    console.log('=== STEP 12: UPDATING INQUIRY STATUS ===');
    try {
      await Inquiry.findByIdAndUpdate(inquiryId, { 
        status: 'quoted',
        quotation: savedQuotation._id 
      });
      console.log('Inquiry status updated to quoted');
    } catch (updateError) {
      console.error('Error updating inquiry status:', updateError);
      // Don't fail the request if inquiry update fails
    }

    console.log('📧 Quotation saved as draft — customer email NOT sent (use Quotations tab → Send)');

    // Customer is notified only when admin sends the quotation (POST /:id/send)

    res.json({
      success: true,
      message: 'Quotation saved as draft. Send it from the Quotations tab to email the customer.',
      quotation: savedQuotation
    });

  } catch (error) {
    console.error('=== QUOTATION CREATION ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    console.error('Full error object:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// @route   POST /api/quotation/upload
// @desc    Upload quotation PDF
// @access  Private (Admin/Back Office)
router.post('/upload', [
  authenticateToken,
  upload.single('quotationPdf')
], async (req, res) => {
  try {
    console.log('📄 ===== BACKEND: QUOTATION PDF UPLOAD REQUEST START =====');
    console.log('👤 User Details:');
    console.log('   - User ID:', req.userId);
    console.log('   - User Role:', req.userRole);
    console.log('📋 Request Body:');
    console.log('   - inquiryId:', req.body.inquiryId);
    console.log('   - totalAmount:', req.body.totalAmount);
    console.log('   - terms:', req.body.terms);
    console.log('   - notes:', req.body.notes);
    console.log('   - validUntil:', req.body.validUntil);
    console.log('📁 Uploaded File Details:');
    if (req.file) {
      console.log('   - Original Name:', req.file.originalname);
      console.log('   - File Size:', req.file.buffer.length, 'bytes');
      console.log('   - File Size (MB):', (req.file.buffer.length / (1024 * 1024)).toFixed(2), 'MB');
      console.log('   - MIME Type:', req.file.mimetype);
      console.log('   - Field Name:', req.file.fieldname);
      console.log('   - Storage: Memory Buffer (direct to Cloudinary)');
    } else {
      console.log('   ⚠️  NO FILE UPLOADED!');
    }

    // Validate request
    if (!req.body.inquiryId) {
      return res.status(400).json({
        success: false,
        message: 'Inquiry ID is required'
      });
    }

    if (!req.body.totalAmount) {
      return res.status(400).json({
        success: false,
        message: 'Total amount is required'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Quotation file is required (PDF, DWG, DXF, ZIP, XLSX, XLS)'
      });
    }

    const { inquiryId, customerInfo, totalAmount, terms, notes, validUntil } = req.body;
    
    // Get customer info from inquiry
    const inquiry = await Inquiry.findById(inquiryId).populate('customer', 'firstName lastName email companyName phoneNumber');
    if (!inquiry) {
      return res.status(404).json({
        success: false,
        message: 'Inquiry not found'
      });
    }

    // Check if quotation already exists
    const existingQuotation = await Quotation.findOne({ inquiryId: inquiryId.toString() });
    if (existingQuotation) {
      return res.status(400).json({
        success: false,
        message: 'A quotation already exists for this inquiry',
        existingQuotationId: existingQuotation._id
      });
    }

    // Prepare customer info
    let parsedCustomerInfo;
    try {
      parsedCustomerInfo = typeof customerInfo === 'string' ? JSON.parse(customerInfo) : customerInfo;
    } catch (e) {
      parsedCustomerInfo = {
        name: `${inquiry.customer?.firstName || ''} ${inquiry.customer?.lastName || ''}`.trim() || 'Customer',
        company: inquiry.customer?.companyName || 'Company',
        email: inquiry.customer?.email || 'customer@example.com',
        phone: inquiry.customer?.phoneNumber || '+1234567890'
      };
    }

    // ✅ CLOUDINARY: Validate file from memory buffer (no disk access)
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    const fileType = fileExtension.slice(1).toUpperCase();
    
    console.log('💾 ===== BACKEND: VALIDATING FILE =====');
    console.log('📂 Storage: Memory Buffer (direct to Cloudinary)');
    console.log('📊 File Statistics:');
    console.log('   - File Size:', req.file.buffer.length, 'bytes');
    console.log('   - File Size (MB):', (req.file.buffer.length / (1024 * 1024)).toFixed(2), 'MB');
    console.log('   - Original Filename:', req.file.originalname);
    console.log('   - File Type:', fileType);
    
    // Validate file size
    if (req.file.buffer.length < 100) {
      console.log('   ⚠️  WARNING: File size is very small (< 100 bytes) - file might be corrupted or empty!');
      return res.status(400).json({
        success: false,
        message: 'Invalid file: File size is too small. Please upload a valid file.',
        fileSize: req.file.buffer.length
      });
    }
    
    // Validate PDF header only for PDF files
    if (fileExtension === '.pdf') {
      const pdfHeader = req.file.buffer.slice(0, 4).toString('ascii');
      console.log('   - PDF Header:', pdfHeader);
      if (pdfHeader !== '%PDF') {
        console.log('   ⚠️  WARNING: File does not appear to be a valid PDF! (Header should be "%PDF")');
        return res.status(400).json({
          success: false,
          message: 'Invalid PDF file: File does not have a valid PDF header. Please upload a valid PDF file.',
          detectedHeader: pdfHeader
        });
      }
      console.log('   ✅ Valid PDF header detected');
    }
    
    const fileName = req.file.originalname;
    const fileBuffer = req.file.buffer; // ✅ Memory storage - get buffer directly
    
    // ✅ Save quotation first (without Cloudinary URL) for fast response
    const quotationData = {
      inquiryId: inquiryId.toString(),
      customerInfo: parsedCustomerInfo,
      totalAmount: parseFloat(totalAmount),
      quotationPdf: null, // Will be updated after Cloudinary upload
      quotationPdfFilename: fileName, // Original filename
      quotationPdfCloudinaryUrl: null, // Will be updated after Cloudinary upload
      quotationPdfCloudinaryPublicId: null, // Will be updated after Cloudinary upload
      items: [],
      status: 'draft',
      validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      terms: terms || 'Standard manufacturing terms apply. Payment required before production begins.',
      notes: notes || '',
      createdBy: req.userId
    };

    console.log('💾 Saving quotation to MongoDB...');
    const savedQuotation = await Quotation.create(quotationData);
    
    console.log('✅ Quotation saved successfully!');
    console.log('   - Quotation ID:', savedQuotation._id);
    console.log('   - Quotation Number:', savedQuotation.quotationNumber);
    
    // Update inquiry status
    await Inquiry.findByIdAndUpdate(inquiryId, { 
      status: 'quoted',
      quotation: savedQuotation._id 
    });

    // Return response immediately for fast API response
    console.log('📧 Quotation uploaded as draft — customer email NOT sent (use Quotations tab → Send)');

    res.json({
      success: true,
      message: 'Quotation uploaded as draft. Send it from the Quotations tab to email the customer.',
      quotation: savedQuotation,
      pdfStorage: 'cloudinary',
      cloudinaryUrl: null // Will be updated in background
    });

    // Upload to Cloudinary in background (non-blocking)
    setImmediate(async () => {
      try {
        if (!isCloudinaryConfigured()) {
          console.error('❌ CLOUDINARY: Not configured!');
          throw new Error('Cloudinary is not configured.');
        }

        console.log(`📤 Uploading ${fileType} file directly to Cloudinary from memory...`);
        
        const cloudinaryResult = await uploadFileToCloudinary(
          fileBuffer,
          fileName,
          'quotations'
        );
        
        const cloudinaryUrl = cloudinaryResult.url;
        const cloudinaryPublicId = cloudinaryResult.public_id;
        
        console.log(`✅ CLOUDINARY: ${fileType} FILE UPLOADED SUCCESSFULLY!`);
        console.log('   - Cloudinary URL:', cloudinaryUrl);
        console.log('   - Public ID:', cloudinaryPublicId);
        
        // Update quotation with Cloudinary URL
        await Quotation.findByIdAndUpdate(savedQuotation._id, {
          quotationPdf: cloudinaryUrl,
          quotationPdfCloudinaryUrl: cloudinaryUrl,
          quotationPdfCloudinaryPublicId: cloudinaryPublicId
        });
        
        console.log('✅ Quotation updated with Cloudinary URL');
      } catch (cloudinaryError) {
        console.error('❌ CLOUDINARY UPLOAD ERROR:', cloudinaryError.message);
        console.error('   Error details:', cloudinaryError);
        // Don't fail the request - quotation is already saved
      }
    });

    // Customer is notified only when admin sends the quotation (POST /:id/send)

  } catch (error) {
    console.error('Quotation upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/quotation
// @desc    Get all quotations (Admin/Back Office) - OPTIMIZED
// @access  Private (Admin/Back Office)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, search } = req.query; // Reduced to 50 for <1s response
    const skip = (page - 1) * limit;
    
    // Build query
    const query = {};
    if (status) {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { 'customerInfo.name': { $regex: search, $options: 'i' } },
        { 'customerInfo.email': { $regex: search, $options: 'i' } },
        { inquiryId: { $regex: search, $options: 'i' } }
      ];
    }

    // ULTRA OPTIMIZED: Get quotations with minimal fields, limit results for speed
    const maxLimit = Math.min(parseInt(limit) || 50, 50); // Max 50 for <1s response
    const [quotations, total] = await Promise.all([
      Quotation.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(maxLimit)
        .select('quotationNumber inquiryId customerInfo totalAmount status quotationPdfCloudinaryUrl createdAt validUntil')
        .lean(),
      // Only count if needed (skip for first page to save time)
      page === 1 ? Promise.resolve(0) : Quotation.countDocuments(query)
    ]);

    // Batch fetch inquiries with customer data
    const inquiryIds = [...new Set(quotations.map(q => q.inquiryId).filter(Boolean))];
    let inquiryMap = {};
    
    if (inquiryIds.length > 0) {
      // Fetch inquiries with customer populated
      const inquiries = await Inquiry.find({ _id: { $in: inquiryIds } })
        .select('_id inquiryNumber customer')
        .populate('customer', 'firstName lastName companyName email')
        .lean();
      
      // Map inquiries with customer data
      inquiries.forEach(inq => {
        inquiryMap[inq._id.toString()] = {
          _id: inq._id,
          inquiryNumber: inq.inquiryNumber,
          customer: inq.customer || null
        };
      });
    }

    // Map quotations with inquiry data (including customer)
    const quotationsWithInquiry = quotations.map(quotation => ({
      ...quotation,
      inquiry: inquiryMap[quotation.inquiryId] || null
    }));

    res.json({
      success: true,
      quotations: quotationsWithInquiry,
      pagination: {
        current: parseInt(page),
        pages: page === 1 ? 1 : Math.ceil((total || quotationsWithInquiry.length) / maxLimit), // Skip calculation for first page
        total: page === 1 ? quotationsWithInquiry.length : (total || quotationsWithInquiry.length)
      }
    });

  } catch (error) {
    console.error('Get quotations error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/quotation/customer
// @desc    Get quotations for the current customer
// @access  Private (Customer)
router.get('/customer', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;
    
    // OPTIMIZED: Get customer's inquiries first
    const customerInquiries = await Inquiry.find({ customer: userId }).select('_id').lean();
    const inquiryIds = customerInquiries.map(inquiry => inquiry._id);
    
    // Build query — customers never see draft quotations
    const query = { inquiryId: { $in: inquiryIds } };
    if (status && String(status).toLowerCase() !== 'draft') {
      query.status = status;
    } else {
      query.status = { $ne: 'draft' };
    }
    
    // OPTIMIZED: Get quotations and total count in parallel
    const [quotations, total] = await Promise.all([
      Quotation.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean()
        .select('quotationNumber inquiryId status totalAmount createdAt validUntil orderPaymentWorkflowStatus payment_status'),
      Quotation.countDocuments(query)
    ]);

    // OPTIMIZED: Batch fetch all inquiries at once instead of one-by-one
    const uniqueInquiryIds = [...new Set(quotations.map(q => q.inquiryId).filter(Boolean))];
    const inquiries = await Inquiry.find({ _id: { $in: uniqueInquiryIds } })
      .select('_id inquiryNumber')
      .lean();
    
    // Create inquiry lookup map
    const inquiryMap = {};
    inquiries.forEach(inq => {
      inquiryMap[inq._id.toString()] = {
        _id: inq._id,
        inquiryNumber: inq.inquiryNumber
      };
    });

    // Map quotations with inquiry data
    const quotationsWithInquiry = quotations.map(quotation => ({
      ...quotation,
      inquiry: inquiryMap[quotation.inquiryId] || null
    }));

    console.log('=== GET CUSTOMER QUOTATIONS ===');
    console.log('Customer ID:', userId);
    console.log('Customer inquiries found:', customerInquiries.length);
    console.log('Inquiry IDs:', inquiryIds);
    console.log('Query:', query);
    console.log('Found quotations:', quotationsWithInquiry.length);
    console.log('Quotations with inquiry:', quotationsWithInquiry.map(q => ({ 
      id: q._id, 
      status: q.status, 
      inquiryId: q.inquiryId,
      inquiryNumber: q.inquiry?.inquiryNumber 
    })));

    res.json({
      success: true,
      quotations: quotationsWithInquiry,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });

  } catch (error) {
    console.error('Get customer quotations error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/quotation/:inquiryId
// @desc    Get quotation by inquiry ID
// @access  Private
router.get('/:inquiryId', authenticateToken, async (req, res) => {
  try {
    const { inquiryId } = req.params;
    const isAdmin = ADMIN_ROLES.includes(req.userRole);

    // Fetch quotation from database
    const quotation = await Quotation.findOne({ inquiryId });

    if (quotation) {
      if (!isAdmin && !isQuotationVisibleToCustomer(quotation.status)) {
        return res.json({
          success: false,
          message: 'Quotation not available yet'
        });
      }
      // Manually populate inquiry data
      const quotationObj = quotation.toObject();
      try {
        // Find the inquiry using the inquiryId string
        const inquiry = await Inquiry.findById(quotation.inquiryId).populate('customer', 'firstName lastName email companyName');
        if (inquiry) {
          quotationObj.inquiry = {
            _id: inquiry._id,
            inquiryNumber: inquiry.inquiryNumber,
            customer: inquiry.customer
          };
        }
      } catch (error) {
        // Only log timeout errors in development, handle gracefully
        if (error.name === 'MongoNetworkTimeoutError' || error.name === 'MongooseServerSelectionError') {
          if (process.env.NODE_ENV === 'development') {
            console.warn('MongoDB timeout fetching inquiry for quotation:', quotation._id);
          }
        } else if (process.env.NODE_ENV === 'development') {
          console.error('Error fetching inquiry for quotation:', quotation._id, error.message);
        }
        quotationObj.inquiry = null;
      }

      res.json({
        success: true,
        quotation: quotationObj
      });
    } else {
      res.json({
        success: false,
        message: 'Quotation not found'
      });
    }

  } catch (error) {
    console.error('Get quotation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/quotation/id/:id
// @desc    Get quotation by quotation ID - Allow both customers and admins
// @access  Private
router.get('/id/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    
    // Validate ID parameter
    if (!id || id === 'undefined' || id === 'null' || id.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Invalid quotation ID provided',
        receivedId: id,
        error: 'ID cannot be undefined, null, or empty'
      });
    }
    
    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quotation ID format',
        receivedId: id,
        error: 'ID must be a valid MongoDB ObjectId'
      });
    }
    
    // Check if user is admin/backoffice - they can access any quotation
    const isAdmin = ['admin', 'backoffice', 'subadmin'].includes(req.userRole);

    // Find the quotation by ID
    const quotation = await Quotation.findById(id).lean();
    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // Check access control: Admin can access any, customer can only access their own
    if (!isAdmin) {
      // Verify this quotation belongs to the customer
      const inquiry = await Inquiry.findById(quotation.inquiryId).lean().select('customer');
      if (!inquiry || inquiry.customer.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This quotation does not belong to you.'
        });
      }
      if (!isQuotationVisibleToCustomer(quotation.status)) {
        return res.status(404).json({
          success: false,
          message: 'Quotation not available yet'
        });
      }
    }

    // Manually populate inquiry data
    const quotationObj = quotation;
    try {
      // Find the inquiry using the inquiryId string
      const inquiry = await Inquiry.findById(quotation.inquiryId)
        .populate('customer', 'firstName lastName email companyName')
        .lean();
      if (inquiry) {
        quotationObj.inquiry = {
          _id: inquiry._id,
          inquiryNumber: inquiry.inquiryNumber,
          customer: inquiry.customer
        };
      }
    } catch (error) {
      console.error('Error fetching inquiry for quotation:', quotation._id, error);
      quotationObj.inquiry = null;
    }

    res.json({
      success: true,
      quotation: quotationObj
    });

  } catch (error) {
    console.error('Get quotation by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   POST /api/quotation/:id/send
// @desc    Send quotation to customer
// @access  Private (Admin/Back Office)
router.post('/:id/send', authenticateToken, async (req, res) => {
  try {
    console.log('=== SEND QUOTATION REQUEST START ===');
    const { id } = req.params;
    console.log('Quotation ID:', id);

    if (!ADMIN_ROLES.includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin users can send quotations to customers.'
      });
    }

    // Find the quotation
    const quotation = await Quotation.findById(id);
    if (!quotation) {
      console.log('Quotation not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    console.log('Found quotation:', {
      id: quotation._id,
      status: quotation.status,
      customerInfo: quotation.customerInfo,
      totalAmount: quotation.totalAmount
    });

    const previousQuotationStatus = quotation.status;

    // Update quotation status to 'sent'
    quotation.status = 'sent';
    quotation.sentAt = new Date();
    if (
      quotation.orderPaymentWorkflowStatus !== 'Paid' &&
      quotation.orderPaymentWorkflowStatus !== 'Payment Pending'
    ) {
      quotation.orderPaymentWorkflowStatus = 'Quoted';
    }
    await quotation.save();
    console.log('Quotation status updated to sent');

    // Return response immediately for fast API response
    res.json({
      success: true,
      message: 'Quotation sent successfully',
      quotation: quotation
    });

    // Email/SMS only when admin clicks Send — never on create/upload
    setImmediate(async () => {
      try {
        const freshQuotation = await Quotation.findById(id);
        if (!freshQuotation) {
          console.error('Quotation not found for email dispatch:', id);
          return;
        }

        const { notifyQuotationStatusChange } = require('../services/statusNotificationService');
        await notifyQuotationStatusChange(freshQuotation, previousQuotationStatus, 'sent');

        console.log('📧 Sending quotation email to customer (Quotations tab → Send)...');
        console.log('Customer Email:', freshQuotation.customerInfo?.email);
        console.log('Quotation Number:', freshQuotation.quotationNumber);
        await dispatchQuotationToCustomer(freshQuotation);
        console.log('✅ Quotation sent email delivered to:', freshQuotation.customerInfo?.email);
        console.log('=== SEND QUOTATION BACKGROUND TASKS COMPLETE ===');
      } catch (backgroundError) {
        console.error('❌ Quotation send email/SMS failed:', backgroundError.message);
        console.error('Error details:', backgroundError);
      }
    });

  } catch (error) {
    console.error('Send quotation error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/quotation/customer/:id
// @desc    Get single quotation for customer
// @access  Private (Customer)
router.get('/customer/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Validate ID parameter
    if (!id || id === 'undefined' || id === 'null' || id.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Invalid quotation ID provided',
        receivedId: id,
        error: 'ID cannot be undefined, null, or empty'
      });
    }
    
    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quotation ID format',
        receivedId: id,
        error: 'ID must be a valid MongoDB ObjectId'
      });
    }

    // Find the quotation
    const quotation = await Quotation.findById(id);
    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // Verify this quotation belongs to the customer
    const inquiry = await Inquiry.findById(quotation.inquiryId);
    if (!inquiry || inquiry.customer.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This quotation does not belong to you.'
      });
    }

    if (!isQuotationVisibleToCustomer(quotation.status)) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not available yet'
      });
    }

    // Manually populate inquiry data
    const quotationObj = quotation.toObject();
    try {
      const populatedInquiry = await Inquiry.findById(quotation.inquiryId).populate('customer', 'firstName lastName email companyName');
      if (populatedInquiry) {
        quotationObj.inquiry = {
          _id: populatedInquiry._id,
          inquiryNumber: populatedInquiry.inquiryNumber,
          customer: populatedInquiry.customer
        };
      }
    } catch (error) {
      console.error('Error fetching inquiry for quotation:', quotation._id, error);
      quotationObj.inquiry = null;
    }

    res.json({
      success: true,
      quotation: quotationObj
    });

  } catch (error) {
    console.error('Get customer quotation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   POST /api/quotation/:id/response
// @desc    Customer response to quotation (accept/reject)
// @access  Private (Customer)
router.post('/:id/response', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { response, notes } = req.body;
    const userId = req.userId;

    console.log('=== QUOTATION RESPONSE REQUEST ===');
    console.log('Quotation ID:', id);
    console.log('User ID:', userId);
    console.log('Response:', response);

    // Find the quotation
    const quotation = await Quotation.findById(id);
    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // Verify this quotation belongs to the customer
    const inquiry = await Inquiry.findById(quotation.inquiryId);
    if (!inquiry || inquiry.customer.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This quotation does not belong to you.'
      });
    }

    if (!isQuotationVisibleToCustomer(quotation.status)) {
      return res.status(400).json({
        success: false,
        message: 'This quotation is not available for response yet'
      });
    }

    const previousQuotationStatus = quotation.status;
    const previousInquiryStatus = inquiry.status;

    // Update quotation status based on response
    if (response === 'accepted') {
      quotation.status = 'accepted';
      quotation.acceptedAt = new Date();
    } else if (response === 'rejected') {
      quotation.status = 'rejected';
      quotation.rejectedAt = new Date();
      quotation.rejectionReason = notes || 'No reason provided';
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid response. Must be "accepted" or "rejected"'
      });
    }

    await quotation.save();

    // Update inquiry status
    if (response === 'accepted') {
      inquiry.status = 'accepted';
    } else if (response === 'rejected') {
      inquiry.status = 'rejected';
    }
    await inquiry.save();

    const {
      notifyQuotationStatusChange,
      notifyInquiryStatusChange,
    } = require('../services/statusNotificationService');
    await notifyQuotationStatusChange(quotation, previousQuotationStatus, quotation.status, {
      customerId: userId,
    });
    await notifyInquiryStatusChange(inquiry, previousInquiryStatus, inquiry.status);

    console.log('Quotation response processed successfully');

    res.json({
      success: true,
      message: `Quotation ${response} successfully`,
      quotation: quotation
    });

  } catch (error) {
    console.error('Quotation response error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/quotation/:id/pdf
// @desc    Get quotation PDF
// @access  Private
router.get('/:id/pdf', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { download } = req.query;

    // Validate ID parameter
    if (!id || id === 'undefined' || id === 'null' || id.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Invalid quotation ID provided',
        receivedId: id,
        error: 'ID cannot be undefined, null, or empty'
      });
    }

    // Try to find quotation by ID first (if id is a quotation ID)
    // Use lean() to get raw MongoDB document with quotationPdfData Buffer
    let quotation = null;
    
    // Only try findById if it's a valid ObjectId format
    if (mongoose.Types.ObjectId.isValid(id)) {
      quotation = await Quotation.findById(id).lean();
    }
    
    // If not found, try to find by inquiryId (if id is an inquiry ID)
    if (!quotation) {
      quotation = await Quotation.findOne({ inquiryId: id }).lean();
    }
    
    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }
    
    console.log('📄 ===== BACKEND: QUOTATION PDF REQUEST =====');
    console.log('   - Quotation ID:', quotation._id);
    console.log('   - Has quotationPdfCloudinaryUrl:', !!quotation.quotationPdfCloudinaryUrl);
    console.log('   - Has quotationPdfData:', !!quotation.quotationPdfData);
    console.log('   - quotationPdf:', quotation.quotationPdf);

    // OPTIMIZED: Check access control with lean query
    const isAdmin = ['admin', 'backoffice', 'subadmin'].includes(req.userRole);
    if (!isAdmin) {
      // For customers, verify the quotation belongs to them (use lean for faster query)
      const inquiry = await Inquiry.findById(quotation.inquiryId).lean().select('customer');
      if (!inquiry || inquiry.customer.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This quotation does not belong to you.'
        });
      }
      if (!isQuotationVisibleToCustomer(quotation.status)) {
        return res.status(404).json({
          success: false,
          message: 'Quotation is not available until it has been sent to you.'
        });
      }
    }
    
    // Helper function to fetch PDF from Cloudinary and serve it
    const fetchAndServeCloudinaryPdf = async (cloudinaryUrl) => {
      try {
        console.log('☁️  Fetching PDF from Cloudinary:', cloudinaryUrl);
        const response = await axios.get(cloudinaryUrl, {
          responseType: 'arraybuffer',
          timeout: 30000 // 30 second timeout
        });
        
        const pdfBuffer = Buffer.from(response.data);
        const pdfFileName = `quotation_${quotation.quotationNumber || quotation._id}.pdf`;
        
        console.log('✅ PDF fetched from Cloudinary, size:', pdfBuffer.length, 'bytes');
        
        // Set headers for PDF viewing
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', download === 'true' 
          ? `attachment; filename="${pdfFileName}"` 
          : `inline; filename="${pdfFileName}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        return res.send(pdfBuffer);
      } catch (error) {
        console.error('❌ Error fetching PDF from Cloudinary:', error.message);
        // Fall through to try other methods
        return null;
      }
    };

    // ✅ Check Cloudinary URL first (new format)
    if (quotation.quotationPdfCloudinaryUrl) {
      console.log('☁️  ===== BACKEND: SERVING PDF FROM CLOUDINARY =====');
      console.log('   - Cloudinary URL:', quotation.quotationPdfCloudinaryUrl);
      const result = await fetchAndServeCloudinaryPdf(quotation.quotationPdfCloudinaryUrl);
      if (result !== null) return; // Successfully served
    }
    
    // Check if quotationPdf is a Cloudinary URL (starts with http)
    if (quotation.quotationPdf && quotation.quotationPdf.startsWith('http')) {
      console.log('☁️  ===== BACKEND: SERVING PDF FROM CLOUDINARY (URL format) =====');
      console.log('   - Cloudinary URL:', quotation.quotationPdf);
      const result = await fetchAndServeCloudinaryPdf(quotation.quotationPdf);
      if (result !== null) return; // Successfully served
    }

    // Helper function to generate PDF
    const generatePDF = async () => {
      // Get inquiry data for PDF generation
      const inquiry = await Inquiry.findById(quotation.inquiryId).populate('customer', 'firstName lastName email companyName phoneNumber');
      if (!inquiry) {
        throw new Error('Inquiry not found for this quotation');
      }

      // Prepare quotation data for PDF generation
      const pdfQuotationData = {
        parts: quotation.items && quotation.items.length > 0 
          ? quotation.items.map(item => ({
              partRef: item.partRef || '',
              material: item.material || 'Zintec',
              thickness: item.thickness || '1.5',
              quantity: item.quantity || 1,
              price: item.unitPrice || 0,
              remarks: item.remark || ''
            }))
          : [],
        totalAmount: quotation.totalAmount || 0,
        currency: 'INR',
        validUntil: quotation.validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        terms: quotation.terms || 'Standard manufacturing terms apply. Payment required before production begins.'
      };

      // Generate PDF
      const pdfResult = await pdfService.generateQuotationPDF(inquiry, pdfQuotationData);
      console.log('PDF generated successfully:', pdfResult.fileName);
      console.log('PDF file path:', pdfResult.filePath);
      console.log('PDF file size:', pdfResult.fileSize, 'bytes');

      // Return the full pdfResult object (not just filename)
      return pdfResult;
    };

    // Check if PDF data exists in database (support multiple formats)
    let pdfBuffer = null;
    let pdfFileName = `quotation_${quotation.quotationNumber}.pdf`;
    let contentType = 'application/pdf';

    // Try new format first: quotationPdfData (Buffer)
    if (quotation.quotationPdfData) {
      if (Buffer.isBuffer(quotation.quotationPdfData)) {
        // Direct Buffer format (normal MongoDB/Mongoose format)
        pdfBuffer = quotation.quotationPdfData;
        pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
        console.log('📄 PDF found in database (new format: quotationPdfData as Buffer)');
      } else if (quotation.quotationPdfData.$binary && quotation.quotationPdfData.$binary.base64) {
        // MongoDB export format with $binary.base64
        try {
          const base64String = quotation.quotationPdfData.$binary.base64;
          pdfBuffer = Buffer.from(base64String, 'base64');
          pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
          console.log('📄 PDF found in database (new format: quotationPdfData as $binary.base64)');
          console.log('   - Base64 string length:', base64String.length);
          console.log('   - Decoded buffer size:', pdfBuffer.length, 'bytes');
          
          // Validate decoded buffer
          if (pdfBuffer.length === 0) {
            console.error('❌ Decoded PDF buffer is empty!');
            pdfBuffer = null; // Reset to null so it tries other methods
          }
        } catch (base64Error) {
          console.error('❌ Error decoding base64 PDF:', base64Error);
          pdfBuffer = null; // Reset to null so it tries other methods
        }
      } else if (quotation.quotationPdfData.buffer && Buffer.isBuffer(quotation.quotationPdfData.buffer)) {
        // Mongoose Binary wrapper format
        pdfBuffer = quotation.quotationPdfData.buffer;
        pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
        console.log('📄 PDF found in database (new format: quotationPdfData as Binary wrapper)');
      } else if (quotation.quotationPdfData.subtype !== undefined || quotation.quotationPdfData.type !== undefined) {
        // Mongoose Binary type (has subtype or type property)
        try {
          // Try to convert Mongoose Binary to Buffer
          if (quotation.quotationPdfData.buffer) {
            pdfBuffer = Buffer.from(quotation.quotationPdfData.buffer);
          } else if (quotation.quotationPdfData.toString) {
            // Try converting to string then to buffer (fallback)
            const base64 = quotation.quotationPdfData.toString('base64');
            pdfBuffer = Buffer.from(base64, 'base64');
          } else {
            pdfBuffer = Buffer.from(quotation.quotationPdfData);
          }
          pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
          console.log('📄 PDF found in database (new format: quotationPdfData as Mongoose Binary)');
          console.log('   - Converted buffer size:', pdfBuffer.length, 'bytes');
        } catch (binaryError) {
          console.error('❌ Error converting Mongoose Binary to Buffer:', binaryError);
          pdfBuffer = null;
        }
      } else if (quotation.quotationPdfData.type === 'Buffer' && Array.isArray(quotation.quotationPdfData.data)) {
        // Handle MongoDB export format: { type: 'Buffer', data: [1,2,3...] }
        try {
          pdfBuffer = Buffer.from(quotation.quotationPdfData.data);
          pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
          console.log('📄 PDF found in database (new format: quotationPdfData as Buffer type array)');
          console.log('   - Converted buffer size:', pdfBuffer.length, 'bytes');
        } catch (bufferError) {
          console.error('❌ Error creating buffer from array:', bufferError);
          pdfBuffer = null;
        }
      } else {
        console.log('⚠️  Unknown quotationPdfData format:', JSON.stringify(Object.keys(quotation.quotationPdfData || {})));
      }
    }
    // Try old format: quotationPdfBuffer (Buffer)
    else if (quotation.quotationPdfBuffer && Buffer.isBuffer(quotation.quotationPdfBuffer)) {
      pdfBuffer = quotation.quotationPdfBuffer;
      pdfFileName = quotation.quotationPdf?.fileName || quotation.quotationPdf || pdfFileName;
      contentType = quotation.quotationPdfContentType || 'application/pdf';
      console.log('PDF found in database (old format: quotationPdfBuffer)');
    }
    // Try old format: quotationPdf as object with data
    else if (quotation.quotationPdf && typeof quotation.quotationPdf === 'object' && quotation.quotationPdf.data) {
      // Handle MongoDB Binary format
      if (quotation.quotationPdf.data && quotation.quotationPdf.data.buffer) {
        pdfBuffer = Buffer.from(quotation.quotationPdf.data.buffer);
      } else if (quotation.quotationPdf.data && quotation.quotationPdf.data.$binary) {
        // Handle MongoDB export format with base64
        try {
          const base64String = quotation.quotationPdf.data.$binary.base64;
          pdfBuffer = Buffer.from(base64String, 'base64');
          console.log('   - Base64 decoded, buffer size:', pdfBuffer.length, 'bytes');
          
          // Validate decoded buffer
          if (pdfBuffer.length === 0) {
            console.error('❌ Decoded PDF buffer is empty!');
            pdfBuffer = null;
          }
        } catch (base64Error) {
          console.error('❌ Error decoding base64 PDF:', base64Error);
          pdfBuffer = null;
        }
      }
      pdfFileName = quotation.quotationPdf.fileName || quotation.quotationPdf || pdfFileName;
      contentType = quotation.quotationPdf.contentType || 'application/pdf';
      console.log('PDF found in database (old format: quotationPdf object)');
    }

    // ✅ BEST PRACTICE: Check filesystem (old format - backward compatibility) - VPS-compatible
    let pdfPath;
    if (quotation.quotationPdf && !quotation.quotationPdf.startsWith('http')) {
      pdfPath = path.join(getQuotationsPath(), quotation.quotationPdf);
      if (fs.existsSync(pdfPath)) {
        console.log('📄 ===== BACKEND: SERVING PDF FROM FILESYSTEM =====');
        console.log('   - PDF Path:', pdfPath);
        console.log('   - PDF Filename:', quotation.quotationPdf);
        
        const fileStats = fs.statSync(pdfPath);
        console.log('   - File Size:', fileStats.size, 'bytes');
        console.log('   - File Size (MB):', (fileStats.size / (1024 * 1024)).toFixed(2), 'MB');
        
        // Set appropriate headers
        if (download === 'true') {
          res.setHeader('Content-Disposition', `attachment; filename="${quotation.quotationPdf}"`);
        } else {
          res.setHeader('Content-Disposition', `inline; filename="${quotation.quotationPdf}"`);
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        
        console.log('   ✅ Sending PDF file to client...');
        return res.sendFile(path.resolve(pdfPath));
      }
    }

    // Fallback: If file not on disk, check database (backward compatibility for old records)
    if (pdfBuffer && Buffer.isBuffer(pdfBuffer)) {
      console.log('📄 ===== BACKEND: SERVING PDF FROM DATABASE (LEGACY) =====');
      console.log('   - PDF Buffer Size:', pdfBuffer.length, 'bytes');
      console.log('   - ⚠️  Note: This is legacy data. Consider migrating to filesystem storage.');
      
      // Validate PDF buffer
      if (pdfBuffer.length === 0) {
        console.error('❌ PDF Buffer is empty!');
        return res.status(500).json({
          success: false,
          message: 'PDF file is empty or corrupted'
        });
      }
      
      // Check PDF header to ensure it's a valid PDF
      const pdfHeader = pdfBuffer.toString('ascii', 0, 4);
      if (pdfHeader !== '%PDF') {
        console.error('❌ Invalid PDF header detected:', pdfHeader);
        return res.status(500).json({
          success: false,
          message: 'Invalid PDF file format. PDF may be corrupted.',
          detectedHeader: pdfHeader
        });
      }
      
      // Set appropriate headers
      if (download === 'true') {
        res.setHeader('Content-Disposition', `attachment; filename="${pdfFileName}"`);
      } else {
        res.setHeader('Content-Disposition', `inline; filename="${pdfFileName}"`);
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', pdfBuffer.length);
      res.setHeader('Cache-Control', 'no-cache');

      // Send the PDF buffer
      console.log('   ✅ Sending PDF buffer to client...');
      return res.send(pdfBuffer);
    }

    // If no PDF exists, try to generate one
    console.log('📄 ===== BACKEND: NO PDF FOUND, GENERATING PDF =====');
    try {
      const pdfResult = await generatePDF();
      
      // Read the generated PDF and store in database
      if (fs.existsSync(pdfResult.filePath)) {
        console.log('✅ Generated PDF file exists, reading into buffer...');
        pdfBuffer = fs.readFileSync(pdfResult.filePath);
        
        // Validate the generated PDF
        if (!pdfBuffer || pdfBuffer.length === 0) {
          throw new Error('Generated PDF file is empty');
        }
        
        const pdfHeader = pdfBuffer.toString('ascii', 0, 4);
        if (pdfHeader !== '%PDF') {
          throw new Error(`Invalid PDF header: ${pdfHeader}. PDF generation may have failed.`);
        }
        
        console.log('✅ Generated PDF is valid, storing in database...');
        console.log('   - PDF Size:', pdfBuffer.length, 'bytes');
        console.log('   - PDF Header:', pdfHeader);
        
        // ✅ BEST PRACTICE: Keep file on disk, store only filename in database (VPS-compatible)
        const permanentPath = path.join(getQuotationsPath(), pdfResult.fileName);
        
        // If file is already in the right place, great. Otherwise, ensure it's there.
        if (pdfResult.filePath !== permanentPath && fs.existsSync(pdfResult.filePath)) {
          // Move file to permanent location
          fs.renameSync(pdfResult.filePath, permanentPath);
          console.log('✅ Generated PDF moved to permanent location:', permanentPath);
        }
        
        // Update quotation with filename only (file stays on disk)
        await Quotation.findByIdAndUpdate(quotation._id, {
          quotationPdfFilename: pdfResult.fileName,
          quotationPdf: pdfResult.fileName // Store filename - file is on disk
          // Note: quotationPdfData (Buffer) is deprecated
        });
        
        console.log('✅ PDF filename stored in database, file on disk');
        
        pdfFileName = pdfResult.fileName;
      } else {
        throw new Error(`Generated PDF file not found at: ${pdfResult.filePath}`);
      }
    } catch (pdfError) {
      console.error('❌ PDF generation failed:', pdfError);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate PDF',
        error: pdfError.message
      });
    }

    // Validate PDF buffer before sending
    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      console.error('❌ PDF buffer is invalid or empty');
      return res.status(500).json({
        success: false,
        message: 'PDF buffer is invalid or empty'
      });
    }

    // Set appropriate headers
    if (download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${pdfFileName}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${pdfFileName}"`);
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'no-cache');

    console.log('✅ Sending generated PDF to client, size:', pdfBuffer.length, 'bytes');
    // Send the PDF buffer
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Get quotation PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Download quotation PDF (same logic as inquiry file download)
router.get('/:id/pdf/download', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID parameter
    if (!id || id === 'undefined' || id === 'null' || id.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Invalid quotation ID provided',
        receivedId: id,
        error: 'ID cannot be undefined, null, or empty'
      });
    }
    
    console.log('=== QUOTATION PDF DOWNLOAD REQUEST ===');
    console.log('Quotation ID:', id);
    console.log('User ID:', req.userId);
    console.log('User role:', req.userRole);
    
    // Check if user is admin/backoffice - they can access any quotation
    const isAdmin = ['admin', 'backoffice', 'subadmin'].includes(req.userRole);
    console.log('Is admin user:', isAdmin);
    
    // Query quotation with quotationPdfData field included (bypass toJSON using lean)
    let quotation = null;
    
    // Only try to find if it's a valid ObjectId format
    if (mongoose.Types.ObjectId.isValid(id)) {
      if (isAdmin) {
        // Admin users can access any quotation - use lean to get raw document with quotationPdfData
        quotation = await Quotation.findOne({
          _id: id
        }).lean();
      } else {
        // Regular users can only access their own quotations
        // First find the quotation
        quotation = await Quotation.findOne({
          _id: id
        }).lean();
        
        if (quotation) {
          // OPTIMIZED: Verify the quotation belongs to the user (use lean for faster query)
          const inquiry = await Inquiry.findById(quotation.inquiryId).lean().select('customer');
          if (!inquiry || inquiry.customer.toString() !== req.userId.toString()) {
            console.log('Quotation exists but user does not have access. Inquiry customer:', inquiry?.customer);
            quotation = null;
          }
        }
      }
    }
    
    // If not found by ID, try to find by inquiryId (if id is an inquiry ID)
    if (!quotation) {
      quotation = await Quotation.findOne({ inquiryId: id }).lean();
      
      if (quotation && !isAdmin) {
        // OPTIMIZED: Verify the quotation belongs to the user (use lean for faster query)
        const inquiry = await Inquiry.findById(quotation.inquiryId).lean().select('customer');
        if (!inquiry || inquiry.customer.toString() !== req.userId.toString()) {
          quotation = null;
        }
      }
    }

    if (!quotation) {
      console.log('Quotation not found. ID:', id, 'User ID:', req.userId, 'Is Admin:', isAdmin);
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    console.log('Quotation found:', quotation.quotationNumber);
    console.log('Has quotationPdf:', !!quotation.quotationPdf);
    console.log('Has quotationPdfData:', !!quotation.quotationPdfData);
    console.log('quotationPdfData type:', quotation.quotationPdfData ? typeof quotation.quotationPdfData : 'null');
    console.log('quotationPdfData is Buffer:', quotation.quotationPdfData ? Buffer.isBuffer(quotation.quotationPdfData) : false);

    // Get PDF buffer - prioritize database storage, fallback to filesystem
    let pdfBuffer = null;
    let pdfFileName = `quotation_${quotation.quotationNumber || quotation._id}.pdf`;
    let contentType = 'application/pdf';
    
    // First, try to get from database (new format: quotationPdfData)
    if (quotation.quotationPdfData) {
      console.log('📦 Reading PDF from database (quotationPdfData)');
      console.log('   - quotationPdfData type:', typeof quotation.quotationPdfData);
      console.log('   - quotationPdfData constructor:', quotation.quotationPdfData?.constructor?.name);
      console.log('   - Is Buffer:', Buffer.isBuffer(quotation.quotationPdfData));
      
      // Handle different Buffer formats (direct Buffer, Mongoose Binary, $binary.base64)
      if (Buffer.isBuffer(quotation.quotationPdfData)) {
        pdfBuffer = quotation.quotationPdfData;
        pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
        console.log('   ✅ Direct Buffer detected');
      } else if (quotation.quotationPdfData.buffer && Buffer.isBuffer(quotation.quotationPdfData.buffer)) {
        pdfBuffer = quotation.quotationPdfData.buffer;
        pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
        console.log('   ✅ Buffer from .buffer property');
      } else if (quotation.quotationPdfData.$binary && quotation.quotationPdfData.$binary.base64) {
        try {
          pdfBuffer = Buffer.from(quotation.quotationPdfData.$binary.base64, 'base64');
          pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
          console.log('   ✅ Decoded from $binary.base64');
        } catch (e) {
          console.error('   ❌ Error decoding base64:', e);
        }
      } else if (typeof quotation.quotationPdfData === 'string') {
        try {
          pdfBuffer = Buffer.from(quotation.quotationPdfData, 'base64');
          pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
          console.log('   ✅ Decoded from string base64');
        } catch (e) {
          console.error('   ❌ Error decoding string as base64:', e);
        }
      } else if (quotation.quotationPdfData.type === 'Buffer' && Array.isArray(quotation.quotationPdfData.data)) {
        // Handle MongoDB export format: { type: 'Buffer', data: [1,2,3...] }
        try {
          pdfBuffer = Buffer.from(quotation.quotationPdfData.data);
          pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
          console.log('   ✅ Decoded from Buffer type array');
        } catch (e) {
          console.error('   ❌ Error creating buffer from array:', e);
        }
      } else {
        console.log('   ⚠️  Unknown quotationPdfData format:', JSON.stringify(Object.keys(quotation.quotationPdfData || {})));
      }
      
      if (pdfBuffer && pdfBuffer.length > 0) {
        console.log(`✅ PDF buffer loaded from database, size: ${pdfBuffer.length} bytes`);
      } else {
        console.log('⚠️  Could not extract buffer from quotationPdfData, trying filesystem...');
      }
    }
    // Try old format: quotationPdfBuffer
    else if (quotation.quotationPdfBuffer && Buffer.isBuffer(quotation.quotationPdfBuffer)) {
      console.log('📦 Reading PDF from database (quotationPdfBuffer - old format)');
      pdfBuffer = quotation.quotationPdfBuffer;
      pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
      contentType = quotation.quotationPdfContentType || 'application/pdf';
      console.log(`✅ PDF buffer loaded from database (old format), size: ${pdfBuffer.length} bytes`);
    }
    // Try old format: quotationPdf as object
    else if (quotation.quotationPdf && typeof quotation.quotationPdf === 'object' && quotation.quotationPdf.data) {
      console.log('📦 Reading PDF from database (quotationPdf object - old format)');
      // Handle MongoDB Binary format
      if (quotation.quotationPdf.data && quotation.quotationPdf.data.buffer) {
        pdfBuffer = Buffer.from(quotation.quotationPdf.data.buffer);
      } else if (quotation.quotationPdf.data && quotation.quotationPdf.data.$binary) {
        // Handle MongoDB export format with base64
        try {
          const base64String = quotation.quotationPdf.data.$binary.base64;
          pdfBuffer = Buffer.from(base64String, 'base64');
        } catch (base64Error) {
          console.error('❌ Error decoding base64 PDF:', base64Error);
        }
      }
      pdfFileName = quotation.quotationPdf.fileName || quotation.quotationPdf || pdfFileName;
      contentType = quotation.quotationPdf.contentType || 'application/pdf';
      if (pdfBuffer && pdfBuffer.length > 0) {
        console.log(`✅ PDF buffer loaded from database (old format), size: ${pdfBuffer.length} bytes`);
      }
    } else {
      console.log('⚠️  No quotationPdfData in database, trying filesystem...');
    }
    
    // Helper function to fetch PDF from Cloudinary
    const fetchCloudinaryPdf = async (cloudinaryUrl) => {
      try {
        console.log('☁️  Fetching PDF from Cloudinary:', cloudinaryUrl);
        const response = await axios.get(cloudinaryUrl, {
          responseType: 'arraybuffer',
          timeout: 30000 // 30 second timeout
        });
        
        const fetchedBuffer = Buffer.from(response.data);
        console.log('✅ PDF fetched from Cloudinary, size:', fetchedBuffer.length, 'bytes');
        return fetchedBuffer;
      } catch (error) {
        console.error('❌ Error fetching PDF from Cloudinary:', error.message);
        throw error;
      }
    };

    // Check for Cloudinary URL (new format)
    if (!pdfBuffer && quotation.quotationPdfCloudinaryUrl) {
      console.log('☁️  PDF stored on Cloudinary');
      console.log('   - Cloudinary URL:', quotation.quotationPdfCloudinaryUrl);
      try {
        pdfBuffer = await fetchCloudinaryPdf(quotation.quotationPdfCloudinaryUrl);
        pdfFileName = `quotation_${quotation.quotationNumber || quotation._id}.pdf`;
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: 'Failed to fetch PDF from Cloudinary',
          error: error.message
        });
      }
    }
    
    // Check if quotationPdf is a Cloudinary URL (starts with http)
    if (!pdfBuffer && quotation.quotationPdf && quotation.quotationPdf.startsWith('http')) {
      console.log('☁️  PDF stored on Cloudinary (URL format)');
      console.log('   - Cloudinary URL:', quotation.quotationPdf);
      try {
        pdfBuffer = await fetchCloudinaryPdf(quotation.quotationPdf);
        pdfFileName = `quotation_${quotation.quotationNumber || quotation._id}.pdf`;
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: 'Failed to fetch PDF from Cloudinary',
          error: error.message
        });
      }
    }
    
    // Fallback to filesystem (old format - backward compatibility)
    if (!pdfBuffer && quotation.quotationPdf && !quotation.quotationPdf.startsWith('http')) {
      const pdfPath = path.join(getQuotationsPath(), quotation.quotationPdf);
      if (fs.existsSync(pdfPath)) {
        console.log('📂 Reading PDF from filesystem (backward compatibility)');
        try {
          pdfBuffer = fs.readFileSync(pdfPath);
          pdfFileName = quotation.quotationPdfFilename || quotation.quotationPdf || pdfFileName;
          console.log(`✅ PDF loaded from filesystem, size: ${pdfBuffer.length} bytes`);
        } catch (readError) {
          console.error('❌ Error reading PDF from filesystem:', readError);
        }
      }
    }
    
    // If still no buffer, return error
    if (!pdfBuffer || pdfBuffer.length === 0) {
      console.log('❌ PDF not found in database, Cloudinary, or filesystem');
      return res.status(404).json({
        success: false,
        message: 'PDF not found on server'
      });
    }

    console.log('📤 Starting PDF download...');

    // Validate PDF buffer
    if (pdfBuffer.length === 0) {
      console.error('❌ PDF Buffer is empty!');
      return res.status(500).json({
        success: false,
        message: 'PDF file is empty or corrupted'
      });
    }
    
    // Check PDF header to ensure it's a valid PDF
    const pdfHeader = pdfBuffer.toString('ascii', 0, 4);
    if (pdfHeader !== '%PDF') {
      console.error('❌ Invalid PDF header detected:', pdfHeader);
      return res.status(500).json({
        success: false,
        message: 'Invalid PDF file format. PDF may be corrupted.',
        detectedHeader: pdfHeader
      });
    }

    // Set appropriate headers and send file (force download)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(pdfFileName)}"`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Quotation PDF download error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   PUT /api/quotation/:id/upload-pdf
// @desc    Upload or update PDF for existing quotation
// @access  Private (Admin/Back Office)
router.put('/:id/upload-pdf', [
  authenticateToken,
  upload.single('quotationPdf')
], async (req, res) => {
  try {
    console.log('=== UPLOAD PDF TO EXISTING QUOTATION ===');
    const { id } = req.params;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'File is required (PDF, DWG, DXF, ZIP, XLSX, XLS)'
      });
    }

    // Find the quotation
    const quotation = await Quotation.findById(id);
    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // ✅ CLOUDINARY: Validate file from memory buffer (no disk access)
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    const fileType = fileExtension.slice(1).toUpperCase();
    const fileSize = req.file.buffer.length;
    
    // Validate file size (50MB limit)
    if (fileSize > 50 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: `File size exceeds 50MB limit. Your file is ${(fileSize / 1024 / 1024).toFixed(2)}MB. Please upload a smaller file.`
      });
    }
    
    // Validate minimum file size
    if (fileSize < 100) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file: File size is too small. Please upload a valid file.'
      });
    }
    
    // Validate PDF header only for PDF files
    if (fileExtension === '.pdf') {
      const pdfHeader = req.file.buffer.slice(0, 4).toString('ascii');
      if (pdfHeader !== '%PDF') {
        return res.status(400).json({
          success: false,
          message: 'Invalid PDF file: File does not have a valid PDF header.'
        });
      }
    }

    // ✅ CLOUDINARY: Upload file directly from memory buffer to Cloudinary
    console.log('☁️  ===== CLOUDINARY: UPLOADING FILE =====');
    console.log('   - Original Filename:', req.file.originalname);
    console.log('   - File Size:', fileSize, 'bytes');
    console.log('   - File Size (MB):', (fileSize / (1024 * 1024)).toFixed(2), 'MB');
    console.log('   - File Type:', fileType);
    console.log('   - Storage: Memory Buffer (direct to Cloudinary)');
    
    let cloudinaryUrl = null;
    let cloudinaryPublicId = null;
    
    if (isCloudinaryConfigured()) {
      try {
        // ✅ Get file buffer directly from memory (no disk read needed)
        const fileBuffer = req.file.buffer;
        
        // Delete old file from Cloudinary if exists
        if (quotation.quotationPdfCloudinaryPublicId) {
          try {
            const { deleteFileFromCloudinary } = require('../services/cloudinaryService');
            await deleteFileFromCloudinary(quotation.quotationPdfCloudinaryPublicId);
            console.log('🗑️  Old file deleted from Cloudinary');
          } catch (deleteError) {
            console.warn('⚠️  Could not delete old file from Cloudinary:', deleteError.message);
          }
        }
        
        // Upload to Cloudinary directly from memory buffer
        console.log(`📤 Uploading ${fileType} file directly to Cloudinary from memory...`);
        const cloudinaryResult = await uploadFileToCloudinary(
          fileBuffer,
          req.file.originalname,
          'quotations'
        );
        
        cloudinaryUrl = cloudinaryResult.url;
        cloudinaryPublicId = cloudinaryResult.public_id;
        
        console.log(`✅ CLOUDINARY: ${fileType} FILE UPLOADED SUCCESSFULLY!`);
        console.log('   - Cloudinary URL:', cloudinaryUrl);
        console.log('   - Public ID:', cloudinaryPublicId);
        console.log('   - Secure URL:', cloudinaryResult.secure_url);
        console.log('   ✅ File uploaded directly to Cloudinary (no local storage)');
        
      } catch (cloudinaryError) {
        console.error('❌ CLOUDINARY UPLOAD ERROR:', cloudinaryError.message);
        console.error('   Error details:', cloudinaryError);
        throw new Error(`Cloudinary upload failed: ${cloudinaryError.message}`);
      }
    } else {
      console.error('❌ CLOUDINARY: Not configured!');
      console.error('   Please set CLOUD_NAME, CLOUD_KEY, and CLOUD_SECRET in .env file');
      throw new Error('Cloudinary is not configured. Please configure Cloudinary in .env file.');
    }

    // ✅ Update quotation with Cloudinary URL
    quotation.quotationPdf = cloudinaryUrl; // Store Cloudinary URL
    quotation.quotationPdfFilename = req.file.originalname; // Store original filename
    quotation.quotationPdfCloudinaryUrl = cloudinaryUrl; // Store Cloudinary URL separately
    quotation.quotationPdfCloudinaryPublicId = cloudinaryPublicId; // For future deletion
    // Note: quotationPdfData (Buffer) is deprecated - files are stored on Cloudinary
    quotation.updatedAt = new Date();
    await quotation.save();

    console.log('✅ Quotation file updated successfully!');
    console.log('   - Storage: ☁️  Cloudinary ✅');
    console.log('   - Cloudinary URL:', cloudinaryUrl);
    console.log('   - Public ID:', cloudinaryPublicId);

    res.json({
      success: true,
      message: 'PDF uploaded successfully',
      quotation: quotation
    });

  } catch (error) {
    console.error('Upload PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   PUT /api/quotation/:id/pricing
// @desc    Update quotation pricing for individual items
// @access  Private (Admin/Back Office)
router.put('/:id/pricing', authenticateToken, [
  body('items').isArray({ min: 1 }).withMessage('Items array is required'),
  body('items.*.unitPrice').isNumeric().withMessage('Unit price must be a number'),
  body('items.*.totalPrice').isNumeric().withMessage('Total price must be a number')
], async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;
    
    console.log('=== UPDATE QUOTATION PRICING ===');
    console.log('Quotation ID:', id);
    console.log('Items to update:', items);
    
    // Check if user is admin/backoffice
    if (!['admin', 'backoffice', 'subadmin'].includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }
    
    // Find the quotation
    const quotation = await Quotation.findById(id);
    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }
    
    // Update items with pricing
    const updatedItems = quotation.items.map((item, index) => {
      const newItem = items[index];
      if (newItem) {
        return {
          ...item,
          unitPrice: parseFloat(newItem.unitPrice) || 0,
          totalPrice: parseFloat(newItem.totalPrice) || 0
        };
      }
      return item;
    });
    
    // Calculate new total amount
    const newTotalAmount = updatedItems.reduce((total, item) => total + (item.totalPrice || 0), 0);
    
    // Update quotation
    quotation.items = updatedItems;
    quotation.totalAmount = newTotalAmount;
    quotation.updatedAt = new Date();
    
    await quotation.save();
    
    console.log('Quotation pricing updated successfully');
    console.log('New total amount:', newTotalAmount);
    
    res.json({
      success: true,
      message: 'Quotation pricing updated successfully',
      quotation: quotation
    });
    
  } catch (error) {
    console.error('Update quotation pricing error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/quotation/:id/verify-pdf
// @desc    Verify if PDF is stored in database (for debugging)
// @access  Private (Admin/Back Office)
router.get('/:id/verify-pdf', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is admin
    const isAdmin = ['admin', 'backoffice', 'subadmin'].includes(req.userRole);
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const quotation = await Quotation.findById(id);
    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // Query directly to get Buffer fields (bypass toJSON)
    const quotationWithData = await Quotation.findById(id)
      .select('quotationPdf quotationPdfData quotationPdfFilename quotationPdfBuffer quotationPdfContentType')
      .lean();

    const hasPdfData = !!(quotationWithData.quotationPdfData);
    const hasPdfBuffer = !!(quotationWithData.quotationPdfBuffer);
    const pdfDataSize = quotationWithData.quotationPdfData ? quotationWithData.quotationPdfData.length : 0;
    const pdfBufferSize = quotationWithData.quotationPdfBuffer ? quotationWithData.quotationPdfBuffer.length : 0;

    res.json({
      success: true,
      quotationId: id,
      quotationNumber: quotation.quotationNumber,
      pdfStorage: {
        hasQuotationPdfData: hasPdfData,
        quotationPdfDataSize: pdfDataSize,
        hasQuotationPdfBuffer: hasPdfBuffer,
        quotationPdfBufferSize: pdfBufferSize,
        quotationPdfFilename: quotationWithData.quotationPdfFilename,
        quotationPdfString: quotationWithData.quotationPdf,
        quotationPdfContentType: quotationWithData.quotationPdfContentType,
        storedInDatabase: hasPdfData || hasPdfBuffer,
        recommendation: hasPdfData || hasPdfBuffer 
          ? 'PDF is stored in database ✅' 
          : 'PDF is NOT stored in database - only filename exists ⚠️'
      }
    });

  } catch (error) {
    console.error('Verify PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;