import os
from typing import Dict, Any, List, Tuple
import numpy as np
from PIL import Image

try:
    import cv2
except ImportError:
    cv2 = None

from ai_service.graph.state import CivicVisionState
from ai_service.model_manager import (
    get_confidence_threshold,
    get_high_confidence_threshold
)


def compute_surface_metrics(pil_img: Image.Image) -> Dict[str, Any]:
    """
    Computes computer vision surface features from decoded image:
    - Laplacian variance (sharpness / blur)
    - Brightness and contrast
    - Color profile & Road surface ratio (asphalt/concrete characteristic ranges)
    - Edge density (structural irregularity vs smooth asphalt)
    - Uniformity index
    """
    if pil_img is None:
        return {
            "sharpness": 0.0,
            "is_blurry": True,
            "is_road": False,
            "road_surface_ratio": 0.0,
            "brightness": 0.0,
            "contrast": 0.0,
            "edge_density": 0.0,
            "uniformity": 0.0
        }

    # Normalize to RGB numpy array
    rgb = np.array(pil_img.convert("RGB"))
    height, width, _ = rgb.shape
    total_pixels = float(height * width) if (height > 0 and width > 0) else 1.0

    if cv2 is not None:
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
        laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    else:
        # Fallback without OpenCV
        gray = np.dot(rgb[..., :3], [0.2989, 0.5870, 0.1140]).astype(np.uint8)
        gy, gx = np.gradient(gray.astype(float))
        laplacian_var = float(np.var(gx) + np.var(gy))
        hsv = np.zeros_like(rgb)

    mean_brightness = float(np.mean(gray))
    contrast = float(np.std(gray))

    # Blur threshold: standard photographic sharpness threshold
    is_blurry = laplacian_var < 50.0

    # Road surface color analysis:
    # Asphalt & concrete pavement:
    # - Relatively neutral color balance (|R-G| < 35, |G-B| < 35, |R-B| < 35)
    # - Medium to dark or light-gray value (25 < V < 230)
    # - Low to moderate saturation (S < 85 out of 255)
    r = rgb[:, :, 0].astype(float)
    g = rgb[:, :, 1].astype(float)
    b = rgb[:, :, 2].astype(float)

    diff_rg = np.abs(r - g)
    diff_gb = np.abs(g - b)
    diff_rb = np.abs(r - b)
    channel_balance = (diff_rg < 35) & (diff_gb < 35) & (diff_rb < 35)

    if cv2 is not None:
        sat = hsv[:, :, 1]
        val = hsv[:, :, 2]
        hue = hsv[:, :, 0]
    else:
        max_c = np.maximum(np.maximum(r, g), b)
        min_c = np.minimum(np.minimum(r, g), b)
        sat = np.where(max_c > 0, 255.0 * (max_c - min_c) / max_c, 0.0)
        val = max_c
        hue = np.zeros_like(sat)

    # Road surface encompasses:
    # 1. Neutral asphalt / concrete (balanced channels, low saturation, medium-dark values)
    neutral_road = (sat < 90) & (val > 20) & (val < 240)
    # 2. Earthy / dusty asphalt, gravel, road dirt, dried mud in cavities (warm earth tones)
    earthy_road = (hue >= 5) & (hue <= 38) & (sat < 170) & (val > 20) & (val < 240)

    road_pixel_mask = (neutral_road | earthy_road)
    road_surface_ratio = float(np.sum(road_pixel_mask)) / total_pixels

    # Edge analysis
    if cv2 is not None and not is_blurry:
        edges = cv2.Canny(gray, 50, 150)
        edge_density = float(np.sum(edges > 0)) / total_pixels
    else:
        edge_density = 0.0

    # Road surface verification:
    # Image must have at least 20% road-characteristic pixels and reasonable brightness
    is_road = (road_surface_ratio >= 0.20) and (mean_brightness > 15)

    return {
        "sharpness": round(laplacian_var, 2),
        "is_blurry": is_blurry,
        "is_road": is_road,
        "road_surface_ratio": round(road_surface_ratio, 4),
        "brightness": round(mean_brightness, 2),
        "contrast": round(contrast, 2),
        "edge_density": round(edge_density, 4),
        "uniformity": round(max(0.0, 1.0 - (edge_density * 4.0)), 3)
    }


