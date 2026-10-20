const SH = {
  S: ['Straight', 8, '#3b82c4'],
  L: ['Late', 8, '#e0932b'],
  N: ['Night', 12, '#3f4fb5'],
  SD: ['Sleeping day', 0, '#b58bd9'],
  O: ['Off', 0, '#8d97a5'],
  C: ['Call', 8, '#0f9d8a'],
  PH: ['Public holiday', 8, '#d6455d'],
  LV: ['Leave', 8, '#5fa05a']
};
const LC = ['S', 'C', 'O', 'PH', 'LV'];
const NC = ['S', 'L', 'N', 'SD', 'O', 'PH', 'LV'];
const D = {
  Laboratory: { codes: LC, pat: ['S', 'S', 'S', 'S', 'S', 'O', 'O'], n: 5 },
  Clinical: { codes: LC, pat: ['S', 'S', 'S', 'O', 'C', 'C', 'C', 'O', 'O', 'O'], n: 8 },
  Nursing: { codes: NC, pat: ['S', 'S', 'L', 'L', 'O', 'N', 'N', 'N', 'SD', 'O', 'O', 'S'], n: 6 }
};
const wards = ['Surgical', 'Male', 'Female', 'Paediatric', 'HDU', 'Labour', 'Postnatal', 'Antenatal'];
const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PHD = { '0-1': 1, '0-15': 1, '2-3': 1, '4-1': 1, '4-14': 1, '6-6': 1, '9-15': 1, '11-25': 1, '11-26': 1 };
const T = new Date();
const DEMO_ME = 2;
const $ = selector => document.querySelector(selector);
let role = 'staff';
let userName = '';
let userId = null;
let mustChangePassword = false;
let screen = 'landing';
let startupError = '';
let passwordChangeRequested = false;
let tab = 'roster';
let dept = 'Laboratory';
let ward = 'Surgical';
let y = T.getFullYear();
let m = T.getMonth();
let span = innerWidth < 640 ? 'week' : 'month';
let w = Math.floor((T.getDate() - 1) / 7);
let sh = null;
const ov = {};
const pv = {};
const dirty = {};
const rosterStatus = {};
const rosterStaff = {};
let managerScopes = [];
let persistedRoster = null;
let rosterLoading = false;
let rosterError = '';
let rosterStaffOptions = [];
let adminAccounts = [];
let adminScopes = [];
let adminDataError = '';
let adminDataLoading = false;
let adminCredentialNotice = null;
let rid = 0;
const reqs = [];
const notes = [
  { role: 'staff', t: 'Your roster is ready to view', n: 1 },
  { role: 'manager', t: 'A staff member submitted a change request', n: 1 }
];

const esc = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const wk = value => dept === 'Nursing' ? value : '';
const rk = (dp = dept, wd = wk(ward), yy = y, mm = m) => `${dp}|${wd}|${yy}-${mm}`;
const entryKey = (dp, wd, yy, mm, row, day) => `${dp}|${wd}|${yy}-${mm}|${row}|${day}`;
const rosterMatches = (dp = dept, wd = wk(ward), yy = y, mm = m) => Boolean(persistedRoster &&
  persistedRoster.roster.department === dp &&
  (persistedRoster.roster.ward || '') === (wd || '') &&
  persistedRoster.roster.year === yy &&
  persistedRoster.roster.month === mm + 1);

function myRow() {
  return rosterMatches() ? persistedRoster.staff.findIndex(member => member.id === userId) : 0;
}

function base(dp, wd, yy, mm, row, day) {
  if (dp === 'Laboratory' && row === 4 && yy === 2026 && mm === 9 && day >= 5 && day <= 18) return 'LV';
  if (PHD[`${mm}-${day}`]) return 'PH';
  const pattern = D[dp].pat;
  return pattern[(day + row * 3 + (dp === 'Nursing' ? wards.indexOf(wd) * 2 : 0)) % pattern.length];
}

function code(dp, wd, yy, mm, row, day, source) {
  return source[entryKey(dp, wd, yy, mm, row, day)] || base(dp, wd, yy, mm, row, day);
}

function cur(row, day) {
  if (rosterMatches()) {
    const member = persistedRoster.staff[row];
    return member ? persistedRoster.entries.find(entry => entry.userId === member.id && entry.day === day)?.code || 'O' : 'O';
  }
  return code(dept, wk(ward), y, m, row, day, role === 'manager' ? ov : pv);
}

function dim(yy = y, mm = m) {
  return new Date(yy, mm + 1, 0).getDate();
}

function staffFor(dp = dept, wd = wk(ward)) {
  if (rosterMatches(dp, wd)) return persistedRoster.staff.map(member => member.username);
  const key = `${dp}|${wd}`;
  if (!rosterStaff[key]) rosterStaff[key] = Array.from({ length: D[dp].n }, (_, index) => `Staff ${String(index + 1).padStart(2, '0')}`);
  return rosterStaff[key];
}

function nm(row) {
  return staffFor()[row] || `Staff ${String(row + 1).padStart(2, '0')}`;
}

function fd(yy, mm, day) {
  return `${WD[new Date(yy, mm, day).getDay()]} ${day} ${MN[mm].slice(0, 3)}`;
}

function totals(row) {
  let hours = 0;
  let holidays = 0;
  for (let day = 1; day <= dim(); day++) {
    const shift = cur(row, day);
    hours += SH[shift][1];
    if (shift === 'PH') holidays++;
  }
  return { hours, holidays, owed: Math.round((hours - 160) / 8) };
}

function isPublished(key = rk()) {
  if (rosterMatches()) return persistedRoster.roster.status === 'published';
  return rosterStatus[key] !== 'draft';
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.hidden = true; }, 2600);
}

function push(targetRole, message) {
  notes.unshift({ role: targetRole, t: message, n: 1 });
  bell();
}

function bell() {
  const unread = notes.filter(note => note.role === role && note.n).length;
  $('#bell').innerHTML = `&#128276;${unread ? `<b>${unread}</b>` : ''}`;
}

function seedRequests() {
  const day = Math.min(14, dim());
  const managerFrom = base('Laboratory', '', y, m, 4, day);
  const staffFrom = base(dept, '', y, m, DEMO_ME, day);
  reqs.push({
    id: ++rid, who: 'Staff 05', r: 4, dept: 'Laboratory', wd: '',
    y, m, d: day, from: managerFrom,
    to: D.Laboratory.codes.find(codeValue => codeValue !== managerFrom),
    reason: 'Family event', status: 'pending', note: '', demo: true
  });
  reqs.push({
    id: ++rid, who: nm(DEMO_ME), r: DEMO_ME, dept, wd: '', y, m, d: day,
    from: staffFrom, to: D[dept].codes.find(codeValue => codeValue !== staffFrom),
    reason: 'I have an appointment and would appreciate a shift change.',
    status: 'pending', note: '', demo: true
  });
}

