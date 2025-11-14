
require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;

// 1. Konfigurasi Cloudinary menggunakan file .env
cloudinary.config({   
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 2. Inisialisasi Firebase Admin
//    SDK secara otomatis akan mencari variabel lingkungan 
//    'GOOGLE_APPLICATION_CREDENTIALS' yang kita set di .env
// 2. Inisialisasi Firebase Admin
let credential;

if (process.env.NODE_ENV === "production") {
  // Di Vercel (Produksi), ambil kredensial dari Environment Variables
  // Ini adalah kode yang LEBIH AMAN
  credential = admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    // Cek dulu apakah privateKey ada, baru lakukan .replace()
    privateKey: process.env.FIREBASE_PRIVATE_KEY 
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") 
      : undefined,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL
  });

} else {
  // Di lokal (Development), gunakan file service account (creds.json)
  credential = admin.credential.applicationDefault();
}

try {
  // Cek agar tidak terjadi inisialisasi ganda
  if (admin.apps.length === 0) {
    admin.initializeApp({ credential });
    console.log("Berhasil terhubung ke Firebase Admin");
  }
} catch (error) {
  console.error("Error koneksi Firebase Admin:", error);
  // Log error yang lebih detail untuk debugging
  console.error("Detail Error:", error.message); 
  process.exit(1); // Keluar dari aplikasi jika tidak bisa konek
}

// Buat "shortcut" untuk mengakses Firestore
const db = admin.firestore();

// 3. Inisialisasi Aplikasi Express
const app = express();
const authMiddleware = require('./authMiddleware');

// 4. Terapkan Middleware
//    'cors' mengizinkan frontend kita (di domain berbeda) mengakses API ini
app.use(cors()); 
//    'express.json' mengizinkan server membaca data JSON dari 'req.body'
app.use(express.json()); 

app.get('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    // 1. Ambil 'date' DARI req.query
    const { search, month, date } = req.query; 

    const tasksCollection = db.collection('users').doc(uid).collection('tasks');
    
    // 2. Mulai kueri dasar
    let query = tasksCollection.where('deletedAt', '==', null);

    // 3. Terapkan filter TANGGAL (PRIORITAS UTAMA)
    if (date) {
      // 'date' diharapkan dalam format "YYYY-MM-DD"
      // Kita perlu membuat rentang waktu dari awal hari hingga akhir hari
      // PENTING: Gunakan zona waktu UTC agar konsisten
      const startDate = new Date(date + 'T00:00:00.000Z');
      const endDate = new Date(date + 'T23:59:59.999Z');

      // Terapkan filter rentang pada 'dueDate'
      query = query.where('dueDate', '>=', startDate);
      query = query.where('dueDate', '<=', endDate);
    
    } else if (month) {
      // 4. ATAU terapkan filter BULAN (jika tidak ada filter tanggal)
      const year = 2025; // Asumsi tahun, sesuai logika frontend Anda
      const monthIndex = parseInt(month) - 1; 
      
      const startDate = new Date(year, monthIndex, 1);
      const endDate = new Date(year, monthIndex + 1, 0, 23, 59, 59);

      query = query.where('dueDate', '>=', startDate);
      query = query.where('dueDate', '<=', endDate);
    }
    
    // 5. Jalankan kueri Firestore
    //    Kita urutkan berdasarkan 'dueDate' sekarang, yang lebih masuk akal
    //    untuk tampilan kalender/pencarian
    const snapshot = await query.orderBy('dueDate', 'asc').get();

    let tasks = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // 6. Terapkan filter SEARCH (setelah mengambil data)
    if (search) {
      const lowerCaseQuery = search.toLowerCase();
      tasks = tasks.filter(task => 
        (task.title && task.title.toLowerCase().includes(lowerCaseQuery))
      );
    }

    // 7. Kirim hasil
    res.status(200).send(tasks);

  } catch (error) {
    console.error('Error mengambil tasks:', error);
    // Jika error karena indeks, Firebase akan memberi tahu di log
    if (error.message.includes('requires an index')) {
        return res.status(500).send({ 
            message: 'Server Error: Diperlukan Composite Index di Firestore. Cek log server untuk link pembuatan indeks.' 
        });
    }
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});