def validate_pothole_candidate(
    det: Dict[str, Any],
    pil_img: Image.Image,
    surface_metrics: Dict[str, Any]
) -> Tuple[bool, str]:
    """
    Protects against false positives:
    - Checks bounding box area ratio
    - Checks aspect ratio (suppresses horizontal/vertical thin stripes like lane markings, tire tracks)
    - Suppresses detections on non-road surfaces
    """
    bbox = det.get("bbox") or []
    conf = float(det.get("confidence", 0.0))

    if len(bbox) != 4:
        return False, "Invalid bbox coordinates"

    w_box = max(0.0, float(bbox[2] - bbox[0]))
    h_box = max(0.0, float(bbox[3] - bbox[1]))

    if w_box <= 0 or h_box <= 0:
        return False, "Zero dimension bbox"

    # 1. Extreme aspect ratio (lane marking stripes, long linear shadows)
    aspect_ratio = max(w_box / h_box, h_box / w_box)
    if aspect_ratio > 7.0 and conf < 0.65:
        return False, f"Extreme aspect ratio ({aspect_ratio:.1f}) typical of lane lines or tire tracks"

    # 2. Non-road image gating: If the image as a whole does not match a road surface
    if not surface_metrics["is_road"] and conf < 0.80:
        return False, "Image background is not verified as a roadway surface"

    # 3. Cavity / depression verification:
    # A true pothole has darker interior depth / contrast variance relative to smooth pavement
    if pil_img is not None:
        try:
            im_w, im_h = pil_img.size
            x1 = max(0, min(im_w - 1, int(bbox[0])))
            y1 = max(0, min(im_h - 1, int(bbox[1])))
            x2 = max(x1 + 1, min(im_w, int(bbox[2])))
            y2 = max(y1 + 1, min(im_h, int(bbox[3])))

            crop = pil_img.crop((x1, y1, x2, y2)).convert("L")
            crop_arr = np.array(crop)
            box_contrast = float(np.std(crop_arr))

            # Flat uniform texture inside box with low confidence is typically a shadow or asphalt patch
            if box_contrast < 10.0 and conf < 0.55:
                return False, f"Flat interior texture (std={box_contrast:.1f}) typical of shadow or uniform tar patch"
        except Exception:
            pass

    return True, "Valid pothole characteristics"


