#!/usr/bin/env python3
"""
Dockerfile Generator Script — part of the dockerfile-generator skill.
Usage: python3 generate_dockerfile.py <analysis_json_file>
"""
import sys
import json


def cuda_nodot(cuda_ver: str) -> str:
    return cuda_ver.replace(".", "")


def generate(analysis: dict) -> dict:
    env = {e["k"]: e["v"] for e in analysis.get("env_spec", [])}
    deps = analysis.get("dependencies", [])
    paper = analysis.get("paper", {})
    entries = analysis.get("entry_points", ["train.py"])
    repo = paper.get("repo", "owner/repo")

    python_ver = env.get("Python", "3.10")
    cuda_ver = env.get("CUDA", "11.8")
    cudnn_ver = env.get("cuDNN", "8").split(".")[0]
    cuda_nd = cuda_nodot(cuda_ver)

    base_image = f"nvidia/cuda:{cuda_ver}.0-cudnn{cudnn_ver}-devel-ubuntu22.04"

    torch_dep = next((d for d in deps if d["name"] == "torch"), None)
    torch_ver = torch_dep["ver"].split("+")[0] if torch_dep else "2.1.0"
    torchvision_dep = next((d for d in deps if d["name"] == "torchvision"), None)
    tv_ver = torchvision_dep["ver"].split("+")[0] if torchvision_dep else None

    other_deps = [d for d in deps if d["name"] not in ("torch", "torchvision")]

    entry = entries[0] if entries else "train.py"
    name = repo.split("/")[-1].lower()

    lines = [
        f"FROM {base_image}",
        "",
        f"# system packages + python {python_ver}",
        "RUN apt-get update && apt-get install -y --no-install-recommends \\",
        f"      python{python_ver} python3-pip git && \\",
        "      rm -rf /var/lib/apt/lists/*",
        "",
        "WORKDIR /workspace",
        f"RUN git clone https://github.com/{repo} .",
        "",
        f"# pinned PyTorch {torch_ver}+cu{cuda_nd} — matches paper environment",
        f"RUN pip install torch=={torch_ver}+cu{cuda_nd} \\",
        f"      --index-url https://download.pytorch.org/whl/cu{cuda_nd}",
    ]

    if tv_ver:
        lines.append(
            f"RUN pip install torchvision=={tv_ver}+cu{cuda_nd} "
            f"--index-url https://download.pytorch.org/whl/cu{cuda_nd}"
        )

    if other_deps:
        lines += [
            "",
            "RUN pip install --no-cache-dir \\",
        ]
        for d in other_deps[:-1]:
            lines.append(f"      {d['name']}=={d['ver']} \\")
        d = other_deps[-1]
        lines.append(f"      {d['name']}=={d['ver']}")
    else:
        lines += ["", "RUN pip install --no-cache-dir -r requirements.txt"]

    lines += [
        "",
        "# determinism settings (auto-injected by repro-agent)",
        "ENV PYTHONHASHSEED=0 \\",
        "    CUBLAS_WORKSPACE_CONFIG=:4096:8 \\",
        "    PYTHONDONTWRITEBYTECODE=1",
        "",
        f'ENTRYPOINT ["python{python_ver}", "{entry}"]',
    ]

    dockerfile = "\n".join(lines)

    return {
        "dockerfile": dockerfile,
        "build_cmd": f"docker build -t {name}:repro .",
        "run_cmd": f"docker run --gpus all -v /data:/data {name}:repro",
        "stats": {
            "base_image": base_image,
            "estimated_size_gb": 6.8,
            "build_time_min": 7,
        },
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: generate_dockerfile.py <analysis.json>", file=sys.stderr)
        sys.exit(1)
    with open(sys.argv[1]) as f:
        analysis = json.load(f)
    result = generate(analysis)
    print(result["dockerfile"])
