import os
import sys
import json
import torch
import numpy as np
from PIL import Image
import torchvision.transforms as T

# Import model architecture
sys.path.append(r"d:\NAGARSETU\NAGARSETU 3.1")
from ai_service.train_pipe_model import WaterPipeClassifier

BASELINE_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\water_pipe_model.pt"
DIR_NORMAL = r"D:\NAGARSETU\normal pipe images"
DIR_LEAK = r"D:\NAGARSETU\leaking pipes"

def evaluate_baseline_on_all():
    checkpoint = torch.load(BASELINE_MODEL_PATH, map_location="cpu")
    model = WaterPipeClassifier(num_classes=3)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    eval_transform = T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    normal_files = sorted([os.path.join(DIR_NORMAL, f) for f in os.listdir(DIR_NORMAL) if os.path.isfile(os.path.join(DIR_NORMAL, f))])
    leak_files = sorted([os.path.join(DIR_LEAK, f) for f in os.listdir(DIR_LEAK) if os.path.isfile(os.path.join(DIR_LEAK, f)) and f != "images (21).jpg"])

    print(f"Total normal images: {len(normal_files)}")
    print(f"Total leak/damaged images: {len(leak_files)}")

    # Evaluate Normal: ground truth = class 0 (perfect_pipe)
    norm_preds = []
    norm_probs = []
    for p in normal_files:
        with Image.open(p) as img:
            t = eval_transform(img.convert("RGB")).unsqueeze(0)
            with torch.no_grad():
                out = model(t)
                probs = torch.softmax(out, dim=1)[0].numpy()
                pred = int(np.argmax(probs))
                norm_preds.append(pred)
                norm_probs.append(probs)

    norm_correct = sum(1 for p in norm_preds if p == 0)
    print(f"\nBaseline on NORMAL images ({len(normal_files)} total):")
    print(f"  Predicted class 0 (perfect): {norm_correct}/{len(normal_files)} ({norm_correct/len(normal_files):.1%})")
    print(f"  Predicted class 1 (leakage): {sum(1 for p in norm_preds if p == 1)}")
    print(f"  Predicted class 2 (broken):  {sum(1 for p in norm_preds if p == 2)}")

    # Evaluate Leak/Damaged: ground truth = defective (class 1 or 2)
    leak_preds = []
    leak_probs = []
    for p in leak_files:
        with Image.open(p) as img:
            t = eval_transform(img.convert("RGB")).unsqueeze(0)
            with torch.no_grad():
                out = model(t)
                probs = torch.softmax(out, dim=1)[0].numpy()
                pred = int(np.argmax(probs))
                leak_preds.append(pred)
                leak_probs.append(probs)

    leak_detected_as_defect = sum(1 for p in leak_preds if p in (1, 2))
    print(f"\nBaseline on LEAKING/DAMAGED images ({len(leak_files)} total):")
    print(f"  Detected as defect (class 1 or 2): {leak_detected_as_defect}/{len(leak_files)} ({leak_detected_as_defect/len(leak_files):.1%})")
    print(f"  Misclassified as normal (class 0): {sum(1 for p in leak_preds if p == 0)} (False Negatives!)")
    print(f"  Predicted class 1 (leakage): {sum(1 for p in leak_preds if p == 1)}")
    print(f"  Predicted class 2 (broken):  {sum(1 for p in leak_preds if p == 2)}")

    # Overall binary accuracy (normal vs defect)
    total = len(normal_files) + len(leak_files)
    correct_binary = norm_correct + leak_detected_as_defect
    print(f"\nBaseline OVERALL binary accuracy (Normal vs Defect): {correct_binary}/{total} ({correct_binary/total:.1%})")

if __name__ == "__main__":
    evaluate_baseline_on_all()
