import { defineMdastPlugin } from 'satteri';

/**
 * 正文里以 `/` 开头的站内链接和图片，自动补上部署的子路径。
 *
 * 本地开发时站点在 `/`，GitHub Pages 上在 `/otter-handbook/`。写作时照常写
 * `[注意力](/handbook/attention/)` 或 `![](/images/a.png)` 就行，构建时会变成
 * `/otter-handbook/handbook/attention/`。外链、`./` 开头的相对路径、`#锚点` 都不动。
 * Markdown 里直接写的 HTML（`<a href="/…">`、`<img src="/…">`、`<video src="/…">`）也一并处理。
 */
export const basePath = (base = '/') => {
  const prefix = base.replace(/\/$/, '');
  const fix = (u) =>
    prefix &&
    typeof u === 'string' &&
    u.startsWith('/') &&
    !u.startsWith('//') &&
    u !== prefix &&
    !u.startsWith(`${prefix}/`)
      ? prefix + u
      : u;
  // Chinese sources live under src/content/**/zh/: their internal page links get the `/zh` prefix too
  // (only links to site pages, not images or other assets).
  const pages = /^\/(handbook|notes|papers|about|lab)(\/|$)|^\/$/;
  const isZh = (ctx) => /\/zh\//.test(ctx.fileURL?.pathname ?? '');
  const lang = (u, zh) => (zh && typeof u === 'string' && pages.test(u) ? `/zh${u === '/' ? '/' : u}` : u);

  const fixUrl = (node, ctx, page = false) => {
    const u = fix(page ? lang(node.url, isZh(ctx)) : node.url);
    if (u !== node.url) ctx.setProperty(node, 'url', u);
  };
  const attr = /(\s(href|src|poster)\s*=\s*)(["'])(\/[^"']*)\3/g;

  return defineMdastPlugin({
    name: 'handbook-base-path',
    link: (node, ctx) => fixUrl(node, ctx, true),
    image: fixUrl,
    definition: (node, ctx) => fixUrl(node, ctx, true),
    html(node, ctx) {
      const zh = isZh(ctx);
      const v = node.value.replace(attr, (m, lead, name, q, u) => `${lead}${q}${fix(name === 'href' ? lang(u, zh) : u)}${q}`);
      if (v !== node.value) ctx.setProperty(node, 'value', v);
    },
  });
};
