const { Readable } = require('stream');

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

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const { url, quality = '720', mode = 'video' } = req.query;
  if (!url) return sendError(res, 400, 'Missing ?url= parameter');

  const videoId = extractVideoId(url);
  if (!videoId) return sendError(res, 400, 'Invalid YouTube URL — cannot extract video ID');

  const isAudio = mode === 'audio';
  const targetHeight = parseInt((quality || '720').replace('p', '')) || 720;

  try {
    // youtubei.js is ESM — use dynamic import in this CJS module
    const { Innertube } = await import('youtubei.js');

    const yt = await Innertube.create({
      retrieve_player: true,
      generate_session_locally: true,
    });

    const info = await yt.getInfo(videoId);

    // Clean title for filename
    const rawTitle = info.basic_info?.title || 'video';
    const cleanTitle = rawTitle
      .replace(/[^\w\s\-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 60) || 'video';

    const ext = isAudio ? 'm4a' : 'mp4';
    const fileName = `${cleanTitle}.${ext}`;

    // ─── Choose quality ────────────────────────────────────────────
    const downloadOptions = isAudio
      ? { type: 'audio', quality: 'best', format: 'any' }
      : { type: 'video+audio', quality: `${targetHeight}p`, format: 'mp4' };

    // ─── Download stream ───────────────────────────────────────────
    const webStream = await yt.download(videoId, downloadOptions);

    // Convert Web ReadableStream → Node.js Readable
    const nodeStream = Readable.fromWeb(webStream);

    // ─── Set response headers and stream ──────────────────────────
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', isAudio ? 'audio/mp4' : 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(200);

    nodeStream.on('error', (err) => {
      console.error('[ytStream error]', err.message);
      if (!res.writableEnded) res.end();
    });

    req.on('close', () => nodeStream.destroy());

    nodeStream.pipe(res);

  } catch (err) {
    console.error('[/api/youtube]', err.message);
    sendError(res, 500, `YouTube download failed: ${err.message}`);
  }
};
