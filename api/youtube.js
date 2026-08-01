let ytdl;
try { ytdl = require('@distube/ytdl-core'); } catch (_) {}

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

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const { url, quality = '720', mode = 'video' } = req.query;

  if (!url) return sendError(res, 400, 'Missing ?url= parameter');

  // If ytdl-core failed to load, report clearly
  if (!ytdl) return sendError(res, 500, 'ytdl-core not available on this server');

  if (!ytdl.validateURL(url)) return sendError(res, 400, 'Invalid YouTube URL');

  const isAudio = mode === 'audio';
  const targetHeight = parseInt((quality || '720').replace('p', '')) || 720;

  const agentOpts = {
    requestOptions: {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Sec-Fetch-Mode': 'navigate',
      },
    },
  };

  try {
    const info = await ytdl.getInfo(url, agentOpts);

    const rawTitle = info.videoDetails.title || 'video';
    const cleanTitle = rawTitle
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 60) || 'video';

    let format;

    if (isAudio) {
      // Best audio-only mp4/m4a
      format =
        ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' }) ||
        ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
    } else {
      // Prefer mp4 with video+audio at or below target height
      const mp4Both = info.formats
        .filter((f) => f.hasVideo && f.hasAudio && f.container === 'mp4')
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      format =
        mp4Both.find((f) => (f.height || 0) <= targetHeight) ||
        mp4Both[0] ||
        // Fallback to any video+audio
        ytdl.chooseFormat(info.formats, { quality: 'highestvideo', filter: 'videoandaudio' }) ||
        ytdl.chooseFormat(info.formats, { quality: 'highest' });
    }

    if (!format) return sendError(res, 404, 'No suitable format found for this video');

    const ext = isAudio ? 'm4a' : 'mp4';
    const contentType = isAudio ? 'audio/mp4' : 'video/mp4';
    const fileName = encodeURIComponent(`${cleanTitle}.${ext}`);

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');

    if (format.contentLength) {
      res.setHeader('Content-Length', format.contentLength);
    }

    res.writeHead(200);

    const stream = ytdl(url, { format, ...agentOpts });

    stream.on('error', (err) => {
      console.error('[ytdl stream error]', err.message);
      // Headers already sent — just end the response
      if (!res.writableEnded) res.end();
    });

    req.on('close', () => stream.destroy());

    stream.pipe(res);

  } catch (err) {
    console.error('[/api/youtube] error:', err.message);
    sendError(res, 500, `YouTube download error: ${err.message}`);
  }
};
