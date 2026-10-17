import { hydrate, mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// Production builds are prerendered (scripts/prerender.js); the dev server serves an empty page.
const app = (import.meta.env.DEV ? mount : hydrate)(App, {
  target: document.getElementById('app'),
})

export default app
