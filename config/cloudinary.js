// Ensure dotenv is loaded first
require('dotenv').config();

const { v2: cloudinary } = require('cloudinary');

// Cloudinary Configuration - Read from .env or use defaults
const cloudName = process.env.CLOUD_NAME || "dxbtm04lh";
const apiKey = process.env.CLOUD_KEY || "qLTD7es8-c52KS5MbIpnDekpyt4";
const apiSecret = process.env.CLOUD_SECRET || "qLTD7es8-c52KS5MbIpnDekpyt4";

// Log what we're using
console.log('\n📦 Cloudinary Configuration:');
console.log('   Cloud Name:', cloudName);
console.log('   API Key:', apiKey ? (apiKey.substring(0, 10) + '...') : 'NOT SET');
console.log('   API Secret:', apiSecret ? '***SET***' : 'NOT SET');
console.log('   Source:', process.env.CLOUD_NAME ? 'Environment (.env)' : 'Default (hardcoded)');

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret
});

// Test Cloudinary Connection
const testCloudinaryConnection = async () => {
  try {
    // Test connection by getting account usage details (better than ping)
    const result = await cloudinary.api.usage();
    console.log('   ✅ Cloudinary Connected Successfully!');
    console.log('   Plan:', result.plan || 'Free');
    console.log('   Status: Ready for uploads\n');
    return true;
  } catch (error) {
    console.error('   ❌ Cloudinary Connection Failed!');
    
    // Check error type
    if (error.error && error.error.http_code === 401) {
      console.error('   ⚠️  Authentication Failed - Invalid API Key or Secret');
      console.error('   📝 Steps to fix:');
      console.error('      1. Go to: https://console.cloudinary.com/console');
      console.error('      2. Login to your account');
      console.error('      3. Go to Settings → Security');
      console.error('      4. Copy the correct API Key and API Secret');
      console.error('      5. Update your .env file with correct values');
      console.error('');
      console.error('   📋 Your .env file should have:');
      console.error('      CLOUD_NAME=dxbtm04lh');
      console.error('      CLOUD_KEY=your_actual_api_key');
      console.error('      CLOUD_SECRET=your_actual_api_secret');
    } else {
      console.error('   Error Message:', error.message || 'Unknown error');
      if (error.error) {
        console.error('   HTTP Code:', error.error.http_code);
        console.error('   Error:', error.error.message);
      }
    }
    
    // Check if credentials are missing
    if (!cloudName || !apiKey || !apiSecret) {
      console.error('');
      console.error('   ⚠️  Missing credentials! Check your .env file');
      console.error('   Required: CLOUD_NAME, CLOUD_KEY, CLOUD_SECRET');
    }
    console.log('');
    return false;
  }
};

// Export cloudinary and test function
module.exports = cloudinary;
module.exports.testConnection = testCloudinaryConnection;

