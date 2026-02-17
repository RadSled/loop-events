function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v)
}

function ensureBool(v, fallback) {
  if (v === true) return true
  if (v === false) return false
  return fallback
}

function ensureNum(v, fallback) {
  const n = Number(v)
  if (Number.isFinite(n)) return n
  return fallback
}

function ensureStr(v, fallback) {
  const s = String(v || "").trim()
  return s ? s : fallback
}

function ensureCleanupMode(v) {
  const mode = String(v || "").trim()
  if (mode === "archive" || mode === "delete" || mode === "unpublish") return mode
  return "off"
}

function sanitizeHistoryEntry(v) {
  const x = isObject(v) ? v : {}
  const itemId = ensureStr(x.itemId, "")
  const startISO = ensureStr(x.startISO, "")
  const source = ensureStr(x.source, "")
  const state = ensureStr(x.state, "")
  const createdAt = ensureNum(x.createdAt, Date.now())
  const outputMode = ensureStr(x.outputMode, "")
  if (!itemId && !startISO) return null
  return {
    itemId,
    startISO,
    source,
    state,
    createdAt,
    outputMode,
  }
}

function sanitizeRunEntry(v) {
  const x = isObject(v) ? v : {}
  const runId = ensureStr(x.runId, "")
  const source = ensureStr(x.source, "manual")
  const status = ensureStr(x.status, "ok")
  const createdAt = ensureNum(x.createdAt, Date.now())
  const finishedAt = x.finishedAt ? ensureNum(x.finishedAt, createdAt) : createdAt
  const createdCount = Math.max(0, ensureNum(x.createdCount, 0))
  const warning = ensureStr(x.warning, "")
  const error = ensureStr(x.error, "")
  const rolledBackAt = x.rolledBackAt ? ensureNum(x.rolledBackAt, 0) : null
  const rollbackDeletedCount = Math.max(0, ensureNum(x.rollbackDeletedCount, 0))
  const rollbackFailedCount = Math.max(0, ensureNum(x.rollbackFailedCount, 0))
  const rollbackError = ensureStr(x.rollbackError, "")
  const createdItemIds = Array.isArray(x.createdItemIds) ? x.createdItemIds.map((id) => String(id || "")).filter(Boolean) : []
  const createdStartKeys = Array.isArray(x.createdStartKeys) ? x.createdStartKeys.map((k) => String(k || "")).filter(Boolean) : []
  if (!runId) return null
  return {
    runId,
    source,
    status,
    createdAt,
    finishedAt,
    createdCount,
    warning,
    error,
    createdItemIds,
    createdStartKeys,
    rolledBackAt,
    rollbackDeletedCount,
    rollbackFailedCount,
    rollbackError,
  }
}

function sanitizeSchedule(input) {
  const s = isObject(input) ? input : {}

  const out = {
    id: ensureStr(s.id, ""),
    userId: ensureStr(s.userId, ""),
    createdAt: ensureNum(s.createdAt, Date.now()),
    isPaused: ensureBool(s.isPaused, false),
    isStopped: ensureBool(s.isStopped, false),
    createdCount: ensureNum(s.createdCount, 0),
    lastTickAt: s.lastTickAt ? ensureNum(s.lastTickAt, 0) : undefined,
    lastRunAt: s.lastRunAt ? ensureNum(s.lastRunAt, 0) : undefined,
    lastRunStatus: ensureStr(s.lastRunStatus, "idle"),
    lastRunMessage: ensureStr(s.lastRunMessage, ""),
    errorStreak: Math.max(0, ensureNum(s.errorStreak, 0)),

    collectionId: ensureStr(s.collectionId, ""),
    collectionName: ensureStr(s.collectionName, ""),
    siteId: ensureStr(s.siteId, ""),
    siteTimezone: ensureStr(s.siteTimezone, "UTC"),
    startFieldId: ensureStr(s.startFieldId, ""),
    startFieldSlug: ensureStr(s.startFieldSlug, ""),
    startFieldName: ensureStr(s.startFieldName, ""),
    endFieldId: ensureStr(s.endFieldId, ""),
    endFieldSlug: ensureStr(s.endFieldSlug, ""),
    endFieldName: ensureStr(s.endFieldName, ""),
    templateItemId: ensureStr(s.templateItemId, ""),
    templateTitle: ensureStr(s.templateTitle, ""),
    templateThumbnailUrl: ensureStr(s.templateThumbnailUrl, ""),

    seedStartISO: ensureStr(s.seedStartISO, ""),
    seedEndISO: ensureStr(s.seedEndISO, ""),
    startHasTime: ensureBool(s.startHasTime, false),
    endHasTime: ensureBool(s.endHasTime, false),

    repeatType: ensureStr(s.repeatType, "weekly"),
    interval: Math.max(1, ensureNum(s.interval, 1)),
    count: Math.max(1, Math.min(200, ensureNum(s.count, 10))),
    weekdaySet: isObject(s.weekdaySet) ? s.weekdaySet : {},
    customRule: ensureStr(s.customRule, "weekdays"),
    nth: Math.max(1, Math.min(5, ensureNum(s.nth, 2))),
    nthWeekday: ensureNum(s.nthWeekday, 1),

    autoEvery: 10,
    autoUnit: "seconds",
    cleanupMode: ensureCleanupMode(s.cleanupMode),

    status: ensureStr(s.status, "draft"),

    createdItemIds: Array.isArray(s.createdItemIds) ? s.createdItemIds.map((x) => String(x)) : [],
    issuedStartKeys: Array.isArray(s.issuedStartKeys) ? s.issuedStartKeys.map((x) => String(x)).filter(Boolean) : [],
    lastIssuedStartKey: ensureStr(s.lastIssuedStartKey, ""),
    history: Array.isArray(s.history)
      ? s.history.map(sanitizeHistoryEntry).filter(Boolean)
      : [],
    runs: Array.isArray(s.runs)
      ? s.runs.map(sanitizeRunEntry).filter(Boolean).slice(-100)
      : [],
  }

  return out
}

module.exports = {
  sanitizeSchedule,
}
