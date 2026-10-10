import os
import unittest
from ai_service.graph.workflow import run_civic_vision_pipeline
from ai_service.model_manager import load_models


class TestCivicVisionGraphIntegration(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        load_models()
        cls.uploads_dir = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "uploads")
        cls.pothole_sample = os.path.join(cls.uploads_dir, "060423ab-81c3-4f4a-a6ab-0449404db247.jpg")
        cls.waste_sample = os.path.join(cls.uploads_dir, "0ed0346b-10e8-4009-9928-80fce15a9749.jpg")

    def test_pothole_image_end_to_end(self):
        self.assertTrue(os.path.exists(self.pothole_sample), f"File {self.pothole_sample} must exist")
        with open(self.pothole_sample, "rb") as f:
            image_bytes = f.read()

        result = run_civic_vision_pipeline(
            image_bytes=image_bytes,
            filename="test_pothole.jpg",
            domain="road"
        )

        self.assertTrue(result["success"])
        self.assertTrue(result["detected"])
        self.assertIn(result["aiStatus"], ("confirmed", "suggested"))
        self.assertEqual(result["model"], "civicmodel.pt")

        primary = result["primaryDetection"]
        self.assertIsNotNone(primary)
        self.assertEqual(primary["class"], "Pothole")
        self.assertGreaterEqual(primary["confidence"], 0.45)
        self.assertIn(primary["confidenceLevel"], ("HIGH", "MEDIUM"))

        # Rich Analysis & Explanation verification
        self.assertIn("analysis", result)
        self.assertIn("visualImpactScore", result["analysis"])
        self.assertIn("detectionCount", result["analysis"])
        self.assertIn("explanation", result)
        self.assertIn("reason", result["explanation"])
        self.assertIn("transparencyNotice", result)
        self.assertIsInstance(result["reviewRequired"], bool)

        comp = result["complaint"]
        self.assertIsNotNone(comp)
        self.assertEqual(comp["issueType"], "Road Damage / Pothole")
        self.assertEqual(comp["category"], "Roads")
        self.assertEqual(comp["departmentCode"], "PWD")
        self.assertEqual(comp["departmentId"], 1)
        self.assertEqual(comp["departmentName"], "Public Works Department")
        self.assertIn("reason", comp)

    def test_waste_image_end_to_end(self):
        self.assertTrue(os.path.exists(self.waste_sample), f"File {self.waste_sample} must exist")
        with open(self.waste_sample, "rb") as f:
            image_bytes = f.read()

        result = run_civic_vision_pipeline(
            image_bytes=image_bytes,
            filename="test_waste.jpg",
            domain="waste"
        )

        self.assertTrue(result["success"])
        self.assertTrue(result["detected"])
        self.assertIn(result["aiStatus"], ("confirmed", "suggested"))
        self.assertEqual(result["model"], "best.pt")

        comp = result["complaint"]
        self.assertIsNotNone(comp)
        self.assertEqual(comp["category"], "Sanitation")
        self.assertEqual(comp["departmentCode"], "SAN")
        self.assertEqual(comp["departmentId"], 2)
        self.assertEqual(comp["departmentName"], "Sanitation & Waste Management")

        self.assertIn("explanation", result)
        self.assertIn("transparencyNotice", result)

    def test_unrelated_image_no_detection(self):
        import io
        from PIL import Image
        img = Image.new("RGB", (600, 400), (70, 130, 180))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        image_bytes = buf.getvalue()

        result = run_civic_vision_pipeline(
            image_bytes=image_bytes,
            filename="sky.jpg"
        )

        self.assertTrue(result["success"])
        self.assertFalse(result["detected"])
        self.assertIn(result["aiStatus"], ("no_detection", "manual_review"))
        self.assertIsNone(result["complaint"])
        self.assertTrue(result["reviewRequired"])
        self.assertIn("transparencyNotice", result)

    def test_invalid_image_payload(self):
        result = run_civic_vision_pipeline(
            image_bytes=b"malformed_non_image_bytes_here",
            filename="bad.jpg"
        )
        self.assertFalse(result["success"])
        self.assertFalse(result["detected"])
        self.assertEqual(result["aiStatus"], "invalid_image")
        self.assertTrue(result["reviewRequired"])


if __name__ == "__main__":
    unittest.main()
