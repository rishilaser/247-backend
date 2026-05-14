const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const createSubAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/comcat', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB');

    // Create a sample sub-admin
    const subAdminData = {
      email: 'subadmin@example.com',
      firstName: 'John',
      lastName: 'Doe',
      phoneNumber: '0000000000',
      companyName: 'Sub-Admin Company',
      department: 'Engineering',
      country: 'India',
      address: {
        street: '',
        city: '',
        state: '',
        zipCode: '',
        country: 'India'
      },
      password: 'TestPass123!',
      role: 'subadmin',
      permissions: {
        canCreateQuotations: true,
        canManageUsers: false,
        canViewAllInquiries: true,
        canManageOrders: false
      }
    };

    // Check if sub-admin already exists
    const existingUser = await User.findOne({ email: subAdminData.email });
    if (existingUser) {
      console.log('Sub-admin already exists with email:', subAdminData.email);
      return;
    }

    // Create the sub-admin
    const subAdmin = new User(subAdminData);
    await subAdmin.save();

    console.log('Sub-admin created successfully:');
    console.log('Email:', subAdmin.email);
    console.log('Name:', subAdmin.firstName, subAdmin.lastName);
    console.log('Role:', subAdmin.role);
    console.log('Permissions:', subAdmin.permissions);

  } catch (error) {
    console.error('Error creating sub-admin:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

// Run the script
createSubAdmin();
