# HydroLight Dashboard

Dashboard front-end untuk proposal Smart Hydroponic Lighting berbasis IoT. Dashboard subscribe ke broker MQTT melalui WebSocket dan memperbarui tampilan saat pesan masuk.

## Struktur folder

- `index.html` — Overview
- `monitoring.html` — Monitoring Lux, Mol, dan DLI
- `riwayat-dli.html` — Riwayat DLI 7 hari dan ekspor CSV
- `pengaturan.html` — Profil tanaman, target DLI, dan informasi perangkat
- `css/app.css` — Design system dan gaya bersama untuk semua halaman
- `js/app.js` — Interaksi, visualisasi, perhitungan DLI, dan integrasi MQTT

Semua halaman memakai `css/app.css` agar tampilan konsisten. Font dimuat dari Google Fonts (Space Grotesk dan Inter).

Library MQTT dimuat dari CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/mqtt@5/dist/mqtt.min.js"></script>
```

Jika dashboard harus berjalan offline, unduh file tersebut ke `js/mqtt.min.js` dan ubah tag script menjadi `<script src="js/mqtt.min.js"></script>`.

## Cara menjalankan

1. Jalankan broker MQTT:

   ```powershell
   cd C:\Users\alfat\OneDrive\Desktop\platform-iot\mqtt
   python broker.py
   ```

2. Jalankan web server statis:

   ```powershell
   cd C:\Users\alfat\OneDrive\Desktop\platform-iot\web
   python -m http.server 8081
   ```

3. Buka `http://localhost:8081/index.html` di PC.
4. Dari perangkat lain di jaringan yang sama, buka `http://192.168.1.6:8081/index.html`.

## Konfigurasi MQTT

URL broker ditentukan dengan urutan:

1. Query parameter `?mqtt=ws://IP_PC:9001`
2. `localStorage` dengan key `hydrolight_mqtt_url`
3. `ws://<hostname-halaman>:9001` jika halaman dibuka melalui HTTP
4. `ws://localhost:9001` jika halaman dibuka melalui `file://`

Contoh override dari console browser:

```js
localStorage.setItem("hydrolight_mqtt_url", "ws://192.168.1.6:9001");
location.reload();
```

Atau buka:

```text
http://localhost:8081/index.html?mqtt=ws://192.168.1.6:9001
```

Cek URL yang sedang dipakai:

```js
window.hydrolightMqttUrl;
```

## Topic MQTT

Dashboard subscribe ke `hydrolight/device/#`.

| Topic | Efek di dashboard |
|---|---|
| `hydrolight/device/lux` | Mengisi nilai Lux dan grafik cahaya |
| `hydrolight/device/mol` | Mengisi nilai Mol; jika topic Lux belum diterima, Lux dihitung mundur `mol / 0.145` |
| `hydrolight/device/dli` | Menimpa nilai DLI dari perangkat |
| `hydrolight/device/led` | Memperbarui status LED |
| `hydrolight/device/status` | Memperbarui status koneksi perangkat IoT |

## Catatan

- DLI dihitung di browser dari estimasi PPFD (`lux * 0.0185`) dan disimpan per hari di `localStorage` dengan key `hydrolight_dli_history`.
- Nilai `mol` dari firmware memakai rumus `lux * 0.145`.
- Status perangkat IoT dan status broker MQTT ditampilkan terpisah.
- Broker menggunakan anonymous auth dan tanpa TLS; gunakan hanya di jaringan lokal tepercaya.

## Catatan lampu

Lampu LED dikendalikan secara otomatis oleh ESP32 berdasarkan pembacaan sensor cahaya BH1750, yaitu menyala ketika cahaya yang terdeteksi kurang. Dashboard ini hanya menampilkan data dan tidak mengirim perintah ke lampu.
