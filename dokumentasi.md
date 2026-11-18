# Dokumentasi Teknis — Website & MQTT

Dokumen ini menjelaskan **cara kerja** dan **bagaimana kode** pada dua bagian proyek:
website dashboard (`web/`) dan broker MQTT (`web/mqtt/broker.py`).

---

## 1. Gambaran Arsitektur

```
┌──────────────┐   MQTT/TCP 1883   ┌──────────────┐   MQTT/WebSocket 9001   ┌──────────────┐
│  ESP32 (IoT) │ ────────────────▶ │ broker.py    │ ◀────────────────────── │  Website     │
│  BH1750      │  publish telemetry│ (amqtt)      │   subscribe telemetry   │  dashboard   │
└──────────────┘                   └──────────────┘                         └──────────────┘
```

- ESP32 mengirim data sensor ke broker lewat MQTT TCP port `1883`.
- Broker yang sama membuka listener WebSocket port `9001` agar browser bisa ikut berkomunikasi MQTT.
- Website berlangganan (subscribe) topik telemetri dan menampilkan datanya secara real-time.
- Selama belum ada data yang masuk, semua nilai ditampilkan sebagai `—`.

---

## 2. Cara Menjalankan

### Menjalankan broker MQTT

Dari folder `web/`:

```powershell
python mqtt/broker.py
```

Broker siap menerima koneksi MQTT TCP di port `1883` dan WebSocket di port `9001`. Pastikan kedua port tidak dipakai aplikasi lain dan diizinkan firewall. Jika ESP32 yang mem-publish data, sesuaikan `MQTT_BROKER` di firmware ke IP PC yang menjalankan `broker.py`.

### Menjalankan website

Dari folder `web/`:

```powershell
python -m http.server 8081
```

Lalu buka salah satu:

- `http://localhost:8081/index.html`
- `http://IP_PC:8081/index.html` (dari perangkat lain di jaringan yang sama)

Website otomatis connect ke `ws://<host-halaman>:9001`. Jika broker berada di host/port berbeda, timpa lewat query string:

```text
http://localhost:8081/index.html?broker=ws://192.168.79.244:9001
```

Tema juga bisa dipaksa lewat URL: `?theme=light` atau `?theme=dark`.

---

## 3. MQTT — `mqtt/broker.py`

### Cara kerja

`broker.py` menjalankan broker MQTT `amqtt` dengan dua listener:

| Listener | Tipe | Bind | Dipakai oleh |
| --- | --- | --- | --- |
| `default` | TCP | `0.0.0.0:1883` | Perangkat ESP32 (PubSubClient) |
| `ws` | WebSocket | `0.0.0.0:9001` | Website (mqtt.js di browser) |

```python
config = {
    "listeners": {
        "default": {"type": "tcp", "bind": "0.0.0.0:1883"},
        "ws": {"type": "ws", "bind": "0.0.0.0:9001"},
    },
    "auth": {"allow-anonymous": True},
}

async def main():
    await Broker(config).start()
    await asyncio.Event().wait()
```

### Bagaimana kode bekerja

1. `Broker(config)` membuat broker dengan konfigurasi listener di atas.
2. `await Broker(config).start()` menyalakan kedua listener sekaligus.
3. `await asyncio.Event().wait()` menahan proses tetap hidup (event yang tidak pernah di-set) sampai program dihentikan.
4. `allow-anonymous: True` membuat perangkat dan browser bisa connect tanpa username/password.

Broker tidak menyimpan data sendiri. Ia hanya meneruskan pesan (publish/subscribe) antar client. Nilai yang di-retain (mis. status perangkat) akan langsung dikirim ke client baru saat subscribe.

### Kontrak topik

Semua topik memakai prefix `hydrolight/device/`.

| Topik | Arah | Payload | Retain | Keterangan |
| --- | --- | --- | --- | --- |
| `hydrolight/device/lux` | device → web | angka, mis. `18324.50` | tidak | Intensitas cahaya (lux) |
| `hydrolight/device/mol` | device → web | angka, mis. `2656.55` | tidak | PPFD / Mol (µmol/m²/s) |
| `hydrolight/device/led` | device → web | `TRUE` / `FALSE` | tidak | Status lampu |
| `hydrolight/device/suhu` | device → web | angka, mis. `29.40` | tidak | Suhu udara dalam °C dari DHT22 (GPIO 12) |
| `hydrolight/device/kelembapan` | device → web | angka, mis. `68.20` | tidak | Kelembapan relatif dalam %RH dari DHT22 (GPIO 12) |
| `hydrolight/device/status` | device → web | `online` / `offline` | ya | Status koneksi perangkat; `offline` dikirim sebagai _Last Will_ |
| `hydrolight/device/command` | web → device | teks/JSON | tidak | Kanal perintah ke perangkat |

