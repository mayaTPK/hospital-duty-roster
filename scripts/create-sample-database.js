const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const databasePath = path.join(__dirname, '..', 'data', 'duty-roster-sample.sqlite');
if (fs.existsSync(databasePath)) {
  console.error(`Sample database already exists: ${databasePath}`);
  console.error('Remove the sample database and its SQLite sidecar files before regenerating it.');
  process.exit(1);
}

process.env.DATABASE_PATH = databasePath;
const { db } = require('../db');

function passwordRecord(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
  });
  return `scrypt$16384$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function createUser({ username, employeeId, department, role, password, email }) {
  const result = db.prepare(`
    INSERT INTO users (username, employee_id, department, email, password_hash, role, must_change_password)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(username, employeeId, department, email, passwordRecord(password), role);
  return Number(result.lastInsertRowid);
}

function assignScope(managerId, department, ward = null) {
  db.prepare(`
    INSERT INTO manager_scopes (manager_id, department, ward, scope_key)
    VALUES (?, ?, ?, ?)
  `).run(managerId, department, ward, `${department}|${ward || ''}`);
}

function createRoster({ managerId, department, ward = null, staffIds, published, shiftCodes }) {
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const rosterResult = db.prepare(`
    INSERT INTO rosters (department, ward, year, month, status, published_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    department,
    ward,
    year,
    month,
    published ? 'published' : 'draft',
    published ? new Date().toISOString() : null,
    managerId
  );
  const rosterId = Number(rosterResult.lastInsertRowid);
  const addStaff = db.prepare('INSERT INTO roster_staff (roster_id, user_id, sort_order) VALUES (?, ?, ?)');
  const addEntry = db.prepare('INSERT INTO roster_entries (roster_id, user_id, day, code) VALUES (?, ?, ?, ?)');
  const daysInMonth = new Date(year, month, 0).getDate();

  staffIds.forEach((staffId, index) => {
    addStaff.run(rosterId, staffId, index);
    for (let day = 1; day <= daysInMonth; day++) {
      addEntry.run(rosterId, staffId, day, shiftCodes[(day + index - 1) % shiftCodes.length]);
    }
  });

  if (published) {
    db.prepare(`
      INSERT INTO published_roster_staff (roster_id, user_id, sort_order)
      SELECT roster_id, user_id, sort_order FROM roster_staff WHERE roster_id = ?
    `).run(rosterId);
    db.prepare(`
      INSERT INTO published_roster_entries (roster_id, user_id, day, code)
      SELECT roster_id, user_id, day, code FROM roster_entries WHERE roster_id = ?
    `).run(rosterId);
  }
}

let committed = false;
try {
  db.exec('BEGIN IMMEDIATE');

  const adminId = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get().id;
  db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?
  `).run(passwordRecord('DemoAdmin-2026!'), adminId);

  const labManagerId = createUser({
    username: 'demo.lab.manager', employeeId: 'DEMO-MGR-LAB', department: 'Laboratory',
    role: 'manager', password: 'DemoManager-2026!', email: 'demo.lab.manager@example.test'
  });
  const nursingManagerId = createUser({
    username: 'demo.nursing.manager', employeeId: 'DEMO-MGR-NUR', department: 'Nursing',
    role: 'manager', password: 'DemoNursing-2026!', email: 'demo.nursing.manager@example.test'
  });
  assignScope(labManagerId, 'Laboratory');
  assignScope(nursingManagerId, 'Nursing', 'Surgical');

  const labStaffIds = ['01', '02', '03'].map((suffix, index) => createUser({
    username: `demo.lab.staff${suffix}`, employeeId: `DEMO-LAB-${suffix}`, department: 'Laboratory',
    role: 'staff', password: 'DemoStaff-2026!', email: `demo.lab.staff${index + 1}@example.test`
  }));
  const nursingStaffIds = ['01', '02', '03'].map((suffix, index) => createUser({
    username: `demo.nursing.staff${suffix}`, employeeId: `DEMO-NUR-${suffix}`, department: 'Nursing',
    role: 'staff', password: 'DemoStaff-2026!', email: `demo.nursing.staff${index + 1}@example.test`
  }));

  createRoster({
    managerId: labManagerId,
    department: 'Laboratory',
    staffIds: labStaffIds,
    published: false,
    shiftCodes: ['S', 'S', 'C', 'O', 'PH', 'LV']
  });
  createRoster({
    managerId: nursingManagerId,
    department: 'Nursing',
    ward: 'Surgical',
    staffIds: nursingStaffIds,
    published: true,
    shiftCodes: ['S', 'L', 'N', 'SD', 'O', 'PH']
  });

  db.exec('COMMIT');
  committed = true;
} catch (error) {
  try {
    db.exec('ROLLBACK');
  } catch {}
  throw error;
} finally {
  db.close();
  if (!committed) {
    for (const suffix of ['', '-shm', '-wal']) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  }
}

console.log(`Sample database created: ${databasePath}`);
console.log('Demo administrator: ADMIN-001 / DemoAdmin-2026!');
console.log('Laboratory manager: DEMO-MGR-LAB / DemoManager-2026!');
console.log('Nursing manager: DEMO-MGR-NUR / DemoNursing-2026!');
console.log('Demo staff: DEMO-LAB-01 through DEMO-LAB-03 and DEMO-NUR-01 through DEMO-NUR-03 / DemoStaff-2026!');