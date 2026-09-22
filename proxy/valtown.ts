/**
 * MicroRadar CORS proxy — Val Town HTTP val.
 *
 * Same job as worker.js, same URL shape, different host. It exists so the proxy
 * can be run from an egress IP that is not shared with every other Cloudflare
 * Workers customer, which is the leading theory for the HTTP 429s adsb.lol
 * returned through the Worker (see docs/plan-m1.md, "On the phone, round 1").
 *
 * Deliberately NOT a general-purpose open proxy — only the upstream named in
 * CLAUDE.md, only GET, only /v2/* paths, only known origins. Keep this file
 * and worker.js in step; they should differ only in the export at the bottom.
 *
 * Deploy: see proxy/README.md.
 */

const UPSTREAMS: Record<string, string> = {
  'adsb.lol': 'https://api.adsb.lol',
  // airplanes.live was here until 2026-09-22; its API is gated behind an email
  // to contact@airplanes.live and answered 403 throughout. Re-add it here and
  // in index.html if they grant access.
};

const ALLOWED_ORIGINS = [
  'https://micrologist.github.io',
];

// Identify the project politely; api.adsb.lol answers 403 to a generic one.
const USER_AGENT = 'MicroRadar/1.0 (+https://github.com/Micrologist/MicroRadar)';

function allowOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // Local development over http://localhost:xxxx / http://127.0.0.1:xxxx
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}

export default async function (request: Request): Promise<Response> {
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

  let upstream: Response;
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

  // Pass the upstream status through untouched — a 429 from the aggregator
  // should read as "HTTP 429" in the app, not as a mystery network failure.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...corsHeaders(allowed),
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
    },
  });
}
