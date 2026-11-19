"""Shared offline material data for MATERIALHUNT.

Elemental engineering constants used by the ML pipeline, API and 3D frontend.
Costs are indicative Indian-market values in INR per kilogram for screening.
"""
from __future__ import annotations

import math
from typing import Any, Iterable, Mapping

# symbol: name, atomic radius (pm), room-temperature density (g/cm3),
# indicative cost (INR/kg), brand colour for the WebGL scene, engineering role.
ELEMENT_INFO: dict[str, dict[str, Any]] = {
    "Fe": {"name": "Iron", "radius": 126, "density": 7.874, "cost": 8, "color": "#7FB3FF", "role": "Base matrix / ferrite"},
    "Cr": {"name": "Chromium", "radius": 128, "density": 7.19, "cost": 320, "color": "#46E0C0", "role": "Passivation & corrosion resistance"},
    "Ni": {"name": "Nickel", "radius": 124, "density": 8.908, "cost": 1650, "color": "#B388FF", "role": "Austenite stabiliser / toughness"},
    "C": {"name": "Carbon", "radius": 77, "density": 2.267, "cost": 35, "color": "#FFB547", "role": "Interstitial strengthening"},
    "Ti": {"name": "Titanium", "radius": 147, "density": 4.506, "cost": 4600, "color": "#7DD3FC", "role": "Lightweight / oxide stability"},
    "Al": {"name": "Aluminium", "radius": 143, "density": 2.70, "cost": 2300, "color": "#E2E8F0", "role": "Density reduction / oxidation"},
    "Mo": {"name": "Molybdenum", "radius": 139, "density": 10.28, "cost": 3300, "color": "#F472B6", "role": "High-temperature creep strength"},
    "Mn": {"name": "Manganese", "radius": 127, "density": 7.21, "cost": 95, "color": "#FCA5A5", "role": "Hardenability / deoxidation"},
    "Si": {"name": "Silicon", "radius": 111, "density": 2.329, "cost": 130, "color": "#CBD5E1", "role": "Solid-solution strengthening"},
    "Cu": {"name": "Copper", "radius": 128, "density": 8.96, "cost": 780, "color": "#FB923C", "role": "Corrosion resistance / conductivity"},
    "V": {"name": "Vanadium", "radius": 134, "density": 6.11, "cost": 3600, "color": "#A78BFA", "role": "Grain refinement"},
    "W": {"name": "Tungsten", "radius": 139, "density": 19.30, "cost": 3400, "color": "#94A3B8", "role": "Refractory strength"},
    "Co": {"name": "Cobalt", "radius": 125, "density": 8.86, "cost": 3900, "color": "#60A5FA", "role": "Hot hardness"},
    "Nb": {"name": "Niobium", "radius": 146, "density": 8.57, "cost": 4100, "color": "#FBBF24", "role": "Microalloying / grain control"},
    "Zr": {"name": "Zirconium", "radius": 160, "density": 6.51, "cost": 3200, "color": "#67E8F9", "role": "Oxide dispersion"},
    "Mg": {"name": "Magnesium", "radius": 160, "density": 1.738, "cost": 290, "color": "#D9F99D", "role": "Ultralight alloying"},
    "Zn": {"name": "Zinc", "radius": 134, "density": 7.14, "cost": 270, "color": "#A5B4FC", "role": "Sacrificial protection"},
    "Sn": {"name": "Tin", "radius": 140, "density": 7.31, "cost": 2100, "color": "#FDE68A", "role": "Bronze / solder phase"},
    "B": {"name": "Boron", "radius": 82, "density": 2.34, "cost": 600, "color": "#F9A8D4", "role": "Boronising / hardenability"},
    "P": {"name": "Phosphorus", "radius": 110, "density": 1.823, "cost": 250, "color": "#FCA5A5", "role": "Deoxidation"},
    "S": {"name": "Sulphur", "radius": 102, "density": 2.07, "cost": 40, "color": "#FDE047", "role": "Free-machining"},
    "N": {"name": "Nitrogen", "radius": 75, "density": 1.251, "cost": 20, "color": "#93C5FD", "role": "Interstitial strengthening"},
    "O": {"name": "Oxygen", "radius": 73, "density": 1.429, "cost": 15, "color": "#F87171", "role": "Oxide former"},
    "H": {"name": "Hydrogen", "radius": 53, "density": 0.0899, "cost": 150, "color": "#E0F2FE", "role": "Hydrogen embrittlement risk"},
    "Ag": {"name": "Silver", "radius": 144, "density": 10.49, "cost": 78000, "color": "#E5E7EB", "role": "Conductivity"},
    "Au": {"name": "Gold", "radius": 144, "density": 19.30, "cost": 6000000, "color": "#FCD34D", "role": "Noble contact"},
    "Pt": {"name": "Platinum", "radius": 139, "density": 21.45, "cost": 2800000, "color": "#E2E8F0", "role": "Catalysis"},
    "Pd": {"name": "Palladium", "radius": 137, "density": 12.02, "cost": 2500000, "color": "#CBD5E1", "role": "Hydrogen transport"},
    "Ta": {"name": "Tantalum", "radius": 146, "density": 16.65, "cost": 12000, "color": "#A7F3D0", "role": "Corrosion barrier"},
    "Hf": {"name": "Hafnium", "radius": 159, "density": 13.31, "cost": 30000, "color": "#C4B5FD", "role": "Refractory"},
    "Sc": {"name": "Scandium", "radius": 162, "density": 2.985, "cost": 30000, "color": "#F0ABFC", "role": "Aluminium grain refiner"},
    "Y": {"name": "Yttrium", "radius": 180, "density": 4.472, "cost": 5000, "color": "#D8B4FE", "role": "Oxide dispersion"},
    "La": {"name": "Lanthanum", "radius": 187, "density": 6.145, "cost": 400, "color": "#FBCFE8", "role": "Rare-earth addition"},
    "Ce": {"name": "Cerium", "radius": 182, "density": 6.77, "cost": 300, "color": "#FDE68A", "role": "Inclusion control"},
    "Nd": {"name": "Neodymium", "radius": 181, "density": 7.01, "cost": 6000, "color": "#C4B5FD", "role": "Magnetic phase"},
    "Gd": {"name": "Gadolinium", "radius": 180, "density": 7.90, "cost": 4000, "color": "#DDD6FE", "role": "Neutron absorption"},
    "Tb": {"name": "Terbium", "radius": 177, "density": 8.23, "cost": 30000, "color": "#E9D5FF", "role": "Magnetostriction"},
    "Dy": {"name": "Dysprosium", "radius": 175, "density": 8.55, "cost": 12000, "color": "#E9D5FF", "role": "High-temp magnets"},
    "Ho": {"name": "Holmium", "radius": 174, "density": 8.80, "cost": 40000, "color": "#F5D0FE", "role": "Research alloy"},
    "Er": {"name": "Erbium", "radius": 173, "density": 9.07, "cost": 30000, "color": "#F5D0FE", "role": "Research alloy"},
    "Tm": {"name": "Thulium", "radius": 172, "density": 9.32, "cost": 50000, "color": "#F5D0FE", "role": "Research alloy"},
    "Yb": {"name": "Ytterbium", "radius": 194, "density": 6.90, "cost": 3000, "color": "#FEF08A", "role": "Research alloy"},
    "Lu": {"name": "Lutetium", "radius": 172, "density": 9.84, "cost": 60000, "color": "#F5D0FE", "role": "Research alloy"},
    "Li": {"name": "Lithium", "radius": 152, "density": 0.534, "cost": 800, "color": "#BFDBFE", "role": "Ultralight alloy"},
    "Na": {"name": "Sodium", "radius": 186, "density": 0.968, "cost": 300, "color": "#FEF3C7", "role": "Reactive metal"},
    "K": {"name": "Potassium", "radius": 227, "density": 0.862, "cost": 400, "color": "#FDE68A", "role": "Reactive metal"},
    "Ca": {"name": "Calcium", "radius": 197, "density": 1.55, "cost": 350, "color": "#E5E7EB", "role": "Deoxidation"},
    "Rb": {"name": "Rubidium", "radius": 248, "density": 1.532, "cost": 30000, "color": "#FCA5A5", "role": "Research metal"},
    "Sr": {"name": "Strontium", "radius": 215, "density": 2.64, "cost": 500, "color": "#FED7AA", "role": "Modifier"},
    "Cs": {"name": "Caesium", "radius": 265, "density": 1.873, "cost": 60000, "color": "#FDBA74", "role": "Research metal"},
    "Ba": {"name": "Barium", "radius": 217, "density": 3.51, "cost": 400, "color": "#FDE68A", "role": "Modifier"},
    "Bi": {"name": "Bismuth", "radius": 155, "density": 9.78, "cost": 500, "color": "#E9D5FF", "role": "Free-machining"},
    "Sb": {"name": "Antimony", "radius": 145, "density": 6.697, "cost": 800, "color": "#DDD6FE", "role": "Hardening"},
    "Te": {"name": "Tellurium", "radius": 140, "density": 6.24, "cost": 700, "color": "#FBCFE8", "role": "Machinability"},
    "Se": {"name": "Selenium", "radius": 120, "density": 4.809, "cost": 600, "color": "#FCA5A5", "role": "Trace addition"},
    "I": {"name": "Iodine", "radius": 139, "density": 4.933, "cost": 3000, "color": "#C4B5FD", "role": "Reactive additive"},
    "Br": {"name": "Bromine", "radius": 114, "density": 3.12, "cost": 300, "color": "#F87171", "role": "Reactive additive"},
    "Cl": {"name": "Chlorine", "radius": 99, "density": 1.56, "cost": 100, "color": "#FCA5A5", "role": "Corrosion risk"},
    "F": {"name": "Fluorine", "radius": 71, "density": 1.696, "cost": 200, "color": "#FDBA74", "role": "Slag former"},
    "He": {"name": "Helium", "radius": 31, "density": 0.1786, "cost": 5000, "color": "#E0F2FE", "role": "Inert"},
    "Ne": {"name": "Neon", "radius": 38, "density": 0.90, "cost": 10000, "color": "#F0ABFC", "role": "Inert"},
    "Ar": {"name": "Argon", "radius": 71, "density": 1.784, "cost": 1000, "color": "#E9D5FF", "role": "Shielding gas"},
    "Kr": {"name": "Krypton", "radius": 88, "density": 3.75, "cost": 50000, "color": "#DDD6FE", "role": "Inert"},
    "Xe": {"name": "Xenon", "radius": 108, "density": 5.894, "cost": 300000, "color": "#C4B5FD", "role": "Inert"},
    "U": {"name": "Uranium", "radius": 138, "density": 19.1, "cost": 12000, "color": "#84CC16", "role": "Nuclear / dual-use"},
    "Pu": {"name": "Plutonium", "radius": 151, "density": 19.86, "cost": 5000000, "color": "#65A30D", "role": "Nuclear / dual-use"},
    "Th": {"name": "Thorium", "radius": 179, "density": 11.72, "cost": 8000, "color": "#A3E635", "role": "Nuclear / dual-use"},
    "Be": {"name": "Beryllium", "radius": 96, "density": 1.848, "cost": 6000, "color": "#34D399", "role": "Toxic lightweight metal"},
    "Cd": {"name": "Cadmium", "radius": 148, "density": 8.65, "cost": 350, "color": "#FCD34D", "role": "Toxic plating element"},
    "Hg": {"name": "Mercury", "radius": 151, "density": 13.534, "cost": 2500, "color": "#94A3B8", "role": "Toxic liquid metal"},
    "As": {"name": "Arsenic", "radius": 119, "density": 5.727, "cost": 500, "color": "#A3A3A3", "role": "Toxic metalloid"},
}

