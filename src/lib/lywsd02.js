// GATT protocol, see https://github.com/h4/lywsd02/blob/master/lywsd02/client.py
const uuid = (short) => `ebe0cc${short}-7a0a-4b0c-8a1a-6ff2997da3a6`
const SERVICE = uuid('b0')
const TIME = uuid('b7') // uint32 LE unix timestamp + int8 whole-hour zone, read/write
const UNIT = uuid('be') // uint8, read/write
const SENSOR = uuid('c1') // int16 LE temperature in 0.01 °C + uint8 humidity %, notify
const BATTERY = uuid('c4') // uint8 %, read
const DEVICE_INFORMATION = 0x180a
const SYSTEM_ID = 0x2a23 // 6 bytes, unique per clock

const XIAOMI_COMPANY_ID = 0x038f
// From https://github.com/Bluetooth-Devices/xiaomi-ble/blob/main/src/xiaomi_ble/devices.py
const PRODUCT_IDS = [0x2542 /* LYWSD02MMC */, 0x16e4 /* LYWSD02MMC */, 0x045b /* LYWSD02 */]

// Clocks bound to Mi Home only send encrypted Xiaomi adverts without a name, so besides the
// name, match the product id in Xiaomi's manufacturer data (uint16 LE at bytes 2-3).
const CLOCK_FILTERS = [
  { namePrefix: 'LYWSD02' },
  ...PRODUCT_IDS.map((productId) => ({
    manufacturerData: [
      {
        companyIdentifier: XIAOMI_COMPANY_ID,
        dataPrefix: Uint8Array.of(0, 0, productId & 0xff, productId >> 8),
        mask: Uint8Array.of(0, 0, 0xff, 0xff),
      },
    ],
  })),
]

export const CELSIUS = 0xff
export const FAHRENHEIT = 0x01

const CONNECT_TIMEOUT_MS = 20_000
const ADVERTISEMENT_TIMEOUT_MS = 10_000
const SENSOR_TIMEOUT_MS = 10_000

export function isBluetoothSupported() {
  return 'bluetooth' in navigator
}

/** Opens the browser's device chooser. Browsers only allow picking one device per call. */
export function requestClock(showAllDevices = false) {
  return navigator.bluetooth.requestDevice({
    ...(showAllDevices ? { acceptAllDevices: true } : { filters: CLOCK_FILTERS }),
    optionalServices: [SERVICE, DEVICE_INFORMATION],
  })
}

/** Devices this site was given access to on earlier visits. Chrome only supports this behind a flag. */
export async function getRememberedClocks() {
  if (!navigator.bluetooth?.getDevices) return []
  try {
    return await navigator.bluetooth.getDevices()
  } catch {
    return []
  }
}

/**
 * The clock shows timestamp + zone hours and only stores whole hours, so the leftover
 * minutes of half/quarter-hour zones (e.g. UTC+5:30, UTC−3:30, UTC+5:45) are added to
 * the timestamp instead.
 */
export function encodeTime(date, offsetMinutes) {
  const zone = Math.floor(offsetMinutes / 60)
  const timestamp = Math.floor(date.getTime() / 1000) + (offsetMinutes - zone * 60) * 60
  const view = new DataView(new ArrayBuffer(5))
  view.setUint32(0, timestamp, true)
  view.setInt8(4, zone)
  return view.buffer
}

/** How many seconds the time shown on the clock is ahead of UTC. */
function decodeDisplayOffset(view) {
  const zone = view.byteLength > 4 ? view.getInt8(4) : 0
  return Math.round(view.getUint32(0, true) + zone * 3600 - Date.now() / 1000)
}

function withTimeout(promise, ms, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function waitForAdvertisement(device) {
  const controller = new AbortController()
  try {
    const seen = new Promise((resolve) => device.addEventListener('advertisementreceived', resolve, { once: true }))
    await device.watchAdvertisements({ signal: controller.signal })
    await withTimeout(seen, ADVERTISEMENT_TIMEOUT_MS, 'Clock not found. Is it in range?')
  } finally {
    controller.abort()
  }
}

async function connect(device) {
  const attempt = () =>
    withTimeout(device.gatt.connect(), CONNECT_TIMEOUT_MS, 'Timed out connecting. Is the clock in range?')
  try {
    return await attempt()
  } catch (error) {
    // Chrome can only connect to a remembered device (from getDevices) after seeing it advertise.
    if (!device.watchAdvertisements) throw error
    await waitForAdvertisement(device)
    return attempt()
  }
}

async function withService(device, action) {
  try {
    const server = await connect(device)
    return await action(await server.getPrimaryService(SERVICE), server)
  } finally {
    device.gatt.disconnect()
  }
}

async function read(service, characteristic) {
  return (await service.getCharacteristic(characteristic)).readValue()
}

async function write(service, characteristic, value) {
  await (await service.getCharacteristic(characteristic)).writeValueWithResponse(value)
}

async function readSensor(service) {
  const characteristic = await service.getCharacteristic(SENSOR)
  const notification = new Promise((resolve) => {
    characteristic.addEventListener('characteristicvaluechanged', () => resolve(characteristic.value), {
      once: true,
    })
  })
  await characteristic.startNotifications()
  const view = await withTimeout(notification, SENSOR_TIMEOUT_MS, 'No temperature reading received.')
  return { temperature: view.getInt16(0, true) / 100, humidity: view.getUint8(2) }
}

const toHex = (bytes, separator = '') =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(separator)

/**
 * The System ID is the MAC address in reverse byte order. A hash of it identifies the clock
 * across browser sessions, where Chrome's device ids change, without storing the whole
 * address; the last 3 bytes (the part after the A4:C1:38 vendor prefix) are kept for display.
 */
async function readIdentity(server) {
  try {
    const service = await server.getPrimaryService(DEVICE_INFORMATION)
    const view = await read(service, SYSTEM_ID)
    const systemId = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', systemId), 0, 8)
    return {
      hardwareId: toHex(hash).toLowerCase(),
      macSuffix: systemId.length === 6 ? toHex(systemId.slice(0, 3).reverse(), ':') : null,
    }
  } catch {
    return { hardwareId: null, macSuffix: null }
  }
}

export function readStatus(device) {
  return withService(device, async (service, server) => ({
    ...(await readIdentity(server)),
    battery: (await read(service, BATTERY)).getUint8(0),
    unit: (await read(service, UNIT)).getUint8(0) === FAHRENHEIT ? FAHRENHEIT : CELSIUS,
    displayOffset: decodeDisplayOffset(await read(service, TIME)),
    // Keep the other readings if the sensor doesn't notify in time.
    ...(await readSensor(service).catch(() => ({ temperature: null, humidity: null }))),
  }))
}

/** Writes the current time and returns the display offset read back from the clock. */
export function writeTime(device, offsetMinutes) {
  return withService(device, async (service) => {
    await write(service, TIME, encodeTime(new Date(), offsetMinutes))
    await new Promise((resolve) => setTimeout(resolve, 250))
    return decodeDisplayOffset(await read(service, TIME))
  })
}

export function writeUnit(device, unit) {
  return withService(device, (service) => write(service, UNIT, Uint8Array.of(unit)))
}