function landingView() {
  $('#session-controls').innerHTML = '<button class="pri landing-signin" data-a="show-login">Staff sign in</button>';
  $('#bell').hidden = true;
  $('#np').hidden = true;
  $('#nav').hidden = true;
  const startupNotice = startupError
    ? `<div class="auth-error startup-error" role="alert">${esc(startupError)}</div>`
    : '';
  $('#app').innerHTML = `
    <section class="landing-page">
      ${startupNotice}
      <div class="landing-hero">
        <div class="hero-copy">
          <span class="eyebrow">A CLEARER WAY TO PLAN EVERY SHIFT</span>
          <h2>One roster.<br><span>Your whole team in sync.</span></h2>
          <p>Hospital Duty Roster gives staff and managers one simple place to check schedules, prepare team rosters, and handle shift-change requests.</p>
          <div class="hero-actions">
            <button class="pri" data-a="show-login">Sign in to your roster <span aria-hidden="true">→</span></button>
            <a class="hero-secondary" href="#how-it-works">See how it works</a>
          </div>
          <div class="hero-trust"><span aria-hidden="true">✓</span> Designed for hospital teams <span class="trust-dot">·</span> Laboratory, Clinical and Nursing</div>
        </div>
        <div class="hero-preview" aria-label="Illustration of a weekly duty roster">
          <div class="preview-top"><span><i></i><i></i><i></i></span><b>TEAM ROSTER</b><span class="preview-month">THIS WEEK</span></div>
          <div class="preview-grid">
            <div class="preview-days"><span></span><span>MON</span><span>TUE</span><span>WED</span><span>THU</span></div>
            <div class="preview-row"><b>Staff 01</b><span class="preview-shift straight">S</span><span class="preview-shift straight">S</span><span class="preview-shift off">O</span><span class="preview-shift straight">S</span></div>
            <div class="preview-row"><b>Staff 02</b><span class="preview-shift late">L</span><span class="preview-shift late">L</span><span class="preview-shift night">N</span><span class="preview-shift night">N</span></div>
            <div class="preview-row"><b>Staff 03</b><span class="preview-shift call">C</span><span class="preview-shift off">O</span><span class="preview-shift straight">S</span><span class="preview-shift straight">S</span></div>
          </div>
          <div class="preview-footer"><span class="preview-live"></span> Published for your team <span>·</span> Easy to read on mobile</div>
        </div>
      </div>
      <div class="landing-section" id="how-it-works">
        <div class="landing-section-heading"><span class="eyebrow">MADE FOR EVERY ROLE</span><h2>Everything your team needs to stay coordinated.</h2></div>
        <div class="feature-grid">
          <article class="feature-card">
            <span class="feature-icon staff-icon" aria-hidden="true">✓</span>
            <h3>For staff</h3>
            <p>Check the latest published roster, see your upcoming shifts, and send a change request when plans change.</p>
            <span class="feature-link">View shifts · Request changes</span>
          </article>
          <article class="feature-card">
            <span class="feature-icon manager-icon" aria-hidden="true">▦</span>
            <h3>For roster managers</h3>
            <p>Organize staff by department or ward, edit a draft roster, review requests, and publish when it is ready.</p>
            <span class="feature-link">Prepare · Review · Publish</span>
          </article>
          <article class="feature-card">
            <span class="feature-icon team-icon" aria-hidden="true">↗</span>
            <h3>Clear for the whole team</h3>
            <p>Color-coded shifts, monthly totals, and request updates help everyone understand what is happening.</p>
            <span class="feature-link">One shared source of truth</span>
          </article>
        </div>
      </div>
      <div class="landing-bottom">
        <div><span class="eyebrow">READY WHEN YOU ARE</span><h2>Get to your roster in a few taps.</h2></div>
        <div class="hero-actions">
          <button class="pri" data-a="show-login">Continue to sign in <span aria-hidden="true">→</span></button>
          <button class="sec" data-a="show-admin-login">Administrator · Accounts &amp; Access</button>
        </div>
      </div>
      <footer class="landing-footer">Hospital Duty Roster <span>·</span> A simpler way for hospital teams to plan together</footer>
    </section>`;
}

function loginView({ administratorOnly = false } = {}) {
  $('#session-controls').innerHTML = '<button class="back-home" data-a="show-home">← Home</button>';
  $('#bell').hidden = true;
  $('#np').hidden = true;
  $('#nav').hidden = true;
  $('#app').innerHTML = `
    <section class="login-wrap">
      <div class="login-card">
        <span class="eyebrow">${administratorOnly ? 'ADMINISTRATOR PORTAL' : 'HOSPITAL STAFF PORTAL'}</span>
        <h2>${administratorOnly ? 'Administrator sign in' : 'Sign in to Duty Roster'}</h2>
        <p class="muted">${administratorOnly
          ? 'Sign in with your administrator employee ID to manage accounts and access.'
          : "View your published shifts or manage your department's roster."}</p>
        ${administratorOnly
          ? '<div class="demo-data-notice"><b>First-time setup:</b> Employee ID <code>ADMIN-001</code>, password <code>DutyRoster-Start1!</code>. This public initial password works only until it is changed; you will be prompted to choose your own password after signing in.</div>'
          : ''}
        <div id="auth-message" class="auth-error" role="alert" hidden></div>
        <form id="login-form">
          <label for="login-identifier">${administratorOnly ? 'Administrator employee ID' : 'Registration number (employee ID)'}</label>
          <input id="login-identifier" name="employeeId" type="text" autocomplete="username" required placeholder="Enter your employee ID">
          <label for="login-password">Password</label>
          <input id="login-password" name="password" type="password" autocomplete="current-password" required>
          <button class="pri login-submit" type="submit">Sign in</button>
        </form>
        <p class="login-hint">Forgot your password? Contact an administrator to issue a temporary password.</p>
        ${administratorOnly
          ? '<p class="login-hint"><button class="text-action" data-a="show-login">Go to staff sign in</button></p>'
          : '<p class="login-hint">New staff member? <button class="text-action" data-a="show-register">Create a staff account</button></p>'}
      </div>
    </section>`;
}

function registerView() {
  $('#session-controls').innerHTML = '<button class="back-home" data-a="show-home">← Home</button>';
  $('#bell').hidden = true;
  $('#np').hidden = true;
  $('#nav').hidden = true;
  $('#app').innerHTML = `
    <section class="login-wrap">
      <div class="login-card">
        <span class="eyebrow">STAFF ACCOUNT</span>
        <h2>Create your account</h2>
        <p class="muted">Create your staff account with your employee ID, username, department, and contact details.</p>
        <div id="auth-message" class="auth-error" role="alert" hidden></div>
        <form id="register-form">
          <label for="register-name">Username</label>
          <input id="register-name" name="username" autocomplete="username" minlength="3" maxlength="32" required placeholder="Choose a username">
          <label for="register-employee-id">Registration number (employee ID)</label>
          <input id="register-employee-id" name="employeeId" autocomplete="off" maxlength="32" required placeholder="Your employee ID">
          <label for="register-department">Department</label>
          <select id="register-department" name="department" required>
            <option value="">Choose your department</option>
            <option value="Laboratory">Laboratory</option>
            <option value="Clinical">Clinical</option>
            <option value="Nursing">Nursing</option>
          </select>
          <label for="register-email">Email address <span class="optional-label">or</span></label>
          <input id="register-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="name@hospital.org">
          <label for="register-phone">Phone number <span class="optional-label">or</span></label>
          <input id="register-phone" name="phone" type="tel" autocomplete="tel" maxlength="24" placeholder="+1 555 0100">
          <label for="register-contact">Other contact details <span class="optional-label">optional</span></label>
          <input id="register-contact" name="contactDetails" maxlength="250" placeholder="Extension or preferred contact time">
          <label for="register-password">Password</label>
          <input id="register-password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required>
          <label for="register-confirm">Confirm password</label>
          <input id="register-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required>
          <button class="pri login-submit" type="submit">Create staff account</button>
        </form>
        <p class="login-hint">Already registered? <button class="text-action" data-a="show-login">Sign in</button></p>
      </div>
    </section>`;
}

