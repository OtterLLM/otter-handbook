---
order: 7
part: model
title: "Residual connections"
label: RESIDUAL
en: "Residual connections"
hint: "mhc"
variants: "add  mhc  attnres  gr"
blurb: "How a sublayer's output is written back to the residual stream: plain addition on one stream, or multiple streams with mixing and gating."
status: planned
progress: 0
categories:
  - title: Single-stream residual
    items: ["pre-norm", "LayerScale", "ReZero"]
  - title: Multi-stream and mixing
    items: ["HC", "mHC", "Doubly stochastic constraint"]
  - title: Depth aggregation
    items: ["AttnRes", "Block AttnRes", "Multi-head / multi-stream variants"]
  - title: Gating
    items: ["GR", "MGR"]
---