app.get('/', (req, res) => {
  res.status(200).send('Selamat datang di API To-Do List. Server berjalan.');
});

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
    const body = req.body; // Ambil seluruh body
    const userRef = db.collection('users').doc(uid);

    // 1. Buat objek kosong untuk data yang akan di-update
    const updateData = {};

    // 2. Cek setiap field satu per satu. 
    //    Hanya tambahkan ke 'updateData' jika nilainya ada di body.
    if (body.name !== undefined) {
      updateData.name = body.name;
    }
    if (body.username !== undefined) {
      updateData.username = body.username;
    }
    if (body.gender !== undefined) {
      updateData.gender = body.gender;
    }
    if (body.profileImageUrl !== undefined) {
      // Ini aman. Jika client mengirim 'null', nilainya akan 'null'.
      // Jika client tidak mengirim field ini, 'undefined' akan terdeteksi
      // dan field ini akan diabaikan (tidak akan di-update).
      updateData.profileImageUrl = body.profileImageUrl;
    }
    
    // Periksa apakah ada data untuk di-update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).send({ message: 'Tidak ada data untuk diperbarui' });
    }

    // 3. Selalu perbarui 'updatedAt'
    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    // 4. Gunakan 'update()'
    //    Ini hanya akan memperbarui field yang ada di 'updateData'
    await userRef.update(updateData);

    res.status(200).send({ message: 'Profil berhasil diperbarui' });
  } catch (error) {
    console.error('Error memperbarui profil:', error);
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});

/**
 * [POST] /api/profile/image
 * Menerima string base64, upload ke Cloudinary,
 * dan simpan URL-nya ke Firestore.
 */
app.post('/api/profile/image', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    // Ambil string base64 dari body JSON
    const { image } = req.body; 

    if (!image) {
      return res.status(400).send({ message: 'Tidak ada gambar yang dikirim' });
    }

    // 1. Upload ke Cloudinary
    // Kita taruh di folder 'profile_pics' agar rapi
    const uploadResponse = await cloudinary.uploader.upload(image, {
      folder: "profile_pics",
      // Opsi untuk 'cropping' otomatis ke 1:1 (persegi)
      crop: "fill", 
      gravity: "face",
      width: 300, 
      height: 300
    });

    const imageUrl = uploadResponse.secure_url; // URL gambar yang aman (https://)

    // 2. Simpan URL ke Firestore
    const userRef = db.collection('users').doc(uid);
    await userRef.update({
      profileImageUrl: imageUrl, 
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 3. Kirim URL baru kembali ke frontend
    res.status(200).send({ 
      message: 'Foto profil berhasil di-upload', 
      newImageUrl: imageUrl 
    });

  } catch (error) {
    console.error('Error upload gambar:', error);
    res.status(500).send({ message: 'Upload gagal', error: error.message });
  }
});


/**
 * [POST] /api/tasks
 * Membuat 'task' baru di dalam subcollection pengguna.
 */
app.post('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { title, details, category, dueDate, priority } = req.body;

    if (!title) {
      return res.status(400).send({ message: 'Title (judul) tidak boleh kosong' });
    }

    // Tentukan path ke subcollection 'tasks' milik pengguna
    const tasksCollection = db.collection('users').doc(uid).collection('tasks');

    // 1. Buat ID dokumen baru terlebih dahulu
    const newDocRef = tasksCollection.doc();
    const newTaskId = newDocRef.id;

    const newTask = {
      // Perbaikan Utama: 'id' harus ada di dalam dokumen
      id: newTaskId, 

      // Data dari aplikasi
      userId: uid,
      title: title,
      details: details || "",
      category: category || "None", // Sesuai Task.kt
      priority: priority || "None", // Sesuai Task.kt
      status: "pending",

      // Perbaikan Kritis: dueDate tidak boleh null
      // Gunakan Timestamp.fromDate() untuk konsistensi (jika menggunakan admin SDK)
      // atau new Date() (jika menggunakan client SDK)
      dueDate: dueDate ? admin.firestore.Timestamp.fromDate(new Date(dueDate)) : admin.firestore.Timestamp.now(),

      // Field dari Task.kt
      time: "", // Sesuai Task.kt
      endTimeMillis: 0,
      flowDurationMillis: 1800000, // Anda memberi default 30 menit, ini OK
      
      // Timestamps
      createdAt: admin.firestore.FieldValue.serverTimestamp(), // Sesuai API Anda
      completedAt: null,
      deletedAt: null,
      missedAt: null // Sesuai Task.kt
    };

    // Gunakan .set() alih-alih .add()
    await newDocRef.set(newTask);

    // Mengirim kembali objek yang baru dibuat (tanpa createdAt serverTimestamp)
    // Untuk mendapatkan data lengkap, Anda bisa fetch lagi, tapi ini cukup
    res.status(201).send({ ...newTask, createdAt: new Date().toISOString() }); // Kirim respons yang representatif

  } catch (error) {
    console.error('Error membuat task:', error);
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
// --- HELPER UNTUK STATISTIK PRODUKTIVITAS ---

/**
 * Mendapatkan tanggal Awal (Minggu) dan Akhir (Sabtu)
 * dari MINGGU SAAT INI.
 */
function getThisWeekRange() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = today.getDay(); // 0=Minggu, 1=Senin, ..., 6=Sabtu

  // Mundur ke hari Minggu
  const startDate = new Date(today.setDate(today.getDate() - dayOfWeek));
  startDate.setHours(0, 0, 0, 0); // Set ke awal hari

  // Maju ke hari Sabtu
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  endDate.setHours(23, 59, 59, 999); // Set ke akhir hari

  return { startDate, endDate };
}

