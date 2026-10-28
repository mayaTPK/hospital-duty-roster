const crypto = require('node:crypto');
const path = require('node:path');
const { promisify } = require('node:util');
const express = require('express');
const { db } = require('./db');

const app = express();
const port = Number(process.env.PORT || 3000);
const appOrigin = process.env.APP_ORIGIN || '';
const cookieName = 'duty_roster_session';
const sessionDurationSeconds = 60 * 60 * 12;
const scryptAsync = promisify(crypto.scrypt);
const loginAttempts = new Map();
const dummySalt = crypto.randomBytes(16);
const dummyHash = crypto.scryptSync('invalid-account-password', dummySalt, 64);
const rootDirectory = __dirname;

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '16kb', strict: true }));

function requestIsAllowed(req, res) {
  const origin = req.get('origin');
  if (origin && appOrigin && origin !== appOrigin) {
    res.status(403).json({ error: 'Request origin is not allowed.' });
    return false;
  }
  if (origin && !appOrigin) {
    const host = req.get('host');
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      res.status(403).json({ error: 'Request origin is not allowed.' });
      return false;
    }
    if (originHost !== host) {
      res.status(403).json({ error: 'Request origin is not allowed.' });
      return false;
    }
  }
  return true;
}

function requireSameOrigin(req, res, next) {
  if (requestIsAllowed(req, res)) next();
}

function cookieToken(req) {
  const header = req.get('cookie') || '';
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== cookieName) continue;
    return item.slice(separator + 1).trim();
  }
  return '';
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function setSessionCookie(res, token) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionDurationSeconds}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    employeeId: user.employee_id,
    department: user.department,
    email: user.email,
    phone: user.phone,
    contactDetails: user.contact_details,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password)
  };
}

function loadSession(req, res, next) {
  const token = cookieToken(req);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    req.user = null;
    return next();
  }

  const hash = tokenHash(token);
  const session = db.prepare(`
    SELECT users.id, users.username, users.employee_id, users.department,
           users.email, users.phone, users.contact_details, users.role,
           users.must_change_password
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hash, Date.now());
  if (!session) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ? OR expires_at <= ?').run(hash, Date.now());
    clearSessionCookie(res);
    req.user = null;
    return next();
  }
  req.user = session;
  req.sessionTokenHash = hash;
  next();
}

app.use(loadSession);

function requireAuthentication(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(req.user ? 403 : 401).json({ error: 'Administrator access is required.' });
    return;
  }
  if (req.user.must_change_password) {
    res.status(403).json({ error: 'Change your temporary password before managing accounts.' });
    return;
  }
  next();
}

function loginLimiter(req, res, next) {
  const now = Date.now();
  const key = `${req.socket.remoteAddress || 'unknown'}:${req.path}`;
  const current = loginAttempts.get(key);
  if (!current || now - current.startedAt > 15 * 60 * 1000) {
    loginAttempts.set(key, { startedAt: now, count: 1 });
    return next();
  }
  if (current.count >= 10) {
    res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
    return;
  }
  current.count++;
  next();
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 128;
}

function validEmployeeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/.test(value.trim());
}

function validDepartment(value) {
  return ['Laboratory', 'Clinical', 'Nursing'].includes(value);
}

function normalizeOptional(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

async function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

async function passwordMatches(password, storedHash) {
  const [algorithm, cost, saltHex, hashHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || cost !== '16384' || !/^[0-9a-f]{32}$/.test(saltHex || '') ||
      !/^[0-9a-f]{128}$/.test(hashHex || '')) {
    return false;
  }
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
  });
  return crypto.timingSafeEqual(actual, expected);
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), userId, now, now + sessionDurationSeconds * 1000);
  setSessionCookie(res, token);
}

function isUniqueConstraint(error) {
  return error && error.code === 'ERR_SQLITE_ERROR' &&
    /UNIQUE constraint failed/i.test(error.message);
}

const departmentShifts = {
  Laboratory: ['S', 'C', 'O', 'PH', 'LV'],
  Clinical: ['S', 'C', 'O', 'PH', 'LV'],
  Nursing: ['S', 'L', 'N', 'SD', 'O', 'PH', 'LV']
};

function rosterScope(department, yearValue, monthValue, wardValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const ward = department === 'Nursing' ? wardValue : null;
  if (!Object.hasOwn(departmentShifts, department) ||
      !Number.isInteger(year) || year < 2000 || year > 2200 ||
      !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  if (department === 'Nursing') {
    if (typeof ward !== 'string' || !ward.trim()) return null;
    if (!db.prepare('SELECT 1 FROM wards WHERE department = ? AND name = ? COLLATE NOCASE')
      .get(department, ward.trim())) return null;
  } else if (wardValue) {
    return null;
  }
  return { department, ward: ward ? ward.trim() : null, year, month };
}

function managerHasScope(userId, scope) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM manager_scopes
    WHERE manager_id = ? AND department = ?
      AND ((ward IS NULL AND ? IS NULL) OR ward = ? COLLATE NOCASE)
  `).get(userId, scope.department, scope.ward, scope.ward));
}

