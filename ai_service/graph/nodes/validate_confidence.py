from typing import Dict, Any
from ai_service.graph.state import CivicVisionState
from ai_service.model_manager import get_confidence_threshold, get_high_confidence_threshold


def validate_confidence_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Confidence Agent:
    - Evaluates detection confidence against configurable thresholds:
        HIGH_CONFIDENCE >= 0.75
        MEDIUM_CONFIDENCE = 0.45 - 0.74
        LOW_CONFIDENCE < 0.45
    - Determines confidence level (HIGH, MEDIUM, LOW)
    - High confidence -> confirmed auto-fill
    - Medium confidence -> allowed as reviewable AI suggestion
    - Low confidence -> routed to manual human review
    """
    primary = state.get("primary_detection")
    high_threshold = get_high_confidence_threshold()
    med_threshold = get_confidence_threshold()

    errors = list(state.get("errors") or [])
    warnings = list(state.get("warnings") or [])
    reasoning = list(state.get("reasoning") or [])

    if not primary:
        reasoning.append("No primary detection found. Setting confidence level to LOW.")
        return {
            "confidence_level": "LOW",
            "ai_status": "no_detection",
            "review_required": True,
            "reasoning": reasoning,
            "errors": errors,
            "warnings": warnings
        }

    conf = float(primary.get("confidence", 0.0))

    if conf >= high_threshold:
        level = "HIGH"
        status = "confirmed"
        review_required = False
        reasoning.append(
            f"Confidence {conf:.2%} is HIGH (>= {high_threshold:.2%}). Auto-fill enabled with standard review."
        )
    elif conf >= med_threshold:
        level = "MEDIUM"
        status = "suggested"
        review_required = True
        reasoning.append(
            f"Confidence {conf:.2%} is MEDIUM ({med_threshold:.2%} - {high_threshold:.2%}). "
            f"Allowed as AI suggestion with manual verification flag."
        )
    else:
        level = "LOW"
        status = "manual_review"
        review_required = True
        warnings.append(
            f"Detection confidence ({conf:.2%}) is below threshold ({med_threshold:.2%}). Routed to manual review."
        )
        reasoning.append(
            f"Confidence {conf:.2%} is LOW (< {med_threshold:.2%}). Bypassing auto-fill for human review."
        )

    # Attach confidence_level to primary_detection dictionary as well for client convenience
    updated_primary = {**primary, "confidenceLevel": level}

    return {
        "primary_detection": updated_primary,
        "confidence_level": level,
        "ai_status": status,
        "review_required": review_required,
        "reasoning": reasoning,
        "errors": errors,
        "warnings": warnings
    }
