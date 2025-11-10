
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
// 6. Jalankan Server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});