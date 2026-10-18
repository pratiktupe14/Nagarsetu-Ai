import os
import io
from pathlib import Path
from typing import List, Dict, Any, Optional
from PIL import Image

# Configurable paths and threshold
BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL_DIR = BASE_DIR / "model"
WASTE_MODEL_PATH = os.getenv("WASTE_MODEL_PATH", str(DEFAULT_MODEL_DIR / "best.pt"))
POTHOLE_MODEL_PATH = os.getenv("POTHOLE_MODEL_PATH", str(DEFAULT_MODEL_DIR / "civicmodel.pt"))
WATER_PIPE_MODEL_PATH = os.getenv("WATER_PIPE_MODEL_PATH", str(DEFAULT_MODEL_DIR / "water_pipe_model.pt"))
DRAINAGE_MODEL_PATH = os.getenv("DRAINAGE_MODEL_PATH", str(DEFAULT_MODEL_DIR / "drainage_model.pt"))
CONFIDENCE_THRESHOLD = float(os.getenv("AI_CONFIDENCE_THRESHOLD", os.getenv("CONFIDENCE_THRESHOLD", "0.45")))
HIGH_CONFIDENCE_THRESHOLD = float(os.getenv("AI_HIGH_CONFIDENCE_THRESHOLD", "0.75"))
MIN_DETECTION_CONFIDENCE = float(os.getenv("AI_MIN_DETECTION_CONFIDENCE", "0.25"))

_waste_model = None
_pothole_model = None
_water_pipe_model = None
_water_pipe_meta = None
_drainage_model = None
_drainage_meta = None
_models_loaded = False


import torch
import torch.nn as nn
import torchvision.models as models


class WaterPipeClassifier(nn.Module):
    """
    Lightweight, high-accuracy transfer-learning model based on MobileNetV3-Small
    for real-time civic pipe condition classification.
    """
    def __init__(self, num_classes=3, pretrained=False):
        super(WaterPipeClassifier, self).__init__()
        if pretrained:
            weights = models.MobileNet_V3_Small_Weights.DEFAULT
            self.backbone = models.mobilenet_v3_small(weights=weights)
        else:
            self.backbone = models.mobilenet_v3_small(weights=None)
        in_features = self.backbone.classifier[3].in_features
        self.backbone.classifier[3] = nn.Linear(in_features, num_classes)

    def forward(self, x):
        return self.backbone(x)


class DrainageClassifier(nn.Module):
    """
    Lightweight, high-accuracy transfer-learning model based on MobileNetV3-Small
    for real-time civic drainage condition classification.
    """
    def __init__(self, num_classes=3, pretrained=False):
        super(DrainageClassifier, self).__init__()
        if pretrained:
            weights = models.MobileNet_V3_Small_Weights.DEFAULT
            self.backbone = models.mobilenet_v3_small(weights=weights)
        else:
            self.backbone = models.mobilenet_v3_small(weights=None)
        in_features = self.backbone.classifier[3].in_features
        self.backbone.classifier[3] = nn.Linear(in_features, num_classes)

    def forward(self, x):
        return self.backbone(x)


