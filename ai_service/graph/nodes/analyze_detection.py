from typing import Dict, Any, List
from ai_service.graph.state import CivicVisionState


def analyze_detection_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Detection Analysis Agent:
    - Filters full-frame false-positives (>95% frame coverage with confidence < 0.70)
    - Preserves all valid detections with their normalized bounding-box area ratios
    - Sorts and ranks detections by confidence descending
    - Identifies primary detection
    - Calculates detection count and multi-detection indicator
    - Computes visual_impact_score (primary bbox area relative to image area)
    """
    raw_detections = state.get("detections") or []
    width = state.get("image_width") or 0
    height = state.get("image_height") or 0
    errors = list(state.get("errors") or [])
    warnings = list(state.get("warnings") or [])
    reasoning = list(state.get("reasoning") or [])

    img_area = float(width * height) if (width > 0 and height > 0) else 1.0
    valid_detections: List[Dict[str, Any]] = []

    for det in raw_detections:
        bbox = det.get("bbox") or []
        conf = float(det.get("confidence", 0.0))

        # Compute detection bbox area
        box_area = 0.0
        box_area_ratio = 0.0
        if len(bbox) == 4 and width > 0 and height > 0:
            box_w = max(0.0, float(bbox[2] - bbox[0]))
            box_h = max(0.0, float(bbox[3] - bbox[1]))
            box_area = box_w * box_h
            box_area_ratio = round(min(1.0, box_area / img_area), 4)

            # Full-frame false positive filtering from CivicLens (object detection models only)
            model_name = det.get("model", "")
            is_classifier = "water_pipe" in model_name or det.get("is_classification", False)
            is_full_frame = (box_w >= 0.95 * width) and (box_h >= 0.95 * height)
            if not is_classifier and is_full_frame and conf < 0.70:
                warnings.append(
                    f"Filtered full-frame false-positive detection '{det.get('class')}' with conf {conf}"
                )
                continue

        det_with_metrics = {
            **det,
            "bbox_area_ratio": box_area_ratio,
        }
        valid_detections.append(det_with_metrics)

    if not valid_detections:
        reasoning.append("No valid civic detections remained after false-positive filtering.")
        return {
            "detections": [],
            "primary_detection": None,
            "detection_count": 0,
            "has_multiple_detections": False,
            "confidence": 0.0,
            "visual_impact_score": 0.0,
            "model_used": None,
            "ai_status": "no_detection",
            "reasoning": reasoning,
            "errors": errors,
            "warnings": warnings
        }

    # Sort descending by confidence
    valid_detections.sort(key=lambda d: d.get("confidence", 0.0), reverse=True)
    primary = valid_detections[0]
    detection_count = len(valid_detections)
    has_multiple = detection_count > 1
    visual_impact = primary.get("bbox_area_ratio", 0.0)

    reasoning.append(
        f"Analyzed {detection_count} detection(s). Primary: '{primary.get('class')}' "
        f"with confidence {primary.get('confidence')} and visual impact score {visual_impact}."
    )

    return {
        "detections": valid_detections,
        "primary_detection": primary,
        "detection_count": detection_count,
        "has_multiple_detections": has_multiple,
        "confidence": primary.get("confidence", 0.0),
        "visual_impact_score": visual_impact,
        "model_used": primary.get("model"),
        "reasoning": reasoning,
        "errors": errors,
        "warnings": warnings
    }
