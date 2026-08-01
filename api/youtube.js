/**
 * /api/youtube — Resilient YouTube Download Proxy
 *
 * Uses multi-client InnerTube API requests (IOS, TVHTML5, ANDROID_VR)
 * and public stream fallback resolvers to ensure direct stream URLs
 * are returned without requiring client-side deciphering.
 */

const https = require('https');
const http  = require('http');

// ─── InnerTube Clients Strategy ──────────────────────────────────────────────
const INNERTUBE_KEY  = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
const INNERTUBE_HOST = 'www.youtube.com';
const INNERTUBE_PATH = `/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`;

const CLIENT_CONFIGS = [
  {
    name: 'IOS',
    ua: 'com.google.ios.youtube/19.29.1 (iPhone14,3; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '19.29.1',
        deviceModel: 'iPhone14,3',
        osName: 'iOS',
        osVersion: '17.5.1.21F90',
        hl: 'en',
        gl: 'US'
      }
    }
  },
  {
    name: 'TVHTML5',
    ua: 'Mozilla/5.0 (SmartHub; SMART-POLICY; AppleTV; AppleTV6,2; network/wifi) AppleWebKit/605.1.15 (KHTML, like Gecko) TV Safari/605.1.15',
    context: {
      client: {
        clientName: 'TVHTML5',
        clientVersion: '7.20230405.00.00',
        hl: 'en',
        gl: 'US'
      }
    }
  },
  {
    name: 'ANDROID_VR',
    ua: 'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/32.0.0.9.17 Chrome/122.0.6261.64 Mobile VR Safari/537.36',
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.50.41',
        deviceModel: 'Quest 3',
        osName: 'Android',
        osVersion: '12',
        hl: 'en',
        gl: 'US'
      }
    }
  },
  {
    name: 'ANDROID',
    ua: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.09.37',
        androidSdkVersion: 30,
        userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
        hl: 'en',
        gl: 'US'
      }
    }
  }
];

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
  if (!url) return null;
  const m = url.match(
    /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|shorts\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i
  );
  return m?.[1] || (url.length === 11 ? url : null);
}

/** POST to InnerTube endpoint using native Node https module */
function innerTubeRequest(videoId, clientConfig) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({
      videoId,
      context: clientConfig.context,
      racyCheckOk: true,
      contentCheckOk: true,
    }), 'utf8');

    const req = https.request({
      hostname: INNERTUBE_HOST,
      port: 443,
      path: INNERTUBE_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'User-Agent': clientConfig.ua,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`InnerTube (${clientConfig.name}) HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error(`Invalid JSON from InnerTube (${clientConfig.name})`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout (${clientConfig.name})`)); });
    req.write(body);
    req.end();
  });
}

/** Attempt to fetch streams via public Piped API as fallback */
function fetchPipedStream(videoId) {
  const instances = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.video',
    'https://pipedapi.drgns.space'
  ];

  return new Promise((resolve, reject) => {
    const tryNext = (index) => {
      if (index >= instances.length) return reject(new Error('All Piped instances failed'));
      const targetUrl = `${instances[index]}/streams/${videoId}`;
      
      try {
        const u = new URL(targetUrl);
        const req = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return tryNext(index + 1);
          }
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              resolve(data);
            } catch {
              tryNext(index + 1);
            }
          });
        });
        req.on('error', () => tryNext(index + 1));
        req.on('timeout', () => { req.destroy(); tryNext(index + 1); });
      } catch {
        tryNext(index + 1);
      }
    };
    tryNext(0);
  });
}

/** Stream a URL directly to outRes with redirects */
function streamUrl(sourceUrl, outRes, fileName, contentType, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL(sourceUrl); } catch { return reject(new Error('Invalid stream URL')); }

    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.youtube.com/',
        'Accept': '*/*',
      },
      timeout: 60000,
    }, (upstream) => {
      if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location && redirectsLeft > 0) {
        upstream.resume();
        return resolve(streamUrl(upstream.headers.location, outRes, fileName, contentType, redirectsLeft - 1));
      }

      if (upstream.statusCode >= 400) {
        upstream.resume();
        return reject(new Error(`CDN returned HTTP ${upstream.statusCode}`));
      }

      const safeFileName = encodeURIComponent(fileName);
      outRes.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"; filename*=UTF-8''${safeFileName}`);
      outRes.setHeader('Content-Type', contentType);
      outRes.setHeader('Cache-Control', 'no-store');
      if (upstream.headers['content-length']) outRes.setHeader('Content-Length', upstream.headers['content-length']);
      outRes.writeHead(200);

      upstream.pipe(outRes);
      upstream.on('end', resolve);
      upstream.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('CDN stream download timed out')); });
    req.end();
  });
}