function requireRosterRole(req, res, next) {
  if (!req.user || !['manager', 'staff'].includes(req.user.role)) {
    res.status(req.user ? 403 : 401).json({ error: 'Staff or manager access is required.' });
    return;
  }
  if (req.user.must_change_password) {
    res.status(403).json({ error: 'Change your temporary password before continuing.' });
    return;
  }
  next();
}

function getRosterForManager(rosterId, userId) {
  const roster = db.prepare('SELECT * FROM rosters WHERE id = ?').get(rosterId);
  if (!roster) return { error: 'Roster not found.', status: 404 };
  const scope = { department: roster.department, ward: roster.ward };
  if (!managerHasScope(userId, scope)) return { error: 'You are not assigned to manage this roster.', status: 403 };
  return { roster };
}

function serializeRoster(roster, published = false) {
  const staffTable = published ? 'published_roster_staff' : 'roster_staff';
  const entriesTable = published ? 'published_roster_entries' : 'roster_entries';
  const staff = db.prepare(`
    SELECT users.id, users.username, users.role, ${staffTable}.sort_order
    FROM ${staffTable}
    JOIN users ON users.id = ${staffTable}.user_id
    WHERE ${staffTable}.roster_id = ?
    ORDER BY ${staffTable}.sort_order, users.username COLLATE NOCASE
  `).all(roster.id);
  const entries = db.prepare(`
    SELECT user_id AS userId, day, code
    FROM ${entriesTable}
    WHERE roster_id = ?
    ORDER BY user_id, day
  `).all(roster.id);
  return {
    roster: {
      id: roster.id,
      department: roster.department,
      ward: roster.ward,
      year: roster.year,
      month: roster.month,
      status: roster.status,
      publishedAt: roster.published_at,
      updatedAt: roster.updated_at
    },
    staff,
    entries
  };
}

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

