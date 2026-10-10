import os
import shutil
import hashlib
from PIL import Image

WORKSPACE_DIR = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\road_damage_v2"
DATASET_DIR = r"D:\NAGARSETU\road"
PROVISIONAL_LABELS_DIR = os.path.join(WORKSPACE_DIR, "provisional_annotations", "labels")


def init_split_dirs():
    for s in ["train", "val", "test"]:
        img_dir = os.path.join(WORKSPACE_DIR, "images", s)
        lbl_dir = os.path.join(WORKSPACE_DIR, "labels", s)
        if os.path.exists(img_dir):
            shutil.rmtree(img_dir)
        if os.path.exists(lbl_dir):
            shutil.rmtree(lbl_dir)
        os.makedirs(img_dir, exist_ok=True)
        os.makedirs(lbl_dir, exist_ok=True)

GROUP_SPLIT_MAP = {
    # Train groups (41 images)
    "session_2026_09_30_video_sequence": "train",  # 4 images
    "road_numbered_series": "train",               # 3 images (ROAD.jpg, ROAD (1).jpg, 16tvsbg03...)
    "burst_2026_10_10_part1": "train",             # 12 images
    "train_web_images": "train",                   # 13 images
    "train_singles": "train",                      # 9 images

    # Val groups (9 images)
    "session_2026_10_01_burst": "val",             # 4 images (subfolders 1 & 3)
    "val_web_images": "val",                       # 3 images (images (15), (16), (17))
    "val_singles": "val",                          # 2 images (WhatsApp-Image-2025, dc-Cover)

    # Held-out Test groups (9 images)
    "burst_2026_10_10_part2": "test",              # 6 images (014247 - 014607)
    "test_web_images": "test",                     # 2 images (images (13), (14))
    "test_singles": "test",                        # 1 image (newindianexpress...)
}

IMAGE_GROUP_MAP = {
    # session_2026_09_30_video_sequence (train)
    r"2\Screenshot 2026-09-30 144031.png": "session_2026_09_30_video_sequence",
    r"2\Screenshot 2026-09-30 144038.png": "session_2026_09_30_video_sequence",
    r"2\Screenshot 2026-09-30 144044.png": "session_2026_09_30_video_sequence",
    r"2\Screenshot 2026-09-30 144050.png": "session_2026_09_30_video_sequence",

    # road_numbered_series (train)
    "16tvsbg03-City-17TVTV_ROAD.jpg.jpg": "road_numbered_series",
    "ROAD.jpg": "road_numbered_series",
    "ROAD (1).jpg": "road_numbered_series",

    # burst_2026_10_10_part1 (train)
    "Screenshot 2026-10-10 013059.png": "burst_2026_10_10_part1",
    "Screenshot 2026-10-10 013112.png": "burst_2026_10_10_part1",
    "Screenshot 2026-10-10 013129.png": "burst_2026_10_10_part1",
    "Screenshot 2026-10-10 013251.png": "burst_2026_10_10_part1",
    "Screenshot 2026-10-10 013300.png": "burst_2026_10_10_part1",
    "Screenshot 2026-10-10 013309.png": "burst_2026_10_10_part1",
    "Screenshot 2026-10-10 013525.png": "burst_2026_10_10_part1",
    "Screenshot 2026-10-10 013535.png": "burst_2026_10_10_part1",
    "Screenshot 2026-10-10 013621.png": "burst_2026_10_10_part1",
    "Screenshot 2026-10-10 013653.png": "burst_2026_10_10_part1",
    "Screenshot 2026-10-10 013701.png": "burst_2026_10_10_part1",
    "Screenshot 2026-10-10 013707.png": "burst_2026_10_10_part1",

    # train_singles (train)
    "1500x900_426556-kochin-roads.jpg": "train_singles",
    "1662931514752.jpg-org": "train_singles",
    "1722730797_new-project-2.jpg": "train_singles",
    "1829697-road.jpg": "train_singles",
    "9F7BCA3E-0644-4703-B6E4-317C9CFE072A.jpeg": "train_singles",
    "Mumbai_rainfall_1689569082155_1700374399988.jpg": "train_singles",
    "Pothole_01.jpg": "train_singles",
    "Screenshot 2026-10-01 120748.png": "train_singles",
    "jpg-4.jpg": "train_singles",

    # train_web_images (train)
    "images.jpg": "train_web_images",
    "images (1).jpg": "train_web_images",
    "images (2).jpg": "train_web_images",
    "images (3).jpg": "train_web_images",
    "images (4).jpg": "train_web_images",
    "images (5).jpg": "train_web_images",
    "images (6).jpg": "train_web_images",
    "images (7).jpg": "train_web_images",
    "images (8).jpg": "train_web_images",
    "images (9).jpg": "train_web_images",
    "images (10).jpg": "train_web_images",
    "images (11).jpg": "train_web_images",
    "images (12).jpg": "train_web_images",

    # session_2026_10_01_burst (val)
    r"1\Screenshot 2026-10-01 081831.png": "session_2026_10_01_burst",
    r"1\WhatsApp Image 2026-10-01 at 8.16.19 AM.jpeg": "session_2026_10_01_burst",
    r"3\Screenshot 2026-10-01 081939.png": "session_2026_10_01_burst",
    r"3\WhatsApp Image 2026-10-01 at 8.16.19 AM.jpeg": "session_2026_10_01_burst",

    # val_web_images (val)
    "images (15).jpg": "val_web_images",
    "images (16).jpg": "val_web_images",
    "images (17).jpg": "val_web_images",

    # val_singles (val)
    "WhatsApp-Image-2025-09-09-at-2.47.24-PM.avif": "val_singles",
    "dc-Cover-anfegbfra3ee1mvanbf11fr9a2-20170822011319.Medi.jpeg": "val_singles",

    # burst_2026_10_10_part2 (test)
    "Screenshot 2026-10-10 014247.png": "burst_2026_10_10_part2",
    "Screenshot 2026-10-10 014302.png": "burst_2026_10_10_part2",
    "Screenshot 2026-10-10 014314.png": "burst_2026_10_10_part2",
    "Screenshot 2026-10-10 014325.png": "burst_2026_10_10_part2",
    "Screenshot 2026-10-10 014547.png": "burst_2026_10_10_part2",
    "Screenshot 2026-10-10 014607.png": "burst_2026_10_10_part2",

    # test_web_images (test)
    "images (13).jpg": "test_web_images",
    "images (14).jpg": "test_web_images",

    # test_singles (test)
    "newindianexpress_2025-05-27_0lzlmnv7_C_1_1_CH1452_10993328.avif": "test_singles",
}

