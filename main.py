"""MATERIALHUNT — FastAPI backend.

Offline AI-powered multi-material discovery and 3D engineering pre-screening.
Serves the Single-Page WebGL frontend and JSON REST API on localhost:8000.

Start:  python main.py
"""
from __future__ import annotations

import io
import math
import random
import secrets
import re
import time
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fpdf import FPDF
from fpdf.enums import XPos, YPos
from pydantic import BaseModel, Field, field_validator

import database
from material_data import (
    HAZARDOUS_ELEMENTS,
    HAZARDOUS_META,
    MATERIALHUNT_LABELS,
    VALIDATED_ALLOYS,
    calculate_cryogenic_effects,
    calculate_environment_parameters,
    calculate_liquidus_state,
    calculate_oxygen_escape_rate,
    calculate_refractory_stability,
    check_elemental_melting,
    corrosion_index,
    ductility_index,
    element_meta,
    element_payload,
    element_phase_state,
    estimate_cost,
    estimate_density,
    periodic_table_payload,
    recommend_structure,
    thermal_limit,
)
from material_data import CATEGORY_COLORS

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
BUNDLE_PATH = BASE_DIR / "materialhunt_bundle.pkl"

BUNDLE: Optional[dict[str, Any]] = None
BUNDLE_ERROR: str = ""
SERVER_START = time.time()

UI_ELEMENTS = ["Fe", "Cr", "Ni", "C", "Ti", "Al", "Mo"]

PERSONAS: dict[str, dict[str, Any]] = {
    "Aerospace": {
        "label": "Aerospace",
        "icon": "rocket",
        "weights": {"strength": 0.30, "weight": 0.25, "thermal": 0.25, "corrosion": 0.07, "cost": 0.05, "confidence": 0.08},
        "brief": "Specific strength, thermal headroom and confidence dominate. Cost is secondary.",
    },
    "Automotive / EV": {
        "label": "Automotive / EV",
        "icon": "bolt",
        "weights": {"strength": 0.22, "weight": 0.25, "thermal": 0.10, "corrosion": 0.10, "cost": 0.23, "confidence": 0.10},
        "brief": "Lightweighting and INR/kg cost drive high-volume EV platform decisions.",
    },
    "Marine": {
        "label": "Marine",
        "icon": "wave",
        "weights": {"strength": 0.22, "weight": 0.12, "thermal": 0.08, "corrosion": 0.36, "cost": 0.12, "confidence": 0.10},
        "brief": "Chloride resistance and corrosion index outweigh raw strength.",
    },
    "Custom Weights": {
        "label": "Custom Weights",
        "icon": "sliders",
        "weights": {"strength": 0.25, "weight": 0.20, "thermal": 0.20, "corrosion": 0.15, "cost": 0.10, "confidence": 0.10},
        "brief": "Tune the six engineering axes yourself.",
    },
}

ENVIRONMENTS: dict[str, dict[str, Any]] = {
    "Air / Industrial": {"factor": 0.97, "label": "Air / Industrial", "note": "Humidity + mild SOx exposure"},
    "Marine / Salt Spray": {"factor": 0.82, "label": "Marine / Salt Spray", "note": "Chloride pitting and crevice attack"},
    "Acidic / Chemical": {"factor": 0.74, "label": "Acidic / Chemical", "note": "Low-pH process stream"},
    "Inert / Argon": {"factor": 1.00, "label": "Inert / Argon", "note": "No oxidative loss"},
    "High-Vacuum": {"factor": 0.96, "label": "High-Vacuum", "note": "Outgassing / vacuum embrittlement"},
    "Oxidising / Steam": {"factor": 0.87, "label": "Oxidising / Steam", "note": "Scale formation above 500 C"},
    "Cryogenic / LNG": {"factor": 0.91, "label": "Cryogenic / LNG", "note": "Low-temperature toughness demand"},
}

LOAD_PROFILES: dict[str, dict[str, Any]] = {
    "Static tension": {"factor": 1.00, "label": "Static tension", "note": "Monotonic design load"},
    "Cyclic / Fatigue": {"factor": 0.80, "label": "Cyclic / Fatigue", "note": "10^6-cycle endurance debit"},
    "Impact / Shock": {"factor": 0.74, "label": "Impact / Shock", "note": "Dynamic toughness debit"},
    "Creep / High-temp": {"factor": 0.68, "label": "Creep / High-temp", "note": "Time-dependent deformation debit"},
    "Biaxial / Pressure": {"factor": 0.88, "label": "Biaxial / Pressure", "note": "Multiaxial stress-state debit"},
}

CONFIDENCE_SCORE = {"High": 1.0, "Medium": 0.62, "Low": 0.28}
CONFIDENCE_RANK = {"Low": 1, "Medium": 2, "High": 3}


# ---------------------------------------------------------------------------
# Lifespan / model loading
# ---------------------------------------------------------------------------
def load_bundle() -> None:
    global BUNDLE, BUNDLE_ERROR
    if not BUNDLE_PATH.exists():
        BUNDLE = None
        BUNDLE_ERROR = "materialhunt_bundle.pkl not found. Run: python train_model.py"
        return
    try:
        BUNDLE = joblib.load(BUNDLE_PATH)
        # Training used n_jobs=-1 to fit forests quickly. Keeping that value
        # makes every single-row prediction fan out to a process pool, which
        # costs several seconds per request. Inference is a single row, so the
        # serial backend is always faster here.
        for dataset in BUNDLE.get("datasets", {}).values():
            for model in dataset.get("models", {}).values():
                if hasattr(model, "n_jobs"):
                    model.n_jobs = 1
        # matminer's ElementProperty spins up a multiprocessing Pool whenever
        # n_jobs is not 1, even for a single composition. On Windows that costs
        # seconds per request, so keep featurisation in-process.
        featurizer = BUNDLE.get("featurizer")
        if featurizer is not None and getattr(featurizer, "n_jobs", 1) != 1:
            featurizer.set_n_jobs(1)
        BUNDLE_ERROR = ""
    except Exception as exc:  # pragma: no cover - startup diagnostics
        BUNDLE = None
        BUNDLE_ERROR = f"Could not load model bundle: {exc}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    load_bundle()
    yield


app = FastAPI(
    title="MATERIALHUNT API",
    description="AI-Powered Multi-Material Discovery & 3D Engineering Pre-Screening SaaS — 100% offline.",
    version="2.6.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def offline_cache_policy(request: Request, call_next):
    """Keep HTML and source assets revalidating so local edits appear immediately."""
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response


def require_model() -> dict[str, Any]:
    if BUNDLE is None:
        raise HTTPException(status_code=503, detail=f"ML engine offline. {BUNDLE_ERROR}")
    return BUNDLE


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=6, max_length=128)
    organization_name: str = Field(default="", max_length=160)
    org_id: str = Field(default="", max_length=80)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", value.strip()):
            raise ValueError("Enter a valid work email address.")
        return value.strip().lower()


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=160)
    password: str = Field(min_length=1, max_length=128)


class PrescreenRequest(BaseModel):
    datasets: list[str] = Field(default_factory=lambda: ["steels", "glass", "expt_gap"])
    persona: str = "Aerospace"
    custom_weights: Optional[dict[str, float]] = None
    min_confidence: str = "Low"
    max_cost: Optional[float] = Field(default=None, ge=0)
    min_predicted: Optional[float] = None
    max_density: Optional[float] = Field(default=None, ge=0)
    include_elements: list[str] = Field(default_factory=list)
    exclude_elements: list[str] = Field(default_factory=list)
    search: str = Field(default="", max_length=80)
    include_hazardous: bool = False
    limit: int = Field(default=50, ge=1, le=200)


