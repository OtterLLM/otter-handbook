# otter: a handbook on training small models

**English** | [简体中文](README.zh-CN.md)

Pitfalls we stepped in, and paths others have already cleared. An open-source handbook of small-model training experience: first-hand observations plus reusable conclusions from the literature, organized by model component from the tokenizer all the way to quantized deployment.

Read online: <https://otterllm.github.io/otter-handbook/>

## Running it

Requires Node.js 22.22 or newer.

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs to dist/, fully static
```

After a push to `main`, `.github/workflows/deploy.yml` builds and publishes to GitHub Pages automatically; it goes live in a minute or two.

## How to write

### Bilingual layout

English is the default language and the site lives at `/`; the Chinese mirror lives at `/zh/`, with a language switch in the header. Chapters and notes each have one file per language, in `en/` and `zh/`, with the same filename. If a translation is missing, the site falls back to the other language's version and shows a notice on the page. UI strings (buttons, labels, notices) live in the i18n dictionary under `src/i18n/`.

| What | Where | Notes |
| --- | --- | --- |
| Handbook chapter | `src/content/handbook/en/NN-*.md` and `src/content/handbook/zh/NN-*.md` (same filename) | Write the body below the second `---`; also set `status` to `draft` / `review` / `stable` and update `progress` (0-1) |
| Observation / note | `src/content/notes/en/*.md` and `src/content/notes/zh/*.md` (same filename) | Create a new file; pick `kind` from `obs` `lit` `recipe` `pitfall` `open`, and put the related chapter ids in `components` |
| Paper | `src/data/papers.yaml` | One entry per paper; `components` takes chapter ids and the entry is attached to those chapters automatically. The one-line conclusion goes in `takeaway` (English) and `takeaway_zh` (Chinese) |

A chapter id is its filename without the number: `tokenizer` `embedding` `position` `normalization` `attention` `ffn` `residual` `loop` `head` `data` `objective` `optimizer` `schedule` `regularization` `initialization` `evaluation` `distillation` `quantization` `inference`.

The body supports five callout types:

```markdown
:::obs[Write the title as a sentence that can be refuted]
Setup → phenomenon → evidence → possible explanation
:::
```

Swap `obs` for `lit` (literature), `recipe`, `pitfall`, or `open` (open question). The three existing notes and the `attention` chapter are typesetting samples (the notes are marked `sample: true`); delete them once you have written real content.

### Images, equations, and other syntax

```markdown
![Loss curve with too short a warmup](../img/warmup-loss.png "Caption: a spike in the first 2k steps, then level with the baseline.")

Inline math $\mathcal{L} = -\sum_i \log p_\theta(x_i)$, and display math:

$$
\theta_t = \theta_{t-1} - \eta \, \frac{\hat m_t}{\sqrt{\hat v_t} + \epsilon}
$$

Internal links start from the root path: [the attention chapter](/handbook/attention/)

<details>
<summary>Full training config</summary>

Put long logs, full configs, and derivation details here; collapsed by default.

</details>
```

- **Images** go in the shared `img/` folder (`src/content/handbook/img/` for chapters, `src/content/notes/img/` for notes) and are referenced as `../img/<file>` from both the English and Chinese versions. They are compressed to webp at build time. An image alone in its paragraph is centered at body width; the quoted text is the caption, and captioned images are numbered automatically as FIG. 01, 02, and so on.
- **Equations** use KaTeX, rendered at build time, and support environments such as `aligned` and `cases`.
- **Internal links and files in `public/`** are written starting from `/`; when deployed to GitHub Pages, `/otter-handbook/` is prepended automatically (see `src/lib/markdown/base-path.mjs`). In files under `zh/`, links to site pages (`/handbook`, `/notes`, `/papers`, `/about`, `/lab`, `/`) also get `/zh` prepended automatically; images and other assets do not. On a page that falls back to the other language's text, these links still point to pages in the page's own language.
- Also supported: tables, code highlighting, footnotes `[^1]`, task lists `- [x]`, strikethrough `~~...~~`, and native HTML such as `<details>` and `<video>`.
- **Not supported**: Mermaid diagrams (shown as plain code), and referencing images by relative path such as `../img/` inside HTML tags (use Markdown's `![]()` syntax for figures).

## License

Text content (`src/content/`, `src/data/`) is licensed under [CC BY 4.0](LICENSE-CONTENT); code under [MIT](LICENSE).

## Design

The whole site is built as a "print proof": paper, ink, and one spot-color plate in Klein blue.

- **The cover is a shader.** A sea otter floating on its back, hugging a Klein-blue stone. Not an image: it is sculpted from distance fields in `src/lib/otter/` and computed fresh every frame.
  First comes the "skin", then a thin shell wrapped around it, and the fur lives inside the shell. As the view ray passes through the shell it asks, in small steps, "is there a hair here?", so the fur is built strand by strand, dark at the root, bright at the tip, with a fuzzy silhouette. The fur around the eyes and on the mouth is clipped short. The fur on the head is dry and fluffy; on the body it is wet and clumped into locks.
  The form follows a real otter: a broad, flat head (not a sphere), a muzzle that bulges forward as one block, a wide black nose, small ears on the sides of the head, a long neck-less body, fan-shaped flippers and a flat tail. The head, the upward-facing chest and the belly are pale; the sides and limbs are dark.
  It lifts its head to look at the stone on its belly, and the camera sits obliquely above.
  The computed "photo" is then split into a black plate and a blue plate, each overlaid with a rotated halftone screen (black at 45°, blue at 15°) and printed onto the paper.
  It has a simple skeleton: the head turns from the base of the neck with a bit of inertia, and the whiskers lag the head by half a beat; the two bones of each forelimb keep fixed lengths; the stone is a rigid body that really leaves the paw when it tosses it, flips once, and lands back in the paw. It watches your pointer; click the water and ripples spread; click the otter and it tosses the stone twice.
- **Four ways to print.** The row of buttons under the cover: halftone, characters, ordered dither, or no printing at all and just the original photo. `/lab/` is a test bench with only the otter (add `?mode=photo&zoom=3&x=0.3&y=1.3` to the address to zoom in on a spot).
- **The map.** `src/components/Atlas.astro`: an SVG architecture diagram where tokens flow up the main trunk and gradients loop back along the dashed lines. Each box is a chapter; hover it and the panel on the right shows that chapter's categories, its progress, and a small animated figure (`src/lib/figs.ts`, nineteen of them).
- **The table of contents.** As the pointer sweeps over a row, that chapter's small figure follows beside it; click in, and the title "grows" from the contents row to the chapter page (a cross-page view transition).
- **Chapter pages.** On the left, a minimap marking where you are; in the middle, the text; on the right, an on-page outline that highlights as you scroll.
- Light and dark themes; a separate layout for narrow screens; when the system asks for "reduce motion", every animation rests on a single frame.

## Layout

```text
src/
├── lib/otter/shaders.ts    two shaders: the "camera" (ray marching + fur shells) and the "press" (color separation + halftone + whiskers)
├── lib/otter/renderer.ts   WebGL2: skeleton and motion, camera, pointer, ripples, light/dark theme, pause and fallback
├── lib/figs.ts             nineteen small animated figures
├── components/Hero.astro   the cover
├── components/Atlas.astro  architecture diagram + inspector panel
├── components/ChapterList.astro  table of contents
├── content/handbook/       en/ and zh/ chapters (same filenames) + shared img/
├── content/notes/          en/ and zh/ notes (same filenames) + shared img/
├── data/papers.yaml        literature library (takeaway / takeaway_zh)
├── i18n/                   UI-string dictionary
├── styles/                 base (design system) · hero · atlas · home · inner · prose
└── pages/                  home / handbook / notes / papers / about / 404 / lab
```

In a browser without WebGL2 you only lose the cover painting; all the text is still there.
