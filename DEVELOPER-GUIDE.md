# Developer and Platform Operations Guide

This guide describes how the Hospital Duty Roster application is built, how its current workflows operate, and how to run and inspect it. It is written to match the implementation that exists today; features marked **Not implemented** should not be assumed to be available.

Update this guide whenever a change affects the architecture, setup, data model, permissions, API, operations, or testing instructions.

## 1. Technology used

| Area | Technology |
|---|---|
| User interface | HTML, CSS, and browser JavaScript |
| UI framework | Bootstrap 5.3.3 CSS loaded from jsDelivr CDN; roster-specific styling lives in the local stylesheet |
| Web server and API | Node.js with Express 5 |
| Database | SQLite using Node.js's built-in `node:sqlite` `DatabaseSync` API |
| Authentication | Server-side sessions, `scrypt` password hashes, and an HttpOnly, SameSite cookie |
| Tests | Node.js built-in test runner (`node:test`) and HTTP integration tests |

Node.js 22.5 or later is required. Express is the only direct npm runtime dependency. Bootstrap is currently loaded from a CDN, so the browser needs access to jsDelivr for Bootstrap styling.

## 2. Project layout

```text
.
├── assets/
│   ├── css/duty-roster.css       # App styling and responsive layouts
│   └── js/duty-roster.js         # UI rendering, events, and API calls
├── scripts/
│   ├── create-account.js         # Secure terminal provisioning for admin/manager
│   └── create-sample-database.js # Local demo database generator
├── test/
│   └── auth.test.js              # Authentication, access, and roster integration tests
├── data/                         # Local SQLite database (ignored by Git)
├── db.js                         # SQLite connection, tables, indexes, and seed data
├── server.js                     # Express app, authentication, and JSON API
├── duty-roster-ui.html           # HTML entry point and asset links
├── package.json                  # npm scripts and dependency declaration
└── README.md                     # User-facing setup and overview
```

The `data/` folder is private application data and should not be copied into source control or served as a static asset.

## 3. How the platform works

### Roles and control

1. **Administrator**
   - The server creates the first administrator automatically if no administrator exists. Initial credentials are employee ID `ADMIN-001` and public password `DutyRoster-Start1!`; the administrator must change it at first sign-in.
   - Sign in, open **Accounts & Access**, and create additional administrator or manager accounts.
   - Review accounts by employee ID and username; edit account usernames, IDs, and departments, and issue temporary password resets from the same screen.
   - Edit the administrator's own account details from the Accounts screen or change their password from the header.
   - Share each generated temporary password privately; its holder must change it on first sign-in.
   - Assign a manager to Laboratory, Clinical, or a particular Nursing ward.
   - Remove an assignment or return a manager to the staff role from the same screen.
2. **Manager**
   - Sign in and use **Overview** to open an assigned scope.
   - Select the roster month, add registered staff or managers assigned to that exact team, reorder or remove roster members, and edit shifts. Manager inclusion is optional per roster.
   - Publish when ready. Managers may keep editing afterward; staff continue to see the last published snapshot until it is published again.
   - Managers cannot access departments or wards outside their assignments. This is checked by the API, not only hidden in the interface.
3. **Staff**
   - Register with an employee ID, username, department, password, and the existing contact fields.
   - Sign in with the employee ID and password (not the username, email, or phone number) to view a roster published with their account on its staff list.
   - Draft roster data and other staff members' rosters are not returned to staff.

Laboratory and Clinical have one roster per month. Nursing has a separate roster for each ward and month. Roster dates in the API use month numbers `1` through `12`; the browser's internal JavaScript month index is zero-based and is converted when calling the API.

### Draft and published data

Draft roster staff and shift entries are stored separately from published staff and entries. Publishing copies the current draft into the published tables inside a database transaction. This keeps the staff view stable while a manager prepares further edits.

### Current feature boundary

Authentication, account roles, manager scopes, roster membership/order, shift edits, and published snapshots are persisted. **Change requests and approvals are currently preview UI only** and are not saved to the server. The app does not yet have a general activity history, audit log, notification delivery, or monitoring dashboard.

## 4. Data model

Tables are created by `db.js` when the server starts. No separate migration tool is currently used.

