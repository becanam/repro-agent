---
name: risk-detector
description: Detect ML paper reproduction risks by comparing the repository against the paper. Identifies CUDA mismatches, missing random seeds, undisclosed hyperparameters, missing scripts, and precision issues. Classifies each risk as high/medium/low and suggests mitigations. Use after repo-analyzer completes, or when the user asks about reproduction risks.
license: MIT
compatibility: Works best when both repository analysis and paper PDF/abstract are available.
metadata:
  author: repro-agent
  version: "1.0"
  domain: ml-reproducibility
allowed-tools: Bash(python3:*) Read
---

# Risk Detector Skill

Systematically identifies gaps between a paper's reported experimental setup and its code repository.

## When to activate

- Pipeline step 5 (Verification) or any time after repo analysis
- User asks "why is reproduction risky?", "what can go wrong?", "how reproducible is this?"
- Before generating the run procedure (risk-aware procedure)

## Risk categories and detection rules

See [references/risk-patterns.md](references/risk-patterns.md) for the full pattern library.

### HIGH severity

These risks can cause >1% metric deviation or complete failure to reproduce:

**CUDA version mismatch**
- Signal: README install command pins a different CUDA version than the paper reports
- Detection: compare `torch+cu{X}` in README vs. paper §Experiments or Appendix
- Fix: pin Dockerfile to paper's CUDA version

**Random seed not fixed**
- Signal: `torch.manual_seed`, `np.random.seed`, `random.seed` absent from training script
- Detection: grep for `manual_seed|set_seed|seed(` across Python files
- Fix: inject `--seed` arg; set `PYTHONHASHSEED=0`, `CUBLAS_WORKSPACE_CONFIG`

**Missing training script**
- Signal: README references a script that doesn't exist in the repo
- Detection: cross-reference README commands with `git ls-files`
- Fix: reconstruct from paper §3 (method) and §4 (experiments)

### MEDIUM severity

These risks can cause 0.1–1% metric deviation:

**Undisclosed hyperparameters**
- Signal: hyperparameter appears in paper text but not in config/argparse
- Common missing: `warmup_steps`, `weight_decay`, `label_smoothing`, `drop_path_rate`
- Fix: estimate from figures (LR schedule) or related-work defaults

**Missing preprocessing script**
- Signal: README mentions preprocessing but script is absent
- Fix: reconstruct from paper §3 (data section) — resize, normalization, augmentation

**Mixed-precision default mismatch**
- Signal: config defaults to `fp16`, paper text mentions `bf16` (or vice versa)
- Fix: set `--amp-dtype` to match paper text

### LOW severity

Minor numerical impact, worth noting:

**Non-deterministic data loader**
- Signal: `DataLoader(num_workers>0)` without `worker_init_fn` or `generator` seed
- Fix: set `generator=torch.Generator().manual_seed(seed)`

**Gradient accumulation undisclosed**
- Signal: `gradient_accumulation_steps` not in config but effective batch size math doesn't add up
- Fix: infer from stated batch size ÷ per-GPU batch size × number of GPUs

**Compiler flags undisclosed**
- Signal: paper mentions `torch.compile` but config doesn't set it

## Output format

```json
[
  {
    "sev": "high",
    "name": "Random seed not fixed",
    "desc": "train.py never calls torch.manual_seed; results are non-deterministic run-to-run.",
    "fix": "Injected --seed 42, PYTHONHASHSEED=0, and CUBLAS_WORKSPACE_CONFIG for determinism."
  }
]
```

## Severity aggregation

At the end, summarize:
- Count of high / medium / low risks
- Overall reproducibility rating: **High** (0 high), **Medium** (1–2 high), **Low** (3+ high)
- Estimated metric variance: ±0.X% Top-1 (or equivalent)
