// Test Cloudinary Connection Script
require('dotenv').config();
const cloudinary = require('../config/cloudinary');

console.log('\n🧪 Testing Cloudinary Connection...\n');

// Check environment variables
console.log('📋 Environment Variables Check:');
console.log('   CLOUD_NAME:', process.env.CLOUD_NAME || '❌ NOT SET');
console.log('   CLOUD_KEY:', process.env.CLOUD_KEY ? (process.env.CLOUD_KEY.substring(0, 10) + '...') : '❌ NOT SET');
console.log('   CLOUD_SECRET:', process.env.CLOUD_SECRET ? '✅ SET' : '❌ NOT SET');
console.log('');

// Test connection
const { testConnection } = require('../config/cloudinary');
testConnection()
  .then((success) => {
    if (success) {
      console.log('✅ Cloudinary is ready to use!');
      process.exit(0);
    } else {
      console.log('❌ Cloudinary connection failed. Please check your credentials.');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });

