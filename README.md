# ReproAgent — ML Paper Reproduction Agent

> **From PDF to running container in minutes.**  
> Paste a GitHub repo or arXiv link. The agent reads the code, infers the environment, generates a pinned Dockerfile, and flags every reproduction risk before you spend a single GPU-hour.

![ReproAgent workbench screenshot](docs/screenshot.png)

---

## Project overview

ReproAgent is an AI Agent web service built with **Pi SDK** for the Research Paper Reproduction scenario. It tackles the ML reproducibility crisis: most papers include code, but reproducing results still requires hours of debugging CUDA mismatches, missing scripts, and undisclosed hyperparameters.

ReproAgent automates this with a 5-step pipeline:

```
Repo Analysis → Dependency Resolution → Dockerfile Generation → Run Script → Risk Verification
```

---

## Features

| Feature | Description |
|---|---|
| **3 input sources** | Paper PDF (drag & drop), GitHub URL, arXiv / DOI link |
| **Repo analyzer** | Parses README, requirements.txt, file tree, entry points, hyperparameters |
| **Dockerfile generator** | Pins CUDA base image, PyTorch wheel, injects determinism env vars |
| **Risk detector** | Flags CUDA mismatch, missing seeds, undisclosed hyperparameters (high/medium/low) |
| **Session branches** | Manage `cuda-fix`, `cpu-fallback` variants in parallel |
| **Agent chat** | Ask the agent to verify deltas, explain risks, or regenerate the Dockerfile |
| **Web UI** | Full single-page workbench with pipeline tracker, tabs, and chat |

---

## Tech stack

| Layer | Technology |
|---|---|
| AI Agent | Claude (claude-sonnet-4-6) via Anthropic SDK |
| Agent Platform | **Pi SDK** — skills, extensions, MCP tools |
| Backend | FastAPI + uvicorn (Python) |
| Frontend | React 18 + Babel (JSX in-browser) |
| PDF parsing | pdfplumber |
| HTTP client | httpx (async) |
| GitHub data | GitHub REST API v3 |
| Paper metadata | arXiv export API |

---

## Pi / Skill / MCP / Pi Extension usage

### Pi SDK

The project is a Pi package (`package.json` with `pi` manifest). Run with:
```bash
pi install ./
pi run repro-agent
# or directly:
python server.py
```

The `/repro` slash command lets you start a reproduction session from the Pi CLI:
```
/repro github.com/lucidrains/vit-pytorch
/repro arxiv:2403.09876
```

### Skills

Three skills guide the agent through the pipeline:

| Skill | Location | Purpose |
|---|---|---|
| `repo-analyzer` | `skills/repo-analyzer/` | Parse GitHub repo, extract deps, hyperparams, env spec |
| `dockerfile-generator` | `skills/dockerfile-generator/` | Generate pinned, reproducible Dockerfile |
| `risk-detector` | `skills/risk-detector/` | Detect CUDA mismatches, missing seeds, undisclosed hyperparams |

Each skill follows the [Agent Skills specification](https://agentskills.io/specification) with a `SKILL.md`, optional `scripts/`, and `references/`.

### MCP (Model Context Protocol)

Two MCP tool functions connect the agent to external data:

| MCP Tool | Function | Data source |
|---|---|---|
| GitHub MCP | `mcp_fetch_repo()` | GitHub REST API — README, requirements, file tree |
| arXiv MCP | `mcp_arxiv_lookup()` | arXiv export API — abstract, title, repo URL |

Declared in the Pi Extension (`extensions/repro-agent.ts`) as `mcpServers`.

### Pi Extension

`extensions/repro-agent.ts` is a TypeScript Pi Extension that:
- Registers 4 tools: `repro_analyze_repo`, `repro_generate_dockerfile`, `repro_detect_risks`, `repro_arxiv_lookup`
- Registers the `/repro` slash command
- Declares GitHub and arXiv MCP server connections
- Hooks into `onLoad` to log the Web UI URL

---

## Installation

### Prerequisites

- Python 3.10+
- `ANTHROPIC_API_KEY` environment variable set
- (Optional) `GITHUB_TOKEN` for higher GitHub API rate limits

### Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/repro-agent
cd repro-agent

# Install Python dependencies
pip install -r requirements.txt

# Set API key
export ANTHROPIC_API_KEY=your-key-here
export GITHUB_TOKEN=your-token-here   # optional but recommended
```

---

## Running

```bash
python server.py
```

Then open **http://localhost:8000** in your browser.

For development with auto-reload:
```bash
DEV=1 python server.py
```

---

## Usage

1. Open http://localhost:8000
2. Choose an input method:
   - **Paper PDF** — drag & drop an arXiv/NeurIPS/ICML paper PDF
   - **GitHub URL** — paste `github.com/owner/repo`
   - **arXiv / DOI** — paste `arxiv.org/abs/2403.09876` or just `2403.09876`
3. Click **Start reproduction** — the agent runs the 5-step pipeline
4. Explore the workbench:
   - **Repo Analysis** — file tree, dependencies, hyperparameters
   - **Dockerfile** — copy-paste ready, builds clean
   - **Run Procedure** — step-by-step commands grounded in the paper
   - **Risks** — high/medium/low risks with mitigations
5. Chat with the agent for custom queries

---

## Project structure

```
repro_agent/
├── repro_agent.html          # Web UI entry point
├── data.jsx                  # Mock/fallback data
├── ui.jsx                    # Shared UI components (Icon, Btn, Tag, Panel)
├── panels.jsx                # Workbench panels (Repo, Dockerfile, Run, Risks)
├── root.jsx                  # App shell + real API integration
│
├── server.py                 # FastAPI backend
├── agent.py                  # Pi agent logic (Claude API + MCP tools)
│
├── skills/
│   ├── repo-analyzer/        # Skill: parse GitHub repositories
│   │   ├── SKILL.md
│   │   └── scripts/analyze_repo.py
│   ├── dockerfile-generator/ # Skill: generate Dockerfiles
│   │   ├── SKILL.md
│   │   └── scripts/generate_dockerfile.py
│   └── risk-detector/        # Skill: detect reproduction risks
│       ├── SKILL.md
│       └── references/risk-patterns.md
│
├── extensions/
│   └── repro-agent.ts        # Pi Extension: tools, /repro command, MCP servers
│
├── prompts/
│   └── reproduce.md          # Pi prompt template
│
├── package.json              # Pi package manifest
└── requirements.txt
```

---

## API reference

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Serve the Web UI |
| `/api/analyze` | POST | Run full 5-step pipeline |
| `/api/dockerfile` | POST | Generate Dockerfile from analysis |
| `/api/risks` | POST | Detect risks for an analysis |
| `/api/chat` | POST | Chat with the agent |
| `/api/upload-pdf` | POST | Parse PDF and extract repo URL |
| `/api/arxiv` | POST | Look up arXiv paper |
| `/api/health` | GET | Health check |

---

## Limitations and future work

- **Private repos**: GitHub API returns 404; requires token with repo scope
- **Non-Python repos**: currently optimized for PyTorch/Python; Julia/C++ support planned
- **PDF extraction accuracy**: depends on PDF text layer quality; scanned PDFs not supported
- **FLOP estimation**: GPU-hours estimate is heuristic, not computed from model size
- **Live Docker build**: currently read-only; future version would build and stream logs
- **Multi-GPU configs**: single-node only; distributed training configs not parsed

---

## License

MIT
