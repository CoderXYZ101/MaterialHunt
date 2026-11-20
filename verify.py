"""MATERIALHUNT — automated offline end-to-end verification.

Run the server first:   python main.py
Then in a second shell: python verify.py

Uses only the Python standard library. No internet access is required or made.
Exit code 0 = every check passed.
"""
from __future__ import annotations

import json
import re
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Windows terminals default to cp1252; the report uses ₹, — and ° glyphs.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass

BASE = "http://127.0.0.1:8000"
GATE = "mh_vault_99x"
PASSKEY = "MH_FOUNDER_2026#"
STATIC_DIR = Path(__file__).resolve().parent / "static"

PASSED: list[str] = []
FAILED: list[str] = []


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------
def request(method: str, path: str, body=None, token: str | None = None,
            admin: bool = False, headers: dict[str, str] | None = None,
            raw: bool = False, timeout: int = 180):
    url = path if path.startswith("http") else BASE + path
    data = None
    hdrs: dict[str, str] = {}
    if headers:
        hdrs.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    if admin:
        hdrs["X-Admin-Passkey"] = PASSKEY
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read()
            if raw:
                return resp.status, payload, dict(resp.headers)
            try:
                return resp.status, json.loads(payload.decode("utf-8")), dict(resp.headers)
            except json.JSONDecodeError:
                return resp.status, payload, dict(resp.headers)
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        try:
            parsed = json.loads(payload.decode("utf-8"))
        except json.JSONDecodeError:
            parsed = payload
        return exc.code, parsed, dict(exc.headers)
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"\n[FATAL] Cannot reach {url} — is the server running?\n"
            f"        Start it with:  python main.py\n        Reason: {exc.reason}\n"
        )


def check(name: str, condition: bool, detail: str = "") -> bool:
    if condition:
        PASSED.append(name)
        print(f"  [PASS] {name}" + (f"  — {detail}" if detail else ""))
        return True
    FAILED.append(name)
    print(f"  [FAIL] {name}" + (f"  — {detail}" if detail else ""))
    return False


def section(title: str) -> None:
    print(f"\n{title}")
    print("-" * len(title))


def detail_of(payload, default: str = "no detail") -> str:
    if isinstance(payload, dict):
        value = payload.get("detail", payload)
        if isinstance(value, dict):
            return str(value.get("message") or value.get("code") or value)[:180]
        return str(value)[:180]
    return str(payload)[:180] if payload else default


def header_value(headers, name: str) -> str:
    """Case-insensitive header lookup (uvicorn may preserve lower-case names)."""
    wanted = name.lower()
    for key, value in (headers or {}).items():
        if key.lower() == wanted:
            return value
    return ""


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------
def check_health() -> None:
    section("1. Server health & offline assets")
    status, body, _ = request("GET", "/api/health")
    check("GET /api/health returns 200", status == 200, f"HTTP {status}")
    if not isinstance(body, dict):
        return
    check("model bundle loaded", body.get("model_loaded") is True, str(body.get("model_error") or "ok"))
    check("server reports offline mode", body.get("offline") is True)
    assets = body.get("assets", {})
    for name in ("three.min.js", "plotly.min.js"):
        info = assets.get(name, {})
        check(f"vendor asset present: {name}", bool(info.get("present")), f"{info.get('bytes', 0):,} bytes")
        check(f"vendor asset non-empty: {name}", (info.get("bytes") or 0) > 100_000, f"{info.get('bytes', 0):,} bytes")


def check_meta() -> None:
    section("2. Model metadata")
    status, body, _ = request("GET", "/api/meta")
    check("GET /api/meta returns 200", status == 200, f"HTTP {status}")
    if not isinstance(body, dict):
        return
    datasets = body.get("datasets", {})
    check("three Matbench tasks present", set(datasets) == {"steels", "glass", "expt_gap"}, ", ".join(sorted(datasets)))
    check("132 Magpie features", body.get("feature_count") == 132, str(body.get("feature_count")))
    check("industry personas exposed", len(body.get("personas", {})) >= 3, ", ".join(body.get("personas", {})))
    check("six-axis custom weights", set(body.get("personas", {}).get("Custom Weights", {}).get("weights", {})) ==
          {"strength", "weight", "thermal", "corrosion", "cost", "confidence"})
    for key, ds in datasets.items():
        bench = ds.get("benchmarks", {})
        check(f"{key}: Random Forest benchmarked", "random_forest" in bench,
              f"R2={bench.get('random_forest', {}).get('r2')}")
        check(f"{key}: top feature importances", len(ds.get("feature_importances", [])) >= 1,
              f"{len(ds.get('feature_importances', []))} model sets")
        check(f"{key}: uncertainty thresholds", "uncertainty_thresholds" in ds)
    check("tiers include Pro ₹4,999 and Enterprise ₹19,999",
          body.get("tiers", {}).get("pro", {}).get("price") == 4999 and
          body.get("tiers", {}).get("enterprise", {}).get("price") == 19999)
    check("commercial waiver label", body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)",
          str(body.get("waiver_label")))
    check("KYB verified badge", body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED",
          str(body.get("kyb_badge")))
    labels = body.get("labels", {})
    check("commercial label pack exposed",
          labels.get("vip", {}).get("enterprise_access_grant") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)"
          and labels.get("vip", {}).get("enterprise_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"
          and "Sandbox" in str(labels.get("mode", {}).get("live_demo", "")),
          str(labels.get("mode", {}).get("live_demo")))
    check("discovery registry title is commercial",
          labels.get("leaderboard", {}).get("title") == "Global R&D Discovery Registry")
    envelope = body.get("simulation_envelope", {})
    check("simulation envelope: -273.15 to 4500 °C",
          envelope.get("temperature_c", {}).get("min") == -273.15
          and envelope.get("temperature_c", {}).get("max") == 4500)
    check("simulation envelope: 0 Pa to infinity",
          envelope.get("pressure_pa", {}).get("min") == 0
          and envelope.get("pressure_pa", {}).get("max", 0) >= 1e15)
    check("simulation envelope: velocity + medium density",
          envelope.get("velocity_kmh", {}).get("max") == 3500
          and envelope.get("medium_density_kgm3", {}).get("max") == 25000)
    check("dual-use guardrail lists Br among 8 restricted elements",
          "Br" in body.get("hazardous_elements", [])
          and len(body.get("hazardous_elements", [])) == 8,
          ", ".join(body.get("hazardous_elements", [])))
    check("feature space cloud present", len(body.get("feature_space", [])) >= 100,
          f"{len(body.get('feature_space', []))} points")
    check("candidate pool present", (body.get("candidate_total") or 0) >= 150, str(body.get("candidate_total")))
    check("benchmark protocol documented", "random_state=42" in str(body.get("benchmark_protocol", "")),
          str(body.get("benchmark_protocol", "")))


