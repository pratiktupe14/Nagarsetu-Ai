from typing import Dict, Any
from ai_service.graph.state import CivicVisionState


def human_review_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Human Review Agent:
    Handles non-detections, low-confidence predictions, and unmapped classes.
    Ensures AI never blocks complaint submission; cleanly prepares state for
    manual citizen form entry.
    """
    primary = state.get("primary_detection")
    conf = float(state.get("confidence") or 0.0)
    conf_level = state.get("confidence_level") or "LOW"
    ai_status = state.get("ai_status") or "manual_review"
    reasoning = list(state.get("reasoning") or [])
    warnings = list(state.get("warnings") or [])

    if ai_status not in ("no_detection", "invalid_image", "error"):
        ai_status = "manual_review"

    if primary:
        detected_issue = primary.get("class", "Uncertain")
        reason_text = (
            f"Detection '{detected_issue}' had confidence {conf:.1%} ({conf_level} band), "
            f"which requires human verification before filing."
        )
    elif ai_status == "no_detection":
        detected_issue = "None"
        reason_text = "AI vision models detected no verified civic defects in the image."
    else:
        detected_issue = "None"
        reason_text = "Image quality or processing constraints require manual citizen issue reporting."

    explanation = {
        "detectedIssue": detected_issue,
        "confidence": round(conf, 4),
        "confidenceLevel": conf_level,
        "visualImpact": 0.0,
        "reason": reason_text,
        "manualReviewReason": reason_text
    }

    reasoning.append(f"Human review activated: {reason_text}")

    return {
        "ai_status": ai_status,
        "review_required": True,
        "complaint": None,
        "explanation": explanation,
        "reasoning": reasoning,
        "warnings": warnings
    }
