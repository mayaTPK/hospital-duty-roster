const { db } = require('../db');

const role = process.argv[2];
const initialAdmin = {
  username: 'admin',
  employeeId: 'ADMIN-001',
  password: 'DutyRoster-Start1!'
};

function showInitialAdmin() {
  if (role !== 'admin') {
    console.error('Usage: node scripts/create-account.js admin');
    console.error('Create manager accounts in the administrator Accounts & Access screen.');
    process.exitCode = 1;
    return;
  }

  const admin = db.prepare(`
    SELECT must_change_password FROM users
    WHERE username = ? COLLATE NOCASE AND employee_id = ? COLLATE NOCASE AND role = 'admin'
  `).get(initialAdmin.username, initialAdmin.employeeId);
  if (!admin) {
    console.error('The initial administrator was not found. Start the app once to create it automatically.');
    process.exitCode = 1;
    return;
  }

  console.log('Initial administrator account:');
  console.log(`Employee ID: ${initialAdmin.employeeId}`);
  console.log(`Password: ${admin.must_change_password
    ? initialAdmin.password
    : 'Already changed; use the password chosen by the administrator.'}`);
  if (admin.must_change_password) console.log('Change this password immediately after signing in.');
}

try {
  showInitialAdmin();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
