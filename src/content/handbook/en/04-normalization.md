---
order: 4
part: model
title: "Normalization"
label: NORM
en: "Normalization"
hint: "rmsnorm"
variants: "rmsnorm  layernorm  dyt"
blurb: "The layer that keeps the residual stream's scale stable, and where to put it."
status: planned
progress: 0
categories:
  - title: Normalization type
    items: ["LayerNorm", "RMSNorm", "DyT"]
  - title: Placement
    items: ["pre-norm", "post-norm", "sandwich"]
  - title: Details
    items: ["QK-norm", "ε", "Learnable gain"]
---