| Table | Purpose |
|---|---|
| `users` | Accounts, employee IDs, department, contact details, password hashes, role, and required-password-change flag |
| `sessions` | Hashed session tokens and expiration timestamps |
| `departments`, `wards` | Supported departments and seeded Nursing wards |
| `manager_scopes` | Department/ward assignments that authorize managers |
| `rosters` | Monthly roster identity, status, creator, and timestamps |
| `roster_staff`, `roster_entries` | Editable draft membership/order and shift codes |
| `published_roster_staff`, `published_roster_entries` | Snapshot visible to eligible staff |

Foreign keys, uniqueness constraints, and checks protect data relationships. The server also validates role, manager scope, shift code, day, and staff membership before roster writes.

## 5. HTTP API reference

All API responses are JSON. Authenticated routes use the session cookie. Mutating routes also enforce same-origin checks.

| Method and path | Purpose / access |
|---|---|
| `GET /api/auth/me` | Return the current signed-in account, or `null` |
| `POST /api/auth/register` | Register a staff account with `employeeId`, `username`, `department`, password, and optional contact fields |
| `POST /api/auth/login` | Sign in with `{ employeeId, password }`; attempts are rate-limited |
| `POST /api/auth/logout` | End the current session |
| `POST /api/auth/change-password` | Change the current password; temporary-password users must do this before normal use |
| `GET /api/admin/accounts` | List accounts and manager scopes; admin only |
| `POST /api/admin/accounts` | Create an administrator or manager account and return its one-time temporary password; admin only |
| `POST /api/admin/accounts/:id/reset-password` | Invalidate an account's sessions and issue a temporary password; admin only |
| `PATCH /api/admin/accounts/:id/profile` | Update username, employee ID, and department without changing role; admin only |
| `PATCH /api/admin/accounts/:id/role` | Promote/demote a non-admin account; admin only |
| `POST /api/admin/manager-scopes` | Assign a manager scope; admin only |
| `DELETE /api/admin/manager-scopes/:id` | Remove a manager scope; admin only |
| `GET /api/roster-scopes` | List current manager assignments; manager only |
| `GET /api/rosters/:department/:year/:month?ward=...` | Read a manager's draft or an eligible staff member's published snapshot |
| `POST /api/rosters` | Create a draft in an assigned scope; manager only |
| `GET /api/rosters/:id/staff-options` | List eligible registered staff and managers assigned to that exact roster scope who are not already on draft; manager only |
| `POST /api/rosters/:id/staff` | Add a staff account or manager assigned to that exact roster scope to the draft; manager only |
| `DELETE /api/rosters/:id/staff/:userId` | Remove a staff member from the draft; manager only |
| `PUT /api/rosters/:id/staff/order` | Save draft roster ordering; manager only |
| `PUT /api/rosters/:id/entries` | Save one validated draft shift; manager only |
| `POST /api/rosters/:id/publish` | Publish a draft snapshot; manager only |

Nursing roster requests require the `ward` query parameter. Other departments do not accept a ward.

## 6. Run and control the app locally (Windows PowerShell)

From the project directory:

```powershell
npm install
npm start
```

Open <http://localhost:3000>. Stop the foreground server with **Ctrl+C**. For automatic restarts while editing:

```powershell
npm run dev
```

The server defaults to host `127.0.0.1` and port `3000`. For a different local port:

```powershell
$env:PORT = '3001'
npm start
```

To use a separate database file for local testing, set `DATABASE_PATH` before starting the app:

```powershell
$env:DATABASE_PATH = 'C:\path\to\test-duty-roster.sqlite'
npm start
```

The standard database path is `data/duty-roster.sqlite`. `DATA_DIRECTORY` can instead be used to choose the data directory. Avoid changing database-path environment variables after starting the server; the database is opened at process startup.

### Full local reset (destructive)

A browser hard refresh clears cached page assets; it does not remove accounts or roster data. To erase all local application data, stop the server first, then remove only the SQLite database and its sidecar files. This permanently deletes accounts, sessions, manager scopes, and rosters. Run these commands from the project directory in PowerShell:

