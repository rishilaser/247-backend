const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const User = require('../models/User');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const user = await User.findOne({ email: 'admin@247cutbend.in' }).select('-password');
    console.log(user || 'Admin user not found');
  } catch (err) {
    console.error('Error finding admin:', err);
  } finally {
    process.exit(0);
  }
})();
