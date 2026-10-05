const VERSION = "1.0.0";

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs) {
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expires < now) cache.delete(k);
    }
    if (cache.size > 500) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
  }
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

function cacheStats() {
  return { entries: cache.size };
}

class Limiter {
  constructor(concurrency = 4, minGapMs = 250) {
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
    const now = Date.now();
    const wait = Math.max(0, this.lastStarted + this.minGapMs - now);
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
}

const limiter = new Limiter(4, 250);

async function httpFetch(url, options = {}) {
  const { timeoutMs = 30000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new HttpError(504, "UPSTREAM_TIMEOUT", "Permintaan ke Pinterest melewati batas waktu");
    }
    throw new HttpError(502, "UPSTREAM_UNREACHABLE", `Gagal menghubungi sumber: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const HTML_HEADERS = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "upgrade-insecure-requests": "1",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none"
};

const IMAGE_FIELDS = [
  { key: "images_orig", label: "original", rank: 100 },
  { key: "imageLargeUrl", label: "1200x", rank: 90 },
  { key: "images_736x", label: "736x", rank: 80 },
  { key: "images_564x", label: "564x", rank: 70 },
  { key: "images_474x", label: "474x", rank: 60 },
  { key: "images_400x300", label: "400x300", rank: 55 },
  { key: "images_236x", label: "236x", rank: 50 },
  { key: "images_170x", label: "170x", rank: 40 },
  { key: "images_136x136", label: "136x136", rank: 30 },
  { key: "images_60x60", label: "60x60", rank: 20 }
];

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\u002F/gi, "/");
}

function scanStringEnd(text, start) {
  if (text[start] !== '"') return -1;
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') return i;
    i++;
  }
  return -1;
}

function scanBalanced(text, start) {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

function collectRelayPayloads(html) {
  const payloads = [];
  const markers = ["__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("];
  for (const marker of markers) {
    let cursor = 0;
    while (true) {
      const at = html.indexOf(marker, cursor);
      if (at === -1) break;
      cursor = at + marker.length;
      const argStart = html.indexOf('"', at + marker.length);
      if (argStart === -1 || argStart > at + marker.length + 4) continue;
      const strEnd = scanStringEnd(html, argStart);
      if (strEnd === -1) continue;
      let p = strEnd + 1;
      while (p < html.length && html[p] !== "{" && html[p] !== "[" && html[p] !== ")") p++;
      if (p >= html.length || html[p] === ")") continue;
      const end = scanBalanced(html, p);
      if (end === -1) continue;
      const raw = html.slice(p, end);
      if (raw.length < 40) continue;
      try {
        payloads.push(JSON.parse(raw));
      } catch {}
    }
  }
  return payloads;
}

function deepFindPins(node, out, visited) {
  if (!node || typeof node !== "object") return out;
  if (visited.has(node)) return out;
  visited.add(node);
  if (Array.isArray(node)) {
    for (const item of node) deepFindPins(item, out, visited);
    return out;
  }
  if (typeof node.entityId === "string" && node.entityId.length >= 10) {
    const looksLikePin =
      "imageSignature" in node ||
      "images_orig" in node ||
      "videos" in node ||
      "images_236x" in node;
    if (looksLikePin) out.push(node);
  }
  for (const key of Object.keys(node)) deepFindPins(node[key], out, visited);
  return out;
}

function readScriptJson(html, id) {
  const re = new RegExp(
    `<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`,
    "i"
  );
  const m = html.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function readMeta(html, property) {
  const re = new RegExp(
    `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
    "i"
  );
  const alt = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    "i"
  );
  const m = html.match(re) || html.match(alt);
  return m ? decodeEntities(m[1]) : null;
}

function signatureFromUrl(url) {
  const clean = String(url).split("?")[0];
  const m = clean.match(/([a-f0-9]{16,64})\.(?:jpg|jpeg|png|webp|gif)$/i);
  if (m) return m[1];
  return clean;
}

const STREAM_URL_RE =
  /^https?:\/\/(?:v\d+\.pinimg\.com|i\.pinimg\.com)\/videos\/[a-z0-9/_.-]+\.(?:mp4|m3u8|mpd)/i;

const GENERIC_KEYS = /^(?:url|uri|src|link|href|source|file|video_?url|hls_?url|hlsv\d+[a-z_]*|mp4|v\d{3,4}p)$/i;

function videoSignature(url) {
  const clean = String(url || "").split("?")[0];
  const m = clean.match(/([a-f0-9]{24,64})[._-][a-z0-9]*\.(?:mp4|m3u8|jpg|jpeg|png|webp)$/i);
  if (m) return m[1];
  const m2 = clean.match(/([a-f0-9]{24,64})(?:_\d+w)?\.(?:mp4|m3u8)$/i);
  return m2 ? m2[1] : null;
}

function looksLikeVideoNode(node) {
  if (!node || typeof node !== "object") return false;
  if (node.videoDataV2 || node.videoList || node.video_list) return true;
  if (typeof node.__typename === "string" && /video/i.test(node.__typename)) return true;
  return false;
}

function collectVideoEntries(node, out, seen) {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) collectVideoEntries(item, out, seen);
    return;
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (typeof value === "string") {
      if (STREAM_URL_RE.test(value)) out.push({ url: value, key });
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (typeof value.url === "string" && STREAM_URL_RE.test(value.url)) {
      out.push({
        url: value.url,
        key,
        width: value.width ?? null,
        height: value.height ?? null,
        duration: value.duration ?? value.durationMs ?? null
      });
    }
    collectVideoEntries(value, out, seen);
  }
}

function labelForEntry(key, url) {
  if (key && !GENERIC_KEYS.test(key)) {
    const label = labelFromVariant(key);
    if (label && label.length <= 14 && !/^[a-f0-9]{8,}$/i.test(label)) return label;
  }
  return labelFromUrl(url);
}

function groupImages(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry) continue;
    const sig = signatureFromUrl(entry.url);
    const existing = groups.get(sig);
    if (!existing) {
      groups.set(sig, { ...entry, signature: sig, sizes: [entry] });
      continue;
    }
    existing.sizes.push(entry);
    if (entry.rank > existing.rank) {
      const merged = { ...entry, signature: sig, sizes: existing.sizes };
      groups.set(sig, merged);
    }
  }
  const list = [...groups.values()];
  for (const group of list) {
    group.sizes.sort((a, b) => b.rank - a.rank);
    group.sizes = group.sizes.map(({ url, label, width, height }) => ({ url, label, width, height }));
  }
  list.sort((a, b) => b.rank - a.rank);
  return list;
}