app.post('/api/auth/register', requireSameOrigin, loginLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : '';
    const department = typeof body.department === 'string' ? body.department : '';
    const email = normalizeOptional(body.email);
    const phone = normalizeOptional(body.phone);
    const contactDetails = typeof body.contactDetails === 'string' ? body.contactDetails.trim() : '';
    const password = body.password;

    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      res.status(400).json({ error: 'Username must be 3–32 characters: letters, numbers, dots, underscores or hyphens.' });
      return;
    }
    if (!validEmployeeId(employeeId)) {
      res.status(400).json({ error: 'Enter a valid employee ID (1–32 letters, numbers, dots, underscores, slashes, or hyphens).' });
      return;
    }
    if (!validDepartment(department)) {
      res.status(400).json({ error: 'Choose Laboratory, Clinical, or Nursing.' });
      return;
    }
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }
    const phoneDigits = phone ? phone.replace(/\D/g, '').length : 0;
    if (phone && (phone.length > 24 || phoneDigits < 7 || phoneDigits > 15 ||
        !/^[+0-9(). -]+$/.test(phone))) {
      res.status(400).json({ error: 'Enter a valid phone number.' });
      return;
    }
    if (!email && !phone) {
      res.status(400).json({ error: 'Enter either an email address or a phone number.' });
      return;
    }
    if (contactDetails.length > 250) {
      res.status(400).json({ error: 'Contact details must be 250 characters or fewer.' });
      return;
    }
    if (!validatePassword(password)) {
      res.status(400).json({ error: 'Password must be between 10 and 128 characters.' });
      return;
    }

    const hashedPassword = await passwordHash(password);
    let result;
    try {
      if (phone) {
        const phoneDigits = phone.replace(/\D/g, '');
        const existingPhone = db.prepare(`
          SELECT 1 FROM users
          WHERE replace(replace(replace(replace(replace(replace(phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') = ?
        `).get(phoneDigits);
        if (existingPhone) {
          res.status(409).json({ error: 'That phone number is already registered.' });
          return;
        }
      }
      const duplicateEmployeeId = db.prepare('SELECT 1 FROM users WHERE employee_id = ? COLLATE NOCASE')
        .get(employeeId);
      if (duplicateEmployeeId) {
        res.status(409).json({ error: 'That employee ID is already registered.' });
        return;
      }
      result = db.prepare(`
        INSERT INTO users (username, employee_id, department, email, phone, contact_details, password_hash, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'staff')
      `).run(username, employeeId, department, email, phone, contactDetails, hashedPassword);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        res.status(409).json({ error: 'That username, email, or phone number is already registered.' });
        return;
      }
      throw error;
    }
    await createSession(res, Number(result.lastInsertRowid));
    const user = db.prepare(`
      SELECT id, username, employee_id, department, email, phone, contact_details, role, must_change_password
      FROM users WHERE id = ?
    `).get(Number(result.lastInsertRowid));
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', requireSameOrigin, loginLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : '';
    const password = body.password;
    if (!employeeId || typeof password !== 'string' || password.length > 128) {
      res.status(400).json({ error: 'Enter your employee ID and password.' });
      return;
    }
    if (!validEmployeeId(employeeId)) {
      res.status(400).json({ error: 'Enter a valid employee ID.' });
      return;
    }
    const user = db.prepare(`
      SELECT id, username, employee_id, department, email, phone, contact_details,
             password_hash, role, must_change_password
      FROM users WHERE employee_id = ? COLLATE NOCASE
    `).get(employeeId);
    const matches = user
      ? await passwordMatches(password, user.password_hash)
      : crypto.timingSafeEqual(
        await scryptAsync(password, dummySalt, dummyHash.length, {
          N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
        }),
        dummyHash
      );
    if (!user || !matches) {
      res.status(401).json({ error: 'Employee ID or password is incorrect.' });
      return;
    }

    await createSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', requireSameOrigin, (req, res) => {
  if (req.sessionTokenHash) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

app.post('/api/auth/change-password', requireSameOrigin, requireAuthentication, async (req, res, next) => {
  try {
    const currentPassword = req.body && req.body.currentPassword;
    const newPassword = req.body && req.body.newPassword;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      res.status(400).json({ error: 'Enter your current and new passwords.' });
      return;
    }
    if (!validatePassword(newPassword)) {
      res.status(400).json({ error: 'New password must be between 10 and 128 characters.' });
      return;
    }
    const account = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!account || !(await passwordMatches(currentPassword, account.password_hash))) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }
    if (currentPassword === newPassword) {
      res.status(400).json({ error: 'Choose a new password that differs from the current password.' });
      return;
    }
    const newHash = await passwordHash(newPassword);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
        .run(newHash, req.user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
        .run(req.user.id, req.sessionTokenHash || '');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/accounts', requireAuthentication, requireAdmin, (req, res) => {
  const accounts = db.prepare(`
    SELECT id, username, employee_id, department, email, phone, contact_details,
           role, must_change_password, created_at
    FROM users
    ORDER BY username COLLATE NOCASE
  `).all();
  const scopes = db.prepare(`
    SELECT id, manager_id, department, ward
    FROM manager_scopes
    ORDER BY department, ward, manager_id
  `).all();
  res.json({ accounts: accounts.map(publicUser), scopes });
});

