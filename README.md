<div align="center">

# 📌 Pindl API

**Pinterest downloader buat lu yang males ribet.**

Lempar linknya, balik jadi file. Foto, video, gif — semua diurus.
Gak ada API key, gak ada login, gak ada `npm install`.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FPertaDex27%2Fpinterestdlapi)

[![Live](https://img.shields.io/badge/live-pinterestdlapi.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://pinterestdlapi.vercel.app/api)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success?style=for-the-badge)](https://github.com/PertaDex27/pinterestdlapi)

[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Made by](https://img.shields.io/badge/made_by-XyncTeam-8e44ad?style=for-the-badge)](https://github.com/PertaDex27)
[![Stars](https://img.shields.io/github/stars/PertaDex27/pinterestdlapi?style=for-the-badge&color=f1c40f&label=stars&logo=github)](https://github.com/PertaDex27/pinterestdlapi/stargazers)
[![Forks](https://img.shields.io/github/forks/PertaDex27/pinterestdlapi?style=for-the-badge&color=1abc9c&label=forks&logo=github)](https://github.com/PertaDex27/pinterestdlapi/network/members)

[![Last commit](https://img.shields.io/github/last-commit/PertaDex27/pinterestdlapi?style=for-the-badge&color=e67e22&label=last%20commit&logo=git)](https://github.com/PertaDex27/pinterestdlapi/commits)
[![Issues](https://img.shields.io/github/issues/PertaDex27/pinterestdlapi?style=for-the-badge&color=e74c3c&label=issues&logo=githubactions)](https://github.com/PertaDex27/pinterestdlapi/issues)
[![Repo size](https://img.shields.io/github/repo-size/PertaDex27/pinterestdlapi?style=for-the-badge&color=9b59b6&label=repo%20size)](https://github.com/PertaDex27/pinterestdlapi)

[🚀 Coba sekarang](https://pinterestdlapi.vercel.app/api) · [📖 Endpoint](#-endpoint) · [🛠️ Deploy sendiri](#%EF%B8%8F-deploy-sendiri) · [🐛 Lapor bug](https://github.com/PertaDex27/pinterestdlapi/issues)

</div>

---

## 🤔 Ini apa sih?

Pindl API itu REST API kecil buat ngambil media dari Pinterest. Kasih link pin, ID pin, atau link pendek `pin.it` — nanti balikannya metadata pin plus semua foto dan video lengkap sama link unduhannya.

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

**Dari Python**

```python
import requests

r = requests.get("https://pinterestdlapi.vercel.app/api/pin",
                 params={"url": "https://www.pinterest.com/pin/1119496419891744897/"}).json()

for v in r["data"]["videos"]:
    print(v["label"], v["format"], v["url"])
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
pindl.js        → mesinnya, semua logika ada di sini (nol dependensi)
api/            → 7 endpoint, isinya cuma nerusin ke pindl.js
local.js        → runner buat tes di komputer sendiri (gak dipake Vercel)
vercel.json     → setelan durasi fungsi 60 detik
package.json    → penanda proyek ESM, tanpa dependensi
```

## 📝 Yang perlu lu tau

- Vercel ngebatasin satu respons fungsi maksimal **4,5 MB**. Makanya mode unduh default-nya `redirect` — file-nya ngalir langsung dari CDN Pinterest, jadi video 7 MB pun aman
- Pakai `mode=proxy` kalau mau nama file sendiri atau gak mau link-nya nunjuk ke Pinterest. Kalau file-nya lebih dari 4 MB, otomatis dialihin 302 (ada catatannya di header `x-pindl-note`)
- Pin privat, board rahasia, dan konten yang butuh login gak bisa diambil (ya jelas lah wkwk 😹)
- Pinterest kadang ngubah struktur datanya. Kalau tiba-tiba ada yang rusak, buka issue aja, nanti dicek

## ⚠️ Disclaimer

Semua konten yang lu unduh itu hak kreatornya masing-masing — jangan dijual ulang, jangan diklaim punya sendiri, dan jangan dipake buat nyepam Pinterest. Pindl API bukan produk resmi Pinterest dan gak berafiliasi sama mereka. Yang make tool ini tanggung jawab sendiri ya 🤝

---

<div align="center">

Copyright © 2026 **XyncTeam** · Dirilis dengan lisensi [MIT](LICENSE)

Jangan lupa kasih ⭐, biar org lain bisa nemuin repo ini 😊🙏

</div>