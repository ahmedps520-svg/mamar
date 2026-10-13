// Mamar Booking — local server. Runs the whole platform on this computer with no accounts:
//   • serves mamar/ exactly like GitHub Pages does (including 404.html for /b/<name>)
//   • /api/rpc/<fn>  the same Postgres functions Supabase runs, in PGlite
//   • /api/auth/*    a tiny stand-in for Supabase Auth
//   • /api/live      server-sent events (the local version of Realtime)
//   • real Web Push + an email outbox when someone finishes the setup flow
//
//   cd mamar/dev && npm install && npm start      →  http://localhost:5600
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import webpush from 'web-push';
import { fileURLToPath } from 'node:url';
import { openDb, rpc, ApiError, toApiError, ensureUser, findUser, checkPassword, isAdmin, seedPrayerTimes, ROOT } from './db.js';

const PORT = +(process.env.PORT || 5600);
const HOST = process.env.HOST || '127.0.0.1';
// Outside OneDrive on purpose: file sync locks break the database files.
const DATA = process.env.MAMAR_DATA
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'mamar-pglite');
const SEED_USERS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed-users.json');

fs.mkdirSync(path.join(DATA, 'files'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'outbox'), { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ───────────── secrets kept in the data folder, never in the repo ─────────────
function keyFile(name, make) {
  const f = path.join(DATA, name);
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(make()));
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
const SECRET = keyFile('secret.json', () => ({ key: crypto.randomBytes(32).toString('hex') })).key;
const VAPID = keyFile('vapid.json', () => webpush.generateVAPIDKeys());
webpush.setVapidDetails('mailto:contact@mamar.site', VAPID.publicKey, VAPID.privateKey);

// ───────────── database ─────────────
const db = await openDb({ dataDir: path.join(DATA, 'db'), log });

const seedUsers = JSON.parse(fs.readFileSync(SEED_USERS, 'utf8'));
for (const u of seedUsers.users) await ensureUser(db, u.email, u.password, u);

{
  const r = await db.query(`select coalesce(max(day) - (now() at time zone 'Asia/Riyadh')::date, -1) as left from public.prayer_times where city = 'jeddah'`);
  if (r.rows[0].left < 90) {
    const from = new Date(Date.now() + 3 * 3600e3 - 7 * 864e5).toISOString().slice(0, 10);
    const n = await seedPrayerTimes(db, { fromISO: from, days: 400 });
    log(n ? `prayer times: ${n} days from ${from}` : 'prayer times: platform/prayer.js not ready yet (pauses off until it is)');
  }
}

// ───────────── tokens (HMAC-signed, the local stand-in for Supabase JWTs) ─────────────
const b64u = (b) => Buffer.from(b).toString('base64url');
function signToken(payload) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
function readToken(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [body, sig] = t.split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() / 1000 ? p : null;
}
const ctxOf = (req) => {
  const t = readToken(req);
  return t ? { role: 'authenticated', sub: t.sub, email: t.email } : { role: 'anon' };
};

// ───────────── live (SSE) ─────────────
const clients = new Set();
await db.listen('mamar_live', (payload) => {
  for (const res of clients) res.write(`event: ping\ndata: ${payload}\n\n`);
});
setInterval(() => { for (const res of clients) res.write(': keep-alive\n\n'); }, 25000).unref();

// ───────────── notifications: push + email outbox ─────────────
await db.listen('mamar_notify', (id) => { notify(id).catch((e) => log('notify failed', e.message)); });

async function notify(id) {
  const n = await rpc(db, 'svc_notification', { id }, { role: 'service_role' });
  const note = n.notification;
  let pushed = 0;
  for (const t of n.targets) {
    const ar = t.lang !== 'en';
    const payload = JSON.stringify({
      title: ar ? note.title_ar : note.title_en,
      body: ar ? note.body_ar : note.body_en,
      url: note.url, tag: `mamar-${note.kind}-${note.ref_id || note.id}`, lang: t.lang,
    });
    try {
      await webpush.sendNotification({ endpoint: t.endpoint, keys: t.keys }, payload, { TTL: 86400, urgency: 'high' });
      pushed++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await rpc(db, 'svc_push_gone', { endpoint: t.endpoint }, { role: 'service_role' });
      else log('push failed', e.statusCode || '', e.body || e.message);
    }
  }
  const mail = emailFor(n);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(DATA, 'outbox', `${stamp}-${note.kind}.html`), mail.html);
  if (process.env.RESEND_API_KEY && process.env.MAMAR_NOTIFY_EMAIL) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAMAR_FROM_EMAIL || 'Mamar <onboarding@resend.dev>',
        to: [process.env.MAMAR_NOTIFY_EMAIL], subject: mail.subject, html: mail.html, text: mail.text }),
    });
    log('email', r.status);
  }
  log(`notify ${note.kind}: push ${pushed}/${n.targets.length}, outbox written`);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sar = (h) => (h == null ? 'Quote' : `${(h / 100).toLocaleString('en-US')} SAR`);
