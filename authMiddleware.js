const admin = require('firebase-admin');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ message: 'Unauthorized: Token tidak ada atau format salah' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  console.log("Middleware: Mencoba verifikasi token..."); // LOG PENTING

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    console.log("Middleware: Token berhasil diverifikasi. UID:", decodedToken.uid); // LOG PENTING
    
    req.user = decodedToken;
    next(); 
  } catch (error) {
    console.log("Middleware: GAGAL verifikasi token:", error.message); // LOG PENTING
    console.error('Error verifikasi token:', error);
    return res.status(403).send({ message: 'Forbidden: Token tidak valid' });
  }
};
module.exports = authMiddleware; // Ekspor fungsi agar bisa dipakai di server.js