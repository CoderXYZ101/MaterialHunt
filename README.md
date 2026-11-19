# MATERIALHUNT Inc.

**Deep-tech materials intelligence — 3D alloy & mission simulation, AI shortlisting and enterprise
pre-screening. 100% offline, single-laptop deployable.**

MATERIALHUNT is a self-contained full-stack B2B SaaS: a FastAPI backend, real Matbench-trained
machine-learning ensembles, a SQLite multi-tenant auth / KYB / subscription / audit layer, board-ready
PDF dossiers, and an 8-module glassmorphic frontend with a local WebGL viewer (Three.js) and live Plotly
analytics. Every vendor asset is bundled locally — zero CDN calls, zero telemetry.

```
http://localhost:8000                        → application (8 modules)
http://localhost:8000/?mode=live_demo        → Interactive Pilot Sandbox (Enterprise VIP, fee waived)
http://localhost:8000/?mode=summit_test      → silent alias for legacy expo links
http://localhost:8000/?gate=mh_vault_99x     → hidden founder vault
http://localhost:8000/docs                   → FastAPI OpenAPI docs
```

---

## 1. The eight commercial modules

| # | Module | What it does |
|---|---|---|
| 1 | **3D Alloy & Mission Simulator** | 118-element composition builder, −273.15 °C → +3,500 °C, 0 Pa → ∞ burst pressure, 0 → 3,500 km/h airspeed, 0 → 25,000+ kg/m³ medium density, weighted liquidus `MELTED` failure, utilisation ring, 3D lattice / tensile viewer |
| 2 | **Alloy A vs. B Battle Arena** | Two chemistries under identical service conditions, weighted category wins, radar overlay, per-metric winner table |
| 3 | **Multi-Material Pre-Screening & PDF** | Three Matbench tasks, persona weighting, uncertainty grading, Ashby map, six-axis radar, PCA-3 manifold, PDF dossier |
| 4 | **Deep Engineering Analytics** | Eleven live Plotly panels: benchmark ladder, feature attribution, coverage, error, training cost, parity, uncertainty, cost-density, task fingerprint, PCA cluster |
| 5 | **Enterprise Batch CSV & Custom Lab Data** | 25-composition batch queue from paste or CSV upload, per-row verdicts, CSV export, measured-coupon bias validation |
| 6 | **R&D ROI Calculator** | Avoided experiments → annual savings, payback, engineering days recovered, cash-flow comparison |
| 7 | **Global R&D Discovery Leaderboard & 0–5★ Feedback** | Verified enterprise discoveries ranked by discovery score, publish-from-simulation, inline 0–5★ rating |
| 8 | **Pricing, Corporate KYB & Compliance** | Free Starter / Pro Lab / Enterprise R&D / VIP GRANT tiers, four-step KYB onboarding, compliance posture |

A ninth, hidden **Founder Vault** view (`?gate=mh_vault_99x`) sits outside the eight commercial tabs.

---

## 2. Simulation envelope

| Dimension | Range | Behaviour |
|---|---|---|
| Temperature | −273.15 °C → +3,500 °C | Cryogenic block below −100 °C, refractory block above +500 °C, 15-point degradation curve |
| Static pressure | 0 Pa → ∞ | Pa / kPa / MPa / GPa / ∞ Burst units, temperature-dependent burst ceiling |
| Velocity | 0 → 3,500 km/h | Dynamic head `q = ½ρv²` added to static pressure |
| Medium density | 0 → 25,000+ kg/m³ | Air, argon, LNG, steam, seawater, acid, steel melt, dense slurry chips |
| Applied stress | 0 → 1 GPa | Utilisation = `load × safety / derated strength` |
| Liquidus | Weighted elemental melting point | Verdict `MELTED` when service temperature ≥ weighted liquidus |
| Elements | All 118 | Periodic-table modal with category colours and engineering metadata |

---

## 3. Quick start

### 3.1 Requirements

* Python **3.12** (tested on Windows 11; Linux/macOS identical)
* `pip`
* No Node.js, no internet, no external services

### 3.2 Install

```powershell
cd G:\MaterialHunt
python -m pip install -r requirements.txt
```

### 3.3 Train the models (first run only, ~18 minutes on CPU)

```powershell
python train_model.py
```

