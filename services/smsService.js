const twilio = require('twilio');
const axios = require('axios');

// Initialize Twilio client
let twilioClient = null;
let isTwilioConfigured = false;

// Alternative SMS providers for better reliability
const SMS_PROVIDERS = {
  TWILIO: 'twilio',
  TEXTLOCAL: 'textlocal',
  FAST2SMS: 'fast2sms'
};

const initializeTwilio = () => {
  try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && 
        process.env.TWILIO_ACCOUNT_SID.startsWith('AC') && 
        process.env.TWILIO_ACCOUNT_SID !== 'your-twilio-account-sid') {
      twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      isTwilioConfigured = true;
      console.log('Twilio SMS service initialized successfully');
    } else {
      console.warn('Twilio credentials not configured or invalid. SMS service will be disabled.');
      isTwilioConfigured = false;
    }
  } catch (error) {
    console.error('Failed to initialize Twilio:', error);
    isTwilioConfigured = false;
  }
};

// Send SMS using TextLocal (backup provider)
const sendSMSTextLocal = async (phoneNumber, message) => {
  try {
    if (!process.env.TEXTLOCAL_API_KEY) {
      return { success: false, message: 'TextLocal API key not configured' };
    }

    const response = await axios.post('https://api.textlocal.in/send/', {
      apikey: process.env.TEXTLOCAL_API_KEY,
      numbers: phoneNumber,
      message: message,
      sender: process.env.TEXTLOCAL_SENDER || 'KOMACUT'
    });

    if (response.data.status === 'success') {
      console.log(`SMS sent via TextLocal to ${phoneNumber}. Batch ID: ${response.data.batch_id}`);
      return { 
        success: true, 
        messageId: response.data.batch_id,
        provider: 'textlocal'
      };
    } else {
      return { success: false, error: response.data.errors[0].message };
    }

  } catch (error) {
    console.error('TextLocal SMS failed:', error);
    return { success: false, error: error.message };
  }
};

// Send SMS using Fast2SMS (backup provider)
const sendSMSFast2SMS = async (phoneNumber, message) => {
  try {
    if (!process.env.FAST2SMS_API_KEY) {
      return { success: false, message: 'Fast2SMS API key not configured' };
    }

    const response = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
      params: {
        authorization: process.env.FAST2SMS_API_KEY,
        message: message,
        language: 'english',
        route: 'v3',
        numbers: phoneNumber
      }
    });

    if (response.data.return === true) {
      console.log(`SMS sent via Fast2SMS to ${phoneNumber}. Request ID: ${response.data.request_id}`);
      return { 
        success: true, 
        messageId: response.data.request_id,
        provider: 'fast2sms'
      };
    } else {
      return { success: false, error: response.data.message };
    }

  } catch (error) {
    console.error('Fast2SMS failed:', error);
    return { success: false, error: error.message };
  }
};

// Send SMS with fallback providers
const sendSMS = async (phoneNumber, message) => {
  try {
    // Try Twilio first (primary)
    if (isTwilioConfigured && twilioClient) {
      // Format phone number (add + if not present)
      let formattedNumber = phoneNumber;
      if (!phoneNumber.startsWith('+')) {
        formattedNumber = `+${phoneNumber}`;
      }

      const result = await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedNumber
      });

      console.log(`SMS sent successfully via Twilio to ${phoneNumber}. SID: ${result.sid}`);
      return { 
        success: true, 
        messageId: result.sid,
        status: result.status,
        to: result.to,
        provider: 'twilio'
      };
    }

    // Fallback to TextLocal
    const textLocalResult = await sendSMSTextLocal(phoneNumber, message);
    if (textLocalResult.success) {
      return textLocalResult;
    }

    // Fallback to Fast2SMS
    const fast2smsResult = await sendSMSFast2SMS(phoneNumber, message);
    if (fast2smsResult.success) {
      return fast2smsResult;
    }

    // All providers failed
    console.log(`SMS to ${phoneNumber}: ${message} (All SMS providers failed)`);
    return { success: false, message: 'All SMS services unavailable' };

  } catch (error) {
    console.error('SMS sending failed:', error);
    return { 
      success: false, 
      error: error.message,
      code: error.code 
    };
  }
};

