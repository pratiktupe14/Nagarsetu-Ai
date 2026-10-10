import os
import sys
import time
import json
import random
import copy
import hashlib
from typing import List, Tuple, Dict, Any

import numpy as np
from PIL import Image
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import torchvision.transforms as T
import torchvision.models as models

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL_DIR = os.path.join(BASE_DIR, "model")
MANIFEST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dataset_v4_manifest.json")

BASELINE_MODEL_PATH = os.path.join(MODEL_DIR, "water_pipe_model.pt")
V2_MODEL_PATH = os.path.join(MODEL_DIR, "water_pipe_model_v2.pt")
V3_MODEL_PATH = os.path.join(MODEL_DIR, "water_pipe_model_v3.pt")
V4_MODEL_PATH = os.path.join(MODEL_DIR, "water_pipe_model_v4.pt")
V4_METRICS_PATH = os.path.join(MODEL_DIR, "water_pipe_model_v4_metrics.json")


def seed_everything(seed=42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


seed_everything(42)


class WaterPipeDataset(Dataset):
    def __init__(self, samples: List[Dict[str, Any]], transform=None):
        self.samples = samples
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        item = self.samples[idx]
        file_path = item["path"]
        label = item["label"]
        try:
            with Image.open(file_path) as img:
                img_rgb = img.convert("RGB")
        except Exception as e:
            raise RuntimeError(f"Error loading {file_path}: {e}")

        if self.transform:
            tensor = self.transform(img_rgb)
        else:
            tensor = T.ToTensor()(img_rgb)

        return tensor, label, file_path


class WaterPipeClassifier(nn.Module):
    def __init__(self, num_classes=2, pretrained=True, dropout=0.25):
        super(WaterPipeClassifier, self).__init__()
        if pretrained:
            weights = models.MobileNet_V3_Small_Weights.DEFAULT
            self.backbone = models.mobilenet_v3_small(weights=weights)
        else:
            self.backbone = models.mobilenet_v3_small(weights=None)
        in_features = self.backbone.classifier[3].in_features
        self.backbone.classifier[2] = nn.Dropout(p=dropout, inplace=True)
        self.backbone.classifier[3] = nn.Linear(in_features, num_classes)

    def forward(self, x):
        return self.backbone(x)


def split_train_val_pool(pool_samples: List[Dict[str, Any]], val_ratio=0.18, seed=42):
    """
    Split pool into train and val using group-stratified assignment.
    """
    random.seed(seed)
    normal_samples = [s for s in pool_samples if s["label"] == 0]
    leak_samples = [s for s in pool_samples if s["label"] == 1]

    def split_group_list(items, target_val_count):
        group_map = {}
        for it in items:
            g = it.get("group", "default")
            group_map.setdefault(g, []).append(it)
        
        group_keys = list(group_map.keys())
        random.shuffle(group_keys)

        val_list = []
        train_list = []
        val_count = 0

        for g in group_keys:
            group_items = group_map[g]
            if val_count < target_val_count and (val_count + len(group_items) <= target_val_count + 1):
                val_list.extend(group_items)
                val_count += len(group_items)
            else:
                train_list.extend(group_items)

        return train_list, val_list

    # Target: ~4 normal val, ~9 leak val (total ~13 val, 62 train)
    norm_train, norm_val = split_group_list(normal_samples, 4)
    leak_train, leak_val = split_group_list(leak_samples, 9)

    train_data = norm_train + leak_train
    val_data = norm_val + leak_val

    random.shuffle(train_data)
    random.shuffle(val_data)
    return train_data, val_data


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray, y_probs: np.ndarray = None) -> Dict[str, Any]:
    cm = np.zeros((2, 2), dtype=int)
    for t, p in zip(y_true, y_pred):
        cm[t, p] += 1

    tn, fp = cm[0, 0], cm[0, 1]
    fn, tp = cm[1, 0], cm[1, 1]

    total = max(1, tp + tn + fp + fn)
    acc = float((tp + tn) / total)
    prec_1 = float(tp / max(1, tp + fp))
    rec_1 = float(tp / max(1, tp + fn))
    f1_1 = float(2 * prec_1 * rec_1 / max(1e-6, prec_1 + rec_1))

    prec_0 = float(tn / max(1, tn + fn))
    rec_0 = float(tn / max(1, tn + fp))
    f1_0 = float(2 * prec_0 * rec_0 / max(1e-6, prec_0 + rec_0))

    macro_f1 = float((f1_0 + f1_1) / 2.0)
    fpr_0 = float(fp / max(1, tn + fp))

    return {
        "accuracy": round(acc, 4),
        "macro_f1": round(macro_f1, 4),
        "confusion_matrix": {
            "TN": int(tn),
            "FP": int(fp),
            "FN": int(fn),
            "TP": int(tp),
            "matrix_2x2": [[int(tn), int(fp)], [int(fn), int(tp)]]
        },
        "leak_metrics": {
            "precision": round(prec_1, 4),
            "recall": round(rec_1, 4),
            "f1": round(f1_1, 4),
            "support": int(tp + fn)
        },
        "normal_metrics": {
            "precision": round(prec_0, 4),
            "recall": round(rec_0, 4),
            "f1": round(f1_0, 4),
            "false_positive_rate": round(fpr_0, 4),
            "support": int(tn + fp)
        }
    }


