from typing import Dict, Any
from ai_service.graph.state import CivicVisionState


def build_complaint_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Complaint Generation Agent:
    Constructs the structured complaint auto-fill object with deterministic fields,
    binding verified category, title, description, severity, priority, canonical department,
    confidence score, and factual reasoning derived directly from model perception.
    """
    primary = state.get("primary_detection") or {}
    raw_class = primary.get("class", "Civic defect")
    conf = float(state.get("confidence") or 0.0)
    conf_level = state.get("confidence_level") or "MEDIUM"
    vis_impact = state.get("visual_impact_score", 0.0)
    det_count = state.get("detection_count", 1)
    has_multiple = state.get("has_multiple_detections", False)

    # Determine factual internal reason from actual perception data
    multi_text = f" ({det_count} instances detected)" if has_multiple else ""
    reason = (
        f"{raw_class} defect{multi_text} identified with {conf:.1%} confidence "
        f"({conf_level} confidence band) and {vis_impact:.1%} frame visual impact."
    )

    detected_classes = [d.get("class") for d in (state.get("detections") or []) if d.get("class")]

    complaint_data = {
        "issueType": state.get("issue_type") or "Other Civic Issue",
        "title": state.get("issue_type") or "Other Civic Issue",
        "category": state.get("category") or "Roads",
        "description": state.get("description") or "Civic issue detected visually by local AI model.",
        "severity": state.get("severity") or "Medium",
        "priority": state.get("priority") or "Medium",
        "departmentCode": state.get("department_code") or "PWD",
        "departmentRegistryId": state.get("department_id") or 1,
        "departmentId": state.get("department_id") or 1,
        "departmentName": state.get("department_name") or "Public Works Department",
        "confidenceScore": round(conf, 4),
        "reason": reason,
        "detectedObjects": detected_classes
    }

    reasoning = list(state.get("reasoning") or [])
    reasoning.append(f"Complaint auto-fill object assembled for '{complaint_data['issueType']}'.")

    return {
        "complaint": complaint_data,
        "reasoning": reasoning
    }
