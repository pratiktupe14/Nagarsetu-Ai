import os
from PIL import Image
from ai_service.model_manager import run_pipe_classification
from ai_service.analyzer import analyze_complaint_image

test_suites = [
    ('PRIMARY REQUIRED EXAMPLES', [
        ('1. Real Perfect Pipe', r'D:\NAGARSETU\normal pipe images\Screenshot 2026-10-09 011533.png', 'pipe'),
        ('2. Real Water Leakage', r'D:\NAGARSETU\leaking pipes\water-leaking-hole-industrial-hose-260nw-2609724773.jpg', 'pipe'),
        ('3. Real Broken Pipe', r'D:\NAGARSETU\leaking pipes\burst-water-pipe.jpg', 'pipe'),
    ]),
    ('3 ADDITIONAL BROKEN PIPE IMAGES', [
        ('4. Broken Pipe (Shattered Pipe Section)', r'D:\NAGARSETU\leaking pipes\images.jpeg', 'pipe'),
        ('5. Broken Pipe (Fractured Joint)', r'D:\NAGARSETU\leaking pipes\images (6).jpg', 'pipe'),
        ('6. Broken Pipe (Burst Opening)', r'D:\NAGARSETU\leaking pipes\WhatsApp Image 2026-10-09 at 12.32.25 AM.jpeg', 'pipe'),
    ]),
    ('3 ADDITIONAL WATER LEAKAGE IMAGES', [
        ('7. Water Leakage (Pipe Drip)', r'D:\NAGARSETU\leaking pipes\images (20).jpg', 'pipe'),
        ('8. Water Leakage (Spraying Pipe)', r'D:\NAGARSETU\leaking pipes\images (3).jpg', 'pipe'),
        ('9. Water Leakage (Hose Jet)', r'D:\NAGARSETU\leaking pipes\WhatsApp Image 2026-10-09 at 12.33.38 AM.jpeg', 'pipe'),
    ]),
    ('3 ADDITIONAL PERFECT PIPE IMAGES', [
        ('10. Perfect Pipe (Clean Conduit)', r'D:\NAGARSETU\normal pipe images\4412.webp', 'pipe'),
        ('11. Perfect Pipe (Intact Installation)', r'D:\NAGARSETU\normal pipe images\istockphoto-1275396599-612x612.jpg', 'pipe'),
        ('12. Perfect Pipe (Normal Hardware)', r'D:\NAGARSETU\normal pipe images\images (5).jpg', 'pipe'),
    ])
]

for section_name, tests in test_suites:
    print(f"\n======================================================================")
    print(f"SECTION: {section_name}")
    print(f"======================================================================")
    for label, path, domain in tests:
        if not os.path.exists(path):
            print(f"NOT FOUND: {path}")
            continue
        
        pil_img = Image.open(path).convert('RGB')
        meta = run_pipe_classification(pil_img)
        
        with open(path, 'rb') as f:
            bytes_data = f.read()
        res = analyze_complaint_image(bytes_data, filename=os.path.basename(path), domain=domain)
        
        print("--------------------------------------------------")
        print(f"Case:                         {label}")
        print(f"filename:                     {os.path.basename(path)}")
        print(f"predicted_class:              {meta['predicted_class']}")
        print(f"perfect_probability:          {meta['perfect_probability']:.4f}")
        print(f"leakage_probability:          {meta['leakage_probability']:.4f}")
        print(f"broken_probability:           {meta['broken_probability']:.4f}")
        print(f"structural_rupture_evidence:  {meta['structural_rupture_evidence']}")
        print(f"structural_confidence:        {meta['structural_confidence']:.4f}")
        print(f"final_class:                  {meta['final_class']}")
        print(f"final_confidence:             {meta['final_confidence']:.4f}")
        print(f"detected:                     {res.get('detected')}")
        print(f"ai_status:                    {res.get('ai_status')}")
        print(f"review_required:              {res.get('review_required')}")
        print(f"issue_type:                   {res.get('issue_type')}")
        print(f"category:                     {res.get('category')}")
        print(f"department_code:              {res.get('department_code')}")