def prepare_splits():
    print("Preparing dataset splits without data leakage...")
    init_split_dirs()
    split_counts = {"train": 0, "val": 0, "test": 0}

    for rel_path, group in IMAGE_GROUP_MAP.items():
        src_path = os.path.join(DATASET_DIR, rel_path)
        split = GROUP_SPLIT_MAP[group]

        # Use normalized flat path that includes subfolder if any
        flat_name = rel_path.replace("\\", "_").replace("/", "_").replace(" ", "_")
        root_name, orig_ext = os.path.splitext(flat_name)
        if orig_ext.lower() in [".jpg", ".jpeg", ".jpg-org"]:
            out_img_name = root_name + ".jpg"
        elif orig_ext.lower() in [".png"]:
            out_img_name = root_name + ".png"
        else:
            out_img_name = root_name + ".jpg"

        dest_img_path = os.path.join(WORKSPACE_DIR, "images", split, out_img_name)
        
        # Load and save RGB image cleanly to dest
        with Image.open(src_path) as im:
            rgb = im.convert("RGB")
            if out_img_name.endswith(".png"):
                rgb.save(dest_img_path, format="PNG")
            else:
                rgb.save(dest_img_path, format="JPEG", quality=95)

        # Source label file in PROVISIONAL_LABELS_DIR
        # In process_road_dataset, filenames were saved as os.path.splitext(fname.replace(' ', '_'))[0] + '.txt'
        src_label_fname = os.path.splitext(os.path.basename(rel_path).replace(" ", "_"))[0] + ".txt"
        src_label_path = os.path.join(PROVISIONAL_LABELS_DIR, src_label_fname)
        
        dest_label_path = os.path.join(WORKSPACE_DIR, "labels", split, root_name + ".txt")
        if os.path.exists(src_label_path):
            shutil.copy2(src_label_path, dest_label_path)
        else:
            with open(dest_label_path, "w", encoding="utf-8") as fp:
                pass

        split_counts[split] += 1

    print("Splits prepared successfully:")
    for s, c in split_counts.items():
        print(f"  {s}: {c} images ({c/len(IMAGE_GROUP_MAP)*100:.1f}%)")

if __name__ == "__main__":
    prepare_splits()