HAZARDOUS_ELEMENTS = ["Be", "Br", "U", "Pu", "Th", "Cd", "Hg", "As"]
HAZARDOUS_META = {
    "Be": "Beryllium — toxic berylliosis hazard",
    "Br": "Bromine — corrosive dual-use halogen",
    "U": "Uranium — nuclear/dual-use material",
    "Pu": "Plutonium — nuclear/dual-use material",
    "Th": "Thorium — nuclear/dual-use material",
    "Cd": "Cadmium — carcinogenic heavy metal",
    "Hg": "Mercury — neurotoxic liquid metal",
    "As": "Arsenic — toxic metalloid",
}
DEFAULT_ELEMENT = {
    "name": "Unknown",
    "radius": 130,
    "density": 7.5,
    "cost": 1000,
    "color": "#94A3B8",
    "role": "Unclassified element",
}


def element_meta(symbol: str) -> dict[str, Any]:
    return ELEMENT_INFO.get(symbol, {**DEFAULT_ELEMENT, "name": symbol})


def estimate_density(atomic_fractions: Mapping[str, float]) -> float:
    """Rule-of-mixtures density from atomic fractions."""
    total_mass = 0.0
    total_volume = 0.0
    for sym, x in atomic_fractions.items():
        if x <= 0:
            continue
        info = element_meta(sym)
        mass = x * _atomic_mass(sym)
        total_mass += mass
        total_volume += mass / max(info["density"], 0.05)
    if total_volume <= 0:
        return 7.5
    return round(total_mass / total_volume, 3)


