import io
import unittest
from PIL import Image
from ai_service.graph.state import CivicVisionState
from ai_service.graph.nodes import (
    validate_image_node,
    preprocess_image_node,
    detect_issue_node,
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


class TestCivicAIAgentNodes(unittest.TestCase):

    def _create_dummy_jpeg_bytes(self, width=100, height=100, color=(200, 100, 50)):
        img = Image.new("RGB", (width, height), color)
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue()

    def test_validate_image_node_empty(self):
        state: CivicVisionState = {"image_bytes": b"", "errors": [], "warnings": []}
        res = validate_image_node(state)
        self.assertEqual(res["ai_status"], "invalid_image")
        self.assertTrue(len(res["errors"]) > 0)

    def test_validate_image_node_invalid_signature(self):
        state: CivicVisionState = {"image_bytes": b"not_an_image_at_all_12345", "errors": [], "warnings": []}
        res = validate_image_node(state)
        self.assertEqual(res["ai_status"], "invalid_image")

    def test_validate_image_node_valid(self):
        jpeg_bytes = self._create_dummy_jpeg_bytes()
        state: CivicVisionState = {"image_bytes": jpeg_bytes, "errors": [], "warnings": []}
        res = validate_image_node(state)
        self.assertNotIn("ai_status", res)
        self.assertEqual(res["image_bytes"], jpeg_bytes)

    def test_preprocess_image_node(self):
        jpeg_bytes = self._create_dummy_jpeg_bytes(120, 80)
        state: CivicVisionState = {"image_bytes": jpeg_bytes, "errors": [], "warnings": []}
        res = preprocess_image_node(state)
        self.assertIsNotNone(res["pil_image"])
        self.assertEqual(res["image_width"], 120)
        self.assertEqual(res["image_height"], 80)

    def test_analyze_detection_node_filter_full_frame(self):
        state: CivicVisionState = {
            "image_width": 1000,
            "image_height": 1000,
            "detections": [
                {
                    "class": "pothole",
                    "confidence": 0.55,
                    "bbox": [10, 10, 990, 990],
                    "model": "civicmodel.pt"
                }
            ],
            "errors": [],
            "warnings": []
        }
        res = analyze_detection_node(state)
        self.assertEqual(res["ai_status"], "no_detection")
        self.assertEqual(len(res["detections"]), 0)

    def test_analyze_detection_node_metrics_and_multi(self):
        state: CivicVisionState = {
            "image_width": 1000,
            "image_height": 1000,
            "detections": [
                {"class": "PLASTIC", "confidence": 0.72, "bbox": [100, 100, 300, 300], "model": "best.pt"},
                {"class": "METAL", "confidence": 0.89, "bbox": [400, 400, 600, 600], "model": "best.pt"}
            ],
            "errors": [],
            "warnings": []
        }
        res = analyze_detection_node(state)
        self.assertEqual(res["primary_detection"]["class"], "METAL")
        self.assertEqual(res["confidence"], 0.89)
        self.assertEqual(res["detection_count"], 2)
        self.assertTrue(res["has_multiple_detections"])
        self.assertGreater(res["visual_impact_score"], 0.0)

    def test_validate_confidence_bands(self):
        # High confidence (>= 0.75)
        state_high: CivicVisionState = {
            "primary_detection": {"class": "Pothole", "confidence": 0.85},
            "errors": [],
            "warnings": []
        }
        res_high = validate_confidence_node(state_high)
        self.assertEqual(res_high["confidence_level"], "HIGH")
        self.assertEqual(res_high["ai_status"], "confirmed")
        self.assertFalse(res_high["review_required"])

        # Medium confidence (0.45 - 0.74)
        state_med: CivicVisionState = {
            "primary_detection": {"class": "Pothole", "confidence": 0.60},
            "errors": [],
            "warnings": []
        }
        res_med = validate_confidence_node(state_med)
        self.assertEqual(res_med["confidence_level"], "MEDIUM")
        self.assertEqual(res_med["ai_status"], "suggested")
        self.assertTrue(res_med["review_required"])

        # Low confidence (< 0.45)
        state_low: CivicVisionState = {
            "primary_detection": {"class": "Pothole", "confidence": 0.32},
            "errors": [],
            "warnings": []
        }
        res_low = validate_confidence_node(state_low)
        self.assertEqual(res_low["confidence_level"], "LOW")
        self.assertEqual(res_low["ai_status"], "manual_review")
        self.assertTrue(res_low["review_required"])

    def test_classify_issue_node(self):
        state_pothole: CivicVisionState = {
            "primary_detection": {"class": "Pothole", "confidence": 0.91},
            "errors": [],
            "warnings": []
        }
        res_pothole = classify_issue_node(state_pothole)
        self.assertEqual(res_pothole["category"], "Roads")
        self.assertEqual(res_pothole["department_code"], "PWD")
        self.assertEqual(res_pothole["department_id"], 1)

        state_waste: CivicVisionState = {
            "primary_detection": {"class": "PLASTIC", "confidence": 0.85},
            "errors": [],
            "warnings": []
        }
        res_waste = classify_issue_node(state_waste)
        self.assertEqual(res_waste["category"], "Sanitation")
        self.assertEqual(res_waste["department_code"], "SAN")
        self.assertEqual(res_waste["department_id"], 2)

    def test_calculate_severity_node_rules(self):
        # Small single pothole -> Medium
        state_small: CivicVisionState = {
            "primary_detection": {"class": "Pothole"},
            "visual_impact_score": 0.04,
            "detection_count": 1,
            "has_multiple_detections": False,
            "warnings": []
        }
        res_small = calculate_severity_node(state_small)
        self.assertEqual(res_small["severity"], "Medium")

        # Large pothole -> High / Critical
        state_large: CivicVisionState = {
            "primary_detection": {"class": "Pothole"},
            "visual_impact_score": 0.28,
            "detection_count": 1,
            "has_multiple_detections": False,
            "warnings": []
        }
        res_large = calculate_severity_node(state_large)
        self.assertIn(res_large["severity"], ["High", "Critical"])

    def test_calculate_priority_node(self):
        state_high: CivicVisionState = {
            "severity": "High",
            "visual_impact_score": 0.15,
            "confidence_level": "HIGH",
            "has_multiple_detections": False
        }
        res = calculate_priority_node(state_high)
        self.assertEqual(res["priority"], "High")
        self.assertGreaterEqual(res["priority_score"], 4)

    def test_route_department_node(self):
        state_pwd: CivicVisionState = {"category": "Roads", "department_code": "PWD"}
        res_pwd = route_department_node(state_pwd)
        self.assertEqual(res_pwd["department_id"], 1)
        self.assertEqual(res_pwd["department_code"], "PWD")

        state_san: CivicVisionState = {"category": "Sanitation", "department_code": "SAN"}
        res_san = route_department_node(state_san)
        self.assertEqual(res_san["department_id"], 2)
        self.assertEqual(res_san["department_code"], "SAN")

    def test_build_complaint_node(self):
        state: CivicVisionState = {
            "issue_type": "Road Damage / Pothole",
            "category": "Roads",
            "description": "Road damage / pothole detected from the uploaded image.",
            "severity": "High",
            "priority": "High",
            "department_code": "PWD",
            "department_id": 1,
            "department_name": "Public Works Department",
            "confidence": 0.92,
            "confidence_level": "HIGH",
            "visual_impact_score": 0.18,
            "primary_detection": {"class": "Pothole"}
        }
        res = build_complaint_node(state)
        comp = res["complaint"]
        self.assertEqual(comp["issueType"], "Road Damage / Pothole")
        self.assertEqual(comp["departmentCode"], "PWD")
        self.assertEqual(comp["departmentId"], 1)
        self.assertEqual(comp["confidenceScore"], 0.92)
        self.assertIn("reason", comp)

    def test_explain_decision_node(self):
        state: CivicVisionState = {
            "primary_detection": {"class": "Pothole"},
            "confidence": 0.82,
            "confidence_level": "HIGH",
            "visual_impact_score": 0.19,
            "severity": "High",
            "priority": "High",
            "priority_score": 5
        }
        res = explain_decision_node(state)
        expl = res["explanation"]
        self.assertEqual(expl["detectedIssue"], "Pothole")
        self.assertEqual(expl["confidenceLevel"], "HIGH")
        self.assertIn("Road damage", expl["reason"])

    def test_human_review_node(self):
        state: CivicVisionState = {
            "primary_detection": {"class": "Pothole"},
            "confidence": 0.35,
            "confidence_level": "LOW",
            "ai_status": "manual_review"
        }
        res = human_review_node(state)
        self.assertEqual(res["ai_status"], "manual_review")
        self.assertTrue(res["review_required"])
        self.assertIsNone(res["complaint"])
        self.assertIn("explanation", res)

    def test_validate_result_node_rich_confirmed(self):
        state: CivicVisionState = {
            "ai_status": "confirmed",
            "model_used": "civicmodel.pt",
            "primary_detection": {"class": "Pothole", "confidence": 0.91, "confidenceLevel": "HIGH"},
            "detections": [{"class": "Pothole", "confidence": 0.91}],
            "confidence": 0.91,
            "confidence_level": "HIGH",
            "visual_impact_score": 0.22,
            "complaint": {
                "issueType": "Road Damage / Pothole",
                "category": "Roads",
                "departmentCode": "PWD",
                "departmentId": 1,
                "confidenceScore": 0.91
            }
        }
        res = validate_result_node(state)
        final = res["final_result"]
        self.assertTrue(final["success"])
        self.assertTrue(final["detected"])
        self.assertEqual(final["aiStatus"], "confirmed")
        self.assertIn("analysis", final)
        self.assertIn("explanation", final)
        self.assertIn("transparencyNotice", final)
        self.assertFalse(final["reviewRequired"])


if __name__ == "__main__":
    unittest.main()
