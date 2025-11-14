const serverless = require("serverless-http");

// Impor 'app' yang SUDAH LENGKAP dari server.js
const app = require("../server.js");

// Ekspor 'app' tersebut agar bisa dijalankan Vercel
module.exports = serverless(app);