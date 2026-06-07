---
name: reproduce
description: Start a full ML paper reproduction session. Runs repo-analyzer → dockerfile-generator → risk-detector and opens the workbench UI.
---

Given a GitHub URL, arXiv ID, or paper PDF, reproduce the paper's experimental results by:

1. Running the `repo-analyzer` skill to parse the repository
2. Running the `dockerfile-generator` skill to create a pinned environment
3. Running the `risk-detector` skill to flag reproduction gaps
4. Presenting a structured workbench with Dockerfile, run procedure, and risk summary

Open the Web UI at http://localhost:8000 for the full interactive experience.
