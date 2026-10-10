import os
import cv2
import numpy as np
from PIL import Image

DIR_LEAK = r"D:\NAGARSETU\leaking pipes"

def inspect_visual_characteristics():
    files = sorted([f for f in os.listdir(DIR_LEAK) if os.path.isfile(os.path.join(DIR_LEAK, f)) and f != "images (21).jpg"])
    
    print(f"Total files: {len(files)}")
    print(f"{'Filename':50s} | {'Water/Blue%':12s} | {'BrightSpray%':12s} | {'Aspect':8s}")
    print("-" * 90)

    water_heavy = []
    dry_damage = []

    for f in files:
        p = os.path.join(DIR_LEAK, f)
        try:
            pil = Image.open(p).convert("RGB")
            arr = np.array(pil)
            hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)
            blue = np.sum((hsv[:, :, 0] > 80) & (hsv[:, :, 0] < 135) & (hsv[:, :, 1] > 30)) / arr.size
            spray = np.sum((hsv[:, :, 2] > 220) & (hsv[:, :, 1] < 50)) / arr.size
            aspect = f"{arr.shape[1]}/{arr.shape[0]}"
            print(f"{f:50s} | {blue*100:10.2f}% | {spray*100:10.2f}% | {aspect:8s}")
            if spray > 0.01 or blue > 0.02 or any(k in f.lower() for k in ["leak", "spray", "water"]):
                water_heavy.append(f)
            else:
                dry_damage.append(f)
        except Exception as e:
            print(f"{f:50s} | ERROR: {e}")

    print(f"\nPotential water-heavy images: {len(water_heavy)}")
    print(f"Potential structural damage images: {len(dry_damage)}")

if __name__ == "__main__":
    inspect_visual_characteristics()