function buildImages(pin) {
  const entries = [];
  for (const field of IMAGE_FIELDS) {
    const raw = pin[field.key];
    if (!raw) continue;
    const url = typeof raw === "string" ? raw : raw.url;
    if (!url) continue;
    entries.push({
      url: decodeEntities(url),
      label: field.label,
      width: typeof raw === "object" ? raw.width ?? null : null,
      height: typeof raw === "object" ? raw.height ?? null : null,
      rank: field.rank
    });
  }
  return entries;
}

function labelFromVariant(key) {
  const k = String(key);
  const mp4 = k.match(/^v(\d{3,4})P$/i);
  if (mp4) return `${mp4[1]}p`;
  if (/hls/i.test(k)) return "hls";
  if (/h265/i.test(k)) return "h265";
  if (/dash|mpd/i.test(k)) return "dash";
  return k.toLowerCase();
}

function labelFromUrl(url) {
  if (/\/videos\/mc\/(\d+)p\//.test(url)) return `${url.match(/\/videos\/mc\/(\d+)p\//)[1]}p`;
  const w = url.match(/_(\d{3,4})w\.mp4/);
  if (w) return `${w[1]}w`;
  const t = url.match(/_t(\d)\.mp4/);
  if (t) return `hevc-t${t[1]}`;
  if (/\.m3u8/.test(url)) return /h265/i.test(url) ? "h265" : "hls";
  if (/\.mpd/.test(url)) return "dash";
  return "video";
}

function formatFromUrl(url, label) {
  if (/\.mp4($|\?)/i.test(url)) return "mp4";
  if (/\.m3u8($|\?)/i.test(url)) return "m3u8";
  if (/\.mpd($|\?)/i.test(url)) return "mpd";
  if (label === "hls" || label === "h265") return "m3u8";
  return "mp4";
}

function variantRank(entry) {
  if (entry.format === "mp4") {
    const h = parseInt(String(entry.label).replace(/[^\d]/g, ""), 10);
    return 1000 + (Number.isFinite(h) ? h : 0);
  }
  if (entry.format === "m3u8") return 400;
  if (entry.format === "mpd") return 300;
  return 100;
}

function buildVideos(pin) {
  const vids = pin.videos;
  if (!vids) return { videos: [], thumbnail: null };
  const seen = new Set();
  const list = [];
  const push = (url, label, duration, width, height) => {
    if (!url || seen.has(url)) return;
    const clean = decodeEntities(url);
    if (seen.has(clean)) return;
    seen.add(clean);
    const finalLabel = label || labelFromUrl(clean);
    list.push({
      url: clean,
      label: finalLabel,
      format: formatFromUrl(clean, finalLabel),
      width: width ?? null,
      height: height ?? null,
      durationMs: duration ?? null,
      tier: finalLabel.startsWith("hevc") ? "hevc" : undefined
    });
  };

  const listObj = vids.videoList || vids.video_list || {};
  for (const key of Object.keys(listObj)) {
    const item = listObj[key];
    if (!item || typeof item !== "object") continue;
    if (!item.url) continue;
    push(item.url, labelFromVariant(key), item.duration, item.width, item.height);
  }

  const flat = vids.videoUrls || vids.video_urls || [];
  for (const url of flat) {
    if (typeof url !== "string") continue;
    push(url, labelFromUrl(url), listObj.v720P?.duration, null, null);
  }

  const thumb =
    vids.videoList?.vHLSV4?.thumbnail ||
    vids.videoList?.v720P?.thumbnail ||
    null;

  list.sort((a, b) => variantRank(b) - variantRank(a));
  for (const item of list) {
    if (!item.thumbnail && thumb) item.thumbnail = thumb;
  }
  return { videos: list, thumbnail: thumb ? decodeEntities(thumb) : null };
}

function hlsCandidates(signature) {
  if (!signature || signature.length < 6) return [];
  const a = signature.slice(0, 2);
  const b = signature.slice(2, 4);
  const c = signature.slice(4, 6);
  const widths = [1080, 720, 540, 480, 360, 240];
  return widths.map((w) => ({
    url: `https://v1.pinimg.com/videos/iht/expMp4/${a}/${b}/${c}/${signature}_${w}w.mp4`,
    label: `${w}w`,
    format: "mp4",
    width: null,
    height: null,
    durationMs: null,
    alternate: true
  }));
}

function walkNested(node, onPin, visited) {
  if (!node || typeof node !== "object") return;
  if (visited.has(node)) return;
  visited.add(node);
  if (Array.isArray(node)) {
    for (const item of node) walkNested(item, onPin, visited);
    return;
  }
  if (node.imageSignature || node.images_orig || node.entityId || looksLikeVideoNode(node)) onPin(node);
  for (const key of Object.keys(node)) walkNested(node[key], onPin, visited);
}

function buildNestedMedia(pin) {
  const images = [];
  const videos = [];
  const seenImg = new Set();
  const seenVid = new Set();

  const handle = (node, label) => {
    if (node.imageSignature || node.images_orig || node.imageLargeUrl) {
      const candidatesList = [
        node.images_orig,
        node.imageLargeUrl,
        node.images_736x,
        node.images_474x,
        node.images_236x
      ];
      for (const raw of candidatesList) {
        const url = typeof raw === "string" ? raw : raw?.url;
        if (!url || seenImg.has(url)) continue;
        if (/videos\/thumbnails/.test(url)) continue;
        seenImg.add(url);
        images.push({ url: decodeEntities(url), label: label || "nested", rank: 95, width: null, height: null });
        break;
      }
    }
    const listObj = node.videos?.videoList || node.videos?.video_list || {};
    for (const key of Object.keys(listObj)) {
      const item = listObj[key];
      if (!item?.url || seenVid.has(item.url)) continue;
      seenVid.add(item.url);
      const finalLabel = labelFromVariant(key);
      videos.push({
        url: decodeEntities(item.url),
        label: finalLabel,
        format: formatFromUrl(item.url, finalLabel),
        width: item.width ?? null,
        height: item.height ?? null,
        durationMs: item.duration ?? null
      });
    }

    const entries = [];
    collectVideoEntries(node, entries, new Set());
    for (const entry of entries) {
      if (seenVid.has(entry.url)) continue;
      seenVid.add(entry.url);
      const finalLabel = labelForEntry(entry.key, entry.url);
      videos.push({
        url: decodeEntities(entry.url),
        label: finalLabel,
        format: formatFromUrl(entry.url, finalLabel),
        width: entry.width ?? null,
        height: entry.height ?? null,
        durationMs: entry.duration ?? null
      });
    }
  };

  for (const source of [pin.storyPinData, pin.carouselData]) {
    if (!source) continue;
    walkNested(source, (node) => handle(node, "nested"), new Set());
  }

  return { images, videos };
}

function orderVideos(videos) {
  const mp4Direct = videos.filter((v) => v.format === "mp4" && !v.alternate);
  const hlsVariants = videos.filter((v) => v.format === "m3u8" && v.variant);
  const mp4Alt = videos.filter((v) => v.format === "mp4" && v.alternate);
  const rest = videos.filter(
    (v) => !mp4Direct.includes(v) && !hlsVariants.includes(v) && !mp4Alt.includes(v)
  );
  const sortDesc = (list, key) => [...list].sort((a, b) => (key(b) || 0) - (key(a) || 0));
  return [
    ...mp4Direct,
    ...sortDesc(mp4Alt, (v) => v.width || 0),
    ...sortDesc(hlsVariants, (v) => v.height || 0),
    ...rest
  ];
}

function resolveType(pin, images, videos) {
  if (videos.length) return "video";
  if (images.length > 1) return "carousel";
  return "image";
}

function scoreCandidate(pin) {
  let score = 0;
  if (pin.pinner?.username) score += 40;
  if (pin.pinner?.fullName) score += 10;
  if (pin.images_orig) score += 20;
  if (pin.imageLargeUrl) score += 10;
  if (pin.videos) score += 25;
  if (pin.gridTitle || pin.title) score += 8;
  if (pin.description) score += 8;
  if (pin.board?.name) score += 6;
  if (pin.storyPinData || pin.storyPinDataId) score += 5;
  if (pin.repinCount != null) score += 4;
  if (pin.link || pin.richSummary) score += 3;
  return score;
}

function mergeCandidates(list) {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const base = { ...sorted[0] };
  for (const other of sorted.slice(1)) {
    for (const key of Object.keys(other)) {
      const value = other[key];
      if (value == null) continue;
      const existing = base[key];
      if (existing == null || (typeof existing === "object" && !Array.isArray(existing) && typeof value === "object" && !Array.isArray(value))) {
        base[key] = existing == null ? value : { ...value, ...existing };
      }
    }
    if (base.pinner && other.pinner) {
      base.pinner = { ...other.pinner, ...base.pinner };
    }
    if (base.videos && other.videos) {
      base.videos = { ...other.videos, ...base.videos };
      if (!base.videos.videoList && other.videos.videoList) base.videos.videoList = other.videos.videoList;
    }
  }
  return base;
}

function normalizePin(pin, fallbackId) {
  const { videos, thumbnail } = buildVideos(pin);
  const nested = buildNestedMedia(pin);
  for (const extra of nested.videos) {
    if (!videos.some((v) => v.url === extra.url)) videos.push(extra);
  }

  const images = groupImages([...buildImages(pin), ...nested.images]).slice(0, 40);

  const hasVideo = videos.length > 0;
  if (hasVideo) {
    const sigs = new Set();
    if (pin.videos?.signature) sigs.add(pin.videos.signature);
    for (const item of videos) {
      const sig = videoSignature(item.url);
      if (sig) sigs.add(sig);
    }
    for (const item of images) {
      if (!/videos\/thumbnails/.test(item.url)) continue;
      const sig = videoSignature(item.url);
      if (sig) sigs.add(sig);
    }
    for (const sig of sigs) {
      for (const cand of hlsCandidates(sig)) {
        if (!videos.some((v) => v.url === cand.url)) videos.push(cand);
      }
    }
  }

  const cover =
    thumbnail ||
    images.find((i) => i.label === "original")?.url ||
    images[0]?.url ||
    null;

  const pinnerCandidates = [pin.pinner, pin.originPinner, pin.nativeCreator, pin.closeupAttribution];
  const pinner = pinnerCandidates.reduce((acc, cur) => {
    if (!cur) return acc;
    const merged = { ...acc };
    for (const key of ["username", "fullName", "imageMediumUrl", "imageSmallUrl", "isVerifiedMerchant", "id", "entityId"]) {
      if (merged[key] == null && cur[key] != null) merged[key] = cur[key];
    }
    return merged;
  }, {});

  return {
    id: String(pin.entityId || fallbackId || ""),
    url: `https://www.pinterest.com/pin/${pin.entityId || fallbackId}/`,
    type: resolveType(pin, images, videos),
    isStoryPin: Boolean(pin.storyPinData?.pages?.length),
    isIdeaPin: Boolean(pin.isV1IdeaPin),
    mediaCount: { images: images.length, videos: videos.length },
    title: decodeEntities(pin.gridTitle || pin.title || pin.seoTitle || ""),
    description: decodeEntities(pin.gridDescription || pin.description || ""),
    altText: pin.seoAltText ? decodeEntities(pin.seoAltText) : null,
    dominantColor: pin.dominantColor || null,
    createdAt: pin.createdAt || null,
    domain: pin.domain || null,
    link: pin.link || null,
    author: {
      username: pinner.username || null,
      fullName: pinner.fullName || null,
      avatar: pinner.imageMediumUrl || pinner.imageSmallUrl || null,
      verified: Boolean(pinner.isVerifiedMerchant)
    },
    board: pin.board
      ? { name: pin.board.name || null, url: pin.board.url || null, id: pin.board.id || null }
      : null,
    stats: {
      saves: pin.repinCount ?? null,
      comments: pin.commentCount ?? null,
      repins: pin.repinCount ?? null
    },
    cover,
    images,
    videos: orderVideos(videos)
  };
}

function fallbackFromHtml(html, id) {
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/url\([^)]*\)/gi, " ");
  const images = [];
  const seen = new Set();
  const re = /https:\/\/i\.pinimg\.com\/((?:originals|1200x|736x|564x|474x|236x|170x|136x136|60x60|600x315))\/[a-z0-9/_.-]+\.(?:jpg|png|webp|gif)/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const url = m[0];
    if (seen.has(url)) continue;
    seen.add(url);
    const size = m[1];
    const rank = size === "originals" ? 100 : size === "1200x" ? 90 : size === "736x" ? 80 : 50;
    images.push({ url, label: size, width: null, height: null, rank });
  }
  images.sort((a, b) => b.rank - a.rank);

  const videos = [];
  const vseen = new Set();
  const vre = /https:\/\/v1\.pinimg\.com\/videos\/(?:iht|mc)\/[a-z0-9/_.-]+\.(?:mp4|m3u8|mpd)/gi;
  while ((m = vre.exec(cleaned)) !== null) {
    const url = m[0];
    if (vseen.has(url)) continue;
    vseen.add(url);
    const label = labelFromUrl(url);
    videos.push({ url, label, format: formatFromUrl(url, label), width: null, height: null, durationMs: null });
  }
  videos.sort((a, b) => variantRank(b) - variantRank(a));

  const ogImage = readMeta(html, "og:image");
  if (ogImage) {
    images.push({ url: ogImage, label: "og:image", width: null, height: null, rank: 85 });
  }
  const grouped = groupImages(images).map((group) => ({
    url: group.url,
    label: group.label,
    width: group.width,
    height: group.height,
    signature: group.signature,
    sizes: group.sizes
  }));

  return {
    id: String(id || ""),
    url: id ? `https://www.pinterest.com/pin/${id}/` : null,
    type: videos.length ? "video" : "image",
    title: readMeta(html, "og:title") || "",
    description: readMeta(html, "og:description") || "",
    altText: null,
    dominantColor: null,
    createdAt: null,
    domain: null,
    link: null,
    author: { username: null, fullName: null, avatar: null, verified: false },
    board: null,
    stats: { saves: null, comments: null, repins: null },
    cover: ogImage || grouped[0]?.url || null,
    images: grouped,
    videos,
    isStoryPin: false,
    isIdeaPin: false,
    mediaCount: { images: grouped.length, videos: videos.length },
    degraded: true
  };
}

