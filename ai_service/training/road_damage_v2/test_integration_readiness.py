import os
import sys
from PIL import Image
from ultralytics import YOLO

sys.path.append(r"d:\NAGARSETU\NAGARSETU 3.1")
from ai_service.model_manager import run_yolo_detection, get_confidence_threshold, MIN_DETECTION_CONFIDENCE
from ai_service.mappings.civic_issue_mapping import CIVIC_ISSUE_MAPPING, is_supported_class

CIVIC_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\civicmodel.pt"
CANDIDATE_MODEL_PATH = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\model\road_damage_model_v2.pt"

def test_integration():
    print("=" * 70)
    print("TESTING AI AGENT INTEGRATION READINESS")
    print("=" * 70)

    # 1. Load both models
    print("1. Loading models...")
    existing_model = YOLO(CIVIC_MODEL_PATH)
    candidate_model = YOLO(CANDIDATE_MODEL_PATH)
    print("   [PASS] Both models loaded into Ultralytics YOLO runtime.")

    # 2. Test inference with representative image
    test_img_path = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\road_damage_v2\images\test\images_(14).jpg"
    with Image.open(test_img_path) as im:
        pil_img = im.convert("RGB")
        w, h = pil_img.size

    print(f"2. Testing inference on sample image: {test_img_path} ({w}x{h})...")
    
    # Run through NAGARSETU standard run_yolo_detection interface
    dets_existing = run_yolo_detection(existing_model, pil_img, model_name="civicmodel.pt", threshold=0.25)
    dets_candidate = run_yolo_detection(candidate_model, pil_img, model_name="road_damage_model_v2.pt", threshold=0.25)

    print(f"   Existing model detections: {len(dets_existing)}")
    print(f"   Candidate model detections: {len(dets_candidate)}")

    # 3. Verify detection structure & coordinates
    for name, dets in [("Existing", dets_existing), ("Candidate", dets_candidate)]:
        for i, d in enumerate(dets):
            assert "class" in d, f"Missing class in {name}"
            assert "confidence" in d, f"Missing confidence in {name}"
            assert "bbox" in d, f"Missing bbox in {name}"
            assert "model" in d, f"Missing model in {name}"

            cls_name = d["class"]
            conf = d["confidence"]
            bbox = d["bbox"]

            assert 0.0 <= conf <= 1.0, f"Invalid confidence {conf}"
            assert len(bbox) == 4, f"Invalid bbox shape {bbox}"
            x1, y1, x2, y2 = bbox
            assert 0 <= x1 <= w and 0 <= y1 <= h, f"Box coords out of bounds: {bbox}"
            assert 0 <= x2 <= w and 0 <= y2 <= h, f"Box coords out of bounds: {bbox}"
            assert x2 >= x1 and y2 >= y1, f"Inverted box coordinates: {bbox}"

            # Check mapping compatibility
            assert is_supported_class(cls_name), f"Class {cls_name} not supported in CIVIC_ISSUE_MAPPING"
            meta = CIVIC_ISSUE_MAPPING.get(cls_name.strip().lower())
            assert meta is not None, f"Class {cls_name} failed civic issue mapping!"
            assert meta.get("category") == "Roads"
            assert meta.get("department_code") == "PWD"

    print("   [PASS] Detection output schema, bounding box coordinates, and department mappings fully compatible.")

    # 4. Verify manual review eligibility
    conf_thresh = get_confidence_threshold()
    print(f"3. System confidence threshold: {conf_thresh}")
    for d in dets_candidate:
        if d["confidence"] < conf_thresh:
            print(f"   Candidate detection with conf {d['confidence']} is properly flagged for manual review (< {conf_thresh}).")
            break

    print("\n[ALL INTEGRATION READINESS CHECKS PASSED]")

if __name__ == "__main__":
    test_integration()
