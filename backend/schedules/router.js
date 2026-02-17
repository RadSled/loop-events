const express = require("express")
const { loadSchedules, upsertSchedule, patchSchedule, deleteSchedule } = require("./store")
const { sanitizeSchedule } = require("./types")

function createSchedulesRouter(options = {}) {
  const r = express.Router()
  const getUserPlan = typeof options.getUserPlan === "function" ? options.getUserPlan : async () => ({ plan: "free", limits: { maxSchedules: 1 } })
  const notify = typeof options.notify === "function" ? options.notify : async () => null

  r.get("/", (req, res) => {
    const authUser = req.authUser || null
    if (!authUser || !authUser.id) {
      res.status(401).json({ ok: false, error: "Not authenticated" })
      return
    }
    res.json({ ok: true, schedules: loadSchedules({ userId: authUser.id }) })
  })

  r.post("/", async (req, res) => {
    const authUser = req.authUser || null
    if (!authUser || !authUser.id) {
      res.status(401).json({ ok: false, error: "Not authenticated" })
      return
    }

    const incoming = sanitizeSchedule({ ...(req.body || {}), userId: authUser.id })

    if (!incoming.id) {
      res.status(400).json({ ok: false, error: "Missing schedule id" })
      return
    }

    if (!incoming.collectionId || !incoming.startFieldId || !incoming.templateItemId || !incoming.seedStartISO) {
      res.status(400).json({ ok: false, error: "Missing required schedule fields" })
      return
    }

    const existing = loadSchedules({ userId: authUser.id })
    const isExisting = existing.some((x) => x.id === incoming.id)

    if (!isExisting) {
      const planInfo = await getUserPlan(authUser.id)
      const maxSchedules = Number(planInfo?.limits?.maxSchedules)
      if (Number.isFinite(maxSchedules) && maxSchedules > 0 && existing.length >= maxSchedules) {
        res.status(403).json({ ok: false, error: `Your current plan allows up to ${maxSchedules} active auto refill schedule${maxSchedules === 1 ? "" : "s"}.` })
        return
      }
    }

    const saved = upsertSchedule(incoming, { userId: authUser.id })
    if (!isExisting && saved) {
      await notify({
        userId: authUser.id,
        type: "schedule.created",
        category: "schedule",
        severity: "success",
        title: "Schedule created",
        body: `${String(saved.templateTitle || "Schedule")} was created successfully.`,
      })
    }
    res.json({ ok: true, schedule: saved })
  })

  r.patch("/:id", async (req, res) => {
    const authUser = req.authUser || null
    if (!authUser || !authUser.id) {
      res.status(401).json({ ok: false, error: "Not authenticated" })
      return
    }

    const patch = req.body && typeof req.body === "object" ? req.body : {}
    const keys = Object.keys(patch)
    const pauseOnly = keys.length === 1 && keys[0] === "isPaused"

    if (!pauseOnly) {
      const planInfo = await getUserPlan(authUser.id)
      if (String(planInfo?.plan || "free") !== "paid") {
        res.status(403).json({ ok: false, error: "Editing schedules is available on the Paid plan." })
        return
      }
    }

    const updated = patchSchedule(req.params.id, patch, { userId: authUser.id })
    if (!updated) {
      res.status(404).json({ ok: false, error: "Schedule not found" })
      return
    }

    if (!pauseOnly) {
      await notify({
        userId: authUser.id,
        type: "schedule.updated",
        category: "schedule",
        severity: "info",
        title: "Schedule updated",
        body: `${String(updated.templateTitle || "Schedule")} settings were updated.`,
      })
    }

    res.json({ ok: true, schedule: updated })
  })

  r.delete("/:id", async (req, res) => {
    const authUser = req.authUser || null
    if (!authUser || !authUser.id) {
      res.status(401).json({ ok: false, error: "Not authenticated" })
      return
    }

    const found = loadSchedules({ userId: authUser.id }).find((x) => String(x && x.id ? x.id : "") === String(req.params.id || ""))
    const ok = deleteSchedule(req.params.id, { userId: authUser.id })
    if (ok) {
      await notify({
        userId: authUser.id,
        type: "schedule.deleted",
        category: "schedule",
        severity: "warning",
        title: "Schedule deleted",
        body: `${String(found?.templateTitle || "Schedule")} was deleted.`,
      })
    }
    res.json({ ok, deleted: ok })
  })

  return r
}

module.exports = {
  createSchedulesRouter,
}
