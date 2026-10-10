import os
import json
import hashlib
from PIL import Image

WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\water_pipe_v4"
NORMAL_DIR = r"D:\NAGARSETU\normal pipe images"
LEAKING_DIR = r"D:\NAGARSETU\leaking pipes"
FROZEN_TEST_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\water_pipe_v3\frozen_held_out_test_manifest.json"
MANIFEST_V4_PATH = os.path.join(WORKSPACE_DIR, "dataset_v4_manifest.json")

def prepare_v4_manifest():
    os.makedirs(WORKSPACE_DIR, exist_ok=True)

    # 1. Load frozen test set
    with open(FROZEN_TEST_PATH, "r", encoding="utf-8") as f:
        frozen_test = json.load(f)
    frozen_test_hashes = {item["sha256"]: item for item in frozen_test}
    print(f"Loaded {len(frozen_test)} frozen held-out test images.")

    # 2. Audit current images
    all_normal = sorted([f for f in os.listdir(NORMAL_DIR) if os.path.isfile(os.path.join(NORMAL_DIR, f))])
    
    # In leaking pipes, inspect root and subfolder '1'
    all_leaking_items = []
    for root, dirs, files in os.walk(LEAKING_DIR):
        for f in files:
            all_leaking_items.append((f, os.path.join(root, f)))

    # Deduplicate
    hashes = {}
    duplicates = []
    unique_images = []

    for f in all_normal:
        fp = os.path.join(NORMAL_DIR, f)
        with open(fp, "rb") as hf:
            h = hashlib.sha256(hf.read()).hexdigest()
        if h in hashes:
            duplicates.append((f, hashes[h]))
        else:
            hashes[h] = f
            unique_images.append({
                "filename": f,
                "path": fp,
                "label": 0,
                "class_name": "normal_pipe",
                "sha256": h,
                "folder": "normal"
            })

    for f, fp in all_leaking_items:
        with open(fp, "rb") as hf:
            h = hashlib.sha256(hf.read()).hexdigest()
        if h in hashes:
            duplicates.append((f, hashes[h]))
        else:
            hashes[h] = f
            unique_images.append({
                "filename": f,
                "path": fp,
                "label": 1,
                "class_name": "damaged_or_leaking_pipe",
                "sha256": h,
                "folder": "leaking"
            })

    # Group assignments for zero leakage
    def assign_group(fname, label):
        prefix = "normal_" if label == 0 else "leak_"
        if "WhatsApp" in fname:
            # Group by hour and minute block
            parts = fname.split("at ")
            if len(parts) > 1:
                time_part = parts[1][:5].replace(".", "_")
                return f"{prefix}whatsapp_{time_part}"
        elif "istock" in fname:
            return f"{prefix}istock_stock"
        elif "Screenshot" in fname:
            return f"{prefix}screenshot"
        elif "images (" in fname:
            return f"{prefix}images_batch_{fname[:10]}"
        return f"{prefix}single_{fname[:15]}"

    for item in unique_images:
        item["group"] = assign_group(item["filename"], item["label"])

    # Separate test vs training pool
    test_pool = []
    train_val_pool = []

    for item in unique_images:
        if item["sha256"] in frozen_test_hashes:
            test_pool.append(item)
        else:
            train_val_pool.append(item)

    # Identify genuinely new images since V3
    v3_manifest_path = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\water_pipe_v3\dataset_v3_manifest.json"
    v3_all_hashes = set()
    if os.path.exists(v3_manifest_path):
        with open(v3_manifest_path) as vf:
            v3_data = json.load(vf)
        for it in v3_data.get("training_pool", []) + v3_data.get("frozen_held_out_test", []):
            v3_all_hashes.add(it["sha256"])

    new_since_v3 = [it for it in unique_images if it["sha256"] not in v3_all_hashes]

    manifest = {
        "version": "v4.0",
        "dataset_name": "NAGARSETU Water Pipe Civic Infrastructure Dataset V4",
        "total_source_files": len(all_normal) + len(all_leaking_items),
        "total_unique_images": len(unique_images),
        "duplicates_excluded": duplicates,
        "genuinely_new_since_v3_count": len(new_since_v3),
        "genuinely_new_since_v3": new_since_v3,
        "classes": {
            "0": "normal_pipe",
            "1": "damaged_or_leaking_pipe"
        },
        "counts": {
            "normal_pipe": sum(1 for x in unique_images if x["label"] == 0),
            "damaged_or_leaking_pipe": sum(1 for x in unique_images if x["label"] == 1)
        },
        "frozen_held_out_test": test_pool,
        "train_val_pool": train_val_pool
    }

    with open(MANIFEST_V4_PATH, "w", encoding="utf-8") as mf:
        json.dump(manifest, mf, indent=2)

    print("=" * 60)
    print("WATER PIPE V4 DATASET AUDIT SUMMARY")
    print("=" * 60)
    print(f"Total source files:           {manifest['total_source_files']}")
    print(f"Unique valid images:          {manifest['total_unique_images']}")
    print(f"Duplicates excluded:          {len(duplicates)}")
    print(f"  Normal pipe images:         {manifest['counts']['normal_pipe']}")
    print(f"  Leaking pipe images:        {manifest['counts']['damaged_or_leaking_pipe']}")
    print(f"Genuinely new images since V3:{len(new_since_v3)}")
    for n in new_since_v3:
        print(f"  - {n['filename']} ({n['path']})")
    print(f"Frozen test images:           {len(test_pool)}")
    print(f"Train/Val pool images:        {len(train_val_pool)}")
    print(f"Manifest written to: {MANIFEST_V4_PATH}")

    return manifest

if __name__ == "__main__":
    prepare_v4_manifest()
