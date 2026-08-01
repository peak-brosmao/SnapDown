import https from 'https';
import http from 'http';
import { URL } from 'url';

// Block private/internal hosts (SSRF protection)
function isPrivateHost(hostname) {
  return [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^::1$/,
    /^0\.0\.0\.0$/,
  ].some(p => p.test(hostname));
}

const ALLOWED_ORIGINS = [
  'https://snapdown.online',
  'https://www.snapdown.online',
];

function getCorsHeaders(origin) {
  const allowed =
    ALLOWED_ORIGINS.includes(origin) || !origin || origin === 'null'
      ? origin || '*'
      : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Max-Age': '86400',
  };
}

export default async function handler(req, res) {
  const origin = req.headers['origin'] || '';
  const cors = getCorsHeaders(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }

  const { url: mediaUrl, name: fileName = 'download' } = req.query;

  if (!mediaUrl) {
    res.writeHead(400, { ...cors, 'Content-Type': 'text/plain' });
    return res.end('Missing ?url= parameter');
  }

  let target;
  try {
    target = new URL(mediaUrl);
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('bad protocol');
  } catch {
    res.writeHead(400, { ...cors, 'Content-Type': 'text/plain' });
    return res.end('Invalid URL');
  }

  if (isPrivateHost(target.hostname)) {
    res.writeHead(403, { ...cors, 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  const lib = target.protocol === 'https:' ? https : http;

  const options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + target.search,
    method: 'GET',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Referer: target.origin + '/',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(req.headers['range'] ? { Range: req.headers['range'] } : {}),
    },
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    // Follow redirects (up to 5)
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
      const location = proxyRes.headers['location'];
      if (location) {
        req.query.url = location;
        return handler(req, res); // recurse
      }
    }

    const safeFileName = encodeURIComponent(fileName);
    const responseHeaders = {
      ...cors,
      'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
      // ← This is the key header that forces download
      'Content-Disposition': `attachment; filename="${safeFileName}"`,
      'Cache-Control': 'no-store',
    };

    if (proxyRes.headers['content-length']) {
      responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
    }
    if (proxyRes.headers['content-range']) {
      responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
    }

    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { ...cors, 'Content-Type': 'text/plain' });
      res.end(`Proxy error: ${err.message}`);
    }
  });

  proxyReq.setTimeout(30000, () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { ...cors, 'Content-Type': 'text/plain' });
      res.end('Gateway timeout');
    }
  });

  proxyReq.end();
}
