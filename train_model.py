"""MATERIALHUNT — offline ML training pipeline.

Trains three real Matbench models with Magpie composition features:
  * matbench_steels   -> Yield Strength (MPa)
  * matbench_glass    -> Glass-Forming Ability (K)
  * matbench_expt_gap -> Band Gap (eV)

Benchmarks a linear baseline, a 150-tree Random Forest and Gradient Boosting
on an 80/20 split (random_state=42). Epistemic uncertainty is the standard
deviation across all 150 Random-Forest trees, graded High / Medium / Low.

Run:  python train_model.py
Output: materialhunt_bundle.pkl (models, featurizer, candidates, metrics)
"""
from __future__ import annotations

import json
import math
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA

warnings.filterwarnings("ignore")

BASE_DIR = Path(__file__).resolve().parent
BUNDLE_PATH = BASE_DIR / "materialhunt_bundle.pkl"
RANDOM_STATE = 42
MAX_CANDIDATES_PER_DATASET = 60
FEATURE_SPACE_PER_DATASET = 260

sys.path.insert(0, str(BASE_DIR))
from material_data import (  # noqa: E402
    HAZARDOUS_ELEMENTS,
    corrosion_index,
    ductility_index,
    estimate_cost,
    estimate_density,
    thermal_limit,
)

DATASET_CONFIG = {
    "steels": {
        "loader": "matbench_steels",
        "target_aliases": ["yield strength", "yield_strength", "yield strength (mpa)", "ys"],
        "label": "Matbench Steels",
        "target_name": "Yield Strength",
        "target_short": "YS",
        "unit": "MPa",
    },
    "glass": {
        "loader": "matbench_glass",
        "target_aliases": ["gfa", "glass forming ability", "glass-forming ability", "tg"],
        "label": "Matbench Glass",
        "target_name": "Glass-Forming Ability",
        "target_short": "GFA",
        "unit": "K",
    },
    "expt_gap": {
        "loader": "matbench_expt_gap",
        "target_aliases": ["gap expt", "gap_expt", "band gap", "bandgap", "gap"],
        "label": "Matbench Experimental Gap",
        "target_name": "Band Gap",
        "target_short": "Eg",
        "unit": "eV",
    },
}


def log(message: str) -> None:
    print(f"[MATERIALHUNT] {message}", flush=True)


def resolve_target_column(df: pd.DataFrame, aliases: list[str]) -> str:
    lowered = {str(c).strip().lower(): c for c in df.columns}
    for alias in aliases:
        if alias in lowered:
            return lowered[alias]
    for key, original in lowered.items():
        if any(alias in key for alias in aliases):
            return original
    numeric_cols = [c for c in df.columns if c != "composition" and pd.api.types.is_numeric_dtype(df[c])]
    if len(numeric_cols) == 1:
        return numeric_cols[0]
    raise KeyError(f"Could not resolve target column from {list(df.columns)}")


def load_dataset_frame(dataset_key: str):
    from matminer.datasets import load_dataset
    from pymatgen.core import Composition

    cfg = DATASET_CONFIG[dataset_key]
    log(f"Loading {cfg['loader']} (first run downloads and caches the Matbench JSON)...")
    df = load_dataset(cfg["loader"])
    log(f"{cfg['loader']} columns: {list(df.columns)} | rows={len(df)}")

    target_col = resolve_target_column(df, cfg["target_aliases"])
    df = df[["composition", target_col]].copy()
    df.columns = ["composition", "target"]
    df["target"] = pd.to_numeric(df["target"], errors="coerce")
    df = df.dropna(subset=["target", "composition"]).reset_index(drop=True)
    df = df[df["target"].apply(lambda v: math.isfinite(float(v)))].reset_index(drop=True)

    def to_composition(value):
        if isinstance(value, Composition):
            return value
        return Composition(str(value))

    df["composition"] = df["composition"].map(to_composition)
    df = df[df["composition"].apply(lambda c: len(c) > 0 and c.weight > 0)].reset_index(drop=True)
    return df, cfg, target_col


