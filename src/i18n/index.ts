/**
 * i18n: English is the default site (served at the root), Chinese lives under `/zh/`.
 * Every user-visible string of the UI is in ./ui.ts; chapter and note content comes from
 * the `en/` and `zh/` folders under src/content.
 */
import { ui, type Ui } from './ui';

export type Lang = 'en' | 'zh';

export const langs: Lang[] = ['en', 'zh'];
export const defaultLang: Lang = 'en';

/** Value for `<html lang>` and hreflang. */
export const htmlLang: Record<Lang, string> = { en: 'en', zh: 'zh-CN' };

/** Rest-param value of `src/pages/[...lang]/…`: `undefined` is the root (English), `zh` the Chinese tree. */
export const getLang = (param: string | undefined): Lang => (param === 'zh' ? 'zh' : 'en');

/**
 * `getStaticPaths` entries for the `[...lang]` rest param. Must return a fresh array each time:
 * Astro attaches a lookup table to the array it gets.
 */
export const langParams = () => langs.map((l) => ({ params: { lang: l === defaultLang ? undefined : l } }));
/** The rest-param value of a language */
export const langParam = (l: Lang) => (l === defaultLang ? undefined : l);

export const t = (lang: Lang): Ui => ui[lang];

export type { Ui };