def load_models():
    """
    Loads YOLOv8 and water pipe models once at startup.
    Logs standard progress messages as required.
    """
    global _waste_model, _pothole_model, _water_pipe_model, _water_pipe_meta, _drainage_model, _drainage_meta, _models_loaded
    if _models_loaded:
        return

    from ultralytics import YOLO

    # 1. Load civicmodel.pt
    print("[AI] Loading civicmodel.pt")
    if os.path.exists(POTHOLE_MODEL_PATH):
        try:
            _pothole_model = YOLO(POTHOLE_MODEL_PATH)
            print("[AI] civicmodel.pt loaded")
        except Exception as e:
            print(f"[AI] Error loading civicmodel.pt: {e}")
            _pothole_model = None
    else:
        print(f"[AI] civicmodel.pt not found at: {POTHOLE_MODEL_PATH}")
        _pothole_model = None

    # 2. Load best.pt
    print("[AI] Loading best.pt")
    if os.path.exists(WASTE_MODEL_PATH):
        try:
            _waste_model = YOLO(WASTE_MODEL_PATH)
            print("[AI] best.pt loaded")
        except Exception as e:
            print(f"[AI] Error loading best.pt: {e}")
            _waste_model = None
    else:
        print(f"[AI] best.pt not found at: {WASTE_MODEL_PATH}")
        _waste_model = None

    # 3. Load water_pipe_model.pt
    print("[AI] Loading water_pipe_model.pt")
    if os.path.exists(WATER_PIPE_MODEL_PATH):
        try:
            checkpoint = torch.load(WATER_PIPE_MODEL_PATH, map_location="cpu")
            num_cls = checkpoint.get("num_classes", 3)
            pipe_mod = WaterPipeClassifier(num_classes=num_cls)
            pipe_mod.load_state_dict(checkpoint["model_state_dict"])
            pipe_mod.eval()
            _water_pipe_model = pipe_mod
            _water_pipe_meta = checkpoint
            print("[AI] water_pipe_model.pt loaded")
        except Exception as e:
            print(f"[AI] Error loading water_pipe_model.pt: {e}")
            _water_pipe_model = None
    else:
        print(f"[AI] water_pipe_model.pt not found at: {WATER_PIPE_MODEL_PATH}")
        _water_pipe_model = None

    # 4. Load drainage_model.pt
    print("[AI] Loading drainage_model.pt")
    if os.path.exists(DRAINAGE_MODEL_PATH):
        try:
            checkpoint = torch.load(DRAINAGE_MODEL_PATH, map_location="cpu")
            num_cls = checkpoint.get("num_classes", 3)
            drain_mod = DrainageClassifier(num_classes=num_cls)
            drain_mod.load_state_dict(checkpoint["model_state_dict"])
            drain_mod.eval()
            _drainage_model = drain_mod
            _drainage_meta = checkpoint
            print("[AI] drainage_model.pt loaded")
        except Exception as e:
            print(f"[AI] Error loading drainage_model.pt: {e}")
            _drainage_model = None
    else:
        print(f"[AI] drainage_model.pt not found at: {DRAINAGE_MODEL_PATH}")
        _drainage_model = None

    _models_loaded = True
    print("[AI] Models ready")


def get_pothole_model():
    global _pothole_model
    if not _models_loaded:
        load_models()
    return _pothole_model


def get_waste_model():
    global _waste_model
    if not _models_loaded:
        load_models()
    return _waste_model


def get_water_pipe_model():
    global _water_pipe_model
    if not _models_loaded:
        load_models()
    return _water_pipe_model


def get_drainage_model():
    global _drainage_model
    if not _models_loaded:
        load_models()
    return _drainage_model


def is_water_pipe_model_loaded() -> bool:
    return get_water_pipe_model() is not None


def is_drainage_model_loaded() -> bool:
    return get_drainage_model() is not None


def get_confidence_threshold() -> float:
    return CONFIDENCE_THRESHOLD


def get_high_confidence_threshold() -> float:
    return HIGH_CONFIDENCE_THRESHOLD


def is_pothole_model_loaded() -> bool:
    return get_pothole_model() is not None


def is_waste_model_loaded() -> bool:
    return get_waste_model() is not None