/**
 * Mendapatkan tanggal Awal (Tgl 1) dan Akhir (Tgl 30/31)
 * dari BULAN SAAT INI.
 */
function getThisMonthRange() {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); // Trik 'hari ke-0'
  return { startDate, endDate };
}

/**
 * Mendapatkan tanggal Awal (1 Jan) dan Akhir (31 Des)
 * dari TAHUN SAAT INI.
 */
function getThisYearRange() {
  const now = new Date();
  const year = now.getFullYear();
  const startDate = new Date(year, 0, 1, 0, 0, 0);
  const endDate = new Date(year, 11, 31, 23, 59, 59);
  return { startDate, endDate };
}

// --- ENDPOINT STATISTIK PRODUKTIVITAS BARU ---

/**
 * [GET] /api/stats/productivity
 * Menghitung dan mengelompokkan tugas yang SELESAI
 * berdasarkan rentang waktu (daily, weekly, monthly).
 */
app.get('/api/stats/productivity', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { view } = req.query; // ?view=daily, ?view=weekly, ?view=monthly
    const tasksCollection = db.collection('users').doc(uid).collection('tasks');

    let startDate, endDate;
    let statsData; // Ini yang akan kita kirim

    // 1. Tentukan rentang tanggal berdasarkan 'view'
    // Kueri dasar: HANYA ambil tugas yang 'completed'
    let query = tasksCollection
      .where('deletedAt', '==', null)
      .where('status', '==', 'completed');

    switch (view) {
      case 'daily': // Data untuk chart "Daily" (Minggu - Sabtu)
        ({ startDate, endDate } = getThisWeekRange());
        // Inisialisasi 7 hari (Minggu=0, Senin=1, ..., Sabtu=6)
        statsData = [0, 0, 0, 0, 0, 0, 0];
        break;
      
      case 'weekly': // Data untuk chart "Weekly" (Minggu 1-5 dalam sebulan)
        ({ startDate, endDate } = getThisMonthRange());
        // Inisialisasi 5 minggu (asumsi maks 5 minggu)
        statsData = [0, 0, 0, 0, 0];
        break;
      
      case 'monthly': // Data untuk chart "Monthly" (Jan - Des)
        ({ startDate, endDate } = getThisYearRange());
        // Inisialisasi 12 bulan
        statsData = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        break;
      
      default:
        return res.status(400).send({ message: 'Query "view" tidak valid' });
    }
    
    // 2. Terapkan filter rentang tanggal
    // Kita filter berdasarkan 'completedAt', KARENA kita hanya peduli KAPAN
    // tugas itu diselesaikan, bukan 'dueDate'-nya.
    query = query
      .where('completedAt', '>=', startDate)
      .where('completedAt', '<=', endDate);

    // 3. Ambil data dan proses
    const snapshot = await query.get();

    snapshot.forEach(doc => {
      const task = doc.data();
      // 'completedAt' adalah Timestamp Firestore, ubah ke Date JS
      const completedDate = task.completedAt.toDate();

      // 4. Kelompokkan data berdasarkan 'view'
      if (view === 'daily') {
        const dayIndex = completedDate.getDay(); // 0=Minggu, 1=Senin, ...
        statsData[dayIndex]++;
      } else if (view === 'weekly') {
        const date = completedDate.getDate(); // Tanggal (1-31)
        const weekIndex = Math.floor((date - 1) / 7); // (Tgl 1-7 -> idx 0), (Tgl 8-14 -> idx 1)
        statsData[weekIndex]++;
      } else if (view === 'monthly') {
        const monthIndex = completedDate.getMonth(); // 0=Jan, 1=Feb, ...
        statsData[monthIndex]++;
      }
    });

    // 5. Kirim hasilnya (array berisi angka)
    res.status(200).send(statsData);

  } catch (error) {
    console.error(`Error mengambil statistik ${req.query.view}:`, error);
    if (error.message.includes('requires an index')) {
        return res.status(500).send({ 
            message: 'Server Error: Diperlukan Composite Index di Firestore. Cek log server untuk link pembuatan indeks.' 
        });
    }
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});
/**
 * [GET] /api/stats/tasks
 * Menghitung statistik (done, missed, deleted) untuk pengguna.
 * Ini jauh lebih efisien daripada menghitung di frontend.
 */
