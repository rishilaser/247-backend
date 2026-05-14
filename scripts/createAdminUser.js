const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const createAdminUser = async () => {
  try {
    // Get MongoDB URI from environment variable
    const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/komacut';
    
    // Debug: Show what connection string is being used (mask password for security)
    const maskedURI = MONGODB_URI.replace(/:([^:@]+)@/, ':***@');
    console.log('🔍 Using MongoDB URI:', maskedURI);
    console.log('📁 .env file path:', path.join(__dirname, '../.env'));
    console.log('📋 MONGODB_URI from env:', process.env.MONGODB_URI ? '✅ Found' : '❌ Not found');
    console.log('📋 DATABASE_URL from env:', process.env.DATABASE_URL ? '✅ Found' : '❌ Not found');
    
    if (!process.env.MONGODB_URI && !process.env.DATABASE_URL) {
      console.warn('⚠️  Warning: No MONGODB_URI or DATABASE_URL found in .env file. Using fallback.');
    }
    
    // Connect to MongoDB
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Connected to MongoDB');

    // Hash password
    const hashedPassword = await bcrypt.hash('admin123', 10);

    // Create admin user
    const adminUser = new User({
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@247cutbend.com',
      password: hashedPassword,
      phoneNumber: '9876543210',
      companyName: '247 Cutbend',
      department: 'Other',
      country: 'India',
      role: 'admin',
      isActive: true
    });

    await adminUser.save();
    console.log('✅ Admin user created successfully!');
    console.log('Email: admin@247cutbend.com');
    console.log('Password: admin123');
    console.log('Role: admin');

  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    process.exit(0);
  }
};

createAdminUser();