def _atomic_mass(symbol: str) -> float:
    try:
        from pymatgen.core import Element
        return float(Element(symbol).atomic_mass)
    except Exception:
        return float(element_meta(symbol)["radius"]) * 0.55


def estimate_cost(atomic_fractions: Mapping[str, float]) -> float:
    """Indicative INR/kg cost using mass fractions."""
    masses: dict[str, float] = {}
    for sym, x in atomic_fractions.items():
        if x > 0:
            masses[sym] = x * _atomic_mass(sym)
    total = sum(masses.values()) or 1.0
    return round(sum((m / total) * element_meta(sym)["cost"] for sym, m in masses.items()), 2)


def thermal_limit(atomic_fractions: Mapping[str, float]) -> int:
    f = atomic_fractions
    limit = (
        300
        + 620 * f.get("Mo", 0)
        + 520 * f.get("W", 0)
        + 300 * f.get("Ti", 0)
        + 260 * f.get("Ni", 0)
        + 210 * f.get("Cr", 0)
        + 180 * f.get("Co", 0)
        + 140 * f.get("Nb", 0)
        - 180 * f.get("Al", 0)
        - 220 * f.get("C", 0)
    )
    return int(max(180, min(1250, limit)))


def corrosion_index(atomic_fractions: Mapping[str, float]) -> float:
    f = atomic_fractions
    idx = (
        0.12
        + 2.6 * f.get("Cr", 0)
        + 1.4 * f.get("Ni", 0)
        + 2.0 * f.get("Mo", 0)
        + 1.0 * f.get("Ti", 0)
        + 0.5 * f.get("Al", 0)
        + 0.4 * f.get("Si", 0)
        + 0.4 * f.get("Cu", 0)
        - 0.8 * f.get("S", 0)
    )
    return round(max(0.0, min(1.0, idx)), 3)


