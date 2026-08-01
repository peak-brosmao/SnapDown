const https = require('https');
const http = require('http');
const { URL } = require('url');

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
  ].some((p) => p.test(hostname));
}

function getCorsHeaders(origin) {
  // Allow any origin so the proxy works from any page on snapdown.online
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Max-Age': '86400',
  };
}

// Simple redirect-following fetch (max 5 hops)
function fetchWithRedirects(urlStr, reqHeaders, redirectsLeft, callback) {
  let target;
  try {
    target = new URL(urlStr);
  } catch (e) {
    return callback(new Error('Invalid URL: ' + urlStr));
  }

  const lib = target.protocol === 'https:' ? https : http;
  const options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + target.search,
    method: 'GET',
    headers: reqHeaders,
    timeout: 30000,
  };

  const req = lib.request(options, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
      // Consume response to free socket
      res.resume();
      return fetchWithRedirects(res.headers.location, reqHeaders, redirectsLeft - 1, callback);
    }
    callback(null, res);
  });

  req.on('error', callback);
  req.on('timeout', () => { req.destroy(); callback(new Error('Request timed out')); });
  req.end();
}

module.exports = function handler(req, res) {
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

  const upstreamHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Referer: target.origin + '/',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Connection: 'keep-alive',
  };
  if (req.headers['range']) upstreamHeaders['Range'] = req.headers['range'];

  fetchWithRedirects(mediaUrl, upstreamHeaders, 5, (err, proxyRes) => {
    if (err) {
      console.error('Proxy error:', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { ...cors, 'Content-Type': 'text/plain' });
        res.end('Proxy error: ' + err.message);
      }
      return;
    }

    const safeFileName = encodeURIComponent(fileName);
    const responseHeaders = {
      ...cors,
      'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
      // ← This forces browser to download instead of play
      'Content-Disposition': `attachment; filename="${safeFileName}"`,
      'Cache-Control': 'no-store',
    };

    if (proxyRes.headers['content-length']) responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
    if (proxyRes.headers['content-range'])  responseHeaders['Content-Range']  = proxyRes.headers['content-range'];

    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });
};
