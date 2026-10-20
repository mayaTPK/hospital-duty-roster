# Hospital Duty Roster

Hospital Duty Roster helps hospital staff view monthly duty schedules and gives managers a shared place to prepare and publish rosters. It includes employee-ID sign-in, department-specific staff registration, administrator tools for managing accounts and access, and persistent roster drafts and published snapshots. Change requests are still preview data and are not saved by the server.

## Requirements

- Node.js 22.5 or later
- npm

For the technical architecture, API reference, operations, and testing details, see [DEVELOPER-GUIDE.md](./DEVELOPER-GUIDE.md).

## First time on a fresh database

In **Windows PowerShell**, open the project folder, replacing the example path with its location on your computer:

```powershell
cd 'C:\path\to\App3'
npm.cmd install
npm.cmd start
```

The app automatically creates the initial administrator in `data/duty-roster.sqlite` the first time it starts. Open <http://localhost:3000>, choose **Administrator · Accounts & Access**, and sign in with:

| Login field | Initial value |
|---|---|
| Employee ID | `ADMIN-001` |
| Password | `DutyRoster-Start1!` |

This initial password is intentionally public and identical for every fresh installation. You must choose a private password when prompted at first sign-in. **Do not expose the app to a network until the initial password has been changed.** The app also displays these first-time credentials on the administrator sign-in page. Once the password has been changed, the public initial password no longer works.

The database directory is private application data, excluded from source control and not served by the web server. If an existing installation has an unclaimed initial admin (`admin` / `ADMIN-001` still requires a password change), starting the app updates its initial password to the documented value so it can be accessed. If the administrator already chose a new password, that password is left unchanged.

## Create a sample database for testing

To generate a separate database with demo users, a manager-editable Laboratory roster, and a published Nursing roster, run:

```powershell
npm.cmd run create-sample-db
```

This creates `data/duty-roster-sample.sqlite` and refuses to overwrite it. Start the app against it with:

```powershell
$env:DATABASE_PATH = Join-Path $PWD 'data\duty-roster-sample.sqlite'
npm.cmd start
```

Use these local-only demo credentials:

| Role | Employee ID | Password |
|---|---|---|
| Administrator | `ADMIN-001` | `DemoAdmin-2026!` |
| Laboratory manager | `DEMO-MGR-LAB` | `DemoManager-2026!` |
| Nursing manager | `DEMO-MGR-NUR` | `DemoNursing-2026!` |
| Demo staff | `DEMO-LAB-01` or `DEMO-NUR-01` | `DemoStaff-2026!` |

Additional sample staff IDs are `DEMO-LAB-02`, `DEMO-LAB-03`, `DEMO-NUR-02`, and `DEMO-NUR-03`. This database contains public test passwords and sample data; use it only for local testing, never deployment. To regenerate it, stop the app and remove the sample database and its `-shm` and `-wal` sidecar files first. The normal `data/duty-roster.sqlite` is not modified.

## Start the app after setup

For later sessions, open PowerShell in the project folder and run:

```powershell
npm.cmd start
```

Then open <http://localhost:3000> and sign in with your current credentials. No account-creation command is needed for the initial administrator.

Use `npm.cmd run dev` while developing to restart the server when its files change. Run the authentication, roster access, and publication integration tests with `npm.cmd test`.

The `.cmd` form runs the Windows npm command directly and avoids PowerShell execution-policy errors that can block `npm.ps1`. In Command Prompt, or in PowerShell where `npm` is permitted, the equivalent commands are `npm install`, `npm start`, `npm run dev`, and `npm test`.

## How it works

The app has three account roles:

- **Administrator:** manages access in **Accounts & access**. Administrators can promote registered staff accounts to manager and assign each manager to Laboratory, Clinical, or a specific Nursing ward.
- **Manager:** works on monthly rosters for assigned scopes only. A manager can add registered staff to a roster, change the staff order, edit shifts, and publish the roster.
- **Staff:** views a roster only after it has been published and only if their account is included in it.

Each roster starts as a draft. Publishing saves a separate snapshot for staff to view. Managers can continue editing the draft afterward; those edits remain private until they publish an updated snapshot. Nursing rosters are managed separately for each ward, while Laboratory and Clinical each have one roster per month.

Shift edits, roster membership, staff ordering, and published snapshots are stored in SQLite. **Change requests and their approvals are not connected to the server yet** and should be treated as preview functionality.

## Create additional administrator and manager accounts

The initial administrator has username `admin` and department `Clinical`. After signing in, use **Create administrator or manager** to add elevated accounts. The app generates a temporary password for each new account; give it directly to the account holder. They must change it on first sign-in. Assign a manager's department or Nursing ward from the Manager assignments panel. Public registration cannot create an administrator or manager.

Staff register with an employee ID, username, department, password, and the existing contact fields. They sign in with their employee ID and password; usernames and contact details are not sign-in credentials. Administrators can review accounts by employee ID and username, update usernames, IDs, and departments, and issue temporary password resets from **Accounts & Access**. An administrator can edit their own account details and change their password from the admin workspace. The administrator must share an issued temporary password privately; the user is forced to choose a new password after sign-in. This app does not send reset emails or SMS. Passwords are hashed with Node's `scrypt`; the server stores opaque, expiring sessions in SQLite and sends the session identifier in an HttpOnly, SameSite cookie. Use the authenticated admin screen for account management; the SQLite database file is private application storage, not a public web page.

## LAN deployment note

The server listens on `127.0.0.1` by default. To make it available on a trusted LAN, set `HOST=0.0.0.0` and configure the host firewall. Do not expose it to a public network without HTTPS and deployment hardening. When HTTPS is enabled, set `COOKIE_SECURE=true`. Keep the SQLite data directory private and back it up separately.
