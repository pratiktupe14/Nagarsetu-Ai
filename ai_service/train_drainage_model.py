import os
import sys
import time
import json
import random
from pathlib import Path
import numpy as np
from PIL import Image
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import torchvision.transforms as T
import cv2

DRAINAGE_DIR = r"D:\NAGARSETU\drainage images"
CATALOG_PATH = os.path.join(os.path.dirname(__file__), "data", "drainage_catalog.json")
OUTPUT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "drainage_model.pt")
METRICS_PATH = os.path.join(os.path.dirname(__file__), "model", "drainage_model_metrics.json")

# Ensure reproducibility
torch.manual_seed(42)
np.random.seed(42)
random.seed(42)


class DrainageDataset(Dataset):
    def __init__(self, samples, transform=None):
        self.samples = samples
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        file_path, label = self.samples[idx]
        try:
            img = Image.open(file_path).convert("RGB")
        except Exception as e:
            arr = cv2.imread(file_path)
            if arr is not None:
                img = Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))
            else:
                raise RuntimeError(f"Cannot load image {file_path}: {e}")

        if self.transform:
            img = self.transform(img)

        return img, label, file_path


class DrainageClassifier(nn.Module):
    """
    Lightweight, high-accuracy transfer-learning model based on MobileNetV3-Small
    for real-time civic drainage condition classification.
    Classes:
    0: NORMAL_DRAIN (clean, functional drainage)
    1: BLOCKED_DRAIN (clogged with waste/plastic/debris/overflow)
    2: DAMAGED_DRAIN (broken slab, collapsed cover, missing grate)
    """
    def __init__(self, num_classes=3, pretrained=False):
        super(DrainageClassifier, self).__init__()
        import torchvision.models as models
        if pretrained:
            cache_file = Path.home() / ".cache" / "torch" / "hub" / "checkpoints" / "mobilenet_v3_small-047dcff4.pth"
            if cache_file.exists():
                self.backbone = models.mobilenet_v3_small(weights=None)
                state = torch.load(str(cache_file), map_location="cpu")
                self.backbone.load_state_dict(state)
            else:
                weights = models.MobileNet_V3_Small_Weights.DEFAULT
                self.backbone = models.mobilenet_v3_small(weights=weights)
        else:
            self.backbone = models.mobilenet_v3_small(weights=None)
        in_features = self.backbone.classifier[3].in_features
        self.backbone.classifier[3] = nn.Linear(in_features, num_classes)

    def forward(self, x):
        return self.backbone(x)


def load_drainage_data():
    with open(CATALOG_PATH, "r") as f:
        data = json.load(f)
    catalog = data["catalog"]

    normal_files = []
    blocked_files = []
    damaged_files = []

    for fname, cls_name in catalog.items():
        fpath = os.path.join(DRAINAGE_DIR, fname)
        if not os.path.exists(fpath):
            continue
        if cls_name == "NORMAL_DRAIN":
            normal_files.append(fpath)
        elif cls_name in ("BLOCKED_DRAIN", "DRAIN_OVERFLOW"):
            blocked_files.append(fpath)
        elif cls_name == "DAMAGED_DRAIN":
            damaged_files.append(fpath)

    return sorted(normal_files), sorted(blocked_files), sorted(damaged_files)


