"""
ReproAgent Web Server — FastAPI backend for the ML Paper Reproduction Agent.

Serves the Web UI and provides REST endpoints that the frontend calls.
The agent logic lives in agent.py and is powered by the Claude API + Pi skills.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

# Load .env before importing agent (agent reads API key at import time)
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

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


# ── Hardware recommendations ─────────────────────────────────────────────────

def _compute_hardware_recs(result: dict, deps: list, env: dict) -> dict:
    gpu_model = env.get("GPU", "")
    has_torch = any(d["name"] == "torch" for d in deps)
    has_tf = any(d["name"] in ("tensorflow", "tf-nightly") for d in deps)
    needs_gpu = has_torch or has_tf

    # Estimate VRAM from paper-reported GPU
    vram = 8
    if "80" in gpu_model: vram = 80
    elif "40gb" in gpu_model.lower() or "A100 40" in gpu_model: vram = 40
    elif "24" in gpu_model or "3090" in gpu_model or "4090" in gpu_model: vram = 24
    elif "16" in gpu_model or "V100" in gpu_model: vram = 16
    elif "11" in gpu_model or "2080" in gpu_model: vram = 11

    min_ram = 64 if vram >= 40 else 32 if vram >= 16 else 16
    min_storage = 200 if vram >= 40 else 80 if needs_gpu else 10
    est_hours = round(vram * 0.5) if needs_gpu else 0

    # Per-setup options: { label, feasible, notes, steps }
    setups = {
        "no_gpu": {
            "feasible": not needs_gpu,
            "verdict": "Works fine" if not needs_gpu else "Not feasible",
            "notes": "No GPU needed — runs on any laptop." if not needs_gpu
                     else f"This repo requires a GPU ({vram}GB VRAM). CPU training would take days.",
            "steps": [
                "Build the Docker image: docker build -t repo:repro .",
                "Run: bash reproduce.sh",
            ] if not needs_gpu else [
                "Use a cloud GPU instead (see options below).",
            ],
        },
        "consumer_gpu": {
            "feasible": needs_gpu and vram <= 24,
            "verdict": "Works" if vram <= 16 else "May need batch size reduction" if vram <= 24 else "Not enough VRAM",
            "notes": (
                f"RTX 3090/4090 (24GB) can handle this." if vram <= 24
                else f"Needs {vram}GB VRAM — consumer GPUs top out at 24GB."
            ),
            "steps": [
                f"Ensure you have {vram}GB+ VRAM GPU.",
                "Install NVIDIA drivers + Docker with GPU support.",
                "Run: bash reproduce.sh",
            ] if vram <= 24 else [
                "Reduce batch size in the config file to fit in 24GB.",
                "Note: smaller batch may shift accuracy results slightly.",
                "Run: bash reproduce.sh",
            ],
        },
        "cloud": {
            "feasible": True,
            "verdict": "Recommended",
            "notes": "Pay-per-hour cloud GPU — no hardware needed.",
            "options": [
                {"name": "Google Colab Pro+", "vram": "40GB A100", "cost": "$50/mo", "link": "https://colab.research.google.com"},
                {"name": "RunPod", "vram": "80GB A100", "cost": "~$2.50/hr", "link": "https://runpod.io"},
                {"name": "Lambda Labs", "vram": "80GB A100", "cost": "~$1.10/hr", "link": "https://lambdalabs.com"},
                {"name": "Google Cloud (GCP)", "vram": "40–80GB", "cost": "~$3.00/hr", "link": "https://cloud.google.com"},
            ],
            "steps": [
                "Upload Dockerfile + reproduce.sh to your cloud instance.",
                f"Estimated run time: ~{est_hours}h on A100." if est_hours else "Run: bash reproduce.sh",
                "Download results when done.",
            ],
        },
        "pro_gpu": {
            "feasible": needs_gpu,
            "verdict": "Full reproduction",
            "notes": f"An A100 80GB matches the paper environment exactly." if vram >= 40
                     else f"Any modern GPU with {vram}GB+ VRAM works.",
            "steps": [
                "Install NVIDIA drivers + Docker with GPU support.",
                "Run: bash reproduce.sh",
                f"Expected: ~{est_hours}h training time." if est_hours else "",
            ],
        },
    }

    return {
        "needs_gpu": needs_gpu,
        "min_vram_gb": vram if needs_gpu else 0,
        "min_ram_gb": min_ram,
        "min_storage_gb": min_storage,
        "est_train_hours": est_hours,
        "paper_gpu": gpu_model or "not specified",
        "setups": setups,
    }


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
    return FileResponse(BASE_DIR / "repro_agent.html", headers={"Cache-Control": "no-store"})


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

        # Detect if repo needs GPU (no CUDA = cpu variant)
        env = {e["k"]: e["v"] for e in result.get("env_spec", [])}
        deps = result.get("dependencies", [])
        cuda = env.get("CUDA", "")
        import re as _re
        if not _re.match(r'^\d+\.\d+', cuda):
            variant = "cpu"
        else:
            variant = "cuda"

        # Generate the actual reproduction files
        dockerfile_result = await agent.generate_dockerfile(result, variant)
        risks = await agent.detect_risks(result)

        repo = result.get("paper", {}).get("repo", "owner/repo")
        name = repo.split("/")[-1]
        deps = result.get("dependencies", [])
        import re as _re2
        _ver_pat2 = _re2.compile(r'^\d[\d.]*(\+\w+)?$')
        _na_vers = {"", "n/a", "none", "null", "unknown", "N/A"}
        _skip = {"torch", "torchvision"}  # need special index URLs, not pip-installable directly
        pinned_lines = [f"# Pinned for {name} reproduction"]
        pinned_deps = [
            f"{d['name']}=={d['ver']}" for d in deps
            if d["name"] not in _skip
            and d.get("ver", "") not in _na_vers
            and _ver_pat2.match(d.get("ver", ""))
        ]
        if pinned_deps:
            pinned_lines += pinned_deps
        else:
            pinned_lines += ["# No versions pinned — install from requirements.txt in the repo"]

        run_cmd = dockerfile_result.get("run_cmd", f"docker run {name}:repro")
        build_cmd = dockerfile_result.get("build_cmd", f"docker build -t {name}:repro .")

        reproduce_sh = "\n".join([
            "#!/bin/bash",
            f"# Reproduction script for {repo}",
            "# Generated by repro-agent",
            "# Usage: place all downloaded files in a folder, then: bash reproduce.sh",
            "set -euo pipefail",
            "",
            f'echo "==> Cloning repository..."',
            "rm -rf _repo_src",
            f"git clone https://github.com/{repo} _repo_src",
            "",
            f'echo "==> Copying Dockerfile into repo..."',
            "cp Dockerfile _repo_src/",
            "cd _repo_src",
            "",
            f'echo "==> Building Docker image..."',
            build_cmd,
            "",
            f'echo "==> Running reproduction..."',
            run_cmd,
        ])

        notes_risks = "\n".join(
            f"### {'⚠' if r['sev']=='high' else '◆'} {r['sev'].upper()} — {r['name']}\n{r['desc']}\n**Fix applied**: {r.get('fix','See Dockerfile.')}\n"
            for r in risks
        ) or "_No significant risks detected._"

        _na_vals = {"", "n/a", "none", "null", "unknown", "N/A"}
        env_table = "\n".join(
            f"| {e['k']} | {e['v'] if e.get('v','') not in _na_vals else '—'} |"
            for e in result.get("env_spec", [])
        )

        repro_notes = f"""# Reproduction Notes
## {repo}

---

## Environment

| Component | Version |
|-----------|---------|
{env_table}

---

## Reproduction risks

{notes_risks}

## How to run

```bash
bash reproduce.sh
```
"""

        result["hardware_recs"] = _compute_hardware_recs(result, deps, env)
        result["files"] = {
            "Dockerfile": dockerfile_result["dockerfile"],
            "reproduce.sh": reproduce_sh,
            "requirements-pinned.txt": "\n".join(pinned_lines),
            "REPRO_NOTES.md": repro_notes,
        }
        result["risks"] = risks
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
        return FileResponse(path, headers={"Cache-Control": "no-store"})
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
