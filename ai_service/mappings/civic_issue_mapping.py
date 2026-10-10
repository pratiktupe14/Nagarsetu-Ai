from typing import Optional, Dict, Any

# Centralized canonical mapping for CivicLens YOLO-detected classes to NAGARSETU complaints.
# Based strictly on verified classes in best.pt and civicmodel.pt.

CIVIC_ISSUE_MAPPING: Dict[str, Dict[str, Any]] = {
    # Road damage from civicmodel.pt
    "pothole": {
        "issue_type": "Road Damage / Pothole",
        "category": "Roads",
        "description_template": "Road damage / pothole detected from the uploaded image.",
        "severity": "High",
        "priority": "High",
        "department_code": "PWD",
        "department_id": 1,
        "department_name": "Public Works Department",
        "risk_quadrants": {
            "human_safety": 2,
            "public_disruption": 2,
            "health_environment": 0,
            "physical_severity": 2
        }
    },

    # Pipe defect classes from water_pipe_model.pt
    "water leakage": {
        "issue_type": "Water Leakage",
        "category": "Water Supply",
        "description_template": "Water leakage detected from piping infrastructure requiring prompt utility repair.",
        "severity": "High",
        "priority": "High",
        "department_code": "WTR",
        "department_id": 3,
        "department_name": "Water Supply & Sewerage Board",
        "risk_quadrants": {
            "human_safety": 1,
            "public_disruption": 2,
            "health_environment": 1,
            "physical_severity": 2
        }
    },
    "water_leakage": {
        "issue_type": "Water Leakage",
        "category": "Water Supply",
        "description_template": "Water leakage detected from piping infrastructure requiring prompt utility repair.",
        "severity": "High",
        "priority": "High",
        "department_code": "WTR",
        "department_id": 3,
        "department_name": "Water Supply & Sewerage Board",
        "risk_quadrants": {
            "human_safety": 1,
            "public_disruption": 2,
            "health_environment": 1,
            "physical_severity": 2
        }
    },
    "broken pipe": {
        "issue_type": "Broken Water Pipe",
        "category": "Water Supply",
        "description_template": "Broken water pipe detected posing risk of water loss and structural damage.",
        "severity": "High",
        "priority": "High",
        "department_code": "WTR",
        "department_id": 3,
        "department_name": "Water Supply & Sewerage Board",
        "risk_quadrants": {
            "human_safety": 2,
            "public_disruption": 2,
            "health_environment": 1,
            "physical_severity": 3
        }
    },
    "broken_pipe": {
        "issue_type": "Broken Water Pipe",
        "category": "Water Supply",
        "description_template": "Broken water pipe detected posing risk of water loss and structural damage.",
        "severity": "High",
        "priority": "High",
        "department_code": "WTR",
        "department_id": 3,
        "department_name": "Water Supply & Sewerage Board",
        "risk_quadrants": {
            "human_safety": 2,
            "public_disruption": 2,
            "health_environment": 1,
            "physical_severity": 3
        }
    },

    # Drainage defect classes from drainage_model.pt
    "blocked drain": {
        "issue_type": "Blocked Drain / Gutter",
        "category": "Drainage",
        "description_template": "Blocked drain detected with accumulated waste or debris obstructing water flow.",
        "severity": "High",
        "priority": "High",
        "department_code": "DRN",
        "department_id": 4,
        "department_name": "Drainage & Sewage Department",
        "risk_quadrants": {
            "human_safety": 1,
            "public_disruption": 2,
            "health_environment": 3,
            "physical_severity": 2
        }
    },
    "blocked_drain": {
        "issue_type": "Blocked Drain / Gutter",
        "category": "Drainage",
        "description_template": "Blocked drain detected with accumulated waste or debris obstructing water flow.",
        "severity": "High",
        "priority": "High",
        "department_code": "DRN",
        "department_id": 4,
        "department_name": "Drainage & Sewage Department",
        "risk_quadrants": {
            "human_safety": 1,
            "public_disruption": 2,
            "health_environment": 3,
            "physical_severity": 2
        }
    },
    "damaged drain": {
        "issue_type": "Damaged Drain / Broken Slab",
        "category": "Drainage",
        "description_template": "Damaged drainage structure detected with broken slab or collapsed cover posing safety hazards.",
        "severity": "High",
        "priority": "High",
        "department_code": "DRN",
        "department_id": 4,
        "department_name": "Drainage & Sewage Department",
        "risk_quadrants": {
            "human_safety": 3,
            "public_disruption": 2,
            "health_environment": 1,
            "physical_severity": 3
        }
    },
    "damaged_drain": {
        "issue_type": "Damaged Drain / Broken Slab",
        "category": "Drainage",
        "description_template": "Damaged drainage structure detected with broken slab or collapsed cover posing safety hazards.",
        "severity": "High",
        "priority": "High",
        "department_code": "DRN",
        "department_id": 4,
        "department_name": "Drainage & Sewage Department",
        "risk_quadrants": {
            "human_safety": 3,
            "public_disruption": 2,
            "health_environment": 1,
            "physical_severity": 3
        }
    },
    "drain overflow": {
        "issue_type": "Drain Overflow",
        "category": "Drainage",
        "description_template": "Drain overflow detected with sewage or wastewater spilling onto public roads.",
        "severity": "High",
        "priority": "High",
        "department_code": "DRN",
        "department_id": 4,
        "department_name": "Drainage & Sewage Department",
        "risk_quadrants": {
            "human_safety": 2,
            "public_disruption": 2,
            "health_environment": 3,
            "physical_severity": 2
        }
    },
    "drain_overflow": {
        "issue_type": "Drain Overflow",
        "category": "Drainage",
        "description_template": "Drain overflow detected with sewage or wastewater spilling onto public roads.",
        "severity": "High",
        "priority": "High",
        "department_code": "DRN",
        "department_id": 4,
        "department_name": "Drainage & Sewage Department",
        "risk_quadrants": {
            "human_safety": 2,
            "public_disruption": 2,
            "health_environment": 3,
            "physical_severity": 2
        }
    },

    # Waste classes from best.pt
    "plastic": {
        "issue_type": "Garbage / Waste",
        "category": "Sanitation",
        "description_template": "Plastic waste detected from the uploaded image requiring recyclable waste collection.",
        "severity": "Medium",
        "priority": "High",
        "department_code": "SAN",
        "department_id": 2,
        "department_name": "Sanitation & Waste Management",
        "risk_quadrants": {
            "human_safety": 1,
            "public_disruption": 1,
            "health_environment": 2,
            "physical_severity": 1
        }
    },
    "paper": {
        "issue_type": "Garbage / Waste",
        "category": "Sanitation",
        "description_template": "Paper and paperboard waste detected from the uploaded image.",
        "severity": "Low",
        "priority": "Medium",
        "department_code": "SAN",
        "department_id": 2,
        "department_name": "Sanitation & Waste Management",
        "risk_quadrants": {
            "human_safety": 0,
            "public_disruption": 1,
            "health_environment": 1,
            "physical_severity": 1
        }
    },
    "cardboard": {
        "issue_type": "Garbage / Waste",
        "category": "Sanitation",
        "description_template": "Cardboard packaging waste detected from the uploaded image.",
        "severity": "Medium",
        "priority": "Medium",
        "department_code": "SAN",
        "department_id": 2,
        "department_name": "Sanitation & Waste Management",
        "risk_quadrants": {
            "human_safety": 0,
            "public_disruption": 1,
            "health_environment": 1,
            "physical_severity": 1
        }
    },
    "glass": {
        "issue_type": "Garbage / Waste",
        "category": "Sanitation",
        "description_template": "Glass bottle / sharp debris waste detected from the uploaded image posing safety risk.",
        "severity": "High",
        "priority": "High",
        "department_code": "SAN",
        "department_id": 2,
        "department_name": "Sanitation & Waste Management",
        "risk_quadrants": {
            "human_safety": 2,
            "public_disruption": 1,
            "health_environment": 2,
            "physical_severity": 1
        }
    },
    "metal": {
        "issue_type": "Garbage / Waste",
        "category": "Sanitation",
        "description_template": "Scrap metal / can waste detected from the uploaded image.",
        "severity": "Medium",
        "priority": "High",
        "department_code": "SAN",
        "department_id": 2,
        "department_name": "Sanitation & Waste Management",
        "risk_quadrants": {
            "human_safety": 2,
            "public_disruption": 1,
            "health_environment": 1,
            "physical_severity": 1
        }
    },
    "biodegradable": {
        "issue_type": "Garbage / Waste",
        "category": "Sanitation",
        "description_template": "Biodegradable organic waste detected from the uploaded image requiring sanitation pickup.",
        "severity": "Medium",
        "priority": "High",
        "department_code": "SAN",
        "department_id": 2,
        "department_name": "Sanitation & Waste Management",
        "risk_quadrants": {
            "human_safety": 1,
            "public_disruption": 1,
            "health_environment": 2,
            "physical_severity": 1
        }
    }
}


