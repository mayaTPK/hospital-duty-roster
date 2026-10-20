const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDirectory = process.env.DATA_DIRECTORY
  ? path.resolve(process.env.DATA_DIRECTORY)
  : path.join(__dirname, 'data');
fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(dataDirectory, 'duty-roster.sqlite');
const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    employee_id TEXT COLLATE NOCASE,
    department TEXT,
    email TEXT,
    phone TEXT,
    contact_details TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (role IN ('admin', 'manager') OR email IS NOT NULL OR phone IS NOT NULL)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
    ON users (email COLLATE NOCASE) WHERE email IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
    ON users (phone) WHERE phone IS NOT NULL;

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

  CREATE TABLE IF NOT EXISTS departments (
    name TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS wards (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE,
    department TEXT NOT NULL REFERENCES departments(name) ON DELETE CASCADE,
    UNIQUE (department, name)
  );

  CREATE TABLE IF NOT EXISTS manager_scopes (
    id INTEGER PRIMARY KEY,
    manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department TEXT NOT NULL REFERENCES departments(name) ON DELETE CASCADE,
    ward TEXT,
    scope_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (manager_id, scope_key),
    CHECK (
      (department = 'Nursing' AND ward IS NOT NULL) OR
      (department IN ('Laboratory', 'Clinical') AND ward IS NULL)
    )
  );

  CREATE TABLE IF NOT EXISTS rosters (
    id INTEGER PRIMARY KEY,
    department TEXT NOT NULL REFERENCES departments(name),
    ward TEXT,
    year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    published_at TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (
      (department = 'Nursing' AND ward IS NOT NULL) OR
      (department IN ('Laboratory', 'Clinical') AND ward IS NULL)
    )
  );

  CREATE TABLE IF NOT EXISTS roster_staff (
    roster_id INTEGER NOT NULL REFERENCES rosters(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (roster_id, user_id),
    UNIQUE (roster_id, sort_order)
  );

  CREATE TABLE IF NOT EXISTS published_roster_staff (
    roster_id INTEGER NOT NULL REFERENCES rosters(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (roster_id, user_id),
    UNIQUE (roster_id, sort_order)
  );

  CREATE TABLE IF NOT EXISTS roster_entries (
    roster_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    code TEXT NOT NULL,
    PRIMARY KEY (roster_id, user_id, day),
    FOREIGN KEY (roster_id, user_id)
      REFERENCES roster_staff(roster_id, user_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS published_roster_entries (
    roster_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    code TEXT NOT NULL,
    PRIMARY KEY (roster_id, user_id, day),
    FOREIGN KEY (roster_id, user_id)
      REFERENCES published_roster_staff(roster_id, user_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS rosters_status ON rosters (status, published_at);
  CREATE UNIQUE INDEX IF NOT EXISTS roster_period_unique
    ON rosters (department, COALESCE(ward, ''), year, month);
  CREATE INDEX IF NOT EXISTS roster_staff_user ON roster_staff (user_id, roster_id);
  CREATE INDEX IF NOT EXISTS published_roster_staff_user ON published_roster_staff (user_id, roster_id);

  INSERT OR IGNORE INTO departments (name) VALUES ('Laboratory'), ('Clinical'), ('Nursing');
  INSERT OR IGNORE INTO wards (name, department) VALUES
    ('Surgical', 'Nursing'),
    ('Male', 'Nursing'),
    ('Female', 'Nursing'),
    ('Paediatric', 'Nursing'),
    ('HDU', 'Nursing'),
    ('Labour', 'Nursing'),
    ('Postnatal', 'Nursing'),
    ('Antenatal', 'Nursing');
`);

const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
if (!userColumns.has('employee_id')) db.exec('ALTER TABLE users ADD COLUMN employee_id TEXT COLLATE NOCASE');
if (!userColumns.has('department')) db.exec('ALTER TABLE users ADD COLUMN department TEXT');
if (!userColumns.has('must_change_password')) {
  db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS users_employee_id_unique
    ON users (employee_id COLLATE NOCASE) WHERE employee_id IS NOT NULL;
`);

const initialAdmin = {
  username: 'admin',
  employeeId: 'ADMIN-001',
  department: 'Clinical',
  password: 'DutyRoster-Start1!'
};
const initialAdminHashSalt = crypto.randomBytes(16);
const initialAdminPasswordHash = crypto.scryptSync(initialAdmin.password, initialAdminHashSalt, 64, {
  N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
});
const initialAdminPasswordRecord =
  `scrypt$16384$${initialAdminHashSalt.toString('hex')}$${initialAdminPasswordHash.toString('hex')}`;
const existingInitialAdmin = db.prepare(`
  SELECT id, must_change_password
  FROM users
  WHERE username = ? COLLATE NOCASE AND employee_id = ? COLLATE NOCASE AND role = 'admin'
`).get(initialAdmin.username, initialAdmin.employeeId);

if (existingInitialAdmin && existingInitialAdmin.must_change_password) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(initialAdminPasswordRecord, existingInitialAdmin.id);
} else if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get()) {
  db.prepare(`
    INSERT INTO users (username, employee_id, department, password_hash, role, must_change_password)
    VALUES (?, ?, ?, ?, 'admin', 1)
  `).run(
    initialAdmin.username,
    initialAdmin.employeeId,
    initialAdmin.department,
    initialAdminPasswordRecord
  );
}

module.exports = { db };
