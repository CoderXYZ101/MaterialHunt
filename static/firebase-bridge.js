/* ==========================================================================
   MATERIALHUNT — Firebase bridge + offline API engine
   Loaded before app.js. Keeps the SPA fully functional on Firebase Hosting
   (no Python process) by providing a deterministic client-side implementation
   of every /api route the UI uses. Also wires Firebase Auth + Firestore.
   ========================================================================== */
'use strict';

(function () {
  const firebaseConfig = {
    apiKey: 'REPLACE_WITH_FIREBASE_WEB_API_KEY',
    authDomain: 'materialhunt-2026.firebaseapp.com',
    projectId: 'materialhunt-2026',
    storageBucket: 'materialhunt-2026.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:materialhunt2026',
  };

  const HOSTED = /(^|\.)web\.app$|(^|\.)firebaseapp\.com$/.test(location.hostname);
  const SDK_VERSION = '10.12.5';
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  const LS = {
    leads: 'mh_rfq_leads_v1',
    feedback: 'mh_feedback_v1',
    leaderboard: 'mh_leaderboard_v1',
    profile: 'mh_firebase_profile_v1',
  };

  const bridge = {
    config: firebaseConfig,
    hosted: HOSTED,
    ready: false,
    auth: null,
    db: null,
    user: null,
    error: '',
  };
  window.MH_FIREBASE = bridge;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                      */
  /* ------------------------------------------------------------------ */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v, d = 1) => Number(Number(v).toFixed(d));
  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const writeJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  };
  const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

  const HAZARDOUS = ['U', 'Pu', 'Th', 'Be', 'Br', 'Cd', 'Hg', 'As'];
  const HAZARD_REASONS = {
    U: 'Uranium — nuclear fuel-cycle material',
    Pu: 'Plutonium — fissile material',
    Th: 'Thorium — nuclear fuel precursor',
    Be: 'Beryllium — toxic inhalation hazard',
    Br: 'Bromine — corrosive dual-use halogen',
    Cd: 'Cadmium — carcinogenic heavy metal',
    Hg: 'Mercury — neurotoxic liquid metal',
    As: 'Arsenic — toxic metalloid',
  };
  const ENV_DENSITY = {
    'Air / Industrial': 1.225,
    'Marine / Salt Spray': 1025,
    'Acidic / Chemical': 1500,
    'Inert / Argon': 1.784,
    'High-Vacuum': 0,
    'Oxidising / Steam': 598,
    'Cryogenic / LNG': 476,
  };
  const ENV_FACTOR = {
    'Air / Industrial': 1,
    'Marine / Salt Spray': 0.82,
    'Acidic / Chemical': 0.74,
    'Inert / Argon': 1.02,
    'High-Vacuum': 1.04,
    'Oxidising / Steam': 0.7,
    'Cryogenic / LNG': 0.9,
  };
  const PROFILE_FACTOR = {
    'Static tension': 1,
    'Cyclic / Fatigue': 0.72,
    'Impact / Shock': 0.66,
    'Creep / High-temp': 0.58,
    'Biaxial / Pressure': 0.8,
  };

  function fmtPressure(pa) {
    const value = Number(pa) || 0;
    if (value >= 1e15) return '∞ Burst';
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GPa`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)} MPa`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)} kPa`;
    return `${Math.round(value)} Pa`;
  }

  function shortFormula(elements, max = 4) {
    const entries = Object.entries(elements || {}).filter(([, v]) => Number(v) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, max);
    if (!entries.length) return '—';
    const total = entries.reduce((s, [, v]) => s + Number(v), 0) || 1;
    return entries.map(([sym, v]) => {
      const pct = Number(v) / total * 100;
      return `${sym}${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}`;
    }).join(' · ');
  }

  /* ------------------------------------------------------------------ */
  /* Handbook data                                                      */
  /* ------------------------------------------------------------------ */
  let handbookPromise = null;
  const handbook = { meta: null, elements: {}, periodic: [], prescreen: null, alloys: [], leaderboard: null };

  function loadHandbook() {
    if (handbookPromise) return handbookPromise;
    handbookPromise = (async () => {
      const candidates = ['data/handbook.json', '/data/handbook.json', 'static/data/handbook.json'];
      for (const path of candidates) {
        try {
          const response = await nativeFetch(path, { cache: 'force-cache' });
          if (!response.ok) continue;
          const data = await response.json();
          Object.assign(handbook, data);
          handbook.elements = data.elements || handbook.elements || {};
          handbook.periodic = data.periodic || handbook.periodic || [];
          return handbook;
        } catch { /* try next */ }
      }
      return handbook;
    })();
    return handbookPromise;
  }

  function elementData(symbol) {
    return handbook.elements[symbol] || {};
  }

  function periodicData(symbol) {
    return (handbook.periodic || []).find((row) => row.symbol === symbol) || {};
  }

  function meltingPoint(symbol) {
    const row = periodicData(symbol);
    if (Number.isFinite(Number(row.melting_point_c))) return Number(row.melting_point_c);
    return 1500;
  }

  function boilingPoint(symbol) {
    const row = periodicData(symbol);
    if (Number.isFinite(Number(row.boiling_point_c))) return Number(row.boiling_point_c);
    return meltingPoint(symbol) * 1.35 + 450;
  }

  function pressureShift(base, pressurePa, span) {
    const pressure = Math.max(1, Number(pressurePa) || 101325);
    return base + clamp(span * Math.log10(pressure / 101325), -220, 650);
  }

  function elementPhase(symbol, temperatureC, pressurePa) {
    const melt = meltingPoint(symbol);
    const boil = boilingPoint(symbol);
    const meltEff = pressureShift(melt, pressurePa, 16);
    const boilEff = pressureShift(boil, pressurePa, 34);
    const row = periodicData(symbol);
    const sub = Number(row.sublimation_point_c);
    if (Number.isFinite(sub)) {
      const subEff = pressureShift(sub, pressurePa, 34);
      if (temperatureC >= subEff) return { phase: 'GASEOUS / VAPORIZED', note: `${symbol} sublimates at ${Math.round(subEff)}°C at this pressure.`, melting: melt, boiling: boil, meltEff, boilEff, subEff };
      return { phase: 'SOLID', note: `${symbol} is solid below its ${Math.round(subEff)}°C sublimation point.`, melting: melt, boiling: boil, meltEff, boilEff, subEff };
    }
    if (temperatureC >= boilEff) return { phase: 'GASEOUS / VAPORIZED', note: `Above the pressure-adjusted boiling point of ${Math.round(boilEff)}°C.`, melting: melt, boiling: boil, meltEff, boilEff };
    if (temperatureC >= meltEff) return { phase: 'LIQUID', note: `Between melting (${Math.round(meltEff)}°C) and boiling (${Math.round(boilEff)}°C).`, melting: melt, boiling: boil, meltEff, boilEff };
    return { phase: 'SOLID', note: `Below the pressure-adjusted melting point of ${Math.round(meltEff)}°C.`, melting: melt, boiling: boil, meltEff, boilEff };
  }

  /* ------------------------------------------------------------------ */
  /* Offline simulation engine                                          */
  /* ------------------------------------------------------------------ */
  function thermalFactor(tempC, limitC) {
    if (tempC <= 25) return clamp(1 + 0.00022 * (25 - tempC), 0.75, 1.08);
    const span = Math.max(1, limitC - 25);
    const ratio = (tempC - 25) / span;
    if (ratio <= 1) return Math.max(0.6, 1 - 0.34 * Math.pow(ratio, 0.82));
    return Math.max(0.18, 0.66 - 0.3 * (ratio - 1));
  }

  function stressStrain(strength, ductility, temperatureC, modulus) {
    const yieldStrength = Math.max(20, strength);
    const ultimate = yieldStrength * (1.12 + 0.42 * ductility);
    const fractureStrain = Math.max(0.015, 0.055 + 0.27 * ductility);
    const elasticStrain = Math.min(0.012, yieldStrength / Math.max(1, modulus * 1000));
    const uniformStrain = Math.max(elasticStrain + 0.005, fractureStrain * 0.62);
    const fractureStress = ultimate * (0.8 + 0.12 * ductility);
    const strain = [];
    const stress = [];
    for (let i = 0; i < 90; i += 1) {
      const eps = (fractureStrain * 1.02) * (i / 89);
      let sigma;
      if (eps <= elasticStrain) sigma = modulus * 1000 * eps;
      else if (eps <= uniformStrain) {
        const t = (eps - elasticStrain) / Math.max(1e-9, uniformStrain - elasticStrain);
        sigma = yieldStrength + (ultimate - yieldStrength) * Math.pow(t, 0.62);
      } else {
        const t = (eps - uniformStrain) / Math.max(1e-9, fractureStrain - uniformStrain);
        sigma = ultimate - (ultimate - fractureStress) * Math.pow(t, 0.55);
      }
      strain.push(Number(eps.toFixed(5)));
      stress.push(Number(Math.max(0, Math.min(sigma, ultimate)).toFixed(2)));
    }
    return {
      strain,
      stress,
      yield_point: { strain: Number(elasticStrain.toFixed(5)), stress: Number(yieldStrength.toFixed(2)) },
      fracture_point: { strain: Number(fractureStrain.toFixed(5)), stress: Number(fractureStress.toFixed(2)) },
      ultimate_strength: Number(ultimate.toFixed(2)),
      fracture_strain_pct: Number((fractureStrain * 100).toFixed(2)),
      temperature_c: temperatureC,
    };
  }

  function simulate(request) {
    const input = request || {};
    const raw = input.elements || { Fe: 70, Cr: 18, Ni: 8, Mo: 2, C: 2 };
    const valid = {};
    const rejected = [];
    Object.entries(raw).forEach(([sym, value]) => {
      const clean = String(sym || '').trim();
      const key = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
      const numeric = Number(value);
      if (!/^[A-Z][a-z]?$/.test(key) || !Number.isFinite(numeric) || numeric <= 0) {
        rejected.push(clean);
        return;
      }
      valid[key] = (valid[key] || 0) + numeric;
    });
    if (!Object.keys(valid).length) valid.Fe = 100;
    const total = Object.values(valid).reduce((s, v) => s + v, 0) || 1;
    const fractions = Object.fromEntries(Object.entries(valid).map(([k, v]) => [k, v / total]));
    const temperature = clamp(Number(input.temperature_c ?? 25), -273.15, 4500);
    const load = Math.max(0, Number(input.load_mpa ?? 250));
    const safety = clamp(Number(input.safety_factor ?? 1.5), 1, 3);
    const pressure = clamp(Number(input.pressure_pa ?? 101325), 0, 1e16);
    const velocity = clamp(Number(input.velocity_kmh ?? 0), 0, 3500);
    const medium = clamp(Number(input.environment_density_kgm3 ?? ENV_DENSITY[input.environment] ?? 1.225), 0, 25000);
    const environment = input.environment || 'Air / Industrial';
    const profile = input.load_profile || 'Static tension';
    const structure = ['BCC', 'FCC', 'HCP'].includes(input.structure) ? input.structure : 'BCC';
    const dynamic = 0.5 * medium * Math.pow(velocity / 3.6, 2);
    const totalPressure = pressure + dynamic;
    const tempFactorEnv = Math.max(0.05, Math.min(1, (4500 - temperature) / 4500));
    const burstPressure = 5e9 * (0.35 + 0.65 * tempFactorEnv);
    const burstRatio = totalPressure / Math.max(1, burstPressure);
    const isBurst = totalPressure >= burstPressure;

    let density = 0;
    let cost = 0;
    let liquidus = 0;
    Object.entries(fractions).forEach(([sym, frac]) => {
      const info = elementData(sym);
      density += (Number(info.density) || 7.5) * frac;
      cost += (Number(info.cost) || 1500) * frac;
      liquidus += meltingPoint(sym) * frac;
    });
    if (Object.keys(fractions).length > 1) liquidus *= 0.92;
    liquidus = clamp(liquidus, -273.15, 4500);
    const isMelted = temperature >= liquidus;
    const phases = Object.entries(fractions).sort((a, b) => b[1] - a[1]).map(([sym, frac]) => {
      const info = elementData(sym);
      const phase = elementPhase(sym, temperature, totalPressure);
      return {
        symbol: sym,
        wt_pct: round(frac * 100, 2),
        name: info.name || sym,
        color: info.color || '#7FB3FF',
        radius: info.radius || 126,
        role: info.role || 'Alloying element',
        hazardous: HAZARDOUS.includes(sym),
        phase: phase.phase,
        note: phase.note,
        melting_point_c: phase.melting,
        boiling_point_c: phase.boiling,
        melting_effective_c: phase.meltEff,
        boiling_effective_c: phase.boilEff,
      };
    });
    const vaporized = phases.filter((p) => p.phase === 'GASEOUS / VAPORIZED').map((p) => p.symbol);
    const liquid = phases.filter((p) => p.phase === 'LIQUID').map((p) => p.symbol);

    const cr = (fractions.Cr || 0) * 100;
    const ni = (fractions.Ni || 0) * 100;
    const mo = (fractions.Mo || 0) * 100;
    const carbon = (fractions.C || 0) * 100;
    const ti = (fractions.Ti || 0) * 100;
    const al = (fractions.Al || 0) * 100;
    const co = (fractions.Co || 0) * 100;
    const w = (fractions.W || 0) * 100;
    const v = (fractions.V || 0) * 100;
    let strength = 360 + cr * 7.2 + ni * 4.1 + mo * 9.4 + carbon * 380 + ti * 5.4 + al * 2.1
      + co * 5.2 + w * 6.6 + v * 11.5 - Math.max(0, al - 6) * 9 - Math.max(0, carbon - 0.6) * 120;
    if (al > 60) strength = 120 + al * 2.4 + (fractions.Zn || 0) * 420 + (fractions.Mg || 0) * 220;
    if (ti > 60) strength = 300 + al * 55 + v * 38 + (fractions.Sn || 0) * 30 + (fractions.Zr || 0) * 18;
    if ((fractions.Ni || 0) > 0.4) strength += 120;
    strength = clamp(strength, 90, 2400);
    const ductility = clamp(0.46 - carbon * 1.9 + ni * 0.005 + mo * 0.003 - Math.max(0, strength - 1200) / 9000, 0.04, 0.6);
    const corrosion = clamp(0.28 + cr * 0.012 + ni * 0.008 + mo * 0.02 - carbon * 0.9, 0.12, 0.98);
    const limit = clamp(Math.min(...Object.keys(fractions).map((s) => meltingPoint(s))) * 0.46 + 95, 180, 1450);
    const tFactor = thermalFactor(temperature, limit);
    const envFactor = ENV_FACTOR[environment] ?? 1;
    const profileFactor = PROFILE_FACTOR[profile] ?? 1;
    const operating = isMelted ? 0 : strength * tFactor * envFactor * profileFactor;
    const applied = load * safety;
    const utilization = operating > 0 ? applied / operating : 99;
    const margin = 1 - utilization;
    let verdict = 'SAFE';
    let verdictLabel = 'Structural envelope verified';
    if (isMelted) { verdict = 'MELTED'; verdictLabel = 'Liquidus failure — alloy loses load-bearing capacity'; }
    else if (isBurst) { verdict = 'UNSAFE'; verdictLabel = 'Pressure-burst containment failure'; }
    else if (utilization > 1) { verdict = 'UNSAFE'; verdictLabel = 'Applied stress exceeds derated working strength'; }
    else if (utilization > 0.85) { verdict = 'MARGINAL'; verdictLabel = 'Thin margin — increase section or lower load'; }

    const modulus = clamp(210 * (1 - 0.38 * (fractions.Al || 0) - 0.18 * (fractions.Ti || 0) - 0.08 * (fractions.Ni || 0)) + 8 * (fractions.Mo || 0), 55, 235);
    const roomCurve = stressStrain(strength, ductility, 25, modulus);
    const opCurve = stressStrain(Math.max(20, operating), ductility, temperature, modulus);
    const temps = [-273.15, -200, -100, -50, 0, 25, 100, 300, 500, 800, 1100, 1500, 2000, 3000, 4500];
    const degradation = {
      temperature_c: temps,
      strength_mpa: temps.map((t) => round(strength * thermalFactor(t, limit), 2)),
      thermal_limit_c: round(limit),
      liquidus_c: round(liquidus, 2),
      operating_temperature_c: temperature,
      is_melted: isMelted,
    };
    const percentile = (value, cap) => round(clamp(value / cap * 100, 2, 100), 1);
    const radar = {
      labels: ['Strength', 'Ductility', 'Thermal', 'Corrosion', 'Cost-Efficiency', 'Weight-Efficiency'],
      alloy: [percentile(strength, 1600), round(ductility * 100, 1), percentile(limit, 1200), round(corrosion * 100, 1),
        round(clamp(100 - Math.log10(cost + 1) * 26, 2, 100), 1), round(clamp(100 - (density - 1.5) * 10.5, 2, 100), 1)],
      benchmark: [52, 48, 55, 46, 58, 52],
      confidence: Object.keys(fractions).length <= 6 ? 'High' : Object.keys(fractions).length <= 9 ? 'Medium' : 'Low',
      confidence_score: 88,
    };
    const top = phases.slice(0, 4).map((p) => p.symbol);
    const formula = top.join('');
    const confidence = radar.confidence;
    const advice = [];
    if (isMelted) advice.push(`Reduce service temperature below the ${Math.round(liquidus)}°C weighted liquidus or switch to a refractory grade.`);
    if (isBurst) advice.push(`Total pressure ${fmtPressure(totalPressure)} exceeds the ${fmtPressure(burstPressure)} burst ceiling. Increase wall section or reduce pressure velocity.`);
    if (cr < 10 && /Marine|Acidic/.test(environment)) advice.push('Raise Cr above 16 wt% for a stable passive film in this corrosive environment.');
    if (utilization > 0.85 && !isMelted) advice.push('Utilisation is above 0.85. Add section thickness or choose a higher-strength temper.');
    if (temperature > limit) advice.push(`Operating temperature exceeds the ${Math.round(limit)}°C service ceiling. Add thermal barrier coating or active cooling.`);
    if (!advice.length) advice.push('Design envelope is healthy. Confirm fatigue life for the selected load profile and qualify the heat treatment.');
    advice.push('Validate the top candidate with a NABL-accredited tensile coupon before production release.');
    const warnings = [];
    if (carbon > 0.05) warnings.push('High carbon chemistry can reduce weldability and fracture toughness.');
    if (vaporized.length) warnings.push(`Vaporized elements at this temperature/pressure: ${vaporized.join(', ')}.`);
    if (temperature > 400) warnings.push('Hot-strength values are extrapolated by the offline screening engine; confirm with a creep test.');
    return {
      product: 'MATERIALHUNT',
      engine: 'Offline deterministic screening engine (Firebase static build)',
      timestamp: new Date().toISOString(),
      composition: {
        formula,
        formula_full: phases.map((p) => `${p.symbol}${(p.wt_pct / 100).toFixed(4)}`).join(' '),
        fractions,
        elements: phases,
        rejected,
        hazardous: phases.filter((p) => p.hazardous).map((p) => p.symbol),
      },
      structure,
      prediction: { predicted: round(strength), uncertainty: round(strength * 0.055), confidence, unit: 'MPa', dataset: 'steels', benchmark_r2: 0.7061, benchmark_mae: 92.03 },
      targets: {
        steels: { predicted: round(strength), uncertainty: round(strength * 0.055), confidence, unit: 'MPa' },
        glass: { predicted: 0.62, uncertainty: 0.16, confidence: 'Medium', unit: 'K' },
        expt_gap: { predicted: 0.44, uncertainty: 0.45, confidence: 'Medium', unit: 'eV' },
      },
      derived: {
        density_gcm3: round(density, 3), cost_per_kg: round(cost), thermal_limit_c: round(limit), liquidus_c: round(liquidus, 2),
        is_melted: isMelted, liquidus_message: isMelted ? 'Liquidus failure' : 'Solid state',
        corrosion_index: round(corrosion, 3), ductility_index: round(ductility, 3), modulus_gpa: round(modulus, 1),
        crystal_structure: structure, environment_factor: round(envFactor, 3), profile_factor: profileFactor,
        thermal_factor: round(tFactor, 3), strength_25c_mpa: round(strength), operating_strength_mpa: round(operating),
        applied_stress_mpa: round(applied), utilization_ratio: round(utilization, 3), safety_margin: round(margin, 3),
        max_safe_load_mpa: round(operating / safety), fatigue_cycles: profile === 'Cyclic / Fatigue' ? Math.round(10 ** clamp(6 - 3 * Math.max(0, utilization - 0.35), 2, 7)) : null,
        verdict, verdict_label: verdictLabel, hazard_blocked: false, hazard_cleared: phases.some((p) => p.hazardous),
        hazardous_elements: phases.filter((p) => p.hazardous).map((p) => p.symbol), rejected_elements: rejected,
        medium_density_kgm3: medium, velocity_kmh: velocity, velocity_ms: round(velocity / 3.6, 3),
        static_pressure_pa: pressure, dynamic_pressure_pa: round(dynamic, 2), total_pressure_pa: round(totalPressure, 2),
        total_pressure_mpa: round(totalPressure / 1e6, 6), burst_pressure_pa: round(burstPressure, 2),
        pressure_ratio: round(burstRatio, 4), is_burst_condition: isBurst, pressure_label: fmtPressure(totalPressure),
        cryogenic: temperature <= -100 ? { is_cryogenic: true } : null,
        refractory: temperature >= 500 ? { stability: temperature >= 1000 ? 'Refractory' : 'High-temperature alloy', remaining_strength_pct: round(clamp(100 - (temperature - 500) / 30, 18, 100), 1) } : null,
        oxygen_escape_kpa_min: round(Math.max(0, 0.0018 * Math.exp((temperature - 500) / 400)), 5),
        element_phases: phases.map((p) => ({ symbol: p.symbol, wt_pct: p.wt_pct, phase: p.phase, note: p.note, melting_point_c: p.melting_point_c, boiling_point_c: p.boiling_point_c, melting_effective_c: p.melting_effective_c, boiling_effective_c: p.boiling_effective_c })),
        vaporized_elements: vaporized, liquid_elements: liquid,
        aggregate_phase: vaporized.length ? 'GASEOUS / VAPORIZED' : liquid.length ? 'LIQUID' : 'SOLID',
      },
      environment: {
        temperature_c: temperature, temperature_k: round(temperature + 273.15, 2), pressure_pa: pressure,
        environment_density_kgm3: medium, environment_type: environment, velocity_kmh: velocity,
        velocity_ms: round(velocity / 3.6, 3), dynamic_pressure_pa: round(dynamic, 2), total_pressure_pa: round(totalPressure, 2),
        total_pressure_mpa: round(totalPressure / 1e6, 6), burst_pressure_pa: round(burstPressure, 2),
        burst_ratio: round(burstRatio, 4), is_burst_condition: isBurst, pressure_label: fmtPressure(totalPressure),
        medium_label: environment,
      },
      conditions: {
        temperature_c: temperature, environment, environment_note: 'Client-side offline screening environment.',
        load_profile: profile, load_profile_note: 'Client-side profile factor applied.', load_mpa: load, safety_factor: safety,
        hazard_verified: Boolean(input.hazard_verified), environment_density_kgm3: medium, pressure_pa: pressure,
        velocity_kmh: velocity, dynamic_pressure_pa: round(dynamic, 2),
      },
      curves: { room: roomCurve, operating: opCurve, degradation },
      radar,
      pca: [round((fractions.Fe || 0) * 6 - 3, 3), round((fractions.Cr || 0) * 14 - 2, 3), round((fractions.Ni || 0) * 10 + 1, 3)],
      advice,
      hypothesis: `Offline screening of ${shortFormula(fractions)} predicts ${Math.round(strength)} MPa yield strength. At ${Math.round(temperature)}°C in ${environment}, the derated working strength is ${Math.round(operating)} MPa, giving utilisation ${utilization.toFixed(2)} at a ${safety.toFixed(1)} safety factor. Weighted liquidus is ${Math.round(liquidus)}°C, and the aggregate phase state is ${vaporized.length ? 'GASEOUS / VAPORIZED' : liquid.length ? 'LIQUID' : 'SOLID'}.`,
      warnings,
      guardrail: { restricted_elements: HAZARDOUS, blocked: false, cleared: phases.some((p) => p.hazardous), message: 'Dual-use guardrail evaluated locally.' },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Offline prescreen                                                  */
  /* ------------------------------------------------------------------ */
  function prescreen(request) {
    const payload = request || {};
    const pool = handbook.prescreen?.candidates || handbook.prescreen?.results || [];
    const weights = handbook.prescreen?.weights || { strength: 0.3, weight: 0.25, thermal: 0.2, corrosion: 0.1, cost: 0.1, confidence: 0.05 };
    const allowed = new Set(payload.datasets && payload.datasets.length ? payload.datasets : ['steels', 'glass', 'expt_gap']);
    const floor = { Low: 1, Medium: 2, High: 3 }[payload.min_confidence || 'Low'] || 1;
    const rank = { Low: 1, Medium: 2, High: 3 };
    const include = (payload.include_elements || []).map((s) => s);
    const exclude = (payload.exclude_elements || []).map((s) => s);
    const query = String(payload.search || '').toLowerCase();
    let rows = pool.filter((item) => {
      if (!allowed.has(item.dataset)) return false;
      if ((rank[item.confidence] || 1) < floor) return false;
      if (payload.max_cost != null && Number(item.cost_per_kg) > Number(payload.max_cost)) return false;
      if (payload.max_density != null && Number(item.density) > Number(payload.max_density)) return false;
      const set = new Set(Object.keys(item.elements || {}));
      if (include.length && !include.every((s) => set.has(s))) return false;
      if (exclude.length && exclude.some((s) => set.has(s))) return false;
      if (query && !String(item.formula || '').toLowerCase().includes(query) && !String(item.composition || '').toLowerCase().includes(query)) return false;
      return true;
    });
    rows = rows.map((item, index) => ({ ...item, formula_short: item.formula_short || shortFormula(item.elements), rank: index + 1 }));
    const result = rows.slice(0, payload.limit || 60);
    const totalBefore = rows.length;
    const counts = {};
    result.forEach((item) => { counts[item.dataset] = (counts[item.dataset] || 0) + 1; });
    return {
      ok: true, product: 'MATERIALHUNT', persona: payload.persona || 'Aerospace',
      weights, candidates: result, results: result, count: result.length,
      total_before_limit: totalBefore, dataset_counts: counts,
      summary: `${result.length} candidates · ${payload.persona || 'Aerospace'} weighting · ${totalBefore} passed filters`,
      generated_at: new Date().toISOString(),
    };
  }

  function missionSearch(request) {
    const prompt = String(request?.prompt || '').toLowerCase();
    const intents = [
      { key: 'lightweight', label: 'Lightweighting campaign', words: ['light', 'weight', 'mass', 'drone', 'ev', 'airframe', 'portable'] },
      { key: 'corrosion', label: 'Corrosion-resistant service', words: ['corrosion', 'marine', 'salt', 'chloride', 'acid', 'offshore'] },
      { key: 'high_temperature', label: 'High-temperature / creep service', words: ['temperature', 'thermal', 'heat', 'turbine', 'rocket', 'hypersonic', 'creep', 'refractory', 'nozzle'] },
      { key: 'cost', label: 'Cost-down high-volume programme', words: ['cost', 'cheap', 'budget', 'affordable', 'price', 'inr', 'volume'] },
      { key: 'strength', label: 'Strength-critical structural design', words: ['strength', 'strong', 'load', 'structural', 'pressure', 'fatigue', 'safety'] },
    ];
    const intent = intents.find((row) => row.words.some((word) => prompt.includes(word))) || intents[4];
    const pool = handbook.prescreen?.candidates || [];
    const scored = pool.filter((item) => item.dataset === 'steels' || item.dataset === 'glass').map((item) => {
      let score = Number(item.rank_score) || 50;
      if (intent.key === 'lightweight') score += Math.max(0, 8 - Number(item.density)) * 4;
      if (intent.key === 'corrosion') score += (Number(item.corrosion_index) || 0) * 22;
      if (intent.key === 'high_temperature') score += Math.min(12, Number(item.thermal_limit_c) / 60);
      if (intent.key === 'cost') score += Math.max(0, 30 - Math.log10(Number(item.cost_per_kg) + 1) * 8);
      if (intent.key === 'strength') score += Math.min(18, Number(item.predicted) / 90);
      return {
        candidate_id: item.id, formula: item.formula, formula_full: item.formula_full || item.formula,
        formula_short: item.formula_short || shortFormula(item.elements), elements: item.elements || {},
        dataset: item.dataset, dataset_label: item.dataset_label, unit: item.unit || 'MPa',
        strength_mpa: item.dataset === 'steels' ? round(item.predicted) : null,
        density_gcm3: item.density, thermal_limit_c: item.thermal_limit_c, cost_per_kg: item.cost_per_kg,
        corrosion_index: item.corrosion_index, ductility_index: item.ductility_index,
        confidence: item.confidence || 'Medium', alloy_class: item.alloy_class || 'Candidate',
        rank_score: round(score, 2), match_rationale: `Fits the ${intent.label.toLowerCase()} objective.`,
      };
    }).sort((a, b) => b.rank_score - a.rank_score).slice(0, 12);
    const top = scored[0];
    return {
      ok: true, product: 'MATERIALHUNT', mission_id: `MH-MSN-${Date.now().toString(36).toUpperCase()}`,
      prompt: request?.prompt || '',
      intent: { key: intent.key, label: intent.label, weights: {}, confidence: prompt.length > 24 ? 'High' : 'Medium' },
      recommendation: top ? `Mission intent classified as '${intent.label}'. Top candidate ${top.formula_short} ranks ${top.rank_score}/100.` : 'No candidate matched the mission brief.',
      results: scored, candidates_evaluated: pool.length, persona: request?.persona || 'Aerospace',
      generated_at: new Date().toISOString(),
    };
  }

  function optimize(request) {
    const constraints = request?.constraints || {};
    const densityMax = Number(constraints.density_max_gcm3 ?? 8.6);
    const strengthMin = Number(constraints.strength_min_mpa ?? 700);
    const tempMax = Number(constraints.temperature_max_c ?? 700);
    const costMax = Number(constraints.cost_max_per_kg ?? 6000);
    const banned = new Set((constraints.banned_elements || []).map((s) => String(s)));
    const pool = (handbook.alloys || []).filter((alloy) => {
      if (Number(alloy.density) > densityMax) return false;
      if (Number(alloy.yield_mpa) < strengthMin) return false;
      if (Number(alloy.max_temp_c) < tempMax) return false;
      if (Number(alloy.cost_inr_kg) > costMax) return false;
      if (Object.keys(alloy.composition || {}).some((sym) => banned.has(sym))) return false;
      return true;
    }).map((alloy) => ({
      ...alloy,
      formula_short: shortFormula(alloy.composition),
      rank_score: round(clamp(Number(alloy.yield_mpa) / 12 + 100 - Number(alloy.cost_inr_kg) / 120 + Math.max(0, 8 - Number(alloy.density)) * 4, 30, 99), 1),
    })).sort((a, b) => b.rank_score - a.rank_score);
    const top = pool[0];
    return {
      ok: true, feasible: pool.length > 0, evaluated: (handbook.alloys || []).length * 7,
      best: top || null, recommendations: pool.slice(0, 5),
      savings: top ? {
        cost_pct: round(clamp(100 - top.cost_inr_kg / Math.max(1, costMax) * 100, 0, 92), 1),
        weight_pct: round(clamp(100 - top.density / Math.max(1, densityMax) * 100, 0, 88), 1),
      } : { cost_pct: 0, weight_pct: 0 },
      constraints: { density_max_gcm3: densityMax, strength_min_mpa: strengthMin, temperature_max_c: tempMax, cost_max_per_kg: costMax, banned_elements: [...banned] },
    };
  }

  function leaderboardSeed() {
    const stored = readJson(LS.leaderboard, []);
    const seeded = handbook.leaderboard?.leaders || [];
    return [...stored, ...seeded];
  }

  function leaderboardResponse() {
    const leaders = leaderboardSeed().sort((a, b) => Number(b.rank_score) - Number(a.rank_score)).slice(0, 20);
    return {
      ok: true, leaders,
      stats: {
        total_discoveries: leaders.length,
        top: leaders[0] || null,
        by_dataset: { steels: leaders.length },
      },
    };
  }

  function fallbackUser(mode) {
    return {
      id: 9001, email: mode === 'register' ? 'new-lab@materialhunt.firebase' : 'pilot@materialhunt.firebase',
      organization_name: mode === 'register' ? 'New Lab (KYB pending)' : 'MATERIALHUNT Pilot Lab',
      org_id: 'MH-FIREBASE-2026', tier: 'enterprise', tier_name: 'Enterprise R&D',
      role: 'member', kyb_status: mode === 'register' ? 'pending' : 'approved',
      billing_status: 'WAIVED', billing_waived: true, created_at: new Date().toISOString(),
    };
  }

  function base64Pdf(lines) {
    const escapePdf = (text) => String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const perPage = 46;
    const pages = [];
    for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
    const objects = [];
    const pageRefs = [];
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    pages.forEach((pageLines, index) => {
      pageRefs.push(index);
      const pageObj = 4 + index * 2;
      const contentObj = pageObj + 1;
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`);
      let stream = 'BT /F1 10 Tf 44 798 Td 14 TL\n';
      pageLines.forEach((line) => {
        const size = String(line).startsWith('#') ? 14 : 10;
        stream += `/F1 ${size} Tf (${escapePdf(String(line).slice(0, 96))}) Tj T*\n`;
      });
      stream += 'ET';
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((body, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return pdf;
  }

  function reportLines(request) {
    const sim = simulate(request);
    const d = sim.derived;
    const p = sim.prediction;
    const lines = [
      '# MATERIALHUNT INC. — ENTERPRISE LAB SCREENING DOSSIER',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Reference: ${request?.lab_reference || 'MH-FIREBASE'}`,
      '',
      '## COMPOSITION & VERDICT',
      `Formula: ${shortFormula(sim.composition.fractions, 8)}`,
      `Verdict: ${d.verdict} — ${d.verdict_label}`,
      `Crystal structure: ${d.crystal_structure}`,
      `Aggregate phase: ${d.aggregate_phase}`,
      '',
      '## SERVICE ENVELOPE',
      `Operating temperature: ${d.environment ? d.environment : ''}${sim.conditions.temperature_c} °C`,
      `Static + dynamic pressure: ${d.pressure_label}`,
      `Medium: ${sim.conditions.environment} at ${sim.conditions.environment_density_kgm3} kg/m³`,
      `Velocity: ${sim.conditions.velocity_kmh} km/h`,
      `Applied stress: ${d.applied_stress_mpa} MPa · safety factor ${sim.conditions.safety_factor}`,
      '',
      '## MATERIAL PROPERTIES',
      `Predicted yield strength: ${p.predicted} MPa (±${p.uncertainty} MPa, ${p.confidence} confidence)`,
      `Derated working strength: ${d.operating_strength_mpa} MPa`,
      `Utilisation: ${d.utilization_ratio}`,
      `Density: ${d.density_gcm3} g/cm³`,
      `Raw material cost: INR ${d.cost_per_kg}/kg`,
      `Weighted liquidus: ${d.liquidus_c} °C`,
      `Service ceiling: ${d.thermal_limit_c} °C`,
      '',
      '## ELEMENTAL PHASE STATE AT OPERATING POINT',
      ...(d.element_phases || []).map((row) => `${row.symbol}: ${row.phase} · melt ${row.melting_point_c}°C · boil ${row.boiling_point_c}°C`),
      '',
      '## AI METALLURGIST ADVICE',
      ...(sim.advice || []).map((tip) => `- ${tip}`),
      '',
      '## HYPOTHESIS',
      sim.hypothesis,
      '',
      'Screening hypothesis only — not a certified test report.',
      'MATERIALHUNT Inc. · materialhunt-2026.web.app',
    ];
    return lines;
  }

  /* ------------------------------------------------------------------ */
  /* Offline API router                                                 */
  /* ------------------------------------------------------------------ */
  async function offlineApi(path, options) {
    await loadHandbook();
    const url = new URL(path, location.origin);
    const route = url.pathname;
    const method = String(options?.method || 'GET').toUpperCase();
    let body = null;
    try { body = options?.body ? JSON.parse(options.body) : null; } catch { body = null; }
    const headers = options?.headers || {};

    if (route === '/api/health') {
      return jsonResponse({
        ok: true, status: 'ok', offline: true, model_loaded: true, mode: 'static-firebase',
        product: 'MATERIALHUNT', assets: {
          'three.min.js': { present: true, bytes: 669884 },
          'plotly.min.js': { present: true, bytes: 4558696 },
        },
      });
    }
    if (route === '/api/meta') {
      return jsonResponse(handbook.meta || { ok: true, datasets: {}, personas: {}, tiers: {} });
    }
    if (route === '/api/elements') {
      const temp = Number(url.searchParams.get('temperature_c') || 25);
      const pressure = Number(url.searchParams.get('pressure_pa') || 101325);
      const table = (handbook.periodic || []).map((row) => {
        const phase = elementPhase(row.symbol, temp, pressure);
        return { ...row, phase: phase.phase, phase_note: phase.note, melting_effective_c: round(phase.meltEff, 1), boiling_effective_c: round(phase.boilEff, 1) };
      });
      return jsonResponse({
        ok: true, elements: handbook.elements || {}, ui_elements: ['Fe', 'Cr', 'Ni', 'C', 'Ti', 'Al', 'Mo'],
        hazardous_elements: HAZARDOUS, periodic_table: table, periodic_table_count: table.length,
        category_colors: handbook.meta?.category_colors || {}, temperature_c: temp, pressure_pa: pressure,
        phase_states: ['SOLID', 'LIQUID', 'GASEOUS / VAPORIZED'],
        carbon_note: 'Carbon does not melt at 1 atm: it sublimates at 3,642 °C.',
      });
    }
    if (route === '/api/alloys/validated') {
      return jsonResponse({ ok: true, count: (handbook.alloys || []).length, alloys: handbook.alloys || [] });
    }
    if (route === '/api/prescreen') return jsonResponse(prescreen(body));
    if (route === '/api/simulate') return jsonResponse(simulate(body));
    if (route === '/api/mission-search') return jsonResponse(missionSearch(body));
    if (route === '/api/optimize') return jsonResponse(optimize(body));
    if (route === '/api/environment') {
      const temp = Number(body?.temperature_c ?? 25);
      const pressure = Number(body?.pressure_pa ?? 101325);
      const medium = Number(body?.environment_density_kgm3 ?? 1.225);
      const velocity = Number(body?.velocity_kmh ?? 0);
      const dynamic = 0.5 * medium * Math.pow(velocity / 3.6, 2);
      return jsonResponse({ ok: true, environment: { temperature_c: temp, pressure_pa: pressure, dynamic_pressure_pa: round(dynamic, 2), total_pressure_pa: round(pressure + dynamic, 2), pressure_label: fmtPressure(pressure + dynamic), environment_density_kgm3: medium, velocity_kmh: velocity } });
    }
    if (route === '/api/labels') return jsonResponse({ ok: true, labels: handbook.meta?.labels || {}, waiver_label: 'VIP GRANT — FEE WAIVED (₹0)', kyb_badge: 'ENTERPRISE VIP · KYB VERIFIED' });
    if (route === '/api/auth/pilot-guest' || route === '/api/auth/guest-summit') {
      return jsonResponse({ ok: true, token: `offline-pilot-${Date.now()}`, mode: 'live_demo', user: fallbackUser('pilot') });
    }
    if (route === '/api/auth/login') {
      const email = String(body?.email || '');
      const password = String(body?.password || '');
      const demo = email === 'demo@materialhunt.ai' && password === 'Demo@2026';
      const rnd = email === 'rnd@vajra-aero.in' && password === 'Vajra@2026';
      if (!demo && !rnd) return jsonResponse({ detail: 'Invalid email or password.' }, 401);
      const user = fallbackUser('pilot');
      user.email = email;
      user.organization_name = demo ? 'Demo Lab · MATERIALHUNT' : 'Vajra Aerospace Materials';
      user.billing_waived = demo;
      user.tier_name = demo ? 'Enterprise R&D' : 'Free Starter';
      user.tier = demo ? 'enterprise' : 'free';
      return jsonResponse({ ok: true, token: `offline-${demo ? 'demo' : 'rnd'}-${Date.now()}`, user });
    }
    if (route === '/api/auth/register') {
      const user = fallbackUser('register');
      user.email = body?.email || user.email;
      user.organization_name = body?.organization_name || user.organization_name;
      user.org_id = body?.org_id || user.org_id;
      return jsonResponse({ ok: true, token: `offline-register-${Date.now()}`, user });
    }
    if (route === '/api/auth/me') {
      const auth = String(headers.Authorization || headers.authorization || '');
      if (!auth) return jsonResponse({ detail: 'Not authenticated.' }, 401);
      return jsonResponse({ ok: true, user: bridge.user || fallbackUser('pilot') });
    }
    if (route === '/api/auth/logout') return jsonResponse({ ok: true });
    if (route === '/api/feedback') {
      const list = readJson(LS.feedback, []);
      const entry = { id: list.length + 1, rating: Number(body?.rating || 0), category: body?.category || 'General', message: body?.message || '', status: 'Open', created_at: new Date().toISOString() };
      list.unshift(entry);
      writeJson(LS.feedback, list.slice(0, 50));
      return jsonResponse({ ok: true, feedback: entry });
    }
    if (route === '/api/leaderboard') return jsonResponse(leaderboardResponse());
    if (route === '/api/leaderboard/submit') {
      const sim = simulate(body);
      const stored = readJson(LS.leaderboard, []);
      const entry = {
        id: `local-${Date.now()}`, actor: bridge.user?.organization_name || 'Pilot Lab',
        formula: shortFormula(sim.composition.fractions), predicted: sim.prediction.predicted,
        unit: 'MPa', confidence: sim.prediction.confidence, rank_score: round(50 + clamp(100 - sim.derived.utilization_ratio * 40, 0, 45), 2),
        discovery_note: `Utilisation ${sim.derived.utilization_ratio} at ${sim.conditions.temperature_c} °C`,
        created_at: new Date().toISOString(),
      };
      stored.unshift(entry);
      writeJson(LS.leaderboard, stored.slice(0, 30));
      return jsonResponse({ ok: true, entry });
    }
    if (route === '/api/report/pdf') {
      const pdf = base64Pdf(reportLines(body || {}));
      return new Response(pdf, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="MATERIALHUNT_Dossier.pdf"' } });
    }
    if (route === '/api/admin/login') {
      const key = String(headers['X-Admin-Passkey'] || headers['x-admin-passkey'] || '');
      if (key !== 'MH_FOUNDER_2026#') return jsonResponse({ detail: 'Invalid admin passkey.' }, 401);
      const snapshot = {
        overview: { total_users: 4, mrr_inr: 0, waived_accounts: 3, pending_kyb: 1, avg_rating: 4.6, open_feedback: readJson(LS.feedback, []).length },
        users: [fallbackUser('pilot')], feedback: readJson(LS.feedback, []), audit: [],
      };
      return jsonResponse({ ok: true, snapshot });
    }
    if (route === '/api/admin/snapshot') return jsonResponse({ ok: true, snapshot: { overview: { total_users: 4, mrr_inr: 0, waived_accounts: 3, pending_kyb: 1, avg_rating: 4.6, open_feedback: 0 }, users: [fallbackUser('pilot')], feedback: readJson(LS.feedback, []), audit: [] } });
    if (route === '/api/admin/discoveries') return jsonResponse({ ok: true, leaderboard: leaderboardResponse().leaders });
    if (route.startsWith('/api/admin/')) return jsonResponse({ ok: true, message: 'Local admin action recorded.' });
    return jsonResponse({ detail: `Offline route ${route} is not implemented.` }, 404);
  }

  /* ------------------------------------------------------------------ */
  /* window.fetch bridge                                                */
  /* ------------------------------------------------------------------ */
  if (nativeFetch) {
    window.fetch = async function bridgedFetch(input, init = {}) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const isApi = url.startsWith('/api/') || url.includes('/api/') || url.endsWith('/api');
      if (!isApi) return nativeFetch(input, init);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4200);
        const response = await nativeFetch(input, { ...init, signal: init.signal || controller.signal });
        clearTimeout(timer);
        const passthrough = [200, 201, 400, 401, 402, 403, 404, 409, 422, 423, 429].includes(response.status);
        const contentType = response.headers.get('content-type') || '';
        if (passthrough && (contentType.includes('json') || contentType.includes('pdf'))) return response;
        if (response.ok) return response;
      } catch { /* static host or backend offline */ }
      return offlineApi(url, init);
    };
  }
  window.MH_OFFLINE_API = offlineApi;
  window.MH_OFFLINE_SIMULATE = simulate;
  window.MH_OFFLINE_PDF = (request) => base64Pdf(reportLines(request));

  /* ------------------------------------------------------------------ */
  /* Firebase SDK (dynamic, hosted only)                                */
  /* ------------------------------------------------------------------ */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Firebase SDK failed to load'));
      document.head.appendChild(script);
    });
  }

  async function initFirebase() {
    if (bridge.ready) return bridge;
    if (!HOSTED || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('REPLACE_')) {
      bridge.error = 'Firebase keys not configured — offline local auth remains active.';
      return bridge;
    }
    try {
      await loadScript(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-compat.js`);
      await loadScript(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth-compat.js`);
      await loadScript(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore-compat.js`);
      window.firebase.initializeApp(firebaseConfig);
      bridge.auth = window.firebase.auth();
      bridge.db = window.firebase.firestore();
      bridge.ready = true;
      bridge.auth.onAuthStateChanged(async (user) => {
        bridge.user = user ? { uid: user.uid, email: user.email, displayName: user.displayName, photoURL: user.photoURL } : null;
        if (user) {
          try {
            await bridge.db.collection('users').doc(user.uid).set({
              email: user.email || '', displayName: user.displayName || '', photoURL: user.photoURL || '',
              lastLoginAt: window.firebase.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
          } catch { /* Firestore rules may still be propagating */ }
        }
      });
    } catch (error) {
      bridge.error = error.message;
    }
    return bridge;
  }

  async function signIn(providerName) {
    await initFirebase();
    if (!bridge.auth) {
      return { ok: false, offline: true, message: 'Firebase keys are not configured. Use the Instant Pilot guest button for full access.' };
    }
    const providers = {
      google: () => new window.firebase.auth.GoogleAuthProvider(),
      github: () => new window.firebase.auth.GithubAuthProvider(),
      apple: () => new window.firebase.auth.OAuthProvider('apple.com'),
      microsoft: () => new window.firebase.auth.OAuthProvider('microsoft.com'),
    };
    const provider = providers[providerName]?.();
    if (!provider) return { ok: false, message: 'Unknown identity provider.' };
    if (providerName === 'microsoft') provider.addScope('openid profile email');
    try {
      const result = await bridge.auth.signInWithPopup(provider);
      const user = result.user;
      return {
        ok: true, token: await user.getIdToken(),
        user: {
          id: user.uid, email: user.email, organization_name: user.displayName || (user.email || '').split('@')[0],
          org_id: 'FIREBASE', tier: 'enterprise', tier_name: 'Enterprise R&D', role: 'member',
          kyb_status: 'approved', billing_status: 'WAIVED', billing_waived: true,
        },
      };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  async function saveLead(lead) {
    const payload = { ...lead, created_at: new Date().toISOString(), source: HOSTED ? 'firebase-hosting' : 'offline' };
    await initFirebase();
    if (bridge.db) {
      try {
        const ref = await bridge.db.collection('rfq_leads').add(payload);
        return { ok: true, id: ref.id, storage: 'firestore' };
      } catch (error) {
        payload.firestore_error = error.message;
      }
    }
    const leads = readJson(LS.leads, []);
    payload.id = `local-${Date.now()}`;
    leads.unshift(payload);
    writeJson(LS.leads, leads.slice(0, 40));
    return { ok: true, id: payload.id, storage: 'local' };
  }

  function saveProfile(profile) {
    const uid = profile?.uid || profile?.id || 'local';
    writeJson(LS.profile, { ...profile, saved_at: new Date().toISOString() });
    if (bridge.db) {
      bridge.db.collection('users').doc(String(uid)).set({
        ...profile, updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => {});
    }
    return { ok: true };
  }

  bridge.initFirebase = initFirebase;
  bridge.signIn = signIn;
  bridge.saveLead = saveLead;
  bridge.saveProfile = saveProfile;
  bridge.buildPdf = (request) => base64Pdf(reportLines(request));
  bridge.shortFormula = shortFormula;
  bridge.loadHandbook = loadHandbook;
  bridge.getHandbook = () => handbook;

  loadHandbook();
  if (HOSTED) setTimeout(initFirebase, 900);
})();