function parseMasterPlaylist(text) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    let uri = null;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next || next.startsWith("#")) continue;
      uri = next;
      break;
    }
    if (!uri) continue;
    const res = line.match(/RESOLUTION=(\d+)x(\d+)/);
    const width = res ? Number(res[1]) : null;
    const height = res ? Number(res[2]) : null;
    const named = uri.match(/_(\d{3,4})w\.m3u8/i);
    const label = named ? `${named[1]}w` : width ? `${width}w` : `variant-${variants.length + 1}`;
    variants.push({ uri, label, width, height });
  }
  return variants;
}

async function enrichHlsVariants(pin) {
  if (!pin.videos?.length) return pin;
  const master = pin.videos.find((v) => v.format === "m3u8" && !v.variant);
  if (!master) return pin;

  const key = `hls:${master.url}`;
  let variants = cacheGet(key);
  if (!variants) {
    try {
      const res = await limiter.run(() =>
        httpFetch(master.url, {
          headers: { "user-agent": UA, accept: "*/*", referer: "https://www.pinterest.com/" },
          timeoutMs: 15000
        })
      );
      const text = await res.text();
      variants = parseMasterPlaylist(text);
      cacheSet(key, variants, 30 * 60 * 1000);
    } catch {
      variants = [];
    }
  }

  const base = master.url.slice(0, master.url.lastIndexOf("/") + 1);
  for (const variant of variants) {
    const url = /^https?:/i.test(variant.uri) ? variant.uri : `${base}${variant.uri}`;
    if (pin.videos.some((v) => v.url === url)) continue;
    pin.videos.push({
      url,
      label: variant.label,
      format: "m3u8",
      width: variant.width,
      height: variant.height,
      durationMs: master.durationMs ?? null,
      variant: true,
      parent: master.url
    });
  }

  const byLabel = new Map(variants.map((v) => [v.label, v]));
  for (const item of pin.videos) {
    const hit = byLabel.get(item.label);
    if (!hit) continue;
    if (item.width == null) item.width = hit.width;
    if (item.height == null) item.height = hit.height;
  }
  return pin;
}

