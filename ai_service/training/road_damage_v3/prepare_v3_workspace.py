import os
import json
import shutil
from pathlib import Path

V2_WORKSPACE = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\road_damage_v2"
V3_WORKSPACE = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\road_damage_v3"
AUDIT_JSON_PATH = os.path.join(V2_WORKSPACE, "road_annotations_reviewed_audit.json")

EXCLUDED_FILENAMES = {
    "Screenshot 2026-10-10 013535.png",
    "Screenshot 2026-10-10 013621.png",
    "dc-Cover-anfegbfra3ee1mvanbf11fr9a2-20170822011319.Medi.jpeg"
}

def prepare_v3_labels():
    print("=" * 70)
    print("NAGARSETU 3.1 — PREPARING ROAD DAMAGE V3 ISOLATED WORKSPACE")
    print("=" * 70)

    with open(AUDIT_JSON_PATH, "r", encoding="utf-8") as f:
        audit_data = json.load(f)

    # Clean existing image and label directories in V3 workspace
    for s in ["train", "val", "test"]:
        img_dir = os.path.join(V3_WORKSPACE, "images", s)
        lbl_dir = os.path.join(V3_WORKSPACE, "labels", s)
        if os.path.exists(img_dir):
            shutil.rmtree(img_dir)
        if os.path.exists(lbl_dir):
            shutil.rmtree(lbl_dir)
        os.makedirs(img_dir, exist_ok=True)
        os.makedirs(lbl_dir, exist_ok=True)

    verified_images = []
    stats = {"train": {"images": 0, "boxes": 0}, "val": {"images": 0, "boxes": 0}, "test": {"images": 0, "boxes": 0}}
    excluded_count = 0

    for img in audit_data["images"]:
        filename = img["filename"]

        # Explicitly exclude the 3 unannotated images
        if filename in EXCLUDED_FILENAMES or not img.get("is_fully_reviewed", False):
            excluded_count += 1
            print(f"  [EXCLUDED] {filename} (unannotated zero-detection image)")
            continue

        split = img["split"]
        rel_path = img["rel_path"]

        flat_name = rel_path.replace("\\", "_").replace("/", "_").replace(" ", "_")
        root_name, orig_ext = os.path.splitext(flat_name)
        ext = ".png" if orig_ext.lower() == ".png" else ".jpg"
        clean_img_name = root_name + ext

        # Source image in V2
        src_img_path = os.path.join(V2_WORKSPACE, "images", split, clean_img_name)
        dst_img_path = os.path.join(V3_WORKSPACE, "images", split, clean_img_name)
        if not os.path.exists(src_img_path):
            raise FileNotFoundError(f"Source image not found: {src_img_path}")
        shutil.copy2(src_img_path, dst_img_path)

        # Build YOLO label content
        yolo_lines = []
        approved_boxes = []
        for b in img["boxes"]:
            if b["status"] == "correct":
                coords = b["adjusted_xywh"] if b.get("adjusted_xywh") else b["xywh_normalized"]
                xc = max(0.001, min(0.999, coords[0]))
                yc = max(0.001, min(0.999, coords[1]))
                bw = max(0.001, min(1.0, coords[2]))
                bh = max(0.001, min(1.0, coords[3]))
                yolo_lines.append(f"0 {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}")
                approved_boxes.append(b)
                stats[split]["boxes"] += 1

        label_path = os.path.join(V3_WORKSPACE, "labels", split, root_name + ".txt")
        with open(label_path, "w", encoding="utf-8") as lfp:
            lfp.write("\n".join(yolo_lines))

        stats[split]["images"] += 1
        verified_images.append({
            "image_id": img["image_id"],
            "filename": filename,
            "split": split,
            "group": img["group"],
            "width": img["dimensions"]["width"],
            "height": img["dimensions"]["height"],
            "approved_boxes_count": len(approved_boxes),
            "approved_boxes": approved_boxes
        })

    total_boxes = sum(s["boxes"] for s in stats.values())
    print(f"\n[OK] V3 dataset isolation complete:")
    print(f"     Total verified images: {len(verified_images)} (Excluded: {excluded_count})")
    print(f"     Total approved boxes:  {total_boxes}")
    print(f"     - Train split: {stats['train']['images']} images, {stats['train']['boxes']} boxes")
    print(f"     - Val split:   {stats['val']['images']} images, {stats['val']['boxes']} boxes")
    print(f"     - Test split:  {stats['test']['images']} images, {stats['test']['boxes']} boxes")

    assert len(verified_images) == 56, f"Expected 56 images, got {len(verified_images)}"
    assert total_boxes == 487, f"Expected 487 approved boxes, got {total_boxes}"
    assert stats["test"]["images"] == 9, f"Expected 9 test images, got {stats['test']['images']}"
    assert stats["train"]["images"] == 39, f"Expected 39 train images, got {stats['train']['images']}"
    assert stats["val"]["images"] == 8, f"Expected 8 val images, got {stats['val']['images']}"

    # Generate V3 data.yaml
    data_yaml_content = f"""# NAGARSETU 3.1 Road Damage AI V3 Dataset
path: {V3_WORKSPACE.replace('\\', '/')}
train: images/train
val: images/val
test: images/test

names:
  0: Pothole
"""
    yaml_path = os.path.join(V3_WORKSPACE, "data.yaml")
    with open(yaml_path, "w", encoding="utf-8") as yf:
        yf.write(data_yaml_content)

    manifest_v3 = {
        "status": "VALIDATED_GROUND_TRUTH_ISOLATED",
        "total_verified_images": len(verified_images),
        "total_approved_boxes": total_boxes,
        "split_statistics": stats,
        "excluded_unannotated_images": list(EXCLUDED_FILENAMES),
        "data_yaml_path": yaml_path,
        "images": verified_images
    }
    with open(os.path.join(V3_WORKSPACE, "dataset_v3_manifest.json"), "w", encoding="utf-8") as mf:
        json.dump(manifest_v3, mf, indent=2)

    print(f"[OK] V3 dataset manifest saved to: {os.path.join(V3_WORKSPACE, 'dataset_v3_manifest.json')}")
    return manifest_v3

if __name__ == "__main__":
    prepare_v3_labels()