// Send bulk SMS to multiple numbers
const sendBulkSMS = async (phoneNumbers, message) => {
  try {
    if (!isTwilioConfigured || !twilioClient) {
      console.log(`Bulk SMS to ${phoneNumbers.length} numbers: ${message} (Twilio not configured)`);
      return { success: false, message: 'SMS service not configured' };
    }

    const results = [];
    const promises = phoneNumbers.map(async (phoneNumber) => {
      const result = await sendSMS(phoneNumber, message);
      results.push({ phoneNumber, result });
      return result;
    });

    await Promise.all(promises);
    
    const successCount = results.filter(r => r.result.success).length;
    console.log(`Bulk SMS completed: ${successCount}/${phoneNumbers.length} successful`);
    
    return {
      success: true,
      total: phoneNumbers.length,
      successful: successCount,
      failed: phoneNumbers.length - successCount,
      results
    };

  } catch (error) {
    console.error('Bulk SMS failed:', error);
    return { success: false, error: error.message };
  }
};

// Send inquiry notification SMS
const sendInquiryNotificationSMS = async (inquiry, customerInfo) => {
  try {
    if (!process.env.BACKOFFICE_PHONE) {
      console.warn('Back office phone number not configured for SMS notifications');
      console.log('SMS to Back Office: New inquiry notification (phone not configured)');
      return { success: false, message: 'Back office phone not configured' };
    }

    const message = `New inquiry ${inquiry.inquiryNumber} received from ${customerInfo.firstName} ${customerInfo.lastName}. ${inquiry.parts.length} parts, ${inquiry.files.length} files. Please review.`;
    
    const result = await sendSMS(process.env.BACKOFFICE_PHONE, message);
    console.log('Inquiry notification SMS result:', result);
    return result;

  } catch (error) {
    console.error('Inquiry notification SMS failed:', error);
    return { success: false, error: error.message };
  }
};

// Send quotation notification SMS
const sendQuotationNotificationSMS = async (quotation, customerInfo) => {
  try {
    if (!customerInfo.phoneNumber) {
      console.warn('Customer phone number not available for quotation SMS');
      console.log('SMS to Customer: Quotation notification (phone not available)');
      return { success: false, message: 'Customer phone not available' };
    }

    const message = `Quotation ${quotation.quotationNumber} ready for inquiry ${quotation.inquiry.inquiryNumber}. Total: ₹${quotation.totalAmount}. Valid until ${new Date(quotation.validUntil).toLocaleDateString()}. Check your email for details.`;
    
    const result = await sendSMS(customerInfo.phoneNumber, message);
    console.log('Quotation notification SMS result:', result);
    return result;

  } catch (error) {
    console.error('Quotation notification SMS failed:', error);
    return { success: false, error: error.message };
  }
};

// Send order confirmation SMS
const sendOrderConfirmationSMS = async (order, customerInfo) => {
  try {
    if (!customerInfo.phoneNumber) {
      console.warn('Customer phone number not available for order confirmation SMS');
      console.log('SMS to Customer: Order confirmation (phone not available)');
      return { success: false, message: 'Customer phone not available' };
    }

    const message = `Order ${order.orderNumber} confirmed! Production started. Estimated completion: ${new Date(order.production.estimatedCompletion).toLocaleDateString()}. We'll keep you updated.`;
    
    const result = await sendSMS(customerInfo.phoneNumber, message);
    console.log('Order confirmation SMS result:', result);
    return result;

  } catch (error) {
    console.error('Order confirmation SMS failed:', error);
    return { success: false, error: error.message };
  }
};

