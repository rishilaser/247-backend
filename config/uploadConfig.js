const path = require('path');
const fs = require('fs');

/**
 * Upload Configuration for VPS Deployment
 * Ensures uploads folder persists and is accessible on live server
 */

// Use absolute path that works on both local and VPS
const getUploadsBasePath = () => {
  // Option 1: Use process.cwd() for VPS (more reliable)
  const basePath = process.env.UPLOADS_BASE_PATH || process.cwd();
  
  // Option 2: Use __dirname (current file location)
  // const basePath = __dirname;
  
  return path.join(basePath, 'uploads');
};

// Create uploads directory structure
const ensureUploadsDirectories = () => {
  const uploadsBase = getUploadsBasePath();
  const directories = [
    uploadsBase,
    path.join(uploadsBase, 'quotations'),
    path.join(uploadsBase, 'inquiries')
  ];

  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ Created uploads directory: ${dir}`);
    } else {
      console.log(`✅ Uploads directory exists: ${dir}`);
    }
  });

  return uploadsBase;
};

// Get absolute paths for different upload types
const getQuotationsPath = () => {
  return path.join(getUploadsBasePath(), 'quotations');
};

const getInquiriesPath = () => {
  return path.join(getUploadsBasePath(), 'inquiries');
};

// Verify uploads directory is writable
const verifyUploadsPermissions = () => {
  const uploadsBase = getUploadsBasePath();
  const testFile = path.join(uploadsBase, '.test-write');
  
  try {
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log('✅ Uploads directory is writable');
    return true;
  } catch (error) {
    console.error('❌ Uploads directory is NOT writable:', error.message);
    console.error('   Please check permissions on:', uploadsBase);
    return false;
  }
};

module.exports = {
  getUploadsBasePath,
  ensureUploadsDirectories,
  getQuotationsPath,
  getInquiriesPath,
  verifyUploadsPermissions
};

