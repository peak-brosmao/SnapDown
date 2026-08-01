const ytdl = require('@distube/ytdl-core');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const { url, quality = '720', mode = 'video' } = req.query;

  if (!url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
  }

  if (!ytdl.validateURL(url)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid YouTube URL' }));
  }

  try {
    const isAudio = mode === 'audio';

    // Get video info
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        },
      },
    });

    const rawTitle = info.videoDetails.title || 'video';
    const cleanTitle = rawTitle.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_').substring(0, 60);

    let format;
    if (isAudio) {
      // Best audio-only format
      format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
    } else {
      // Try exact quality, fall back to nearest
      const q = quality.replace('p', '');
      format =
        ytdl.chooseFormat(info.formats, { quality: `${q}p`, filter: 'videoandaudio' }) ||
        ytdl.chooseFormat(info.formats, { quality: 'highestvideo', filter: 'videoandaudio' }) ||
        ytdl.chooseFormat(info.formats, { quality: 'highest' });
    }

    if (!format) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No suitable format found' }));
    }

    const ext = isAudio ? 'm4a' : (format.container || 'mp4');
    const fileName = `${cleanTitle}.${ext}`;

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', format.mimeType?.split(';')[0] || (isAudio ? 'audio/mp4' : 'video/mp4'));
    res.setHeader('Cache-Control', 'no-store');

    if (format.contentLength) {
      res.setHeader('Content-Length', format.contentLength);
    }

    res.writeHead(200);

    // Stream directly from YouTube → client
    ytdl(url, { format }).pipe(res).on('error', (err) => {
      console.error('ytdl stream error:', err.message);
    });

  } catch (err) {
    console.error('YouTube API error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
};
