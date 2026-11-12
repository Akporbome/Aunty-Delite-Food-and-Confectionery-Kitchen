# The Common Table

A restaurant-site starter with separate home, menu, order, reservation, and password-protected staff pages. The staff area manages the menu, orders, and reservations.

The restaurant name, address, opening hours, sample dishes, and USD pricing are placeholders. Update them for your restaurant before publishing.

## Run locally

Requires Python 3.8 or newer; the server uses only the Python standard library.

In PowerShell, from this folder:

```powershell
$env:ADMIN_PASSWORD = Read-Host "Choose a staff passphrase (at least 12 characters)"
python .\server.py
```

Open [http://localhost:8000](http://localhost:8000). Use the navigation at the top right to move between pages. The staff sign-in page is separate and requires the password set in the environment; the password is not saved in the project.

Opening an HTML file directly in a browser also shows a read-only preview with sample menu items and a working local basket. Orders, reservations, and staff tools need the local server running.

The menu is seeded with example dishes the first time the server starts. Changes, orders, reservations, and staff sessions are stored in a SQLite file next to the project folder.

## Before using it with real customers

- This is a starter, not a production deployment. Put it behind a properly configured HTTPS reverse proxy and set `COOKIE_SECURE=1` in the server environment. Do not expose the development server directly to the internet.
- The starter uses one shared staff password. Use named staff accounts, password reset/revocation, and stronger operational monitoring before production.
- Orders are pickup requests paid for in person; no online payment is collected. Reservations are requests that staff must confirm. No email or SMS notifications are sent.
- Add your actual restaurant details, menu, currency, pickup instructions, privacy notice, and data-retention policy.
- Protect and back up the SQLite database file. It contains customer contact details and order/reservation history.

To use a different local port, set `PORT` before starting the server. `HOST` defaults to `127.0.0.1`; keep it local for development.