app.post('/api/admin/accounts', requireSameOrigin, requireAuthentication, requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : '';
    const department = typeof body.department === 'string' ? body.department : '';
    const role = body.role;
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      res.status(400).json({ error: 'Username must be 3–32 characters: letters, numbers, dots, underscores or hyphens.' });
      return;
    }
    if (!validEmployeeId(employeeId)) {
      res.status(400).json({ error: 'Enter a valid employee ID (1–32 letters, numbers, dots, underscores, slashes, or hyphens).' });
      return;
    }
    if (!validDepartment(department)) {
      res.status(400).json({ error: 'Choose Laboratory, Clinical, or Nursing.' });
      return;
    }
    if (!['admin', 'manager'].includes(role)) {
      res.status(400).json({ error: 'This screen can create administrator or manager accounts only.' });
      return;
    }
    const temporaryPassword = crypto.randomBytes(18).toString('base64url');
    const hashedPassword = await passwordHash(temporaryPassword);
    const result = db.prepare(`
      INSERT INTO users (username, employee_id, department, password_hash, role, must_change_password)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(username, employeeId, department, hashedPassword, role);
    const account = db.prepare(`
      SELECT id, username, employee_id, department, email, phone, contact_details,
             role, must_change_password
      FROM users WHERE id = ?
    `).get(Number(result.lastInsertRowid));
    res.status(201).json({ account: publicUser(account), temporaryPassword });
  } catch (error) {
    if (isUniqueConstraint(error)) {
      res.status(409).json({ error: 'That username or employee ID is already registered.' });
      return;
    }
    next(error);
  }
});

app.post('/api/admin/accounts/:id/reset-password', requireSameOrigin, requireAuthentication, requireAdmin, async (req, res, next) => {
  try {
    const accountId = Number(req.params.id);
    if (!Number.isSafeInteger(accountId) || accountId < 1) {
      res.status(400).json({ error: 'Choose a valid account.' });
      return;
    }
    const account = db.prepare('SELECT id FROM users WHERE id = ?').get(accountId);
    if (!account) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }
    const temporaryPassword = crypto.randomBytes(18).toString('base64url');
    const hashedPassword = await passwordHash(temporaryPassword);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
        .run(hashedPassword, accountId);
      if (accountId === req.user.id) {
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
          .run(accountId, req.sessionTokenHash || '');
      } else {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(accountId);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ success: true, temporaryPassword });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/accounts/:id/profile', requireSameOrigin, requireAuthentication, requireAdmin, (req, res) => {
  const accountId = Number(req.params.id);
  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : '';
  const department = typeof body.department === 'string' ? body.department : '';
  if (!Number.isSafeInteger(accountId) || accountId < 1) {
    res.status(400).json({ error: 'Choose a valid account.' });
    return;
  }
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3–32 characters: letters, numbers, dots, underscores or hyphens.' });
    return;
  }
  if (!validEmployeeId(employeeId)) {
    res.status(400).json({ error: 'Enter a valid employee ID.' });
    return;
  }
  if (!validDepartment(department)) {
    res.status(400).json({ error: 'Choose Laboratory, Clinical, or Nursing.' });
    return;
  }
  try {
    const result = db.prepare('UPDATE users SET username = ?, employee_id = ?, department = ? WHERE id = ?')
      .run(username, employeeId, department, accountId);
    if (!result.changes) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }
    const account = db.prepare(`
      SELECT id, username, employee_id, department, email, phone, contact_details,
             role, must_change_password
      FROM users WHERE id = ?
    `).get(accountId);
    res.json({ account: publicUser(account) });
  } catch (error) {
    if (isUniqueConstraint(error)) {
      res.status(409).json({ error: 'That username or employee ID is already assigned to another account.' });
      return;
    }
    throw error;
  }
});

app.patch('/api/admin/accounts/:id/role', requireSameOrigin, requireAuthentication, requireAdmin, (req, res) => {
  const body = req.body || {};
  const accountId = Number(req.params.id);
  const role = body.role;
  if (!Number.isSafeInteger(accountId) || accountId < 1) {
    res.status(400).json({ error: 'Choose a valid account.' });
    return;
  }
  if (!['staff', 'manager'].includes(role)) {
    res.status(400).json({ error: 'Accounts can only be assigned the staff or manager role here.' });
    return;
  }
  const account = db.prepare('SELECT id, role FROM users WHERE id = ?').get(accountId);
  if (!account) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }
  if (account.role === 'admin') {
    res.status(403).json({ error: 'Administrator accounts cannot be changed from this screen.' });
    return;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, accountId);
    if (role !== 'manager') {
      db.prepare('DELETE FROM manager_scopes WHERE manager_id = ?').run(accountId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const updated = db.prepare(`
    SELECT id, username, email, phone, contact_details, role FROM users WHERE id = ?
  `).get(accountId);
  res.json({ account: publicUser(updated) });
});

app.post('/api/admin/manager-scopes', requireSameOrigin, requireAuthentication, requireAdmin, (req, res) => {
  const body = req.body || {};
  const managerId = Number(body.managerId);
  const department = typeof body.department === 'string' ? body.department : '';
  const ward = typeof body.ward === 'string' && body.ward.trim() ? body.ward.trim() : null;
  if (!Number.isSafeInteger(managerId) || managerId < 1) {
    res.status(400).json({ error: 'Choose a valid manager account.' });
    return;
  }
  if (!['Laboratory', 'Clinical', 'Nursing'].includes(department)) {
    res.status(400).json({ error: 'Choose a valid department.' });
    return;
  }
  if ((department === 'Nursing' && !ward) || (department !== 'Nursing' && ward)) {
    res.status(400).json({ error: 'Choose a ward only when assigning a Nursing manager scope.' });
    return;
  }
  if (ward && !db.prepare('SELECT 1 FROM wards WHERE department = ? AND name = ? COLLATE NOCASE').get(department, ward)) {
    res.status(400).json({ error: 'Choose a ward that exists in the Nursing department.' });
    return;
  }
  const manager = db.prepare('SELECT id, role FROM users WHERE id = ?').get(managerId);
  if (!manager) {
    res.status(404).json({ error: 'Manager account not found.' });
    return;
  }
  if (manager.role !== 'manager') {
    res.status(400).json({ error: 'Change this account to the manager role before assigning a scope.' });
    return;
  }
  const scopeKey = `${department}|${ward || ''}`;
  try {
    const result = db.prepare(`
      INSERT INTO manager_scopes (manager_id, department, ward, scope_key)
      VALUES (?, ?, ?, ?)
    `).run(managerId, department, ward, scopeKey);
    res.status(201).json({
      scope: {
        id: Number(result.lastInsertRowid),
        manager_id: managerId,
        department,
        ward
      }
    });
  } catch (error) {
    if (isUniqueConstraint(error)) {
      res.status(409).json({ error: 'This manager already has that department or ward assigned.' });
      return;
    }
    throw error;
  }
});

app.delete('/api/admin/manager-scopes/:id', requireSameOrigin, requireAuthentication, requireAdmin, (req, res) => {
  const scopeId = Number(req.params.id);
  if (!Number.isSafeInteger(scopeId) || scopeId < 1) {
    res.status(400).json({ error: 'Choose a valid manager assignment.' });
    return;
  }
  const result = db.prepare('DELETE FROM manager_scopes WHERE id = ?').run(scopeId);
  if (!result.changes) {
    res.status(404).json({ error: 'Manager assignment not found.' });
    return;
  }
  res.json({ success: true });
});

app.get('/api/rosters/:department/:year/:month', requireAuthentication, requireRosterRole, (req, res) => {
  const scope = rosterScope(req.params.department, req.params.year, req.params.month, req.query.ward);
  if (!scope) {
    res.status(400).json({ error: 'Choose a valid department, month, year, and Nursing ward.' });
    return;
  }
  if (req.user.role === 'manager') {
    if (!managerHasScope(req.user.id, scope)) {
      res.status(403).json({ error: 'You are not assigned to manage this department or ward.' });
      return;
    }
    const roster = db.prepare(`
      SELECT * FROM rosters
      WHERE department = ? AND COALESCE(ward, '') = COALESCE(?, '')
        AND year = ? AND month = ?
    `).get(scope.department, scope.ward, scope.year, scope.month);
    res.json(roster ? serializeRoster(roster) : { roster: null, staff: [], entries: [] });
    return;
  }

  const roster = db.prepare(`
    SELECT rosters.*
    FROM rosters
    JOIN published_roster_staff
      ON published_roster_staff.roster_id = rosters.id
     AND published_roster_staff.user_id = ?
    WHERE rosters.department = ? AND COALESCE(rosters.ward, '') = COALESCE(?, '')
      AND rosters.year = ? AND rosters.month = ?
      AND rosters.published_at IS NOT NULL
  `).get(req.user.id, scope.department, scope.ward, scope.year, scope.month);
  if (!roster) {
    res.status(404).json({ error: 'No published roster is available for you for this month.' });
    return;
  }
  const result = serializeRoster(roster, true);
  result.staff = result.staff.map(member => ({
    ...member,
    isCurrentUser: member.id === req.user.id
  }));
  res.json(result);
});

app.get('/api/roster-scopes', requireAuthentication, requireRosterRole, (req, res) => {
  if (req.user.role !== 'manager') {
    res.status(403).json({ error: 'Only managers have roster assignments.' });
    return;
  }
  const scopes = db.prepare(`
    SELECT department, ward
    FROM manager_scopes
    WHERE manager_id = ?
    ORDER BY department, ward
  `).all(req.user.id);
  res.json({ scopes });
});

app.post('/api/rosters', requireSameOrigin, requireAuthentication, requireRosterRole, (req, res) => {
  if (req.user.role !== 'manager') {
    res.status(403).json({ error: 'Only assigned managers can create rosters.' });
    return;
  }
  const body = req.body || {};
  const scope = rosterScope(body.department, body.year, body.month, body.ward);
  if (!scope) {
    res.status(400).json({ error: 'Choose a valid department, month, year, and Nursing ward.' });
    return;
  }
  if (!managerHasScope(req.user.id, scope)) {
    res.status(403).json({ error: 'You are not assigned to manage this department or ward.' });
    return;
  }
  try {
    const created = db.prepare(`
      INSERT INTO rosters (department, ward, year, month, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(scope.department, scope.ward, scope.year, scope.month, req.user.id);
    const roster = db.prepare('SELECT * FROM rosters WHERE id = ?').get(Number(created.lastInsertRowid));
    res.status(201).json(serializeRoster(roster));
  } catch (error) {
    if (isUniqueConstraint(error)) {
      res.status(409).json({ error: 'A roster for this department, ward, and month already exists.' });
      return;
    }
    throw error;
  }
});