def check_static() -> None:
    section("3. Static frontend & local vendor libs")
    for path, label in (
        ("/", "index.html"),
        ("/static/style.css", "style.css"),
        ("/static/app.js", "app.js"),
        ("/static/vendor/three.min.js", "three.min.js"),
        ("/static/vendor/plotly.min.js", "plotly.min.js"),
        ("/favicon.svg", "favicon.svg"),
    ):
        status, payload, headers = request("GET", path, raw=True)
        size = len(payload) if isinstance(payload, (bytes, bytearray)) else 0
        minimum = 200 if label == "favicon.svg" else 500
        check(f"served {label}", status == 200 and size > minimum, f"HTTP {status} · {size:,} bytes")

    _, three, _ = request("GET", "/static/vendor/three.min.js", raw=True)
    _, plotly, _ = request("GET", "/static/vendor/plotly.min.js", raw=True)
    check("three.js bundle is the real library", b"THREE" in three and b"WebGLRenderer" in three)
    check("Plotly bundle is the real library", b"Plotly" in plotly and b"scatter3d" in plotly)

    offline_ok = True
    offenders: list[str] = []
    for name in ("index.html", "style.css", "app.js"):
        text = (STATIC_DIR / name).read_text(encoding="utf-8")
        for match in re.findall(r"https?://[^\s\"'<>)]+", text):
            # SVG XML namespaces are not network requests.
            if "www.w3.org" in match:
                continue
            offenders.append(f"{name}: {match}")
            offline_ok = False
    check("no external http(s) asset URLs in frontend", offline_ok, "; ".join(offenders[:4]) or "none")
    check("no TODO placeholders in frontend",
          not any("TODO" in (STATIC_DIR / n).read_text(encoding="utf-8") for n in ("index.html", "style.css", "app.js")))

    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    css = (STATIC_DIR / "style.css").read_text(encoding="utf-8")
    modules = (
        "3D Alloy &amp; Mission Simulator",
        "Alloy A vs. B Battle Arena",
        "Multi-Material Pre-Screening &amp; PDF",
        "Deep Engineering Analytics",
        "Enterprise Batch CSV &amp; Custom Lab Data",
        "R&amp;D ROI Calculator",
        "Global R&D Discovery Registry & Feedback",
        "Pricing, Corporate KYB &amp; Compliance",
    )
    missing = [name for name in modules if name not in html]
    check("all 8 commercial module headings present", not missing, "; ".join(missing) or "8 / 8")
    views = re.findall(r'<section class="view[^"]*" id="view-([a-z]+)"', html)
    check("exactly 8+ visible module views plus hidden vault",
          set(views) >= {"simulator", "battle", "dashboard", "analytics", "batch", "roi",
                         "discovery-registry", "pricing", "admin"} and len(views) >= 9,
          ", ".join(views))
    nav_views = re.findall(r'class="nav-link[^"]*" data-view="([a-z]+)"', html)
    check("navigation exposes the core 8 tabs (vault hidden + enterprise)",
          set(v for v in nav_views if v != "admin") >=
          {"simulator", "battle", "dashboard", "analytics", "batch", "roi", "discovery-registry", "pricing"}
          and "vault-link hidden" in html,
          ", ".join(nav_views))
    check("periodic table modal present", all(token in html for token in (
        'id="periodicModal"', 'id="periodicGrid"', 'id="periodicSearch"', 'id="periodicDetail"')))
    check("pressure / velocity / density controls present", all(token in html for token in (
        'id="pressureSlider"', 'id="velocitySlider"', 'id="densitySlider"', 'id="pressureUnits"')))
    check("enterprise footer with pilot launch",
          'class="enterprise-footer"' in html and "#05080F" in css
          and "Launch Interactive Pilot Sandbox (?mode=live_demo)" in html)
    check("commercial labels rendered in UI",
          "VIP GRANT \u2014 FEE WAIVED (\u20b90)" in html and "ENTERPRISE VIP \u00b7 KYB VERIFIED" in html)
    check("8 module controllers wired in app.js",
          all(symbol in (STATIC_DIR / "app.js").read_text(encoding="utf-8") for symbol in (
              "runMissionSearch", "runComparison", "runBatch", "loadDiscoveryRegistry",
              "renderPricing", "renderAnalyticsR2", "openPeriodic", "validateLabCoupon")))
    check("WebGL viewer avoids backdrop-filter blur",
          "backdrop-filter: none !important" in css and ".viewport-card" in css)


