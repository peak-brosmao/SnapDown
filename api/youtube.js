/**
 * /api/youtube — YouTube Download Proxy
 *
 * Strategy: Call YouTube's native InnerTube API as the Android YouTube app.
 * Android client trick returns direct, signed URLs that are NOT IP-locked,
 * so this Vercel server can proxy-stream them to the client.
 *
 * No npm packages — uses built-in fetch (Node.js 18+).
 */

// InnerTube Android client config (mimics YouTube Android app v19.x)
const INNERTUBE_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
const ANDROID_UA    = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip';
const INNERTUBE_CONTEXT = {
  client: {
    clientName:        'ANDROID',
    clientVersion:     '19.09.37',
    androidSdkVersion: 30,
    userAgent:         ANDROID_UA,
    hl: 'en',
    gl: 'US',
  }
};

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

async function getInnerTubeFormats(videoId) {
  const endpoint = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type':          'application/json',
      'User-Agent':            ANDROID_UA,
      'X-YouTube-Client-Name':    '3',
      'X-YouTube-Client-Version': '19.09.37',
    },
    body: JSON.stringify({ videoId, context: INNERTUBE_CONTEXT }),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) throw new Error(`InnerTube API returned ${resp.status}`);

  const data = await resp.json();

  if (data.playabilityStatus?.status !== 'OK') {
    throw new Error(`Video not playable: ${data.playabilityStatus?.reason || 'unknown'}`);
  }

  const streaming = data.streamingData;
  if (!streaming) throw new Error('No streaming data in response');

  // Combined formats (video + audio in one file) — easiest to download
  const combined  = (streaming.formats         || []).filter(f => f.url);
  // Adaptive formats (video-only or audio-only)
  const adaptive  = (streaming.adaptiveFormats || []).filter(f => f.url);

  return { combined, adaptive, title: data.videoDetails?.title || 'video' };
}

function pickVideoFormat(combined, adaptive, targetHeight) {
  // 1. Prefer combined (video+audio) mp4 at or below target height
  const mp4Combined = combined
    .filter(f => (f.mimeType || '').startsWith('video/mp4'))
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  const exact = mp4Combined.find(f => (f.height || 0) <= targetHeight);
  if (exact) return exact;
  if (mp4Combined.length) return mp4Combined[0]; // best available

  // 2. Fallback to any combined format
  if (combined.length) return combined[0];

  // 3. Fallback to adaptive video-only (no audio, but downloadable)
  const adaptiveVideo = adaptive
    .filter(f => (f.mimeType || '').startsWith('video/'))
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  return adaptiveVideo.find(f => (f.height || 0) <= targetHeight) || adaptiveVideo[0] || null;
}

function pickAudioFormat(adaptive) {
  // Best audio-only format (prefer m4a / mp4 container)
  const audio = adaptive
    .filter(f => (f.mimeType || '').startsWith('audio/'))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  return audio.find(f => (f.mimeType || '').includes('mp4')) || audio[0] || null;
}

async function proxyStream(sourceUrl, res, fileName, contentType) {
  const upstream = await fetch(sourceUrl, {
    headers: {
      'User-Agent': ANDROID_UA,
      'Referer':    'https://www.youtube.com/',
      'Accept':     '*/*',
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!upstream.ok) throw new Error(`CDN returned ${upstream.status}`);

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');

  const cl = upstream.headers.get('content-length');
  if (cl) res.setHeader('Content-Length', cl);

  res.writeHead(200);

  // Stream body chunks to client
  for await (const chunk of upstream.body) {
    if (!res.writableEnded) res.write(Buffer.from(chunk));
  }
  res.end();
}

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
    const { combined, adaptive, title } = await getInnerTubeFormats(videoId);

    const cleanTitle = title.replace(/[^\w\s\-]/g, '').trim().replace(/\s+/g, '_').substring(0, 60) || 'video';

    let format, ext, contentType;

    if (isAudio) {
      format      = pickAudioFormat(adaptive);
      ext         = 'm4a';
      contentType = 'audio/mp4';
    } else {
      format      = pickVideoFormat(combined, adaptive, targetHeight);
      ext         = 'mp4';
      contentType = 'video/mp4';
    }

    if (!format?.url) return sendError(res, 404, 'No suitable format found for this video');

    const fileName = `${cleanTitle}.${ext}`;
    await proxyStream(format.url, res, fileName, contentType);

  } catch (err) {
    console.error('[/api/youtube]', err.message);
    sendError(res, 500, `YouTube: ${err.message}`);
  }
};