app.get('/api/rosters/:id/staff-options', requireAuthentication, requireRosterRole, (req, res) => {
  if (req.user.role !== 'manager') {
    res.status(403).json({ error: 'Only assigned managers can view staff options.' });
    return;
  }
  const rosterId = Number(req.params.id);
  const access = getRosterForManager(rosterId, req.user.id);
  if (access.error) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const staff = db.prepare(`
    SELECT id, username
    FROM users
    WHERE department = ?
      AND id NOT IN (SELECT user_id FROM roster_staff WHERE roster_id = ?)
      AND (
        role = 'staff' OR (
          role = 'manager' AND EXISTS (
            SELECT 1
            FROM manager_scopes
            WHERE manager_scopes.manager_id = users.id
              AND manager_scopes.department = ?
              AND ((manager_scopes.ward IS NULL AND ? IS NULL) OR manager_scopes.ward = ? COLLATE NOCASE)
          )
        )
      )
    ORDER BY username COLLATE NOCASE
  `).all(
    access.roster.department,
    rosterId,
    access.roster.department,
    access.roster.ward,
    access.roster.ward
  );
  res.json({ staff });
});

app.post('/api/rosters/:id/staff', requireSameOrigin, requireAuthentication, requireRosterRole, (req, res) => {
  if (req.user.role !== 'manager') {
    res.status(403).json({ error: 'Only assigned managers can change roster staff.' });
    return;
  }
  const rosterId = Number(req.params.id);
  const access = getRosterForManager(rosterId, req.user.id);
  if (access.error) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const body = req.body || {};
  const userId = Number(body.userId);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    res.status(400).json({ error: 'Choose a valid staff account.' });
    return;
  }
  const user = db.prepare('SELECT id, role, department FROM users WHERE id = ?').get(userId);
  if (!user) {
    res.status(404).json({ error: 'Staff account not found.' });
    return;
  }
  if (!['staff', 'manager'].includes(user.role)) {
    res.status(400).json({ error: 'Only staff or managers assigned to this roster can be added.' });
    return;
  }
  if (user.department !== access.roster.department) {
    res.status(400).json({ error: 'Accounts can only be added to rosters for their registered department.' });
    return;
  }
  if (user.role === 'manager' && !managerHasScope(user.id, access.roster)) {
    res.status(400).json({ error: 'Only managers assigned to this roster can be added.' });
    return;
  }
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM roster_staff WHERE roster_id = ?')
    .get(rosterId).value;
  try {
    db.prepare('INSERT INTO roster_staff (roster_id, user_id, sort_order) VALUES (?, ?, ?)')
      .run(rosterId, userId, nextOrder);
  } catch (error) {
    if (isUniqueConstraint(error)) {
      res.status(409).json({ error: 'This staff member is already on the roster.' });
      return;
    }
    throw error;
  }
  db.prepare(`UPDATE rosters SET status = 'draft', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .run(rosterId);
  res.status(201).json(serializeRoster(db.prepare('SELECT * FROM rosters WHERE id = ?').get(rosterId)));
});

app.delete('/api/rosters/:id/staff/:userId', requireSameOrigin, requireAuthentication, requireRosterRole, (req, res) => {
  if (req.user.role !== 'manager') {
    res.status(403).json({ error: 'Only assigned managers can change roster staff.' });
    return;
  }
  const rosterId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const access = getRosterForManager(rosterId, req.user.id);
  if (access.error) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const result = db.prepare('DELETE FROM roster_staff WHERE roster_id = ? AND user_id = ?').run(rosterId, userId);
  if (!result.changes) {
    res.status(404).json({ error: 'Staff member is not on this draft roster.' });
    return;
  }
  db.prepare(`UPDATE rosters SET status = 'draft', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .run(rosterId);
  res.json(serializeRoster(db.prepare('SELECT * FROM rosters WHERE id = ?').get(rosterId)));
});

