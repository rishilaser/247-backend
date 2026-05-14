const cloudinary = require('../config/cloudinary');
const fs = require('fs');

/**
 * Upload file to Cloudinary (supports all file types: PDF, DWG, DXF, ZIP, XLSX, XLS, etc.)
 * @param {Buffer|String} fileData - File buffer or file path
 * @param {String} originalName - Original filename
 * @param {String} folder - Cloudinary folder (optional)
 * @returns {Promise<Object>} Cloudinary upload result with URL
 */
const uploadFileToCloudinary = async (fileData, originalName, folder = 'uploads') => {
  try {
    let buffer;
    
    // If fileData is a path, read the file
    if (typeof fileData === 'string' && fs.existsSync(fileData)) {
      buffer = fs.readFileSync(fileData);
    } else if (Buffer.isBuffer(fileData)) {
      buffer = fileData;
    } else {
      throw new Error('Invalid file data provided');
    }

    const fileExtension = require('path').extname(originalName).toLowerCase().slice(1) || 'file';
    const fileType = fileExtension.toUpperCase();
    
    console.log('\n📤 Uploading file to Cloudinary:');
    console.log('   File Name:', originalName);
    console.log('   File Type:', fileType);
    console.log('   File Size:', (buffer.length / 1024 / 1024).toFixed(2), 'MB');

    // Upload to Cloudinary
    const uploadPromise = new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw', // Use 'raw' for all file types (PDF, DWG, DXF, ZIP, XLSX, XLS, etc.)
          folder: folder,
          public_id: `${folder}_${Date.now()}_${Math.round(Math.random() * 1E9)}`,
          format: fileExtension, // Preserve original file format
          filename_override: originalName,
          context: {
            original_filename: originalName,
            file_type: fileType,
            uploaded_at: new Date().toISOString()
          }
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
      uploadStream.end(buffer);
    });

    const result = await uploadPromise;

    console.log(`   ✅ ${fileType} File Upload Successful!`);
    console.log('   Public ID:', result.public_id);
    console.log('   URL:', result.secure_url);
    console.log('   Format:', result.format || fileExtension);
    console.log('   Size:', (result.bytes / 1024 / 1024).toFixed(2), 'MB\n');

    return {
      success: true,
      url: result.secure_url,
      public_id: result.public_id,
      bytes: result.bytes,
      format: result.format,
      originalName: originalName
    };

  } catch (error) {
    console.error('   ❌ Cloudinary Upload Failed!');
    console.error('   Error:', error.message);
    console.log('');
    throw error;
  }
};

/**
 * Delete file from Cloudinary
 * @param {String} publicId - Cloudinary public ID
 * @returns {Promise<Object>} Deletion result
 */
const deleteFileFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'raw'
    });

    if (result.result === 'ok') {
      console.log('✅ File deleted from Cloudinary:', publicId);
      return { success: true };
    } else {
      console.log('⚠️  File not found in Cloudinary:', publicId);
      return { success: false, message: 'File not found' };
    }
  } catch (error) {
    console.error('❌ Error deleting file from Cloudinary:', error.message);
    throw error;
  }
};

/**
 * Check if Cloudinary is configured
 * @returns {boolean}
 */
const isCloudinaryConfigured = () => {
  return !!(
    process.env.CLOUD_NAME &&
    process.env.CLOUD_KEY &&
    process.env.CLOUD_SECRET
  );
};

// Keep uploadPdfToCloudinary and deletePdfFromCloudinary for backward compatibility
const uploadPdfToCloudinary = uploadFileToCloudinary;
const deletePdfFromCloudinary = deleteFileFromCloudinary;

module.exports = {
  uploadFileToCloudinary, // ✅ New: Supports all file types
  uploadPdfToCloudinary, // ✅ Backward compatibility
  deleteFileFromCloudinary, // ✅ New: Supports all file types
  deletePdfFromCloudinary, // ✅ Backward compatibility
  isCloudinaryConfigured
};

