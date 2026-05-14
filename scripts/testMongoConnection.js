/**
 * Test MongoDB Connection Script
 * Run this to diagnose MongoDB connection issues
 * 
 * Usage: node scripts/testMongoConnection.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const testConnection = async () => {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://abhishekm:ouRpXr0E4NnlT7Me@cluster0.mwqeffk.mongodb.net/komacut?retryWrites=true&w=majority';
    
    console.log('🔍 MongoDB Connection Test');
    console.log('========================\n');
    
    // Mask password in URI
    const maskedURI = MONGODB_URI.replace(/:[^:@]+@/, ':***@');
    console.log('📋 Connection String:', maskedURI);
    console.log('📋 From .env file:', process.env.MONGODB_URI ? '✅ Yes' : '❌ No (using fallback)');
    console.log('');
    
    console.log('🔄 Attempting to connect...');
    
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      maxPoolSize: 10,
      minPoolSize: 5,
      retryWrites: true,
      retryReads: true,
    });
    
    console.log('✅ Successfully connected to MongoDB!');
    console.log('📊 Connection Details:');
    console.log('   - Host:', mongoose.connection.host);
    console.log('   - Port:', mongoose.connection.port);
    console.log('   - Database:', mongoose.connection.name);
    console.log('   - Ready State:', mongoose.connection.readyState);
    console.log('');
    
    // Test a simple query
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('📁 Collections found:', collections.length);
    collections.forEach(col => {
      console.log(`   - ${col.name}`);
    });
    
    await mongoose.disconnect();
    console.log('\n✅ Connection test completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Connection failed!');
    console.error('📋 Error Details:');
    console.error('   - Name:', error.name);
    console.error('   - Message:', error.message);
    console.error('   - Code:', error.code);
    console.error('');
    
    // Provide specific troubleshooting based on error
    if (error.name === 'MongooseServerSelectionError') {
      console.log('🔧 Troubleshooting Steps:');
      console.log('1. Check MongoDB Atlas cluster status');
      console.log('2. Verify your IP address is whitelisted in MongoDB Atlas:');
      console.log('   - Go to Network Access in MongoDB Atlas');
      console.log('   - Add your current IP or use 0.0.0.0/0 (less secure)');
      console.log('3. Check if cluster is paused (free tier clusters pause after inactivity)');
      console.log('4. Verify connection string username and password');
      console.log('5. Check internet connection');
    } else if (error.name === 'MongoAuthenticationError') {
      console.log('🔧 Authentication Error:');
      console.log('1. Verify username and password in connection string');
      console.log('2. Check if user exists in MongoDB Atlas');
      console.log('3. Verify user has proper permissions');
    } else {
      console.log('🔧 General Troubleshooting:');
      console.log('1. Check MongoDB Atlas dashboard');
      console.log('2. Verify connection string format');
      console.log('3. Check network connectivity');
      console.log('4. Review MongoDB Atlas logs');
    }
    
    process.exit(1);
  }
};

// Run test
testConnection();