function passwordChangeView() {
  $('#bell').hidden = true;
  $('#np').hidden = true;
  $('#nav').hidden = true;
  $('#app').innerHTML = `
    <section class="login-wrap">
      <div class="login-card">
        <span class="eyebrow">SECURE YOUR ACCOUNT</span>
        <h2>${mustChangePassword ? 'Choose a new password' : 'Change your password'}</h2>
        <p class="muted">${mustChangePassword
          ? 'Your administrator issued a temporary password. Change it before continuing.'
          : 'Enter your current password and choose a new one.'}</p>
        ${adminCredentialNotice
          ? `<div class="demo-data-notice">Temporary password: <code>${esc(adminCredentialNotice.password)}</code></div>`
          : ''}
        <div id="auth-message" class="auth-error" role="alert" hidden></div>
        <form id="password-change-form">
          <label for="current-password">Temporary/current password</label>
          <input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required>
          <label for="new-password">New password</label>
          <input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required>
          <label for="confirm-new-password">Confirm new password</label>
          <input id="confirm-new-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required>
          <button class="pri login-submit" type="submit">Update password</button>
        </form>
        ${mustChangePassword
          ? '<p class="login-hint">Forgot your password? Contact an administrator to issue another temporary password.</p>'
          : '<p class="login-hint"><button class="text-action" data-a="cancel-password-change">Cancel</button></p>'}
      </div>
    </section>`;
}

function updateHeader() {
  $('#session-controls').innerHTML = `
    <span class="account-label"><b>${esc(userName)}</b><small>${role === 'manager' ? 'Roster manager' : role === 'admin' ? 'Administrator' : 'Staff member'}</small></span>
    ${role === 'manager' || role === 'admin' ? `<span class="demo-role">${role.toUpperCase()}</span>` : ''}
    ${role === 'admin' ? '<button class="sec" data-a="change-password">Change password</button>' : ''}
    <button class="sec signout" data-a="signout">Sign out</button>`;
  $('#bell').hidden = false;
  $('#nav').hidden = false;
}

function step(amount) {
  if (span === 'month') {
    m += amount;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    return;
  }
  w += amount;
  const weekCount = Math.ceil(dim() / 7);
  if (w < 0) {
    m--;
    if (m < 0) { m = 11; y--; }
    w = Math.ceil(dim() / 7) - 1;
  } else if (w >= weekCount) {
    m++;
    if (m > 11) { m = 0; y++; }
    w = 0;
  }
}

function roster() {
  if (rosterLoading) return '<div class="empty">Loading roster…</div>';
  if (rosterError) return `<div class="empty roster-unavailable"><h2>Roster unavailable</h2><p>${esc(rosterError)}</p></div>`;
  if (role === 'staff' && (!rosterMatches() || !isPublished())) {
    return `<div class="empty roster-unavailable"><h2>This roster is not published yet</h2><p>Your manager is preparing the ${esc(MN[m])} roster. You'll be able to view it here once it's published.</p><span class="badge">Not published</span></div>`;
  }
  if (role === 'manager' && (!rosterMatches() || !persistedRoster.roster)) {
    return '<div class="empty roster-unavailable"><h2>No roster is available</h2><p>Open a department or ward assigned to you to begin a roster draft.</p></div>';
  }
  const days = dim();
  const start = span === 'week' ? 1 + 7 * w : 1;
  const end = span === 'week' ? Math.min(days, start + 6) : days;
  const codes = D[dept].codes;
  const editable = role === 'manager';
  const staff = staffFor();
  if (role === 'staff' && myRow() < 0) {
    return '<div class="empty roster-unavailable"><h2>This roster is not available to your account</h2><p>Only staff included in a published roster can view it.</p></div>';
  }
  let html = '<tr><th class="nm">Name</th>';
  for (let day = start; day <= end; day++) {
    const weekday = new Date(y, m, day).getDay();
    const classes = `${weekday % 6 ? '' : 'we '}${PHD[`${m}-${day}`] ? 'ph ' : ''}${T.getFullYear() === y && T.getMonth() === m && T.getDate() === day ? 'td' : ''}`;
    html += `<th class="${classes}">${WD[weekday].slice(0, 3)}<b>${day}</b></th>`;
  }
  html += '<th>Hrs</th><th>PH</th><th>OW</th></tr>';
  for (let row = 0; row < staff.length; row++) {
    const sum = totals(row);
    html += `<tr class="${row === myRow() ? 'me' : ''}"><td class="nm">${esc(staff[row])}${role === 'staff' && row === myRow() ? ' (you)' : ''}</td>`;
    for (let day = start; day <= end; day++) {
      const shift = cur(row, day);
      html += `<td><button class="cl ${row === myRow() ? 'mine' : ''}" style="--c:${SH[shift][2]}" data-a="cell" data-r="${row}" data-d="${day}" data-ed="${editable ? 1 : 0}" aria-label="${esc(staff[row])}, ${fd(y, m, day)}, ${SH[shift][0]}">${shift}</button></td>`;
    }
    html += `<td class="t ${sum.hours < 160 ? 'low' : ''}">${sum.hours}</td><td class="t">${sum.holidays}</td><td class="t">${sum.owed > 0 ? '+' : ''}${sum.owed}</td></tr>`;
  }
  let warnings = '';
  if (editable) {
    const uncovered = [];
    for (let day = 1; day <= days; day++) {
      let onDuty = 0;
      for (let row = 0; row < staff.length; row++) if ('SLNC'.includes(cur(row, day))) onDuty++;
      if (!onDuty && !PHD[`${m}-${day}`]) uncovered.push(day);
    }
    warnings = uncovered.length
      ? `<div class="note bad"><b>${uncovered.length} day${uncovered.length > 1 ? 's' : ''} with nobody on duty:</b> ${uncovered.join(', ')}. Warnings do not block publishing.</div>`
      : '<div class="note">Every day has someone on duty.</div>';
  }
  const legend = codes.map(codeValue => `<span style="--c:${SH[codeValue][2]}"><i>${codeValue}</i>${SH[codeValue][0]}</span>`).join('');
  return `${warnings}<div class="gw"><table>${html}</table></div><div class="leg" aria-label="Legend">${legend}</div>
    <p class="roster-help">${editable ? 'Tap a shift to edit the draft.' : 'Tap one of your own shifts to request a change.'} Hrs target is 160. OW means owed days.</p>`;
}

function mine() {
  if (!rosterMatches() || !isPublished()) return roster();
  const row = myRow();
  if (row < 0) return '<div class="empty">Your account is not included in this published roster.</div>';
  const sum = totals(row);
  const rows = [];
  const firstDay = T.getFullYear() === y && T.getMonth() === m ? T.getDate() : 1;
  for (let day = firstDay; day <= dim() && rows.length < 7; day++) {
    const shift = cur(row, day);
    if (shift !== 'O' && shift !== 'SD') rows.push([day, shift]);
  }
  const cards = `<div class="cards">
    <div class="stat"><small>Hours this month</small><div>${sum.hours}</div></div>
    <div class="stat"><small>Public holidays</small><div>${sum.holidays}</div></div>
    <div class="stat"><small>Owed days</small><div>${sum.owed > 0 ? '+' : ''}${sum.owed}</div></div>
  </div><h3 class="t">Your next shifts</h3>`;
  return cards + (rows.length
    ? rows.map(([day, shift]) => `<div class="row"><div class="cl" style="--c:${SH[shift][2]};display:grid;place-items:center">${shift}</div>
      <div class="when"><b>${fd(y, m, day)}</b><small>${SH[shift][0]}</small></div>
      <button class="sec" data-a="cell" data-r="${row}" data-d="${day}">Request change</button></div>`).join('')
    : '<div class="empty">No shifts left this month. Use the arrows to check another month.</div>');
}

