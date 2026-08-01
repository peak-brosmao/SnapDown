/**
 * SnapDown — Download Proxy Worker
 * Deploy this to Cloudflare Workers (free tier).
 *
 * HOW TO DEPLOY (5 minutes):
 * 1. Go to https://dash.cloudflare.com
 * 2. Click "Workers & Pages" → "Create" → "Create Worker"
 * 3. Click "Edit Code" → paste this entire file → "Save and Deploy"
 * 4. Copy your worker URL (e.g. https://snapdown-proxy.YOUR_NAME.workers.dev)
 * 5. In tiktok-video-downloader.html, find:
 *       const SNAP_DL_PROXY = 'https://snapdown-proxy.peak-brosmao.workers.dev';
 *    and replace with your worker URL.
 *
 * Usage: GET https://your-worker.workers.dev?url=<encoded-media-url>&name=video.mp4
 */

const ALLOWED_ORIGINS = [
  'https://snapdown.online',
  'https://www.snapdown.online',
  'http://localhost',
  'http://127.0.0.1',
  'null', // file:// pages
];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const mediaUrl = url.searchParams.get('url');
    const fileName  = url.searchParams.get('name') || 'download';

    if (!mediaUrl) {
      return new Response('Missing ?url= parameter', { status: 400, headers: corsHeaders(origin) });
    }

    // Validate URL
    let targetUrl;
    try {
      targetUrl = new URL(mediaUrl);
      if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error('Invalid protocol');
    } catch {
      return new Response('Invalid URL', { status: 400, headers: corsHeaders(origin) });
    }

    // Block private/internal IPs (SSRF protection)
    if (isPrivateHost(targetUrl.hostname)) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders(origin) });
    }

    try {
      // Fetch the media from remote server with browser-like headers
      const mediaRes = await fetch(targetUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Referer': targetUrl.origin + '/',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Range': request.headers.get('Range') || '',
        },
        redirect: 'follow',
        cf: { cacheTtl: 0 },
      });

      if (!mediaRes.ok && mediaRes.status !== 206) {
        return new Response(`Upstream error: ${mediaRes.status}`, {
          status: mediaRes.status,
          headers: corsHeaders(origin),
        });
      }

      const contentType = mediaRes.headers.get('Content-Type') || 'application/octet-stream';
      const contentLength = mediaRes.headers.get('Content-Length');
      const contentRange = mediaRes.headers.get('Content-Range');

      const responseHeaders = {
        ...corsHeaders(origin),
        'Content-Type': contentType,
        // Force download — this is the key header!
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'no-store',
      };
      if (contentLength) responseHeaders['Content-Length'] = contentLength;
      if (contentRange)  responseHeaders['Content-Range']  = contentRange;

      return new Response(mediaRes.body, {
        status: mediaRes.status,
        headers: responseHeaders,
      });

    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, {
        status: 500,
        headers: corsHeaders(origin),
      });
    }
  },
};

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) || origin === 'null' || origin === ''
    ? (origin || '*')
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Max-Age': '86400',
  };
}

function isPrivateHost(host) {
  return [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^::1$/,
    /^0\.0\.0\.0$/,
  ].some(p => p.test(host));
}
