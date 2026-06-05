---
name: dockerfile-generator
description: Generate a reproducible Dockerfile for an ML paper repository. Takes environment spec and dependencies, selects the correct CUDA base image, pins all versions, and injects determinism settings. Use when the user asks to generate a Dockerfile or after repo-analyzer has completed step 2.
license: MIT
compatibility: Requires Docker knowledge. Output is designed for NVIDIA GPU environments. Produces CPU-fallback variant on request.
metadata:
  author: repro-agent
  version: "1.0"
  domain: ml-reproducibility
allowed-tools: Bash(docker:*) Read
---

# Dockerfile Generator Skill

Generates a pinned, reproducible Dockerfile from the environment specification produced by `repo-analyzer`.

## When to activate

- User says "generate Dockerfile", "create Docker image", "containerize this"
- Pipeline step 3 (Dockerfile) is reached
- User asks for a CPU-only fallback variant

## Base image selection

| Condition | Base image |
|-----------|-----------|
| CUDA + cuDNN + devel (training) | `nvidia/cuda:{cuda}-cudnn{cudnn}-devel-ubuntu22.04` |
| CUDA + runtime only (inference) | `nvidia/cuda:{cuda}-cudnn{cudnn}-runtime-ubuntu22.04` |
| CPU only | `python:{python}-slim-bookworm` |
| Conda environment | `continuumio/miniconda3:latest` |

Always prefer the **smallest image tier** that satisfies the training requirements.

## Pinning rules

1. **PyTorch**: always install from the official wheel index matching the CUDA version:
   ```
   pip install torch=={ver}+cu{cuda_nodot} \
     --index-url https://download.pytorch.org/whl/cu{cuda_nodot}
   ```
2. **Other packages**: install from `requirements.txt` as-is; add `--no-cache-dir`
3. **System packages**: pin `apt-get install -y --no-install-recommends`
4. **Python**: use `python3.{minor}` explicitly, not `python3`

## Determinism injections

Always add these ENV vars unless the repo already sets them:

```dockerfile
ENV PYTHONHASHSEED=0 \
    CUBLAS_WORKSPACE_CONFIG=:4096:8 \
    PYTHONDONTWRITEBYTECODE=1
```

If `torch.manual_seed` is absent from the codebase, add a comment noting the seed risk.

## Layer ordering (cache optimization)

```dockerfile
FROM ...                    # 1. base image
RUN apt-get install ...     # 2. system packages (rarely changes)
WORKDIR /workspace
RUN git clone ... .         # 3. source code
RUN pip install torch ...   # 4. heavy deps (PyTorch)
RUN pip install -r req.txt  # 5. project deps
ENV PYTHONHASHSEED=0 ...    # 6. determinism settings
ENTRYPOINT [...]            # 7. entry point
```

## Output structure

```json
{
  "dockerfile": "FROM nvidia/cuda:...\n...",
  "build_cmd": "docker build -t {name}:repro .",
  "run_cmd": "docker run --gpus all -v /data:/data {name}:repro",
  "stats": {
    "base_image": "cuda:11.8.0-cudnn8-devel-ubuntu22.04",
    "estimated_size_gb": 6.8,
    "build_time_min": 7
  }
}
```

## Variants

### CPU fallback

When the user asks for a CPU-only variant:
- Replace base image with `python:3.10-slim-bookworm`
- Replace torch wheel URL with CPU variant: `https://download.pytorch.org/whl/cpu`
- Add `--device=cpu` to ENTRYPOINT if supported by the script

### Conda environment

If `environment.yml` is present and contains CUDA packages:
```dockerfile
FROM continuumio/miniconda3:latest
COPY environment.yml .
RUN conda env create -f environment.yml && conda clean -afy
SHELL ["conda", "run", "-n", "{env_name}", "/bin/bash", "-c"]
```

See [scripts/generate_dockerfile.py](scripts/generate_dockerfile.py) for the executable.
