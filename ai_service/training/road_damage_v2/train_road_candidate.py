import os
import sys
import time
import json
import shutil
import hashlib
from pathlib import Path
import torch
from ultralytics import YOLO

WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\road_damage_v2"
CIVIC_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\civicmodel.pt"
CANDIDATE_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\road_damage_model_v2.pt"
METRICS_JSON_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\road_damage_model_v2_metrics.json"
DATA_YAML_PATH = os.path.join(WORKSPACE_DIR, "data.yaml")

def sha256_of_file(filepath: str) -> str:
    with open(filepath, "rb") as fp:
        return hashlib.sha256(fp.read()).hexdigest()

def run_candidate_training():
    print("=" * 75)
    print("NAGARSETU 3.1 — ROAD DAMAGE MODEL TRANSFER LEARNING & EVALUATION")
    print("=" * 75)

    # 1. Verify civicmodel.pt exists and record pre-training hash
    if not os.path.exists(CIVIC_MODEL_PATH):
        raise FileNotFoundError(f"Civicmodel not found at {CIVIC_MODEL_PATH}")
    
    civic_sha_before = sha256_of_file(CIVIC_MODEL_PATH)
    print(f"Verified civicmodel.pt SHA-256 before training: {civic_sha_before}")

    # 2. Initialize YOLOv8 transfer learning with civicmodel.pt
    print(f"\nInitializing YOLO with existing weights: {CIVIC_MODEL_PATH}")
    model = YOLO(CIVIC_MODEL_PATH)

    print("Architecture verified:")
    print(f"  Task: {model.task}")
    print(f"  Classes: {model.names}")
    total_params = sum(p.numel() for p in model.model.parameters())
    print(f"  Total parameters: {total_params:,}")

    # 3. Training execution with conservative hyperparameters and safe augmentation
    print("\nStarting transfer learning fine-tuning on CPU...")
    start_time = time.time()
    
    train_results = model.train(
        data=DATA_YAML_PATH,
        epochs=5,
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
        mosaic=0.0,    # Avoid destroying small potholes
        mixup=0.0,
        project=os.path.join(WORKSPACE_DIR, "runs"),
        name="candidate_v2",
        exist_ok=True,
        seed=42,
        deterministic=True,
        verbose=True
    )
    
    elapsed_training_sec = round(time.time() - start_time, 2)
    print(f"\nTraining completed in {elapsed_training_sec}s ({elapsed_training_sec/60:.2f} min).")

    # 4. Locate best trained checkpoint
    runs_dir = os.path.join(WORKSPACE_DIR, "runs", "candidate_v2", "weights")
    best_weights = os.path.join(runs_dir, "best.pt")
    last_weights = os.path.join(runs_dir, "last.pt")
    
    candidate_source = best_weights if os.path.exists(best_weights) else last_weights
    if not os.path.exists(candidate_source):
        raise FileNotFoundError(f"Neither best.pt nor last.pt found in {runs_dir}")

    print(f"Candidate source weights located at: {candidate_source}")

    # 5. Save candidate checkpoint separately without touching civicmodel.pt
    shutil.copy2(candidate_source, CANDIDATE_MODEL_PATH)
    candidate_sha = sha256_of_file(CANDIDATE_MODEL_PATH)
    civic_sha_after = sha256_of_file(CIVIC_MODEL_PATH)

    print(f"\nCandidate saved separately to: {CANDIDATE_MODEL_PATH}")
    print(f"Candidate SHA-256: {candidate_sha}")
    print(f"Civicmodel SHA-256 after training: {civic_sha_after}")
    assert civic_sha_before == civic_sha_after, "FATAL: civicmodel.pt was modified!"
    print("[PASS] civicmodel.pt strictly preserved unchanged.")

    # 6. Independent Evaluation on Held-Out Test Set for BOTH models
    print("\n--- INDEPENDENT EVALUATION ON FROZEN HELD-OUT TEST SPLIT (9 IMAGES) ---")

    print("\nEvaluating existing model (civicmodel.pt)...")
    t0 = time.time()
    existing_model = YOLO(CIVIC_MODEL_PATH)
    existing_val = existing_model.val(data=DATA_YAML_PATH, split="test", imgsz=640, device="cpu", verbose=False)
    existing_lat = (time.time() - t0) / 9.0 * 1000.0  # ms per image

    print("\nEvaluating candidate model (road_damage_model_v2.pt)...")
    t0 = time.time()
    new_model = YOLO(CANDIDATE_MODEL_PATH)
    new_val = new_model.val(data=DATA_YAML_PATH, split="test", imgsz=640, device="cpu", verbose=False)
    new_lat = (time.time() - t0) / 9.0 * 1000.0  # ms per image

    # Extract metrics
    # Existing
    ex_p = float(existing_val.results_dict.get("metrics/precision(B)", 0.0))
    ex_r = float(existing_val.results_dict.get("metrics/recall(B)", 0.0))
    ex_map50 = float(existing_val.results_dict.get("metrics/mAP50(B)", 0.0))
    ex_map50_95 = float(existing_val.results_dict.get("metrics/mAP50-95(B)", 0.0))

    # Candidate
    new_p = float(new_val.results_dict.get("metrics/precision(B)", 0.0))
    new_r = float(new_val.results_dict.get("metrics/recall(B)", 0.0))
    new_map50 = float(new_val.results_dict.get("metrics/mAP50(B)", 0.0))
    new_map50_95 = float(new_val.results_dict.get("metrics/mAP50-95(B)", 0.0))

    print("\nEvaluation Comparison Summary:")
    print(f"  Existing Model (civicmodel.pt):")
    print(f"    Precision:    {ex_p:.4f}")
    print(f"    Recall:       {ex_r:.4f}")
    print(f"    mAP@0.50:     {ex_map50:.4f}")
    print(f"    mAP@0.50:0.95:{ex_map50_95:.4f}")
    print(f"    Latency:      {existing_lat:.1f} ms/image")

    print(f"  Candidate Model (road_damage_model_v2.pt):")
    print(f"    Precision:    {new_p:.4f}")
    print(f"    Recall:       {new_r:.4f}")
    print(f"    mAP@0.50:     {new_map50:.4f}")
    print(f"    mAP@0.50:0.95:{new_map50_95:.4f}")
    print(f"    Latency:      {new_lat:.1f} ms/image")

    # 7. Per-image qualitative inspection on test split
    test_img_dir = os.path.join(WORKSPACE_DIR, "images", "test")
    test_lbl_dir = os.path.join(WORKSPACE_DIR, "labels", "test")
    test_images = sorted(os.listdir(test_img_dir))
    
    qualitative_results = []
    print("\nQualitative test sample detections:")
    for im_name in test_images:
        im_path = os.path.join(test_img_dir, im_name)
        res_ex = existing_model(im_path, conf=0.25, verbose=False)[0]
        res_new = new_model(im_path, conf=0.25, verbose=False)[0]
        
        lbl_path = os.path.join(test_lbl_dir, os.path.splitext(im_name)[0] + ".txt")
        gt_boxes = 0
        if os.path.exists(lbl_path):
            with open(lbl_path) as fp:
                gt_boxes = len([l for l in fp if l.strip()])

        item_res = {
            "image": im_name,
            "provisional_gt_boxes": gt_boxes,
            "existing_detections": len(res_ex.boxes),
            "candidate_detections": len(res_new.boxes),
            "existing_confidences": [round(float(b.conf[0]), 3) for b in res_ex.boxes],
            "candidate_confidences": [round(float(b.conf[0]), 3) for b in res_new.boxes]
        }
        qualitative_results.append(item_res)
        print(f"  {im_name}: GT(prov)={gt_boxes} | Existing={len(res_ex.boxes)} | Candidate={len(res_new.boxes)}")

    # 8. Compile and save road_damage_model_v2_metrics.json
    metrics_data = {
        "architecture": {
            "model_type": "YOLOv8s",
            "task": "detect",
            "parameters": total_params,
            "input_resolution": [640, 640],
            "classes": {0: "Pothole"}
        },
        "dataset": {
            "dataset_source": r"D:\NAGARSETU\road",
            "total_images": 59,
            "train_images": 41,
            "val_images": 9,
            "held_out_test_images": 9,
            "annotated_ground_truth": 0,
            "provisional_annotated_images": 56,
            "zero_detection_hard_examples": 3,
            "exact_duplicates_handled": 1,
            "leakage_prevention": "Session & sequence group-based isolation"
        },
        "training_configuration": {
            "base_checkpoint": "civicmodel.pt",
            "epochs": 5,
            "batch_size": 4,
            "device": "cpu",
            "optimizer": "auto",
            "learning_rate_initial": 0.001,
            "learning_rate_final": 0.01,
            "image_size": 640,
            "augmentations": {
                "hsv_h": 0.015,
                "hsv_s": 0.3,
                "hsv_v": 0.3,
                "degrees": 5.0,
                "translate": 0.05,
                "scale": 0.1,
                "fliplr": 0.5,
                "mosaic": 0.0
            },
            "training_time_seconds": elapsed_training_sec
        },
        "evaluation_metrics": {
            "test_split_size": 9,
            "existing_model_civicmodel": {
                "precision": round(ex_p, 4),
                "recall": round(ex_r, 4),
                "mAP50": round(ex_map50, 4),
                "mAP50_95": round(ex_map50_95, 4),
                "inference_latency_ms_per_image": round(existing_lat, 1)
            },
            "candidate_model_v2": {
                "precision": round(new_p, 4),
                "recall": round(new_r, 4),
                "mAP50": round(new_map50, 4),
                "mAP50_95": round(new_map50_95, 4),
                "inference_latency_ms_per_image": round(new_lat, 1)
            }
        },
        "qualitative_test_samples": qualitative_results,
        "recommended_thresholds": {
            "detection_minimum": 0.25,
            "standard_reporting": 0.45,
            "high_confidence_auto_assign": 0.75
        },
        "checkpoint_integrity": {
            "candidate_path": CANDIDATE_MODEL_PATH,
            "candidate_sha256": candidate_sha,
            "existing_civicmodel_path": CIVIC_MODEL_PATH,
            "existing_civicmodel_sha256": civic_sha_after,
            "civicmodel_preserved": True
        },
        "scientific_limitations_and_status": {
            "status": "ANNOTATION REQUIRED",
            "rationale": "Source dataset D:\\NAGARSETU\\road contains 0 ground-truth bounding box files. While candidate weights road_damage_model_v2.pt were successfully trained and evaluated against provisional pseudo-labels without data leakage, pseudo-label fine-tuning without human verification cannot be certified as an objective improvement.",
            "known_limitations": [
                "Dataset contains zero human-annotated defect bounding boxes.",
                "Small dataset sample size (59 total images, 9 held-out test images) carries high statistical uncertainty.",
                "Candidate model trained on machine pseudo-labels may reinforce existing detector blind spots on challenging textures (wet roads, irregular asphalt patches, fine cracks).",
                "Healthy negative road examples are minimal in the dataset."
            ]
        }
    }

    with open(METRICS_JSON_PATH, "w", encoding="utf-8") as mfp:
        json.dump(metrics_data, mfp, indent=2)
    print(f"\n[OK] Metrics and metadata saved to: {METRICS_JSON_PATH}")

    return metrics_data

if __name__ == "__main__":
    run_candidate_training()
