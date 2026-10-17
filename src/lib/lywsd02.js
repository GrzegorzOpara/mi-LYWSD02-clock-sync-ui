// GATT UUIDs from https://github.com/h4/lywsd02/blob/master/lywsd02/client.py
export const TIME_SERVICE = 'ebe0ccb0-7a0a-4b0c-8a1a-6ff2997da3a6'
export const TIME = 'ebe0ccb7-7a0a-4b0c-8a1a-6ff2997da3a6'
export const UNIT = 'ebe0ccbe-7a0a-4b0c-8a1a-6ff2997da3a6'

export const CELSIUS = 0
export const FAHRENHEIT = 1

const UNIT_NAMES = { [CELSIUS]: '°C', [FAHRENHEIT]: '°F' }

export function isBluetoothSupported() {
  return 'bluetooth' in navigator
}

/**
 * The clock only stores a whole-hour zone, so half-hour zones are expressed as
 * the hour below plus a 30 minute shift of the timestamp (e.g. UTC-3:30 is -4 + 30 min).
 */
export function getBrowserTimeZone() {
  const offsetMinutes = -new Date().getTimezoneOffset()
  const zone = Math.floor(offsetMinutes / 60)
  return { zone, add30Min: offsetMinutes - zone * 60 >= 30 }
}

/** Time payload: uint32 little-endian unix timestamp followed by an int8 hour offset. */
export function encodeTime(date, zone, add30Min) {
  const timestamp = Math.floor(date.getTime() / 1000) + (add30Min ? 30 * 60 : 0)
  const view = new DataView(new ArrayBuffer(5))
  view.setUint32(0, timestamp, true)
  view.setInt8(4, zone)
  return view.buffer
}

async function withCharacteristic(uuid, log, action) {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth API is not supported in this browser.')
  }

  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [TIME_SERVICE],
  })

  try {
    log('Connecting...')
    const server = await device.gatt.connect()
    log('Getting primary service...')
    const service = await server.getPrimaryService(TIME_SERVICE)
    log('Getting characteristic...')
    const characteristic = await service.getCharacteristic(uuid)
    await action(characteristic)
  } finally {
    device.gatt.disconnect()
  }
}

export function updateTime(zone, add30Min, log) {
  return withCharacteristic(TIME, log, async (characteristic) => {
    log('Writing time value...')
    // Encode after connecting so time spent in the device picker isn't lost.
    await characteristic.writeValue(encodeTime(new Date(), zone, add30Min))
    log('Time updated.')
  })
}

export function updateUnit(unit, log) {
  return withCharacteristic(UNIT, log, async (characteristic) => {
    const oldUnit = (await characteristic.readValue()).getUint8(0)
    log(`Writing unit value (${UNIT_NAMES[oldUnit] ?? oldUnit} -> ${UNIT_NAMES[unit]})...`)
    await characteristic.writeValue(Uint8Array.of(unit))
    log('Unit updated.')
  })
}
