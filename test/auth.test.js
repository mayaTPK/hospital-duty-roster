const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const net = require('node:net');
const { after, before, test } = require('node:test');

const root = path.resolve(__dirname, '..');
let serverProcess;
let databaseDirectory;
let baseUrl;
let serverOutput = '';
let adminCookie;
const adminEmployeeId = 'ADMIN-001';
const adminPassword = 'SecureIntegrationAdmin123';
const initialAdminPassword = 'DutyRoster-Start1!';

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Roster server exited before becoming ready.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/auth/me`);
      if (response.ok) return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Roster server did not start in time.\n${serverOutput}`);
}

async function request(route, { method = 'GET', body, cookie, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

before(async () => {
  databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'duty-roster-auth-'));
  baseUrl = `http://127.0.0.1:${await unusedPort()}`;
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: new URL(baseUrl).port,
      DATABASE_PATH: path.join(databaseDirectory, 'test.sqlite')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stderr.setEncoding('utf8');
  serverProcess.stdout.on('data', chunk => { serverOutput += chunk; });
  serverProcess.stderr.on('data', chunk => { serverOutput += chunk; });
  await waitForServer();
  const admin = spawnSync(process.execPath, ['scripts/create-account.js', 'admin'], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_PATH: path.join(databaseDirectory, 'test.sqlite')
    },
    encoding: 'utf8',
    timeout: 30000
  });
  if (admin.error || admin.status !== 0) {
    throw new Error(`Could not provision the test administrator.\n${admin.stdout}\n${admin.stderr}`);
  }
  if (!admin.stdout.includes(`Password: ${initialAdminPassword}`)) {
    throw new Error(`The bootstrap command did not show the documented initial password.\n${admin.stdout}`);
  }
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { employeeId: adminEmployeeId, password: initialAdminPassword }
  });
  if (login.response.status !== 200) {
    throw new Error(`Could not sign in the test administrator. ${JSON.stringify(login.payload)}`);
  }
  assert.equal(login.payload.user.mustChangePassword, true);
  const changedPassword = await request('/api/auth/change-password', {
    method: 'POST',
    cookie: login.cookie,
    body: { currentPassword: initialAdminPassword, newPassword: adminPassword }
  });
  if (changedPassword.response.status !== 200) {
    throw new Error(`Could not change the bootstrap administrator password. ${JSON.stringify(changedPassword.payload)}`);
  }
  adminCookie = login.cookie;
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await Promise.race([
      once(serverProcess, 'exit'),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
  }
  if (databaseDirectory) fs.rmSync(databaseDirectory, { recursive: true, force: true });
});

