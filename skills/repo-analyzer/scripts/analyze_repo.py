#!/usr/bin/env python3
"""
Repo Analyzer Script — part of the repo-analyzer skill.
Usage: python3 analyze_repo.py <github_url_or_owner/repo>
"""
import sys
import json
import re
import base64
import os
import httpx

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
HEADERS = {"Authorization": f"Bearer {GITHUB_TOKEN}"} if GITHUB_TOKEN else {}


def normalize_repo(url: str) -> str:
    url = re.sub(r"https?://", "", url).strip("/")
    if url.startswith("github.com/"):
        url = url[len("github.com/"):]
    parts = url.split("/")
    return f"{parts[0]}/{parts[1]}"


def fetch(url: str) -> dict | str | None:
    try:
        r = httpx.get(url, headers=HEADERS, timeout=15, follow_redirects=True)
        if r.status_code == 200:
            ct = r.headers.get("content-type", "")
            return r.json() if "json" in ct else r.text
    except Exception:
        pass
    return None


def decode_github_file(repo: str, path: str) -> str:
    data = fetch(f"https://api.github.com/repos/{repo}/contents/{path}")
    if isinstance(data, dict) and "content" in data:
        return base64.b64decode(data["content"]).decode("utf-8", errors="ignore")
    return ""


def analyze(repo_slug: str) -> dict:
    repo_info = fetch(f"https://api.github.com/repos/{repo_slug}") or {}
    readme = decode_github_file(repo_slug, "README.md") or decode_github_file(repo_slug, "README.rst")
    requirements = decode_github_file(repo_slug, "requirements.txt")
    setup_py = decode_github_file(repo_slug, "setup.py")
    env_yml = decode_github_file(repo_slug, "environment.yml")

    tree_data = fetch(f"https://api.github.com/repos/{repo_slug}/git/trees/HEAD?recursive=1")
    all_paths = [item["path"] for item in (tree_data or {}).get("tree", [])[:100]]

    # Entry points
    entry_patterns = re.compile(r"^(train|main|run|eval|test)\.py$", re.IGNORECASE)
    entries = [p for p in all_paths if entry_patterns.match(p.split("/")[-1])]

    # Config files
    config_paths = [p for p in all_paths if p.endswith((".yaml", ".yml", ".json")) and "config" in p.lower()]

    # Dependency extraction
    deps = []
    if requirements:
        for line in requirements.strip().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            m = re.match(r"([a-zA-Z0-9_.-]+)[>=<~!]+([\w.+]+)", line)
            if m:
                deps.append({"name": m.group(1), "ver": m.group(2), "inferred": False})
            else:
                deps.append({"name": line, "ver": "latest", "inferred": True})

    # Infer CUDA version from torch wheel string
    cuda_ver = "11.8"
    for dep in deps:
        if dep["name"] == "torch":
            m = re.search(r"\+cu(\d+)", dep["ver"])
            if m:
                cuda_ver = m.group(1)[:2] + "." + m.group(1)[2:]
                break

    # Python version inference
    python_ver = "3.10"
    m = re.search(r"python_requires['\"]?\s*[=><]+\s*['\"]([0-9.]+)", setup_py)
    if m:
        python_ver = m.group(1)

    # Build file tree for UI
    seen_dirs: set[str] = set()
    file_tree = []
    for path in all_paths[:30]:
        parts = path.split("/")
        for i in range(len(parts) - 1):
            d = "/".join(parts[:i + 1])
            if d not in seen_dirs:
                seen_dirs.add(d)
                file_tree.append({"t": "dir", "txt": parts[i] + "/", "indent": i})
        fname = parts[-1]
        indent = len(parts) - 1
        t = "entry" if fname in [e.split("/")[-1] for e in entries] else "file"
        tag = "entry" if t == "entry" else None
        file_tree.append({"t": t, "txt": fname, "indent": indent, "tag": tag})

    # Stars formatting
    stars = repo_info.get("stargazers_count", 0)
    stars_str = f"{stars/1000:.1f}k" if stars >= 1000 else str(stars)

    return {
        "paper": {
            "title": repo_info.get("description") or repo_slug.split("/")[1].replace("-", " ").title(),
            "authors": "",
            "venue": "",
            "arxiv": "",
            "repo": repo_slug,
            "stars": stars_str,
            "headline": "",
        },
        "dependencies": deps[:12],
        "env_spec": [
            {"k": "Python", "v": python_ver, "infer": False},
            {"k": "CUDA", "v": cuda_ver, "infer": True},
            {"k": "cuDNN", "v": "8.9", "infer": True},
            {"k": "OS", "v": "Ubuntu 22.04", "infer": True},
        ],
        "file_tree": file_tree[:20],
        "entry_points": entries,
        "config_paths": config_paths[:5],
        "readme_excerpt": readme[:2000],
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: analyze_repo.py <github_url_or_owner/repo>", file=sys.stderr)
        sys.exit(1)
    repo = normalize_repo(sys.argv[1])
    result = analyze(repo)
    print(json.dumps(result, indent=2))
