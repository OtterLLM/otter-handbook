import { defineMdastPlugin } from 'satteri';

/**
 * An image that stands alone as its own paragraph is wrapped into a figure block (<figure>),
 * centered at the body's width.
 * The image's title becomes its caption:
 *
 *   ![loss curve when warmup is too short](./img/warmup-loss.png "the caption goes in the quotes")
 *
 * A captioned figure is numbered automatically (FIG. 01, 02, ...); styles are in
 * src/styles/prose.css.
 */
export const figures = defineMdastPlugin({
  name: 'handbook-figures',
  paragraph(node, ctx) {
    const kids = node.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
    if (kids.length !== 1 || kids[0].type !== 'image') return;
    const img = kids[0];
    ctx.setProperty(node, 'data', { hName: 'figure' });
    if (img.title) {
      ctx.appendChild(node, {
        type: 'paragraph',
        data: { hName: 'figcaption' },
        children: [{ type: 'text', value: img.title }],
      });
      ctx.setProperty(img, 'title', null);
    }
  },
});
