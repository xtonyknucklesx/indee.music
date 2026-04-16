export const ALLOWED_ORIGINS = new Set([
  'https://indee.music',
  'https://www.indee.music',
]);

export const ALLOWED_ROLES = new Set([
  'venue',
  'booker',
  'band',
  'label',
  'fan',
  'email_signup',
]);

const MAX_BODY_BYTES = 64 * 1024;
const MAX_FIELD_LEN = 4000;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX = 3;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

function buildCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function withHeaders(response, extra) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

function jsonResponse(data, status, cors) {
  return withHeaders(Response.json(data, { status }), cors);
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

export function extractBearer(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function isAuthorized(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const token = extractBearer(request);
  if (!token) return false;
  return timingSafeEqual(token, env.ADMIN_TOKEN);
}

async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(ip + ':' + salt);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function safeParse(json) {
  try { return JSON.parse(json); } catch { return {}; }
}

export function validateAnswers(answers) {
  const cleaned = {};
  for (const [key, value] of Object.entries(answers)) {
    if (typeof key !== 'string' || key.length > 64) continue;
    if (value == null) continue;
    if (Array.isArray(value)) {
      const items = value
        .filter(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        .map(v => String(v).slice(0, MAX_FIELD_LEN));
      if (items.length) cleaned[key] = items;
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      cleaned[key] = String(value).slice(0, MAX_FIELD_LEN);
    }
  }
  return cleaned;
}

export function escapeCSV(val) {
  if (val == null) return '';
  let str = String(val);
  // Mitigate CSV formula injection
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  if (/[,"\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

async function verifyTurnstile(env, token, ip) {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const data = await res.json();
  return !!data.success;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = buildCorsHeaders(request);

    if (request.method === 'OPTIONS') {
      return withHeaders(new Response(null, { status: 204 }), cors);
    }

    try {
      if (url.pathname === '/api/submit' && request.method === 'POST') {
        return await handleSubmit(request, env, cors);
      }
      if (url.pathname === '/api/responses' && request.method === 'GET') {
        return await handleResponses(request, env, cors);
      }
      if (url.pathname === '/api/stats' && request.method === 'GET') {
        return await handleStats(request, env, cors);
      }
      if (url.pathname === '/api/export' && request.method === 'GET') {
        return await handleExport(request, env, cors);
      }
      return withHeaders(new Response('Not found', { status: 404 }), cors);
    } catch (err) {
      console.error('Unhandled error:', err?.stack || err);
      return jsonResponse({ error: 'Internal error' }, 500, cors);
    }
  },
};

async function handleSubmit(request, env, cors) {
  if (!env.TURNSTILE_SECRET || !env.ADMIN_TOKEN || !env.IP_SALT) {
    console.error('Missing required secrets (TURNSTILE_SECRET/ADMIN_TOKEN/IP_SALT)');
    return jsonResponse({ error: 'Service unavailable' }, 503, cors);
  }

  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Payload too large' }, 413, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, cors);
  }
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Invalid body' }, 400, cors);
  }

  const { _roles, _turnstile, _timestamp: _ignored, ...rawAnswers } = body;

  if (!Array.isArray(_roles) || _roles.length === 0 || _roles.length > 8) {
    return jsonResponse({ error: 'Invalid roles' }, 400, cors);
  }
  const roles = [];
  for (const r of _roles) {
    if (typeof r !== 'string' || !ALLOWED_ROLES.has(r)) {
      return jsonResponse({ error: 'Invalid roles' }, 400, cors);
    }
    if (!roles.includes(r)) roles.push(r);
  }

  if (typeof _turnstile !== 'string' || _turnstile.length < 10 || _turnstile.length > 2048) {
    return jsonResponse({ error: 'Verification required' }, 403, cors);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  const turnstileOk = await verifyTurnstile(env, _turnstile, ip);
  if (!turnstileOk) {
    return jsonResponse({ error: 'Verification failed' }, 403, cors);
  }

  const ipHash = await hashIp(ip, env.IP_SALT);

  const rateRow = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM responses WHERE ip_hash = ? AND submitted_at > datetime('now', ?)"
  ).bind(ipHash, `-${RATE_LIMIT_WINDOW_SECONDS} seconds`).first();
  if (rateRow && rateRow.c >= RATE_LIMIT_MAX) {
    return jsonResponse({ error: 'Too many requests' }, 429, cors);
  }

  const answers = validateAnswers(rawAnswers);
  const name = typeof answers.q01 === 'string' ? answers.q01 : null;
  const city = typeof answers.q03 === 'string' ? answers.q03 : null;
  const submittedAt = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO responses (roles, name, city, answers, submitted_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(roles.join(','), name, city, JSON.stringify(answers), submittedAt, ipHash).run();

  return jsonResponse({ success: true }, 200, cors);
}

async function handleResponses(request, env, cors) {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401, cors);
  }
  const { results } = await env.DB.prepare(
    'SELECT id, roles, name, city, answers, submitted_at FROM responses ORDER BY submitted_at DESC'
  ).all();
  const parsed = results.map(r => ({ ...r, answers: safeParse(r.answers) }));
  return jsonResponse({ count: parsed.length, responses: parsed }, 200, cors);
}

async function handleStats(request, env, cors) {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401, cors);
  }
  const total = await env.DB.prepare('SELECT COUNT(*) as count FROM responses').first();
  const byRole = await env.DB.prepare(
    'SELECT roles, COUNT(*) as count FROM responses GROUP BY roles ORDER BY count DESC'
  ).all();
  const recent = await env.DB.prepare(
    'SELECT name, roles, city, submitted_at FROM responses ORDER BY submitted_at DESC LIMIT 10'
  ).all();
  return jsonResponse(
    { total: total.count, by_role: byRole.results, recent: recent.results },
    200,
    cors
  );
}

async function handleExport(request, env, cors) {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401, cors);
  }
  const { results } = await env.DB.prepare(
    'SELECT id, roles, name, city, answers, submitted_at FROM responses ORDER BY submitted_at DESC'
  ).all();

  const allKeys = new Set();
  const parsed = results.map(r => {
    const answers = safeParse(r.answers);
    Object.keys(answers).forEach(k => allKeys.add(k));
    return { ...r, answers };
  });

  const sortedKeys = [...allKeys].sort((a, b) => {
    const numA = parseInt(a.replace(/[^0-9]/g, ''), 10) || 999;
    const numB = parseInt(b.replace(/[^0-9]/g, ''), 10) || 999;
    return numA - numB;
  });

  const headers = ['id', 'submitted_at', 'roles', 'name', 'city', ...sortedKeys];
  let csv = headers.map(escapeCSV).join(',') + '\n';
  for (const row of parsed) {
    const line = [
      row.id,
      row.submitted_at,
      row.roles,
      row.name,
      row.city,
      ...sortedKeys.map(k => {
        const v = row.answers[k];
        return Array.isArray(v) ? v.join('; ') : (v ?? '');
      }),
    ];
    csv += line.map(escapeCSV).join(',') + '\n';
  }

  return withHeaders(
    new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="indee-music-responses-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    }),
    cors
  );
}
