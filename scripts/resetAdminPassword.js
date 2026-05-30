const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');

const newPwd = process.argv[2];
if (!newPwd) {
  console.error('Usage: node scripts/resetAdminPassword.js <newPassword>');
  process.exit(1);
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const hashed = await bcrypt.hash(newPwd, 10);
    const user = await User.findOneAndUpdate(
      { email: 'admin@247cutbend.in' },
      { $set: { password: hashed } },
      { new: true }
    );
    if (user) console.log('Password reset for', user.email);
    else console.log('Admin user not found');
  } catch (err) {
    console.error('Error resetting password:', err);
  } finally {
    process.exit(0);
  }
})();
