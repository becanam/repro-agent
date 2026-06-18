"""
ReproductionAgent — Pi-powered ML paper reproduction agent.

Uses OpenRouter API with openai/gpt-oss-20b:free as the underlying LLM, with MCP
tools for GitHub and arXiv access. Skills (repo-analyzer, dockerfile-generator,
risk-detector) guide the agent's behavior at each pipeline step.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
from typing import Optional

from openai import OpenAI
import httpx

MODEL = "openai/gpt-oss-20b:free"
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_HEADERS = {"Authorization": f"Bearer {GITHUB_TOKEN}"} if GITHUB_TOKEN else {}

_client = OpenAI(
    api_key=OPENROUTER_API_KEY or "sk-placeholder",
    base_url="https://openrouter.ai/api/v1",
)


# ── Utility helpers ──────────────────────────────────────────────────────────

def normalize_repo(url: str) -> str:
    url = re.sub(r"https?://", "", url).strip("/")
    if url.startswith("github.com/"):
        url = url[len("github.com/"):]
    parts = url.split("/")
    return f"{parts[0]}/{parts[1]}"


def stars_fmt(n: int) -> str:
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


async def github_get(path: str) -> dict | list | None:
    url = f"https://api.github.com/{path}"
    async with httpx.AsyncClient(headers=GITHUB_HEADERS, timeout=20) as c:
        r = await c.get(url)
        return r.json() if r.status_code == 200 else None


async def github_raw(repo: str, path: str, branch: str = "HEAD") -> str:
    for b in (branch, "main", "master"):
        url = f"https://raw.githubusercontent.com/{repo}/{b}/{path}"
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url)
            if r.status_code == 200:
                return r.text
    return ""


# ── MCP tool implementations (exposed via the Pi Extension) ──────────────────

async def mcp_fetch_repo(repo: str, branch: str = "HEAD") -> dict:
    """GitHub MCP tool: fetch repo metadata + key files."""
    info = await github_get(f"repos/{repo}") or {}

    readme = (
        await github_raw(repo, "README.md", branch)
        or await github_raw(repo, "README.rst", branch)
    )
    requirements = await github_raw(repo, "requirements.txt", branch)
    setup_py = await github_raw(repo, "setup.py", branch)
    env_yml = await github_raw(repo, "environment.yml", branch)

    tree_data = await github_get(f"repos/{repo}/git/trees/{branch}?recursive=1") or {}
    all_paths = [item["path"] for item in tree_data.get("tree", [])[:150]
                 if item.get("type") == "blob"]

    return {
        "repo": repo,
        "stars": info.get("stargazers_count", 0),
        "description": info.get("description", ""),
        "default_branch": info.get("default_branch", "main"),
        "readme": readme[:6000],
        "requirements": requirements[:2000],
        "setup_py": setup_py[:1500],
        "env_yml": env_yml[:1500],
        "all_paths": all_paths,
    }


async def mcp_arxiv_lookup(arxiv_id: str) -> dict:
    """arXiv MCP tool: fetch abstract and extract repo link."""
    arxiv_id = re.sub(r".*abs/", "", arxiv_id).strip()
    m = re.search(r"(\d{4}\.\d{4,5})", arxiv_id)
    if m:
        arxiv_id = m.group(1)

    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"https://export.arxiv.org/abs/{arxiv_id}", follow_redirects=True)
        html = r.text if r.status_code == 200 else ""

    # Extract GitHub URLs directly from HTML
    urls = re.findall(r"github\.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+", html)
    repo_url = f"https://{urls[0]}" if urls else None

    # Also grab title and authors from meta tags
    title_m = re.search(r'<title>(.*?)</title>', html, re.DOTALL)
    title = re.sub(r'\s+', ' ', title_m.group(1)).strip() if title_m else ""
    title = re.sub(r'^\[.*?\]\s*', '', title).replace(" | arXiv", "")

    abstract_m = re.search(r'class="abstract[^"]*"[^>]*>(.*?)</blockquote>', html, re.DOTALL)
    abstract = re.sub(r'<[^>]+>', '', abstract_m.group(1) if abstract_m else "").strip()

    return {
        "arxiv_id": arxiv_id,
        "title": title,
        "abstract": abstract[:1000],
        "repo_url": repo_url,
    }


# ── Core agent ───────────────────────────────────────────────────────────────

class ReproductionAgent:
    """
    Pi-based agent for ML paper reproduction.

    Skills used:
      - repo-analyzer      → parse GitHub repo
      - dockerfile-generator → generate Dockerfile
      - risk-detector      → identify reproduction risks

    MCP tools:
      - github MCP         → mcp_fetch_repo()
      - arxiv MCP          → mcp_arxiv_lookup()
    """

    def __init__(self) -> None:
        self._sessions: dict[str, dict] = {}

    async def _llm(self, messages: list[dict], max_tokens: int = 1024, system: str = "") -> str:
        """Call OpenRouter in a thread so it doesn't block the async event loop."""
        if system:
            messages = [{"role": "system", "content": system}] + messages
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: _client.chat.completions.create(model=MODEL, max_tokens=max_tokens, messages=messages),
        )
        return resp.choices[0].message.content or ""

    # ── Public API ───────────────────────────────────────────────────────────

    async def analyze(self, source: str, value: str, branch: str = "HEAD") -> dict:
        """
        Full 5-step reproduction pipeline.
        source: "github" | "arxiv" | "pdf_extracted"
        value:  GitHub URL/slug, arXiv ID, or extracted repo URL
        """
        arxiv_data: dict = {}

        # Step 1: resolve repo URL
        if source == "arxiv":
            arxiv_data = await mcp_arxiv_lookup(value)
            if not arxiv_data.get("repo_url"):
                arxiv_data["repo_url"] = await self._llm_find_repo(arxiv_data["abstract"])
            repo_slug = normalize_repo(arxiv_data["repo_url"] or value)
        else:
            repo_slug = normalize_repo(value)

        # Step 2: fetch repo data (repo-analyzer MCP tool)
        repo_data = await mcp_fetch_repo(repo_slug, branch)

        # Steps 3–5: LLM analysis
        result = await self._llm_analyze(repo_slug, repo_data, arxiv_data)

        # Cache session context
        session_id = repo_slug.replace("/", "_")
        self._sessions[session_id] = {
            "repo": repo_slug,
            "analysis": result,
            "repo_data": repo_data,
        }

        return result

    async def generate_dockerfile(self, analysis: dict, variant: str = "cuda") -> dict:
        """Generate Dockerfile from analysis using dockerfile-generator skill."""
        env = {e["k"]: e["v"] for e in analysis.get("env_spec", [])}
        deps = analysis.get("dependencies", [])
        paper = analysis.get("paper", {})
        repo = paper.get("repo", "owner/repo")

        _na = {"", "n/a", "none", "null", "unknown", "N/A"}
        python_ver = env.get("Python", "") or "3.10"
        if python_ver.lower() in _na:
            python_ver = "3.10"
        cuda_ver = env.get("CUDA", "") or ""
        if not re.match(r'^\d+\.\d+', cuda_ver):
            cuda_ver = "11.8"
        cudnn_raw = (env.get("cuDNN", "8") or "8").split(".")[0]
        cudnn = cudnn_raw if cudnn_raw.isdigit() else "8"
        cuda_nd = cuda_ver.replace(".", "")

        _na = ("", "n/a", "none", "null", "N/A")
        torch_dep = next((d for d in deps if d["name"] == "torch" and d.get("ver", "") not in _na), None)
        torch_ver = torch_dep["ver"].split("+")[0] if torch_dep else None
        tv_dep = next((d for d in deps if d["name"] == "torchvision" and d.get("ver", "") not in _na), None)
        tv_ver = tv_dep["ver"].split("+")[0] if tv_dep else None
        other_deps = [d for d in deps if d["name"] not in ("torch", "torchvision")]

        entries = analysis.get("entry_points", ["train.py"])
        entry = entries[0] if entries else "train.py"
        name = repo.split("/")[-1].lower()

        file_txts = " ".join(n.get("txt", "") for n in analysis.get("file_tree", []))
        has_req_file = "requirements.txt" in file_txts

        if variant == "cpu":
            base = f"python:{python_ver}-slim-bookworm"
            # CPU whl index uses plain version numbers (no +cpu) for torch < 2.6
            torch_install = (
                f"RUN pip install torch=={torch_ver} \\\n"
                f"      --index-url https://download.pytorch.org/whl/cpu"
            ) if torch_ver else None
        else:
            # use devel only when the repo compiles custom CUDA extensions
            cuda_layer = "devel" if ".cu" in file_txts else "runtime"
            base = f"nvidia/cuda:{cuda_ver}.0-cudnn{cudnn}-{cuda_layer}-ubuntu22.04"
            torch_install = (
                f"RUN pip install torch=={torch_ver}+cu{cuda_nd} \\\n"
                f"      --index-url https://download.pytorch.org/whl/cu{cuda_nd}"
            ) if torch_ver else None

        # python:X.Y-slim images already have Python installed — only need git + pip
        # nvidia/cuda images need python to be installed explicitly
        dep_names = {d["name"].lower() for d in deps}
        extra_apt = []
        if "tkinter" in dep_names or "tk" in dep_names:
            extra_apt.append("python3-tk")
        if any(n in dep_names for n in ("cv2", "opencv-python", "opencv-python-headless")):
            extra_apt.append("libgl1 libglib2.0-0")

        if variant == "cpu":
            apt_pkgs = "python3-pip git" + (" " + " ".join(extra_apt) if extra_apt else "")
            py_cmd = "python3"
        else:
            apt_pkgs = f"python{python_ver} python3-pip git" + (" " + " ".join(extra_apt) if extra_apt else "")
            py_cmd = f"python{python_ver}"

        lines = [
            f"FROM {base}",
            "",
            f"# system packages",
            "RUN apt-get update && apt-get install -y --no-install-recommends \\",
            f"      {apt_pkgs} && \\",
            "      rm -rf /var/lib/apt/lists/*",
            "",
            "WORKDIR /workspace",
            "COPY . .",
            "",
        ]

        if torch_install:
            lines.append(torch_install)

        if tv_ver:
            if variant == "cpu":
                lines.append(
                    f"RUN pip install torchvision=={tv_ver} "
                    f"--index-url https://download.pytorch.org/whl/cpu"
                )
            else:
                lines.append(
                    f"RUN pip install torchvision=={tv_ver}+cu{cuda_nd} "
                    f"--index-url https://download.pytorch.org/whl/cu{cuda_nd}"
                )

        import re as _re
        _bad_ver = {"", "n/a", "none", "null", "N/A", "unknown", "—", "-"}
        _ver_pat = _re.compile(r'^\d[\d.]*(\+\w+)?$')
        other_deps = [d for d in deps
                      if d["name"] not in ("torch", "torchvision")
                      and d.get("ver", "") not in _bad_ver
                      and _ver_pat.match(d.get("ver", ""))]
        if other_deps:
            pkg_list = " \\\n      ".join(f"{d['name']}=={d['ver']}" for d in other_deps)
            lines.append(f"RUN pip install --no-cache-dir \\\n      {pkg_list}")
        elif has_req_file:
            lines.append("RUN pip install --no-cache-dir -r requirements.txt")

        lines += [
            "",
            "# determinism (auto-injected by repro-agent)",
            "ENV PYTHONHASHSEED=0 \\",
            "    PYTHONDONTWRITEBYTECODE=1",
            "",
            f'ENTRYPOINT ["{py_cmd}", "{entry}"]',
        ]

        dockerfile = "\n".join(lines)
        est_gb = 1.8 if variant == "cpu" else 6.8

        return {
            "dockerfile": dockerfile,
            "build_cmd": f"docker build -t {name}:repro .",
            "run_cmd": (
                f"docker run {name}:repro"
                if variant == "cpu"
                else f"docker run --gpus all {name}:repro"
            ),
            "stats": {
                "base_image": base,
                "estimated_size_gb": est_gb,
                "build_time_min": 4 if variant == "cpu" else 7,
            },
        }

    async def detect_risks(self, analysis: dict, paper_text: str = "") -> list[dict]:
        """Use risk-detector skill to identify reproduction risks."""
        prompt = f"""You are using the `risk-detector` skill to analyze this ML repository for reproduction risks.

Repository analysis:
{json.dumps(analysis, indent=2)[:3000]}

Paper text excerpt:
{paper_text[:1000] if paper_text else "(not provided)"}

Detect ALL of the following risk patterns from references/risk-patterns.md:
1. CUDA version mismatch (compare README install vs paper reported CUDA)
2. Random seed not fixed (check if manual_seed is missing from training scripts)
3. Missing warmup_steps in config
4. Missing preprocessing scripts
5. Mixed-precision mismatch (fp16 vs bf16)
6. Gradient accumulation undisclosed

Return a JSON array:
[{{"sev": "high|medium|low", "name": "...", "desc": "...", "fix": "..."}}]

Return only JSON."""
        text = self._strip_json(await self._llm([{"role": "user", "content": prompt}], max_tokens=1200))
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return []

    async def chat(self, message: str, context: dict) -> str:
        """Agent chat with full reproduction context."""
        repo = context.get("repo", "the repository")
        analysis = context.get("analysis", {})
        paper = analysis.get("paper", {})
        risks = analysis.get("risks", [])

        system = (
            f"You are a specialized ML paper reproduction agent. "
            f"You have fully analyzed the repository `{repo}` "
            f"({paper.get('title', 'ML paper')}, {paper.get('venue', '')}) "
            f"using the repo-analyzer, dockerfile-generator, and risk-detector skills.\n\n"
            f"Key facts:\n"
            f"- Dependencies: {len(analysis.get('dependencies', []))} resolved\n"
            f"- Risks: {len([r for r in risks if r.get('sev')=='high'])} high, "
            f"{len([r for r in risks if r.get('sev')=='medium'])} medium\n"
            f"- Entry point: {(analysis.get('entry_points') or ['train.py'])[0]}\n\n"
            f"Be concise and specific. Use **markdown** for emphasis and `backticks` for inline code. "
            f"Use bullet lists (- item) for multi-part answers. "
            f"Always ground answers in the actual analysis data above."
        )
        return await self._llm([{"role": "user", "content": message}], max_tokens=1024, system=system)

    async def extract_repo_from_pdf(self, pdf_bytes: bytes) -> Optional[str]:
        """Extract GitHub URL from uploaded PDF (MCP PDF tool)."""
        text = self._extract_pdf_text(pdf_bytes)
        if not text:
            return None

        urls = re.findall(r"github\.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+", text)
        if urls:
            return "https://" + urls[0]

        result = (await self._llm([{
            "role": "user",
            "content": (
                "Find the GitHub repository URL in this ML paper. "
                "Return only the URL (no explanation), or 'none':\n\n"
                + text[:3000]
            ),
        }], max_tokens=100)).strip()
        if "github.com" in result:
            return result
        return None

    # ── Private helpers ──────────────────────────────────────────────────────

    async def _llm_find_repo(self, abstract: str) -> str:
        return (await self._llm([{
            "role": "user",
            "content": (
                "Find the GitHub repository URL mentioned in this abstract. "
                "Return only the URL or 'none':\n\n" + abstract
            ),
        }], max_tokens=100)).strip()

    async def _llm_analyze(self, repo: str, repo_data: dict, arxiv_data: dict) -> dict:
        """Run full LLM analysis using all three skills."""
        prompt = f"""You are an ML reproduction agent running three skills in sequence:
1. repo-analyzer: parse the repository
2. dockerfile-generator: generate a Dockerfile
3. risk-detector: identify reproduction risks

Repository: {repo}
Stars: {stars_fmt(repo_data.get('stars', 0))}
Description: {repo_data.get('description', '')}

arXiv data: {json.dumps(arxiv_data) if arxiv_data else 'not available'}

README (first 3000 chars):
{repo_data.get('readme', '')[:3000]}

requirements.txt:
{repo_data.get('requirements', '')[:800]}

File paths (first 40):
{chr(10).join(repo_data.get('all_paths', [])[:40])}

Return a single JSON object with ALL of these fields:
{{
  "paper": {{
    "title": "...",
    "authors": "Author1, Author2, et al.",
    "venue": "NeurIPS 2024",
    "arxiv": "2403.09876",
    "repo": "{repo}",
    "stars": "{stars_fmt(repo_data.get('stars', 0))}",
    "headline": "Key result from README (e.g. Top-1 82.7% on ImageNet-1k)"
  }},
  "dependencies": [
    {{"name": "torch", "ver": "2.1.0+cu118", "inferred": false}},
    {{"name": "numpy", "ver": "1.26.x", "inferred": true}}
  ],
  "hyperparams": [
    {{"name": "optimizer", "val": "AdamW", "src": "config"}},
    {{"name": "warmup_steps", "val": "—", "src": "missing"}}
  ],
  "env_spec": [
    {{"k": "Python", "v": "3.10", "infer": false}},
    {{"k": "CUDA", "v": "11.8", "infer": true}},
    {{"k": "cuDNN", "v": "8.9", "infer": true}},
    {{"k": "PyTorch", "v": "2.1.0+cu118", "infer": false}},
    {{"k": "OS", "v": "Ubuntu 22.04", "infer": true}},
    {{"k": "GPU", "v": "A100 80GB", "infer": true}}
  ],
  "file_tree": [
    {{"t": "dir", "txt": "{repo.split('/')[1]}/", "indent": 0}},
    {{"t": "entry", "txt": "train.py", "indent": 1, "tag": "entry"}},
    {{"t": "file", "txt": "requirements.txt", "indent": 1, "tag": null}}
  ],
  "entry_points": ["train.py"],
  "run_procedure": [
    {{
      "title": "Build the image",
      "desc": "Builds the CUDA environment matching the paper.",
      "cmd": "docker build -t {repo.split('/')[1]}:repro ."
    }}
  ],
  "risks": [
    {{
      "sev": "high",
      "name": "Random seed not fixed",
      "desc": "train.py never calls torch.manual_seed; results are non-deterministic.",
      "fix": "Inject --seed 42 and PYTHONHASHSEED=0."
    }}
  ]
}}

IMPORTANT: analyze the actual README and file list above; don't make up data.
Return only valid JSON."""
        text = self._strip_json(await self._llm([{"role": "user", "content": prompt}], max_tokens=4096))
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            # Return safe fallback on parse error
            return {
                "paper": {"repo": repo, "title": repo, "stars": stars_fmt(repo_data.get("stars", 0))},
                "dependencies": [],
                "hyperparams": [],
                "env_spec": [],
                "file_tree": [],
                "entry_points": [],
                "run_procedure": [],
                "risks": [],
                "_parse_error": str(e),
            }

    @staticmethod
    def _strip_json(text: str) -> str:
        text = text.strip()
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
        return text.strip()

    @staticmethod
    def _extract_pdf_text(pdf_bytes: bytes) -> str:
        try:
            import pdfplumber
            import io
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                pages = [p.extract_text() or "" for p in pdf.pages[:8]]
            return "\n".join(pages)
        except ImportError:
            return ""
        except Exception:
            return ""
