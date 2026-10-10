import os
import sys
import json
import numpy as np
from PIL import Image
import torch
import torchvision.transforms as T
from torch.utils.data import DataLoader

sys.path.append(r"d:\NAGARSETU\NAGARSETU 3.1")
from ai_service.train_pipe_model import WaterPipeClassifier as BaselineClassifier
from ai_service.training.water_pipe_v2.train_water_pipe_v2 import (
    WaterPipeClassifier as CandidateClassifier,
    WaterPipeDataset,
    collect_dataset,
    create_group_stratified_split,
    compute_metrics,
    BASELINE_MODEL_PATH,
    CANDIDATE_MODEL_PATH,
    METRICS_PATH
)

def run_evaluation():
    print("=" * 70)
    print("NAGARSETU 3.1 — RIGOROUS MODEL EVALUATION & HEAD-TO-HEAD BENCHMARK")
    print("=" * 70)

    eval_transform = T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    # 1. Load Data
    samples, stats = collect_dataset()
    train_data, val_data, test_data = create_group_stratified_split(samples, seed=42)
    print(f"Dataset summary: Total={len(samples)} (Normal={stats['normal_pipe_count']}, Damaged={stats['damaged_or_leaking_pipe_count']})")
    print(f"Held-out test set size: {len(test_data)} ({sum(1 for s in test_data if s['label']==0)} Normal, {sum(1 for s in test_data if s['label']==1)} Damaged)")

    test_tuples = [(s["path"], s["label"], s["group"]) for s in test_data]
    test_loader = DataLoader(WaterPipeDataset(test_tuples, eval_transform), batch_size=4, shuffle=False)

    all_tuples = [(s["path"], s["label"], s["group"]) for s in samples]
    full_loader = DataLoader(WaterPipeDataset(all_tuples, eval_transform), batch_size=4, shuffle=False)

    # 2. Load Models
    print(f"\nLoading Baseline: {BASELINE_MODEL_PATH}")
    base_ckpt = torch.load(BASELINE_MODEL_PATH, map_location="cpu")
    baseline_model = BaselineClassifier(num_classes=base_ckpt.get("num_classes", 3))
    baseline_model.load_state_dict(base_ckpt["model_state_dict"])
    baseline_model.eval()

    print(f"Loading Candidate V2: {CANDIDATE_MODEL_PATH}")
    cand_ckpt = torch.load(CANDIDATE_MODEL_PATH, map_location="cpu")
    candidate_model = CandidateClassifier(num_classes=cand_ckpt.get("num_classes", 2))
    candidate_model.load_state_dict(cand_ckpt["model_state_dict"])
    candidate_model.eval()

    # 3. Evaluate Baseline on Held-out Test Set
    base_test_preds, base_test_labels, base_test_probs, base_test_paths = [], [], [], []
    with torch.no_grad():
        for imgs, labels, paths in test_loader:
            outputs = baseline_model(imgs)
            probs = torch.softmax(outputs, dim=1)
            # Baseline is 3-class (0: perfect, 1: leakage, 2: broken)
            # Map to binary (0: normal, 1: damaged/leaking)
            pred_binary = (torch.argmax(probs, dim=1) > 0).long()
            base_test_preds.extend(pred_binary.cpu().numpy())
            base_test_labels.extend(labels.cpu().numpy())
            base_test_probs.extend(probs.cpu().numpy())
            base_test_paths.extend(paths)

    base_test_metrics = compute_metrics(np.array(base_test_labels), np.array(base_test_preds), np.array(base_test_probs))

    # 4. Evaluate Candidate on Held-out Test Set
    cand_test_preds, cand_test_labels, cand_test_probs, cand_test_paths = [], [], [], []
    with torch.no_grad():
        for imgs, labels, paths in test_loader:
            outputs = candidate_model(imgs)
            probs = torch.softmax(outputs, dim=1)
            preds = torch.argmax(probs, dim=1)
            cand_test_preds.extend(preds.cpu().numpy())
            cand_test_labels.extend(labels.cpu().numpy())
            cand_test_probs.extend(probs.cpu().numpy())
            cand_test_paths.extend(paths)

    cand_test_metrics = compute_metrics(np.array(cand_test_labels), np.array(cand_test_preds), np.array(cand_test_probs))

    # Print Comparative Results on Held-out Test Set
    print("\n" + "=" * 70)
    print("PART A: HELD-OUT TEST SPLIT COMPARISON (N=15 Unseen Images)")
    print("=" * 70)
    print(f"{'Metric':32s} | {'Baseline (Original)':20s} | {'Candidate (V2)':20s}")
    print("-" * 70)
    print(f"{'Overall Accuracy':32s} | {base_test_metrics['accuracy']:19.1%} | {cand_test_metrics['accuracy']:19.1%}")
    print(f"{'Overall Macro F1':32s} | {base_test_metrics['macro_f1']:19.4f} | {cand_test_metrics['macro_f1']:19.4f}")
    print(f"{'Damaged Pipe Recall (Detection)':32s} | {base_test_metrics['damaged_or_leaking_pipe']['recall']:19.1%} | {cand_test_metrics['damaged_or_leaking_pipe']['recall']:19.1%}")
    print(f"{'Damaged Pipe Precision':32s} | {base_test_metrics['damaged_or_leaking_pipe']['precision']:19.1%} | {cand_test_metrics['damaged_or_leaking_pipe']['precision']:19.1%}")
    print(f"{'Normal Pipe Recall':32s} | {base_test_metrics['normal_pipe']['recall']:19.1%} | {cand_test_metrics['normal_pipe']['recall']:19.1%}")
    print(f"{'Normal Pipe Precision':32s} | {base_test_metrics['normal_pipe']['precision']:19.1%} | {cand_test_metrics['normal_pipe']['precision']:19.1%}")
    print(f"{'False Negatives (Missed Leaks)':32s} | {base_test_metrics['confusion_matrix']['FN_leak_called_normal']:19d} | {cand_test_metrics['confusion_matrix']['FN_leak_called_normal']:19d}")
    print(f"{'False Positives (Normal as Leak)':32s} | {base_test_metrics['confusion_matrix']['FP_normal_called_leak']:19d} | {cand_test_metrics['confusion_matrix']['FP_normal_called_leak']:19d}")

    # 5. Full Dataset Evaluation (All 89 Images)
    base_full_preds, base_full_labels = [], []
    with torch.no_grad():
        for imgs, labels, _ in full_loader:
            outputs = baseline_model(imgs)
            probs = torch.softmax(outputs, dim=1)
            pred_binary = (torch.argmax(probs, dim=1) > 0).long()
            base_full_preds.extend(pred_binary.cpu().numpy())
            base_full_labels.extend(labels.cpu().numpy())

    base_full_metrics = compute_metrics(np.array(base_full_labels), np.array(base_full_preds), np.array([]))

    cand_full_preds, cand_full_labels = [], []
    with torch.no_grad():
        for imgs, labels, _ in full_loader:
            outputs = candidate_model(imgs)
            probs = torch.softmax(outputs, dim=1)
            preds = torch.argmax(probs, dim=1)
            cand_full_preds.extend(preds.cpu().numpy())
            cand_full_labels.extend(labels.cpu().numpy())

    cand_full_metrics = compute_metrics(np.array(cand_full_labels), np.array(cand_full_preds), np.array([]))

    print("\n" + "=" * 70)
    print("PART B: FULL DATASET COMPREHENSIVE BENCHMARK (All 89 Images)")
    print("=" * 70)
    print(f"{'Metric':32s} | {'Baseline (Original)':20s} | {'Candidate (V2)':20s}")
    print("-" * 70)
    print(f"{'Overall Accuracy':32s} | {base_full_metrics['accuracy']:19.1%} | {cand_full_metrics['accuracy']:19.1%}")
    print(f"{'Overall Macro F1':32s} | {base_full_metrics['macro_f1']:19.4f} | {cand_full_metrics['macro_f1']:19.4f}")
    print(f"{'Damaged Pipe Recall':32s} | {base_full_metrics['damaged_or_leaking_pipe']['recall']:19.1%} | {cand_full_metrics['damaged_or_leaking_pipe']['recall']:19.1%}")
    print(f"{'Damaged Pipe Precision':32s} | {base_full_metrics['damaged_or_leaking_pipe']['precision']:19.1%} | {cand_full_metrics['damaged_or_leaking_pipe']['precision']:19.1%}")
    print(f"{'Normal Pipe Recall':32s} | {base_full_metrics['normal_pipe']['recall']:19.1%} | {cand_full_metrics['normal_pipe']['recall']:19.1%}")
    print(f"{'Normal Pipe Precision':32s} | {base_full_metrics['normal_pipe']['precision']:19.1%} | {cand_full_metrics['normal_pipe']['precision']:19.1%}")
    print(f"{'Total Missed Leaks (FN)':32s} | {base_full_metrics['confusion_matrix']['FN_leak_called_normal']:19d} | {cand_full_metrics['confusion_matrix']['FN_leak_called_normal']:19d}")
    print(f"{'Total False Alarms (FP)':32s} | {base_full_metrics['confusion_matrix']['FP_normal_called_leak']:19d} | {cand_full_metrics['confusion_matrix']['FP_normal_called_leak']:19d}")

    # Update metadata with comparative metrics
    if os.path.exists(METRICS_PATH):
        with open(METRICS_PATH, "r", encoding="utf-8") as fp:
            data = json.load(fp)
        data["baseline_test_comparison"] = base_test_metrics
        data["baseline_full_comparison"] = base_full_metrics
        data["improvements"] = {
            "test_accuracy_diff": f"{cand_test_metrics['accuracy'] - base_test_metrics['accuracy']:+.2%}",
            "test_f1_diff": f"{cand_test_metrics['macro_f1'] - base_test_metrics['macro_f1']:+.4f}",
            "full_accuracy_diff": f"{cand_full_metrics['accuracy'] - base_full_metrics['accuracy']:+.2%}",
            "full_f1_diff": f"{cand_full_metrics['macro_f1'] - base_full_metrics['macro_f1']:+.4f}",
            "full_false_negatives_reduced": f"{base_full_metrics['confusion_matrix']['FN_leak_called_normal'] - cand_full_metrics['confusion_matrix']['FN_leak_called_normal']} fewer missed leaking pipes"
        }
        with open(METRICS_PATH, "w", encoding="utf-8") as fp:
            json.dump(data, fp, indent=2)
        print(f"\n[OK] Updated comparative metrics in {METRICS_PATH}")

    # Also update candidate checkpoint
    cand_ckpt["metrics"]["baseline_test_comparison"] = base_test_metrics
    cand_ckpt["metrics"]["baseline_full_comparison"] = base_full_metrics
    torch.save(cand_ckpt, CANDIDATE_MODEL_PATH)
    print(f"[OK] Updated comparative metrics in candidate checkpoint {CANDIDATE_MODEL_PATH}")

if __name__ == "__main__":
    run_evaluation()
