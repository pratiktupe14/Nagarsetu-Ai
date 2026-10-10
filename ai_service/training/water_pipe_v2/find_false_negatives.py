import os
import sys
import torch
import numpy as np
from PIL import Image
import torchvision.transforms as T

sys.path.append(r"d:\NAGARSETU\NAGARSETU 3.1")
from ai_service.train_pipe_model import WaterPipeClassifier

BASELINE_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\water_pipe_model.pt"
DIR_LEAK = r"D:\NAGARSETU\leaking pipes"

checkpoint = torch.load(BASELINE_MODEL_PATH, map_location="cpu")
model = WaterPipeClassifier(num_classes=3)
model.load_state_dict(checkpoint["model_state_dict"])
model.eval()

eval_transform = T.Compose([
    T.Resize((224, 224)),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

leak_files = sorted([f for f in os.listdir(DIR_LEAK) if os.path.isfile(os.path.join(DIR_LEAK, f)) and f != "images (21).jpg"])

print("--- FALSE NEGATIVES (Leaking pipes misclassified as Normal) ---")
for f in leak_files:
    p = os.path.join(DIR_LEAK, f)
    with Image.open(p) as img:
        t = eval_transform(img.convert("RGB")).unsqueeze(0)
        with torch.no_grad():
            out = model(t)
            probs = torch.softmax(out, dim=1)[0].numpy()
            pred = int(np.argmax(probs))
            if pred == 0:
                print(f"File: {f} | Probabilities: Perf={probs[0]:.3f}, Leak={probs[1]:.3f}, Broken={probs[2]:.3f}")