function requestView() {
  const manager = role === 'manager' || role === 'admin';
  const list = reqs.filter(request => manager || request.who === userName);
  if (!list.length) return '<div class="empty">No requests yet. Tap one of your shifts in Roster to ask for a change.</div>';
  return list.slice().reverse().map(request => `
    <article class="rq">
      <div class="request-heading">
        <div><b>${manager ? `${esc(request.who)} · ` : ''}${fd(request.y, request.m, request.d)}</b>
          <small>${esc(request.dept)}${request.wd ? ` / ${esc(request.wd)}` : ''}</small></div>
        <span class="st ${request.status}">${request.status[0].toUpperCase()}${request.status.slice(1)}</span>
      </div>
      <div class="request-shifts">
        <span class="shift-pill" style="--c:${SH[request.from][2]}"><i>${request.from}</i>${SH[request.from][0]}</span>
        <span class="request-arrow" aria-label="requested instead of">→</span>
        <span class="shift-pill" style="--c:${SH[request.to][2]}"><i>${request.to}</i>${SH[request.to][0]}</span>
      </div>
      <p class="request-reason"><b>Reason:</b> ${esc(request.reason || 'No reason given')}</p>
      ${request.note ? `<p class="manager-note"><b>Manager note:</b> ${esc(request.note)}</p>` : ''}
      ${manager && request.status === 'pending' ? `<label class="sr-only" for="n${request.id}">Optional note to ${esc(request.who)}</label>
        <input id="n${request.id}" class="request-note" placeholder="Add a note for staff (optional)">
        <div class="act"><button class="sec" data-a="decline" data-v="${request.id}">Decline</button>
          <button class="pri" data-a="approve" data-v="${request.id}">Approve</button></div>` : ''}
    </article>`).join('');
}

function managerOverview() {
  const pending = reqs.filter(request => request.status === 'pending').length;
  const departmentCards = managerScopes.map(scope => {
    const name = scope.department;
    const wardName = scope.ward || '';
    return `<article class="overview-card">
      <div class="overview-card-top"><div><span class="eyebrow">${wardName ? 'DEPARTMENT · WARD' : 'DEPARTMENT'}</span>
        <h3>${name}${name === 'Nursing' ? ` · ${esc(wardName)}` : ''}</h3></div>
        <span class="badge">Assigned</span></div>
      <p>Manage the ${MN[m]} ${y} roster for this scope.</p>
      <button class="sec" data-a="open-roster" data-v="${name}" data-ward="${esc(wardName)}">Open roster</button>
    </article>`;
  }).join('');
  return `<section class="dashboard">
    <div class="dashboard-heading"><div><span class="eyebrow">MANAGER WORKSPACE</span><h2>Roster overview</h2>
      <p class="muted">Prepare, review and publish rosters for your teams.</p></div>
      ${managerScopes.length ? `<button class="pri" data-a="open-roster" data-v="${esc(managerScopes[0].department)}" data-ward="${esc(managerScopes[0].ward || '')}">Open a roster</button>` : ''}</div>
    <div class="cards overview-stats">
      <div class="stat"><small>Teams to manage</small><div>${Object.keys(D).length}</div></div>
      <div class="stat"><small>Pending requests</small><div>${pending}</div></div>
      <div class="stat"><small>Current month</small><div class="stat-month">${MN[m].slice(0, 3)} ${y}</div></div>
    </div>
    <div class="section-heading"><h3>Your rosters</h3><span class="muted">Select a roster to edit staff and shifts.</span></div>
    ${managerScopes.length
      ? `<div class="overview-grid">${departmentCards}</div>`
      : '<div class="empty">No department or ward has been assigned to your manager account yet. Ask an administrator to assign your roster scope.</div>'}
    <div class="manager-shortcuts"><button class="sec" data-a="tab" data-v="reqs">Review change requests${pending ? ` (${pending})` : ''}</button></div>
  </section>`;
}

function adminPanel() {
  if (adminDataLoading) {
    return '<section class="admin-page"><p class="muted">Loading accounts and manager assignments…</p></section>';
  }
  if (adminDataError) {
    return `<section class="admin-page"><div class="auth-error" role="alert">${esc(adminDataError)}</div>
      <button class="pri" data-a="reload-admin">Try again</button></section>`;
  }
  const accounts = adminAccounts.map(account => {
    const assignments = adminScopes
      .filter(scope => scope.manager_id === account.id)
      .map(scope => `${scope.department}${scope.ward ? ` · ${scope.ward}` : ''}`);
    const contact = [account.email, account.phone, account.contactDetails]
      .filter(Boolean).map(esc).join('<br>') || '<span class="muted">No contact details</span>';
    const roleControl = account.role === 'admin'
      ? '<span class="badge">Administrator</span>'
      : `<div class="account-role-control">
          <select id="role-${account.id}" aria-label="Role for ${esc(account.username)}">
            <option value="staff" ${account.role === 'staff' ? 'selected' : ''}>Staff</option>
            <option value="manager" ${account.role === 'manager' ? 'selected' : ''}>Manager</option>
          </select>
          <button class="sec" data-a="save-role" data-v="${account.id}">Save role</button>
        </div>`;
    return `<tr>
      <td><b>${esc(account.employeeId || 'Not set')}</b><br><span class="muted">${esc(account.username)}</span>
        <button class="sec account-reset" data-a="edit-account" data-v="${account.id}">Edit account details</button></td>
      <td>${esc(account.department || 'Not set')}</td>
      <td>${contact}</td>
      <td>${roleControl}<button class="sec account-reset" data-a="reset-password" data-v="${account.id}">Issue temporary password</button></td>
      <td>${assignments.length ? assignments.map(esc).join('<br>') : '<span class="muted">Not assigned</span>'}</td>
    </tr>`;
  }).join('');
  const managers = adminAccounts.filter(account => account.role === 'manager');
  const scopes = adminScopes.map(scope => {
    const manager = adminAccounts.find(account => account.id === scope.manager_id);
    return `<div class="scope-row"><span><b>${esc(manager ? manager.username : 'Unknown manager')}</b>
      <small>${esc(scope.department)}${scope.ward ? ` · ${esc(scope.ward)} ward` : ' · Department-wide'}</small></span>
      <button class="icon-action remove" data-a="remove-scope" data-v="${scope.id}">Remove</button></div>`;
  }).join('');
  const credentialNotice = adminCredentialNotice
    ? `<div class="auth-error credential-notice" role="status">
        <b>Temporary password for ${esc(adminCredentialNotice.username)} (${esc(adminCredentialNotice.employeeId)}):</b>
        <code>${esc(adminCredentialNotice.password)}</code>
        <p>Share it directly with this account holder. They must change it after their first sign-in. This password will not be shown again.</p>
        <button class="sec" data-a="dismiss-credential">Dismiss</button>
      </div>`
    : '';
  return `<section class="admin-page">
    <div class="admin-heading"><div><span class="eyebrow">ADMINISTRATOR WORKSPACE</span>
      <h2>Accounts &amp; manager access</h2>
      <p class="muted">Set account roles and assign managers to the teams they oversee.</p></div>
      <span class="badge">${adminAccounts.length} account${adminAccounts.length === 1 ? '' : 's'}</span></div>
    <div class="admin-grid">
      <section class="admin-card">
        <h3>Create administrator or manager</h3>
        <p>New elevated accounts receive a one-time password that they must change at first sign-in.</p>
        <div id="admin-create-message" class="auth-error" role="alert" hidden></div>
        <form id="elevated-account-form">
          <label for="new-account-role">Account role</label>
          <select id="new-account-role" name="role" required>
            <option value="manager">Manager</option>
            <option value="admin">Administrator</option>
          </select>
          <label for="new-account-id">Registration number (employee ID)</label>
          <input id="new-account-id" name="employeeId" required maxlength="32" placeholder="Employee ID">
          <label for="new-account-username">Username</label>
          <input id="new-account-username" name="username" required minlength="3" maxlength="32" placeholder="Choose a username">
          <label for="new-account-department">Department</label>
          <select id="new-account-department" name="department" required>
            <option value="Laboratory">Laboratory</option>
            <option value="Clinical">Clinical</option>
            <option value="Nursing">Nursing</option>
          </select>
          <button class="pri scope-submit" type="submit">Create account</button>
        </form>
        ${credentialNotice}
      </section>
      <section class="admin-card">
        <h3>Manager assignments</h3>
        <p>Managers can only be assigned to a department or a specific Nursing ward.</p>
        <form id="manager-scope-form">
          <label for="scope-manager">Manager</label>
          <select id="scope-manager" name="managerId" required>
            <option value="">Choose a manager</option>
            ${managers.map(manager => `<option value="${manager.id}">${esc(manager.username)}</option>`).join('')}
          </select>
          <label for="scope-department">Department</label>
          <select id="scope-department" name="department" required>
            <option value="Laboratory">Laboratory</option>
            <option value="Clinical">Clinical</option>
            <option value="Nursing">Nursing</option>
          </select>
          <label for="scope-ward">Nursing ward <span class="optional-label">required for Nursing</span></label>
          <select id="scope-ward" name="ward" disabled>
            <option value="">Department-wide / not applicable</option>
            ${wards.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
          </select>
          <button class="pri scope-submit" type="submit" ${managers.length ? '' : 'disabled'}>Assign manager</button>
        </form>
        <h4 class="scope-list-heading">Current assignments</h4>
        ${scopes || '<div class="empty">No managers have team assignments yet.</div>'}
      </section>
      <section class="admin-card account-card">
        <h3>Accounts</h3>
        <p>Review staff and elevated accounts by employee ID, username, department, and contact details.</p>
        ${adminAccounts.length ? `<div class="account-table-wrap"><table class="account-table">
          <thead><tr><th>Employee ID / username</th><th>Department</th><th>Contact</th><th>Role / reset</th><th>Assigned teams</th></tr></thead>
          <tbody>${accounts}</tbody>
        </table></div>` : '<div class="empty">No accounts yet.</div>'}
      </section>
    </div>
    <aside class="demo-data-notice"><b>Note:</b> Accounts, manager assignments and roster data are saved in the database. Change requests are still preview data.</aside>
  </section>`;
}

