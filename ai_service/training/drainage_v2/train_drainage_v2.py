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
import torchvision.models as models

WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\drainage_v2"
REVIEWED_JSON = os.path.join(WORKSPACE_DIR, "drainage_annotations_reviewed.json")
MANIFEST_PATH = os.path.join(WORKSPACE_DIR, "dataset_manifest.json")
ORIGINAL_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\drainage_model.pt"
NEW_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\drainage_model_v2.pt"
METRICS_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\drainage_model_v2_metrics.json"
DRAINAGE_DIR = r"D:\NAGARSETU\drainage images"

torch.manual_seed(42)
np.random.seed(42)
random.seed(42)

CLASS_MAP = {
    "normal_drain": 0,
    "blocked_drain": 1,
    "damaged_drain": 2
}
REV_CLASS_MAP = {v: k for k, v in CLASS_MAP.items()}

class DrainageDataset(Dataset):
    def __init__(self, samples, transform=None):
        self.samples = samples
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label, is_overflow = self.samples[idx][:3]
        img = Image.open(path).convert("RGB")
        if self.transform:
            img = self.transform(img)
        return img, label, is_overflow, path

class DrainageClassifier(nn.Module):
    def __init__(self, num_classes=3, pretrained=True):
        super().__init__()
        weights = models.MobileNet_V3_Small_Weights.DEFAULT if pretrained else None
        self.backbone = models.mobilenet_v3_small(weights=weights)
        in_features = self.backbone.classifier[3].in_features
        self.backbone.classifier[3] = nn.Linear(in_features, num_classes)

    def forward(self, x):
        return self.backbone(x)

def load_data(allow_unverified=False):
    json_path = REVIEWED_JSON if os.path.exists(REVIEWED_JSON) else MANIFEST_PATH
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    images = data.get("images", data.get("inventory", []))

    samples = []
    unverified = []

    for item in images:
        fname = item["filename"]
        fpath = os.path.join(DRAINAGE_DIR, fname)
        if not os.path.exists(fpath):
            continue

        lbl_str = item.get("assigned_label")
        is_ver = item.get("is_verified", False)
        is_overflow = item.get("is_overflow", False)

        if not is_ver:
            unverified.append(fname)
            if not allow_unverified:
                continue

        if lbl_str in CLASS_MAP:
            samples.append((fpath, CLASS_MAP[lbl_str], is_overflow, item.get("group", "default")))

    return samples, unverified