def train_and_evaluate_drainage():
    start_time = time.time()
    normal_files, blocked_files, damaged_files = load_drainage_data()

    print("==================================================")
    print("REAL DRAINAGE AI MODEL TRAINING & HELD-OUT EVALUATION")
    print("==================================================")
    print(f"Real Normal Drain images:   {len(normal_files)} (D:\\NAGARSETU\\drainage images)")
    print(f"Real Blocked Drain images:  {len(blocked_files)} (D:\\NAGARSETU\\drainage images)")
    print(f"Real Damaged Drain images:  {len(damaged_files)} (D:\\NAGARSETU\\drainage images)")
    print(f"Total Unique Real Images:   {len(normal_files) + len(blocked_files) + len(damaged_files)}")

    # Split: 70% Train, 15% Val, 15% Test
    random.seed(42)
    random.shuffle(normal_files)
    random.shuffle(blocked_files)
    random.shuffle(damaged_files)

    # Normal (14 total -> 10 train, 2 val, 2 test)
    norm_train = [(p, 0) for p in normal_files[:10]]
    norm_val = [(p, 0) for p in normal_files[10:12]]
    norm_test = [(p, 0) for p in normal_files[12:14]]

    # Blocked (40 total -> 28 train, 6 val, 6 test)
    block_train = [(p, 1) for p in blocked_files[:28]]
    block_val = [(p, 1) for p in blocked_files[28:34]]
    block_test = [(p, 1) for p in blocked_files[34:40]]

    # Damaged (48 total -> 34 train, 7 val, 7 test)
    dam_train = [(p, 2) for p in damaged_files[:34]]
    dam_val = [(p, 2) for p in damaged_files[34:41]]
    dam_test = [(p, 2) for p in damaged_files[41:48]]

    train_samples = norm_train + block_train + dam_train
    val_samples = norm_val + block_val + dam_val
    test_samples = norm_test + block_test + dam_test

    random.shuffle(train_samples)

    print("\nDataset Partition (Zero Data Leakage):")
    print(f"  Train: {len(train_samples)} (Normal: {len(norm_train)}, Blocked: {len(block_train)}, Damaged: {len(dam_train)})")
    print(f"  Val:   {len(val_samples)} (Normal: {len(norm_val)}, Blocked: {len(block_val)}, Damaged: {len(dam_val)})")
    print(f"  Test:  {len(test_samples)} (Normal: {len(norm_test)}, Blocked: {len(block_test)}, Damaged: {len(dam_test)})")

    train_transform = T.Compose([
        T.Resize((224, 224)),
        T.RandomHorizontalFlip(),
        T.RandomRotation(10),
        T.ColorJitter(brightness=0.15, contrast=0.15, saturation=0.15),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    eval_transform = T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    train_loader = DataLoader(DrainageDataset(train_samples, train_transform), batch_size=8, shuffle=True)
    val_loader = DataLoader(DrainageDataset(val_samples, eval_transform), batch_size=8, shuffle=False)
    test_loader = DataLoader(DrainageDataset(test_samples, eval_transform), batch_size=8, shuffle=False)

    model = DrainageClassifier(num_classes=3, pretrained=True)
    # Balanced class weights (Normal is fewer, so weight higher)
    class_weights = torch.tensor([2.0, 1.0, 1.0]).float()
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-3)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=25)

    print("\nTraining MobileNetV3-Small on Real Drainage Data (25 Epochs)...")
    best_val_loss = float("inf")
    best_weights = None

    for epoch in range(1, 26):
        model.train()
        running_loss = 0.0
        correct = 0
        total = 0

        for imgs, labels, _ in train_loader:
            optimizer.zero_grad()
            outputs = model(imgs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            running_loss += loss.item() * imgs.size(0)
            _, preds = torch.max(outputs, 1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)

        scheduler.step()
        train_loss = running_loss / total
        train_acc = correct / total

        # Validation
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        with torch.no_grad():
            for imgs, labels, _ in val_loader:
                outputs = model(imgs)
                loss = criterion(outputs, labels)
                val_loss += loss.item() * imgs.size(0)
                _, preds = torch.max(outputs, 1)
                val_correct += (preds == labels).sum().item()
                val_total += labels.size(0)

        val_loss = val_loss / val_total
        val_acc = val_correct / val_total

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_weights = {k: v.cpu().clone() for k, v in model.state_dict().items()}

        if epoch % 5 == 0 or epoch == 1:
            print(f"  Epoch [{epoch:02d}/25] Train Loss: {train_loss:.4f} Acc: {train_acc:.1%} | Val Loss: {val_loss:.4f} Acc: {val_acc:.1%}")

    if best_weights is not None:
        model.load_state_dict(best_weights)

    # Held-out Test Evaluation
    print("\nRunning Evaluation on Held-Out Test Set (Unseen Real Images)...")
    model.eval()
    all_preds = []
    all_labels = []
    all_scores = []
    test_paths = []

    with torch.no_grad():
        for imgs, labels, paths in test_loader:
            outputs = model(imgs)
            probs = torch.softmax(outputs, dim=1)
            scores, preds = torch.max(probs, 1)
            all_preds.extend(preds.cpu().tolist())
            all_labels.extend(labels.cpu().tolist())
            all_scores.extend(scores.cpu().tolist())
            test_paths.extend(paths)

    all_preds = np.array(all_preds)
    all_labels = np.array(all_labels)

    # Classes: 0: NORMAL_DRAIN, 1: BLOCKED_DRAIN, 2: DAMAGED_DRAIN
    conf_matrix = np.zeros((3, 3), dtype=int)
    for t, p in zip(all_labels, all_preds):
        conf_matrix[t, p] += 1

    print("\nConfusion Matrix (Rows=True, Cols=Pred):")
    print("                Pred Normal | Pred Blocked | Pred Damaged")
    print(f"  True Normal:     {conf_matrix[0, 0]:5d}    |    {conf_matrix[0, 1]:5d}     |    {conf_matrix[0, 2]:5d}")
    print(f"  True Blocked:    {conf_matrix[1, 0]:5d}    |    {conf_matrix[1, 1]:5d}     |    {conf_matrix[1, 2]:5d}")
    print(f"  True Damaged:    {conf_matrix[2, 0]:5d}    |    {conf_matrix[2, 1]:5d}     |    {conf_matrix[2, 2]:5d}")

    # Metrics per class
    # Class 0: NORMAL_DRAIN
    tp_0 = conf_matrix[0, 0]
    fp_0 = conf_matrix[1, 0] + conf_matrix[2, 0]
    fn_0 = conf_matrix[0, 1] + conf_matrix[0, 2]
    tn_0 = conf_matrix[1, 1] + conf_matrix[1, 2] + conf_matrix[2, 1] + conf_matrix[2, 2]
    prec_0 = float(tp_0 / (tp_0 + fp_0)) if (tp_0 + fp_0) > 0 else 0.0
    rec_0 = float(tp_0 / (tp_0 + fn_0)) if (tp_0 + fn_0) > 0 else 0.0
    fpr_0 = float(fp_0 / (fp_0 + tn_0)) if (fp_0 + tn_0) > 0 else 0.0
    acc_0 = float((tp_0 + tn_0) / (tp_0 + tn_0 + fp_0 + fn_0)) if len(all_labels) > 0 else 0.0

    # Class 1: BLOCKED_DRAIN
    tp_1 = conf_matrix[1, 1]
    fp_1 = conf_matrix[0, 1] + conf_matrix[2, 1]
    fn_1 = conf_matrix[1, 0] + conf_matrix[1, 2]
    prec_1 = float(tp_1 / (tp_1 + fp_1)) if (tp_1 + fp_1) > 0 else 0.0
    rec_1 = float(tp_1 / (tp_1 + fn_1)) if (tp_1 + fn_1) > 0 else 0.0

    # Class 2: DAMAGED_DRAIN
    tp_2 = conf_matrix[2, 2]
    fp_2 = conf_matrix[0, 2] + conf_matrix[1, 2]
    fn_2 = conf_matrix[2, 0] + conf_matrix[2, 1]
    prec_2 = float(tp_2 / (tp_2 + fp_2)) if (tp_2 + fp_2) > 0 else 0.0
    rec_2 = float(tp_2 / (tp_2 + fn_2)) if (tp_2 + fn_2) > 0 else 0.0

    total_acc = float(np.mean(all_preds == all_labels))
    f1_0 = float(2 * prec_0 * rec_0 / (prec_0 + rec_0)) if (prec_0 + rec_0) > 0 else 0.0
    f1_1 = float(2 * prec_1 * rec_1 / (prec_1 + rec_1)) if (prec_1 + rec_1) > 0 else 0.0
    f1_2 = float(2 * prec_2 * rec_2 / (prec_2 + rec_2)) if (prec_2 + rec_2) > 0 else 0.0
    macro_f1 = float((f1_0 + f1_1 + f1_2) / 3.0)

    elapsed = time.time() - start_time

    print(f"\n==================================================")
    print(f"ACTUAL HELD-OUT TEST METRICS (N={len(all_labels)})")
    print(f"==================================================")
    print(f"NORMAL DRAIN Accuracy:            {acc_0:.4f} ({acc_0:.1%})")
    print(f"NORMAL DRAIN Precision:           {prec_0:.4f}")
    print(f"NORMAL DRAIN Recall:              {rec_0:.4f}")
    print(f"NORMAL DRAIN False Positive Rate: {fpr_0:.4f}")
    print(f"BLOCKED DRAIN Precision:          {prec_1:.4f}")
    print(f"BLOCKED DRAIN Recall:             {rec_1:.4f}")
    print(f"DAMAGED DRAIN Precision:          {prec_2:.4f}")
    print(f"DAMAGED DRAIN Recall:             {rec_2:.4f}")
    print(f"Overall Accuracy:                 {total_acc:.4f} ({total_acc:.1%})")
    print(f"Overall Macro F1:                 {macro_f1:.4f}")
    print(f"Elapsed Training Time:            {elapsed:.2f} seconds")

    # Save model checkpoint
    os.makedirs(os.path.dirname(OUTPUT_MODEL_PATH), exist_ok=True)
    checkpoint = {
        "model_state_dict": model.state_dict(),
        "class_names": {0: "normal_drain", 1: "blocked_drain", 2: "damaged_drain"},
        "classes": ["normal_drain", "blocked_drain", "damaged_drain"],
        "num_classes": 3,
        "input_size": (224, 224),
        "mean": [0.485, 0.456, 0.406],
        "std": [0.229, 0.224, 0.225],
        "train_samples": len(train_samples),
        "val_samples": len(val_samples),
        "test_samples": len(test_samples),
        "metrics": {
            "test_accuracy": round(total_acc, 4),
            "macro_f1": round(macro_f1, 4),
            "normal_drain": {
                "accuracy": round(acc_0, 4),
                "precision": round(prec_0, 4),
                "recall": round(rec_0, 4),
                "false_positive_rate": round(fpr_0, 4)
            },
            "blocked_drain": {
                "precision": round(prec_1, 4),
                "recall": round(rec_1, 4)
            },
            "damaged_drain": {
                "precision": round(prec_2, 4),
                "recall": round(rec_2, 4)
            }
        }
    }
    torch.save(checkpoint, OUTPUT_MODEL_PATH)
    print(f"\nModel checkpoint saved to: {OUTPUT_MODEL_PATH}")

    with open(METRICS_PATH, "w") as f:
        json.dump(checkpoint["metrics"], f, indent=2)
    print(f"Metrics saved to: {METRICS_PATH}")

    return checkpoint


if __name__ == "__main__":
    train_and_evaluate_drainage()