class SimulateRequest(BaseModel):
    elements: dict[str, float] = Field(default_factory=lambda: {"Fe": 70, "Cr": 18, "Ni": 8, "Mo": 2, "C": 2})
    temperature_c: float = Field(default=25, ge=-273.15, le=4500)
    environment: str = "Air / Industrial"
    load_profile: str = "Static tension"
    load_mpa: float = Field(default=250, ge=0, le=1e9)
    safety_factor: float = Field(default=1.5, ge=1.0, le=3.0)
    hazard_verified: bool = False
    structure: Optional[str] = None
    # Commercial environment envelope: liquidus, medium density, pressure, airspeed.
    environment_density_kgm3: Optional[float] = Field(default=None, ge=0, le=25000)
    pressure_pa: float = Field(default=101325, ge=0, le=1e16)
    velocity_kmh: float = Field(default=0, ge=0, le=3500)

    @field_validator("environment")
    @classmethod
    def valid_environment(cls, value: str) -> str:
        if value not in ENVIRONMENTS:
            raise ValueError("Unknown environment.")
        return value

    @field_validator("load_profile")
    @classmethod
    def valid_profile(cls, value: str) -> str:
        if value not in LOAD_PROFILES:
            raise ValueError("Unknown load profile.")
        return value

    @field_validator("structure")
    @classmethod
    def valid_structure(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value.upper() not in {"BCC", "FCC", "HCP"}:
            raise ValueError("Structure must be BCC, FCC or HCP.")
        return value.upper() if value else None


class ReportRequest(SimulateRequest):
    report_title: str = Field(default="Official Lab Screening Report", max_length=120)
    lab_reference: str = Field(default="", max_length=80)


class FeedbackRequest(BaseModel):
    rating: int = Field(ge=0, le=5)
    category: str = Field(default="General", max_length=60)
    message: str = Field(default="", max_length=2000)


class AdminActionRequest(BaseModel):
    user_id: int = Field(ge=1)
    note: str = Field(default="", max_length=240)


class AdminFeedbackRequest(BaseModel):
    feedback_id: int = Field(ge=1)
    status: str = Field(default="Reviewed", max_length=30)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def optional_user(authorization: Optional[str] = Header(default=None)) -> Optional[dict[str, Any]]:
    token = bearer_token(authorization)
    if not token:
        return None
    return database.get_user_by_token(token)


def require_user(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    user = optional_user(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required. Sign in or launch the Interactive Pilot Sandbox.")
    return user


def client_ip(request: Request) -> str:
    host = request.client.host if request.client else "unknown"
    if host in {"127.0.0.1", "::1", "localhost"}:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]
    return host


def require_admin(
    request: Request,
    gate: Optional[str] = Query(default=None),
    x_admin_passkey: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    """Secret URL gate + salted passkey + persistent 3-strike lockout."""
    if gate != "mh_vault_99x":
        raise HTTPException(status_code=404, detail="Not found.")
    ip = client_ip(request)
    state = database.admin_lock_state(ip)
    if state["locked"]:
        raise HTTPException(
            status_code=423,
            detail={"message": "Admin vault locked after 3 failed attempts.",
                    "retry_after_seconds": state["retry_after"], "attempts": state["attempts"]},
        )
    if not x_admin_passkey:
        raise HTTPException(status_code=401, detail="Admin passkey required.")
    if not database.verify_admin_passkey(x_admin_passkey):
        result = database.record_admin_attempt(ip, False)
        database.log_audit("admin-vault", "ADMIN_AUTH_FAILED",
                           f"Failed attempt {result['attempts']} from {ip}", ip=ip)
        if result["locked"]:
            raise HTTPException(
                status_code=423,
                detail={"message": "Admin vault locked after 3 failed attempts. Cooldown 15 minutes.",
                        "retry_after_seconds": result["retry_after"], "attempts": result["attempts"]},
            )
        raise HTTPException(
            status_code=401,
            detail={"message": "Invalid admin passkey.", "remaining_attempts": result["remaining_attempts"]},
        )
    database.record_admin_attempt(ip, True)
    return {"ip": ip}


# ---------------------------------------------------------------------------
# Material science helpers
# ---------------------------------------------------------------------------
def normalise_elements(elements: dict[str, float]) -> tuple[dict[str, float], dict[str, str]]:
    valid: dict[str, float] = {}
    rejected: dict[str, str] = {}
    for raw_symbol, raw_pct in (elements or {}).items():
        symbol = str(raw_symbol).strip()
        if not symbol:
            continue
        symbol = symbol[0].upper() + symbol[1:].lower() if len(symbol) > 1 else symbol.upper()
        try:
            pct = float(raw_pct)
        except (TypeError, ValueError):
            rejected[symbol] = "Not a number"
            continue
        if pct < 0 or not math.isfinite(pct):
            rejected[symbol] = "Percent must be a finite positive value"
            continue
        if pct == 0:
            continue
        try:
            from pymatgen.core import Element
            Element(symbol)
        except Exception:
            rejected[symbol] = "Not a valid chemical element symbol"
            continue
        valid[symbol] = valid.get(symbol, 0.0) + pct
    if not valid:
        raise HTTPException(status_code=422, detail="Provide at least one valid alloying element above 0%.")
    total = sum(valid.values())
    fractions = {sym: round(pct / total, 6) for sym, pct in valid.items()}
    return fractions, rejected


def composition_from_fractions(fractions: dict[str, float]):
    from pymatgen.core import Composition
    integerish = {sym: max(frac, 1e-6) for sym, frac in fractions.items()}
    return Composition(integerish)


def short_formula(elements: dict[str, float], max_terms: int = 4) -> str:
    """Human-readable formula from the dominant elements, e.g. 'Fe76 · Cr11 · Ni10 · Mo1'."""
    if not elements:
        return "—"
    ordered = sorted(((str(k), float(v)) for k, v in elements.items() if float(v) > 0),
                     key=lambda kv: kv[1], reverse=True)[:max_terms]
    total = sum(v for _, v in ordered) or 1.0
    parts = []
    for symbol, value in ordered:
        pct = value / total * 100.0 if total <= 1.0001 else value
        digits = 0 if pct >= 10 else 1
        parts.append(f"{symbol}{pct:.{digits}f}")
    return " · ".join(parts)


def composition_features(composition) -> pd.DataFrame:
    bundle = require_model()
    rows = bundle["featurizer"].transform([composition])
    frame = pd.DataFrame(rows, columns=bundle["feature_names"])
    frame = frame.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)
    return frame


def predict_dataset(dataset_key: str, features: pd.DataFrame) -> dict[str, Any]:
    bundle = require_model()
    ds = bundle["datasets"][dataset_key]
    imputer = ds["imputer"]
    X = imputer.transform(features.to_numpy())
    rf = ds["models"]["random_forest"]
    prediction = float(rf.predict(X)[0])
    tree_preds = np.array([tree.predict(X)[0] for tree in rf.estimators_])
    uncertainty = float(tree_preds.std())
    thresholds = ds["uncertainty_thresholds"]
    if uncertainty <= thresholds["high_max"]:
        confidence = "High"
    elif uncertainty <= thresholds["medium_max"]:
        confidence = "Medium"
    else:
        confidence = "Low"
    return {
        "dataset": dataset_key,
        "label": ds["label"],
        "target_name": ds["target_name"],
        "target_short": ds["target_short"],
        "unit": ds["unit"],
        "predicted": round(prediction, 4),
        "uncertainty": round(uncertainty, 4),
        "confidence": confidence,
        "benchmark_r2": ds["test_r2"],
        "benchmark_mae": ds["test_mae"],
    }


def project_features(features: pd.DataFrame) -> list[float]:
    bundle = require_model()
    ds = bundle["datasets"]["steels"]
    X = ds["imputer"].transform(features.to_numpy())
    scaler = bundle["global_pca"]["scaler"]
    pca = bundle["global_pca"]["model"]
    coords = pca.transform(scaler.transform(X))[0]
    return [round(float(v), 4) for v in coords]


def thermal_factor(temp_c: float, limit_c: int) -> float:
    if temp_c <= 25:
        stiffening = 1.0 + 0.00022 * (25 - temp_c)
        return max(0.75, min(1.08, stiffening))
    span = max(1.0, float(limit_c) - 25.0)
    ratio = (temp_c - 25.0) / span
    if ratio <= 1.0:
        return max(0.60, 1.0 - 0.34 * (ratio ** 0.82))
    return max(0.18, 0.66 - 0.30 * (ratio - 1.0))


def generate_stress_strain(predicted_strength: float, ductility: float, temperature_c: float,
                           modulus_gpa: float) -> dict[str, Any]:
    yield_strength = max(20.0, predicted_strength)
    ultimate = yield_strength * (1.12 + 0.42 * ductility)
    fracture_strain = max(0.015, 0.055 + 0.27 * ductility)
    elastic_strain = min(0.012, yield_strength / max(1.0, modulus_gpa * 1000.0))
    uniform_strain = max(elastic_strain + 0.005, fracture_strain * 0.62)
    fracture_stress = ultimate * (0.80 + 0.12 * ductility)

    strain = np.linspace(0.0, fracture_strain * 1.02, 90)
    stress = np.zeros_like(strain)
    for i, eps in enumerate(strain):
        if eps <= elastic_strain:
            stress[i] = modulus_gpa * 1000.0 * eps
        elif eps <= uniform_strain:
            t = (eps - elastic_strain) / max(1e-9, uniform_strain - elastic_strain)
            stress[i] = yield_strength + (ultimate - yield_strength) * (t ** 0.62)
        else:
            t = (eps - uniform_strain) / max(1e-9, fracture_strain - uniform_strain)
            stress[i] = ultimate - (ultimate - fracture_stress) * (t ** 0.55)
    stress = np.minimum(stress, ultimate)
    return {
        "strain": [round(float(v), 5) for v in strain],
        "stress": [round(float(max(0.0, v)), 2) for v in stress],
        "yield_point": {"strain": round(float(elastic_strain), 5), "stress": round(float(yield_strength), 2)},
        "fracture_point": {"strain": round(float(fracture_strain), 5), "stress": round(float(fracture_stress), 2)},
        "ultimate_strength": round(float(ultimate), 2),
        "fracture_strain_pct": round(float(fracture_strain * 100), 2),
        "temperature_c": temperature_c,
    }


def _fmt(value: float, digits: int = 1) -> str:
    return f"{value:,.{digits}f}"


def build_advice(fractions: dict[str, float], derived: dict[str, Any], targets: dict[str, Any],
                 payload: SimulateRequest) -> list[str]:
    advice: list[str] = []
    cr = fractions.get("Cr", 0.0)
    ni = fractions.get("Ni", 0.0)
    mo = fractions.get("Mo", 0.0)
    c = fractions.get("C", 0.0)
    ti = fractions.get("Ti", 0.0)
    al = fractions.get("Al", 0.0)
    temp = payload.temperature_c
    env = payload.environment
    util = derived["utilization_ratio"]

    if derived.get("is_melted"):
        advice.append(
            f"LIQUIDUS FAILURE: operating temperature {temp:.1f} °C meets or exceeds the weighted liquidus of "
            f"{derived.get('liquidus_c', 0):,.1f} °C. Reduce service temperature, add refractory solutes "
            f"(W, Ta, Re, Mo) or switch to a ceramic / intermetallic system before any load case is considered."
        )
    if derived.get("is_burst_condition"):
        advice.append(
            f"Pressure burst: total pressure {derived.get('pressure_label', '∞ Burst')} exceeds the containment "
            f"ceiling of {derived.get('burst_pressure_pa', 0) / 1e9:,.2f} GPa. Increase wall thickness, reduce "
            f"airspeed or reduce the process pressure before structural analysis."
        )

    if temp > derived["thermal_limit_c"]:
        advice.append(
            f"Operating temperature {temp:.0f} C exceeds the estimated service ceiling of "
            f"{derived['thermal_limit_c']} C. Add Mo/W for solid-solution creep resistance or apply a thermal barrier coating."
        )
    elif temp > 500 and mo < 0.02:
        advice.append(
            f"Above 500 C, raise Mo to 2-4 wt% (currently {mo*100:.1f} wt%) to suppress creep and retain yield strength."
        )
    if env in {"Marine / Salt Spray", "Acidic / Chemical"}:
        if cr < 0.12:
            advice.append(
                f"Corrosive service requires a passive Cr-rich surface; Cr is only {cr*100:.1f} wt%. Target >= 12 wt% Cr, ideally with 2% Mo."
            )
        else:
            advice.append(
                f"Cr at {cr*100:.1f} wt% supports a passive film. Verify pitting resistance equivalent number (PREN = Cr + 3.3Mo + 16N) for this chloride load."
            )
    if ni < 0.04 and derived["ductility_index"] < 0.5:
        advice.append(
            "Low Ni and low predicted ductility suggest brittle cleavage risk. 2-4 wt% Ni would improve toughness and austenite stability."
        )
    if c > 0.04:
        advice.append(
            f"Carbon is {c*100:.1f} wt%. Drop below 0.03 wt% or temper martensite to avoid a strength-ductility trade-off and weld cracking."
        )
    if ti + al > 0.12:
        advice.append(
            "Ti/Al content is age-hardenable territory. Solution-treat and age to form coherent gamma-prime / gamma-double-prime precipitates; avoid over-aging."
        )
    if al > 0.3:
        advice.append(
            "Aluminium-rich chemistry is density-optimised but has limited high-temperature capability. Consider Al-Li or Ti additions for stiffness."
        )
    if util > 1.0:
        advice.append(
            f"Design utilisation is {util:.2f} (>1.0). Increase section thickness, raise the safety factor, or select a higher-strength grade before prototyping."
        )
    elif util > 0.8:
        advice.append(
            f"Design utilisation is {util:.2f}. The alloy is workable but has a thin margin; validate with a tensile coupon at {temp:.0f} C."
        )
    else:
        advice.append(
            f"Design utilisation is {util:.2f}, leaving a healthy static margin. Confirm fatigue life for the '{payload.load_profile}' profile."
        )
    if payload.load_profile == "Cyclic / Fatigue":
        advice.append(
            "For cyclic loading, specify a fatigue limit from rotating-bend tests and apply surface treatment (shot peening) at stress risers."
        )
    if temp < -50:
        advice.append(
            "Cryogenic service: verify Charpy V-notch impact energy at the minimum design temperature; raise Ni for austenite stability."
        )
    steel_conf = targets["steels"]["confidence"]
    if steel_conf == "Low":
        advice.append(
            "The 150-tree ensemble is flagged for low confidence (wide epistemic spread). Treat this prediction as a screening hypothesis and commission lab validation."
        )
    elif steel_conf == "Medium":
        advice.append(
            "Medium confidence: the composition lies near the edge of the Matbench training manifold. A second model family or lab coupon is recommended."
        )
    if derived["cost_per_kg"] > 3000:
        advice.append(
            f"Raw material cost is INR {derived['cost_per_kg']:,.0f}/kg, driven by Ni/Mo/Ti. Consider leaner chemistry or near-net-shape processing."
        )
    if not advice:
        advice.append("The composition sits inside the dataset envelope with balanced properties. Proceed to coupon-level validation.")
    return advice


def run_simulation(payload: SimulateRequest, user: Optional[dict[str, Any]], ip: str = "") -> dict[str, Any]:
    require_model()
    fractions, rejected = normalise_elements(payload.elements)
    blocked = [sym for sym in fractions if sym in HAZARDOUS_ELEMENTS]

    if blocked:
        authorised = bool(
            payload.hazard_verified
            and user
            and user.get("kyb_status") == "approved"
            and user.get("tier") in {"pro", "enterprise"}
        )
        if not authorised:
            database.log_audit(
                user["email"] if user else "anonymous",
                "DUAL_USE_GUARDRAIL_BLOCK",
                f"Blocked elements: {', '.join(blocked)}",
                user_id=user["id"] if user else None,
                ip=ip,
            )
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "DUAL_USE_BLOCKED",
                    "message": "Dual-Use Hazardous Element Guardrail blocked this simulation.",
                    "blocked": [{"symbol": s, "reason": HAZARDOUS_META.get(s, "Restricted element")} for s in blocked],
                    "requires": "KYB-approved Pro Lab / Enterprise account plus explicit hazard-handling verification.",
                    "hazard_verified_received": bool(payload.hazard_verified),
                },
            )
        database.log_audit(
            user["email"] if user else "anonymous",
            "DUAL_USE_CLEARED",
            f"Cleared hazardous elements: {', '.join(blocked)}",
            user_id=user["id"] if user else None,
            ip=ip,
        )

    composition = composition_from_fractions(fractions)
    features = composition_features(composition)
    targets = {key: predict_dataset(key, features) for key in ("steels", "glass", "expt_gap")}

    density = estimate_density(fractions)
    cost = estimate_cost(fractions)
    limit_c = thermal_limit(fractions)
    corr = corrosion_index(fractions)
    duct = ductility_index(fractions)
    structure = payload.structure or recommend_structure(fractions, payload.temperature_c)

    env = ENVIRONMENTS[payload.environment]
    profile = LOAD_PROFILES[payload.load_profile]
    t_factor = thermal_factor(payload.temperature_c, limit_c)
    env_factor = env["factor"] * (0.80 + 0.20 * corr)
    strength_25c = max(1.0, targets["steels"]["predicted"] * env_factor * profile["factor"])

    # Liquidus failure: a weighted elemental melting check across the composition.
    is_melted, liquidus_c, liquidus_label, liquidus_message = calculate_liquidus_state(
        fractions, payload.temperature_c
    )

    # Working envelope: fluid density, static pressure, airspeed -> q = 0.5 rho v^2.
    environment = calculate_environment_parameters(
        density_gcm3=density,
        temperature_c=payload.temperature_c,
        velocity_kmh=payload.velocity_kmh,
        pressure_pa=payload.pressure_pa,
        environment_type=payload.environment,
        environment_density_kgm3=payload.environment_density_kgm3,
    )
    cryogenic = calculate_cryogenic_effects(payload.temperature_c) if payload.temperature_c <= -100 else None
    refractory = calculate_refractory_stability(payload.temperature_c) if payload.temperature_c >= 500 else None

    if is_melted:
        operating_strength = 0.0
        utilization = 99.0
        margin = -1.0
        max_safe_load = 0.0
    else:
        operating_strength = max(1.0, strength_25c * t_factor)
        applied_stress = payload.load_mpa * payload.safety_factor
        utilization = applied_stress / operating_strength
        margin = (operating_strength - applied_stress) / max(1.0, applied_stress)
        max_safe_load = operating_strength / payload.safety_factor

    applied_stress = payload.load_mpa * payload.safety_factor

    if is_melted:
        verdict = "MELTED"
        verdict_label = f"Melted — weighted liquidus {liquidus_c:,.0f} °C exceeded"
    elif environment["is_burst_condition"]:
        verdict = "UNSAFE"
        verdict_label = "Pressure burst — containment envelope exceeded"
    elif utilization <= 0.70:
        verdict = "SAFE"
        verdict_label = "Cleared for detailed design"
    elif utilization <= 0.95:
        verdict = "MARGINAL"
        verdict_label = "Marginal — reduce load or upgrade alloy"
    else:
        verdict = "UNSAFE"
        verdict_label = "Unsafe — redesign required"

    warnings: list[str] = []
    if is_melted:
        warnings.append(liquidus_message)
    if environment["is_burst_condition"]:
        warnings.append(
            f"Total pressure {format_pressure(environment['total_pressure_pa'])} reaches the "
            f"{format_pressure(environment['burst_pressure_pa'])} burst ceiling for this wall temperature."
        )
    if targets["steels"]["confidence"] == "Low":
        warnings.append("Low-confidence prediction: epistemic uncertainty exceeds the 66th percentile of the test set.")
    if payload.temperature_c > limit_c:
        warnings.append(f"Operating temperature exceeds the {limit_c} C estimated service limit.")
    if payload.temperature_c < -100:
        warnings.append("Deep cryogenic regime: ductile-to-brittle transition must be verified experimentally.")
    if fractions.get("C", 0) > 0.05:
        warnings.append("High carbon chemistry can reduce weldability and fracture toughness.")
    if blocked:
        warnings.append("Restricted elements accepted under KYB-verified dual-use clearance.")
    if rejected:
        warnings.append(f"Ignored unrecognised inputs: {', '.join(rejected)}")

    modulus = 210.0 * (1.0 - 0.38 * fractions.get("Al", 0) - 0.18 * fractions.get("Ti", 0)
                       - 0.08 * fractions.get("Ni", 0)) + 8.0 * fractions.get("Mo", 0)
    modulus = max(55.0, min(235.0, modulus))

    curve_25 = generate_stress_strain(strength_25c, duct, 25.0, modulus)
    curve_op = generate_stress_strain(operating_strength, duct, payload.temperature_c, modulus)

    temps = [-273.15, -200, -100, -50, 0, 25, 100, 300, 500, 800, 1100, 1500, 2000, 3000, 4500]
    degradation = {
        "temperature_c": temps,
        "strength_mpa": [round(strength_25c * thermal_factor(t, limit_c), 2) for t in temps],
        "thermal_limit_c": limit_c,
        "liquidus_c": liquidus_c,
        "operating_temperature_c": payload.temperature_c,
        "is_melted": is_melted,
    }

    percentile = lambda v, cap: round(max(2.0, min(100.0, v / cap * 100.0)), 1)
    radar = {
        "labels": ["Strength", "Ductility", "Thermal", "Corrosion", "Cost-Efficiency", "Weight-Efficiency"],
        "alloy": [
            percentile(targets["steels"]["predicted"], 1600),
            round(duct * 100, 1),
            percentile(limit_c, 1200),
            round(corr * 100, 1),
            round(max(2.0, min(100.0, 100.0 - math.log10(cost + 1) * 26.0)), 1),
            round(max(2.0, min(100.0, 100.0 - (density - 1.5) * 10.5)), 1),
        ],
        "benchmark": [52.0, 48.0, 55.0, 46.0, 58.0, 52.0],
        "confidence": targets["steels"]["confidence"],
        "confidence_score": {"High": 95.0, "Medium": 70.0, "Low": 38.0}[targets["steels"]["confidence"]],
    }

    fatigue_cycles = None
    if payload.load_profile == "Cyclic / Fatigue":
        exponent = 6.0 - 3.0 * max(0.0, utilization - 0.35)
        fatigue_cycles = int(max(2_000, min(10_000_000, 10 ** exponent)))

    derived = {
        "density_gcm3": density,
        "cost_per_kg": cost,
        "thermal_limit_c": limit_c,
        "liquidus_c": liquidus_c,
        "is_melted": is_melted,
        "liquidus_message": liquidus_message,
        "corrosion_index": corr,
        "ductility_index": duct,
        "modulus_gpa": round(modulus, 1),
        "crystal_structure": structure,
        "environment_factor": round(env_factor, 3),
        "profile_factor": profile["factor"],
        "thermal_factor": round(t_factor, 3),
        "strength_25c_mpa": round(strength_25c, 1),
        "operating_strength_mpa": round(operating_strength, 1),
        "applied_stress_mpa": round(applied_stress, 1),
        "utilization_ratio": round(utilization, 3),
        "safety_margin": round(margin, 3),
        "max_safe_load_mpa": round(max_safe_load, 1),
        "fatigue_cycles": fatigue_cycles,
        "verdict": verdict,
        "verdict_label": verdict_label,
        "hazard_blocked": False,
        "hazard_cleared": bool(blocked),
        "hazardous_elements": blocked,
        "rejected_elements": rejected,
        "medium_density_kgm3": environment["environment_density_kgm3"],
        "velocity_kmh": environment["velocity_kmh"],
        "velocity_ms": environment["velocity_ms"],
        "static_pressure_pa": environment["pressure_pa"],
        "dynamic_pressure_pa": environment["dynamic_pressure_pa"],
        "total_pressure_pa": environment["total_pressure_pa"],
        "total_pressure_mpa": environment["total_pressure_mpa"],
        "burst_pressure_pa": environment["burst_pressure_pa"],
        "pressure_ratio": environment["burst_ratio"],
        "is_burst_condition": environment["is_burst_condition"],
        "pressure_label": format_pressure(environment["total_pressure_pa"]),
        "cryogenic": cryogenic,
        "refractory": refractory,
        "oxygen_escape_kpa_min": calculate_oxygen_escape_rate(
            payload.temperature_c, environment["total_pressure_pa"], density
        ),
    }
    phase_rows = []
    for sym, frac in sorted(fractions.items(), key=lambda kv: kv[1], reverse=True):
        if frac <= 0:
            continue
        phase = element_phase_state(sym, payload.temperature_c, environment["total_pressure_pa"])
        phase_rows.append({
            "symbol": sym,
            "wt_pct": round(frac * 100, 2),
            "phase": phase["phase"],
            "note": phase["note"],
            "melting_point_c": phase["melting_c"],
            "boiling_point_c": phase["boiling_c"],
            "melting_effective_c": phase["melting_effective_c"],
            "boiling_effective_c": phase["boiling_effective_c"],
        })
    derived["element_phases"] = phase_rows
    derived["vaporized_elements"] = [row["symbol"] for row in phase_rows if row["phase"] == "GASEOUS / VAPORIZED"]
    derived["liquid_elements"] = [row["symbol"] for row in phase_rows if row["phase"] == "LIQUID"]
    derived["aggregate_phase"] = (
        "GASEOUS / VAPORIZED" if derived["vaporized_elements"] else
        "LIQUID" if derived["liquid_elements"] else "SOLID"
    )

    advice = build_advice(fractions, derived, targets, payload)
    if is_melted:
        hypothesis = (
            f"Liquidus screen failed: the weighted elemental melting point of this composition is "
            f"{liquidus_c:,.1f} C, below the {payload.temperature_c:,.1f} C operating temperature. "
            f"The Random Forest yield-strength prediction of {targets['steels']['predicted']:,.0f} MPa "
            f"({targets['steels']['confidence']} confidence) is void in the liquid state."
        )
    else:
        hypothesis = (
            f"The Magpie -> Random Forest (150-tree) ensemble predicts {targets['steels']['predicted']:,.0f} MPa yield strength "
            f"with +/-{targets['steels']['uncertainty']:,.0f} MPa epistemic spread ({targets['steels']['confidence']} confidence). "
            f"At {payload.temperature_c:.0f} C in {payload.environment}, the derated working strength is "
            f"{operating_strength:,.0f} MPa, giving a utilisation of {utilization:.2f} at a {payload.safety_factor:.1f} safety factor. "
            f"The weighted liquidus of {liquidus_c:,.0f} C leaves a {max(0.0, liquidus_c - payload.temperature_c):,.0f} C solid-state margin."
        )

    # Element payload for the WebGL colour engine.
    browser_elements = []
    for sym, frac in sorted(fractions.items(), key=lambda kv: kv[1], reverse=True):
        meta = element_meta(sym)
        browser_elements.append({
            "symbol": sym,
            "fraction": frac,
            "pct": round(frac * 100, 2),
            "name": meta["name"],
            "color": meta["color"],
            "radius": meta["radius"],
            "role": meta["role"],
            "hazardous": sym in HAZARDOUS_ELEMENTS,
            "phase": next((row["phase"] for row in derived["element_phases"] if row["symbol"] == sym), "SOLID"),
        })

    return {
        "product": "MATERIALHUNT",
        "engine": "Magpie composition features + 150-tree Random Forest ensemble",
        "timestamp": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "user": {"email": user["email"], "tier": user["tier_name"], "organization": user["organization_name"]} if user else None,
        "composition": {
            "formula": composition.reduced_formula,
            "formula_full": composition.formula,
            "fractions": fractions,
            "elements": browser_elements,
            "rejected": rejected,
            "hazardous": blocked,
        },
        "structure": structure,
        "prediction": targets["steels"],
        "targets": {
            "steels": targets["steels"],
            "glass": targets["glass"],
            "expt_gap": targets["expt_gap"],
        },
        "derived": derived,
        "environment": environment,
        "conditions": {
            "temperature_c": payload.temperature_c,
            "environment": payload.environment,
            "environment_note": env["note"],
            "load_profile": payload.load_profile,
            "load_profile_note": profile["note"],
            "load_mpa": payload.load_mpa,
            "safety_factor": payload.safety_factor,
            "hazard_verified": payload.hazard_verified,
            "environment_density_kgm3": environment["environment_density_kgm3"],
            "pressure_pa": environment["pressure_pa"],
            "velocity_kmh": environment["velocity_kmh"],
            "dynamic_pressure_pa": environment["dynamic_pressure_pa"],
        },
        "curves": {
            "room": curve_25,
            "operating": curve_op,
            "degradation": degradation,
        },
        "radar": radar,
        "pca": project_features(features),
        "advice": advice,
        "hypothesis": hypothesis,
        "warnings": warnings,
        "guardrail": {
            "restricted_elements": HAZARDOUS_ELEMENTS,
            "blocked": False,
            "cleared": bool(blocked),
            "message": "Dual-use guardrail cleared under verified KYB authority." if blocked else "No restricted elements detected.",
        },
        "benchmarks": {
            "steels": {
                "random_forest_r2": BUNDLE["datasets"]["steels"]["benchmarks"]["random_forest"]["r2"],
                "random_forest_mae": BUNDLE["datasets"]["steels"]["benchmarks"]["random_forest"]["mae"],
                "test_rows": BUNDLE["datasets"]["steels"]["benchmarks"]["test_rows"],
            }
        },
    }


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@app.post("/api/auth/register")
def register(payload: RegisterRequest, request: Request) -> dict[str, Any]:
    try:
        user = database.create_user(
            email=payload.email,
            password=payload.password,
            organization_name=payload.organization_name,
            org_id=payload.org_id,
            kyb_status="pending",
            tier="free",
            billing_status="PENDING KYB",
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    token = database.create_session(user["id"])
    database.log_audit(user["email"], "REGISTER", f"KYB pending for {user['organization_name']}",
                       user_id=user["id"], ip=client_ip(request))
    return {"ok": True, "token": token, "user": user, "waiver_label": database.WAIVER_LABEL}


@app.post("/api/auth/login")
def login(payload: LoginRequest, request: Request) -> dict[str, Any]:
    user = database.authenticate(payload.email, payload.password)
    if not user:
        database.log_audit(payload.email.strip().lower(), "LOGIN_FAILED", "Invalid credentials",
                           ip=client_ip(request))
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    token = database.create_session(user["id"])
    database.log_audit(user["email"], "LOGIN", "Session created", user_id=user["id"], ip=client_ip(request))
    return {"ok": True, "token": token, "user": user, "waiver_label": database.WAIVER_LABEL}


@app.post("/api/auth/guest-summit")
def guest_summit(request: Request) -> dict[str, Any]:
    """Legacy alias for the Interactive Pilot Sandbox (kept for old clients)."""
    user, token = database.create_pilot_user(mode="live_demo")
    database.log_audit(user["email"], "PILOT_SESSION", "Legacy guest alias opened pilot access",
                       user_id=user["id"], ip=client_ip(request))
    return {
        "ok": True,
        "token": token,
        "user": user,
        "mode": "live_demo",
        "waiver_label": database.WAIVER_LABEL,
        "kyb_badge": database.KYB_VERIFIED_BADGE,
        "message": "Pilot access granted: Enterprise VIP with a full fee waiver.",
    }


@app.get("/api/auth/me")
def me(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    return {"ok": True, "user": user, "waiver_label": database.WAIVER_LABEL}


@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    token = bearer_token(authorization)
    if token:
        database.revoke_session(token)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Discovery / pre-screen
# ---------------------------------------------------------------------------
@app.post("/api/prescreen")
def prescreen(payload: PrescreenRequest, user: Optional[dict[str, Any]] = Depends(optional_user)) -> dict[str, Any]:
    bundle = require_model()
    candidates: list[dict[str, Any]] = bundle["candidates"]
    allowed_datasets = {k for k in ("steels", "glass", "expt_gap") if k in payload.datasets} or {"steels", "glass", "expt_gap"}
    conf_floor = CONFIDENCE_RANK.get(payload.min_confidence, 1)
    include = {s[0].upper() + s[1:].lower() for s in payload.include_elements if s}
    exclude = {s[0].upper() + s[1:].lower() for s in payload.exclude_elements if s}
    query = payload.search.strip().lower()

    filtered: list[dict[str, Any]] = []
    for item in candidates:
        if item["dataset"] not in allowed_datasets:
            continue
        if CONFIDENCE_RANK.get(item["confidence"], 0) < conf_floor:
            continue
        if payload.max_cost is not None and item["cost_per_kg"] > payload.max_cost:
            continue
        if payload.max_density is not None and item["density"] > payload.max_density:
            continue
        if payload.min_predicted is not None and item["predicted"] < payload.min_predicted:
            continue
        element_set = set(item["element_list"])
        if include and not include.issubset(element_set):
            continue
        if exclude and exclude.intersection(element_set):
            continue
        if not payload.include_hazardous and item.get("hazardous"):
            continue
        if query and query not in item["formula"].lower() and query not in item["composition"].lower():
            continue
        filtered.append(item)

    persona = PERSONAS.get(payload.persona, PERSONAS["Aerospace"])
    weights = dict(persona["weights"])
    if payload.persona == "Custom Weights" and payload.custom_weights:
        for key in weights:
            try:
                weights[key] = max(0.0, float(payload.custom_weights.get(key, weights[key])))
            except (TypeError, ValueError):
                pass
        total = sum(weights.values()) or 1.0
        weights = {k: v / total for k, v in weights.items()}
    weight_total = sum(weights.values()) or 1.0
    weights = {k: v / weight_total for k, v in weights.items()}

    # Dataset-relative performance percentiles so steel MPa, glass GFA and gap
    # eV can be compared inside one multi-material ranking.
    by_dataset: dict[str, list[float]] = {}
    for item in filtered:
        by_dataset.setdefault(item["dataset"], []).append(item["predicted"])

    def percentile(value: float, dataset: str) -> float:
        values = by_dataset.get(dataset, [])
        if len(values) <= 1:
            return 58.0
        below = sum(1 for v in values if v <= value)
        return 4.0 + 96.0 * (below / len(values))

    if filtered:
        costs = [i["cost_per_kg"] for i in filtered]
        densities = [i["density"] for i in filtered]
        cmin, cmax = min(costs), max(costs)
        dmin, dmax = min(densities), max(densities)
    else:
        cmin = cmax = dmin = dmax = 0.0

    def inverse_norm(value: float, lo: float, hi: float) -> float:
        if hi <= lo:
            return 65.0
        return 4.0 + 96.0 * (1.0 - (value - lo) / (hi - lo))

    scored: list[dict[str, Any]] = []
    for item in filtered:
        metrics = {
            "strength": percentile(item["predicted"], item["dataset"]),
            "weight": inverse_norm(item["density"], dmin, dmax),
            "thermal": max(2.0, min(100.0, item["thermal_limit_c"] / 12.0)),
            "corrosion": item["corrosion_index"] * 100.0,
            "cost": inverse_norm(item["cost_per_kg"], cmin, cmax),
            "confidence": CONFIDENCE_SCORE.get(item["confidence"], 0.3) * 100.0,
        }
        score = sum(metrics[k] * weights.get(k, 0.0) for k in metrics)
        enriched = dict(item)
        enriched["metrics"] = {k: round(v, 1) for k, v in metrics.items()}
        enriched["rank_score"] = round(score, 1)
        enriched["persona"] = persona["label"]
        enriched["formula_short"] = short_formula(item.get("elements", {}))
        scored.append(enriched)

    scored.sort(key=lambda x: (-x["rank_score"], -x["predicted"]))
    for index, item in enumerate(scored, start=1):
        item["rank"] = index
    result = scored[: payload.limit]

    dataset_counts: dict[str, int] = {}
    for item in result:
        dataset_counts[item["dataset"]] = dataset_counts.get(item["dataset"], 0) + 1

    confidence_counts: dict[str, int] = {}
    for item in result:
        confidence_counts[item["confidence"]] = confidence_counts.get(item["confidence"], 0) + 1

    return {
        "ok": True,
        "count": len(result),
        "total_before_limit": len(scored),
        "candidates": result,
        "dataset_counts": dataset_counts,
        "confidence_counts": confidence_counts,
        "persona": persona["label"],
        "weights": weights,
        "persona_brief": persona["brief"],
        "filters": {
            "datasets": sorted(allowed_datasets),
            "min_confidence": payload.min_confidence,
            "include_elements": sorted(include),
            "exclude_elements": sorted(exclude),
            "max_cost": payload.max_cost,
            "max_density": payload.max_density,
            "min_predicted": payload.min_predicted,
            "search": payload.search,
            "include_hazardous": payload.include_hazardous,
        },
        "user_tier": user["tier_name"] if user else "Guest preview",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


@app.post("/api/simulate")
def simulate(payload: SimulateRequest, request: Request,
             user: Optional[dict[str, Any]] = Depends(optional_user)) -> dict[str, Any]:
    result = run_simulation(payload, user, client_ip(request))
    if user:
        database.log_audit(user["email"], "SIMULATE",
                           f"{result['composition']['formula']} @ {payload.temperature_c:.0f} C / {payload.load_mpa:.0f} MPa",
                           user_id=user["id"], ip=client_ip(request))
    return {"ok": True, **result}


# ---------------------------------------------------------------------------
# PDF report
# ---------------------------------------------------------------------------
def pdf_safe(text: Any) -> str:
    value = str(text)
    replacements = {
        "\u20b9": "Rs.", "\u00b0": " deg ", "\u2014": "-", "\u2013": "-",
        "\u2265": ">=", "\u2264": "<=", "\u00d7": "x", "\u00b2": "2",
        "\u0394": "Delta ", "\u00b1": "+/-", "\u2019": "'", "\u201c": '"', "\u201d": '"',
    }
    for src, dst in replacements.items():
        value = value.replace(src, dst)
    return value.encode("latin-1", "replace").decode("latin-1")


class ReportPDF(FPDF):
    def header(self) -> None:
        self.set_fill_color(7, 11, 20)
        self.rect(0, 0, 210, 30, style="F")
        self.set_fill_color(34, 211, 238)
        self.rect(0, 30, 210, 1.6, style="F")
        self.set_xy(14, 8)
        self.set_font("Helvetica", "B", 20)
        self.set_text_color(34, 211, 238)
        self.cell(70, 9, "MATERIALHUNT", new_x=XPos.RIGHT, new_y=YPos.TOP)
        self.set_font("Helvetica", "", 7.5)
        self.set_text_color(148, 163, 184)
        self.set_xy(14, 17)
        self.cell(0, 4, "AI-POWERED MULTI-MATERIAL DISCOVERY  |  3D ENGINEERING PRE-SCREENING", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_xy(150, 9)
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(16, 185, 129)
        self.cell(46, 5, "OFFLINE LAB REPORT", align="R")
        self.set_y(38)
        self.set_text_color(30, 41, 59)

    def footer(self) -> None:
        self.set_y(-14)
        self.set_draw_color(203, 213, 225)
        self.line(14, self.get_y(), 196, self.get_y())
        self.set_y(-12)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(100, 116, 139)
        self.cell(0, 5, pdf_safe(
            f"MATERIALHUNT offline engine v2.6  |  Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}  |  Page {self.page_no()}/{{nb}}"
        ), align="C")


def section_title(pdf: ReportPDF, title: str) -> None:
    if pdf.get_y() > 248:
        pdf.add_page()
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(8, 145, 178)
    pdf.cell(4, 5, "", new_x=XPos.RIGHT, new_y=YPos.TOP)
    pdf.cell(0, 5, pdf_safe(title.upper()), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_draw_color(34, 211, 238)
    y = pdf.get_y()
    pdf.line(14, y, 196, y)
    pdf.ln(2.5)
    pdf.set_text_color(30, 41, 59)


def key_value_grid(pdf: ReportPDF, rows: list[tuple[str, str]], cols: int = 2) -> None:
    width = 182 / cols
    for index, (key, value) in enumerate(rows):
        if pdf.get_y() > 252:
            pdf.add_page()
        x = 14 + (index % cols) * width
        if index % cols == 0:
            y = pdf.get_y()
        else:
            y = pdf.get_y()
        pdf.set_xy(x, y)
        pdf.set_font("Helvetica", "", 7)
        pdf.set_text_color(100, 116, 139)
        pdf.cell(width - 3, 4, pdf_safe(key), new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.set_xy(x, y + 4)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(15, 23, 42)
        pdf.cell(width - 3, 5, pdf_safe(value), new_x=XPos.RIGHT, new_y=YPos.TOP)
        if index % cols == cols - 1:
            pdf.ln(12)
    if len(rows) % cols:
        pdf.ln(12)


def table(pdf: ReportPDF, headers: list[str], rows: list[list[str]], widths: list[float]) -> None:
    if pdf.get_y() > 242:
        pdf.add_page()
    pdf.set_font("Helvetica", "B", 7.5)
    pdf.set_fill_color(241, 245, 249)
    pdf.set_text_color(51, 65, 85)
    for header, width in zip(headers, widths):
        pdf.cell(width, 6, pdf_safe(header), border=0, fill=True, new_x=XPos.RIGHT, new_y=YPos.TOP)
    pdf.ln(7)
    pdf.set_font("Helvetica", "", 7.5)
    pdf.set_text_color(30, 41, 59)
    for row in rows:
        if pdf.get_y() > 258:
            pdf.add_page()
            pdf.set_font("Helvetica", "B", 7.5)
            for header, width in zip(headers, widths):
                pdf.cell(width, 6, pdf_safe(header), border=0, fill=True, new_x=XPos.RIGHT, new_y=YPos.TOP)
            pdf.ln(7)
            pdf.set_font("Helvetica", "", 7.5)
        for value, width in zip(row, widths):
            pdf.cell(width, 5.6, pdf_safe(value), border="B", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.ln(5.6)


def build_pdf(sim: dict[str, Any], report_title: str, lab_reference: str) -> bytes:
    pdf = ReportPDF(orientation="P", unit="mm", format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(14, 36, 14)
    pdf.add_page()

    derived = sim["derived"]
    composition = sim["composition"]
    prediction = sim["prediction"]
    conditions = sim["conditions"]
    report_id = f"MH-{datetime.now().strftime('%y%m%d-%H%M%S')}-{random.randint(100, 999)}"

    pdf.set_font("Helvetica", "B", 15)
    pdf.set_text_color(7, 11, 20)
    pdf.cell(0, 8, pdf_safe(report_title), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(100, 116, 139)
    pdf.cell(0, 4, pdf_safe(f"Report {report_id}   |   Lab reference: {lab_reference or 'Not supplied'}   |   {sim['timestamp']}"),
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(4)

    section_title(pdf, "1. Client, KYB & Subscription")
    user = sim.get("user") or {}
    key_value_grid(pdf, [
        ("Account", user.get("email", "Offline demo")),
        ("Organisation", user.get("organization", "Independent Lab")),
        ("Subscription", user.get("tier", "Guest preview")),
        ("Verified engine", "Magpie + 150-tree Random Forest"),
    ])

    section_title(pdf, "2. Alloy Under Test")
    element_rows = [
        [e["symbol"], e["name"], f"{e['pct']:.2f}", e["role"]]
        for e in composition["elements"][:12]
    ]
    table(pdf, ["Element", "Name", "at.%", "Engineered role"], element_rows, [22, 40, 20, 100])
    pdf.ln(1)
    key_value_grid(pdf, [
        ("Formula", composition["formula"]),
        ("Crystal structure", derived["crystal_structure"]),
        ("Density", f"{derived['density_gcm3']:.2f} g/cm3"),
        ("Indicative cost", f"INR {derived['cost_per_kg']:,.0f} / kg"),
        ("Thermal ceiling", f"{derived['thermal_limit_c']} C"),
        ("Ductility index", f"{derived['ductility_index']:.2f} / 1.00"),
    ])

    section_title(pdf, "3. AI Prediction & Uncertainty")
    table(pdf, ["Target", "Prediction", "Epistemic +/-", "Confidence", "Benchmark R2"], [
        ["Yield strength", f"{prediction['predicted']:,.1f} MPa", f"{prediction['uncertainty']:,.1f} MPa",
         prediction["confidence"], f"{prediction['benchmark_r2']:.3f}"],
        ["Glass-forming ability", f"{sim['targets']['glass']['predicted']:,.1f} K",
         f"{sim['targets']['glass']['uncertainty']:,.1f} K", sim["targets"]["glass"]["confidence"],
         f"{sim['targets']['glass']['benchmark_r2']:.3f}"],
        ["Band gap", f"{sim['targets']['expt_gap']['predicted']:.3f} eV",
         f"{sim['targets']['expt_gap']['uncertainty']:.3f} eV", sim["targets"]["expt_gap"]["confidence"],
         f"{sim['targets']['expt_gap']['benchmark_r2']:.3f}"],
    ], [48, 38, 38, 28, 30])
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 8)
    pdf.multi_cell(0, 4.2, pdf_safe(
        "Epistemic uncertainty is the standard deviation across all 150 Random-Forest trees. "
        "High/Medium/Low confidence grades follow the held-out uncertainty terciles for each Matbench task."
    ), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    section_title(pdf, "4. Working Conditions")
    key_value_grid(pdf, [
        ("Temperature", f"{conditions['temperature_c']:.0f} C"),
        ("Environment", conditions["environment"]),
        ("Load profile", conditions["load_profile"]),
        ("Service load", f"{conditions['load_mpa']:,.0f} MPa"),
        ("Safety factor", f"{conditions['safety_factor']:.2f}"),
        ("Applied design stress", f"{derived['applied_stress_mpa']:,.1f} MPa"),
        ("Derated working strength", f"{derived['operating_strength_mpa']:,.1f} MPa"),
        ("Utilisation", f"{derived['utilization_ratio']:.2f}"),
    ])

    section_title(pdf, "5. Engineering Verdict")
    verdict_colors = {
        "SAFE": (16, 185, 129),
        "MARGINAL": (245, 158, 11),
        "UNSAFE": (239, 68, 68),
    }
    r, g, b = verdict_colors.get(derived["verdict"], (100, 116, 139))
    pdf.set_fill_color(r, g, b)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 9, pdf_safe(f"  {derived['verdict']}  |  {derived['verdict_label']}"),
             fill=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2)
    pdf.set_text_color(30, 41, 59)
    pdf.set_font("Helvetica", "", 8)
    pdf.multi_cell(0, 4.4, pdf_safe(sim["hypothesis"]), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(1)
    if derived.get("fatigue_cycles"):
        pdf.set_font("Helvetica", "B", 8)
        pdf.cell(0, 4.5, pdf_safe(f"Estimated fatigue life: {derived['fatigue_cycles']:,} cycles (screening estimate)."),
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    section_title(pdf, "6. AI Metallurgist Hypotheses")
    pdf.set_font("Helvetica", "", 8)
    for index, tip in enumerate(sim["advice"], start=1):
        if pdf.get_y() > 255:
            pdf.add_page()
            pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(8, 145, 178)
        pdf.cell(5, 4.3, f"{index}.", new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.set_text_color(30, 41, 59)
        pdf.multi_cell(0, 4.3, pdf_safe(tip), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(0.8)

    section_title(pdf, "7. Dual-Use Guardrail & Compliance")
    guard = sim["guardrail"]
    pdf.set_font("Helvetica", "", 8)
    pdf.multi_cell(0, 4.4, pdf_safe(guard["message"]), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.multi_cell(0, 4.4, pdf_safe(
        "Restricted elements (U, Pu, Th, Be, Cd, Hg, As) are blocked unless the account is KYB-approved "
        "Pro/Enterprise and the operator explicitly verifies hazardous-material handling authority."
    ), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if sim.get("warnings"):
        pdf.ln(1)
        pdf.set_font("Helvetica", "B", 8)
        pdf.cell(0, 4.4, "Risk flags", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_font("Helvetica", "", 7.5)
        for warning in sim["warnings"]:
            pdf.multi_cell(0, 4.1, pdf_safe(f"- {warning}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    if pdf.get_y() > 230:
        pdf.add_page()
    pdf.ln(5)
    pdf.set_draw_color(203, 213, 225)
    pdf.line(14, pdf.get_y(), 196, pdf.get_y())
    pdf.ln(2)
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(100, 116, 139)
    pdf.multi_cell(0, 3.8, pdf_safe(
        "Screening hypothesis only. MATERIALHUNT predictions are generated offline from Matbench-trained "
        "statistical models and do not replace certified tensile, corrosion, fatigue or NDT testing. "
        "All design decisions remain the responsibility of the qualified engineer of record."
    ), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "B", 7)
    pdf.set_text_color(8, 145, 178)
    pdf.cell(0, 5, "MATERIALHUNT  |  AI-POWERED MULTI-MATERIAL DISCOVERY", align="C",
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    return bytes(pdf.output())


@app.post("/api/report/pdf")
def report_pdf(payload: ReportRequest, request: Request,
               user: dict[str, Any] = Depends(require_user)):
    if user["tier"] == "free":
        raise HTTPException(
            status_code=402,
            detail="PDF lab reports require Pro Lab or Enterprise R&D. Summit VIP guests receive Enterprise access free.",
        )
    simulation = run_simulation(payload, user, client_ip(request))
    pdf_bytes = build_pdf(simulation, payload.report_title, payload.lab_reference)
    database.log_audit(user["email"], "PDF_EXPORT",
                       f"{simulation['composition']['formula']} report generated",
                       user_id=user["id"], ip=client_ip(request))
    filename_formula = re.sub(r"[^A-Za-z0-9._-]+", "", simulation["composition"]["formula"]) or "Alloy"
    filename = f"MATERIALHUNT_{filename_formula}_Report.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
            "Cache-Control": "no-store",
        },
    )


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------
@app.post("/api/feedback")
def submit_feedback(payload: FeedbackRequest, request: Request,
                    user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    item = database.add_feedback(
        user_id=user["id"], email=user["email"], rating=payload.rating,
        category=payload.category, message=payload.message,
    )
    database.log_audit(user["email"], "FEEDBACK", f"{payload.rating}-star {payload.category}",
                       user_id=user["id"], ip=client_ip(request))
    return {"ok": True, "feedback": item, "message": "Thank you — your feedback is in the founder triage queue."}


@app.get("/api/feedback/mine")
def my_feedback(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    items = [f for f in database.list_feedback() if f.get("user_id") == user["id"]]
    return {"ok": True, "items": items}


# ---------------------------------------------------------------------------
# Admin hidden vault
# ---------------------------------------------------------------------------
@app.post("/api/admin/login")
def admin_login(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    database.log_audit("admin-vault", "ADMIN_LOGIN", f"Vault opened from {admin['ip']}", ip=admin["ip"])
    return {"ok": True, "message": "Admin vault unlocked.", "snapshot": database.admin_snapshot()}


@app.get("/api/admin/overview")
def admin_overview(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return {"ok": True, "overview": database.overview_stats(), "audit": database.list_audit(20)}


@app.get("/api/admin/users")
def admin_users(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return {"ok": True, "users": database.list_users()}


@app.get("/api/admin/feedback")
def admin_feedback(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    items = database.list_feedback()
    ratings = [f["rating"] for f in items] or [0]
    return {
        "ok": True,
        "feedback": items,
        "average_rating": round(sum(ratings) / len(ratings), 2),
        "open_count": sum(1 for f in items if f["status"] == "Open"),
    }


@app.post("/api/admin/waive-fee")
def admin_waive_fee(payload: AdminActionRequest, request: Request,
                    admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    note = payload.note.strip() or "Summit VIP fee waiver granted from hidden admin vault"
    user = database.waive_fee(payload.user_id, note)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    database.log_audit("admin-vault", "FEE_WAIVER",
                       f"{user['email']} -> Enterprise / {database.WAIVER_LABEL}",
                       user_id=user["id"], ip=admin["ip"])
    return {"ok": True, "user": user, "waiver_label": database.WAIVER_LABEL,
            "message": f"Fee waived for {user['email']}. Enterprise R&D unlocked at INR 0."}


@app.post("/api/admin/approve-kyb")
def admin_approve_kyb(payload: AdminActionRequest, request: Request,
                      admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    user = database.approve_kyb(payload.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    database.log_audit("admin-vault", "KYB_APPROVED",
                       f"{user['email']} / {user['organization_name']} / {user['org_id']}",
                       user_id=user["id"], ip=admin["ip"])
    return {"ok": True, "user": user, "message": f"KYB approved for {user['organization_name']}."}


@app.post("/api/admin/feedback-triage")
def admin_triage(payload: AdminFeedbackRequest, request: Request,
                 admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    try:
        item = database.update_feedback(payload.feedback_id, payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not item:
        raise HTTPException(status_code=404, detail="Feedback not found.")
    database.log_audit("admin-vault", "FEEDBACK_TRIAGE", f"#{item['id']} -> {item['status']}", ip=admin["ip"])
    return {"ok": True, "feedback": item}


@app.get("/api/admin/snapshot")
def admin_snapshot(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return {"ok": True, "snapshot": database.admin_snapshot()}


# ---------------------------------------------------------------------------
# Commercial API (MATERIALHUNT Inc.)
# ---------------------------------------------------------------------------
class MissionRequest(BaseModel):
    prompt: str = Field(default="Design a high-strength aerospace alloy", max_length=600)
    persona: str = Field(default="Aerospace", max_length=40)


class AutoOptimizeRequest(BaseModel):
    target_material: str = Field(default="steel", max_length=50)
    constraints: dict[str, float] = Field(default_factory=dict)
    limit: int = Field(default=10, ge=1, le=40)

    @field_validator("target_material")
    @classmethod
    def valid_material_class(cls, value: str) -> str:
        cleaned = value.lower().strip()
        allowed = {"steel", "steel-alloy", "aluminium", "titanium", "niobium", "magnesium", "nickel", "cobalt"}
        return cleaned if cleaned in allowed else "steel"


class PilotRequest(BaseModel):
    mode: str = Field(default="live_demo", max_length=30)
    organization_name: Optional[str] = Field(default=None, max_length=120)


class EnvironmentPreviewRequest(BaseModel):
    environment: str = "Air / Industrial"
    environment_density_kgm3: Optional[float] = Field(default=None, ge=0, le=25000)
    temperature_c: float = Field(default=25, ge=-273.15, le=4500)
    pressure_pa: float = Field(default=101325, ge=0, le=1e16)
    velocity_kmh: float = Field(default=0, ge=0, le=3500)
    material_density_gcm3: float = Field(default=7.85, ge=0, le=30)

    @field_validator("environment")
    @classmethod
    def known_environment(cls, value: str) -> str:
        return value if value in ENVIRONMENTS else "Air / Industrial"


MISSION_INTENTS: dict[str, dict[str, Any]] = {
    "lightweight": {
        "keywords": ("light", "weight", "mass", "drone", "ev", "aerospace", "airframe", "portable"),
        "label": "Lightweighting campaign",
        "weights": {"strength": 0.34, "weight": 0.36, "thermal": 0.10, "cost": 0.12, "confidence": 0.08},
    },
    "corrosion": {
        "keywords": ("corrosion", "marine", "salt", "chloride", "acid", "chemical", "offshore"),
        "label": "Corrosion-resistant service",
        "weights": {"strength": 0.20, "weight": 0.10, "thermal": 0.08, "corrosion": 0.40, "cost": 0.12, "confidence": 0.10},
    },
    "high_temperature": {
        "keywords": ("temperature", "thermal", "heat", "turbine", "rocket", "hypersonic", "creep", "refractory", "nozzle"),
        "label": "High-temperature / creep service",
        "weights": {"strength": 0.30, "weight": 0.06, "thermal": 0.40, "corrosion": 0.08, "cost": 0.06, "confidence": 0.10},
    },
    "cost": {
        "keywords": ("cost", "cheap", "budget", "affordable", "price", "inr", "volume", "commercial"),
        "label": "Cost-down high-volume programme",
        "weights": {"strength": 0.24, "weight": 0.14, "thermal": 0.06, "corrosion": 0.06, "cost": 0.42, "confidence": 0.08},
    },
    "strength": {
        "keywords": ("strength", "strong", "load", "structural", "pressure", "fatigue", "safety"),
        "label": "Strength-critical structural design",
        "weights": {"strength": 0.46, "weight": 0.14, "thermal": 0.14, "corrosion": 0.08, "cost": 0.06, "confidence": 0.12},
    },
}


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _score_candidate(candidate: dict[str, Any], weights: dict[str, float]) -> float:
    """Commercial ranking score across strength, weight, thermal, corrosion and cost."""
    strength = float(candidate.get("predicted", 0.0)) if candidate.get("dataset") == "steels" else 700.0
    if strength <= 0:
        strength = 700.0
    density = float(candidate.get("density", 7.85) or 7.85)
    thermal = float(candidate.get("thermal_limit_c", 500) or 500)
    corrosion = float(candidate.get("corrosion_index", 0.5) or 0.5)
    cost = float(candidate.get("cost_per_kg", 500) or 500)
    confidence = {"High": 1.0, "Medium": 0.7, "Low": 0.4}.get(candidate.get("confidence", "Medium"), 0.7)

    components = {
        "strength": _clamp(strength / 1600.0 * 100.0),
        "weight": _clamp((1.0 - (density - 1.5) / 12.0) * 100.0),
        "thermal": _clamp(thermal / 1600.0 * 100.0),
        "corrosion": _clamp(corrosion * 100.0),
        "cost": _clamp((1.0 - min(1.0, cost / 6000.0)) * 100.0),
        "confidence": confidence * 100.0,
    }
    total_weight = sum(weights.values()) or 1.0
    return sum(components[key] * weight for key, weight in weights.items()) / total_weight


def detect_mission_intent(prompt: str) -> tuple[str, dict[str, Any]]:
    text = (prompt or "").lower()
    best_key, best_hits = "strength", 0
    for key, spec in MISSION_INTENTS.items():
        hits = sum(1 for word in spec["keywords"] if word in text)
        if hits > best_hits:
            best_key, best_hits = key, hits
    return best_key, MISSION_INTENTS[best_key]


@app.post("/api/mission-search")
def mission_search(payload: MissionRequest,
                   authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    """AI Mission Co-Pilot: translate a plain-language brief into a ranked shortlist."""
    bundle = require_model()
    user = optional_user(authorization)
    intent_key, intent = detect_mission_intent(payload.prompt)
    weights = dict(intent["weights"])

    scored: list[dict[str, Any]] = []
    for candidate in bundle.get("candidates", []):
        score = _score_candidate(candidate, weights)
        scored.append({
            "candidate_id": candidate.get("id"),
            "formula": candidate.get("formula", ""),
            "formula_full": candidate.get("formula_full", candidate.get("formula", "")),
            "formula_short": short_formula(candidate.get("elements", {})),
            "elements": candidate.get("elements", {}),
            "dataset": candidate.get("dataset"),
            "dataset_label": candidate.get("dataset_label"),
            "unit": candidate.get("unit", "MPa"),
            "strength_mpa": round(float(candidate.get("predicted", 0.0)), 1)
            if candidate.get("dataset") == "steels" else None,
            "density_gcm3": candidate.get("density"),
            "thermal_limit_c": candidate.get("thermal_limit_c"),
            "cost_per_kg": candidate.get("cost_per_kg"),
            "corrosion_index": candidate.get("corrosion_index"),
            "ductility_index": candidate.get("ductility_index"),
            "confidence": candidate.get("confidence", "Medium"),
            "alloy_class": candidate.get("alloy_class", "Candidate"),
            "rank_score": round(score, 2),
            "match_rationale": (
                f"Fits the {intent['label'].lower()} objective with "
                f"{candidate.get('confidence', 'Medium').lower()}-confidence predictions."
            ),
        })
    scored.sort(key=lambda item: item["rank_score"], reverse=True)
    shortlist = scored[:12]

    recommendation = (
        f"Mission intent classified as '{intent['label']}'. "
        f"Top candidate {shortlist[0]['formula']} ranks {shortlist[0]['rank_score']:.1f}/100. "
        if shortlist else "No candidate matched the mission brief."
    )
    recommendation += "Run the shortlist through the 3D Alloy & Mission Simulator before committing tooling."

    if user:
        database.log_audit(user["email"], "MISSION_SEARCH", payload.prompt[:180],
                           user_id=user.get("id"))

    return {
        "ok": True,
        "product": "MATERIALHUNT Inc.",
        "mission_id": f"MH-MSN-{secrets.token_hex(3).upper()}",
        "prompt": payload.prompt,
        "intent": {
            "key": intent_key,
            "label": intent["label"],
            "weights": weights,
            "confidence": "High" if len(payload.prompt) > 24 else "Medium",
        },
        "recommendation": recommendation,
        "results": shortlist,
        "candidates_evaluated": len(scored),
        "persona": payload.persona,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


def _auto_optimize(payload: AutoOptimizeRequest,
                   authorization: Optional[str]) -> dict[str, Any]:
    bundle = require_model()
    user = optional_user(authorization)
    constraints = payload.constraints or {}
    # Accept both commercial and engineering constraint keys.
    density_max = float(constraints.get("density_max_gcm3", constraints.get("max_density_gcm3", 8.6)))
    strength_min = float(constraints.get("strength_min_mpa", constraints.get("min_strength_mpa", 700)))
    temp_max = float(constraints.get("temperature_max_c", constraints.get("max_temperature_c", 700)))
    cost_max = float(constraints.get("cost_max_per_kg", constraints.get("max_cost_per_kg", 6000)))

    scored: list[dict[str, Any]] = []
    for candidate in bundle.get("candidates", []):
        density = float(candidate.get("density", 7.85) or 7.85)
        strength = float(candidate.get("predicted", 0.0)) if candidate.get("dataset") == "steels" else 700.0
        thermal = float(candidate.get("thermal_limit_c", 500) or 500)
        cost = float(candidate.get("cost_per_kg", 500) or 500)
        if density > density_max or strength < strength_min or thermal < temp_max or cost > cost_max:
            continue
        score = (
            0.45 * _clamp(strength / 1600.0 * 100.0)
            + 0.25 * _clamp((1.0 - (density - 1.5) / 10.0) * 100.0)
            + 0.15 * _clamp(thermal / 1600.0 * 100.0)
            + 0.15 * _clamp((1.0 - min(1.0, cost / max(1.0, cost_max))) * 100.0)
        )
        scored.append({
            "formula": candidate.get("formula", ""),
            "dataset": candidate.get("dataset"),
            "strength_mpa": round(strength, 1),
            "density_gcm3": round(density, 3),
            "thermal_limit_c": round(thermal, 0),
            "cost_per_kg": round(cost, 2),
            "confidence": candidate.get("confidence", "Medium"),
            "alloy_class": candidate.get("alloy_class", "Candidate"),
            "score": round(score, 2),
        })
    scored.sort(key=lambda item: item["score"], reverse=True)
    for index, item in enumerate(scored, start=1):
        item["rank"] = index

    if user:
        database.log_audit(user["email"], "AUTO_OPTIMIZE",
                           f"{payload.target_material}: {len(scored)} feasible", user_id=user.get("id"))

    return {
        "ok": True,
        "product": "MATERIALHUNT Inc.",
        "optimization": {
            "target_material_class": payload.target_material,
            "constraints": {
                "density_max_gcm3": density_max,
                "strength_min_mpa": strength_min,
                "temperature_max_c": temp_max,
                "cost_max_per_kg": cost_max,
            },
            "objective": "45% strength · 25% weight · 15% thermal headroom · 15% cost efficiency",
            "feasible_candidates": len(scored),
            "database_coverage": len(bundle.get("candidates", [])),
            "status": "OPTIMISED" if scored else "NO_FEASIBLE_REGION",
        },
        "recommendations": scored[: payload.limit],
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


@app.post("/api/optimize")
def auto_optimize(payload: AutoOptimizeRequest,
                  authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    """Auto-Optimizer: constraint-driven ranking of the validated candidate space."""
    return _auto_optimize(payload, authorization)


@app.get("/api/labels")
def commercial_labels() -> dict[str, Any]:
    return {"ok": True, "labels": MATERIALHUNT_LABELS,
            "waiver_label": database.WAIVER_LABEL,
            "kyb_badge": database.KYB_VERIFIED_BADGE}


@app.post("/api/environment")
def environment_preview(payload: EnvironmentPreviewRequest) -> dict[str, Any]:
    """Live pressure / dynamic-head preview for the simulator HUD."""
    params = calculate_environment_parameters(
        density_gcm3=payload.material_density_gcm3,
        temperature_c=payload.temperature_c,
        velocity_kmh=payload.velocity_kmh,
        pressure_pa=payload.pressure_pa,
        environment_type=payload.environment,
        environment_density_kgm3=payload.environment_density_kgm3,
    )
    return {"ok": True, "environment": params, "environment_note": ENVIRONMENTS[payload.environment]["note"]}


@app.post("/api/auth/pilot-guest")
def pilot_guest(request: Request,
                mode: str = Query(default="live_demo", max_length=30),
                payload: Optional[PilotRequest] = None) -> dict[str, Any]:
    """Open the Interactive Pilot Sandbox.

    Canonical mode is ``?mode=live_demo``. ``?mode=summit_test`` remains a
    silent alias so legacy expo links keep working.
    """
    body_mode = (payload.mode if payload else "") or ""
    requested = (body_mode or mode or "live_demo").strip().lower()
    canonical = "live_demo" if requested in {"summit_test", "live_demo", "summit", "demo"} else "live_pilot"
    organization = (payload.organization_name if payload and payload.organization_name
                    else "MATERIALHUNT Interactive R&D Sandbox")

    user, token = database.create_pilot_user(mode=canonical, organization_name=organization)
    database.log_audit(user["email"], "PILOT_SESSION", f"{canonical} pilot grant issued",
                       user_id=user["id"], ip=client_ip(request))

    return {
        "ok": True,
        "product": "MATERIALHUNT Inc.",
        "token": token,
        "user": user,
        "waiver_label": database.WAIVER_LABEL,
        "kyb_badge": database.KYB_VERIFIED_BADGE,
        "mode": canonical,
        "labels": MATERIALHUNT_LABELS,
        "sandbox": {
            "mode": canonical,
            "title": MATERIALHUNT_LABELS["mode"]["live_demo"],
            "features": {
                "periodic_table_elements": 118,
                "three_d_simulator": True,
                "battle_arena": True,
                "batch_csv": True,
                "pdf_export": True,
                "temperature_range_c": "-273.15 to 4500",
                "pressure_range_pa": "0 to ∞ (burst detection)",
                "velocity_range_kmh": "0 to 3500",
                "medium_density_range_kgm3": "0 to 25000+",
            },
        },
        "timestamp": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


# ---------------------------------------------------------------------------
# Global R&D Discovery Leaderboard
# ---------------------------------------------------------------------------
@app.get("/api/leaderboard")
def public_leaderboard(limit: int = Query(default=20, ge=1, le=100)) -> dict[str, Any]:
    rows = database.leaderboard(limit=limit)
    return {
        "ok": True,
        "title": MATERIALHUNT_LABELS["leaderboard"]["title"],
        "subtitle": MATERIALHUNT_LABELS["leaderboard"]["subtitle"],
        "leaders": rows,
        "stats": database.leaderboard_stats(),
    }


@app.post("/api/leaderboard/submit")
def submit_leaderboard(payload: SimulateRequest, request: Request,
                       authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    """Publish a verified simulation to the Global R&D Discovery Leaderboard."""
    user = require_user(authorization)
    sim = run_simulation(payload, user, ip=client_ip(request))
    derived = sim["derived"]
    actor = user.get("organization_name") or user["email"]

    # Verified Discovery Index: strength, mass, thermal headroom, cost and
    # ensemble confidence, normalised to 0-100 for cross-lab ranking.
    confidence_score = {"High": 95.0, "Medium": 72.0, "Low": 45.0}.get(
        sim["prediction"]["confidence"], 72.0
    )
    rank_score = round(
        0.35 * max(0.0, min(100.0, derived["operating_strength_mpa"] / 16.0))
        + 0.20 * max(0.0, min(100.0, 100.0 - (derived["density_gcm3"] - 1.5) * 9.0))
        + 0.15 * max(0.0, min(100.0, derived["thermal_limit_c"] / 12.0))
        + 0.15 * max(0.0, min(100.0, 100.0 - derived["cost_per_kg"] / 80.0))
        + 0.15 * confidence_score,
        2,
    )

    entry = database.push_leaderboard(
        user_id=user["id"],
        actor=actor,
        dataset="steels",
        formula=sim["composition"]["formula"],
        predicted=derived["operating_strength_mpa"],
        unit="MPa",
        confidence=sim["prediction"]["confidence"],
        rank_score=rank_score,
        persona=payload.environment,
        discovery_note=f"Utilisation {derived['utilization_ratio']:.2f} at {payload.temperature_c:.0f} °C",
    )
    database.record_discovery(user["id"], actor, "simulate", sim["composition"]["formula"],
                              derived["verdict"], derived["verdict_label"], ip=client_ip(request))
    return {"ok": True, "entry": entry, "stats": database.leaderboard_stats()}


# ---------------------------------------------------------------------------
# Founder vault extensions
# ---------------------------------------------------------------------------
@app.post("/api/admin/mint-pilot")
def admin_mint_pilot(request: Request,
                     mode: str = Query(default="live_demo", max_length=30),
                     admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    user, token = database.create_pilot_user(mode="live_demo" if mode != "live_pilot" else "live_pilot")
    database.log_audit("founder-vault", "PILOT_MINTED", user["email"],
                       user_id=user["id"], ip=client_ip(request))
    return {"ok": True, "user": user, "token": token,
            "waiver_label": database.WAIVER_LABEL, "kyb_badge": database.KYB_VERIFIED_BADGE}


@app.get("/api/admin/discoveries")
def admin_discoveries(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return {"ok": True, "discoveries": database.list_discovery(limit=60),
            "leaderboard": database.leaderboard(limit=40),
            "stats": database.leaderboard_stats()}


def format_pressure(value_pa: float) -> str:
    """Human-readable pressure label across Pa, kPa, MPa, GPa and burst."""
    if value_pa >= 1e15:
        return "∞ Burst"
    if value_pa >= 1e9:
        return f"{value_pa / 1e9:,.2f} GPa"
    if value_pa >= 1e6:
        return f"{value_pa / 1e6:,.2f} MPa"
    if value_pa >= 1e3:
        return f"{value_pa / 1e3:,.1f} kPa"
    return f"{value_pa:,.0f} Pa"


# ---------------------------------------------------------------------------
# Public metadata / health
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict[str, Any]:
    assets = {}
    for name in ("three.min.js", "plotly.min.js"):
        path = STATIC_DIR / "vendor" / name
        assets[name] = {"present": path.exists(), "bytes": path.stat().st_size if path.exists() else 0}
    return {
        "status": "online" if BUNDLE is not None else "degraded",
        "product": "MATERIALHUNT",
        "version": "2.6.0",
        "model_loaded": BUNDLE is not None,
        "model_error": BUNDLE_ERROR or None,
        "offline": True,
        "uptime_seconds": round(time.time() - SERVER_START, 1),
        "assets": assets,
        "database": database.DB_PATH.name,
    }


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    bundle = require_model()
    datasets = {
        key: {
            "key": key,
            "label": ds["label"],
            "target_name": ds["target_name"],
            "target_short": ds["target_short"],
            "unit": ds["unit"],
            "benchmarks": ds["benchmarks"],
            "uncertainty_thresholds": ds["uncertainty_thresholds"],
            "feature_importances": ds["feature_importances"],
            "test_r2": ds["test_r2"],
            "test_mae": ds["test_mae"],
            "rows": ds["benchmarks"]["dataset_rows"],
            "best_model": ds["best_model"],
        }
        for key, ds in bundle["datasets"].items()
    }
    return {
        "ok": True,
        "product": "MATERIALHUNT",
        "version": bundle["version"],
        "tagline": "AI-Powered Multi-Material Discovery & 3D Engineering Pre-Screening",
        "created_utc": bundle["created_utc"],
        "training_seconds": bundle["training_seconds"],
        "feature_count": len(bundle["feature_names"]),
        "datasets": datasets,
        "personas": PERSONAS,
        "environments": ENVIRONMENTS,
        "load_profiles": LOAD_PROFILES,
        "structures": ["BCC", "FCC", "HCP"],
        "ui_elements": UI_ELEMENTS,
        "elements": element_payload(),
        "tiers": database.TIERS,
        "waiver_label": database.WAIVER_LABEL,
        "kyb_badge": database.KYB_VERIFIED_BADGE,
        "labels": MATERIALHUNT_LABELS,
        "hazardous_elements": HAZARDOUS_ELEMENTS,
        "hazardous_meta": HAZARDOUS_META,
        "feature_space": bundle["feature_space"],
        "pca_explained_variance": bundle["global_pca"]["explained_variance"],
        "candidate_total": len(bundle["candidates"]),
        "benchmark_protocol": bundle["benchmark_protocol"],
        "uncertainty_protocol": bundle["uncertainty_protocol"],
        "admin_gate_hint": "Hidden vault available at ?gate=mh_vault_99x",
        "simulation_envelope": {
            "temperature_c": {"min": -273.15, "max": 4500},
            "pressure_pa": {"min": 0, "max": 1e16, "note": "0 Pa to infinity, burst detection above the wall ceiling"},
            "velocity_kmh": {"min": 0, "max": 3500, "note": "dynamic head q = 0.5 · rho · v²"},
            "medium_density_kgm3": {"min": 0, "max": 25000},
            "stress_mpa": {"min": 0, "max": 1e9},
        },
        "validated_alloys": VALIDATED_ALLOYS,
    }


@app.get("/api/elements")
def elements(temperature_c: float = Query(default=25.0, ge=-273.15, le=4500.0),
             pressure_pa: float = Query(default=101325.0, ge=0.0, le=1e16)) -> dict[str, Any]:
    table = []
    for row in periodic_table_payload():
        enriched = dict(row)
        phase = element_phase_state(row["symbol"], temperature_c, pressure_pa)
        enriched.update({
            "phase": phase["phase"],
            "phase_note": phase["note"],
            "melting_effective_c": phase["melting_effective_c"],
            "boiling_effective_c": phase["boiling_effective_c"],
            "sublimation_effective_c": phase["sublimation_effective_c"],
        })
        table.append(enriched)
    return {"ok": True, "elements": element_payload(), "ui_elements": UI_ELEMENTS,
            "hazardous_elements": HAZARDOUS_ELEMENTS, "hazardous_meta": HAZARDOUS_META,
            "periodic_table": table, "periodic_table_count": len(table),
            "category_colors": CATEGORY_COLORS,
            "temperature_c": temperature_c, "pressure_pa": pressure_pa,
            "phase_states": sorted({row["phase"] for row in table}),
            "carbon_note": "Carbon does not melt at 1 atm: it sublimates at 3,642 °C."}


@app.get("/api/alloys/validated")
def validated_alloys() -> dict[str, Any]:
    """Authentic commercial alloy handbook used by the arena and pre-screening."""
    return {"ok": True, "count": len(VALIDATED_ALLOYS), "alloys": VALIDATED_ALLOYS,
            "standards": sorted({a["standard"].split(" / ")[0] for a in VALIDATED_ALLOYS})}


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------
@app.get("/favicon.svg")
def favicon() -> Response:
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="14" fill="#070B14"/>'
        '<path d="M32 8 53 20v24L32 56 11 44V20Z" fill="none" stroke="#22D3EE" stroke-width="3"/>'
        '<circle cx="32" cy="32" r="7" fill="#10B981"/>'
        '<circle cx="32" cy="32" r="13" fill="none" stroke="#22D3EE" stroke-width="1.5" opacity=".6"/>'
        "</svg>"
    )
    return Response(content=svg, media_type="image/svg+xml")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/{full_path:path}")
def static_fallback(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found.")
    candidate = (STATIC_DIR / full_path).resolve()
    try:
        candidate.relative_to(STATIC_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found.")
    if candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    print("=" * 74)
    print("  MATERIALHUNT — AI Multi-Material Discovery & 3D Engineering SaaS")
    print("  Offline server: http://localhost:8000")
    print("  Admin vault:    http://localhost:8000/?gate=mh_vault_99x")
    print("=" * 74)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False, log_level="info")
