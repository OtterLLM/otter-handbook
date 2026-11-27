/**
 * 站点级配置。名字、仓库地址都只在这里改一次。
 * Language-dependent text (tagline, descriptions, nav labels, part titles, status and kind labels)
 * lives in src/i18n/ui.ts; this file only holds what is the same in every language.
 */
export const site = {
  /** 项目名（暂定）。页头、标题、页脚大字都读这里 */
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

/** 手册的三个部分，决定目录分组与架构图上的分区（标题和导语见 ui.parts） */
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
