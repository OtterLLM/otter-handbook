---
order: 3
part: model
title: "Positional encoding"
label: POSITION
en: "Positional encoding"
hint: "rope"
variants: "rope  alibi  learned  none"
blurb: "How the model knows the order of tokens."
status: planned
progress: 0
categories:
  - title: Absolute position
    items: ["sinusoidal", "learned"]
  - title: Rotary and relative position
    items: ["RoPE", "partial RoPE", "ALiBi"]
  - title: No explicit encoding
    items: ["NoPE"]
  - title: Length extrapolation
    items: ["Beyond-training lengths", "Frequency base"]
---
