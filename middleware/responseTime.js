/**
 * Response Time Middleware
 * Logs response time for all API requests
 */

const responseTime = (req, res, next) => {
  const startTime = Date.now();
  
  // Override res.json to log response time
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    const responseTime = Date.now() - startTime;
    
    // Log slow requests (>1 second)
    if (responseTime > 1000) {
      console.warn(`⚠️  SLOW REQUEST: ${req.method} ${req.path} - ${responseTime}ms`);
    } else {
      console.log(`⚡ ${req.method} ${req.path} - ${responseTime}ms`);
    }
    
    // Add response time to response data if it's a success response
    if (data && typeof data === 'object' && data.success) {
      data.responseTime = `${responseTime}ms`;
    }
    
    return originalJson(data);
  };
  
  next();
};

module.exports = responseTime;