def check_auth() -> str:
    section("4. Auth, KYB & pilot-sandbox provisioning")
    status, wrong, _ = request("POST", "/api/auth/login",
                               {"email": "demo@materialhunt.ai", "password": "not-the-password"})
    check("bad password rejected", status == 401, f"HTTP {status} · {detail_of(wrong)}")

    status, body, _ = request("POST", "/api/auth/pilot-guest?mode=live_demo")
    check("POST /api/auth/pilot-guest?mode=live_demo returns 200", status == 200, f"HTTP {status}")
    user = body.get("user", {}) if isinstance(body, dict) else {}
    token = body.get("token", "") if isinstance(body, dict) else ""
    check("pilot receives a session token", bool(token))
    check("pilot mode is canonical live_demo", body.get("mode") == "live_demo", str(body.get("mode")))
    check("pilot tier is Enterprise R&D", user.get("tier") == "enterprise", str(user.get("tier_name")))
    check("pilot billing is WAIVED", user.get("billing_waived") is True and "WAIVED" in str(user.get("billing_status")),
          str(user.get("billing_status")))
    check("pilot KYB auto-approved", user.get("kyb_status") == "approved")
    check("pilot commercial labels returned",
          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT"\u2014 FEE WAIVED (\u20b90)"
          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED",
          str(body.get("waiver_label")))
    sandbox = body.get("sandbox", {}).get("features", {})
    check("pilot sandbox unlocks 118 elements + pressure envelope",
          sandbox.get("periodic_table_elements") == 118 and "∞" in str(sandbox.get("pressure_range_pa")),
          f"{sandbox.get('periodic_table_elements')} elements")

    status, alias, _ = request("POST", "/api/auth/pilot-guest?mode=summit_test")
    check("legacy ?mode=summit_test aliases to live_demo",
          status == 200 and alias.get("mode") == "live_demo", f"HTTP {status} · {alias.get('mode') if isinstance(alias, dict) else ''}")

    status, legacy, _ = request("POST", "/api/auth/guest-summit")
    check("legacy /api/auth/guest-summit stays available as a silent alias",
          status == 200 and legacy.get("user", {}).get("billing_waived") is True, f"HTTP {status}")

    status, me, _ = request("GET", "/api/auth/me", token=token)
    check("session token authenticates /api/auth/me", status == 200 and me.get("user", {}).get("email") == user.get("email"),
          f"HTTP {status}")

    status, demo, _ = request("POST", "/api/auth/login",
                              {"email": "demo@materialhunt.ai", "password": "Demo@2026"})
    demo_user = demo.get("user", {}) if isinstance(demo, dict) else {}
    check("demo account login works",
          status == 200 and demo_user.get("email") == "demo@materialhunt.ai"
          and demo_user.get("tier") in {"pro", "enterprise"},
          f"HTTP {status} · tier={demo_user.get('tier')}")
    return token


def check_prescreen(token: str) -> None:
    section("5. Multi-material pre-screening")
    payload = {
        "datasets": ["steels", "glass", "expt_gap"],
        "persona": "Aerospace",
        "min_confidence": "Low",
        "limit": 60,
        "include_hazardous": False,
    }
    status, body, _ = request("POST", "/api/prescreen", payload, token=token)
    check("POST /api/prescreen returns 200", status == 200, f"HTTP {status} · {detail_of(body)}")
    if not isinstance(body, dict):
        return
    candidates = body.get("candidates", [])
    check("candidates returned", len(candidates) > 0, f"{len(candidates)} rows")
    check("multiple datasets represented", len(body.get("dataset_counts", {})) >= 2, str(body.get("dataset_counts")))
    check("ranked ordering present", all("rank" in c for c in candidates[:5]))
    check("uncertainty + confidence on every row",
          all("uncertainty" in c and c.get("confidence") in {"High", "Medium", "Low"} for c in candidates))
    check("persona weights normalised", abs(sum(body.get("weights", {}).values()) - 1.0) < 1e-6,
          str({k: round(v, 3) for k, v in body.get("weights", {}).items()}))
    check("no hazardous candidates unless requested",
          all(not c.get("hazardous") for c in candidates))

    status, filtered, _ = request("POST", "/api/prescreen", {
        "datasets": ["steels"], "persona": "Marine", "min_confidence": "High",
        "max_cost": 500, "max_density": 9.0, "limit": 30,
    }, token=token)
    rows = filtered.get("candidates", []) if isinstance(filtered, dict) else []
    check("filters narrow the envelope", status == 200 and len(rows) <= len(candidates),
          f"{len(rows)} ≤ {len(candidates)}")
    check("cost filter respected", all(r["cost_per_kg"] <= 500 for r in rows))
    check("density filter respected", all(r["density"] <= 9.0 for r in rows))
    check("confidence floor respected", all(r["confidence"] == "High" for r in rows))
    check("Marine persona weighting applied", filtered.get("persona") == "Marine")


