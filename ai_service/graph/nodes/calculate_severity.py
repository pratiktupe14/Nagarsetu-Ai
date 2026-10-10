import os
from typing import Dict, Any
from ai_service.graph.state import CivicVisionState

POTHOLE_CRITICAL_RATIO = float(os.getenv("POTHOLE_CRITICAL_RATIO", "0.20"))
POTHOLE_MEDIUM_RATIO = float(os.getenv("POTHOLE_MEDIUM_RATIO", "0.08"))


def calculate_severity_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Severity Assessment Agent:
    Evaluates physical severity using:
    - Issue type / physical class
    - Bounding-box visual impact score (bbox area relative to image area)
    - Detection count (single vs multiple defects)
    - Detection confidence
    Never claims real-world physical dimensions from 2D pixels; uses visual_impact_score.
    """
    primary = state.get("primary_detection")
    visual_impact = state.get("visual_impact_score", 0.0)
    detection_count = state.get("detection_count", 1)
    has_multiple = state.get("has_multiple_detections", False)
    warnings = list(state.get("warnings") or [])
    reasoning = list(state.get("reasoning") or [])

    if not primary:
        return {
            "severity": state.get("severity") or "Medium",
            "warnings": warnings,
            "reasoning": reasoning
        }

    raw_class = primary.get("class", "").lower()
    severity = "Medium"
    rule_note = ""

    if "pothole" in raw_class:
        if has_multiple and visual_impact >= POTHOLE_CRITICAL_RATIO:
            severity = "Critical"
            rule_note = f"Multiple potholes ({detection_count}) with high visual impact ({visual_impact:.2%})."
        elif visual_impact >= POTHOLE_CRITICAL_RATIO:
            severity = "Critical" if has_multiple else "High"
            rule_note = f"Extensive pothole area ({visual_impact:.2%})."
        elif has_multiple or visual_impact >= POTHOLE_MEDIUM_RATIO:
            severity = "High"
            rule_note = f"Multiple potholes ({detection_count}) or medium-large visual impact ({visual_impact:.2%})."
        else:
            severity = "Medium"
            rule_note = f"Single small pothole defect ({visual_impact:.2%})."

    elif "glass" in raw_class:
        if has_multiple or visual_impact >= 0.25:
            severity = "Critical"
            rule_note = f"Widespread broken glass ({detection_count} items) posing sharp hazard."
        else:
            severity = "High"
            rule_note = "Glass debris detected, inherently high public safety hazard."

    elif "metal" in raw_class:
        if has_multiple or visual_impact >= 0.15:
            severity = "High"
            rule_note = f"Heavy/scrap metal debris with visual impact {visual_impact:.2%}."
        else:
            severity = "Medium"
            rule_note = f"Small metal can/debris with visual impact {visual_impact:.2%}."

    elif any(k in raw_class for k in ("biodegradable", "plastic", "cardboard")):
        if has_multiple and visual_impact >= 0.30:
            severity = "High"
            rule_note = f"Extensive waste accumulation ({detection_count} items, {visual_impact:.2%} impact)."
        elif visual_impact >= 0.35:
            severity = "High"
            rule_note = f"Large waste volume ({visual_impact:.2%} visual impact)."
        elif visual_impact <= 0.05 and not has_multiple:
            severity = "Low"
            rule_note = f"Isolated small waste item ({visual_impact:.2%} visual impact)."
        else:
            severity = "Medium"
            rule_note = f"Moderate waste defect ({visual_impact:.2%} visual impact)."

    elif "paper" in raw_class:
        if visual_impact >= 0.30 or has_multiple:
            severity = "Medium"
            rule_note = f"Scattered paper waste ({detection_count} items)."
        else:
            severity = "Low"
            rule_note = f"Minor paper litter ({visual_impact:.2%} visual impact)."

    else:
        severity = state.get("severity") or "Medium"
        rule_note = f"Default severity mapping applied for {raw_class}."

    reasoning.append(f"Severity assessed as '{severity}': {rule_note}")

    return {
        "severity": severity,
        "reasoning": reasoning,
        "warnings": warnings
    }
