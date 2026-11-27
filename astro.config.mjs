import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import { callouts } from './src/lib/markdown/callouts.mjs';
import { math } from './src/lib/markdown/math.mjs';
import { basePath } from './src/lib/markdown/base-path.mjs';
import { figures } from './src/lib/markdown/figures.mjs';

// In local dev, the site lives at the root path `/`;
// on GitHub Pages it lives at the sub-path `/otter-handbook/`, passed in via BASE_PATH in
// .github/workflows/deploy.yml.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://otterllm.github.io',
  base,
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  markdown: {
    processor: satteri({
      features: { math: true, directive: true, headingAttributes: true },
      mdastPlugins: [callouts, math, basePath(base), figures],
    }),
    // code highlighting: one color scheme each for light and dark, picked by src/styles/prose.css based on the current theme
    shikiConfig: {
      themes: { light: 'vitesse-light', dark: 'vitesse-dark' },
      defaultColor: false,
      wrap: false,
    },
  },
});