const ALT_CACHE = new Map();

async function probeMedia(url) {
  const hit = ALT_CACHE.get(url);
  if (hit && hit.expires > Date.now()) return hit.ok;
  let ok = false;
  for (const method of ["HEAD", "GET"]) {
    try {
      const res = await httpFetch(url, {
        method,
        redirect: "follow",
        timeoutMs: 12000,
        headers: {
          "user-agent": UA,
          accept: "*/*",
          referer: "https://www.pinterest.com/",
          range: method === "GET" ? "bytes=0-0" : undefined
        }
      });
      await res.body?.cancel?.();
      if (res.status === 200 || res.status === 206) {
        ok = true;
        break;
      }
    } catch {}
  }
  ALT_CACHE.set(url, { ok, expires: Date.now() + 10 * 60 * 1000 });
  return ok;
}

async function verifyVideoAlternates(pin) {
  if (!pin.videos?.length) return pin;
  const alternates = pin.videos.filter((v) => v.alternate);
  if (!alternates.length) return pin;
  const results = await Promise.all(alternates.map((v) => probeMedia(v.url)));
  const dead = new Set(alternates.filter((v, i) => !results[i]).map((v) => v.url));
  if (dead.size) pin.videos = pin.videos.filter((v) => !dead.has(v.url));
  return pin;
}

function parsePinId(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (/^\d{8,25}$/.test(raw)) return raw;
  const direct = raw.match(/pinterest\.[a-z.]+\/pin\/(\d{8,25})/i);
  if (direct) return direct[1];
  const anyPin = raw.match(/\/pin\/(\d{8,25})/i);
  if (anyPin) return anyPin[1];
  const query = raw.match(/[?&]pin_id=(\d{8,25})/i);
  if (query) return query[1];
  return null;
}

function parseShortCode(input) {
  if (!input) return null;
  const m = String(input).match(/pin\.it\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

async function expandShortUrl(input) {
  const code = parseShortCode(input);
  if (!code) return { url: input, expanded: false };
  const key = `short:${code}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  let target = null;
  try {
    const res = await limiter.run(() =>
      httpFetch(`https://api.pinterest.com/url_shortener/${code}/redirect/`, {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "text/html" },
        timeoutMs: 15000
      })
    );
    target = res.headers.get("location");
    await res.text().catch(() => "");
  } catch {}

  if (!target) {
    try {
      const res = await limiter.run(() =>
        httpFetch(`https://pin.it/${code}`, {
          redirect: "manual",
          headers: { "user-agent": UA, accept: "text/html" },
          timeoutMs: 15000
        })
      );
      target = res.headers.get("location");
      await res.text().catch(() => "");
    } catch {}
  }

  if (!target) {
    throw new HttpError(404, "SHORT_URL_UNRESOLVED", "Link pin.it tidak bisa dibuka jadi URL pin penuh");
  }

  const clean = target.split("?")[0].replace(/\/sent\/?$/, "/");
  const result = { url: clean, expanded: true };
  cacheSet(key, result, 60 * 60 * 1000);
  return result;
}

