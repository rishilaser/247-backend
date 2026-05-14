const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function createBackOfficeUser() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/komacut');
    console.log('Connected to MongoDB');

    // Create Back Office Admin User
    const backOfficeUser = new User({
      email: 'admin@komacut.com',
      firstName: 'Back Office',
      lastName: 'Admin',
      phoneNumber: '+919876543210',
      companyName: 'Komacut',
      department: 'Other',
      country: 'India',
      password: 'admin123',
      role: 'admin',
      isActive: true
    });

    await backOfficeUser.save();
    console.log('✅ Back Office Admin User created successfully!');
    console.log('📧 Email: admin@komacut.com');
    console.log('🔑 Password: admin123');
    console.log('👤 Role: admin');

    // Create Back Office Staff User
    const backOfficeStaff = new User({
      email: 'staff@komacut.com',
      firstName: 'Back Office',
      lastName: 'Staff',
      phoneNumber: '+919876543211',
      companyName: 'Komacut',
      department: 'Other',
      country: 'India',
      password: 'staff123',
      role: 'backoffice',
      isActive: true
    });

    await backOfficeStaff.save();
    console.log('✅ Back Office Staff User created successfully!');
    console.log('📧 Email: staff@komacut.com');
    console.log('🔑 Password: staff123');
    console.log('👤 Role: backoffice');

    // Verify users
    const adminUser = await User.findOne({ email: 'admin@komacut.com' });
    const staffUser = await User.findOne({ email: 'staff@komacut.com' });
    
    console.log('\n🔍 Verification:');
    console.log('Admin User ID:', adminUser._id);
    console.log('Staff User ID:', staffUser._id);

    mongoose.connection.close();
    console.log('\n🎉 Back Office users ready for login!');
    
  } catch (error) {
    console.error('❌ Error creating Back Office users:', error);
    mongoose.connection.close();
  }
}

createBackOfficeUser();