app.put('/api/rosters/:id/staff/order', requireSameOrigin, requireAuthentication, requireRosterRole, (req, res) => {
  if (req.user.role !== 'manager') {
    res.status(403).json({ error: 'Only assigned managers can reorder roster staff.' });
    return;
  }
  const rosterId = Number(req.params.id);
  const access = getRosterForManager(rosterId, req.user.id);
  if (access.error) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const userIds = req.body && req.body.userIds;
  if (!Array.isArray(userIds) || userIds.some(id => !Number.isSafeInteger(id) || id < 1)) {
    res.status(400).json({ error: 'Provide the ordered list of roster staff IDs.' });
    return;
  }
  const current = db.prepare('SELECT user_id FROM roster_staff WHERE roster_id = ? ORDER BY sort_order')
    .all(rosterId).map(row => row.user_id);
  if (new Set(userIds).size !== userIds.length ||
      userIds.length !== current.length ||
      current.some(id => !userIds.includes(id))) {
    res.status(400).json({ error: 'The order must include every roster staff member exactly once.' });
    return;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const update = db.prepare('UPDATE roster_staff SET sort_order = ? WHERE roster_id = ? AND user_id = ?');
    userIds.forEach((userId, index) => update.run(-index - 1, rosterId, userId));
    userIds.forEach((userId, index) => update.run(index, rosterId, userId));
    db.prepare(`UPDATE rosters SET status = 'draft', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .run(rosterId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.json(serializeRoster(db.prepare('SELECT * FROM rosters WHERE id = ?').get(rosterId)));
});

app.put('/api/rosters/:id/entries', requireSameOrigin, requireAuthentication, requireRosterRole, (req, res) => {
  if (req.user.role !== 'manager') {
    res.status(403).json({ error: 'Only assigned managers can edit roster shifts.' });
    return;
  }
  const rosterId = Number(req.params.id);
  const access = getRosterForManager(rosterId, req.user.id);
  if (access.error) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const body = req.body || {};
  const userId = Number(body.userId);
  const day = Number(body.day);
  const code = body.code;
  const roster = access.roster;
  const daysInMonth = new Date(roster.year, roster.month, 0).getDate();
  if (!Number.isSafeInteger(userId) || userId < 1 ||
      !Number.isInteger(day) || day < 1 || day > daysInMonth) {
    res.status(400).json({ error: 'Choose a roster staff member and a valid day in this month.' });
    return;
  }
  if (!departmentShifts[roster.department].includes(code)) {
    res.status(400).json({ error: 'That shift code is not valid for this department.' });
    return;
  }
  if (!db.prepare('SELECT 1 FROM roster_staff WHERE roster_id = ? AND user_id = ?').get(rosterId, userId)) {
    res.status(400).json({ error: 'The selected staff member is not on this roster.' });
    return;
  }
  db.prepare(`
    INSERT INTO roster_entries (roster_id, user_id, day, code) VALUES (?, ?, ?, ?)
    ON CONFLICT (roster_id, user_id, day) DO UPDATE SET code = excluded.code
  `).run(rosterId, userId, day, code);
  db.prepare(`UPDATE rosters SET status = 'draft', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .run(rosterId);
  res.json(serializeRoster(db.prepare('SELECT * FROM rosters WHERE id = ?').get(rosterId)));
});

app.post('/api/rosters/:id/publish', requireSameOrigin, requireAuthentication, requireRosterRole, (req, res) => {
  if (req.user.role !== 'manager') {
    res.status(403).json({ error: 'Only assigned managers can publish rosters.' });
    return;
  }
  const rosterId = Number(req.params.id);
  const access = getRosterForManager(rosterId, req.user.id);
  if (access.error) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const staffCount = db.prepare('SELECT COUNT(*) AS total FROM roster_staff WHERE roster_id = ?').get(rosterId).total;
  if (staffCount === 0) {
    res.status(400).json({ error: 'Add at least one staff member before publishing this roster.' });
    return;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM published_roster_entries WHERE roster_id = ?').run(rosterId);
    db.prepare('DELETE FROM published_roster_staff WHERE roster_id = ?').run(rosterId);
    db.prepare(`
      INSERT INTO published_roster_staff (roster_id, user_id, sort_order)
      SELECT roster_id, user_id, sort_order FROM roster_staff WHERE roster_id = ?
    `).run(rosterId);
    db.prepare(`
      INSERT INTO published_roster_entries (roster_id, user_id, day, code)
      SELECT roster_id, user_id, day, code FROM roster_entries WHERE roster_id = ?
    `).run(rosterId);
    db.prepare(`
      UPDATE rosters
      SET status = 'published', published_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(rosterId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.json(serializeRoster(db.prepare('SELECT * FROM rosters WHERE id = ?').get(rosterId)));
});

app.use('/assets', express.static(path.join(rootDirectory, 'assets'), {
  fallthrough: false,
  etag: true,
  maxAge: '1h'
}));
app.get('/', (req, res) => res.sendFile(path.join(rootDirectory, 'duty-roster-ui.html')));
app.get('/duty-roster-ui.html', (req, res) => res.sendFile(path.join(rootDirectory, 'duty-roster-ui.html')));
app.get('/api/*path', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error && error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body must contain valid JSON.' });
    return;
  }
  console.error('Request failed:', error);
  res.status(500).json({ error: 'The server could not complete the request.' });
});

const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  const host = process.env.HOST || '127.0.0.1';
  console.log(`Duty Roster running at http://${host}:${port}`);
  console.log(`Database: ${process.env.DATABASE_PATH || path.join(rootDirectory, 'data', 'duty-roster.sqlite')}`);
  console.log('First-time administrator credentials are shown on the administrator sign-in page.');
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