async function resolveInput(input) {
  if (!input) {
    throw new HttpError(400, "MISSING_URL", "Parameter 'url' wajib diisi (link pin atau ID pin)");
  }
  const trimmed = String(input).trim();
  let id = parsePinId(trimmed);
  let canonical = trimmed;
  let expanded = false;

  if (!id) {
    const short = await expandShortUrl(trimmed);
    canonical = short.url;
    expanded = short.expanded;
    id = parsePinId(canonical);
  }

  if (!id) {
    throw new HttpError(
      400,
      "INVALID_URL",
      "Tidak menemukan ID pin. Format yang didukung: pinterest.com/pin/<id>/, pin.it/<kode>, atau angka ID langsung"
    );
  }

  return { id, canonical: id ? `https://www.pinterest.com/pin/${id}/` : canonical, expanded };
}

async function fetchPinHtml(id, options = {}) {
  const host = options.host || "www.pinterest.com";
  const userAgent = options.userAgent || UA;
  const useCache = options.cache !== false;
  const key = `html:${id}:${host}:${userAgent === UA ? "desktop" : "android"}`;
  if (useCache) {
    const hit = cacheGet(key);
    if (hit) return hit;
  }

  const res = await limiter.run(() =>
    httpFetch(`https://${host}/pin/${id}/`, {
      headers: { ...HTML_HEADERS, "user-agent": userAgent },
      timeoutMs: 30000
    })
  );

  if (res.status === 404) {
    await res.text().catch(() => "");
    throw new HttpError(404, "PIN_NOT_FOUND", `Pin ${id} tidak ditemukan di Pinterest`);
  }
  if (res.status === 429) {
    await res.text().catch(() => "");
    throw new HttpError(429, "RATE_LIMITED", "Pinterest membatasi permintaan, coba lagi beberapa saat");
  }
  if (!res.ok) {
    await res.text().catch(() => "");
    throw new HttpError(502, "UPSTREAM_ERROR", `Pinterest membalas HTTP ${res.status}`);
  }

  const html = await res.text();
  if (html.length < 2000) {
    throw new HttpError(502, "EMPTY_RESPONSE", "Pinterest mengirim halaman kosong");
  }
  if (useCache) cacheSet(key, html, 5 * 60 * 1000);
  return html;
}

function extractPin(html, id) {
  const payloads = collectRelayPayloads(html);
  const candidates = [];
  const visited = new Set();
  for (const payload of payloads) deepFindPins(payload, candidates, visited);

  if (!candidates.length) {
    const props = readScriptJson(html, "__PWS_INITIAL_PROPS__");
    const statePins = props?.initialReduxState?.pins;
    if (statePins && typeof statePins === "object") {
      for (const key of Object.keys(statePins)) {
        const value = statePins[key];
        if (value && value.entityId) candidates.push(value);
        if (value && value.data && value.data.entityId) candidates.push(value.data);
      }
    }
  }

  const exact = candidates.filter((p) => String(p.entityId) === String(id));
  let chosen = mergeCandidates(exact);
  let canonicalWarning = null;

  if (!chosen) {
    const ogUrl = readMeta(html, "og:url");
    const ogPin = ogUrl ? parsePinId(ogUrl) : null;
    if (ogPin) {
      const alt = candidates.filter((p) => String(p.entityId) === String(ogPin));
      if (alt.length) {
        chosen = mergeCandidates(alt);
        if (String(ogPin) !== String(id)) {
          canonicalWarning =
            "Pinterest menampilkan pin berbeda dari yang diminta (kemungkinan link undangan, pin duplikat, atau pin sudah berpindah)";
        }
      }
    }
  }

  if (chosen) {
    const normalized = normalizePin(chosen, id);
    if (canonicalWarning) normalized.canonicalWarning = canonicalWarning;
    if (normalized.images.length || normalized.videos.length) return normalized;
  }

  const hasOpenGraph = Boolean(
    readMeta(html, "og:image") || readMeta(html, "og:title") || readMeta(html, "og:url")
  );
  if (!hasOpenGraph) {
    throw new HttpError(
      404,
      "PIN_NOT_FOUND",
      `Pin ${id} tidak ditemukan. Pastikan link pin benar dan pinnya masih publik`
    );
  }

  return fallbackFromHtml(html, id);
}

