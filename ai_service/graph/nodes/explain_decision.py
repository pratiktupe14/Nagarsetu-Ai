from typing import Dict, Any
from ai_service.graph.state import CivicVisionState


def explain_decision_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Explanation Agent:
    Synthesizes a transparent, factual explanation from actual computer-vision outputs
    and deterministic decision rules. No LLM or generative hallucination is used.
    """
    primary = state.get("primary_detection") or {}
    raw_class = primary.get("class", state.get("issue_type", "Defect"))
    conf = float(state.get("confidence") or 0.0)
    conf_level = state.get("confidence_level") or "MEDIUM"
    vis_impact = float(state.get("visual_impact_score", 0.0))
    severity = state.get("severity") or "Medium"
    priority = state.get("priority") or "Medium"
    det_count = state.get("detection_count", 1)
    has_multiple = state.get("has_multiple_detections", False)

    multi_suffix = f" across {det_count} visible locations" if has_multiple else ""

    if "pothole" in raw_class.lower():
        reason_str = (
            f"Road damage / pothole detected with {conf:.0%} confidence ({conf_level} confidence band){multi_suffix}. "
            f"Evaluated as {severity} severity based on {vis_impact:.1%} visual impact."
        )
    else:
        reason_str = (
            f"{raw_class.capitalize()} waste detected with {conf:.0%} confidence ({conf_level} confidence band){multi_suffix}. "
            f"Routed to Sanitation with {priority} priority."
        )

    explanation_payload = {
        "detectedIssue": raw_class,
        "confidence": round(conf, 4),
        "confidenceLevel": conf_level,
        "visualImpact": round(vis_impact, 4),
        "reason": reason_str,
        "scoringDetails": {
            "severity": severity,
            "priority": priority,
            "priorityScore": state.get("priority_score", 0),
            "detectionCount": det_count,
            "hasMultipleDetections": has_multiple
        }
    }

    reasoning = list(state.get("reasoning") or [])
    reasoning.append(f"Decision explanation generated: {reason_str}")

    return {
        "explanation": explanation_payload,
        "reasoning": reasoning
    }
