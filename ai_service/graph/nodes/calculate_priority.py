from typing import Dict, Any
from ai_service.graph.state import CivicVisionState


def calculate_priority_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Priority Assessment Agent:
    Transparent, explainable multi-factor scoring:
      priority_score = severity_score + visual_impact_score + confidence_score + multiple_detection_bonus
    Maps total score into:
      >= 6 -> Critical
      4 - 5 -> High
      2 - 3 -> Medium
      <= 1 -> Low
    """
    severity = (state.get("severity") or "Medium").capitalize()
    visual_impact = state.get("visual_impact_score", 0.0)
    conf_level = state.get("confidence_level") or "MEDIUM"
    has_multiple = state.get("has_multiple_detections", False)
    reasoning = list(state.get("reasoning") or [])

    # 1. Severity Score (1 - 4)
    sev_weights = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}
    sev_score = sev_weights.get(severity, 2)

    # 2. Visual Impact Score (0 - 2)
    if visual_impact >= 0.25:
        vis_score = 2
    elif visual_impact >= 0.10:
        vis_score = 1
    else:
        vis_score = 0

    # 3. Confidence Score (0 - 1)
    conf_score = 1 if conf_level == "HIGH" else 0

    # 4. Multiple Detection Bonus (0 - 1)
    multi_score = 1 if has_multiple else 0

    total_score = sev_score + vis_score + conf_score + multi_score

    # Map to priority label
    if total_score >= 6:
        priority = "Critical"
    elif total_score >= 4:
        priority = "High"
    elif total_score >= 2:
        priority = "Medium"
    else:
        priority = "Low"

    explanation_breakdown = (
        f"Priority assessed as '{priority}' (Score: {total_score} = "
        f"Severity[{sev_score}] + VisualImpact[{vis_score}] + "
        f"Confidence[{conf_score}] + MultiDetection[{multi_score}])."
    )
    reasoning.append(explanation_breakdown)

    return {
        "priority": priority,
        "priority_score": total_score,
        "reasoning": reasoning
    }
