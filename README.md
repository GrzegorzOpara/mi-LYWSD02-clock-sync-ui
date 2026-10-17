# mi-LYWSD02-clock-sync-ui

Set the time, time zone and temperature unit on one or more Xiaomi Mijia LYWSD02 Bluetooth clocks straight from the browser, using Web Bluetooth. Each clock's temperature, humidity, battery level and how far its time is off are shown in a list.

**Live version:** https://khromov.github.io/mi-LYWSD02-clock-sync-ui/

Web Bluetooth is supported in Chrome and Edge on desktop and Android. For connection issues, open `chrome://bluetooth-internals/#devices/` in Chrome.

## Multiple clocks

Browsers only let a page pick one Bluetooth device at a time, so press **Add clock** once per clock. Every action applies to the checked clocks. Click a clock's name to give it a nickname.

The chooser lists devices whose name starts with `LYWSD02`, plus devices whose Xiaomi manufacturer data (company `0x038F`) carries an LYWSD02 / LYWSD02MMC product id (`0x045B`, `0x2542`, `0x16E4`). The second filter is needed because clocks bound to Mi Home only send encrypted adverts without a name.

The list, nicknames and last readings are saved in localStorage. After a reload:

- By default, Chrome no longer gives the page access to the clocks, so each one shows a **Reconnect** button that opens the chooser again. The picked clock is recognized by a hash of its System ID (`0x2A23`), so it's matched to the right entry even after a browser restart or if you pick a different clock than the row you clicked.
- With `chrome://flags/#enable-experimental-web-platform-features` (and `chrome://flags/#enable-web-bluetooth-new-permissions-backend` to keep access across browser restarts), the page uses `navigator.bluetooth.getDevices()` to reconnect to all saved clocks automatically.

## Troubleshooting

- A clock that's connected to something else (the Mi Home app, a hub, Home Assistant) stops advertising and won't show up.
- If a clock bound to Mi Home won't connect, delete it in the Mi Home app and factory reset it. From the LYWSD02MMC manual: remove the back cover and, while the clock is running, connect the "Reset" and "Gnd" metal points near a battery with a metal conductor for more than 7 seconds. The clock restarts with factory settings.

## Time zones

The clock stores the time as a UTC timestamp plus a whole-hour zone. For zones with a 30 or 45 minute offset (e.g. India, Newfoundland, Nepal), the leftover minutes are added to the timestamp so the clock shows the correct local time. Daylight saving time is applied when syncing, so re-sync after a DST change.

## Development

```sh
npm install
npm run dev
```

`npm run build` outputs a static site to `dist/`. Pushing to `main` deploys it to GitHub Pages via `.github/workflows/deploy.yml`.

## Credits

Based on code snippets from [web.dev](https://web.dev/bluetooth/) and [lywsd02](https://github.com/h4/lywsd02/blob/master/lywsd02/client.py). Thanks to [Harold De Armas](https://github.com/dearmash) for adding C/F support and [Mitja Pugelj](https://www.linkedin.com/in/mitjapugelj).