The three Matbench datasets are downloaded **once** and cached inside `matminer/datasets/`. Training
featurises every composition with the Magpie `ElementProperty` preset, benchmarks Linear Regression vs
Random Forest (`n_estimators=150`) vs Gradient Boosting on an 80/20 split (`random_state=42`), fits the
global PCA-3 basis, and writes `materialhunt_bundle.pkl` (≈8.8 MB).

| Task | Rows | RF R² | RF MAE | Best model |
|---|---:|---:|---:|---|
| Matbench Steels (yield strength) | 312 | 0.706 | 92.03 MPa | Random Forest |
| Matbench Glass (GFA) | 5 680 | 0.611 | 0.162 K | Random Forest |
| Matbench Expt Gap (band gap) | 4 604 | 0.677 | 0.448 eV | Random Forest |

### 3.4 Run

```powershell
python main.py
```

Open **http://localhost:8000**. The header badge reads **OFFLINE READY** when the bundle and both
vendored JS libraries are present.

---

## 4. Accounts, tiers and the vault

### 4.1 Seeded accounts

| Email | Password | Organisation | Tier | KYB |
|---|---|---|---|---|
| `demo@materialhunt.ai` | `Demo@2026` | IIT Bombay Metallurgy Lab | Pro Lab ₹4,999/mo | approved |
| `rnd@vajra-aero.in` | `Vajra@2026` | Vajra Aerospace Materials | Free Starter | pending |
| `admin@materialhunt.ai` | `MH_FOUNDER_2026#` | MATERIALHUNT Command | Enterprise R&D | approved |

Passwords use **PBKDF2-HMAC-SHA256**, 260 000 iterations, with a unique 16-byte salt per user. Sessions
are opaque 36-byte URL-safe tokens with a 24-hour expiry.

### 4.2 Interactive Pilot Sandbox

Open `http://localhost:8000/?mode=live_demo`. The SPA calls `POST /api/auth/pilot-guest?mode=live_demo`,
which provisions a throwaway Enterprise R&D account marked **VIP GRANT — FEE WAIVED (₹0)** and
**ENTERPRISE VIP · KYB VERIFIED**, then shows the Enterprise banner.

`?mode=summit_test` continues to work as a **silent alias** so existing expo QR codes resolve to the same
canonical `live_demo` pilot. `/api/auth/guest-summit` also remains as a silent backend alias.

### 4.3 Tiers

| Tier | Price | Limits |
|---|---|---|
| Free Starter | ₹0 | 3 pre-screens / month, ML predictions |
| Pro Lab | ₹4,999 / month | 100 pre-screens, uncertainty grading, PDF reports, analytics |
| Enterprise R&D | ₹19,999 / month | Unlimited, KYB + hazardous clearance, admin API + audit, priority support |
| VIP GRANT | **FEE WAIVED (₹0)** | Enterprise access granted by the founder vault or pilot programme |

### 4.4 Founder vault

```
http://localhost:8000/?gate=mh_vault_99x
```

Passkey: **`MH_FOUNDER_2026#`**

The passkey is verified against a PBKDF2 hash stored in `app_settings` (not in source). **Three failed
attempts lock that client IP for 15 minutes** (HTTP 423 with `retry_after_seconds`); a successful unlock
resets the counter. Every action is written to `audit_logs`.

Vault capabilities:

* One-click **fee waiver** → Enterprise R&D at ₹0 with the `VIP GRANT — FEE WAIVED (₹0)` label
* **KYB approval** for pending organisations
* **Feedback triage** → Resolved / Dismissed
* **Mint Pilot** → instant Enterprise VIP sandbox account
* Live overview: accounts, MRR, waived accounts, pending KYB, average rating, audit count
* Global R&D Discovery Leaderboard inspection
* Immutable audit trail of logins, simulations, guardrail blocks, PDF exports and admin actions

---

## 5. Architecture

```
G:\MaterialHunt
├── main.py                  FastAPI app: REST API, ML inference, simulator, PDF, static serving
├── database.py              SQLite schema, PBKDF2 auth, KYB, tiers, feedback, leaderboard, admin guard
├── material_data.py         Element constants, 118-element payload, liquidus + environment physics
├── train_model.py           Matbench training, benchmarking, uncertainty, PCA, bundle writer
├── requirements.txt         Pinned Python dependencies
├── materialhunt_bundle.pkl  Trained artefacts (generated)
├── materialhunt.db          SQLite database (generated on first boot)
├── verify.py                End-to-end offline verification suite
└── static
    ├── index.html           8-module SPA shell, periodic table, footer, vault, auth, feedback
    ├── style.css            Glassmorphic dark industrial / light lab design system
    ├── app.js               Router, API client, Three.js scenes, Plotly charts, module controllers
    └── vendor
        ├── three.min.js     Three.js r160   (≈654 KB, bundled)
        └── plotly.min.js    Plotly.js 2.35 (≈4.3 MB, bundled)
```

