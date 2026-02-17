function toDate(iso, wantsTime) {
  const raw = String(iso || "").trim()
  if (!raw) return new Date()

  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (!m) return new Date()

  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const hh = Number(m[4] || "0")
  const mm = Number(m[5] || "0")

  if (!wantsTime) return new Date(y, mo - 1, d, 0, 0, 0, 0)
  return new Date(y, mo - 1, d, Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0)
}

function toISO(d, wantsTime) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")

  if (!wantsTime) return `${y}-${m}-${day}`

  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${y}-${m}-${day}T${hh}:${mm}`
}

function addDays(d, n) {
  const x = new Date(d.getTime())
  x.setDate(x.getDate() + n)
  return x
}

function addMonthsKeepDay(d, n) {
  const x = new Date(d.getTime())
  const day = x.getDate()
  x.setMonth(x.getMonth() + n)
  if (x.getDate() !== day) x.setDate(0)
  return x
}

function startOfDay(d) {
  const x = new Date(d.getTime())
  x.setHours(0, 0, 0, 0)
  return x
}

function keepTime(base, target) {
  const x = new Date(target.getTime())
  x.setHours(base.getHours(), base.getMinutes(), 0, 0)
  return x
}

const WEEKDAYS = [
  { key: "mon", idx: 1 },
  { key: "tue", idx: 2 },
  { key: "wed", idx: 3 },
  { key: "thu", idx: 4 },
  { key: "fri", idx: 5 },
  { key: "sat", idx: 6 },
  { key: "sun", idx: 0 },
]

function isWeekdayOn(weekdaySet, jsDay) {
  const found = WEEKDAYS.find((w) => w.idx === jsDay)
  if (!found) return false
  return Boolean(weekdaySet && weekdaySet[found.key])
}

function firstOfMonth(d) {
  const x = new Date(d.getTime())
  x.setDate(1)
  return x
}

function nthWeekdayOfMonth(anchor, nth, weekday) {
  const first = firstOfMonth(anchor)
  const firstDay = first.getDay()
  const delta = (weekday - firstDay + 7) % 7
  const dayOfMonth = 1 + delta + (nth - 1) * 7
  const x = new Date(first.getTime())
  x.setDate(dayOfMonth)
  return x
}

function buildPreviewStarts(args) {
  const count = Math.max(0, Math.min(200, Number.isFinite(args.count) ? args.count : 0))
  const interval = Math.max(1, Math.min(365, Number.isFinite(args.interval) ? args.interval : 1))

  const base = toDate(args.startISO, Boolean(args.startWantsTime))
  const baseDay = startOfDay(base)
  const out = []
  if (!count) return out

  if (args.repeatType === "daily") {
    for (let i = 0; i < count; i++) {
      const d = addDays(baseDay, i * interval)
      out.push(toISO(args.startWantsTime ? keepTime(base, d) : d, Boolean(args.startWantsTime)))
    }
    return out
  }

  if (args.repeatType === "weekly") {
    let cursor = startOfDay(base)
    let guard = 0
    while (out.length < count && guard < 2000) {
      const w = cursor.getDay()
      if (isWeekdayOn(args.weekdaySet, w) && cursor.getTime() >= baseDay.getTime()) {
        out.push(toISO(args.startWantsTime ? keepTime(base, cursor) : cursor, Boolean(args.startWantsTime)))
      }
      cursor = addDays(cursor, 1)
      guard += 1
    }
    if (interval > 1) return out.filter((_, idx) => idx % interval === 0).slice(0, count)
    return out.slice(0, count)
  }

  if (args.repeatType === "monthly") {
    for (let i = 0; i < count; i++) {
      const d = addMonthsKeepDay(baseDay, i * interval)
      out.push(toISO(args.startWantsTime ? keepTime(base, d) : d, Boolean(args.startWantsTime)))
    }
    return out
  }

  if (args.customRule === "weekdays" || args.customRule === "weekends") {
    let cursor = startOfDay(base)
    let guard = 0
    while (out.length < count && guard < 4000) {
      const day = cursor.getDay()
      const isWeekend = day === 0 || day === 6
      const ok = args.customRule === "weekdays" ? !isWeekend : isWeekend
      if (ok && cursor.getTime() >= baseDay.getTime()) {
        out.push(toISO(args.startWantsTime ? keepTime(base, cursor) : cursor, Boolean(args.startWantsTime)))
      }
      cursor = addDays(cursor, 1)
      guard += 1
    }
    if (interval > 1) return out.filter((_, idx) => idx % interval === 0).slice(0, count)
    return out.slice(0, count)
  }

  for (let i = 0; i < count; i++) {
    const anchor = addMonthsKeepDay(baseDay, i * interval)
    const nthDate = nthWeekdayOfMonth(anchor, args.nth, args.nthWeekday)
    out.push(toISO(args.startWantsTime ? keepTime(base, nthDate) : nthDate, Boolean(args.startWantsTime)))
  }
  return out
}

function buildPreviewEnds(args) {
  if (!args.endFieldId) return []
  const baseEnd = toDate(args.endISO, Boolean(args.endWantsTime))
  const baseStart = toDate(args.startISO, Boolean(args.startISO && String(args.startISO).includes("T")))
  const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime())
  const out = []
  const list = Array.isArray(args.previewStarts) ? args.previewStarts : []
  for (const s of list) {
    const sd = toDate(s, Boolean(args.endWantsTime))
    const ed = new Date(sd.getTime() + durationMs)
    out.push(toISO(ed, Boolean(args.endWantsTime)))
  }
  return out
}

module.exports = {
  buildPreviewStarts,
  buildPreviewEnds,
}
