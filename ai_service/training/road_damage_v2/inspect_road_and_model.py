import os
import sys
import json
import hashlib
from PIL import Image
import torch

def run_inspection():
    print("=" * 70)
    print("NAGARSETU 3.1 — ROAD DAMAGE MODEL & DATASET INSPECTION")
    print("=" * 70)

    # 1. Inspect Environment
    print("\n--- 1. ENVIRONMENT ---")
    print(f"Python: {sys.version}")
    print(f"PyTorch: {torch.__version__}")
    cuda_avail = torch.cuda.is_available()
    print(f"CUDA Available: {cuda_avail}")
    if cuda_avail:
        print(f"GPU Device: {torch.cuda.get_device_name(0)}")
    else:
        print("Device: CPU")

    # 2. Inspect Existing Road Model (civicmodel.pt)
    print("\n--- 2. EXISTING ROAD MODEL (civicmodel.pt) ---")
    model_path = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\civicmodel.pt"
    if os.path.exists(model_path):
        size_bytes = os.path.getsize(model_path)
        print(f"Model Path: {model_path} ({size_bytes:,} bytes)")
        with open(model_path, "rb") as fp:
            sha256 = hashlib.sha256(fp.read()).hexdigest()
        print(f"SHA-256: {sha256}")

        try:
            from ultralytics import YOLO
            model = YOLO(model_path)
            print(f"YOLO Model Loaded successfully.")
            print(f"Task: {getattr(model, 'task', 'unknown')}")
            print(f"Classes (names dict): {model.names}")
            print(f"Number of classes: {len(model.names) if model.names else 0}")
            if hasattr(model, 'model') and model.model is not None:
                total_params = sum(p.numel() for p in model.model.parameters())
                print(f"Total Parameters: {total_params:,}")
                if hasattr(model.model, 'yaml'):
                    print(f"Model YAML: {model.model.yaml}")
                if hasattr(model.model, 'args'):
                    print(f"Model Args: {model.model.args}")
        except Exception as e:
            print(f"Error inspecting YOLO model: {e}")
    else:
        print(f"ERROR: Model not found at {model_path}")

    # 3. Inspect Dataset Directory (D:\NAGARSETU\road)
    print("\n--- 3. DATASET INSPECTION (D:\\NAGARSETU\\road) ---")
    dataset_dir = r"D:\NAGARSETU\road"
    if not os.path.exists(dataset_dir):
        print(f"ERROR: Dataset directory not found: {dataset_dir}")
        return

    all_entries = []
    for root, dirs, files in os.walk(dataset_dir):
        for f in files:
            all_entries.append(os.path.join(root, f))

    print(f"Total files found recursively: {len(all_entries)}")

    # Classify files by type
    image_exts = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.avif', '.tiff'}
    annotation_exts = {'.txt', '.xml', '.json', '.yaml', '.yml', '.csv'}

    image_files = []
    annotation_files = []
    other_files = []

    for fpath in all_entries:
        ext = os.path.splitext(fpath)[1].lower()
        if ext in image_exts:
            image_files.append(fpath)
        elif ext in annotation_exts:
            annotation_files.append(fpath)
        else:
            other_files.append(fpath)

    print(f"Image files: {len(image_files)}")
    print(f"Annotation/text files: {len(annotation_files)}")
    print(f"Other files: {len(other_files)}")

    if annotation_files:
        print("\nAnnotation files list:")
        for af in annotation_files:
            rel = os.path.relpath(af, dataset_dir)
            print(f"  {rel} ({os.path.getsize(af)} bytes)")

    # Validate each image
    print("\nValidating images...")
    valid_images = []
    corrupted_images = []
    hashes = {}
    duplicates = []
    resolutions = {}
    format_counts = {}

    for fpath in sorted(image_files):
        fname = os.path.basename(fpath)
        rel_path = os.path.relpath(fpath, dataset_dir)
        ext = os.path.splitext(fname)[1].lower()
        format_counts[ext] = format_counts.get(ext, 0) + 1

        # Check MD5 hash
        try:
            with open(fpath, "rb") as fp:
                file_bytes = fp.read()
                file_hash = hashlib.md5(file_bytes).hexdigest()
            if file_hash in hashes:
                duplicates.append((rel_path, hashes[file_hash]))
            else:
                hashes[file_hash] = rel_path
        except Exception as e:
            corrupted_images.append((rel_path, f"Read error: {e}"))
            continue

        # Check PIL image loading
        try:
            with Image.open(fpath) as img:
                img.verify()
            with Image.open(fpath) as img:
                rgb = img.convert("RGB")
                w, h = rgb.size
                mode = img.mode
            res_key = f"{w}x{h}"
            resolutions[res_key] = resolutions.get(res_key, 0) + 1
            valid_images.append({
                "path": fpath,
                "rel_path": rel_path,
                "name": fname,
                "size": (w, h),
                "format": ext,
                "bytes": os.path.getsize(fpath),
                "hash": file_hash
            })
        except Exception as e:
            corrupted_images.append((rel_path, f"Corrupted image: {e}"))

    print(f"Valid readable images: {len(valid_images)}")
    print(f"Corrupted images: {len(corrupted_images)}")
    if corrupted_images:
        for c in corrupted_images:
            print(f"  {c[0]}: {c[1]}")
    print(f"Exact duplicates detected: {len(duplicates)}")
    if duplicates:
        for d in duplicates:
            print(f"  {d[0]} == {d[1]}")

    print(f"\nImage format distribution: {format_counts}")
    print(f"Unique image resolutions ({len(resolutions)} distinct sizes):")
    for r, count in sorted(resolutions.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"  {r}: {count} images")

    # List first 15 images
    print("\nSample image filenames:")
    for img in valid_images[:15]:
        print(f"  {img['rel_path']} ({img['size'][0]}x{img['size'][1]}, {img['bytes']:,} bytes)")
    if len(valid_images) > 15:
        print(f"  ... and {len(valid_images)-15} more")

if __name__ == "__main__":
    run_inspection()
