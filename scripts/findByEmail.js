const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const User = require('../models/User');

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/findByEmail.js <email>');
  process.exit(1);
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const user = await User.findOne({ email: String(email).toLowerCase() }).select('-password');
    console.log(user || 'User not found');
  } catch (err) {
    console.error('Error finding user:', err);
  } finally {
    process.exit(0);
  }
})();
