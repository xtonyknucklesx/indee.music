export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── POST /api/submit ──
    if (url.pathname === '/api/submit' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { _roles, _timestamp, _turnstile, ...answers } = body;

        if (!_roles || !_roles.length) {
          return Response.json({ error: 'No roles selected' }, { status: 400, headers: corsHeaders });
        }

        // Verify Turnstile token
        if (env.TURNSTILE_SECRET) {
          if (!_turnstile) {
            return Response.json({ error: 'Verification required' }, { status: 403, headers: corsHeaders });
          }

          const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              secret: env.TURNSTILE_SECRET,
              response: _turnstile,
              remoteip: request.headers.get('CF-Connecting-IP') || '',
            }),
          });

          const turnstileData = await turnstileRes.json();
          if (!turnstileData.success) {
            return Response.json({ error: 'Verification failed' }, { status: 403, headers: corsHeaders });
          }
        }

        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const ipData = new TextEncoder().encode(ip + (env.IP_SALT || 'default-salt'));
        const hashBuffer = await crypto.subtle.digest('SHA-256', ipData);
        const ipHash = [...new Uint8Array(hashBuffer)]
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 16);

        const roles = _roles.join(',');
        const name = answers.q01 || null;
        const city = answers.q03 || null;

        await env.DB.prepare(
          'INSERT INTO responses (roles, name, city, answers, submitted_at, ip_hash) VALUES (?, ?, ?, ?, datetime(?), ?)'
        ).bind(
          roles,
          name,
          city,
          JSON.stringify(answers),
          _timestamp || new Date().toISOString(),
          ipHash
        ).run();

        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json(
          { error: 'Failed to save response', detail: err.message },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── GET /api/responses ──
    if (url.pathname === '/api/responses' && request.method === 'GET') {
      const auth = url.searchParams.get('token');
      if (auth !== env.ADMIN_TOKEN) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      }

      try {
        const { results } = await env.DB.prepare(
          'SELECT id, roles, name, city, answers, submitted_at FROM responses ORDER BY submitted_at DESC'
        ).all();

        const parsed = results.map(r => ({
          ...r,
          answers: JSON.parse(r.answers),
        }));

        return Response.json(
          { count: parsed.length, responses: parsed },
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        return Response.json(
          { error: 'Failed to fetch', detail: err.message },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── GET /api/stats ──
    if (url.pathname === '/api/stats' && request.method === 'GET') {
      const auth = url.searchParams.get('token');
      if (auth !== env.ADMIN_TOKEN) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      }

      try {
        const total = await env.DB.prepare('SELECT COUNT(*) as count FROM responses').first();
        const byRole = await env.DB.prepare(
          'SELECT roles, COUNT(*) as count FROM responses GROUP BY roles ORDER BY count DESC'
        ).all();
        const recent = await env.DB.prepare(
          'SELECT name, roles, city, submitted_at FROM responses ORDER BY submitted_at DESC LIMIT 10'
        ).all();

        return Response.json({
          total: total.count,
          by_role: byRole.results,
          recent: recent.results,
        }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ── GET /api/export ── (CSV)
    if (url.pathname === '/api/export' && request.method === 'GET') {
      const auth = url.searchParams.get('token');
      if (auth !== env.ADMIN_TOKEN) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      }

      try {
        const { results } = await env.DB.prepare(
          'SELECT id, roles, name, city, answers, submitted_at FROM responses ORDER BY submitted_at DESC'
        ).all();

        // Collect all unique answer keys
        const allKeys = new Set();
        const parsed = results.map(r => {
          const answers = JSON.parse(r.answers);
          Object.keys(answers).forEach(k => allKeys.add(k));
          return { ...r, answers };
        });

        const sortedKeys = [...allKeys].sort((a, b) => {
          const numA = parseInt(a.replace(/[^0-9]/g, '')) || 999;
          const numB = parseInt(b.replace(/[^0-9]/g, '')) || 999;
          return numA - numB;
        });

        // Build CSV
        const headers = ['id', 'submitted_at', 'roles', 'name', 'city', ...sortedKeys];
        const escapeCSV = (val) => {
          if (val == null) return '';
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        };

        let csv = headers.map(escapeCSV).join(',') + '\n';
        for (const row of parsed) {
          const line = [
            row.id,
            row.submitted_at,
            row.roles,
            row.name,
            row.city,
            ...sortedKeys.map(k => row.answers[k] || ''),
          ];
          csv += line.map(escapeCSV).join(',') + '\n';
        }

        return new Response(csv, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="indee-music-responses-${new Date().toISOString().slice(0, 10)}.csv"`,
          },
        });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};
