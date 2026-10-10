import os
import json
from pathlib import Path

WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\road_damage_v2"
MANIFEST_PATH = os.path.join(WORKSPACE_DIR, "dataset_manifest.json")
OUTPUT_HTML_PATH = os.path.join(WORKSPACE_DIR, "annotation_review.html")

from prepare_dataset_splits import IMAGE_GROUP_MAP, GROUP_SPLIT_MAP

def generate_review_page():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    inventory = manifest.get("inventory", [])
    
    enriched_items = []
    total_boxes = 0

    for item in inventory:
        rel_path = item["rel_path"]
        group = IMAGE_GROUP_MAP.get(rel_path, "default_group")
        split = GROUP_SPLIT_MAP.get(group, "train")

        flat_name = rel_path.replace("\\", "_").replace("/", "_").replace(" ", "_")
        root_name, orig_ext = os.path.splitext(flat_name)
        ext = ".png" if orig_ext.lower() == ".png" else ".jpg"
        out_name = root_name + ext
        rel_img_url = f"images/{split}/{out_name}"

        provisional_boxes = item.get("provisional_boxes", [])
        total_boxes += len(provisional_boxes)

        boxes = []
        w = item["width"]
        h = item["height"]

        for b_idx, box in enumerate(provisional_boxes):
            xc, yc, bw, bh = box["xywh_normalized"]
            # Clamp safely within boundaries
            xc = max(0.005, min(0.995, xc))
            yc = max(0.005, min(0.995, yc))
            bw = max(0.005, min(1.0, bw))
            bh = max(0.005, min(1.0, bh))

            left_pct = max(0.0, min(100.0, (xc - bw / 2.0) * 100.0))
            top_pct = max(0.0, min(100.0, (yc - bh / 2.0) * 100.0))
            width_pct = max(0.5, min(100.0 - left_pct, bw * 100.0))
            height_pct = max(0.5, min(100.0 - top_pct, bh * 100.0))

            x1 = max(0.0, (xc - bw / 2.0) * w)
            y1 = max(0.0, (yc - bh / 2.0) * h)
            x2 = min(float(w), (xc + bw / 2.0) * w)
            y2 = min(float(h), (yc + bh / 2.0) * h)

            boxes.append({
                "id": b_idx + 1,
                "global_id": f"img_{item['index']}_box_{b_idx + 1}",
                "class_id": 0,
                "class_name": box.get("class_name", "Pothole"),
                "confidence": round(box.get("confidence", 0.0), 4),
                "xywh_normalized": [round(xc, 6), round(yc, 6), round(bw, 6), round(bh, 6)],
                "pixel_coords": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                "css_left": round(left_pct, 3),
                "css_top": round(top_pct, 3),
                "css_width": round(width_pct, 3),
                "css_height": round(height_pct, 3),
                "status": "pending",  # pending | correct | incorrect | needs_adjustment
                "adjusted_xywh": None,
                "adjustment_note": "",
                "reviewed_at": None
            })

        enriched_items.append({
            "index": item["index"],
            "image_id": f"img_{item['index']}",
            "filename": item["filename"],
            "manifest_key": rel_path,
            "rel_path": rel_path,
            "split": split,
            "group": group,
            "width": w,
            "height": h,
            "rel_img_url": rel_img_url,
            "boxes": boxes,
            "missing_pothole_flag": False,
            "notes": ""
        })

    json_payload = json.dumps(enriched_items, ensure_ascii=False)

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NAGARSETU 3.1 — Fast Road Annotation Review</title>
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
      color: #60a5fa;
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
    .main-layout {{
      display: flex;
      flex: 1;
      overflow: hidden;
    }}
    /* Sidebar */
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
      background: #1d4ed8;
      border-color: #60a5fa;
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
      background: #1e3a8a;
      border-color: #3b82f6;
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

    /* Workspace */
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
    /* Viewport */
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
    .image-stage img {{
      display: block;
      max-width: 100%;
      max-height: calc(100vh - 220px);
      object-fit: contain;
      user-select: none;
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
    .bounding-box.has-warning {{
      box-shadow: 0 0 0 2px #ef4444;
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

    /* Review Control Panel */
    .review-panel {{
      width: 420px;
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
      border-color: #60a5fa;
      background: #172554;
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
    .box-warning-tag {{
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid #ef4444;
      color: #fca5a5;
      font-size: 0.68rem;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }}
    .box-card-meta {{
      font-size: 0.7rem;
      color: var(--text-muted);
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
    .box-adjustment-input {{
      width: 100%;
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.72rem;
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
      color: #60a5fa;
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
      color: #38bdf8;
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
      transition: all 0.2s ease;
    }}
    .toast.visible {{
      display: block;
    }}
  </style>
</head>
<body>
  <div id="toast" class="toast">Action completed successfully</div>

  <header>
    <div class="brand">
      <h1>NAGARSETU 3.1</h1>
      <span class="badge">Fast Road Review</span>
    </div>

    <div class="stats-bar">
      <div class="stat-pill">
        Images: <span class="stat-val" id="kpi-reviewed-images">0</span>/<span id="kpi-total-images">59</span>
        (<span id="kpi-images-pct">0%</span>)
      </div>
      <div class="stat-pill">
        Boxes: <span class="stat-val" id="kpi-reviewed-boxes">0</span>/<span id="kpi-total-boxes">494</span>
        (<span id="kpi-boxes-pct">0%</span>)
      </div>
      <div class="stat-pill">✅ <span class="stat-val correct" id="kpi-correct">0</span></div>
      <div class="stat-pill">❌ <span class="stat-val incorrect" id="kpi-incorrect">0</span></div>
      <div class="stat-pill">⚠️ <span class="stat-val adjustment" id="kpi-adjustment">0</span></div>
      <div class="stat-pill">🟣 Missing: <span class="stat-val missing" id="kpi-missing">0</span></div>
    </div>

    <div class="actions-bar">
      <button onclick="saveToStorage()">💾 Save</button>
      <button class="primary" onclick="openExportModal('audit')" title="Export or Copy Full Audit JSON">📥 Export JSON</button>
      <button class="success" onclick="openExportModal('verified')" title="Export Only Verified Approved Annotations">⭐ Export Verified</button>
      <button onclick="quickCopyJson()" title="Copy entire JSON to clipboard immediately">📋 Copy JSON</button>
      <button onclick="importReviewedJsonPrompt()">📤 Import JSON</button>
      <input type="file" id="import-file" style="display:none;" accept=".json" onchange="handleImportFile(event)" />
    </div>
  </header>

  <div class="main-layout">
    <!-- Sidebar -->
    <div class="sidebar">
      <div class="sidebar-search">
        <input type="text" id="search-input" placeholder="Search filenames..." oninput="filterImages()" />
        <select id="filter-select" onchange="filterImages()">
          <option value="all">All Images ({len(enriched_items)})</option>
          <option value="pending_only" selected>⏳ Pending Images Only</option>
          <option value="reviewed_only">✅ Fully Reviewed Images</option>
          <option value="has_warnings">⚠️ Images with Box Warnings</option>
          <option value="zero_detections">0 Detections (Candidate defects)</option>
          <option value="missing_flagged">🟣 Flagged Missing Pothole</option>
          <option value="train">Train Split ({len([i for i in enriched_items if i['split']=='train'])})</option>
          <option value="val">Val Split ({len([i for i in enriched_items if i['split']=='val'])})</option>
          <option value="test">Test Split ({len([i for i in enriched_items if i['split']=='test'])})</option>
        </select>
        <div class="filter-toggles">
          <button class="filter-btn active" id="btn-filter-pending" onclick="setQuickFilter('pending_only')">Pending</button>
          <button class="filter-btn" id="btn-filter-all" onclick="setQuickFilter('all')">All</button>
          <button class="filter-btn" id="btn-filter-warn" onclick="setQuickFilter('has_warnings')">Warnings</button>
        </div>
      </div>

      <div class="image-list" id="image-list">
        <!-- Image items rendered here -->
      </div>
    </div>

    <!-- Workspace -->
    <div class="workspace">
      <div class="workspace-top">
        <div class="img-meta-title" id="img-meta-title">
          <span>Loading...</span>
        </div>

        <div class="bulk-actions">
          <button class="success" onclick="approveAllCurrent()" title="Approve all boxes in current image (Shift+A)">
            ✅ Approve All in Image (Shift+A)
          </button>
          <button class="danger" onclick="rejectAllCurrent()" title="Reject all boxes in current image (Shift+R)">
            ❌ Reject All in Image (Shift+R)
          </button>
          <button onclick="prevImage()">◀ Prev (A)</button>
          <button onclick="nextImage()">Next ▶ (D)</button>
        </div>
      </div>

      <!-- Warning Alert Banner -->
      <div class="warning-banner" id="warning-banner">
        <span id="warning-banner-text">⚠️ Warning: Detection issues detected on this image.</span>
      </div>

      <div class="content-area">
        <!-- Viewport -->
        <div class="viewport-container" id="viewport-container">
          <div class="image-stage" id="image-stage">
            <img id="main-image" src="" alt="Road inspection" onload="renderBoundingBoxes()" />
            <div id="boxes-overlay"></div>
          </div>
        </div>

        <!-- Review Control Panel -->
        <div class="review-panel">
          <div class="review-panel-header">
            <h3>Provisional Annotations</h3>
            <span class="badge" id="panel-box-count">0 boxes</span>
          </div>

          <div class="box-list" id="box-list">
            <!-- Box cards rendered here -->
          </div>

          <div class="image-controls-footer">
            <button id="missing-pothole-btn" onclick="toggleMissingPotholeFlag()">
              🟣 Flag Missing Pothole(s) on Image (M)
            </button>
            <input type="text" id="image-note-input" placeholder="Image notes (e.g. wet road, patch repair)..." onchange="updateImageNote(this.value)" style="background:#1e293b;border:1px solid var(--border);color:white;padding:5px 8px;border-radius:4px;font-size:0.75rem;" />
            
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

  <!-- Export & Fallback Modal -->
  <div id="export-modal" class="modal-overlay">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modal-title">📥 Export Road Annotations</h2>
        <button onclick="closeExportModal()">✕ Close</button>
      </div>
      <div class="modal-body">
        <div class="modal-stats-grid">
          <div class="modal-stat-box">
            <div class="title">Images Reviewed</div>
            <div class="value" id="m-stat-images" style="color:#60a5fa;">0 / 59</div>
          </div>
          <div class="modal-stat-box">
            <div class="title">Approved (Correct)</div>
            <div class="value" id="m-stat-correct" style="color:#34d399;">0</div>
          </div>
          <div class="modal-stat-box">
            <div class="title">Rejected (Incorrect)</div>
            <div class="value" id="m-stat-incorrect" style="color:#f87171;">0</div>
          </div>
          <div class="modal-stat-box">
            <div class="title">Pending Review</div>
            <div class="value" id="m-stat-pending" style="color:#9ca3af;">0</div>
          </div>
        </div>

        <div class="export-options">
          <button class="primary" onclick="triggerFileDownload('audit')">📥 Download Full Audit JSON</button>
          <button class="success" onclick="triggerFileDownload('verified')">⭐ Download Verified Only</button>
          <button onclick="copyModalJson()">📋 Copy JSON to Clipboard</button>
        </div>

        <label style="font-size:0.76rem;color:var(--text-muted);">
          Export Payload (select and copy if automatic browser file download is restricted):
        </label>
        <textarea id="export-json-textarea" class="export-textarea" readonly onclick="this.select()"></textarea>
      </div>
      <div class="modal-footer">
        <span style="font-size:0.72rem;color:var(--text-muted);" id="modal-footer-info">Generated for NAGARSETU 3.1 Road Damage Review</span>
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

    const STORAGE_KEY = "nagarsetu_road_review_v2";

    function showToast(msg) {{
      const t = document.getElementById("toast");
      t.innerText = msg;
      t.className = "toast visible";
      setTimeout(() => {{
        t.className = "toast";
      }}, 3000);
    }}

    function analyzeImageWarnings(item) {{
      const warnings = [];
      const boxes = item.boxes;

      boxes.forEach(b => {{
        b.warnings = [];
        if (b.confidence < 0.35) {{
          b.warnings.push(`Low confidence (${{(b.confidence * 100).toFixed(1)}}%)`);
        }}

        const xc = b.xywh_normalized[0];
        const yc = b.xywh_normalized[1];
        const bw = b.xywh_normalized[2];
        const bh = b.xywh_normalized[3];
        const x1 = xc - bw / 2;
        const y1 = yc - bh / 2;
        const x2 = xc + bw / 2;
        const y2 = yc + bh / 2;

        if (x1 < 0.001 || y1 < 0.001 || x2 > 0.999 || y2 > 0.999) {{
          b.warnings.push("Extends to/beyond image edge");
        }}
      }});

      for (let i = 0; i < boxes.length; i++) {{
        for (let j = i + 1; j < boxes.length; j++) {{
          const b1 = boxes[i];
          const b2 = boxes[j];

          const x1_a = b1.xywh_normalized[0] - b1.xywh_normalized[2] / 2;
          const y1_a = b1.xywh_normalized[1] - b1.xywh_normalized[3] / 2;
          const x2_a = b1.xywh_normalized[0] + b1.xywh_normalized[2] / 2;
          const y2_a = b1.xywh_normalized[1] + b1.xywh_normalized[3] / 2;

          const x1_b = b2.xywh_normalized[0] - b2.xywh_normalized[2] / 2;
          const y1_b = b2.xywh_normalized[1] - b2.xywh_normalized[3] / 2;
          const x2_b = b2.xywh_normalized[0] + b2.xywh_normalized[2] / 2;
          const y2_b = b2.xywh_normalized[1] + b2.xywh_normalized[3] / 2;

          const interX1 = Math.max(x1_a, x1_b);
          const interY1 = Math.max(y1_a, y1_b);
          const interX2 = Math.min(x2_a, x2_b);
          const interY2 = Math.min(y2_a, y2_b);

          if (interX2 > interX1 && interY2 > interY1) {{
            const interArea = (interX2 - interX1) * (interY2 - interY1);
            const areaA = (x2_a - x1_a) * (y2_a - y1_a);
            const areaB = (x2_b - x1_b) * (y2_b - y1_b);
            const unionArea = areaA + areaB - interArea;
            const iou = unionArea > 0 ? interArea / unionArea : 0;
            const overlapSmaller = Math.min(areaA, areaB) > 0 ? interArea / Math.min(areaA, areaB) : 0;

            if (iou > 0.35 || overlapSmaller > 0.50) {{
              b1.warnings.push(`Overlaps Box #${{b2.id}} (IoU: ${{iou.toFixed(2)}})`);
              b2.warnings.push(`Overlaps Box #${{b1.id}} (IoU: ${{iou.toFixed(2)}})`);
            }}
          }}
        }}
      }}

      boxes.forEach(b => {{
        if (b.warnings.length > 0) {{
          warnings.push(`Box #${{b.id}}: ${{b.warnings.join(", ")}}`);
        }}
      }});

      item.has_warnings = warnings.length > 0;
      item.warning_messages = warnings;
      return warnings;
    }}

    function init() {{
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {{
        try {{
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length === INITIAL_DATA.length) {{
            // Merge to preserve newly enriched fields while maintaining review choices
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

      dataset.forEach(item => analyzeImageWarnings(item));

      filterImages();
      selectImage(0);
      updateKpis();
    }}

    function saveToStorage() {{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
      updateKpis();
      showToast("Saved to browser storage");
    }}

    function updateKpis() {{
      let totalBoxes = 0;
      let reviewedBoxes = 0;
      let correct = 0;
      let incorrect = 0;
      let adjustment = 0;
      let missingFlags = 0;
      let reviewedImagesCount = 0;

      dataset.forEach(img => {{
        if (img.missing_pothole_flag) missingFlags++;

        const isReviewed = (img.boxes.length === 0 && img.missing_pothole_flag) || 
                           (img.boxes.length > 0 && img.boxes.every(b => b.status !== "pending"));
        if (isReviewed) reviewedImagesCount++;

        img.boxes.forEach(b => {{
          totalBoxes++;
          if (b.status === "correct") {{ reviewedBoxes++; correct++; }}
          else if (b.status === "incorrect") {{ reviewedBoxes++; incorrect++; }}
          else if (b.status === "needs_adjustment") {{ reviewedBoxes++; adjustment++; }}
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
      if (val === "pending_only") document.getElementById("btn-filter-pending").classList.add("active");
      else if (val === "all") document.getElementById("btn-filter-all").classList.add("active");
      else if (val === "has_warnings") document.getElementById("btn-filter-warn").classList.add("active");
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

        const isReviewed = (item.boxes.length === 0 && item.missing_pothole_flag) || 
                           (item.boxes.length > 0 && item.boxes.every(b => b.status !== "pending"));
        const isPartial = item.boxes.some(b => b.status !== "pending") && !isReviewed;
        const hasPendingBoxes = item.boxes.some(b => b.status === "pending") || (item.boxes.length === 0 && !item.missing_pothole_flag);

        if (filter === "pending_only") matchesFilter = hasPendingBoxes;
        else if (filter === "reviewed_only") matchesFilter = isReviewed;
        else if (filter === "has_warnings") matchesFilter = !!item.has_warnings;
        else if (filter === "zero_detections") matchesFilter = item.boxes.length === 0;
        else if (filter === "missing_flagged") matchesFilter = !!item.missing_pothole_flag;
        else if (["train", "val", "test"].includes(filter)) matchesFilter = item.split === filter;

        if (matchesQuery && matchesFilter) {{
          const itemEl = document.createElement("div");
          itemEl.className = `image-item ${{idx === currentIdx ? "active" : ""}}`;
          itemEl.onclick = () => selectImage(idx);

          let statusBadge = "pending";
          let statusText = "Pending";
          if (item.boxes.length === 0) {{
            statusBadge = item.missing_pothole_flag ? "done" : "pending";
            statusText = item.missing_pothole_flag ? "Missed Flagged" : "0 Boxes";
          }} else if (isReviewed) {{
            statusBadge = "done";
            statusText = "Done";
          }} else if (isPartial) {{
            statusBadge = "partial";
            statusText = "Partial";
          }}

          itemEl.innerHTML = `
            <div class="image-item-info">
              <div>#${{item.index}} ${{item.filename}} ${{item.has_warnings ? "⚠️" : ""}}</div>
              <div class="image-item-meta">
                <span class="badge-split ${{item.split}}">${{item.split}}</span>
                ${{item.boxes.length}} boxes · ${{item.width}}x${{item.height}}
                ${{item.missing_pothole_flag ? "🟣" : ""}}
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
      analyzeImageWarnings(item);

      document.getElementById("img-meta-title").innerHTML = `
        <span><b>#${{item.index}}</b> ${{item.filename}}</span>
        <span class="badge-split ${{item.split}}">${{item.split}}</span>
        <span class="badge">${{item.width}}x${{item.height}}</span>
        <span class="badge">${{item.boxes.length}} boxes</span>
      `;

      const banner = document.getElementById("warning-banner");
      const bannerText = document.getElementById("warning-banner-text");
      if (item.has_warnings) {{
        banner.className = "warning-banner visible";
        bannerText.innerHTML = `⚠️ <b>Inspection Warnings:</b> ${{item.warning_messages.join(" · ")}}`;
      }} else {{
        banner.className = "warning-banner";
      }}

      const imgEl = document.getElementById("main-image");
      imgEl.src = item.rel_img_url;

      document.getElementById("image-note-input").value = item.notes || "";
      updateMissingPotholeBtn();
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
        const hasWarn = b.warnings && b.warnings.length > 0;
        boxEl.className = `bounding-box status-${{b.status}} ${{selectedBoxId === b.id ? "active" : ""}} ${{hasWarn ? "has-warning" : ""}}`;
        boxEl.style.left = b.css_left + "%";
        boxEl.style.top = b.css_top + "%";
        boxEl.style.width = b.css_width + "%";
        boxEl.style.height = b.css_height + "%";

        const warnIcon = hasWarn ? "⚠️" : "";
        boxEl.innerHTML = `<span class="box-tag">#${{b.id}} ${{Math.round(b.confidence * 100)}}% ${{warnIcon}}</span>`;

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
            No provisional boxes detected for this image.<br><br>
            If road defects exist, use <b>"🟣 Flag Missing Pothole(s)"</b> below.
          </div>
        `;
        return;
      }}

      item.boxes.forEach(b => {{
        const card = document.createElement("div");
        const hasWarn = b.warnings && b.warnings.length > 0;
        card.className = `box-card ${{selectedBoxId === b.id ? "active" : ""}} ${{hasWarn ? "card-warning" : ""}}`;
        card.id = `box-card-${{b.id}}`;
        card.onclick = () => selectBox(b.id);

        let warnHtml = "";
        if (hasWarn) {{
          warnHtml = `<div class="box-warning-tag">⚠️ ${{b.warnings.join(" | ")}}</div>`;
        }}

        card.innerHTML = `
          <div class="box-card-header">
            <b>Box #${{b.id}}: ${{b.class_name}}</b>
            <span class="badge">${{Math.round(b.confidence * 100)}}% conf</span>
          </div>
          ${{warnHtml}}
          <div class="box-card-meta">
            Normalized: [${{b.xywh_normalized.map(v => v.toFixed(3)).join(", ")}}]
          </div>
          <div class="box-card-actions">
            <button class="${{b.status === 'correct' ? 'selected-correct' : ''}}" onclick="setBoxStatus(${{b.id}}, 'correct', event)">
              ✅ Correct (1)
            </button>
            <button class="${{b.status === 'incorrect' ? 'selected-incorrect' : ''}}" onclick="setBoxStatus(${{b.id}}, 'incorrect', event)">
              ❌ Reject (2)
            </button>
            <button class="${{b.status === 'needs_adjustment' ? 'selected-adjustment' : ''}}" onclick="setBoxStatus(${{b.id}}, 'needs_adjustment', event)">
              ⚠️ Adjust (3)
            </button>
          </div>
          <input type="text" class="box-adjustment-input" placeholder="Adjustment note (e.g. boundary loose)..." value="${{b.adjustment_note || ''}}" onchange="updateBoxAdjustmentNote(${{b.id}}, this.value)" onclick="event.stopPropagation();" />
        `;
        list.appendChild(card);
      }});
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
        box.status = box.status === status ? "pending" : status;
        box.reviewed_at = new Date().toISOString();
        saveToStorage();
        renderBoundingBoxes();
        renderBoxCards();
        filterImages();
      }}
    }}

    function updateBoxAdjustmentNote(boxId, val) {{
      const item = dataset[currentIdx];
      const box = item.boxes.find(b => b.id === boxId);
      if (box) {{
        box.adjustment_note = val;
        saveToStorage();
      }}
    }}

    function approveAllCurrent() {{
      const item = dataset[currentIdx];
      if (item.boxes.length === 0) return;
      const now = new Date().toISOString();
      item.boxes.forEach(b => {{
        b.status = "correct";
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

    function toggleMissingPotholeFlag() {{
      const item = dataset[currentIdx];
      item.missing_pothole_flag = !item.missing_pothole_flag;
      updateMissingPotholeBtn();
      saveToStorage();
      filterImages();
    }}

    function updateMissingPotholeBtn() {{
      const item = dataset[currentIdx];
      const btn = document.getElementById("missing-pothole-btn");
      if (item.missing_pothole_flag) {{
        btn.innerText = "🟣 Flagged: Missing Pothole Present (Click to Unset)";
        btn.style.background = "#581c87";
        btn.style.borderColor = "#c084fc";
      }} else {{
        btn.innerText = "🟣 Flag Missing Pothole(s) on Image (M)";
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

    window.addEventListener("keydown", (e) => {{
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      
      if (e.shiftKey && (e.key === "A" || e.key === "a")) {{
        e.preventDefault();
        approveAllCurrent();
        return;
      }}
      if (e.shiftKey && (e.key === "R" || e.key === "r")) {{
        e.preventDefault();
        rejectAllCurrent();
        return;
      }}

      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") nextImage();
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") prevImage();
      if (e.key === "m" || e.key === "M") toggleMissingPotholeFlag();

      if (["1", "2", "3"].includes(e.key)) {{
        const item = dataset[currentIdx];
        if (item.boxes.length === 0) return;
        const targetId = selectedBoxId || item.boxes[0].id;
        const statusMap = {{ "1": "correct", "2": "incorrect", "3": "needs_adjustment" }};
        setBoxStatus(targetId, statusMap[e.key]);
      }}
    }});

    // Build complete export object
    function buildExportPayload(mode) {{
      let correct = 0, incorrect = 0, adjustment = 0, pending = 0, missingFlagged = 0;
      let totalImagesReviewed = 0;

      const structuredImages = [];

      dataset.forEach(img => {{
        const isReviewed = (img.boxes.length === 0 && img.missing_pothole_flag) ||
                           (img.boxes.length > 0 && img.boxes.every(b => b.status !== "pending"));
        if (isReviewed) totalImagesReviewed++;
        if (img.missing_pothole_flag) missingFlagged++;

        const processedBoxes = [];

        img.boxes.forEach(b => {{
          if (b.status === "correct") correct++;
          else if (b.status === "incorrect") incorrect++;
          else if (b.status === "needs_adjustment") adjustment++;
          else pending++;

          // In verified mode, include only approved boxes
          if (mode === "verified") {{
            if (b.status === "correct") {{
              processedBoxes.push({{
                id: b.id,
                global_id: b.global_id || `img_${{img.index}}_box_${{b.id}}`,
                class_id: 0,
                class_name: "Pothole",
                confidence: b.confidence,
                xywh_normalized: b.xywh_normalized,
                pixel_coordinates: b.pixel_coords,
                status: "correct",
                adjusted_xywh: b.adjusted_xywh || b.xywh_normalized,
                reviewed_at: b.reviewed_at || new Date().toISOString()
              }});
            }}
          }} else {{
            // Full audit mode includes all boxes
            processedBoxes.push({{
              id: b.id,
              global_id: b.global_id || `img_${{img.index}}_box_${{b.id}}`,
              class_id: 0,
              class_name: "Pothole",
              confidence: b.confidence,
              xywh_normalized: b.xywh_normalized,
              pixel_coordinates: b.pixel_coords,
              status: b.status,
              adjusted_xywh: b.adjusted_xywh || b.xywh_normalized,
              adjustment_note: b.adjustment_note || "",
              reviewed_at: b.reviewed_at || null
            }});
          }}
        }});

        if (mode === "verified" && processedBoxes.length === 0 && !img.missing_pothole_flag) {{
          // Skip empty in verified training export unless background
          return;
        }}

        structuredImages.push({{
          index: img.index,
          image_id: img.image_id || `img_${{img.index}}`,
          filename: img.filename,
          manifest_key: img.manifest_key || img.rel_path,
          rel_path: img.rel_path,
          split: img.split,
          group: img.group,
          dimensions: {{
            width: img.width,
            height: img.height
          }},
          missing_pothole_flag: !!img.missing_pothole_flag,
          notes: img.notes || "",
          is_fully_reviewed: isReviewed,
          boxes: processedBoxes
        }});
      }});

      const totalBoxes = correct + incorrect + adjustment + pending;
      return {{
        review_metadata: {{
          generated_at: new Date().toISOString(),
          system: "NAGARSETU 3.1 Fast Road Annotation Review Tool",
          export_type: mode === "verified" ? "verified_training_ground_truth" : "full_review_audit",
          dataset_source: "D:\\\\NAGARSETU\\\\road",
          total_images_in_dataset: dataset.length,
          reviewed_images_count: totalImagesReviewed,
          total_boxes_audited: totalBoxes,
          summary: {{
            approved_correct_boxes: correct,
            rejected_incorrect_boxes: incorrect,
            needs_adjustment_boxes: adjustment,
            pending_boxes: pending,
            images_with_missing_potholes: missingFlagged
          }}
        }},
        images: structuredImages
      }};
    }}

    // Robust file download handler with Blob + attached anchor + fallback
    function triggerFileDownload(mode) {{
      const exportObj = buildExportPayload(mode);
      const jsonStr = JSON.stringify(exportObj, null, 2);
      const filename = mode === "verified" 
        ? `road_annotations_verified_${{new Date().toISOString().slice(0, 10)}}.json`
        : `road_annotations_reviewed_audit_${{new Date().toISOString().slice(0, 10)}}.json`;

      let downloaded = false;

      // 1. Blob Download Attempt with DOM attachment
      try {{
        const blob = new Blob([jsonStr], {{ type: "application/json;charset=utf-8" }});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {{
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }}, 3000);
        downloaded = true;
      }} catch (err) {{
        console.warn("Blob download failed, trying data URI fallback...", err);
      }}

      // 2. Data URI Fallback if needed
      if (!downloaded) {{
        try {{
          const encoded = "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr);
          const a = document.createElement("a");
          a.style.display = "none";
          a.href = encoded;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => document.body.removeChild(a), 3000);
          downloaded = true;
        }} catch (err2) {{
          console.warn("Data URI download failed", err2);
        }}
      }}

      showToast(`Export initiated: ${{filename}}`);
    }}

    // Modal and Fallback Copy
    function openExportModal(mode) {{
      const exportObj = buildExportPayload(mode);
      cachedExportJson = JSON.stringify(exportObj, null, 2);

      const m = exportObj.review_metadata.summary;
      document.getElementById("m-stat-images").innerText = `${{exportObj.review_metadata.reviewed_images_count}} / ${{dataset.length}}`;
      document.getElementById("m-stat-correct").innerText = m.approved_correct_boxes;
      document.getElementById("m-stat-incorrect").innerText = m.rejected_incorrect_boxes;
      document.getElementById("m-stat-pending").innerText = m.pending_boxes;

      document.getElementById("modal-title").innerText = mode === "verified" 
        ? "⭐ Export Verified Annotations (Training Ready)" 
        : "📥 Export Full Review Audit JSON";

      document.getElementById("export-json-textarea").value = cachedExportJson;
      document.getElementById("export-modal").className = "modal-overlay active";
      
      // Auto-trigger direct download as well
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
      navigator.clipboard.writeText(jsonStr).then(() => {{
        showToast("✅ Full audit JSON copied to clipboard!");
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
            alert("Successfully imported reviewed annotations!");
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

    print(f"[OK] Generated upgraded road review tool with modal fallback: {OUTPUT_HTML_PATH}")
    print(f"Total images: {len(enriched_items)}")
    print(f"Total provisional bounding boxes: {total_boxes}")

if __name__ == "__main__":
    generate_review_page()
