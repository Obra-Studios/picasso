"""
FastAPI server for logging Figma plugin generation data
Run with: uvicorn logger_server:app --reload --port 8000
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any
import json
import os
from datetime import datetime
import base64

app = FastAPI(title="Figma Plugin Logger")

# Enable CORS for Figma plugin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logger directory structure (relative to script location)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOGGER_DIR = os.path.join(SCRIPT_DIR, "..", "logger_data")
MEDIA_DIR = os.path.join(LOGGER_DIR, "media")
LOG_FILE = os.path.join(LOGGER_DIR, "generation_logs.json")

# Create directories if they don't exist
os.makedirs(LOGGER_DIR, exist_ok=True)
os.makedirs(MEDIA_DIR, exist_ok=True)

# Initialize log file if it doesn't exist
if not os.path.exists(LOG_FILE):
    with open(LOG_FILE, 'w') as f:
        json.dump([], f)


class GenerationLog(BaseModel):
    timestamp: str
    designPrompt: str
    figmaDOM: Dict[str, Any]
    descriptionAPI: Optional[Dict[str, Any]] = None
    generationAPI: Optional[Dict[str, Any]] = None
    screenshots: Dict[str, Optional[str]]


@app.get("/")
async def root():
    return {"message": "Figma Plugin Logger Server", "status": "running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/log")
async def log_generation(log: GenerationLog):
    """
    Receive and save a generation log from the Figma plugin
    """
    try:
        # Create a sanitized timestamp for filenames
        timestamp_safe = log.timestamp.replace(":", "-").replace(".", "-").replace("T", "_")[:19]
        
        # Save screenshots if provided
        screenshot_paths = {
            "before": None,
            "after": None
        }
        
        if log.screenshots.get("before"):
            before_path = os.path.join(MEDIA_DIR, f"{timestamp_safe}-before.png")
            # Extract base64 data and save
            base64_data = log.screenshots["before"].split(",")[1] if "," in log.screenshots["before"] else log.screenshots["before"]
            image_bytes = base64.b64decode(base64_data)
            with open(before_path, "wb") as f:
                f.write(image_bytes)
            screenshot_paths["before"] = f"media/{timestamp_safe}-before.png"
        
        if log.screenshots.get("after"):
            after_path = os.path.join(MEDIA_DIR, f"{timestamp_safe}-after.png")
            # Extract base64 data and save
            base64_data = log.screenshots["after"].split(",")[1] if "," in log.screenshots["after"] else log.screenshots["after"]
            image_bytes = base64.b64decode(base64_data)
            with open(after_path, "wb") as f:
                f.write(image_bytes)
            screenshot_paths["after"] = f"media/{timestamp_safe}-after.png"
        
        # Create log entry with file paths instead of base64
        log_entry = {
            "timestamp": log.timestamp,
            "designPrompt": log.designPrompt,
            "figmaDOM": log.figmaDOM,
            "descriptionAPI": log.descriptionAPI,
            "generationAPI": log.generationAPI,
            "screenshots": screenshot_paths
        }
        
        # Read existing logs
        with open(LOG_FILE, 'r') as f:
            logs = json.load(f)
        
        # Append new log
        logs.append(log_entry)
        
        # Write back to file
        with open(LOG_FILE, 'w') as f:
            json.dump(logs, f, indent=2)
        
        return {
            "status": "success",
            "message": "Log saved successfully",
            "logIndex": len(logs) - 1,
            "timestamp": log.timestamp
        }
    
    except Exception as e:
        print(f"Error saving log: {e}")
        raise HTTPException(status_code=500, detail=f"Error saving log: {str(e)}")


@app.get("/logs")
async def get_logs(limit: int = 100):
    """
    Get recent generation logs
    """
    try:
        with open(LOG_FILE, 'r') as f:
            logs = json.load(f)
        
        # Return most recent logs
        return {
            "total": len(logs),
            "logs": logs[-limit:]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading logs: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