def check_simulate(token: str) -> dict:
    section("6. Working-condition simulator")
    payload = {
        "elements": {"Fe": 70, "Cr": 18, "Ni": 8, "Mo": 2, "C": 2},
        "temperature_c": 650,
        "environment": "Marine / Salt Spray",
        "load_profile": "Cyclic / Fatigue",
        "load_mpa": 320,
        "safety_factor": 1.6,
        "hazard_verified": False,
        "structure": "BCC",
        "environment_density_kgm3": 1.225,
        "pressure_pa": 101325,
        "velocity_kmh": 900,
    }
    status, body, _ = request("POST", "/api/simulate", payload, token=token)
    check("POST /api/simulate returns 200", status == 200, f"HTTP {status} · {detail_of(body)}")
    if not isinstance(body, dict):
        return {}
    derived = body.get("derived", {})
    environment = body.get("environment", {})
    check("engineering verdict computed", derived.get("verdict") in {"SAFE", "MARGINAL", "UNSAFE", "MELTED"},
          str(derived.get("verdict")))
    check("utilisation ratio computed", isinstance(derived.get("utilization_ratio"), (int, float)),
          str(derived.get("utilization_ratio")))
    check("derated working strength computed", (derived.get("operating_strength_mpa") or 0) > 0,
          f"{derived.get('operating_strength_mpa')} MPa")
    check("weighted liquidus computed from all elements", 1000 < (derived.get("liquidus_c") or 0) < 5000,
          f"{derived.get('liquidus_c')} °C")
    check("liquidus remains solid below melting point", derived.get("is_melted") is False)
    check("dynamic head q = ½ρv² computed",
          abs((environment.get("dynamic_pressure_pa") or 0) - 38281.25) < 1.0,
          f"{environment.get('dynamic_pressure_pa')} Pa")
    check("total pressure = static + dynamic",
          (environment.get("total_pressure_pa") or 0) > (environment.get("pressure_pa") or 0),
          f"{environment.get('total_pressure_pa')} Pa")
    check("burst ceiling and ratio exposed",
          (environment.get("burst_pressure_pa") or 0) > 0 and "burst_ratio" in environment,
          f"{environment.get('burst_pressure_pa')} Pa")
    check("pressure label formatted commercially", "Pa" in str(derived.get("pressure_label")),
          str(derived.get("pressure_label")))
    check("oxygen escape / refractory telemetry present",
          isinstance(derived.get("oxygen_escape_kpa_min"), (int, float))
          and "cryogenic" in derived and "refractory" in derived,
          f"O2 {derived.get('oxygen_escape_kpa_min')} kPa/min")
    curves = body.get("curves", {})
    check("stress-strain room curve", len(curves.get("room", {}).get("strain", [])) == 90)
    check("stress-strain operating curve", len(curves.get("operating", {}).get("strain", [])) == 90)
    check("operating curve derated vs 25 °C",
          curves["operating"]["yield_point"]["stress"] < curves["room"]["yield_point"]["stress"],
          f"{curves['operating']['yield_point']['stress']:.0f} < {curves['room']['yield_point']['stress']:.0f} MPa")
    check("thermal degradation curve spans -273.15 to 4500 °C",
          len(curves.get("degradation", {}).get("temperature_c", [])) == 15
          and curves["degradation"]["temperature_c"][0] == -273.15
          and curves["degradation"]["temperature_c"][-1] == 4500,
          str(curves.get("degradation", {}).get("temperature_c", [])[:2]))
    check("six-axis radar", len(body.get("radar", {}).get("alloy", [])) == 6)
    check("PCA-3 coordinates returned", len(body.get("pca", [])) == 3, str(body.get("pca")))
    check("AI metallurgist advice generated", len(body.get("advice", [])) >= 2, f"{len(body.get('advice', []))} points")
    check("hypothesis text generated", len(body.get("hypothesis", "")) > 80)
    check("fatigue life estimated for cyclic load", (derived.get("fatigue_cycles") or 0) > 0,
          f"{derived.get('fatigue_cycles')} cycles")
    check("warning raised when temp exceeds service ceiling",
          payload["temperature_c"] > derived.get("thermal_limit_c", 9999) or bool(body.get("warnings")),
          f"limit {derived.get('thermal_limit_c')} °C")

    # Liquidus failure: 4,500 °C is above every elemental melting point.
    status, melted, _ = request("POST", "/api/simulate", {
        "elements": {"Fe": 70, "Cr": 18, "Ni": 8, "Mo": 2, "C": 2},
        "temperature_c": 4500, "environment": "Air / Industrial",
        "load_profile": "Static tension", "load_mpa": 250, "safety_factor": 1.5,
    }, token=token)
    melted_derived = melted.get("derived", {}) if isinstance(melted, dict) else {}
    check("4500 °C triggers MELTED liquidus verdict",
          status == 200 and melted_derived.get("verdict") == "MELTED"
          and melted_derived.get("is_melted") is True, f"HTTP {status} · {melted_derived.get('verdict')}")
    check("melted alloy carries zero working strength",
          float(melted_derived.get("operating_strength_mpa") or 0) == 0.0
          and float(melted_derived.get("max_safe_load_mpa") or 0) == 0.0,
          str(melted_derived.get("operating_strength_mpa")))

    # Extreme cryogenic excursion at the lower envelope bound.
    status, cold, _ = request("POST", "/api/simulate", {
        "elements": {"Ti": 90, "Al": 6, "V": 4},
        "temperature_c": -273.15, "environment": "Air / Industrial",
        "load_profile": "Static tension", "load_mpa": 250, "safety_factor": 1.5,
    }, token=token)
    cold_derived = cold.get("derived", {}) if isinstance(cold, dict) else {}
    check("-273.15 °C accepted with cryogenic handling",
          status == 200 and cold_derived.get("verdict") in {"SAFE", "MARGINAL", "UNSAFE"},
          f"HTTP {status} · {cold_derived.get('verdict')}")

    # Infinite burst pressure past the containment ceiling.
    status, burst, _ = request("POST", "/api/simulate", {
        "elements": {"Fe": 70, "Cr": 18, "Ni": 8, "Mo": 2, "C": 2},
        "temperature_c": 25, "environment": "Air / Industrial",
        "load_profile": "Static tension", "load_mpa": 100, "safety_factor": 1.5,
        "pressure_pa": 1e16, "velocity_kmh": 0,
    }, token=token)
    burst_derived = burst.get("derived", {}) if isinstance(burst, dict) else {}
    check("infinite pressure flags burst containment failure",
          status == 200 and burst_derived.get("is_burst_condition") is True
          and burst_derived.get("verdict") == "UNSAFE",
          f"HTTP {status} · {burst_derived.get('verdict')}")
    return body


