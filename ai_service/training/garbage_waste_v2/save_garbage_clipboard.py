import os
import json
import time
import shutil

TARGET = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\garbage_waste_v2\garbage_annotations_reviewed.json"

try:
    import tkinter as tk
    root = tk.Tk()
    root.withdraw()
    clip_text = root.clipboard_get()
    print(f"Clipboard length: {len(clip_text)}")
    data = json.loads(clip_text)
    
    # 1. Create timestamped backup if target already exists
    if os.path.exists(TARGET):
        backup_path = TARGET.replace(".json", f"_backup_{int(time.time())}.json")
        shutil.copy2(TARGET, backup_path)
        print(f"[OK] Created backup at: {backup_path}")

    # 2. Save directly to target
    with open(TARGET, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"[SUCCESS] Saved complete JSON ({len(clip_text)} chars) to: {TARGET}")

    # 3. Recalculate totals directly from entries instead of trusting summary
    images = data.get("images", [])
    total_imgs = len(images)
    reviewed_imgs = sum(1 for img in images if img.get("is_fully_reviewed", False))
    
    total_boxes = 0
    correct = 0
    incorrect = 0
    needs_adj = 0
    pending = 0

    adj_boxes_list = []

    for img in images:
        for b in img.get("boxes", []):
            total_boxes += 1
            st = b.get("status")
            if st == "correct":
                correct += 1
            elif st == "incorrect":
                incorrect += 1
            elif st == "needs_adjustment":
                needs_adj += 1
                adj_boxes_list.append((img["filename"], b))
            else:
                pending += 1

    print("\n--- RECALCULATED METRICS FROM ACTUAL ENTRIES ---")
    print(f"Total Images: {total_imgs}")
    print(f"Reviewed Images: {reviewed_imgs}")
    print(f"Total Boxes: {total_boxes}")
    print(f"Approved (correct): {correct}")
    print(f"Rejected (incorrect): {incorrect}")
    print(f"Needs Adjustment: {needs_adj}")
    print(f"Pending: {pending}")

    print("\nBoxes marked for adjustment:")
    for fn, b in adj_boxes_list:
        print(f" - Image: {fn}, Box #{b['id']}: Class={b['class_name']}, Conf={b['confidence']}, AdjustedXYWH={b.get('adjusted_xywh')}, Note='{b.get('adjustment_note')}'")

except Exception as e:
    print(f"Error fetching and saving clipboard: {e}")
