/**
 * Test Cloudinary Connection
 * Run this script to verify Cloudinary configuration
 * Usage: node scripts/testCloudinaryConnection.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const cloudinary = require('cloudinary').v2;

console.log('\n🔍 ===== TESTING CLOUDINARY CONNECTION =====\n');

// Check environment variables
console.log('📋 Environment Variables:');
console.log('   - CLOUD_NAME:', process.env.CLOUD_NAME || '❌ NOT SET');
console.log('   - CLOUD_KEY:', process.env.CLOUD_KEY ? `***${process.env.CLOUD_KEY.slice(-4)}` : '❌ NOT SET');
console.log('   - CLOUD_SECRET:', process.env.CLOUD_SECRET ? `***${process.env.CLOUD_SECRET.slice(-4)}` : '❌ NOT SET');
console.log('');

// Configure Cloudinary
if (process.env.CLOUD_NAME && process.env.CLOUD_KEY && process.env.CLOUD_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_KEY,
    api_secret: process.env.CLOUD_SECRET
  });

  console.log('✅ Cloudinary configuration loaded');
  console.log('   - Cloud Name:', process.env.CLOUD_NAME);
  console.log('');

  // Test connection by getting account details
  console.log('🔌 Testing Cloudinary connection...');
  cloudinary.api.ping((error, result) => {
    if (error) {
      console.error('❌ CLOUDINARY CONNECTION FAILED!');
      console.error('   Error:', error.message);
      console.error('   Details:', error);
      console.log('\n🔧 Troubleshooting:');
      console.log('   1. Check if your Cloudinary credentials are correct');
      console.log('   2. Verify your API key and secret are valid');
      console.log('   3. Check your internet connection');
      console.log('   4. Make sure there are no extra spaces in .env file');
      process.exit(1);
    } else {
      console.log('✅ CLOUDINARY CONNECTION SUCCESSFUL!');
      console.log('   - Status:', result.status);
      console.log('   - Service:', result.service);
      console.log('\n✅ Cloudinary is properly configured and ready to use!');
      console.log('   All PDFs will be uploaded directly to Cloudinary ☁️\n');
      process.exit(0);
    }
  });
} else {
  console.error('❌ CLOUDINARY NOT CONFIGURED!');
  console.error('\n📝 Please add these to your .env file (lines 65-67):');
  console.error('   CLOUD_NAME=your-cloud-name');
  console.error('   CLOUD_KEY=your-api-key');
  console.error('   CLOUD_SECRET=your-api-secret');
  console.error('\n💡 Make sure:');
  console.error('   - No spaces around the = sign');
  console.error('   - No quotes around the values');
  console.error('   - .env file is in the Comcate_Backend directory\n');
  process.exit(1);
}

