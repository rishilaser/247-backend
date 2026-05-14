const express = require('express');
const multer = require('multer');
const yauzl = require('yauzl');
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');
const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit for ZIP files
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'), false);
    }
  }
});

// Extract data from ZIP file
router.post('/extract-zip-data', upload.single('zip'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No ZIP file uploaded'
      });
    }

    console.log('ZIP file received:', req.file.originalname, 'Size:', req.file.size);

    // Extract ZIP file
    const extractedData = await extractZipFile(req.file.buffer);
    
    // Extract part specifications from all files
    const allParts = [];
    
    for (const fileData of extractedData) {
      console.log('Processing file:', fileData.name, 'Type:', fileData.type);
      
      if (fileData.type === 'pdf') {
        const parts = await extractFromPDF(fileData.content);
        allParts.push(...parts);
      } else if (fileData.type === 'excel') {
        const parts = await extractFromExcel(fileData.content);
        allParts.push(...parts);
      } else if (fileData.type === 'text') {
        const parts = extractFromText(fileData.content);
        allParts.push(...parts);
      }
    }

    // Remove duplicates and clean up
    const uniqueParts = removeDuplicateParts(allParts);

    console.log('Total parts extracted:', uniqueParts.length);

    res.json({
      success: true,
      parts: uniqueParts,
      filesProcessed: extractedData.length,
      message: `Extracted ${uniqueParts.length} parts from ${extractedData.length} files`
    });

  } catch (error) {
    console.error('ZIP extraction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to extract data from ZIP file',
      error: error.message
    });
  }
});

// Extract ZIP file contents
function extractZipFile(buffer) {
  return new Promise((resolve, reject) => {
    const files = [];
    
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }

      zipfile.readEntry();
      
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          // Directory entry
          zipfile.readEntry();
        } else {
          // File entry
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              reject(err);
              return;
            }

            const chunks = [];
            readStream.on('data', (chunk) => {
              chunks.push(chunk);
            });

            readStream.on('end', () => {
              const buffer = Buffer.concat(chunks);
              const fileName = entry.fileName.toLowerCase();
              
              let type = 'text';
              if (fileName.endsWith('.pdf')) {
                type = 'pdf';
              } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.xlsm')) {
                type = 'excel';
              }

              files.push({
                name: entry.fileName,
                type: type,
                content: buffer
              });

              zipfile.readEntry();
            });
          });
        }
      });

      zipfile.on('end', () => {
        resolve(files);
      });

      zipfile.on('error', (err) => {
        reject(err);
      });
    });
  });
}

// Extract data from PDF
async function extractFromPDF(buffer) {
  try {
    const pdfData = await pdfParse(buffer);
    const text = pdfData.text;
    return extractPartSpecifications(text);
  } catch (error) {
    console.error('PDF extraction error:', error);
    return [];
  }
}

// Extract data from Excel
async function extractFromExcel(buffer) {
  try {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const parts = [];
    
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);
      
      for (const row of data) {
        if (row.Material || row.material || row.MATERIAL) {
          parts.push({
            material: row.Material || row.material || row.MATERIAL || '',
            thickness: row.Thickness || row.thickness || row.THICKNESS || '',
            grade: row.Grade || row.grade || row.GRADE || '',
            quantity: parseInt(row.Quantity || row.quantity || row.QUANTITY || 0),
            remarks: row.Remarks || row.remarks || row.REMARKS || ''
          });
        }
      }
    }
    
    return parts;
  } catch (error) {
    console.error('Excel extraction error:', error);
    return [];
  }
}

// Extract data from text files
function extractFromText(buffer) {
  try {
    const text = buffer.toString('utf8');
    return extractPartSpecifications(text);
  } catch (error) {
    console.error('Text extraction error:', error);
    return [];
  }
}

// Extract part specifications from text
function extractPartSpecifications(text) {
  const parts = [];
  
  // Common patterns for part specifications
  const patterns = [
    // Pattern 1: Material, Thickness, Grade, Quantity format
    /(?:material|Material|MATERIAL)[\s:]*([^\n\r,]+)[\s,]*thickness[\s:]*([^\n\r,]+)[\s,]*grade[\s:]*([^\n\r,]+)[\s,]*quantity[\s:]*(\d+)/gi,
    
    // Pattern 2: Part specifications in table format
    /([A-Za-z\s]+)[\s]*([0-9.]+mm?)[\s]*([A-Za-z0-9-]+)[\s]*(\d+)/g,
    
    // Pattern 3: Material specifications
    /(Steel|Aluminum|Stainless|Copper|Brass|Mild Steel|Carbon Steel)[\s,]*([0-9.]+mm?)[\s,]*([A-Za-z0-9-]+)[\s,]*(\d+)/gi,
    
    // Pattern 4: Generic part specifications
    /([A-Za-z\s]+)[\s]*([0-9.]+)[\s]*([A-Za-z0-9-]+)[\s]*(\d+)/g
  ];

  // Try each pattern
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const material = match[1]?.trim() || '';
      const thickness = match[2]?.trim() || '';
      const grade = match[3]?.trim() || '';
      const quantity = match[4]?.trim() || '';

      // Validate extracted data
      if (material && thickness && grade && quantity && !isNaN(quantity)) {
        parts.push({
          material: material,
          thickness: thickness,
          grade: grade,
          quantity: parseInt(quantity),
          remarks: `Extracted from ZIP: ${material} ${thickness} ${grade}`
        });
      }
    }
  }

  return parts;
}

// Remove duplicate parts
function removeDuplicateParts(parts) {
  const unique = [];
  const seen = new Set();
  
  for (const part of parts) {
    const key = `${part.material}-${part.thickness}-${part.grade}-${part.quantity}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(part);
    }
  }
  
  return unique;
}

module.exports = router;