function emailFor(n) {
  const note = n.notification;
  const r = n.request;
  const subject = note.title_en;
  const rows = r ? (r.estimate.lines || []).map((l) =>
    `<tr><td style="padding:6px 0;color:#444">${esc(l.label_en)}${l.qty > 1 ? ` × ${l.qty}` : ''}</td>
     <td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums">${l.quote ? 'Custom quote' : l.amount_halalas ? sar(l.amount_halalas) : 'Included'}</td></tr>`).join('') : '';
  const html = `<!doctype html><meta charset="utf-8"><div style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111">
  <p style="color:#FF4A2B;font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:12px;margin:0 0 8px">Mamar</p>
  <h1 style="font-size:20px;margin:0 0 4px">${esc(note.title_en)}</h1>
  <p style="margin:0 0 16px;color:#555">${esc(note.body_en)}</p>
  ${r ? `<p style="margin:0 0 16px"><b>${esc(r.contact_name)}</b> · ${esc(r.phone)}${r.email ? ` · ${esc(r.email)}` : ''}<br>Ref ${esc(r.ref)}</p>
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee">${rows}
  <tr><td style="padding:10px 0;border-top:1px solid #111"><b>Setup estimate</b></td><td style="padding:10px 0;border-top:1px solid #111;text-align:right"><b>${sar(r.setup_halalas)}</b></td></tr>
  ${r.plan_code ? `<tr><td style="padding:6px 0;color:#444">Care plan (${esc(r.plan_interval)})</td><td style="text-align:right">${sar(r.plan_halalas)}</td></tr>` : ''}</table>` : ''}
  <p style="margin:24px 0 0"><a href="https://mamar.site${esc(note.url)}" style="background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open in admin</a></p></div>`;
  const text = `${note.title_en}\n${note.body_en}\n${r ? `${r.contact_name} · ${r.phone}\nSetup: ${sar(r.setup_halalas)}\n` : ''}https://mamar.site${note.url}`;
  return { subject, html, text };
}

