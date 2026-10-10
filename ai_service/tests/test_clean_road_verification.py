"""
Dedicated Benchmark and Unit Tests for NAGARSETU 3.1 Clean Road / No-Pothole Verification.
Evaluates all 8 required test categories and computes classification metrics:
- Precision
- Recall
- F1 Score
- Confusion Matrix
- Clean Road False Positive Rate (Road Clean -> Classified as Pothole)
- Pothole False Negative Rate (Pothole -> Missed / Clean)
"""

import os
import io
import cv2
import numpy as np
import unittest
from PIL import Image

from ai_service.graph.workflow import run_civic_vision_pipeline
from ai_service.analyzer import analyze_complaint_image
from ai_service.model_manager import load_models


def create_synthetic_road_image(width=640, height=480, variant="clean"):
    """
    Generates realistic road test images with controlled visual features.
    Variants:
      - 'clean': uniform neutral gray asphalt with micro-texture
      - 'lane_markings': clean asphalt with crisp white/yellow center striping
      - 'shadow': clean road with cast shadow gradient across lane
      - 'repaired_patch': clean road with a darker rectangular bitumen patch
      - 'blurry': heavily blurred road failing sharpness variance
      - 'non_road': grass / landscape with non-road color space
    """
    np.random.seed(42 if variant != "random" else None)
    
    # Natural perspective lighting gradient (distant road horizon 95 to foreground 135)
    gradient = np.linspace(95, 135, height, dtype=np.float32)[:, None, None]
    img = np.tile(gradient, (1, width, 3)).astype(np.uint8)
    
    # Add asphalt aggregate texture noise
    noise = np.random.normal(0, 16, (height, width, 3)).astype(np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    
    if variant == "clean":
        # Realistic clean road surface
        img = cv2.GaussianBlur(img, (3, 3), 0.5)
        
    elif variant == "lane_markings":
        # Draw white dashed lane stripes
        for y in range(20, height - 20, 80):
            cv2.rectangle(img, (width // 2 - 8, y), (width // 2 + 8, y + 45), (235, 235, 235), -1)
            
    elif variant == "shadow":
        # Cast diagonal shadow band (multiply region by 0.55)
        mask = np.zeros((height, width), dtype=np.float32)
        pts = np.array([[0, 0], [width // 2, 0], [width, height], [width // 2, height]], np.int32)
        cv2.fillPoly(mask, [pts], 1.0)
        mask = cv2.GaussianBlur(mask, (31, 31), 10)
        for c in range(3):
            img[:, :, c] = np.clip(img[:, :, c] * (1.0 - 0.45 * mask), 0, 255).astype(np.uint8)
            
    elif variant == "repaired_patch":
        # Draw a darker asphalt rectangular patch (seamless, flat bitumen repair)
        patch_x1, patch_y1 = width // 3, height // 3
        patch_x2, patch_y2 = width // 3 + 160, height // 3 + 100
        # Darker asphalt BGR ~ 70, 70, 70
        patch = np.full((patch_y2 - patch_y1, patch_x2 - patch_x1, 3), 75, dtype=np.uint8)
        pnoise = np.random.normal(0, 8, patch.shape).astype(np.int16)
        patch = np.clip(patch.astype(np.int16) + pnoise, 0, 255).astype(np.uint8)
        img[patch_y1:patch_y2, patch_x1:patch_x2] = patch
        
    elif variant == "blurry":
        # Severe out-of-focus blur
        img = cv2.GaussianBlur(img, (45, 45), 18.0)
        
    elif variant == "non_road":
        # Lush green foliage / lawn image (high saturation green, hue ~ 60)
        img = np.zeros((height, width, 3), dtype=np.uint8)
        img[:, :, 1] = 180  # High green channel
        img[:, :, 0] = 30   # Low blue
        img[:, :, 2] = 40   # Low red
        gnoise = np.random.normal(0, 25, (height, width, 3)).astype(np.int16)
        img = np.clip(img.astype(np.int16) + gnoise, 0, 255).astype(np.uint8)

    # Encode to JPEG buffer
    _, buffer = cv2.imencode(".jpg", img)
    return buffer.tobytes(), img


class TestCleanRoadAIVerification(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        load_models()
        cls.uploads_dir = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "uploads")
        cls.real_pothole_path = os.path.join(cls.uploads_dir, "060423ab-81c3-4f4a-a6ab-0449404db247.jpg")
        
        # Verify pothole image exists
        if not os.path.exists(cls.real_pothole_path):
            cls.real_pothole_path = os.path.join(cls.uploads_dir, "test-pothole.jpg")
        cls.assertTrue(os.path.exists(cls.real_pothole_path), "Pothole test image must exist")

    def test_category_1_clearly_clean_road(self):
        """TEST 1: Clearly clean road -> Expected: CLEAN"""
        buf, _ = create_synthetic_road_image(variant="clean")
        res = run_civic_vision_pipeline(image_bytes=buf, filename="clean_road.jpg", domain="road")
        
        self.assertTrue(res["success"])
        self.assertFalse(res["detected"])
        self.assertEqual(res.get("road_condition"), "clean")
        self.assertEqual(res["aiStatus"], "confirmed_clean")
        self.assertFalse(res["reviewRequired"])
        self.assertIsNone(res["complaint"])

    def test_category_2_clear_pothole(self):
        """TEST 2: Clear pothole -> Expected: POTHOLE / PWD"""
        with open(self.real_pothole_path, "rb") as f:
            buf = f.read()
            
        res = run_civic_vision_pipeline(image_bytes=buf, filename="pothole.jpg", domain="road")
        
        self.assertTrue(res["success"])
        self.assertTrue(res["detected"])
        self.assertEqual(res["primaryDetection"]["class"], "Pothole")
        self.assertIsNotNone(res["complaint"])
        self.assertEqual(res["complaint"]["departmentCode"], "PWD")
        self.assertEqual(res["complaint"]["category"], "Roads")

    def test_category_3_repaired_road_patch(self):
        """TEST 3: Normal repaired road patch -> Expected: CLEAN or UNCERTAIN, never automatic pothole"""
        buf, _ = create_synthetic_road_image(variant="repaired_patch")
        res = run_civic_vision_pipeline(image_bytes=buf, filename="repaired_patch.jpg", domain="road")
        
        self.assertTrue(res["success"])
        # Must NOT classify repaired patch as Pothole!
        self.assertNotEqual((res.get("primaryDetection") or {}).get("class"), "Pothole")
        self.assertIn(res.get("road_condition"), ("clean", "uncertain"))
        if res.get("road_condition") == "clean":
            self.assertIsNone(res["complaint"])

    def test_category_4_road_with_shadows(self):
        """TEST 4: Road with shadows -> Expected: CLEAN or UNCERTAIN, never pothole"""
        buf, _ = create_synthetic_road_image(variant="shadow")
        res = run_civic_vision_pipeline(image_bytes=buf, filename="shadowed_road.jpg", domain="road")
        
        self.assertTrue(res["success"])
        self.assertFalse(res["detected"])
        self.assertIn(res.get("road_condition"), ("clean", "uncertain"))
        self.assertIsNone(res["complaint"])

    def test_category_5_road_with_lane_markings(self):
        """TEST 5: Road with lane markings -> Expected: CLEAN"""
        buf, _ = create_synthetic_road_image(variant="lane_markings")
        res = run_civic_vision_pipeline(image_bytes=buf, filename="lane_markings.jpg", domain="road")
        
        self.assertTrue(res["success"])
        self.assertFalse(res["detected"])
        self.assertEqual(res.get("road_condition"), "clean")
        self.assertEqual(res["aiStatus"], "confirmed_clean")
        self.assertIsNone(res["complaint"])

    def test_category_6_blurry_road_image(self):
        """TEST 6: Blurry road image -> Expected: UNCERTAIN / MANUAL REVIEW"""
        buf, _ = create_synthetic_road_image(variant="blurry")
        res = run_civic_vision_pipeline(image_bytes=buf, filename="blurry_road.jpg", domain="road")
        
        self.assertTrue(res["success"])
        self.assertFalse(res["detected"])
        self.assertEqual(res.get("road_condition"), "uncertain")
        self.assertEqual(res["aiStatus"], "manual_review")
        self.assertTrue(res["reviewRequired"])

    def test_category_7_non_road_image(self):
        """TEST 7: Non-road image -> Expected: NOT_A_ROAD / MANUAL REVIEW"""
        buf, _ = create_synthetic_road_image(variant="non_road")
        res = run_civic_vision_pipeline(image_bytes=buf, filename="grass.jpg", domain="road")
        
        self.assertTrue(res["success"])
        self.assertFalse(res["detected"])
        self.assertEqual(res.get("road_condition"), "non_road")
        self.assertEqual(res["aiStatus"], "manual_review")
        self.assertTrue(res["reviewRequired"])

    def test_category_8_pothole_at_different_angle(self):
        """TEST 8: Pothole at different angle -> Expected: POTHOLE"""
        with open(self.real_pothole_path, "rb") as f:
            raw_bytes = f.read()
            
        nparr = np.frombuffer(raw_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Apply small affine rotation (e.g. 10 degrees) to simulate angled capture
        h, w = img.shape[:2]
        M = cv2.getRotationMatrix2D((w // 2, h // 2), 10, 1.0)
        rotated = cv2.warpAffine(img, M, (w, h), borderMode=cv2.BORDER_REFLECT)
        _, rotated_buf = cv2.imencode(".jpg", rotated)
        
        res = run_civic_vision_pipeline(image_bytes=rotated_buf.tobytes(), filename="pothole_angle.jpg", domain="road")
        
        self.assertTrue(res["success"])
        self.assertTrue(res["detected"])
        self.assertEqual(res["primaryDetection"]["class"], "Pothole")
        self.assertEqual(res["complaint"]["departmentCode"], "PWD")

    def test_analyzer_contract_clean_road(self):
        """Verifies full analyzer.py response contract for clean road"""
        buf, _ = create_synthetic_road_image(variant="clean")
        contract = analyze_complaint_image(image_bytes=buf, filename="clean.jpg", domain="road")
        
        self.assertTrue(contract["success"])
        self.assertEqual(contract["road_condition"], "clean")
        self.assertFalse(contract["detected"])
        self.assertIsNone(contract["detected_class"])
        self.assertEqual(contract["ai_status"], "confirmed_clean")
        self.assertFalse(contract["review_required"])
        self.assertEqual(contract["category"], "Road Condition")
        self.assertEqual(contract["issue_type"], "No Road Defect")
        self.assertEqual(contract["severity"], "None")
        self.assertEqual(contract["priority"], "None")
        self.assertIsNone(contract["department"])
        self.assertIsNone(contract["department_code"])
        self.assertIsNone(contract["department_id"])
        self.assertIn("no visible pothole", contract["explanation"].lower())

    def test_analyzer_contract_pothole(self):
        """Verifies full analyzer.py response contract for real pothole"""
        with open(self.real_pothole_path, "rb") as f:
            buf = f.read()
            
        contract = analyze_complaint_image(image_bytes=buf, filename="pothole.jpg", domain="road")
        
        self.assertTrue(contract["success"])
        self.assertEqual(contract["road_condition"], "defective")
        self.assertTrue(contract["detected"])
        self.assertEqual(contract["detected_class"], "Pothole")
        self.assertEqual(contract["category"], "Roads")
        self.assertEqual(contract["department_code"], "PWD")
        self.assertEqual(contract["department_id"], 1)

    def test_comprehensive_metrics_benchmark(self):
        """
        Runs comprehensive test matrix across all categories and computes:
        - Precision
        - Recall
        - F1 Score
        - Confusion Matrix
        - Clean Road False Positive Rate
        - Pothole False Negative Rate
        """
        # Test dataset composition:
        # Category: list of (bytes, true_label)
        # Labels: 'POTHOLE', 'CLEAN', 'UNCERTAIN'
        samples = []
        
        # 1. Clean roads (10 variations)
        for i in range(10):
            buf, _ = create_synthetic_road_image(variant="clean")
            samples.append((buf, "CLEAN", f"clean_{i}"))
            
        # 2. Lane markings (5 variations)
        for i in range(5):
            buf, _ = create_synthetic_road_image(variant="lane_markings")
            samples.append((buf, "CLEAN", f"lane_{i}"))
            
        # 3. Shadows (5 variations)
        for i in range(5):
            buf, _ = create_synthetic_road_image(variant="shadow")
            samples.append((buf, "CLEAN_OR_UNCERTAIN", f"shadow_{i}"))
            
        # 4. Repaired patches (5 variations)
        for i in range(5):
            buf, _ = create_synthetic_road_image(variant="repaired_patch")
            samples.append((buf, "CLEAN_OR_UNCERTAIN", f"patch_{i}"))
            
        # 5. Blurry images (5 variations)
        for i in range(5):
            buf, _ = create_synthetic_road_image(variant="blurry")
            samples.append((buf, "UNCERTAIN", f"blurry_{i}"))
            
        # 6. Non-road images (5 variations)
        for i in range(5):
            buf, _ = create_synthetic_road_image(variant="non_road")
            samples.append((buf, "UNCERTAIN", f"nonroad_{i}"))
            
        # 7. Real potholes and angled potholes (10 variations)
        with open(self.real_pothole_path, "rb") as f:
            base_pothole_bytes = f.read()
            
        nparr = np.frombuffer(base_pothole_bytes, np.uint8)
        base_pothole_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        for deg in [0, 5, -5, 8, -8, 10, -10, 12, -12, 15]:
            if deg == 0:
                samples.append((base_pothole_bytes, "POTHOLE", f"pothole_{deg}"))
            else:
                h, w = base_pothole_cv.shape[:2]
                M = cv2.getRotationMatrix2D((w // 2, h // 2), deg, 1.0)
                rotated = cv2.warpAffine(base_pothole_cv, M, (w, h), borderMode=cv2.BORDER_REFLECT)
                _, pbuf = cv2.imencode(".jpg", rotated)
                samples.append((pbuf.tobytes(), "POTHOLE", f"pothole_{deg}"))

        # Evaluate all
        # Confusion matrix buckets:
        # Ground Truth rows: [Pothole, Non-Pothole (Clean/Uncertain)]
        # Predicted cols:   [Pothole, Non-Pothole]
        # TP: GT Pothole -> Pred Pothole
        # FN: GT Pothole -> Pred Non-Pothole (missed pothole)
        # FP: GT Clean/Normal -> Pred Pothole (clean classified as pothole)
        # TN: GT Clean/Normal -> Pred Non-Pothole
        TP, FP, FN, TN = 0, 0, 0, 0
        clean_total = 0
        clean_false_positives = 0
        
        for buf, gt_label, name in samples:
            res = run_civic_vision_pipeline(image_bytes=buf, filename=f"{name}.jpg", domain="road")
            is_pred_pothole = (res["detected"] and res.get("primaryDetection", {}).get("class") == "Pothole")
            
            if gt_label == "POTHOLE":
                if is_pred_pothole:
                    TP += 1
                else:
                    FN += 1
            elif gt_label in ("CLEAN", "CLEAN_OR_UNCERTAIN", "UNCERTAIN"):
                clean_total += 1
                if is_pred_pothole:
                    FP += 1
                    clean_false_positives += 1
                else:
                    TN += 1

        precision = TP / (TP + FP) if (TP + FP) > 0 else 0.0
        recall = TP / (TP + FN) if (TP + FN) > 0 else 0.0
        f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
        clean_fpr = clean_false_positives / clean_total if clean_total > 0 else 0.0
        pothole_fnr = FN / (TP + FN) if (TP + FN) > 0 else 0.0
        
        print("\n" + "="*50)
        print(" NAGARSETU 3.1 AI EVALUATION BENCHMARK METRICS")
        print("="*50)
        print(f"Total Benchmark Images: {len(samples)}")
        print(f"TP (Pothole correctly identified): {TP}")
        print(f"TN (Clean/Uncertain correctly protected): {TN}")
        print(f"FP (Clean road falsely marked pothole): {FP}")
        print(f"FN (Pothole missed): {FN}")
        print(f"Precision: {precision:.4f} ({precision*100:.1f}%)")
        print(f"Recall:    {recall:.4f} ({recall*100:.1f}%)")
        print(f"F1 Score:  {f1:.4f} ({f1*100:.1f}%)")
        print(f"Clean Road False Positive Rate (FPR): {clean_fpr:.4f} ({clean_fpr*100:.1f}%)")
        print(f"Pothole False Negative Rate (FNR):    {pothole_fnr:.4f} ({pothole_fnr*100:.1f}%)")
        print("="*50 + "\n")
        
        # Crucial assertions:
        # Clean Road False Positive Rate must be ZERO or near zero
        self.assertEqual(clean_false_positives, 0, "Clean road False Positive Rate must be 0.0%!")
        self.assertGreaterEqual(precision, 0.90, "Pothole precision must be >= 90%")
        self.assertGreaterEqual(recall, 0.80, "Pothole recall must be >= 80%")


if __name__ == "__main__":
    unittest.main()
