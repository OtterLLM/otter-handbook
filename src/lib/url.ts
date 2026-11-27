import type { Lang } from '../i18n';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * Internal links always go through here: it composes the deploy base path (GitHub Pages sub-path)
 * with the language prefix (English at the root, Chinese under `/zh`).
 * Static assets (favicon, …) use the default language, i.e. no prefix.
 */
export const url = (path = '/', lang: Lang = 'en') =>
  `${base}${lang === 'zh' ? '/zh' : ''}${path.startsWith('/') ? path : `/${path}`}`;

/** Absolute pathname (with base) → the language-neutral path, e.g. `/otter-handbook/zh/notes/` → `/notes/`. */
export const stripLang = (pathname: string) => {
  let p = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  if (p === '/zh' || p.startsWith('/zh/')) p = p.slice(3);
  return p.startsWith('/') ? p : `/${p}`;
};

export const isCurrent = (pathname: string, href: string, lang: Lang = 'en') => {
  const here = pathname.replace(/\/$/, '') || '/';
  const target = url(href, lang).replace(/\/$/, '') || '/';
  return href === '/' ? here === target : here === target || here.startsWith(`${target}/`);
};
