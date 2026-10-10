import http.server
import socketserver
import os

PORT = 8765
TARGET_FILE = r"d:\NAGARSETU\NAGARSETU 3.1\ai_service\training\road_damage_v2\road_annotations_reviewed_audit.json"

class SaveHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)
        with open(TARGET_FILE, "wb") as f:
            f.write(post_data)
        
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"saved","bytes":' + str(len(post_data)).encode() + b'}')
        print(f"[OK] Saved review JSON ({len(post_data)} bytes) to {TARGET_FILE}")

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), SaveHandler) as httpd:
        print(f"Serving on port {PORT}...")
        httpd.handle_request() # handle single POST request and exit
