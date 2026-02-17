const { loadSchedules, patchSchedule } = require("./store")
const { runSchedule } = require("./worker")

function isTransientReason(reason) {
  const msg = String(reason || "").toLowerCase()
  if (!msg) return false
  return (
    msg.includes("too many requests") ||
    msg.includes(" 429") ||
    msg.includes("error: 429") ||
    msg.includes("publish already in progress") ||
    msg.includes("retry in") ||
    msg.includes("rate limit") ||
    msg.includes("waiting for cms consistency")
  )
}

function parseRetryBackoffMs(reason) {
  const msg = String(reason || "")
  const m = msg.match(/retry\s+in\s+~?(\d+)\s*s/i)
  const sec = m ? Number(m[1]) : 0
  if (Number.isFinite(sec) && sec > 0) return sec * 1000
  if (isTransientReason(msg)) return 15000
  return 0
}

function startScheduler(deps) {
  console.log("[AutoRefill] scheduler started")
  const inFlight = new Set()
  const notify = deps && typeof deps.notify === "function" ? deps.notify : async () => null

  setInterval(async () => {
    const all = loadSchedules()
    const now = Date.now()

    for (const s of all) {
      if (!s) continue
      if (s.isStopped || s.isPaused) continue
      if (inFlight.has(s.id)) continue

      const everyMs = 10000
      const due = !s.lastTickAt || (now - s.lastTickAt >= everyMs)

      if (!due) continue

      patchSchedule(s.id, {
        lastTickAt: now,
        lastRunStatus: "running",
        lastRunMessage: "Run in progress",
      })
      inFlight.add(s.id)

      try {
        const res = await runSchedule(s, deps)
        if (!res || res.ok !== true) {
          const reason = String(res && res.reason ? res.reason : "Schedule run failed")
          const transient = Boolean((res && res.transient) || isTransientReason(reason))
          if (transient) {
            const backoffMs = parseRetryBackoffMs(reason)
            patchSchedule(s.id, {
              lastRunAt: Date.now(),
              lastRunStatus: "ok",
              lastRunMessage: reason,
              errorStreak: 0,
              lastTickAt: backoffMs ? Date.now() + Math.max(0, backoffMs - 10000) : Date.now(),
            })
            console.log("[AutoRefill] transient run condition", s.id, reason)
            continue
          }
          const nextErrorStreak = Number(s.errorStreak || 0) + 1
          const fatalTemplateMissing = /template item not found/i.test(reason)
          const shouldPause = fatalTemplateMissing || nextErrorStreak >= 5

          patchSchedule(s.id, {
            lastRunAt: Date.now(),
            lastRunStatus: "error",
            lastRunMessage: shouldPause
              ? `${reason} (Auto refill paused after repeated failures)`
              : reason,
            errorStreak: nextErrorStreak,
            isPaused: shouldPause ? true : Boolean(s.isPaused),
          })
          await notify({
            userId: s.userId,
            type: shouldPause ? "schedule.paused" : "schedule.run_failed",
            category: "schedule",
            severity: shouldPause ? "warning" : "error",
            title: shouldPause ? "Auto refill paused" : "Auto refill run failed",
            body: shouldPause
              ? `${String(s.templateTitle || "Schedule")} paused after repeated failures.`
              : `${String(s.templateTitle || "Schedule")}: ${reason}`,
            dedupeKey: shouldPause ? `paused:${s.id}:${nextErrorStreak}` : "",
          })
          console.log("[AutoRefill] schedule failed", s.id, reason)
        } else {
          patchSchedule(s.id, {
            lastRunAt: Date.now(),
            lastRunStatus: "ok",
            lastRunMessage: res.created > 0 ? `Created ${res.created} item(s)` : "No refill needed",
            errorStreak: 0,
          })
          console.log(
            "[AutoRefill] schedule ok",
            s.id,
            "created",
            res.created,
            "have",
            res.have,
            "want",
            res.want,
            "hasTime",
            res.startHasTime
          )
        }
      } catch (e) {
        const reason = String(e && e.message ? e.message : e)
        if (isTransientReason(reason)) {
          const backoffMs = parseRetryBackoffMs(reason)
          patchSchedule(s.id, {
            lastRunAt: Date.now(),
            lastRunStatus: "ok",
            lastRunMessage: reason,
            errorStreak: 0,
            lastTickAt: backoffMs ? Date.now() + Math.max(0, backoffMs - 10000) : Date.now(),
          })
          console.log("[AutoRefill] transient schedule error", s.id, reason)
          continue
        }
        const nextErrorStreak = Number(s.errorStreak || 0) + 1
        const shouldPause = nextErrorStreak >= 5
        patchSchedule(s.id, {
          lastRunAt: Date.now(),
          lastRunStatus: "error",
          lastRunMessage: shouldPause
            ? `${reason} (Auto refill paused after repeated failures)`
            : reason,
          errorStreak: nextErrorStreak,
          isPaused: shouldPause ? true : Boolean(s.isPaused),
        })
        await notify({
          userId: s.userId,
          type: shouldPause ? "schedule.paused" : "schedule.run_failed",
          category: "schedule",
          severity: shouldPause ? "warning" : "error",
          title: shouldPause ? "Auto refill paused" : "Auto refill run failed",
          body: shouldPause
            ? `${String(s.templateTitle || "Schedule")} paused after repeated failures.`
            : `${String(s.templateTitle || "Schedule")}: ${reason}`,
          dedupeKey: shouldPause ? `paused:${s.id}:${nextErrorStreak}` : "",
        })
        console.log("[AutoRefill] schedule error", s.id, reason)
      } finally {
        inFlight.delete(s.id)
      }
    }
  }, 2000)
}

module.exports = {
  startScheduler,
}
