/**
 * MicroRadar CORS proxy — Cloudflare Worker.
 *
 * Why this exists: the ADS-B aggregators serve perfectly good JSON but send no
 * Access-Control-Allow-Origin header on their /v2/* routes, so a browser is
 * never allowed to read the response. See the "API verification" section of
 * docs/plan-m1.md for the evidence. This Worker is the smallest thing that
 * fixes it: it forwards the request and adds the header.
 *
 * It is deliberately NOT a general-purpose open proxy — only the two upstreams
 * named in CLAUDE.md, only GET, only /v2/* paths, only known origins.
 *
 * valtown.ts is the same code for Val Town; keep the two in step.
 *
 * Deploy: see proxy/README.md.
 */

const UPSTREAMS = {
  'adsb.lol': 'https://api.adsb.lol',
  'airplanes.live': 'https://api.airplanes.live',
};

const ALLOWED_ORIGINS = [
  'https://micrologist.github.io',
];

// Identify the project politely; some aggregators reject blank user agents.
const USER_AGENT = 'MicroRadar/1.0 (+https://github.com/Micrologist/MicroRadar)';

function allowOrigin(origin) {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // Local development over http://localhost:xxxx / http://127.0.0.1:xxxx
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    const allowed = allowOrigin(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: allowed ? 204 : 403,
        headers: allowed
          ? { ...corsHeaders(allowed), 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
          : {},
      });
    }

    if (request.method !== 'GET') {
      return new Response('Only GET', { status: 405 });
    }
    if (!allowed) {
      return new Response('Origin not allowed', { status: 403 });
    }

    // Path shape: /<source>/v2/<whatever>  e.g. /adsb.lol/v2/point/51.5/-0.12/40
    const { pathname, search } = new URL(request.url);
    const m = pathname.match(/^\/([^/]+)(\/v2\/.*)$/);
    if (!m) {
      return new Response('Expected /<source>/v2/...', {
        status: 404,
        headers: corsHeaders(allowed),
      });
    }

    const base = UPSTREAMS[m[1]];
    if (!base) {
      return new Response('Unknown source: ' + m[1], {
        status: 404,
        headers: corsHeaders(allowed),
      });
    }

    let upstream;
    try {
      upstream = await fetch(base + m[2] + search, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'upstream unreachable' }), {
        status: 502,
        headers: { ...corsHeaders(allowed), 'Content-Type': 'application/json' },
      });
    }

    // Pass the upstream status through untouched — a 403 from the aggregator
    // should read as "HTTP 403" in the app, not as a mystery network failure.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...corsHeaders(allowed),
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      },
    });
  },
};
