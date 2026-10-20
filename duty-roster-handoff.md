# Duty Roster App: Build Brief for Claude Code

Files in this pack:
- duty-roster-handoff.md (this file: build brief and full prompt)
- duty-roster-ui.html (visual and interaction reference; open it in a browser)
- The three sample rosters (Laboratory, Clinical, Nursing). Cover or blur all real names before sharing.

## 1. What to build

A Progressive Web App for hospital duty rosters (Laboratory, Clinical, and Nursing by ward) that runs on a local server over the hospital Wi-Fi or LAN. Follow the full prompt in section 6. Use duty-roster-ui.html as the visual and interaction reference: same layout, colors, shift codes, bottom navigation, bottom-sheet pickers, and wording. Do not copy any real names from the sample rosters.

## 2. Recommended stack (keep it simple)

- Node.js with Express
- SQLite (single file, easy to back up)
- Plain HTML, CSS, and JavaScript on the front end (or a light framework if preferred)
- Service worker for offline caching of the latest published roster
- Server-Sent Events for live in-app notifications while online

## 3. Data model

- users: id, username, phone, email, contact_details, password_hash, role (admin, manager, staff)
- departments: Laboratory, Clinical, Nursing
- wards: id, name, department (nursing wards only)
- rosters: id, department, ward, year, month, status (draft or published)
- roster_staff: roster, user, row order
- shift_types: code, name, hours, color, department (managers can edit hours)
- entries: roster, user, day, code, plus a published copy so staff only see published data
- manager_scope: which manager owns which department or ward
- requests: staff, roster, day, from_code, to_code, reason, status, manager_note
- notifications: user, text, read, time
- audit_log: who changed which cell, from what, to what, and when
- rules: per roster, optional, warning only

## 4. Build order, with a check after each step

1. Setup, accounts, and roles. Check: an admin creates departments, wards, and managers; staff sign up with a username plus phone or email.
2. Roster grid, draft editing, and publishing. Check: a manager edits cells; staff see nothing until Publish.
3. My shifts and change requests. Check: a request reaches the right manager; approve updates the roster; decline sends a note.
4. Notifications and offline. Check: publish and request events show in the bell; the app opens a cached roster with the server off; offline requests sync later.
5. Totals, warnings, and leave ranges. Check: Hrs, PH, and OW calculate correctly; leave can be set over a date range; warnings never block saving.
6. Audit log, backup, export. Check: history shows each change; a daily backup file is created; PDF or print matches the on-screen grid.

## 5. Important notes

- Service workers and installing to the home screen need HTTPS, except on localhost. For phones on the LAN, set up a local certificate (for example with mkcert) or serve through a local HTTPS proxy. Plan this early.
- Phone lock-screen push messages normally need internet. On a LAN-only setup, notifications are in-app and live while the app is open, and are waiting when it next opens.
- Staff without email can log in by phone number. The admin can reset passwords.
- Run the server on one always-on hospital PC with a fixed local address.

## 6. Full prompt

Build a simple Progressive Web App for digital duty rosters at a hospital, with three departments: Laboratory, Clinical, and Nursing. It must install on phones and run on the hospital LAN or Wi-Fi from a simple local server and database, so it works without internet. Keep the code simple and easy to maintain.

Use the attached rosters as layout and color references only. Match the grid style, shift codes, and totals columns. Do not copy any names. Use placeholder names in sample data.

### Shift types
- Laboratory and Clinical: Straight (S), Call (C), Off (O), Public Holiday (PH), Leave (annual or study).
- Nursing: Straight (S), Late (L), Night (N), Sleeping Day (SD, the rest day after nights), Off (O), PH, Leave.
- Each shift type has a set number of hours that managers can change (for example, Straight 8, Night 12).

### Accounts and roles
- Staff sign up with a username, a phone number or email, and contact details.
- Roster Manager (per department or ward): finds staff by username, adds them to a roster, then creates, edits, copies last month, and publishes.
- Staff: view published rosters, see a "My shifts" view, and request changes.
- Admin: sets up departments and wards, assigns roster managers, and resets passwords.

### Nursing wards
- Starting wards: Surgical, Male, Female, Paediatric, HDU, Labour, Postnatal, Antenatal.
- Roster managers can add, rename, or remove wards. Each ward has its own staff list and roster.

### Rosters
- Viewed inside the app as a monthly grid: staff down the side, dates and weekdays across the top, color-coded cells, legend always visible.
- No fixed limit on staff per roster.
- Per-staff totals: Hours (target 160), PH count, and OW (Owed Days, can be negative).
- Laboratory also shows on-call weeks and staff contact numbers.
- Managers work on a draft. Staff only see a roster once it is published.
- Export to PDF or print is available, but secondary to in-app viewing.

### Rules
- No fixed rules are built in. Managers can set their own per department or ward (for example, maximum nights in a row, minimum staff per shift, target hours).
- Rules only show warnings. They never block saving.

### Change requests
- Staff taps their shift, picks the date and the change wanted, adds a short reason, and sends it.
- The request goes to the manager of that department or ward.
- The manager approves (roster updates) or declines (with a note). The staff member is notified.

### Notifications
- In-app push for: roster published, roster changed, request received, request approved or declined.

### Offline and data
- The latest published roster is cached on each phone.
- Offline changes and requests sync when the connection returns.
- The app records who changed which shift and when.
- The server saves an automatic daily backup.

### Key features
- Tap a cell to pick a shift from a color-coded menu.
- Public holidays highlighted automatically (for example, 15 October).
- Leave can be marked over a date range.

### UI and UX
- Clean, large tap targets, simple language, one-screen month view, swipe between months.

## 7. Done when

Three departments work, all eight starting wards exist (managers can add more), staff can request changes, managers can publish, and everything works on phones over the hospital Wi-Fi with no internet.
