import { HttpError, cacheGet, cacheSet } from "./pindl.js";

const EZGIF_BASE = "https://ezgif.com";
const EZGIF_UPLOAD = `${EZGIF_BASE}/video-to-gif`;
const EZGIF_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const PROXY_LIMIT_BYTES = 4 * 1024 * 1024;
const MAX_CLIP_SEC = 15;
const MAX_FRAMES = 400;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_RECHECK_MS = 5 * 60 * 1000;
const TIME_BUDGET_MS = 55 * 1000;

const VIDEO_EXT = ["mp4", "m4v", "webm", "mov", "avi", "mkv", "flv", "wmv", "mpg", "mpeg", "3gp", "ts", "ogv"];

const MIME_BY_EXT = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  flv: "video/x-flv",
  wmv: "video/x-ms-wmv",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  "3gp": "video/3gpp",
  ts: "video/mp2t",
  ogv: "video/ogg"
};

const SIZE_VALUES = ["original", "1280", "600", "540", "500", "480", "400", "320", "720p", "480p", "360p", "320p", "1200w", "1200h"];
const CROP_VALUES = ["none", "auto", "1:1", "4:3", "16:9", "3:2", "2:1", "1:2", "2:3", "3:4", "4:5", "5:4", "9:16"];
const AR_VALUES = ["no", ...CROP_VALUES.slice(2)];
const METHOD_VALUES = ["ezgif", "gifski", "ffmpeg_dithering"];

class Queue {
  constructor(concurrency = 2, minGapMs = 300) {
    this.concurrency = concurrency;
    this.minGapMs = minGapMs;
    this.active = 0;
    this.queue = [];
    this.lastStarted = 0;
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    if (!this.queue.length) return;
    if (this.active >= this.concurrency) return;
    const wait = Math.max(0, this.lastStarted + this.minGapMs - Date.now());
    if (wait > 0) {
      setTimeout(() => this.drain(), wait);
      return;
    }
    const job = this.queue.shift();
    this.active++;
    this.lastStarted = Date.now();
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.active--;
        this.drain();
      });
  }

  get stats() {
    return { aktif: this.active, antre: this.queue.length, paralel: this.concurrency };
  }
}

const gifQueue = new Queue(2, 300);

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
    "access-control-allow-headers": "content-type,range,accept",
    "access-control-expose-headers":
      "content-length,content-range,accept-ranges,retry-after,content-disposition,x-gif-cache,x-gif-frames,x-gif-size,x-gif-source,x-gif-expires,x-gif-note",
    "access-control-max-age": "86400"
  };
}

function sendJson(res, status, body, extra = {}) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...corsHeaders(),
    ...extra
  });
  res.end(payload);
}

function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const code = err instanceof HttpError ? err.code : "INTERNAL_ERROR";
  sendJson(res, status, {
    ok: false,
    error: { code, message: err.message || "Terjadi kesalahan", ...(err.extra || {}) }
  });
}

function redirectTo(res, url, extra = {}) {
  res.writeHead(302, { location: url, ...corsHeaders(), ...extra });
  res.end();
}

function fmtBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1048576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = ipv4.slice(1).map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function extFromUrl(rawUrl, contentType) {
  const clean = String(rawUrl).split("?")[0].split("#")[0];
  const m = clean.match(/\.([a-z0-9]{2,4})$/i);
  if (m && VIDEO_EXT.includes(m[1].toLowerCase())) return m[1].toLowerCase();
  const ct = String(contentType || "").toLowerCase();
  const byCt = Object.entries(MIME_BY_EXT).find(([, type]) => ct.includes(type));
  if (byCt) return byCt[0];
  if (ct.startsWith("video/")) return "mp4";
  return null;
}

function fileNameFromUrl(rawUrl, ext) {
  try {
    const base = decodeURIComponent(new URL(rawUrl).pathname.split("/").pop() || "");
    if (/\.(mp4|m4v|webm|mov|avi|mkv|flv|wmv|mpg|mpeg|3gp|ts|ogv)$/i.test(base)) return base;
  } catch {
    return `video.${ext}`;
  }
  return `video.${ext}`;
}

