export function getLocalTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** UTC offset of `timeZone` at `date` in minutes, including DST and half/quarter-hour zones. */
export function getOffsetMinutes(timeZone, date = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName').value
  // "GMT+05:30", "GMT-03:30", or plain "GMT" for UTC
  const match = name.match(/([+\-−])(\d{2}):(\d{2})/)
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '+' ? minutes : -minutes
}

export function formatOffset(minutes) {
  const abs = Math.abs(minutes)
  return `UTC${minutes < 0 ? '−' : '+'}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
}

/** All time zones grouped by region, e.g. [{ region: 'Europe', zones: [{ id, label }] }]. */
export function groupTimeZones(extraZones = []) {
  const ids = new Set([...Intl.supportedValuesOf('timeZone'), ...extraZones])
  ids.delete('UTC')
  const groups = new Map([['UTC', [{ id: 'UTC', label: `UTC (${formatOffset(0)})` }]]])

  for (const id of [...ids].sort()) {
    const [region, ...rest] = id.split('/')
    const place = rest.length ? rest.join(' / ').replaceAll('_', ' ') : region
    const groupName = rest.length ? region : 'Other'
    if (!groups.has(groupName)) groups.set(groupName, [])
    groups.get(groupName).push({ id, label: `${place} (${formatOffset(getOffsetMinutes(id))})` })
  }

  return [...groups].map(([region, zones]) => ({ region, zones }))
}