def magpie_matrix(featurizer, compositions: pd.Series) -> pd.DataFrame:
    """Featurise compositions into a tidy Magpie DataFrame.

    matminer 0.10 returns a raw matrix from ElementProperty.transform, so the
    feature labels are attached explicitly here (works across matminer APIs).
    """
    rows = featurizer.transform(list(compositions))
    labels = list(featurizer.feature_labels())
    features = pd.DataFrame(rows, columns=labels)
    features = features.apply(pd.to_numeric, errors="coerce")
    features = features.replace([np.inf, -np.inf], np.nan)
    return features


def tree_uncertainty(model: RandomForestRegressor, X: np.ndarray) -> np.ndarray:
    predictions = np.array([tree.predict(X) for tree in model.estimators_])
    return predictions.std(axis=0)


def grade_confidence(uncertainty: float, low_cut: float, medium_cut: float) -> str:
    if uncertainty <= low_cut:
        return "High"
    if uncertainty <= medium_cut:
        return "Medium"
    return "Low"


def safe_metrics(y_true, y_pred) -> dict[str, float]:
    return {
        "r2": round(float(r2_score(y_true, y_pred)), 4),
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "rmse": round(float(math.sqrt(mean_squared_error(y_true, y_pred))), 4),
    }


def alloy_class(fractions: dict[str, float], dataset: str) -> str:
    if dataset == "glass":
        return "Bulk Metallic Glass"
    if dataset == "expt_gap":
        return "Functional Semiconductor"
    if fractions.get("Ti", 0) > 0.45:
        return "Titanium Alloy"
    if fractions.get("Al", 0) > 0.45:
        return "Aluminium Alloy"
    if fractions.get("Ni", 0) > 0.4:
        return "Nickel Superalloy"
    if fractions.get("Cr", 0) > 0.1 and fractions.get("Ni", 0) > 0.04:
        return "Stainless Steel"
    if fractions.get("Cr", 0) > 0.1:
        return "Tool / Die Steel"
    return "Structural Steel"


def candidate_record(
    dataset_key: str,
    cfg: dict[str, Any],
    composition,
    predicted: float,
    actual: float,
    uncertainty: float,
    confidence: str,
    index: int,
    pca_xyz: tuple[float, float, float],
) -> dict[str, Any]:
    fractions_raw = composition.get_el_amt_dict()
    total = sum(fractions_raw.values()) or 1.0
    fractions = {sym: round(float(amount / total), 5) for sym, amount in fractions_raw.items() if amount > 0}
    density = estimate_density(fractions)
    cost = estimate_cost(fractions)
    is_steel = dataset_key == "steels"
    predicted = float(predicted)
    record = {
        "id": f"MH-{dataset_key[:2].upper()}-{index:04d}",
        "dataset": dataset_key,
        "dataset_label": cfg["label"],
        "target_name": cfg["target_name"],
        "target_short": cfg["target_short"],
        "unit": cfg["unit"],
        "formula": composition.reduced_formula,
        "formula_full": composition.formula,
        "composition": str(composition),
        "predicted": round(predicted, 4),
        "actual": round(float(actual), 4),
        "uncertainty": round(float(uncertainty), 4),
        "confidence": confidence,
        "density": density,
        "cost_per_kg": cost,
        "thermal_limit_c": thermal_limit(fractions),
        "corrosion_index": corrosion_index(fractions),
        "ductility_index": ductility_index(fractions),
        "elements": fractions,
        "element_list": sorted(fractions.keys(), key=lambda s: fractions[s], reverse=True),
        "alloy_class": alloy_class(fractions, dataset_key),
        "hazardous": sorted(set(fractions) & set(HAZARDOUS_ELEMENTS)) if dataset_key != "glass" else [],
        "pca": [round(float(v), 4) for v in pca_xyz],
        "strength_mpa": round(predicted, 2) if is_steel else None,
        "specific_strength": round(predicted / max(density, 0.1), 2) if is_steel else None,
        "gfa_k": round(predicted, 2) if dataset_key == "glass" else None,
        "band_gap_ev": round(predicted, 3) if dataset_key == "expt_gap" else None,
        "test_error": round(abs(predicted - float(actual)), 4),
    }
    return record


