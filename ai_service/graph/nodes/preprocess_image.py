import io
from PIL import Image
from typing import Dict, Any
from ai_service.graph.state import CivicVisionState


def preprocess_image_node(state: CivicVisionState) -> Dict[str, Any]:
    """
    Decodes verified image bytes into a PIL RGB image and extracts dimensions.
    """
    image_bytes = state.get("image_bytes")
    errors = list(state.get("errors") or [])
    warnings = list(state.get("warnings") or [])

    if not image_bytes:
        errors.append("No valid image bytes to preprocess.")
        return {
            "ai_status": "invalid_image",
            "errors": errors,
            "warnings": warnings
        }

    try:
        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        width, height = pil_image.size

        return {
            "pil_image": pil_image,
            "image_width": width,
            "image_height": height,
            "errors": errors,
            "warnings": warnings
        }
    except Exception as e:
        errors.append(f"Image decode exception: {str(e)}")
        return {
            "pil_image": None,
            "ai_status": "invalid_image",
            "errors": errors,
            "warnings": warnings
        }
