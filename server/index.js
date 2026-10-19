import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3001);
const sessionCookie = 'care_session';
const sessionMaxAge = 60 * 60 * 24 * 7;
const defaultAdmin = { name: 'CareAudit Administrator', username: 'admin', password: '12345678' };

function databaseConfig() {
  const raw = process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not configured');
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    ssl: { rejectUnauthorized: false },
    connectionLimit: 8,
    waitForConnections: true,
    queueLimit: 0,
  };
}

const db = mysql.createPool(databaseConfig());

function id() {
  return crypto.randomUUID();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value));
}

function setSessionCookie(response, token) {
  response.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${sessionMaxAge}`);
}

function clearSessionCookie(response) {
  response.setHeader('Set-Cookie', `${sessionCookie}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`);
}

function publicUser(row) {
  return { id: row.id, role: row.role, name: row.name, username: row.username, active: Boolean(row.active), createdAt: row.created_at };
}

function validateCredentials({ name, username, password }, requireName = false) {
  if (requireName && (!name || !name.trim())) return 'Name is required.';
  if (!username || !/^[a-zA-Z0-9._-]{2,80}$/.test(username.trim())) return 'Username must be 2–80 letters, numbers, dots, underscores, or hyphens.';
  if (!password || password.length < 6 || password.length > 200) return 'Password must be between 6 and 200 characters.';
  return null;
}

async function ensureSchema() {
  await db.query(`CREATE TABLE IF NOT EXISTS careaudit_users (
    id CHAR(36) NOT NULL PRIMARY KEY,
    role ENUM('admin', 'inspector') NOT NULL,
    name VARCHAR(160) NOT NULL,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_careaudit_users_role (role)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS careaudit_sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_careaudit_sessions_user (user_id),
    INDEX idx_careaudit_sessions_expiry (expires_at),
    CONSTRAINT fk_careaudit_session_user FOREIGN KEY (user_id) REFERENCES careaudit_users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const [admins] = await db.execute("SELECT id FROM careaudit_users WHERE role = 'admin' LIMIT 1");
  if (admins.length === 0) {
    await db.execute('INSERT INTO careaudit_users (id, role, name, username, password_hash) VALUES (?, \'admin\', ?, ?, ?)', [id(), defaultAdmin.name, defaultAdmin.username, await bcrypt.hash(defaultAdmin.password, 12)]);
  }
}

async function authenticated(request, response, next) {
  try {
    const token = parseCookies(request.headers.cookie)[sessionCookie];
    if (!token) return response.status(401).json({ error: 'Not signed in.' });
    const [rows] = await db.execute(`SELECT u.* FROM careaudit_sessions s JOIN careaudit_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3) AND u.active = 1 LIMIT 1`, [hashToken(token)]);
    if (!rows.length) return response.status(401).json({ error: 'Session expired.' });
    request.user = rows[0];
    return next();
  } catch (error) {
    return next(error);
  }
}

function adminOnly(request, response, next) {
  if (request.user?.role !== 'admin') return response.status(403).json({ error: 'Admin access required.' });
  return next();
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', async (_request, response) => {
  try {
    await db.query('SELECT 1');
    response.json({ ok: true, service: 'careaudit', database: 'ready' });
  } catch {
    response.status(503).json({ ok: false, service: 'careaudit', database: 'unavailable' });
  }
});

