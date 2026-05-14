const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit for PDFs
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Extract data from PDF
router.post('/extract-pdf-data', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No PDF file uploaded'
      });
    }

    // Parse PDF content
    const pdfData = await pdfParse(req.file.buffer);
    const text = pdfData.text;

    console.log('PDF Text extracted:', text);

    // Extract part specifications and pricing from PDF text
    const extractionResult = extractPartSpecificationsAndPricing(text);

    res.json({
      success: true,
      parts: extractionResult.parts,
      totalAmount: extractionResult.totalAmount,
      extractedText: text
    });

  } catch (error) {
    console.error('PDF extraction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to extract data from PDF',
      error: error.message
    });
  }
});

// Function to extract part specifications and pricing from PDF text
function extractPartSpecificationsAndPricing(text) {
  const parts = [];
  let totalAmount = 0;
  
  // First, try to extract pricing sheet data specifically
  const pricingSheetPattern = /MATERIAL PRICES \(Per Piece\):([\s\S]*?)(?:BULK DISCOUNTS|TERMS|Contact:)/i;
  const pricingSheetMatch = text.match(pricingSheetPattern);
  
  if (pricingSheetMatch) {
    console.log('Found pricing sheet format, extracting specific patterns...');
    const pricingSection = pricingSheetMatch[1];
    
    // Extract each pricing line
    const pricingLines = pricingSection.split('\n').filter(line => line.trim());
    
    pricingLines.forEach(line => {
      // Match patterns like "1. Stainless Steel 2.0mm - $25.00"
      const lineMatch = line.match(/(\d+\.\s*)?([A-Za-z\s]+)\s+([0-9.]+mm?)\s*-\s*\$?([0-9,]+\.?[0-9]*)/i);
      if (lineMatch) {
        const material = lineMatch[2].trim();
        const thickness = lineMatch[3].trim();
        const price = parseFloat(lineMatch[4].replace(/,/g, ''));
        
        if (material && thickness && price > 0) {
          parts.push({
            material: material,
            thickness: thickness,
            grade: 'Standard',
            quantity: 1,
            unitPrice: price,
            totalPrice: price,
            remarks: `Extracted from pricing sheet: ${material} ${thickness}`
          });
        }
      }
    });
  }

  // First, try to extract total amount from common patterns
  const totalAmountPatterns = [
    /(?:total|Total|TOTAL)[\s:]*\$?([0-9,]+\.?[0-9]*)/gi,
    /(?:amount|Amount|AMOUNT)[\s:]*\$?([0-9,]+\.?[0-9]*)/gi,
    /(?:grand total|Grand Total|GRAND TOTAL)[\s:]*\$?([0-9,]+\.?[0-9]*)/gi,
    /(?:final total|Final Total|FINAL TOTAL)[\s:]*\$?([0-9,]+\.?[0-9]*)/gi,
    /\$([0-9,]+\.?[0-9]*)\s*(?:total|Total|TOTAL)/gi,
    /(?:subtotal|Subtotal|SUBTOTAL)[\s:]*\$?([0-9,]+\.?[0-9]*)/gi
  ];

  for (const pattern of totalAmountPatterns) {
    const match = pattern.exec(text);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(amount) && amount > totalAmount) {
        totalAmount = amount;
      }
    }
  }

  // Common patterns for part specifications with pricing
  const patterns = [
    // Pattern 1: Material pricing sheet format (e.g., "Stainless Steel 2.0mm - $25.00")
    /([A-Za-z\s]+)\s+([0-9.]+mm?)\s*-\s*\$?([0-9,]+\.?[0-9]*)/gi,
    
    // Pattern 2: Numbered list format (e.g., "1. Stainless Steel 2.0mm - $25.00")
    /\d+\.\s*([A-Za-z\s]+)\s+([0-9.]+mm?)\s*-\s*\$?([0-9,]+\.?[0-9]*)/gi,
    
    // Pattern 3: Material, Thickness, Grade, Quantity, Price format
    /(?:material|Material|MATERIAL)[\s:]*([^\n\r,]+)[\s,]*thickness[\s:]*([^\n\r,]+)[\s,]*grade[\s:]*([^\n\r,]+)[\s,]*quantity[\s:]*(\d+)[\s,]*price[\s:]*\$?([0-9,]+\.?[0-9]*)/gi,
    
    // Pattern 4: Part specifications in table format with pricing
    /([A-Za-z\s]+)[\s]*([0-9.]+mm?)[\s]*([A-Za-z0-9-]+)[\s]*(\d+)[\s]*\$?([0-9,]+\.?[0-9]*)/g,
    
    // Pattern 5: Material specifications with pricing
    /(Steel|Aluminum|Stainless|Copper|Brass|Mild Steel|Carbon Steel|Zintec)[\s,]*([0-9.]+mm?)[\s,]*([A-Za-z0-9-]+)[\s,]*(\d+)[\s,]*\$?([0-9,]+\.?[0-9]*)/gi,
    
    // Pattern 6: Generic part specifications with pricing
    /([A-Za-z\s]+)[\s]*([0-9.]+)[\s]*([A-Za-z0-9-]+)[\s]*(\d+)[\s]*\$?([0-9,]+\.?[0-9]*)/g,
    
    // Pattern 7: More flexible pricing patterns
    /([A-Za-z\s]+)[\s]*([0-9.]+mm?)[\s]*(\d+)[\s]*\$?([0-9,]+\.?[0-9]*)/g,
    
    // Pattern 8: Simple material and price
    /([A-Za-z\s]+)[\s]*\$?([0-9,]+\.?[0-9]*)/g,
    
    // Pattern 9: Look for any number followed by currency symbol
    /\$([0-9,]+\.?[0-9]*)/g
  ];

  // Try each pattern
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const material = match[1]?.trim() || '';
      const thickness = match[2]?.trim() || '';
      const grade = match[3]?.trim() || '';
      const quantity = match[4]?.trim() || '';
      const price = match[5]?.trim() || '';

      // For patterns with fewer groups, adjust accordingly
      let actualMaterial = material;
      let actualThickness = thickness;
      let actualGrade = grade;
      let actualQuantity = quantity;
      let actualPrice = price;

      // Handle different pattern structures
      if (pattern.source.includes('Material pricing sheet format') || pattern.source.includes('Numbered list format')) {
        // For patterns like "Stainless Steel 2.0mm - $25.00" or "1. Stainless Steel 2.0mm - $25.00"
        actualMaterial = match[1].trim();
        actualThickness = match[2].trim();
        actualGrade = 'Standard';
        actualQuantity = '1'; // Default quantity for pricing sheets
        actualPrice = match[3].trim();
      } else if (pattern.source.includes('Simple material and price')) {
        actualMaterial = match[1];
        actualThickness = '1.5';
        actualGrade = 'Standard';
        actualQuantity = '1';
        actualPrice = match[2];
      } else if (pattern.source.includes('More flexible pricing patterns')) {
        actualMaterial = match[1];
        actualThickness = match[2];
        actualGrade = 'Standard';
        actualQuantity = match[3];
        actualPrice = match[4];
      } else if (pattern.source.includes('Look for any number followed by currency')) {
        // This pattern only extracts price, we'll use it to enhance existing parts
        const foundPrice = parseFloat(match[1].replace(/,/g, ''));
        if (foundPrice > 0 && parts.length > 0) {
          // Apply this price to the last part if it doesn't have a price
          const lastPart = parts[parts.length - 1];
          if (lastPart.unitPrice === 0) {
            lastPart.unitPrice = foundPrice;
            lastPart.totalPrice = foundPrice * lastPart.quantity;
          }
        }
        continue;
      }

      // Validate extracted data
      if (actualMaterial && actualQuantity && !isNaN(actualQuantity)) {
        const unitPrice = actualPrice ? parseFloat(actualPrice.replace(/,/g, '')) : 0;
        const totalPrice = unitPrice * parseInt(actualQuantity);
        
        parts.push({
          material: actualMaterial,
          thickness: actualThickness || '1.5',
          grade: actualGrade || 'Standard',
          quantity: parseInt(actualQuantity),
          unitPrice: unitPrice,
          totalPrice: totalPrice,
          remarks: `Extracted from PDF: ${actualMaterial} ${actualThickness || '1.5'} ${actualGrade || 'Standard'}`
        });
      }
    }
  }

  // If no parts found with pricing, try to extract without pricing
  if (parts.length === 0) {
    const basicPatterns = [
      /(?:material|Material|MATERIAL)[\s:]*([^\n\r,]+)[\s,]*thickness[\s:]*([^\n\r,]+)[\s,]*grade[\s:]*([^\n\r,]+)[\s,]*quantity[\s:]*(\d+)/gi,
      /([A-Za-z\s]+)[\s]*([0-9.]+mm?)[\s]*([A-Za-z0-9-]+)[\s]*(\d+)/g,
      /(Steel|Aluminum|Stainless|Copper|Brass|Mild Steel|Carbon Steel)[\s,]*([0-9.]+mm?)[\s,]*([A-Za-z0-9-]+)[\s,]*(\d+)/gi,
      /([A-Za-z\s]+)[\s]*([0-9.]+)[\s]*([A-Za-z0-9-]+)[\s]*(\d+)/g
    ];

    for (const pattern of basicPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const material = match[1]?.trim() || '';
        const thickness = match[2]?.trim() || '';
        const grade = match[3]?.trim() || '';
        const quantity = match[4]?.trim() || '';

        if (material && thickness && grade && quantity && !isNaN(quantity)) {
          parts.push({
            material: material,
            thickness: thickness,
            grade: grade,
            quantity: parseInt(quantity),
            unitPrice: 0,
            totalPrice: 0,
            remarks: `Extracted from PDF: ${material} ${thickness} ${grade}`
          });
        }
      }
    }
  }

  // If still no parts found, try to extract common specifications
  if (parts.length === 0) {
    const materialMatches = text.match(/(Steel|Aluminum|Stainless|Copper|Brass|Mild Steel|Carbon Steel)/gi);
    const thicknessMatches = text.match(/([0-9.]+mm?)/g);
    const quantityMatches = text.match(/(\d+)\s*(?:pcs|pieces|units|qty|quantity)/gi);

    if (materialMatches && thicknessMatches && quantityMatches) {
      const material = materialMatches[0];
      const thickness = thicknessMatches[0];
      const quantity = quantityMatches[0].match(/\d+/)[0];

      parts.push({
        material: material,
        thickness: thickness,
        grade: 'Standard',
        quantity: parseInt(quantity),
        unitPrice: 0,
        totalPrice: 0,
        remarks: 'Extracted from PDF specifications'
      });
    }
  }

  // If still no parts found, create a default part
  if (parts.length === 0) {
    parts.push({
      material: 'Steel',
      thickness: '2mm',
      grade: 'A36',
      quantity: 100,
      unitPrice: 0,
      totalPrice: 0,
      remarks: 'Default specification - please update as needed'
    });
  }

  // If parts were extracted but have no pricing, apply fallback pricing
  if (parts.length > 0 && parts.every(part => part.unitPrice === 0)) {
    console.log('No pricing found in PDF, applying fallback pricing...');
    
    // Apply fallback pricing based on material and thickness
    const fallbackPricing = {
      'Zintec': {
        '1.5mm': 15.00,
        '2.0mm': 20.00,
        'default': 17.50
      },
      'Stainless Steel': {
        '2.0mm': 25.00,
        '3.0mm': 35.00,
        'default': 30.00
      },
      'Mild Steel': {
        '1.5mm': 12.00,
        '2.0mm': 18.00,
        'default': 15.00
      },
      'Aluminum': {
        '1.0mm': 22.00,
        '2.0mm': 28.00,
        'default': 25.00
      },
      'Copper': {
        '1.0mm': 45.00,
        'default': 45.00
      },
      'Brass': {
        '1.5mm': 38.00,
        'default': 38.00
      },
      'Steel': {
        'default': 20.00
      }
    };
    
    parts.forEach(part => {
      const materialPricing = fallbackPricing[part.material] || fallbackPricing['Steel'];
      const thicknessPricing = materialPricing[part.thickness] || materialPricing['default'];
      const materialPrice = thicknessPricing || 20.00; // Final fallback
      
      part.unitPrice = materialPrice;
      part.totalPrice = materialPrice * part.quantity;
      part.remarks = `${part.remarks} (Fallback pricing applied: $${materialPrice} for ${part.material} ${part.thickness})`;
    });
    
    // Recalculate total amount
    totalAmount = parts.reduce((sum, part) => sum + (part.totalPrice || 0), 0);
  }

  // Calculate total amount from parts if not found directly
  if (totalAmount === 0) {
    totalAmount = parts.reduce((sum, part) => sum + (part.totalPrice || 0), 0);
  }

  return { parts, totalAmount };
}

module.exports = router;
