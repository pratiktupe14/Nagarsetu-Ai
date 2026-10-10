import os
import sys
import time
import json
import shutil
import torch
from ultralytics import YOLO

ORIGINAL_MODEL = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\best.pt"
NEW_MODEL = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\garbage_waste_model_v2.pt"
METRICS_OUTPUT = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\garbage_waste_model_v2_metrics.json"
DATA_YAML = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\garbage_waste_v2\data.yaml"
WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\garbage_waste_v2"

def train():
    print("=" * 60)
    print("NAGARSETU 3.1 — GARBAGE AI V2 RETRAINING")
    print("=" * 60)

    # 1. Check original model
    if not os.path.exists(ORIGINAL_MODEL):
        raise FileNotFoundError(f"Original model not found: {ORIGINAL_MODEL}")

    orig_size = os.path.getsize(ORIGINAL_MODEL)
    print(f"[OK] Original model intact: {ORIGINAL_MODEL} ({orig_size} bytes)")

    device = "0" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device} (CUDA available: {torch.cuda.is_available()})")

    # 2. Load baseline model
    model = YOLO(ORIGINAL_MODEL)

    start_time = time.time()

    # 3. Controlled YOLOv8 transfer learning fine-tuning
    print("Starting fine-tuning...")
    results = model.train(
        data=DATA_YAML,
        epochs=30,
        patience=7,
        imgsz=640,
        batch=4,
        device=device,
        project=os.path.join(WORKSPACE_DIR, "runs"),
        name="garbage_waste_v2_run",
        exist_ok=True,
        # Realistic mild augmentation
        hsv_h=0.015,
        hsv_s=0.5,
        hsv_v=0.4,
        degrees=10.0,
        translate=0.1,
        scale=0.2,
        shear=2.0,
        perspective=0.0,
        flipud=0.0,
        fliplr=0.5,
        mosaic=0.5,
        mixup=0.0,
        copy_paste=0.0,
        workers=2,
        plots=False,
        save=True,
        verbose=True
    )

    duration = time.time() - start_time
    print(f"Training completed in {duration:.1f}s")

    # 4. Save model candidate
    best_trained_pt = os.path.join(WORKSPACE_DIR, "runs", "garbage_waste_v2_run", "weights", "best.pt")
    if os.path.exists(best_trained_pt):
        shutil.copy2(best_trained_pt, NEW_MODEL)
        print(f"[OK] Saved candidate model to: {NEW_MODEL}")
    else:
        # Fallback to last.pt
        last_pt = os.path.join(WORKSPACE_DIR, "runs", "garbage_waste_v2_run", "weights", "last.pt")
        shutil.copy2(last_pt, NEW_MODEL)
        print(f"[OK] Saved fallback candidate model to: {NEW_MODEL}")

    # 5. Evaluate on validation set
    val_results = model.val(data=DATA_YAML, split="val", imgsz=640, batch=4, device=device)

    metrics = {
        "timestamp": time.time(),
        "training_duration_seconds": round(duration, 2),
        "device": device,
        "epochs_trained": getattr(results, "epoch", 30),
        "precision": float(val_results.results_dict.get("metrics/precision(B)", 0.0)),
        "recall": float(val_results.results_dict.get("metrics/recall(B)", 0.0)),
        "mAP50": float(val_results.results_dict.get("metrics/mAP50(B)", 0.0)),
        "mAP50_95": float(val_results.results_dict.get("metrics/mAP50-95(B)", 0.0)),
        "original_model_path": ORIGINAL_MODEL,
        "v2_model_path": NEW_MODEL
    }

    with open(METRICS_OUTPUT, "w", encoding="utf-8") as mf:
        json.dump(metrics, mf, indent=2)

    print(f"[OK] Metrics saved to: {METRICS_OUTPUT}")
    print(f"  Precision: {metrics['precision']:.4f}")
    print(f"  Recall:    {metrics['recall']:.4f}")
    print(f"  mAP50:     {metrics['mAP50']:.4f}")
    print(f"  mAP50-95:  {metrics['mAP50_95']:.4f}")

if __name__ == "__main__":
    train()
