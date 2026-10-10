import os
import sys
import time
import json
import random
import numpy as np
from PIL import Image
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import torchvision.transforms as T
import cv2

NORMAL_DIR = r"D:\NAGARSETU\normal pipe images"
LEAK_DIR = r"D:\NAGARSETU\leaking pipes"
OUTPUT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "water_pipe_model.pt")
METRICS_PATH = os.path.join(os.path.dirname(__file__), "model", "pipe_model_metrics.json")

# Ensure reproducibility
torch.manual_seed(42)
np.random.seed(42)
random.seed(42)


class WaterPipeDataset(Dataset):
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


class WaterPipeClassifier(nn.Module):
    """
    Lightweight, high-accuracy transfer-learning model based on MobileNetV3-Small
    for real-time civic pipe condition classification.
    Classes:
    0: PERFECT_PIPE
    1: WATER_LEAKAGE
    2: BROKEN_PIPE
    """
    def __init__(self, num_classes=3, pretrained=False):
        super(WaterPipeClassifier, self).__init__()
        import torchvision.models as models
        if pretrained:
            weights = models.MobileNet_V3_Small_Weights.DEFAULT
            self.backbone = models.mobilenet_v3_small(weights=weights)
        else:
            self.backbone = models.mobilenet_v3_small(weights=None)
        in_features = self.backbone.classifier[3].in_features
        self.backbone.classifier[3] = nn.Linear(in_features, num_classes)

    def forward(self, x):
        return self.backbone(x)


def inspect_all_pipe_data():
    # 1. Normal Pipe Images
    normal_files = sorted(os.listdir(NORMAL_DIR))
    perfect_files = [os.path.join(NORMAL_DIR, f) for f in normal_files if os.path.splitext(f)[1].lower() in ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.avif']]

    # 2. Leaking and Broken Pipe Images
    leak_all = sorted(os.listdir(LEAK_DIR))
    leak_unique = [f for f in leak_all if f != "images (21).jpg"]
    
    leakage_files = []
    broken_files = []

    for f in leak_unique:
        p = os.path.join(LEAK_DIR, f)
        fl = f.lower()
        if "broken" in fl or "burst" in fl:
            broken_files.append(p)
            continue
        if any(k in fl for k in ["leak", "hole", "waste-water", "silpukhuri"]):
            leakage_files.append(p)
            continue

        try:
            pil = Image.open(p).convert("RGB")
            arr = np.array(pil)
            hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)
            blue = np.sum((hsv[:, :, 0] > 80) & (hsv[:, :, 0] < 135) & (hsv[:, :, 1] > 30)) / arr.size
            spray = np.sum((hsv[:, :, 2] > 220) & (hsv[:, :, 1] < 50)) / arr.size
            if spray > 0.015 or blue > 0.025:
                leakage_files.append(p)
            else:
                broken_files.append(p)
        except Exception:
            broken_files.append(p)

    return perfect_files[:28], leakage_files[:37], broken_files[:20]


