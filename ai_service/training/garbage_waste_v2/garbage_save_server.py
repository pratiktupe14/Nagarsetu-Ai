import http.server
import socketserver
import os
import json
import time
import shutil

PORT = 8766
TARGET_FILE = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\garbage_waste_v2\garbage_annotations_reviewed.json"

class GarbageSaveHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)
        
        try:
            parsed = json.loads(post_data.decode("utf-8"))
            
            # Create timestamped backup if target exists
            if os.path.exists(TARGET_FILE):
                bk = TARGET_FILE.replace(".json", f"_backup_{int(time.time())}.json")
                shutil.copy2(TARGET_FILE, bk)

            with open(TARGET_FILE, "w", encoding="utf-8") as f:
                json.dump(parsed, f, indent=2)

            resp = {
                "status": "saved",
                "bytes": len(post_data),
                "timestamp": time.time(),
                "path": TARGET_FILE
            }
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(resp).encode())
            print(f"[OK] Successfully saved garbage review JSON ({len(post_data)} bytes) to {TARGET_FILE}")
        except Exception as e:
            self.send_response(500)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(str(e).encode())

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), GarbageSaveHandler) as httpd:
        print(f"Garbage review save server listening on port {PORT}...")
        httpd.serve_forever()