async function getPin(input, options = {}) {
  const { id, canonical } = await resolveInput(input);
  const cacheKey = `pin:${id}:${options.withAlternates ? "alt" : "std"}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const attempts = [
    { host: "www.pinterest.com", userAgent: UA },
    { host: "www.pinterest.com", userAgent: UA_ANDROID },
    { host: "www.pinterest.com", userAgent: UA, cache: false }
  ];

  let pin = null;
  for (let i = 0; i < attempts.length; i++) {
    const html = await fetchPinHtml(id, { ...attempts[i], cache: i === 0 });
    pin = extractPin(html, id);
    if (!pin.degraded && (pin.images.length || pin.videos.length)) break;
  }

  pin.requestedUrl = canonical;
  pin.fetchedAt = new Date().toISOString();
  await enrichHlsVariants(pin);
  await verifyVideoAlternates(pin);

  if (!pin.images.length && !pin.videos.length) {
    throw new HttpError(
      404,
      "NO_MEDIA",
      "Pin ini tidak punya media yang bisa diambil (mungkin board, profil, atau pin teks)"
    );
  }

  cacheSet(cacheKey, pin, 10 * 60 * 1000);
  return pin;
}

{ UA, HTML_HEADERS };
const MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  m3u8: "application/vnd.apple.mpegurl",
  mpd: "application/dash+xml"
};

const ALLOWED_MEDIA_HOSTS = [
  "pinimg.com",
  "giphy.com",
  "giphyusercontent.com"
];

const PROXY_LIMIT_BYTES = 4 * 1024 * 1024;

function isAllowedMediaHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return ALLOWED_MEDIA_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-allow-headers": "content-type,range",
    "access-control-expose-headers":
      "content-length,content-range,accept-ranges,x-pindl-id,x-pindl-variant,x-pindl-format,x-pindl-note",
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

function extFromUrl(url, fallback) {
  const clean = String(url).split("?")[0];
  const m = clean.match(/\.([a-z0-9]{2,4})$/i);
  if (!m) return fallback;
  const ext = m[1].toLowerCase();
  return ext === "jpeg" ? "jpg" : ext;
}

function variantLabel(v) {
  const raw = String(v.label || "").toLowerCase();
  const num = raw.match(/(\d{3,4})/);
  if (!num) return { num: 0, kind: raw, raw };
  return { num: Number(num[1]), kind: raw.replace(/[\d]/g, ""), raw };
}

function buildVideoOrder(videos) {
  const mp4Direct = videos.filter((v) => v.format === "mp4" && !v.alternate);
  const mp4Alt = videos.filter((v) => v.format === "mp4" && v.alternate);
  const hlsVariants = videos.filter((v) => v.format === "m3u8" && v.variant);
  const rest = videos.filter(
    (v) => !mp4Direct.includes(v) && !mp4Alt.includes(v) && !hlsVariants.includes(v)
  );
  const sortDesc = (list, key) => [...list].sort((a, b) => (key(b) || 0) - (key(a) || 0));
  return [
    ...mp4Direct,
    ...sortDesc(mp4Alt, (v) => (v.width || 0) * 1000 + (variantLabel(v).num || 0)),
    ...sortDesc(hlsVariants, (v) => v.height || variantLabel(v).num || 0),
    ...rest
  ];
}

function pickImage(pin, index) {
  if (!pin.images.length) throw new HttpError(404, "NO_IMAGE", "Pin ini tidak punya gambar");
  const i = Math.min(Math.max(Number(index) || 0, 0), pin.images.length - 1);
  return { item: pin.images[i], index: i };
}

function pickVideo(pin, quality) {
  if (!pin.videos.length) throw new HttpError(404, "NO_VIDEO", "Pin ini tidak punya video atau gif");
  const ordered = buildVideoOrder(pin.videos);
  if (quality) {
    const want = String(quality).toLowerCase().trim();
    const matches = ordered.filter((v) => String(v.label).toLowerCase() === want);
    if (!matches.length) {
      const num = want.match(/\d{3,4}/);
      if (num) {
        const target = Number(num[0]);
        matches.push(...ordered.filter((v) => variantLabel(v).num === target));
      }
    }
    if (matches.length) {
      const remainder = ordered.filter((v) => !matches.includes(v));
      return { item: matches[0], candidates: [...matches, ...remainder], quality: want };
    }
  }
  return { item: ordered[0], candidates: ordered, quality: null };
}

function openMedia(url, range) {
  return httpFetch(url, {
    redirect: "follow",
    timeoutMs: 45000,
    headers: {
      "user-agent": UA,
      accept: "*/*",
      referer: "https://www.pinterest.com/",
      range: range || undefined
    }
  });
}

async function pipeUpstream(req, res, upstream, headers, limitBytes) {
  res.writeHead(upstream.status, headers);
  if (req.method === "HEAD" || !upstream.body) {
    res.end();
    return;
  }
  let sent = 0;
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sent += value.byteLength;
      if (limitBytes && sent > limitBytes) {
        res.destroy();
        return;
      }
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once("drain", resolve));
      }
    }
  } catch {}
  res.end();
}

function redirectTo(res, target, extra = {}) {
  res.writeHead(302, {
    location: target,
    "cache-control": "public, max-age=300",
    ...corsHeaders(),
    ...extra
  });
  res.end();
}

function requireInput(params) {
  const input = params.get("url") || params.get("id") || params.get("u");
  if (!input) {
    throw new HttpError(400, "MISSING_URL", "Parameter 'url' wajib diisi: link pin, ID pin, atau link pin.it");
  }
  return input;
}

const RATE_DEFAULT_LIMIT = 1000;
const RATE_WINDOW_SEC = 86400;

function firstEnv(...names) {
  for (const name of names) {
    const value = typeof process !== "undefined" && process.env ? process.env[name] : null;
    if (value) return value;
  }
  return null;
}

const RATE = {
  storeUrl: firstEnv("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "REDIS_REST_API_URL"),
  storeToken: firstEnv("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN", "REDIS_REST_API_TOKEN"),
  limit: Number(firstEnv("PINDL_DAILY_LIMIT") || RATE_DEFAULT_LIMIT),
  whitelist: String(firstEnv("PINDL_UNLIMITED") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  memory: new Map()
};

function limitDisabled() {
  return !Number.isFinite(RATE.limit) || RATE.limit <= 0 || RATE.whitelist.includes("*");
}

function clientIp(req) {
  const forwarded =
    req.headers["x-forwarded-for"] || req.headers["x-vercel-forwarded-for"] || req.headers["x-real-ip"];
  const first = String(forwarded || "").split(",")[0].trim();
  if (first) return first;
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function clientKey(req, url) {
  const raw = req.headers["x-pindl-key"] || url.searchParams.get("key");
  return raw ? String(raw).trim() : null;
}

function isUnlimited(req, url, ip) {
  if (limitDisabled()) return true;
  const key = clientKey(req, url);
  if (key && RATE.whitelist.includes(key)) return true;
  return RATE.whitelist.includes(ip);
}

function memoryConsume(ip) {
  const now = Date.now();
  const hit = RATE.memory.get(ip);
  if (!hit || hit.resetAt <= now) {
    RATE.memory.set(ip, { count: 1, resetAt: now + RATE_WINDOW_SEC * 1000 });
    return { count: 1, resetIn: RATE_WINDOW_SEC, store: "memory" };
  }
  if (RATE.memory.size > 5000) {
    for (const [key, value] of RATE.memory) {
      if (value.resetAt <= now) RATE.memory.delete(key);
    }
  }
  hit.count += 1;
  return { count: hit.count, resetIn: Math.max(1, Math.round((hit.resetAt - now) / 1000)), store: "memory" };
}

async function storeCommand(base, token, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`penyimpanan membalas HTTP ${res.status}`);
  return res.json();
}

async function consumeQuota(ip) {
  if (RATE.storeUrl && RATE.storeToken) {
    const base = RATE.storeUrl.replace(/\/+$/, "");
    try {
      const key = `pindl:rl:${ip}`;
      const data = await storeCommand(base, RATE.storeToken, "/pipeline", [
        ["INCR", key],
        ["TTL", key]
      ]);
      const count = Number(data?.[0]?.result || 0) || 1;
      let resetIn = Number(data?.[1]?.result ?? -1);
      if (resetIn < 0) resetIn = RATE_WINDOW_SEC;
      if (count === 1) {
        try {
          await storeCommand(base, RATE.storeToken, `/expire/${encodeURIComponent(key)}/${RATE_WINDOW_SEC}`);
        } catch {}
      }
      return { count, resetIn, store: "redis" };
    } catch {}
  }
  return memoryConsume(ip);
}

async function applyRateLimit(req, res, url) {
  if (limitDisabled()) {
    res.setHeader("x-pindl-limit", "unlimited");
    return { allowed: true, unlimited: true, limit: null, store: RATE.storeUrl ? "redis" : "memory" };
  }
  const ip = clientIp(req);
  if (isUnlimited(req, url, ip)) {
    res.setHeader("x-pindl-limit", "unlimited");
    res.setHeader("x-pindl-limit-note", "whitelist");
    return { allowed: true, unlimited: true, limit: null, store: RATE.storeUrl ? "redis" : "memory" };
  }
  const usage = await consumeQuota(ip);
  const remaining = Math.max(0, RATE.limit - usage.count);
  res.setHeader("x-pindl-limit", String(RATE.limit));
  res.setHeader("x-pindl-limit-window", `${RATE_WINDOW_SEC / 3600}j`);
  res.setHeader("x-pindl-limit-remaining", String(remaining));
  res.setHeader("x-pindl-limit-reset", String(usage.resetIn));
  const info = {
    allowed: usage.count <= RATE.limit,
    limit: RATE.limit,
    terpakai: usage.count,
    sisa: remaining,
    resetDalamDetik: usage.resetIn,
    resetPada: new Date(Date.now() + usage.resetIn * 1000).toISOString(),
    store: usage.store,
  };
  if (!info.allowed) {
    sendJson(
      res,
      429,
      {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: `Kuota harian habis. Batas ${RATE.limit} permintaan per 24 jam untuk alamat ini.`,
          limit: RATE.limit,
          resetDalamDetik: usage.resetIn,
          resetPada: info.resetPada
        }
      },
      { "retry-after": String(usage.resetIn), "cache-control": "no-store" }
    );
  }
  return info;
}

function handleIndex(req, res, origin) {
  sendJson(res, 200, {
    ok: true,
    data: {
      service: "pindl-api",
      version: VERSION,
      deskripsi: "API pengunduh media Pinterest: foto, video, dan gif, Tanpa login.",
      endpoints: [
        { path: "/api/health", info: "Status layanan" },
        { path: "/api/resolve?url=https://pin.it/xxxx", info: "Ubah link pendek jadi link pin penuh" },
        { path: "/api/pin?url=<link|id|pin.it>", info: "Metadata pin + semua foto dan video" },
        {
          path: "/api/download?url=<link|id>&kind=video|image&q=720w&i=0&mode=redirect|proxy&json=1",
          info: "Ambil media. Default 302 langsung ke CDN Pinterest"
        },
        { path: "/api/proxy?u=<url media>", info: "Proxy media pinimg/giphy (maksimal 4 MB per respons)" },
        { path: "/api/probe?url=<link|id>", info: "Cek varian video mana yang masih hidup" }
      ],
      contoh: {
        pin: `${origin}/api/pin?url=https://www.pinterest.com/pin/1119496419891744897/`,
        video: `${origin}/api/download?url=1119496419891744897&kind=video`,
        foto: `${origin}/api/download?url=1119496419891744897&kind=image&i=0`
      },
      batas: {
        harian: limitDisabled() ? null : RATE.limit,
        per: "24 jam per alamat IP",
      },
      catatan: [
        "Karena keterbatasan vercel, jadi max file adalah 4MB saja tapi tenang kalau mencapai limit max akan tetap jalan sudah di handle oleh system api."
      ]
    }
  });
}

