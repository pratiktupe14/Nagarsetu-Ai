import os
import sys
import hashlib
from pathlib import Path
from PIL import Image
import torch
from ultralytics import YOLO

DATASET_DIR = r"D:\NAGARSETU\garbage waste"
MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\best.pt"

def inspect_dataset_and_model():
    print("=" * 70)
    print("NAGARSETU 3.1 — GARBAGE & WASTE DATASET & MODEL INSPECTION")
    print("=" * 70)

    # 1. Model Inspection
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Model not found at: {MODEL_PATH}")

    with open(MODEL_PATH, "rb") as fp:
        model_sha = hashlib.sha256(fp.read()).hexdigest()

    model = YOLO(MODEL_PATH)
    total_params = sum(p.numel() for p in model.model.parameters())
    print(f"\n[MODEL INSPECTION: best.pt]")
    print(f"  Path: {MODEL_PATH}")
    print(f"  SHA-256: {model_sha}")
    print(f"  Task: {model.task}")
    print(f"  Classes: {model.names}")
    print(f"  Parameters: {total_params:,}")
    print(f"  Input size: 640")
    print(f"  Device: {'CUDA (' + torch.cuda.get_device_name(0) + ')' if torch.cuda.is_available() else 'CPU'}")

    # 2. Dataset Inspection
    if not os.path.exists(DATASET_DIR):
        raise FileNotFoundError(f"Dataset directory not found: {DATASET_DIR}")

    all_files = []
    for root, dirs, files in os.walk(DATASET_DIR):
        for f in files:
            all_files.append(os.path.join(root, f))

    image_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".avif", ".tiff"}
    image_files = []
    annotation_files = []
    other_files = []

    for f in all_files:
        ext = os.path.splitext(f)[1].lower()
        if ext in image_exts or f.endswith(".jpg-org"):
            image_files.append(f)
        elif ext in {".txt", ".xml", ".json", ".yaml"}:
            annotation_files.append(f)
        else:
            other_files.append(f)

    print(f"\n[DATASET INSPECTION: {DATASET_DIR}]")
    print(f"  Total files in directory: {len(all_files)}")
    print(f"  Image files found: {len(image_files)}")
    print(f"  Annotation files found: {len(annotation_files)}")
    print(f"  Other files: {len(other_files)}")

    # Check images validity & duplicates
    valid_images = []
    corrupted_images = []
    hashes = {}
    duplicates = []
    image_formats = set()

    for idx, fpath in enumerate(sorted(image_files)):
        rel = os.path.relpath(fpath, DATASET_DIR)
        with open(fpath, "rb") as fp:
            file_bytes = fp.read()
            h = hashlib.md5(file_bytes).hexdigest()

        if h in hashes:
            duplicates.append({"duplicate": rel, "original": hashes[h]})
        else:
            hashes[h] = rel

        try:
            with Image.open(fpath) as img:
                w, h_dim = img.size
                image_formats.add(img.format)
                valid_images.append({
                    "path": fpath,
                    "rel_path": rel,
                    "width": w,
                    "height": h_dim,
                    "format": img.format
                })
        except Exception as e:
            corrupted_images.append({"path": fpath, "error": str(e)})

    print(f"  Valid readable images: {len(valid_images)}")
    print(f"  Corrupted images: {len(corrupted_images)}")
    print(f"  Exact duplicates: {len(duplicates)}")
    for d in duplicates:
        print(f"    - Duplicate: {d['duplicate']} == {d['original']}")
    print(f"  Unique valid images: {len(valid_images) - len(duplicates)}")
    print(f"  Supported image formats: {sorted(list(image_formats))}")

    # Check if existing annotations correspond to YOLO labels
    print(f"\n[ANNOTATION STATUS]")
    if len(annotation_files) == 0:
        print("  NO pre-existing bounding-box annotations found (.txt/.xml/.json).")
        print("  Provisional annotations must be generated and audited before any supervised training.")
    else:
        print(f"  Found {len(annotation_files)} annotation files:")
        for a in annotation_files[:5]:
            print(f"    - {os.path.relpath(a, DATASET_DIR)}")

    # Run quick detection test using best.pt on first 3 images to check provisional predictions
    print(f"\n[SAMPLE PROVISIONAL DETECTION CHECK (conf=0.25)]")
    for item in valid_images[:5]:
        with Image.open(item["path"]) as im:
            res = model(im.convert("RGB"), conf=0.25, verbose=False)[0]
            boxes = res.boxes
            print(f"  Image: {item['rel_path']} ({item['width']}x{item['height']}) -> {len(boxes)} detections")
            for b in boxes[:3]:
                cls_id = int(b.cls[0])
                cls_name = model.names.get(cls_id, str(cls_id))
                conf = float(b.conf[0])
                print(f"    Box: {cls_name} (conf={conf:.3f})")

    return {
        "model_sha": model_sha,
        "classes": model.names,
        "total_images": len(image_files),
        "valid_images": len(valid_images),
        "corrupted_images": len(corrupted_images),
        "duplicates": duplicates,
        "unique_images": len(valid_images) - len(duplicates),
        "has_annotations": len(annotation_files) > 0,
        "valid_items": valid_images
    }

if __name__ == "__main__":
    inspect_dataset_and_model()
