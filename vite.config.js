import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works under the GitHub Pages project path
  // (/mi-LYWSD02-clock-sync-ui/) as well as at a domain root.
  base: './',
  plugins: [svelte()],
})
