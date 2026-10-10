import os
import json

WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\drainage_v2"
MANIFEST_PATH = os.path.join(WORKSPACE_DIR, "dataset_manifest.json")
OUTPUT_HTML_PATH = os.path.join(WORKSPACE_DIR, "drainage_review.html")

def build_review_html():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    inventory = manifest.get("inventory", [])
    json_payload = json.dumps(inventory, ensure_ascii=False)

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NAGARSETU 3.1 — Drainage AI Annotation & Label Review</title>
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
      --cyan: #06b6d4;
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
      padding: 10px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      z-index: 10;
    }}
    .brand {{
      display: flex;
      align-items: center;
      gap: 12px;
    }}
    .brand h1 {{
      font-size: 1.15rem;
      font-weight: 700;
      color: #fff;
    }}
    .badge {{
      background: var(--surface-light);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.72rem;
      font-weight: 600;
      border: 1px solid var(--border);
      color: var(--text-muted);
    }}
    .kpi-bar {{
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }}
    .kpi-chip {{
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      background: var(--surface-light);
      padding: 5px 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }}
    .kpi-chip b {{
      color: #fff;
    }}
    .kpi-chip.kpi-warn {{
      border-color: var(--warning);
      color: var(--warning);
    }}
    .actions-bar {{
      display: flex;
      gap: 8px;
    }}
    button {{
      background: var(--surface-light);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
    }}
    button:hover {{
      background: #283548;
      border-color: #4b5563;
    }}
    button.primary {{
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }}
    button.primary:hover {{
      background: #2563eb;
    }}
    button.success {{
      background: var(--success);
      border-color: var(--success);
      color: #fff;
    }}
    .main-layout {{
      display: flex;
      flex: 1;
      overflow: hidden;
    }}
    .sidebar {{
      width: 340px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }}
    .sidebar-filter {{
      padding: 10px;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }}
    .filter-btn-group {{
      display: flex;
      gap: 5px;
    }}
    .filter-btn {{
      flex: 1;
      padding: 5px;
      font-size: 0.72rem;
      border-radius: 4px;
      text-align: center;
      background: var(--surface-light);
      cursor: pointer;
      border: 1px solid var(--border);
    }}
    .filter-btn.active {{
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
      font-weight: 700;
    }}
    .image-list {{
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }}
    .image-item {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--surface-light);
      border: 1px solid transparent;
      cursor: pointer;
      font-size: 0.78rem;
      gap: 8px;
    }}
    .image-item:hover {{
      background: #263346;
    }}
    .image-item.active {{
      border-color: var(--primary);
      background: #1e293b;
    }}
    .image-item-info {{
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }}
    .badge-status {{
      font-size: 0.68rem;
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: 700;
      white-space: nowrap;
    }}
    .badge-status.normal {{ background: #064e3b; color: #34d399; }}
    .badge-status.blocked {{ background: #78350f; color: #fbbf24; }}
    .badge-status.damaged {{ background: #7f1d1d; color: #f87171; }}
    .badge-status.unreviewed {{ background: #4c1d95; color: #c084fc; border: 1px solid #a855f7; }}

    .stage-container {{
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: #000;
      position: relative;
    }}
    .stage-header {{
      padding: 10px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }}
    .image-stage {{
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      padding: 20px;
    }}
    .image-stage img {{
      max-width: 95%;
      max-height: 90%;
      object-fit: contain;
      border-radius: 4px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.8);
      border: 1px solid #334155;
    }}
    .control-panel {{
      width: 360px;
      background: var(--surface);
      border-left: 1px solid var(--border);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
    }}
    .panel-section {{
      background: var(--surface-light);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }}
    .panel-section h3 {{
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }}
    .class-btn-grid {{
      display: flex;
      flex-direction: column;
      gap: 8px;
    }}
    .class-choice-btn {{
      padding: 12px;
      border-radius: 6px;
      font-size: 0.88rem;
      font-weight: 700;
      border: 2px solid transparent;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.15s ease;
    }}
    .class-choice-btn.btn-normal {{
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border-color: rgba(16, 185, 129, 0.3);
    }}
    .class-choice-btn.btn-normal:hover, .class-choice-btn.btn-normal.active {{
      background: var(--success);
      color: #fff;
      border-color: var(--success);
    }}
    .class-choice-btn.btn-blocked {{
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border-color: rgba(245, 158, 11, 0.3);
    }}
    .class-choice-btn.btn-blocked:hover, .class-choice-btn.btn-blocked.active {{
      background: var(--warning);
      color: #000;
      border-color: var(--warning);
    }}
    .class-choice-btn.btn-damaged {{
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.3);
    }}
    .class-choice-btn.btn-damaged:hover, .class-choice-btn.btn-damaged.active {{
      background: var(--danger);
      color: #fff;
      border-color: var(--danger);
    }}
    .toast {{
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #1e293b;
      border: 1px solid var(--primary);
      padding: 10px 18px;
      border-radius: 6px;
      color: #fff;
      font-size: 0.85rem;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
      z-index: 100;
    }}
    .toast.visible {{ opacity: 1; }}
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>NAGARSETU 3.1 — Drainage AI Label Review</h1>
      <span class="badge">MobileNetV3-Small (3-Class)</span>
    </div>
    <div class="kpi-bar">
      <div class="kpi-chip">Total Unique: <b id="kpi-total">106</b></div>
      <div class="kpi-chip">Verified: <b id="kpi-verified" style="color:#10b981;">99</b></div>
      <div class="kpi-chip kpi-warn">Needs Review: <b id="kpi-unreviewed" style="color:#f59e0b;">7</b></div>
    </div>
    <div class="actions-bar">
      <button class="primary" onclick="saveToServer()">💾 Save Reviews to Disk</button>
      <button onclick="exportJson()">📥 Export JSON</button>
      <button onclick="copyJson()">📋 Copy JSON</button>
    </div>
  </header>

  <div class="main-layout">
    <div class="sidebar">
      <div class="sidebar-filter">
        <div class="filter-btn-group">
          <div class="filter-btn" id="filter-unreviewed" onclick="setFilter('unreviewed')">⚠️ Needs Review (7)</div>
          <div class="filter-btn active" id="filter-all" onclick="setFilter('all')">All (106)</div>
          <div class="filter-btn" id="filter-verified" onclick="setFilter('verified')">Verified (99)</div>
        </div>
      </div>
      <div class="image-list" id="image-list"></div>
    </div>

    <div class="stage-container">
      <div class="stage-header">
        <div>
          <b id="active-filename">Image filename</b>
          <span class="badge" id="active-dimensions">Dimensions</span>
        </div>
        <div>
          <button onclick="prevImage()">◀ Previous</button>
          <button onclick="nextImage()">Next ▶</button>
        </div>
      </div>
      <div class="image-stage">
        <img id="main-image" src="" alt="Drainage photograph" />
      </div>
    </div>

    <div class="control-panel">
      <div class="panel-section">
        <h3>Current Ground Truth Label</h3>
        <div class="class-btn-grid">
          <div class="class-choice-btn btn-normal" id="btn-normal" onclick="setLabel('normal_drain')">
            <span>🟢 Normal Drain (1)</span>
            <span style="font-size:0.75rem;">Clean / Functional</span>
          </div>
          <div class="class-choice-btn btn-blocked" id="btn-blocked" onclick="setLabel('blocked_drain')">
            <span>🟡 Blocked Drain (2)</span>
            <span style="font-size:0.75rem;">Clogged / Overflow</span>
          </div>
          <div class="class-choice-btn btn-damaged" id="btn-damaged" onclick="setLabel('damaged_drain')">
            <span>🔴 Broken Drain (3)</span>
            <span style="font-size:0.75rem;">Damaged Slab / Grate</span>
          </div>
        </div>
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="chk-overflow" onchange="toggleOverflow(this.checked)" />
          <label for="chk-overflow" style="font-size:0.8rem;cursor:pointer;">🌊 Flag as Overflowing Drain (Nuance)</label>
        </div>
      </div>

      <div class="panel-section">
        <h3>Review Status</h3>
        <div id="review-status-tag" style="font-size:0.85rem;font-weight:700;">Status</div>
        <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.4;" id="review-desc">
          Catalog label from ground truth catalog.
        </div>
        <button class="success" onclick="confirmCurrent()">✅ Confirm Label for this Image</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">Saved</div>

  <script>
    const INITIAL_DATA = {json_payload};
    const STORAGE_KEY = "nagarsetu_drainage_review_v2";
    let dataset = [];
    let currentIdx = 0;
    let currentFilter = "unreviewed";

    function init() {{
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {{
        try {{
          dataset = JSON.parse(stored);
        }} catch(e) {{
          dataset = INITIAL_DATA;
        }}
      }} else {{
        dataset = INITIAL_DATA;
      }}

      // Default to the first unreviewed image
      const firstUn = dataset.findIndex(d => !d.is_verified);
      currentIdx = firstUn !== -1 ? firstUn : 0;

      updateKpis();
      filterList();
      selectImage(currentIdx);

      // Keyboard shortcuts 1, 2, 3
      window.addEventListener("keydown", (e) => {{
        if (e.key === "1") setLabel("normal_drain");
        else if (e.key === "2") setLabel("blocked_drain");
        else if (e.key === "3") setLabel("damaged_drain");
        else if (e.key === "ArrowRight") nextImage();
        else if (e.key === "ArrowLeft") prevImage();
      }});
    }}

    function updateKpis() {{
      const total = dataset.length;
      const verified = dataset.filter(d => d.is_verified).length;
      const unreviewed = total - verified;

      document.getElementById("kpi-total").innerText = total;
      document.getElementById("kpi-verified").innerText = verified;
      document.getElementById("kpi-unreviewed").innerText = unreviewed;
    }}

    function setFilter(f) {{
      currentFilter = f;
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      document.getElementById(`filter-${{f}}`).classList.add("active");
      filterList();
    }}

    function filterList() {{
      const list = document.getElementById("image-list");
      list.innerHTML = "";

      dataset.forEach((item, idx) => {{
        if (currentFilter === "unreviewed" && item.is_verified) return;
        if (currentFilter === "verified" && !item.is_verified) return;

        const el = document.createElement("div");
        el.className = `image-item ${{idx === currentIdx ? "active" : ""}}`;
        el.onclick = () => selectImage(idx);

        let badgeCls = "unreviewed";
        let badgeTxt = "NEEDS REVIEW";
        if (item.is_verified) {{
          if (item.assigned_label === "normal_drain") {{ badgeCls = "normal"; badgeTxt = "NORMAL"; }}
          else if (item.assigned_label === "blocked_drain") {{ badgeCls = "blocked"; badgeTxt = item.is_overflow ? "OVERFLOW" : "BLOCKED"; }}
          else if (item.assigned_label === "damaged_drain") {{ badgeCls = "damaged"; badgeTxt = "DAMAGED"; }}
        }}

        el.innerHTML = `
          <div class="image-item-info">
            <b>#${{item.index}}</b> ${{item.filename}}
          </div>
          <span class="badge-status ${{badgeCls}}">${{badgeTxt}}</span>
        `;
        list.appendChild(el);
      }});
    }}

    function selectImage(idx) {{
      if (idx < 0 || idx >= dataset.length) return;
      currentIdx = idx;
      const item = dataset[currentIdx];

      document.getElementById("active-filename").innerText = `#${{item.index}} — ${{item.filename}}`;
      document.getElementById("active-dimensions").innerText = `${{item.width}}x${{item.height}} (${{item.group}})`;
      document.getElementById("main-image").src = item.relative_url;

      document.querySelectorAll(".class-choice-btn").forEach(b => b.classList.remove("active"));
      if (item.assigned_label === "normal_drain") document.getElementById("btn-normal").classList.add("active");
      else if (item.assigned_label === "blocked_drain") document.getElementById("btn-blocked").classList.add("active");
      else if (item.assigned_label === "damaged_drain") document.getElementById("btn-damaged").classList.add("active");

      document.getElementById("chk-overflow").checked = !!item.is_overflow;

      const stTag = document.getElementById("review-status-tag");
      const stDesc = document.getElementById("review-desc");
      if (item.is_verified) {{
        stTag.innerText = "✅ Confirmed Ground Truth";
        stTag.style.color = "#10b981";
        stDesc.innerText = `Class: ${{item.assigned_label.toUpperCase()}}${{item.is_overflow ? " (Overflowing)" : ""}}`;
      }} else {{
        stTag.innerText = "⚠️ Awaiting Human Confirmation";
        stTag.style.color = "#f59e0b";
        stDesc.innerText = `Suggested Label: ${{item.assigned_label.toUpperCase()}}. Click a button above to confirm or change.`;
      }}

      filterList();
    }}

    function setLabel(label) {{
      const item = dataset[currentIdx];
      item.assigned_label = label;
      item.is_verified = true;
      item.status = "verified";
      if (label !== "blocked_drain") item.is_overflow = false;
      saveLocal();
      selectImage(currentIdx);
      showToast(`Set to ${{label.toUpperCase()}}`);
    }}

    function toggleOverflow(val) {{
      const item = dataset[currentIdx];
      item.is_overflow = val;
      if (val) {{
        item.assigned_label = "blocked_drain";
        item.is_verified = true;
      }}
      saveLocal();
      selectImage(currentIdx);
    }}

    function confirmCurrent() {{
      const item = dataset[currentIdx];
      item.is_verified = true;
      item.status = "verified";
      saveLocal();
      showToast(`Confirmed #${{item.index}} as ${{item.assigned_label.toUpperCase()}}`);
      nextImage();
    }}

    function nextImage() {{
      if (currentIdx < dataset.length - 1) selectImage(currentIdx + 1);
    }}

    function prevImage() {{
      if (currentIdx > 0) selectImage(currentIdx - 1);
    }}

    function saveLocal() {{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
      updateKpis();
    }}

    function buildPayload() {{
      return {{
        review_metadata: {{
          generated_at: new Date().toISOString(),
          system: "NAGARSETU 3.1 Drainage AI Review Tool",
          total_images: dataset.length,
          verified_images: dataset.filter(d => d.is_verified).length,
          class_counts: {{
            normal_drain: dataset.filter(d => d.is_verified && d.assigned_label === "normal_drain").length,
            blocked_drain: dataset.filter(d => d.is_verified && d.assigned_label === "blocked_drain").length,
            damaged_drain: dataset.filter(d => d.is_verified && d.assigned_label === "damaged_drain").length,
            overflow_drain: dataset.filter(d => d.is_verified && d.is_overflow).length
          }}
        }},
        images: dataset
      }};
    }}

    function saveToServer() {{
      saveLocal();
      const payload = JSON.stringify(buildPayload(), null, 2);
      fetch("http://localhost:8767/save", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: payload
      }}).then(r => r.json()).then(data => {{
        showToast("✅ Successfully saved to server disk!");
      }}).catch(e => {{
        showToast("Saved locally (Server offline)");
      }});
    }}

    function exportJson() {{
      saveToServer();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(buildPayload(), null, 2));
      const a = document.createElement("a");
      a.href = dataStr;
      a.download = "drainage_annotations_reviewed.json";
      a.click();
    }}

    function copyJson() {{
      const payload = JSON.stringify(buildPayload(), null, 2);
      navigator.clipboard.writeText(payload).then(() => {{
        showToast("✅ JSON copied to clipboard!");
      }});
    }}

    function showToast(msg) {{
      const t = document.getElementById("toast");
      t.innerText = msg;
      t.className = "toast visible";
      setTimeout(() => {{ t.className = "toast"; }}, 2500);
    }}

    window.onload = init;
  </script>
</body>
</html>
"""

    with open(OUTPUT_HTML_PATH, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"[OK] Generated Drainage Review HTML: {OUTPUT_HTML_PATH}")

if __name__ == "__main__":
    build_review_html()
