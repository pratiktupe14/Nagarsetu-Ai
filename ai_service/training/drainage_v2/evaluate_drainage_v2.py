import os
import sys
import time
import json
import numpy as np
from PIL import Image
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import torchvision.transforms as T
import torchvision.models as models

WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\drainage_v2"
SPLITS_PATH = os.path.join(WORKSPACE_DIR, "frozen_splits.json")
CATALOG_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\data\drainage_catalog.json"
ORIGINAL_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\drainage_model.pt"
NEW_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\drainage_model_v2.pt"
METRICS_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\drainage_model_v2_metrics.json"

CLASS_MAP = {"normal_drain": 0, "blocked_drain": 1, "damaged_drain": 2}
REV_MAP = {0: "normal_drain", 1: "blocked_drain", 2: "damaged_drain"}

class DrainageClassifier(nn.Module):
    def __init__(self, num_classes=3):
        super().__init__()
        self.backbone = models.mobilenet_v3_small(weights=None)
        in_features = self.backbone.classifier[3].in_features
        self.backbone.classifier[3] = nn.Linear(in_features, num_classes)

    def forward(self, x):
        return self.backbone(x)

def load_eval_model(model_path):
    checkpoint = torch.load(model_path, map_location="cpu")
    model = DrainageClassifier(num_classes=3)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    return model

def run_evaluation():
    print("=" * 60)
    print("NAGARSETU 3.1 — DRAINAGE MODEL HELD-OUT EVALUATION")
    print("=" * 60)

    if not os.path.exists(SPLITS_PATH):
        print(f"Error: Frozen test splits not found at {SPLITS_PATH}")
        return

    with open(SPLITS_PATH, "r") as sf:
        splits = json.load(sf)
    test_files = splits["test"]

    reviewed_json = os.path.join(WORKSPACE_DIR, "drainage_annotations_reviewed.json")
    with open(reviewed_json, "r", encoding="utf-8") as rf:
        rev_data = json.load(rf)["images"]
    label_map = {item["filename"]: item for item in rev_data}

    test_samples = []
    for fp in test_files:
        fname = os.path.basename(fp)
        item = label_map.get(fname, {})
        lbl_str = item.get("assigned_label", "damaged_drain")
        lbl_idx = CLASS_MAP.get(lbl_str, 2)
        is_overflow = bool(item.get("is_overflow", False))
        test_samples.append((fp, lbl_idx, is_overflow))

    print(f"Held-out test set size: {len(test_samples)} images")
    print(f"  Normal:   {sum(1 for s in test_samples if s[1] == 0)}")
    print(f"  Blocked:  {sum(1 for s in test_samples if s[1] == 1)}")
    print(f"  Damaged:  {sum(1 for s in test_samples if s[1] == 2)}")

    eval_tf = T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    def evaluate_single_model(model, name):
        y_true = []
        y_pred = []
        latencies = []
        overflow_missed = 0
        overflow_total = 0

        with torch.no_grad():
            for fpath, label, is_overflow in test_samples:
                img = Image.open(fpath).convert("RGB")
                tensor = eval_tf(img).unsqueeze(0)

                t0 = time.time()
                out = model(tensor)
                lat = (time.time() - t0) * 1000
                latencies.append(lat)

                pred = torch.argmax(out, dim=1).item()
                y_true.append(label)
                y_pred.append(pred)

                if is_overflow:
                    overflow_total += 1
                    if pred != 1:  # blocked/overflow
                        overflow_missed += 1

        y_true = np.array(y_true)
        y_pred = np.array(y_pred)

        acc = float(np.mean(y_true == y_pred))

        # Confusion matrix (3x3)
        cm = np.zeros((3, 3), dtype=int)
        for t, p in zip(y_true, y_pred):
            cm[t, p] += 1

        precisions = []
        recalls = []
        f1s = []

        for c in range(3):
            tp = cm[c, c]
            fp = np.sum(cm[:, c]) - tp
            fn = np.sum(cm[c, :]) - tp

            prec = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
            rec = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
            f1 = float(2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0

            precisions.append(round(prec, 4))
            recalls.append(round(rec, 4))
            f1s.append(round(f1, 4))

        macro_f1 = float(np.mean(f1s))

        # Civic error analysis:
        # Missed broken drains: true label 2 (damaged) predicted as 0 (normal) or 1 (blocked)
        missed_broken = int(np.sum(cm[2, 0]) + np.sum(cm[2, 1]))
        # False alarms: true label 0 (normal) predicted as 1 or 2
        false_alarms = int(np.sum(cm[0, 1]) + np.sum(cm[0, 2]))

        avg_latency = float(np.mean(latencies))

        return {
            "name": name,
            "accuracy": round(acc, 4),
            "macro_f1": round(macro_f1, 4),
            "per_class": {
                "normal_drain": {"precision": precisions[0], "recall": recalls[0], "f1": f1s[0]},
                "blocked_drain": {"precision": precisions[1], "recall": recalls[1], "f1": f1s[1]},
                "damaged_drain": {"precision": precisions[2], "recall": recalls[2], "f1": f1s[2]}
            },
            "confusion_matrix": cm.tolist(),
            "missed_broken_drains": missed_broken,
            "missed_overflow_drains": overflow_missed,
            "false_alarms": false_alarms,
            "avg_cpu_latency_ms": round(avg_latency, 2)
        }

    # Evaluate Original Model
    orig_model = load_eval_model(ORIGINAL_MODEL_PATH)
    orig_res = evaluate_single_model(orig_model, "Original (drainage_model.pt)")

    # Evaluate V2 Model if exists
    v2_res = None
    if os.path.exists(NEW_MODEL_PATH):
        v2_model = load_eval_model(NEW_MODEL_PATH)
        v2_res = evaluate_single_model(v2_model, "V2 (drainage_model_v2.pt)")

    print("\n--- ORIGINAL MODEL (drainage_model.pt) ---")
    print(f"Accuracy:  {orig_res['accuracy'] * 100:.1f}%")
    print(f"Macro F1:  {orig_res['macro_f1']:.4f}")
    print(f"Per-Class:")
    for k, v in orig_res["per_class"].items():
        print(f"  {k}: Prec={v['precision']:.3f}, Rec={v['recall']:.3f}, F1={v['f1']:.3f}")
    print(f"Missed Broken: {orig_res['missed_broken_drains']}, False Alarms: {orig_res['false_alarms']}, CPU Latency: {orig_res['avg_cpu_latency_ms']} ms")

    if v2_res:
        print("\n--- V2 MODEL (drainage_model_v2.pt) ---")
        print(f"Accuracy:  {v2_res['accuracy'] * 100:.1f}%")
        print(f"Macro F1:  {v2_res['macro_f1']:.4f}")
        print(f"Per-Class:")
        for k, v in v2_res["per_class"].items():
            print(f"  {k}: Prec={v['precision']:.3f}, Rec={v['recall']:.3f}, F1={v['f1']:.3f}")
        print(f"Missed Broken: {v2_res['missed_broken_drains']}, False Alarms: {v2_res['false_alarms']}, CPU Latency: {v2_res['avg_cpu_latency_ms']} ms")

    # Save metrics
    metrics_data = {
        "timestamp": time.time(),
        "test_samples_count": len(test_samples),
        "original_model": orig_res,
        "v2_model": v2_res
    }
    with open(METRICS_PATH, "w", encoding="utf-8") as mf:
        json.dump(metrics_data, mf, indent=2)
    print(f"\n[OK] Metrics saved to {METRICS_PATH}")

if __name__ == "__main__":
    run_evaluation()
