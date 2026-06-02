"""
ReproAgent Web Server — FastAPI backend for the ML Paper Reproduction Agent.

Serves the Web UI and provides REST endpoints that the frontend calls.
The agent logic lives in agent.py and is powered by the Claude API + Pi skills.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from agent import ReproductionAgent

# ── App setup ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="ReproAgent",
    description="ML Paper Reproduction Agent powered by Pi SDK",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

agent = ReproductionAgent()
BASE_DIR = Path(__file__).parent


# ── Request/Response models ───────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    source: str           # "github" | "arxiv" | "pdf_extracted"
    value: str            # GitHub URL, arXiv ID, or extracted repo URL
    branch: str = "HEAD"


class DockerfileRequest(BaseModel):
    analysis: dict
    variant: str = "cuda"   # "cuda" | "cpu"


class RisksRequest(BaseModel):
    analysis: dict
    paper_text: str = ""


class ChatRequest(BaseModel):
    message: str
    context: dict = {}


class ArxivRequest(BaseModel):
    arxiv_id: str


# ── Static file serving ───────────────────────────────────────────────────────

@app.get("/")
async def root():
    return FileResponse(BASE_DIR / "repro_agent.html")


# ── Agent API endpoints ───────────────────────────────────────────────────────

@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    """
    Run the full 5-step reproduction pipeline on a GitHub repo or arXiv paper.
    Returns the complete analysis including dependencies, Dockerfile, run
    procedure, and reproduction risks.
    """
    if not req.value.strip():
        raise HTTPException(status_code=400, detail="value is required")
    try:
        result = await agent.analyze(req.source, req.value, req.branch)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/dockerfile")
async def dockerfile(req: DockerfileRequest):
    """Generate a pinned Dockerfile from an analysis result."""
    try:
        result = await agent.generate_dockerfile(req.analysis, req.variant)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/risks")
async def risks(req: RisksRequest):
    """Detect reproduction risks using the risk-detector skill."""
    try:
        result = await agent.detect_risks(req.analysis, req.paper_text)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Chat with the agent about the current reproduction session."""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    try:
        text = await agent.chat(req.message, req.context)
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    """
    Parse an uploaded ML paper PDF and extract the GitHub repository URL.
    Uses pdfplumber for text extraction, then the agent for URL detection.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    try:
        content = await file.read()
        repo_url = await agent.extract_repo_from_pdf(content)
        if not repo_url:
            raise HTTPException(status_code=422, detail="No GitHub URL found in PDF")
        return {"repo_url": repo_url, "filename": file.filename}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/arxiv")
async def arxiv_lookup(req: ArxivRequest):
    """Look up an arXiv paper and extract the GitHub repository link."""
    try:
        from agent import mcp_arxiv_lookup
        result = await mcp_arxiv_lookup(req.arxiv_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
async def health():
    return {"status": "ok", "model": "openai/gpt-oss-20b:free", "provider": "openrouter", "skills": ["repo-analyzer", "dockerfile-generator", "risk-detector"]}


# ── Static file serving (catch-all, must be LAST) ────────────────────────────

@app.get("/{filename:path}")
async def serve_file(filename: str):
    """Serve JSX/JS/CSS files for the frontend."""
    safe_extensions = {".jsx", ".js", ".css", ".png", ".svg", ".ico"}
    path = BASE_DIR / filename
    if path.suffix in safe_extensions and path.exists():
        return FileResponse(path)
    raise HTTPException(status_code=404, detail="Not found")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=os.environ.get("DEV", "") == "1",
    )
