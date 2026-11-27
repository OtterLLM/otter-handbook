import { getCollection, render, type CollectionEntry } from 'astro:content';
import { parts, type PartKey } from '../site.config';
import { t, type Lang } from '../i18n';

type Entry = CollectionEntry<'handbook'> | CollectionEntry<'handbookZh'>;
type NoteEntry = CollectionEntry<'notes'> | CollectionEntry<'notesZh'>;

/**
 * A chapter as seen from one site language. If the chapter has no file in that language, the entry of
 * the other language is used (`fallback: true`, `contentLang` tells which one); ids are the same in both.
 */
export interface Chapter {
  id: string;
  data: CollectionEntry<'handbook'>['data'];
  body?: string;
  entry: Entry;
  /** language the text is actually written in */
  contentLang: Lang;
  fallback: boolean;
  /** Chinese title, if a zh entry exists (used as the subtitle on English pages) */
  zhTitle?: string;
}

export interface Note {
  id: string;
  data: CollectionEntry<'notes'>['data'];
  entry: NoteEntry;
  contentLang: Lang;
  fallback: boolean;
}

export interface OutlineItem {
  title: string;
  items: string[];
  /** anchor of the matching section in the body (absent when categories come from frontmatter) */
  anchor?: string;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** Merge the two language collections: every id shows up once, in `lang` when available. */
function merge<E extends { id: string }>(en: E[], zh: E[], lang: Lang) {
  const own = new Map((lang === 'zh' ? zh : en).map((e) => [e.id, e]));
  const other = new Map((lang === 'zh' ? en : zh).map((e) => [e.id, e]));
  const otherLang: Lang = lang === 'zh' ? 'en' : 'zh';
  const ids = new Set([...own.keys(), ...other.keys()]);
  return [...ids].map((id) => {
    const mine = own.get(id);
    return mine
      ? { id, entry: mine, contentLang: lang, fallback: false }
      : { id, entry: other.get(id)!, contentLang: otherLang, fallback: true };
  });
}

/** All chapters, sorted by order. Chapters missing in `lang` fall back to the other language. */
export async function getChapters(lang: Lang): Promise<Chapter[]> {
  const [en, zh] = await Promise.all([getCollection('handbook'), getCollection('handbookZh')]);
  const zhTitles = new Map(zh.map((e) => [e.id, e.data.title]));
  return merge<Entry>(en, zh, lang)
    .map(({ id, entry, contentLang, fallback }) => ({
      id,
      data: entry.data,
      body: entry.body,
      entry,
      contentLang,
      fallback,
      zhTitle: zhTitles.get(id),
    }))
    .sort((a, b) => a.data.order - b.data.order);
}

/**
 * The small line under a chapter title: the English full name when the text is Chinese,
 * the Chinese title (tagged lang="zh-CN") when the text is English. May be absent.
 */
export function subtitle(c: Chapter): { text: string; lang?: string } | undefined {
  if (c.contentLang === 'zh') return { text: c.data.en };
  return c.zhTitle ? { text: c.zhTitle, lang: 'zh-CN' } : undefined;
}

/**
 * All visible notes (see isVisibleNote), newest first. Drafts are dropped per language *before* merging,
 * so a draft translation falls back to the other language (with the FallbackNotice) instead of leaving
 * a 404 behind the language switch / hreflang.
 */
export async function getNotes(lang: Lang): Promise<Note[]> {
  const [en, zh] = await Promise.all([getCollection('notes'), getCollection('notesZh')]);
  return merge<NoteEntry>(en.filter(isVisibleNote), zh.filter(isVisibleNote), lang)
    .map(({ id, entry, contentLang, fallback }) => ({ id, data: entry.data, entry, contentLang, fallback }))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** Group by "part", in the same order as `parts` in site.config.ts. */
export function groupByPart(chapters: Chapter[], lang: Lang) {
  const text = t(lang).parts;
  return (Object.keys(parts) as PartKey[]).map((key) => ({
    key,
    ...parts[key],
    ...text[key],
    chapters: chapters.filter((c) => c.data.part === key),
  }));
}

const outlines = new Map<string, Promise<OutlineItem[]>>();

/**
 * A chapter's "categories" -- used by both the hover card and the top of the chapter page.
 * If `categories` is set in frontmatter, use it; otherwise read the body's h2 (categories) and
 * h3 (items).
 * Anchors are matched against the headings of the entry that is actually rendered, so this works per language.
 */
export function getOutline(chapter: Chapter): Promise<OutlineItem[]> {
  const key = `${chapter.contentLang}/${chapter.id}`;
  if (!outlines.has(key)) outlines.set(key, computeOutline(chapter));
  return outlines.get(key)!;
}

async function computeOutline(chapter: Chapter): Promise<OutlineItem[]> {
  const { headings } = await render(chapter.entry);
  if (chapter.data.categories.length) {
    return chapter.data.categories.map((c) => ({
      ...c,
      anchor: headings.find((h) => h.depth === 2 && h.text.trim() === c.title)?.slug,
    }));
  }
  const outline: OutlineItem[] = [];
  for (const h of headings) {
    if (h.depth === 2) outline.push({ title: h.text, items: [], anchor: h.slug });
    else if (h.depth === 3) outline[outline.length - 1]?.items.push(h.text);
  }
  return outline;
}

/** ▓▓▓░░░░░ */
export function progressBar(progress: number, width = 8) {
  const filled = Math.round(Math.min(1, Math.max(0, progress)) * width);
  return { on: '▓'.repeat(filled), off: '░'.repeat(width - filled) };
}

export const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

/** Draft notes (`draft: true` in frontmatter) only show up in local `npm run dev`; excluded from the production build. */
export const isVisibleNote = ({ data }: { data: { draft: boolean } }) => import.meta.env.DEV || !data.draft;

/** The `lang` attribute for a block of content written in `lang`. */
export const contentLangAttr = (lang: Lang) => (lang === 'zh' ? 'zh-CN' : 'en');
