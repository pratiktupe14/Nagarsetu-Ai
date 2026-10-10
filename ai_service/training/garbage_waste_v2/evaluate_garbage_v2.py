import os
import sys
import json
import torch
from ultralytics import YOLO

WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\garbage_waste_v2"
DATA_YAML = os.path.join(WORKSPACE_DIR, "data.yaml")
ORIGINAL_MODEL = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\best.pt"
V2_MODEL = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\garbage_waste_model_v2.pt"

def evaluate_models(split="val"):
    print("=" * 60)
    print(f"EVALUATING ORIGINAL VS V2 ON {split.upper()} SPLIT")
    print("=" * 60)

    device = "0" if torch.cuda.is_available() else "cpu"

    m_orig = YOLO(ORIGINAL_MODEL)
    orig_res = m_orig.val(data=DATA_YAML, split=split, imgsz=640, device=device)

    print("\n--- Original Model (best.pt) ---")
    orig_p = float(orig_res.results_dict.get("metrics/precision(B)", 0.0))
    orig_r = float(orig_res.results_dict.get("metrics/recall(B)", 0.0))
    orig_map50 = float(orig_res.results_dict.get("metrics/mAP50(B)", 0.0))
    orig_map50_95 = float(orig_res.results_dict.get("metrics/mAP50-95(B)", 0.0))
    print(f"Precision: {orig_p:.4f}, Recall: {orig_r:.4f}, mAP50: {orig_map50:.4f}, mAP50-95: {orig_map50_95:.4f}")

    if not os.path.exists(V2_MODEL):
        print(f"\nV2 model not found at {V2_MODEL} yet.")
        return

    m_v2 = YOLO(V2_MODEL)
    v2_res = m_v2.val(data=DATA_YAML, split=split, imgsz=640, device=device)

    print("\n--- Candidate V2 Model (garbage_waste_model_v2.pt) ---")
    v2_p = float(v2_res.results_dict.get("metrics/precision(B)", 0.0))
    v2_r = float(v2_res.results_dict.get("metrics/recall(B)", 0.0))
    v2_map50 = float(v2_res.results_dict.get("metrics/mAP50(B)", 0.0))
    v2_map50_95 = float(v2_res.results_dict.get("metrics/mAP50-95(B)", 0.0))
    print(f"Precision: {v2_p:.4f}, Recall: {v2_r:.4f}, mAP50: {v2_map50:.4f}, mAP50-95: {v2_map50_95:.4f}")

if __name__ == "__main__":
    split = "test" if len(sys.argv) < 2 else sys.argv[1]
    evaluate_models(split)
