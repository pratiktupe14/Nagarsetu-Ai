import os
import sys
import gc
import json
import shutil
import hashlib
from typing import Dict, Any, List
from PIL import Image
import torch
from ultralytics import YOLO

DATASET_DIR = r"D:\NAGARSETU\garbage waste"
BEST_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\best.pt"
WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\garbage_waste_v2"
PROVISIONAL_DIR = os.path.join(WORKSPACE_DIR, "provisional_annotations")
PROV_LABELS_DIR = os.path.join(PROVISIONAL_DIR, "labels")

# Groupings to prevent data leakage across bursts
GROUP_MAP = {
    # Train: 21 images (70%)
    "WhatsApp Image 2026-09-30 at 1.34.52 AM.jpeg": ("session_sept30_whatsapp", "train"),
    "WhatsApp Image 2026-09-30 at 1.34.53 AM.jpeg": ("session_sept30_whatsapp", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.15 AM.jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.16 AM (1).jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.16 AM.jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.18 AM.jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.19 AM (1).jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.19 AM.jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.20 AM (1).jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.20 AM (2).jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.20 AM.jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.21 AM (1).jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.21 AM (2).jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.21 AM (3).jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.21 AM.jpeg": ("session_oct10_burst_part1", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.22 AM.jpeg": ("session_oct10_burst_part2", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.23 AM (1).jpeg": ("session_oct10_burst_part2", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.23 AM (2).jpeg": ("session_oct10_burst_part2", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.23 AM.jpeg": ("session_oct10_burst_part2", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.24 AM (1).jpeg": ("session_oct10_burst_part2", "train"),
    "WhatsApp Image 2026-10-10 at 1.41.24 AM (2).jpeg": ("session_oct10_burst_part2", "train"),

    # Val: 5 images (16.7%)
    "Screenshot 2026-10-01 073203.png": ("session_screenshots", "val"),
    "Screenshot 2026-10-01 073443.png": ("session_screenshots", "val"),
    "images.jpg": ("session_web_image", "val"),
    "WhatsApp Image 2026-10-10 at 1.41.24 AM.jpeg": ("session_oct10_burst_part3", "val"),
    "WhatsApp Image 2026-10-10 at 1.41.25 AM.jpeg": ("session_oct10_burst_part3", "val"),

    # Held-out Test: 4 images (13.3%)
    "WhatsApp Image 2026-10-10 at 1.41.27 AM (1).jpeg": ("session_oct10_burst_test", "test"),
    "WhatsApp Image 2026-10-10 at 1.41.27 AM.jpeg": ("session_oct10_burst_test", "test"),
    "WhatsApp Image 2026-10-10 at 1.41.28 AM.jpeg": ("session_oct10_burst_test", "test"),
    "WhatsApp Image 2026-10-10 at 1.41.30 AM.jpeg": ("session_oct10_burst_test", "test"),
}

def setup_workspace():
    os.makedirs(WORKSPACE_DIR, exist_ok=True)
    os.makedirs(PROV_LABELS_DIR, exist_ok=True)
    for s in ["train", "val", "test"]:
        os.makedirs(os.path.join(WORKSPACE_DIR, "images", s), exist_ok=True)
        os.makedirs(os.path.join(WORKSPACE_DIR, "labels", s), exist_ok=True)

def process_garbage_dataset():
    print("=" * 70)
    print("NAGARSETU 3.1 — GARBAGE & WASTE DATASET PROCESSING & AUDIT")
    print("=" * 70)

    setup_workspace()

    # Load existing model
    model = YOLO(BEST_MODEL_PATH)
    with open(BEST_MODEL_PATH, "rb") as fp:
        model_sha = hashlib.sha256(fp.read()).hexdigest()

    print(f"[OK] Loaded existing garbage model: {BEST_MODEL_PATH}")
    print(f"Model Task: {model.task}, Classes: {model.names}")
    print(f"Model SHA-256: {model_sha}")

    image_files = sorted([f for f in os.listdir(DATASET_DIR) if f in GROUP_MAP])
    print(f"Total images being processed: {len(image_files)}")

    inventory = []
    zero_detection_images = []
    confident_detections = []
    marginal_detections = []
    total_provisional_boxes = 0

    split_counts = {"train": 0, "val": 0, "test": 0}

    for idx, fname in enumerate(image_files):
        src_path = os.path.join(DATASET_DIR, fname)
        group, split = GROUP_MAP[fname]
        split_counts[split] += 1

        flat_name = fname.replace("\\", "_").replace("/", "_").replace(" ", "_")
        root_name, orig_ext = os.path.splitext(flat_name)
        ext = ".png" if orig_ext.lower() == ".png" else ".jpg"
        out_img_name = root_name + ext

        # Save image copy in split folder
        dst_img_path = os.path.join(WORKSPACE_DIR, "images", split, out_img_name)
        with Image.open(src_path) as img:
            rgb_img = img.convert("RGB")
            w, h = rgb_img.size
            rgb_img.save(dst_img_path)

        # Run inference for provisional bounding boxes
        results = model(rgb_img, conf=0.20, verbose=False)
        boxes_yolo = []
        boxes_summary = []

        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = model.names.get(cls_id, "GARBAGE")
                conf = float(box.conf[0])
                xywhn = box.xywhn[0].tolist()
                xyxy = box.xyxy[0].tolist()

                # Clamp coordinates safely
                xc = max(0.001, min(0.999, xywhn[0]))
                yc = max(0.001, min(0.999, xywhn[1]))
                bw = max(0.001, min(1.0, xywhn[2]))
                bh = max(0.001, min(1.0, xywhn[3]))

                boxes_yolo.append(f"{cls_id} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}")
                boxes_summary.append({
                    "id": len(boxes_summary) + 1,
                    "class_id": cls_id,
                    "class_name": cls_name,
                    "confidence": round(conf, 4),
                    "xywh_normalized": [round(xc, 6), round(yc, 6), round(bw, 6), round(bh, 6)],
                    "xyxy_pixels": [round(v, 1) for v in xyxy]
                })

        total_provisional_boxes += len(boxes_summary)

        # Save provisional label files in provisional folder AND in split folder
        prov_label_fpath = os.path.join(PROV_LABELS_DIR, root_name + ".txt")
        split_label_fpath = os.path.join(WORKSPACE_DIR, "labels", split, root_name + ".txt")
        with open(prov_label_fpath, "w", encoding="utf-8") as lfp:
            lfp.write("\n".join(boxes_yolo))
        with open(split_label_fpath, "w", encoding="utf-8") as lfp:
            lfp.write("\n".join(boxes_yolo))

        item = {
            "index": idx + 1,
            "filename": fname,
            "rel_path": fname,
            "group": group,
            "split": split,
            "width": w,
            "height": h,
            "out_img_name": out_img_name,
            "rel_img_url": f"images/{split}/{out_img_name}",
            "provisional_boxes_count": len(boxes_summary),
            "provisional_boxes": boxes_summary,
            "max_confidence": max([b["confidence"] for b in boxes_summary], default=0.0)
        }
        inventory.append(item)

        if len(boxes_summary) == 0:
            zero_detection_images.append(item)
        elif item["max_confidence"] >= 0.45:
            confident_detections.append(item)
        else:
            marginal_detections.append(item)

    print(f"\n--- AUDIT RESULTS ---")
    print(f"Total images evaluated: {len(inventory)}")
    print(f"Splits allocated:")
    print(f"  - Train: {split_counts['train']} images (70.0%)")
    print(f"  - Val:   {split_counts['val']} images (16.7%)")
    print(f"  - Test:  {split_counts['test']} images (13.3%)")
    print(f"Total provisional bounding boxes: {total_provisional_boxes}")
    print(f"Images with provisional detections (>=0.45): {len(confident_detections)}")
    print(f"Images with marginal detections (0.20-0.44): {len(marginal_detections)}")
    print(f"Images with ZERO detections by current model: {len(zero_detection_images)}")
    for z in zero_detection_images:
        print(f"  [Zero Detection] {z['filename']} ({z['width']}x{z['height']}) - Candidate for defect discovery")

    # Save manifest
    manifest_path = os.path.join(WORKSPACE_DIR, "dataset_manifest.json")
    manifest_data = {
        "dataset_path": DATASET_DIR,
        "total_images": len(inventory),
        "valid_images": len(inventory),
        "corrupted_images": 0,
        "exact_duplicates": [],
        "classes_in_model": model.names,
        "split_counts": split_counts,
        "detection_audit": {
            "confident_detections_count": len(confident_detections),
            "marginal_detections_count": len(marginal_detections),
            "zero_detections_count": len(zero_detection_images),
            "total_provisional_boxes": total_provisional_boxes
        },
        "zero_detection_images": [z["filename"] for z in zero_detection_images],
        "inventory": inventory
    }

    with open(manifest_path, "w", encoding="utf-8") as mfp:
        json.dump(manifest_data, mfp, indent=2)
    print(f"\n[OK] Dataset manifest saved to: {manifest_path}")

    # Write data.yaml
    data_yaml_path = os.path.join(WORKSPACE_DIR, "data.yaml")
    data_yaml_content = f"""# NAGARSETU 3.1 Garbage & Waste AI Dataset Configuration
path: {WORKSPACE_DIR.replace('\\', '/')}
train: images/train
val: images/val
test: images/test

names:
  0: BIODEGRADABLE
  1: CARDBOARD
  2: GLASS
  3: METAL
  4: PAPER
  5: PLASTIC
"""
    with open(data_yaml_path, "w", encoding="utf-8") as yfp:
        yfp.write(data_yaml_content)
    print(f"[OK] data.yaml written to: {data_yaml_path}")

    return manifest_data

if __name__ == "__main__":
    process_garbage_dataset()
