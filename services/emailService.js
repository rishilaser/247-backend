const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const axios = require('axios');
const archiver = require('archiver');
const {
  resolveInquiryFileNameWithCloudinary,
  uniquifyZipEntryNames,
} = require('../utils/inquiryFileName');

/** Calendar year for email footers (evaluated when each email HTML is built). */
const getEmailCopyrightYear = () => new Date().getFullYear();

// Create transporter
const createTransporter = () => {
  console.log('=== EMAIL SERVICE CONFIGURATION ===');
  console.log('SMTP_HOST:', process.env.SMTP_HOST || 'smtp.gmail.com');
  console.log('SMTP_PORT:', process.env.SMTP_PORT || 587);
  console.log('SMTP_USER:', process.env.SMTP_USER ? '✓ Configured' : '✗ Missing');
  console.log('SMTP_PASS:', process.env.SMTP_PASS ? '✓ Configured' : '✗ Missing');
  console.log('SMTP_FROM:', process.env.SMTP_FROM || 'noreply@247cutbend.com');
  console.log('BACKOFFICE_EMAIL:', process.env.BACKOFFICE_EMAIL || 'backoffice@247cutbend.com');
  
  // Check if SMTP configuration is available and not placeholder values
  const hasUser = process.env.SMTP_USER && process.env.SMTP_USER !== 'your-email@gmail.com';
  const hasPass = process.env.SMTP_PASS && process.env.SMTP_PASS !== 'your-app-password-here';
  
  if (!hasUser || !hasPass) {
    console.warn('⚠️ SMTP configuration missing. Email service will be disabled.');
    console.warn('Please configure SMTP_USER and SMTP_PASS in .env file');
    console.warn('For Gmail: Enable 2FA and generate App Password from: https://myaccount.google.com/apppasswords');
    return null;
  }
  
  console.log('✅ Email service initialized successfully');
  
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};

// Import SMS service
const { 
  sendInquiryNotificationSMS,
  sendQuotationNotificationSMS,
  sendOrderConfirmationSMS,
  sendDispatchNotificationSMS,
  sendPaymentConfirmationSMS
} = require('./smsService');

// Legacy SMS function for backward compatibility
const sendSMS = async (phoneNumber, message) => {
  try {
    // Use the new SMS service
    const result = await sendInquiryNotificationSMS({ inquiryNumber: 'LEGACY' }, { firstName: 'User', lastName: 'User' });
    console.log(`SMS to ${phoneNumber}: ${message}`);
    return true;
  } catch (error) {
    console.error('SMS sending failed:', error);
    return false;
  }
};

