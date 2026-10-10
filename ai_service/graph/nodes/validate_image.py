import os
from pathlib import Path
from typing import Dict, Any
from ai_service.graph.state import CivicVisionState

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def validate_image_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Validates uploaded image bytes, file size, and binary magic signatures.
    """
    image_bytes = state.get("image_bytes")
    image_path = state.get("image_path")
    errors = list(state.get("errors") or [])
    warnings = list(state.get("warnings") or [])

    if not image_bytes and image_path and os.path.exists(image_path):
        try:
            with open(image_path, "rb") as f:
                image_bytes = f.read()
        except Exception as e:
            errors.append(f"Failed to read image from path: {e}")

    if not image_bytes or len(image_bytes) == 0:
        errors.append("Empty image payload provided (0 bytes).")
        return {
            "image_bytes": None,
            "ai_status": "invalid_image",
            "errors": errors,
            "warnings": warnings
        }

    if len(image_bytes) > MAX_FILE_SIZE:
        errors.append(f"File size exceeds limit ({len(image_bytes)} bytes > {MAX_FILE_SIZE} bytes).")
        return {
            "image_bytes": None,
            "ai_status": "invalid_image",
            "errors": errors,
            "warnings": warnings
        }

    # Binary signature check (JPEG, PNG, WebP)
    if len(image_bytes) < 12:
        errors.append("Image payload too short to verify header signature.")
        return {
            "image_bytes": None,
            "ai_status": "invalid_image",
            "errors": errors,
            "warnings": warnings
        }

    header = image_bytes[:12]
    is_jpeg = header.startswith(b"\xff\xd8\xff")
    is_png = header.startswith(b"\x89PNG\r\n\x1a\n") or header.startswith(b"\x89PNG")
    is_webp = header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    is_avif = (len(image_bytes) >= 12 and header[4:8] == b"ftyp" and header[8:12] in (b"avif", b"avis"))

    if not (is_jpeg or is_png or is_webp or is_avif):
        errors.append("Invalid image binary format. Must be JPEG, PNG, WebP, or AVIF.")
        return {
            "image_bytes": None,
            "ai_status": "invalid_image",
            "errors": errors,
            "warnings": warnings
        }

    return {
        "image_bytes": image_bytes,
        "errors": errors,
        "warnings": warnings
    }
