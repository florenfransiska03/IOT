# HydroLight Dashboard

Dashboard front-end untuk monitoring Smart Hydroponic Lighting. Tampilan dibuat ulang menjadi satu halaman bersih dengan tema terang/gelap, menggunakan font **Poppins** dan **Montserrat**.

## Struktur folder

- `index.html` — halaman utama dashboard
- `css/dashboard.css` — design system, tema terang/gelap, dan layout responsif
- `js/dashboard.js` — grafik timeseries, kontrol fase/jadwal, tabel, dan ekspor CSV
- `mqtt/broker.py` — broker MQTT lokal (opsional, untuk integrasi perangkat)

Font dimuat dari Google Fonts, sedangkan grafik memakai Chart.js dari CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
```

## Cara menjalankan

1. Jalankan web server statis:

   ```powershell
   cd C:\Users\alfat\OneDrive\Desktop\platform-iot\web
   python -m http.server 8081
   ```

2. Buka `http://localhost:8081/index.html` di browser.
3. Dari perangkat lain di jaringan yang sama, buka `http://IP_PC:8081/index.html`.

Untuk mengubah tema lewat URL:

```text
http://localhost:8081/index.html?theme=light
http://localhost:8081/index.html?theme=dark
```

## Fitur

- Toggle tema terang/gelap (tersimpan di `localStorage`).
- Grafik timeseries dengan filter **Semua**, **Lux & Mol**, **DLI**, dan **Suhu**.
- Kontrol fase pertumbuhan: Seedling, Vegetative, Flowering.
- Mode **Auto** atau **Jadwal**; pada mode Jadwal, rentang waktu nyala lampu dapat diatur bebas.
- Status lampu bersifat read-only dan mengikuti mode/jadwal yang dipilih.
- Data history per jam serta ekspor CSV.

## Catatan

- Data telemetri pada halaman ini masih berupa data contoh untuk keperluan tampilan.
- Status lampu ditampilkan otomatis: mode Auto dianggap menyala, mode Jadwal mengikuti rentang waktu yang diatur.