app.get('/api/stats/tasks', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const tasksCollection = db.collection('users').doc(uid).collection('tasks');
    const now = new Date(); // Waktu server saat ini

    // 1. Kueri untuk menghitung 'Done' (Selesai)
    // status == 'completed' DAN belum di-soft-delete
    const doneQuery = tasksCollection
      .where('deletedAt', '==', null)
      .where('status', '==', 'completed')
      .count()
      .get();

    // 2. Kueri untuk menghitung 'Deleted' (Dihapus)
    // Cukup cek 'deletedAt' tidak null
    const deletedQuery = tasksCollection
      .where('deletedAt', '!=', null)
      .count()
      .get();

    // 3. Kueri untuk menghitung 'Missed' (Terlewat)
    // status == 'pending' DAN dueDate < HARI INI
    const missedQuery = tasksCollection
      .where('deletedAt', '==', null)
      .where('status', '==', 'pending')
      .where('dueDate', '<', now) // dueDate sudah lewat
      .count()
      .get();

    // 4. Jalankan semua 3 kueri secara paralel
    const [doneResult, deletedResult, missedResult] = await Promise.all([
      doneQuery,
      deletedQuery,
      missedQuery
    ]);

    // 5. Ambil angkanya dari hasil
    const doneCount = doneResult.data().count;
    const deletedCount = deletedResult.data().count;
    const missedCount = missedResult.data().count;

    // 6. Kirim sebagai JSON
    res.status(200).send({
      completed: doneCount,
      missed: missedCount,
      deleted: deletedCount
    });

  } catch (error) {
    console.error('Error mengambil statistik tugas:', error);
    if (error.message.includes('requires an index')) {
        return res.status(500).send({ 
            message: 'Server Error: Diperlukan Composite Index di Firestore. Cek log server untuk link pembuatan indeks.' 
        });
    }
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});


/**
 * Mendapatkan tanggal hari ini dalam format YYYY-MM-DD.
 * @param {Date} date Objek tanggal
 * @returns {string} String format "YYYY-MM-DD"
 */
const getTodayStr = (date) => {
  // .toISOString() menghasilkan format "2025-11-10T17:00:00.000Z"
  // Kita hanya ambil bagian tanggalnya.
  return date.toISOString().split('T')[0];
};

/**
 * Mengecek apakah 'lastDateStr' adalah hari kemarin.
 * @param {string} lastDateStr String "YYYY-MM-DD" dari database
 * @param {string} todayStr String "YYYY-MM-DD" hari ini
 * @returns {boolean}
 */
const isYesterday = (lastDateStr, todayStr) => {
  try {
    // Set jam 12 siang UTC untuk menghindari masalah zona waktu
    const today = new Date(todayStr + "T12:00:00Z"); 
    // Mundur 1 hari
    const yesterday = new Date(today.setDate(today.getDate() - 1));
    const yesterdayStr = getTodayStr(yesterday);
    return lastDateStr === yesterdayStr;
  } catch (e) {
    console.error("Error di isYesterday:", e);
    return false;
  }
};

/**
 * Mendapatkan hari dalam seminggu sesuai standar Kotlin Anda.
 * (Senin=0, Selasa=1, ..., Minggu=6)
 * @param {Date} date Objek tanggal
 * @returns {number}
 */
const getDayOfWeekAsNumber = (date) => {
  const jsDay = date.getDay(); // Standar JS: Minggu=0, Senin=1, ..., Sabtu=6
  // Konversi ke standar Anda (Senin=0, ..., Minggu=6)
  if (jsDay === 0) { // Jika JS hari Minggu (0)
    return 6; // Standar Anda adalah 6
  } else {
    return jsDay - 1; // Senin (1) jadi 0, Selasa (2) jadi 1, dst.
  }
};

