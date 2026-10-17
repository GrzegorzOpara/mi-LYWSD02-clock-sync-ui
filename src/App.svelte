<script>
  import {
    CELSIUS,
    FAHRENHEIT,
    getBrowserTimeZone,
    isBluetoothSupported,
    updateTime,
    updateUnit,
  } from './lib/lywsd02.js'

  const supported = isBluetoothSupported()
  const browserZone = getBrowserTimeZone()

  let zone = $state(browserZone.zone)
  let add30Min = $state(browserZone.add30Min)
  let unit = $state(CELSIUS)
  let busy = $state(false)
  let logs = $state([])
  let now = $state(new Date())
  let consoleEl

  const zoneValid = $derived(Number.isInteger(zone) && zone >= -12 && zone <= 14)
  const offsetMinutes = $derived(zone * 60 + (add30Min ? 30 : 0))
  const offsetLabel = $derived(
    `UTC${offsetMinutes < 0 ? '−' : '+'}${Math.floor(Math.abs(offsetMinutes) / 60)}:${pad(Math.abs(offsetMinutes) % 60)}`,
  )
  const clockTime = $derived.by(() => {
    const shifted = new Date(now.getTime() + offsetMinutes * 60 * 1000)
    return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  })

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

  async function run(action) {
    busy = true
    try {
      await action()
    } catch (error) {
      log(error)
    } finally {
      busy = false
    }
  }
</script>

<main>
  <h1>LYWSD02 Clock sync</h1>
  <p class="subtitle">
    Xiaomi Mijia BT4.0 Wireless Smart Electric Digital Clock Indoor &amp; Outdoor Hygrometer
    Thermometer
  </p>

  <img
    src="https://imgaz3.staticbg.com/thumb/large/oaupload/banggood/images/74/DF/f05ddb02-4334-48a1-8785-39c4a5d9d9c1.jpg.webp"
    alt="Xiaomi Mijia LYWSD02 clock"
    width="300"
  />

  {#if !supported}
    <p class="warning">
      Web Bluetooth is not available in this browser. Use Chrome or Edge on desktop or Android.
    </p>
  {/if}

  <fieldset>
    <legend>Time sync</legend>
    <label>
      Time zone (hours from UTC)
      <input type="number" bind:value={zone} min="-12" max="14" step="1" />
    </label>
    <label class="inline">
      <input type="checkbox" bind:checked={add30Min} />
      Add 30 min offset
    </label>
    {#if zoneValid}
      <p class="hint">Clock will show <strong>{clockTime}</strong> ({offsetLabel})</p>
    {:else}
      <p class="hint error">Time zone must be a whole number between −12 and 14.</p>
    {/if}
    <button disabled={!supported || busy || !zoneValid} onclick={() => run(() => updateTime(zone, add30Min, log))}>
      Update time
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
    <button disabled={!supported || busy} onclick={() => run(() => updateUnit(unit, log))}>
      Update unit
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