function handleHealth(req, res) {
  sendJson(res, 200, {
    ok: true,
    data: {
      service: "pindl-api",
      version: VERSION,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      cache: cacheStats(),
      waktu: new Date().toISOString(),
      pembatas: {
        batas: limitDisabled() ? null : RATE.limit,
        per: "24 jam",
        kuotaAnda: res.pindlQuota || null
      }
    }
  });
}

async function handleResolve(req, res, params) {
  const resolved = await resolveInput(requireInput(params));
  sendJson(res, 200, { ok: true, data: resolved });
}

async function handlePin(req, res, params, origin) {
  const input = requireInput(params);
  const pin = await getPin(input);
  const id = pin.id;
  const base = `${origin}/api/download?url=${encodeURIComponent(id)}`;
  pin.links = {
    pin: `https://www.pinterest.com/pin/${id}/`,
    fotoTerbaik: `${base}&kind=image&i=0`,
    videoTerbaik: pin.videos.length ? `${base}&kind=video` : null,
    semuaMedia: `${origin}/api/pin?url=${encodeURIComponent(id)}`
  };
  sendJson(res, 200, { ok: true, data: pin });
}

async function handleDownload(req, res, params, origin) {
  const input = requireInput(params);
  const kind = (params.get("kind") || "").toLowerCase();
  const index = Number(params.get("i") || 0);
  const quality = params.get("q") || params.get("quality");
  const mode = (params.get("mode") || "redirect").toLowerCase();

  if (!["redirect", "url", "proxy", "stream"].includes(mode)) {
    throw new HttpError(400, "BAD_MODE", "Parameter 'mode' hanya menerima redirect atau proxy");
  }

  const pin = await getPin(input);
  const wanted = kind || pin.type;
  let chosen;
  let candidates = [];
  let usedIndex = null;

  if (wanted === "video" || wanted === "gif") {
    const picked = pickVideo(pin, quality);
    chosen = picked.item;
    candidates = picked.candidates;
  } else {
    const picked = pickImage(pin, index);
    chosen = picked.item;
    candidates = [chosen];
    usedIndex = picked.index;
  }

  const ext =
    chosen.format === "m3u8"
      ? "m3u8"
      : chosen.format === "mpd"
        ? "mpd"
        : extFromUrl(chosen.url, wanted === "video" ? "mp4" : "jpg");
  const filename = `pin_${pin.id}_${chosen.label || "media"}.${ext}`;

  if (params.get("json") === "1") {
    const base = `${origin}/api/download?url=${encodeURIComponent(pin.id)}&kind=${wanted}`;
    sendJson(res, 200, {
      ok: true,
      data: {
        id: pin.id,
        type: wanted,
        index: usedIndex,
        filename,
        directUrl: chosen.url,
        downloadUrl: `${base}${chosen.format === "mp4" ? `&q=${encodeURIComponent(chosen.label)}` : ""}`,
        proxyUrl: `${origin}/api/proxy?u=${encodeURIComponent(chosen.url)}`,
        chosen: { label: chosen.label, format: chosen.format, width: chosen.width, height: chosen.height, url: chosen.url },
        candidates: candidates.map((c) => ({
          label: c.label,
          format: c.format,
          width: c.width ?? null,
          height: c.height ?? null,
          url: c.url
        }))
      }
    });
    return;
  }

  if (!isAllowedMediaHost(new URL(chosen.url).hostname)) {
    throw new HttpError(400, "HOST_NOT_ALLOWED", "URL media tidak berasal dari domain media yang diizinkan");
  }

  if (mode === "redirect" || mode === "url") {
    redirectTo(res, chosen.url, {
      "x-pindl-id": pin.id,
      "x-pindl-variant": chosen.label || "media",
      "x-pindl-format": chosen.format || ext,
      "x-pindl-note": "ambil langsung dari CDN Pinterest"
    });
    return;
  }

  const range = req.headers.range;
  for (const candidate of candidates.slice(0, 8)) {
    if (!isAllowedMediaHost(new URL(candidate.url).hostname)) continue;
    let upstream;
    try {
      upstream = await openMedia(candidate.url, range);
    } catch {
      continue;
    }
    if (upstream.status !== 200 && upstream.status !== 206) {
      await upstream.body?.cancel?.();
      continue;
    }
    const length = Number(upstream.headers.get("content-length") || 0);
    if (!range && length > PROXY_LIMIT_BYTES) {
      await upstream.body?.cancel?.();
      redirectTo(res, candidate.url, {
        "x-pindl-id": pin.id,
        "x-pindl-variant": candidate.label || "media",
        "x-pindl-note": "file lebih dari 4 MB, dialihkan ke CDN"
      });
      return;
    }
    const headers = {
      "content-type":
        upstream.headers.get("content-type") || MIME_BY_EXT[extFromUrl(candidate.url, "jpg")] || "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "public, max-age=600",
      "x-pindl-id": pin.id,
      "x-pindl-variant": candidate.label || "media",
      "x-pindl-format": candidate.format || ext,
      ...corsHeaders()
    };
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(h);
      if (value) headers[h] = value;
    }
    await pipeUpstream(req, res, upstream, headers, PROXY_LIMIT_BYTES);
    return;
  }

  throw new HttpError(502, "MEDIA_UNAVAILABLE", "Tidak ada varian media yang bisa diambil dari Pinterest");
}