// Send dispatch notification SMS
const sendDispatchNotificationSMS = async (order, customerInfo) => {
  try {
    if (!customerInfo.phoneNumber) {
      console.warn('Customer phone number not available for dispatch SMS');
      console.log('SMS to Customer: Dispatch notification (phone not available)');
      return { success: false, message: 'Customer phone not available' };
    }

    const message = `Order ${order.orderNumber} dispatched! Tracking: ${order.dispatch.trackingNumber}. Courier: ${order.dispatch.courier}. Estimated delivery: ${new Date(order.dispatch.estimatedDelivery).toLocaleDateString()}.`;
    
    const result = await sendSMS(customerInfo.phoneNumber, message);
    console.log('Dispatch notification SMS result:', result);
    return result;

  } catch (error) {
    console.error('Dispatch notification SMS failed:', error);
    return { success: false, error: error.message };
  }
};

// Send payment confirmation SMS to back office
const sendPaymentConfirmationSMS = async (order, customerInfo) => {
  try {
    if (!process.env.BACKOFFICE_PHONE) {
      console.warn('Back office phone number not configured for payment confirmation SMS');
      console.log('SMS to Back Office: Payment confirmation (phone not configured)');
      return { success: false, message: 'Back office phone not configured' };
    }

    const message = `Payment confirmed for order ${order.orderNumber}. Customer: ${customerInfo.firstName} ${customerInfo.lastName}. Amount: ₹${order.totalAmount}. Please update order status.`;
    
    const result = await sendSMS(process.env.BACKOFFICE_PHONE, message);
    console.log('Payment confirmation SMS result:', result);
    return result;

  } catch (error) {
    console.error('Payment confirmation SMS failed:', error);
    return { success: false, error: error.message };
  }
};

// Send delivery time notification SMS
const sendDeliveryTimeNotificationSMS = async (order, customerInfo) => {
  try {
    if (!customerInfo.phoneNumber) {
      console.warn('Customer phone number not available for delivery time SMS');
      console.log('SMS to Customer: Delivery time updated (phone not available)');
      return { success: false, message: 'Customer phone not available' };
    }

    const message = `Delivery time updated for order ${order.orderNumber}. Estimated delivery: ${order.production?.estimatedCompletion ? new Date(order.production.estimatedCompletion).toLocaleDateString() : 'TBD'}. Track your order at ${process.env.CLIENT_URL || 'http://localhost:3000'}/order/${order._id}/tracking`;
    
    const result = await sendSMS(customerInfo.phoneNumber, message);
    console.log('Delivery time notification SMS result:', result);
    return result;

  } catch (error) {
    console.error('Delivery time notification SMS failed:', error);
    return { success: false, error: error.message };
  }
};

// Send delivery confirmation SMS
const sendDeliveryConfirmationSMS = async (order, customerInfo) => {
  try {
    if (!customerInfo.phoneNumber) {
      console.warn('Customer phone number not available for delivery confirmation SMS');
      console.log('SMS to Customer: Order delivered (phone not available)');
      return { success: false, message: 'Customer phone not available' };
    }

    const message = `Order ${order.orderNumber} has been delivered successfully! Thank you for choosing Komacut. We hope you're satisfied with your sheet metal parts.`;
    
    const result = await sendSMS(customerInfo.phoneNumber, message);
    console.log('Delivery confirmation SMS result:', result);
    return result;

  } catch (error) {
    console.error('Delivery confirmation SMS failed:', error);
    return { success: false, error: error.message };
  }
};

// Initialize Twilio when module is loaded
initializeTwilio();

module.exports = {
  sendSMS,
  sendBulkSMS,
  sendInquiryNotificationSMS,
  sendQuotationNotificationSMS,
  sendOrderConfirmationSMS,
  sendDispatchNotificationSMS,
  sendPaymentConfirmationSMS,
  sendDeliveryTimeNotificationSMS,
  sendDeliveryConfirmationSMS,
  isTwilioConfigured
};