async function loadAdminData() {
  adminDataLoading = true;
  adminDataError = '';
  render();
  try {
    const result = await apiRequest('/api/admin/accounts');
    adminAccounts = result.accounts;
    adminScopes = result.scopes;
  } catch (error) {
    adminDataError = error.message;
  } finally {
    adminDataLoading = false;
    render();
  }
}

async function saveAccountRole(accountId) {
  const roleSelect = $(`#role-${accountId}`);
  await apiRequest(`/api/admin/accounts/${accountId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role: roleSelect.value })
  });
  toast('Account role updated.');
  await loadAdminData();
}

async function createElevatedAccount(form) {
  const values = new FormData(form);
  const result = await apiRequest('/api/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: values.get('employeeId'),
      username: values.get('username'),
      department: values.get('department'),
      role: values.get('role')
    })
  });
  adminCredentialNotice = {
    employeeId: result.account.employeeId,
    username: result.account.username,
    password: result.temporaryPassword
  };
  form.reset();
  await loadAdminData();
}

async function resetAccountPassword(accountId) {
  const account = adminAccounts.find(item => item.id === accountId);
  const result = await apiRequest(`/api/admin/accounts/${accountId}/reset-password`, {
    method: 'POST',
    body: '{}'
  });
  adminCredentialNotice = {
    employeeId: account ? account.employeeId : 'Unknown ID',
    username: account ? account.username : 'account',
    password: result.temporaryPassword
  };
  if (accountId === userId) {
    mustChangePassword = true;
    render();
    return;
  }
  await loadAdminData();
}

async function saveAccountProfile(form) {
  const values = new FormData(form);
  const accountId = Number(form.dataset.accountId);
  const result = await apiRequest(`/api/admin/accounts/${accountId}/profile`, {
    method: 'PATCH',
    body: JSON.stringify({
      username: values.get('username'),
      employeeId: values.get('employeeId'),
      department: values.get('department')
    })
  });
  if (accountId === userId) userName = result.account.username;
  sh = null;
  sheet();
  toast('Account details updated.');
  await loadAdminData();
}

async function assignManager(form) {
  const values = new FormData(form);
  await apiRequest('/api/admin/manager-scopes', {
    method: 'POST',
    body: JSON.stringify({
      managerId: values.get('managerId'),
      department: values.get('department'),
      ward: values.get('ward')
    })
  });
  toast('Manager assignment saved.');
  await loadAdminData();
}

function render() {
  if (!userName) {
    if (screen === 'login') loginView();
    else if (screen === 'admin-login') loginView({ administratorOnly: true });
    else if (screen === 'register') registerView();
    else landingView();
    return;
  }
  updateHeader();
  bell();
  if (mustChangePassword || passwordChangeRequested) {
    passwordChangeView();
    return;
  }
  const manager = role === 'manager' || role === 'admin';
  const pending = reqs.filter(request => request.status === 'pending').length;
  const tabs = role === 'admin'
    ? [['accounts', 'Accounts & access']]
    : manager
    ? [['overview', 'Overview'], ['roster', 'Roster'], ['reqs', `Requests${pending ? ` · ${pending}` : ''}`]]
    : [['roster', 'Roster'], ['mine', 'My shifts'], ['reqs', 'My requests']];
  $('#nav').innerHTML = tabs.map(([key, label]) =>
    `<button data-a="tab" data-v="${key}" aria-pressed="${tab === key}">${label}</button>`).join('');
  if (role === 'admin') {
    $('#app').innerHTML = adminPanel();
    return;
  }
  if (tab === 'overview' && manager) {
    $('#app').innerHTML = demoDataNotice() + managerOverview();
    return;
  }
  if (tab !== 'reqs') {
    const departments = role === 'manager'
      ? [...new Set(managerScopes.map(scope => scope.department))]
      : Object.keys(D);
    let html = `<div class="tabs" role="group" aria-label="Department">${departments.map(name =>
      `<button data-a="dept" data-v="${name}" aria-pressed="${dept === name}">${name}</button>`).join('')}</div>`;
    const availableWards = role === 'manager'
      ? managerScopes.filter(scope => scope.department === 'Nursing').map(scope => scope.ward)
      : wards;
    if (dept === 'Nursing') html += `<div class="tabs w" role="group" aria-label="Ward">${availableWards.map(name =>
      `<button data-a="ward" data-v="${name}" aria-pressed="${ward === name}">${name}</button>`).join('')}
      </div>`;
    const title = span === 'week'
      ? `${MN[m].slice(0, 3)} ${1 + 7 * w}-${Math.min(dim(), 7 + 7 * w)}, ${y}`
      : `${MN[m]} ${y}`;
    const rosterReady = Boolean(rosterMatches() && persistedRoster.roster);
    const status = rosterReady ? (isPublished() ? 'Published' : 'Draft changes') : 'Loading';
    html += `<div class="bar">
      <button class="ar" data-a="prev" aria-label="Previous">&#8249;</button><h2>${title}</h2>
      <button class="ar" data-a="next" aria-label="Next">&#8250;</button>
      <span class="sp">${manager && rosterReady ? `<span class="badge ${status === 'Published' ? '' : 'd'}">${status}</span>
        <button class="sec roster-tool" data-a="manage-staff">Manage staff</button>
        ${status !== 'Published' ? '<button class="pri" data-a="confirm-publish">Publish roster</button>' : ''}` : ''}
        <div class="seg"><button data-a="span" data-v="week" aria-pressed="${span === 'week'}">Week</button>
          <button data-a="span" data-v="month" aria-pressed="${span === 'month'}">Month</button></div></span></div>`;
    $('#app').innerHTML = (tab === 'roster' ? html + roster() : demoDataNotice() + html + mine());
    return;
  }
  $('#app').innerHTML = `${demoDataNotice()}<section class="requests-page"><span class="eyebrow">${manager ? 'TEAM INBOX' : 'YOUR ACTIVITY'}</span>
    <h2>${manager ? 'Change requests' : 'My change requests'}</h2>
    <p class="muted">${manager ? 'Review requests from staff in your teams.' : 'Track each request and any note from your manager.'}</p>
    ${requestView()}</section>`;
}

function demoDataNotice() {
  return `<aside class="demo-data-notice"><b>Roster and staff assignments are saved.</b> Change requests are still a preview and are not saved to the server.</aside>`;
}

function openSheet(type, options = {}) {
  sh = { type, ...options };
  sheet();
}

function sheet() {
  const overlay = $('#ov');
  if (!sh) { overlay.innerHTML = ''; return; }
  if (sh.type === 'account-profile') {
    const account = adminAccounts.find(item => item.id === sh.accountId);
    if (!account) {
      sh = null;
      overlay.innerHTML = '';
      return;
    }
    overlay.innerHTML = `<div class="bk" data-a="close"><div class="panel">
      <h3>Account details</h3><p>${esc(account.username)} · ${esc(account.role)}</p>
      <div id="account-profile-message" class="auth-error" role="alert" hidden></div>
      <form id="account-profile-form" data-account-id="${account.id}">
        <label for="profile-username">Username</label>
        <input id="profile-username" name="username" value="${esc(account.username)}" required minlength="3" maxlength="32" autocomplete="username">
        <label for="profile-employee-id">Registration number (employee ID)</label>
        <input id="profile-employee-id" name="employeeId" value="${esc(account.employeeId || '')}" required maxlength="32">
        <label for="profile-department">Department</label>
        <select id="profile-department" name="department" required>
          ${['Laboratory', 'Clinical', 'Nursing'].map(name =>
            `<option value="${name}" ${account.department === name ? 'selected' : ''}>${name}</option>`).join('')}
        </select>
        <div class="act"><button type="button" class="sec" data-a="close">Cancel</button>
          <button class="pri" type="submit">Save account details</button></div>
      </form>
    </div></div>`;
    return;
  }
  if (sh.type === 'ward') {
    overlay.innerHTML = `<div class="bk" data-a="close"><div class="panel">
      <h3>Add a ward</h3><p>A nursing ward has its own staff list and roster.</p>
      <label for="wn">Ward name</label><input id="wn" placeholder="For example, Oncology" maxlength="40">
      <div class="act"><button class="sec" data-a="close">Cancel</button><button class="pri" data-a="saveward">Add ward</button></div>
    </div></div>`;
    $('#wn').focus();
    return;
  }
  if (sh.type === 'staff') {
    const list = persistedRoster.staff;
    overlay.innerHTML = `<div class="bk" data-a="close"><div class="panel panel-wide">
      <h3>Manage roster staff</h3><p>${esc(dept)}${dept === 'Nursing' ? ` · ${esc(ward)} ward` : ''}. Staff are shown in this order on the roster.</p>
      <div class="staff-list">${list.map((member, index) => `<div class="staff-item"><span class="staff-order">${index + 1}</span>
        <b>${esc(member.username)}</b><div class="staff-actions">
          <button class="icon-action" data-a="move-staff" data-v="${member.id}" data-dir="-1" aria-label="Move ${esc(member.username)} up" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-action" data-a="move-staff" data-v="${member.id}" data-dir="1" aria-label="Move ${esc(member.username)} down" ${index === list.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-action remove" data-a="remove-staff" data-v="${member.id}" aria-label="Remove ${esc(member.username)}">Remove</button>
        </div></div>`).join('')}</div>
      <label for="new-staff">Add a registered staff member</label><div class="add-staff-row"><select id="new-staff" ${rosterStaffOptions.length ? '' : 'disabled'}>
        <option value="">${rosterStaffOptions.length ? 'Select a staff account' : 'No eligible staff accounts available'}</option>
        ${rosterStaffOptions.map(member => `<option value="${member.id}">${esc(member.username)}</option>`).join('')}
      </select>
        <button class="sec" data-a="add-staff">Add</button></div>
      <div class="act"><button class="pri" data-a="close">Done</button></div>
    </div></div>`;
    return;
  }
  if (sh.type === 'publish') {
    const count = persistedRoster.entries.length;
    overlay.innerHTML = `<div class="bk" data-a="close"><div class="panel">
      <h3>Publish ${esc(dept)} roster?</h3>
      <p>Staff will be able to view this roster as soon as it is published. You can continue editing it later.</p>
      <div class="publish-summary"><b>${esc(MN[m])} ${y}</b><span>${staffFor().length} staff · ${count} edited shift${count === 1 ? '' : 's'}</span>
        <span class="badge">Warnings do not block publishing</span></div>
      <div class="act"><button class="sec" data-a="close">Keep as draft</button><button class="pri" data-a="publish">Publish roster</button></div>
    </div></div>`;
    return;
  }
  const shift = cur(sh.r, sh.d);
  const codes = D[dept].codes;
  overlay.innerHTML = `<div class="bk" data-a="close"><div class="panel">
    <h3>${role === 'manager' ? esc(nm(sh.r)) : 'Ask for a change'}</h3>
    <p>${fd(y, m, sh.d)}. Current shift: ${SH[shift][0]} (${shift})</p>
    <div class="pk">${codes.map(value => `<button style="--c:${SH[value][2]}" data-a="pick" data-v="${value}" aria-pressed="${(sh.to || shift) === value}">
      <i>${value}</i><span>${SH[value][0]}<small>${SH[value][1]} hrs</small></span></button>`).join('')}</div>
    ${role === 'staff' ? '<label for="why">Reason for your request</label><textarea id="why" rows="2" maxlength="240" placeholder="Briefly explain why you need this change"></textarea>' : ''}
    <div class="act"><button class="sec" data-a="close">Cancel</button>
      <button class="pri" data-a="${role === 'manager' ? 'save' : 'send'}">${role === 'manager' ? 'Save draft shift' : 'Send request'}</button></div>
  </div></div>`;
}

function showAuthError(message) {
  const element = $('#auth-message');
  if (element) {
    element.textContent = message;
    element.hidden = false;
  } else {
    toast(message);
  }
}

async function apiRequest(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers }
    });
  } catch {
    throw new Error('Could not reach the roster server. Start it with npm start, then open http://localhost:3000.');
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The server returned an invalid response. Please try again.');
  }
  if (!response.ok) {
    const error = new Error(payload.error || 'The server could not complete the request.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function rosterUrl(scope = { department: dept, ward, year: y, month: m }) {
  const wardQuery = scope.department === 'Nursing' ? `?ward=${encodeURIComponent(scope.ward)}` : '';
  return `/api/rosters/${encodeURIComponent(scope.department)}/${scope.year}/${scope.month + 1}${wardQuery}`;
}

async function loadManagerScopes() {
  const result = await apiRequest('/api/roster-scopes');
  managerScopes = result.scopes;
  if (managerScopes.length && !managerScopes.some(scope =>
    scope.department === dept && (scope.ward || '') === (dept === 'Nursing' ? ward : ''))) {
    dept = managerScopes[0].department;
    if (dept === 'Nursing') ward = managerScopes[0].ward;
  }
}

async function loadRoster() {
  if (!userId || !['manager', 'staff'].includes(role)) return;
  rosterLoading = true;
  rosterError = '';
  persistedRoster = null;
  rosterStaffOptions = [];
  render();
  try {
    if (role === 'manager' && !managerScopes.some(scope =>
      scope.department === dept && (scope.ward || '') === (dept === 'Nursing' ? ward : ''))) {
      throw new Error('You do not have a manager assignment for this department or ward.');
    }
    const url = rosterUrl();
    let result = await apiRequest(url);
    if (role === 'manager' && !result.roster) {
      result = await apiRequest('/api/rosters', {
        method: 'POST',
        body: JSON.stringify({ department: dept, ward: dept === 'Nursing' ? ward : null, year: y, month: m + 1 })
      });
    }
    persistedRoster = result;
    if (role === 'manager' && result.roster) {
      rosterStaffOptions = (await apiRequest(`/api/rosters/${result.roster.id}/staff-options`)).staff;
    }
  } catch (error) {
    if (!(role === 'staff' && error.status === 404)) rosterError = error.message;
  } finally {
    rosterLoading = false;
    render();
  }
}

function copyToNextMonth() {
  const source = { dp: dept, wd: wk(ward), yy: y, mm: m };
  const sourceValues = {};
  const staff = staffFor(source.dp, source.wd);
  for (let row = 0; row < staff.length; row++) {
    for (let day = 1; day <= dim(source.yy, source.mm); day++) {
      sourceValues[entryKey(source.dp, source.wd, source.yy, source.mm, row, day)] =
        code(source.dp, source.wd, source.yy, source.mm, row, day, ov);
    }
  }
  step(1);
  const targetKey = rk();
  rosterStatus[targetKey] = 'draft';
  dirty[targetKey] = 1;
  for (let row = 0; row < staff.length; row++) {
    for (let day = 1; day <= dim(); day++) {
      ov[entryKey(dept, wk(ward), y, m, row, day)] =
        sourceValues[entryKey(source.dp, source.wd, source.yy, source.mm, row, day)] ||
        base(dept, wk(ward), y, m, row, day);
    }
  }
  tab = 'roster';
  toast(`Copied roster as a draft for ${MN[m]}`);
}

async function handleClick(event) {
  const target = event.target.closest('[data-a]');
  if (!target) {
    if (!event.target.closest('#np')) $('#np').hidden = true;
    return;
  }
  const action = target.dataset.a;
  if (action === 'close' && target.classList.contains('bk') && event.target !== target) return;
  if (action === 'change-password') { passwordChangeRequested = true; render(); return; }
  if (action === 'cancel-password-change') { passwordChangeRequested = false; render(); return; }
  const value = target.dataset.v;
  if (action !== 'bell' && !event.target.closest('#np')) $('#np').hidden = true;

  if (action === 'signout') {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', body: '{}' });
    } catch (error) {
      showAuthError(error.message);
      return;
    }
    userName = '';
    userId = null;
    mustChangePassword = false;
    passwordChangeRequested = false;
    persistedRoster = null;
    managerScopes = [];
    rosterStaffOptions = [];
    rosterError = '';
    adminCredentialNotice = null;
    screen = 'landing';
    sh = null;
    $('#ov').innerHTML = '';
    render();
    return;
  }
  if (action === 'show-login') { screen = 'login'; render(); return; }
  if (action === 'show-admin-login') { screen = 'admin-login'; render(); return; }
  if (action === 'show-register') { screen = 'register'; render(); return; }
  if (action === 'show-home') { screen = 'landing'; render(); return; }
  if (action === 'tab') {
    tab = value;
    if (role === 'admin' && value === 'accounts') { await loadAdminData(); return; }
    if (role !== 'admin' && value === 'roster') { await loadRoster(); return; }
  }
  else if (action === 'reload-admin') { await loadAdminData(); return; }
  else if (action === 'edit-account') { openSheet('account-profile', { accountId: Number(value) }); return; }
  else if (action === 'save-role') {
    try { await saveAccountRole(Number(value)); }
    catch (error) { showAuthError(error.message); }
    return;
  } else if (action === 'reset-password') {
    try { await resetAccountPassword(Number(value)); }
    catch (error) { showAuthError(error.message); }
    return;
  } else if (action === 'dismiss-credential') {
    adminCredentialNotice = null;
    render();
    return;
  } else if (action === 'remove-scope') {
    try {
      await apiRequest(`/api/admin/manager-scopes/${value}`, { method: 'DELETE' });
      toast('Manager assignment removed.');
      await loadAdminData();
    } catch (error) { showAuthError(error.message); }
    return;
  }
  else if (action === 'dept') {
    dept = value;
    if (dept === 'Nursing') {
      const scope = role === 'manager'
        ? managerScopes.find(item => item.department === 'Nursing')
        : null;
      ward = scope ? scope.ward : wards[0];
    }
    if (role === 'manager' && dept !== 'Nursing') ward = '';
    await loadRoster();
    return;
  }
  else if (action === 'ward') { ward = value; await loadRoster(); return; }
  else if (action === 'prev') { step(-1); await loadRoster(); return; }
  else if (action === 'next') { step(1); await loadRoster(); return; }
  else if (action === 'span') { span = value; w = Math.min(w, Math.ceil(dim() / 7) - 1); }
  else if (action === 'bell') {
    const panel = $('#np');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      const list = notes.filter(note => note.role === role);
      panel.innerHTML = '<h3>Notifications</h3>' +
        (list.length ? list.map(note => `<p class="${note.n ? 'new' : ''}">${esc(note.t)}</p>`).join('') : '<p>Nothing new.</p>');
      list.forEach(note => { note.n = 0; });
      bell();
    }
    return;
  } else if (action === 'cell') {
    const row = Number(target.dataset.r);
    const day = Number(target.dataset.d);
    if (role === 'staff' && row !== myRow()) { toast('You can only request a change to your own shifts.'); return; }
    openSheet('cell', { r: row, d: day, to: null });
    return;
  } else if (action === 'pick') { sh.to = value; sheet(); return; }
  else if (action === 'close') { sh = null; sheet(); render(); return; }
  else if (action === 'save') {
    if (sh.to) {
      const member = persistedRoster.staff[sh.r];
      persistedRoster = await apiRequest(`/api/rosters/${persistedRoster.roster.id}/entries`, {
        method: 'PUT',
        body: JSON.stringify({ userId: member.id, day: sh.d, code: sh.to })
      });
    }
    sh = null; sheet(); render(); toast('Shift saved to the roster draft.');
  } else if (action === 'confirm-publish') { openSheet('publish'); return; }
  else if (action === 'publish') {
    persistedRoster = await apiRequest(`/api/rosters/${persistedRoster.roster.id}/publish`, {
      method: 'POST',
      body: '{}'
    });
    sh = null; sheet(); render(); toast('Roster published. Staff can now view it.');
  } else if (action === 'send') {
    const current = cur(sh.r, sh.d);
    const requested = sh.to || current;
    if (requested === current) { toast('Choose a different shift before sending.'); return; }
    reqs.push({
      id: ++rid, who: userName, r: myRow(), dept, wd: wk(ward), y, m, d: sh.d,
      from: current, to: requested, reason: ($('#why').value || '').trim(), status: 'pending', note: ''
    });
    push('manager', `${userName} requested a shift change for ${fd(y, m, sh.d)}.`);
    sh = null; sheet(); tab = 'reqs'; toast('Request sent to your roster manager.');
  } else if (action === 'approve' || action === 'decline') {
    const request = reqs.find(item => item.id === Number(value));
    if (!request || request.status !== 'pending') { toast('This request is no longer pending.'); return; }
    const noteInput = $(`#n${value}`);
    request.note = noteInput ? noteInput.value.trim() : '';
    request.status = action === 'approve' ? 'approved' : 'declined';
    if (action === 'approve') {
      const key = entryKey(request.dept, request.wd, request.y, request.m, request.r, request.d);
      ov[key] = pv[key] = request.to;
      rosterStatus[rk(request.dept, request.wd, request.y, request.m)] = 'published';
    }
    push('staff', `Your request for ${fd(request.y, request.m, request.d)} was ${request.status}.`);
    toast(action === 'approve' ? 'Approved. The published roster has been updated.' : 'Declined. Your note has been sent.');
  } else if (action === 'addward') { openSheet('ward'); return; }
  else if (action === 'saveward') {
    const name = $('#wn').value.trim();
    if (!name) { toast('Enter a ward name.'); $('#wn').focus(); return; }
    if (wards.some(existing => existing.toLowerCase() === name.toLowerCase())) { toast('That ward already exists.'); return; }
    wards.push(name); ward = name; sh = null; sheet(); toast('Ward added to this demo.');
  } else if (action === 'manage-staff') { openSheet('staff'); return; }
  else if (action === 'add-staff') {
    const input = $('#new-staff');
    const userIdToAdd = Number(input.value);
    if (!Number.isSafeInteger(userIdToAdd) || userIdToAdd < 1) { toast('Select a staff account to add.'); input.focus(); return; }
    persistedRoster = await apiRequest(`/api/rosters/${persistedRoster.roster.id}/staff`, {
      method: 'POST',
      body: JSON.stringify({ userId: userIdToAdd })
    });
    rosterStaffOptions = (await apiRequest(`/api/rosters/${persistedRoster.roster.id}/staff-options`)).staff;
    sheet(); toast('Staff member added to the roster draft.');
  } else if (action === 'remove-staff') {
    persistedRoster = await apiRequest(`/api/rosters/${persistedRoster.roster.id}/staff/${value}`, { method: 'DELETE' });
    rosterStaffOptions = (await apiRequest(`/api/rosters/${persistedRoster.roster.id}/staff-options`)).staff;
    sheet(); toast('Staff list updated in the draft.');
  } else if (action === 'move-staff') {
    const list = persistedRoster.staff.map(member => member.id);
    const index = list.indexOf(Number(value));
    const next = index + Number(target.dataset.dir);
    if (index >= 0 && next >= 0 && next < list.length) {
      [list[index], list[next]] = [list[next], list[index]];
      persistedRoster = await apiRequest(`/api/rosters/${persistedRoster.roster.id}/staff/order`, {
        method: 'PUT',
        body: JSON.stringify({ userIds: list })
      });
    }
    sheet();
  } else if (action === 'copy-next') copyToNextMonth();
  else if (action === 'open-roster') {
    dept = value;
    ward = dept === 'Nursing' ? target.dataset.ward : '';
    tab = 'roster';
    await loadRoster();
    return;
  }
  render();
}

