import os
import unittest
from PIL import Image
import io

from ai_service.analyzer import analyze_complaint_image
from ai_service.graph.workflow import run_civic_vision_pipeline


class TestPipeAIIntegration(unittest.TestCase):
    def setUp(self):
        self.real_pipe_folder = r"D:\NAGARSETU\leaking pipes"
        self.burst_img = os.path.join(self.real_pipe_folder, "burst-water-pipe.jpg")
        self.leak_hole_img = os.path.join(self.real_pipe_folder, "water-leaking-hole-industrial-hose-260nw-2609724773.jpg")
        self.broken_img = os.path.join(self.real_pipe_folder, "broken-water-pipe-leaking-out-soil-underground-leak-274565016.webp")

    def test_water_leakage_detection_and_routing(self):
        """Tests that a real water leakage image detects Water Leakage and routes to WTR."""
        if not os.path.exists(self.leak_hole_img):
            self.skipTest(f"Sample {self.leak_hole_img} not found")

        with open(self.leak_hole_img, "rb") as fp:
            data = fp.read()

        result = analyze_complaint_image(data, filename="leak_test.jpg", domain="water")
        self.assertTrue(result["detected"])
        self.assertEqual(result["category"], "Water Supply")
        self.assertIn(result["department_code"], ("WTR",))
        self.assertIn("Leak", result["issue_type"])
        self.assertIn(result["severity"], ("High", "Critical", "Medium"))
        self.assertIn(result["priority"], ("High", "Critical", "Medium"))

    def test_broken_pipe_detection_and_routing(self):
        """Tests that a real broken pipe image detects Broken Pipe and routes to WTR."""
        img_to_use = self.burst_img if os.path.exists(self.burst_img) else self.broken_img
        if not os.path.exists(img_to_use):
            self.skipTest(f"Sample {img_to_use} not found")

        with open(img_to_use, "rb") as fp:
            data = fp.read()

        result = analyze_complaint_image(data, filename="broken_test.webp", domain="water")
        self.assertTrue(result["detected"])
        self.assertEqual(result["category"], "Water Supply")
        self.assertEqual(result["department_code"], "WTR")
        self.assertIn("Pipe", result["issue_type"])
        self.assertIn(result["severity"], ("High", "Critical", "Medium"))

    def test_perfect_pipe_normal_behavior(self):
        """
        Tests the strict contract for normal pipe:
        PERFECT_PIPE:
        detected = false
        issue_type = null
        category = null
        department_code = null
        department_id = null
        severity = None
        priority = None
        review_required = false
        ai_status = 'confirmed_normal'
        condition = 'normal'
        """
        initial_state = {
            "ai_status": "confirmed_normal",
            "condition": "normal",
            "pipe_condition": "normal",
            "road_condition": "non_road",
            "detected": False,
            "domain": "water",
            "filename": "normal_pipe_inspection.jpg"
        }
        from ai_service.graph.nodes.validate_result import validate_result_node
        res = validate_result_node(initial_state)
        final = res["final_result"]

        self.assertFalse(final["detected"])
        self.assertIsNone(final["issue_type"])
        self.assertIsNone(final["category"])
        self.assertIsNone(final["department_code"])
        self.assertIsNone(final["department_id"])
        self.assertIsNone(final["severity"])
        self.assertIsNone(final["priority"])
        self.assertFalse(final["review_required"])
        self.assertEqual(final["ai_status"], "confirmed_normal")
        self.assertEqual(final["condition"], "normal")
        self.assertEqual(final["message"], "✓ PIPE CONDITION: NORMAL")

    def test_real_held_out_perfect_pipe_image(self):
        """Tests that a real held-out normal pipe image from D:\\NAGARSETU\\normal pipe images evaluates to normal pipe with no complaint."""
        norm_folder = r"D:\NAGARSETU\normal pipe images"
        if not os.path.exists(norm_folder):
            self.skipTest(f"Normal pipe folder {norm_folder} not found")

        test_file = os.path.join(norm_folder, "blue-industrial-water-pipe-system-with-visible-rust-near-a-corrugated-metal-wall-in-an-outdoor-setting-photo.jpg")
        if not os.path.exists(test_file):
            # pick first available image
            files = [f for f in os.listdir(norm_folder) if f.endswith(('.jpg', '.png', '.webp'))]
            test_file = os.path.join(norm_folder, files[0])

        with open(test_file, "rb") as fp:
            data = fp.read()

        result = analyze_complaint_image(data, filename="normal_pipe_test.jpg", domain="water")
        self.assertFalse(result["detected"])
        self.assertEqual(result["ai_status"], "confirmed_normal")
        self.assertIsNone(result.get("department_code"))
        self.assertEqual(result.get("message"), "✓ PIPE CONDITION: NORMAL")

    def test_unrelated_image_does_not_create_wtr_complaint(self):
        """Tests that an unrelated sky image does not trigger WTR complaint."""
        img = Image.new("RGB", (300, 300), (135, 206, 235))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        data = buf.getvalue()

        result = analyze_complaint_image(data, filename="clear_sky.jpg")
        self.assertFalse(result["detected"])
        self.assertNotEqual(result.get("department_code"), "WTR")


if __name__ == "__main__":
    unittest.main()