async function handleProxy(req, res, params) {
  const target = params.get("u");
  if (!target) throw new HttpError(400, "MISSING_U", "Parameter 'u' wajib diisi dengan URL media");
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    throw new HttpError(400, "BAD_URL", "URL media tidak valid");
  }
  if (parsed.protocol !== "https:" || !isAllowedMediaHost(parsed.hostname)) {
    throw new HttpError(403, "HOST_NOT_ALLOWED", "Hanya media dari domain pinimg atau giphy yang bisa diproksikan");
  }

  const range = req.headers.range;
  const upstream = await openMedia(parsed.toString(), range);
  if (upstream.status !== 200 && upstream.status !== 206) {
    await upstream.body?.cancel?.();
    throw new HttpError(502, "PROXY_FAILED", `Sumber media membalas HTTP ${upstream.status}`);
  }

  const length = Number(upstream.headers.get("content-length") || 0);
  if (!range && length > PROXY_LIMIT_BYTES) {
    await upstream.body?.cancel?.();
    redirectTo(res, parsed.toString(), {
      "x-pindl-note": "file lebih dari 4 MB, dialihkan ke CDN"
    });
    return;
  }

  const headers = {
    "content-type": upstream.headers.get("content-type") || "application/octet-stream",
    "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    ...corsHeaders()
  };
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(h);
    if (value) headers[h] = value;
  }
  await pipeUpstream(req, res, upstream, headers, PROXY_LIMIT_BYTES);
}

async function handleProbe(req, res, params) {
  const pin = await getPin(requireInput(params));
  const checks = await Promise.all(
    pin.videos.map(async (v) => ({
      label: v.label,
      format: v.format,
      width: v.width ?? null,
      height: v.height ?? null,
      url: v.url,
      ok: await probeMedia(v.url)
    }))
  );
  sendJson(res, 200, {
    ok: true,
    data: {
      id: pin.id,
      total: checks.length,
      hidup: checks.filter((c) => c.ok).length,
      videos: checks
    }
  });
}

function routeFromPath(pathname) {
  const clean = String(pathname || "/").replace(/\/+$/, "");
  if (!clean || clean === "/" || clean === "/api" || clean === "/index.html") return "index";
  const last = clean.split("/").filter(Boolean).pop() || "index";
  return last.toLowerCase();
}

export async function handleApi(req, res, route) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || "http";
  const origin = `${proto}://${host}`;
  let url;
  try {
    url = new URL(req.url, origin);
  } catch {
    url = new URL("/", origin);
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, {
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Hanya menerima GET, HEAD, dan OPTIONS" }
    });
    return;
  }

  const name = route || routeFromPath(url.pathname);
  const params = url.searchParams;

  const quota = await applyRateLimit(req, res, url);
  if (!quota.allowed) return;
  res.pindlQuota = quota;

  try {
    if (name === "index") {
      handleIndex(req, res, origin);
      return;
    }
    if (name === "health") {
      handleHealth(req, res);
      return;
    }
    if (name === "resolve") {
      await handleResolve(req, res, params);
      return;
    }
    if (name === "pin") {
      await handlePin(req, res, params, origin);
      return;
    }
    if (name === "download") {
      await handleDownload(req, res, params, origin);
      return;
    }
    if (name === "proxy") {
      await handleProxy(req, res, params);
      return;
    }
    if (name === "probe") {
      await handleProbe(req, res, params);
      return;
    }
    sendJson(res, 404, {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Endpoint tidak dikenal",
        endpoints: [
          "GET /api/health",
          "GET /api/resolve?url=",
          "GET /api/pin?url=",
          "GET /api/download?url=&kind=video|image&q=720w&i=0&mode=redirect|proxy&json=1",
          "GET /api/proxy?u=",
          "GET /api/probe?url="
        ]
      }
    });
  } catch (err) {
    if (!res.headersSent) {
      sendError(res, err);
      return;
    }
    res.destroy();
  }
}

export {
  VERSION,
  HttpError,
  cacheGet,
  cacheSet,
  cacheStats,
  limiter,
  httpFetch,
  getPin,
  extractPin,
  fetchPinHtml,
  resolveInput,
  expandShortUrl,
  parsePinId,
  parseShortCode,
  collectRelayPayloads,
  deepFindPins,
  enrichHlsVariants,
  verifyVideoAlternates,
  buildVideoOrder,
  pickVideo,
  pickImage,
  isAllowedMediaHost,
  UA,
  HTML_HEADERS
};