document.addEventListener('submit', async event => {
  if (event.target.id === 'account-profile-form') {
    event.preventDefault();
    const button = event.target.querySelector('[type="submit"]');
    button.disabled = true;
    try { await saveAccountProfile(event.target); }
    catch (error) {
      const message = $('#account-profile-message');
      message.textContent = error.message;
      message.hidden = false;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
    return;
  }
  if (event.target.id === 'manager-scope-form') {
    event.preventDefault();
    const button = event.target.querySelector('[type="submit"]');
    button.disabled = true;
    try { await assignManager(event.target); }
    catch (error) { showAuthError(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
    return;
  }
  if (event.target.id === 'elevated-account-form') {
    event.preventDefault();
    const button = event.target.querySelector('[type="submit"]');
    button.disabled = true;
    const message = $('#admin-create-message');
    try {
      message.hidden = true;
      await createElevatedAccount(event.target);
    } catch (error) {
      message.textContent = error.message;
      message.hidden = false;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
    return;
  }
  if (!['login-form', 'register-form', 'password-change-form'].includes(event.target.id)) return;
  event.preventDefault();
  const form = new FormData(event.target);
  const button = event.target.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    if (event.target.id === 'password-change-form') {
      const newPassword = String(form.get('newPassword') || '');
      if (newPassword !== form.get('confirmPassword')) {
        showAuthError('The new passwords do not match.');
        return;
      }
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: form.get('currentPassword'),
          newPassword
        })
      });
      mustChangePassword = false;
      passwordChangeRequested = false;
      adminCredentialNotice = null;
      toast('Password updated.');
    } else if (event.target.id === 'login-form') {
      const result = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: form.get('employeeId'),
          password: form.get('password')
        })
      });
      if (screen === 'admin-login' && result.user.role !== 'admin') {
        await apiRequest('/api/auth/logout', { method: 'POST', body: '{}' });
        showAuthError('This sign-in page is for administrator accounts. Use staff sign in for this account.');
        return;
      }
      userName = result.user.username;
      userId = result.user.id;
      role = result.user.role;
      mustChangePassword = result.user.mustChangePassword;
      tab = role === 'admin' ? 'accounts' : role === 'manager' ? 'overview' : 'roster';
    } else {
      const password = String(form.get('password') || '');
      if (password !== form.get('confirmPassword')) {
        showAuthError('The passwords do not match.');
        return;
      }
      if (!String(form.get('email') || '').trim() && !String(form.get('phone') || '').trim()) {
        showAuthError('Enter either an email address or a phone number.');
        return;
      }
      const result = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: form.get('username'),
          employeeId: form.get('employeeId'),
          department: form.get('department'),
          email: form.get('email'),
          phone: form.get('phone'),
          contactDetails: form.get('contactDetails'),
          password
        })
      });
      userName = result.user.username;
      userId = result.user.id;
      role = result.user.role;
      mustChangePassword = result.user.mustChangePassword;
      tab = 'roster';
    }
    screen = 'app';
    startupError = '';
    if (!mustChangePassword) {
      if (role === 'admin') await loadAdminData();
      if (role === 'manager') await loadManagerScopes();
      if (role === 'staff') await loadRoster();
    }
    render();
  } catch (error) {
    showAuthError(error.message);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

document.addEventListener('change', event => {
  if (event.target.id !== 'scope-department') return;
  const wardSelect = $('#scope-ward');
  const requiresWard = event.target.value === 'Nursing';
  wardSelect.disabled = !requiresWard;
  wardSelect.required = requiresWard;
  wardSelect.value = '';
});

document.addEventListener('click', event => {
  handleClick(event).catch(error => showAuthError(error.message));
});

async function initialize() {
  try {
    const result = await apiRequest('/api/auth/me');
    if (result.user) {
      userName = result.user.username;
      userId = result.user.id;
      role = result.user.role;
      mustChangePassword = result.user.mustChangePassword;
      screen = 'app';
      tab = role === 'admin' ? 'accounts' : role === 'manager' ? 'overview' : 'roster';
      if (!mustChangePassword) {
        if (role === 'admin') await loadAdminData();
        if (role === 'manager') await loadManagerScopes();
        if (role === 'staff') await loadRoster();
      }
    }
  } catch (error) {
    startupError = error.message;
  }
  render();
}

seedRequests();
initialize();