app.get('/api/auth/status', async (_request, response, next) => {
  try {
    const [rows] = await db.execute("SELECT COUNT(*) AS count FROM careaudit_users WHERE role = 'admin'");
    response.json({ hasAdmin: Number(rows[0].count) > 0 });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', authenticated, (request, response) => response.json({ user: publicUser(request.user) }));

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const { role, username, password } = request.body || {};
    if (!['admin', 'inspector'].includes(role) || !username || !password) return response.status(400).json({ error: 'Role, username, and password are required.' });
    const [rows] = await db.execute('SELECT * FROM careaudit_users WHERE username = ? AND role = ? LIMIT 1', [username.trim().toLowerCase(), role]);
    const user = rows[0];
    if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) return response.status(401).json({ error: `${role === 'admin' ? 'Admin' : 'Inspector'} username or password is not correct.` });
    const token = crypto.randomBytes(32).toString('hex');
    await db.execute('DELETE FROM careaudit_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
    await db.execute('INSERT INTO careaudit_sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY))', [hashToken(token), user.id]);
    setSessionCookie(response, token);
    response.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', async (request, response, next) => {
  try {
    const token = parseCookies(request.headers.cookie)[sessionCookie];
    if (token) await db.execute('DELETE FROM careaudit_sessions WHERE token_hash = ?', [hashToken(token)]);
    clearSessionCookie(response);
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/api/admin/overview', authenticated, adminOnly, async (request, response, next) => {
  try {
    const [rows] = await db.execute("SELECT id, name, username, active, created_at FROM careaudit_users WHERE role = 'inspector' ORDER BY created_at DESC");
    response.json({ admin: publicUser(request.user), inspectors: rows.map(publicUser) });
  } catch (error) { next(error); }
});

app.post('/api/admin/inspectors', authenticated, adminOnly, async (request, response, next) => {
  try {
    const { name, username, password } = request.body || {};
    const validation = validateCredentials({ name, username, password }, true);
    if (validation) return response.status(400).json({ error: validation });
    const normalized = username.trim().toLowerCase();
    const [existing] = await db.execute('SELECT id FROM careaudit_users WHERE username = ? LIMIT 1', [normalized]);
    if (existing.length) return response.status(409).json({ error: 'That username is already in use.' });
    const inspectorId = id();
    await db.execute('INSERT INTO careaudit_users (id, role, name, username, password_hash) VALUES (?, \'inspector\', ?, ?, ?)', [inspectorId, name.trim(), normalized, await bcrypt.hash(password, 12)]);
    const [created] = await db.execute('SELECT id, role, name, username, active, created_at FROM careaudit_users WHERE id = ?', [inspectorId]);
    response.status(201).json({ inspector: publicUser(created[0]) });
  } catch (error) { next(error); }
});

app.patch('/api/admin/inspectors/:id', authenticated, adminOnly, async (request, response, next) => {
  try {
    const active = Boolean(request.body?.active);
    const [result] = await db.execute("UPDATE careaudit_users SET active = ? WHERE id = ? AND role = 'inspector'", [active ? 1 : 0, request.params.id]);
    if (!result.affectedRows) return response.status(404).json({ error: 'Inspector account not found.' });
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/admin/inspectors/:id/reset-password', authenticated, adminOnly, async (request, response, next) => {
  try {
    const password = request.body?.password;
    if (!password || password.length < 6 || password.length > 200) return response.status(400).json({ error: 'Password must be between 6 and 200 characters.' });
    const [result] = await db.execute("UPDATE careaudit_users SET password_hash = ?, active = 1 WHERE id = ? AND role = 'inspector'", [await bcrypt.hash(password, 12), request.params.id]);
    if (!result.affectedRows) return response.status(404).json({ error: 'Inspector account not found.' });
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.put('/api/admin/profile', authenticated, adminOnly, async (request, response, next) => {
  try {
    const { name, username, currentPassword, newPassword } = request.body || {};
    if (!name?.trim() || !username?.trim() || !currentPassword) return response.status(400).json({ error: 'Name, username, and current password are required.' });
    if (newPassword && (newPassword.length < 6 || newPassword.length > 200)) return response.status(400).json({ error: 'New password must be between 6 and 200 characters.' });
    if (!(await bcrypt.compare(currentPassword, request.user.password_hash))) return response.status(401).json({ error: 'The current admin password is not correct.' });
    const normalized = username.trim().toLowerCase();
    const [existing] = await db.execute('SELECT id FROM careaudit_users WHERE username = ? AND id <> ? LIMIT 1', [normalized, request.user.id]);
    if (existing.length) return response.status(409).json({ error: 'That username is already assigned to another account.' });
    const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : request.user.password_hash;
    await db.execute('UPDATE careaudit_users SET name = ?, username = ?, password_hash = ? WHERE id = ?', [name.trim(), normalized, passwordHash, request.user.id]);
    const [updated] = await db.execute('SELECT id, role, name, username, active, created_at FROM careaudit_users WHERE id = ?', [request.user.id]);
    response.json({ admin: publicUser(updated[0]) });
  } catch (error) { next(error); }
});

const distRoot = path.join(projectRoot, 'dist');
app.use(express.static(distRoot, { index: 'index.html' }));
app.use((request, response, next) => {
  if (request.method === 'GET' && request.accepts('html')) return response.sendFile(path.join(distRoot, 'index.html'));
  return next();
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Server error.' });
});

async function start() {
  await ensureSchema();
  app.listen(port, '0.0.0.0', () => console.log(`CareAudit server listening on ${port}`));
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