// Send login notification email to customer
const sendLoginNotificationEmail = async (user) => {
  try {
    console.log('=== SENDING LOGIN NOTIFICATION EMAIL ===');
    console.log('User:', user.email);
    console.log('Role:', user.role);
    
    const transporter = createTransporter();
    
    // If no transporter (SMTP not configured), just log and return
    if (!transporter) {
      console.log('SMTP not configured. Login notification email skipped for:', user.email);
      return;
    }
    
    // Only send to customers
    if (user.role !== 'customer') {
      console.log('Login notification email skipped - user is not a customer');
      return;
    }
    
    const customerName = `${user.firstName} ${user.lastName}`.trim() || 'Valued Customer';
    const loginTime = new Date().toLocaleString();
    const loginDate = new Date().toLocaleDateString();
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: user.email,
      subject: 'Login Notification - 247 CutBend',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700;">247 CUTBEND</h1>
            <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">SHEET METAL PARTS ON DEMAND</p>
            <h2 style="margin: 20px 0 10px 0; font-size: 24px; font-weight: 600;">Login Notification</h2>
          </div>
          
          <div style="background-color: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h3 style="color: #333; margin-top: 0;">Dear ${customerName},</h3>
            <p style="color: #555; line-height: 1.6;">We wanted to inform you that someone has successfully logged into your 247 CutBend account.</p>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #4CAF50;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">🔐 Login Details</h3>
              <p style="margin: 8px 0; color: #555;"><strong>Email:</strong> ${user.email}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Login Date:</strong> ${loginDate}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Login Time:</strong> ${loginTime}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Account:</strong> ${user.companyName || 'N/A'}</p>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ffc107;">
              <h3 style="margin-top: 0; color: #333;">⚠️ Security Notice</h3>
              <p style="margin: 0; color: #555; line-height: 1.6;">If you did not perform this login, please:</p>
              <ul style="margin: 10px 0; padding-left: 20px; color: #555;">
                <li>Change your password immediately</li>
                <li>Contact our support team</li>
                <li>Review your account activity</li>
              </ul>
            </div>
            
            <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #2196F3;">
              <h3 style="margin-top: 0; color: #333;">💡 Quick Actions</h3>
              <ul style="margin: 10px 0; padding-left: 20px; color: #555;">
                <li>View your recent inquiries and quotations</li>
                <li>Track your orders</li>
                <li>Update your profile information</li>
                <li>Submit new inquiries</li>
              </ul>
            </div>
            
            <p style="margin-top: 30px; color: #555;">Thank you for choosing 247 CutBend for your sheet metal manufacturing needs. We're here to help!</p>
          </div>
          
          <div style="background-color: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px;">
            <p style="margin: 0 0 5px 0;">© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
            <p style="margin: 0; opacity: 0.8;">Delivering Factory Direct Quality Sheet Metal Parts Since 2005</p>
          </div>
        </div>
      `
    };

    console.log('Sending login notification email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Login notification email sent successfully!');
    console.log('Message ID:', result.messageId);
    
  } catch (error) {
    console.error('Login notification email failed:', error);
    // Don't throw error, just log it to prevent login from failing
  }
};

// Send welcome email to new customers
const sendWelcomeEmail = async (email, firstName) => {
  try {
    const transporter = createTransporter();
    
    // If no transporter (SMTP not configured), just log and return
    if (!transporter) {
      console.log('SMTP not configured. Welcome email skipped for:', email);
      return;
    }
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: email,
      subject: 'Welcome to 247 CutBend - Your Sheet Metal Manufacturing Partner',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">247 CUTBEND</h1>
            <p style="margin: 5px 0;">SHEET METAL PARTS ON DEMAND</p>
          </div>
          
          <div style="padding: 20px;">
            <h2>Welcome ${firstName}!</h2>
            <p>Thank you for creating your account with 247 CutBend. We're excited to have you as part of our manufacturing community.</p>
            
            <h3>What's Next?</h3>
            <ul>
              <li>Upload your technical drawings (DWG, DXF, ZIP)</li>
              <li>Specify material requirements and quantities</li>
              <li>Receive competitive quotes</li>
              <li>Place orders with confidence</li>
            </ul>
            
            <h3>Our Expertise:</h3>
            <ul>
              <li>Laser Cutting</li>
              <li>Surface Finishing</li>
              <li>Threading & Chamfering</li>
              <li>Sheet Metal Bending</li>
              <li>Laser Engraving</li>
              <li>CNC Turning</li>
            </ul>
            
            <p>If you have any questions, feel free to reach out to our support team.</p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666;">
            <p>© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
            <p>Delivering Factory Direct Quality Sheet Metal Parts Since 2005</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Welcome email sent successfully to:', email);
    
  } catch (error) {
    console.error('Welcome email failed:', error);
    // Don't throw error, just log it to prevent signup from failing
  }
};

// Send inquiry confirmation email to customer
const sendInquiryConfirmationEmail = async (inquiry) => {
  try {
    console.log('=== SENDING INQUIRY CONFIRMATION EMAIL TO CUSTOMER ===');
    console.log('Inquiry:', inquiry.inquiryNumber);
    console.log('Customer:', inquiry.customer?.email);
    
    const transporter = createTransporter();
    
    // If no transporter (SMTP not configured), just log and return
    if (!transporter) {
      console.log('SMTP not configured. Inquiry confirmation email skipped for:', inquiry.customer?.email);
      return;
    }
    
    // Get customer information - handle both populated and unpopulated cases
    let customerInfo = {};
    if (inquiry.customer && typeof inquiry.customer === 'object') {
      if (inquiry.customer.firstName) {
        // Customer is populated
        customerInfo = {
          firstName: inquiry.customer.firstName,
          lastName: inquiry.customer.lastName || '',
          email: inquiry.customer.email || '',
          companyName: inquiry.customer.companyName || ''
        };
      } else {
        // Customer is an ObjectId, we need to fetch it
        try {
          const User = require('../models/User');
          const customer = await User.findById(inquiry.customer);
          if (customer) {
            customerInfo = {
              firstName: customer.firstName || 'Customer',
              lastName: customer.lastName || '',
              email: customer.email || '',
              companyName: customer.companyName || ''
            };
          }
        } catch (fetchError) {
          console.error('Failed to fetch customer data:', fetchError);
          return;
        }
      }
    } else {
      console.error('No customer data found for inquiry:', inquiry._id);
      return;
    }
    
    // Validate customer email
    if (!customerInfo.email || customerInfo.email === 'customer@example.com') {
      console.error('No valid customer email found for inquiry:', inquiry._id);
      return;
    }
    
    const customerName = `${customerInfo.firstName} ${customerInfo.lastName}`.trim() || 'Valued Customer';
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: customerInfo.email,
      subject: `Inquiry ${inquiry.inquiryNumber} Submitted Successfully - 247 CutBend`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #FF9800; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700;">247 CUTBEND</h1>
            <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">SHEET METAL PARTS ON DEMAND</p>
            <h2 style="margin: 20px 0 10px 0; font-size: 24px; font-weight: 600;">Inquiry Submitted Successfully!</h2>
          </div>
          
          <div style="background-color: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h3 style="color: #333; margin-top: 0;">Dear ${customerName},</h3>
            <p style="color: #555; line-height: 1.6;">Thank you for submitting your inquiry. We have received your request and our team will review it shortly.</p>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #FF9800;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">📋 Inquiry Details</h3>
              <p style="margin: 8px 0; color: #555;"><strong>Inquiry Number:</strong> ${inquiry.inquiryNumber}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Status:</strong> Under Review</p>
              <p style="margin: 8px 0; color: #555;"><strong>Submitted Date:</strong> ${new Date(inquiry.createdAt).toLocaleDateString()}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Total Parts:</strong> ${inquiry.parts?.length || 0}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Files Attached:</strong> ${inquiry.files?.length || 0}</p>
            </div>
            
            ${inquiry.parts && inquiry.parts.length > 0 ? `
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #4CAF50;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">🔧 Parts Summary</h3>
              <div style="background-color: white; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <table style="width: 100%; border-collapse: collapse;">
                  <thead>
                    <tr style="background-color: #f5f5f5;">
                      <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Part</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Material</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Thickness</th>
                      <th style="padding: 12px; text-align: right; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${inquiry.parts.slice(0, 10).map(part => `
                      <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 12px; color: #555;">${part.partRef || part.partName || 'N/A'}</td>
                        <td style="padding: 12px; color: #555;">${part.material || 'N/A'}</td>
                        <td style="padding: 12px; color: #555;">${part.thickness || 'N/A'}${part.thickness ? 'mm' : ''}</td>
                        <td style="padding: 12px; text-align: right; color: #555;">${part.quantity || 0}</td>
                      </tr>
                    `).join('')}
                    ${inquiry.parts.length > 10 ? `
                      <tr>
                        <td colspan="4" style="padding: 12px; text-align: center; color: #666; font-style: italic;">
                          ... and ${inquiry.parts.length - 10} more parts
                        </td>
                      </tr>
                    ` : ''}
                  </tbody>
                </table>
              </div>
            </div>
            ` : ''}
            
            ${inquiry.specialInstructions ? `
            <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #2196F3;">
              <h3 style="margin-top: 0; color: #333;">Special Instructions:</h3>
              <p style="margin: 0; color: #555; line-height: 1.6;">${inquiry.specialInstructions}</p>
            </div>
            ` : ''}
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 25px 0;">
              <h3 style="margin-top: 0; color: #333;">What's Next?</h3>
              <ul style="margin: 10px 0; padding-left: 20px; color: #555;">
                <li>Our team will review your inquiry and technical drawings</li>
                <li>You will receive a quotation within 24-48 hours</li>
                <li>You can track your inquiry status by logging into your account</li>
                <li>If you have any questions, please don't hesitate to contact us</li>
              </ul>
            </div>
            
            <p style="margin-top: 30px; color: #555;">Thank you for choosing 247 CutBend for your sheet metal manufacturing needs. We look forward to serving you!</p>
          </div>
          
          <div style="background-color: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px;">
            <p style="margin: 0 0 5px 0;">© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
            <p style="margin: 0; opacity: 0.8;">Delivering Factory Direct Quality Sheet Metal Parts Since 2005</p>
          </div>
        </div>
      `
    };

    console.log('Sending inquiry confirmation email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Inquiry confirmation email sent successfully to customer!');
    console.log('Message ID:', result.messageId);
    
  } catch (error) {
    console.error('Inquiry confirmation email failed:', error);
    // Don't throw error, just log it to prevent inquiry creation from failing
  }
};

// Send inquiry notification to back office
const sendInquiryNotification = async (inquiry) => {
  try {
    console.log('=== SENDING INQUIRY NOTIFICATION EMAIL ===');
    console.log('Creating transporter...');
    
    const transporter = createTransporter();
    
    // If no transporter (SMTP not configured), just log and return
    if (!transporter) {
      console.log('❌ SMTP not configured. Inquiry notification skipped.');
      return;
    }
    
    console.log('✅ Transporter created successfully');

    // Get customer information - handle both populated and unpopulated cases
    let customerInfo = {};
    if (inquiry.customer && typeof inquiry.customer === 'object') {
      if (inquiry.customer.firstName) {
        // Customer is populated
        customerInfo = {
          firstName: inquiry.customer.firstName,
          lastName: inquiry.customer.lastName || '',
          companyName: inquiry.customer.companyName || 'N/A',
          email: inquiry.customer.email || 'N/A',
          phoneNumber: inquiry.customer.phoneNumber || 'N/A'
        };
      } else {
        // Customer is an ObjectId, we need to fetch it
        try {
          const User = require('../models/User');
          const customer = await User.findById(inquiry.customer);
          if (customer) {
            customerInfo = {
              firstName: customer.firstName || 'Unknown',
              lastName: customer.lastName || '',
              companyName: customer.companyName || 'N/A',
              email: customer.email || 'N/A',
              phoneNumber: customer.phoneNumber || 'N/A'
            };
          }
        } catch (fetchError) {
          console.error('Failed to fetch customer data:', fetchError);
          customerInfo = {
            firstName: 'Unknown',
            lastName: '',
            companyName: 'N/A',
            email: 'N/A',
            phoneNumber: 'N/A'
          };
        }
      }
    }
    
    // Initialize attachments array - Attach all original files
    const attachments = [];
    const filesForZip = []; // Store files for ZIP creation
    
    // Download all uploaded files (PDF, DWG, DXF, ZIP, Excel, etc.) for ZIP creation
    if (inquiry.files && inquiry.files.length > 0) {
      console.log(`Processing ${inquiry.files.length} files for email attachment and ZIP creation...`);
      
      for (const file of inquiry.files) {
        try {
          let fileBuffer = null;
          let filePath = file.filePath || file.cloudinaryUrl;
          
          // Check if file is from Cloudinary (URL) or local path
          if (filePath && (filePath.startsWith('http://') || filePath.startsWith('https://'))) {
            // File is in Cloudinary - download it
            console.log(`☁️ Downloading file from Cloudinary: ${file.originalName}`);
            try {
              const response = await axios.get(filePath, {
                responseType: 'arraybuffer',
                timeout: 30000 // 30 second timeout
              });
              fileBuffer = Buffer.from(response.data);
              console.log(`✅ Downloaded from Cloudinary: ${file.originalName}, size: ${fileBuffer.length} bytes`);
            } catch (downloadError) {
              console.error(`❌ Error downloading file from Cloudinary: ${downloadError.message}`);
              continue; // Skip this file and continue with others
            }
          } else if (filePath && fs.existsSync(filePath)) {
            // File is local - read it
            console.log(`📁 Reading local file: ${file.originalName}`);
            fileBuffer = fs.readFileSync(filePath);
            console.log(`✅ Read local file: ${file.originalName}, size: ${fileBuffer.length} bytes`);
          } else {
            console.warn(`⚠️ File not found (neither Cloudinary URL nor local path): ${filePath}`);
            continue; // Skip this file
          }
          
          const downloadName = await resolveInquiryFileNameWithCloudinary(file);
          filesForZip.push({
            name: downloadName,
            buffer: fileBuffer,
          });
          
          console.log(`✅ File prepared for ZIP: ${file.originalName} (${(fileBuffer.length / 1024).toFixed(2)} KB)`);
        } catch (error) {
          console.error(`❌ Error processing file ${file.originalName || 'unknown'}:`, error.message);
          // Continue with other files even if one fails
        }
      }
      
      console.log(`Total files processed: ${filesForZip.length}/${inquiry.files.length}`);
    }
    
    // Create ZIP file containing all inquiry files
    if (filesForZip.length > 0) {
      try {
        console.log(`📦 Creating ZIP file with ${filesForZip.length} files...`);
        
        const zipBuffer = await new Promise((resolve, reject) => {
          const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
          });
          
          const zipBuffers = [];
          
          archive.on('data', (chunk) => {
            zipBuffers.push(chunk);
          });
          
          archive.on('end', () => {
            const zipBuffer = Buffer.concat(zipBuffers);
            console.log(`✅ ZIP file created successfully: ${(zipBuffer.length / 1024).toFixed(2)} KB`);
            resolve(zipBuffer);
          });
          
          archive.on('error', (err) => {
            console.error('❌ Error creating ZIP file:', err);
            reject(err);
          });
          
          const zipEntries = uniquifyZipEntryNames(
            filesForZip.map((file) => ({ downloadName: file.name, buffer: file.buffer }))
          );
          zipEntries.forEach((file) => {
            archive.append(file.buffer, { name: file.downloadName });
          });
          
          // Finalize the archive
          archive.finalize();
        });
        
        // Add ZIP file to attachments
        attachments.push({
          filename: `${inquiry.inquiryNumber}_All_Files.zip`,
          content: zipBuffer,
          contentType: 'application/zip'
        });
        
        console.log(`✅ ZIP file added to email attachments: ${inquiry.inquiryNumber}_All_Files.zip`);
      } catch (zipError) {
        console.error('❌ Failed to create ZIP file:', zipError);
        // Don't fail the email if ZIP creation fails
      }
    }

    // Generate Consolidated Excel file with ALL data
    try {
      console.log('Generating consolidated Excel file with all data...');
      
      // Create workbook
      const wb = xlsx.utils.book_new();
      
      // ========== SHEET 1: Summary ==========
      const summaryData = [
        ['INQUIRY SUMMARY'],
        [],
        ['Inquiry Number:', inquiry.inquiryNumber],
        ['Customer Name:', `${customerInfo.firstName} ${customerInfo.lastName}`],
        ['Company:', customerInfo.companyName],
        ['Email:', customerInfo.email],
        ['Phone:', customerInfo.phoneNumber],
        ['Created Date:', new Date(inquiry.createdAt).toLocaleDateString()],
        ['Total Parts:', inquiry.parts?.length || 0],
        ['Total Files:', inquiry.files?.length || 0],
        ['Total Amount:', `INR ₹${inquiry.totalAmount || 0}`],
        [],
        ['Special Instructions:', inquiry.specialInstructions || 'None']
      ];
      
      const wsSummary = xlsx.utils.aoa_to_sheet(summaryData);
      wsSummary['!cols'] = [{ wch: 20 }, { wch: 40 }];
      xlsx.utils.book_append_sheet(wb, wsSummary, 'Summary');
      
      // ========== SHEET 2: Technical Specifications ==========
      const techSpecData = [];
      techSpecData.push(['Part Name', 'Material', 'Thickness', 'Grade', 'Quantity', 'Price', 'Remarks']);
      
      console.log('Inquiry parts data:', JSON.stringify(inquiry.parts, null, 2));
      console.log('Total parts found:', inquiry.parts?.length || 0);
      
      if (inquiry.parts && inquiry.parts.length > 0) {
        inquiry.parts.forEach((part, index) => {
          console.log(`Adding part ${index + 1}:`, {
            partRef: part.partRef,
            material: part.material,
            thickness: part.thickness,
            grade: part.grade,
            quantity: part.quantity,
            price: part.price,
            remarks: part.remarks
          });
          
          techSpecData.push([
            part.partRef || `Part ${index + 1}`,
            part.material || 'N/A',
            part.thickness || 'N/A',
            part.grade || 'N/A',
            part.quantity || 0,
            part.price || 0,
            part.remarks || 'No remarks'
          ]);
        });
      } else {
        console.warn('⚠️ No parts data found in inquiry!');
        techSpecData.push(['No technical specifications available', '', '', '', '', '', '']);
      }
      
      const wsTechSpec = xlsx.utils.aoa_to_sheet(techSpecData);
      wsTechSpec['!cols'] = [
        { wch: 25 }, // Part Name
        { wch: 15 }, // Material
        { wch: 12 }, // Thickness
        { wch: 12 }, // Grade
        { wch: 10 }, // Quantity
        { wch: 12 }, // Price
        { wch: 30 }  // Remarks
      ];
      xlsx.utils.book_append_sheet(wb, wsTechSpec, 'Technical Specifications');
      
      // ========== SHEET 3: Uploaded Files List ==========
      const filesData = [];
      filesData.push(['File Name', 'File Type', 'File Size (KB)', 'Upload Date']);
      
      if (inquiry.files && inquiry.files.length > 0) {
        inquiry.files.forEach(file => {
          filesData.push([
            file.originalName || file.fileName || 'Unknown',
            file.fileType || 'Unknown',
            file.fileSize ? Math.round(file.fileSize / 1024) : 0,
            file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString() : 'N/A'
          ]);
        });
      } else {
        filesData.push(['No files uploaded', '', '', '']);
      }
      
      const wsFiles = xlsx.utils.aoa_to_sheet(filesData);
      wsFiles['!cols'] = [{ wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
      xlsx.utils.book_append_sheet(wb, wsFiles, 'Uploaded Files');
      
      // ========== SHEET 4: Delivery Information ==========
      const deliveryData = [
        ['DELIVERY INFORMATION'],
        [],
        ['Street Address:', inquiry.deliveryAddress?.street || 'N/A'],
        ['City:', inquiry.deliveryAddress?.city || 'N/A'],
        ['State:', inquiry.deliveryAddress?.state || 'N/A'],
        ['Postal Code:', inquiry.deliveryAddress?.postalCode || 'N/A'],
        ['Country:', inquiry.deliveryAddress?.country || 'N/A'],
        [],
        ['Expected Delivery Date:', inquiry.expectedDeliveryDate ? new Date(inquiry.expectedDeliveryDate).toLocaleDateString() : 'Not specified']
      ];
      
      const wsDelivery = xlsx.utils.aoa_to_sheet(deliveryData);
      wsDelivery['!cols'] = [{ wch: 20 }, { wch: 40 }];
      xlsx.utils.book_append_sheet(wb, wsDelivery, 'Delivery Information');
      
      // Generate buffer
      const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      // Add consolidated Excel file to attachments
      attachments.push({
        filename: `${inquiry.inquiryNumber}_Complete_Data.xlsx`,
        content: excelBuffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      
      console.log(`✅ Consolidated Excel file generated: ${inquiry.inquiryNumber}_Complete_Data.xlsx`);
      console.log(`   - Summary Sheet: Inquiry details`);
      console.log(`   - Technical Specifications: ${inquiry.parts?.length || 0} parts`);
      console.log(`   - Uploaded Files List: ${inquiry.files?.length || 0} files`);
      console.log(`   - Delivery Information: Address details`);
    } catch (excelError) {
      console.error('Failed to generate consolidated Excel file:', excelError);
      console.error('Error details:', excelError.message);
      // Don't fail the email if Excel generation fails
    }

    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: process.env.BACKOFFICE_EMAIL || 'backoffice@247cutbend.com',
      subject: `New Inquiry Received - ${inquiry.inquiryNumber}`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 700px; margin: 0 auto; background-color: #f8f9fa;">
          <!-- Header with Company Branding -->
          <div style="background: linear-gradient(135deg, #FF9800 0%, #F57C00 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 15px;">
              <div style="width: 50px; height: 50px; background-color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                <span style="color: #FF9800; font-size: 24px; font-weight: bold;">K</span>
              </div>
              <div>
                <h1 style="margin: 0; font-size: 28px; font-weight: 700;">247 CUTBEND</h1>
                <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">SHEET METAL PARTS ON DEMAND</p>
              </div>
            </div>
            <h2 style="margin: 0; font-size: 24px; font-weight: 600;">New Inquiry Received</h2>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Inquiry Number: <strong>${inquiry.inquiryNumber}</strong></p>
          </div>
          
          <!-- Main Content -->
          <div style="background-color: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            
            <!-- Customer Information Card -->
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #FF9800;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">👤 Customer Information</h3>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <p style="margin: 5px 0; color: #555;"><strong>Name:</strong> ${customerInfo.firstName} ${customerInfo.lastName}</p>
                <p style="margin: 5px 0; color: #555;"><strong>Company:</strong> ${customerInfo.companyName}</p>
                <p style="margin: 5px 0; color: #555;"><strong>Email:</strong> ${customerInfo.email}</p>
                <p style="margin: 5px 0; color: #555;"><strong>Phone:</strong> ${customerInfo.phoneNumber}</p>
              </div>
            </div>
            
            <!-- Inquiry Details Card -->
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #4CAF50;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">📋 Inquiry Details</h3>
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; text-align: center;">
                <div style="background-color: white; padding: 15px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                  <div style="font-size: 24px; font-weight: bold; color: #FF9800;">${inquiry.files.length}</div>
                  <div style="font-size: 12px; color: #666; text-transform: uppercase;">Files Attached</div>
                </div>
                <div style="background-color: white; padding: 15px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                  <div style="font-size: 24px; font-weight: bold; color: #4CAF50;">${inquiry.parts.length}</div>
                  <div style="font-size: 12px; color: #666; text-transform: uppercase;">Parts</div>
                </div>
                <div style="background-color: white; padding: 15px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                  <div style="font-size: 24px; font-weight: bold; color: #2196F3;">INR ₹${inquiry.totalAmount || 0}</div>
                  <div style="font-size: 12px; color: #666; text-transform: uppercase;">Total Amount</div>
                </div>
              </div>
            </div>
            
            <!-- Parts Specifications -->
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #2196F3;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">🔧 Parts Specifications</h3>
              <div style="background-color: white; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <table style="width: 100%; border-collapse: collapse;">
                  <thead>
                    <tr style="background-color: #f5f5f5;">
                      <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Part Name</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Material</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Thickness</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Qty</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${inquiry.parts.map(part => `
                      <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 12px; color: #555;">${part.partName || part.partRef || 'Part'}</td>
                        <td style="padding: 12px; color: #555;">${part.material}</td>
                        <td style="padding: 12px; color: #555;">${part.thickness}mm</td>
                        <td style="padding: 12px; color: #555;">${part.quantity}</td>
                        <td style="padding: 12px; color: #555;">${part.remarks || '-'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px;">
            <p style="margin: 0 0 5px 0;">© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
            <p style="margin: 0; opacity: 0.8;">Delivering Factory Direct Quality Sheet Metal Parts Since 2005</p>
          </div>
        </div>
      `,
      attachments: attachments
    };

    console.log('Sending email to:', mailOptions.to);
    console.log('Email subject:', mailOptions.subject);
    console.log('Attachments:', attachments.length);
    
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Inquiry notification email sent successfully!');
    console.log('Message ID:', result.messageId);
    console.log('Response:', result.response);
    
    // Send SMS notification to back office
    try {
      const smsResult = await sendInquiryNotificationSMS(inquiry, customerInfo);
      if (smsResult.success) {
        console.log('Inquiry SMS notification sent successfully');
      } else {
        console.log('Inquiry SMS notification failed:', smsResult.message);
      }
    } catch (smsError) {
      console.error('SMS notification failed:', smsError);
      // Don't fail the email if SMS fails
    }
    
  } catch (error) {
    console.error('Inquiry notification failed:', error);
    // Don't throw error, just log it to prevent inquiry creation from failing
  }
};

// Send quotation email to customer (when admin sends quotation)
const sendQuotationSentEmail = async (quotation, inquiryNumber = null, pdfBuffer = null, pdfFileName = null) => {
  try {
    console.log('=== SENDING QUOTATION SENT EMAIL ===');
    console.log('Quotation:', quotation.quotationNumber);
    console.log('Customer Email:', quotation.customerInfo?.email);
    
    const transporter = createTransporter();
    
    // If no transporter (SMTP not configured), just log and return
    if (!transporter) {
      console.log('SMTP not configured. Quotation sent email skipped for:', quotation.customerInfo?.email);
      return;
    }
    
    // Validate customer email
    if (!quotation.customerInfo || !quotation.customerInfo.email || quotation.customerInfo.email === 'customer@example.com') {
      console.error('No valid customer email found for quotation:', quotation._id);
      return;
    }
    
    const customerName = quotation.customerInfo.name || 'Valued Customer';
    const customerEmail = quotation.customerInfo.email;
    
    // Prepare PDF attachment if available
    const attachments = [];
    
    // If PDF buffer is provided directly, use it
    if (pdfBuffer && Buffer.isBuffer(pdfBuffer)) {
      console.log('📎 Attaching PDF from provided buffer, size:', pdfBuffer.length, 'bytes');
      const fileName = pdfFileName || quotation.quotationPdfFilename || `${quotation.quotationNumber}.pdf`;
      attachments.push({
        filename: fileName,
        content: pdfBuffer,
        contentType: 'application/pdf'
      });
    } else {
      // Try to download PDF from Cloudinary URL
      const cloudinaryUrl = quotation.quotationPdfCloudinaryUrl || quotation.quotationPdf;
      if (cloudinaryUrl && (typeof cloudinaryUrl === 'string' && (cloudinaryUrl.startsWith('http://') || cloudinaryUrl.startsWith('https://')))) {
        try {
          console.log('☁️ Downloading PDF from Cloudinary for email attachment:', cloudinaryUrl);
          const response = await axios.get(cloudinaryUrl, {
            responseType: 'arraybuffer',
            timeout: 30000 // 30 second timeout
          });
          const downloadedBuffer = Buffer.from(response.data);
          console.log('✅ PDF downloaded from Cloudinary, size:', downloadedBuffer.length, 'bytes');
          
          const fileName = pdfFileName || quotation.quotationPdfFilename || `${quotation.quotationNumber}.pdf`;
          attachments.push({
            filename: fileName,
            content: downloadedBuffer,
            contentType: 'application/pdf'
          });
        } catch (downloadError) {
          console.error('❌ Error downloading PDF from Cloudinary for email attachment:', downloadError.message);
          // Continue without attachment if download fails
        }
      } else {
        console.log('⚠️ No PDF buffer or Cloudinary URL available for attachment');
      }
    }
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: customerEmail,
      subject: `Quotation ${quotation.quotationNumber} - 247 CutBend`,
      attachments: attachments.length > 0 ? attachments : undefined,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #FF9800; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700;">247 CUTBEND</h1>
            <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">SHEET METAL PARTS ON DEMAND</p>
            <h2 style="margin: 20px 0 10px 0; font-size: 24px; font-weight: 600;">Your Quotation is Ready!</h2>
          </div>
          
          <div style="background-color: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h3 style="color: #333; margin-top: 0;">Dear ${customerName},</h3>
            <p style="color: #555; line-height: 1.6;">Thank you for your inquiry. We have prepared a competitive quotation for your sheet metal parts.</p>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #FF9800;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">📋 Quotation Summary</h3>
              <p style="margin: 8px 0; color: #555;"><strong>Quotation Number:</strong> ${quotation.quotationNumber}</p>
              ${inquiryNumber ? `<p style="margin: 8px 0; color: #555;"><strong>Inquiry Number:</strong> ${inquiryNumber}</p>` : ''}
              <p style="margin: 8px 0; color: #555;"><strong>Total Amount:</strong> ${quotation.currency || 'INR'} ₹${quotation.totalAmount}</p>
              ${quotation.validUntil ? `<p style="margin: 8px 0; color: #555;"><strong>Valid Until:</strong> ${new Date(quotation.validUntil).toLocaleDateString()}</p>` : ''}
            </div>
            
            ${quotation.items && quotation.items.length > 0 ? `
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #4CAF50;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">🔧 Parts & Pricing</h3>
              <div style="background-color: white; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <table style="width: 100%; border-collapse: collapse;">
                  <thead>
                    <tr style="background-color: #f5f5f5;">
                      <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Part</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Material</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Qty</th>
                      <th style="padding: 12px; text-align: right; font-weight: 600; color: #333; border-bottom: 2px solid #ddd;">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${quotation.items.slice(0, 10).map(item => `
                      <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 12px; color: #555;">${item.partRef || 'N/A'}</td>
                        <td style="padding: 12px; color: #555;">${item.material || 'N/A'}</td>
                        <td style="padding: 12px; color: #555;">${item.quantity || 0}</td>
                        <td style="padding: 12px; text-align: right; color: #555;">$${item.totalPrice || 0}</td>
                      </tr>
                    `).join('')}
                    ${quotation.items.length > 10 ? `
                      <tr>
                        <td colspan="4" style="padding: 12px; text-align: center; color: #666; font-style: italic;">
                          ... and ${quotation.items.length - 10} more items
                        </td>
                      </tr>
                    ` : ''}
                  </tbody>
                </table>
              </div>
            </div>
            ` : ''}
            
            ${quotation.terms ? `
            <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #4CAF50;">
              <h3 style="margin-top: 0; color: #333;">Terms & Conditions:</h3>
              <p style="margin: 0; color: #555; line-height: 1.6;">${quotation.terms}</p>
            </div>
            ` : ''}
            
            ${quotation.notes ? `
            <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #2196F3;">
              <h3 style="margin-top: 0; color: #333;">Additional Notes:</h3>
              <p style="margin: 0; color: #555; line-height: 1.6;">${quotation.notes}</p>
            </div>
            ` : ''}
            
            ${attachments.length > 0 ? `
            <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #2196F3;">
              <h3 style="margin-top: 0; color: #333;">📎 Quotation PDF Attached</h3>
              <p style="margin: 0; color: #555; line-height: 1.6;">The detailed quotation PDF is attached to this email for your reference. Please review the attached document for complete pricing and specifications.</p>
            </div>
            ` : ''}
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 25px 0;">
              <h3 style="margin-top: 0; color: #333;">What's Next?</h3>
              <ul style="margin: 10px 0; padding-left: 20px; color: #555;">
                <li>Please review the attached quotation PDF</li>
                <li>Log in to your account to view the full quotation details</li>
                <li>Review the quotation and accept or request changes</li>
                <li>If you have any questions, please don't hesitate to contact us</li>
              </ul>
            </div>
            
            <p style="margin-top: 30px; color: #555;">Thank you for choosing 247 CutBend for your sheet metal manufacturing needs.</p>
          </div>
          
          <div style="background-color: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px;">
            <p style="margin: 0 0 5px 0;">© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
            <p style="margin: 0; opacity: 0.8;">Delivering Factory Direct Quality Sheet Metal Parts Since 2005</p>
          </div>
        </div>
      `
    };

    console.log('Sending quotation email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      hasAttachment: attachments.length > 0,
      attachmentCount: attachments.length
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Quotation sent email sent successfully!');
    console.log('Message ID:', result.messageId);
    if (attachments.length > 0) {
      console.log('📎 PDF attachment included in email');
    }
    
    // Send SMS notification to customer
    try {
      const { sendQuotationNotificationSMS } = require('./smsService');
      const customerInfo = {
        firstName: quotation.customerInfo.name?.split(' ')[0] || 'Customer',
        lastName: quotation.customerInfo.name?.split(' ').slice(1).join(' ') || '',
        phoneNumber: quotation.customerInfo.phone
      };
      const smsResult = await sendQuotationNotificationSMS(quotation, customerInfo);
      if (smsResult.success) {
        console.log('Quotation SMS notification sent successfully');
      } else {
        console.log('Quotation SMS notification failed:', smsResult.message);
      }
    } catch (smsError) {
      console.error('SMS notification failed:', smsError);
      // Don't fail the email if SMS fails
    }
    
  } catch (error) {
    console.error('Quotation sent email failed:', error);
    // Don't throw error, just log it to prevent route from failing
  }
};