```powershell
Remove-Item -LiteralPath `
  '.\data\duty-roster.sqlite', `
  '.\data\duty-roster.sqlite-shm', `
  '.\data\duty-roster.sqlite-wal' `
  -Force -ErrorAction SilentlyContinue
npm start
```

The app recreates the empty database, seeds the built-in departments and Nursing wards, and creates the initial administrator on startup. Do not run this reset against a database whose data you need.

### Create and manage accounts

The initial administrator is created automatically on first server start. Its public first-login credentials are employee ID `ADMIN-001` and password `DutyRoster-Start1!`; the password must be changed before the account can use admin features. The optional `npm run create-admin` helper displays these initial credentials only while the initial password is still required. It does not recover a password that the administrator has already changed.

Create all subsequent administrators and managers in the authenticated **Accounts & Access** screen. New elevated accounts receive a generated temporary password and are required to change it before using protected features. Managers still need a scope assignment before managing rosters. Staff self-register and cannot choose an elevated role. Password recovery is admin-assisted: reset invalidates existing sessions, and the administrator shares the temporary password privately. No email or SMS provider is configured. Never put passwords in source files or command-line arguments.

### Running tests

```powershell
npm test
```

The integration test starts a separate server with a temporary database, exercises authentication, manager authorization, roster draft editing, and published-snapshot isolation, then removes its temporary test data. It does not reset the normal `data/duty-roster.sqlite` database.

### Sample database

Run `npm run create-sample-db` to create `data/duty-roster-sample.sqlite`. The generator refuses to overwrite an existing file. Start the server with `DATABASE_PATH` set to that file to exercise demo administrator, manager, and staff accounts plus draft and published rosters. The demo passwords are documented in `README.md`; this database is for local testing only and must not be deployed. Stop the server before removing the sample database and its SQLite sidecar files to regenerate it.

## 7. How to inspect and track the running platform

### Available now

- The terminal running `npm start` or `npm run dev` displays the server URL and active database path at startup.
- Keep that terminal open while testing. Server-side request failures are written to its error output; successful application actions are not currently recorded as an activity feed.
- Use the administrator's **Accounts & access** screen to inspect accounts and their manager assignments.
- Use manager **Overview** and the roster status to see assigned scopes and whether the selected roster is a draft or published.
- Run `npm test` after changes to check the automated authentication and roster access flows.
- The database records account creation time and roster update/publication timestamps. It does not currently record a complete history of who changed each shift or every administrative action.

### Not yet available

There is no administrator dashboard for live user counts, failed-login history, server health, request status, or audit events. Change requests are not stored. Do not rely on the current application as an audit/compliance system or as a source of operational alerts.

Until an audit feature is implemented, keep the server terminal output for troubleshooting and take controlled database backups. To back up the SQLite database safely, stop the server first, then copy `data/duty-roster.sqlite` to an access-controlled backup location. Stopping first matters because SQLite uses write-ahead logging while the app is running. Do not share the database file: it contains personal account/contact information and credential hashes.

## 8. Security and deployment notes

- Passwords are stored as `scrypt` hashes; plaintext passwords are not stored.
- Session tokens are random and only their hashes are stored in SQLite. Session cookies are HttpOnly and SameSite=Strict, and expire after 12 hours.
- The server limits JSON request bodies and applies basic security response headers and login-attempt throttling.
- Keep `data/` private and back it up securely. Do not commit it.
- By default, the server listens only on `127.0.0.1`. Setting `HOST=0.0.0.0` makes it reachable on network interfaces; do this only on a trusted, firewalled network.
- Do not expose this development server to the public internet without HTTPS, secure deployment configuration, operational monitoring, backups, and a security review. If serving over HTTPS, set `COOKIE_SECURE=true`.
- `APP_ORIGIN` can be set to the expected origin when the application is deployed behind a controlled host.
- Bootstrap CSS is fetched from jsDelivr; plan for a locally hosted dependency if the deployment must work without internet access.

## 9. Updating the developer documentation

When adding or changing a role, route, database table, environment variable, setup command, test flow, or operational feature, update this guide and `README.md` in the same change. Clearly label functionality as available, preview-only, or not implemented so operators know what the platform can safely be used for.