def train(allow_unverified=False):
    print("=" * 60)
    print("NAGARSETU 3.1 — DRAINAGE AI V2 TRAINING PIPELINE")
    print("=" * 60)

    samples, unverified = load_data(allow_unverified=allow_unverified)
    print(f"Total usable labeled samples: {len(samples)}")
    if unverified and not allow_unverified:
        print(f"Note: {len(unverified)} images pending human review excluded from training.")

    # Group allocation ensuring zero burst leakage across splits
    def get_clean_group(fname):
        if fname.startswith("WhatsApp Image 2026-10-09 at 12.40"): return "burst_oct09_1240"
        elif fname.startswith("WhatsApp Image 2026-10-09 at 12.45"): return "burst_oct09_1245"
        elif fname.startswith("WhatsApp Image 2026-10-09 at 12.51"): return "burst_oct09_1251"
        elif fname.startswith("WhatsApp Image 2026-10-09 at 2.42"): return "burst_oct09_1442"
        elif fname.startswith("Screenshot 2026-10-09"): return "burst_oct09_screenshot"
        elif fname.startswith("09d2afff"): return "burst_09d2"
        else: return f"single_{fname}"

    groups = defaultdict(list)
    for s in samples:
        fname = os.path.basename(s[0])
        grp = get_clean_group(fname)
        groups[grp].append(s)

    normal_groups = [g for g, items in groups.items() if any(it[1] == 0 for it in items)]
    defect_groups = [g for g in groups.keys() if g not in normal_groups]

    random.seed(42)
    random.shuffle(normal_groups)
    random.shuffle(defect_groups)

    val_g = set([normal_groups[0]])
    test_g = set([normal_groups[1]])
    train_g = set(normal_groups[2:])

    for g in defect_groups:
        items = groups[g]
        cur_v = sum(len(groups[x]) for x in val_g)
        cur_t = sum(len(groups[x]) for x in test_g)
        if cur_v < 16 and len(items) <= 6:
            val_g.add(g)
        elif cur_t < 16 and len(items) <= 6:
            test_g.add(g)
        else:
            train_g.add(g)

    train_data = [item for g in train_g for item in groups[g]]
    val_data = [item for g in val_g for item in groups[g]]
    test_data = [item for g in test_g for item in groups[g]]

    random.shuffle(train_data)

    print(f"Split breakdown (Zero Leakage Group Partition):")
    print(f"  Train: {len(train_data)} (Normal: {sum(1 for s in train_data if s[1]==0)}, Blocked: {sum(1 for s in train_data if s[1]==1)}, Damaged: {sum(1 for s in train_data if s[1]==2)})")
    print(f"  Val:   {len(val_data)} (Normal: {sum(1 for s in val_data if s[1]==0)}, Blocked: {sum(1 for s in val_data if s[1]==1)}, Damaged: {sum(1 for s in val_data if s[1]==2)})")
    print(f"  Test:  {len(test_data)} (Normal: {sum(1 for s in test_data if s[1]==0)}, Blocked: {sum(1 for s in test_data if s[1]==1)}, Damaged: {sum(1 for s in test_data if s[1]==2)})")

    splits_record = {
        "train": [s[0] for s in train_data],
        "val": [s[0] for s in val_data],
        "test": [s[0] for s in test_data]
    }
    with open(os.path.join(WORKSPACE_DIR, "frozen_splits.json"), "w") as sf:
        json.dump(splits_record, sf, indent=2)

    train_tf = T.Compose([
        T.Resize((224, 224)),
        T.RandomHorizontalFlip(),
        T.RandomRotation(10),
        T.ColorJitter(brightness=0.15, contrast=0.15, saturation=0.15),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])
    eval_tf = T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    train_loader = DataLoader(DrainageDataset(train_data, train_tf), batch_size=8, shuffle=True)
    val_loader = DataLoader(DrainageDataset(val_data, eval_tf), batch_size=8, shuffle=False)
    test_loader = DataLoader(DrainageDataset(test_data, eval_tf), batch_size=8, shuffle=False)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Training on device: {device}")

    # Transfer learning using MobileNetV3-Small
    model = DrainageClassifier(num_classes=3, pretrained=True).to(device)

    # Balanced class weights
    class_weights = torch.tensor([2.5, 1.0, 1.0]).float().to(device)
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-3)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=30)

    best_val_loss = float("inf")
    best_weights = None
    patience = 6
    patience_counter = 0
    start_time = time.time()

    print("\nStarting Transfer Learning (Max 30 Epochs, Patience 6)...")
    for epoch in range(1, 31):
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for imgs, labels, _, _ in train_loader:
            imgs, labels = imgs.to(device), labels.to(device)
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
        train_loss /= train_total
        train_acc = train_correct / train_total

        # Validation
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        with torch.no_grad():
            for imgs, labels, _, _ in val_loader:
                imgs, labels = imgs.to(device), labels.to(device)
                outputs = model(imgs)
                loss = criterion(outputs, labels)
                val_loss += loss.item() * imgs.size(0)
                _, preds = torch.max(outputs, 1)
                val_correct += (preds == labels).sum().item()
                val_total += labels.size(0)

        val_loss /= val_total
        val_acc = val_correct / val_total

        print(f"Epoch {epoch:02d}/30 | Train Loss: {train_loss:.4f} Acc: {train_acc:.3f} | Val Loss: {val_loss:.4f} Acc: {val_acc:.3f}")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_weights = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= patience:
                print(f"Early stopping triggered at epoch {epoch} (no improvement for {patience} epochs).")
                break

    duration = time.time() - start_time
    print(f"\nTraining completed in {duration:.1f}s")

    # Save V2 Checkpoint in identical schema compatible with model_manager
    v2_save_dict = {
        "model_state_dict": best_weights,
        "class_names": {0: "normal_drain", 1: "blocked_drain", 2: "damaged_drain"},
        "classes": ["normal_drain", "blocked_drain", "damaged_drain"],
        "num_classes": 3,
        "input_size": (224, 224),
        "mean": [0.485, 0.456, 0.406],
        "std": [0.229, 0.224, 0.225],
        "train_samples": len(train_data),
        "val_samples": len(val_data),
        "test_samples": len(test_data),
        "training_duration_seconds": round(duration, 2),
        "device": str(device)
    }

    torch.save(v2_save_dict, NEW_MODEL_PATH)
    print(f"[OK] Saved V2 Model: {NEW_MODEL_PATH} ({os.path.getsize(NEW_MODEL_PATH)} bytes)")

if __name__ == "__main__":
    from collections import defaultdict
    allow = "--allow-unverified" in sys.argv
    train(allow_unverified=allow)
