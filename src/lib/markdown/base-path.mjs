import { defineMdastPlugin } from 'satteri';

/**
 * Internal links and images in the body that start with `/` automatically get the deployment's
 * base path prepended.
 *
 * In local dev the site lives at `/`; on GitHub Pages it's at `/otter-handbook/`. Just write
 * `[attention](/handbook/attention/)` or `![](/images/a.png)` as usual, and the build turns it into
 * `/otter-handbook/handbook/attention/`. External links, relative paths starting with `./`, and
 * `#anchor` links are all left alone.
 * Raw HTML written directly in Markdown (`<a href="/...">`, `<img src="/...">`, `<video src="/...">`)
 * is handled the same way.
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