function parseOptions(params) {
  const readNum = (keys, fallback) => {
    for (const key of keys) {
      const raw = params.get(key);
      if (raw === null || raw === "") continue;
      const n = Number(String(raw).replace(",", "."));
      if (!Number.isFinite(n)) throw new HttpError(400, "BAD_PARAM", `Nilai ${key} harus angka`);
      return n;
    }
    return fallback;
  };

  const readEnum = (keys, allowed, fallback) => {
    for (const key of keys) {
      const raw = params.get(key);
      if (raw === null || raw === "") continue;
      const value = String(raw).toLowerCase().trim();
      if (!allowed.includes(value)) {
        throw new HttpError(400, "BAD_PARAM", `Nilai ${key} "${value}" tidak dikenal`, { pilihan: allowed });
      }
      return value;
    }
    return fallback;
  };

  const start = Math.max(0, readNum(["start", "s", "awal"], 0));
  const endRaw = readNum(["end", "e", "akhir"], null);
  const fps = Math.round(readNum(["fps", "f"], 10));
  if (fps < 1 || fps > 50) throw new HttpError(400, "BAD_PARAM", "fps harus antara 1 - 50");

  const maxClip = Math.min(Math.max(readNum(["max", "maxdur"], MAX_CLIP_SEC), 0.5), 60);
  const mode = readEnum(["mode"], ["redirect", "proxy"], "redirect");
  const loop = Math.round(Math.max(0, readNum(["loop"], 0)));

  return {
    start,
    end: endRaw,
    fps,
    size: readEnum(["size"], SIZE_VALUES, "original"),
    crop: readEnum(["crop"], CROP_VALUES, "none"),
    ar: readEnum(["ar"], AR_VALUES, "no"),
    method: readEnum(["method", "encoder"], METHOD_VALUES, "ezgif"),
    loop,
    maxClip,
    mode,
    json: ["1", "true", "yes"].includes(String(params.get("json") || "").toLowerCase()),
    dl: ["1", "true", "yes"].includes(String(params.get("dl") || "").toLowerCase()),
    fresh: ["1", "true", "yes"].includes(String(params.get("fresh") || "").toLowerCase())
  };
}

function stepTimeout(budget, capMs) {
  const left = budget.left();
  if (left <= 3000) throw new HttpError(504, "GIF_TIMEOUT", "Waktu pengerjaan habis (batas 60 detik Vercel). Coba clip yang lebih pendek atau video yang lebih kecil.");
  return Math.min(capMs, left - 1500);
}

function makeBudget(totalMs = TIME_BUDGET_MS) {
  const started = Date.now();
  return { started, left: () => totalMs - (Date.now() - started) };
}

