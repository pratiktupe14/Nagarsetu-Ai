import os
import json
import math
from pathlib import Path
from PIL import Image

WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\road_damage_v2"
MANIFEST_PATH = os.path.join(WORKSPACE_DIR, "dataset_manifest.json")
REPORT_PATH = os.path.join(WORKSPACE_DIR, "validation_audit_report.json")

from prepare_dataset_splits import IMAGE_GROUP_MAP, GROUP_SPLIT_MAP

def compute_iou(b1, b2):
    # b: [xc, yc, w, h]
    x1_a, y1_a = b1[0] - b1[2] / 2, b1[1] - b1[3] / 2
    x2_a, y2_a = b1[0] + b1[2] / 2, b1[1] + b1[3] / 2
    
    x1_b, y1_b = b2[0] - b2[2] / 2, b2[1] - b2[3] / 2
    x2_b, y2_b = b2[0] + b2[2] / 2, b2[1] + b2[3] / 2
    
    ix1, iy1 = max(x1_a, x1_b), max(y1_a, y1_b)
    ix2, iy2 = min(x2_a, x2_b), min(y2_a, y2_b)
    
    if ix2 > ix1 and iy2 > iy1:
        inter = (ix2 - ix1) * (iy2 - iy1)
        area_a = (x2_a - x1_a) * (y2_a - y1_a)
        area_b = (x2_b - x1_b) * (y2_b - y1_b)
        union = area_a + area_b - inter
        return inter / union if union > 0 else 0.0
    return 0.0

def run_validation():
    print("=" * 70)
    print("NAGARSETU 3.1 — PHASE 2: AUTOMATED ANNOTATION & DATASET VALIDATION")
    print("=" * 70)

    if not os.path.exists(MANIFEST_PATH):
        raise FileNotFoundError(f"Manifest not found: {MANIFEST_PATH}")

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    inventory = manifest.get("inventory", [])
    print(f"Total image entries discovered: {len(inventory)}")

    total_boxes = 0
    clamped_boxes = 0
    duplicate_boxes_found = 0
    overlapping_pairs = 0
    low_confidence_boxes = 0
    zero_detection_images = []
    readable_images = 0

    validated_inventory = []

    for item in inventory:
        rel_path = item["rel_path"]
        group = IMAGE_GROUP_MAP.get(rel_path, "default_group")
        split = GROUP_SPLIT_MAP.get(group, "train")

        flat_name = rel_path.replace("\\", "_").replace("/", "_").replace(" ", "_")
        root_name, orig_ext = os.path.splitext(flat_name)
        ext = ".png" if orig_ext.lower() == ".png" else ".jpg"
        out_name = root_name + ext
        img_disk_path = os.path.join(WORKSPACE_DIR, "images", split, out_name)

        # 1. Verify image exists and is readable
        if not os.path.exists(img_disk_path):
            raise FileNotFoundError(f"Image not found at {img_disk_path}")
        
        try:
            with Image.open(img_disk_path) as im:
                im_w, im_h = im.size
                im_format = im.format
                readable_images += 1
        except Exception as e:
            raise RuntimeError(f"Unreadable image {img_disk_path}: {e}")

        # Validate bounding boxes
        p_boxes = item.get("provisional_boxes", [])
        total_boxes += len(p_boxes)

        if len(p_boxes) == 0:
            zero_detection_images.append(item["filename"])

        clean_boxes = []
        seen_coords = set()

        for b_idx, box in enumerate(p_boxes):
            norm = box["xywh_normalized"]
            xc, yc, bw, bh = norm[0], norm[1], norm[2], norm[3]

            # Deterministic repair: clamp safe boundary overflows
            orig_xc, orig_yc, orig_bw, orig_bh = xc, yc, bw, bh
            xc = max(0.005, min(0.995, xc))
            yc = max(0.005, min(0.995, yc))
            bw = max(0.005, min(1.0, bw))
            bh = max(0.005, min(1.0, bh))

            if (xc != orig_xc) or (yc != orig_yc) or (bw != orig_bw) or (bh != orig_bh):
                clamped_boxes += 1

            coord_key = (round(xc, 4), round(yc, 4), round(bw, 4), round(bh, 4))
            if coord_key in seen_coords:
                duplicate_boxes_found += 1
                continue  # remove exact identical duplicate
            seen_coords.add(coord_key)

            conf = box.get("confidence", 0.0)
            if conf < 0.35:
                low_confidence_boxes += 1

            # Recalculate pixel coordinates accurately
            x1 = max(0.0, (xc - bw / 2.0) * im_w)
            y1 = max(0.0, (yc - bh / 2.0) * im_h)
            x2 = min(float(im_w), (xc + bw / 2.0) * im_w)
            y2 = min(float(im_h), (yc + bh / 2.0) * im_h)

            clean_boxes.append({
                "id": b_idx + 1,
                "class_id": 0,
                "class_name": "Pothole",
                "confidence": round(conf, 4),
                "xywh_normalized": [round(xc, 6), round(yc, 6), round(bw, 6), round(bh, 6)],
                "xyxy_pixels": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)]
            })

        # Overlap check
        for i in range(len(clean_boxes)):
            for j in range(i + 1, len(clean_boxes)):
                iou = compute_iou(clean_boxes[i]["xywh_normalized"], clean_boxes[j]["xywh_normalized"])
                if iou > 0.40:
                    overlapping_pairs += 1

        validated_inventory.append({
            "index": item["index"],
            "filename": item["filename"],
            "rel_path": rel_path,
            "group": group,
            "split": split,
            "width": im_w,
            "height": im_h,
            "format": im_format,
            "box_count": len(clean_boxes),
            "boxes": clean_boxes
        })

    print(f"[OK] Images verified readable: {readable_images}/{len(inventory)} (100%)")
    print(f"[OK] Total provisional boxes validated: {total_boxes}")
    print(f"[OK] Boundary coordinates clamped safely: {clamped_boxes}")
    print(f"[OK] Redundant duplicate boxes detected: {duplicate_boxes_found}")
    print(f"[OK] Overlapping box pairs flagged: {overlapping_pairs}")
    print(f"[OK] Low-confidence boxes (<0.35) flagged: {low_confidence_boxes}")
    print(f"[OK] Zero-detection defect discovery candidates: {len(zero_detection_images)}")
    for zd in zero_detection_images:
        print(f"     - {zd}")

    report = {
        "validation_status": "PASSED",
        "dataset_summary": {
            "total_images": len(inventory),
            "readable_images": readable_images,
            "total_provisional_boxes": total_boxes,
            "clamped_boxes": clamped_boxes,
            "exact_duplicate_boxes": duplicate_boxes_found,
            "overlapping_box_pairs_flagged": overlapping_pairs,
            "low_confidence_boxes_flagged": low_confidence_boxes,
            "zero_detection_images": zero_detection_images
        },
        "inventory": validated_inventory
    }

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"[OK] Validation audit report saved to: {REPORT_PATH}")
    return report

if __name__ == "__main__":
    run_validation()
