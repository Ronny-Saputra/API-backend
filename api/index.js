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

