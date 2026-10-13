// Local database for Mamar Booking: real Postgres (PGlite, WebAssembly) running the exact
// migrations that go to Supabase, plus a stub of Supabase's auth schema (local_auth.sql).
// Used by server.js and by the tests.
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');                        // mamar/
export const SQL_DIR = path.join(ROOT, 'platform', 'supabase');

const ROLES = { anon: 'anon', authenticated: 'authenticated', service_role: 'service_role' };

export class ApiError extends Error {
  constructor(code, detail = null, status = 400) {
    super(code);
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

/** Open (or create) the database and bring it up to date. dataDir 'memory://' for tests. */
export async function openDb({ dataDir = 'memory://', demo = true, log = () => {} } = {}) {
  if (dataDir !== 'memory://') fs.mkdirSync(dataDir, { recursive: true });
  const db = await PGlite.create(dataDir, { extensions: { btree_gist } });
  await db.exec(`set timezone = 'UTC'`);                              // what Supabase runs with
  await db.exec(`set mamar.local = 'on'`);                            // lets demo businesses show the demo payment sheet
  await db.exec(fs.readFileSync(path.join(HERE, 'local_auth.sql'), 'utf8'));
  const files = fs.readdirSync(path.join(SQL_DIR, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try {
      await db.exec(fs.readFileSync(path.join(SQL_DIR, 'migrations', f), 'utf8'));
    } catch (e) {
      throw new Error(`${f}: ${e.message}`);
    }
  }
  if (demo) await db.exec(fs.readFileSync(path.join(SQL_DIR, 'seed', 'demo.sql'), 'utf8'));
  log(`db ready (${files.length} migrations${demo ? ' + demo' : ''})`);
  return db;
}

/**
 * Call one RPC exactly the way PostgREST does on Supabase: inside a transaction, as the caller's
 * role, with the JWT claims set, so security definer + RLS + grants behave identically.
 * ctx: { role: 'anon'|'authenticated'|'service_role', sub?, email? }
 */
export async function rpc(db, name, args = {}, ctx = {}) {
  if (!/^(pub|own|adm|svc)_[a-z0-9_]+$/.test(name)) throw new ApiError('NOT_FOUND', null, 404);
  const role = ROLES[ctx.role || 'anon'];
  if (!role) throw new ApiError('NOT_ALLOWED', null, 403);
  try {
    return await db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: ctx.sub || null, role, email: ctx.email || null })]);
      const r = await tx.query(`select public.${name}($1::jsonb) as r`, [JSON.stringify(args ?? {})]);
      return r.rows[0].r;
    });
  } catch (e) {
    throw toApiError(e);
  }
}

export function toApiError(e) {
  if (e instanceof ApiError) return e;
  if (e && e.code === 'P0001') {
    let detail = null;
    try { detail = e.detail ? JSON.parse(e.detail) : null; } catch { detail = e.detail; }
    return new ApiError(e.message, detail, 400);
  }
  if (e && (e.code === '42501')) return new ApiError('NOT_ALLOWED', null, 403);
  if (e && (e.code === '42883' || e.code === '42P01')) return new ApiError('NOT_FOUND', null, 404);
  if (e && /^22/.test(e.code || '')) return new ApiError('BAD_INPUT', e.message, 400);
  const err = new ApiError('SERVER_ERROR', e && e.message, 500);
  err.cause = e;
  return err;
}

// ───────────── local users (Supabase Auth stand-in) ─────────────

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, keyHex] = stored.split('$');
  const key = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

export async function ensureUser(db, email, password, { admin = false, businesses = [] } = {}) {
  email = String(email).trim().toLowerCase();
  let r = await db.query(`select id from auth.users where email = $1`, [email]);
  let id = r.rows[0]?.id;
  if (!id) {
    r = await db.query(`insert into auth.users (email, encrypted_password) values ($1, $2) returning id`,
      [email, hashPassword(password)]);
    id = r.rows[0].id;
  }
  if (admin) await db.query(`insert into public.admins (user_id) values ($1) on conflict do nothing`, [id]);
  for (const slug of businesses) {
    await db.query(`insert into public.members (business_id, user_id)
                    select id, $1 from public.businesses where slug = $2 on conflict do nothing`, [id, slug]);
  }
  return id;
}

export async function findUser(db, emailOrUsername) {
  let email = String(emailOrUsername || '').trim().toLowerCase();
  if (email && !email.includes('@')) email = `${email}@owners.mamar.site`;
  const r = await db.query(`select id, email, encrypted_password from auth.users where email = $1`, [email]);
  return r.rows[0] || null;
}

export async function isAdmin(db, userId) {
  const r = await db.query(`select 1 from public.admins where user_id = $1`, [userId]);
  return r.rows.length > 0;
}

/** Fill prayer_times for `days` days from `fromISO` using platform/prayer.js (if it exists yet). */
export async function seedPrayerTimes(db, { fromISO, days = 400, city = 'jeddah' } = {}) {
  let mod;
  try {
    mod = await import(new URL('../platform/prayer.js', import.meta.url));
  } catch {
    return 0;
  }
  const rows = mod.prayerYear(fromISO, days);
  await db.query(
    `insert into public.prayer_times (city, day, fajr, dhuhr, asr, maghrib, isha)
     select $1, (r->>'day')::date, (r->>'fajr')::time, (r->>'dhuhr')::time, (r->>'asr')::time,
            (r->>'maghrib')::time, (r->>'isha')::time
     from jsonb_array_elements($2::jsonb) r
     on conflict (city, day) do update set fajr = excluded.fajr, dhuhr = excluded.dhuhr, asr = excluded.asr,
       maghrib = excluded.maghrib, isha = excluded.isha`,
    [city, JSON.stringify(rows)]);
  return rows.length;
}
