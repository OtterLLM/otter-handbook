import { defineMdastPlugin } from 'satteri';
import katex from 'katex';

const render = (tex, displayMode) =>
  katex.renderToString(tex, { displayMode, throwOnError: false, strict: 'ignore' });

/** `$...$` and `$$...$$` -> KaTeX (rendered at build time, so the page ships no JS for it). */
export const math = defineMdastPlugin({
  name: 'handbook-math',
  math(node) {
    return { type: 'html', value: `<div class="math-block">${render(node.value, true)}</div>` };
  },
  inlineMath(node) {
    return { type: 'html', value: render(node.value, false) };
  },
});