def ductility_index(atomic_fractions: Mapping[str, float]) -> float:
    f = atomic_fractions
    idx = (
        0.34
        + 1.7 * f.get("Ni", 0)
        + 0.9 * f.get("Mn", 0)
        + 0.6 * f.get("Al", 0)
        + 0.35 * f.get("Cr", 0)
        - 2.4 * f.get("C", 0)
        - 0.7 * f.get("Mo", 0)
        - 0.5 * f.get("Si", 0)
    )
    return round(max(0.08, min(0.96, idx)), 3)


def recommend_structure(atomic_fractions: Mapping[str, float], temperature_c: float = 25) -> str:
    """Heuristic crystal-structure recommendation for the interactive lattice."""
    ni = atomic_fractions.get("Ni", 0) + atomic_fractions.get("Mn", 0) * 0.6
    cr = atomic_fractions.get("Cr", 0)
    c = atomic_fractions.get("C", 0)
    al = atomic_fractions.get("Al", 0) + atomic_fractions.get("Ti", 0) * 0.8
    if al > 0.25:
        return "HCP"
    if ni >= 0.09 or (ni + cr >= 0.24):
        return "FCC"
    if c > 0.03 or temperature_c > 750:
        return "BCC"
    return "BCC" if cr > 0.1 else "FCC"


def element_payload(symbols: Iterable[str] | None = None) -> dict[str, dict[str, Any]]:
    if symbols is None:
        return ELEMENT_INFO
    out = {}
    for s in symbols:
        out[s] = {**element_meta(s), "symbol": s, "hazardous": s in HAZARDOUS_ELEMENTS}
    return out


# ---------------------------------------------------------------------------
# Full 118-element periodic table (commercial UI surface)
# ---------------------------------------------------------------------------
CATEGORY_COLORS: dict[str, str] = {
    "alkali metal": "#FB923C",
    "alkaline earth metal": "#FBBF24",
    "transition metal": "#22D3EE",
    "post-transition metal": "#38BDF8",
    "metalloid": "#A78BFA",
    "nonmetal": "#34D399",
    "halogen": "#F43F5E",
    "noble gas": "#818CF8",
    "lanthanide": "#FB7185",
    "actinide": "#F59E0B",
}

