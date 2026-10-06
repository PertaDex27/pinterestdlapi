<div align="center">

# 📌 Pindl API

**Pinterest downloader buat lu yang males ribet — plus bonus converter video ke GIF.**

Lempar linknya, balik jadi file. Foto, video, gif, semua diurus.
Gak ada API key, gak ada login, gak ada `npm install`.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FPertaDex27%2Fpinterestdlapi)

[![Live](https://img.shields.io/badge/live-pinterestdlapi.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://pinterestdlapi.vercel.app/api)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success?style=for-the-badge)](https://github.com/PertaDex27/pinterestdlapi)
[![Video to GIF](https://img.shields.io/badge/bonus-video_to_gif-ff69b4?style=for-the-badge)](#-video-to-gif)

[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Made by](https://img.shields.io/badge/made_by-XyncTeam-8e44ad?style=for-the-badge)](https://github.com/PertaDex27)
[![Stars](https://img.shields.io/github/stars/PertaDex27/pinterestdlapi?style=for-the-badge&color=f1c40f&label=stars&logo=github)](https://github.com/PertaDex27/pinterestdlapi/stargazers)
[![Forks](https://img.shields.io/github/forks/PertaDex27/pinterestdlapi?style=for-the-badge&color=1abc9c&label=forks&logo=github)](https://github.com/PertaDex27/pinterestdlapi/network/members)

[![Last commit](https://img.shields.io/github/last-commit/PertaDex27/pinterestdlapi?style=for-the-badge&color=e67e22&label=last%20commit&logo=git)](https://github.com/PertaDex27/pinterestdlapi/commits)
[![Issues](https://img.shields.io/github/issues/PertaDex27/pinterestdlapi?style=for-the-badge&color=e74c3c&label=issues&logo=githubactions)](https://github.com/PertaDex27/pinterestdlapi/issues)
[![Repo size](https://img.shields.io/github/repo-size/PertaDex27/pinterestdlapi?style=for-the-badge&color=9b59b6&label=repo%20size)](https://github.com/PertaDex27/pinterestdlapi)

[🚀 Coba sekarang](https://pinterestdlapi.vercel.app/api) · [📖 Endpoint](#-endpoint) · [🎬 Video to GIF](#-video-to-gif) · [🛠️ Deploy sendiri](#%EF%B8%8F-deploy-sendiri) · [🐛 Lapor bug](https://github.com/PertaDex27/pinterestdlapi/issues)

</div>

---

## 🤔 Ini apa sih?

Pindl API itu REST API kecil buat ngambil media dari Pinterest. Kasih link pin, ID pin, atau link pendek `pin.it` — nanti balikannya metadata pin plus semua foto dan video lengkap sama link unduhannya.

Terus ada bonus satu endpoint: **video ke GIF**. Kasih link video apa aja (mp4, webm, mov, mkv, dll), dia balikin GIF siap pakai — lengkap sama potong durasi, atur fps, ukuran, crop, dan pilih encoder-nya.

Semuanya nulis pakai JavaScript murni. **Nol dependensi.** Gak ada `node_modules`, gak ada retasan library yang tiap minggu harus di-update. Cukup Node 18 ke atas, deploy ke Vercel, langsung jalan.

Btw ini juga udah live, jadi lu bisa langsung nyoba tanpa deploy apa-apa:
**https://pinterestdlapi.vercel.app**

## ✨ Kenapa pake ini?

- 🎯 **Tanpa API key, tanpa login** — buka aja, gak ada drama
- 🧩 **Mesinnya satu file** — `pindl.js` isi semua logika, gampang dibaca ulang dan dioprek
- 🎬 **Video story pin ikut kebaca** — ini yang sering bikin downloader lain nyerah, video-nya disimpen Pinterest di `storyPinData`, bukan di field biasa
- 🔁 **Anti gagal deteksi** — payload Pinterest suka ilang random, API ini otomatis nyoba ulang pakai profil browser lain
- ✅ **Link video diverifikasi dulu** sebelum ditampilin, jadi gak ada link mati
- ⚡ **Hemat kuota** — default-nya file ditarik langsung dari CDN Pinterest (302), bukan lewat server Vercel lu
- 🎞️ **Bonus video ke GIF** — potong, atur fps, resize, crop, semua dari satu request
- 🌐 **CORS terbuka** — bisa dipanggil dari web, bot, atau mana pun

## 🔌 Endpoint

Base URL: `https://pinterestdlapi.vercel.app`

| Method | Endpoint | Fungsi |
| :--- | :--- | :--- |
| `GET` | `/api` | Daftar endpoint + info batas harian |
| `GET` | `/api/health` | Status layanan + sisa kuota lu |
| `GET` | `/api/resolve?url=` | Ubah `pin.it/xxx` jadi link pin penuh |
| `GET` | `/api/pin?url=` | Metadata pin + semua foto & video |
| `GET` | `/api/download?url=` | Ambil medianya (foto/video/gif) |
| `GET` | `/api/proxy?u=` | Proxy media dari `pinimg.com` / `giphy.com` |
| `GET` | `/api/probe?url=` | Cek varian video mana yang masih hidup |
| `GET` / `POST` | `/api/videotogif?url=` | Ubah video jadi GIF (bisa upload langsung juga) |

Semua endpoint nerima `GET`, dan balasannya konsisten:

```json
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "code": "NO_VIDEO", "message": "Pin ini tidak punya video atau gif" } }
```

### Parameter `/api/download`

| Param | Wajib | Keterangan |
| :--- | :---: | :--- |
| `url` | ✅ | Link pin, ID pin, atau link `pin.it` |
| `kind` | ❌ | `video`, `image`, atau `gif`. Kosongin aja, nanti ngikut jenis pinnya |
| `q` | ❌ | Mutu video: `1080w`, `720w`, `540w`, `480w`, `360w`, `240w` |
| `i` | ❌ | Foto ke berapa, mulai dari `0` (default `0` = paling jernih) |
| `mode` | ❌ | `redirect` (default) atau `proxy` |
| `json` | ❌ | Isi `1` kalau cuma mau liat pilihannya tanpa ikut unduh |

## 🎬 Video to GIF

Endpoint buat ngubah video jadi GIF.

```
GET /api/videotogif?url=<link video>&start=0&end=5&fps=12&size=480&crop=none&method=ezgif&mode=redirect|proxy&json=1
```

| Param | Wajib | Keterangan |
| :--- | :---: | :--- |
| `url` / `u` / `video` | ✅* | Link video langsung. Format: `mp4`, `m4v`, `webm`, `mov`, `avi`, `mkv`, `flv`, `wmv`, `mpg`, `mpeg`, `3gp`, `ts`, `ogv` |
| `start` / `s` | ❌ | Detik mulai, default `0` |
| `end` / `e` | ❌ | Detik akhir. Kosongin = ngikut batas `max` |
| `fps` / `f` | ❌ | `1` - `50`, default `10`. Makin gede makin mulus, tapi filenya makin berat |
| `size` | ❌ | `original`, `1280`, `600`, `540`, `500`, `480`, `400`, `320`, `720p`, `480p`, `360p`, `320p`, `1200w`, `1200h` |
| `crop` | ❌ | `none`, `auto`, `1:1`, `4:3`, `16:9`, `3:2`, `2:1`, `1:2`, `2:3`, `3:4`, `4:5`, `5:4`, `9:16` |
| `ar` | ❌ | Paksa rasio output: `no` + semua rasio di atas |
| `method` | ❌ | `ezgif` (cepat), `gifski` (paling bagus), `ffmpeg_dithering` |
| `loop` | ❌ | Jumlah loop, default `0` = muter terus |
| `max` | ❌ | Batas durasi potongan, default `15` detik, maks `60` |
| `mode` | ❌ | `redirect` (default, 302 ke file GIF) atau `proxy` (GIF-nya lewat server sendiri, maks 4 MB) |
| `json` | ❌ | Isi `1` kalau cuma mau detail GIF-nya tanpa ngunduh |
| `fresh` | ❌ | Isi `1` buat maksa convert ulang, ngelewatin cache |

**Kalau mau upload langsung** (gak pakai link), kirim `POST` ke `/api/videotogif?start=0&end=3` dengan salah satu cara:
- `multipart/form-data` field `video`
- atau raw body video + header `x-filename: nama.mp4`

**Contoh balasan `json=1`:**

```json
{
  "ok": true,
  "data": {
    "gif": {
      "url": "https://ezgif.com/save/ezgif-6384bb535f8e2395.gif",
      "preview": "https://s6.ezgif.com/tmp/ezgif-6384bb535f8e2395.gif",
      "lebar": 320,
      "tinggi": 180,
      "frame": 20,
      "ukuranEzGif": "811.08KiB"
    },
    "video": { "nama": "cut.mp4", "ukuran": "967.8 KB", "durasi": 10, "sourceFps": 30 },
    "setelan": { "start": 0, "end": 2, "durasiClip": 2, "fps": 10, "size": "320", "crop": "none", "loop": 0, "method": "ezgif" }
  }
}
```

## 🚀 Contoh pakai

**Ambil data pin**

```bash
curl "https://pinterestdlapi.vercel.app/api/pin?url=https://pin.it/5Xxs8iokC"
```

**Unduh video kualitas 720w**

```bash
curl -L -o video.mp4 "https://pinterestdlapi.vercel.app/api/download?url=1119496419891744897&kind=video&q=720w"
```

**Unduh foto**

```bash
curl -L -o foto.jpg "https://pinterestdlapi.vercel.app/api/download?url=560064903677324577&kind=image"
```

**Liat pilihan tanpa ngunduh**

```bash
curl "https://pinterestdlapi.vercel.app/api/download?url=1119496419891744897&kind=video&json=1"
```

**Video jadi GIF, potong 2 detik, fps 12**

```bash
curl -L -o meme.gif "https://pinterestdlapi.vercel.app/api/videotogif?url=https://situs.com/video.mp4&start=2&end=4&fps=12&size=480"
```

**GIF persegi buat feed, pake Gifski**

```bash
curl -L -o kotak.gif "https://pinterestdlapi.vercel.app/api/videotogif?url=https://situs.com/video.mp4&start=0&end=3&crop=1:1&method=gifski"
```

**Upload video sendiri ke endpoint GIF**

```bash
# upload video dari komputer sendiri, balikannya JSON berisi link GIF-nya
curl -X POST -F "video=@cut.mp4" "https://pinterestdlapi.vercel.app/api/videotogif?start=0&end=2&fps=10"

# minta GIF-nya dikirim lewat server API (bukan 302 ke ezgif), cocok buat file kecil
curl -L -o hasil.gif "https://pinterestdlapi.vercel.app/api/videotogif?url=https://situs.com/video.mp4&mode=proxy"
```

**Dari JavaScript**

```js
const res = await fetch("https://pinterestdlapi.vercel.app/api/pin?url=https://pin.it/5Xxs8iokC");
const { ok, data, error } = await res.json();

if (ok) {
  console.log(data.title);
  console.log("foto:", data.images.length, "| video:", data.videos.length);
  console.log("video terbaik:", data.links.videoTerbaik);
  console.log("foto terbaik :", data.links.fotoTerbaik);
} else {
  console.log("gagal:", error.code, error.message);
}
```

```js
const q = new URLSearchParams({
  url: "https://situs.com/video.mp4",
  start: 1,
  end: 5,
  fps: 15,
  size: "480",
  json: 1,
});

const gif = await fetch(`https://pinterestdlapi.vercel.app/api/videotogif?${q}`).then((r) => r.json());

if (gif.ok) {
  console.log("GIF jadi:", gif.data.gif.url);
  console.log(`${gif.data.gif.lebar}x${gif.data.gif.tinggi}, ${gif.data.gif.frame} frame`);
} else {
  console.log("gagal:", gif.error.code, gif.error.message);
}
```

**Dari Python**

```python
import requests

r = requests.get("https://pinterestdlapi.vercel.app/api/pin",
                 params={"url": "https://www.pinterest.com/pin/1119496419891744897/"}).json()

for v in r["data"]["videos"]:
    print(v["label"], v["format"], v["url"])
```

```python
import requests

r = requests.get("https://pinterestdlapi.vercel.app/api/videotogif",
                 params={"url": "https://situs.com/video.mp4", "start": 0, "end": 4, "fps": 12, "size": 480}).json()

if r["ok"]:
    gif = requests.get(r["data"]["gif"]["url"])
    open("hasil.gif", "wb").write(gif.content)
else:
    print(r["error"])
```

**Langsung tampilin di HTML**

```html
<img src="https://pinterestdlapi.vercel.app/api/download?url=560064903677324577&kind=image" alt="dari Pinterest">
```

## 🔒 Batas harian

Biar API-nya gak diembat orang iseng, tiap IP dapet **1.000 request per 24 jam**. Hitungannya mulai dari request pertama, abis itu baru penuh lagi 24 jam kemudian. Request yang dihitung termasuk unduhan; yang gak dihitung cuma `OPTIONS`.

Tiap balasan nempel info kuota di header:

| Header | Isi |
| :--- | :--- |
| `x-pindl-limit` | Batas harian lu |
| `x-pindl-limit-remaining` | Sisa kuota |
| `x-pindl-limit-reset` | Detik lagi sampai kuota penuh |
| `x-pindl-limit-window` | Panjang jendelanya, `24j` |

Kalau udah habis:

```json
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Kuota harian habis. Batas 1000 permintaan per 24 jam untuk alamat ini.",
    "limit": 1000,
    "resetDalamDetik": 83021,
    "resetPada": "2026-10-06T10:43:19.061Z"
  }
}
```

## ⚙️ Variabel lingkungan

Atur di Vercel: **Settings → Environment Variables**. Semuanya opsional, API tetap jalan tanpa ini.

| Nama | Fungsi |
| :--- | :--- |
| `PINDL_DAILY_LIMIT` | Batas harian. Isi `0` kalau mau matiin pembatasnya (alias bebas tanpa batas) |
| `PINDL_UNLIMITED` | Daftar bebas batas, pisah pakai koma. Bisa IP, kunci rahasia, atau `*` buat semua orang |
| `UPSTASH_REDIS_REST_URL` | Alamat Redis biar hitungan kuota berlaku menyeluruh |
| `UPSTASH_REDIS_REST_TOKEN` | Token Redis |

**Soal Redis:** tanpa Redis, hitungannya disimpen di memori tiap instans fungsi. Tetep jalan, tapi karena Vercel ngasih banyak instans, batas efektifnya bisa lebih longgar. Kalau mau 1.000-nya beneran ketat: dashboard Vercel → **Storage → Upstash Redis → Connect**. Env-nya keisi otomatis.

**Whitelist buat web sendiri:** isi `PINDL_UNLIMITED` pakai IP lu atau kunci rahasia, terus kirim kuncinya waktu manggil:

```js
fetch("https://pinterestdlapi.vercel.app/api/pin?url=" + link, {
  headers: { "x-pindl-key": "kunci-rahasia-lu" }
});
```

## 🛠️ Deploy sendiri

**Cara gampang:** klik tombolnya di atas, Vercel bakal nge-clone repo ini ke akun lu dan langsung deploy.

**Cara CLI:**

```bash
git clone https://github.com/PertaDex27/pinterestdlapi.git
cd pinterestdlapi
npm i -g vercel
vercel --prod
```

**Atau lewat dashboard:** import repo dari GitHub di vercel.com, framework biarin `Other`, tekan Deploy. Udah, itu doang.

## 💻 Jalanin di lokal

```bash
git clone https://github.com/PertaDex27/pinterestdlapi.git
cd pinterestdlapi
node local.js
```

Buka `http://localhost:3210/api`. Mau ganti port? `PORT=4000 node local.js`.

## 📁 Isi repo

```
pindl.js        → mesin Pinterest, semua logika utama ada di sini (nol dependensi)
videotogif.js   → mesin video ke GIF, semua logika GIF ada di sini (nol dependensi)
api/            → 8 endpoint, isinya cuma nerusin ke dua mesin di atas
local.js        → runner buat tes di komputer sendiri (gak dipake Vercel)
vercel.json     → setelan durasi fungsi 60 detik
package.json    → penanda proyek ESM, tanpa dependensi
```

## 📝 Yang perlu lu tau

- Vercel ngebatasin satu respons fungsi maksimal **4,5 MB**. Makanya mode unduh default-nya `redirect` — file-nya ngalir langsung dari CDN Pinterest, jadi video 7 MB pun aman
- Pakai `mode=proxy` kalau mau nama file sendiri atau gak mau link-nya nunjuk ke Pinterest. Kalau file-nya lebih dari 4 MB, otomatis dialihin 302 (ada catatannya di header `x-pindl-note`)
- Pin privat, board rahasia, dan konten yang butuh login gak bisa diambil (ya jelas lah wkwk 😹)
- Pinterest kadang ngubah struktur datanya. Kalau tiba-tiba ada yang rusak, buka issue aja, nanti dicek

### Khusus video to GIF

- Berkas GIF cuma nangkring di server ezgif sekitar **1 jam**, jadi di-link langsung ke sana bisa mati. Kalau lu hit endpoint API-nya lagi, dia otomatis convert ulang — gak usah panik 🔥
- Batas aman biar gak kena limit Vercel 60 detik: potongan **maks 15 detik** (bisa dinaikin lewat `max`, maks 60) dan **maks 400 frame** per GIF
- Video yang diunduh dari link dibatasi **25 MB**. Kalau lebih gede, download dulu videonya terus upload lewat `POST`
- Upload langsung ke Vercel juga kena limit body **~4 MB** — video gede mending pakai parameter `url`
- Endpoint `videotogif` jalan lewat antrean **2 proses paralel** biar ezgif gak ngambek, jadi kalau lagi rame bisa agak ngantri bentar
- Hasil convert disimpen di cache **30 menit**. Mau maksa convert ulang? Pakai `fresh=1`
- Ini nempel ke ezgif.com yang **bukan API resmi**. Jangan dipakai buat trafik gede-gedean, nanti mereka yang repot 🙏

## ⚠️ Disclaimer

Semua konten yang lu unduh itu hak kreatornya masing-masing — jangan dijual ulang, jangan diklaim punya sendiri, dan jangan dipake buat nyepam Pinterest. Pindl API bukan produk resmi Pinterest dan gak berafiliasi sama mereka. Endpoint video to GIF juga bukan produk resmi ezgif.com. Yang make tool ini tanggung jawab sendiri ya 🤝

---

<div align="center">

Copyright © 2026 **XyncTeam** · Dirilis dengan lisensi [MIT](LICENSE)

Jangan lupa kasih ⭐, biar org lain bisa nemuin repo ini 😊

</div>
