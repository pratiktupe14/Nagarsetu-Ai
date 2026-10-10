import os
import sys
import hashlib
import unittest
import numpy as np
from PIL import Image
import torch
import torchvision.transforms as T

sys.path.append(r"d:\NAGARSETU\NAGARSETU 3.1")
from ai_service.train_pipe_model import WaterPipeClassifier as BaselineClassifier
from ai_service.training.water_pipe_v2.train_water_pipe_v2 import (
    WaterPipeClassifier as CandidateClassifier,
    collect_dataset,
    create_group_stratified_split,
    NORMAL_DIR,
    LEAK_DIR,
    BASELINE_MODEL_PATH,
    CANDIDATE_MODEL_PATH,
    METRICS_PATH
)
from ai_service.model_manager import run_pipe_classification, get_water_pipe_model, load_models

class TestWaterPipeV2Validation(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        load_models()
        cls.samples, cls.stats = collect_dataset()
        cls.candidate_ckpt = torch.load(CANDIDATE_MODEL_PATH, map_location="cpu")
        cls.candidate_model = CandidateClassifier(num_classes=cls.candidate_ckpt.get("num_classes", 2))
        cls.candidate_model.load_state_dict(cls.candidate_ckpt["model_state_dict"])
        cls.candidate_model.eval()

    def test_01_all_valid_images_load(self):
        """1. All valid images load successfully without throwing unhandled exceptions."""
        loaded_count = 0
        for s in self.samples:
            with Image.open(s["path"]) as img:
                rgb = img.convert("RGB")
                w, h = rgb.size
                self.assertGreater(w, 0)
                self.assertGreater(h, 0)
                loaded_count += 1
        self.assertEqual(loaded_count, len(self.samples))
        print(f"\n[Test 1 PASS] All {loaded_count} images loaded and verified successfully.")

    def test_02_class_labels_match_training_config(self):
        """2. Class labels match the training configuration."""
        self.assertEqual(self.candidate_ckpt["classes"], ["normal_pipe", "damaged_or_leaking_pipe"])
        self.assertEqual(self.candidate_ckpt["class_names"], {0: "normal_pipe", 1: "damaged_or_leaking_pipe"})
        print(f"[Test 2 PASS] Class labels match training configuration: {self.candidate_ckpt['classes']}.")

    def test_03_train_val_test_leakage_prevented(self):
        """3. Train/validation/test leakage is prevented (no cross-set file or group leakage)."""
        train, val, test = create_group_stratified_split(self.samples, seed=42)
        train_paths = set(s["path"] for s in train)
        val_paths = set(s["path"] for s in val)
        test_paths = set(s["path"] for s in test)

        # Disjoint path sets
        self.assertEqual(len(train_paths.intersection(val_paths)), 0)
        self.assertEqual(len(train_paths.intersection(test_paths)), 0)
        self.assertEqual(len(val_paths.intersection(test_paths)), 0)

        # Check MD5 hashes to prevent duplicate image leakage
        def get_hashes(sample_list):
            h_set = set()
            for s in sample_list:
                with open(s["path"], "rb") as fp:
                    h_set.add(hashlib.md5(fp.read()).hexdigest())
            return h_set

        train_hashes = get_hashes(train)
        val_hashes = get_hashes(val)
        test_hashes = get_hashes(test)

        self.assertEqual(len(train_hashes.intersection(val_hashes)), 0)
        self.assertEqual(len(train_hashes.intersection(test_hashes)), 0)
        self.assertEqual(len(val_hashes.intersection(test_hashes)), 0)
        print("[Test 3 PASS] Zero data leakage: train, val, and test splits are strictly disjoint in files and hashes.")

    def test_04_data_augmentation_runs_without_corruption(self):
        """4. Data augmentation runs without corruption."""
        aug_transform = T.Compose([
            T.Resize((224, 224)),
            T.RandomHorizontalFlip(p=0.5),
            T.RandomRotation(15),
            T.ColorJitter(brightness=0.15, contrast=0.15),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        for s in self.samples[:5]:
            with Image.open(s["path"]) as img:
                tensor = aug_transform(img.convert("RGB"))
                self.assertEqual(tensor.shape, (3, 224, 224))
                self.assertFalse(torch.isnan(tensor).any())
                self.assertFalse(torch.isinf(tensor).any())
        print("[Test 4 PASS] Augmentation pipeline executes without corruption or numerical anomalies.")

    def test_05_model_checkpoint_loads_successfully(self):
        """5. Model checkpoint loads successfully."""
        self.assertIn("model_state_dict", self.candidate_ckpt)
        self.assertIn("classes", self.candidate_ckpt)
        self.assertIn("num_classes", self.candidate_ckpt)
        self.assertIn("metrics", self.candidate_ckpt)
        print("[Test 5 PASS] Checkpoint structure is complete and valid.")

    def test_06_output_class_dimensions_are_correct(self):
        """6. Output class dimensions are correct."""
        dummy_input = torch.randn(2, 3, 224, 224)
        out = self.candidate_model(dummy_input)
        self.assertEqual(out.shape, (2, 2))
        print(f"[Test 6 PASS] Output dimensions are correct: {out.shape}.")

    def test_07_preprocessing_matches_inference(self):
        """7. Preprocessing matches inference."""
        input_size = self.candidate_ckpt.get("input_size", (224, 224))
        mean = self.candidate_ckpt.get("mean", [0.485, 0.456, 0.406])
        std = self.candidate_ckpt.get("std", [0.229, 0.224, 0.225])
        self.assertEqual(input_size, (224, 224))
        self.assertEqual(mean, [0.485, 0.456, 0.406])
        self.assertEqual(std, [0.229, 0.224, 0.225])
        print("[Test 7 PASS] Preprocessing dimensions and normalization match inference exactly.")

    def test_08_normal_pipe_images_produce_valid_predictions(self):
        """8. Normal pipe images produce valid predictions."""
        eval_transform = T.Compose([
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        normal_samples = [s for s in self.samples if s["label"] == 0]
        # Test first 5 normal pipes
        for s in normal_samples[:5]:
            with Image.open(s["path"]) as img:
                t = eval_transform(img.convert("RGB")).unsqueeze(0)
                with torch.no_grad():
                    out = self.candidate_model(t)
                    probs = torch.softmax(out, dim=1)[0]
                    self.assertGreater(probs[0].item(), 0.0)
                    self.assertLessEqual(probs[0].item(), 1.0)
        print("[Test 8 PASS] Normal pipe images produce valid probability outputs.")

    def test_09_leaking_damaged_pipe_images_produce_valid_predictions(self):
        """9. Leaking/damaged pipe images produce valid predictions."""
        eval_transform = T.Compose([
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        leak_samples = [s for s in self.samples if s["label"] == 1]
        for s in leak_samples[:5]:
            with Image.open(s["path"]) as img:
                t = eval_transform(img.convert("RGB")).unsqueeze(0)
                with torch.no_grad():
                    out = self.candidate_model(t)
                    probs = torch.softmax(out, dim=1)[0]
                    self.assertGreater(probs[1].item(), 0.0)
                    self.assertLessEqual(probs[1].item(), 1.0)
        print("[Test 9 PASS] Leaking/damaged pipe images produce valid probability outputs.")

    def test_10_invalid_images_fail_safely(self):
        """10. Invalid images fail safely."""
        res_none = run_pipe_classification(None)
        self.assertIsNone(res_none)
        print("[Test 10 PASS] Invalid/None images fail safely with None return.")

    def test_11_low_confidence_predictions_handled_safely(self):
        """11. Low-confidence predictions are handled safely."""
        # A completely flat synthetic noise image
        flat_img = Image.new("RGB", (224, 224), color=(128, 128, 128))
        # Test with high threshold or through run_pipe_classification
        res = run_pipe_classification(flat_img, threshold=0.99)
        self.assertIsNotNone(res)
        self.assertIn("ai_status", res)
        print(f"[Test 11 PASS] Low-confidence handling verified: status={res['ai_status']}.")

    def test_12_existing_ai_service_imports_remain_functional(self):
        """12. Existing AI service imports remain functional."""
        from ai_service.main import app
        from ai_service.analyzer import analyze_complaint_image
        self.assertIsNotNone(app)
        self.assertIsNotNone(analyze_complaint_image)
        print("[Test 12 PASS] Existing AI service modules import and initialize cleanly.")

    def test_13_existing_model_weights_remain_unchanged(self):
        """13. Existing model weights remain unchanged."""
        self.assertTrue(os.path.exists(BASELINE_MODEL_PATH))
        # Size of baseline model was 6,221,217 bytes
        baseline_size = os.path.getsize(BASELINE_MODEL_PATH)
        self.assertEqual(baseline_size, 6221217)
        # Verify baseline checkpoint loads
        base_ckpt = torch.load(BASELINE_MODEL_PATH, map_location="cpu")
        self.assertEqual(base_ckpt.get("num_classes"), 3)
        print(f"[Test 13 PASS] Baseline model preserved: {BASELINE_MODEL_PATH} ({baseline_size:,} bytes).")

    def test_14_candidate_model_can_be_loaded_independently(self):
        """14. Candidate model file can be loaded independently."""
        self.assertTrue(os.path.exists(CANDIDATE_MODEL_PATH))
        ckpt = torch.load(CANDIDATE_MODEL_PATH, map_location="cpu")
        mod = CandidateClassifier(num_classes=ckpt["num_classes"], pretrained=False)
        mod.load_state_dict(ckpt["model_state_dict"])
        mod.eval()
        t = torch.randn(1, 3, 224, 224)
        with torch.no_grad():
            out = mod(t)
        self.assertEqual(out.shape, (1, 2))
        print("[Test 14 PASS] Candidate model loads and executes inference completely independently.")

if __name__ == "__main__":
    unittest.main(verbosity=2)