def get_civic_mapping(raw_class: str) -> Optional[Dict[str, Any]]:
    """
    Returns the canonical NAGARSETU mapping for a verified model class name.
    Normalizes casing before lookup.
    """
    if not raw_class:
        return None
    key = raw_class.strip().lower()
    return CIVIC_ISSUE_MAPPING.get(key)


def is_supported_class(raw_class: str) -> bool:
    """
    Checks if a detected class has an authoritative trained model in NAGARSETU.
    Only classes with verified weights in civicmodel.pt or best.pt return True.
    """
    if not raw_class:
        return False
    return raw_class.strip().lower() in CIVIC_ISSUE_MAPPING


# Future / Unsupported Department Mappings (Registered for future trained model integration)
# These remain strictly marked as unsupported / manual review because trained weights do not yet exist.
FUTURE_UNSUPPORTED_MAPPINGS: Dict[str, Dict[str, Any]] = {
    "broken streetlight": {
        "issue_type": "Broken Streetlight",
        "category": "Electricity",
        "department_code": "ELE",
        "department_id": 5,
        "department_name": "Electrical & Street Lighting",
        "supported_by_ai_model": False,
        "review_required": True
    },
    "electrical pole": {
        "issue_type": "Electrical Pole Hazard",
        "category": "Electricity",
        "department_code": "ELE",
        "department_id": 5,
        "department_name": "Electrical & Street Lighting",
        "supported_by_ai_model": False,
        "review_required": True
    },
    "traffic signal": {
        "issue_type": "Traffic Signal Defect",
        "category": "Traffic",
        "department_code": "TRF",
        "department_id": 6,
        "department_name": "Traffic Management Department",
        "supported_by_ai_model": False,
        "review_required": True
    },
    "road sign": {
        "issue_type": "Road Sign Damaged",
        "category": "Traffic",
        "department_code": "TRF",
        "department_id": 6,
        "department_name": "Traffic Management Department",
        "supported_by_ai_model": False,
        "review_required": True
    },
    "public asset damage": {
        "issue_type": "Public Asset Damage",
        "category": "Maintenance",
        "department_code": "MNT",
        "department_id": 7,
        "department_name": "Maintenance Department",
        "supported_by_ai_model": False,
        "review_required": True
    }
}


def get_future_unsupported_mapping(raw_class: str) -> Optional[Dict[str, Any]]:
    """
    Returns taxonomy mapping for future department classes, explicitly flagged
    as supported_by_ai_model=False and review_required=True.
    """
    if not raw_class:
        return None
    return FUTURE_UNSUPPORTED_MAPPINGS.get(raw_class.strip().lower())

