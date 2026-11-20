"""MATERIALHUNT — SQLite persistence layer.

Implements salted PBKDF2-SHA256 authentication, KYB organization records,
SaaS subscription tiers, Summit VIP fee waivers, audit logging, customer
feedback and persistent admin-vault lockout state. 100% offline.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(__file__).resolve().parent / "materialhunt.db"

PBKDF2_ITERATIONS = 260_000
SESSION_HOURS = 24
ADMIN_MAX_ATTEMPTS = 3
ADMIN_LOCK_MINUTES = 15
ADMIN_PASSKEY = "MH_FOUNDER_2026#"
WAIVER_LABEL = "VIP GRANT \u2014 FEE WAIVED (\u20b90)"
KYB_VERIFIED_BADGE = "ENTERPRISE VIP \u00b7 KYB VERIFIED"

TIERS: dict[str, dict[str, Any]] = {
    "free": {
        "key": "free",
        "name": "Free Starter",
        "price": 0,
        "price_label": "\u20b90 / forever",
        "limit": 3,
        "features": ["3 pre-screens / month", "Magpie ML predictions", "Community support"],
    },
    "pro": {
        "key": "pro",
        "name": "Pro Lab",
        "price": 4999,
        "price_label": "\u20b94,999 / month",
        "limit": 100,
        "features": ["100 pre-screens / month", "Uncertainty grading", "PDF lab reports", "Plotly analytics"],
    },
    "enterprise": {
        "key": "enterprise",
        "name": "Enterprise R&D",
        "price": 19999,
        "price_label": "\u20b919,999 / month",
        "limit": 10000,
        "features": ["Unlimited materials", "KYB + hazardous-element clearance", "Admin API + audit trail", "Priority metallurgist support"],
    },
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime] = None) -> str:
    return (dt or utcnow()).replace(microsecond=0).isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ---------------------------------------------------------------------------
# Password hashing — PBKDF2-HMAC-SHA256 with a per-user 16-byte random salt
# ---------------------------------------------------------------------------
def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    if not isinstance(password, str) or len(password) < 6:
        raise ValueError("Password must contain at least 6 characters.")
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, iterations, salt_hex, digest_hex = encoded.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(candidate.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                organization_name TEXT NOT NULL DEFAULT '',
                org_id TEXT NOT NULL DEFAULT '',
                kyb_status TEXT NOT NULL DEFAULT 'pending',
                tier TEXT NOT NULL DEFAULT 'free',
                billing_status TEXT NOT NULL DEFAULT 'ACTIVE',
                billing_waived INTEGER NOT NULL DEFAULT 0,
                waiver_note TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'member',
                created_at TEXT NOT NULL,
                last_login TEXT
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '',
                ip TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                email TEXT NOT NULL DEFAULT '',
                rating INTEGER NOT NULL CHECK(rating BETWEEN 0 AND 5),
                category TEXT NOT NULL DEFAULT 'General',
                message TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'Open',
                created_at TEXT NOT NULL,
                resolved_at TEXT
            );

            CREATE TABLE IF NOT EXISTS global_rd_leaderboard (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                actor TEXT NOT NULL,
                dataset TEXT NOT NULL,
                formula TEXT NOT NULL,
                predicted REAL NOT NULL,
                unit TEXT NOT NULL,
                confidence TEXT NOT NULL,
                rank_score REAL NOT NULL,
                persona TEXT NOT NULL DEFAULT '',
                discovery_note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS discovery_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                actor TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                formula TEXT NOT NULL DEFAULT '',
                verdict TEXT NOT NULL DEFAULT '',
                detail TEXT NOT NULL DEFAULT '',
                ip TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS admin_guard (
                ip TEXT PRIMARY KEY,
                attempts INTEGER NOT NULL DEFAULT 0,
                locked_until TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
            CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON global_rd_leaderboard(rank_score DESC);
            CREATE INDEX IF NOT EXISTS idx_discovery_endpoint ON discovery_audit(endpoint);
            """
        )
        conn.execute(
            """INSERT INTO app_settings(key, value) VALUES(?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            ("admin_passkey_hash", hash_password(ADMIN_PASSKEY)),
        )
        # Keep the documented founder console credentials deterministic across
        # restarts, and migrate legacy demo rows to the commercial billing label.
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE email = ?",
            (hash_password(ADMIN_PASSKEY), "admin@materialhunt.ai"),
        )
        conn.execute(
            "UPDATE users SET billing_status = ? WHERE billing_waived = 1 AND billing_status != 'INTERNAL'",
            (WAIVER_LABEL,),
        )
        _seed_users(conn)
        _seed_feedback(conn)
        _seed_leaderboard(conn)


def _seed_users(conn: sqlite3.Connection) -> None:
    """Seed the offline demo accounts. Passwords are salted and hashed."""
    demo_users = [
        {
            "email": "admin@materialhunt.ai",
            "password": ADMIN_PASSKEY,
            "organization_name": "MATERIALHUNT Inc. — Founder Office",
            "org_id": "MH-CORE-ADMIN",
            "kyb_status": "approved",
            "tier": "enterprise",
            "billing_status": "INTERNAL",
            "billing_waived": 1,
            "waiver_note": "Internal platform administration",
            "role": "admin",
        },
        {
            "email": "demo@materialhunt.ai",
            "password": "Demo@2026",
            "organization_name": "IIT Bombay Metallurgy Lab",
            "org_id": "MH-KYB-77120",
            "kyb_status": "approved",
            "tier": "pro",
            "billing_status": "ACTIVE",
            "billing_waived": 0,
            "waiver_note": "",
            "role": "member",
        },
        {
            "email": "rnd@vajra-aero.in",
            "password": "Vajra@2026",
            "organization_name": "Vajra Aerospace Materials Pvt Ltd",
            "org_id": "MH-KYB-99401",
            "kyb_status": "pending",
            "tier": "free",
            "billing_status": "PENDING KYB",
            "billing_waived": 0,
            "waiver_note": "",
            "role": "member",
        },
    ]
    for u in demo_users:
        exists = conn.execute("SELECT 1 FROM users WHERE email = ?", (u["email"],)).fetchone()
        if exists:
            continue
        conn.execute(
            """INSERT INTO users
               (email, password_hash, organization_name, org_id, kyb_status, tier,
                billing_status, billing_waived, waiver_note, role, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                u["email"], hash_password(u["password"]), u["organization_name"], u["org_id"],
                u["kyb_status"], u["tier"], u["billing_status"], u["billing_waived"],
                u["waiver_note"], u["role"], iso(),
            ),
        )


