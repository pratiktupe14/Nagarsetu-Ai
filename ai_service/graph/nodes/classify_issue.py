from typing import Dict, Any
from ai_service.graph.state import CivicVisionState
from ai_service.mappings.civic_issue_mapping import get_civic_mapping


def classify_issue_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Issue Classification Agent:
    - Maps the verified YOLO detection class to canonical NAGARSETU taxonomy:
        Pothole -> Road Damage / Pothole (Roads / PWD)
        Waste classes -> Garbage / Waste (Sanitation / SAN)
    - Sets baseline severity, priority, and department metadata.
    - If unmapped, flags for human review.
    """
    primary = state.get("primary_detection")
    errors = list(state.get("errors") or [])
    warnings = list(state.get("warnings") or [])
    reasoning = list(state.get("reasoning") or [])

    if not primary:
        reasoning.append("Classification skipped: no primary detection available.")
        return {
            "ai_status": "no_detection",
            "review_required": True,
            "errors": errors,
            "warnings": warnings,
            "reasoning": reasoning
        }

    raw_class = primary.get("class", "")
    mapping = get_civic_mapping(raw_class)

    if not mapping:
        from ai_service.mappings.civic_issue_mapping import get_future_unsupported_mapping
        unsupported = get_future_unsupported_mapping(raw_class)
        if unsupported:
            warning_msg = f"Detected class '{raw_class}' is a future category ({unsupported['category']}) with no trained weights in production."
            warnings.append(warning_msg)
            reasoning.append(warning_msg + " Routing strictly to manual review.")
            return {
                "ai_status": "manual_review",
                "review_required": True,
                "issue_type": unsupported["issue_type"],
                "category": unsupported["category"],
                "description": f"Civic defect ({raw_class}) requires manual review.",
                "department_code": None,
                "department_id": None,
                "reasoning": reasoning,
                "errors": errors,
                "warnings": warnings
            }

        warning_msg = f"Detected class '{raw_class}' does not have an authoritative NAGARSETU mapping."
        warnings.append(warning_msg)
        reasoning.append(warning_msg + " Routing to human review.")
        return {
            "ai_status": "manual_review",
            "review_required": True,
            "issue_type": f"Unmapped ({raw_class})",
            "category": "Other",
            "description": f"Visual defect ({raw_class}) detected but requires manual department triage.",
            "reasoning": reasoning,
            "errors": errors,
            "warnings": warnings
        }

    reasoning.append(
        f"Classified '{raw_class}' as '{mapping['issue_type']}' under category '{mapping['category']}'."
    )

    return {
        "issue_type": mapping["issue_type"],
        "category": mapping["category"],
        "description": mapping["description_template"],
        "severity": mapping["severity"],
        "priority": mapping["priority"],
        "department_code": mapping["department_code"],
        "department_id": mapping["department_id"],
        "department_name": mapping["department_name"],
        "risk_quadrants": mapping.get("risk_quadrants"),
        "reasoning": reasoning,
        "errors": errors,
        "warnings": warnings
    }
