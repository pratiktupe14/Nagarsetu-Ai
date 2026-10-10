from typing import TypedDict, Optional, List, Dict, Any, Literal


class CivicVisionState(TypedDict, total=False):
    # 1. Input attributes
    image_path: Optional[str]
    image_bytes: Optional[bytes]
    filename: Optional[str]
    domain: Optional[str]  # "road", "waste", or None for auto-detect

    # 2. Decoded / Preprocessed image attributes
    pil_image: Optional[Any]
    image_width: Optional[int]
    image_height: Optional[int]

    # 3. Vision perception layer & detection analysis
    detections: List[Dict[str, Any]]
    primary_detection: Optional[Dict[str, Any]]
    detection_count: int
    has_multiple_detections: bool
    confidence: float
    confidence_level: Optional[Literal["HIGH", "MEDIUM", "LOW"]]
    visual_impact_score: float
    model_used: Optional[str]

    # 4. Civic classification & decision nodes
    issue_type: Optional[str]
    category: Optional[str]
    description: Optional[str]
    severity: Optional[str]
    priority: Optional[str]
    priority_score: int
    department_code: Optional[str]
    department_id: Optional[int]
    department_name: Optional[str]
    risk_quadrants: Optional[Dict[str, int]]
    complaint: Optional[Dict[str, Any]]

    # 5. Explainability & human-in-the-loop review
    explanation: Optional[Dict[str, Any]]
    review_required: bool
    reasoning: List[str]

    # 6. Status and error tracking
    ai_status: str  # "confirmed", "suggested", "manual_review", "no_detection", "confirmed_clean", "confirmed_normal", "invalid_image", "error"
    condition: Optional[str]  # "normal", "leakage", "broken", "clean", "defective"
    pipe_condition: Optional[str]  # "normal", "leakage", "broken"
    pipe_analysis: Optional[Dict[str, Any]]
    drain_condition: Optional[str]  # "normal", "blocked", "damaged", "overflow"
    drain_analysis: Optional[Dict[str, Any]]
    road_condition: Optional[str]  # "clean", "defective", "uncertain", "non_road"
    road_analysis: Optional[Dict[str, Any]]
    warnings: List[str]
    errors: List[str]

    # 7. Final packaged result returned to API client
    final_result: Optional[Dict[str, Any]]