test('registers staff, restores sessions, authenticates, and logs out', async () => {
  const username = `staff${Date.now()}`;
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username,
      employeeId: `ID-${username}`,
      department: 'Laboratory',
      email: `${username}@example.test`,
      password: 'SecureExamplePassword123',
      role: 'manager'
    }
  });
  assert.equal(registration.response.status, 201);
  assert.equal(registration.payload.user.role, 'staff');
  assert.ok(registration.cookie.startsWith('duty_roster_session='));
  assert.equal(registration.response.headers.get('set-cookie').includes('HttpOnly'), true);
  assert.equal(registration.response.headers.get('set-cookie').includes('SameSite=Strict'), true);

  const restored = await request('/api/auth/me', { cookie: registration.cookie });
  assert.equal(restored.payload.user.username, username);

  const duplicate = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username,
      employeeId: `ID-${username}`,
      department: 'Laboratory',
      email: `${username}@example.test`,
      password: 'SecureExamplePassword123'
    }
  });
  assert.equal(duplicate.response.status, 409);

  const withoutContact = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username: `${username}x`,
      employeeId: `ID-${username}X`,
      department: 'Laboratory',
      password: 'SecureExamplePassword123'
    }
  });
  assert.equal(withoutContact.response.status, 400);

  const disallowedOrigin = await request('/api/auth/login', {
    method: 'POST',
    origin: 'http://untrusted.example',
    body: { employeeId: `ID-${username}`, password: 'SecureExamplePassword123' }
  });
  assert.equal(disallowedOrigin.response.status, 403);

  const invalidPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { employeeId: `ID-${username}`, password: 'IncorrectPassword123' }
  });
  assert.equal(invalidPassword.response.status, 401);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { employeeId: `ID-${username}`, password: 'SecureExamplePassword123' }
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.payload.user.role, 'staff');

  const usernameLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { username, password: 'SecureExamplePassword123' }
  });
  assert.equal(usernameLogin.response.status, 400);

  const phoneUsername = `${username}phone`;
  const phoneRegistration = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username: phoneUsername,
      employeeId: `ID-${phoneUsername}`,
      department: 'Clinical',
      phone: '+1 (555) 123-4567',
      password: 'SecureExamplePassword123'
    }
  });
  assert.equal(phoneRegistration.response.status, 201);
  const duplicateFormattedPhone = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username: `duplicate${Date.now()}`,
      employeeId: `ID-DUP-${Date.now()}`,
      department: 'Clinical',
      phone: '1-555-123-4567',
      password: 'SecureExamplePassword123'
    }
  });
  assert.equal(duplicateFormattedPhone.response.status, 409);
  const phoneLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { employeeId: `ID-${phoneUsername}`, password: 'SecureExamplePassword123' }
  });
  assert.equal(phoneLogin.response.status, 200);
  assert.equal(phoneLogin.payload.user.username, phoneUsername);

  const logout = await request('/api/auth/logout', {
    method: 'POST',
    cookie: login.cookie || registration.cookie,
    body: {}
  });
  assert.equal(logout.payload.success, true);
  const afterLogout = await request('/api/auth/me', {
    cookie: login.cookie || registration.cookie
  });
  assert.equal(afterLogout.payload.user, null);
});

test('restricts account roles and manager assignments to administrators', async () => {
  const staffUsername = `scope${Date.now()}`;
  const staff = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username: staffUsername,
      employeeId: `ID-${staffUsername}`,
      department: 'Clinical',
      email: `${staffUsername}@example.test`,
      password: 'SecureExamplePassword123'
    }
  });
  assert.equal(staff.response.status, 201);

  const forbiddenList = await request('/api/admin/accounts', { cookie: staff.cookie });
  assert.equal(forbiddenList.response.status, 403);
  const forbiddenPromotion = await request(`/api/admin/accounts/${staff.payload.user.id}/role`, {
    method: 'PATCH',
    cookie: staff.cookie,
    body: { role: 'manager' }
  });
  assert.equal(forbiddenPromotion.response.status, 403);

  const makeManager = await request(`/api/admin/accounts/${staff.payload.user.id}/role`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { role: 'manager' }
  });
  assert.equal(makeManager.response.status, 200);
  assert.equal(makeManager.payload.account.role, 'manager');
  const profile = await request(`/api/admin/accounts/${staff.payload.user.id}/profile`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      username: `updated-${staffUsername}`,
      employeeId: `UPDATED-${staffUsername}`,
      department: 'Laboratory'
    }
  });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.payload.account.username, `updated-${staffUsername}`);
  assert.equal(profile.payload.account.employeeId, `UPDATED-${staffUsername}`);
  assert.equal(profile.payload.account.role, 'manager');

  const assignment = await request('/api/admin/manager-scopes', {
    method: 'POST',
    cookie: adminCookie,
    body: { managerId: staff.payload.user.id, department: 'Nursing', ward: 'Surgical' }
  });
  assert.equal(assignment.response.status, 201);
  assert.equal(assignment.payload.scope.ward, 'Surgical');

  const duplicate = await request('/api/admin/manager-scopes', {
    method: 'POST',
    cookie: adminCookie,
    body: { managerId: staff.payload.user.id, department: 'Nursing', ward: 'Surgical' }
  });
  assert.equal(duplicate.response.status, 409);

  const invalidWard = await request('/api/admin/manager-scopes', {
    method: 'POST',
    cookie: adminCookie,
    body: { managerId: staff.payload.user.id, department: 'Nursing', ward: 'Not a ward' }
  });
  assert.equal(invalidWard.response.status, 400);

  const adminList = await request('/api/admin/accounts', { cookie: adminCookie });
  assert.equal(adminList.response.status, 200);
  assert.equal(adminList.payload.scopes.length, 1);
  assert.equal(adminList.payload.scopes[0].manager_id, staff.payload.user.id);

  const promotionToAdmin = await request(`/api/admin/accounts/${staff.payload.user.id}/role`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { role: 'admin' }
  });
  assert.equal(promotionToAdmin.response.status, 400);

  const removeAssignment = await request(`/api/admin/manager-scopes/${assignment.payload.scope.id}`, {
    method: 'DELETE',
    cookie: adminCookie
  });
  assert.equal(removeAssignment.response.status, 200);
  const demoteManager = await request(`/api/admin/accounts/${staff.payload.user.id}/role`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { role: 'staff' }
  });
  assert.equal(demoteManager.payload.account.role, 'staff');
});

