import uuid
import hashlib
from typing import Dict, Any, Optional
from ai_service.graph.workflow import run_civic_vision_pipeline


def analyze_complaint_image(
    image_bytes: bytes,
    filename: str = "",
    domain: Optional[str] = None
) -> Dict[str, Any]:
    """
    Analyzes complaint image using the compiled LangGraph YOLOv8 agent system.
    Completely removes Gemini Vision. Uses 100% local computer-vision inference.
    Returns both the standard rich LangGraph agent result and backward-compatible fields.
    """
    analysis_id = str(uuid.uuid4())
    image_hash = hashlib.sha256(image_bytes).hexdigest()

    result = run_civic_vision_pipeline(
        image_bytes=image_bytes,
        filename=filename,
        domain=domain
    )

    complaint = result.get("complaint")
    ai_status = result.get("aiStatus", "manual_review")
    has_valid_complaint = (ai_status in ("confirmed", "suggested") and complaint is not None)
    road_condition = result.get("road_condition")

    primary = result.get("primaryDetection")
    detections = result.get("detections") or []
    detected_features = [d.get("class") for d in detections if d.get("class")]
    explanation_obj = result.get("explanation") or {}
    explanation_text = (
        explanation_obj.get("reason") if isinstance(explanation_obj, dict) and explanation_obj.get("reason")
        else "Defect evaluation completed by local AI vision."
    )
    analysis = result.get("analysis") or {}

    if ai_status == "confirmed_normal" or result.get("condition") == "normal" or result.get("pipe_condition") == "normal":
        cat = None
        title = None
        desc = "The uploaded image shows a normal pipe with no visible leakage or significant damage."
        sev = "None"
        prio = "None"
        dept = None
        dept_code = None
        dept_id = None
        conf = float(result.get("confidence", 0.95))
        needs_manual = False
        detected_class = None
        ai_status = "confirmed_normal"
        has_valid_complaint = False
        explanation_text = "The uploaded image shows a normal pipe with no visible leakage or significant damage."
    elif ai_status == "confirmed_clean" or road_condition == "clean":
        cat = "Road Condition"
        title = "No Road Defect"
        desc = "The uploaded road image shows no visible pothole or significant road defect."
        sev = "None"
        prio = "None"
        dept = None
        dept_code = None
        dept_id = None
        conf = float(result.get("confidence", 0.92))
        needs_manual = False
        detected_class = None
        road_condition = "clean"
        ai_status = "confirmed_clean"
        has_valid_complaint = False
        explanation_text = "The uploaded road image shows no visible pothole or significant road defect."
    elif has_valid_complaint and complaint:
        cat = complaint.get("category", "Roads")
        title = complaint.get("issueType", "Civic Issue")
        desc = complaint.get("description", "Civic issue detected visually by local AI.")
        sev = complaint.get("severity", "High")
        prio = complaint.get("priority", "High")
        dept = complaint.get("departmentName", "Public Works Department")
        dept_code = complaint.get("departmentCode", "PWD")
        dept_id = complaint.get("departmentId", 1)
        conf = float(complaint.get("confidenceScore", result.get("confidence", 0.0)))
        needs_manual = bool(result.get("reviewRequired", ai_status != "confirmed"))
        detected_class = primary.get("class") if primary else title
        if not road_condition:
            road_condition = "defective" if (cat == "Roads" or detected_class == "Pothole") else "non_road"
    elif road_condition == "uncertain":
        cat = "Road Condition"
        title = "Uncertain Road Condition"
        desc = "Road condition could not be verified confidently. Please upload a clearer road image."
        sev = "None"
        prio = "None"
        dept = None
        dept_code = None
        dept_id = None
        conf = float(result.get("confidence", 0.0))
        needs_manual = True
        detected_class = None
        road_condition = "uncertain"
        ai_status = "manual_review"
        has_valid_complaint = False
        explanation_text = "Road condition could not be verified confidently. Please upload a clearer road image."
    elif road_condition == "non_road" or ai_status in ("no_detection", "manual_review"):
        if result.get("department_code") in ("WTR", "DRN", "SAN", "PWD") or result.get("category") in ("Water Supply", "Water", "Drainage", "Sanitation"):
            cat = result.get("category") or ("Water Supply" if result.get("department_code") == "WTR" else "Other")
            title = result.get("issue_type") or result.get("title") or "Pipe Condition Needs Review"
            desc = result.get("message") or result.get("description") or "Pipe condition could not be verified confidently. Please inspect manually."
            sev = result.get("severity") or "Medium"
            prio = result.get("priority") or "Medium"
            dept = result.get("department") or result.get("department_name") or ("Water Supply & Sewerage Board" if result.get("department_code") == "WTR" else None)
            dept_code = result.get("department_code")
            dept_id = result.get("department_id")
            conf = float(result.get("confidence", 0.0))
            needs_manual = True
            detected_class = None
            road_condition = "non_road"
            ai_status = "manual_review"
            has_valid_complaint = False
            explanation_text = desc
        else:
            cat = "Other"
            title = "Manual Review Required"
            desc = result.get("message") or "Uploaded photo does not exhibit recognizable road pavement characteristics."
            sev = "None"
            prio = "None"
            dept = None
            dept_code = None
            dept_id = None
            conf = float(result.get("confidence", 0.0))
            needs_manual = True
            detected_class = None
            road_condition = road_condition or "non_road"
            ai_status = "manual_review"
            has_valid_complaint = False
            explanation_text = "Uploaded photo does not exhibit recognizable road pavement characteristics."
    else:
        cat = "Other Civic Issue"
        title = "Manual Review Required"
        desc = result.get("message") or "Unable to confidently identify a verified civic issue. Please select details manually."
        sev = "None"
        prio = "None"
        dept = None
        dept_code = None
        dept_id = None
        conf = float(result.get("confidence", 0.0))
        needs_manual = True
        detected_class = primary.get("class") if primary else None
        road_condition = road_condition or "uncertain"
        ai_status = "manual_review"
        has_valid_complaint = False

    response = {
        # Standardized Local Civic AI Agent Schema
        "success": result.get("success", True),
        "road_condition": road_condition,
        "aiStatus": ai_status,
        "ai_status": ai_status,
        "detected": has_valid_complaint,
        "detected_class": detected_class,
        "model": result.get("model") or "civiclens-yolov8",
        "primaryDetection": primary,
        "detections": detections,
        "analysis": analysis,
        "complaint": complaint if has_valid_complaint else None,
        "explanation": explanation_text if isinstance(explanation_text, str) else explanation_obj,
        "explanation_details": explanation_obj,
        "reviewRequired": needs_manual,
        "review_required": needs_manual,
        "transparencyNotice": result.get("transparencyNotice", ""),
        "message": result.get("message", ""),
        "confidence": conf,
        "risk": result.get("risk"),

        # Canonical Response Contract fields
        "category": cat,
        "issue_type": title,
        "title": title,
        "description": desc,
        "severity": sev if sev == "None" else sev.capitalize(),
        "priority": prio if prio == "None" else prio.capitalize(),
        "department": dept,
        "department_code": dept_code,
        "departmentCode": dept_code,
        "department_id": dept_id,
        "recommended_department": dept,

        # Backward compatibility for existing NAGARSETU endpoints & services
        "analysis_id": analysis_id,
        "image_hash": image_hash,
        "is_civic_issue": has_valid_complaint,
        "detected_features": detected_features,
        "needs_manual_verification": needs_manual,
        "reasoningTrace": result.get("reasoningTrace", []),
        "road_analysis": result.get("road_analysis"),
        "warnings": result.get("warnings", []),
        "errors": result.get("errors", [])
    }

    return response