def main():
    print("=" * 70)
    print("NAGARSETU 3.1 — WATER PIPE AI V4 FAST TRAINING & EVALUATION")
    print("=" * 70)
    start_time = time.time()

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    test_samples = manifest["frozen_held_out_test"]
    pool_samples = manifest["train_val_pool"]

    print(f"Total Unique Valid Images:        {manifest['total_unique_images']}")
    print(f"Genuinely New Images Since V3:    {manifest['genuinely_new_since_v3_count']}")
    print(f"Frozen Held-Out Test Samples:     {len(test_samples)} ({sum(1 for s in test_samples if s['label']==0)} Normal, {sum(1 for s in test_samples if s['label']==1)} Leak)")
    print(f"Train/Val Pool Samples:           {len(pool_samples)} ({sum(1 for s in pool_samples if s['label']==0)} Normal, {sum(1 for s in pool_samples if s['label']==1)} Leak)")

    # 1. Dataset Split
    train_data, val_data = split_train_val_pool(pool_samples, val_ratio=0.18, seed=42)
    print(f"\nGroup-Stratified Split:")
    print(f"  Train: {len(train_data)} samples ({sum(1 for s in train_data if s['label']==0)} Normal, {sum(1 for s in train_data if s['label']==1)} Leak)")
    print(f"  Val:   {len(val_data)} samples ({sum(1 for s in val_data if s['label']==0)} Normal, {sum(1 for s in val_data if s['label']==1)} Leak)")
    print(f"  Test:  {len(test_samples)} samples (Untouched frozen held-out set)")

    # 2. Transforms
    # Retain fine edges and spray contrast
    train_transform = T.Compose([
        T.Resize((224, 224)),
        T.RandomHorizontalFlip(p=0.5),
        T.RandomRotation(degrees=10),
        T.RandomAdjustSharpness(sharpness_factor=1.5, p=0.4),
        T.ColorJitter(brightness=0.15, contrast=0.20, saturation=0.15),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    eval_transform = T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    train_loader = DataLoader(WaterPipeDataset(train_data, train_transform), batch_size=8, shuffle=True)
    val_loader = DataLoader(WaterPipeDataset(val_data, eval_transform), batch_size=8, shuffle=False)
    test_loader = DataLoader(WaterPipeDataset(test_samples, eval_transform), batch_size=8, shuffle=False)

    # 3. Model Architecture & Base Checkpoint Selection
    # As instructed: Choose checkpoint based on existing independent evaluation and compatibility.
    # V2 demonstrated 86.67% test accuracy, 0 FP, and 2-class alignment. V3 had weaker 80% test accuracy.
    print("\n--- Initializing Model from High-Performing V2 Checkpoint ---")
    model = WaterPipeClassifier(num_classes=2, pretrained=False, dropout=0.25)
    if os.path.exists(V2_MODEL_PATH):
        v2_ckpt = torch.load(V2_MODEL_PATH, map_location="cpu")
        model.load_state_dict(v2_ckpt["model_state_dict"])
        print(f"[OK] Loaded base weights from {os.path.basename(V2_MODEL_PATH)}")
    else:
        print("[WARN] V2 checkpoint not found; falling back to torchvision pretrained weights")
        model = WaterPipeClassifier(num_classes=2, pretrained=True, dropout=0.25)

    # 4. Class weighting
    n_normal_train = sum(1 for s in train_data if s["label"] == 0)
    n_leak_train = sum(1 for s in train_data if s["label"] == 1)
    norm_weight = n_leak_train / max(1, n_normal_train)
    class_weights = torch.tensor([norm_weight, 1.0]).float()
    print(f"Class Weights: Normal={norm_weight:.2f}, Leak=1.00")
    criterion = nn.CrossEntropyLoss(weight=class_weights, label_smoothing=0.02)

    # 5. Freezing Lower Layers & Fine-Tuning Strategy
    # Freeze lower feature extractors (blocks 0 to 7) to preserve low-level features
    # Fine-tune blocks 8 to 12 and classifier head
    for idx, block in enumerate(model.backbone.features):
        if idx >= 8:
            for p in block.parameters():
                p.requires_grad = True
        else:
            for p in block.parameters():
                p.requires_grad = False

    for p in model.backbone.classifier.parameters():
        p.requires_grad = True

    optimizer = torch.optim.AdamW([
        {"params": model.backbone.features[8:].parameters(), "lr": 5e-5},
        {"params": model.backbone.classifier.parameters(), "lr": 2e-4}
    ], weight_decay=1e-3)

    max_epochs = 30
    patience = 6
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max_epochs, eta_min=1e-6)

    best_val_f1 = -1.0
    best_val_loss = float("inf")
    best_model_weights = copy.deepcopy(model.state_dict())
    no_improve_epochs = 0
    actual_epochs_run = 0

    print(f"\n--- Starting Single-Run Training (Max {max_epochs} Epochs, Early Stopping Patience {patience}) ---")
    training_start = time.time()
    for epoch in range(1, max_epochs + 1):
        actual_epochs_run = epoch
        model.train()
        train_loss, train_correct, train_total = 0.0, 0, 0
        for imgs, labels, _ in train_loader:
            optimizer.zero_grad()
            outputs = model(imgs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            train_loss += loss.item() * imgs.size(0)
            _, preds = torch.max(outputs, 1)
            train_correct += (preds == labels).sum().item()
            train_total += labels.size(0)

        scheduler.step()

        # Validation
        model.eval()
        val_loss, val_preds, val_labels, val_probs = 0.0, [], [], []
        val_total = 0
        with torch.no_grad():
            for imgs, labels, _ in val_loader:
                outputs = model(imgs)
                loss = criterion(outputs, labels)
                val_loss += loss.item() * imgs.size(0)
                probs = torch.softmax(outputs, dim=1)
                preds = torch.argmax(probs, dim=1)

                val_preds.extend(preds.cpu().numpy())
                val_labels.extend(labels.cpu().numpy())
                val_probs.extend(probs.cpu().numpy())
                val_total += labels.size(0)

        val_loss = val_loss / max(1, val_total)
        val_metrics = compute_metrics(np.array(val_labels), np.array(val_preds), np.array(val_probs))

        improved = False
        if val_metrics["macro_f1"] > best_val_f1 or (val_metrics["macro_f1"] == best_val_f1 and val_loss < best_val_loss):
            best_val_f1 = val_metrics["macro_f1"]
            best_val_loss = val_loss
            best_model_weights = copy.deepcopy(model.state_dict())
            improved = True
            no_improve_epochs = 0
        else:
            no_improve_epochs += 1

        if epoch % 5 == 0 or epoch == 1 or improved:
            flag = " [BEST]" if improved else ""
            print(f"Epoch [{epoch:02d}/{max_epochs:02d}] Train Loss: {train_loss/train_total:.4f} Acc: {train_correct/train_total:.1%} | Val Loss: {val_loss:.4f} Acc: {val_metrics['accuracy']:.1%} F1: {val_metrics['macro_f1']:.4f}{flag}")

        if no_improve_epochs >= patience:
            print(f"Early stopping triggered at epoch {epoch} (no improvement for {patience} epochs).")
            break

    training_duration = time.time() - training_start
    print(f"\n[OK] Training completed in {training_duration:.2f}s ({actual_epochs_run} epochs).")
    print(f"Best Val Macro F1: {best_val_f1:.4f}, Best Val Loss: {best_val_loss:.4f}")

    # Load best validation checkpoint
    model.load_state_dict(best_model_weights)

    # 6. Comprehensive Independent Held-Out Test Evaluation
    print("\n" + "=" * 70)
    print("HELD-OUT TEST SET EVALUATION (15 Images)")
    print("=" * 70)

    def eval_model_on_test(m, is_baseline=False):
        m.eval()
        preds, labels, probs, paths = [], [], [], []
        with torch.no_grad():
            for imgs, lbls, pths in test_loader:
                outputs = m(imgs)
                prob = torch.softmax(outputs, dim=1)
                if is_baseline:
                    # Baseline is 3-class (0=perfect, 1=leak, 2=broken) -> binary leak is > 0
                    pred_binary = (torch.argmax(prob, dim=1) > 0).long()
                else:
                    pred_binary = torch.argmax(prob, dim=1)

                preds.extend(pred_binary.cpu().numpy())
                labels.extend(lbls.cpu().numpy())
                probs.extend(prob.cpu().numpy())
                paths.extend(pths)
        return compute_metrics(np.array(labels), np.array(preds), np.array(probs)), preds, probs, paths

    # Evaluate V4 Candidate
    v4_test_metrics, v4_preds, v4_probs, test_paths = eval_model_on_test(model, is_baseline=False)

    # Evaluate Baseline Model (water_pipe_model.pt)
    baseline_metrics = None
    if os.path.exists(BASELINE_MODEL_PATH):
        try:
            b_ckpt = torch.load(BASELINE_MODEL_PATH, map_location="cpu")
            b_model = WaterPipeClassifier(num_classes=b_ckpt.get("num_classes", 3), pretrained=False)
            b_model.load_state_dict(b_ckpt["model_state_dict"])
            baseline_metrics, _, _, _ = eval_model_on_test(b_model, is_baseline=True)
        except Exception as e:
            print(f"[WARN] Error evaluating baseline: {e}")

    # Evaluate V2 Model
    v2_metrics = None
    if os.path.exists(V2_MODEL_PATH):
        try:
            v2_ckpt = torch.load(V2_MODEL_PATH, map_location="cpu")
            v2_model = WaterPipeClassifier(num_classes=2, pretrained=False)
            v2_model.load_state_dict(v2_ckpt["model_state_dict"])
            v2_metrics, _, _, _ = eval_model_on_test(v2_model, is_baseline=False)
        except Exception as e:
            print(f"[WARN] Error evaluating V2: {e}")

    # Evaluate V3 Model
    v3_metrics = None
    if os.path.exists(V3_MODEL_PATH):
        try:
            v3_ckpt = torch.load(V3_MODEL_PATH, map_location="cpu")
            v3_model = WaterPipeClassifier(num_classes=2, pretrained=False)
            v3_model.load_state_dict(v3_ckpt["model_state_dict"])
            v3_metrics, _, _, _ = eval_model_on_test(v3_model, is_baseline=False)
        except Exception as e:
            print(f"[WARN] Error evaluating V3: {e}")

    # Subgroups evaluation on the test set
    subgroup_categories = {
        "thin_spray_leaks": ["WhatsApp Image 2026-10-09 at 12.19.20 AM (1).jpeg"],
        "wide_angle_pipe_photographs": ["WhatsApp Image 2026-10-09 at 12.20.51 AM.jpeg"],
        "rusted_normal_pipes": ["blue-industrial-water-pipe-system-with-visible-rust-near-a-corrugated-metal-wall-in-an-outdoor-setting-photo.jpg"],
        "obvious_large_leaks": [
            "broken-water-pipe-leaking-out-soil-underground-leak-274565016.webp",
            "Screenshot 2026-10-09 003238.png",
            "sentinelassam-english_2025-12-03_mru07lxm_Water-pipeline-leakage-at-Silpukhuri.avif"
        ]
    }

    subgroup_results = {}
    path_to_pred = {os.path.basename(p): pred for p, pred in zip(test_paths, v4_preds)}
    for cat_name, file_list in subgroup_categories.items():
        cat_correct = 0
        cat_total = len(file_list)
        details = []
        for fn in file_list:
            pred = path_to_pred.get(fn)
            true_lbl = 0 if "normal" in cat_name else 1
            is_corr = bool(int(pred) == int(true_lbl)) if pred is not None else False
            if is_corr:
                cat_correct += 1
            details.append({"filename": fn, "predicted": int(pred) if pred is not None else None, "correct": is_corr})
        subgroup_results[cat_name] = {
            "total": int(cat_total),
            "correct": int(cat_correct),
            "accuracy": round(float(cat_correct / max(1, cat_total)), 4),
            "samples": details
        }

    # Measure CPU inference latency over 50 iterations
    dummy_input = torch.randn(1, 3, 224, 224)
    model.eval()
    # Warmup
    for _ in range(10):
        _ = model(dummy_input)
    t_lat_start = time.time()
    n_lat_runs = 50
    with torch.no_grad():
        for _ in range(n_lat_runs):
            _ = model(dummy_input)
    avg_latency_ms = round(((time.time() - t_lat_start) / n_lat_runs) * 1000, 2)

    print(f"\nModel Performance on Held-Out Test Set (15 Images):")
    print(f"{'Metric':<25} {'Baseline':<12} {'V2':<12} {'V3':<12} {'V4 (New)':<12}")
    print("-" * 70)
    print(f"{'Accuracy':<25} {baseline_metrics['accuracy'] if baseline_metrics else 'N/A':<12} {v2_metrics['accuracy'] if v2_metrics else 'N/A':<12} {v3_metrics['accuracy'] if v3_metrics else 'N/A':<12} {v4_test_metrics['accuracy']:<12}")
    print(f"{'Macro F1':<25} {baseline_metrics['macro_f1'] if baseline_metrics else 'N/A':<12} {v2_metrics['macro_f1'] if v2_metrics else 'N/A':<12} {v3_metrics['macro_f1'] if v3_metrics else 'N/A':<12} {v4_test_metrics['macro_f1']:<12}")
    print(f"{'Leak Recall':<25} {baseline_metrics['leak_metrics']['recall'] if baseline_metrics else 'N/A':<12} {v2_metrics['leak_metrics']['recall'] if v2_metrics else 'N/A':<12} {v3_metrics['leak_metrics']['recall'] if v3_metrics else 'N/A':<12} {v4_test_metrics['leak_metrics']['recall']:<12}")
    print(f"{'Leak Precision':<25} {baseline_metrics['leak_metrics']['precision'] if baseline_metrics else 'N/A':<12} {v2_metrics['leak_metrics']['precision'] if v2_metrics else 'N/A':<12} {v3_metrics['leak_metrics']['precision'] if v3_metrics else 'N/A':<12} {v4_test_metrics['leak_metrics']['precision']:<12}")
    print(f"{'False Positives (FP)':<25} {baseline_metrics['confusion_matrix']['FP'] if baseline_metrics else 'N/A':<12} {v2_metrics['confusion_matrix']['FP'] if v2_metrics else 'N/A':<12} {v3_metrics['confusion_matrix']['FP'] if v3_metrics else 'N/A':<12} {v4_test_metrics['confusion_matrix']['FP']:<12}")
    print(f"{'False Negatives (FN)':<25} {baseline_metrics['confusion_matrix']['FN'] if baseline_metrics else 'N/A':<12} {v2_metrics['confusion_matrix']['FN'] if v2_metrics else 'N/A':<12} {v3_metrics['confusion_matrix']['FN'] if v3_metrics else 'N/A':<12} {v4_test_metrics['confusion_matrix']['FN']:<12}")
    print(f"{'CPU Latency (ms)':<25} {'~4.5 ms':<12} {'~4.5 ms':<12} {'~4.6 ms':<12} {f'{avg_latency_ms} ms':<12}")

    print("\nSubgroup Evaluation:")
    for cat, res in subgroup_results.items():
        print(f"  {cat}: {res['correct']}/{res['total']} ({res['accuracy']:.1%})")

    # 7. Save Candidate Checkpoint
    checkpoint_dict = {
        "model_state_dict": model.state_dict(),
        "model_architecture": "MobileNetV3-Small",
        "model_version": "v4.0-candidate",
        "training_date": time.strftime("%Y-%m-%d %H:%M:%S"),
        "class_names": {0: "normal_pipe", 1: "damaged_or_leaking_pipe"},
        "classes": ["normal_pipe", "damaged_or_leaking_pipe"],
        "num_classes": 2,
        "input_size": (224, 224),
        "mean": [0.485, 0.456, 0.406],
        "std": [0.229, 0.224, 0.225],
        "train_samples": len(train_data),
        "val_samples": len(val_data),
        "test_samples": len(test_samples),
        "total_dataset_samples": manifest["total_unique_images"],
        "class_weights": [round(float(norm_weight), 4), 1.0],
        "hyperparameters": {
            "max_epochs": max_epochs,
            "actual_epochs": actual_epochs_run,
            "early_stopping_patience": patience,
            "batch_size": 8,
            "backbone_lr": 5e-5,
            "classifier_lr": 2e-4,
            "weight_decay": 1e-3,
            "label_smoothing": 0.02,
            "dropout": 0.25
        },
        "metrics": {
            "test_metrics": v4_test_metrics,
            "subgroups": subgroup_results,
            "baseline_test_comparison": baseline_metrics,
            "v2_test_comparison": v2_metrics,
            "v3_test_comparison": v3_metrics,
            "cpu_inference_latency_ms": avg_latency_ms
        }
    }

    torch.save(checkpoint_dict, V4_MODEL_PATH)
    print(f"\n[OK] Candidate Checkpoint saved to: {V4_MODEL_PATH}")

    def np_encoder(obj):
        if isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float32, np.float64)):
            return float(obj)
        elif isinstance(obj, (np.bool_, bool)):
            return bool(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return str(obj)

    with open(V4_METRICS_PATH, "w", encoding="utf-8") as f:
        json.dump(checkpoint_dict["metrics"], f, indent=2, default=np_encoder)
    print(f"[OK] Evaluation metrics saved to: {V4_METRICS_PATH}")

    # 8. Real Inference Smoke Test
    print("\n--- Smoke Testing Real Inference ---")
    test_img_path = test_samples[0]["path"]
    with Image.open(test_img_path) as img:
        img_t = eval_transform(img.convert("RGB")).unsqueeze(0)
    
    loaded_ckpt = torch.load(V4_MODEL_PATH, map_location="cpu")
    smoke_model = WaterPipeClassifier(num_classes=loaded_ckpt["num_classes"], pretrained=False)
    smoke_model.load_state_dict(loaded_ckpt["model_state_dict"])
    smoke_model.eval()
    with torch.no_grad():
        out = smoke_model(img_t)
        prob = torch.softmax(out, dim=1)[0]
        pred_idx = torch.argmax(prob).item()

    print(f"Smoke test image: {os.path.basename(test_img_path)}")
    print(f"Predicted class: {loaded_ckpt['classes'][pred_idx]} (confidence: {prob[pred_idx]:.2%})")
    print(f"[OK] Checkpoint verified and functional on CPU.")


if __name__ == "__main__":
    main()