# symbol -> (period, group). Lanthanides/actinides keep group 3 in the main
# table and are repeated in the two f-block rows rendered below it.
_MAIN_TABLE: dict[str, tuple[int, int]] = {
    "H": (1, 1), "He": (1, 18),
    "Li": (2, 1), "Be": (2, 2), "B": (2, 13), "C": (2, 14), "N": (2, 15),
    "O": (2, 16), "F": (2, 17), "Ne": (2, 18),
    "Na": (3, 1), "Mg": (3, 2), "Al": (3, 13), "Si": (3, 14), "P": (3, 15),
    "S": (3, 16), "Cl": (3, 17), "Ar": (3, 18),
    "K": (4, 1), "Ca": (4, 2), "Sc": (4, 3), "Ti": (4, 4), "V": (4, 5),
    "Cr": (4, 6), "Mn": (4, 7), "Fe": (4, 8), "Co": (4, 9), "Ni": (4, 10),
    "Cu": (4, 11), "Zn": (4, 12), "Ga": (4, 13), "Ge": (4, 14), "As": (4, 15),
    "Se": (4, 16), "Br": (4, 17), "Kr": (4, 18),
    "Rb": (5, 1), "Sr": (5, 2), "Y": (5, 3), "Zr": (5, 4), "Nb": (5, 5),
    "Mo": (5, 6), "Tc": (5, 7), "Ru": (5, 8), "Rh": (5, 9), "Pd": (5, 10),
    "Ag": (5, 11), "Cd": (5, 12), "In": (5, 13), "Sn": (5, 14), "Sb": (5, 15),
    "Te": (5, 16), "I": (5, 17), "Xe": (5, 18),
    "Cs": (6, 1), "Ba": (6, 2), "La": (6, 3), "Hf": (6, 4), "Ta": (6, 5),
    "W": (6, 6), "Re": (6, 7), "Os": (6, 8), "Ir": (6, 9), "Pt": (6, 10),
    "Au": (6, 11), "Hg": (6, 12), "Tl": (6, 13), "Pb": (6, 14), "Bi": (6, 15),
    "Po": (6, 16), "At": (6, 17), "Rn": (6, 18),
    "Fr": (7, 1), "Ra": (7, 2), "Ac": (7, 3), "Rf": (7, 4), "Db": (7, 5),
    "Sg": (7, 6), "Bh": (7, 7), "Hs": (7, 8), "Mt": (7, 9), "Ds": (7, 10),
    "Rg": (7, 11), "Cn": (7, 12), "Nh": (7, 13), "Fl": (7, 14), "Mc": (7, 15),
    "Lv": (7, 16), "Ts": (7, 17), "Og": (7, 18),
}

_LANTHANIDES = ["Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu"]
_ACTINIDES = ["Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr"]

_CATEGORY_Z: dict[str, set[int]] = {
    "alkali metal": {3, 11, 19, 37, 55, 87},
    "alkaline earth metal": {4, 12, 20, 38, 56, 88},
    "transition metal": set(range(21, 31)) | set(range(39, 49)) | set(range(72, 81)) | set(range(104, 113)),
    "post-transition metal": {13, 31, 49, 50, 81, 82, 83, 84, 113, 114, 115, 116},
    "metalloid": {5, 14, 32, 33, 51, 52},
    "nonmetal": {1, 6, 7, 8, 15, 16, 34},
    "halogen": {9, 17, 35, 53, 85, 117},
    "noble gas": {2, 10, 18, 36, 54, 86, 118},
    "lanthanide": set(range(57, 72)),
    "actinide": set(range(89, 104)),
}


def _category_for_z(z: int) -> str:
    for name, numbers in _CATEGORY_Z.items():
        if z in numbers:
            return name
    return "transition metal"


_PERIODIC_CACHE: list[dict[str, Any]] | None = None


def periodic_table_payload() -> list[dict[str, Any]]:
    """Return all 118 elements with grid coordinates and engineering metadata."""
    global _PERIODIC_CACHE
    if _PERIODIC_CACHE is not None:
        return _PERIODIC_CACHE
    from pymatgen.core import Element

    rows: list[dict[str, Any]] = []
    for z in range(1, 119):
        element = Element.from_Z(z)
        symbol = element.symbol
        name = getattr(element, "long_name", None) or symbol
        period, group = _MAIN_TABLE.get(symbol, (0, 0))
        grid_row = period
        grid_col = group
        if symbol in _LANTHANIDES:
            grid_row = 9
            grid_col = 4 + _LANTHANIDES.index(symbol)
        elif symbol in _ACTINIDES:
            grid_row = 10
            grid_col = 4 + _ACTINIDES.index(symbol)
        info = ELEMENT_INFO.get(symbol, {})
        category = _category_for_z(z)
        rows.append({
            "z": z,
            "symbol": symbol,
            "name": name,
            "mass": round(float(element.atomic_mass), 3),
            "category": category,
            "color": info.get("color") or CATEGORY_COLORS.get(category, "#94A3B8"),
            "category_color": CATEGORY_COLORS.get(category, "#94A3B8"),
            "density": info.get("density"),
            "cost": info.get("cost"),
            "radius": info.get("radius"),
            "role": info.get("role", "Periodic-table element"),
            "period": period,
            "group": group,
            "grid_row": grid_row,
            "grid_col": grid_col,
            "hazardous": symbol in HAZARDOUS_ELEMENTS,
        })
    _PERIODIC_CACHE = rows
    return rows


