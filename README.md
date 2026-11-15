# HydroLight Dashboard

Dashboard front-end demonstrasi untuk proposal Smart Hydroponic Lighting berbasis IoT.

## Struktur folder
- `index.html` — Overview
- `monitoring.html` — Monitoring Lux dan PPFD
- `riwayat-dli.html` — Riwayat DLI 7 hari dan ekspor CSV
- `pengaturan.html` — Profil tanaman, target DLI, dan informasi perangkat
- `css/overview.css` — Gaya khusus halaman Overview
- `css/monitoring.css` — Gaya khusus halaman Monitoring
- `css/riwayat-dli.css` — Gaya khusus halaman Riwayat DLI
- `css/pengaturan.css` — Gaya khusus halaman Pengaturan
- `js/app.js` — Interaksi dan visualisasi bersama

Setiap halaman memuat stylesheet-nya sendiri. Gaya yang sama (sidebar, topbar, panel) sengaja ditulis ulang di tiap file CSS agar setiap halaman dapat diubah tanpa memengaruhi halaman lain.

## Catatan lampu
Lampu LED dikendalikan secara otomatis oleh ESP32 berdasarkan pembacaan sensor cahaya BH1750, yaitu menyala ketika cahaya yang terdeteksi kurang. Dashboard ini hanya menampilkan data dan tidak mengirim perintah ke lampu.

## Cara menjalankan
1. Ekstrak ZIP.
2. Pastikan struktur folder tidak berubah.
3. Buka `index.html` menggunakan browser modern.
4. Navigasikan halaman melalui menu di sidebar.

## Catatan
Data pada versi ini adalah data simulasi untuk demonstrasi. Belum ada koneksi langsung ke ESP32/BH1750. Integrasi perangkat nyata membutuhkan endpoint komunikasi, penyimpanan data, dan kalibrasi konversi lux ke PPFD.
"# IOT" 
