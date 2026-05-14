const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class PDFService {
  constructor() {
    this.doc = null;
  }

  // Generate quotation PDF
  async generateQuotationPDF(inquiry, quotationData) {
    return new Promise((resolve, reject) => {
      try {
        this.doc = new PDFDocument({
          size: 'A4',
          margins: {
            top: 50,
            bottom: 50,
            left: 50,
            right: 50
          }
        });

        // Create write stream
        const fileName = `quotation_${inquiry.inquiryNumber}_${Date.now()}.pdf`;
        const filePath = path.join(__dirname, '../uploads/quotations', fileName);
        
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const stream = fs.createWriteStream(filePath);
        this.doc.pipe(stream);

        // Generate PDF content
        this.generateQuotationContent(inquiry, quotationData);

        // Finalize PDF
        this.doc.end();

        stream.on('finish', () => {
          // Add a small delay to ensure file is fully written to disk
          setTimeout(() => {
            try {
              if (fs.existsSync(filePath)) {
                resolve({
                  fileName,
                  filePath,
                  fileSize: fs.statSync(filePath).size
                });
              } else {
                reject(new Error(`PDF file was not created at ${filePath}`));
              }
            } catch (error) {
              reject(error);
            }
          }, 100); // 100ms delay to ensure file is written
        });

        stream.on('error', (error) => {
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  // Generate quotation content
  generateQuotationContent(inquiry, quotationData) {
    // Header
    this.generateHeader(inquiry, quotationData);
    
    // Customer Information
    this.generateCustomerSection(inquiry);
    
    // Quotation Details
    this.generateQuotationDetails(inquiry, quotationData);
    
    // Parts Table
    this.generatePartsTable(quotationData.parts);
    
    // Terms and Conditions
    this.generateTermsSection(quotationData.terms);
    
    // Footer
    this.generateFooter();
  }

  // Generate header with company logo and info
  generateHeader(inquiry, quotationData) {
    // Company Logo (placeholder - replace with actual logo path)
    // this.doc.image(path.join(__dirname, '../assets/logo.png'), 50, 50, { width: 100 });
    
    // Company Information
    this.doc
      .fontSize(24)
      .font('Helvetica-Bold')
      .fillColor('#4CAF50')
      .text('KOMACUT', 50, 50);

    this.doc
      .fontSize(12)
      .font('Helvetica')
      .fillColor('#666666')
      .text('SHEET METAL PARTS ON DEMAND', 50, 80);

    this.doc
      .fontSize(10)
      .text('Delivering Factory Direct Quality Sheet Metal Parts Since 2005', 50, 95);

    // Quotation Title
    this.doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('QUOTATION', 400, 50);

    // Quotation Number
    this.doc
      .fontSize(12)
      .font('Helvetica')
      .text(`Quotation #: ${inquiry.inquiryNumber}`, 400, 75);

    // Date
    this.doc
      .fontSize(10)
      .text(`Date: ${new Date().toLocaleDateString()}`, 400, 90);

    // Valid Until
    this.doc
      .fontSize(10)
      .text(`Valid Until: ${new Date(quotationData.validUntil).toLocaleDateString()}`, 400, 105);
  }

  // Generate customer information section
  generateCustomerSection(inquiry) {
    this.doc.moveDown(2);
    
    this.doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Customer Information', 50, this.doc.y);

    this.doc.moveDown(0.5);

    const customer = inquiry.customer;
    this.doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Name: ${customer.firstName} ${customer.lastName}`, 50, this.doc.y);

    if (customer.companyName) {
      this.doc.text(`Company: ${customer.companyName}`, 50, this.doc.y + 15);
    }

    this.doc.text(`Email: ${customer.email}`, 50, this.doc.y + 15);
    
    if (customer.phoneNumber) {
      this.doc.text(`Phone: ${customer.phoneNumber}`, 50, this.doc.y + 15);
    }

    // Delivery Address
    if (inquiry.deliveryAddress) {
      this.doc.moveDown(0.5);
      this.doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('Delivery Address:', 50, this.doc.y);

      const addr = inquiry.deliveryAddress;
      this.doc
        .fontSize(10)
        .font('Helvetica')
        .text(`${addr.street}`, 50, this.doc.y + 15)
        .text(`${addr.city}, ${addr.state} ${addr.zipCode}`, 50, this.doc.y + 15)
        .text(`${addr.country}`, 50, this.doc.y + 15);
    }
  }

  // Generate quotation details
  generateQuotationDetails(inquiry, quotationData) {
    this.doc.moveDown(2);
    
    this.doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Quotation Summary', 50, this.doc.y);

    this.doc.moveDown(0.5);

    this.doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Inquiry Number: ${inquiry.inquiryNumber}`, 50, this.doc.y)
      .text(`Total Amount: ${quotationData.currency || 'INR'} ₹${quotationData.totalAmount.toFixed(2)}`, 50, this.doc.y + 15)
      .text(`Currency: ${quotationData.currency || 'INR'}`, 50, this.doc.y + 15);
  }

  // Generate parts table
  generatePartsTable(parts) {
    this.doc.moveDown(2);
    
    this.doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Parts & Pricing', 50, this.doc.y);

    this.doc.moveDown(0.5);

    // Table headers
    const headers = ['Part Ref', 'Material', 'Thickness', 'Quantity', 'Unit Price', 'Total'];
    const columnWidths = [80, 80, 60, 50, 70, 70];
    const startX = 50;
    let currentY = this.doc.y + 10;

    // Draw table headers
    this.doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#4CAF50');

    headers.forEach((header, index) => {
      this.doc.text(header, startX + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), currentY);
    });

    currentY += 20;

    // Draw table rows
    this.doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#000000');

    parts.forEach((part, rowIndex) => {
      const rowData = [
        part.partRef || `Part ${rowIndex + 1}`,
        part.material,
        `${part.thickness}mm`,
        part.quantity.toString(),
        `$${part.price.toFixed(2)}`,
        `$${(part.price * part.quantity).toFixed(2)}`
      ];

      rowData.forEach((cell, index) => {
        this.doc.text(cell, startX + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), currentY);
      });

      currentY += 15;

      // Add remarks if available
      if (part.remarks) {
        this.doc
          .fontSize(8)
          .fillColor('#666666')
          .text(`Remarks: ${part.remarks}`, startX + 10, currentY);
        currentY += 10;
      }

      currentY += 5;
    });

    // Total row
    currentY += 5;
    this.doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Total:', startX + columnWidths.slice(0, 4).reduce((a, b) => a + b, 0), currentY)
      .text(`$${parts.reduce((sum, part) => sum + (part.price * part.quantity), 0).toFixed(2)}`, startX + columnWidths.slice(0, 5).reduce((a, b) => a + b, 0), currentY);
  }

  // Generate terms and conditions section
  generateTermsSection(terms) {
    this.doc.moveDown(2);
    
    this.doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Terms & Conditions', 50, this.doc.y);

    this.doc.moveDown(0.5);

    this.doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666666')
      .text(terms, 50, this.doc.y, {
        width: 500,
        align: 'justify'
      });
  }

  // Generate footer
  generateFooter() {
    const pageCount = this.doc.bufferedPageRange().count;
    
    for (let i = 0; i < pageCount; i++) {
      this.doc.switchToPage(i);
      
      const pageHeight = this.doc.page.height;
      const footerY = pageHeight - 50;

      // Footer line
      this.doc
        .moveTo(50, footerY)
        .lineTo(550, footerY)
        .stroke();

      // Footer text
      this.doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#666666')
        .text(`© ${new Date().getFullYear()} Komacut. All rights reserved.`, 50, footerY + 10)
        .text('Delivering Factory Direct Quality Sheet Metal Parts Since 2005', 50, footerY + 20)
        .text('For questions, contact: support@komacut.com', 50, footerY + 30);

      // Page number
      this.doc
        .text(`Page ${i + 1} of ${pageCount}`, 500, footerY + 20);
    }
  }

  // Generate invoice PDF
  async generateInvoicePDF(order) {
    return new Promise((resolve, reject) => {
      try {
        this.doc = new PDFDocument({
          size: 'A4',
          margins: {
            top: 50,
            bottom: 50,
            left: 50,
            right: 50
          }
        });

        const fileName = `invoice_${order.orderNumber}_${Date.now()}.pdf`;
        const filePath = path.join(__dirname, '../uploads/invoices', fileName);
        
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const stream = fs.createWriteStream(filePath);
        this.doc.pipe(stream);

        this.generateInvoiceContent(order);
        this.doc.end();

        stream.on('finish', () => {
          resolve({
            fileName,
            filePath,
            fileSize: fs.statSync(filePath).size
          });
        });

        stream.on('error', (error) => {
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  // Generate invoice content
  generateInvoiceContent(order) {
    this.generateHeader(order);
    this.generateCustomerSection(order);
    this.generateInvoiceDetails(order);
    this.generateItemsTable(order.items);
    this.generatePaymentSection(order.payment);
    this.generateFooter();
  }

  // Generate invoice details
  generateInvoiceDetails(order) {
    this.doc.moveDown(2);
    
    this.doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Invoice Details', 50, this.doc.y);

    this.doc.moveDown(0.5);

    this.doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Invoice Number: ${order.orderNumber}`, 50, this.doc.y)
      .text(`Order Date: ${new Date(order.createdAt).toLocaleDateString()}`, 50, this.doc.y + 15)
      .text(`Due Date: ${new Date(order.createdAt).toLocaleDateString()}`, 50, this.doc.y + 15);
  }

  // Generate items table for invoice
  generateItemsTable(items) {
    this.doc.moveDown(2);
    
    this.doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Items', 50, this.doc.y);

    this.doc.moveDown(0.5);

    const headers = ['Part Ref', 'Material', 'Thickness', 'Quantity', 'Unit Price', 'Total'];
    const columnWidths = [80, 80, 60, 50, 70, 70];
    const startX = 50;
    let currentY = this.doc.y + 10;

    // Table headers
    this.doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#4CAF50');

    headers.forEach((header, index) => {
      this.doc.text(header, startX + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), currentY);
    });

    currentY += 20;

    // Table rows
    this.doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#000000');

    items.forEach((item, rowIndex) => {
      const rowData = [
        item.partRef || `Part ${rowIndex + 1}`,
        item.material,
        `${item.thickness}mm`,
        item.quantity.toString(),
        `$${item.unitPrice.toFixed(2)}`,
        `$${item.totalPrice.toFixed(2)}`
      ];

      rowData.forEach((cell, index) => {
        this.doc.text(cell, startX + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), currentY);
      });

      currentY += 15;
    });

    // Total
    currentY += 5;
    this.doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Total:', startX + columnWidths.slice(0, 4).reduce((a, b) => a + b, 0), currentY)
      .text(`₹${order.totalAmount.toFixed(2)}`, startX + columnWidths.slice(0, 5).reduce((a, b) => a + b, 0), currentY);
  }

  // Generate payment section
  generatePaymentSection(payment) {
    this.doc.moveDown(2);
    
    this.doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Payment Information', 50, this.doc.y);

    this.doc.moveDown(0.5);

    this.doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Status: ${payment.status}`, 50, this.doc.y)
      .text(`Method: ${payment.method}`, 50, this.doc.y + 15)
      .text(`Amount: INR ₹${payment.amount.toFixed(2)}`, 50, this.doc.y + 15);

    if (payment.transactionId) {
      this.doc.text(`Transaction ID: ${payment.transactionId}`, 50, this.doc.y + 15);
    }

    if (payment.paidAt) {
      this.doc.text(`Paid At: ${new Date(payment.paidAt).toLocaleString()}`, 50, this.doc.y + 15);
    }
  }
}

module.exports = new PDFService();
