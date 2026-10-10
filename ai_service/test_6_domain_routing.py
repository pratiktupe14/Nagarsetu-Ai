import os
import requests
import json

base_url = "http://127.0.0.1:8000/analyze"

test_cases = [
    {
        "name": "1. Water Leakage (Actual Blue Pipe Spraying Image from Evidence)",
        "file": r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\test_blue_pipe.jpg",
        "domain": "pipe",
        "expected_dept": "WTR",
        "expected_cat": "Water Supply",
        "expected_issue": "Water Leakage"
    },
    {
        "name": "2. Broken Pipe (Structural Rupture)",
        "file": r"D:\NAGARSETU\leaking pipes\burst-water-pipe.jpg",
        "domain": "pipe",
        "expected_dept": "WTR",
        "expected_cat": "Water Supply",
        "expected_issue": "Broken Water Pipe"
    },
    {
        "name": "3. Normal Pipe (Held-out Intact Blue Pipe)",
        "file": r"D:\NAGARSETU\normal pipe images\blue-industrial-water-pipe-system-with-visible-rust-near-a-corrugated-metal-wall-in-an-outdoor-setting-photo.jpg",
        "domain": "pipe",
        "expected_status": "confirmed_normal",
        "expected_detected": False
    },
    {
        "name": "4. Pothole / Road Image",
        "file": r"D:\NAGARSETU\leaking pipes\WhatsApp Image 2026-10-09 at 12.32.25 AM.jpeg",
        "domain": "road",
        "expected_dept": "PWD",
        "expected_cat": "Roads"
    },
    {
        "name": "5. Waste Image (Sanitation)",
        "file": r"D:\NAGARSETU\drainage images\dbcl_169054508064c3abb8201fb_1690531846342.jpg",
        "domain": "waste",
        "expected_cat": "Sanitation"
    },
    {
        "name": "6. Drainage Image (Grate / Drain)",
        "file": r"D:\NAGARSETU\drainage images\a-close-up-view-of-a-damaged-urban-street-surface-showing-a-metal-storm-drain-grate-pos...jpg",
        "domain": "drainage",
        "expected_dept": "DRN",
        "expected_cat": "Drainage"
    }
]

print("================================================================================")
print("             NAGARSETU 3.1 - REAL MULTI-DOMAIN ROUTING VERIFICATION              ")
print("================================================================================")

all_passed = True
for tc in test_cases:
    path = tc["file"]
    if not os.path.exists(path):
        # find fallback if filename was truncated
        dir_name = os.path.dirname(path)
        base_prefix = os.path.basename(path).split("...")[0]
        matches = [os.path.join(dir_name, f) for f in os.listdir(dir_name) if f.startswith(base_prefix)]
        if matches:
            path = matches[0]
        else:
            print(f"[SKIP] {tc['name']}: file not found {tc['file']}")
            continue

    with open(path, "rb") as f:
        files = {"file": (os.path.basename(path), f, "image/jpeg")}
        data = {"domain": tc["domain"]}
        res = requests.post(base_url, files=files, data=data)

    if res.status_code != 200:
        print(f"[FAIL] {tc['name']} HTTP {res.status_code}: {res.text}")
        all_passed = False
        continue

    r = res.json()
    model = r.get("model") or r.get("ai_model")
    dept = r.get("department_code") or r.get("department")
    cat = r.get("category")
    issue = r.get("issue_type") or r.get("title")
    conf = r.get("confidence")
    status = r.get("ai_status") or r.get("aiStatus")
    detected = r.get("detected")

    print(f"\n--- {tc['name']} ---")
    print(f"  Domain Sent:       {tc['domain']}")
    print(f"  Model Selected:    {model}")
    print(f"  AI Status:         {status}")
    print(f"  Detected:          {detected}")
    print(f"  Category:          {cat}")
    print(f"  Issue Type/Title:  {issue}")
    print(f"  Confidence:        {conf}")
    print(f"  Department:        {dept}")

    # Check criteria
    if "expected_dept" in tc:
        if dept != tc["expected_dept"] and not (isinstance(dept, str) and tc["expected_dept"] in dept):
            print(f"  [ERROR] Expected department {tc['expected_dept']}, got {dept}")
            all_passed = False
        else:
            print(f"  [PASS] Department correctly assigned to {dept}")
    elif "expected_status" in tc:
        if status != tc["expected_status"] or detected != tc.get("expected_detected", False):
            print(f"  [ERROR] Expected status {tc['expected_status']} detected={tc.get('expected_detected')}, got status={status} detected={detected}")
            all_passed = False
        else:
            print(f"  [PASS] Normal status correctly verified with zero false alarms")

print("\n================================================================================")
print(f"OVERALL RESULT: {'ALL PASS' if all_passed else 'SOME FAILED'}")
print("================================================================================")
