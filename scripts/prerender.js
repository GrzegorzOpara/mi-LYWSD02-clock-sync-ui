// Renders the app to HTML after `vite build` so the page's text is in index.html before any
// JavaScript runs. The client then hydrates this markup (see src/main.js).
import fs from 'node:fs'

const template = fs.readFileSync('dist/index.html', 'utf8')
const { renderApp } = await import('../dist-ssr/entry-server.js')
const { head, body } = renderApp()

if (!template.includes('<!--app-html-->')) {
  throw new Error('dist/index.html is missing the <!--app-html--> placeholder')
}

fs.writeFileSync('dist/index.html', template.replace('<!--app-head-->', head).replace('<!--app-html-->', body))
fs.rmSync('dist-ssr', { recursive: true, force: true })
console.log('Prerendered dist/index.html')