test('creates elevated accounts in-app and requires a password change after reset', async () => {
  const employeeId = `MGR-${Date.now()}`;
  const created = await request('/api/admin/accounts', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      employeeId,
      username: `newmanager${Date.now()}`,
      department: 'Clinical',
      role: 'manager'
    }
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.account.employeeId, employeeId);
  assert.equal(created.payload.account.department, 'Clinical');
  assert.equal(created.payload.account.role, 'manager');
  assert.equal(created.payload.account.mustChangePassword, true);
  assert.ok(created.payload.temporaryPassword);

  const managerLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { employeeId, password: created.payload.temporaryPassword }
  });
  assert.equal(managerLogin.response.status, 200);
  assert.equal(managerLogin.payload.user.mustChangePassword, true);

  const restricted = await request('/api/roster-scopes', { cookie: managerLogin.cookie });
  assert.equal(restricted.response.status, 403);
  const changePassword = await request('/api/auth/change-password', {
    method: 'POST',
    cookie: managerLogin.cookie,
    body: {
      currentPassword: created.payload.temporaryPassword,
      newPassword: 'SecureNewManagerPassword123'
    }
  });
  assert.equal(changePassword.response.status, 200);
  const updatedSession = await request('/api/auth/me', { cookie: managerLogin.cookie });
  assert.equal(updatedSession.payload.user.mustChangePassword, false);

  const reset = await request(`/api/admin/accounts/${created.payload.account.id}/reset-password`, {
    method: 'POST',
    cookie: adminCookie,
    body: {}
  });
  assert.equal(reset.response.status, 200);
  assert.ok(reset.payload.temporaryPassword);
  const invalidatedSession = await request('/api/auth/me', { cookie: managerLogin.cookie });
  assert.equal(invalidatedSession.payload.user, null);
  const resetLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { employeeId, password: reset.payload.temporaryPassword }
  });
  assert.equal(resetLogin.response.status, 200);
  assert.equal(resetLogin.payload.user.mustChangePassword, true);

  const adminCreated = await request('/api/admin/accounts', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      employeeId: `ADM-${Date.now()}`,
      username: `newadmin${Date.now()}`,
      department: 'Nursing',
      role: 'admin'
    }
  });
  assert.equal(adminCreated.response.status, 201);
  assert.equal(adminCreated.payload.account.role, 'admin');
  const forbiddenSelfElevation = await request('/api/admin/accounts', {
    method: 'POST',
    cookie: resetLogin.cookie,
    body: {
      employeeId: `ADM-X-${Date.now()}`,
      username: `badadmin${Date.now()}`,
      department: 'Nursing',
      role: 'admin'
    }
  });
  assert.equal(forbiddenSelfElevation.response.status, 403);
});