// --- ENDPOINT ---

/**
 * [GET] /api/stats/streak
 * Mengambil data streak (rentetan) pengguna.
 * Path: users/{uid}/stats/streak
 */
app.get('/api/stats/streak', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const streakRef = db.collection('users').doc(uid).collection('stats').doc('streak');
    const doc = await streakRef.get();

    if (!doc.exists) {
      // Kirim data default sesuai format Kotlin Anda ("" bukan null)
      return res.status(200).send({
        currentStreak: 0,
        lastCompletionDate: null, // null saat awal
        streakDays: "" // String kosong
      });
    }

    res.status(200).send(doc.data());
  } catch (error) {
    console.error('Error mengambil streak:', error);
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});


/**
 * [POST] /api/stats/streak/complete
 * Merekam penyelesaian tugas HARI INI dan memperbarui streak.
 * Endpoint ini meniru logika 'checkAndUpdateStreak' dari Kotlin.
 */
app.post('/api/stats/streak/complete', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    const streakRef = db.collection('users').doc(uid).collection('stats').doc('streak');

    const finalData = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(streakRef);

      // 1. Tentukan tanggal hari ini (waktu server)
      // Izinkan 'simulatedDate' dari body HANYA UNTUK TESTING
      const { simulatedDate } = req.body;
      const now = simulatedDate ? new Date(simulatedDate) : new Date();
      
      const todayStr = getTodayStr(now); // "YYYY-MM-DD"

      // 2. Ambil data saat ini, atau siapkan data default jika tidak ada
      const currentState = doc.exists ? doc.data() : {
        currentStreak: 0,
        lastCompletionDate: null,
        streakDays: ""
      };

      const { currentStreak, lastCompletionDate, streakDays } = currentState;

      // 3. Logika Inti Streak (Meniru 'when' di Kotlin)

      // Kasus 2: Sudah di-update hari ini
      if (lastCompletionDate === todayStr) {
        return currentState; // Tidak ada perubahan, langsung kembalikan data
      }

      let newStreak = currentStreak;
      // Variabel 'hasCompletedToday' selalu 'true' di endpoint ini,
      
      if (lastCompletionDate === null) {
        // Kasus 1: Belum ada streak sama sekali
        newStreak = 0;
      } else if (isYesterday(lastCompletionDate, todayStr)) {
        // Kasus 3: Hari ini adalah hari setelah lastDateStr (Beruntun)
        newStreak = currentStreak + 1;
      } else {
        // Kasus 4: Jeda lebih dari satu hari (Streak putus)
        newStreak = 0;
      }

      // 4. Logika 'streakDays' (Meniru kode Kotlin)
      const currentDay = getDayOfWeekAsNumber(now); // 0-6
      
      // Ubah string "1,2,5" menjadi Set [1, 2, 5]
      const existingDays = streakDays.split(',')
                                    .map(s => s.trim()) // Hapus spasi
                                    .filter(s => s.length > 0) // Hapus string kosong
                                    .map(Number); // Ubah jadi angka
      const daySet = new Set(existingDays);

      let newStreakDays;
      if (newStreak > currentStreak) {
        // Lanjutkan streak, tambahkan hari ini jika belum ada
        if (!daySet.has(currentDay)) {
          daySet.add(currentDay);
        }
        newStreakDays = Array.from(daySet).sort((a, b) => a - b).join(',');
      } else if (newStreak === 1) {
        // Streak baru (baik dari 0 atau dari reset)
        // Mulai ulang 'streakDays' hanya dengan hari ini
        newStreakDays = String(currentDay);
      } else {
        // Kasus yang seharusnya tidak terjadi di sini (streak == 0)
        // Tapi untuk jaga-jaga, kita pertahankan data lama
        newStreakDays = streakDays;
      }

      // 5. Siapkan data baru untuk disimpan
      const newState = {
        currentStreak: newStreak,
        lastCompletionDate: todayStr, // Simpan sebagai String "YYYY-MM-DD"
        streakDays: newStreakDays   // Simpan sebagai String "1,2,5"
      };

      transaction.set(streakRef, newState);
      return newState;
    });

    res.status(200).send(finalData);

  } catch (error) {
    console.error('Error memperbarui streak:', error);
    res.status(500).send({ message: 'Server Error', error: error.message });
  }
});

module.exports = app;