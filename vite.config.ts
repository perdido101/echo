import { defineConfig } from 'vite';

// IMPORTANT: `base` MUST match the GitHub Pages sub-path (the repo name),
// otherwise the built JS/CSS/asset URLs 404 on the live site.
// Repo: perdido101/echo  ->  served at https://perdido101.github.io/echo/
export default defineConfig({
  base: '/echo/',
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
