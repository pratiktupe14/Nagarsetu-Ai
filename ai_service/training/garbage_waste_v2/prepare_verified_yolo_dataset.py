import os
import sys
import json
from pathlib import Path

WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\garbage_waste_v2"
REVIEWED_JSON_PATH = os.path.join(WORKSPACE_DIR, "garbage_annotations_reviewed.json")
DATA_YAML_PATH = os.path.join(WORKSPACE_DIR, "data.yaml")
IMAGES_DIR = os.path.join(WORKSPACE_DIR, "images")
LABELS_DIR = os.path.join(WORKSPACE_DIR, "labels")

# Supported classes in best.pt
CLASS_MAPPING = {
    0: "BIODEGRADABLE",
    1: "CARDBOARD",
    2: "GLASS",
    3: "METAL",
    4: "PAPER",
    5: "PLASTIC"
}

def prepare_yolo_dataset(allow_partial=False):
    if not os.path.exists(REVIEWED_JSON_PATH):
        raise FileNotFoundError(f"Review JSON not found: {REVIEWED_JSON_PATH}")

    with open(REVIEWED_JSON_PATH, "r", encoding="utf-8") as f:
        review_data = json.load(f)

    images = review_data.get("images", [])
    print(f"Loaded {len(images)} images from {REVIEWED_JSON_PATH}")

    total_approved = 0
    total_rejected = 0
    total_adjusted_completed = 0
    total_pending = 0
    total_adj_unresolved = 0

    complete_images = []
    incomplete_images = []

    for img in images:
        fname = img["filename"]
        split = img["split"]
        boxes = img.get("boxes", [])
        
        has_pending = False
        has_unresolved_adj = False
        approved_in_img = []

        for b in boxes:
            st = b.get("status", "pending")
            if st == "correct":
                total_approved += 1
                coords = b.get("adjusted_xywh") or b["xywh_normalized"]
                approved_in_img.append((b["class_id"], coords))
            elif st == "incorrect":
                total_rejected += 1
            elif st == "needs_adjustment":
                if b.get("adjusted_xywh") and b.get("is_confirmed", False):
                    total_adjusted_completed += 1
                    total_approved += 1
                    approved_in_img.append((b["class_id"], b["adjusted_xywh"]))
                else:
                    has_unresolved_adj = True
                    total_adj_unresolved += 1
            elif st == "pending":
                has_pending = True
                total_pending += 1

        is_complete = (not has_pending) and (not has_unresolved_adj)
        if is_complete and (len(boxes) > 0 or img.get("missing_garbage_flag")):
            complete_images.append({
                "filename": fname,
                "split": split,
                "approved_boxes": approved_in_img
            })
        else:
            incomplete_images.append({
                "filename": fname,
                "split": split,
                "boxes": boxes,
                "has_pending": has_pending,
                "has_unresolved_adj": has_unresolved_adj
            })

    print("-" * 60)
    print(f"Summary of Reviews:")
    print(f"  Approved boxes:             {total_approved}")
    print(f"  Rejected boxes (excluded):  {total_rejected}")
    print(f"  Adjusted boxes completed:   {total_adjusted_completed}")
    print(f"  Adjusted boxes unresolved:  {total_adj_unresolved}")
    print(f"  Pending boxes:              {total_pending}")
    print(f"  Fully verified images:      {len(complete_images)} / {len(images)}")
    print(f"  Incomplete images:          {len(incomplete_images)}")
    print("-" * 60)

    if incomplete_images:
        print("Incomplete images requiring human decision:")
        for inc in incomplete_images:
            print(f"  - {inc['filename']} (Split: {inc['split']}, Pending: {inc['has_pending']}, Unresolved Adj: {inc['has_unresolved_adj']})")

    if not allow_partial and incomplete_images:
        print("\n[BLOCKED] All annotations must be human-confirmed before full training export.")
        return False, complete_images, incomplete_images

    # Export labels for verified images
    for comp in complete_images:
        fname = comp["filename"]
        split = comp["split"]
        approved_boxes = comp["approved_boxes"]

        flat_name = fname.replace("\\", "_").replace("/", "_").replace(" ", "_")
        root_name, _ = os.path.splitext(flat_name)
        label_file = os.path.join(LABELS_DIR, split, f"{root_name}.txt")

        os.makedirs(os.path.dirname(label_file), exist_ok=True)
        with open(label_file, "w", encoding="utf-8") as lf:
            for cls_id, (xc, yc, bw, bh) in approved_boxes:
                # Clamp coordinates to [0, 1]
                xc = max(0.0, min(1.0, float(xc)))
                yc = max(0.0, min(1.0, float(yc)))
                bw = max(0.001, min(1.0, float(bw)))
                bh = max(0.001, min(1.0, float(bh)))
                lf.write(f"{cls_id} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}\n")

    print(f"[OK] Wrote YOLO labels for {len(complete_images)} verified images.")
    return True, complete_images, incomplete_images

if __name__ == "__main__":
    allow = "--allow-partial" in sys.argv
    prepare_yolo_dataset(allow_partial=allow)
