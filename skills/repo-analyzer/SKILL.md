---
name: repo-analyzer
description: Analyze a GitHub ML paper repository. Parse README, requirements.txt, setup.py, and source files to extract dependencies, entry points, hyperparameters, and environment specifications. Use when the user provides a GitHub URL or asks to analyze a repository for reproduction.
license: MIT
compatibility: Requires internet access to reach GitHub API. Works best with Claude Sonnet or higher.
metadata:
  author: repro-agent
  version: "1.0"
  domain: ml-reproducibility
allowed-tools: Bash(curl:*) Bash(python3:*) Read WebFetch
---

# Repo Analyzer Skill

Analyzes a GitHub repository to extract all information needed to reproduce an ML paper experiment.

## When to activate

- User provides a GitHub URL (`github.com/owner/repo`)
- User asks "analyze this repo" or "what do I need to run this"
- Called as part of the 5-step reproduction pipeline (step 1: Repo Analysis)

## Analysis pipeline

### Step 1 — Fetch repository metadata

Use the GitHub API to retrieve:
- Repository description and star count
- Default branch name
- Last commit date (freshness signal)

```bash
curl -s "https://api.github.com/repos/{owner}/{repo}" \
  -H "Authorization: Bearer $GITHUB_TOKEN"
```

### Step 2 — Parse key files

Fetch and parse in order of priority:

1. `README.md` / `README.rst` — extract paper title, venue, metrics, install instructions
2. `requirements.txt` — direct dependency list
3. `setup.py` / `pyproject.toml` — package dependencies and Python version constraints
4. `environment.yml` — conda environment (overrides requirements.txt for CUDA/cuDNN)
5. `Dockerfile` (if present) — most reliable environment source; skip inference if found

### Step 3 — Extract entry points

Scan for common ML training/eval script patterns:
- `train.py`, `main.py`, `run.py`, `eval.py`
- Files containing `argparse.ArgumentParser` or `@hydra.main`
- Shell scripts in `scripts/` that invoke Python

### Step 4 — Extract hyperparameters

Search in order:
1. YAML/JSON config files (`configs/`, `config/`, `*.yaml`, `*.json`)
2. Default values in `argparse` definitions
3. Paper text (requires PDF or arXiv abstract)

Flag as **missing** if a hyperparameter appears in the paper but cannot be found in the code.

### Step 5 — Infer environment

Build the environment spec from gathered evidence:

| Field | Source priority |
|-------|----------------|
| Python version | `setup.py` → `pyproject.toml` → README → infer from torch version |
| CUDA version | `requirements.txt` wheel suffix → `environment.yml` → README → paper |
| PyTorch version | `requirements.txt` → `setup.py` → infer from CUDA |
| GPU type | Paper §4 (experiments) → README → default A100 |

Mark inferred values with `infer: true` in the output.

## Output format

Return a structured JSON object:

```json
{
  "paper": { "title": "...", "venue": "...", "arxiv": "...", "stars": "1.4k" },
  "dependencies": [{ "name": "torch", "ver": "2.1.0", "inferred": false }],
  "hyperparams": [{ "name": "lr", "val": "3e-4", "src": "config" }],
  "env_spec": [{ "k": "Python", "v": "3.10", "infer": false }],
  "file_tree": [{ "t": "entry", "txt": "train.py", "indent": 1 }]
}
```

## Common issues

- **Private repos**: API returns 404 — ask user to check repo visibility
- **Monorepos**: look for `paper/` or `experiments/` subdirectory
- **No requirements.txt**: fall back to `pip freeze` output in README, or parse imports from scripts
- **Missing preprocess scripts**: note as risk; reconstruct from paper §3 (data section)

See [scripts/analyze_repo.py](scripts/analyze_repo.py) for the executable implementation.