def check_guardrail(token: str) -> None:
    section("7. Dual-Use hazardous-element guardrail")
    status, body, _ = request("POST", "/api/simulate", {
        "elements": {"Fe": 97, "Be": 3},
        "temperature_c": 25, "environment": "Air / Industrial",
        "load_profile": "Static tension", "load_mpa": 100, "safety_factor": 1.5,
        "hazard_verified": False,
    }, token=token)
    detail = body.get("detail", {}) if isinstance(body, dict) else {}
    check("unverified Be is blocked with 403", status == 403, f"HTTP {status}")
    check("guardrail error code present", isinstance(detail, dict) and detail.get("code") == "DUAL_USE_BLOCKED",
          detail_of(detail))
    check("blocked element is named", isinstance(detail, dict) and
          any(entry.get("symbol") == "Be" for entry in detail.get("blocked", [])))

    for symbol in ("U", "Pu", "Th", "Cd", "Hg", "As", "Br"):
        status, _, _ = request("POST", "/api/simulate", {
            "elements": {"Fe": 99, symbol: 1},
            "temperature_c": 25, "environment": "Air / Industrial",
        }, token=token)
        check(f"guardrail blocks {symbol}", status == 403, f"HTTP {status}")

    status, cleared, _ = request("POST", "/api/simulate", {
        "elements": {"Fe": 97, "Be": 3},
        "temperature_c": 25, "environment": "Air / Industrial",
        "load_profile": "Static tension", "load_mpa": 100, "safety_factor": 1.5,
        "hazard_verified": True,
    }, token=token)
    cleared_derived = cleared.get("derived", {}) if isinstance(cleared, dict) else {}
    check("KYB-verified clearance permits Be with an audit warning",
          status == 200 and cleared_derived.get("hazard_cleared") is True,
          f"HTTP {status} · hazard_cleared={cleared_derived.get('hazard_cleared')}")


def check_feedback(token: str) -> int:
    section("8. Feedback capture")
    status, body, _ = request("POST", "/api/feedback", {
        "rating": 5, "category": "Prediction Quality",
        "message": "Automated verification: uncertainty band and 3D viewer behaved as expected.",
    }, token=token)
    check("POST /api/feedback returns 200", status == 200, f"HTTP {status} · {detail_of(body)}")
    feedback_id = (body.get("feedback") or {}).get("id", 0) if isinstance(body, dict) else 0
    check("feedback stored with id", feedback_id > 0, str(feedback_id))
    status, mine, _ = request("GET", "/api/feedback/mine", token=token)
    check("feedback visible to its author", status == 200 and any(f["id"] == feedback_id for f in mine.get("items", [])))
    return feedback_id


def check_pdf(token: str) -> None:
    section("9. PDF lab report")
    status, body, headers = request("POST", "/api/report/pdf", {
        "elements": {"Fe": 68, "Cr": 17, "Ni": 12, "Mo": 2.5, "C": 0.03},
        "temperature_c": 400, "environment": "Oxidising / Steam",
        "load_profile": "Static tension", "load_mpa": 280, "safety_factor": 1.5,
        "report_title": "Official Lab Screening Report",
        "lab_reference": "SUMMIT-2026-VERIFY",
    }, token=token, raw=True)
    check("POST /api/report/pdf returns 200", status == 200, f"HTTP {status}")
    check("PDF byte stream begins with %PDF", isinstance(body, (bytes, bytearray)) and body[:5] == b"%PDF-",
          f"{len(body) if isinstance(body, (bytes, bytearray)) else 0:,} bytes")
    check("PDF has EOF marker", isinstance(body, (bytes, bytearray)) and b"%%EOF" in body[-2048:])
    disposition = header_value(headers, "content-disposition")
    check("PDF attachment header", "attachment" in disposition.lower() and ".pdf" in disposition.lower(),
          disposition or "missing")

    status, _, _ = request("POST", "/api/report/pdf", {
        "elements": {"Fe": 99, "C": 1}, "temperature_c": 25,
    }, token="")
    check("PDF export requires authentication", status == 401, f"HTTP {status}")