### 5.1 REST API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | Model + asset status, uptime |
| GET | `/api/meta` | — | Datasets, personas, tiers, labels, simulation envelope, feature space |
| GET | `/api/elements` | — | 118-element periodic table + hazard list + category colours |
| POST | `/api/auth/register` | — | Create account (KYB pending, Free Starter) |
| POST | `/api/auth/login` | — | PBKDF2 login → session token |
| POST | `/api/auth/pilot-guest?mode=live_demo` | — | Interactive Pilot Sandbox (Enterprise VIP, fee waived) |
| POST | `/api/auth/guest-summit` | — | Silent legacy alias for the pilot sandbox |
| GET | `/api/auth/me` | Bearer | Current user |
| POST | `/api/auth/logout` | Bearer | Revoke session |
| POST | `/api/prescreen` | optional | Multi-dataset filter + persona ranking |
| POST | `/api/simulate` | optional | Full working-condition simulation, liquidus + pressure envelope, guardrail |
| POST | `/api/mission-search` | optional | AI Mission Co-Pilot: brief → ranked shortlist |
| POST | `/api/optimize` | optional | Auto-Optimizer: constraint-driven candidate ranking |
| POST | `/api/environment` | — | Live ½ρv² / total pressure preview |
| GET | `/api/labels` | — | Commercial label pack |
| GET | `/api/leaderboard` | — | Global R&D Discovery Leaderboard + stats |
| POST | `/api/leaderboard/submit` | Bearer | Publish a verified discovery |
| POST | `/api/report/pdf` | Bearer (Pro+) | FPDF2 lab dossier (`%PDF` stream) |
| POST | `/api/feedback` | Bearer | 0–5★ rating / issue report |
| GET | `/api/feedback/mine` | Bearer | Own feedback |
| POST | `/api/admin/login` | gate + passkey | Unlock + snapshot |
| GET | `/api/admin/snapshot` | gate + passkey | Users, feedback, audit, overview |
| GET | `/api/admin/overview` · `/users` · `/feedback` | gate + passkey | Individual slices |
| POST | `/api/admin/waive-fee` | gate + passkey | Grant VIP GRANT — FEE WAIVED (₹0) |
| POST | `/api/admin/approve-kyb` | gate + passkey | Approve KYB |
| POST | `/api/admin/feedback-triage` | gate + passkey | Resolve / dismiss feedback |
| POST | `/api/admin/mint-pilot` | gate + passkey | Mint an Enterprise VIP pilot |
| GET | `/api/admin/discoveries` | gate + passkey | Discoveries + leaderboard |

Admin routes require **both** `?gate=mh_vault_99x` **and** the `X-Admin-Passkey` header. A gate mismatch
returns 404, so the vault is invisible without the secret query parameter.

### 5.2 Machine-learning pipeline

1. **Dataset** — `matbench_steels`, `matbench_glass`, `matbench_expt_gap` via matminer.
2. **Featuriser** — `ElementProperty.from_preset("magpie")` → 132 composition descriptors.
3. **Split** — 80/20 hold-out, `random_state=42`.
4. **Models** — Linear Regression baseline; `RandomForestRegressor(n_estimators=150)`;
   `GradientBoostingRegressor`.
5. **Uncertainty** — standard deviation of the 150 tree predictions; confidence boundaries are the
   held-out test-set terciles per task.
6. **Importances** — top-10 Random Forest impurity importances per dataset.
7. **PCA-3** — one global scaler + PCA basis fitted across all Magpie matrices, so custom alloys land in
   the same coordinate system as the candidate cloud.
8. **Bundle** — models, imputers, featuriser, metrics, thresholds, candidates and cluster points are
   serialised with joblib.

Inference is pinned to `n_jobs=1` so a single request never spawns a Windows process pool.

### 5.3 Dual-Use guardrail

Simulations containing **U, Pu, Th, Be, Br, Cd, Hg, As** are rejected with HTTP 403
`code: DUAL_USE_BLOCKED` unless *all* of the following hold:

