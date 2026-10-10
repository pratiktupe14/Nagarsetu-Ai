import os
import sys
import gc
import json
import hashlib
from typing import Dict, Any, List
import numpy as np
from PIL import Image
import torch
from ultralytics import YOLO

sys.path.append(r"d:\NAGARSETU\NAGARSETU 3.1")

DATASET_DIR = r"D:\NAGARSETU\road"
CIVIC_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\civicmodel.pt"
WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\road_damage_v2"
PROVISIONAL_DIR = os.path.join(WORKSPACE_DIR, "provisional_annotations")
LABELS_DIR = os.path.join(PROVISIONAL_DIR, "labels")

os.makedirs(LABELS_DIR, exist_ok=True)

def process_road_dataset():
    print("=" * 70)
    print("NAGARSETU 3.1 — ROAD DAMAGE DATASET PROCESSING & ANNOTATION AUDIT")
    print("=" * 70)

    model = YOLO(CIVIC_MODEL_PATH)
    print(f"[OK] Loaded existing road model: {CIVIC_MODEL_PATH}")
    print(f"Model Task: {model.task}, Classes: {model.names}")

    all_entries = []
    for root, dirs, files in os.walk(DATASET_DIR):
        for f in files:
            all_entries.append(os.path.join(root, f))

    image_exts = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.avif'}
    image_files = [f for f in all_entries if os.path.splitext(f)[1].lower() in image_exts or f.endswith('.jpg-org')]

    print(f"Total image files found: {len(image_files)}")

    inventory = []
    hashes = {}
    duplicates = []
    detected_potholes = []
    zero_detection_images = []
    marginal_detection_images = []

    # Process each image
    for idx, fpath in enumerate(sorted(image_files)):
        fname = os.path.basename(fpath)
        rel_path = os.path.relpath(fpath, DATASET_DIR)
        ext = os.path.splitext(fname)[1].lower()

        # Compute file hash
        with open(fpath, "rb") as fp:
            file_bytes = fp.read()
            md5 = hashlib.md5(file_bytes).hexdigest()
            sha256 = hashlib.sha256(file_bytes).hexdigest()

        if md5 in hashes:
            duplicates.append({"duplicate": rel_path, "original": hashes[md5]})
            is_dup = True
        else:
            hashes[md5] = rel_path
            is_dup = False

        # Load image
        try:
            with Image.open(fpath) as img:
                rgb_img = img.convert("RGB")
                w, h = rgb_img.size
        except Exception as e:
            print(f"Error loading {fpath}: {e}")
            continue

        # Determine capture group to avoid data leakage
        if "Screenshot 2026-09-30 1440" in fname:
            group = "session_2026_09_30_video_sequence"
        elif "Screenshot 2026-10-01 08" in fname or "WhatsApp Image 2026-10-01" in fname:
            group = "session_2026_10_01_burst"
        elif "ROAD" in fname:
            group = "road_numbered_series"
        elif "Pothole_" in fname:
            group = "pothole_numbered_series"
        else:
            group = f"individual_{fname}"

        # Run model inference to propose provisional bounding boxes
        results = model(rgb_img, conf=0.20, verbose=False)
        boxes_yolo = []
        boxes_summary = []

        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = model.names.get(cls_id, "Pothole")
                conf = float(box.conf[0])
                xywhn = box.xywhn[0].tolist()
                xyxy = box.xyxy[0].tolist()

                boxes_yolo.append(f"{cls_id} {xywhn[0]:.6f} {xywhn[1]:.6f} {xywhn[2]:.6f} {xywhn[3]:.6f}")
                boxes_summary.append({
                    "class_id": cls_id,
                    "class_name": cls_name,
                    "confidence": round(conf, 4),
                    "xywh_normalized": [round(v, 4) for v in xywhn],
                    "xyxy_pixels": [round(v, 1) for v in xyxy]
                })

        # Save provisional label file in YOLO format
        label_fname = os.path.splitext(fname.replace(" ", "_"))[0] + ".txt"
        label_fpath = os.path.join(LABELS_DIR, label_fname)
        with open(label_fpath, "w", encoding="utf-8") as lfp:
            lfp.write("\n".join(boxes_yolo))

        item = {
            "index": idx + 1,
            "filename": fname,
            "rel_path": rel_path,
            "group": group,
            "width": w,
            "height": h,
            "bytes": len(file_bytes),
            "md5": md5,
            "sha256": sha256,
            "is_duplicate": is_dup,
            "provisional_boxes_count": len(boxes_summary),
            "provisional_boxes": boxes_summary,
            "max_confidence": max([b["confidence"] for b in boxes_summary], default=0.0)
        }
        inventory.append(item)

        if len(boxes_summary) == 0:
            zero_detection_images.append(item)
        elif item["max_confidence"] >= 0.50:
            detected_potholes.append(item)
        else:
            marginal_detection_images.append(item)

        if (idx + 1) % 15 == 0:
            print(f"Processed {idx + 1}/{len(image_files)} images...")
            gc.collect()

    print(f"\n--- AUDIT RESULTS ---")
    print(f"Total images evaluated: {len(inventory)}")
    print(f"Images with provisional pothole detections (>=0.50): {len(detected_potholes)}")
    print(f"Images with marginal detections (0.20-0.49):        {len(marginal_detection_images)}")
    print(f"Images with ZERO detections by current model:       {len(zero_detection_images)} (Candidates for annotation & missed defect discovery)")
    print(f"Exact duplicates found:                              {len(duplicates)}")
    for d in duplicates:
        print(f"  Duplicate: {d['duplicate']} == {d['original']}")

    # Identify hard examples
    hard_examples = []
    print("\n--- HARD EXAMPLES & ANNOTATION DEFICITS ---")
    for z in zero_detection_images:
        print(f"  [Zero Detection] {z['rel_path']} ({z['width']}x{z['height']}) - Needs human annotation of defect boundaries")
        hard_examples.append({
            "type": "missed_defect_or_unannotated_damage",
            "file": z["rel_path"],
            "resolution": f"{z['width']}x{z['height']}",
            "reason": "Existing YOLOv8s model produced 0 detections above 0.20 confidence threshold."
        })

    # Save dataset manifest
    manifest_path = os.path.join(WORKSPACE_DIR, "dataset_manifest.json")
    manifest_data = {
        "dataset_path": DATASET_DIR,
        "total_images": len(inventory),
        "valid_images": len(inventory),
        "corrupted_images": 0,
        "exact_duplicates": duplicates,
        "classes_in_model": model.names,
        "detection_audit": {
            "confident_detections_count": len(detected_potholes),
            "marginal_detections_count": len(marginal_detection_images),
            "zero_detections_count": len(zero_detection_images)
        },
        "hard_examples": hard_examples,
        "inventory": inventory
    }

    with open(manifest_path, "w", encoding="utf-8") as mfp:
        json.dump(manifest_data, mfp, indent=2)
    print(f"\n[OK] Dataset manifest saved to: {manifest_path}")

    # Generate data.yaml template for YOLOv8 training once annotations are verified
    data_yaml_path = os.path.join(WORKSPACE_DIR, "data.yaml")
    data_yaml_content = f"""# NAGARSETU 3.1 Road Damage Dataset Configuration
path: {WORKSPACE_DIR.replace('\\', '/')}
train: images/train
val: images/val
test: images/test

# Classes
names:
  0: Pothole
"""
    with open(data_yaml_path, "w", encoding="utf-8") as yfp:
        yfp.write(data_yaml_content)
    print(f"[OK] YOLOv8 dataset configuration template written to: {data_yaml_path}")

    return manifest_data

if __name__ == "__main__":
    process_road_dataset()
