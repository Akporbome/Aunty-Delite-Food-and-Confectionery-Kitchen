import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATABASE = ROOT.parent / (ROOT.name + ".sqlite3")
SESSION_SECONDS = 8 * 60 * 60
MAX_BODY = 64 * 1024
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
LOGIN_FAILURES = {}


def connect():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize():
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS menu_items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL,
                price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
                active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY,
                customer_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                total_cents INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'received',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES orders(id),
                menu_item_id INTEGER,
                name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                price_cents INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reservations (
                id INTEGER PRIMARY KEY,
                customer_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                party_size INTEGER NOT NULL,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'requested',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                expires_at INTEGER NOT NULL
            );
            """
        )
        if db.execute("SELECT COUNT(*) FROM menu_items").fetchone()[0] == 0:
            db.executemany(
                """
                INSERT INTO menu_items (name, description, category, price_cents)
                VALUES (?, ?, ?, ?)
                """,
                [
                    ("Roasted tomato toast", "Sourdough, whipped ricotta, basil oil", "Brunch", 1250),
                    ("Wild mushroom omelette", "Herbs, aged cheddar, dressed greens", "Brunch", 1650),
                    ("Crispy chicken sandwich", "Pickled cabbage, house sauce, fries", "Mains", 1850),
                    ("Market grain bowl", "Seasonal vegetables, grains, lemon tahini", "Mains", 1700),
                    ("Olive oil cake", "Citrus cream, fresh berries", "Dessert", 850),
                    ("House lemonade", "Fresh lemon, a little mint", "Drinks", 550),
                ],
            )


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def as_dict(row):
    return dict(row) if row is not None else None


class Handler(SimpleHTTPRequestHandler):
    server_version = "RestaurantSite"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/menu":
            with connect() as db:
                rows = db.execute(
                    "SELECT id, name, description, category, price_cents FROM menu_items WHERE active = 1 ORDER BY category, id"
                ).fetchall()
            return self.send_json(200, [as_dict(row) for row in rows])
        if path == "/api/admin/session":
            return self.send_json(200, {"authenticated": self.admin_session()})
        if path.startswith("/api/admin/"):
            if not self.require_admin():
                return
            if path == "/api/admin/menu":
                with connect() as db:
                    rows = db.execute("SELECT * FROM menu_items ORDER BY category, id").fetchall()
                return self.send_json(200, [as_dict(row) for row in rows])
            if path == "/api/admin/orders":
                with connect() as db:
                    orders = db.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 100").fetchall()
                    result = []
                    for order in orders:
                        item_rows = db.execute(
                            "SELECT name, quantity, price_cents FROM order_items WHERE order_id = ?",
                            (order["id"],),
                        ).fetchall()
                        data = as_dict(order)
                        data["items"] = [as_dict(item) for item in item_rows]
                        result.append(data)
                return self.send_json(200, result)
            if path == "/api/admin/reservations":
                with connect() as db:
                    rows = db.execute("SELECT * FROM reservations ORDER BY date, time LIMIT 200").fetchall()
                return self.send_json(200, [as_dict(row) for row in rows])
            return self.send_json(404, {"error": "Not found"})
        if path in (
            "/",
            "/index.html",
            "/menu.html",
            "/order.html",
            "/reservations.html",
            "/staff.html",
            "/app.js",
            "/styles.css",
        ):
            return super().do_GET()
        return self.send_error(404, "Not found")

    def do_HEAD(self):
        if urlparse(self.path).path in (
            "/",
            "/index.html",
            "/menu.html",
            "/order.html",
            "/reservations.html",
            "/staff.html",
            "/app.js",
            "/styles.css",
        ):
            return super().do_HEAD()
        return self.send_error(404, "Not found")

    def do_POST(self):
        path = urlparse(self.path).path
        if not self.valid_origin():
            return self.send_json(403, {"error": "Request origin is not allowed"})
        data = self.read_json()
        if data is None:
            return
        if path == "/api/orders":
            return self.create_order(data)
        if path == "/api/reservations":
            return self.create_reservation(data)
        if path == "/api/admin/login":
            return self.login(data)
        if path == "/api/admin/logout":
            token = self.session_token()
            if token:
                with connect() as db:
                    db.execute("DELETE FROM sessions WHERE token_hash = ?", (self.hash_token(token),))
            self.send_response(200)
            self.send_header("Set-Cookie", self.cookie("", 0))
            return self.send_json_body({"ok": True})
        if path.startswith("/api/admin/"):
            if not self.require_admin():
                return
            if path == "/api/admin/menu":
                return self.create_menu_item(data)
        return self.send_json(404, {"error": "Not found"})

    def do_PUT(self):
        if not self.valid_origin():
            return self.send_json(403, {"error": "Request origin is not allowed"})
        if not self.require_admin():
            return
        data = self.read_json()
        if data is None:
            return
        match = re.fullmatch(r"/api/admin/menu/(\d+)", urlparse(self.path).path)
        if match:
            return self.update_menu_item(int(match.group(1)), data)
        match = re.fullmatch(r"/api/admin/(orders|reservations)/(\d+)", urlparse(self.path).path)
        if match:
            return self.update_status(match.group(1), int(match.group(2)), data)
        return self.send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        if not self.valid_origin():
            return self.send_json(403, {"error": "Request origin is not allowed"})
        if not self.require_admin():
            return
        match = re.fullmatch(r"/api/admin/menu/(\d+)", urlparse(self.path).path)
        if not match:
            return self.send_json(404, {"error": "Not found"})
        with connect() as db:
            cursor = db.execute("UPDATE menu_items SET active = 0 WHERE id = ?", (int(match.group(1)),))
        if cursor.rowcount == 0:
            return self.send_json(404, {"error": "Menu item not found"})
        return self.send_json(200, {"ok": True})

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.send_json(413, {"error": "Invalid request size"})
            return None
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            self.send_json(415, {"error": "Expected JSON"})
            return None
        try:
            data = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Invalid JSON"})
            return None
        if not isinstance(data, dict):
            self.send_json(400, {"error": "Expected a JSON object"})
            return None
        return data

    def send_json(self, status, value):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        return self.send_json_body(value)

    def send_json_body(self, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def valid_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return False
        parsed = urlparse(origin)
        return parsed.scheme in ("http", "https") and parsed.netloc.lower() == self.headers.get("Host", "").lower()

    def session_token(self):
        for part in self.headers.get("Cookie", "").split(";"):
            key, separator, value = part.strip().partition("=")
            if separator and key == "restaurant_admin":
                return value
        return ""

    @staticmethod
    def hash_token(token):
        return hashlib.sha256(token.encode("ascii")).hexdigest()

    def admin_session(self):
        token = self.session_token()
        if not token:
            return False
        with connect() as db:
            row = db.execute(
                "SELECT expires_at FROM sessions WHERE token_hash = ?",
                (self.hash_token(token),),
            ).fetchone()
            if row and row["expires_at"] > int(time.time()):
                return True
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (self.hash_token(token),))
        return False

    def require_admin(self):
        if not self.admin_session():
            self.send_json(401, {"error": "Staff sign-in required"})
            return False
        return True

    def cookie(self, value, max_age):
        secure = "; Secure" if os.environ.get("COOKIE_SECURE") == "1" else ""
        return "restaurant_admin=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d%s" % (value, max_age, secure)

    def login(self, data):
        remote = self.client_address[0]
        now = time.time()
        attempts = [stamp for stamp in LOGIN_FAILURES.get(remote, []) if now - stamp < 300]
        if len(attempts) >= 5:
            return self.send_json(429, {"error": "Too many sign-in attempts. Try again in five minutes."})
        password = data.get("password")
        if not ADMIN_PASSWORD or not isinstance(password, str) or not hmac.compare_digest(password, ADMIN_PASSWORD):
            attempts.append(now)
            LOGIN_FAILURES[remote] = attempts
            return self.send_json(401, {"error": "Incorrect password"})
        LOGIN_FAILURES.pop(remote, None)
        token = secrets.token_urlsafe(32)
        with connect() as db:
            db.execute(
                "INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)",
                (self.hash_token(token), int(now) + SESSION_SECONDS),
            )
        self.send_response(200)
        self.send_header("Set-Cookie", self.cookie(token, SESSION_SECONDS))
        return self.send_json_body({"ok": True})

    @staticmethod
    def text(data, key, required=False, limit=500):
        value = data.get(key, "")
        if not isinstance(value, str):
            raise ValueError("%s must be text" % key)
        value = value.strip()
        if required and not value:
            raise ValueError("%s is required" % key)
        if len(value) > limit:
            raise ValueError("%s is too long" % key)
        return value

    def create_order(self, data):
        try:
            name = self.text(data, "name", True, 100)
            phone = self.text(data, "phone", True, 40)
            email = self.text(data, "email", False, 254)
            note = self.text(data, "note", False, 500)
            items = data.get("items")
            if not isinstance(items, list) or not items or len(items) > 40:
                raise ValueError("Your cart is empty or too large")
            quantities = {}
            for item in items:
                if not isinstance(item, dict):
                    raise ValueError("Invalid cart item")
                item_id = item.get("id")
                quantity = item.get("quantity")
                if type(item_id) is not int or type(quantity) is not int or quantity < 1 or quantity > 20:
                    raise ValueError("Invalid item quantity")
                quantities[item_id] = quantities.get(item_id, 0) + quantity
            if any(quantity > 20 for quantity in quantities.values()):
                raise ValueError("Maximum quantity per item is 20")
            with connect() as db:
                rows = db.execute(
                    "SELECT id, name, price_cents FROM menu_items WHERE active = 1 AND id IN (%s)"
                    % ",".join("?" for _ in quantities),
                    list(quantities.keys()),
                ).fetchall()
                if len(rows) != len(quantities):
                    raise ValueError("A menu item is no longer available")
                total = sum(row["price_cents"] * quantities[row["id"]] for row in rows)
                cursor = db.execute(
                    "INSERT INTO orders (customer_name, phone, email, note, total_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (name, phone, email, note, total, now_iso()),
                )
                order_id = cursor.lastrowid
                db.executemany(
                    "INSERT INTO order_items (order_id, menu_item_id, name, quantity, price_cents) VALUES (?, ?, ?, ?, ?)",
                    [
                        (order_id, row["id"], row["name"], quantities[row["id"]], row["price_cents"])
                        for row in rows
                    ],
                )
            return self.send_json(201, {"id": order_id, "total_cents": total})
        except ValueError as error:
            return self.send_json(400, {"error": str(error)})

    def create_reservation(self, data):
        try:
            name = self.text(data, "name", True, 100)
            phone = self.text(data, "phone", True, 40)
            email = self.text(data, "email", False, 254)
            note = self.text(data, "note", False, 500)
            date = self.text(data, "date", True, 10)
            time_value = self.text(data, "time", True, 5)
            party_size = data.get("party_size")
            if datetime.strptime(date, "%Y-%m-%d").date().isoformat() != date:
                raise ValueError("Choose a valid reservation date")
            if datetime.strptime(time_value, "%H:%M").strftime("%H:%M") != time_value:
                raise ValueError("Choose a valid reservation time")
            if type(party_size) is not int or party_size < 1 or party_size > 20:
                raise ValueError("Party size must be from 1 to 20")
            if date < datetime.now().date().isoformat():
                raise ValueError("Choose a date that has not passed")
            with connect() as db:
                cursor = db.execute(
                    "INSERT INTO reservations (customer_name, phone, email, party_size, date, time, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (name, phone, email, party_size, date, time_value, note, now_iso()),
                )
            return self.send_json(201, {"id": cursor.lastrowid, "status": "requested"})
        except (ValueError, TypeError) as error:
            return self.send_json(400, {"error": str(error) or "Invalid reservation"})

    @staticmethod
    def menu_values(data):
        name = data.get("name")
        description = data.get("description", "")
        category = data.get("category")
        price = data.get("price_cents")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
            raise ValueError("A menu item name is required (100 characters max)")
        if not isinstance(description, str) or len(description) > 300:
            raise ValueError("Description must be 300 characters or fewer")
        if not isinstance(category, str) or not category.strip() or len(category.strip()) > 60:
            raise ValueError("A category is required (60 characters max)")
        if type(price) is not int or price < 0 or price > 100000:
            raise ValueError("Price must be a whole number of cents")
        return name.strip(), description.strip(), category.strip(), price

    def create_menu_item(self, data):
        try:
            values = self.menu_values(data)
        except ValueError as error:
            return self.send_json(400, {"error": str(error)})
        with connect() as db:
            cursor = db.execute(
                "INSERT INTO menu_items (name, description, category, price_cents) VALUES (?, ?, ?, ?)",
                values,
            )
            row = db.execute("SELECT * FROM menu_items WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return self.send_json(201, as_dict(row))

    def update_menu_item(self, item_id, data):
        try:
            values = self.menu_values(data)
        except ValueError as error:
            return self.send_json(400, {"error": str(error)})
        with connect() as db:
            cursor = db.execute(
                "UPDATE menu_items SET name = ?, description = ?, category = ?, price_cents = ? WHERE id = ?",
                values + (item_id,),
            )
        if cursor.rowcount == 0:
            return self.send_json(404, {"error": "Menu item not found"})
        return self.send_json(200, {"ok": True})

    def update_status(self, kind, item_id, data):
        status = data.get("status")
        allowed = {
            "orders": {"received", "preparing", "ready", "completed", "cancelled"},
            "reservations": {"requested", "confirmed", "seated", "completed", "cancelled"},
        }
        if status not in allowed[kind]:
            return self.send_json(400, {"error": "Invalid status"})
        table = kind
        with connect() as db:
            cursor = db.execute("UPDATE %s SET status = ? WHERE id = ?" % table, (status, item_id))
        if cursor.rowcount == 0:
            return self.send_json(404, {"error": "Record not found"})
        return self.send_json(200, {"ok": True})


if __name__ == "__main__":
    if len(ADMIN_PASSWORD) < 12:
        raise SystemExit("Set ADMIN_PASSWORD to a strong passphrase of at least 12 characters before starting.")
    initialize()
    port = int(os.environ.get("PORT", "8000"))
    print("Restaurant site ready at http://localhost:%d" % port)
    host = os.environ.get("HOST", "127.0.0.1")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
