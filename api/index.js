const serverless = require("serverless-http");

// Impor 'app' yang SUDAH LENGKAP dari server.js
const app = require("../server.js");

module.exports = serverless(app, {
  binary: false,
  request: (request, event, context) => {
    // Pastikan headers content-length benar
    if (request.headers['content-length']) {
      request.headers['content-length'] = String(request.body ? Buffer.byteLength(request.body) : 0);
    }
  }
});

module.exports = async (req, res) => {
  // ✅ Hapus body dari GET request untuk menghindari content-length mismatch
  if (req.method === 'GET' || req.method === 'HEAD') {
    delete req.headers['content-length'];
    req.body = undefined;
  }
  
  const handler = serverless(app);
  return handler(req, res);
};