def _seed_feedback(conn: sqlite3.Connection) -> None:
    row = conn.execute("SELECT COUNT(*) AS c FROM feedback").fetchone()
    if row and row["c"]:
        return
    demo = conn.execute("SELECT id, email FROM users WHERE email = ?", ("demo@materialhunt.ai",)).fetchone()
    samples = [
        (5, "Prediction Quality", "The uncertainty band matched our tensile coupon within 4%. Brilliant for pre-screening."),
        (4, "3D Visualisation", "Lattice viewer is gorgeous. Would love a dislocation-density overlay in the next release."),
        (2, "Bug Report", "PDF export button was slow on the expo Wi-Fi. Offline mode works perfectly now."),
    ]
    for rating, category, message in samples:
        conn.execute(
            "INSERT INTO feedback(user_id, email, rating, category, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
            (demo["id"] if demo else None, demo["email"] if demo else "demo@materialhunt.ai",
             rating, category, message, "Open" if rating < 5 else "Reviewed", iso()),
        )


def _seed_leaderboard(conn: sqlite3.Connection) -> None:
    """Seed the Global R&D Discovery Leaderboard with verified pilot results."""
    row = conn.execute("SELECT COUNT(*) AS c FROM global_rd_leaderboard").fetchone()
    if row and row["c"]:
        return
    demo = conn.execute("SELECT id, email, organization_name FROM users WHERE email = ?",
                        ("demo@materialhunt.ai",)).fetchone()
    samples = [
        ("steels", "Fe-18Cr-10Ni-3Mo", 1184.0, "MPa", "High", 96.4, "IIT Bombay Metallurgy Lab", "Marine-grade stainless screening"),
        ("steels", "Ti-6Al-4V", 1042.0, "MPa", "High", 94.8, "Vajra Aerospace Materials", "Aerospace structural coupon"),
        ("steels", "Ni-718-3Mo", 1310.0, "MPa", "Medium", 92.1, "MATERIALHUNT Inc. — Founder Office", "High-temperature turbine study"),
        ("steels", "Al-7075-T6", 572.0, "MPa", "High", 90.6, "IIT Bombay Metallurgy Lab", "EV lightweighting campaign"),
        ("steels", "Fe-12Cr-2Mo", 961.0, "MPa", "Medium", 88.9, "Vajra Aerospace Materials", "Pressure-vessel alloy shortlist"),
    ]
    for dataset, formula, predicted, unit, confidence, score, org, note in samples:
        conn.execute(
            "INSERT INTO global_rd_leaderboard(user_id, actor, dataset, formula, predicted, unit, confidence, "
            "rank_score, persona, discovery_note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (demo["id"] if demo else None, org, dataset, formula, predicted, unit,
             confidence, score, "Aerospace", note, iso()),
        )


