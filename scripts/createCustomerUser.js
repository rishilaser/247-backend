const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://damsole:Damsole@cluster0.mwqeffk.mongodb.net/komacut?retryWrites=true&w=majority', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function createCustomerUser() {
  try {
    console.log('👤 Creating Customer User...\n');

    // Check if customer user already exists
    const existingCustomer = await User.findOne({ email: 'customer@example.com' });
    
    if (existingCustomer) {
      console.log('✅ Customer user already exists:');
      console.log(`   Email: ${existingCustomer.email}`);
      console.log(`   Role: ${existingCustomer.role}`);
      console.log(`   Name: ${existingCustomer.firstName} ${existingCustomer.lastName}\n`);
      
      console.log('🔑 Login Credentials:');
      console.log('   Email: customer@example.com');
      console.log('   Password: password123\n');
      
      console.log('🌐 Access URL:');
      console.log('   http://localhost:3000/dashboard\n');
      
      return;
    }

    // Create customer user - let the User model handle password hashing
    const customerUser = new User({
      firstName: 'John',
      lastName: 'Doe',
      email: 'customer@example.com',
      password: 'password123', // Let the pre-save hook hash this
      role: 'customer',
      phoneNumber: '+1234567890',
      companyName: 'Test Company',
      country: 'India',
      department: 'Engineering',
      isActive: true
    });

    await customerUser.save();

    console.log('✅ Customer user created successfully!');
    console.log(`   Email: ${customerUser.email}`);
    console.log(`   Role: ${customerUser.role}`);
    console.log(`   Name: ${customerUser.firstName} ${customerUser.lastName}\n`);
    
    console.log('🔑 Login Credentials:');
    console.log('   Email: customer@example.com');
    console.log('   Password: password123\n');
    
    console.log('🌐 Access URL:');
    console.log('   http://localhost:3000/dashboard\n');
    
    console.log('📋 Customer Features:');
    console.log('   ✅ Inquiry Submission');
    console.log('   ✅ Quotation Viewing');
    console.log('   ✅ Order Tracking');
    console.log('   ✅ Payment Processing');
    console.log('   ✅ Order History\n');

  } catch (error) {
    console.error('❌ Error creating customer user:', error.message);
  } finally {
    mongoose.connection.close();
  }
}

createCustomerUser();
