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
  import { loadClocks, saveClocks } from './lib/savedClocks.js'
  import { formatOffset, getLocalTimeZone, getOffsetMinutes, groupTimeZones } from './lib/timezones.js'

  const supported = isBluetoothSupported()
  const localTimeZone = getLocalTimeZone()
  const timeZoneGroups = groupTimeZones([localTimeZone])

  // Saved clocks start disconnected: the browser has to hand out the Bluetooth device again.
  let clocks = $state(loadClocks().map((saved) => ({ ...saved, device: null, selected: true, status: null })))
  let timeZone = $state(localTimeZone)
  let unit = $state(CELSIUS)
  let busy = $state(false)
  let connecting = $state(false)
  let logs = $state([])
  let now = $state(new Date())
  let consoleEl

  const selectedClocks = $derived(clocks.filter((clock) => clock.selected && clock.device))
  const hasDisconnected = $derived(clocks.some((clock) => !clock.device))
  const offsetMinutes = $derived(getOffsetMinutes(timeZone, now))
  const clockTime = $derived.by(() => {
    const shifted = new Date(now.getTime() + offsetMinutes * 60 * 1000)
    return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  })
  const clocksLabel = $derived(`${selectedClocks.length} clock${selectedClocks.length === 1 ? '' : 's'}`)

  onMount(async () => {
    for (const device of await getRememberedClocks()) {
      const clock = clocks.find((c) => c.deviceId === device.id)
      if (clock) clock.device = device
    }
    const remembered = clocks.filter((clock) => clock.device)
    if (remembered.length > 0) {
      await runOn(remembered, 'Reconnecting', refresh)
    }
  })

  $effect(() => saveClocks(clocks))

  $effect(() => {
    const timer = setInterval(() => (now = new Date()), 1000)
    return () => clearInterval(timer)
  })

  $effect(() => {
    logs.length
    consoleEl?.scrollTo({ top: consoleEl.scrollHeight })
  })

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
    if (abs < 5) return 'Time is correct'
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
      reading: null,
      readAt: null,
      device: null,
      selected: true,
      status: null,
    })
    // Return the reactive proxy rather than the plain object that was pushed.
    return clocks.at(-1)
  }

  function applyReading(clock, { hardwareId, ...reading }) {
    clock.reading = reading
    clock.readAt = Date.now()
    if (hardwareId) clock.hardwareId = hardwareId
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
  <header>
    <img
      src="https://imgaz3.staticbg.com/thumb/large/oaupload/banggood/images/74/DF/f05ddb02-4334-48a1-8785-39c4a5d9d9c1.jpg.webp"
      alt="Xiaomi Mijia LYWSD02 clock"
      width="120"
      height="120"
    />
    <div>
      <h1>LYWSD02 Clock sync</h1>
      <p class="subtitle">
        Xiaomi Mijia BT4.0 Wireless Smart Electric Digital Clock Indoor &amp; Outdoor Hygrometer
        Thermometer
      </p>
    </div>
  </header>

  {#if !supported}
    <p class="warning">
      Web Bluetooth is not available in this browser. Use Chrome or Edge on desktop or Android.
    </p>
  {/if}

  <fieldset>
    <legend>Clocks</legend>
    {#if clocks.length === 0}
      <p class="hint">
        No clocks yet. Press <strong>Add clock</strong> and pick a clock from the browser's list. The
        browser only allows picking one at a time, so repeat this for each clock.
      </p>
    {:else}
      {#if hasDisconnected && !busy}
        <p class="hint">
          After a reload, the browser needs you to pick each clock again: press <strong>Reconnect</strong> and choose
          it from the list.
        </p>
      {/if}
      <ul class="clocks">
        {#each clocks as clock (clock.id)}
          <li>
            <div class="clock-name">
              <input
                type="checkbox"
                bind:checked={clock.selected}
                disabled={!clock.device}
                aria-label="Include {clockName(clock)}"
              />
              <input
                class="nickname"
                bind:value={clock.nickname}
                placeholder="Clock {clock.number}"
                aria-label="Name of {clockName(clock)}"
                title="Click to rename"
                maxlength="40"
              />
            </div>
            <button class="link" disabled={busy} onclick={() => removeClock(clock)}>Remove</button>

            {#if clock.reading}
              <div class="readings">
                {#if clock.reading.temperature != null}
                  <span>{formatTemperature(clock.reading.temperature, clock.reading.unit)}</span>
                  <span>{clock.reading.humidity}% humidity</span>
                {/if}
                {#if clock.reading.battery != null}
                  <span class:low={clock.reading.battery < 20}>Battery {clock.reading.battery}%</span>
                {/if}
              </div>
              {#if clock.reading.displayOffset != null}
                {@const drift = clock.reading.displayOffset - offsetMinutes * 60}
                <div class="drift" class:off={Math.abs(drift) >= 60}>{formatDrift(drift)}</div>
              {/if}
            {/if}

            {#if clock.status}
              <div class="status {clock.status.type}">{clock.status.text}</div>
            {:else if !clock.device}
              <div class="status">
                Not connected{clock.readAt ? ` · last read ${formatWhen(clock.readAt)}` : ''}
                <button class="link" disabled={!supported || busy} onclick={() => pickClock(clock)}>Reconnect</button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <div class="actions">
      <button disabled={!supported || busy} onclick={() => pickClock()}>Add clock</button>
      {#if clocks.length > 0}
        <button
          class="secondary"
          disabled={!supported || busy || selectedClocks.length === 0}
          onclick={() => runOn(selectedClocks, 'Reading', refresh)}
        >
          Refresh readings
        </button>
      {/if}
      {#if connecting}
        <span class="hint">Connecting…</span>
      {/if}
    </div>
    <button class="link" disabled={!supported || busy} onclick={() => pickClock(null, true)}>
      Clock not listed? Show all Bluetooth devices
    </button>
    <details class="help">
      <summary>Clock missing or not connecting?</summary>
      <ul>
        <li>
          Close the Mi Home / Xiaomi Home app and disconnect the clock from anything else (phone, hub, Home
          Assistant). A clock that's connected elsewhere stops showing up.
        </li>
        <li>Move closer to the clock and check its battery.</li>
        <li>
          Clocks set up in Mi Home don't broadcast their name, so they show up without one (e.g. "Unknown or
          unsupported device") in the browser's list.
        </li>
        <li>
          If a clock set up in Mi Home still won't connect, delete it in the Mi Home app and factory reset it:
          remove the back cover and, while the clock is running, connect the <strong>Reset</strong> and
          <strong>Gnd</strong> metal points next to a battery with something metal (e.g. a paperclip) for more
          than 7 seconds. The clock restarts with factory settings; then add it here again.
        </li>
      </ul>
    </details>
  </fieldset>

  <fieldset>
    <legend>Time sync</legend>
    <label>
      Time zone
      <select bind:value={timeZone}>
        {#each timeZoneGroups as group (group.region)}
          <optgroup label={group.region}>
            {#each group.zones as zone (zone.id)}
              <option value={zone.id}>{zone.label}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </label>
    {#if timeZone !== localTimeZone}
      <button class="link" onclick={() => (timeZone = localTimeZone)}>Use my time zone ({localTimeZone})</button>
    {/if}
    <p class="hint">Clocks will show <strong>{clockTime}</strong> ({formatOffset(offsetMinutes)})</p>
    <button
      disabled={!supported || busy || selectedClocks.length === 0}
      onclick={() => runOn(selectedClocks, 'Syncing time', syncTime)}
    >
      Sync time on {clocksLabel}
    </button>
  </fieldset>

  <fieldset>
    <legend>Temperature unit</legend>
    <label class="inline">
      <input type="radio" bind:group={unit} value={CELSIUS} />
      °C
    </label>
    <label class="inline">
      <input type="radio" bind:group={unit} value={FAHRENHEIT} />
      °F
    </label>
    <button
      disabled={!supported || busy || selectedClocks.length === 0}
      onclick={() => runOn(selectedClocks, 'Setting unit', syncUnit)}
    >
      Set unit on {clocksLabel}
    </button>
  </fieldset>

  <fieldset>
    <legend>Console</legend>
    <div class="console" bind:this={consoleEl} aria-live="polite">
      {#each logs as entry, i (i)}
        <div><span class="time">{entry.time}</span> {entry.message}</div>
      {:else}
        <div class="empty">Nothing yet.</div>
      {/each}
    </div>
  </fieldset>

  <section class="credits">
    <h2>Based on code snippets from</h2>
    <ul>
      <li><a href="https://web.dev/bluetooth/" target="_blank" rel="noopener">Web.dev</a></li>
      <li>
        <a href="https://github.com/h4/lywsd02/blob/master/lywsd02/client.py" target="_blank" rel="noopener">lywsd02</a>
      </li>
      <li>
        <a href="https://github.com/muro-dot/lywsd02-ble-android-app" target="_blank" rel="noopener">
          lywsd02-ble-android-app
        </a>
      </li>
    </ul>

    <h2>Special thanks to</h2>
    <ul>
      <li>
        <a href="https://github.com/dearmash" target="_blank" rel="noopener">Harold De Armas</a> for adding
        C/F support
      </li>
      <li>
        <a href="https://www.linkedin.com/in/mitjapugelj" target="_blank" rel="noopener">Mitja Pugelj</a> my personal
        hero
      </li>
    </ul>

    <p>
      For connection issues, open <code>chrome://bluetooth-internals/#devices/</code> in Chrome.
    </p>
  </section>
</main>
