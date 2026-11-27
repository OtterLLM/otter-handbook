import { defineMdastPlugin } from 'satteri';

/**
 * The handbook's five kinds of callout, written in Markdown like this:
 *
 *   :::obs[what happens when warmup is too short]
 *   body text...
 *   :::
 *
 * obs observation (something I ran myself) · lit literature (someone else's conclusion) ·
 * recipe (a default worth copying outright)
 * pitfall · open open question
 */
export const CALLOUTS = {
  obs: { mark: '◆', zh: '观察', en: 'OBSERVATION' },
  lit: { mark: '◇', zh: '文献', en: 'LITERATURE' },
  recipe: { mark: '▲', zh: '配方', en: 'RECIPE' },
  pitfall: { mark: '✕', zh: '坑', en: 'PITFALL' },
  open: { mark: '?', zh: '存疑', en: 'OPEN QUESTION' },
};

const isZh = (ctx) => /\/zh\//.test(ctx.fileURL?.pathname ?? '');

export const callouts = defineMdastPlugin({
  name: 'handbook-callouts',
  containerDirective(node, ctx) {
    const kind = CALLOUTS[node.name];
    if (!kind) return;
    ctx.setProperty(node, 'data', {
      hName: 'aside',
      hProperties: {
        class: `callout callout-${node.name}`,
        'data-mark': kind.mark,
        // Chinese sources (src/content/**/zh/) get "观察 OBSERVATION"; English sources just "OBSERVATION"
        'data-label': isZh(ctx) ? `${kind.zh} ${kind.en}` : kind.en,
      },
    });
    const first = node.children[0];
    if (first?.data?.directiveLabel) {
      ctx.setProperty(first, 'data', { hName: 'p', hProperties: { class: 'callout-title' } });
    }
  },
});