def road_condition_analysis_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Road Condition Analysis Agent (Option B Architecture):
    - Analyzes road surface characteristics (sharpness, texture, road color ratios).
    - Performs False Positive Protection on pothole detections (shadows, lane lines, patches).
    - Classifies road condition into:
        1. DEFECTIVE (real pothole verified with sufficient confidence)
        2. CLEAN (verified clear road with no defects)
        3. UNCERTAIN (blurry, poor lighting, ambiguous, or manual review required)
        4. NON_ROAD (uploaded image is not a road surface)
    - Non-road civic issues (waste/sanitation) are preserved and routed to their respective workflow.
    """
    pil_image = state.get("pil_image")
    raw_detections = list(state.get("detections") or [])
    domain = (state.get("domain") or "").strip().lower()
    errors = list(state.get("errors") or [])
    warnings = list(state.get("warnings") or [])
    reasoning = list(state.get("reasoning") or [])

    high_threshold = get_high_confidence_threshold()  # 0.75
    med_threshold = get_confidence_threshold()        # 0.45

    if state.get("ai_status") == "confirmed_normal" or state.get("condition") == "normal":
        return {
            "condition": "normal",
            "pipe_condition": state.get("pipe_condition", "normal"),
            "drain_condition": state.get("drain_condition", "normal"),
            "road_condition": "non_road",
            "detected": False,
            "ai_status": "confirmed_normal",
            "issue_type": None,
            "category": None,
            "department_code": None,
            "department_id": None,
            "severity": None,
            "priority": None,
            "review_required": False,
            "detections": [],
            "reasoning": reasoning,
            "errors": errors,
            "warnings": warnings
        }

    # 1. Compute computer vision surface metrics
    surface_metrics = compute_surface_metrics(pil_image)
    is_road = surface_metrics["is_road"]
    is_blurry = surface_metrics["is_blurry"]

    # 2. Check for Waste Detections from best.pt (Sanitation workflow preservation)
    waste_classes = {"BIODEGRADABLE", "CARDBOARD", "GLASS", "METAL", "PAPER", "PLASTIC"}
    pothole_dets = [d for d in raw_detections if d.get("class") == "Pothole"]

    # Filter out full-frame false-positive waste detections on verified road surfaces
    waste_dets = []
    for d in raw_detections:
        if d.get("class") in waste_classes:
            bbox = d.get("bbox") or []
            if len(bbox) == 4 and surface_metrics["is_road"] and pil_image is not None:
                box_w = bbox[2] - bbox[0]
                box_h = bbox[3] - bbox[1]
                img_w, img_h = pil_image.size
                box_area_ratio = (box_w * box_h) / float(img_w * img_h) if (img_w > 0 and img_h > 0) else 0.0
                if box_area_ratio > 0.65 and surface_metrics["road_surface_ratio"] > 0.70:
                    warnings.append(f"Suppressed full-frame false-positive waste detection ({d.get('class')}, area={box_area_ratio:.1%}) on verified road surface.")
                    continue
            waste_dets.append(d)

    # If domain is not explicitly road, and we have clear waste detections:
    if waste_dets and domain not in ("road", "pothole"):
        reasoning.append(f"Identified {len(waste_dets)} waste/sanitation detection(s). Proceeding to Sanitation flow.")
        return {
            "road_condition": "non_road",
            "road_analysis": surface_metrics,
            "reasoning": reasoning,
            "errors": errors,
            "warnings": warnings
        }

    # 2b. Check for Pipe Detections from water_pipe_model.pt (Water department workflow)
    pipe_classes = {"water leakage", "water_leakage", "broken pipe", "broken_pipe"}
    pipe_dets = [d for d in raw_detections if (d.get("class") or "").strip().lower() in pipe_classes]

    if pipe_dets and domain not in ("road", "pothole"):
        primary_pipe = sorted(pipe_dets, key=lambda d: d.get("confidence", 0.0), reverse=True)[0]
        p_conf = float(primary_pipe.get("confidence", 0.0))
        conf_level = "HIGH" if p_conf >= high_threshold else "MEDIUM"
        ai_status = "confirmed" if p_conf >= high_threshold else "suggested"
        pipe_cls = (primary_pipe.get("class") or "").strip().lower()
        is_leakage = "leak" in pipe_cls
        cond = "leakage" if is_leakage else "broken"
        issue_name = "Water Leakage" if is_leakage else "Broken Water Pipe"

        reasoning.append(f"Identified pipe defect ({issue_name}, conf={p_conf:.1%}). Proceeding to Water Supply (WTR) flow.")
        return {
            "road_condition": "non_road",
            "condition": cond,
            "pipe_condition": cond,
            "detections": pipe_dets,
            "primary_detection": primary_pipe,
            "confidence": p_conf,
            "confidence_level": conf_level,
            "ai_status": ai_status,
            "review_required": (ai_status != "confirmed"),
            "category": "Water Supply",
            "issue_type": issue_name,
            "department_code": "WTR",
            "department_id": 3,
            "department_name": "Water Supply & Sewerage Board",
            "severity": "High",
            "priority": "High",
            "reasoning": reasoning,
            "errors": errors,
            "warnings": warnings
        }

    # 2c. Check for Normal / Perfect Pipe (explicit pipe domain or indicator, no defects found)
    filename_lower = (state.get("filename") or "").lower()
    is_pipe_domain = domain in ("water", "pipe", "leak", "leakage") or any(k in filename_lower for k in ["pipe", "pipeline", "wtr"])
    if is_pipe_domain and not pothole_dets and not waste_dets and not pipe_dets:
        norm_desc = "The uploaded image shows a normal pipe with no visible leakage or significant damage."
        reasoning.append("Normal pipe verified with no visible leakage or damage. No complaint required.")
        return {
            "condition": "normal",
            "pipe_condition": "normal",
            "road_condition": "non_road",
            "detected": False,
            "issue_type": None,
            "category": None,
            "department_code": None,
            "department_id": None,
            "severity": None,
            "priority": None,
            "review_required": False,
            "ai_status": "confirmed_normal",
            "confidence": 0.95,
            "confidence_level": "HIGH",
            "primary_detection": None,
            "detections": [],
            "explanation": {
                "detectedIssue": "Normal Pipe",
                "confidence": 0.95,
                "confidenceLevel": "HIGH",
                "reason": norm_desc
            },
            "reasoning": reasoning,
            "errors": errors,
            "warnings": warnings
        }

    # 2d. Check for Drainage Detections from drainage_model.pt (Drainage department workflow)
    drain_classes = {"blocked drain", "blocked_drain", "damaged drain", "damaged_drain", "drain overflow", "drain_overflow"}
    drain_dets = [d for d in raw_detections if (d.get("class") or "").strip().lower() in drain_classes]

    if drain_dets and domain not in ("road", "pothole"):
        primary_drain = sorted(drain_dets, key=lambda d: d.get("confidence", 0.0), reverse=True)[0]
        d_conf = float(primary_drain.get("confidence", 0.0))
        conf_level = "HIGH" if d_conf >= high_threshold else "MEDIUM"
        ai_status = "confirmed" if d_conf >= high_threshold else "suggested"
        drain_cls = (primary_drain.get("class") or "").strip().lower()
        if "damage" in drain_cls:
            cond = "damaged"
            issue_name = "Damaged Drain / Broken Slab"
        elif "overflow" in drain_cls:
            cond = "overflow"
            issue_name = "Drain Overflow"
        else:
            cond = "blocked"
            issue_name = "Blocked Drain / Gutter"

        reasoning.append(f"Identified drainage defect ({issue_name}, conf={d_conf:.1%}). Proceeding to Drainage & Sewage (DRN) flow.")
        return {
            "road_condition": "non_road",
            "condition": cond,
            "drain_condition": cond,
            "detections": drain_dets,
            "primary_detection": primary_drain,
            "confidence": d_conf,
            "confidence_level": conf_level,
            "ai_status": ai_status,
            "review_required": (ai_status != "confirmed"),
            "category": "Drainage",
            "issue_type": issue_name,
            "department_code": "DRN",
            "department_id": 4,
            "department_name": "Drainage & Sewage Department",
            "severity": "High",
            "priority": "High",
            "reasoning": reasoning,
            "errors": errors,
            "warnings": warnings
        }

    # 2e. Check for Normal Drainage (explicit drain domain or indicator, no defects found)
    is_drain_domain = domain in ("drain", "drainage", "sewage", "gutter", "culvert") or any(k in filename_lower for k in ["drain", "sewage", "gutter", "culvert", "grate"])
    if is_drain_domain and not pothole_dets and not waste_dets and not pipe_dets and not drain_dets:
        norm_desc = "The uploaded image shows normal, functional drainage with no visible blockage, damage, or overflow."
        reasoning.append("Normal drainage verified with no visible blockage or structural damage. No complaint required.")
        return {
            "condition": "normal",
            "drain_condition": "normal",
            "road_condition": "non_road",
            "detected": False,
            "issue_type": None,
            "category": None,
            "department_code": None,
            "department_id": None,
            "severity": None,
            "priority": None,
            "review_required": False,
            "ai_status": "confirmed_normal",
            "confidence": 0.95,
            "confidence_level": "HIGH",
            "primary_detection": None,
            "detections": [],
            "explanation": {
                "detectedIssue": "Normal Drainage",
                "confidence": 0.95,
                "confidenceLevel": "HIGH",
                "reason": norm_desc
            },
            "reasoning": reasoning,
            "errors": errors,
            "warnings": warnings
        }

    # 3. Pothole False Positive Protection Gate
    validated_potholes: List[Dict[str, Any]] = []
    filtered_count = 0

    for det in pothole_dets:
        conf = float(det.get("confidence", 0.0))
        is_valid, reason = validate_pothole_candidate(det, pil_image, surface_metrics)

        if is_valid and conf >= med_threshold:
            validated_potholes.append(det)
        else:
            filtered_count += 1
            warnings.append(f"Filtered pothole candidate (conf={conf:.2f}): {reason}")
            reasoning.append(f"False-positive protection filtered candidate (conf={conf:.2f}): {reason}")

    # Sort validated potholes by confidence descending
    validated_potholes.sort(key=lambda d: d.get("confidence", 0.0), reverse=True)

    # 4. ROAD CONDITION DECISION
    # CASE 1: Valid Pothole Detected
    if len(validated_potholes) > 0:
        primary_pothole = validated_potholes[0]
        p_conf = float(primary_pothole.get("confidence", 0.0))
        conf_level = "HIGH" if p_conf >= high_threshold else "MEDIUM"
        ai_status = "confirmed" if p_conf >= high_threshold else "suggested"
        review_required = (ai_status != "confirmed")

        reasoning.append(
            f"Road defect verified: Pothole detected with {p_conf:.1%} confidence ({conf_level}). "
            f"Routing to PWD Road Damage workflow."
        )

        return {
            "road_condition": "defective",
            "detections": validated_potholes,
            "primary_detection": primary_pothole,
            "confidence": p_conf,
            "confidence_level": conf_level,
            "ai_status": ai_status,
            "review_required": review_required,
            "road_analysis": {
                **surface_metrics,
                "validated_potholes": len(validated_potholes),
                "filtered_candidates": filtered_count
            },
            "reasoning": reasoning,
            "warnings": warnings,
            "errors": errors
        }

    # CASE 2 & 3: No Valid Pothole Detected
    # Check if image is actually a road
    if not is_road:
        # Non-road image
        reason_msg = "Uploaded photo does not exhibit recognizable road pavement characteristics."
        reasoning.append(f"Non-road surface identified (road ratio: {surface_metrics['road_surface_ratio']:.1%}).")
        return {
            "road_condition": "non_road",
            "ai_status": "manual_review",
            "review_required": True,
            "detections": [],
            "primary_detection": None,
            "confidence": 0.0,
            "confidence_level": "LOW",
            "category": "Other",
            "issue_type": "Unrecognized Scene",
            "severity": "Low",
            "priority": "Medium",
            "department_code": None,
            "department_id": None,
            "explanation": {
                "detectedIssue": "Non-Road",
                "confidence": 0.0,
                "confidenceLevel": "LOW",
                "reason": reason_msg
            },
            "road_analysis": surface_metrics,
            "reasoning": reasoning,
            "warnings": warnings,
            "errors": errors
        }

    # Image IS a road. Now check image quality / blur:
    if is_blurry or surface_metrics["contrast"] < 8.0:
        reason_msg = "Road condition could not be verified confidently. Please upload a clearer road image."
        reasoning.append(f"Road image quality uncertain (sharpness={surface_metrics['sharpness']}, blurry={is_blurry}).")
        return {
            "road_condition": "uncertain",
            "ai_status": "manual_review",
            "review_required": True,
            "detections": [],
            "primary_detection": None,
            "confidence": 0.0,
            "confidence_level": "LOW",
            "category": "Road Condition",
            "issue_type": "Uncertain Road Condition",
            "severity": "None",
            "priority": "None",
            "department_code": None,
            "department_id": None,
            "explanation": {
                "detectedIssue": "Uncertain Road",
                "confidence": 0.0,
                "confidenceLevel": "LOW",
                "reason": reason_msg
            },
            "road_analysis": surface_metrics,
            "reasoning": reasoning,
            "warnings": warnings,
            "errors": errors
        }

    # CASE 2: CLEAN / NORMAL ROAD
    # Verified road surface, sharp/clear image, zero potholes detected or all candidate defects filtered as normal road features
    clean_confidence = round(min(0.96, max(0.85, 0.85 + (surface_metrics["uniformity"] * 0.10))), 2)
    reasoning.append(
        f"Clean road verified with {clean_confidence:.0%} confidence. "
        f"Surface uniformity: {surface_metrics['uniformity']:.2f}, road ratio: {surface_metrics['road_surface_ratio']:.1%}. "
        f"No pothole or road defect detected."
    )

    clean_explanation = {
        "detectedIssue": "Clean Road",
        "confidence": clean_confidence,
        "confidenceLevel": "HIGH",
        "visualImpact": 0.0,
        "reason": "The uploaded road image shows no visible pothole or significant road defect."
    }

    return {
        "road_condition": "clean",
        "ai_status": "confirmed_clean",
        "review_required": False,
        "detections": [],
        "primary_detection": None,
        "confidence": clean_confidence,
        "confidence_level": "HIGH",
        "issue_type": "No Road Defect",
        "category": "Road Condition",
        "severity": "None",
        "priority": "None",
        "department_code": None,
        "department_id": None,
        "department_name": None,
        "complaint": None,
        "explanation": clean_explanation,
        "road_analysis": surface_metrics,
        "reasoning": reasoning,
        "warnings": warnings,
        "errors": errors
    }
