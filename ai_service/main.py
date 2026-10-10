import os
import sys
import secrets
from pathlib import Path
from contextlib import asynccontextmanager

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
for p in [str(BASE_DIR), str(ROOT_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from ai_service.model_manager import (
    load_models,
    is_pothole_model_loaded,
    is_waste_model_loaded,
    is_water_pipe_model_loaded,
    is_drainage_model_loaded,
    get_confidence_threshold
)
from ai_service.analyzer import analyze_complaint_image
import google_maps_service as gms


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Load models once into memory
    load_models()
    yield


app = FastAPI(
    title="NAGARSETU Local AI & Google Maps Service",
    description="Computer Vision (YOLOv8 + LangGraph), complaint auto-fill, and official Google Maps Geocoding & Routing",
    version="3.1.0",
    lifespan=lifespan
)

cors_allowed = os.getenv("CORS_ALLOWED_ORIGINS", "")
allowed_origins = [orig.strip() for orig in cors_allowed.split(",") if orig.strip()]
if not allowed_origins:
    allowed_origins = ["http://localhost:3000", "http://localhost:5173", "http://localhost:5000", "http://127.0.0.1:5000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def verify_internal_api_key(x_internal_api_key: Optional[str] = Header(None, alias="X-Internal-API-Key")):
    expected_key = os.getenv("AI_INTERNAL_API_KEY")
    is_prod = os.getenv("ENVIRONMENT") == "production" or os.getenv("NODE_ENV") == "production"
    if is_prod and not expected_key:
        raise HTTPException(status_code=500, detail="Server security misconfiguration: AI_INTERNAL_API_KEY must be set in production")
    if not expected_key:
        return True
    if not x_internal_api_key or not secrets.compare_digest(x_internal_api_key, expected_key):
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid or missing X-Internal-API-Key")
    return True


MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/avif"}


class GeocodeRequest(BaseModel):
    address: str = Field(..., min_length=2, max_length=500)


class ReverseGeocodeRequest(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)


class DirectionsRequest(BaseModel):
    origin_latitude: float = Field(..., ge=-90.0, le=90.0)
    origin_longitude: float = Field(..., ge=-180.0, le=180.0)
    destination_latitude: float = Field(..., ge=-90.0, le=90.0)
    destination_longitude: float = Field(..., ge=-180.0, le=180.0)
    mode: Optional[str] = Field("driving", pattern="^(driving|walking|bicycling|transit)$")


class ValidateLocationRequest(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)


@app.get("/")
def root():
    return {
        "status": "ok",
        "service": "NAGARSETU Local AI & Google Maps Service",
        "version": "3.1.0",
        "ai": "local",
        "framework": "ultralytics",
        "workflow": "langgraph",
        "gemini": False
    }


@app.get("/health")
def health_check():
    """
    Lightweight local AI health check reporting loaded YOLO models and status.
    No Gemini dependency.
    """
    return {
        "status": "ok",
        "ai": "local",
        "framework": "ultralytics",
        "workflow": "langgraph",
        "models": {
            "civicmodel": is_pothole_model_loaded(),
            "wasteModel": is_waste_model_loaded(),
            "waterPipeModel": is_water_pipe_model_loaded(),
            "drainageModel": is_drainage_model_loaded()
        },
        "gemini": False,
        "confidenceThreshold": get_confidence_threshold(),
        "google_maps_configured": bool(os.getenv("GOOGLE_MAPS_API_KEY"))
    }


@app.get("/ready")
def readiness_check():
    """
    Readiness probe distinguishing a running service from a service ready for inference.
    Returns HTTP 200 if all 4 required civic models are loaded, 503 otherwise.
    """
    models_status = {
        "civicmodel": is_pothole_model_loaded(),
        "wasteModel": is_waste_model_loaded(),
        "waterPipeModel": is_water_pipe_model_loaded(),
        "drainageModel": is_drainage_model_loaded()
    }
    all_ready = all(models_status.values())
    if not all_ready:
        raise HTTPException(
            status_code=503,
            detail={
                "status": "not_ready",
                "message": "AI models are still initializing or unavailable.",
                "models": models_status
            }
        )
    return {
        "status": "ready",
        "ready": True,
        "models": models_status,
        "workflow": "langgraph"
    }


async def _process_image_upload(file: UploadFile, domain: Optional[str] = None):
    if file.content_type and file.content_type.lower() not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported Media Type: {file.content_type}. Allowed: JPEG, PNG, WebP."
        )

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty file uploaded")

        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="Payload Too Large: Maximum allowed file size is 10 MB.")

        if len(content) < 12:
            raise HTTPException(status_code=400, detail="Invalid image payload")

        header = content[:12]
        is_jpeg = header.startswith(b'\xff\xd8\xff')
        is_png = header.startswith(b'\x89PNG')
        is_webp = header.startswith(b'RIFF') and content[8:12] == b'WEBP'
        is_avif = len(header) >= 12 and header[4:8] == b'ftyp' and content[8:12] in (b'avif', b'avis', b'mif1')

        if not (is_jpeg or is_png or is_webp or is_avif):
            raise HTTPException(status_code=415, detail="Invalid image binary signature. Must be JPEG, PNG, WebP, or AVIF.")

        result = analyze_complaint_image(content, filename=file.filename or "", domain=domain)
        return result
    except HTTPException:
        raise
    except Exception as e:
        sys.stderr.write(f"[AI Service Error] {str(e)}\n")
        raise HTTPException(status_code=500, detail="AI Processing Error. Please try again later.")


@app.post("/analyze", dependencies=[Depends(verify_internal_api_key)])
async def analyze_photo(
    file: Optional[UploadFile] = File(None),
    image: Optional[UploadFile] = File(None),
    domain: Optional[str] = Form(None)
):
    """
    Runs LangGraph + Ultralytics YOLOv8 local computer-vision workflow on uploaded photo.
    Accepts image in either 'file' or 'image' form-data field.
    """
    upload = file or image
    if upload is None:
        raise HTTPException(status_code=400, detail="No 'file' or 'image' payload provided in request.")
    return await _process_image_upload(upload, domain=domain)


@app.post("/analyze-complaint-image", dependencies=[Depends(verify_internal_api_key)])
async def analyze_complaint_image_endpoint(
    image: UploadFile = File(...),
    domain: Optional[str] = Form(None)
):
    """
    Alias endpoint for CivicLens-style multipart 'image' upload.
    """
    return await _process_image_upload(image, domain=domain)


# GOOGLE MAPS ENDPOINTS (Kept intact - official routing & geocoding)
@app.post("/google-maps/geocode", dependencies=[Depends(verify_internal_api_key)])
def geocode(req: GeocodeRequest):
    return gms.geocode_address(req.address)


@app.post("/google-maps/reverse-geocode")
def reverse_geocode(req: ReverseGeocodeRequest):
    return gms.reverse_geocode(req.latitude, req.longitude)


@app.post("/google-maps/directions", dependencies=[Depends(verify_internal_api_key)])
def get_directions(req: DirectionsRequest):
    return gms.get_directions(
        req.origin_latitude,
        req.origin_longitude,
        req.destination_latitude,
        req.destination_longitude,
        mode=req.mode or "driving"
    )


@app.post("/google-maps/validate")
def validate_location(req: ValidateLocationRequest):
    is_valid = gms.is_within_nashik_bounds(req.latitude, req.longitude)
    return {
        "status": "OK",
        "latitude": req.latitude,
        "longitude": req.longitude,
        "is_valid": is_valid,
        "service_area": "Nashik Municipal Area"
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
