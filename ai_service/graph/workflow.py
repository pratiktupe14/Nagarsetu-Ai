from typing import Literal, Dict, Any
from langgraph.graph import StateGraph, START, END
from ai_service.graph.state import CivicVisionState
from ai_service.graph.nodes import (
    validate_image_node,
    preprocess_image_node,
    detect_issue_node,
    road_condition_analysis_node,
    analyze_detection_node,
    validate_confidence_node,
    classify_issue_node,
    calculate_severity_node,
    calculate_priority_node,
    route_department_node,
    build_complaint_node,
    explain_decision_node,
    human_review_node,
    validate_result_node
)


# Conditional Router Functions
def route_after_validate(state: CivicVisionState) -> Literal["preprocess_image", "validate_result"]:
    if state.get("ai_status") == "invalid_image":
        return "validate_result"
    return "preprocess_image"


def route_after_preprocess(state: CivicVisionState) -> Literal["detect_issue", "validate_result"]:
    if state.get("ai_status") == "invalid_image":
        return "validate_result"
    return "detect_issue"


def route_after_road_condition(
    state: CivicVisionState
) -> Literal["analyze_detection", "validate_result", "human_review"]:
    """
    Routes from Road Condition Analysis:
    - Clean Road (confirmed_clean) -> validate_result (NO complaint, NO PWD routing)
    - Defective Road (pothole) OR Valid Waste detections -> analyze_detection
    - Uncertain / Low confidence / Non-Road / Manual Review -> human_review
    """
    road_cond = state.get("road_condition")
    ai_status = state.get("ai_status")
    cond = state.get("condition")
    pipe_cond = state.get("pipe_condition")
    drain_cond = state.get("drain_condition")

    if road_cond == "clean" or ai_status in ("confirmed_clean", "confirmed_normal") or cond == "normal" or pipe_cond == "normal" or drain_cond == "normal":
        return "validate_result"

    detections = state.get("detections") or []
    if (road_cond == "defective" or detections) and ai_status not in ("manual_review", "no_detection", "invalid_image", "error"):
        return "analyze_detection"

    return "human_review"


def route_after_analyze(state: CivicVisionState) -> Literal["validate_confidence", "human_review"]:
    if state.get("ai_status") == "no_detection":
        return "human_review"
    return "validate_confidence"


def route_after_confidence(state: CivicVisionState) -> Literal["classify_issue", "human_review"]:
    # HIGH and MEDIUM confidence proceed to classification; LOW routes to Human Review
    conf_level = state.get("confidence_level")
    ai_status = state.get("ai_status")
    if conf_level == "LOW" or ai_status in ("low_confidence", "manual_review", "no_detection"):
        return "human_review"
    return "classify_issue"


def route_after_classify(state: CivicVisionState) -> Literal["calculate_severity", "human_review"]:
    if state.get("ai_status") == "manual_review":
        return "human_review"
    return "calculate_severity"


def build_civic_vision_graph():
    """
    Constructs and compiles the modular Local Civic AI Agent System StateGraph.
    Orchestrates specialized perception, decision, explainability, and review agents.
    """
    builder = StateGraph(CivicVisionState)

    # 1. Register specialized agent nodes
    builder.add_node("validate_image", validate_image_node)
    builder.add_node("preprocess_image", preprocess_image_node)
    builder.add_node("detect_issue", detect_issue_node)
    builder.add_node("road_condition_analysis", road_condition_analysis_node)
    builder.add_node("analyze_detection", analyze_detection_node)
    builder.add_node("validate_confidence", validate_confidence_node)
    builder.add_node("classify_issue", classify_issue_node)
    builder.add_node("calculate_severity", calculate_severity_node)
    builder.add_node("calculate_priority", calculate_priority_node)
    builder.add_node("route_department", route_department_node)
    builder.add_node("build_complaint", build_complaint_node)
    builder.add_node("explain_decision", explain_decision_node)
    builder.add_node("human_review", human_review_node)
    builder.add_node("validate_result", validate_result_node)

    # 2. Add edges with conditional branches
    builder.add_edge(START, "validate_image")

    builder.add_conditional_edges(
        "validate_image",
        route_after_validate,
        {
            "preprocess_image": "preprocess_image",
            "validate_result": "validate_result"
        }
    )

    builder.add_conditional_edges(
        "preprocess_image",
        route_after_preprocess,
        {
            "detect_issue": "detect_issue",
            "validate_result": "validate_result"
        }
    )

    # Detect issue feeds directly into Road Condition Analysis
    builder.add_edge("detect_issue", "road_condition_analysis")

    builder.add_conditional_edges(
        "road_condition_analysis",
        route_after_road_condition,
        {
            "analyze_detection": "analyze_detection",
            "validate_result": "validate_result",
            "human_review": "human_review"
        }
    )


    builder.add_conditional_edges(
        "analyze_detection",
        route_after_analyze,
        {
            "validate_confidence": "validate_confidence",
            "human_review": "human_review"
        }
    )

    builder.add_conditional_edges(
        "validate_confidence",
        route_after_confidence,
        {
            "classify_issue": "classify_issue",
            "human_review": "human_review"
        }
    )

    builder.add_conditional_edges(
        "classify_issue",
        route_after_classify,
        {
            "calculate_severity": "calculate_severity",
            "human_review": "human_review"
        }
    )

    # High/Medium Confidence Decision Pipeline
    builder.add_edge("calculate_severity", "calculate_priority")
    builder.add_edge("calculate_priority", "route_department")
    builder.add_edge("route_department", "build_complaint")
    builder.add_edge("build_complaint", "explain_decision")
    builder.add_edge("explain_decision", "validate_result")

    # Human Review Branch
    builder.add_edge("human_review", "validate_result")

    # Final Validation to END
    builder.add_edge("validate_result", END)

    return builder.compile()


# Precompiled singleton graph instance
compiled_graph = build_civic_vision_graph()


def run_civic_vision_pipeline(
    image_bytes: bytes = None,
    image_path: str = None,
    filename: str = None,
    domain: str = None
) -> Dict[str, Any]:
    """
    Executes the compiled LangGraph agent workflow for an uploaded image.
    Returns the standardized rich Civic Intelligence output dictionary.
    """
    initial_state: CivicVisionState = {
        "image_bytes": image_bytes,
        "image_path": image_path,
        "filename": filename or "upload.jpg",
        "domain": domain,
        "detections": [],
        "warnings": [],
        "errors": [],
        "reasoning": [],
        "ai_status": "initialized"
    }

    final_state = compiled_graph.invoke(initial_state)
    return final_state.get("final_result") or {
        "success": False,
        "aiStatus": "error",
        "detected": False,
        "message": "Pipeline did not produce a final result."
    }