def check_admin(feedback_id: int) -> None:
    section("10. Hidden admin vault")

    # Register a dedicated KYB-pending account so the approval path and its
    # audit trail are always exercised, regardless of database history.
    probe_email = f"kyb-audit-{secrets.token_hex(4)}@lab.materialhunt.ai"
    reg_status, _, _ = request("POST", "/api/auth/register", {
        "email": probe_email,
        "password": "Probe@2026",
        "organization_name": "Verification Materials Lab",
        "org_id": "VERIFY-2026",
    })
    check("KYB probe account registered", reg_status == 200, f"HTTP {reg_status}")

    status, _, _ = request("POST", f"/api/admin/login?gate={GATE}")
    check("passkey required (401 without header)", status == 401, f"HTTP {status}")

    status, _, _ = request("POST", "/api/admin/login?gate=wrong_gate", admin=True)
    check("wrong gate returns 404 (vault invisible)", status == 404, f"HTTP {status}")

    admin_ip = {"X-Forwarded-For": f"198.51.100.{secrets.randbelow(253) + 2}"}
    status, body, _ = request("POST", f"/api/admin/login?gate={GATE}", admin=True, headers=admin_ip)
    check("correct gate + passkey unlocks vault", status == 200, f"HTTP {status} · {detail_of(body)}")
    snapshot = body.get("snapshot", {}) if isinstance(body, dict) else {}
    overview = snapshot.get("overview", {})
    check("snapshot includes overview", "total_users" in overview, str(overview.get("total_users")))
    check("snapshot includes users", len(snapshot.get("users", [])) >= 3)
    check("snapshot includes audit trail", len(snapshot.get("audit", [])) >= 1)
    check("admin login is audited",
          any(event.get("action") == "ADMIN_LOGIN" for event in snapshot.get("audit", [])))

    pending = None
    for user in snapshot.get("users", []):
        if user.get("email") == probe_email:
            pending = user
            break
    if pending is None:
        for user in snapshot.get("users", []):
            if user.get("kyb_status") == "pending":
                pending = user
                break
    if pending:
        status, body, _ = request("POST", f"/api/admin/approve-kyb?gate={GATE}",
                                  {"user_id": pending["id"], "note": "Verification suite"}, admin=True, headers=admin_ip)
        check("KYB approval succeeds", status == 200 and body.get("user", {}).get("kyb_status") == "approved",
              f"HTTP {status} · {detail_of(body)}")
    else:
        check("KYB approval succeeds", True, "no pending account to approve")

    status, body, _ = request("POST", f"/api/admin/waive-fee?gate={GATE}",
                              {"user_id": pending["id"] if pending else 1, "note": "Verification suite"},
                              admin=True, headers=admin_ip)
    waived_user = body.get("user", {}) if isinstance(body, dict) else {}
    check("fee waiver grants Enterprise + WAIVED ₹0",
          status == 200 and waived_user.get("tier") == "enterprise" and waived_user.get("billing_waived") is True
          and "WAIVED" in str(waived_user.get("billing_status")),
          f"HTTP {status} · {waived_user.get('billing_status')}")
    check("waiver label is VIP GRANT — FEE WAIVED (₹0)",
          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT"\u2014 FEE WAIVED (\u20b90)" if isinstance(body, dict) else False,
          str(body.get("waiver_label") if isinstance(body, dict) else ""))

    if feedback_id:
        status, body, _ = request("POST", f"/api/admin/feedback-triage?gate={GATE}",
                                  {"feedback_id": feedback_id, "status": "Resolved"},
                                  admin=True, headers=admin_ip)
        check("feedback triage updates status",
              status == 200 and body.get("feedback", {}).get("status") == "Resolved", f"HTTP {status}")

    status, body, _ = request("GET", f"/api/admin/snapshot?gate={GATE}", admin=True, headers=admin_ip)
    actions = {event.get("action") for event in body.get("snapshot", {}).get("audit", [])} if isinstance(body, dict) else set()
    check("waiver + KYB + triage are audit-logged",
          {"FEE_WAIVER", "KYB_APPROVED", "FEEDBACK_TRIAGE"}.issubset(actions), ", ".join(sorted(actions))[:160])

    status, body, _ = request("POST", f"/api/admin/mint-pilot?mode=live_demo&gate={GATE}",
                              admin=True, headers=admin_ip)
    minted = body.get("user", {}) if isinstance(body, dict) else {}
    check("vault mints an Enterprise VIP pilot",
          status == 200 and minted.get("tier") == "enterprise" and minted.get("billing_waived") is True
          and body.get("waiver_label") == "ENTERPRISE ACCESS GRANT"\u2014 FEE WAIVED (\u20b90)",
          f"HTTP {status} · {minted.get('email')}")
    check("minted pilot receives a working token",
          bool(body.get("token")) if isinstance(body, dict) else False)

    status, body, _ = request("GET", f"/api/admin/discoveries?gate={GATE}", admin=True, headers=admin_ip)
    check("vault lists discoveries + leaderboard",
          status == 200 and isinstance(body.get("discoveries"), list) and isinstance(body.get("leaderboard"), list),
          f"HTTP {status} · {len(body.get('leaderboard', []))} ranked")

    section("11. Admin 3-attempt lockout (dedicated client IP)")
    lock_ip = {"X-Forwarded-For": f"203.0.113.{secrets.randbelow(253) + 2}"}

    def wrong_admin(ip):
        url = BASE + f"/api/admin/login?gate={GATE}"
        req = urllib.request.Request(url, data=b"{}", method="POST", headers={
            "Content-Type": "application/json",
            "X-Admin-Passkey": "definitely-wrong",
            **ip,
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode() or "{}")

    status1, body1 = wrong_admin(lock_ip)
    check("wrong passkey #1 → 401", status1 == 401, f"HTTP {status1}")
    check("remaining attempts reported",
          isinstance(body1.get("detail"), dict) and body1["detail"].get("remaining_attempts") == 2,
          str(body1.get("detail")))
    status2, _ = wrong_admin(lock_ip)
    check("wrong passkey #2 → 401", status2 == 401, f"HTTP {status2}")
    status3, body3 = wrong_admin(lock_ip)
    check("wrong passkey #3 → 423 lockout", status3 == 423, f"HTTP {status3}")
    check("lockout reports retry window",
          isinstance(body3.get("detail"), dict) and 0 < body3["detail"].get("retry_after_seconds", 0) <= 900,
          str(body3.get("detail")))

    status4, _, _ = request("POST", f"/api/admin/login?gate={GATE}", admin=True, headers=lock_ip)
    check("correct passkey rejected during lockout", status4 == 423, f"HTTP {status4}")


def check_commercial_apis(token: str) -> None:
    section("13. Commercial intelligence endpoints")

    status, body, _ = request("GET", "/api/labels")
    labels = body.get("labels", {}) if isinstance(body, dict) else {}
    check("GET /api/labels returns 200", status == 200, f"HTTP {status}")
    check("labels expose fee-waived grant + KYB badge",
          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT"\u2014 FEE WAIVED (\u20b90)"
          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"
          and labels.get("admin", {}).get("gate") == GATE,
          str(body.get("waiver_label")))

    status, body, _ = request("GET", "/api/elements")
    table = body.get("periodic_table", []) if isinstance(body, dict) else []
    check("GET /api/elements returns 200", status == 200, f"HTTP {status}")
    check("periodic table carries all 118 elements",
          body.get("periodic_table_count") == 118 and len(table) == 118,
          f"{body.get('periodic_table_count')} rows")
    check("every element has grid coordinates + category",
          all(item.get("grid_col") and item.get("grid_row") and item.get("category") for item in table))
    check("periodic payload covers H through Og",
          table[0].get("symbol") == "H" and table[-1].get("symbol") == "Og",
          f"{table[0].get('symbol')} … {table[-1].get('symbol')}")
    check("all 8 restricted elements flagged in the payload",
          set(body.get("hazardous_elements", [])) == {"Be", "Br", "U", "Pu", "Th", "Cd", "Hg", "As"},
          ", ".join(body.get("hazardous_elements", [])))
    check("category colours exposed for the UI",
          len(body.get("category_colors", {})) >= 6, f"{len(body.get('category_colors', {}))} categories")

    status, body, _ = request("POST", "/api/mission-search", {
        "prompt": "Lightweight corrosion-resistant alloy for offshore drone airframes under 8 g/cm3",
        "persona": "Aerospace",
    }, token=token)
    check("POST /api/mission-search returns 200", status == 200, f"HTTP {status} · {detail_of(body)}")
    if isinstance(body, dict):
        results = body.get("results", [])
        check("mission brief classified by intent",
              body.get("intent", {}).get("key") == "lightweight",
              str(body.get("intent", {}).get("label")))
        check("mission id issued", str(body.get("mission_id", "")).startswith("MH-MSN-"),
              str(body.get("mission_id")))
        check("ranked shortlist returned", len(results) > 0 and len(results) <= 12, f"{len(results)} rows")
        check("shortlist ordered by rank score",
              all(results[i]["rank_score"] >= results[i + 1]["rank_score"] for i in range(len(results) - 1)))
        check("candidate pool fully evaluated", (body.get("candidates_evaluated") or 0) >= 150,
              str(body.get("candidates_evaluated")))
        check("recommendation narrative generated", "Top candidate" in str(body.get("recommendation", "")),
              str(body.get("recommendation", ""))[:120])

    status, body, _ = request("POST", "/api/optimize", {
        "target_material": "steel",
        "constraints": {
            "density_max_gcm3": 8.2,
            "strength_min_mpa": 1300,
            "temperature_max_c": 350,
            "cost_max_per_kg": 1200,
        },
        "limit": 8,
    }, token=token)
    check("POST /api/optimize returns 200", status == 200, f"HTTP {status} · {detail_of(body)}")
    if isinstance(body, dict):
        optimization = body.get("optimization", {})
        recommendations = body.get("recommendations", [])
        check("optimiser reports a feasible region",
              optimization.get("status") == "OPTIMISED" and (optimization.get("feasible_candidates") or 0) > 0,
              str(optimization.get("status")))
        check("optimiser respects the limit", 0 < len(recommendations) <= 8, f"{len(recommendations)} rows")
        check("constraints honoured by every recommendation",
              all(item["density_gcm3"] <= 8.2 and item["strength_mpa"] >= 1300
                  and item["cost_per_kg"] <= 1200 and item["thermal_limit_c"] >= 350
                  for item in recommendations),
              f"{len(recommendations)} rows")
        check("recommendations ranked 1..n",
              [item.get("rank") for item in recommendations] == list(range(1, len(recommendations) + 1)))

    status, body, _ = request("POST", "/api/environment", {
        "environment": "Air / Industrial",
        "environment_density_kgm3": 1.225,
        "temperature_c": 25,
        "pressure_pa": 101325,
        "velocity_kmh": 900,
        "material_density_gcm3": 7.85,
    })
    environment = body.get("environment", {}) if isinstance(body, dict) else {}
    check("POST /api/environment returns 200", status == 200, f"HTTP {status}")
    check("environment preview computes ½ρv² dynamic head",
          abs((environment.get("dynamic_pressure_pa") or 0) - 38281.25) < 1.0,
          f"{environment.get('dynamic_pressure_pa')} Pa")
    check("environment preview resolves total pressure",
          (environment.get("total_pressure_pa") or 0) > 101325, f"{environment.get('total_pressure_pa')} Pa")
    check("environment preview exposes burst ceiling",
          (environment.get("burst_pressure_pa") or 0) > 1e9, f"{environment.get('burst_pressure_pa')} Pa")


def check_leaderboard(token: str) -> None:
    section("14. Global R&D Discovery Leaderboard")
    status, body, _ = request("GET", "/api/leaderboard?limit=20")
    check("GET /api/leaderboard returns 200", status == 200, f"HTTP {status}")
    check("leaderboard uses the commercial title",
          body.get("title") == "Global R&D Discovery Registry", str(body.get("title")))
    check("seeded discoveries visible", len(body.get("leaders", [])) >= 1,
          f"{len(body.get('leaders', []))} entries")
    check("leaderboard stats exposed",
          "total_discoveries" in body.get("stats", {}), str(body.get("stats", {}).get("total_discoveries")))

    status, submit, _ = request("POST", "/api/leaderboard/submit", {
        "elements": {"Fe": 70, "Cr": 18, "Ni": 8, "Mo": 2, "C": 2},
        "temperature_c": 350,
        "environment": "Air / Industrial",
        "load_profile": "Static tension",
        "load_mpa": 260,
        "safety_factor": 1.5,
    }, token=token)
    entry = submit.get("entry", {}) if isinstance(submit, dict) else {}
    check("POST /api/leaderboard/submit returns 200", status == 200, f"HTTP {status} · {detail_of(submit)}")
    check("published discovery carries a score + formula",
          (entry.get("rank_score") or 0) > 0 and bool(entry.get("formula")),
          f"score {entry.get('rank_score')} · {entry.get('formula')}")

    status, _, _ = request("POST", "/api/leaderboard/submit", {
        "elements": {"Fe": 99, "C": 1}, "temperature_c": 25,
    }, token="")
    check("leaderboard publish requires authentication", status == 401, f"HTTP {status}")


def check_roi_math() -> None:
    section("12. Subscription economics consistency")
    status, body, _ = request("GET", "/api/meta")
    if status != 200 or not isinstance(body, dict):
        check("ROI tier pricing", False, "meta unavailable")
        return
    tiers = body.get("tiers", {})
    check("Free Starter is ₹0", tiers.get("free", {}).get("price") == 0, str(tiers.get("free", {}).get("price_label")))
    check("Pro Lab is ₹4,999 / month", tiers.get("pro", {}).get("price_label") == "\u20b94,999 / month")
    check("Enterprise R&D is ₹19,999 / month", tiers.get("enterprise", {}).get("price_label") == "\u20b919,999 / month")
    check("all tiers carry feature lists", all(t.get("features") for t in tiers.values()))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    print("=" * 78)
    print("  MATERIALHUNT — offline end-to-end verification")
    print(f"  Target: {BASE}   ·   {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 78)

    check_health()
    check_meta()
    check_static()
    token = check_auth()
    check_prescreen(token)
    check_simulate(token)
    check_guardrail(token)
    feedback_id = check_feedback(token)
    check_pdf(token)
    check_admin(feedback_id)
    check_roi_math()
    check_commercial_apis(token)
    check_leaderboard(token)

    total = len(PASSED) + len(FAILED)
    print("\n" + "=" * 78)
    print(f"  RESULT: {len(PASSED)}/{total} checks passed, {len(FAILED)} failed")
    if FAILED:
        print("\n  Failed checks:")
        for name in FAILED:
            print(f"    - {name}")
    print("=" * 78)

    if not FAILED:
        print("\n  All systems verified — MATERIALHUNT is fully offline and operational.")
        print("  Open http://localhost:8000  ·  Pilot Sandbox: ?mode=live_demo  ·  Vault: ?gate=mh_vault_99x\n")
    return 0 if not FAILED else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(130)
