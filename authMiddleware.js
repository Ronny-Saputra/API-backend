const admin = require('firebase-admin');

const authMiddleware = async (req, res, next) => {
  // 1. Ambil token dari header 'Authorization'
  const authHeader = req.headers.authorization;

  // 2. Cek apakah token ada dan formatnya benar ('Bearer <token>')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ message: 'Unauthorized: Token tidak ada atau format salah' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  console.log("Middleware: Mencoba verifikasi token...");

  // 3. Verifikasi token menggunakan Firebase Admin
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // 4. Jika token valid, simpan info pengguna di 'req.user'
    //    Supaya bisa dipakai di endpoint lain (PENTING!)
    req.user = decodedToken;
    console.log("Middleware: Token berhasil diverifikasi. UID:", decodedToken.uid);
    // 5. Lanjutkan ke request berikutnya (endpoint)
    next(); 
  } catch (error) {
    console.error('Error verifikasi token:', error);
    return res.status(403).send({ message: 'Forbidden: Token tidak valid' });
  }
};

module.exports = authMiddleware; // Ekspor fungsi agar bisa dipakai di server.js