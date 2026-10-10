import os
import json
from pathlib import Path

WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\garbage_waste_v2"
REVIEWED_JSON_PATH = os.path.join(WORKSPACE_DIR, "garbage_annotations_reviewed.json")
MANIFEST_PATH = os.path.join(WORKSPACE_DIR, "dataset_manifest.json")
OUTPUT_HTML_PATH = os.path.join(WORKSPACE_DIR, "annotation_review.html")

def build_review_tool():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    # Load recovered reviews if present
    saved_reviews = {}
    if os.path.exists(REVIEWED_JSON_PATH):
        try:
            with open(REVIEWED_JSON_PATH, "r", encoding="utf-8") as rf:
                saved_data = json.load(rf)
                for s_img in saved_data.get("images", []):
                    saved_reviews[s_img["filename"]] = s_img
            print(f"[OK] Loaded {len(saved_reviews)} previously reviewed images from {REVIEWED_JSON_PATH}")
        except Exception as e:
            print(f"Error loading {REVIEWED_JSON_PATH}: {e}")

    inventory = manifest.get("inventory", [])
    enriched_items = []
    total_boxes = 0

    for item in inventory:
        fname = item["filename"]
        split = item["split"]
        out_img_name = item["out_img_name"]
        rel_img_url = f"images/{split}/{out_img_name}"

        # If previous review exists, preserve decisions
        prev_img = saved_reviews.get(fname)
        
        boxes = []
        w = item["width"]
        h = item["height"]

        if prev_img and prev_img.get("boxes"):
            for b in prev_img["boxes"]:
                xc, yc, bw, bh = b["xywh_normalized"]
                left_pct = max(0.0, min(100.0, (xc - bw / 2.0) * 100.0))
                top_pct = max(0.0, min(100.0, (yc - bh / 2.0) * 100.0))
                width_pct = max(0.5, min(100.0 - left_pct, bw * 100.0))
                height_pct = max(0.5, min(100.0 - top_pct, bh * 100.0))

                boxes.append({
                    "id": b["id"],
                    "global_id": b.get("global_id", f"img_{item['index']}_box_{b['id']}"),
                    "class_id": b.get("class_id", 5),
                    "class_name": b["class_name"],
                    "confidence": b.get("confidence", 0.0),
                    "xywh_normalized": [round(xc, 6), round(yc, 6), round(bw, 6), round(bh, 6)],
                    "pixel_coords": b.get("pixel_coordinates", [round((xc - bw/2)*w, 1), round((yc - bh/2)*h, 1), round((xc + bw/2)*w, 1), round((yc + bh/2)*h, 1)]),
                    "css_left": round(left_pct, 3),
                    "css_top": round(top_pct, 3),
                    "css_width": round(width_pct, 3),
                    "css_height": round(height_pct, 3),
                    "status": b.get("status", "pending"),
                    "adjusted_xywh": b.get("adjusted_xywh"),
                    "adjustment_note": b.get("adjustment_note", ""),
                    "reviewed_at": b.get("reviewed_at")
                })
        else:
            # Check if this is the zero-detection last image: Screenshot 2026-10-01 073203.png
            if fname == "Screenshot 2026-10-01 073203.png":
                # Inject the candidate roadside mixed waste pile box
                xc, yc, bw, bh = 0.442597, 0.509640, 0.443443, 0.342199
                left_pct = (xc - bw / 2.0) * 100.0
                top_pct = (yc - bh / 2.0) * 100.0
                width_pct = bw * 100.0
                height_pct = bh * 100.0

                boxes.append({
                    "id": 1,
                    "global_id": f"img_{item['index']}_box_1",
                    "class_id": 5,  # PLASTIC (Mixed roadside garbage pile)
                    "class_name": "PLASTIC",
                    "confidence": 0.1971,
                    "xywh_normalized": [round(xc, 6), round(yc, 6), round(bw, 6), round(bh, 6)],
                    "pixel_coords": [131.0, 146.2, 393.9, 294.1],
                    "css_left": round(left_pct, 3),
                    "css_top": round(top_pct, 3),
                    "css_width": round(width_pct, 3),
                    "css_height": round(height_pct, 3),
                    "status": "pending",  # Pending human confirmation!
                    "adjusted_xywh": None,
                    "adjustment_note": "Candidate roadside mixed waste pile awaiting confirmation; taxonomy note: mixed roadside litter",
                    "reviewed_at": None,
                    "is_proposed_defect": True
                })
            else:
                for b_idx, box in enumerate(item.get("provisional_boxes", [])):
                    xc, yc, bw, bh = box["xywh_normalized"]
                    left_pct = max(0.0, min(100.0, (xc - bw / 2.0) * 100.0))
                    top_pct = max(0.0, min(100.0, (yc - bh / 2.0) * 100.0))
                    width_pct = max(0.5, min(100.0 - left_pct, bw * 100.0))
                    height_pct = max(0.5, min(100.0 - top_pct, bh * 100.0))

                    boxes.append({
                        "id": b_idx + 1,
                        "global_id": f"img_{item['index']}_box_{b_idx + 1}",
                        "class_id": box["class_id"],
                        "class_name": box["class_name"],
                        "confidence": round(box.get("confidence", 0.0), 4),
                        "xywh_normalized": [round(xc, 6), round(yc, 6), round(bw, 6), round(bh, 6)],
                        "pixel_coords": box["xyxy_pixels"],
                        "css_left": round(left_pct, 3),
                        "css_top": round(top_pct, 3),
                        "css_width": round(width_pct, 3),
                        "css_height": round(height_pct, 3),
                        "status": "pending",
                        "adjusted_xywh": None,
                        "adjustment_note": "",
                        "reviewed_at": None
                    })

        total_boxes += len(boxes)

        is_fully_rev = prev_img.get("is_fully_reviewed", False) if prev_img else False
        if fname == "Screenshot 2026-10-01 073203.png" and boxes and boxes[0]["status"] == "correct":
            is_fully_rev = True

        enriched_items.append({
            "index": item["index"],
            "image_id": f"img_{item['index']}",
            "filename": fname,
            "manifest_key": item["rel_path"],
            "rel_path": item["rel_path"],
            "split": split,
            "group": item["group"],
            "width": w,
            "height": h,
            "rel_img_url": rel_img_url,
            "boxes": boxes,
            "is_fully_reviewed": is_fully_rev,
            "missing_garbage_flag": prev_img.get("missing_garbage_flag", False) if prev_img else False,
            "notes": prev_img.get("notes", "") if prev_img else ""
        })

    json_payload = json.dumps(enriched_items, ensure_ascii=False)

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NAGARSETU 3.1 — Garbage & Waste Annotation Review</title>
  <style>
    :root {{
      --bg: #0b0f19;
      --surface: #111827;
      --surface-light: #1f2937;
      --border: #374151;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #3b82f6;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --purple: #8b5cf6;
      --radius: 8px;
    }}
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }}
    body {{
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }}
    header {{
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 8px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      z-index: 10;
    }}
    .brand {{
      display: flex;
      align-items: center;
      gap: 10px;
    }}
    .brand h1 {{
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #34d399;
    }}
    .badge {{
      background: #1e293b;
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 0.72rem;
      padding: 2px 7px;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
    }}
    .stats-bar {{
      display: flex;
      gap: 12px;
      align-items: center;
      background: #0f172a;
      padding: 5px 12px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      font-size: 0.8rem;
    }}
    .stat-pill {{
      display: flex;
      align-items: center;
      gap: 5px;
    }}
    .stat-val {{
      font-weight: 700;
      color: var(--text);
    }}
    .stat-val.correct {{ color: var(--success); }}
    .stat-val.incorrect {{ color: var(--danger); }}
    .stat-val.adjustment {{ color: var(--primary); }}
    .stat-val.missing {{ color: var(--purple); }}
    .actions-bar {{
      display: flex;
      gap: 8px;
    }}
    button {{
      background: var(--surface-light);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.12s ease;
    }}
    button:hover {{
      background: #374151;
      border-color: #4b5563;
    }}
    button.primary {{
      background: #2563eb;
      border-color: #3b82f6;
      color: white;
    }}
    button.primary:hover {{
      background: #1d4ed8;
    }}
    button.success {{
      background: #065f46;
      border-color: var(--success);
      color: #ecfdf5;
      font-weight: 600;
    }}
    button.success:hover {{
      background: #047857;
    }}
    button.danger {{
      background: #7f1d1d;
      border-color: var(--danger);
      color: #fef2f2;
      font-weight: 600;
    }}
    button.danger:hover {{
      background: #991b1b;
    }}
    button.tool-active {{
      background: #d97706;
      border-color: #f59e0b;
      color: white;
    }}
    .main-layout {{
      display: flex;
      flex: 1;
      overflow: hidden;
    }}
    .sidebar {{
      width: 320px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }}
    .sidebar-search {{
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }}
    .sidebar-search input, .sidebar-search select {{
      width: 100%;
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 5px 8px;
      border-radius: 6px;
      font-size: 0.78rem;
    }}
    .filter-toggles {{
      display: flex;
      gap: 6px;
    }}
    .filter-btn {{
      flex: 1;
      padding: 4px;
      font-size: 0.72rem;
      justify-content: center;
    }}
    .filter-btn.active {{
      background: #059669;
      border-color: #34d399;
      color: #fff;
    }}
    .image-list {{
      flex: 1;
      overflow-y: auto;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }}
    .image-item {{
      padding: 7px 10px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      border: 1px solid transparent;
      transition: all 0.1s ease;
      font-size: 0.78rem;
    }}
    .image-item:hover {{
      background: var(--surface-light);
    }}
    .image-item.active {{
      background: #064e3b;
      border-color: #10b981;
    }}
    .image-item-info {{
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }}
    .image-item-meta {{
      font-size: 0.68rem;
      color: var(--text-muted);
    }}
    .badge-split {{
      font-size: 0.65rem;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
    }}
    .badge-split.train {{ background: #064e3b; color: #34d399; }}
    .badge-split.val {{ background: #713f12; color: #fde047; }}
    .badge-split.test {{ background: #3730a3; color: #a5b4fc; }}
    .badge-reviewed {{
      font-size: 0.65rem;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 600;
    }}
    .badge-reviewed.done {{ background: var(--success); color: #000; }}
    .badge-reviewed.partial {{ background: var(--warning); color: #000; }}
    .badge-reviewed.pending {{ background: #374151; color: #9ca3af; }}

    .workspace {{
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: #090d16;
    }}
    .workspace-top {{
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 8px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }}
    .img-meta-title {{
      font-size: 0.9rem;
      font-weight: 600;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      gap: 8px;
    }}
    .bulk-actions {{
      display: flex;
      gap: 6px;
      align-items: center;
    }}
    .warning-banner {{
      background: rgba(245, 158, 11, 0.15);
      border-bottom: 1px solid rgba(245, 158, 11, 0.4);
      color: #fbbf24;
      padding: 5px 16px;
      font-size: 0.76rem;
      display: none;
      align-items: center;
      gap: 8px;
    }}
    .warning-banner.visible {{
      display: flex;
    }}
    .content-area {{
      display: flex;
      flex: 1;
      overflow: hidden;
    }}
    .viewport-container {{
      flex: 1.5;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 14px;
      position: relative;
      background: #05070d;
      overflow: auto;
      user-select: none;
    }}
    .image-stage {{
      position: relative;
      display: inline-block;
      max-width: 100%;
      max-height: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.7);
      border-radius: 4px;
      overflow: hidden;
    }}
    .image-stage.drawing-mode {{
      cursor: crosshair;
    }}
    .image-stage img {{
      display: block;
      max-width: 100%;
      max-height: calc(100vh - 220px);
      object-fit: contain;
      user-select: none;
      pointer-events: none;
    }}
    .bounding-box {{
      position: absolute;
      border: 2px solid var(--warning);
      background: rgba(245, 158, 11, 0.15);
      cursor: pointer;
      transition: all 0.1s ease;
      z-index: 5;
    }}
    .bounding-box:hover, .bounding-box.active {{
      border-width: 3px;
      background: rgba(245, 158, 11, 0.3);
      z-index: 10;
    }}
    .bounding-box.status-correct {{
      border-color: var(--success);
      background: rgba(16, 185, 129, 0.2);
    }}
    .bounding-box.status-incorrect {{
      border-color: var(--danger);
      background: rgba(239, 68, 68, 0.25);
    }}
    .bounding-box.status-needs_adjustment {{
      border-color: var(--primary);
      background: rgba(59, 130, 246, 0.25);
    }}
    .bounding-box.is-proposed {{
      border-style: dashed;
      border-color: #f59e0b;
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
    }}
    .box-tag {{
      position: absolute;
      top: -20px;
      left: -2px;
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid inherit;
      color: white;
      font-size: 0.68rem;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
      white-space: nowrap;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 3px;
    }}

    .drawing-box-preview {{
      position: absolute;
      border: 2px dashed #34d399;
      background: rgba(52, 211, 153, 0.2);
      pointer-events: none;
      z-index: 20;
      display: none;
    }}

    .review-panel {{
      width: 440px;
      background: var(--surface);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }}
    .review-panel-header {{
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }}
    .review-panel-header h3 {{
      font-size: 0.85rem;
      font-weight: 600;
    }}
    .draw-controls-bar {{
      padding: 8px 14px;
      background: #0f172a;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 8px;
    }}
    .box-list {{
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }}
    .box-card {{
      background: #1e293b;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: all 0.1s ease;
    }}
    .box-card.active {{
      border-color: #34d399;
      background: #064e3b;
    }}
    .box-card.card-warning {{
      border-left: 3px solid #f59e0b;
    }}
    .box-card-header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.78rem;
    }}
    .box-card-actions {{
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5px;
    }}
    .box-card-actions button {{
      padding: 4px;
      font-size: 0.7rem;
      justify-content: center;
    }}
    .box-card-actions button.selected-correct {{
      background: var(--success);
      color: #000;
      font-weight: 700;
    }}
    .box-card-actions button.selected-incorrect {{
      background: var(--danger);
      color: #fff;
      font-weight: 700;
    }}
    .box-card-actions button.selected-adjustment {{
      background: var(--primary);
      color: #fff;
      font-weight: 700;
    }}
    .coord-edit-grid {{
      display: grid;
      grid-template-columns: repeat(4, 1fr) auto;
      gap: 4px;
      align-items: center;
      background: #090d16;
      padding: 4px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }}
    .coord-edit-grid input {{
      background: #1e293b;
      border: 1px solid var(--border);
      color: #f3f4f6;
      font-size: 0.68rem;
      padding: 2px 4px;
      border-radius: 3px;
      width: 100%;
      text-align: center;
    }}
    .coord-edit-grid button {{
      font-size: 0.68rem;
      padding: 2px 6px;
    }}
    .image-controls-footer {{
      padding: 10px 14px;
      border-top: 1px solid var(--border);
      background: #0f172a;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }}
    .shortcut-legend {{
      font-size: 0.66rem;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
    }}

    /* Export Modal */
    .modal-overlay {{
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }}
    .modal-overlay.active {{
      display: flex;
    }}
    .modal-content {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      width: 780px;
      max-width: 95vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 20px 40px rgba(0,0,0,0.8);
    }}
    .modal-header {{
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }}
    .modal-header h2 {{
      font-size: 1.1rem;
      color: #34d399;
    }}
    .modal-body {{
      padding: 16px 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
      flex: 1;
    }}
    .modal-stats-grid {{
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }}
    .modal-stat-box {{
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      text-align: center;
    }}
    .modal-stat-box .title {{
      font-size: 0.72rem;
      color: var(--text-muted);
    }}
    .modal-stat-box .value {{
      font-size: 1.15rem;
      font-weight: 700;
      margin-top: 2px;
    }}
    .export-options {{
      display: flex;
      gap: 10px;
    }}
    .export-textarea {{
      width: 100%;
      height: 220px;
      background: #090d16;
      border: 1px solid var(--border);
      color: #34d399;
      font-family: monospace;
      font-size: 0.75rem;
      padding: 10px;
      border-radius: 6px;
      resize: vertical;
    }}
    .modal-footer {{
      padding: 12px 20px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0f172a;
    }}
    .toast {{
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #10b981;
      color: black;
      font-weight: 600;
      font-size: 0.85rem;
      padding: 10px 18px;
      border-radius: 6px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.5);
      z-index: 200;
      display: none;
    }}
    .toast.visible {{
      display: block;
    }}
  </style>
</head>
<body>
  <div id="toast" class="toast">Action completed</div>

  <header>
    <div class="brand">
      <h1>NAGARSETU 3.1</h1>
      <span class="badge">Garbage & Waste Review</span>
    </div>

    <div class="stats-bar">
      <div class="stat-pill">
        Images: <span class="stat-val" id="kpi-reviewed-images">0</span>/<span id="kpi-total-images">30</span>
        (<span id="kpi-images-pct">0%</span>)
      </div>
      <div class="stat-pill">
        Boxes: <span class="stat-val" id="kpi-reviewed-boxes">0</span>/<span id="kpi-total-boxes">{total_boxes}</span>
        (<span id="kpi-boxes-pct">0%</span>)
      </div>
      <div class="stat-pill">✅ <span class="stat-val correct" id="kpi-correct">0</span></div>
      <div class="stat-pill">❌ <span class="stat-val incorrect" id="kpi-incorrect">0</span></div>
      <div class="stat-pill">⚠️ <span class="stat-val adjustment" id="kpi-adjustment">0</span></div>
      <div class="stat-pill">🟣 Missing: <span class="stat-val missing" id="kpi-missing">0</span></div>
    </div>

    <div class="actions-bar">
      <button onclick="saveToStorage()">💾 Save to Disk</button>
      <button class="primary" onclick="openExportModal('audit')">📥 Export JSON</button>
      <button class="success" onclick="openExportModal('verified')">⭐ Export Verified</button>
      <button onclick="quickCopyJson()">📋 Copy JSON</button>
      <button onclick="importReviewedJsonPrompt()">📤 Import JSON</button>
      <input type="file" id="import-file" style="display:none;" accept=".json" onchange="handleImportFile(event)" />
    </div>
  </header>

  <div class="main-layout">
    <div class="sidebar">
      <div class="sidebar-search">
        <input type="text" id="search-input" placeholder="Search filenames..." oninput="filterImages()" />
        <select id="filter-select" onchange="filterImages()">
          <option value="all">All Images ({len(enriched_items)})</option>
          <option value="pending_only">⏳ Pending Confirmation</option>
          <option value="needs_adj_only">⚠️ Marked for Adjustment (2)</option>
          <option value="reviewed_only">✅ Fully Reviewed Images</option>
          <option value="train">Train Split</option>
          <option value="val">Val Split</option>
          <option value="test">Held-out Test Split</option>
        </select>
        <div class="filter-toggles">
          <button class="filter-btn active" id="btn-filter-all" onclick="setQuickFilter('all')">All (30)</button>
          <button class="filter-btn" id="btn-filter-pending" onclick="setQuickFilter('pending_only')">Pending</button>
          <button class="filter-btn" id="btn-filter-adj" onclick="setQuickFilter('needs_adj_only')">Adjustments</button>
        </div>
      </div>

      <div class="image-list" id="image-list"></div>
    </div>

    <div class="workspace">
      <div class="workspace-top">
        <div class="img-meta-title" id="img-meta-title">
          <span>Loading...</span>
        </div>

        <div class="bulk-actions">
          <button class="success" onclick="approveAllCurrent()" title="Approve all boxes in current image (Shift+A)">
            ✅ Approve All (Shift+A)
          </button>
          <button class="danger" onclick="rejectAllCurrent()" title="Reject all boxes in current image (Shift+R)">
            ❌ Reject All (Shift+R)
          </button>
          <button onclick="prevImage()">◀ Prev (A)</button>
          <button onclick="nextImage()">Next ▶ (D)</button>
        </div>
      </div>

      <div class="warning-banner" id="warning-banner">
        <span id="warning-banner-text">⚠️ Warning: Detection issues detected on this image.</span>
      </div>

      <div class="content-area">
        <div class="viewport-container" id="viewport-container">
          <div class="image-stage" id="image-stage">
            <img id="main-image" src="" alt="Garbage inspection" onload="renderBoundingBoxes()" />
            <div id="boxes-overlay"></div>
            <div id="drawing-preview" class="drawing-box-preview"></div>
          </div>
        </div>

        <div class="review-panel">
          <div class="review-panel-header">
            <h3>Bounding Boxes</h3>
            <span class="badge" id="panel-box-count">0 boxes</span>
          </div>

          <!-- Drawing / Adding Tool -->
          <div class="draw-controls-bar">
            <button id="btn-toggle-draw" onclick="toggleDrawingMode()">➕ Draw New Box</button>
            <select id="select-draw-class" style="background:#1e293b;border:1px solid var(--border);color:white;padding:3px 6px;border-radius:4px;font-size:0.75rem;">
              <option value="0">BIODEGRADABLE</option>
              <option value="1">CARDBOARD</option>
              <option value="2">GLASS</option>
              <option value="3">METAL</option>
              <option value="4">PAPER</option>
              <option value="5" selected>PLASTIC (Mixed Waste)</option>
            </select>
            <button onclick="addCenterBox()" style="font-size:0.72rem;">Add Default</button>
          </div>

          <div class="box-list" id="box-list"></div>

          <div class="image-controls-footer">
            <button id="missing-garbage-btn" onclick="toggleMissingGarbageFlag()">
              🟣 Flag Missing Garbage/Litter on Image (M)
            </button>
            <input type="text" id="image-note-input" placeholder="Notes (e.g. roadside pile, plastic bags)..." onchange="updateImageNote(this.value)" style="background:#1e293b;border:1px solid var(--border);color:white;padding:5px 8px;border-radius:4px;font-size:0.75rem;" />
            
            <div class="shortcut-legend">
              <span><b>Shift+A</b>: Approve All</span>
              <span><b>Shift+R</b>: Reject All</span>
              <span><b>1/2/3</b>: Box Status</span>
              <span><b>A/D</b>: Prev/Next</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Export Modal -->
  <div id="export-modal" class="modal-overlay">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modal-title">📥 Export Garbage Annotations</h2>
        <button onclick="closeExportModal()">✕ Close</button>
      </div>
      <div class="modal-body">
        <div class="modal-stats-grid">
          <div class="modal-stat-box">
            <div class="title">Images Reviewed</div>
            <div class="value" id="m-stat-images" style="color:#34d399;">0 / 30</div>
          </div>
          <div class="modal-stat-box">
            <div class="title">Approved</div>
            <div class="value" id="m-stat-correct" style="color:#34d399;">0</div>
          </div>
          <div class="modal-stat-box">
            <div class="title">Rejected</div>
            <div class="value" id="m-stat-incorrect" style="color:#f87171;">0</div>
          </div>
          <div class="modal-stat-box">
            <div class="title">Pending</div>
            <div class="value" id="m-stat-pending" style="color:#9ca3af;">0</div>
          </div>
        </div>

        <div class="export-options">
          <button class="primary" onclick="triggerFileDownload('audit')">📥 Download Full Audit JSON</button>
          <button class="success" onclick="triggerFileDownload('verified')">⭐ Download Verified Only</button>
          <button onclick="copyModalJson()">📋 Copy JSON to Clipboard</button>
          <button onclick="sendToServer(cachedExportJson)">💾 Direct Save to Server Disk</button>
        </div>

        <textarea id="export-json-textarea" class="export-textarea" readonly onclick="this.select()"></textarea>
      </div>
      <div class="modal-footer">
        <span style="font-size:0.72rem;color:var(--text-muted);">Saved directly to ai_service/training/garbage_waste_v2/garbage_annotations_reviewed.json</span>
        <button class="primary" onclick="closeExportModal()">Done</button>
      </div>
    </div>
  </div>

  <script>
    const INITIAL_DATA = {json_payload};
    let dataset = [];
    let currentIdx = 0;
    let selectedBoxId = null;
    let cachedExportJson = "";
    let isDrawingMode = false;
    let isMouseDown = false;
    let startX = 0, startY = 0;

    const STORAGE_KEY = "nagarsetu_garbage_review_v2";

    function showToast(msg) {{
      const t = document.getElementById("toast");
      t.innerText = msg;
      t.className = "toast visible";
      setTimeout(() => {{ t.className = "toast"; }}, 3000);
    }}

    function init() {{
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {{
        try {{
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length === INITIAL_DATA.length) {{
            dataset = parsed;
          }} else {{
            dataset = INITIAL_DATA;
          }}
        }} catch (e) {{
          dataset = INITIAL_DATA;
        }}
      }} else {{
        dataset = INITIAL_DATA;
      }}

      // Ensure Screenshot 2026-10-01 073203.png has its candidate roadside box if missing
      const lastImg = dataset.find(d => d.filename === "Screenshot 2026-10-01 073203.png");
      if (lastImg && lastImg.boxes.length === 0) {{
        lastImg.boxes.push({{
          id: 1,
          global_id: `${{lastImg.image_id}}_box_1`,
          class_id: 5,
          class_name: "PLASTIC",
          confidence: 0.1971,
          xywh_normalized: [0.442597, 0.509640, 0.443443, 0.342199],
          pixel_coords: [131.0, 146.2, 393.9, 294.1],
          css_left: 22.088,
          css_top: 33.854,
          css_width: 44.344,
          css_height: 34.220,
          status: "pending",
          adjusted_xywh: null,
          adjustment_note: "Roadside mixed garbage pile candidate awaiting confirmation",
          reviewed_at: null,
          is_proposed_defect: true
        }});
      }}

      setupDrawingListeners();
      filterImages();
      selectImage(0);
      updateKpis();
    }}

    function sendToServer(jsonString) {{
      fetch("http://localhost:8766/save", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: jsonString
      }}).then(r => r.json()).then(data => {{
        showToast("✅ Successfully saved to server disk!");
      }}).catch(err => {{
        console.warn("Direct save server error, fallback active:", err);
      }});
    }}

    function saveToStorage() {{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
      const payload = JSON.stringify(buildExportPayload("audit"), null, 2);
      sendToServer(payload);
      updateKpis();
      showToast("Saved to storage and server disk");
    }}

    function updateKpis() {{
      let totalBoxes = 0, reviewedBoxes = 0, correct = 0, incorrect = 0, adjustment = 0, missingFlags = 0, reviewedImagesCount = 0;

      dataset.forEach(img => {{
        if (img.missing_garbage_flag) missingFlags++;
        const isReviewed = (img.boxes.length === 0 && img.missing_garbage_flag) || 
                           (img.boxes.length > 0 && img.boxes.every(b => b.status === "correct" || b.status === "incorrect"));
        if (isReviewed) reviewedImagesCount++;

        img.boxes.forEach(b => {{
          totalBoxes++;
          if (b.status === "correct") {{ reviewedBoxes++; correct++; }}
          else if (b.status === "incorrect") {{ reviewedBoxes++; incorrect++; }}
          else if (b.status === "needs_adjustment") {{ adjustment++; }}
        }});
      }});

      const imgPct = Math.round((reviewedImagesCount / (dataset.length || 1)) * 100);
      const boxPct = Math.round((reviewedBoxes / (totalBoxes || 1)) * 100);

      document.getElementById("kpi-reviewed-images").innerText = reviewedImagesCount;
      document.getElementById("kpi-total-images").innerText = dataset.length;
      document.getElementById("kpi-images-pct").innerText = `${{imgPct}}%`;

      document.getElementById("kpi-reviewed-boxes").innerText = reviewedBoxes;
      document.getElementById("kpi-total-boxes").innerText = totalBoxes;
      document.getElementById("kpi-boxes-pct").innerText = `${{boxPct}}%`;

      document.getElementById("kpi-correct").innerText = correct;
      document.getElementById("kpi-incorrect").innerText = incorrect;
      document.getElementById("kpi-adjustment").innerText = adjustment;
      document.getElementById("kpi-missing").innerText = missingFlags;
    }}

    function setQuickFilter(val) {{
      document.getElementById("filter-select").value = val;
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      if (val === "all") document.getElementById("btn-filter-all").classList.add("active");
      else if (val === "pending_only") document.getElementById("btn-filter-pending").classList.add("active");
      else if (val === "needs_adj_only") document.getElementById("btn-filter-adj").classList.add("active");
      filterImages();
    }}

    function filterImages() {{
      const q = document.getElementById("search-input").value.toLowerCase();
      const filter = document.getElementById("filter-select").value;
      const listEl = document.getElementById("image-list");
      listEl.innerHTML = "";

      dataset.forEach((item, idx) => {{
        const matchesQuery = item.filename.toLowerCase().includes(q);
        let matchesFilter = true;

        const isReviewed = (item.boxes.length === 0 && item.missing_garbage_flag) || 
                           (item.boxes.length > 0 && item.boxes.every(b => b.status === "correct" || b.status === "incorrect"));
        const hasPending = item.boxes.some(b => b.status === "pending");
        const hasAdj = item.boxes.some(b => b.status === "needs_adjustment");

        if (filter === "pending_only") matchesFilter = hasPending;
        else if (filter === "needs_adj_only") matchesFilter = hasAdj;
        else if (filter === "reviewed_only") matchesFilter = isReviewed;
        else if (["train", "val", "test"].includes(filter)) matchesFilter = item.split === filter;

        if (matchesQuery && matchesFilter) {{
          const itemEl = document.createElement("div");
          itemEl.className = `image-item ${{idx === currentIdx ? "active" : ""}}`;
          itemEl.onclick = () => selectImage(idx);

          let statusBadge = "pending";
          let statusText = "Pending";
          if (hasAdj) {{
            statusBadge = "partial";
            statusText = "Adj (Needs Coord)";
          }} else if (isReviewed) {{
            statusBadge = "done";
            statusText = "Reviewed";
          }}

          itemEl.innerHTML = `
            <div class="image-item-info">
              <div>#${{item.index}} ${{item.filename}}</div>
              <div class="image-item-meta">
                <span class="badge-split ${{item.split}}">${{item.split}}</span>
                ${{item.boxes.length}} boxes · ${{item.width}}x${{item.height}}
                ${{hasAdj ? "⚠️ Adj" : ""}}
              </div>
            </div>
            <span class="badge-reviewed ${{statusBadge}}">${{statusText}}</span>
          `;
          listEl.appendChild(itemEl);
        }}
      }});
    }}

    function selectImage(idx) {{
      if (idx < 0 || idx >= dataset.length) return;
      currentIdx = idx;
      selectedBoxId = null;

      const item = dataset[currentIdx];

      document.getElementById("img-meta-title").innerHTML = `
        <span><b>#${{item.index}}</b> ${{item.filename}}</span>
        <span class="badge-split ${{item.split}}">${{item.split}}</span>
        <span class="badge">${{item.width}}x${{item.height}}</span>
        <span class="badge">${{item.boxes.length}} boxes</span>
      `;

      // Warning banner if zero detection or needs adjustment
      const banner = document.getElementById("warning-banner");
      const bannerText = document.getElementById("warning-banner-text");
      const hasAdj = item.boxes.some(b => b.status === "needs_adjustment");
      const hasProposed = item.boxes.some(b => b.is_proposed_defect);

      if (hasAdj) {{
        banner.className = "warning-banner visible";
        bannerText.innerHTML = `⚠️ <b>Action Required:</b> This image contains boxes marked for adjustment. Please correct coordinates and confirm approval.`;
      }} else if (hasProposed) {{
        banner.className = "warning-banner visible";
        bannerText.innerHTML = `⚠️ <b>Zero-Detection Defect Candidate:</b> Candidate roadside mixed waste pile displayed for human confirmation (not automatically approved).`;
      }} else {{
        banner.className = "warning-banner";
      }}

      const imgEl = document.getElementById("main-image");
      imgEl.src = item.rel_img_url;

      document.getElementById("image-note-input").value = item.notes || "";
      updateMissingGarbageBtn();
      renderBoxCards();
      renderBoundingBoxes();
      filterImages();
    }}

    function renderBoundingBoxes() {{
      const overlay = document.getElementById("boxes-overlay");
      overlay.innerHTML = "";
      const item = dataset[currentIdx];

      item.boxes.forEach(b => {{
        const boxEl = document.createElement("div");
        boxEl.className = `bounding-box status-${{b.status}} ${{selectedBoxId === b.id ? "active" : ""}} ${{b.is_proposed_defect ? "is-proposed" : ""}}`;
        boxEl.style.left = b.css_left + "%";
        boxEl.style.top = b.css_top + "%";
        boxEl.style.width = b.css_width + "%";
        boxEl.style.height = b.css_height + "%";

        const propTag = b.is_proposed_defect ? " [Proposed]" : "";
        boxEl.innerHTML = `<span class="box-tag">#${{b.id}} ${{b.class_name}}${{propTag}}</span>`;

        boxEl.onclick = (e) => {{
          e.stopPropagation();
          selectBox(b.id);
        }};

        overlay.appendChild(boxEl);
      }});
    }}

    function renderBoxCards() {{
      const list = document.getElementById("box-list");
      list.innerHTML = "";
      const item = dataset[currentIdx];
      document.getElementById("panel-box-count").innerText = `${{item.boxes.length}} boxes`;

      if (item.boxes.length === 0) {{
        list.innerHTML = `
          <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.82rem;">
            No boxes present.<br><br>
            Use <b>"➕ Draw New Box"</b> above to annotate visible waste.
          </div>
        `;
        return;
      }}

      item.boxes.forEach(b => {{
        const card = document.createElement("div");
        const isAdj = b.status === "needs_adjustment";
        card.className = `box-card ${{selectedBoxId === b.id ? "active" : ""}} ${{isAdj ? "card-warning" : ""}}`;
        card.id = `box-card-${{b.id}}`;
        card.onclick = () => selectBox(b.id);

        let adjBadge = "";
        if (isAdj) {{
          adjBadge = `<span style="background:#f59e0b;color:#000;font-size:0.68rem;padding:2px 5px;border-radius:3px;font-weight:700;">Needs Coord Correction</span>`;
        }}

        card.innerHTML = `
          <div class="box-card-header">
            <b>Box #${{b.id}}: ${{b.class_name}}</b>
            <div>
              ${{adjBadge}}
              <span class="badge">${{Math.round(b.confidence * 100)}}% conf</span>
            </div>
          </div>
          <div class="box-card-meta">
            Normalized: [${{b.xywh_normalized.map(v => v.toFixed(3)).join(", ")}}]
            ${{b.adjustment_note ? "<br><i>Note: " + b.adjustment_note + "</i>" : ""}}
          </div>
          <div class="box-card-actions">
            <button class="${{b.status === 'correct' ? 'selected-correct' : ''}}" onclick="setBoxStatus(${{b.id}}, 'correct', event)">
              ✅ Approve (1)
            </button>
            <button class="${{b.status === 'incorrect' ? 'selected-incorrect' : ''}}" onclick="setBoxStatus(${{b.id}}, 'incorrect', event)">
              ❌ Reject (2)
            </button>
            <button class="${{b.status === 'needs_adjustment' ? 'selected-adjustment' : ''}}" onclick="setBoxStatus(${{b.id}}, 'needs_adjustment', event)">
              ⚠️ Adjust (3)
            </button>
          </div>
          <div class="coord-edit-grid" onclick="event.stopPropagation()">
            <input type="number" step="0.005" id="c_xc_${{b.id}}" value="${{b.xywh_normalized[0].toFixed(3)}}" title="Center X" />
            <input type="number" step="0.005" id="c_yc_${{b.id}}" value="${{b.xywh_normalized[1].toFixed(3)}}" title="Center Y" />
            <input type="number" step="0.005" id="c_bw_${{b.id}}" value="${{b.xywh_normalized[2].toFixed(3)}}" title="Width" />
            <input type="number" step="0.005" id="c_bh_${{b.id}}" value="${{b.xywh_normalized[3].toFixed(3)}}" title="Height" />
            <button class="primary" onclick="applyBoxCoords(${{b.id}})">Apply</button>
          </div>
        `;
        list.appendChild(card);
      }});
    }}

    function applyBoxCoords(boxId) {{
      const item = dataset[currentIdx];
      const box = item.boxes.find(b => b.id === boxId);
      if (!box) return;

      const xc = parseFloat(document.getElementById(`c_xc_${{boxId}}`).value);
      const yc = parseFloat(document.getElementById(`c_yc_${{boxId}}`).value);
      const bw = parseFloat(document.getElementById(`c_bw_${{boxId}}`).value);
      const bh = parseFloat(document.getElementById(`c_bh_${{boxId}}`).value);

      box.xywh_normalized = [xc, yc, bw, bh];
      box.adjusted_xywh = [xc, yc, bw, bh];
      box.css_left = Math.max(0, (xc - bw / 2) * 100);
      box.css_top = Math.max(0, (yc - bh / 2) * 100);
      box.css_width = bw * 100;
      box.css_height = bh * 100;
      box.status = "correct"; // Marking approved once coordinates are applied!
      box.reviewed_at = new Date().toISOString();

      saveToStorage();
      renderBoundingBoxes();
      renderBoxCards();
      filterImages();
      showToast(`Box #${{boxId}} coordinates updated & approved`);
    }}

    function selectBox(boxId) {{
      selectedBoxId = boxId;
      renderBoundingBoxes();
      renderBoxCards();
      const card = document.getElementById(`box-card-${{boxId}}`);
      if (card) card.scrollIntoView({{ behavior: "smooth", block: "nearest" }});
    }}

    function setBoxStatus(boxId, status, ev) {{
      if (ev) ev.stopPropagation();
      const item = dataset[currentIdx];
      const box = item.boxes.find(b => b.id === boxId);
      if (box) {{
        box.status = status;
        box.reviewed_at = new Date().toISOString();
        if (status === "correct" && !box.adjusted_xywh) {{
          box.adjusted_xywh = box.xywh_normalized;
        }}
        saveToStorage();
        renderBoundingBoxes();
        renderBoxCards();
        filterImages();
      }}
    }}

    function approveAllCurrent() {{
      const item = dataset[currentIdx];
      if (item.boxes.length === 0) return;
      const now = new Date().toISOString();
      item.boxes.forEach(b => {{
        b.status = "correct";
        if (!b.adjusted_xywh) b.adjusted_xywh = b.xywh_normalized;
        b.reviewed_at = now;
      }});
      saveToStorage();
      renderBoundingBoxes();
      renderBoxCards();
      filterImages();
    }}

    function rejectAllCurrent() {{
      const item = dataset[currentIdx];
      if (item.boxes.length === 0) return;
      const now = new Date().toISOString();
      item.boxes.forEach(b => {{
        b.status = "incorrect";
        b.reviewed_at = now;
      }});
      saveToStorage();
      renderBoundingBoxes();
      renderBoxCards();
      filterImages();
    }}

    function toggleMissingGarbageFlag() {{
      const item = dataset[currentIdx];
      item.missing_garbage_flag = !item.missing_garbage_flag;
      updateMissingGarbageBtn();
      saveToStorage();
      filterImages();
    }}

    function updateMissingGarbageBtn() {{
      const item = dataset[currentIdx];
      const btn = document.getElementById("missing-garbage-btn");
      if (item.missing_garbage_flag) {{
        btn.innerText = "🟣 Flagged: Missing Garbage (Click to Unset)";
        btn.style.background = "#581c87";
        btn.style.borderColor = "#c084fc";
      }} else {{
        btn.innerText = "🟣 Flag Missing Garbage/Litter on Image (M)";
        btn.style.background = "";
        btn.style.borderColor = "";
      }}
    }}

    function updateImageNote(val) {{
      dataset[currentIdx].notes = val;
      saveToStorage();
    }}

    function nextImage() {{
      if (currentIdx < dataset.length - 1) selectImage(currentIdx + 1);
    }}

    function prevImage() {{
      if (currentIdx > 0) selectImage(currentIdx - 1);
    }}

    // Mouse drag-to-draw bounding box
    function toggleDrawingMode() {{
      isDrawingMode = !isDrawingMode;
      const btn = document.getElementById("btn-toggle-draw");
      const stage = document.getElementById("image-stage");
      if (isDrawingMode) {{
        btn.className = "tool-active";
        btn.innerText = "✕ Cancel Draw";
        stage.className = "image-stage drawing-mode";
        showToast("Click and drag on the image to draw a new bounding box");
      }} else {{
        btn.className = "";
        btn.innerText = "➕ Draw New Box";
        stage.className = "image-stage";
      }}
    }}

    function addCenterBox() {{
      const item = dataset[currentIdx];
      const clsSel = document.getElementById("select-draw-class");
      const clsId = parseInt(clsSel.value);
      const clsName = clsSel.options[clsSel.selectedIndex].text;

      const newId = item.boxes.length + 1;
      const newBox = {{
        id: newId,
        global_id: `${{item.image_id}}_box_${{newId}}`,
        class_id: clsId,
        class_name: clsName,
        confidence: 1.0,
        xywh_normalized: [0.5, 0.5, 0.3, 0.3],
        pixel_coords: [item.width * 0.35, item.height * 0.35, item.width * 0.65, item.height * 0.65],
        css_left: 35.0,
        css_top: 35.0,
        css_width: 30.0,
        css_height: 30.0,
        status: "correct",
        adjusted_xywh: [0.5, 0.5, 0.3, 0.3],
        adjustment_note: "Manually added box",
        reviewed_at: new Date().toISOString()
      }};
      item.boxes.push(newBox);
      saveToStorage();
      renderBoundingBoxes();
      renderBoxCards();
      selectBox(newId);
      showToast(`Added box #${{newId}}`);
    }}

    function setupDrawingListeners() {{
      const stage = document.getElementById("image-stage");
      const preview = document.getElementById("drawing-preview");

      stage.addEventListener("mousedown", (e) => {{
        if (!isDrawingMode) return;
        const rect = stage.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        isMouseDown = true;
        preview.style.left = startX + "px";
        preview.style.top = startY + "px";
        preview.style.width = "0px";
        preview.style.height = "0px";
        preview.style.display = "block";
      }});

      window.addEventListener("mousemove", (e) => {{
        if (!isDrawingMode || !isMouseDown) return;
        const rect = stage.getBoundingClientRect();
        const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

        const left = Math.min(startX, curX);
        const top = Math.min(startY, curY);
        const width = Math.abs(curX - startX);
        const height = Math.abs(curY - startY);

        preview.style.left = left + "px";
        preview.style.top = top + "px";
        preview.style.width = width + "px";
        preview.style.height = height + "px";
      }});

      window.addEventListener("mouseup", (e) => {{
        if (!isDrawingMode || !isMouseDown) return;
        isMouseDown = false;
        preview.style.display = "none";

        const rect = stage.getBoundingClientRect();
        const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

        const leftPx = Math.min(startX, curX);
        const topPx = Math.min(startY, curY);
        const wPx = Math.abs(curX - startX);
        const hPx = Math.abs(curY - startY);

        if (wPx < 10 || hPx < 10) return; // Too small

        const item = dataset[currentIdx];
        const xc = (leftPx + wPx / 2) / rect.width;
        const yc = (topPx + hPx / 2) / rect.height;
        const bw = wPx / rect.width;
        const bh = hPx / rect.height;

        const clsSel = document.getElementById("select-draw-class");
        const clsId = parseInt(clsSel.value);
        const clsName = clsSel.options[clsSel.selectedIndex].text;

        const newId = item.boxes.length + 1;
        const newBox = {{
          id: newId,
          global_id: `${{item.image_id}}_box_${{newId}}`,
          class_id: clsId,
          class_name: clsName,
          confidence: 1.0,
          xywh_normalized: [round(xc, 6), round(yc, 6), round(bw, 6), round(bh, 6)],
          pixel_coords: [round(leftPx * (item.width / rect.width), 1), round(topPx * (item.height / rect.height), 1), round((leftPx + wPx) * (item.width / rect.width), 1), round((topPx + hPx) * (item.height / rect.height), 1)],
          css_left: round(leftPx / rect.width * 100, 3),
          css_top: round(topPx / rect.height * 100, 3),
          css_width: round(bw * 100, 3),
          css_height: round(bh * 100, 3),
          status: "correct",
          adjusted_xywh: [round(xc, 6), round(yc, 6), round(bw, 6), round(bh, 6)],
          adjustment_note: "Manually drawn box",
          reviewed_at: new Date().toISOString()
        }};
        item.boxes.push(newBox);
        toggleDrawingMode();
        saveToStorage();
        renderBoundingBoxes();
        renderBoxCards();
        selectBox(newId);
        showToast(`Box #${{newId}} created and approved`);
      }});
    }}

    function round(num, dec) {{
      return Math.round(num * Math.pow(10, dec)) / Math.pow(10, dec);
    }}

    function buildExportPayload(mode) {{
      let correct = 0, incorrect = 0, adjustment = 0, pending = 0, missingFlagged = 0;
      let totalImagesReviewed = 0;
      const structuredImages = [];

      dataset.forEach(img => {{
        const isReviewed = (img.boxes.length === 0 && img.missing_garbage_flag) || 
                           (img.boxes.length > 0 && img.boxes.every(b => b.status === "correct" || b.status === "incorrect"));
        if (isReviewed) totalImagesReviewed++;
        if (img.missing_garbage_flag) missingFlagged++;

        const processedBoxes = [];
        img.boxes.forEach(b => {{
          if (b.status === "correct") correct++;
          else if (b.status === "incorrect") incorrect++;
          else if (b.status === "needs_adjustment") adjustment++;
          else pending++;

          if (mode === "verified") {{
            if (b.status === "correct") {{
              processedBoxes.push({{
                id: b.id,
                global_id: b.global_id || `${{img.image_id}}_box_${{b.id}}`,
                class_id: b.class_id,
                class_name: b.class_name,
                confidence: b.confidence,
                xywh_normalized: b.adjusted_xywh || b.xywh_normalized,
                pixel_coordinates: b.pixel_coords,
                status: "correct",
                reviewed_at: b.reviewed_at || new Date().toISOString()
              }});
            }}
          }} else {{
            processedBoxes.push({{
              id: b.id,
              global_id: b.global_id || `${{img.image_id}}_box_${{b.id}}`,
              class_id: b.class_id,
              class_name: b.class_name,
              confidence: b.confidence,
              xywh_normalized: b.xywh_normalized,
              adjusted_xywh: b.adjusted_xywh,
              pixel_coordinates: b.pixel_coords,
              status: b.status,
              adjustment_note: b.adjustment_note || "",
              reviewed_at: b.reviewed_at || null
            }});
          }}
        }});

        if (mode === "verified" && processedBoxes.length === 0 && !img.missing_garbage_flag) return;

        structuredImages.push({{
          index: img.index,
          image_id: img.image_id,
          filename: img.filename,
          manifest_key: img.manifest_key,
          rel_path: img.rel_path,
          split: img.split,
          group: img.group,
          dimensions: {{ width: img.width, height: img.height }},
          missing_garbage_flag: !!img.missing_garbage_flag,
          notes: img.notes || "",
          is_fully_reviewed: isReviewed,
          boxes: processedBoxes
        }});
      }});

      return {{
        review_metadata: {{
          generated_at: new Date().toISOString(),
          system: "NAGARSETU 3.1 Garbage AI Annotation Review Tool",
          export_type: mode === "verified" ? "verified_training_ground_truth" : "full_review_audit",
          dataset_source: "D:\\\\NAGARSETU\\\\garbage waste",
          total_images_in_dataset: dataset.length,
          reviewed_images_count: totalImagesReviewed,
          total_boxes_audited: correct + incorrect + adjustment + pending,
          summary: {{
            approved_correct_boxes: correct,
            rejected_incorrect_boxes: incorrect,
            needs_adjustment_boxes: adjustment,
            pending_boxes: pending,
            images_with_missing_garbage: missingFlagged
          }}
        }},
        images: structuredImages
      }};
    }}

    function triggerFileDownload(mode) {{
      const exportObj = buildExportPayload(mode);
      const jsonStr = JSON.stringify(exportObj, null, 2);
      sendToServer(jsonStr);
      const filename = `garbage_annotations_${{mode}}_${{new Date().toISOString().slice(0, 10)}}.json`;

      try {{
        const blob = new Blob([jsonStr], {{ type: "application/json;charset=utf-8" }});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {{ document.body.removeChild(a); URL.revokeObjectURL(url); }}, 3000);
      }} catch (err) {{
        console.warn("Download failed, use copy or direct save", err);
      }}
      showToast(`Exported ${{filename}} & saved to disk`);
    }}

    function openExportModal(mode) {{
      const exportObj = buildExportPayload(mode);
      cachedExportJson = JSON.stringify(exportObj, null, 2);

      const m = exportObj.review_metadata.summary;
      document.getElementById("m-stat-images").innerText = `${{exportObj.review_metadata.reviewed_images_count}} / ${{dataset.length}}`;
      document.getElementById("m-stat-correct").innerText = m.approved_correct_boxes;
      document.getElementById("m-stat-incorrect").innerText = m.rejected_incorrect_boxes;
      document.getElementById("m-stat-pending").innerText = m.pending_boxes + m.needs_adjustment_boxes;

      document.getElementById("modal-title").innerText = mode === "verified" 
        ? "⭐ Export Verified Garbage Annotations" 
        : "📥 Export Full Garbage Review Audit";

      document.getElementById("export-json-textarea").value = cachedExportJson;
      document.getElementById("export-modal").className = "modal-overlay active";
      triggerFileDownload(mode);
    }}

    function closeExportModal() {{
      document.getElementById("export-modal").className = "modal-overlay";
    }}

    function copyModalJson() {{
      const ta = document.getElementById("export-json-textarea");
      ta.select();
      navigator.clipboard.writeText(ta.value).then(() => {{
        showToast("✅ JSON copied to clipboard!");
      }}).catch(() => {{
        document.execCommand("copy");
        showToast("✅ JSON copied to clipboard!");
      }});
    }}

    function quickCopyJson() {{
      const exportObj = buildExportPayload("audit");
      const jsonStr = JSON.stringify(exportObj, null, 2);
      sendToServer(jsonStr);
      navigator.clipboard.writeText(jsonStr).then(() => {{
        showToast("✅ Full audit JSON copied to clipboard & saved to disk!");
      }}).catch(() => {{
        openExportModal("audit");
      }});
    }}

    function importReviewedJsonPrompt() {{
      document.getElementById("import-file").click();
    }}

    function handleImportFile(event) {{
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {{
        try {{
          const imported = JSON.parse(e.target.result);
          const images = imported.images || imported;
          if (Array.isArray(images)) {{
            dataset = images;
            saveToStorage();
            init();
            alert("Imported reviews successfully!");
          }}
        }} catch (err) {{
          alert("Error parsing JSON: " + err.message);
        }}
      }};
      reader.readAsText(file);
    }}

    window.onload = init;
  </script>
</body>
</html>
"""

    with open(OUTPUT_HTML_PATH, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"[OK] Generated upgraded Garbage Review Tool: {OUTPUT_HTML_PATH}")

if __name__ == "__main__":
    build_review_tool()
