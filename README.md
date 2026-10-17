# mi-LYWSD02-clock-sync-ui

Set the time, time zone and temperature unit on a Xiaomi Mijia LYWSD02 Bluetooth clock straight from the browser, using Web Bluetooth.

**Live version:** https://khromov.github.io/mi-LYWSD02-clock-sync-ui/

Web Bluetooth is supported in Chrome and Edge on desktop and Android. For connection issues, open `chrome://bluetooth-internals/#devices/` in Chrome.

## Development

```sh
npm install
npm run dev
```

`npm run build` outputs a static site to `dist/`. Pushing to `main` deploys it to GitHub Pages via `.github/workflows/deploy.yml`.

## Credits

Based on code snippets from [web.dev](https://web.dev/bluetooth/) and [lywsd02](https://github.com/h4/lywsd02/blob/master/lywsd02/client.py). Thanks to [Harold De Armas](https://github.com/dearmash) for adding C/F support and [Mitja Pugelj](https://www.linkedin.com/in/mitjapugelj).