// ─── Format selection ──────────────────────────────────────────────────────

function pickVideoFormat(combined, adaptive, targetH) {
  const mp4Combined = combined
    .filter(f => f.url && (f.mimeType || '').startsWith('video/mp4'))
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  const bestFit = mp4Combined.find(f => (f.height || 0) <= targetH);
  if (bestFit) return bestFit;
  if (mp4Combined.length > 0) return mp4Combined[0];

  const anyCombined = combined.find(f => f.url);
  if (anyCombined) return anyCombined;

  const adaptiveVideo = adaptive
    .filter(f => f.url && (f.mimeType || '').startsWith('video/'))
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  return adaptiveVideo[0] || null;
}

function pickAudioFormat(adaptive) {
  const audio = adaptive
    .filter(f => f.url && (f.mimeType || '').startsWith('audio/'))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

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

  const isAudio = mode === 'audio';
  const targetHeight = parseInt((quality || '720').replace('p', '')) || 720;

  let streamUrlTarget = null;
  let videoTitle = 'video';

  // 1. Try multi-client InnerTube API requests
  for (const clientConfig of CLIENT_CONFIGS) {
    try {
      const data = await innerTubeRequest(videoId, clientConfig);
      if (data.playabilityStatus?.status !== 'OK') continue;

      const streaming = data.streamingData;
      if (!streaming) continue;

      const combined = (streaming.formats || []).filter(f => f.url);
      const adaptive = (streaming.adaptiveFormats || []).filter(f => f.url);

      const selected = isAudio ? pickAudioFormat(adaptive) : pickVideoFormat(combined, adaptive, targetHeight);
      if (selected?.url) {
        streamUrlTarget = selected.url;
        if (data.videoDetails?.title) videoTitle = data.videoDetails.title;
        break;
      }
    } catch (clientErr) {
      console.warn(`[/api/youtube] ${clientConfig.name} failed:`, clientErr.message);
    }
  }

  // 2. Fallback to Piped API if InnerTube direct URLs were missing
  if (!streamUrlTarget) {
    try {
      const pipedData = await fetchPipedStream(videoId);
      if (pipedData?.title) videoTitle = pipedData.title;

      if (isAudio && pipedData.audioStreams?.length) {
        const audio = pipedData.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        streamUrlTarget = audio[0]?.url || null;
      } else if (pipedData.videoStreams?.length) {
        const videos = pipedData.videoStreams
          .filter(v => v.url && (!v.videoOnly || pipedData.videoStreams.length === 1))
          .sort((a, b) => (parseInt(a.quality) || 0) - (parseInt(b.quality) || 0));

        const fit = videos.find(v => (parseInt(v.quality) || 0) <= targetHeight) || videos[0];
        streamUrlTarget = fit?.url || pipedData.videoStreams[0]?.url || null;
      }
    } catch (pipedErr) {
      console.warn('[/api/youtube] Piped fallback failed:', pipedErr.message);
    }
  }

  if (!streamUrlTarget) {
    return sendError(res, 500, 'Could not extract direct stream URL for this video');
  }

  // 3. Build filename and proxy stream
  const cleanName = videoTitle.replace(/[^\w\s\-]/g, '').trim().replace(/\s+/g, '_').substring(0, 60) || 'video';
  const ext = isAudio ? 'm4a' : 'mp4';
  const contentType = isAudio ? 'audio/mp4' : 'video/mp4';
  const fileName = `${cleanName}.${ext}`;

  try {
    await streamUrl(streamUrlTarget, res, fileName, contentType);
  } catch (streamErr) {
    console.error('[/api/youtube] Stream proxy failed:', streamErr.message);
    sendError(res, 500, `Streaming error: ${streamErr.message}`);
  }
};
