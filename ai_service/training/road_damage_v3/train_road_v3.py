import os
import sys
import time
import json
import shutil
import hashlib
from pathlib import Path
import torch
from ultralytics import YOLO

V3_WORKSPACE = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\road_damage_v3"
CIVIC_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\civicmodel.pt"
CANDIDATE_V3_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\road_damage_model_v3.pt"
METRICS_JSON_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\road_damage_model_v3_metrics.json"
DATA_YAML_PATH = os.path.join(V3_WORKSPACE, "data.yaml")

def sha256_of_file(filepath: str) -> str:
    with open(filepath, "rb") as fp:
        return hashlib.sha256(fp.read()).hexdigest()

def run_v3_training():
    print("=" * 75)
    print("NAGARSETU 3.1 — ROAD DAMAGE MODEL V3 FINE-TUNING & EVALUATION")
    print("=" * 75)

    if not os.path.exists(CIVIC_MODEL_PATH):
        raise FileNotFoundError(f"Civicmodel not found at {CIVIC_MODEL_PATH}")

    civic_sha_before = sha256_of_file(CIVIC_MODEL_PATH)
    print(f"[VERIFIED] civicmodel.pt SHA-256 before training: {civic_sha_before}")

    print(f"\n[INIT] Loading baseline model: {CIVIC_MODEL_PATH}")
    model = YOLO(CIVIC_MODEL_PATH)
    print(f"Task: {model.task}, Classes: {model.names}")

    # Training execution
    print("\nStarting transfer learning fine-tuning with verified human ground truth...")
    start_time = time.time()

    train_results = model.train(
        data=DATA_YAML_PATH,
        epochs=30,
        patience=7,
        imgsz=640,
        batch=4,
        device="cpu",
        lr0=0.001,
        lrf=0.01,
        momentum=0.937,
        weight_decay=0.0005,
        warmup_epochs=1.0,
        hsv_h=0.015,
        hsv_s=0.3,
        hsv_v=0.3,
        degrees=5.0,
        translate=0.05,
        scale=0.1,
        shear=2.0,
        perspective=0.0001,
        flipud=0.0,
        fliplr=0.5,
        mosaic=0.0,
        mixup=0.0,
        project=os.path.join(V3_WORKSPACE, "runs"),
        name="candidate_v3",
        exist_ok=True,
        seed=42,
        deterministic=True,
        verbose=True
    )

    training_duration_sec = round(time.time() - start_time, 2)
    print(f"\n[OK] Training completed in {training_duration_sec}s ({training_duration_sec/60:.2f} min).")

    # Locate best trained weights
    runs_dir = os.path.join(V3_WORKSPACE, "runs", "candidate_v3", "weights")
    best_weights = os.path.join(runs_dir, "best.pt")
    last_weights = os.path.join(runs_dir, "last.pt")

    candidate_source = best_weights if os.path.exists(best_weights) else last_weights
    if not os.path.exists(candidate_source):
        raise FileNotFoundError(f"Neither best.pt nor last.pt found in {runs_dir}")

    # Save separately as road_damage_model_v3.pt
    shutil.copy2(candidate_source, CANDIDATE_V3_PATH)
    candidate_sha = sha256_of_file(CANDIDATE_V3_PATH)
    civic_sha_after = sha256_of_file(CIVIC_MODEL_PATH)

    print(f"[OK] Candidate saved separately to: {CANDIDATE_V3_PATH}")
    print(f"Candidate SHA-256: {candidate_sha}")
    print(f"Civicmodel SHA-256 after training: {civic_sha_after}")
    assert civic_sha_before == civic_sha_after, "FATAL: civicmodel.pt was modified!"

    # Evaluate both baseline and V3 on the exact same 9 held-out test images
    print("\n" + "=" * 75)
    print("INDEPENDENT HELD-OUT TEST EVALUATION (9 VERIFIED TEST IMAGES)")
    print("=" * 75)

    print("\nEvaluating original civicmodel.pt on held-out test split...")
    eval_model_orig = YOLO(CIVIC_MODEL_PATH)
    orig_val_results = eval_model_orig.val(
        data=DATA_YAML_PATH,
        split="test",
        imgsz=640,
        batch=4,
        device="cpu",
        verbose=False
    )

    orig_p = float(orig_val_results.results_dict.get("metrics/precision(B)", 0.0))
    orig_r = float(orig_val_results.results_dict.get("metrics/recall(B)", 0.0))
    orig_map50 = float(orig_val_results.results_dict.get("metrics/mAP50(B)", 0.0))
    orig_map50_95 = float(orig_val_results.results_dict.get("metrics/mAP50-95(B)", 0.0))

    print("\nEvaluating candidate road_damage_model_v3.pt on held-out test split...")
    eval_model_v3 = YOLO(CANDIDATE_V3_PATH)
    v3_val_results = eval_model_v3.val(
        data=DATA_YAML_PATH,
        split="test",
        imgsz=640,
        batch=4,
        device="cpu",
        verbose=False
    )

    v3_p = float(v3_val_results.results_dict.get("metrics/precision(B)", 0.0))
    v3_r = float(v3_val_results.results_dict.get("metrics/recall(B)", 0.0))
    v3_map50 = float(v3_val_results.results_dict.get("metrics/mAP50(B)", 0.0))
    v3_map50_95 = float(v3_val_results.results_dict.get("metrics/mAP50-95(B)", 0.0))

    # Detailed image-by-image test detection breakdown
    test_img_dir = os.path.join(V3_WORKSPACE, "images", "test")
    test_lbl_dir = os.path.join(V3_WORKSPACE, "labels", "test")
    test_files = sorted(os.listdir(test_img_dir))

    total_gt_boxes = 0
    orig_total_dets = 0
    v3_total_dets = 0
    orig_missed = 0
    v3_missed = 0

    per_image_results = []
    for tf in test_files:
        img_p = os.path.join(test_img_dir, tf)
        lbl_p = os.path.join(test_lbl_dir, os.path.splitext(tf)[0] + ".txt")

        gt_count = 0
        if os.path.exists(lbl_p):
            with open(lbl_p, "r") as lf:
                gt_count = len([line for line in lf.read().strip().split("\n") if line.strip()])
        total_gt_boxes += gt_count

        res_orig = eval_model_orig(img_p, conf=0.45, verbose=False)[0]
        res_v3 = eval_model_v3(img_p, conf=0.45, verbose=False)[0]

        n_orig = len(res_orig.boxes)
        n_v3 = len(res_v3.boxes)

        orig_total_dets += n_orig
        v3_total_dets += n_v3

        missed_orig = max(0, gt_count - n_orig)
        missed_v3 = max(0, gt_count - n_v3)
        orig_missed += missed_orig
        v3_missed += missed_v3

        per_image_results.append({
            "image": tf,
            "ground_truth_potholes": gt_count,
            "civicmodel_detections": n_orig,
            "v3_detections": n_v3,
            "civicmodel_confidences": [round(float(c), 3) for c in res_orig.boxes.conf.tolist()],
            "v3_confidences": [round(float(c), 3) for c in res_v3.boxes.conf.tolist()]
        })

    # False detections and missed potholes estimation at operational threshold 0.45
    orig_false_dets = max(0, orig_total_dets - (total_gt_boxes - orig_missed))
    v3_false_dets = max(0, v3_total_dets - (total_gt_boxes - v3_missed))

    metrics_payload = {
        "model_metadata": {
            "version": "v3",
            "base_checkpoint": "civicmodel.pt",
            "candidate_path": CANDIDATE_V3_PATH,
            "candidate_sha256": candidate_sha,
            "original_civicmodel_path": CIVIC_MODEL_PATH,
            "original_civicmodel_sha256": civic_sha_before,
            "original_preserved": (civic_sha_before == civic_sha_after)
        },
        "dataset_summary": {
            "train_images": 39,
            "val_images": 8,
            "held_out_test_images": 9,
            "total_approved_boxes": 487,
            "excluded_unannotated_images": 3
        },
        "training_execution": {
            "epochs_target": 30,
            "patience": 7,
            "imgsz": 640,
            "batch_size": 4,
            "device": "cpu",
            "duration_seconds": training_duration_sec
        },
        "held_out_evaluation_metrics": {
            "original_civicmodel": {
                "precision": round(orig_p, 4),
                "recall": round(orig_r, 4),
                "mAP50": round(orig_map50, 4),
                "mAP50_95": round(orig_map50_95, 4),
                "total_detections_at_045": orig_total_dets,
                "missed_potholes_estimate": orig_missed,
                "false_detections_estimate": orig_false_dets
            },
            "candidate_v3": {
                "precision": round(v3_p, 4),
                "recall": round(v3_r, 4),
                "mAP50": round(v3_map50, 4),
                "mAP50_95": round(v3_map50_95, 4),
                "total_detections_at_045": v3_total_dets,
                "missed_potholes_estimate": v3_missed,
                "false_detections_estimate": v3_false_dets
            }
        },
        "per_image_results": per_image_results
    }

    with open(METRICS_JSON_PATH, "w", encoding="utf-8") as mfp:
        json.dump(metrics_payload, mfp, indent=2)

    print(f"\n[OK] Metrics report saved to: {METRICS_JSON_PATH}")
    print("\n--- COMPARISON RESULTS ---")
    print(f"Original civicmodel: Precision={orig_p:.4f}, Recall={orig_r:.4f}, mAP50={orig_map50:.4f}, mAP50-95={orig_map50_95:.4f}")
    print(f"Candidate V3:        Precision={v3_p:.4f}, Recall={v3_r:.4f}, mAP50={v3_map50:.4f}, mAP50-95={v3_map50_95:.4f}")

    return metrics_payload

if __name__ == "__main__":
    run_v3_training()
