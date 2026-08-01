/**
 * /api/youtube — YouTube Download Proxy
 *
 * Uses YouTube's native InnerTube API (Android client) to get direct,
 * non-IP-locked download URLs, then streams the response to the client.
 *
 * Uses only built-in Node.js modules (https, http) — no npm packages needed.
 */

const https = require('https');
const http  = require('http');

// ─── Android client constants ──────────────────────────────────────────────
const ANDROID_UA      = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip';
const INNERTUBE_KEY   = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
const INNERTUBE_HOST  = 'www.youtube.com';
const INNERTUBE_PATH  = `/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`;
const INNERTUBE_CONTEXT = {
  client: {
    clientName:         'ANDROID',
    clientVersion:      '19.09.37',
    androidSdkVersion:  30,
    userAgent:          ANDROID_UA,
    hl: 'en',
    gl: 'US',
    timeZone: 'UTC',
    utcOffsetMinutes: 0,
  }
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendError(res, status, msg) {
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: msg }));
  }
}

function extractVideoId(url) {
  const m = url.match(
    /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|shorts\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i
  );
  return m?.[1] || null;
}

/** POST to InnerTube using built-in https module (no fetch needed) */
function innerTubeRequest(videoId) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({
      videoId,
      context: INNERTUBE_CONTEXT,
      racyCheckOk: true,
      contentCheckOk: true,
    }), 'utf8');

    const req = https.request({
      hostname: INNERTUBE_HOST,
      port:     443,
      path:     INNERTUBE_PATH,
      method:   'POST',
      headers: {
        'Content-Type':             'application/json',
        'Content-Length':           body.length,
        'User-Agent':               ANDROID_UA,
        'X-YouTube-Client-Name':    '3',
        'X-YouTube-Client-Version': '19.09.37',
        'Accept-Language':          'en-US,en;q=0.9',
      },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data',  c => chunks.push(c));
      res.on('end',  () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`InnerTube returned HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('Invalid JSON from InnerTube'));
        }
      });
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('InnerTube request timed out')); });
    req.write(body);
    req.end();
  });
}

/** Stream a URL response directly to the HTTP res object */
function streamUrl(sourceUrl, outRes, fileName, contentType, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL(sourceUrl); } catch { return reject(new Error('Invalid source URL')); }

    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: target.hostname,
      port:     target.port || (target.protocol === 'https:' ? 443 : 80),
      path:     target.pathname + target.search,
      method:   'GET',
      headers: {
        'User-Agent': ANDROID_UA,
        'Referer':    'https://www.youtube.com/',
        'Accept':     '*/*',
      },
      timeout: 60000,
    }, (upstream) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location && redirectsLeft > 0) {
        upstream.resume();
        return resolve(streamUrl(upstream.headers.location, outRes, fileName, contentType, redirectsLeft - 1));
      }

      if (upstream.statusCode >= 400) {
        upstream.resume();
        return reject(new Error(`CDN returned HTTP ${upstream.statusCode}`));
      }

      outRes.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      outRes.setHeader('Content-Type', contentType);
      outRes.setHeader('Cache-Control', 'no-store');
      if (upstream.headers['content-length']) outRes.setHeader('Content-Length', upstream.headers['content-length']);
      outRes.writeHead(200);

      upstream.pipe(outRes);
      upstream.on('end',   resolve);
      upstream.on('error', reject);
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('CDN download timed out')); });
    req.end();
  });
}

// ─── Format selection ──────────────────────────────────────────────────────

function pickVideo(combined, adaptive, targetH) {
  // 1. Combined mp4 (video+audio in one — best for playback without ffmpeg)
  const mp4 = combined
    .filter(f => (f.mimeType || '').startsWith('video/mp4') && f.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  return mp4.find(f => (f.height || 0) <= targetH)
      || mp4[0]
      // 2. Any combined format
      || combined.find(f => f.url)
      // 3. Adaptive video (no audio, but downloadable)
      || adaptive.filter(f => (f.mimeType || '').startsWith('video/') && f.url)
                 .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
      || null;
}

function pickAudio(adaptive) {
  const audio = adaptive
    .filter(f => (f.mimeType || '').startsWith('audio/') && f.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  // Prefer mp4/m4a container
  return audio.find(f => (f.mimeType || '').includes('mp4')) || audio[0] || null;
}

// ─── Main handler ──────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const { url, quality = '720', mode = 'video' } = req.query;
  if (!url) return sendError(res, 400, 'Missing ?url= parameter');

  const videoId = extractVideoId(url);
  if (!videoId) return sendError(res, 400, 'Cannot extract YouTube video ID from URL');

  const isAudio      = mode === 'audio';
  const targetHeight = parseInt((quality || '720').replace('p', '')) || 720;

  try {
    // 1. Fetch video metadata from InnerTube
    const data = await innerTubeRequest(videoId);

    if (data.playabilityStatus?.status !== 'OK') {
      return sendError(res, 403, `Video not available: ${data.playabilityStatus?.reason || 'restricted'}`);
    }

    const streaming = data.streamingData;
    if (!streaming) return sendError(res, 502, 'YouTube returned no streaming data');

    const combined = (streaming.formats         || []).filter(f => f.url);
    const adaptive = (streaming.adaptiveFormats || []).filter(f => f.url);

    // 2. Choose best format
    const format = isAudio ? pickAudio(adaptive) : pickVideo(combined, adaptive, targetHeight);
    if (!format?.url) return sendError(res, 404, 'No suitable format found for this video/quality');

    // 3. Build filename
    const rawTitle  = data.videoDetails?.title || 'video';
    const cleanName = rawTitle.replace(/[^\w\s\-]/g, '').trim().replace(/\s+/g, '_').substring(0, 60) || 'video';
    const ext         = isAudio ? 'm4a' : 'mp4';
    const contentType = isAudio ? 'audio/mp4' : 'video/mp4';
    const fileName    = `${cleanName}.${ext}`;

    // 4. Proxy-stream the video directly to client
    await streamUrl(format.url, res, fileName, contentType);

  } catch (err) {
    console.error('[/api/youtube]', err.message);
    sendError(res, 500, `YouTube error: ${err.message}`);
  }
};
