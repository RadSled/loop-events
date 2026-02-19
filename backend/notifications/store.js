const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const ROOT_DATA_DIR = process.env.LOOP_EVENTS_DATA_DIR
  ? path.resolve(process.env.LOOP_EVENTS_DATA_DIR)
  : path.join(__dirname, "..", "data")
const DATA_DIR = path.join(ROOT_DATA_DIR, "notifications")
const DATA_PATH = path.join(DATA_DIR, "notifications.json")
const LEGACY_DATA_PATH = path.join(process.cwd(), "notifications", "notifications.json")

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
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveRaw(list) {
  ensureStore()
  const safe = Array.isArray(list) ? list : []
  fs.writeFileSync(DATA_PATH, JSON.stringify(safe, null, 2))
  return safe
}

function sanitizeNotification(input) {
  const x = input && typeof input === "object" ? input : {}
  const id = String(x.id || "").trim() || `ntf_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
  const userId = String(x.userId || "").trim()
  const title = String(x.title || "").trim()
  const body = String(x.body || "").trim()
  return {
    id,
    userId,
    type: String(x.type || "").trim() || "generic",
    category: String(x.category || "").trim() || "general",
    title,
    body,
    severity: String(x.severity || "info").trim() || "info",
    createdAt: Number.isFinite(Number(x.createdAt)) ? Number(x.createdAt) : Date.now(),
    readAt: x.readAt ? Number(x.readAt) : null,
    dedupeKey: String(x.dedupeKey || "").trim(),
    meta: x.meta && typeof x.meta === "object" ? x.meta : null,
  }
}

function loadNotifications(opts = {}) {
  const userId = String(opts.userId || "").trim()
  const max = Math.max(1, Number(opts.max || 200))
  const list = readRaw().map(sanitizeNotification).filter((n) => n.userId && n.title)
  const filtered = userId ? list.filter((n) => n.userId === userId) : list
  return filtered.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, max)
}

function hasNotificationByDedupeKey(userId, dedupeKey) {
  const safeUserId = String(userId || "").trim()
  const safeKey = String(dedupeKey || "").trim()
  if (!safeUserId || !safeKey) return false
  const list = readRaw().map(sanitizeNotification)
  return list.some((n) => n.userId === safeUserId && n.dedupeKey === safeKey)
}

function addNotification(input) {
  const next = sanitizeNotification(input)
  if (!next.userId || !next.title) return null

  const all = readRaw().map(sanitizeNotification)
  if (next.dedupeKey) {
    const duplicateIdx = all.findIndex((n) => n.userId === next.userId && n.dedupeKey === next.dedupeKey)
    if (duplicateIdx >= 0) {
      const prev = all[duplicateIdx]
      const updated = {
        ...prev,
        type: next.type || prev.type,
        category: next.category || prev.category,
        title: next.title || prev.title,
        body: next.body || prev.body,
        severity: next.severity || prev.severity,
        meta: next.meta || prev.meta || null,
        createdAt: Date.now(),
      }
      all[duplicateIdx] = updated
      saveRaw(all)
      return updated
    }
  }

  const forUser = all.filter((n) => n.userId === next.userId)
  const overBy = Math.max(0, forUser.length - 199)
  let dropped = 0
  const pruned = all.filter((n) => {
    if (n.userId !== next.userId) return true
    if (dropped >= overBy) return true
    dropped += 1
    return false
  })

  pruned.unshift(next)
  saveRaw(pruned)
  return next
}

function markAllRead(userId) {
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) return 0
  const now = Date.now()
  let changed = 0
  const next = readRaw().map((item) => {
    const n = sanitizeNotification(item)
    if (n.userId !== safeUserId) return n
    if (n.readAt) return n
    changed += 1
    return { ...n, readAt: now }
  })
  saveRaw(next)
  return changed
}

function markRead(userId, id) {
  const safeUserId = String(userId || "").trim()
  const safeId = String(id || "").trim()
  if (!safeUserId || !safeId) return null
  const now = Date.now()
  let updated = null
  const next = readRaw().map((item) => {
    const n = sanitizeNotification(item)
    if (n.userId !== safeUserId || n.id !== safeId) return n
    updated = { ...n, readAt: n.readAt || now }
    return updated
  })
  saveRaw(next)
  return updated
}

function deleteNotification(userId, id) {
  const safeUserId = String(userId || "").trim()
  const safeId = String(id || "").trim()
  if (!safeUserId || !safeId) return false

  const all = readRaw().map(sanitizeNotification)
  const next = all.filter((n) => !(n.userId === safeUserId && n.id === safeId))
  saveRaw(next)
  return next.length !== all.length
}

module.exports = {
  loadNotifications,
  addNotification,
  markAllRead,
  markRead,
  deleteNotification,
  hasNotificationByDedupeKey,
}
