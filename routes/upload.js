const express = require('express');
const multer = require('multer');
const cloudinary = require('../config/cloudinary');

const router = express.Router();

// Configure multer to use memory storage (for Cloudinary)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit for PDFs
  },
  fileFilter: (req, file, cb) => {
    // Accept only PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Upload PDF to Cloudinary
router.post('/upload-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded' 
      });
    }

    console.log('\n📤 Cloudinary Upload Started:');
    console.log('   File Name:', req.file.originalname);
    console.log('   File Size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('   MIME Type:', req.file.mimetype);

    // Upload to Cloudinary using upload_stream
    const uploadPromise = new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          folder: 'pdfs', // Optional: organize files in a folder
          public_id: `pdf_${Date.now()}_${Math.round(Math.random() * 1E9)}`,
        },
        (error, uploadResult) => {
          if (error) {
            reject(error);
          } else {
            resolve(uploadResult);
          }
        }
      );

      // Write the buffer to the stream
      uploadStream.end(req.file.buffer);
    });

    const result = await uploadPromise;

    console.log('   ✅ Upload Successful!');
    console.log('   Public ID:', result.public_id);
    console.log('   URL:', result.secure_url);
    console.log('   Size:', (result.bytes / 1024 / 1024).toFixed(2), 'MB\n');

    res.json({
      success: true,
      url: result.secure_url,
      public_id: result.public_id,
      bytes: result.bytes,
      format: result.format
    });

  } catch (error) {
    console.error('   ❌ Cloudinary Upload Failed!');
    console.error('   Error:', error.message);
    console.log('');
    
    // Handle file size limit error
    if (error.message && error.message.includes('File too large')) {
      return res.status(413).json({
        success: false,
        error: 'File size exceeds 5MB limit. Please upload a smaller PDF file.'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to upload PDF to Cloudinary'
    });
  }
});

// Delete PDF from Cloudinary (optional endpoint)
router.delete('/delete-pdf/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;
    
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'raw'
    });

    if (result.result === 'ok') {
      res.json({
        success: true,
        message: 'PDF deleted successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'PDF not found'
      });
    }
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete PDF'
    });
  }
});

module.exports = router;

