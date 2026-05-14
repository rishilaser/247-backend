const errorHandler = (err, req, res, next) => {
  console.error('Error occurred:', err);

  // Default error
  let error = {
    message: 'Internal Server Error',
    status: 500
  };

  // Handle specific error types
  if (err.name === 'ValidationError') {
    error.message = 'Validation Error';
    error.status = 400;
    error.details = Object.values(err.errors).map(e => e.message);
  } else if (err.name === 'CastError') {
    error.message = 'Invalid ID format';
    error.status = 400;
  } else if (err.code === 11000) {
    error.message = 'Duplicate field value';
    error.status = 400;
  } else if (err.name === 'JsonWebTokenError') {
    error.message = 'Invalid token';
    error.status = 401;
  } else if (err.name === 'TokenExpiredError') {
    error.message = 'Token expired';
    error.status = 401;
  } else if (err.name === 'MulterError') {
    // Handle Multer file upload errors
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        error.message = `File too large. Maximum file size is 500MB. File "${err.field}" exceeded the limit.`;
        error.status = 413;
        break;
      case 'LIMIT_FILE_COUNT':
        error.message = 'Too many files. Maximum 10 files allowed.';
        error.status = 413;
        break;
      case 'LIMIT_FIELD_COUNT':
        error.message = 'Too many form fields.';
        error.status = 413;
        break;
      case 'LIMIT_FIELD_SIZE':
        error.message = 'Field value too large.';
        error.status = 413;
        break;
      default:
        error.message = `Upload error: ${err.message}`;
        error.status = 413;
    }
  } else if (err.message) {
    error.message = err.message;
    error.status = err.status || 500;
  }

  // Send error response
  res.status(error.status).json({
    success: false,
    message: error.message,
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      details: error.details 
    })
  });
};

module.exports = errorHandler;