test('limits roster drafts to assigned managers and gives staff published snapshots only', async () => {
  const suffix = Date.now();
  const managerUsername = `roster_manager${suffix}`;
  const staffUsername = `roster_staff${suffix}`;
  const otherStaffUsername = `roster_other${suffix}`;
  const wrongDepartmentUsername = `roster_clinical${suffix}`;
  const password = 'SecureRosterPassword123';
  const registrations = await Promise.all([
    request('/api/auth/register', {
      method: 'POST',
      body: {
        username: managerUsername,
        employeeId: `ID-${managerUsername}`,
        department: 'Nursing',
        email: `${managerUsername}@example.test`,
        password
      }
    }),
    request('/api/auth/register', {
      method: 'POST',
      body: {
        username: staffUsername,
        employeeId: `ID-${staffUsername}`,
        department: 'Nursing',
        email: `${staffUsername}@example.test`,
        password
      }
    }),
    request('/api/auth/register', {
      method: 'POST',
      body: {
        username: otherStaffUsername,
        employeeId: `ID-${otherStaffUsername}`,
        department: 'Nursing',
        email: `${otherStaffUsername}@example.test`,
        password
      }
    }),
    request('/api/auth/register', {
      method: 'POST',
      body: {
        username: wrongDepartmentUsername,
        employeeId: `ID-${wrongDepartmentUsername}`,
        department: 'Clinical',
        email: `${wrongDepartmentUsername}@example.test`,
        password
      }
    })
  ]);
  const [managerRegistration, staffRegistration, otherStaffRegistration, wrongDepartmentRegistration] = registrations;
  assert.equal(managerRegistration.response.status, 201);
  assert.equal(staffRegistration.response.status, 201);
  assert.equal(otherStaffRegistration.response.status, 201);
  assert.equal(wrongDepartmentRegistration.response.status, 201);

  const promote = await request(`/api/admin/accounts/${managerRegistration.payload.user.id}/role`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { role: 'manager' }
  });
  assert.equal(promote.response.status, 200);
  const assignment = await request('/api/admin/manager-scopes', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      managerId: managerRegistration.payload.user.id,
      department: 'Nursing',
      ward: 'Surgical'
    }
  });
  assert.equal(assignment.response.status, 201);
  const managerAssignments = await request('/api/roster-scopes', { cookie: managerRegistration.cookie });
  assert.deepEqual(managerAssignments.payload.scopes, [{ department: 'Nursing', ward: 'Surgical' }]);
  const managerCookie = managerRegistration.cookie;
  const staffCookie = staffRegistration.cookie;
  const otherStaffCookie = otherStaffRegistration.cookie;
  const year = 2030;
  const month = 2;
  const rosterPath = `/api/rosters/Nursing/${year}/${month}?ward=Surgical`;

  const forbiddenWard = await request(`/api/rosters/Nursing/${year}/${month}?ward=Male`, {
    cookie: managerCookie
  });
  assert.equal(forbiddenWard.response.status, 403);
  const staffCannotCreate = await request('/api/rosters', {
    method: 'POST',
    cookie: staffCookie,
    body: { department: 'Nursing', ward: 'Surgical', year, month }
  });
  assert.equal(staffCannotCreate.response.status, 403);

  const created = await request('/api/rosters', {
    method: 'POST',
    cookie: managerCookie,
    body: { department: 'Nursing', ward: 'Surgical', year, month }
  });
  assert.equal(created.response.status, 201);
  const rosterId = created.payload.roster.id;
  const duplicateRoster = await request('/api/rosters', {
    method: 'POST',
    cookie: managerCookie,
    body: { department: 'Nursing', ward: 'Surgical', year, month }
  });
  assert.equal(duplicateRoster.response.status, 409);
  const wrongDepartment = await request(`/api/rosters/${rosterId}/staff`, {
    method: 'POST',
    cookie: managerCookie,
    body: { userId: wrongDepartmentRegistration.payload.user.id }
  });
  assert.equal(wrongDepartment.response.status, 400);
  const addStaff = await request(`/api/rosters/${rosterId}/staff`, {
    method: 'POST',
    cookie: managerCookie,
    body: { userId: staffRegistration.payload.user.id }
  });
  assert.equal(addStaff.response.status, 201);
  const availableStaff = await request(`/api/rosters/${rosterId}/staff-options`, { cookie: managerCookie });
  assert.equal(availableStaff.response.status, 200);
  assert.equal(availableStaff.payload.staff.some(account => account.id === staffRegistration.payload.user.id), false);
  assert.equal(availableStaff.payload.staff.some(account => account.id === otherStaffRegistration.payload.user.id), true);
  assert.equal(availableStaff.payload.staff.some(account => account.id === managerRegistration.payload.user.id), true);

  const addManager = await request(`/api/rosters/${rosterId}/staff`, {
    method: 'POST',
    cookie: managerCookie,
    body: { userId: managerRegistration.payload.user.id }
  });
  assert.equal(addManager.response.status, 201);
  assert.equal(addManager.payload.staff.some(account =>
    account.id === managerRegistration.payload.user.id && account.role === 'manager'
  ), true);
  const availableAfterManagerAdded = await request(`/api/rosters/${rosterId}/staff-options`, {
    cookie: managerCookie
  });
  assert.equal(availableAfterManagerAdded.payload.staff.some(account =>
    account.id === managerRegistration.payload.user.id
  ), false);

  const draftHidden = await request(rosterPath, { cookie: staffCookie });
  assert.equal(draftHidden.response.status, 404);
  const notAssignedCannotRead = await request(rosterPath, { cookie: otherStaffCookie });
  assert.equal(notAssignedCannotRead.response.status, 404);

  const badShift = await request(`/api/rosters/${rosterId}/entries`, {
    method: 'PUT',
    cookie: managerCookie,
    body: { userId: staffRegistration.payload.user.id, day: 1, code: 'UNKNOWN' }
  });
  assert.equal(badShift.response.status, 400);
  const badDay = await request(`/api/rosters/${rosterId}/entries`, {
    method: 'PUT',
    cookie: managerCookie,
    body: { userId: staffRegistration.payload.user.id, day: 30, code: 'S' }
  });
  assert.equal(badDay.response.status, 400);
  const addEntry = await request(`/api/rosters/${rosterId}/entries`, {
    method: 'PUT',
    cookie: managerCookie,
    body: { userId: staffRegistration.payload.user.id, day: 1, code: 'S' }
  });
  assert.equal(addEntry.response.status, 200);

  const published = await request(`/api/rosters/${rosterId}/publish`, {
    method: 'POST',
    cookie: managerCookie,
    body: {}
  });
  assert.equal(published.response.status, 200);
  assert.equal(published.payload.roster.status, 'published');
  const staffPublished = await request(rosterPath, { cookie: staffCookie });
  assert.equal(staffPublished.response.status, 200);
  const publishedStaffMember = staffPublished.payload.staff.find(member =>
    member.id === staffRegistration.payload.user.id
  );
  assert.ok(publishedStaffMember);
  assert.equal(staffPublished.payload.entries.find(entry =>
    entry.userId === staffRegistration.payload.user.id && entry.day === 1
  ).code, 'S');
  assert.equal(publishedStaffMember.isCurrentUser, true);

  const changeDraft = await request(`/api/rosters/${rosterId}/entries`, {
    method: 'PUT',
    cookie: managerCookie,
    body: { userId: staffRegistration.payload.user.id, day: 1, code: 'O' }
  });
  assert.equal(changeDraft.response.status, 200);
  assert.equal(changeDraft.payload.roster.status, 'draft');
  const stillPublished = await request(rosterPath, { cookie: staffCookie });
  assert.equal(stillPublished.payload.entries[0].code, 'S');
});
