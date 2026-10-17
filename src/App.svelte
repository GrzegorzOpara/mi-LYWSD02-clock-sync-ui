<script>
  import { onMount } from 'svelte'
  import {
    CELSIUS,
    FAHRENHEIT,
    getRememberedClocks,
    isBluetoothSupported,
    readStatus,
    requestClock,
    writeTime,
    writeUnit,
  } from './lib/lywsd02.js'
  import Icon from './lib/Icon.svelte'
  import { loadClocks, saveClocks } from './lib/savedClocks.js'
  import { formatOffset, getLocalTimeZone, getOffsetMinutes, groupTimeZones } from './lib/timezones.js'

  // The page is prerendered at build time, so anything that depends on the visitor's browser
  // (Bluetooth support, time zone, current time, saved clocks) starts out neutral and is filled
  // in on mount. That keeps the first client render identical to the prerendered HTML.
  let supported = $state(true)
  let localTimeZone = $state(null)
  let timeZoneGroups = $state([])
  let clocks = $state([])
  let loaded = $state(false)
  let useLocalZone = $state(true)
  let chosenZone = $state(null)
  let unit = $state(CELSIUS)
  let busy = $state(false)
  let connecting = $state(false)
  let logs = $state([])
  let now = $state(null)

  const selectedClocks = $derived(clocks.filter((clock) => clock.selected && clock.device))
  const hasDisconnected = $derived(clocks.some((clock) => !clock.device))
  const timeZone = $derived(useLocalZone ? localTimeZone : chosenZone)
  const offsetMinutes = $derived(timeZone && now ? getOffsetMinutes(timeZone, now) : 0)
  const clockTime = $derived.by(() => {
    if (!now) return '--:--'
    const shifted = new Date(now.getTime() + offsetMinutes * 60 * 1000)
    return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  })
  const clocksLabel = $derived(`${selectedClocks.length} clock${selectedClocks.length === 1 ? '' : 's'}`)

  onMount(async () => {
    supported = isBluetoothSupported()
    localTimeZone = chosenZone = getLocalTimeZone()
    timeZoneGroups = groupTimeZones([localTimeZone])
    now = new Date()
    // Saved clocks start disconnected: the browser has to hand out the Bluetooth device again.
    clocks = loadClocks().map((saved) => ({ ...saved, device: null, selected: true, status: null }))
    loaded = true

    for (const device of await getRememberedClocks()) {
      const clock = clocks.find((c) => c.deviceId === device.id)
      if (clock) clock.device = device
    }
    const remembered = clocks.filter((clock) => clock.device)
    if (remembered.length > 0) {
      await runOn(remembered, 'Reconnecting', refresh)
    }
  })

  // Wait for the saved list to load, or the initial empty list would overwrite it.
  $effect(() => {
    if (loaded) saveClocks(clocks)
  })

  $effect(() => {
    const timer = setInterval(() => (now = new Date()), 1000)
    return () => clearInterval(timer)
  })

  /** Keeps the activity log scrolled to the newest entry. */
  function followLog(el) {
    logs.length
    el.scrollTo({ top: el.scrollHeight })
  }

  function pad(n) {
    return String(n).padStart(2, '0')
  }

  function log(message) {
    console.log(message)
    logs.push({ time: new Date().toLocaleTimeString(), message: String(message) })
  }

  function errorMessage(error) {
    return error?.message || String(error)
  }

  function clockName(clock) {
    return clock.nickname?.trim() || `Clock ${clock.number}`
  }

  function formatTemperature(celsius, clockUnit) {
    return clockUnit === FAHRENHEIT ? `${((celsius * 9) / 5 + 32).toFixed(1)} °F` : `${celsius.toFixed(1)} °C`
  }

  function formatWhen(timestamp) {
    const date = new Date(timestamp)
    return date.toDateString() === new Date().toDateString()
      ? date.toLocaleTimeString([], { timeStyle: 'short' })
      : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  }

  /** How far the time on the clock is from the selected time zone. */
  function formatDrift(seconds) {
    const abs = Math.abs(seconds)
    const direction = seconds > 0 ? 'ahead' : 'behind'
    if (abs < 5) return 'On time'
    if (abs < 60) return `${abs} s ${direction}`
    const minutes = Math.round(abs / 60)
    const hours = Math.floor(minutes / 60)
    return `${hours ? `${hours} h ` : ''}${minutes % 60 ? `${minutes % 60} min ` : ''}${direction}`
  }

  function createClock() {
    const number = Math.max(0, ...clocks.map((clock) => clock.number)) + 1
    clocks.push({
      id: crypto.randomUUID(),
      number,
      nickname: '',
      deviceId: null,
      hardwareId: null,
      macSuffix: null,
      reading: null,
      readAt: null,
      device: null,
      selected: true,
      status: null,
    })
    // Return the reactive proxy rather than the plain object that was pushed.
    return clocks.at(-1)
  }

  function applyReading(clock, { hardwareId, macSuffix, ...reading }) {
    clock.reading = reading
    clock.readAt = Date.now()
    if (hardwareId) clock.hardwareId = hardwareId
    if (macSuffix) clock.macSuffix = macSuffix
  }

  /**
   * Lets the user pick a clock in the browser's chooser and matches it to a saved clock: by
   * hardware id (stable across browser sessions), then by browser device id, then to the row
   * whose Reconnect button was pressed. Anything else is added as a new clock.
   */
  async function pickClock(target = null, showAllDevices = false) {
    let device
    try {
      device = await requestClock(showAllDevices)
    } catch (error) {
      log(errorMessage(error))
      return
    }

    busy = connecting = true
    if (target) target.status = { type: 'busy', text: 'Connecting…' }
    log(`Connecting to ${device.name || 'device'}…`)

    let reading = null
    let failure = null
    try {
      reading = await readStatus(device)
    } catch (error) {
      failure = error
    } finally {
      busy = connecting = false
    }

    const clock =
      (reading?.hardwareId && clocks.find((c) => c.hardwareId === reading.hardwareId)) ||
      clocks.find((c) => c.deviceId === device.id) ||
      (target && !target.device ? target : null) ||
      createClock()

    if (target && target !== clock) {
      target.status = null
      log(`That was ${clockName(clock)}, not ${clockName(target)}.`)
    }

    clock.device = device
    clock.deviceId = device.id
    if (failure) {
      clock.status = { type: 'error', text: errorMessage(failure) }
      log(`${clockName(clock)}: ${errorMessage(failure)}`)
    } else {
      applyReading(clock, reading)
      clock.status = { type: 'ok', text: `Connected at ${formatWhen(Date.now())}` }
      log(`${clockName(clock)}: connected.`)
    }
  }

  async function removeClock(clock) {
    clocks = clocks.filter((c) => c !== clock)
    log(`Removed ${clockName(clock)}.`)
    try {
      // Revoke the site's access so the clock isn't remembered on the next visit.
      await clock.device?.forget?.()
    } catch {
      // Best effort: not all browsers support forget().
    }
  }

  /** Runs `action` on each clock in turn; one GATT connection at a time is the most reliable. */
  async function runOn(targets, verb, action) {
    busy = true
    try {
      for (const clock of targets) {
        clock.status = { type: 'busy', text: `${verb}…` }
        try {
          const text = await action(clock)
          clock.status = { type: 'ok', text }
          log(`${clockName(clock)}: ${text}`)
        } catch (error) {
          clock.status = { type: 'error', text: errorMessage(error) }
          log(`${clockName(clock)}: ${errorMessage(error)}`)
        }
      }
    } finally {
      busy = false
    }
  }

  async function refresh(clock) {
    applyReading(clock, await readStatus(clock.device))
    return `Read at ${formatWhen(Date.now())}`
  }

  async function syncTime(clock) {
    const displayOffset = await writeTime(clock.device, offsetMinutes)
    clock.reading = { ...clock.reading, displayOffset }
    clock.readAt = Date.now()
    return `Time synced at ${formatWhen(Date.now())}`
  }

  async function syncUnit(clock) {
    await writeUnit(clock.device, unit)
    clock.reading = { ...clock.reading, unit }
    return `Unit set to ${unit === FAHRENHEIT ? '°F' : '°C'}`
  }
