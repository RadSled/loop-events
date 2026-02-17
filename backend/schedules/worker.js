const { isTodayOrFutureStart } = require("./time")
const { patchSchedule } = require("./store")

function isTransientReason(reason) {
  const msg = String(reason || "").toLowerCase()
  if (!msg) return false
  return (
    msg.includes("too many requests") ||
    msg.includes(" 429") ||
    msg.includes("error: 429") ||
    msg.includes("publish already in progress") ||
    msg.includes("retry in") ||
    msg.includes("rate limit")
  )
}

async function runSchedule(schedule, deps) {
  const webflow = deps && deps.webflow
  if (!webflow) throw new Error("Missing deps.webflow")

  const {
    getItemById,
    getItemsByIds,
    createCopiesFromTemplate,
    resolveFieldSlugs,
    resolveFieldDateTime,
    resolveSiteTimezone,
    archiveItems,
    deleteItems,
    unpublishItems,
  } = webflow

  const resolved = typeof resolveFieldSlugs === "function"
    ? await resolveFieldSlugs(
        schedule.collectionId,
        schedule.startFieldId,
        schedule.endFieldId,
        schedule.startFieldSlug,
        schedule.endFieldSlug
      )
    : { startFieldSlug: schedule.startFieldSlug || "", endFieldSlug: schedule.endFieldSlug || "" }

  const startKey = resolved.startFieldSlug || schedule.startFieldId
  const schemaStartHasTime = typeof resolveFieldDateTime === "function"
    ? await resolveFieldDateTime(schedule.collectionId, schedule.startFieldId, startKey)
    : false
  const startHasTime = Boolean(
    schedule.startHasTime ||
    schemaStartHasTime ||
    /t\d{2}:\d{2}/i.test(String(schedule.seedStartISO || ""))
  )

  const siteTimezone = typeof resolveSiteTimezone === "function"
    ? await resolveSiteTimezone(schedule.siteId, schedule.siteTimezone || "UTC")
    : String(schedule.siteTimezone || "UTC")

  if (
    (!schedule.startFieldSlug && resolved.startFieldSlug) ||
    (!schedule.endFieldSlug && resolved.endFieldSlug) ||
    schedule.siteTimezone !== siteTimezone ||
    schedule.startHasTime !== startHasTime
  ) {
    const patched = patchSchedule(schedule.id, {
      startFieldSlug: resolved.startFieldSlug || schedule.startFieldSlug || "",
      endFieldSlug: resolved.endFieldSlug || schedule.endFieldSlug || "",
      siteTimezone,
      startHasTime,
    })
    if (patched) schedule = patched
  }

  const template = await getItemById(schedule.collectionId, schedule.templateItemId)
  if (!template) return { ok: false, reason: "Template item not found" }

  const trackedIds = Array.isArray(schedule.createdItemIds) ? schedule.createdItemIds : []
  const trackedItems = trackedIds.length ? await getItemsByIds(schedule.collectionId, trackedIds) : []
  const trackedFoundIds = new Set(trackedItems.map((it) => String(it && it.id ? it.id : "")).filter(Boolean))
  let prunedTrackedIds = trackedIds.filter((id) => trackedFoundIds.has(String(id)))
  const scheduleAgeMs = Math.max(0, Date.now() - Number(schedule.createdAt || 0))
  const missingTrackedCount = Math.max(0, trackedIds.length - trackedFoundIds.size)
  if (trackedIds.length && missingTrackedCount > 0 && scheduleAgeMs < 120000) {
    return {
      ok: true,
      created: 0,
      have: Math.max(trackedFoundIds.size, trackedIds.length),
      want: schedule.count,
      startHasTime,
      transient: true,
      reason: "Waiting for CMS consistency before next refill",
    }
  }
  const historyBase = Array.isArray(schedule.history) ? schedule.history.slice(-1000) : []
  const historyAdds = []

  function addHistoryEntry(entry) {
    if (!entry || typeof entry !== "object") return
    historyAdds.push({
      itemId: String(entry.itemId || ""),
      startISO: String(entry.startISO || ""),
      source: String(entry.source || ""),
      state: String(entry.state || ""),
      createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(),
      outputMode: String(entry.outputMode || ""),
    })
  }

  const oldTracked = trackedItems.filter((it) => {
    const fd = it && it.fieldData ? it.fieldData : {}
    const startIso = fd[startKey]
    return !isTodayOrFutureStart(startIso, startHasTime, siteTimezone)
  })

  if (schedule.cleanupMode === "archive" && typeof archiveItems === "function") {
    const oldIds = oldTracked.map((it) => String(it && it.id ? it.id : "")).filter(Boolean)
    if (oldIds.length) {
      const archivedIds = await archiveItems(schedule.collectionId, oldIds)
      const archivedSet = new Set((Array.isArray(archivedIds) ? archivedIds : []).map((id) => String(id)))
      prunedTrackedIds = prunedTrackedIds.filter((id) => !archivedSet.has(String(id)))
      const oldById = new Map(oldTracked.map((it) => [String(it && it.id ? it.id : ""), it]))
      for (const id of archivedSet) {
        const it = oldById.get(String(id))
        const fd = it && it.fieldData ? it.fieldData : {}
        addHistoryEntry({
          itemId: String(id),
          startISO: String(fd[startKey] || ""),
          source: "cleanup",
          state: "archived",
          createdAt: Date.now(),
          outputMode: schedule.status,
        })
      }
    }
  }

  if (schedule.cleanupMode === "delete" && typeof deleteItems === "function") {
    const oldIds = oldTracked.map((it) => String(it && it.id ? it.id : "")).filter(Boolean)
    if (oldIds.length) {
      const deletedIds = await deleteItems(schedule.collectionId, oldIds)
      const deletedSet = new Set((Array.isArray(deletedIds) ? deletedIds : []).map((id) => String(id)))
      prunedTrackedIds = prunedTrackedIds.filter((id) => !deletedSet.has(String(id)))
      const oldById = new Map(oldTracked.map((it) => [String(it && it.id ? it.id : ""), it]))
      for (const id of deletedSet) {
        const it = oldById.get(String(id))
        const fd = it && it.fieldData ? it.fieldData : {}
        addHistoryEntry({
          itemId: String(id),
          startISO: String(fd[startKey] || ""),
          source: "cleanup",
          state: "deleted",
          createdAt: Date.now(),
          outputMode: schedule.status,
        })
      }
    }
  }

  if (schedule.cleanupMode === "unpublish" && typeof unpublishItems === "function") {
    const oldIds = oldTracked.map((it) => String(it && it.id ? it.id : "")).filter(Boolean)
    if (oldIds.length) {
      const unpublishedIds = await unpublishItems(schedule.collectionId, oldIds)
      const unpublishedSet = new Set((Array.isArray(unpublishedIds) ? unpublishedIds : []).map((id) => String(id)))
      prunedTrackedIds = prunedTrackedIds.filter((id) => !unpublishedSet.has(String(id)))
      const oldById = new Map(oldTracked.map((it) => [String(it && it.id ? it.id : ""), it]))
      for (const id of unpublishedSet) {
        const it = oldById.get(String(id))
        const fd = it && it.fieldData ? it.fieldData : {}
        addHistoryEntry({
          itemId: String(id),
          startISO: String(fd[startKey] || ""),
          source: "cleanup",
          state: "unpublished",
          createdAt: Date.now(),
          outputMode: schedule.status,
        })
      }
    }
  }

  const futureTracked = trackedItems.filter((it) => {
    const fd = it && it.fieldData ? it.fieldData : {}
    const startIso = fd[startKey]
    return isTodayOrFutureStart(startIso, startHasTime, siteTimezone)
  })

  const have = futureTracked.length
  const want = schedule.count
  const missing = Math.max(0, want - have)

  const trackedStartKeysAll = trackedItems
    .map((it) => {
      const fd = it && it.fieldData ? it.fieldData : {}
      const startIso = fd[startKey]
      if (!startIso) return ""
      const d = new Date(String(startIso))
      if (startHasTime && !Number.isNaN(d.getTime())) {
        const fmt = new Intl.DateTimeFormat("en-US", {
          timeZone: siteTimezone || "UTC",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
        const parts = fmt.formatToParts(d)
        const map = {}
        for (const p of parts) map[p.type] = p.value
        return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`
      }
      return String(startIso).slice(0, 10)
    })
    .filter(Boolean)

  const issuedSet = new Set(
    [
      ...(Array.isArray(schedule.issuedStartKeys) ? schedule.issuedStartKeys : []),
      ...trackedStartKeysAll,
      String(schedule.seedStartISO || ""),
    ]
      .map((x) => String(x))
      .filter(Boolean)
  )
  const issuedStartKeys = Array.from(issuedSet).sort()
  const lastIssuedStartKey = issuedStartKeys.length
    ? issuedStartKeys[issuedStartKeys.length - 1]
    : String(schedule.lastIssuedStartKey || "")

  const idsChanged = prunedTrackedIds.length !== trackedIds.length || prunedTrackedIds.some((id, idx) => id !== trackedIds[idx])
  const issuedChanged =
    (Array.isArray(schedule.issuedStartKeys) ? schedule.issuedStartKeys.join("|") : "") !== issuedStartKeys.join("|") ||
    String(schedule.lastIssuedStartKey || "") !== String(lastIssuedStartKey || "")

  if (!missing) {
    const now = Date.now()
    const runsBase = Array.isArray(schedule.runs) ? schedule.runs : []
    const runEntry = {
      runId: `run_${now}_${Math.random().toString(16).slice(2, 10)}`,
      source: "refill",
      status: "ok",
      createdAt: now,
      finishedAt: now,
      createdCount: 0,
      warning: "",
      error: "",
      createdItemIds: [],
      createdStartKeys: [],
      rolledBackAt: null,
      rollbackDeletedCount: 0,
      rollbackFailedCount: 0,
      rollbackError: "",
    }
    if (idsChanged || issuedChanged || historyAdds.length) {
      const mergedHistory = [...historyBase, ...historyAdds].slice(-1000)
      patchSchedule(schedule.id, {
        createdItemIds: prunedTrackedIds,
        issuedStartKeys,
        lastIssuedStartKey,
        history: mergedHistory,
        runs: [...runsBase, runEntry].slice(-100),
      })
    } else {
      patchSchedule(schedule.id, {
        runs: [...runsBase, runEntry].slice(-100),
      })
    }
    return { ok: true, created: 0, have, want, startHasTime }
  }

  const created = await createCopiesFromTemplate({
    schedule,
    templateItem: template,
    missing,
    existingStarts: trackedItems
      .map((it) => it.fieldData && it.fieldData[startKey])
      .filter(Boolean),
    issuedStartKeys,
    lastIssuedStartKey,
  })

  if (created && created.publishError) {
    const reason = String(created.publishError)
    return {
      ok: false,
      reason,
      created: 0,
      have,
      want,
      startHasTime,
      transient: isTransientReason(reason),
    }
  }

  const createdIds = Array.isArray(created && created.createdItemIds) ? created.createdItemIds : []
  const createdStartKeys = Array.isArray(created && created.createdStartKeys) ? created.createdStartKeys : []

  const createdState = schedule.status === "publish" ? "published" : schedule.status === "staged" ? "staged" : "draft"
  for (let i = 0; i < createdIds.length; i++) {
    addHistoryEntry({
      itemId: String(createdIds[i] || ""),
      startISO: String(createdStartKeys[i] || ""),
      source: "refill",
      state: createdState,
      createdAt: Date.now(),
      outputMode: schedule.status,
    })
  }

  const nextIds = Array.from(new Set([...prunedTrackedIds, ...createdIds].map((x) => String(x)).filter(Boolean)))
  const nextIssued = Array.from(new Set([...issuedStartKeys, ...createdStartKeys])).sort()
  const nextLastIssued = String((created && created.lastIssuedStartKey) || (nextIssued.length ? nextIssued[nextIssued.length - 1] : lastIssuedStartKey || ""))
  const mergedHistory = [...historyBase, ...historyAdds].slice(-1000)
  const now = Date.now()
  const runsBase = Array.isArray(schedule.runs) ? schedule.runs : []
  const runEntry = {
    runId: `run_${now}_${Math.random().toString(16).slice(2, 10)}`,
    source: "refill",
    status: "ok",
    createdAt: now,
    finishedAt: now,
    createdCount: createdIds.length,
    warning: String((created && created.warning) || ""),
    error: "",
    createdItemIds: createdIds,
    createdStartKeys,
    rolledBackAt: null,
    rollbackDeletedCount: 0,
    rollbackFailedCount: 0,
    rollbackError: "",
  }

  patchSchedule(schedule.id, {
    createdCount: (schedule.createdCount || 0) + createdIds.length,
    createdItemIds: nextIds,
    issuedStartKeys: nextIssued,
    lastIssuedStartKey: nextLastIssued,
    history: mergedHistory,
    runs: [...runsBase, runEntry].slice(-100),
  })

  return { ok: true, created: createdIds.length, have: have + createdIds.length, want, startHasTime }
}

module.exports = {
  runSchedule,
}
