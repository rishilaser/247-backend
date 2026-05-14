const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function changeUserRole() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/komacut');
    console.log('Connected to MongoDB');

    // Example: Change user role
    const email = 'dinesh@example.com'; // Change this email
    const newRole = 'backoffice'; // Change to: customer, backoffice, or admin

    const user = await User.findOne({ email: email });
    
    if (!user) {
      console.log('❌ User not found with email:', email);
      return;
    }

    console.log('👤 Current User Details:');
    console.log('Name:', user.firstName, user.lastName);
    console.log('Email:', user.email);
    console.log('Current Role:', user.role);

    // Update role
    user.role = newRole;
    await user.save();

    console.log('✅ Role updated successfully!');
    console.log('New Role:', user.role);
    console.log('\n🔄 Next Steps:');
    console.log('1. Logout from current session');
    console.log('2. Login again with same credentials');
    console.log('3. Check navigation for new menu items');

    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error changing user role:', error);
    mongoose.connection.close();
  }
}

changeUserRole();
