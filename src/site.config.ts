/**
 * Site-level config. The name and repo URL are each changed in exactly one place, here.
 * Language-dependent text (tagline, descriptions, nav labels, part titles, status and kind labels)
 * lives in src/i18n/ui.ts; this file only holds what is the same in every language.
 */
export const site = {
  /** Project name (tentative). Read here by the header, the page title, and the footer's big type */
  name: 'otter',
  version: 'v0.1',
  repo: 'https://github.com/OtterLLM/otter-handbook',
  author: 'Skystellan',
  /** `key` indexes `ui.nav` */
  nav: [
    { href: '/handbook/', key: 'handbook' },
    { href: '/notes/', key: 'notes' },
    { href: '/papers/', key: 'papers' },
    { href: '/about/', key: 'about' },
  ],
} as const;

/** The handbook's three parts, deciding the table-of-contents grouping and the sections on the architecture diagram (titles and leads are in ui.parts) */
export const parts = {
  model: { no: 'I', en: 'MODEL' },
  training: { no: 'II', en: 'TRAINING' },
  after: { no: 'III', en: 'AFTER' },
} as const;

export type PartKey = keyof typeof parts;

export type StatusKey = 'planned' | 'draft' | 'review' | 'stable';

/** Callout / note kinds: marks and short codes; names and descriptions are in ui.kinds */
export const kinds = {
  obs: { mark: '◆', en: 'OBS' },
  lit: { mark: '◇', en: 'LIT' },
  recipe: { mark: '▲', en: 'RECIPE' },
  pitfall: { mark: '✕', en: 'PITFALL' },
  open: { mark: '?', en: 'OPEN' },
} as const;

export type KindKey = keyof typeof kinds;
