const fs = require("fs")
const path = require("path")
const { sanitizeSchedule } = require("./types")

const ROOT_DATA_DIR = process.env.LOOP_EVENTS_DATA_DIR
  ? path.resolve(process.env.LOOP_EVENTS_DATA_DIR)
  : path.join(__dirname, "..", "data")
const DATA_DIR = path.join(ROOT_DATA_DIR, "schedules")
const DATA_PATH = path.join(DATA_DIR, "schedules.json")
const LEGACY_DATA_PATH = path.join(process.cwd(), "schedules", "schedules.json")

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(DATA_PATH)) {
    if (fs.existsSync(LEGACY_DATA_PATH)) {
      try {
        fs.copyFileSync(LEGACY_DATA_PATH, DATA_PATH)
        return
      } catch {}
    }
    fs.writeFileSync(DATA_PATH, JSON.stringify([], null, 2))
  }
}

function readRaw() {
  ensureStore()
  const raw = fs.readFileSync(DATA_PATH, "utf-8")
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

function loadSchedules(opts = {}) {
  const userId = String(opts.userId || "").trim()
  const raw = readRaw()
  const list = raw.map(sanitizeSchedule).filter((s) => s.id)
  if (!userId) return list
  return list.filter((s) => String(s.userId || "") === userId)
}

function saveSchedules(list) {
  ensureStore()
  const safe = Array.isArray(list) ? list.map(sanitizeSchedule).filter((s) => s.id) : []
  fs.writeFileSync(DATA_PATH, JSON.stringify(safe, null, 2))
  return safe
}

function upsertSchedule(schedule, opts = {}) {
  const userId = String(opts.userId || "").trim()
  const next = sanitizeSchedule({ ...(schedule || {}), userId: userId || schedule?.userId || "" })
  if (!next.id) return null
  if (!next.userId) return null

  const all = loadSchedules()
  const idx = all.findIndex((x) => x.id === next.id && String(x.userId || "") === String(next.userId || ""))

  if (idx >= 0) all[idx] = { ...all[idx], ...next }
  else all.unshift(next)

  saveSchedules(all)
  return next
}

function patchSchedule(id, patch, opts = {}) {
  const safeId = String(id || "").trim()
  const userId = String(opts.userId || "").trim()
  if (!safeId) return null

  const all = loadSchedules()
  const idx = all.findIndex((x) => x.id === safeId && (!userId || String(x.userId || "") === userId))
  if (idx < 0) return null

  all[idx] = sanitizeSchedule({ ...all[idx], ...(patch || {}), userId: all[idx].userId })
  saveSchedules(all)
  return all[idx]
}

function deleteSchedule(id, opts = {}) {
  const safeId = String(id || "").trim()
  const userId = String(opts.userId || "").trim()
  if (!safeId) return false

  const all = loadSchedules()
  const next = all.filter((x) => {
    if (x.id !== safeId) return true
    if (!userId) return false
    return String(x.userId || "") !== userId
  })
  saveSchedules(next)
  return next.length !== all.length
}

module.exports = {
  loadSchedules,
  saveSchedules,
  upsertSchedule,
  patchSchedule,
  deleteSchedule,
}
