---
order: 6
part: model
title: "Feed-forward & mixture of experts"
label: FFN
en: "Feed-forward & mixture of experts"
hint: "moe"
variants: "dense  moe  latent-moe"
blurb: A per-position nonlinear transform. Split a single dense FFN into a bank of experts, and let each token activate only a handful of them.
status: draft
progress: 0.35
updated: 2026-11-14
categories:
  - title: MoE
    items: ["Expert sparsity"]
---

## MoE

A standard `top-k` MoE layer splits a single feed-forward network into $E$ routed experts plus $s$ always-on shared experts; the `router` scores each token's affinity and activates $k$ routed experts for it. Total parameter count grows linearly with $E$, while per-token FFN compute only grows with $k$ and the per-expert hidden width $d_{\text{expert}}$ — the gap between the two is the first knob you have to turn when designing MoE for a small model: **routing sparsity**.

Let's state the core finding up front: **under iso-training-FLOPs accounting, even on small models with under 2B activated parameters, pushing routing sparsity all the way to $E/k = 153.6$ keeps monotonically improving pretraining BPB, and does so far more effectively than widening the backbone, skewing expert allocation across layers, or bolting on a static N-gram table**. What actually caps sparsity for small models isn't pretraining quality — it's four system and optimization boundaries: the device's total memory ceiling, too few tokens per expert at decode time ($T_{\text{exp}} = Tk/E$), whether grouped GEMM and cross-device dispatch can hold on to real wall-clock throughput, and the drift in optimal batch size / learning rate caused by amplified per-expert gradient noise.

---

### Three "sparsity" conventions, and expert granularity

Before reading a technical report or a model card you have to align on accounting conventions first — the same model, reported under the three conventions below, can differ by two or three times:

| Convention | Definition | Example: Ling-mini-2.0 (`256/8+1`, `16.3B / 1.4B`) | Question it answers |
| --- | --- | --- | --- |
| Routing sparsity $E/k$ | Total routed experts / routed experts activated per token (Kimi K2 convention) | $256 / 8 = 32$ | How large a candidate pool does the `router` pick from |
| Expert activation ratio $A$ | $(k + s) / (E + s)$, folding shared experts in at the same width (Ant Ling convention) | $9 / 257 = 3.5\%$ | What fraction of a single MoE layer's parameters is used per step |
| Parameter activation ratio $N_a / N$ | Activated parameters per token / total model parameters (including embeddings, LM head, attention, and dense layers) | $1.4\text{B} / 16.3\text{B} = 8.6\%$ | The real "compute per step / resident memory" ratio at deployment |

Separately, Abnar et al. (2025) define sparsity as the fraction of **unactivated** experts, $1 - k/E$ — the closer to $1$, the sparser — which is just an inverse-shifted version of $E/k$.

For small models, the easiest accounting mistake is **treating the per-layer activation ratio $A$ as the whole-network activation ratio $N_a / N$**. Embeddings, the output head, and attention projections are dense overhead every token incurs. In trillion-parameter models this is a thin slice: $A \approx 2\%$ corresponds to an $N_a / N$ of roughly $3\%\text{–}4\%$. But in small models with total parameters $\le 50\text{B}$, the vocabulary and attention stack eat up a sizable share — even with MoE layers compressed to "256 choose 8" ($A = 3.5\%$), whole-network $N_a / N$ typically still lands at $8\%\text{–}15\%$.

Orthogonal to "how much is used per step" is a second knob: **expert granularity**. Tian et al. (2025) define it as:

$$
G = \frac{2\,d_{\text{model}}}{d_{\text{expert}}}
$$

With total parameters $N$ and activated parameters $N_a$ held fixed, a larger $G$ means each expert is narrower, and $E$ and $k$ are sliced proportionally finer. $A$ determines "how much FFN capacity is activated per step," while $G$ determines "how many pieces that capacity is cut into for free combination."

---

### Where open source lands: why 166 configurations diverge at 50B

