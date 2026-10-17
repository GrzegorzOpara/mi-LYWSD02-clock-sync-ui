const STORAGE_KEY = 'lywsd02-clock-sync:clocks'
const SAVED_FIELDS = ['id', 'number', 'nickname', 'deviceId', 'hardwareId', 'reading', 'readAt']

export function loadClocks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

export function saveClocks(clocks) {
  const data = clocks.map((clock) => Object.fromEntries(SAVED_FIELDS.map((field) => [field, clock[field]])))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the list then lasts for this visit only.
  }
}
