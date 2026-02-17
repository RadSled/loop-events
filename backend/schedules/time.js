function msFromUnit(unit, value) {
  const v = Math.max(1, Number(value) || 1)

  if (unit === "seconds") return v * 1000
  if (unit === "minutes") return v * 60 * 1000
  if (unit === "hours") return v * 60 * 60 * 1000
  return v * 24 * 60 * 60 * 1000
}

function isFutureISO(iso) {
  const s = String(iso || "").trim()
  if (!s) return false

  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return false

  return d.getTime() > Date.now()
}

function splitISO(iso) {
  const s = String(iso || "").trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/) 
  if (!m) return { date: "", hh: 0, mm: 0, hasTime: false }
  return {
    date: String(m[1] || ""),
    hh: Number(m[2] || "0"),
    mm: Number(m[3] || "0"),
    hasTime: Boolean(m[2] && m[3]),
  }
}

function todayStrInTz(timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: String(timeZone || "UTC"),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = fmt.formatToParts(new Date())
  const map = {}
  for (const p of parts) map[p.type] = p.value
  return `${map.year || "0000"}-${map.month || "01"}-${map.day || "01"}`
}

function isTodayOrFutureStart(iso, hasTime, timeZone) {
  if (hasTime) {
    const d = new Date(String(iso || ""))
    if (Number.isNaN(d.getTime())) return false
    return d.getTime() > Date.now()
  }

  const parsed = splitISO(iso)
  if (!parsed.date) return false

  const today = todayStrInTz(timeZone)
  if (parsed.date > today) return true
  if (parsed.date < today) return false
  return true
}

module.exports = {
  msFromUnit,
  isFutureISO,
  isTodayOrFutureStart,
}