</script>

<main>
  <header class="app-header">
    <!-- Relative path from public/: an imported asset would be prerendered with an absolute URL. -->
    <img class="thumb" src="./lywsd02.webp" alt="Xiaomi LYWSD02 clock" width="64" height="64" />
    <div>
      <h1>Clock sync</h1>
      <p class="muted">Time, time zone and units for Xiaomi LYWSD02 &amp; LYWSD02MMC clocks</p>
    </div>
  </header>

  {#if !supported}
    <p class="banner warning">
      <Icon name="alert" />
      Web Bluetooth isn't available in this browser. Use Chrome or Edge on desktop or Android.
    </p>
  {/if}

  <section>
    <div class="section-head">
      <h2>Clocks</h2>
      {#if clocks.length > 0}
        <button
          class="ghost"
          disabled={!supported || busy || selectedClocks.length === 0}
          onclick={() => runOn(selectedClocks, 'Reading', refresh)}
        >
          <Icon name="refresh" size={14} />
          Refresh
        </button>
      {/if}
    </div>

    <div class="card">
      {#if clocks.length === 0}
        <div class="empty">
          <div class="empty-icon"><Icon name="bluetooth" size={22} /></div>
          <p><strong>No clocks yet</strong></p>
          <p class="muted">Add each of your clocks once. The browser only lets you pick one at a time.</p>
        </div>
      {:else}
        {#if hasDisconnected && !busy}
          <p class="notice">
            After a reload, the browser needs you to pick each clock again: press <strong>Reconnect</strong> and choose it
            from the list.
          </p>
        {/if}
        <ul class="clocks">
          {#each clocks as clock (clock.id)}
            {@const drift = clock.reading?.displayOffset != null ? clock.reading.displayOffset - offsetMinutes * 60 : null}
            <li class={{ offline: !clock.device }}>
              <input
                class="check"
                type="checkbox"
                bind:checked={clock.selected}
                disabled={!clock.device}
                aria-label="Include {clockName(clock)}"
              />
              <div class="clock-title">
                <input
                  class="nickname"
                  bind:value={clock.nickname}
                  placeholder="Clock {clock.number}"
                  aria-label="Name of {clockName(clock)}"
                  title="Click to rename"
                  maxlength="40"
                />
                {#if clock.macSuffix}
                  <span class="mac" title="End of the clock's Bluetooth MAC address">…{clock.macSuffix}</span>
                {/if}
              </div>

              <div class="clock-actions">
                {#if !clock.device}
                  <button class="chip" disabled={!supported || busy} onclick={() => pickClock(clock)}>Reconnect</button>
                {/if}
                <button
                  class="icon-button"
                  disabled={busy}
                  onclick={() => removeClock(clock)}
                  aria-label="Remove {clockName(clock)}"
                  title="Remove"
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>

              <!-- Spans under the actions too, so narrow screens don't waste the right column. -->
              <div class="clock-details">
                {#if clock.reading && (clock.reading.temperature != null || clock.reading.battery != null)}
                  <div class="stats">
                    {#if clock.reading.temperature != null}
                      <span><Icon name="thermometer" size={14} />{formatTemperature(clock.reading.temperature, clock.reading.unit)}</span>
                      <span><Icon name="droplet" size={14} />{clock.reading.humidity}%</span>
                    {/if}
                    {#if clock.reading.battery != null}
                      <span class={{ low: clock.reading.battery < 20 }}>
                        <Icon name="battery" size={14} level={clock.reading.battery} />{clock.reading.battery}%
                      </span>
                    {/if}
                  </div>
                {/if}

                <div class="meta">
                  {#if drift != null}
                    <span class={['badge', { ok: Math.abs(drift) < 60, warn: Math.abs(drift) >= 60 }]}>
                      {formatDrift(drift)}
                    </span>
                  {/if}
                  {#if clock.status}
                    <span class="status {clock.status.type}">
                      {#if clock.status.type === 'busy'}<span class="spinner"></span>{/if}
                      {clock.status.text}
                    </span>
                  {:else if !clock.device}
                    <span class="status">
                      Not connected{clock.readAt ? ` · last read ${formatWhen(clock.readAt)}` : ''}
                    </span>
                  {/if}
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="card-footer">
        <button class="secondary" disabled={!supported || busy} onclick={() => pickClock()}>
          <Icon name="plus" />
          Add clock
        </button>
        {#if connecting}
          <span class="status busy"><span class="spinner"></span>Connecting…</span>
        {/if}
      </div>
    </div>

    <details class="card disclosure">
      <summary>
        <span class="disclosure-icon"><Icon name="help" size={18} /></span>
        <span class="disclosure-label">
          Troubleshooting
          <span class="muted small">Missing clocks, Mi Home, factory reset</span>
        </span>
        <span class="chevron"><Icon name="chevron" size={18} /></span>
      </summary>
      <div class="tips">
        <div class="tip">
          <h3>Not in the list?</h3>
          <p>The browser's list only shows LYWSD02 clocks. If yours is missing, pick it from all nearby devices.</p>
          <button class="secondary compact" disabled={!supported || busy} onclick={() => pickClock(null, true)}>
            <Icon name="bluetooth" />
            Show all Bluetooth devices
          </button>
        </div>
        <div class="tip">
          <h3>Connected to something else?</h3>
          <p>
            Close the Mi Home / Xiaomi Home app and disconnect the clock from phones, hubs or Home Assistant. A clock
            that's connected elsewhere stops showing up.
          </p>
        </div>
        <div class="tip">
          <h3>Out of range?</h3>
          <p>Move closer to the clock and check its battery.</p>
        </div>
        <div class="tip">
          <h3>Set up in Mi Home?</h3>
          <p>
            That works too, but the clock doesn't broadcast its name, so it shows up as "Unknown or unsupported
            device".
          </p>
        </div>
        <div class="tip">
          <h3>Addresses don't match on a Mac?</h3>
          <p>
            Chrome on macOS makes up the addresses in its device list. The MAC shown here (and in Mi Home) is the real
            one.
          </p>
        </div>
        <div class="tip">
          <h3>Still stuck?</h3>
          <p>
            Factory reset the clock: remove the back cover and, while it's running, connect the
            <strong>Reset</strong> and <strong>Gnd</strong> metal points next to a battery with something metal (e.g. a
            paperclip) for more than 7 seconds. Delete it in Mi Home if it was set up there, then add it here again.
          </p>
        </div>
      </div>
    </details>
  </section>

  <section>
    <h2>Time</h2>
    <div class="card padded">
      <div class="preview">
        <span class="muted small">Clocks will show</span>
        <span class="preview-time">{clockTime}</span>
        <!-- Non-breaking space keeps the line height until the time zone is known. -->
        <span class="muted small">
          {timeZone ? `${formatOffset(offsetMinutes)} · ${timeZone.replaceAll('_', ' ')}` : ' '}
        </span>
      </div>

      <label class="setting">
        <span>
          <span class="setting-label">Use this device's time zone</span>
          <span class="muted small">{localTimeZone?.replaceAll('_', ' ') ?? ' '}</span>
        </span>
        <input class="switch" type="checkbox" role="switch" bind:checked={useLocalZone} />
      </label>

      {#if !useLocalZone}
        <select bind:value={chosenZone} aria-label="Time zone">
          {#each timeZoneGroups as group (group.region)}
            <optgroup label={group.region}>
              {#each group.zones as zone (zone.id)}
                <option value={zone.id}>{zone.label}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      {/if}

      <button
        class="primary"
        disabled={!supported || busy || selectedClocks.length === 0}
        onclick={() => runOn(selectedClocks, 'Syncing time', syncTime)}
      >
        Sync time on {clocksLabel}
      </button>
    </div>
  </section>

  <section>
    <h2>Temperature unit</h2>
    <div class="card padded">
      <div class="segmented" role="radiogroup" aria-label="Temperature unit">
        <label>
          <input type="radio" bind:group={unit} value={CELSIUS} />
          <span>°C Celsius</span>
        </label>
        <label>
          <input type="radio" bind:group={unit} value={FAHRENHEIT} />
          <span>°F Fahrenheit</span>
        </label>
      </div>
      <button
        class="secondary"
        disabled={!supported || busy || selectedClocks.length === 0}
        onclick={() => runOn(selectedClocks, 'Setting unit', syncUnit)}
      >
        Set unit on {clocksLabel}
      </button>
    </div>
  </section>

  <details class="card disclosure log">
    <summary>
      <span class="disclosure-icon"><Icon name="list" size={18} /></span>
      <span class="disclosure-label">
        Activity log
        <span class="muted small">{logs.length ? `${logs.length} entr${logs.length === 1 ? 'y' : 'ies'}` : 'Nothing yet'}</span>
      </span>
      <span class="chevron"><Icon name="chevron" size={18} /></span>
    </summary>
    <div class="console" {@attach followLog} aria-live="polite">
      {#each logs as entry, i (i)}
        <div><span class="muted">{entry.time}</span> {entry.message}</div>
      {:else}
        <div class="muted">Nothing yet.</div>
      {/each}
    </div>
  </details>

  <footer>
    <p>
      Inspired by the original
      <a href="https://saso5.github.io/LYWSD02-clock-sync/" target="_blank" rel="noopener">LYWSD02 Clock sync</a>. Based
      on code snippets from
      <a href="https://web.dev/bluetooth/" target="_blank" rel="noopener">web.dev</a>,
      <a href="https://github.com/h4/lywsd02/blob/master/lywsd02/client.py" target="_blank" rel="noopener">lywsd02</a>
      and
      <a href="https://github.com/muro-dot/lywsd02-ble-android-app" target="_blank" rel="noopener">lywsd02-ble-android-app</a>.
      Special thanks to
      <a href="https://github.com/dearmash" target="_blank" rel="noopener">Harold De Armas</a> for adding C/F support and
      <a href="https://www.linkedin.com/in/mitjapugelj" target="_blank" rel="noopener">Mitja Pugelj</a>.
    </p>
    <p>For connection issues, open <code>chrome://bluetooth-internals/#devices/</code> in Chrome.</p>
    <p>
      <a href="https://github.com/khromov/mi-LYWSD02-clock-sync-ui" target="_blank" rel="noopener">Source on GitHub</a>
    </p>
  </footer>
</main>