async function fetchUpstream(url, { timeoutMs, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
  } catch (err) {
    if (err.name === "AbortError") throw new HttpError(504, "UPSTREAM_TIMEOUT", "Server ezgif kelamaan menjawab");
    throw new HttpError(502, "UPSTREAM_UNREACHABLE", `Gagal menghubungi server sumber: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    await response.body?.cancel?.();
    throw new HttpError(413, "VIDEO_TOO_LARGE", `Video ${fmtBytes(declared)} melebihi batas ${fmtBytes(maxBytes)}`, {
      maxBytes
    });
  }
  if (!response.body) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) throw new HttpError(413, "VIDEO_TOO_LARGE", "Video melebihi batas ukuran", { maxBytes });
    return buf;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "VIDEO_TOO_LARGE", `Video melebihi batas ${fmtBytes(maxBytes)}`, { maxBytes });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function downloadVideo(rawUrl, budget) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new HttpError(400, "INVALID_URL", "URL video tidak valid");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new HttpError(400, "INVALID_URL", "Hanya URL http/https");
  if (isPrivateHost(parsed.hostname)) {
    throw new HttpError(403, "URL_NOT_ALLOWED", "Alamat lokal / jaringan privat tidak diizinkan");
  }

  let upstream;
  try {
    upstream = await fetchUpstream(parsed.toString(), {
      timeoutMs: stepTimeout(budget, 20000),
      headers: { "user-agent": EZGIF_UA, accept: "*/*" }
    });
  } catch (err) {
    if (err instanceof HttpError && err.code === "UPSTREAM_TIMEOUT") {
      throw new HttpError(504, "DOWNLOAD_TIMEOUT", "Video sumber kelamaan diunduh");
    }
    throw err;
  }

  if (!upstream.ok) {
    await upstream.body?.cancel?.();
    throw new HttpError(502, "DOWNLOAD_FAILED", `Video sumber membalas HTTP ${upstream.status}`);
  }

  const contentType = upstream.headers.get("content-type") || "";
  const ext = extFromUrl(parsed.toString(), contentType);
  const bytes = await readCapped(upstream, MAX_INPUT_BYTES);

  if (!ext) {
    throw new HttpError(400, "INVALID_VIDEO", "Link itu bukan berkas video yang didukung", {
      didukung: VIDEO_EXT,
      contentTypeDiterima: contentType
    });
  }
  if (!bytes.length) throw new HttpError(502, "DOWNLOAD_FAILED", "Video sumber kosong");

  return { bytes, ext, contentType: MIME_BY_EXT[ext], name: fileNameFromUrl(parsed.toString(), ext), url: parsed.toString() };
}

function inputBy(html, name) {
  const m = html.match(new RegExp(`<input[^>]*\\bname\\s*=\\s*["']${name}["'][^>]*>`, "i"));
  return m ? m[0] : null;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
}

async function uploadToEzgif(video, budget) {
  const form = new FormData();
  form.append("new-image", new Blob([video.bytes], { type: video.contentType }), video.name);

  const res = await fetchUpstream(EZGIF_UPLOAD, {
    method: "POST",
    body: form,
    headers: { "user-agent": EZGIF_UA, accept: "*/*", referer: EZGIF_UPLOAD, "sec-fetch-site": "same-origin" },
    timeoutMs: stepTimeout(budget, 22000)
  });

  const html = await res.text();
  const match = (res.url || "").match(/\/video-to-gif\/([^/?#]+)\.html/);
  if (!match) {
    const alert = (html.match(/class="alert[^"]*"[^>]*>([\s\S]{0,300}?)</i) || [])[1];
    throw new HttpError(502, "EZGIF_UPLOAD_FAILED", alert ? alert.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : `ezgif menolak unggahan (HTTP ${res.status})`);
  }

  const file = decodeURIComponent(match[1]);
  const durationRaw = inputBy(html, "end") ? attr(inputBy(html, "end"), "value") : null;
  const fpsRaw = inputBy(html, "detected-fps") ? attr(inputBy(html, "detected-fps"), "value") : null;

  return {
    file,
    duration: durationRaw ? Number(parseFloat(durationRaw).toFixed(2)) : null,
    sourceFps: fpsRaw ? Number(parseFloat(fpsRaw).toFixed(2)) : null,
    halaman: `${EZGIF_BASE}/video-to-gif/${file}.html`
  };
}

async function convertOnEzgif(job, opts, budget) {
  const form = new FormData();
  form.append("file", job.file);
  form.append("start", String(opts.start));
  form.append("end", String(opts.end));
  form.append("size", opts.size);
  form.append("crop", opts.crop);
  form.append("ar", opts.ar);
  form.append("fps", String(opts.fps));
  form.append("fpsr", String(opts.fps));
  form.append("detected-fps", String(job.sourceFps || 30));
  form.append("method", opts.method);
  form.append("loop", String(opts.loop));
  form.append("ajax", "true");

  const target = `${EZGIF_BASE}/video-to-gif/${encodeURIComponent(job.file)}?ajax=true`;
  const res = await fetchUpstream(target, {
    method: "POST",
    body: form,
    headers: { "user-agent": EZGIF_UA, accept: "*/*", referer: job.halaman, "sec-fetch-site": "same-origin" },
    timeoutMs: stepTimeout(budget, 30000)
  });

  const html = await res.text();
  if (res.status >= 400) throw new HttpError(502, "EZGIF_CONVERT_FAILED", `ezgif membalas HTTP ${res.status}`);
  if (/class="alert/i.test(html)) {
    const msg = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    throw new HttpError(502, "EZGIF_CONVERT_FAILED", msg);
  }

  const imgTag = (html.match(/<img[^>]*class="[^"]*\boutput\b[^"]*"[^>]*>/i) || [])[0];
  const preview = imgTag ? attr(imgTag, "src") : null;
  const savePath = (html.match(/href="(\/save\/[^"]+?\.gif)"/i) || [])[1] || null;
  const stats = html.match(/File size:\s*<strong>([^<]+)<\/strong>,\s*width:\s*(\d+)px,\s*height:\s*(\d+)px,\s*frames:\s*(\d+)/i);

  const previewUrl = preview ? (preview.startsWith("//") ? `https:${preview}` : preview) : null;
  if (!savePath && !previewUrl) throw new HttpError(502, "GIF_NOT_FOUND", "Hasil GIF tidak ditemukan di respons ezgif");

  return {
    saveUrl: savePath ? `${EZGIF_BASE}${savePath}` : previewUrl,
    previewUrl,
    width: stats ? Number(stats[2]) : null,
    height: stats ? Number(stats[3]) : null,
    frames: stats ? Number(stats[4]) : null,
    ezgifSize: stats ? stats[1] : null
  };
}

async function stillAlive(url, budget) {
  try {
    const res = await fetchUpstream(url, { method: "HEAD", timeoutMs: stepTimeout(budget, 8000), headers: { "user-agent": EZGIF_UA } });
    await res.body?.cancel?.();
    return res.status < 400;
  } catch {
    return true;
  }
}

function cacheKey(videoUrl, opts) {
  return ["gif", videoUrl, opts.start, opts.end, opts.fps, opts.size, opts.crop, opts.ar, opts.loop, opts.method].join("|");
}

async function buildGif(videoUrl, opts, budget) {
  const result = await gifQueue.run(async () => {
    const video = await downloadVideo(videoUrl, budget);
    const job = await uploadToEzgif(video, budget);

    const duration = job.duration && job.duration > 0 ? job.duration : opts.maxClip;
    if (opts.start >= duration) {
      throw new HttpError(400, "BAD_PARAM", `start ${opts.start}s melebihi durasi video (${duration}s)`, { durasi: duration });
    }
    let end = opts.end === null ? Math.min(duration, opts.start + opts.maxClip) : opts.end;
    end = Math.min(end, duration, opts.start + opts.maxClip);
    if (end <= opts.start) end = Math.min(duration, opts.start + Math.max(0.5, opts.maxClip));

    const frames = Math.round((end - opts.start) * opts.fps);
    if (frames > MAX_FRAMES) {
      throw new HttpError(400, "TERLALU_BANYAK_FRAME", `Perkiraan ${frames} frame melebihi batas ${MAX_FRAMES}. Kecilkan fps atau durasi.`, {
        perkiraanFrame: frames,
        batasFrame: MAX_FRAMES
      });
    }

    const gif = await convertOnEzgif(job, { ...opts, end }, budget);
    return {
      gif,
      video: {
        nama: video.name,
        ukuran: fmtBytes(video.bytes.length),
        bytes: video.bytes.length,
        durasi: duration,
        sourceFps: job.sourceFps
      },
      setelan: {
        start: opts.start,
        end: Number(end.toFixed(2)),
        durasiClip: Number((end - opts.start).toFixed(2)),
        fps: opts.fps,
        size: opts.size,
        crop: opts.crop,
        ar: opts.ar,
        loop: opts.loop,
        method: opts.method
      },
      ezgif: { file: job.file, halaman: job.halaman },
      createdAt: Date.now()
    };
  });

  cacheSet(cacheKey(videoUrl, { ...opts, end: result.setelan.end }), result, CACHE_TTL_MS);
  return result;
}

function publicData(result, opts, input, origin, cached) {
  return {
    gif: {
      url: result.gif.saveUrl,
      preview: result.gif.previewUrl,
      lebar: result.gif.width,
      tinggi: result.gif.height,
      frame: result.gif.frames,
      ukuranEzGif: result.gif.ezgifSize
    },
    video: result.video,
    setelan: result.setelan,
    tautan: {
      unduhLangsung: result.gif.saveUrl,
      lewatApiRedirect: `${origin}/api/videotogif?url=${encodeURIComponent(input)}`,
      lewatApiProxy: `${origin}/api/videotogif?url=${encodeURIComponent(input)}&mode=proxy`,
      halamanEzGif: result.ezgif.halaman
    },
    catatan: [
      `Berkas GIF disimpan ezgif sekitar 1 jam, setelah itu link mati dan convert perlu diulang${cached ? " (hasil ini dari cache)" : ""}.`,
      "Ini API tidak resmi milik ezgif.com. Jangan dipakai buat trafik besar."
    ]
  };
}

export async function handleVideoToGif(req, res, params) {
  const input = params.get("url") || params.get("u") || params.get("video");
  if (!input) {
    throw new HttpError(400, "MISSING_URL", "Parameter url wajib diisi (link video mp4/webm/mov)", {
      contoh: "/api/videotogif?url=https://contoh.com/video.mp4&start=0&end=5&fps=12&size=480"
    });
  }

  const opts = parseOptions(params);
  const budget = makeBudget();
  const key = cacheKey(input, opts);
  let result = opts.fresh ? null : cacheGet(key);
  let cached = Boolean(result);

  if (result && Date.now() - result.createdAt > CACHE_RECHECK_MS) {
    const alive = await stillAlive(result.gif.saveUrl, budget);
    if (!alive) {
      result = null;
      cached = false;
    }
  }

  if (!result) result = await buildGif(input, opts, budget);

  const headers = {
    "cache-control": "public, max-age=60",
    "x-gif-cache": cached ? "HIT" : "MISS",
    "x-gif-frames": String(result.gif.frames ?? ""),
    "x-gif-size": result.gif.ezgifSize || "",
    "x-gif-source": result.ezgif.file,
    "x-gif-expires": new Date(result.createdAt + CACHE_TTL_MS).toISOString(),
    "x-gif-note": "link ezgif hidup sekitar 1 jam"
  };

  const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers["x-forwarded-host"] || req.headers.host || "localhost"}`;

  if (opts.json) {
    sendJson(res, 200, { ok: true, data: publicData(result, opts, input, origin, cached) }, headers);
    return;
  }

  if (opts.mode === "proxy") {
    const gifRes = await fetchUpstream(result.gif.saveUrl, {
      headers: { "user-agent": EZGIF_UA, accept: "image/gif,image/*,*/*", referer: result.ezgif.halaman },
      timeoutMs: stepTimeout(budget, 15000)
    });
    if (!gifRes.ok) throw new HttpError(502, "GIF_NOT_FOUND", `Gagal mengambil GIF (HTTP ${gifRes.status})`);

    const length = Number(gifRes.headers.get("content-length") || 0);
    if (length > PROXY_LIMIT_BYTES) {
      await gifRes.body?.cancel?.();
      throw new HttpError(413, "GIF_TOO_LARGE", `GIF ${fmtBytes(length)} melebihi batas proxy ${fmtBytes(PROXY_LIMIT_BYTES)}`, {
        saran: "pakai mode=redirect (default) atau turunkan size/fps/durasi"
      });
    }

    const buf = await readCapped(gifRes, PROXY_LIMIT_BYTES);
    const name = `videotogif-${Date.now()}.gif`;
    res.writeHead(200, {
      "content-type": "image/gif",
      "content-length": buf.length,
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "content-disposition": `attachment; filename="${name}"`,
      ...corsHeaders(),
      ...headers
    });
    res.end(buf);
    return;
  }

  redirectTo(res, result.gif.saveUrl, headers);
}

export async function handleVideoToGifUpload(req, res, paramsInput) {
  try {
    const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers["x-forwarded-host"] || req.headers.host || "localhost"}`;
    const url = new URL(req.url || "/", origin);
    const params = paramsInput || url.searchParams;

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Gunakan GET atau POST" } });
      return;
    }

    const opts = parseOptions(params);
    const budget = makeBudget();
    const { bytes, name, contentType } = await readUpload(req, opts);
    const ext = extFromUrl(name, contentType);
    if (!ext) throw new HttpError(400, "INVALID_VIDEO", `Format berkas ${name} tidak didukung`, { didukung: VIDEO_EXT });

    const result = await gifQueue.run(async () => {
      const job = await uploadToEzgif({ bytes, ext, contentType: MIME_BY_EXT[ext], name }, budget);

      const duration = job.duration && job.duration > 0 ? job.duration : opts.maxClip;
      let end = opts.end === null ? Math.min(duration, opts.start + opts.maxClip) : Math.min(opts.end, duration, opts.start + opts.maxClip);
      if (end <= opts.start) end = Math.min(duration, opts.start + Math.max(0.5, opts.maxClip));

      const frames = Math.round((end - opts.start) * opts.fps);
      if (frames > MAX_FRAMES) {
        throw new HttpError(400, "TERLALU_BANYAK_FRAME", `Perkiraan ${frames} frame melebihi ${MAX_FRAMES}. Kecilkan fps atau durasi.`);
      }

      const gif = await convertOnEzgif(job, { ...opts, end }, budget);
      return {
        gif,
        video: { nama: name, ukuran: fmtBytes(bytes.length), bytes: bytes.length, durasi: duration, sourceFps: job.sourceFps },
        setelan: {
          start: opts.start,
          end: Number(end.toFixed(2)),
          durasiClip: Number((end - opts.start).toFixed(2)),
          fps: opts.fps,
          size: opts.size,
          crop: opts.crop,
          ar: opts.ar,
          loop: opts.loop,
          method: opts.method
        },
        ezgif: { file: job.file, halaman: job.halaman },
        createdAt: Date.now()
      };
    });

    const headers = {
      "x-gif-frames": String(result.gif.frames ?? ""),
      "x-gif-size": result.gif.ezgifSize || "",
      "x-gif-source": result.ezgif.file,
      "x-gif-note": "link ezgif hidup sekitar 1 jam"
    };

    if (opts.json || opts.mode === "redirect") {
      sendJson(
        res,
        200,
        {
          ok: true,
          data: {
            gif: {
              url: result.gif.saveUrl,
              preview: result.gif.previewUrl,
              lebar: result.gif.width,
              tinggi: result.gif.height,
              frame: result.gif.frames,
              ukuranEzGif: result.gif.ezgifSize
            },
            video: result.video,
            setelan: result.setelan,
            catatan: [
              "Unggahan langsung dibatasi sekitar 4 MB oleh Vercel, pakai ?url= kalau videonya lebih besar.",
              "Berkas GIF disimpan ezgif sekitar 1 jam, setelah itu link mati."
            ]
          }
        },
        headers
      );
      return;
    }

    const gifRes = await fetchUpstream(result.gif.saveUrl, {
      headers: { "user-agent": EZGIF_UA, accept: "image/gif,image/*,*/*", referer: result.ezgif.halaman },
      timeoutMs: stepTimeout(budget, 15000)
    });
    if (!gifRes.ok) throw new HttpError(502, "GIF_NOT_FOUND", `Gagal mengambil GIF (HTTP ${gifRes.status})`);
    const buf = await readCapped(gifRes, PROXY_LIMIT_BYTES);
    res.writeHead(200, {
      "content-type": "image/gif",
      "content-length": buf.length,
      "cache-control": "public, max-age=3600",
      "content-disposition": `attachment; filename="videotogif-${Date.now()}.gif"`,
      ...corsHeaders(),
      ...headers
    });
    res.end(buf);
  } catch (err) {
    if (!res.headersSent) sendError(res, err);
    else res.destroy();
  }
}

async function readUpload(req, opts) {
  const rawContentType = String(req.headers["content-type"] || "");
  const contentType = rawContentType.toLowerCase();
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_INPUT_BYTES) throw new HttpError(413, "VIDEO_TOO_LARGE", `Berkas melebihi ${fmtBytes(MAX_INPUT_BYTES)}`);
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  if (!body.length) throw new HttpError(400, "NO_FILE", "Body kosong, kirim berkas video sebagai raw body atau form-data");

  if (contentType.includes("multipart/form-data")) {
    const boundary = rawContentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
    if (!boundary) throw new HttpError(400, "BAD_REQUEST", "Boundary multipart tidak ditemukan");
    const parsed = parseMultipart(body, (boundary[1] || boundary[2]).trim());
    if (!parsed) throw new HttpError(400, "NO_FILE", "Tidak ada berkas video di form-data");
    return { bytes: parsed.bytes, name: parsed.name || "video.mp4", contentType: parsed.contentType || "video/mp4" };
  }

  const name = String(req.headers["x-filename"] || "video.mp4");
  return { bytes: body, name, contentType: contentType.startsWith("video/") ? contentType : "video/mp4" };
}

function parseMultipart(body, boundary) {
  let delim = Buffer.from(`--${boundary}`);
  let index = body.indexOf(delim);
  if (index === -1) {
    const lower = body.toString("latin1").toLowerCase();
    const found = lower.indexOf(`--${boundary.toLowerCase()}`);
    if (found !== -1) {
      delim = body.subarray(found, found + boundary.length + 2);
      index = found;
    }
  }
  const parts = [];
  while (index !== -1) {
    const start = index + delim.length;
    const next = body.indexOf(delim, start);
    if (next === -1) break;
    let chunk = body.subarray(start, next);
    if (chunk.subarray(0, 2).toString() === "\r\n") chunk = chunk.subarray(2);
    if (chunk.subarray(-2).toString() === "\r\n") chunk = chunk.subarray(0, -2);
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const rawHeaders = chunk.subarray(0, headerEnd).toString("latin1");
      const data = chunk.subarray(headerEnd + 4);
      const nameMatch = rawHeaders.match(/name="([^"]*)"/i);
      const fileMatch = rawHeaders.match(/filename="([^"]*)"/i);
      const typeMatch = rawHeaders.match(/content-type:\s*([^\r\n]+)/i);
      parts.push({
        field: nameMatch ? nameMatch[1] : "",
        filename: fileMatch ? fileMatch[1] : null,
        contentType: typeMatch ? typeMatch[1].trim() : null,
        data
      });
    }
    index = next;
  }

  const filePart =
    parts.find((p) => p.filename && /video|octet-stream/.test(String(p.contentType || ""))) ||
    parts.find((p) => p.filename) ||
    parts.find((p) => ["video", "file", "new-image", "upload"].includes(p.field));
  return filePart ? { bytes: filePart.data, name: filePart.filename || `${filePart.field}.mp4`, contentType: filePart.contentType } : null;
}

export function sendErrorSafe(res, err) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendError(res, err);
}

export function videoToGifStats() {
  return { antre: gifQueue.stats, maxInputBytes: MAX_INPUT_BYTES, maxClipSec: MAX_CLIP_SEC, maxFrames: MAX_FRAMES, proxyLimitBytes: PROXY_LIMIT_BYTES };
}

export { HttpError };
