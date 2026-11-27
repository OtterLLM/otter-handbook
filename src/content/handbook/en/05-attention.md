---
order: 5
part: model
title: "Attention & sequence mixing"
label: ATTENTION
en: "Attention & sequence mixing"
hint: "mla"
variants: "full  sparse  linear  hybrid"
blurb: "Where tokens exchange information: from full attention to sparse and linear variants, and on to hybrids that mix several kinds."
status: draft
progress: 0.25
categories:
  - title: Full attention
    items: ["MHA", "GQA", "MLA", "Gated Attention"]
  - title: Sparse attention
    items: ["SWA", "DSA", "LSA", "CSA / HCA"]
  - title: Linear attention and state space
    items: ["Gated DeltaNet", "KDA", "Lightning Attention", "Mamba-2"]
  - title: Hybrid stacking
    items: ["KDA : MLA = 3 : 1", "Global-layer spacing", "Layer ratio"]
  - title: Implementation
    items: ["Flash Attention", "KV cache"]
---

:::open[This chapter is currently a typesetting sample]
The content below only demonstrates the layouts the handbook will use: sections, equations, tables, code, and the five callout types. Replace it wholesale when writing; every other chapter is still empty.
:::

## Full attention

Standard scaled dot-product attention:

$$
\mathrm{Attention}(Q, K, V) = \mathrm{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right) V
$$

Here $d_k$ is the per-head dimension. The variants of full attention differ mainly in what the KV cache actually stores.

| Scheme | Query heads | What is cached | Notes |
| --- | --- | --- | --- |
| MHA | $h$ | $h$ sets of K / V | Each head has its own |
| GQA | $h$ | $h / g$ sets of K / V | One set shared per $g$ heads |
| MLA | $h$ | One compressed latent | K / V are reconstructed on use |

:::obs[Observation block: write what you saw in your own runs]
Suggested four-part form: **Setup** (model size, data, steps trained) → **Phenomenon** (one sentence) → **Evidence** (curve or table) → **Possible explanation**.
:::

:::lit[Literature block: write what others concluded]
State the source and the scale of the original experiments, then add one line: have you verified this conclusion on small models?
:::

## Sparse attention

Inline code looks like this: `F.scaled_dot_product_attention`. A code block:

```python
import torch.nn.functional as F

def attention(q, k, v, causal=True):
    # q, k, v: (batch, heads, seq, head_dim)
    return F.scaled_dot_product_attention(q, k, v, is_causal=causal)
```

:::recipe[Recipe block: defaults you can copy as-is]
Use it first when you do not feel like tuning. Every recipe should link to the observation or paper that supports it.
:::

:::pitfall[Pitfall: code that looks fine but breaks]
Describe the symptom in one sentence, then how you found it and how you fixed it.
:::

## Linear attention and state space

To be written.

## Hybrid stacking

To be written.
