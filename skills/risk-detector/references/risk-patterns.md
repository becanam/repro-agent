# ML Reproduction Risk Patterns

Reference library for the `risk-detector` skill. Updated from empirical analysis of NeurIPS/ICML/ICLR 2022–2024 papers.

## Pattern: CUDA Version Mismatch

**Prevalence**: ~40% of PyTorch papers with CUDA dependencies  
**Metric impact**: ±0.2–0.5% Top-1 accuracy; ±0.5–2% BLEU for NLP

**Detection grep**:
```bash
# In requirements.txt / README
grep -Ei "cu[0-9]{3}" requirements.txt README.md
# In paper text (if extracted)
grep -Ei "cuda [0-9]+\.[0-9]+" paper.txt
```

**Common mismatch pairs**:
| README pins | Paper used | Risk |
|-------------|-----------|------|
| cu121 | cu118 | Medium (kernel differences) |
| cu118 | cu117 | Low |
| cu121 | cu102 | High (cuBLAS API changes) |

---

## Pattern: Missing Random Seed

**Prevalence**: ~55% of papers (improving post-2023)  
**Metric impact**: ±0.1–0.8% depending on task; high variance on small datasets

**Detection**:
```bash
grep -r "manual_seed\|set_seed\|seed(" --include="*.py" .
```

Missing if output is empty for training scripts.

**Required seed coverage for full determinism**:
```python
import random, numpy as np, torch
random.seed(seed)
np.random.seed(seed)
torch.manual_seed(seed)
torch.cuda.manual_seed_all(seed)
torch.backends.cudnn.deterministic = True
torch.backends.cudnn.benchmark = False
os.environ["PYTHONHASHSEED"] = str(seed)
os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"
```

---

## Pattern: Undisclosed Warmup Schedule

**Prevalence**: ~30% of transformer-based papers  
**Metric impact**: ±0.1–0.3% on classification; ±0.5–1.5 BLEU on generation

**Detection**: search for `warmup` in configs and README. If absent but paper plots an LR schedule, digitize the figure.

**Common defaults by architecture**:
| Architecture | Typical warmup |
|---|---|
| ViT (ImageNet) | 10k–20k steps |
| BERT-style | 4% of total steps |
| GPT-style | 1k–2k steps |
| Diffusion | 500–1000 steps |

---

## Pattern: Missing Preprocessing Script

**Prevalence**: ~25% of vision papers  

**Detection**: grep README for `bash data/` or `python preprocess` then check if file exists:
```bash
grep -Eo "(bash|python[3]?) [^ ]+\.(sh|py)" README.md | \
  while read cmd f; do [ -f "$f" ] || echo "MISSING: $f"; done
```

**Reconstruction sources** (in priority order):
1. Paper §3.1 (data section) — resize, normalization constants
2. Standard dataset recipes (e.g., ImageNet: 224px, mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225])
3. `timm` default transforms for the stated backbone

---

## Pattern: Mixed-Precision Mismatch

**Prevalence**: ~15% of A100-era papers  
**Metric impact**: ±0.05–0.2%; larger for bfloat16 vs float16 on loss spikes

**Detection**:
```bash
grep -r "amp\|autocast\|fp16\|bf16\|float16\|bfloat16" --include="*.py" --include="*.yaml" .
```

If config says `fp16: true` but paper says "trained with bf16", flag as low risk.

---

## Pattern: Gradient Accumulation Hidden

**Prevalence**: ~20% of large-batch papers  

If the paper states batch size B but `DataLoader(batch_size=b)` where b < B, check for `gradient_accumulation_steps`. If absent, the effective batch size is wrong.

**Formula**: `effective_batch = batch_size × grad_accum_steps × num_gpus`

---

## Severity decision matrix

| Detectable? | Quantifiable impact | Severity |
|---|---|---|
| Yes | >1% metric | HIGH |
| Yes | 0.1–1% metric | MEDIUM |
| Yes | <0.1% metric | LOW |
| No (paper-only) | Any | MEDIUM (flag as unverifiable) |
