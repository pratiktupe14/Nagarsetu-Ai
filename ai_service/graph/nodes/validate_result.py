from typing import Dict, Any
from ai_service.graph.state import CivicVisionState


def validate_result_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Validation Agent:
    Validates all upstream agent decisions and packages the standardized, rich
    Civic Intelligence result schema with transparency notices, explainability,
    multi-detection analysis, and department metadata.
    """
    ai_status = state.get("ai_status") or "manual_review"
    primary = state.get("primary_detection")
    detections = state.get("detections") or []
    complaint = state.get("complaint")
    explanation = state.get("explanation")
    errors = list(state.get("errors") or [])
    warnings = list(state.get("warnings") or [])
    reasoning = list(state.get("reasoning") or [])
    model_used = state.get("model_used") or "none"
    confidence = round(float(state.get("confidence") or 0.0), 4)
    confidence_level = state.get("confidence_level") or ("HIGH" if confidence >= 0.75 else ("MEDIUM" if confidence >= 0.45 else "LOW"))
    visual_impact = round(float(state.get("visual_impact_score") or 0.0), 4)
    detection_count = int(state.get("detection_count") or len(detections))
    has_multiple = bool(state.get("has_multiple_detections", detection_count > 1))
    review_required = bool(state.get("review_required", ai_status != "confirmed"))

    # Transparency Notice per confidence band
    if ai_status == "confirmed_clean" or state.get("road_condition") == "clean":
        transparency_notice = "Road condition verified: Clean — no complaint required."
    elif ai_status == "confirmed":
        transparency_notice = "AI-generated — please review before submitting."
    elif ai_status == "suggested":
        transparency_notice = "AI suggestion — please verify."
    elif ai_status in ("low_confidence", "manual_review"):
        transparency_notice = "AI could not confidently identify this issue."
    elif ai_status == "no_detection":
        transparency_notice = "AI vision models found no civic defect — manual selection enabled."
    else:
        transparency_notice = "Please fill in complaint details manually."

    analysis_payload = {
        "visualImpactScore": visual_impact,
        "detectionCount": detection_count,
        "hasMultipleDetections": has_multiple,
        "allDetections": detections
    }

    risk_quadrants = state.get("risk_quadrants") or {
        "human_safety": 1,
        "public_disruption": 1,
        "health_environment": 0,
        "physical_severity": 1
    }

    road_condition = state.get("road_condition")

    # 1. Clean Road Confirmed Branch
    if ai_status == "confirmed_clean" or road_condition == "clean":
        clean_expl = (
            explanation.get("reason") if isinstance(explanation, dict) and explanation.get("reason")
            else "The uploaded road image shows no visible pothole or significant road defect."
        )
        final_result = {
            "success": True,
            "road_condition": "clean",
            "detected": False,
            "detected_class": None,
            "confidence": confidence if confidence > 0 else 0.92,
            "aiStatus": "confirmed_clean",
            "ai_status": "confirmed_clean",
            "reviewRequired": False,
            "review_required": False,
            "category": "Road Condition",
            "issue_type": "No Road Defect",
            "title": "No Road Defect",
            "description": clean_expl,
            "severity": "None",
            "priority": "None",
            "department": None,
            "department_code": None,
            "department_id": None,
            "departmentName": None,
            "model": model_used if model_used != "none" else "road_condition_analyzer",
            "primaryDetection": None,
            "detections": [],
            "analysis": analysis_payload,
            "complaint": None,
            "explanation": {
                "detectedIssue": "Clean Road",
                "confidence": confidence if confidence > 0 else 0.92,
                "confidenceLevel": "HIGH",
                "visualImpact": 0.0,
                "reason": clean_expl
            },
            "transparencyNotice": transparency_notice,
            "message": "✓ Road appears clean. No pothole or visible road defect was detected.",
            "reasoningTrace": reasoning,
            "road_analysis": state.get("road_analysis"),
            "risk": {
                "human_safety": 0,
                "public_disruption": 0,
                "health_environment": 0,
                "physical_severity": 0,
                "risk_score": 0,
                "severity": "None"
            },
            "warnings": warnings,
            "errors": errors
        }
    # 1b. Normal Pipe Confirmed Branch (PERFECT_PIPE)
    elif ai_status == "confirmed_normal" or state.get("condition") == "normal" or state.get("pipe_condition") == "normal":
        norm_expl = (
            explanation.get("reason") if isinstance(explanation, dict) and explanation.get("reason")
            else "The uploaded image shows a normal pipe with no visible leakage or significant damage."
        )
        final_result = {
            "success": True,
            "condition": "normal",
            "pipe_condition": "normal",
            "detected": False,
            "detected_class": None,
            "confidence": confidence if confidence > 0 else 0.95,
            "aiStatus": "confirmed_normal",
            "ai_status": "confirmed_normal",
            "reviewRequired": False,
            "review_required": False,
            "category": None,
            "issue_type": None,
            "title": None,
            "description": norm_expl,
            "severity": None,
            "priority": None,
            "department": None,
            "department_code": None,
            "department_id": None,
            "departmentName": None,
            "model": "water_pipe_model.pt",
            "primaryDetection": None,
            "detections": [],
            "analysis": analysis_payload,
            "complaint": None,
            "explanation": {
                "detectedIssue": "Normal Pipe",
                "confidence": confidence if confidence > 0 else 0.95,
                "confidenceLevel": "HIGH",
                "visualImpact": 0.0,
                "reason": norm_expl
            },
            "transparencyNotice": "Pipe condition verified: Normal — no complaint required.",
            "message": "✓ PIPE CONDITION: NORMAL",
            "reasoningTrace": reasoning,
            "pipe_analysis": state.get("pipe_analysis"),
            "risk": {
                "human_safety": 0,
                "public_disruption": 0,
                "health_environment": 0,
                "physical_severity": 0,
                "risk_score": 0,
                "severity": "None"
            },
            "warnings": warnings,
            "errors": errors
        }
    elif ai_status in ("confirmed", "suggested") and complaint:
        det_class = primary.get("class") if primary else complaint.get("issueType")
        resolved_road_cond = road_condition or ("defective" if det_class == "Pothole" else "non_road")
        message = (
            f"AI detected: {complaint.get('issueType')} "
            f"({int(confidence * 100)}% - {confidence_level})"
        )
        final_result = {
            "success": True,
            "road_condition": resolved_road_cond,
            "aiStatus": ai_status,
            "ai_status": ai_status,
            "detected": True,
            "detected_class": det_class,
            "model": model_used,
            "primaryDetection": primary,
            "detections": detections,
            "analysis": analysis_payload,
            "complaint": complaint,
            "category": complaint.get("category"),
            "issue_type": complaint.get("issueType"),
            "severity": complaint.get("severity"),
            "priority": complaint.get("priority"),
            "department_code": complaint.get("departmentCode"),
            "department_id": complaint.get("departmentId"),
            "department": complaint.get("departmentName"),
            "confidence": confidence,
            "explanation": explanation or {
                "detectedIssue": det_class,
                "confidence": confidence,
                "confidenceLevel": confidence_level,
                "visualImpact": visual_impact,
                "reason": complaint.get("reason", "Defect identified with valid confidence.")
            },
            "reviewRequired": review_required,
            "review_required": review_required,
            "transparencyNotice": transparency_notice,
            "risk": {
                **risk_quadrants,
                "risk_score": sum(risk_quadrants.values()),
                "severity": complaint.get("severity", "Medium")
            },
            "reasoningTrace": reasoning,
            "road_analysis": state.get("road_analysis"),
            "message": message,
            "warnings": warnings,
            "errors": errors
        }
    elif road_condition == "uncertain":
        unc_expl = (
            explanation.get("reason") if isinstance(explanation, dict) and explanation.get("reason")
            else "Road condition could not be verified confidently. Please upload a clearer road image."
        )
        final_result = {
            "success": True,
            "road_condition": "uncertain",
            "detected": False,
            "detected_class": None,
            "confidence": 0.0,
            "aiStatus": "manual_review",
            "ai_status": "manual_review",
            "reviewRequired": True,
            "review_required": True,
            "category": "Road Condition",
            "issue_type": "Uncertain Road Condition",
            "title": "Uncertain Road Condition",
            "description": unc_expl,
            "severity": "None",
            "priority": "None",
            "department": None,
            "department_code": None,
            "department_id": None,
            "departmentName": None,
            "model": model_used,
            "primaryDetection": primary,
            "detections": detections,
            "analysis": analysis_payload,
            "complaint": None,
            "explanation": {
                "detectedIssue": "Uncertain Road",
                "confidence": 0.0,
                "confidenceLevel": "LOW",
                "visualImpact": visual_impact,
                "reason": unc_expl
            },
            "transparencyNotice": "⚠ Road condition could not be verified confidently.",
            "message": "⚠ Road condition could not be verified confidently. Please upload a clearer road image.",
            "reasoningTrace": reasoning,
            "road_analysis": state.get("road_analysis"),
            "risk": {
                "human_safety": 0,
                "public_disruption": 0,
                "health_environment": 0,
                "physical_severity": 0,
                "risk_score": 0,
                "severity": "None"
            },
            "warnings": warnings,
            "errors": errors
        }
    elif ai_status == "no_detection":
        final_result = {
            "success": True,
            "road_condition": road_condition or "uncertain",
            "detected": False,
            "detected_class": None,
            "aiStatus": "no_detection",
            "ai_status": "no_detection",
            "model": model_used,
            "primaryDetection": None,
            "detections": [],
            "analysis": {
                "visualImpactScore": 0.0,
                "detectionCount": 0,
                "hasMultipleDetections": False,
                "allDetections": []
            },
            "complaint": None,
            "category": "Other Civic Issue",
            "issue_type": "Manual Review Required",
            "severity": "Low",
            "priority": "Medium",
            "department_code": None,
            "department_id": None,
            "department": None,
            "explanation": explanation or {
                "detectedIssue": "None",
                "confidence": 0.0,
                "confidenceLevel": "LOW",
                "visualImpact": 0.0,
                "reason": "AI vision models detected no verified civic defects in the image."
            },
            "reviewRequired": True,
            "review_required": True,
            "transparencyNotice": transparency_notice,
            "reasoningTrace": reasoning,
            "road_analysis": state.get("road_analysis"),
            "message": "Unable to identify a verified civic issue in the uploaded photo. Please fill details manually.",
            "warnings": warnings,
            "errors": errors
        }
    elif ai_status in ("manual_review", "low_confidence"):
        final_result = {
            "success": True,
            "road_condition": road_condition or "uncertain",
            "detected": False,
            "detected_class": primary.get("class") if primary else None,
            "aiStatus": "manual_review",
            "ai_status": "manual_review",
            "model": model_used,
            "primaryDetection": primary,
            "detections": detections,
            "analysis": analysis_payload,
            "complaint": None,
            "category": state.get("category") or "Other",
            "issue_type": state.get("issue_type") or "Manual Review Required",
            "severity": state.get("severity") or "Low",
            "priority": state.get("priority") or "Medium",
            "department_code": state.get("department_code"),
            "department_id": state.get("department_id"),
            "department": state.get("department_name"),
            "explanation": explanation or {
                "detectedIssue": primary.get("class") if primary else "Uncertain",
                "confidence": confidence,
                "confidenceLevel": confidence_level,
                "visualImpact": visual_impact,
                "reason": "Detection confidence is below threshold. Routed for manual citizen review."
            },
            "reviewRequired": True,
            "review_required": True,
            "transparencyNotice": transparency_notice,
            "reasoningTrace": reasoning,
            "road_analysis": state.get("road_analysis"),
            "message": "Detection confidence is below threshold. Please enter complaint details manually.",
            "warnings": warnings,
            "errors": errors
        }
    elif ai_status == "invalid_image":
        final_result = {
            "success": False,
            "aiStatus": "invalid_image",
            "detected": False,
            "model": None,
            "primaryDetection": None,
            "detections": [],
            "analysis": analysis_payload,
            "complaint": None,
            "explanation": {
                "detectedIssue": "None",
                "confidence": 0.0,
                "confidenceLevel": "LOW",
                "visualImpact": 0.0,
                "reason": errors[0] if errors else "Invalid or unreadable image file."
            },
            "reviewRequired": True,
            "transparencyNotice": transparency_notice,
            "reasoningTrace": reasoning,
            "message": errors[0] if errors else "Invalid or unreadable image file.",
            "warnings": warnings,
            "errors": errors
        }
    else:
        final_result = {
            "success": False,
            "aiStatus": ai_status,
            "detected": False,
            "model": model_used,
            "primaryDetection": primary,
            "detections": detections,
            "analysis": analysis_payload,
            "complaint": None,
            "explanation": {
                "detectedIssue": "Error",
                "confidence": 0.0,
                "confidenceLevel": "LOW",
                "visualImpact": 0.0,
                "reason": "AI processing error occurred. Routed for manual citizen review."
            },
            "reviewRequired": True,
            "transparencyNotice": transparency_notice,
            "reasoningTrace": reasoning,
            "message": "AI analysis unavailable. Please enter complaint details manually.",
            "warnings": warnings,
            "errors": errors
        }

    return {
        "final_result": final_result
    }
