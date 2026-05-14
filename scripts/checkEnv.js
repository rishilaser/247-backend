// Check .env file configuration
require('dotenv').config();

console.log('\n📋 Environment Variables Check:\n');
console.log('Port Configuration:');
console.log('   PORT:', process.env.PORT || 'NOT SET (will use default 5000)');
console.log('');

console.log('Cloudinary Configuration:');
console.log('   CLOUD_NAME:', process.env.CLOUD_NAME || 'NOT SET');
console.log('   CLOUD_KEY:', process.env.CLOUD_KEY ? (process.env.CLOUD_KEY.substring(0, 15) + '...') : 'NOT SET');
console.log('   CLOUD_SECRET:', process.env.CLOUD_SECRET ? '✅ SET' : 'NOT SET');
console.log('');

// Check if .env is being loaded
if (process.env.CLOUD_NAME) {
  console.log('✅ .env file is being loaded correctly!');
} else {
  console.log('⚠️  .env file might not be loaded or CLOUD_NAME is missing');
}
console.log('');

