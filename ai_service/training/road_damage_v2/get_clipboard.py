import subprocess
import json
import os

TARGET = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\road_damage_v2\road_annotations_reviewed_audit.json"

try:
    import tkinter as tk
    root = tk.Tk()
    root.withdraw()
    clip_text = root.clipboard_get()
    print(f"Clipboard length: {len(clip_text)}")
    data = json.loads(clip_text)
    print("Parsed JSON successfully!")
    with open(TARGET, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"[SUCCESS] Exported JSON saved to: {TARGET}")
except Exception as e:
    print(f"Error fetching clipboard: {e}")