Contoh alur pesan:

```
ESP32  --publish--> hydrolight/device/lux     "18324.50"
ESP32  --publish--> hydrolight/device/mol     "2656.55"
ESP32  --publish--> hydrolight/device/led     "TRUE"
ESP32  --publish--> hydrolight/device/status  "online"   (retain)
broker --deliver--> website (subscribe hydrolight/device/+)
```

---

## 4. Website — `web/`

### Struktur file

| File | Fungsi |
| --- | --- |
| `index.html` | Markup dashboard, pemuatan Chart.js dan mqtt.js, semua elemen yang menampilkan nilai sensor |
| `css/dashboard.css` | Tema terang/gelap, layout, serta indikator status (titik IoT, lampu, dsb.) |
| `js/dashboard.js` | Koneksi MQTT, pengolahan data live, grafik, tabel riwayat, kontrol, ekspor CSV |
| `mqtt/broker.py` | Broker MQTT (dijelaskan pada bagian 3) |

### Cara kerja

**1. Koneksi ke MQTT**

Website memakai mqtt.js dari CDN dan connect ke broker melalui WebSocket:

```html
<script src="https://cdn.jsdelivr.net/npm/mqtt@5/dist/mqtt.min.js"></script>
```

Alamat broker ditentukan fungsi `brokerUrl()`:

- Default: `ws://<host-halaman>:9001` (host diambil dari `location.hostname`).
- Bisa dioverride lewat query string, mis. `?broker=ws://192.168.79.244:9001`.
- Jika halaman dibuka via HTTPS, skema otomatis menjadi `wss://`.

Setelah connect, website melakukan subscribe ke `hydrolight/device/+` sehingga semua sub-topik perangkat masuk ke satu handler.

**2. Status koneksi IoT**

Indikator ada di pill header (`#nodeStatus` + `#nodeDot`). Status dihitung oleh `connectionState()`:

| Kondisi | Tampilan | Warna titik |
| --- | --- | --- |
| Belum pernah connect | `Menghubungkan…` | kuning berkedip |
| Gagal connect sebelum pernah sukses | `Gagal terhubung` | merah |
| Pernah connect lalu terputus | `Terputus` | merah |
| Broker connect, data perangkat masih baru (< 15 detik) | `Online` | hijau |
| Broker connect, perangkat mengirim `offline` | `Offline` | merah |
| Broker connect, belum ada data | `Menunggu data` | kuning berkedip |

"Data masih baru" ditentukan dari `telemetry.lastSeen` dengan ambang `STALE_MS = 15000`. Pemeriksaan diulang tiap 5 detik lewat `setInterval(renderConnection, 5000)`, sehingga bila perangkat berhenti mengirim, status otomatis berubah dari `Online` menjadi `Menunggu data`/`Offline` tanpa perlu refresh halaman.

**3. Nilai `—` sebelum ada data**

Semua nilai awal `null` di objek `telemetry`, dan helper `num()` mengembalikan `—` untuk nilai yang belum ada:

```js
const telemetry = {
  lux: null, mol: null, led: null, suhu: null, kelembapan: null, dli: null, lastSeen: 0,
};

function num(value, digits) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  ...
}
```

Akibatnya kartu Suhu, Lux, Mol/PPFD, DLI, rata-rata PAR, status lampu, tabel riwayat, dan grafik semuanya tampil `—`/kosong sampai pesan MQTT pertama diterima. Ini juga tertulis langsung di markup `index.html` sebagai nilai awal.

**4. Pengolahan pesan**

`handleMessage(topic, raw)` memetakan topik ke field telemetri:

| Topik | Aksi |
| --- | --- |
| `.../lux` | `parseFloat` → `telemetry.lux` |
| `.../mol` | `parseFloat` → `telemetry.mol`, sekaligus menghitung DLI |
| `.../led` | `TRUE`/`FALSE` → `telemetry.led` (boolean) |
| `.../suhu` | `parseFloat` → `telemetry.suhu` |
| `.../kelembapan` | `parseFloat` → `telemetry.kelembapan` |
| `.../status` | `online`/`offline` → `deviceStatus` |

