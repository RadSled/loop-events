// src/logic/dateUtils.ts

export function isoTodayDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Decide if a Webflow field is a DateTime field (so UI should show a time picker)
 * This is the real fix for "always date+time no matter what"
 */
export function fieldWantsTime(field: any) {
  const t = String(field?.type || field?.fieldType || field?.dataType || "").toLowerCase()

  // common variants from Webflow APIs
  if (t.includes("datetime")) return true
  if (t.includes("date_time")) return true
  if (t === "date-time") return true
  if (t === "date time") return true
  if (t === "date") return false

  // safest default so you do NOT accidentally force time
  return false
}

export function splitISO(iso: any) {
  const raw = String(iso || "").trim()
  if (!raw) return { date: isoTodayDate(), time: "09:00" }

  if (raw.includes("T")) {
    const [datePart, timePartRaw] = raw.split("T")
    const timePart = String(timePartRaw || "").slice(0, 5)
    return { date: datePart || isoTodayDate(), time: timePart || "09:00" }
  }

  return { date: raw.slice(0, 10) || isoTodayDate(), time: "09:00" }
}

export function combineISO(date: any, time: any, wantsTime: boolean) {
  const d = String(date || "").trim()
  if (!d) return ""

  if (!wantsTime) return d.slice(0, 10)

  const t = String(time || "00:00").slice(0, 5)
  return `${d.slice(0, 10)}T${t}`
}

export function formatISO(iso: any, wantsTime: boolean) {
  const raw = String(iso || "").trim()
  if (!raw) return ""

  if (!wantsTime) return raw.slice(0, 10)

  const s = splitISO(raw)
  return `${s.date} ${formatTime12h(s.time)}`
}

function formatTime12h(time: any) {
  const raw = String(time || "").trim()
  const m = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return raw

  let hour = Number(m[1])
  const minute = String(m[2])
  if (!Number.isFinite(hour)) return raw

  const ampm = hour >= 12 ? "PM" : "AM"
  hour = hour % 12
  if (hour === 0) hour = 12

  return `${hour}:${minute} ${ampm}`
}

function toDateSafe(iso: any, wantsTime: boolean) {
  const s = String(iso || "").trim()
  if (!s) return null

  // if wantsTime is false, force midnight
  const d = wantsTime
    ? new Date(s.includes("T") ? s : `${s}T00:00`)
    : new Date(`${s.slice(0, 10)}T00:00`)

  if (Number.isNaN(d.getTime())) return null
  return d
}

export function formatNice(iso: any, wantsTime: boolean) {
  const d = toDateSafe(iso, wantsTime)
  if (!d) return ""

  try {
    const dateFmt = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
    })

    if (!wantsTime) return dateFmt.format(d)

    const timeFmt = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })

    return `${dateFmt.format(d)} ${timeFmt.format(d)}`
  } catch {
    return formatISO(iso, wantsTime)
  }
}

/**
 * Optional: normalize an existing ISO value when switching field type
 * If switching to date-only, strip time
 * If switching to datetime, keep date and use fallback time if missing
 */
export function normalizeISOForField(iso: any, wantsTime: boolean, fallbackTime = "09:00") {
  const raw = String(iso || "").trim()
  if (!raw) return wantsTime ? combineISO(isoTodayDate(), fallbackTime, true) : isoTodayDate()

  if (!wantsTime) return raw.slice(0, 10)

  const s = splitISO(raw)
  return combineISO(s.date, s.time || fallbackTime, true)
}
