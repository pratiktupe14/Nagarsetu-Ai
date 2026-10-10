import os
from PIL import Image
import numpy as np

DIR_LEAK = r"D:\NAGARSETU\leaking pipes"
DIR_NORM = r"D:\NAGARSETU\normal pipe images"

def inspect_all_leak_images():
    files = sorted([f for f in os.listdir(DIR_LEAK) if os.path.isfile(os.path.join(DIR_LEAK, f))])
    print(f"Total files in leaking pipes: {len(files)}")
    
    for idx, f in enumerate(files):
        p = os.path.join(DIR_LEAK, f)
        try:
            with Image.open(p) as img:
                w, h = img.size
                mode = img.mode
            print(f"[{idx+1:02d}] {f:55s} | size: {w}x{h} | mode: {mode}")
        except Exception as e:
            print(f"[{idx+1:02d}] {f:55s} | ERROR: {e}")

if __name__ == "__main__":
    inspect_all_leak_images()