# ---------------------------------------------------------------------------
# Commercial simulation helpers (MATERIALHUNT Inc.)
# ---------------------------------------------------------------------------
MATERIALHUNT_LABELS = {
    "mode": {
        "live_demo": "MATERIALHUNT Interactive R&D Sandbox — Instant Enterprise Trial Mode",
        "live_pilot": "MATERIALHUNT Live Pilot",
        "is_live": True,
        "banner": "MATERIALHUNT Interactive R&D Sandbox",
    },
    "vip": {
        "summit_grant": "VIP GRANT — FEE WAIVED (₹0)",
        "enterprise_badge": "ENTERPRISE VIP · KYB VERIFIED",
        "kyb_pending": "KYB VERIFICATION PENDING",
        "callout": "Enterprise R&D Feature Unlock",
    },
    "admin": {
        "gate": "mh_vault_99x",
        "passkey": "MH_FOUNDER_2026#",
        "vault_title": "MATERIALHUNT Founder Vault",
        "locked_message": "3-attempt lockout in effect. Cooldown 15 minutes.",
    },
    "leaderboard": {
        "title": "Global R&D Discovery Leaderboard",
        "subtitle": "Verified material breakthroughs from enterprise labs",
        "leader_title": "Top R&D Team",
        "sub_labels": ["Material", "Strength", "Density", "Region", "Confidence", "Date"],
    },
}

LIQUIDUS_ELEMENTS = ["U", "Pu", "Th", "Be", "Cd", "Hg", "As", "Br"]
LIQUIDUS_META = {
    "U": "Uranium — liquidus at 1132°C, nuclear fuel cycle material",
    "Pu": "Plutonium — liquidus at 639.6°C, fissile material",
    "Th": "Thorium — liquidus at 1750°C, nuclear fuel precursor",
    "Be": "Beryllium — liquidus at 1287°C, toxic inhalation hazard",
    "Cd": "Cadmium — liquidus at 321°C, carcinogenic heavy metal",
    "Hg": "Mercury — liquidus at -38.83°C, neurotoxic liquid metal",
    "As": "Arsenic — liquidus at 817°C, toxic metalloid",
    "Br": "Bromine — liquidus at -7.2°C, corrosive dual-use halogen",
}

# Fallback melting points (°C) for elements that pymatgen cannot resolve.
_MELTING_FALLBACK = {
    "H": -259.1, "He": -272.2, "Li": 180.5, "Be": 1287.0, "B": 2076.0,
    "C": 3550.0, "N": -210.0, "O": -218.8, "F": -219.7, "Ne": -248.6,
    "Na": 97.8, "Mg": 650.0, "Al": 660.3, "Si": 1414.0, "P": 44.2,
    "S": 115.2, "Cl": -101.5, "Ar": -189.3, "K": 63.5, "Ca": 842.0,
    "Sc": 1541.0, "Ti": 1668.0, "V": 1910.0, "Cr": 1907.0, "Mn": 1246.0,
    "Fe": 1538.0, "Co": 1495.0, "Ni": 1455.0, "Cu": 1084.6, "Zn": 419.5,
    "Ga": 29.8, "Ge": 938.3, "As": 817.0, "Se": 221.0, "Br": -7.2,
    "Kr": -157.4, "Rb": 39.3, "Sr": 777.0, "Y": 1526.0, "Zr": 1855.0,
    "Nb": 2477.0, "Mo": 2623.0, "Tc": 2157.0, "Ru": 2334.0, "Rh": 1964.0,
    "Pd": 1554.9, "Ag": 961.8, "Cd": 321.1, "In": 156.6, "Sn": 231.9,
    "Sb": 630.6, "Te": 449.5, "I": 113.7, "Xe": -111.8, "Cs": 28.4,
    "Ba": 727.0, "La": 920.0, "Ce": 795.0, "Pr": 935.0, "Nd": 1024.0,
    "Pm": 1042.0, "Sm": 1072.0, "Eu": 822.0, "Gd": 1312.0, "Tb": 1356.0,
    "Dy": 1407.0, "Ho": 1461.0, "Er": 1529.0, "Tm": 1545.0, "Yb": 824.0,
    "Lu": 1652.0, "Hf": 2233.0, "Ta": 3017.0, "W": 3422.0, "Re": 3186.0,
    "Os": 3033.0, "Ir": 2446.0, "Pt": 1768.3, "Au": 1064.2, "Hg": -38.8,
    "Tl": 304.0, "Pb": 327.5, "Bi": 271.4, "Po": 254.0, "At": 302.0,
    "Rn": -71.0, "Fr": 27.0, "Ra": 700.0, "Ac": 1050.0, "Th": 1750.0,
    "Pa": 1572.0, "U": 1132.0, "Np": 644.0, "Pu": 639.6, "Am": 1176.0,
    "Cm": 1345.0, "Bk": 986.0, "Cf": 900.0, "Es": 860.0, "Fm": 1527.0,
    "Md": 827.0, "No": 827.0, "Lr": 1627.0, "Rf": 2100.0, "Db": 2100.0,
    "Sg": 2100.0, "Bh": 2100.0, "Hs": 2100.0, "Mt": 2100.0, "Ds": 2100.0,
    "Rg": 2100.0, "Cn": 2100.0, "Nh": 2100.0, "Fl": 2100.0, "Mc": 2100.0,
    "Lv": 2100.0, "Ts": 2100.0, "Og": 2100.0,
}