// @deprecated Do not use — customer quotation email must go through sendQuotationSentEmail
// only from POST /api/quotation/:id/send (admin Quotations tab → Send).
const sendQuotationEmail = async (quotation) => {
  try {
    const transporter = createTransporter();
    
    // Get customer information
    let customerInfo = {};
    if (quotation.inquiry && quotation.inquiry.customer) {
      if (typeof quotation.inquiry.customer === 'object' && quotation.inquiry.customer.firstName) {
        customerInfo = quotation.inquiry.customer;
      } else {
        // Customer is an ObjectId, we need to fetch it
        try {
          const User = require('../models/User');
          const customer = await User.findById(quotation.inquiry.customer);
          if (customer) {
            customerInfo = customer;
          }
        } catch (fetchError) {
          console.error('Failed to fetch customer data:', fetchError);
        }
      }
    }
    
    if (!customerInfo.email) {
      console.error('No customer email found for quotation:', quotation._id);
      return;
    }
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: customerInfo.email,
      subject: `Quotation ${quotation.quotationNumber} - Inquiry ${quotation.inquiry.inquiryNumber} - 247 CutBend`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">Quotation Ready</h1>
            <p style="margin: 5px 0;">Quotation Number: ${quotation.quotationNumber}</p>
          </div>
          
          <div style="padding: 20px;">
            <h3>Dear ${customerInfo.firstName || 'Valued Customer'},</h3>
            <p>Thank you for your inquiry. We have prepared a competitive quotation for your sheet metal parts.</p>
            
            <h3>Quotation Summary:</h3>
            <p><strong>Quotation Number:</strong> ${quotation.quotationNumber}</p>
            <p><strong>Inquiry Number:</strong> ${quotation.inquiry.inquiryNumber}</p>
            <p><strong>Total Amount:</strong> ${quotation.currency || 'INR'} ₹${quotation.totalAmount}</p>
            <p><strong>Valid Until:</strong> ${new Date(quotation.validUntil).toLocaleDateString()}</p>
            
            <h3>Parts & Pricing:</h3>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <thead>
                <tr style="background-color: #f5f5f5;">
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Part Name</th>
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Material</th>
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Thickness</th>
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Qty</th>
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Unit Price</th>
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${quotation.parts.map(part => `
                  <tr>
                    <td style="border: 1px solid #ddd; padding: 8px;">${part.partName || part.partRef || 'Part'}</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">${part.material}</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">${part.thickness}mm</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">${part.quantity}</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">₹${part.unitPrice}</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">₹${part.totalPrice}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            
            <h3>Terms & Conditions:</h3>
            <p style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #4CAF50;">
              ${quotation.terms}
            </p>
            
            ${quotation.notes ? `
            <h3>Additional Notes:</h3>
            <p style="background-color: #f0f8ff; padding: 15px; border-left: 4px solid #2196F3;">
              ${quotation.notes}
            </p>
            ` : ''}
            
            <p style="margin-top: 30px;">Please log in to your account to view and respond to this quotation.</p>
            
            <p style="margin-top: 30px;">If you have any questions, please don't hesitate to contact us.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Quotation email sent successfully to:', customerInfo.email);
    
    // Send SMS notification to customer
    try {
      const smsResult = await sendQuotationNotificationSMS(quotation, customerInfo);
      if (smsResult.success) {
        console.log('Quotation SMS notification sent successfully');
      } else {
        console.log('Quotation SMS notification failed:', smsResult.message);
      }
    } catch (smsError) {
      console.error('SMS notification failed:', smsError);
      // Don't fail the email if SMS fails
    }
    
  } catch (error) {
    console.error('Quotation email failed:', error);
    throw error;
  }
};

// Send order confirmation
const sendOrderConfirmation = async (order) => {
  try {
    console.log('=== SENDING ORDER CONFIRMATION EMAIL ===');
    console.log('Order:', order.orderNumber);
    console.log('Customer:', order.customer?.email);
    
    const transporter = createTransporter();
    
    // If no transporter (SMTP not configured), just log and return
    if (!transporter) {
      console.log('SMTP not configured. Order confirmation email skipped for:', order.customer?.email);
      return;
    }
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: order.customer.email,
      subject: `Order Confirmed - ${order.orderNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">247 CUTBEND</h1>
            <h2 style="margin: 10px 0;">Order Confirmed</h2>
            <p style="margin: 5px 0;">Order Number: ${order.orderNumber}</p>
          </div>
          
          <div style="padding: 20px;">
            <h3>Dear ${order.customer.firstName || 'Customer'},</h3>
            <p style="color: #555; line-height: 1.6;">Great news! Your order has been confirmed by our team and is now ready for production!</p>
            
            <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #4CAF50;">
              <h3 style="margin-top: 0; color: #333;">✅ Order Confirmed</h3>
              <p style="margin: 5px 0; color: #555;">Your order has been reviewed and confirmed by our team. We're now preparing to start production.</p>
            </div>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Order Details:</h3>
              <p><strong>Order Number:</strong> ${order.orderNumber}</p>
              <p><strong>Total Amount:</strong> ${order.currency || 'INR'} ₹${order.totalAmount}</p>
              <p><strong>Payment Status:</strong> ${order.payment ? (order.payment.status === 'completed' ? '✅ Completed' : order.payment.status) : 'Completed'}</p>
              <p><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}</p>
              <p><strong>Confirmed Date:</strong> ${order.confirmedAt ? new Date(order.confirmedAt).toLocaleDateString() : new Date().toLocaleDateString()}</p>
            </div>
            
            <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Production Timeline:</h3>
              <p><strong>Start Date:</strong> ${order.production && order.production.startDate ? new Date(order.production.startDate).toLocaleDateString() : 'TBD'}</p>
              <p><strong>Estimated Completion:</strong> ${order.production && order.production.estimatedCompletion ? new Date(order.production.estimatedCompletion).toLocaleDateString() : 'TBD'}</p>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">What's Next?</h3>
              <ul>
                <li>Your order is now in production</li>
                <li>We will keep you updated on the progress</li>
                <li>You will receive notifications for each milestone</li>
                <li>Log in to your account to track order status</li>
              </ul>
            </div>
            
            <p style="margin-top: 30px;">Please log in to your account to track your order status.</p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="font-size: 14px; color: #666;">
                If you have any questions, please contact our support team.<br>
                Thank you for choosing 247 CutBend for your sheet metal manufacturing needs.
              </p>
            </div>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666;">
            <p>© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
            <p>Sheet Metal Parts on Demand</p>
          </div>
        </div>
      `
    };

    console.log('Sending email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('Order confirmation email sent successfully:', result.messageId);
    
    // Send SMS notification
    try {
      const smsResult = await sendOrderConfirmationSMS(order, order.customer);
      if (smsResult.success) {
        console.log('Order confirmation SMS notification sent successfully');
      } else {
        console.log('Order confirmation SMS notification failed:', smsResult.message);
      }
    } catch (smsError) {
      console.error('SMS notification failed:', smsError);
      // Don't fail the email if SMS fails
    }
    
  } catch (error) {
    console.error('Order confirmation email failed:', error);
    throw error;
  }
};

// Send dispatch notification
const sendDispatchNotification = async (order) => {
  try {
    console.log('=== SENDING DISPATCH NOTIFICATION EMAIL TO CUSTOMER ===');
    console.log('Order ID:', order._id);
    console.log('Order Number:', order.orderNumber);
    console.log('Customer:', order.customer);
    console.log('Customer Email:', order.customer?.email);
    console.log('Dispatch Object:', order.dispatch);
    console.log('Courier:', order.dispatch?.courier);
    console.log('Tracking Number:', order.dispatch?.trackingNumber);
    console.log('Dispatched At:', order.dispatch?.dispatchedAt);
    
    const transporter = createTransporter();
    
    // If no transporter (SMTP not configured), just log and return
    if (!transporter) {
      console.log('❌ SMTP not configured. Dispatch notification email skipped for:', order.customer?.email);
      return;
    }
    
    // Validate customer email
    if (!order.customer) {
      console.error('❌ No customer object found for order:', order._id);
      return;
    }
    
    if (!order.customer.email || order.customer.email === 'customer@example.com') {
      console.error('❌ No valid customer email found for order:', order._id);
      console.error('Customer email value:', order.customer.email);
      return;
    }
    
    if (!order.dispatch) {
      console.warn('⚠️ Dispatch object not found, creating empty dispatch object');
      order.dispatch = {};
    }
    
    if (!order.dispatch.courier) {
      console.warn('⚠️ Courier name not found in dispatch object');
    }
    
    const customerName = `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() || 'Valued Customer';
    const estimatedDelivery = order.dispatch?.estimatedDelivery ? new Date(order.dispatch.estimatedDelivery) : null;
    const deliveryDate = estimatedDelivery ? estimatedDelivery.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'TBD';
    const deliveryTime = estimatedDelivery ? estimatedDelivery.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'TBD';
    const dispatchedDate = order.dispatch?.dispatchedAt ? new Date(order.dispatch.dispatchedAt) : new Date();
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: order.customer.email,
      subject: `Order Dispatched - ${order.orderNumber} - 247 CutBend`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #2196F3; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700;">247 CUTBEND</h1>
            <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">SHEET METAL PARTS ON DEMAND</p>
            <h2 style="margin: 20px 0 10px 0; font-size: 24px; font-weight: 600;">Order Dispatched! 🚚</h2>
          </div>
          
          <div style="background-color: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h3 style="color: #333; margin-top: 0;">Dear ${customerName},</h3>
            <p style="color: #555; line-height: 1.6; font-size: 16px;">Great news! Your order <strong>${order.orderNumber}</strong> has been dispatched and is on its way to you!</p>
            
            <div style="background-color: #e3f2fd; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196F3; text-align: center;">
              <h3 style="margin: 0 0 20px 0; color: #333; font-size: 20px; font-weight: 600;">🚚 Dispatch Information</h3>
              <div style="background-color: white; padding: 20px; border-radius: 8px; margin-bottom: 15px;">
                <p style="margin: 0 0 10px 0; color: #666; font-size: 14px; text-transform: uppercase;">Courier Name</p>
                <p style="margin: 0; color: #1976D2; font-size: 28px; font-weight: 700;">${order.dispatch?.courier || 'N/A'}</p>
              </div>
              <div style="background-color: white; padding: 20px; border-radius: 8px;">
                <p style="margin: 0 0 10px 0; color: #666; font-size: 14px; text-transform: uppercase;">Dispatched Date</p>
                <p style="margin: 0; color: #1976D2; font-size: 24px; font-weight: 700;">${dispatchedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                <p style="margin: 10px 0 0 0; color: #555; font-size: 16px;">${dispatchedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</p>
              </div>
            </div>
            
            ${estimatedDelivery ? `
            <div style="background-color: #e8f5e8; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #4CAF50; text-align: center;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 20px; font-weight: 600;">📦 Expected Delivery Date & Time</h3>
              <p style="margin: 0; color: #2e7d32; font-size: 24px; font-weight: 700;">${deliveryDate}</p>
              <p style="margin: 10px 0 0 0; color: #2e7d32; font-size: 20px; font-weight: 600;">at ${deliveryTime}</p>
              <p style="margin: 15px 0 0 0; color: #555; font-size: 14px;">You will receive your order on this date at this time</p>
            </div>
            ` : ''}
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196F3;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">📋 Order Details</h3>
              <p style="margin: 8px 0; color: #555;"><strong>Order Number:</strong> ${order.orderNumber}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Tracking Number:</strong> ${order.dispatch?.trackingNumber || 'N/A'}</p>
              ${order.dispatch?.trackingNumber ? `
              <p style="margin: 8px 0; color: #555;">You can use this tracking number to track your shipment with ${order.dispatch?.courier || 'the courier'}</p>
              ` : ''}
            </div>
            
            ${order.deliveryAddress ? `
            <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ffc107;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">📍 Delivery Address</h3>
              <p style="margin: 8px 0; color: #555; padding-left: 20px;">
                ${order.deliveryAddress.street || ''}<br>
                ${order.deliveryAddress.city || ''}, ${order.deliveryAddress.state || ''} ${order.deliveryAddress.postalCode || ''}<br>
                ${order.deliveryAddress.country || ''}
              </p>
            </div>
            ` : ''}
            
            <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #4CAF50;">
              <h3 style="margin-top: 0; color: #333;">💡 Important Information</h3>
              <ul style="margin: 10px 0; padding-left: 20px; color: #555;">
                <li>Please ensure someone is available at the delivery address on <strong>${deliveryDate}</strong> at <strong>${deliveryTime}</strong></li>
                <li>You can track your order using the tracking number provided above</li>
                <li>If you need to change the delivery date or address, please contact our support team immediately</li>
                <li>Log in to your account to track your order status</li>
              </ul>
            </div>
            
            <p style="margin-top: 30px; color: #555;">Thank you for choosing 247 CutBend. We look forward to delivering your order on time!</p>
          </div>
          
          <div style="background-color: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px;">
            <p style="margin: 0 0 5px 0;">© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
            <p style="margin: 0; opacity: 0.8;">Delivering Factory Direct Quality Sheet Metal Parts Since 2005</p>
          </div>
        </div>
      `
    };

    console.log('Sending dispatch notification email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Dispatch notification email sent successfully!');
    console.log('Message ID:', result.messageId);
    
    // Send SMS notification
    try {
      const smsResult = await sendDispatchNotificationSMS(order, order.customer);
      if (smsResult.success) {
        console.log('Dispatch SMS notification sent successfully');
      } else {
        console.log('Dispatch SMS notification failed:', smsResult.message);
      }
    } catch (smsError) {
      console.error('SMS notification failed:', smsError);
      // Don't fail the email if SMS fails
    }
    
  } catch (error) {
    console.error('Dispatch notification email failed:', error);
    throw error;
  }
};

// Send payment confirmation email to customer
const sendCustomerPaymentConfirmation = async (order) => {
  try {
    console.log('=== SENDING CUSTOMER PAYMENT CONFIRMATION EMAIL ===');
    console.log('Order:', order.orderNumber);
    console.log('Customer:', order.customer?.email);
    
    const transporter = createTransporter();
    
    // If no transporter (SMTP not configured), just log and return
    if (!transporter) {
      console.log('SMTP not configured. Customer payment confirmation email skipped for:', order.customer?.email);
      return;
    }
    
    // Validate customer email
    if (!order.customer || !order.customer.email || order.customer.email === 'customer@example.com') {
      console.error('No valid customer email found for order:', order._id);
      return;
    }
    
    const customerName = `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() || 'Valued Customer';
    const paymentDate = order.payment?.paidAt ? new Date(order.payment.paidAt) : new Date();
    const paymentMethod = order.payment?.method || 'Online Payment';
    const transactionId = order.payment?.transactionId || 'N/A';
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: order.customer.email,
      subject: `Payment Successful - Order ${order.orderNumber} - 247 CutBend`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700;">247 CUTBEND</h1>
            <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">SHEET METAL PARTS ON DEMAND</p>
            <h2 style="margin: 20px 0 10px 0; font-size: 24px; font-weight: 600;">Payment Successful! ✅</h2>
          </div>
          
          <div style="background-color: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h3 style="color: #333; margin-top: 0;">Dear ${customerName},</h3>
            <p style="color: #555; line-height: 1.6;">Thank you for your payment! We have successfully received your payment for order <strong>${order.orderNumber}</strong>.</p>
            
            <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #4CAF50;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">💳 Payment Details</h3>
              <p style="margin: 8px 0; color: #555;"><strong>Order Number:</strong> ${order.orderNumber}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Payment Amount:</strong> ${order.currency || 'INR'} ₹${order.totalAmount || order.payment?.amount || 0}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Payment Method:</strong> ${paymentMethod}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Transaction ID:</strong> ${transactionId}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Payment Date:</strong> ${paymentDate.toLocaleDateString()} at ${paymentDate.toLocaleTimeString()}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Payment Status:</strong> <span style="color: #4CAF50; font-weight: 600;">Completed</span></p>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196F3;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">📦 Order Information</h3>
              <p style="margin: 8px 0; color: #555;"><strong>Order Status:</strong> ${order.status ? order.status.charAt(0).toUpperCase() + order.status.slice(1).replace('_', ' ') : 'Confirmed'}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}</p>
              ${order.deliveryAddress ? `
              <p style="margin: 8px 0; color: #555;"><strong>Delivery Address:</strong></p>
              <p style="margin: 8px 0; color: #555; padding-left: 20px;">
                ${order.deliveryAddress.street || ''}<br>
                ${order.deliveryAddress.city || ''}, ${order.deliveryAddress.state || ''} ${order.deliveryAddress.postalCode || ''}<br>
                ${order.deliveryAddress.country || ''}
              </p>
              ` : ''}
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ffc107;">
              <h3 style="margin-top: 0; color: #333;">📋 What's Next?</h3>
              <ul style="margin: 10px 0; padding-left: 20px; color: #555;">
                <li>Your order has been confirmed and is now in production</li>
                <li>We will keep you updated on the production progress</li>
                <li>You will receive notifications for each milestone</li>
                <li>Log in to your account to track your order status</li>
              </ul>
            </div>
            
            <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #2196F3;">
              <h3 style="margin-top: 0; color: #333;">💡 Important Information</h3>
              <p style="margin: 0; color: #555; line-height: 1.6;">
                Please save this email for your records. Your transaction ID is <strong>${transactionId}</strong>. 
                If you have any questions about your payment or order, please contact our support team with your order number.
              </p>
            </div>
            
            <p style="margin-top: 30px; color: #555;">Thank you for choosing 247 CutBend for your sheet metal manufacturing needs. We appreciate your business!</p>
          </div>
          
          <div style="background-color: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px;">
            <p style="margin: 0 0 5px 0;">© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
            <p style="margin: 0; opacity: 0.8;">Delivering Factory Direct Quality Sheet Metal Parts Since 2005</p>
          </div>
        </div>
      `
    };

    console.log('Sending customer payment confirmation email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Customer payment confirmation email sent successfully!');
    console.log('Message ID:', result.messageId);
    
  } catch (error) {
    console.error('Customer payment confirmation email failed:', error);
    // Don't throw error, just log it to prevent payment from failing
  }
};

// Send payment confirmation to back office
const sendPaymentConfirmation = async (order) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: process.env.BACKOFFICE_EMAIL || 'backoffice@247cutbend.com',
      subject: `Payment Confirmed - Order ${order.orderNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">Payment Confirmed</h1>
            <p style="margin: 5px 0;">Order Number: ${order.orderNumber}</p>
          </div>
          
          <div style="padding: 20px;">
            <h3>Payment Details:</h3>
            <p><strong>Order Number:</strong> ${order.orderNumber}</p>
            <p><strong>Customer:</strong> ${order.customer?.firstName || 'Unknown'} ${order.customer?.lastName || ''}</p>
            <p><strong>Amount:</strong> INR ₹${order.totalAmount}</p>
            <p><strong>Payment Method:</strong> ${order.payment?.method || 'Online'}</p>
            <p><strong>Transaction ID:</strong> ${order.payment?.transactionId || 'N/A'}</p>
            <p><strong>Paid At:</strong> ${order.payment?.paidAt ? new Date(order.payment.paidAt).toLocaleString() : new Date().toLocaleString()}</p>
            
            <h3>Next Steps:</h3>
            <p>1. Update order status to "confirmed"</p>
            <p>2. Set production timeline</p>
            <p>3. Begin manufacturing process</p>
            
            <p style="margin-top: 30px;">Please log in to the back office to manage this order.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Payment confirmation email sent to back office');
    
    // Send SMS notification to back office
    try {
      const smsResult = await sendPaymentConfirmationSMS(order, order.customer);
      if (smsResult.success) {
        console.log('Payment confirmation SMS notification sent successfully');
      } else {
        console.log('Payment confirmation SMS notification failed:', smsResult.message);
      }
    } catch (smsError) {
      console.error('SMS notification failed:', smsError);
      // Don't fail the email if SMS fails
    }
    
  } catch (error) {
    console.error('Payment confirmation email failed:', error);
    throw error;
  }
};

// Send delivery confirmation
const sendDeliveryConfirmation = async (order) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: order.customer.email,
      subject: `Order Delivered - ${order.orderNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">Order Delivered</h1>
            <p style="margin: 5px 0;">Order Number: ${order.orderNumber}</p>
          </div>
          
          <div style="padding: 20px;">
            <h3>Dear ${order.customer.firstName},</h3>
            <p>Your order has been successfully delivered!</p>
            
            <h3>Delivery Details:</h3>
            <p><strong>Order Number:</strong> ${order.orderNumber}</p>
            <p><strong>Delivered Date:</strong> ${new Date(order.dispatch.actualDelivery).toLocaleDateString()}</p>
            <p><strong>Delivery Address:</strong> ${order.deliveryAddress.street}, ${order.deliveryAddress.city}</p>
            
            <h3>Thank You!</h3>
            <p>We appreciate your business and hope you're satisfied with your order. If you have any questions or need assistance, please don't hesitate to contact us.</p>
            
            <p style="margin-top: 30px;">Thank you for choosing 247 CutBend. We look forward to serving you again.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Delivery confirmation email sent successfully');
    
    // Send SMS notification
    if (order.customer.phoneNumber) {
      const smsMessage = `Order ${order.orderNumber} delivered successfully! Thank you for choosing 247 CutBend.`;
      await sendSMS(order.customer.phoneNumber, smsMessage);
    }
    
  } catch (error) {
    console.error('Delivery confirmation email failed:', error);
    throw error;
  }
};

// Send production started notification to customer
const sendProductionStartedEmail = async (order) => {
  try {
    console.log('=== SENDING PRODUCTION STARTED EMAIL TO CUSTOMER ===');
    console.log('Order:', order.orderNumber);
    console.log('Customer:', order.customer?.email);
    
    const transporter = createTransporter();
    
    // If no transporter (SMTP not configured), just log and return
    if (!transporter) {
      console.log('SMTP not configured. Production started email skipped for:', order.customer?.email);
      return;
    }
    
    // Validate customer email
    if (!order.customer || !order.customer.email || order.customer.email === 'customer@example.com') {
      console.error('No valid customer email found for order:', order._id);
      return;
    }
    
    const customerName = `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() || 'Valued Customer';
    const productionStartDate = order.production?.startDate ? new Date(order.production.startDate) : new Date();
    const estimatedCompletion = order.production?.estimatedCompletion ? new Date(order.production.estimatedCompletion) : null;
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: order.customer.email,
      subject: `Production Started - Order ${order.orderNumber} - 247 CutBend`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #2196F3; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700;">247 CUTBEND</h1>
            <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">SHEET METAL PARTS ON DEMAND</p>
            <h2 style="margin: 20px 0 10px 0; font-size: 24px; font-weight: 600;">Production Started! 🏭</h2>
          </div>
          
          <div style="background-color: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h3 style="color: #333; margin-top: 0;">Dear ${customerName},</h3>
            <p style="color: #555; line-height: 1.6;">Great news! Production has started for your order <strong>${order.orderNumber}</strong>. We're now manufacturing your sheet metal parts!</p>
            
            <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196F3;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">🏭 Production Information</h3>
              <p style="margin: 8px 0; color: #555;"><strong>Order Number:</strong> ${order.orderNumber}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Production Start Date:</strong> ${productionStartDate.toLocaleDateString()} at ${productionStartDate.toLocaleTimeString()}</p>
              ${estimatedCompletion ? `
              <p style="margin: 8px 0; color: #555;"><strong>Estimated Completion:</strong> ${estimatedCompletion.toLocaleDateString()}</p>
              ` : ''}
              <p style="margin: 8px 0; color: #555;"><strong>Status:</strong> <span style="color: #2196F3; font-weight: 600;">In Production</span></p>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #4CAF50;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">📦 Order Details</h3>
              <p style="margin: 8px 0; color: #555;"><strong>Total Amount:</strong> ${order.currency || 'INR'} ₹${order.totalAmount}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}</p>
              ${order.parts && order.parts.length > 0 ? `
              <p style="margin: 8px 0; color: #555;"><strong>Number of Parts:</strong> ${order.parts.length}</p>
              ` : ''}
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ffc107;">
              <h3 style="margin-top: 0; color: #333;">📋 What's Next?</h3>
              <ul style="margin: 10px 0; padding-left: 20px; color: #555;">
                <li>Your order is now being manufactured in our facility</li>
                <li>We will keep you updated on the production progress</li>
                <li>You will receive a notification when production is complete</li>
                <li>Once ready, your order will be prepared for dispatch</li>
                <li>Log in to your account to track your order status</li>
              </ul>
            </div>
            
            <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #4CAF50;">
              <h3 style="margin-top: 0; color: #333;">💡 Quality Assurance</h3>
              <p style="margin: 0; color: #555; line-height: 1.6;">
                Our team is committed to delivering high-quality sheet metal parts. We follow strict quality control processes 
                to ensure your order meets our standards. If you have any questions during production, please don't hesitate to contact us.
              </p>
            </div>
            
            <p style="margin-top: 30px; color: #555;">Thank you for choosing 247 CutBend. We're working hard to deliver your order on time!</p>
          </div>
          
          <div style="background-color: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px;">
            <p style="margin: 0 0 5px 0;">© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
            <p style="margin: 0; opacity: 0.8;">Delivering Factory Direct Quality Sheet Metal Parts Since 2005</p>
          </div>
        </div>
      `
    };

    console.log('Sending production started email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Production started email sent successfully!');
    console.log('Message ID:', result.messageId);
    
  } catch (error) {
    console.error('Production started email failed:', error);
    // Don't throw error, just log it to prevent operation from failing
  }
};

// Send order ready for dispatch notification to customer
const sendOrderReadyEmail = async (order) => {
  try {
    console.log('=== SENDING ORDER READY EMAIL TO CUSTOMER ===');
    console.log('Order:', order.orderNumber);
    console.log('Customer:', order.customer?.email);
    
    const transporter = createTransporter();
    
    // If no transporter (SMTP not configured), just log and return
    if (!transporter) {
      console.log('SMTP not configured. Order ready email skipped for:', order.customer?.email);
      return;
    }
    
    // Validate customer email
    if (!order.customer || !order.customer.email || order.customer.email === 'customer@example.com') {
      console.error('No valid customer email found for order:', order._id);
      return;
    }
    
    const customerName = `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() || 'Valued Customer';
    const completionDate = order.production?.actualCompletion ? new Date(order.production.actualCompletion) : new Date();
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: order.customer.email,
      subject: `Order Ready for Dispatch - ${order.orderNumber} - 247 CutBend`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #FF9800; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700;">247 CUTBEND</h1>
            <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">SHEET METAL PARTS ON DEMAND</p>
            <h2 style="margin: 20px 0 10px 0; font-size: 24px; font-weight: 600;">Order Ready! ✅</h2>
          </div>
          
          <div style="background-color: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h3 style="color: #333; margin-top: 0;">Dear ${customerName},</h3>
            <p style="color: #555; line-height: 1.6;">Excellent news! Your order <strong>${order.orderNumber}</strong> has been completed and is now ready for dispatch!</p>
            
            <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #FF9800;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">📦 Order Status</h3>
              <p style="margin: 8px 0; color: #555;"><strong>Order Number:</strong> ${order.orderNumber}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Status:</strong> <span style="color: #FF9800; font-weight: 600;">Ready for Dispatch</span></p>
              <p style="margin: 8px 0; color: #555;"><strong>Production Completed:</strong> ${completionDate.toLocaleDateString()} at ${completionDate.toLocaleTimeString()}</p>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #4CAF50;">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; font-weight: 600;">📋 Order Summary</h3>
              <p style="margin: 8px 0; color: #555;"><strong>Total Amount:</strong> ${order.currency || 'INR'} ₹${order.totalAmount}</p>
              <p style="margin: 8px 0; color: #555;"><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}</p>
              ${order.parts && order.parts.length > 0 ? `
              <p style="margin: 8px 0; color: #555;"><strong>Number of Parts:</strong> ${order.parts.length}</p>
              ` : ''}
              ${order.deliveryAddress ? `
              <p style="margin: 8px 0; color: #555;"><strong>Delivery Address:</strong></p>
              <p style="margin: 8px 0; color: #555; padding-left: 20px;">
                ${order.deliveryAddress.street || ''}<br>
                ${order.deliveryAddress.city || ''}, ${order.deliveryAddress.state || ''} ${order.deliveryAddress.postalCode || ''}<br>
                ${order.deliveryAddress.country || ''}
              </p>
              ` : ''}
            </div>
            
            <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #2196F3;">
              <h3 style="margin-top: 0; color: #333;">📋 What's Next?</h3>
              <ul style="margin: 10px 0; padding-left: 20px; color: #555;">
                <li>Your order has been completed and quality checked</li>
                <li>It's now ready to be dispatched to your delivery address</li>
                <li>We will prepare it for shipping shortly</li>
                <li>You will receive a dispatch notification with tracking details once it's shipped</li>
                <li>Log in to your account to track your order status</li>
              </ul>
            </div>
            
            <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #4CAF50;">
              <h3 style="margin-top: 0; color: #333;">💡 Quality Assurance</h3>
              <p style="margin: 0; color: #555; line-height: 1.6;">
                Your order has passed our quality control checks and is ready for dispatch. We ensure all parts meet our 
                high standards before shipping. Thank you for your patience during the production process!
              </p>
            </div>
            
            <p style="margin-top: 30px; color: #555;">We're excited to deliver your order to you soon. Thank you for choosing 247 CutBend!</p>
          </div>
          
          <div style="background-color: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px;">
            <p style="margin: 0 0 5px 0;">© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
            <p style="margin: 0; opacity: 0.8;">Delivering Factory Direct Quality Sheet Metal Parts Since 2005</p>
          </div>
        </div>
      `
    };

    console.log('Sending order ready email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Order ready email sent successfully!');
    console.log('Message ID:', result.messageId);
    
  } catch (error) {
    console.error('Order ready email failed:', error);
    // Don't throw error, just log it to prevent operation from failing
  }
};

// Send delivery time notification to customer
const sendDeliveryTimeNotification = async (order) => {
  try {
    console.log('=== SENDING DELIVERY TIME NOTIFICATION ===');
    console.log('Order:', order.orderNumber);
    console.log('Customer:', order.customer?.email);
    
    const transporter = createTransporter();
    
    // If no transporter (SMTP not configured), just log and return
    if (!transporter) {
      console.log('SMTP not configured. Delivery time notification skipped for:', order.customer?.email);
      return;
    }
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: order.customer.email,
      subject: `Delivery Time Updated - ${order.orderNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #FF9800; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">247 CUTBEND</h1>
            <h2 style="margin: 10px 0;">Delivery Time Updated</h2>
            <p style="margin: 5px 0;">Order Number: ${order.orderNumber}</p>
          </div>
          
          <div style="padding: 20px;">
            <h3>Dear ${order.customer.firstName || 'Customer'},</h3>
            <p>We have updated the delivery time for your order. Here are the latest details:</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Order Details:</h3>
              <p><strong>Order Number:</strong> ${order.orderNumber}</p>
              <p><strong>Total Amount:</strong> ${order.currency || 'INR'} ₹${order.totalAmount}</p>
              <p><strong>Current Status:</strong> ${order.status.charAt(0).toUpperCase() + order.status.slice(1).replace('_', ' ')}</p>
            </div>
            
            <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Updated Delivery Information:</h3>
              <p><strong>Estimated Delivery:</strong> ${order.production?.estimatedCompletion ? new Date(order.production.estimatedCompletion).toLocaleDateString() : 'TBD'}</p>
              <p><strong>Production Start Date:</strong> ${order.production?.startDate ? new Date(order.production.startDate).toLocaleDateString() : 'TBD'}</p>
              <p><strong>Updated On:</strong> ${new Date().toLocaleDateString()}</p>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">What's Next?</h3>
              <ul>
                <li>Your order is currently in production</li>
                <li>We will keep you updated on any changes</li>
                <li>You will receive a notification when it's ready for dispatch</li>
                <li>Log in to your account to track order status</li>
              </ul>
            </div>
            
            <p style="margin-top: 30px;">Please log in to your account to track your order.</p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="font-size: 14px; color: #666;">
                If you have any questions about the delivery time, please contact our support team.<br>
                Thank you for choosing 247 CutBend for your sheet metal manufacturing needs.
              </p>
            </div>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666;">
            <p>© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
            <p>Sheet Metal Parts on Demand</p>
          </div>
        </div>
      `
    };

    console.log('Sending delivery time notification with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('Delivery time notification sent successfully:', result.messageId);
    
    // Send SMS notification
    try {
      const { sendDeliveryTimeNotificationSMS } = require('./smsService');
      const smsResult = await sendDeliveryTimeNotificationSMS(order, order.customer);
      if (smsResult.success) {
        console.log('Delivery time SMS notification sent successfully');
      } else {
        console.log('Delivery time SMS notification failed:', smsResult.message);
      }
    } catch (smsError) {
      console.error('SMS notification failed:', smsError);
      // Don't fail the email if SMS fails
    }
    
  } catch (error) {
    console.error('Delivery time notification failed:', error);
    throw error;
  }
};

// Send Quote Request Form Email
const sendQuoteFormEmail = async (quoteData) => {
  try {
    console.log('=== SENDING QUOTE FORM EMAIL ===');
    console.log('Quote Request Data:', quoteData);
    
    const transporter = createTransporter();
    
    if (!transporter) {
      console.log('SMTP not configured. Quote form email skipped.');
      return { success: false, message: 'SMTP not configured' };
    }
    
    const { name, email, phone, services, message } = quoteData;
    const contactFormEmail = process.env.CONTACTFORM_EMAIL || 'sales@247cutbend.in';
    
    // Email to admin
    const adminMailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: contactFormEmail,
      subject: `New Quote Request from ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f15925; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700;">247 CUTBEND</h1>
            <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">NEW QUOTE REQUEST</p>
          </div>
          
          <div style="padding: 20px; background-color: #ffffff; border: 1px solid #ddd;">
            <h2 style="color: #2d3992; margin-top: 0;">New Quote Request Received</h2>
            
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #f15925;">
              <h3 style="margin-top: 0; color: #2d3992;">Customer Details</h3>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
              <p><strong>Phone:</strong> <a href="tel:${phone}">${phone}</a></p>
            </div>
            
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #f15925;">
              <h3 style="margin-top: 0; color: #2d3992;">Services Requested</h3>
              <p style="margin: 0;">${services && services.length > 0 ? services.join(', ') : 'Not specified'}</p>
            </div>
            
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #f15925;">
              <h3 style="margin-top: 0; color: #2d3992;">Message / Details</h3>
              <p style="margin: 0; white-space: pre-wrap; line-height: 1.6;">${message || 'No message provided'}</p>
            </div>
            
            <div style="background-color: #e8f4f8; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 0; color: #666;"><strong>Submitted On:</strong> ${new Date().toLocaleString()}</p>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <p style="margin: 0; color: #856404;"><strong>Action Required:</strong> Please review this quote request and respond to the customer within 2 hours.</p>
            </div>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 8px 8px;">
            <p>© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
          </div>
        </div>
      `
    };
    
    // Email confirmation to customer
    const customerMailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: email,
      subject: 'Your Quote Request - 247 CutBend',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f15925; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700;">247 CUTBEND</h1>
            <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">SHEET METAL PARTS ON DEMAND</p>
          </div>
          
          <div style="padding: 20px; background-color: #ffffff; border: 1px solid #ddd;">
            <h2 style="color: #2d3992; margin-top: 0;">Thank You for Your Quote Request!</h2>
            
            <p>Dear ${name},</p>
            
            <p>Thank you for reaching out to 247 CutBend. We have received your quote request and appreciate your interest in our services.</p>
            
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #f15925;">
              <h3 style="margin-top: 0; color: #2d3992;">Request Summary</h3>
              <p><strong>Services:</strong> ${services && services.length > 0 ? services.join(', ') : 'Not specified'}</p>
              <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
            </div>
            
            <div style="background-color: #e8f4f8; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #2d3992;">What's Next?</h3>
              <p>Our team will review your request and get back to you within <strong>2 hours</strong> with a detailed quote and timeline.</p>
            </div>
            
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #2d3992;">Contact Information</h3>
              <p><strong>Email:</strong> <a href="mailto:support@247cutbend.in">support@247cutbend.in</a></p>
              <p><strong>Phone:</strong> <a href="tel:+918511113021">+91 8511113021</a></p>
            </div>
            
            <p>If you have any urgent questions, please don't hesitate to contact us directly.</p>
            
            <p style="margin-top: 30px; color: #666;">Best regards,<br><strong>247 CutBend Team</strong><br>Laser Cutting & CNC Bending Services</p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 8px 8px;">
            <p>© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
          </div>
        </div>
      `
    };
    
    // Send both emails
    const [adminResult, customerResult] = await Promise.all([
      transporter.sendMail(adminMailOptions),
      transporter.sendMail(customerMailOptions)
    ]);
    
    console.log('Quote form admin email sent:', adminResult.messageId);
    console.log('Quote form customer confirmation email sent:', customerResult.messageId);
    
    return { success: true, messageId: adminResult.messageId };
    
  } catch (error) {
    console.error('Quote form email failed:', error);
    throw error;
  }
};