In our [MoE Config Atlas](https://otterllm.github.io/moe-config-atlas/) we continuously track and deduplicate **166 independent open-source MoE architecture configurations** released by 57 organizations in 2025–2026 (data as of `2026-11-09`; minor versions that only changed post-training without touching `config.json` are merged; the interactive sparsity scatter plot and the 40-column structural fingerprint table can be filtered directly on that page). Splitting by total parameters into **small tier ($\le 50\text{B}$)**, **mid tier ($50\text{–}500\text{B}$)**, and **large tier ($\ge 500\text{B}$)** makes the divergence between small and large models obvious at a glance:

![Activation ratio and routing sparsity of 166 open-source MoE configs, binned by tier](../img/ffn-atlas-166.en.png "Plotted from the MoE Config Atlas (as of 2026-11-09, 166 deduplicated configs from 57 organizations). (a) Whole-network parameter activation ratio N_a/N falls as a power law with total parameters N; (b) distribution and median of per-tier routing sparsity E/k across 2025 and 2026, with the blue band at the bottom marking the E384 → E1536 range this book measured on 0.5B–5.5B small models.")

| Scale tier | Deduplicated configs | $N_a$ range (median) | $E/k$ median (full range) | $E/k$ median: `2025 → 2026` | Per-layer activation ratio $A$ median | Whole-network $N_a/N$ median (range) | Standard granularity $G$ median |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Small tier $\le 50\text{B}$ | 67 | 0.6–9.0B (2.8B) | **16.0** (4.0–42.7) | `10.7 → 16.0` | 7.7% | **14.3%** (5.0%–40.0%) | 4.0 |
| Mid tier $50\text{–}500\text{B}$ | 66 | 3.0–114.9B (13.0B) | **32.0** (4.0–128.0) | `16.0 → 32.0` | 3.9% | **6.0%** (3.3%–34.3%) | 5.3 |
| Large tier $\ge 500\text{B}$ | 33 | 16.0–104.0B (40.0B) | **42.7** (23.3–64.0) | `32.0 → 43.4` | 3.1% | **4.8%** (2.2%–10.0%) | 6.0 |

Three facts emerge from these 166 configurations that directly inform small-model design:

- **Whole-network activated parameters follow an empirical power law $N_a \approx 0.28\,N^{0.73}$ ($R^2 = 0.89$)**: every $10\times$ increase in total parameters shrinks the whole-network activation ratio to roughly $0.54$ of its prior value. The same vendor's flagship and small model almost never share the same sparsity tier — e.g., Qwen's `35B` uses `256/8` ($E/k = 32$), while its `80B` and `397B+` step up to `512/10` ($51.2$); Ant Ling's `7.9B` drops back to `128/8` ($16$), while its `124B` and `560B` push to `512/8` ($64$).
- **No open-source model under 50B has reached $E/k = 64$ to date**: in 2026, mainstream mid- and large-tier configurations have massed around `48–64` (e.g., DeepSeek-V4 `384/6+1`, Ling-3.0-flash `512/8+1`, Kolibri-1 `384/6+1`, LongCat-2.0 `768/12`), while the record among the 67 small-tier models is `Recursive flint` (`39.8B / 2.5B`, `256/6+1`, $E/k = 42.7$), closely followed by a cluster parked at `32` (`Qwen3.6-35B-A3B`, `Ling-mini-2.0`, `Kimi Linear 48B-A3B`, `Maple-Preview 20B/1B`), with most still clustered at `8–16` (`OLMoE-1B-7B`, `Gemma 4 26B-A4B`, `GLM-4.7-Flash`). Two hard constraints pin down small-tier models: total parameters $N$ usually have to fit on a single consumer-grade GPU or edge-device unified memory (`16B–35B`), while activated parameters can't drop below the `1B–3B` needed for baseline reasoning ability — arithmetically this locks $E/k$ into `16–32`.
- **Scaling up relies on adding more experts $E$, not on cutting a single expert infinitely finer**: excluding latent-projection routing, the median granularity $G$ across all three standard `top-k` tiers only creeps from `4.0` to `6.0`, with the overwhelming majority landing at `2–8`. As a model widens, $d_{\text{expert}}$ widens in step with $d_{\text{model}}$, and the new parameter budget is mostly spent doubling $E$.

---

### Local experiment: pushing a small model's E from 384 to 1536

Open-source small-tier models stall at $E/k \le 42.7$ due to edge-device memory limits, which raises a question that must be tested by hand in small-model pretraining: **if total parameters aren't locked, does pushing routed experts all the way to `1536` ($E/k = 153.6$) on a sub-2B-activation small model keep improving iso-FLOPs quality? Does spending the same budget on widening the backbone, rebalancing per-layer expert allocation, pooling shared experts across layers, or switching to a compute-free N-gram lookup achieve the same effect?**

We ran a set of systematic ablations on 4 Ascend 910C devices (8 logical dies, `EP8`) based on the Marin small-tier architecture. Shared baseline: `top-10` routing plus `1` shared expert, attention mixed as `KDA : MLA = 2 : 1`, Block AttnRes residuals, a Quantile Balancing router keeping `dropless` zero-drop, `global_batch = 128`, sequence length `4096`, single `seed = 0`. Because increasing $E$ raises the per-token resolved FLOPs of the `router` projection ($d_{\text{model}} \times E$) by a few percentage points, treatment groups are aligned by **equal total proxy training FLOPs** (correspondingly running a few percent fewer tokens), and we record two kinds of metrics:

1. **Final quality**: the macro-average BPB across all 16 Paloma packed evaluation domains (lower is better), plus the number of domains that improved, `X/16`;
2. **Wall-clock time at matched resolved FLOPs**: converted via the identity $\text{same-FLOPs time} = \text{per-token time} \div \text{per-token resolved FLOPs}$ (steady-state throughput taken as the mean of the final 300 steps, **comparing wall-clock only between pairs on the same kernel version**; the `d512` `v23 E384` baseline switched from `micro8` to `micro16` at step `6355`, so when comparing against `micro8` runs we strictly use its pre-switch `micro8` steady-state window of `780,342 tok/s`).

![Summary of local small-model MoE sparsity and alternative ablations](../img/ffn-local-ablations.en.png "Controlled local small-model ablations on 4×Ascend 910C (EP8). (a) Relative change in final Paloma 16-domain macro-average BPB under equal total proxy FLOPs; (b) change in wall-clock time at matched resolved FLOPs, with cross-kernel-version pairs explicitly marked as not directly comparable.")

| Experiment axis | Control arm → treatment arm | Total params | Training tokens | Paloma macro BPB | Quality change (domains improved) | Same-FLOPs time change |
| --- | --- | --- | --- | --- | --- | --- |
| `d512` expand experts $4\times$ | `E384` → `E1536` (both `v23, mb8`) | 502M → 1,864M | 4.62B → 4.26B | `1.2209 → 1.1984` | **−1.84%** (`16/16`) | **+3.2%** (per-step `+12.2%`, FLOPs `+8.6%`) |
| `d512` expand experts $2\times$ | `E384 (v23)` → `E768 (v2)` | 502M → 956M | 4.62B → 4.50B | `1.2209 → 1.2080` | **−1.05%** (`16/16`) | Cross kernel version (`v23` vs `v2`), not directly comparable |
| `d512` expand again $2\times$ | `E768 (v2, mb8)` → `E1536 (v3, mb4)` | 956M → 1,864M | 4.50B → 4.26B | `1.2080 → 1.1986` | **−0.78%** (`15/16`) | `+52.8%` (includes `mb8→4` and splitting into two GMM groups) |
| `d768` expand experts $4\times$ | `E384 (v3)` → `E1536 (v23)` | 1,452M → 5,536M | 13.10B → 12.24B | `1.1281 → 1.1097` | **−1.63%** (`16/16`) | Cross kernel/mb (`v3/mb4` vs `v23/mb8`) |
| Widen instead of sparsify, equal FLOPs | `d512×6 E1536` → `d768×8 E384` (`v3, mb4`) | 1,864M → 1,452M | 4.26B → 1.90B | `1.1986 → 1.2148` | **+1.35%** (`0/16`) | **−43.9%** (under `v3/mb4`, `E1536` is `1.78×` slower) |
| Lookup table instead of experts, equal total params | `E1536` → `E768 + N-gram` (`v23, mb8`) | 1,864M → 1,864M | 4.26B → 4.47B | `1.1984 → 1.2047` | **+0.53%** (`0/16`) | `+0.7%` |
| Bolt-on official Engram | `E384` → `E384 + Engram` (`v23, mb16`) | 502M → 586M | 4.62B → 4.57B | `1.2209 → 1.2216` | `+0.06%` (`4/16`) | `+4.6%` |
| Sparse-then-dense / dense-then-sparse across layers | `[384×6]` → `[288×4, 576×2]` / `[576×2, 288×4]` | both 502M | both 4.62B | `1.2209 → 1.2219 / 1.2227` | `+0.08%` / `+0.15%` | `−0.1%` / `+0.2%` |
| Global shared expert pool across layers | `[384×6]` → `UniPool-2304` (`v23, mb16`) | 502M → 505M | 4.62B → 4.52B | `1.2209 → 1.2193` | **−0.13%** (`13/16`) | **+28.8%** |
| Two-hop serial routing within a layer | `Top-10` → `CoE-2Hop (Top-5→5)` (`v23, mb16`) | both 502M | 4.62B → 4.43B | `1.2209 → 1.2205` | **−0.04%** (`10/16`) | `+8.7%` |

:::obs[Pushing E/k to 153.6 still monotonically lowers BPB across every evaluation domain, and after kernel tuning the same-FLOPs wall-clock cost is only +3.2%]
**Setup**: `d512×6` (total budget `1.1355e18` FLOPs) and `d768×8` (`7.831e18` FLOPs), with per-token activation fixed at `top-10 + 1` shared expert, only scaling routed experts per layer from `384` to `768` and `1536` (routing sparsity $E/k$ rising from `38.4` to `76.8`, `153.6`). Note that the early `capacity = 1.05` historical `E384` baseline (`1.2266`) includes roughly `9.4%` late-stage token dropping — we instead use a clean `dropless E384` control (`1.2209`) here; a calibration across versions of the same configuration shows `v3` and `v23` differ by only `0.02%` on final BPB (`1.1986` vs `1.1984`).

**Observation**: even though training `8%` fewer tokens because the `router` got wider, on `d512` the sequence `E384 → E768 → E1536` keeps dropping by `−1.05%` and `−0.78%` (cumulative **−1.84%**, winning all 16 domains, with the largest drop in the `Code` domain); on `d768`, `E384 → E1536` similarly drops by **−1.63%** (winning all `16/16` domains). More importantly, under the `source-v23 / micro8` kernel — with dispatch and operator paths cleaned up — expanding `d512` from `E384` to `E1536` ($4\times$) only costs **+3.2%** more same-resolved-FLOPs wall-clock time.

**Interpretation**: a fine-grained expert pool provides high-dimensional conditional capacity; as long as grouped GEMM and `all-to-all` dispatch don't degrade, the extra wall-clock time is almost exactly equal to the real resolved compute of the `router`'s linear layer itself, `+8.6%`.
:::

:::obs[At equal FLOPs, "expand experts" beats "widen the backbone" outright, but wall-clock accounting reverses if the kernel isn't tuned]
**Setup**: holding `1.1355e18` training FLOPs fixed and using the same early `overnight-v3 / micro4` kernel, we compare head-to-head the "narrow and very sparse" `d512×6 E1536` (runs 8119 steps, 4.26B tokens) against the "wide and denser" `d768×8 E384` (per-step compute $2.24\times$ larger, only manages 3624 steps, 1.90B tokens).

**Observation**: aligned by FLOPs, `d768×8 E384`'s final BPB (`1.2148`) is **+1.35%** worse than `d512×6 E1536`'s (`1.1986`), losing in all 16 sub-domains. But under this version of the `overnight-v3 / micro4` kernel (where `E1536` is forced to reduce microbatch size and split into two 768-group GMM calls), `d512 E1536` takes **1.78×** the NPU wall-clock time of the wide model to run the same FLOPs (equivalently, the wide model is **−43.9%** faster) — exceeding the roughly `1.44×` compute-equivalent ratio implied by its BPB lead.

**Interpretation**: under a small budget, the wide model is severely undertrained, so "accounting by FLOPs" will always favor high sparsity; but high sparsity on a narrow residual stream easily tanks hardware utilization — the contrast between `1.78×` slower under `overnight-v3` and only `+3.2%` slower after tuning to `v23` shows that **whether small-model high sparsity wins on "quality per device-hour" depends half on the algorithm and half on your underlying GMM and dispatch kernels**.
:::

:::obs[Rearranging layers, pooling experts across layers, two-hop routing within a layer, and a static N-gram table are all no substitute for simply putting more experts in every layer]
**Setup**: on `d512×6` (`source-v23`), holding either compute or total parameters fixed, we test four common ideas that try to avoid adding total experts or drop dynamic routing altogether.

**Observations and evidence**:
1. **Non-uniform allocation across layers doesn't help**: with the whole network fixed at `2304` total routed experts, splitting them evenly per layer at `[384×6]` (`1.2209`) beats both sparse-then-dense `[288×4, 576×2]` (`+0.08%`) and dense-then-sparse `[576×2, 288×4]` (`+0.15%`).
2. **Pooling across layers into one big shared pool has very poor cost-effectiveness**: merging the 6 layers' experts into one globally shared pool of `2304` experts (`UniPool-2304`, where every layer can pick any expert in the whole network), BPB only drops marginally by `−0.13%`, while same-FLOPs wall-clock time explodes by **+28.8%**.
3. **Serial two-hop routing within a layer just taxes you for nothing**: without adding experts, splitting a single `Top-10` into two serial hops `Top-5 → Top-5` (`CoE-2Hop`), BPB barely moves (`−0.04%`), while time cost rises by `+8.7%` for nothing.
4. **A static lookup table can't buy back dynamic nonlinear experts**: given the same `1,864M` total parameters, `E768 + a dual-head input-side 2/3-gram table` (`1.2047`) loses on all 16 domains to plain `E1536` (`1.1984`, a gap of **+0.53%**), recovering only about a third of the gain from `E768 → E1536`; bolting the official `Engram` table (`+84M` parameters) onto `E384` likewise comes out flat to slightly worse (`+0.06%`, time `+4.6%`).

**Interpretation**: what makes routed experts genuinely valuable is the **deep-context-dependent nonlinear conditional computation** they provide at every layer's residual transform; a static surface-level n-gram lookup can only cover shallow local co-occurrence, and the scheduling/communication friction from a cross-layer global pool or within-layer serial two-hop routing far outweighs the small amount of combinatorial freedom it buys.
:::

---

### Borrowing from others: scaling laws, hyperparameter drift, and iso-cost evaluation

Cross-checking the local small-model findings against external large-scale controlled experiments shows that "quality improves monotonically with sparsity, but optimal hyperparameters and wall-clock economics drift along with it" is a consistent rule across organizations:

:::lit[Kimi K2 and Ant Ling: under FLOPs accounting, activation ratio A is the power-law main effect, granularity G is only a flat second-order term]
1. **Kimi K2 (Kimi Team, 2025, Muon optimizer)**: with per-token activation fixed at `8 + 1` experts, sweeping $E/k$ from `8` to `64`. On the compute-optimal frontier, reaching validation loss `1.5`, sparsity `48` saves **$1.69\times$, $1.39\times$, $1.15\times$** training FLOPs over `8`, `16`, `32` respectively; the final choice to stop at `384/8+1` ($E/k = 48$) was purely a concession to engineering complexity.
2. **Ant Ling's efficiency leverage law (Tian et al., 2025; Ling Team, 2025, 300+ models up to 28B)**: after re-tuning optimal hyperparameters for each, the dense/MoE compute ratio $\mathrm{EL}(A, G, C)$ needed to reach the same loss grows as a power law in activation ratio $A$, with leverage increasing at larger budgets $C$; the granularity optimum is flat and falls at **$G \in [8, 12]$**, and leaving **`1`** shared expert is sufficient. On `Ling-mini-beta` (0.85B activated / 17.5B total parameters) they matched a `6.1B` dense model with 1T tokens, realizing roughly $7\times$ compute leverage.

**Small-model check**: consistent with our observation that pushing $E/k$ to `153.6` on `d512` (`−1.84%`) and `d768` (`−1.63%`) still shows no saturation.
:::

:::lit[Ling hyperparameter power law (2026): the sparser the model, the larger the optimal global batch and the lower the optimal peak learning rate]
Tian et al. (2026, `arXiv:2609.08690`) ran **1800 experiments** on Muon and hybrid linear/full-attention architectures (activation `10M–324M`, total parameters up to `12B`, activation ratio $A$ as low as $1/64$), directly fitting a joint power law for the optimal peak learning rate $\eta^*$ and optimal global batch size $B^*$ in terms of compute $C$, data $D$, and activation ratio $A$:

$$
\eta^*(C, A) = 0.8343\,C^{-0.1385}\,A^{0.1361}, \qquad B^*(D, A) = 6.4765\,D^{0.5181}\,A^{-0.0841}
$$

The mechanism is intuitive: as $A$ shrinks, even though the optimal global batch $B^* \propto A^{-0.0841}$ expands slightly, the effective number of samples a single routed expert actually sees per step, $A \cdot B^* \propto A^{0.9159}$, still shrinks rapidly, significantly raising gradient noise on expert parameters — this must be stabilized with a **larger global batch and a lower peak learning rate**. Meanwhile, at fixed $A$, changing granularity $G$ (e.g. `(2, 64)` to `(4, 128)`) leaves the optimal $(\eta^*, B^*)$ almost unchanged, so it can be migrated at essentially zero cost.

**Small-model check**: when we matched configurations at small scale, directly reusing the `(lr, batch)` from a dense or low-sparsity model tended to underestimate the true ceiling of the high-sparsity arm; checking gradient noise and learning-rate scaling whenever $E$ is expanded is a must-do step.
:::

:::lit[Apple, Marin, and Pavlichenko: how memory ceilings, wall-clock throughput, and online inference cost rewrite the answer]
- **A total-parameter ceiling creates a parabolic optimum (Abnar et al., 2025)**: when device memory locks total parameters $N$ at a value small relative to training tokens, over-sparsifying actually hurts quality; and on tasks that integrate context on the spot — reading comprehension like CoQA and SQuAD — **at the same pretraining loss, denser models perform better**.
- **Small, narrow models are the easiest to have their FLOPs gains eaten by throughput (Marin Grug MoE `#5387`)**: fixing `top-4` and expanding experts from `E64` to `E256` ($E/k: 16 \to 64$), the pure loss-compute-equivalent speedup is `1.16×` on `d512`, rising to `1.38×` on `d1024`; but once a measured `9%–14%` throughput loss is factored in, the wall-clock-equivalent speedup on `d512` falls to just **`0.994×`** (essentially no gain), only turning a net profit of **`1.25×`** at `d1024`, and directly OOMing at `d1280` due to optimizer state.
- **When costed against real online inference spending, fine-grained MoE is still the single biggest lever (Pavlichenko `bux-timeline`, October 2026, 1129 runs)**: after normalizing different architectures to the **same vLLM FP8 online inference cost** before comparing validation loss, fine-grained MoE delivers the single largest module-level gain, **−5.5%**, far exceeding any attention variant or residual tweak.

**Small-model check**: Marin's wall-clock breakeven on `d512` (`0.994×`) mirrors our own early `overnight-v3` being `1.78×` slower, dropping to only `+3.2%` after tuning to `v23` — small models' narrow matrices sit far from the compute roofline, so operator efficiency directly determines whether sparsity actually pays off.
:::

---

### The four walls you hit when pushing sparsity higher

Why do open-source small-tier models generally stall at $E/k \in [16, 32]$, never daring to push to `64` or even `150` the way flagships do? Because once you leave pure FLOPs paper calculations, the following four hardware bills come due in turn:

1. **The decode arithmetic-intensity wall: $T_{\text{exp}} = Tk / E$ becomes too small, and the expert layer degenerates into an HBM mover**. When a layer processes $T$ tokens at once, each routed expert gets on average $T_{\text{exp}} = Tk/E$ tokens. For grouped matrix multiply to clear the Roofline knee and amortize the HBM bandwidth of reading expert weights, a single expert typically needs to accumulate thousands of tokens (Elango et al., 2026 estimate roughly `1418` for `Qwen3-235B-A22B` on GB200 FP4). Doubling $E/k$ directly halves $T_{\text{exp}}$; by the time you reach single-user `batch = 1` decoding on edge devices ($T = 1$), each step always moves $k$ experts' worth of weights from memory regardless — expanding the expert pool further saves not a single byte of bandwidth, and only wastes resident memory.
2. **The total-parameter memory and small-matrix MFU wall**. Ludziejewski et al. (ICML 2025) show that in the regime $E \le 8$ with extended token-to-parameter overtraining, MoE can be memory-friendly; but once you enter the modern fine-grained regime of $E \ge 256$, the minimum number of training and deployment devices is hard-capped entirely by total parameters $N$. Meanwhile, small models have narrow per-expert matrices (e.g., `d512` paired with `intermediate = 384`), so hardware utilization is naturally low — we measured only about `8.7%` MFU on `d768 E1536` on 910C, rising to `14.1%` only at `d2048`; scaling the combined recipe on `d1024×12` from `E384` (`3.81B` total parameters) to `E1536` (`14.81B` total parameters) also raised iso-FLOPs wall-clock time by about `39%`.
3. **The cross-device `all-to-all` communication wall, and shared-expert masking**. Under expert parallelism, the communication bytes dispatched and gathered per step scale with $T\,k\,d_{\text{model}}$ (this is why MiniMax-M3, changing M2's `256/8, d=3072` to `128/4+1, d=6144`, left the product $k\,d_{\text{model}}$ unchanged — saving on dispatch count rather than cross-device bytes). When training across multiple nodes, inter-node bandwidth is far lower than intra-node interconnect, so you must do what DeepSeek-V3 (2024) does with **node-limited routing** (`n_group = 8, topk_group = 4`) to cap the maximum number of nodes a single token can hit — **in practice, the lossless upper bound on $k$ is set by the inter-node/intra-node bandwidth ratio**. Conversely, the always-on shared expert doesn't depend on routing results, so it slots neatly into the `all-to-all` communication window and executes in parallel — we measured that on `d512×6 E384`, doubling shared-expert width (`384 → 768`) slows a serial step by `+3.02%`, but only **`+0.74%`** once overlapped with EP communication.
4. **The thousand-expert-scale load-balancing and operator bit-width wall**. Once a single expert's target share $k/E$ drops below $1\%$ (`0.65%` when choosing `10` out of `1536`), an auxiliary-loss-free balancer that updates its bias by a fixed step struggles to balance cold-start speed against steady-state stability. Switching to **Quantile Balancing** — using each token's $(k+1)$-th highest score as the threshold, and snapping the bias in one step to the empirical quantile corresponding to the target load — is what keeps `dropless` zero dead-expert throughout from `E384` to `E1536`.

:::pitfall[Before pushing expert count past 1000, check the grouped GEMM's group-count ceiling and your custom kernel's int32 index overflow]
When pushing our local model to `E1536`, we hit two operator pitfalls in a row that don't raise a dimension error — they just quietly tank throughput or silently corrupt training in deep layers:

- **Grouped GEMM has a hard maximum group count**: Ascend's `aclnnGroupedMatmulV4` accepts at most `1024` groups in `groupList` per call. Running `E1536` can't be fed in one shot — it must be split by contiguous expert id into two calls of `768` groups each and stitched back together (if this split isn't co-tuned with `microbatch`, it noticeably raises operator scheduling overhead).
- **Flat index silently overflows past $2^{31}$**: at `d1024×12`, `global_batch = 256` (`131,072` tokens per step), `E1536`, the quantile-balancing statistics tensor has shape `[12, 131072, 1536]`, totaling about **2.42 billion** elements — right past the signed `int32` ceiling of $2^{31} - 1 \approx 2.15\text{ billion}$. After the custom counting kernel's `int32` flat index wraps around, the first 9 layers looked completely normal, but the coefficient of variation (CV) of expert load in layers 10 and 11 alone spiked to `3.69` and `5.24`. Switching the kernel's index uniformly to `int64` and resuming from the checkpoint restored flat load in the deep layers within 100 steps.
:::

---

### A default recipe for setting sparsity in small models

:::recipe[Seven defaults for training MoE in ≤50B small models]
1. **First lock activated parameters $N_a$ by inference-latency requirements, then back out total parameters $N$ and $E/k$ from your target device memory ceiling**: for edge or single-card consumer deployment (total parameters pinned to `16B–35B`), prefer $E/k \in [16, 32]$ (e.g., `128/8+1` or `256/8+1`, consistent with where small-tier models mainstream in the [MoE Config Atlas](https://otterllm.github.io/moe-config-atlas/)); for server-side multi-device inference or small-activation models aimed purely at pretraining-quality limits, push $E/k$ to `64–128` once kernels are in place (supported by our local `d512/d768 E1536` observations and inference-cost evaluations like Pavlichenko's).
2. **Set expert granularity to $G = 2d_{\text{model}}/d_{\text{expert}} \in [6, 12]$, keep exactly `1` shared expert, and overlap it with EP communication**: when widening model width, widen $d_{\text{expert}}$ in step, and spend any extra parameter budget primarily on increasing $E$ (supported by Ling's EL law and our local measurement of `+0.74%` shared-expert overlap cost).
3. **Place the same number of routed experts uniformly across all layers**: don't bother with sparse-then-dense, dense-then-sparse, a cross-layer shared big pool, or within-layer two-hop serial routing (supported by our local `d512` ablations of even split vs. skewed / `UniPool-2304` / `CoE-2Hop`).
4. **Don't use a static N-gram / Engram lookup table as a substitute for a routed expert pool**: at equal total parameters, a static table only recovers about a third of the expert gain; evaluate it separately only when the goal is bolting on zero-compute memory, not reducing expert count (supported by the local `E1536` vs. `E768 + N-gram` all-16-domains-win comparison).
5. **Do architecture selection with "BPB compute-equivalent ratio × same-kernel measured throughput ratio"**: never compare wall-clock time bare across kernel versions or `microbatch` settings; every experiment report must give both the quality delta and the `same-FLOPs time` (supported by the local `overnight-v3` 1.78× slower vs. `v23` +3.2% slower comparison, and Marin `#5387`).
6. **When doubling sparsity, tune hyperparameters along $\eta^* \propto A^{0.136}$, $B^* \propto A^{-0.084}$**: the sparser the experts, the higher the per-expert gradient noise, so global batch should be set larger than a dense model at the same compute, and peak learning rate slightly lower; when only changing granularity $G$, the original hyperparameters can be reused directly (supported by Tian et al., 2026's hyperparameter scaling law).
7. **For hundreds to thousands of experts, make `dropless` + Quantile Balancing (QB) standard, and preflight real tensor shapes before launch**: enable grouped-restricted routing to control inter-node `all-to-all` when training across multiple nodes; when $E > 1024$ or `layers × tokens_per_step × E` approaches $2 \times 10^9$, check your underlying GMM's group-count ceiling and your custom operators' use of `int64` indices ahead of time (supported by our local `E1536` pitfall log).
:::