def elemental_melting_point(symbol: str) -> float:
    """Return an elemental melting point in °C, with a stable offline fallback."""
    try:
        from pymatgen.core import Element
        value = Element(symbol).melting_point
        if value is not None and math.isfinite(float(value)):
            return float(value)
    except Exception:
        pass
    return float(_MELTING_FALLBACK.get(symbol, 1500.0))


def calculate_liquidus_state(elements: Mapping[str, float],
                             temperature_c: float = 25.0) -> tuple[bool, float, str, str]:
    """Weighted liquidus failure check for a multi-element composition.

    Returns (is_melted, liquidus_c, verdict_label, message).
    """
    weights = {sym: max(0.0, float(frac)) for sym, frac in elements.items() if float(frac) > 0}
    total = sum(weights.values())
    if total <= 0:
        return False, 25.0, "SOLID", "No composition supplied."

    liquidus = sum((w / total) * elemental_melting_point(sym) for sym, w in weights.items())
    if len(weights) > 1:
        # Multi-component alloying-point depression (screening heuristic).
        liquidus *= 0.92
    liquidus = max(-273.15, min(3500.0, liquidus))

    if temperature_c >= liquidus:
        return (
            True,
            round(liquidus, 2),
            "MELTED",
            f"Operating temperature {temperature_c:.1f}°C reaches the weighted liquidus "
            f"of {liquidus:.1f}°C. The alloy loses load-bearing capacity.",
        )
    margin = liquidus - temperature_c
    return (
        False,
        round(liquidus, 2),
        "SOLID",
        f"Weighted liquidus {liquidus:.1f}°C leaves a {margin:.0f}°C solid-state margin.",
    )


def calculate_environment_parameters(density_gcm3: float, temperature_c: float,
                                     velocity_kmh: float, pressure_pa: Optional[float],
                                     environment_type: str = "Air / Industrial",
                                     environment_density_kgm3: Optional[float] = None) -> dict[str, Any]:
    """Return pressure, dynamic-head and burst data for the working envelope.

    Dynamic fluid pressure is q = 0.5 · rho · v². Temperature spans -273.15°C
    to +3,500°C; pressure spans 0 Pa to practical infinity; the fluid density
    spans 0 to 25,000 kg/m³.
    """
    valid_temp_c = max(-273.15, min(3500.0, float(temperature_c)))
    temperature_k = valid_temp_c + 273.15

    if pressure_pa is None or pressure_pa < 0:
        pressure_pa = 0.0
    valid_pressure_pa = min(max(0.0, float(pressure_pa)), 1e16)

    env_factors = {
        "Air / Industrial": {"density_kgm3": 1.225, "viscosity": 0.0000182},
        "Marine / Salt Spray": {"density_kgm3": 1025.0, "viscosity": 0.0000010},
        "Acidic / Chemical": {"density_kgm3": 1500.0, "viscosity": 0.0000250},
        "Inert / Argon": {"density_kgm3": 1.784, "viscosity": 0.0000140},
        "High-Vacuum": {"density_kgm3": 0.0, "viscosity": 0.0},
        "Oxidising / Steam": {"density_kgm3": 598.0, "viscosity": 0.0000120},
        "Cryogenic / LNG": {"density_kgm3": 476.0, "viscosity": 0.0000015},
    }
    env = env_factors.get(environment_type, env_factors["Air / Industrial"])
    medium_density = env["density_kgm3"] if environment_density_kgm3 is None else float(environment_density_kgm3)
    medium_density = max(0.0, min(25000.0, medium_density))

    velocity_ms = max(0.0, min(3500.0, float(velocity_kmh))) / 3.6
    dynamic_pressure_pa = 0.5 * medium_density * (velocity_ms ** 2)
    total_pressure_pa = valid_pressure_pa + dynamic_pressure_pa

    temp_factor = max(0.05, min(1.0, (3500.0 - valid_temp_c) / 3500.0))
    # A conservative screening burst ceiling: 5 GPa at ambient, falling with heat.
    burst_pressure_pa = 5.0e9 * (0.35 + 0.65 * temp_factor)
    burst_ratio = total_pressure_pa / max(1.0, burst_pressure_pa)
    has_burst = total_pressure_pa >= burst_pressure_pa

    return {
        "temperature_c": round(valid_temp_c, 2),
        "temperature_k": round(temperature_k, 2),
        "pressure_pa": round(valid_pressure_pa, 2),
        "pressure_kpa": round(valid_pressure_pa / 1e3, 4),
        "pressure_mpa": round(valid_pressure_pa / 1e6, 4),
        "pressure_gpa": round(valid_pressure_pa / 1e9, 6),
        "pressure_label": "∞ Burst" if valid_pressure_pa >= 1e15 else f"{valid_pressure_pa:,.0f} Pa",
        "environment_density_kgm3": round(medium_density, 3),
        "environment_type": environment_type,
        "velocity_kmh": round(float(velocity_kmh), 2),
        "velocity_ms": round(velocity_ms, 3),
        "dynamic_pressure_pa": round(dynamic_pressure_pa, 2),
        "dynamic_pressure_kpa": round(dynamic_pressure_pa / 1e3, 4),
        "total_pressure_pa": round(total_pressure_pa, 2),
        "total_pressure_mpa": round(total_pressure_pa / 1e6, 4),
        "burst_pressure_pa": round(burst_pressure_pa, 2),
        "burst_pressure_gpa": round(burst_pressure_pa / 1e9, 4),
        "burst_ratio": round(burst_ratio, 4),
        "is_burst_condition": has_burst,
        "is_within_pressure_limits": not has_burst,
        "viscosity_pas": round(env["viscosity"], 6),
        "material_density_kgm3": round(float(density_gcm3) * 1000, 2),
    }