def run_pipe_classification(
    pil_image: Image.Image,
    threshold: float = MIN_DETECTION_CONFIDENCE
) -> Optional[Dict[str, Any]]:
    """
    Runs real two-stage inference on a PIL image using water_pipe_model.pt:
    Stage 1: MobileNetV3 3-class posterior distribution (perfect_pipe, water_leakage, broken_pipe)
    Stage 2: Conservative structural rupture verification & decision layer
    """
    model = get_water_pipe_model()
    if model is None or pil_image is None:
        return None

    try:
        import torch
        import torchvision.transforms as T
        eval_transform = T.Compose([
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        rgb = pil_image.convert("RGB")
        tensor = eval_transform(rgb).unsqueeze(0)
        with torch.no_grad():
            outputs = model(tensor)
            probs = torch.softmax(outputs, dim=1)[0]
            score, pred_idx = torch.max(probs, dim=0)
            score_val = float(score.item())
            pred_val = int(pred_idx.item())

        if len(probs) >= 3:
            class_map = {0: "perfect_pipe", 1: "water_leakage", 2: "broken_pipe"}
            raw_pred_class = class_map.get(pred_val, "broken_pipe")
            p_perf = round(float(probs[0].item()), 4)
            p_leak = round(float(probs[1].item()), 4)
            p_broken = round(float(probs[2].item()), 4)
        else:
            class_map = {0: "perfect_pipe", 1: "water_leakage"}
            raw_pred_class = class_map.get(pred_val, "water_leakage")
            p_perf = round(float(probs[0].item()), 4)
            p_leak = round(float(probs[1].item()), 4)
            p_broken = 0.0

        # Stage 2: Structural rupture verification
        has_structural_evidence = bool(p_broken >= 0.50 or (p_broken >= 0.40 and p_broken > p_leak))
        structural_confidence = p_broken

        # Two-stage Decision Logic (Phase 4):
        # Case A: Perfect pipe sufficiently dominant -> confirmed normal, no complaint
        if p_perf >= 0.50 and p_perf > p_leak and p_perf > p_broken:
            final_class = "perfect_pipe"
            final_conf = p_perf
            ai_status = "confirmed_normal"
            detected = False
            review_required = False
            decision_case = "CASE_A_PERFECT_PIPE"
        # Case B & E: Clear structural rupture (broken probability strong and structural rupture verified)
        elif p_broken >= 0.50 and p_broken > p_leak:
            final_class = "broken_pipe"
            final_conf = p_broken
            ai_status = "confirmed" if p_broken >= 0.70 else "suggested"
            detected = True
            review_required = bool(p_broken < 0.70)
            decision_case = "CASE_B_CLEAR_STRUCTURAL_RUPTURE"
        # Case C: Clear water leakage (leakage probability strong and structural evidence weak/absent)
        elif p_leak >= 0.45 and not has_structural_evidence:
            final_class = "water_leakage"
            final_conf = p_leak
            ai_status = "confirmed" if p_leak >= 0.70 else "suggested"
            detected = True
            review_required = bool(p_leak < 0.70)
            decision_case = "CASE_C_CLEAR_WATER_LEAKAGE"
        # Case D: Water + possible structural damage (water strong, structural evidence uncertain)
        elif p_leak >= 0.45 and has_structural_evidence:
            final_class = "water_leakage"
            final_conf = p_leak
            ai_status = "suggested"
            detected = True
            review_required = True
            decision_case = "CASE_D_WATER_AND_POSSIBLE_STRUCTURAL_DAMAGE"
        # Case F: Low confidence or low separation
        elif max(p_perf, p_leak, p_broken) < 0.45:
            final_class = "uncertain"
            final_conf = max(p_perf, p_leak, p_broken)
            ai_status = "manual_review"
            detected = False
            review_required = True
            decision_case = "CASE_F_LOW_CONFIDENCE"
        else:
            final_class = raw_pred_class
            final_conf = score_val
            ai_status = "suggested"
            detected = (final_class != "perfect_pipe")
            review_required = True
            decision_case = "CASE_FALLBACK"

        return {
            "class": final_class,
            "confidence": round(final_conf, 4),
            "predicted_class": raw_pred_class,
            "perfect_probability": p_perf,
            "leakage_probability": p_leak,
            "broken_probability": p_broken,
            "structural_rupture_evidence": has_structural_evidence,
            "structural_confidence": round(structural_confidence, 4),
            "final_class": final_class,
            "final_confidence": round(final_conf, 4),
            "detected": detected,
            "ai_status": ai_status,
            "review_required": review_required,
            "decision_case": decision_case,
            "model": "water_pipe_model.pt"
        }
    except Exception as e:
        print(f"[AI] Error during pipe classification: {e}")
        return None


def run_drainage_classification(
    pil_image: Image.Image,
    threshold: float = MIN_DETECTION_CONFIDENCE
) -> Optional[Dict[str, Any]]:
    """
    Runs real inference on a PIL image using drainage_model.pt:
    Classes:
    0: normal_drain
    1: blocked_drain
    2: damaged_drain
    Decision layer handles normal safety, clear defects, and overflow nuances.
    """
    model = get_drainage_model()
    if model is None or pil_image is None:
        return None

    try:
        import torch
        import torchvision.transforms as T
        eval_transform = T.Compose([
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        rgb = pil_image.convert("RGB")
        tensor = eval_transform(rgb).unsqueeze(0)
        with torch.no_grad():
            outputs = model(tensor)
            probs = torch.softmax(outputs, dim=1)[0]
            score, pred_idx = torch.max(probs, dim=0)
            score_val = float(score.item())
            pred_val = int(pred_idx.item())

        class_map = {0: "normal_drain", 1: "blocked_drain", 2: "damaged_drain"}
        raw_pred_class = class_map.get(pred_val, "blocked_drain")

        p_norm = round(float(probs[0].item()), 4)
        p_block = round(float(probs[1].item()), 4)
        p_dam = round(float(probs[2].item()), 4)

        # Decision Layer:
        # Case A: Normal drain sufficiently confident -> confirmed normal, no complaint
        if p_norm >= 0.50 and p_norm > p_block and p_norm > p_dam:
            final_class = "normal_drain"
            final_conf = p_norm
            ai_status = "confirmed_normal"
            detected = False
            review_required = False
            decision_case = "CASE_A_NORMAL_DRAIN"
        # Case B: Clear Damaged Drain (broken slab, collapsed cover)
        elif p_dam >= 0.50 and p_dam > p_norm:
            final_class = "damaged_drain"
            final_conf = p_dam
            ai_status = "confirmed" if p_dam >= 0.70 else "suggested"
            detected = True
            review_required = bool(p_dam < 0.70)
            decision_case = "CASE_B_CLEAR_DAMAGED_DRAIN"
        # Case C: Clear Blocked Drain (garbage, debris, clogged flow)
        elif p_block >= 0.45 and p_block > p_norm:
            final_class = "blocked_drain"
            final_conf = p_block
            ai_status = "confirmed" if p_block >= 0.70 else "suggested"
            detected = True
            review_required = bool(p_block < 0.70)
            decision_case = "CASE_C_CLEAR_BLOCKED_DRAIN"
        # Case D: Low Confidence / Borderline
        elif max(p_norm, p_block, p_dam) < 0.45:
            final_class = "uncertain"
            final_conf = max(p_norm, p_block, p_dam)
            ai_status = "manual_review"
            detected = False
            review_required = True
            decision_case = "CASE_D_LOW_CONFIDENCE"
        else:
            final_class = raw_pred_class
            final_conf = score_val
            ai_status = "suggested"
            detected = (final_class != "normal_drain")
            review_required = True
            decision_case = "CASE_FALLBACK"

        return {
            "class": final_class,
            "confidence": round(final_conf, 4),
            "predicted_class": raw_pred_class,
            "normal_probability": p_norm,
            "blocked_probability": p_block,
            "damaged_probability": p_dam,
            "final_class": final_class,
            "final_confidence": round(final_conf, 4),
            "detected": detected,
            "ai_status": ai_status,
            "review_required": review_required,
            "decision_case": decision_case,
            "model": "drainage_model.pt"
        }
    except Exception as e:
        print(f"[AI] Error during drainage classification: {e}")
        return None


def run_yolo_detection(
    model,
    pil_image: Image.Image,
    model_name: str,
    threshold: float = MIN_DETECTION_CONFIDENCE
) -> List[Dict[str, Any]]:
    """
    Runs actual inference on a PIL image using the specified YOLO model.
    Returns real classes, real confidences, and bounding boxes.
    """
    if model is None:
        return []

    detections = []
    try:
        results = model(pil_image, conf=threshold, verbose=False)
        for r in results:
            names_dict = r.names or {}
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = names_dict.get(cls_id, f"class_{cls_id}").strip()
                conf = float(box.conf[0])
                xyxy = [round(float(v), 2) for v in box.xyxy[0].tolist()]

                if conf >= threshold:
                    detections.append({
                        "class": cls_name,
                        "confidence": round(conf, 4),
                        "bbox": xyxy,
                        "model": model_name
                    })
    except Exception as e:
        print(f"[AI] Inference error on {model_name}: {e}")
        raise e

    return detections