def train_and_evaluate_3class():
    start_time = time.time()
    perfect_files, leakage_files, broken_files = inspect_all_pipe_data()

    print(f"==================================================")
    print(f"REAL 3-CLASS PIPE AI TRAINING & EVALUATION")
    print(f"==================================================")
    print(f"Real Perfect Pipe images:  {len(perfect_files)} (D:\\NAGARSETU\\normal pipe images)")
    print(f"Real Water Leakage images: {len(leakage_files)} (D:\\NAGARSETU\\leaking pipes)")
    print(f"Real Broken Pipe images:   {len(broken_files)} (D:\\NAGARSETU\\leaking pipes)")
    print(f"Excluded duplicates:       1 (images (21).jpg in leaking pipes)")
    print(f"Total Unique Real Images:  {len(perfect_files) + len(leakage_files) + len(broken_files)}")

    # Split: 70% Train, 15% Val, 15% Test per class
    random.seed(42)
    random.shuffle(perfect_files)
    random.shuffle(leakage_files)
    random.shuffle(broken_files)

    # Perfect (28 total -> 20 train, 4 val, 4 test)
    perf_train = [(p, 0) for p in perfect_files[:20]]
    perf_val = [(p, 0) for p in perfect_files[20:24]]
    perf_test = [(p, 0) for p in perfect_files[24:28]]

    # Leakage (37 total -> 26 train, 5 val, 6 test)
    leak_train = [(p, 1) for p in leakage_files[:26]]
    leak_val = [(p, 1) for p in leakage_files[26:31]]
    leak_test = [(p, 1) for p in leakage_files[31:37]]

    # Broken (20 total -> 14 train, 3 val, 3 test)
    broken_train = [(p, 2) for p in broken_files[:14]]
    broken_val = [(p, 2) for p in broken_files[14:17]]
    broken_test = [(p, 2) for p in broken_files[17:20]]

    train_samples = perf_train + leak_train + broken_train
    val_samples = perf_val + leak_val + broken_val
    test_samples = perf_test + leak_test + broken_test

    random.shuffle(train_samples)

    print(f"\nDataset Splits:")
    print(f"  Train: {len(train_samples)} (Perfect: {len(perf_train)}, Leakage: {len(leak_train)}, Broken: {len(broken_train)})")
    print(f"  Val:   {len(val_samples)} (Perfect: {len(perf_val)}, Leakage: {len(leak_val)}, Broken: {len(broken_val)})")
    print(f"  Test:  {len(test_samples)} (Perfect: {len(perf_test)}, Leakage: {len(leak_test)}, Broken: {len(broken_test)})")

    train_transform = T.Compose([
        T.Resize((224, 224)),
        T.RandomHorizontalFlip(),
        T.RandomVerticalFlip(p=0.3),
        T.RandomRotation(15),
        T.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    eval_transform = T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    train_loader = DataLoader(WaterPipeDataset(train_samples, train_transform), batch_size=8, shuffle=True)
    val_loader = DataLoader(WaterPipeDataset(val_samples, eval_transform), batch_size=8, shuffle=False)
    test_loader = DataLoader(WaterPipeDataset(test_samples, eval_transform), batch_size=8, shuffle=False)

    model = WaterPipeClassifier(num_classes=3, pretrained=True)
    class_weights = torch.tensor([1.0, 1.35, 1.45]).float()
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=4e-4, weight_decay=1e-3)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=30)

    print("\nStarting Training (30 Epochs)...")
    best_val_loss = float("inf")
    best_weights = None

    for epoch in range(1, 31):
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
            print(f"  Epoch [{epoch:02d}/30] Train Loss: {train_loss:.4f} Acc: {train_acc:.1%} | Val Loss: {val_loss:.4f} Acc: {val_acc:.1%}")

    if best_weights is not None:
        model.load_state_dict(best_weights)

    # Test Set Evaluation
    print("\nRunning Test Set Evaluation on Previously Unseen Real Images...")
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

    # Compute actual confusion matrix & metrics
    # Classes: 0=PERFECT_PIPE, 1=WATER_LEAKAGE, 2=BROKEN_PIPE
    conf_matrix = np.zeros((3, 3), dtype=int)
    for t, p in zip(all_labels, all_preds):
        conf_matrix[t, p] += 1

    print("\nConfusion Matrix (Rows=True, Cols=Pred):")
    print("                Pred Perf | Pred Leak | Pred Broken")
    print(f"  True Perf:       {conf_matrix[0, 0]:5d}  |    {conf_matrix[0, 1]:5d}  |    {conf_matrix[0, 2]:5d}")
    print(f"  True Leak:       {conf_matrix[1, 0]:5d}  |    {conf_matrix[1, 1]:5d}  |    {conf_matrix[1, 2]:5d}")
    print(f"  True Broken:     {conf_matrix[2, 0]:5d}  |    {conf_matrix[2, 1]:5d}  |    {conf_matrix[2, 2]:5d}")

    # Metrics per class
    # Class 0: PERFECT_PIPE
    tp_0 = conf_matrix[0, 0]
    fp_0 = conf_matrix[1, 0] + conf_matrix[2, 0]
    fn_0 = conf_matrix[0, 1] + conf_matrix[0, 2]
    tn_0 = conf_matrix[1, 1] + conf_matrix[1, 2] + conf_matrix[2, 1] + conf_matrix[2, 2]

    prec_0 = float(tp_0 / (tp_0 + fp_0)) if (tp_0 + fp_0) > 0 else 0.0
    rec_0 = float(tp_0 / (tp_0 + fn_0)) if (tp_0 + fn_0) > 0 else 0.0
    fpr_0 = float(fp_0 / (fp_0 + tn_0)) if (fp_0 + tn_0) > 0 else 0.0
    acc_0 = float((tp_0 + tn_0) / (tp_0 + tn_0 + fp_0 + fn_0)) if len(all_labels) > 0 else 0.0

    # Class 1: WATER_LEAKAGE
    tp_1 = conf_matrix[1, 1]
    fp_1 = conf_matrix[0, 1] + conf_matrix[2, 1]
    fn_1 = conf_matrix[1, 0] + conf_matrix[1, 2]
    prec_1 = float(tp_1 / (tp_1 + fp_1)) if (tp_1 + fp_1) > 0 else 0.0
    rec_1 = float(tp_1 / (tp_1 + fn_1)) if (tp_1 + fn_1) > 0 else 0.0

    # Class 2: BROKEN_PIPE
    tp_2 = conf_matrix[2, 2]
    fp_2 = conf_matrix[0, 2] + conf_matrix[1, 2]
    fn_2 = conf_matrix[2, 0] + conf_matrix[2, 1]
    prec_2 = float(tp_2 / (tp_2 + fp_2)) if (tp_2 + fp_2) > 0 else 0.0
    rec_2 = float(tp_2 / (tp_2 + fn_2)) if (tp_2 + fn_2) > 0 else 0.0

    total_acc = float(np.mean(all_preds == all_labels))
    
    # Macro F1
    f1_0 = float(2 * prec_0 * rec_0 / (prec_0 + rec_0)) if (prec_0 + rec_0) > 0 else 0.0
    f1_1 = float(2 * prec_1 * rec_1 / (prec_1 + rec_1)) if (prec_1 + rec_1) > 0 else 0.0
    f1_2 = float(2 * prec_2 * rec_2 / (prec_2 + rec_2)) if (prec_2 + rec_2) > 0 else 0.0
    macro_f1 = float((f1_0 + f1_1 + f1_2) / 3.0)

    elapsed = time.time() - start_time

    print(f"\n==================================================")
    print(f"ACTUAL HELD-OUT TEST METRICS (N={len(all_labels)})")
    print(f"==================================================")
    print(f"PERFECT PIPE Accuracy:            {acc_0:.4f} ({acc_0:.1%})")
    print(f"PERFECT PIPE Precision:           {prec_0:.4f}")
    print(f"PERFECT PIPE Recall:              {rec_0:.4f}")
    print(f"PERFECT PIPE False Positive Rate: {fpr_0:.4f}")
    print(f"WATER LEAKAGE Precision:          {prec_1:.4f}")
    print(f"WATER LEAKAGE Recall:             {rec_1:.4f}")
    print(f"BROKEN PIPE Precision:            {prec_2:.4f}")
    print(f"BROKEN PIPE Recall:               {rec_2:.4f}")
    print(f"Overall Accuracy:                 {total_acc:.4f} ({total_acc:.1%})")
    print(f"Overall Macro F1:                 {macro_f1:.4f}")
    print(f"Elapsed Time:                     {elapsed:.2f} seconds")

    # Save model checkpoint
    os.makedirs(os.path.dirname(OUTPUT_MODEL_PATH), exist_ok=True)
    checkpoint = {
        "model_state_dict": model.state_dict(),
        "class_names": {0: "perfect_pipe", 1: "water_leakage", 2: "broken_pipe"},
        "classes": ["perfect_pipe", "water_leakage", "broken_pipe"],
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
            "perfect_pipe": {
                "accuracy": round(acc_0, 4),
                "precision": round(prec_0, 4),
                "recall": round(rec_0, 4),
                "false_positive_rate": round(fpr_0, 4)
            },
            "water_leakage": {
                "precision": round(prec_1, 4),
                "recall": round(rec_1, 4)
            },
            "broken_pipe": {
                "precision": round(prec_2, 4),
                "recall": round(rec_2, 4)
            }
        }
    }
    torch.save(checkpoint, OUTPUT_MODEL_PATH)
    print(f"\n[OK] Model saved: {OUTPUT_MODEL_PATH}")

    metrics_data = {
        "perfect_pipe_count": len(perfect_files),
        "water_leakage_count": len(leakage_files),
        "broken_pipe_count": len(broken_files),
        "excluded_duplicates": 1,
        "train_count": len(train_samples),
        "val_count": len(val_samples),
        "test_count": len(test_samples),
        "perfect_pipe_accuracy": round(acc_0, 4),
        "perfect_pipe_precision": round(prec_0, 4),
        "perfect_pipe_recall": round(rec_0, 4),
        "perfect_pipe_false_positive_rate": round(fpr_0, 4),
        "water_leakage_precision": round(prec_1, 4),
        "water_leakage_recall": round(rec_1, 4),
        "broken_pipe_precision": round(prec_2, 4),
        "broken_pipe_recall": round(rec_2, 4),
        "overall_accuracy": round(total_acc, 4),
        "overall_f1": round(macro_f1, 4),
        "training_time_seconds": round(elapsed, 2)
    }
    with open(METRICS_PATH, "w", encoding="utf-8") as fp:
        json.dump(metrics_data, fp, indent=2)

    print(f"[OK] Metrics saved: {METRICS_PATH}")
    return metrics_data


if __name__ == "__main__":
    train_and_evaluate_3class()