// Test email service function
const testEmailService = async (testEmail) => {
  try {
    console.log('=== TESTING EMAIL SERVICE ===');
    console.log('Test email:', testEmail);
    
    const transporter = createTransporter();
    
    if (!transporter) {
      console.log('SMTP not configured. Cannot send test email.');
      return { success: false, message: 'SMTP not configured' };
    }
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@247cutbend.com',
      to: testEmail,
      subject: '247 CutBend Email Service Test',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">247 CUTBEND</h1>
            <h2 style="margin: 10px 0;">Email Service Test</h2>
          </div>
          
          <div style="padding: 20px;">
            <h3>Email Service is Working!</h3>
            <p>This is a test email to verify that the 247 CutBend email service is functioning correctly.</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Test Details:</h3>
              <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
              <p><strong>SMTP Host:</strong> ${process.env.SMTP_HOST || 'smtp.gmail.com'}</p>
              <p><strong>From Email:</strong> ${process.env.SMTP_FROM || 'noreply@247cutbend.com'}</p>
            </div>
            
            <p>If you received this email, the email service is working correctly!</p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666;">
            <p>© ${getEmailCopyrightYear()} 247 CutBend. All rights reserved.</p>
          </div>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Test email sent successfully:', result.messageId);
    
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('Test email failed:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendWelcomeEmail,
  sendLoginNotificationEmail,
  sendInquiryNotification,
  sendInquiryConfirmationEmail,
  sendQuotationEmail,
  sendQuotationSentEmail,
  sendOrderConfirmation,
  sendDispatchNotification,
  sendPaymentConfirmation,
  sendCustomerPaymentConfirmation,
  sendProductionStartedEmail,
  sendOrderReadyEmail,
  sendDeliveryConfirmation,
  sendDeliveryTimeNotification,
  sendQuoteFormEmail,
  sendSMS,
  testEmailService
};
