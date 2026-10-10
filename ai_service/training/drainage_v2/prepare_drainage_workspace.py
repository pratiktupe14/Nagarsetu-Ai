import os
import json
import hashlib
import shutil
from collections import defaultdict
from PIL import Image

DRAINAGE_DIR = r"D:\NAGARSETU\drainage images"
WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\drainage_v2"
CATALOG_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\data\drainage_catalog.json"

def setup_workspace():
    os.makedirs(WORKSPACE_DIR, exist_ok=True)
    images_dir = os.path.join(WORKSPACE_DIR, "images")
    os.makedirs(images_dir, exist_ok=True)

    # 1. Load catalog
    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        cat_data = json.load(f)
    catalog = cat_data.get("catalog", {})
    known_duplicates = cat_data.get("duplicates", {})

    # Sort files preferring cataloged names first so primary has catalog label
    all_files = sorted(
        [f for f in os.listdir(DRAINAGE_DIR) if os.path.isfile(os.path.join(DRAINAGE_DIR, f))],
        key=lambda x: (0 if x in catalog else 1, x)
    )

    # 2. Hash check & deduplication
    file_hashes = {}
    hash_to_primary = {}
    duplicates = {}
    valid_unique_files = []

    for f in all_files:
        fp = os.path.join(DRAINAGE_DIR, f)
        with open(fp, "rb") as hf:
            h = hashlib.sha256(hf.read()).hexdigest()
        file_hashes[f] = h
        if h in hash_to_primary:
            duplicates[f] = hash_to_primary[h]
        else:
            hash_to_primary[h] = f
            valid_unique_files.append(f)

    print(f"Total files in folder: {len(all_files)}")
    print(f"Valid unique images: {len(valid_unique_files)}")
    print(f"Duplicates identified: {len(duplicates)}")

    # 3. Session grouping to prevent leakage
    def get_session_group(filename):
        if filename.startswith("WhatsApp Image 2026-10-09 at 12.40"):
            return "session_oct09_1240"
        elif filename.startswith("WhatsApp Image 2026-10-09 at 12.45"):
            return "session_oct09_1245"
        elif filename.startswith("WhatsApp Image 2026-10-09 at 12.51"):
            return "session_oct09_1251"
        elif filename.startswith("WhatsApp Image 2026-10-09 at 2.42"):
            return "session_oct09_1442"
        elif filename.startswith("Screenshot 2026-10-09"):
            return "session_oct09_screenshot"
        elif filename.startswith("images ("):
            prefix = filename.split(" ")[0]
            return f"session_images_batch"
        elif filename.startswith("09d2afff"):
            return "session_burst_09d2"
        else:
            return f"session_single_{filename[:12]}"

    # 4. Inventory compilation
    inventory = []
    normal_count = 0
    broken_count = 0
    overflow_count = 0
    blocked_count = 0
    unreviewed_count = 0

    for idx, fname in enumerate(valid_unique_files, 1):
        src_path = os.path.join(DRAINAGE_DIR, fname)
        im = Image.open(src_path)
        w, h = im.size
        group = get_session_group(fname)

        # Check existing catalog label
        raw_label = catalog.get(fname)
        is_verified = (raw_label is not None)

        if raw_label == "NORMAL_DRAIN":
            mapped_label = "normal_drain"
            normal_count += 1
        elif raw_label == "DAMAGED_DRAIN":
            mapped_label = "damaged_drain"
            broken_count += 1
        elif raw_label == "DRAIN_OVERFLOW":
            mapped_label = "blocked_drain"  # grouped with blocked in 3-class system
            overflow_count += 1
            blocked_count += 1
        elif raw_label == "BLOCKED_DRAIN":
            mapped_label = "blocked_drain"
            blocked_count += 1
        else:
            # Uncataloged 7 images
            unreviewed_count += 1
            is_verified = False
            # Visual heuristic suggestion
            if "Repaired" in fname:
                mapped_label = "normal_drain"
            elif "2.42" in fname:
                mapped_label = "damaged_drain"
            else:
                mapped_label = "damaged_drain"

        # Copy to workspace images for browser review
        dest_name = f"img_{idx:03d}_{fname.replace(' ', '_').replace('(', '').replace(')', '')}"
        dest_path = os.path.join(images_dir, dest_name)
        if not os.path.exists(dest_path):
            shutil.copy2(src_path, dest_path)

        inventory.append({
            "index": idx,
            "filename": fname,
            "relative_url": f"images/{dest_name}",
            "width": w,
            "height": h,
            "sha256": file_hashes[fname],
            "group": group,
            "catalog_label": raw_label,
            "assigned_label": mapped_label,
            "is_overflow": (raw_label == "DRAIN_OVERFLOW"),
            "is_verified": is_verified,
            "status": "verified" if is_verified else "needs_review"
        })

    # Summary
    summary = {
        "total_files_in_source": len(all_files),
        "valid_unique_images": len(valid_unique_files),
        "exact_duplicates": len(duplicates),
        "verified_labeled_images": len(valid_unique_files) - unreviewed_count,
        "uncataloged_images": unreviewed_count,
        "class_breakdown_unique": {
            "normal_drain": normal_count,
            "damaged_drain (broken)": broken_count,
            "blocked_drain": blocked_count,
            "drain_overflow (subset of blocked)": overflow_count
        }
    }

    manifest = {
        "metadata": summary,
        "duplicates": duplicates,
        "inventory": inventory
    }

    manifest_path = os.path.join(WORKSPACE_DIR, "dataset_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print("\n" + "=" * 60)
    print("DRAINAGE DATASET AUDIT SUMMARY")
    print("=" * 60)
    print(f"Total images in folder:       {summary['total_files_in_source']}")
    print(f"Valid unique images:          {summary['valid_unique_images']}")
    print(f"Exact binary duplicates:      {summary['exact_duplicates']}")
    print(f"Verified labeled images:      {summary['verified_labeled_images']}")
    print(f"Images requiring review:      {summary['uncataloged_images']}")
    print(f"  Normal drain:               {normal_count}")
    print(f"  Damaged/Broken drain:       {broken_count}")
    print(f"  Blocked drain:              {blocked_count} (including {overflow_count} overflowing)")
    print(f"Manifest written to: {manifest_path}")

    return manifest

if __name__ == "__main__":
    setup_workspace()
