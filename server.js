// 1. Impor semua library yang kita butuhkan

// Panggil 'dotenv' paling atas agar semua file lain bisa membaca .env
require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// 2. Inisialisasi Firebase Admin
//    SDK secara otomatis akan mencari variabel lingkungan 
//    'GOOGLE_APPLICATION_CREDENTIALS' yang kita set di .env
try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
  console.log("Berhasil terhubung ke Firebase Admin");
} catch (error) {
  console.error("Error koneksi Firebase Admin:", error);
  process.exit(1); // Keluar dari aplikasi jika tidak bisa konek
}

// Buat "shortcut" untuk mengakses Firestore
const db = admin.firestore();

// 3. Inisialisasi Aplikasi Express
const app = express();
const PORT = process.env.PORT || 3001; // Gunakan port 3001
const authMiddleware = require('./authMiddleware');

// 4. Terapkan Middleware
//    'cors' mengizinkan frontend kita (di domain berbeda) mengakses API ini
app.use(cors()); 
//    'express.json' mengizinkan server membaca data JSON dari 'req.body'
app.use(express.json()); 

app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid; 
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).send({ message: 'Profil pengguna tidak ditemukan' });
    }
    res.status(200).send(userDoc.data());
  } catch (error) {
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});

app.put('/api/profile', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { name, username, gender, profileImageUrI1 } = req.body; 

    const userRef = db.collection('users').doc(uid);
    
    await userRef.set({
      name: name,
      username: username,
      gender: gender,
      profileImageUrI1: profileImageUrI1, // Pastikan nama field sama persis
      updatedAt: admin.firestore.FieldValue.serverTimestamp() // Praktik terbaik
    }, { merge: true });

    res.status(200).send({ message: 'Profil berhasil diperbarui' });
  } catch (error) {
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});


// --- Rute 'Tasks' (CRUD LENGKAP - Versi Revisi) ---

/**
 * [POST] /api/tasks
 * Membuat 'task' baru di dalam subcollection pengguna.
 */
app.post('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    // Ambil data dari body, sesuai struktur di gambar Anda
    const { title, details, category, dueDate, priority } = req.body;

    if (!title) {
      return res.status(400).send({ message: 'Title (judul) tidak boleh kosong' });
    }

    // Tentukan path ke subcollection 'tasks' milik pengguna
    const tasksCollection = db.collection('users').doc(uid).collection('tasks');

    const newTask = {
      userId: uid, // Tetap simpan ini, bagus untuk security rules
      title: title,
      details: details || "",
      category: category || "None",
      priority: priority || "None",
      status: "pending", // Status default saat dibuat
      
      // Gunakan timestamp server untuk konsistensi
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      
      // Sesuai struktur Anda
      dueDate: dueDate ? new Date(dueDate) : null,
      completedAt: null,
      deletedAt: null
      // Anda bisa tambahkan field lain seperti 'flowDurationMillis' di sini
    };

    const docRef = await tasksCollection.add(newTask);

    res.status(201).send({ id: docRef.id, ...newTask });
  } catch (error) {
    console.error('Error membuat task:', error);
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});

/**
 * [GET] /api/tasks
 * Mengambil SEMUA 'tasks' dari subcollection pengguna (yang tidak di-soft-delete).
 */
app.get('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;

    // Tentukan path ke subcollection 'tasks'
    const tasksCollection = db.collection('users').doc(uid).collection('tasks');

    // Kueri untuk mengambil tugas yang 'deletedAt'-nya null
    // dan urutkan berdasarkan yang terbaru
    const snapshot = await tasksCollection
                             .where('deletedAt', '==', null) // Hanya ambil yang tidak di-soft-delete
                             .orderBy('createdAt', 'desc') // Tampilkan yang terbaru dulu
                             .get();

    if (snapshot.empty) {
      return res.status(200).send([]); // Kirim array kosong
    }

    const tasks = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).send(tasks);
  } catch (error) {
    console.error('Error mengambil tasks:', error);
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});

/**
 * [PUT] /api/tasks/:taskId
 * Memperbarui 'task' spesifik di dalam subcollection pengguna.
 * :taskId adalah ID dari dokumen tugas.
 */
app.put('/api/tasks/:taskId', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { taskId } = req.params; // Ambil ID tugas dari URL
    const updateData = req.body;   // Ambil data baru dari body

    // Jangan biarkan 'userId' atau 'createdAt' diubah
    delete updateData.userId;
    delete updateData.createdAt;

    // Selalu perbarui 'updatedAt'
    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    
    // Jika status diubah jadi 'completed', set 'completedAt'
    if (updateData.status === 'completed') {
      updateData.completedAt = admin.firestore.FieldValue.serverTimestamp();
    } else if (updateData.status) {
      // Jika status diubah kembali (misal ke 'pending'), hapus completedAt
      updateData.completedAt = null;
    }

    // Tentukan path ke DOKUMEN task spesifik
    const taskRef = db.collection('users').doc(uid).collection('tasks').doc(taskId);

    // Cek dulu apakah dokumennya ada
    const doc = await taskRef.get();
    if (!doc.exists) {
      return res.status(404).send({ message: 'Tugas tidak ditemukan' });
    }

    await taskRef.update(updateData);

    res.status(200).send({ message: 'Tugas berhasil diperbarui' });
  } catch (error) {
    console.error('Error memperbarui task:', error);
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});

/**
 * [DELETE] /api/tasks/:taskId
 * Melakukan SOFT DELETE pada 'task' spesifik.
 * :taskId adalah ID dari dokumen tugas.
 */
app.delete('/api/tasks/:taskId', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { taskId } = req.params;

    // Tentukan path ke DOKUMEN task spesifik
    const taskRef = db.collection('users').doc(uid).collection('tasks').doc(taskId);

    // Cek dulu apakah dokumennya ada
    const doc = await taskRef.get();
    if (!doc.exists) {
      return res.status(404).send({ message: 'Tugas tidak ditemukan' });
    }

    // Lakukan 'Soft Delete' dengan mengatur 'deletedAt' dan 'status'
    await taskRef.update({
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "deleted"
    });

    res.status(200).send({ message: 'Tugas berhasil dihapus (soft delete)' });
  } catch (error) {
    console.error('Error menghapus task:', error);
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});
// 6. Jalankan Server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});