// ───────────── http helpers ─────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.ics': 'text/calendar; charset=utf-8', '.xml': 'application/xml',
};
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store', 'access-control-allow-origin': '*', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
const sendErr = (res, e) => {
  const err = toApiError(e);
  if (err.status >= 500) log('error', err.detail || err.message, err.cause?.stack?.split('\n').slice(0, 3).join(' | ') || '');
  send(res, err.status, { code: err.code, detail: err.detail });
};
async function body(req, limit = 1e6) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new ApiError('TOO_LARGE', null, 413); chunks.push(c); }
  return Buffer.concat(chunks);
}
const json = async (req) => { const b = await body(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; };
async function needAdmin(req) {
  const c = ctxOf(req);
  if (c.role !== 'authenticated' || !(await isAdmin(db, c.sub))) throw new ApiError('NOT_ALLOWED', null, 403);
  return c;
}

// ───────────── api routes ─────────────
async function api(req, res, url) {
  const p = url.pathname;
  if (req.method === 'OPTIONS') {
    return send(res, 204, '', { 'access-control-allow-headers': 'authorization, content-type, apikey', 'access-control-allow-methods': 'GET, POST, OPTIONS' });
  }
  if (p === '/api/config') return send(res, 200, { mode: 'local', vapid_public: VAPID.publicKey });

  if (p.startsWith('/api/rpc/') && req.method === 'POST') {
    const name = p.slice(9);
    if (name.startsWith('svc_')) throw new ApiError('NOT_ALLOWED', null, 403);
    return send(res, 200, await rpc(db, name, await json(req), ctxOf(req)));
  }

  if (p === '/api/auth/login' && req.method === 'POST') {
    const { identifier, email, password } = await json(req);
    const u = await findUser(db, identifier || email);
    if (!u || !checkPassword(password, u.encrypted_password)) throw new ApiError('BAD_LOGIN', null, 401);
    const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
    return send(res, 200, { access_token: signToken({ sub: u.id, email: u.email, exp }), expires_at: exp,
      user: { id: u.id, email: u.email }, is_admin: await isAdmin(db, u.id) });
  }
  if (p === '/api/auth/me') {
    const c = ctxOf(req);
    if (c.role !== 'authenticated') throw new ApiError('NOT_ALLOWED', null, 401);
    return send(res, 200, { user: { id: c.sub, email: c.email }, is_admin: await isAdmin(db, c.sub) });
  }

  // Local stand-in for "Supabase Dashboard → Authentication → Add user".
  if (p === '/api/admin/users' && req.method === 'POST') {
    await needAdmin(req);
    const { email, password } = await json(req);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '') || String(password || '').length < 8) throw new ApiError('BAD_INPUT');
    if (await findUser(db, email)) throw new ApiError('USER_EXISTS');
    return send(res, 200, { user_id: await ensureUser(db, email, password), email: String(email).toLowerCase() });
  }

  // Local stand-in for committing b/<slug>/index.html to GitHub.
  if (p === '/api/admin/publish' && req.method === 'POST') {
    await needAdmin(req);
    const { slug, html } = await json(req);
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug || '') || typeof html !== 'string' || html.length > 60000) throw new ApiError('BAD_INPUT');
    const dir = path.join(ROOT, 'b', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    return send(res, 200, { ok: true, path: `/b/${slug}/` });
  }

  if (p === '/api/upload' && req.method === 'POST') {
    await needAdmin(req);
    const type = (req.headers['content-type'] || '').split(';')[0];
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg' }[type];
    if (!ext) throw new ApiError('BAD_INPUT');
    const buf = await body(req, 2e6);
    const name = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(DATA, 'files', name), buf);
    return send(res, 200, { url: `/files/${name}` });
  }

  if (p === '/api/live') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Demo payment (local only): stands in for Moyasar + the verifying Edge Function.
  if (p === '/api/dev/pay' && req.method === 'POST') {
    const { booking_id, token, outcome } = await json(req);
    const st = await rpc(db, 'pub_payment_status', { booking_id, token });
    if (outcome === 'failed') return send(res, 200, { ok: false, reason: 'DECLINED', status: st.status });
    const mid = `demo_${crypto.randomBytes(6).toString('hex')}`;
    await rpc(db, 'pub_attach_payment', { booking_id, token, moyasar_id: mid });
    const r = await rpc(db, 'svc_confirm_payment',
      { booking_id, moyasar_id: mid, status: 'paid', currency: 'SAR', amount_halalas: st.due_now_halalas }, { role: 'service_role' });
    return send(res, 200, r);
  }

  throw new ApiError('NOT_FOUND', null, 404);
}

// ───────────── static files, GitHub Pages style ─────────────
function serveFile(res, file, status = 200) {
  const ext = path.extname(file).toLowerCase();
  // GitHub Pages also sends ACAO: * — embed.js on a client's site imports platform modules cross-origin.
  res.writeHead(status, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store',
    'access-control-allow-origin': '*' });
  fs.createReadStream(file).pipe(res);
}
function staticFile(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'bad path'); }
  if (rel.startsWith('/files/')) {
    const f = path.join(DATA, 'files', path.basename(rel));
    return fs.existsSync(f) ? serveFile(res, f) : send(res, 404, 'not found');
  }
  if (rel.includes('/node_modules/') || rel.includes('\0')) return send(res, 404, 'not found');
  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT)) return send(res, 403, 'forbidden');
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    if (!rel.endsWith('/')) { res.writeHead(301, { location: rel + '/' + url.search }); return res.end(); }
    const idx = path.join(abs, 'index.html');
    if (fs.existsSync(idx)) return serveFile(res, idx);
  } else if (fs.existsSync(abs)) {
    return serveFile(res, abs);
  }
  const nf = path.join(ROOT, '404.html');
  return fs.existsSync(nf) ? serveFile(res, nf, 404) : send(res, 404, 'not found');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else staticFile(req, res, url);
  } catch (e) {
    if (!res.headersSent) sendErr(res, e);
    else res.end();
  }
});
server.listen(PORT, HOST, () => {
  log(`Mamar Booking running → http://localhost:${PORT}`);
  log(`  /start/  setup flow   ·  /admin/  Ahmed  ·  /manage/  owners  ·  /b/ward-barber  booking  ·  /demo/barber/`);
  log(`  data: ${DATA}`);
});
const stop = async () => { server.close(); await db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
