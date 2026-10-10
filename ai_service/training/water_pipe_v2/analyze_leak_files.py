import os
from PIL import Image
import numpy as np

DIR_LEAK = r"D:\NAGARSETU\leaking pipes"
DIR_NORM = r"D:\NAGARSETU\normal pipe images"

def analyze_images():
    files = sorted(os.listdir(DIR_LEAK))
    print(f"Total files in leaking pipes: {len(files)}")
    
    # Check each file
    categories = {
        "explicit_burst_broken": [],
        "explicit_leak": [],
        "whatsapp_images": [],
        "numbered_images": [],
        "other": []
    }
    
    for f in files:
        fl = f.lower()
        if "broken" in fl or "burst" in fl:
            categories["explicit_burst_broken"].append(f)
        elif "leak" in fl or "waste-water" in fl:
            categories["explicit_leak"].append(f)
        elif "whatsapp" in fl:
            categories["whatsapp_images"].append(f)
        elif "images (" in fl or f == "images.jpg" or f == "images.jpeg":
            categories["numbered_images"].append(f)
        else:
            categories["other"].append(f)

    for k, v in categories.items():
        print(f"\nCategory: {k} ({len(v)} files)")
        for fname in v[:10]:
            print(f"  {fname}")
        if len(v) > 10:
            print(f"  ... and {len(v)-10} more")

if __name__ == "__main__":
    analyze_images()
