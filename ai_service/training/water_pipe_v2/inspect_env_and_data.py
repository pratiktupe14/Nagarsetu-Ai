import os
import sys
import json
import hashlib
from PIL import Image
import torch
import torchvision

def run_inspection():
    print("=== ENVIRONMENT CHECK ===")
    print(f"Python: {sys.version}")
    print(f"PyTorch: {torch.__version__}")
    print(f"TorchVision: {torchvision.__version__}")
    cuda_avail = torch.cuda.is_available()
    print(f"CUDA Available: {cuda_avail}")
    if cuda_avail:
        print(f"CUDA Device: {torch.cuda.get_device_name(0)}")
    else:
        print("Device: CPU")

    print("\n=== BASELINE MODEL CHECK ===")
    model_path = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\water_pipe_model.pt"
    if os.path.exists(model_path):
        ckpt = torch.load(model_path, map_location="cpu")
        print(f"Model exists: {model_path} ({os.path.getsize(model_path):,} bytes)")
        print(f"Keys in checkpoint: {list(ckpt.keys())}")
        print(f"Classes: {ckpt.get('classes')}")
        print(f"Class names: {ckpt.get('class_names')}")
        print(f"Num classes: {ckpt.get('num_classes')}")
        print(f"Input size: {ckpt.get('input_size')}")
        print(f"Mean: {ckpt.get('mean')}")
        print(f"Std: {ckpt.get('std')}")
        if "metrics" in ckpt:
            print("Checkpoint metrics:", json.dumps(ckpt["metrics"], indent=2))
    else:
        print(f"Model not found at: {model_path}")

    metrics_json_path = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\pipe_model_metrics.json"
    if os.path.exists(metrics_json_path):
        with open(metrics_json_path, "r", encoding="utf-8") as f:
            print("Existing metrics.json:", f.read())

    print("\n=== DATASET DIRECTORY INSPECTION ===")
    dir_normal = r"D:\NAGARSETU\normal pipe images"
    dir_leak = r"D:\NAGARSETU\leaking pipes"

    def inspect_dir(dpath, label_name):
        print(f"\n--- Inspecting: {label_name} ({dpath}) ---")
        if not os.path.exists(dpath):
            print(f"ERROR: Directory does not exist: {dpath}")
            return []
        
        files = os.listdir(dpath)
        print(f"Total entries in directory: {len(files)}")
        
        valid_images = []
        corrupted = []
        format_counts = {}
        hashes = {}
        duplicates = []
        
        for fname in sorted(files):
            fpath = os.path.join(dpath, fname)
            if not os.path.isfile(fpath):
                continue
            ext = os.path.splitext(fname)[1].lower()
            format_counts[ext] = format_counts.get(ext, 0) + 1
            
            # Check hash for duplicates
            with open(fpath, "rb") as fp:
                file_hash = hashlib.md5(fp.read()).hexdigest()
            if file_hash in hashes:
                duplicates.append((fname, hashes[file_hash]))
            else:
                hashes[file_hash] = fname

            # Try loading image
            try:
                with Image.open(fpath) as img:
                    img.verify()
                # Reopen to check convert
                with Image.open(fpath) as img:
                    rgb = img.convert("RGB")
                    w, h = rgb.size
                valid_images.append({
                    "name": fname,
                    "path": fpath,
                    "format": ext,
                    "size": (w, h),
                    "file_bytes": os.path.getsize(fpath),
                    "hash": file_hash
                })
            except Exception as e:
                corrupted.append((fname, str(e)))

        print(f"Format counts: {format_counts}")
        print(f"Valid readable images: {len(valid_images)}")
        print(f"Corrupted images: {len(corrupted)}")
        if corrupted:
            for c in corrupted:
                print(f"  Corrupted: {c}")
        print(f"Exact duplicates detected: {len(duplicates)}")
        if duplicates:
            for d in duplicates:
                print(f"  Duplicate: {d[0]} == {d[1]}")

        return valid_images

    normal_imgs = inspect_dir(dir_normal, "NORMAL_PIPES")
    leak_imgs = inspect_dir(dir_leak, "LEAKING_AND_DAMAGED_PIPES")

    # Check cross-directory duplicates
    normal_hashes = {img["hash"]: img["name"] for img in normal_imgs}
    cross_dups = []
    for img in leak_imgs:
        if img["hash"] in normal_hashes:
            cross_dups.append((img["name"], normal_hashes[img["hash"]]))
    print(f"\nCross-directory duplicates between normal and leak: {len(cross_dups)}")
    if cross_dups:
        for cd in cross_dups:
            print(f"  Cross dup: Leak '{cd[0]}' == Normal '{cd[1]}'")

    # Detailed file list in leaking pipes to examine naming / contents
    print("\n--- Leaking / Damaged Pipes Filenames ---")
    for img in leak_imgs:
        print(f"  {img['name']} ({img['size'][0]}x{img['size'][1]}, {img['file_bytes']:,} bytes)")

    print("\n--- Normal Pipes Filenames ---")
    for img in normal_imgs:
        print(f"  {img['name']} ({img['size'][0]}x{img['size'][1]}, {img['file_bytes']:,} bytes)")

if __name__ == "__main__":
    run_inspection()