Setiap pesan valid memperbarui `telemetry.lastSeen`, lalu memanggil `renderLive()`, `renderHistory()`, `updateChartData()`, dan `renderConnection()`.

**5. Perhitungan DLI**

DLI (mol/m²/d) dihitung dengan integrasi numerik (trapesium) dari nilai PPFD setiap kali topik `mol` masuk:

```js
dliTotal += ((lastMol + nextMol) / 2) * dt / 1e6;
```

- `dt` = selisih waktu antar pesan (detik).
- Dibagi `1e6` untuk mengubah µmol menjadi mol.
- Interval di luar `0 < dt < 30` detik diabaikan agar lonjakan waktu (mis. tab sempat tidur) tidak merusak akumulasi.
- Akumulasi bersifat **per sesi halaman** (mulai dari 0 setiap reload) dan dipakai untuk angka DLI, progress bar terhadap target `18.0 mol/m²/d`, serta persentase chip.

**6. Grafik dan tabel riwayat**

- `recordHistory(now)` menyimpan nilai terakhir untuk jam berjalan ke `history["HH"]`.
- `chartSeries()` menyusun tiga array 24 jam (PPFD, DLI, Suhu) dengan `null` untuk jam yang belum ada datanya.
- Grafik (`buildChart` + `updateChartData`) memakai sumbu-X `00:00–23:00`, dan menampilkan overlay `Menunggu data IoT…` selama `history` masih kosong.
- `renderHistory()` selalu membuat 24 baris (00:00–23:00); jam tanpa data diisi `—`, termasuk kolom status lampu.
- Tab `Semua`, `Lux & Mol`, `DLI`, `Suhu` hanya menyembunyikan/menampilkan dataset (`rangeMap`).

**7. Ekspor CSV**

`downloadCsv()` menyusun CSV dari `history` untuk 24 jam. Sel yang belum berisi data ditulis `—`, sehingga file yang diunduh tetap konsisten dengan tampilan.

**8. Kontrol Auto/Jadwal & fase**

Tombol mode (Auto/Jadwal) dan fase (Seedling/Vegetative/Flowering) bersifat **lokal di UI**: mengubah teks `#nodeMode` dan panel jadwal. Status lampu yang ditampilkan berasal dari perangkat (`hydrolight/device/led`), bukan dihitung dari mode/jadwal. Kanal `hydrolight/device/command` sudah tersedia di broker dan di-subscribe firmware, tetapi website belum mengirim perintah ke sana.

**9. Fungsi utama di `js/dashboard.js`**

| Fungsi | Peran |
| --- | --- |
| `applyTheme` / `initTheme` | Ganti & simpan tema terang/gelap |
| `brokerUrl` | Tentukan URL WebSocket broker (default/override) |
| `initMqtt` | Connect mqtt.js, subscribe `hydrolight/device/+`, pasang event `connect/close/error/message` |
| `handleMessage` | Routing pesan MQTT ke state telemetri |
| `integrateDli` | Integrasi PPFD → akumulasi DLI |
| `recordHistory` | Simpan snapshot per jam |
| `renderLive` / `setLamp` | Update kartu sensor, DLI, PAR, dan status lampu |
| `connectionState` / `renderConnection` | Hitung & tampilkan status koneksi IoT |
| `buildChart` / `updateChartData` / `chartSeries` | Grafik 24 jam dari data live |
| `renderHistory` | Tabel riwayat per jam |
| `downloadCsv` | Ekspor CSV |
| `initControls`, `initDateFields` | Interaksi kontrol, jadwal, dan field tanggal |
| `showToast` | Notifikasi singkat |

### Catatan data

- Sumber nilai di dashboard sekarang **murni dari MQTT**; tidak ada lagi angka contoh yang di-hardcode.
- Kartu **Suhu** menampilkan suhu (°C) sekaligus kelembapan (%RH) dari DHT22 pada GPIO 12; keduanya tampil `—` sampai firmware mengirim topik `hydrolight/device/suhu` dan `hydrolight/device/kelembapan`.
- Jika broker tidak dapat dijangkau, status header menunjukkan `Gagal terhubung`/`Terputus` dan semua nilai tetap `—`.
