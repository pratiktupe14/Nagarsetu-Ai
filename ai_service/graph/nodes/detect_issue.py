import os
from typing import Dict, Any, List
from ai_service.graph.state import CivicVisionState
from ai_service.model_manager import (
    get_pothole_model,
    get_waste_model,
    run_yolo_detection,
    get_confidence_threshold
)


def detect_issue_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Executes real Ultralytics YOLOv8 inference using CivicLens model weights.
    Supports selective execution if 'domain' is provided ('road' or 'waste').
    Otherwise runs both models safely and collects detections.
    """
    pil_image = state.get("pil_image")
    domain = (state.get("domain") or "").strip().lower()
    errors = list(state.get("errors") or [])
    warnings = list(state.get("warnings") or [])

    if pil_image is None:
        errors.append("Preprocessed PIL image missing for detection node.")
        return {
            "detections": [],
            "ai_status": "error",
            "errors": errors,
            "warnings": warnings
        }

    threshold = float(os.getenv("AI_MIN_DETECTION_CONFIDENCE", "0.25"))
    all_detections: List[Dict[str, Any]] = []

    pothole_model = get_pothole_model()
    waste_model = get_waste_model()

    run_road = domain in ("road", "pothole", "")
    run_waste = domain in ("waste", "garbage", "sanitation", "")
    run_pipe = domain in ("pipe", "water", "leak", "leakage", "")
    run_drainage = domain in ("drain", "drainage", "sewage", "gutter", "culvert", "")

    # 1. Pothole Model Inference
    if run_road and pothole_model is not None:
        try:
            pothole_dets = run_yolo_detection(
                pothole_model, pil_image, model_name="civicmodel.pt", threshold=threshold
            )
            all_detections.extend(pothole_dets)
        except Exception as e:
            warnings.append(f"civicmodel.pt execution warning: {e}")

    # 2. Waste Model Inference
    if run_waste and waste_model is not None:
        try:
            waste_dets = run_yolo_detection(
                waste_model, pil_image, model_name="best.pt", threshold=threshold
            )
            all_detections.extend(waste_dets)
        except Exception as e:
            warnings.append(f"best.pt execution warning: {e}")

    # 3. Water Pipe Model Inference (water_pipe_model.pt)
    filename_lower = (state.get("filename") or "").lower()
    is_pipe_target = (
        domain in ("pipe", "water", "leak", "leakage") or
        any(k in filename_lower for k in ["pipe", "leak", "burst", "pipeline", "water"])
    )
    if is_pipe_target and run_pipe:
        from ai_service.model_manager import run_pipe_classification
        try:
            pipe_res = run_pipe_classification(pil_image, threshold=threshold)
            if pipe_res is not None:
                p_conf = pipe_res.get("confidence", 0.0)
                p_cls = pipe_res.get("class")
                if p_cls == "perfect_pipe" and p_conf >= 0.50:
                    norm_desc = "The uploaded image shows a normal pipe with no visible leakage or significant damage."
                    return {
                        "condition": "normal",
                        "pipe_condition": "normal",
                        "road_condition": "non_road",
                        "detected": False,
                        "ai_status": "confirmed_normal",
                        "confidence": p_conf,
                        "confidence_level": "HIGH",
                        "issue_type": None,
                        "category": None,
                        "department_code": None,
                        "department_id": None,
                        "severity": None,
                        "priority": None,
                        "review_required": False,
                        "detections": [],
                        "explanation": {
                            "detectedIssue": "Normal Pipe",
                            "confidence": p_conf,
                            "confidenceLevel": "HIGH",
                            "reason": norm_desc
                        },
                        "errors": errors,
                        "warnings": warnings
                    }
                elif p_cls in ("water_leakage", "broken_pipe") and p_conf >= 0.45:
                    w, h = pil_image.size
                    all_detections.append({
                        "class": p_cls,
                        "confidence": p_conf,
                        "bbox": [0, 0, w, h],
                        "model": "water_pipe_model.pt",
                        "review_required": pipe_res.get("review_required", False),
                        "structural_rupture_evidence": pipe_res.get("structural_rupture_evidence", False),
                        "decision_case": pipe_res.get("decision_case", "")
                    })
                elif is_pipe_target:
                    # Ambiguous / uncertain pipe image -> Pipe-specific manual review
                    unc_desc = "Pipe condition could not be verified confidently. Please inspect manually or upload a clearer pipe image."
                    return {
                        "condition": "uncertain",
                        "pipe_condition": "uncertain",
                        "road_condition": "non_road",
                        "detected": False,
                        "ai_status": "manual_review",
                        "confidence": p_conf,
                        "confidence_level": "LOW",
                        "issue_type": "Pipe Condition Needs Review",
                        "category": "Water Supply",
                        "department_code": "WTR",
                        "department_id": 3,
                        "department_name": "Water Supply & Sewerage Board",
                        "severity": "Medium",
                        "priority": "Medium",
                        "review_required": True,
                        "detections": [],
                        "explanation": {
                            "detectedIssue": "Pipe Condition Needs Review",
                            "confidence": p_conf,
                            "confidenceLevel": "LOW",
                            "reason": unc_desc
                        },
                        "errors": errors,
                        "warnings": warnings
                    }
        except Exception as e:
            warnings.append(f"water_pipe_model.pt execution warning: {e}")
            if is_pipe_target:
                unc_desc = "Pipe inspection service encountered a temporary issue. Please inspect manually."
                return {
                    "condition": "uncertain",
                    "pipe_condition": "uncertain",
                    "road_condition": "non_road",
                    "detected": False,
                    "ai_status": "manual_review",
                    "confidence": 0.0,
                    "confidence_level": "LOW",
                    "issue_type": "Pipe Condition Needs Review",
                    "category": "Water Supply",
                    "department_code": "WTR",
                    "department_id": 3,
                    "department_name": "Water Supply & Sewerage Board",
                    "severity": "Medium",
                    "priority": "Medium",
                    "review_required": True,
                    "detections": [],
                    "explanation": {
                        "detectedIssue": "Pipe Condition Needs Review",
                        "confidence": 0.0,
                        "confidenceLevel": "LOW",
                        "reason": unc_desc
                    },
                    "errors": errors,
                    "warnings": warnings
                }

    if is_pipe_target and domain in ("pipe", "water", "leak", "leakage") and not all_detections:
        unc_desc = "Pipe condition could not be verified confidently. Please inspect manually or upload a clearer pipe image."
        return {
            "condition": "uncertain",
            "pipe_condition": "uncertain",
            "road_condition": "non_road",
            "detected": False,
            "ai_status": "manual_review",
            "confidence": 0.0,
            "confidence_level": "LOW",
            "issue_type": "Pipe Condition Needs Review",
            "category": "Water Supply",
            "department_code": "WTR",
            "department_id": 3,
            "department_name": "Water Supply & Sewerage Board",
            "severity": "Medium",
            "priority": "Medium",
            "review_required": True,
            "detections": [],
            "explanation": {
                "detectedIssue": "Pipe Condition Needs Review",
                "confidence": 0.0,
                "confidenceLevel": "LOW",
                "reason": unc_desc
            },
            "errors": errors,
            "warnings": warnings
        }

    # 4. Drainage Model Inference (drainage_model.pt)
    is_drainage_target = (
        domain in ("drain", "drainage", "sewage", "gutter", "culvert") or
        any(k in filename_lower for k in ["drain", "sewage", "gutter", "culvert", "grate", "manhole", "slab", "overflow"])
    )
    if is_drainage_target and run_drainage:
        from ai_service.model_manager import run_drainage_classification
        try:
            drain_res = run_drainage_classification(pil_image, threshold=threshold)
            if drain_res is not None and drain_res.get("confidence", 0) >= 0.45:
                if drain_res.get("class") == "normal_drain":
                    norm_desc = "The uploaded image shows normal, functional drainage with no visible blockage, damage, or overflow."
                    return {
                        "condition": "normal",
                        "drain_condition": "normal",
                        "road_condition": "non_road",
                        "detected": False,
                        "ai_status": "confirmed_normal",
                        "confidence": drain_res["confidence"],
                        "confidence_level": "HIGH",
                        "issue_type": None,
                        "category": None,
                        "department_code": None,
                        "department_id": None,
                        "severity": None,
                        "priority": None,
                        "review_required": False,
                        "detections": [],
                        "explanation": {
                            "detectedIssue": "Normal Drainage",
                            "confidence": drain_res["confidence"],
                            "confidenceLevel": "HIGH",
                            "reason": norm_desc
                        },
                        "errors": errors,
                        "warnings": warnings
                    }
                elif drain_res.get("detected", False):
                    w, h = pil_image.size
                    all_detections.append({
                        "class": drain_res["class"],
                        "confidence": drain_res["confidence"],
                        "bbox": [0, 0, w, h],
                        "model": "drainage_model.pt",
                        "review_required": drain_res.get("review_required", False),
                        "decision_case": drain_res.get("decision_case", "")
                    })
        except Exception as e:
            warnings.append(f"drainage_model.pt execution warning: {e}")
            if is_drainage_target:
                unc_desc = "Drainage inspection service encountered a temporary error. Please inspect manually."
                return {
                    "condition": "uncertain",
                    "drain_condition": "uncertain",
                    "road_condition": "non_road",
                    "detected": False,
                    "ai_status": "manual_review",
                    "confidence": 0.0,
                    "confidence_level": "LOW",
                    "issue_type": "Drainage Condition Needs Review",
                    "category": "Drainage",
                    "department_code": "DRN",
                    "department_id": 7,
                    "department_name": "Drainage & Sewage Department",
                    "severity": "Medium",
                    "priority": "Medium",
                    "review_required": True,
                    "detections": [],
                    "explanation": {
                        "detectedIssue": "Drainage Condition Needs Review",
                        "confidence": 0.0,
                        "confidenceLevel": "LOW",
                        "reason": unc_desc
                    },
                    "errors": errors,
                    "warnings": warnings
                }

    if is_drainage_target and domain in ("drain", "drainage", "sewage", "gutter", "culvert") and not all_detections:
        unc_desc = "Drainage condition could not be verified confidently. Please inspect manually."
        return {
            "condition": "uncertain",
            "drain_condition": "uncertain",
            "road_condition": "non_road",
            "detected": False,
            "ai_status": "manual_review",
            "confidence": 0.0,
            "confidence_level": "LOW",
            "issue_type": "Drainage Condition Needs Review",
            "category": "Drainage",
            "department_code": "DRN",
            "department_id": 7,
            "department_name": "Drainage & Sewage Department",
            "severity": "Medium",
            "priority": "Medium",
            "review_required": True,
            "detections": [],
            "explanation": {
                "detectedIssue": "Drainage Condition Needs Review",
                "confidence": 0.0,
                "confidenceLevel": "LOW",
                "reason": unc_desc
            },
            "errors": errors,
            "warnings": warnings
        }

    if domain in ("waste", "garbage", "sanitation") and not all_detections:
        unc_desc = "Sanitation condition could not be verified confidently. Please inspect manually."
        return {
            "condition": "uncertain",
            "road_condition": "non_road",
            "detected": False,
            "ai_status": "manual_review",
            "confidence": 0.0,
            "confidence_level": "LOW",
            "issue_type": "Sanitation Condition Needs Review",
            "category": "Sanitation",
            "department_code": "SAN",
            "department_id": 2,
            "department_name": "Sanitation & Waste Management",
            "severity": "Medium",
            "priority": "Medium",
            "review_required": True,
            "detections": [],
            "explanation": {
                "detectedIssue": "Sanitation Condition Needs Review",
                "confidence": 0.0,
                "confidenceLevel": "LOW",
                "reason": unc_desc
            },
            "errors": errors,
            "warnings": warnings
        }

    if not all_detections:
        return {
            "detections": [],
            "ai_status": "no_detection",
            "errors": errors,
            "warnings": warnings
        }

    return {
        "detections": all_detections,
        "errors": errors,
        "warnings": warnings
    }
