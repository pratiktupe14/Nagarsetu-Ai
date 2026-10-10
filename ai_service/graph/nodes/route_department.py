from typing import Dict, Any
from ai_service.graph.state import CivicVisionState

# Canonical registry of NAGARSETU municipal departments
# Authoritative for ID and code mapping across all decision nodes.
CANONICAL_DEPARTMENTS: Dict[str, Dict[str, Any]] = {
    "PWD": {"id": 1, "name": "Public Works Department", "code": "PWD"},
    "SAN": {"id": 2, "name": "Sanitation & Waste Management", "code": "SAN"},
    "WTR": {"id": 3, "name": "Water Supply & Pipelines", "code": "WTR"},
    "ELE": {"id": 4, "name": "Electricity & Street Lighting", "code": "ELE"},
    "TRF": {"id": 5, "name": "Traffic & Transport Management", "code": "TRF"},
    "MNT": {"id": 6, "name": "Parks & Public Maintenance", "code": "MNT"},
    "DRN": {"id": 7, "name": "Stormwater & Drainage", "code": "DRN"},
}


def route_department_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Department Routing Agent:
    Binds the authoritative canonical department code and ID to the complaint.
    Designed modularly to support future models (WTR, ELE, TRF, DRN) seamlessly.
    """
    dept_code = (state.get("department_code") or "PWD").upper()
    reasoning = list(state.get("reasoning") or [])

    dept_info = CANONICAL_DEPARTMENTS.get(dept_code)
    if not dept_info:
        dept_info = CANONICAL_DEPARTMENTS["PWD"]

    dept_id = dept_info["id"]
    dept_name = dept_info["name"]

    reasoning.append(
        f"Department routed authoritatively to {dept_name} (Code: {dept_code}, ID: {dept_id})."
    )

    return {
        "department_code": dept_code,
        "department_id": dept_id,
        "department_name": dept_name,
        "reasoning": reasoning
    }