def train() -> dict[str, Any]:
    started = time.perf_counter()
    from matminer.featurizers.composition import ElementProperty

    log("Building Magpie ElementProperty featurizer (preset='magpie')...")
    featurizer = ElementProperty.from_preset("magpie")
    feature_names = list(featurizer.feature_labels())
    log(f"Magpie feature vector dimensionality: {len(feature_names)}")

    datasets: dict[str, Any] = {}
    candidate_pool: list[dict[str, Any]] = []
    feature_space: list[dict[str, Any]] = []
    pca_inputs: list[np.ndarray] = []
    dataset_matrices: dict[str, np.ndarray] = {}
    candidate_refs: list[tuple[int, str, int]] = []
    feature_space_refs: list[tuple[int, str, int]] = []
    all_feature_names: list[str] | None = None

    for dataset_key, cfg in DATASET_CONFIG.items():
        log(f"================ {cfg['label']} ({dataset_key}) ================")
        df, cfg, target_col = load_dataset_frame(dataset_key)
        log(f"Featurising {len(df)} compositions with Magpie...")
        t_feat = time.perf_counter()
        features = magpie_matrix(featurizer, df["composition"])
        if all_feature_names is None:
            all_feature_names = list(features.columns)
        features = features.reindex(columns=all_feature_names)
        log(f"Featurisation complete in {time.perf_counter() - t_feat:.1f}s -> {features.shape}")

        y = df["target"].to_numpy(dtype=float)
        X_raw = features.to_numpy(dtype=float)
        imputer = SimpleImputer(strategy="median")
        X = imputer.fit_transform(X_raw)

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=RANDOM_STATE
        )
        idx_train, idx_test = train_test_split(
            np.arange(len(y)), test_size=0.2, random_state=RANDOM_STATE
        )
        log(f"80/20 split -> train={len(X_train)} test={len(X_test)}")

        models: dict[str, Any] = {}
        benchmarks: dict[str, Any] = {}

        log("Training Linear Regression baseline...")
        t0 = time.perf_counter()
        linear = Pipeline([
            ("scaler", StandardScaler()),
            ("model", LinearRegression()),
        ])
        linear.fit(X_train, y_train)
        linear_pred = linear.predict(X_test)
        models["linear"] = linear
        benchmarks["linear"] = {
            "name": "Linear Baseline", **safe_metrics(y_test, linear_pred),
            "train_seconds": round(time.perf_counter() - t0, 2),
        }

        log("Training Random Forest (150 trees, epistemic uncertainty)...")
        t0 = time.perf_counter()
        rf = RandomForestRegressor(
            n_estimators=150,
            random_state=RANDOM_STATE,
            n_jobs=-1,
            min_samples_leaf=1,
            max_features=1.0 / 3.0,
        )
        rf.fit(X_train, y_train)
        rf_pred = rf.predict(X_test)
        models["random_forest"] = rf
        benchmarks["random_forest"] = {
            "name": "Random Forest (150 trees)", **safe_metrics(y_test, rf_pred),
            "train_seconds": round(time.perf_counter() - t0, 2),
        }

        log("Training Gradient Boosting...")
        t0 = time.perf_counter()
        gb = GradientBoostingRegressor(
            n_estimators=100,
            learning_rate=0.06,
            max_depth=3,
            subsample=0.9,
            random_state=RANDOM_STATE,
        )
        gb.fit(X_train, y_train)
        gb_pred = gb.predict(X_test)
        models["gradient_boosting"] = gb
        benchmarks["gradient_boosting"] = {
            "name": "Gradient Boosting", **safe_metrics(y_test, gb_pred),
            "train_seconds": round(time.perf_counter() - t0, 2),
        }

        # Epistemic uncertainty from the spread of all 150 individual trees.
        uncertainty = tree_uncertainty(rf, X_test)
        low_cut = float(np.quantile(uncertainty, 0.33))
        medium_cut = float(np.quantile(uncertainty, 0.66))
        if medium_cut <= low_cut:
            medium_cut = low_cut + 1e-9
        confidences = [grade_confidence(float(u), low_cut, medium_cut) for u in uncertainty]
        benchmarks["random_forest"]["mean_uncertainty"] = round(float(uncertainty.mean()), 4)

        best_name = max(benchmarks, key=lambda k: benchmarks[k]["r2"])
        benchmarks["best_model"] = best_name
        benchmarks["dataset_rows"] = int(len(y))
        benchmarks["train_rows"] = int(len(X_train))
        benchmarks["test_rows"] = int(len(X_test))
        benchmarks["target_mean"] = round(float(y.mean()), 4)
        benchmarks["target_std"] = round(float(y.std()), 4)

        importances = []
        for name, model_key in (("random_forest", "random_forest"), ("gradient_boosting", "gradient_boosting")):
            est = models[model_key]
            order = np.argsort(est.feature_importances_)[::-1][:10]
            importances.append({
                "model": name,
                "features": [
                    {"feature": str(all_feature_names[i]), "importance": round(float(est.feature_importances_[i]), 6)}
                    for i in order
                ],
            })

        # PCA projection for the 3D feature-space cluster map (global fit below).
        pca_fit_n = min(1200, len(X))
        rng = np.random.default_rng(RANDOM_STATE)
        fit_idx = rng.choice(len(X), size=pca_fit_n, replace=False) if len(X) > pca_fit_n else np.arange(len(X))
        dataset_matrices[dataset_key] = X
        pca_inputs.append(X[fit_idx])

        # Candidate sample from the held-out test set (never trained on these).
        rng_candidates = np.random.default_rng(RANDOM_STATE + len(candidate_pool))
        if len(idx_test) > MAX_CANDIDATES_PER_DATASET:
            chosen_local = rng_candidates.choice(len(idx_test), size=MAX_CANDIDATES_PER_DATASET, replace=False)
        else:
            chosen_local = np.arange(len(idx_test))
        chosen_local = np.sort(chosen_local)

        for order_i, local_i in enumerate(chosen_local):
            global_i = int(idx_test[local_i])
            composition = df["composition"].iloc[global_i]
            rec = candidate_record(
                dataset_key, cfg, composition,
                predicted=rf_pred[local_i], actual=y_test[local_i],
                uncertainty=uncertainty[local_i], confidence=confidences[local_i],
                index=order_i + 1, pca_xyz=(0.0, 0.0, 0.0),
            )
            candidate_pool.append(rec)
            candidate_refs.append((len(candidate_pool) - 1, dataset_key, global_i))

        # Feature-space cloud sample (test rows only keeps the story honest).
        fs_n = min(FEATURE_SPACE_PER_DATASET, len(idx_test))
        fs_chosen = rng_candidates.choice(len(idx_test), size=fs_n, replace=False)
        for local_i in fs_chosen:
            global_i = int(idx_test[local_i])
            feature_space.append({
                "x": 0.0, "y": 0.0, "z": 0.0,
                "dataset": dataset_key,
                "confidence": confidences[local_i],
                "composition": df["composition"].iloc[global_i].reduced_formula,
            })
            feature_space_refs.append((len(feature_space) - 1, dataset_key, global_i))

        datasets[dataset_key] = {
            "key": dataset_key,
            "label": cfg["label"],
            "target_name": cfg["target_name"],
            "target_short": cfg["target_short"],
            "unit": cfg["unit"],
            "target_column": str(target_col),
            "models": models,
            "featurizer": featurizer,
            "imputer": imputer,
            "benchmarks": benchmarks,
            "uncertainty_thresholds": {
                "high_max": round(low_cut, 6),
                "medium_max": round(medium_cut, 6),
                "low_min": round(medium_cut, 6),
            },
            "feature_importances": importances,
            "candidate_count": len(chosen_local),
            "test_r2": benchmarks["random_forest"]["r2"],
            "test_mae": benchmarks["random_forest"]["mae"],
            "best_model": best_name,
        }
        log(
            f"{cfg['label']}: RF R2={benchmarks['random_forest']['r2']:.3f} "
            f"MAE={benchmarks['random_forest']['mae']:.3f} {cfg['unit']} | "
            f"best={best_name} | candidates={len(chosen_local)}"
        )

    # One global PCA space across all three Matbench datasets.
    log("Fitting global 3D PCA feature-space projection...")
    combined = np.vstack(pca_inputs)
    global_scaler = StandardScaler().fit(combined)
    global_pca = PCA(n_components=3, random_state=RANDOM_STATE).fit(global_scaler.transform(combined))

    # Re-project every saved candidate and cluster point into the same global
    # Magpie PCA basis so the custom alloy marker is directly comparable.
    def project_row(dataset_key: str, row_index: int) -> list[float]:
        row = dataset_matrices[dataset_key][row_index:row_index + 1]
        xyz = global_pca.transform(global_scaler.transform(row))[0]
        return [round(float(v), 4) for v in xyz]

    for pool_index, dataset_key, row_index in candidate_refs:
        candidate_pool[pool_index]["pca"] = project_row(dataset_key, row_index)
    for space_index, dataset_key, row_index in feature_space_refs:
        feature_space[space_index].update(dict(zip(("x", "y", "z"), project_row(dataset_key, row_index))))
    log(f"Projected {len(candidate_refs)} candidates and {len(feature_space_refs)} cluster points.")
    dataset_summary = {
        key: {
            "label": info["label"],
            "target_name": info["target_name"],
            "unit": info["unit"],
            "rows": info["benchmarks"]["dataset_rows"],
            "rf_r2": info["benchmarks"]["random_forest"]["r2"],
            "rf_mae": info["benchmarks"]["random_forest"]["mae"],
            "best_model": info["best_model"],
            "candidate_count": info["candidate_count"],
        }
        for key, info in datasets.items()
    }

    bundle = {
        "version": "2.6.0",
        "product": "MATERIALHUNT",
        "created_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "random_state": RANDOM_STATE,
        "feature_names": all_feature_names,
        "featurizer": featurizer,
        "global_pca": {
            "scaler": global_scaler,
            "model": global_pca,
            "explained_variance": [round(float(v), 4) for v in global_pca.explained_variance_ratio_],
        },
        "datasets": datasets,
        "candidates": candidate_pool,
        "feature_space": feature_space,
        "summary": dataset_summary,
        "training_seconds": round(time.perf_counter() - started, 1),
        "benchmark_protocol": "80/20 hold-out split, random_state=42, Magpie composition features",
        "uncertainty_protocol": "Population standard deviation across all 150 Random-Forest trees; High/Medium/Low graded on held-out uncertainty terciles.",
    }

    log(f"Writing bundle -> {BUNDLE_PATH}")
    joblib.dump(bundle, BUNDLE_PATH, compress=3)
    size_mb = BUNDLE_PATH.stat().st_size / (1024 * 1024)
    log(f"Bundle saved ({size_mb:.1f} MB) in {bundle['training_seconds']}s")
    log("Dataset summary:")
    print(json.dumps(dataset_summary, indent=2), flush=True)
    log("Benchmark metrics:")
    print(json.dumps({k: v["benchmarks"] for k, v in datasets.items()}, indent=2), flush=True)
    return dataset_summary


if __name__ == "__main__":
    summary = train()
    log("Training pipeline complete. Start the SaaS with: python main.py")
