import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** `05-attention.md` -> id `attention`: the filename carries a number for sorting, left out of the URL. */
const stripOrder = ({ entry }: { entry: string }) =>
  entry.replace(/\.md$/, '').replace(/^\d+-/, '');

/**
 * Handbook chapters -- each file corresponds to one component on the architecture diagram.
 * The "categories" shown on the hover card come from `categories` here;
 * if it's left unset, it falls back to the h2 / h3 headings in the body text.
 */
const handbookSchema = z.object({
    order: z.number().int(),
    part: z.enum(['model', 'training', 'after']),
    /** Title, in the language of the folder the file is in (the zh title is also the subtitle on English pages) */
    title: z.string(),
    /** label drawn on the diagram: plain ASCII, all caps, as short as possible */
    label: z.string().regex(/^[A-Z0-9 \-]+$/),
    /** Full English name (shown as the subtitle on Chinese pages) */
    en: z.string(),
    blurb: z.string(),
    /** small text inside the box on the narrow diagram: "today's default choice" */
    hint: z.string().optional(),
    /** small text to the right of the box on the wide diagram: what kinds of approaches belong here. Plain ASCII, separated by two spaces, at most 28 characters */
    variants: z.string().regex(/^[\x20-\x7e]+$/).max(28).optional(),
    status: z.enum(['planned', 'draft', 'review', 'stable']).default('planned'),
    progress: z.number().min(0).max(1).default(0),
    updated: z.coerce.date().optional(),
    categories: z
      .array(z.object({ title: z.string(), items: z.array(z.string()).default([]) }))
      .default([]),
});

/** English chapters (the default site) and Chinese chapters (`/zh/`): same schema, same ids. */
const handbook = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/handbook/en', generateId: stripOrder }),
  schema: handbookSchema,
});
const handbookZh = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/handbook/zh', generateId: stripOrder }),
  schema: handbookSchema,
});

/** Observations / notes -- a running log in time order, each one can attach to one or more chapters. */
const noteSchema = z.object({
    title: z.string(),
    date: z.coerce.date(),
    kind: z.enum(['obs', 'lit', 'recipe', 'pitfall', 'open']).default('obs'),
    /** ids of the chapters it's linked to, e.g. [attention, schedule] */
    components: z.array(z.string()).default([]),
    summary: z.string().optional(),
    /** sample entries are flagged on the page, so they're easy to remove later */
    sample: z.boolean().default(false),
    draft: z.boolean().default(false),
});

const notes = defineCollection({ loader: glob({ pattern: '*.md', base: './src/content/notes/en' }), schema: noteSchema });
const notesZh = defineCollection({ loader: glob({ pattern: '*.md', base: './src/content/notes/zh' }), schema: noteSchema });

/** Papers -- one YAML file, one entry per paper. */
const papers = defineCollection({
  loader: file('./src/data/papers.yaml'),
  schema: z.object({
    title: z.string(),
    authors: z.string(),
    year: z.number().int(),
    venue: z.string().optional(),
    url: z.url().optional(),
    components: z.array(z.string()).default([]),
    /** One line: what this paper means for training small models (English) */
    takeaway: z.string().optional(),
    /** One line (Chinese). If missing, the Chinese site falls back to the English one */
    takeaway_zh: z.string().optional(),
  }),
});

export const collections = { handbook, handbookZh, notes, notesZh, papers };