# ---------------------------------------------------------------------------
# User / session helpers
# ---------------------------------------------------------------------------
def _user_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    tier = row["tier"] if row["tier"] in TIERS else "free"
    return {
        "id": row["id"],
        "email": row["email"],
        "organization_name": row["organization_name"],
        "org_id": row["org_id"],
        "kyb_status": row["kyb_status"],
        "kyb_badge": KYB_VERIFIED_BADGE if row["kyb_status"] == "approved" else "KYB VERIFICATION PENDING",
        "tier": tier,
        "tier_name": TIERS[tier]["name"],
        "tier_price": TIERS[tier]["price"],
        "billing_status": row["billing_status"],
        "billing_waived": bool(row["billing_waived"]),
        "waiver_note": row["waiver_note"],
        "role": row["role"],
        "created_at": row["created_at"],
        "last_login": row["last_login"],
    }


def _generate_org_id() -> str:
    return f"MH-KYB-{secrets.randbelow(90000) + 10000}"


def create_user(
    email: str,
    password: str,
    organization_name: str = "",
    org_id: str = "",
    kyb_status: str = "pending",
    tier: str = "free",
    billing_status: Optional[str] = None,
    billing_waived: bool = False,
    waiver_note: str = "",
    role: str = "member",
) -> dict[str, Any]:
    email = email.strip().lower()
    organization_name = organization_name.strip() or "Independent Lab"
    org_id = org_id.strip() or _generate_org_id()
    tier = tier if tier in TIERS else "free"
    if billing_status is None:
        billing_status = WAIVER_LABEL if billing_waived else "ACTIVE"
    with get_conn() as conn:
        existing = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            raise ValueError("An account with this email already exists.")
        cursor = conn.execute(
            """INSERT INTO users
               (email, password_hash, organization_name, org_id, kyb_status, tier,
                billing_status, billing_waived, waiver_note, role, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (email, hash_password(password), organization_name, org_id, kyb_status, tier,
             billing_status, 1 if billing_waived else 0, waiver_note, role, iso()),
        )
        row = conn.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _user_to_dict(row)


def create_guest_summit() -> tuple[dict[str, Any], str]:
    """Create an Enterprise VIP pilot guest (legacy name kept as an alias)."""
    return create_pilot_user("live_demo")


def create_pilot_user(mode: str = "live_demo",
                      email: Optional[str] = None,
                      password: Optional[str] = None,
                      organization_name: str = "MATERIALHUNT Interactive R&D Sandbox") -> tuple[dict[str, Any], str]:
    token_suffix = secrets.token_hex(4)
    guest = create_user(
        email=email or f"pilot-{token_suffix}@guest.materialhunt.ai",
        password=password or secrets.token_urlsafe(24),
        organization_name=organization_name,
        org_id="MH-VIP-GRANT",
        kyb_status="approved",
        tier="enterprise",
        billing_status=WAIVER_LABEL,
        billing_waived=True,
        waiver_note=f"{mode} pilot grant — Enterprise VIP access",
        role="guest",
    )
    token = create_session(guest["id"])
    return guest, token


def authenticate(email: str, password: str) -> Optional[dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()
        if not row or not verify_password(password, row["password_hash"]):
            return None
        conn.execute("UPDATE users SET last_login = ? WHERE id = ?", (iso(), row["id"]))
        refreshed = conn.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
        return _user_to_dict(refreshed)


def get_user(user_id: int) -> Optional[dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _user_to_dict(row) if row else None


def create_session(user_id: int, hours: int = SESSION_HOURS) -> str:
    token = secrets.token_urlsafe(36)
    now = utcnow()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, iso(now), iso(now + timedelta(hours=hours))),
        )
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (iso(now),))
    return token


def get_user_by_token(token: str) -> Optional[dict[str, Any]]:
    if not token:
        return None
    with get_conn() as conn:
        row = conn.execute(
            """SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token = ? AND s.expires_at > ?""",
            (token, iso()),
        ).fetchone()
        return _user_to_dict(row) if row else None


def revoke_session(token: str) -> None:
    if not token:
        return
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


def list_users() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM users ORDER BY id ASC").fetchall()
        users = []
        for row in rows:
            item = _user_to_dict(row)
            item["last_login"] = row["last_login"]
            users.append(item)
        return users


def waive_fee(user_id: int, note: str = "VIP grant issued from founder console") -> Optional[dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            return None
        conn.execute(
            """UPDATE users SET tier = 'enterprise', billing_waived = 1,
               billing_status = ?, waiver_note = ? WHERE id = ?""",
            (WAIVER_LABEL, note, user_id),
        )
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _user_to_dict(updated)


def approve_kyb(user_id: int) -> Optional[dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            return None
        conn.execute(
            "UPDATE users SET kyb_status = 'approved', billing_status = CASE WHEN billing_waived = 1 THEN billing_status ELSE 'ACTIVE' END WHERE id = ?",
            (user_id,),
        )
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _user_to_dict(updated)


def set_user_tier(user_id: int, tier: str) -> Optional[dict[str, Any]]:
    if tier not in TIERS:
        raise ValueError("Unknown subscription tier.")
    with get_conn() as conn:
        conn.execute("UPDATE users SET tier = ? WHERE id = ?", (tier, user_id))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _user_to_dict(row) if row else None


# ---------------------------------------------------------------------------
# Audit + feedback
# ---------------------------------------------------------------------------
def log_audit(actor: str, action: str, detail: str = "", user_id: Optional[int] = None,
              ip: str = "") -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO audit_logs(user_id, actor, action, detail, ip, created_at) VALUES (?,?,?,?,?,?)",
            (user_id, actor, action, detail, ip, iso()),
        )


def list_audit(limit: int = 40) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]


def add_feedback(user_id: Optional[int], email: str, rating: int, category: str,
                 message: str) -> dict[str, Any]:
    rating = max(0, min(5, int(rating)))
    with get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO feedback(user_id, email, rating, category, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
            (user_id, email, rating, category, message.strip(), "Open", iso()),
        )
        row = conn.execute("SELECT * FROM feedback WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)


def list_feedback() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM feedback ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Global R&D Discovery Leaderboard
# ---------------------------------------------------------------------------
def record_discovery(user_id: Optional[int], actor: str, endpoint: str, formula: str,
                     verdict: str, detail: str = "", ip: str = "") -> dict[str, Any]:
    with get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO discovery_audit(user_id, actor, endpoint, formula, verdict, detail, ip, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (user_id, actor, endpoint, formula, verdict, detail, ip, iso()),
        )
        return dict(conn.execute("SELECT * FROM discovery_audit WHERE id = ?", (cursor.lastrowid,)).fetchone())


def list_discovery(limit: int = 40) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM discovery_audit ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]


def push_leaderboard(user_id: Optional[int], actor: str, dataset: str, formula: str,
                     predicted: float, unit: str, confidence: str, rank_score: float,
                     persona: str = "", discovery_note: str = "") -> dict[str, Any]:
    with get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO global_rd_leaderboard(user_id, actor, dataset, formula, predicted, unit, confidence, "
            "rank_score, persona, discovery_note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (user_id, actor, dataset, formula, float(predicted), unit, confidence,
             float(rank_score), persona, discovery_note, iso()),
        )
        return dict(conn.execute("SELECT * FROM global_rd_leaderboard WHERE id = ?", (cursor.lastrowid,)).fetchone())


def leaderboard(limit: int = 50) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT l.*, u.email, u.organization_name FROM global_rd_leaderboard l "
            "LEFT JOIN users u ON u.id = l.user_id "
            "ORDER BY l.rank_score DESC, l.id ASC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def leaderboard_stats() -> dict[str, Any]:
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM global_rd_leaderboard").fetchone()["c"]
        top = conn.execute(
            "SELECT l.rank_score, l.dataset, l.formula, l.confidence, l.created_at, u.email, u.organization_name "
            "FROM global_rd_leaderboard l LEFT JOIN users u ON u.id = l.user_id "
            "ORDER BY l.rank_score DESC, l.id ASC LIMIT 1"
        ).fetchone()
        by_dataset = conn.execute(
            "SELECT dataset, COUNT(*) AS c FROM global_rd_leaderboard GROUP BY dataset"
        ).fetchall()
    return {
        "total_discoveries": int(total),
        "top": dict(top) if top else None,
        "by_dataset": {r["dataset"]: r["c"] for r in by_dataset},
    }


def update_feedback(feedback_id: int, status: str) -> Optional[dict[str, Any]]:
    if status not in {"Open", "Reviewed", "Resolved", "Dismissed"}:
        raise ValueError("Invalid triage status.")
    with get_conn() as conn:
        conn.execute(
            "UPDATE feedback SET status = ?, resolved_at = ? WHERE id = ?",
            (status, iso() if status in {"Resolved", "Dismissed"} else None, feedback_id),
        )
        row = conn.execute("SELECT * FROM feedback WHERE id = ?", (feedback_id,)).fetchone()
        return dict(row) if row else None


# ---------------------------------------------------------------------------
# Admin vault — salted passkey + persistent 3-attempt lockout
# ---------------------------------------------------------------------------
def verify_admin_passkey(passkey: str) -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM app_settings WHERE key = 'admin_passkey_hash'").fetchone()
        if not row:
            return False
        return verify_password(passkey or "", row["value"])


def admin_lock_state(ip: str) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM admin_guard WHERE ip = ?", (ip,)).fetchone()
        if not row:
            return {"attempts": 0, "locked": False, "retry_after": 0}
        locked_until = row["locked_until"]
        if locked_until:
            try:
                until = datetime.fromisoformat(locked_until)
                remaining = (until - utcnow()).total_seconds()
                if remaining > 0:
                    return {"attempts": row["attempts"], "locked": True,
                            "retry_after": int(remaining) + 1}
            except ValueError:
                pass
        return {"attempts": row["attempts"], "locked": False, "retry_after": 0}


def record_admin_attempt(ip: str, success: bool) -> dict[str, Any]:
    now = utcnow()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM admin_guard WHERE ip = ?", (ip,)).fetchone()
        if success:
            conn.execute(
                "INSERT INTO admin_guard(ip, attempts, locked_until, updated_at) VALUES (?,0,NULL,?) "
                "ON CONFLICT(ip) DO UPDATE SET attempts = 0, locked_until = NULL, updated_at = excluded.updated_at",
                (ip, iso(now)),
            )
            return {"attempts": 0, "locked": False, "remaining_attempts": ADMIN_MAX_ATTEMPTS}
        attempts = (row["attempts"] if row else 0) + 1
        if attempts >= ADMIN_MAX_ATTEMPTS:
            locked_until = now + timedelta(minutes=ADMIN_LOCK_MINUTES)
            conn.execute(
                "INSERT INTO admin_guard(ip, attempts, locked_until, updated_at) VALUES (?,?,?,?) "
                "ON CONFLICT(ip) DO UPDATE SET attempts = excluded.attempts, locked_until = excluded.locked_until, updated_at = excluded.updated_at",
                (ip, attempts, iso(locked_until), iso(now)),
            )
            return {"attempts": attempts, "locked": True,
                    "retry_after": ADMIN_LOCK_MINUTES * 60,
                    "remaining_attempts": 0}
        conn.execute(
            "INSERT INTO admin_guard(ip, attempts, locked_until, updated_at) VALUES (?,?,NULL,?) "
            "ON CONFLICT(ip) DO UPDATE SET attempts = excluded.attempts, updated_at = excluded.updated_at",
            (ip, attempts, iso(now)),
        )
        return {"attempts": attempts, "locked": False,
                "remaining_attempts": ADMIN_MAX_ATTEMPTS - attempts}


def overview_stats() -> dict[str, Any]:
    with get_conn() as conn:
        users = conn.execute("SELECT * FROM users").fetchall()
        feedback = conn.execute("SELECT * FROM feedback").fetchall()
        audits = conn.execute("SELECT COUNT(*) AS c FROM audit_logs").fetchone()["c"]
    tier_counts = {k: 0 for k in TIERS}
    mrr = 0
    waived = 0
    pending_kyb = 0
    for u in users:
        tier = u["tier"] if u["tier"] in TIERS else "free"
        tier_counts[tier] += 1
        if u["billing_waived"]:
            waived += 1
        else:
            mrr += TIERS[tier]["price"]
        if u["kyb_status"] == "pending":
            pending_kyb += 1
    ratings = [f["rating"] for f in feedback] or [0]
    stats = {
        "total_users": len(users),
        "tier_counts": tier_counts,
        "mrr_inr": mrr,
        "waived_accounts": waived,
        "pending_kyb": pending_kyb,
        "feedback_count": len(feedback),
        "open_feedback": sum(1 for f in feedback if f["status"] == "Open"),
        "avg_rating": round(sum(ratings) / len(ratings), 2),
        "audit_events": audits,
        "tiers": TIERS,
        "waiver_label": WAIVER_LABEL,
    }
    stats.update(leaderboard_stats())
    return stats


def admin_snapshot() -> dict[str, Any]:
    return {
        "overview": overview_stats(),
        "users": list_users(),
        "feedback": list_feedback(),
        "leaderboard": leaderboard(25),
        "discovery": list_discovery(25),
        "audit": list_audit(30),
        "tiers": TIERS,
        "waiver_label": WAIVER_LABEL,
    }


if __name__ == "__main__":
    init_db()
    print(f"Initialised MATERIALHUNT SQLite database at {DB_PATH}")
    print(json.dumps(overview_stats(), indent=2, ensure_ascii=False))