1. the request sets `hazard_verified: true`;
2. the authenticated user's `kyb_status` is `approved`;
3. the account tier is `pro` or `enterprise`.

Blocked attempts are audit-logged (`DUAL_USE_GUARDRAIL_BLOCK`); cleared attempts are audit-logged
(`DUAL_USE_CLEARED`). The frontend freezes the 3D viewer and ML verdict when blocked.

### 5.4 Frontend performance

The WebGL viewport deliberately avoids `backdrop-filter: blur()` (fixed background + GPU containment) so
orbiting the lattice and scrolling the 8 modules stay at 60fps on integrated graphics. Charts render on
demand per tab, and the periodic table is `contain: content`.

---

## 6. Verification

An automated offline end-to-end suite ships with the project:

```powershell
# terminal 1
python main.py

# terminal 2
python verify.py
```

`verify.py` uses only the Python standard library and makes no external requests. It asserts:

1. `/api/health` reports the model loaded and both vendor assets present with non-zero size
2. `/api/meta` exposes three datasets, personas, tiers, the commercial label pack and the simulation envelope
3. The 118-element periodic table payload is complete (H → Og) with hazard flags and category colours
4. The 8 module headings, 9 views (8 + hidden vault), pressure controls and enterprise footer are present
5. The pilot sandbox issues an Enterprise VIP account marked WAIVED, and `?mode=summit_test` aliases to `live_demo`
6. Pre-screen returns ranked multi-material candidates with uncertainty grades
7. Simulate returns stress–strain curves, 15-point degradation, radar, PCA, liquidus, dynamic head and burst state
8. 3,500 °C triggers `MELTED`; −273.15 °C is accepted; ∞ pressure triggers burst containment failure
9. The Dual-Use guardrail blocks all eight restricted elements without clearance (403)
10. Mission Co-Pilot, Auto-Optimizer and environment preview return ranked/derived payloads
11. Feedback submission reaches the triage queue
12. PDF export returns a real `%PDF-` byte stream
13. The Global R&D Discovery Leaderboard serves seeded rows and accepts an authenticated publish
14. Admin gate: wrong gate → 404, wrong passkey → 401 with remaining attempts, 3 strikes → 423 lockout,
    correct passkey → snapshot, fee waiver, KYB approval, feedback triage, pilot minting
15. Static `index.html` / `style.css` / `app.js` contain no external URLs and no TODO placeholders

Exit code `0` means every check passed.

---

## 7. Offline guarantees

* All ML training data is cached **on disk** after the first download; inference never touches the network.
* `three.min.js` and `plotly.min.js` are served from `static/vendor/` by FastAPI.
* Fonts are OS-native (`Segoe UI Variable`, `Cascadia Code`); no webfont requests.
* The SVG favicon is generated by the backend inline.
* `verify.py` asserts that no `http://` or `https://` asset reference exists in the served frontend.
* SQLite, the bundle, the leaderboard and the PDF generator are all local file operations.

> The only first-run network activity is downloading the three Matbench JSON datasets, which matminer
> caches permanently. After that the whole stack is air-gap safe.

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Health badge says `DEGRADED` | `materialhunt_bundle.pkl` missing → run `python train_model.py` |
| `503 ML engine offline` | Same as above; check the bundle path |
| Pilot link opens a login modal | Use `?mode=live_demo` exactly; the alias is `?mode=summit_test` |
| Admin vault returns 404 | You forgot `?gate=mh_vault_99x` in the URL |
| Admin vault returns 423 | 3 failed passkeys → wait 15 minutes, or delete the offending row in `admin_guard` |
| PDF button says 402 | Free Starter account → use the demo Pro account or the VIP pilot |
| Guardrail blocks your alloy | Expected for U/Pu/Th/Be/Br/Cd/Hg/As without KYB clearance |
| Port 8000 busy | `uvicorn main:app --port 8010` |
| First simulation feels slow (5–10 s on Windows) | matminer spawns a process pool per request when `n_jobs > 1`; `load_bundle()` pins inference to one job. Restart the server after changing `main.py` |

---

## 9. Scientific disclaimer

MATERIALHUNT predictions are **statistical screening hypotheses** generated offline from Matbench-trained
models. They do not replace certified tensile, fatigue, corrosion or NDT testing. All design and safety
decisions remain the responsibility of the qualified engineer of record.
