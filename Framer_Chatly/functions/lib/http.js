/**
 * Minimal helpers for serverless handlers.
 */
function json(res, statusCode, data) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
  }
  
  function badRequest(res, message = 'Bad request') {
    json(res, 400, { error: message });
  }
  
  function unauthorized(res, message = 'Unauthorized') {
    json(res, 401, { error: message });
  }
  
  function methodNotAllowed(res, methods = ['GET']) {
    res.setHeader('Allow', methods.join(', '));
    json(res, 405, { error: `Method Not Allowed. Allowed: ${methods.join(', ')}` });
  }
  
  function parseBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => (data += chunk));
      req.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }
  
  module.exports = {
    json,
    badRequest,
    unauthorized,
    methodNotAllowed,
    parseBody
  };