def calculate_cryogenic_effects(temperature_c: float) -> dict[str, Any]:
    """Cryogenic service effects from -273.15°C to -100°C."""
    temp_c = max(-273.15, min(-100.0, float(temperature_c)))
    ductility_penalty = max(0.0, min(0.25, (100 - abs(temp_c)) / 100 * 0.25))
    charpy = 200.0 * (1.0 - ductility_penalty)
    return {
        "temperature_c": round(temp_c, 2),
        "temperature_k": round(temp_c + 273.15, 2),
        "cryogenic_range": "Deep Cryogenic" if temp_c <= -200 else "Cryogenic",
        "ductility_penalty": round(ductility_penalty * 100, 1),
        "charpy_joules": round(charpy, 2),
        "ductile_to_brittle_transition_validated": temp_c > -100,
        "helium_embrittlement_risk": temp_c < -260,
        "neutron_activation_risk": temp_c < -260,
        "frost_fatigue_needed": temp_c <= -50,
        "recommended_materials": ["Austenitic stabilised steel (high Ni)", "Aluminium 2024-T4", "Ti-6Al-4V"],
    }


def calculate_refractory_stability(temperature_c: float) -> dict[str, Any]:
    """Refractory stability and creep screening from 500°C to 3,500°C."""
    if temperature_c < 500:
        return {"is_refractory": False, "stability": "Conventional alloy", "remaining_strength_pct": 100.0}
    remaining = max(18.0, 100.0 - (temperature_c - 500.0) / 30.0)
    temperature_k = temperature_c + 273.15
    creep_rate = 1e-14 * math.exp(min(12.0, (temperature_c - 500.0) / 220.0))
    return {
        "temperature_c": round(temperature_c, 2),
        "temperature_k": round(temperature_k, 2),
        "is_refractory": temperature_c >= 1000,
        "stability": "Refractory" if temperature_c >= 1000 else "High-temperature alloy",
        "remaining_strength_pct": round(remaining, 1),
        "creep_rate_s1": float(f"{creep_rate:.3e}"),
        "creep_rate_s1_label": f"{creep_rate:.2e} s⁻¹",
        "service_ceiling_c": 1500 if temperature_c >= 1000 else 1100,
        "recommended_for": ["Hypersonic leading edges", "Rocket nozzles", "Fusion reactor first wall"],
    }


def check_elemental_melting(element_symbol: str, atomic_fraction: float,
                            base_melting_c: float) -> tuple[str, float, str]:
    """Check a single element against its liquidus."""
    if atomic_fraction <= 0:
        return "SOLID", base_melting_c, "Element not present"
    melting = elemental_melting_point(element_symbol)
    if element_symbol in LIQUIDUS_ELEMENTS:
        return "RESTRICTED", melting, LIQUIDUS_META.get(element_symbol, f"{element_symbol} is restricted")
    return "SOLID", melting, f"{element_symbol} melts at {melting:.0f}°C"


def calculate_oxygen_escape_rate(temperature_c: float, pressure_pa: float,
                                 density_gcm3: float) -> float:
    """Arrhenius oxide-diffusion escape proxy (kPa/min) at elevated temperature."""
    if density_gcm3 <= 0.01 or temperature_c <= 25:
        return 0.0
    temperature_k = temperature_c + 273.15
    diffusion = 1e-7 * math.exp(-80000 / (8.314 * temperature_k))
    escape = diffusion * (pressure_pa / (density_gcm3 * 1000)) * 60 / 1000
    return round(max(0.0, escape), 6)
