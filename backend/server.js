require("dotenv").config({ path: require("path").join(__dirname, ".env") })
const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { createSchedulesRouter } = require("./schedules/router")
const { loadSchedules, patchSchedule, deleteSchedule } = require("./schedules/store")
const { startScheduler } = require("./schedules/scheduler")
const { runSchedule } = require("./schedules/worker")
const { buildPreviewStarts, buildPreviewEnds } = require("./schedules/recurrence")
const { loadNotifications, addNotification, markAllRead, markRead, deleteNotification } = require("./notifications/store")

const app = express()

app.disable("x-powered-by")

app.use(
  express.json({
    limit: "256kb",
    verify: (req, _res, buf) => {
      if (req.originalUrl === "/api/stripe/webhook") {
        req.rawBody = Buffer.from(buf)
      }
    },
  })
)

const PORT = Number(process.env.PORT || 3001)
const ROOT_DATA_DIR = process.env.LOOP_EVENTS_DATA_DIR
  ? path.resolve(process.env.LOOP_EVENTS_DATA_DIR)
  : path.join(__dirname, "data")
const TOKENS_PATH = path.join(ROOT_DATA_DIR, "tokens", "tokens.json")
const LEGACY_TOKENS_PATH = path.join(__dirname, "tokens.dev.json")
const PROCESSED_STRIPE_EVENTS_PATH = path.join(ROOT_DATA_DIR, "stripe", "processed-events.json")
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "")
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || "").trim()
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim()
const STRIPE_PRICE_ID_PAID = String(process.env.STRIPE_PRICE_ID_PAID || "").trim()
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim()
const APP_BASE_URL = String(process.env.APP_BASE_URL || "http://localhost:1337").trim().replace(/\/+$/, "")
const STRIPE_RETURN_BASE = String(process.env.STRIPE_RETURN_BASE || `http://localhost:${PORT}`).trim().replace(/\/+$/, "")
const STRIPE_DOWNGRADE_MODE = String(process.env.STRIPE_DOWNGRADE_MODE || "period_end").trim().toLowerCase() === "immediate" ? "immediate" : "period_end"
const TEST_PLAN_ALLOWLIST = String(process.env.TEST_PLAN_ALLOWLIST || "creator@radsled.com")
  .split(",")
  .map((x) => String(x || "").trim().toLowerCase())
  .filter(Boolean)
const CORS_ALLOWLIST = Array.from(
  new Set(
    [
      ...String(process.env.CORS_ALLOWLIST || APP_BASE_URL || "")
        .split(",")
        .map((x) => String(x || "").trim().replace(/\/+$/, ""))
        .filter(Boolean),
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`,
    ].filter(Boolean)
  )
)
const SCHEDULER_ENABLED = String(process.env.SCHEDULER_ENABLED || "true").trim().toLowerCase() !== "false"
const TRUST_PROXY = String(process.env.TRUST_PROXY || "").trim().toLowerCase() === "true"
let tokenMemoryStore = {}

if (TRUST_PROXY) {
  app.set("trust proxy", 1)
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "")
  if (!raw) return ""
  if (raw.toLowerCase() === "null") return "null"
  try {
    const u = new URL(raw)
    return `${u.protocol}//${u.host}`.toLowerCase()
  } catch {
    return raw.toLowerCase()
  }
}

function originMatchesRule(originRaw, ruleRaw) {
  const origin = normalizeOrigin(originRaw)
  const rule = normalizeOrigin(ruleRaw)
  if (!origin || !rule) return false

  if (rule === "*") return true
  if (rule === "null") return origin === "null"

  if (rule.startsWith("*.")) {
    if (origin === "null") return false
    try {
      const u = new URL(origin)
      const suffix = rule.slice(1)
      return u.protocol === "https:" && u.hostname.toLowerCase().endsWith(suffix)
    } catch {
      return false
    }
  }

  return origin === rule
}

function isAllowedCorsOrigin(origin) {
  const raw = String(origin || "").trim().replace(/\/+$/, "")
  if (!raw) return true
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw)) return true

  const normalized = normalizeOrigin(raw)
  if (normalized === "null") return true
  try {
    const u = new URL(normalized)
    const host = String(u.hostname || "").toLowerCase()
    if (u.protocol === "https:" && (host === "webflow.com" || host.endsWith(".webflow.com"))) return true
    if (u.protocol === "https:" && host.endsWith(".webflow-ext.com")) return true
  } catch {
    // fall through to explicit allowlist rules
  }

  if (!CORS_ALLOWLIST.length) return false
  return CORS_ALLOWLIST.some((rule) => originMatchesRule(raw, rule))
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (isAllowedCorsOrigin(origin)) {
        cb(null, true)
        return
      }
      cb(null, false)
    },
  })
)

app.use((req, res, next) => {
  if (req.path === "/api/auth/relay" || req.path.startsWith("/api/auth/relay/")) {
    return next()
  }
  const origin = String(req.headers.origin || "").trim()
  if (origin && !isAllowedCorsOrigin(origin)) {
    return res.status(403).json({ ok: false, error: "Origin not allowed" })
  }
  return next()
})

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  if (req.path === "/health" || req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
    res.setHeader("Pragma", "no-cache")
    res.setHeader("Expires", "0")
    res.setHeader("Surrogate-Control", "no-store")
  }
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  }
  if (req.path === "/auth/callback" || req.path === "/billing/success" || req.path === "/billing/cancel" || req.path === "/billing/return") {
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:;")
  }
  next()
})

function getClientIp(req) {
  const direct = String(req.ip || "").trim()
  if (direct) return direct
  const fromHeader = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()
  return fromHeader || "unknown"
}

function createRateLimiter(opts = {}) {
  const max = Math.max(1, Number(opts.max || 60))
  const windowMs = Math.max(1000, Number(opts.windowMs || 60_000))
  const keyFn = typeof opts.keyFn === "function" ? opts.keyFn : (req) => getClientIp(req)
  const store = new Map()

  return (req, res, next) => {
    const key = String(keyFn(req) || "anon").slice(0, 300)
    const now = Date.now()
    const hit = store.get(key)
    if (!hit || now >= hit.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    if (hit.count >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((hit.resetAt - now) / 1000))
      res.setHeader("Retry-After", String(retryAfterSec))
      return res.status(429).json({ ok: false, error: "Too many requests. Please retry shortly." })
    }

    hit.count += 1
    return next()
  }
}

const authRelayRateLimit = createRateLimiter({ max: 120, windowMs: 60_000 })
const billingRateLimit = createRateLimiter({
  max: 40,
  windowMs: 60_000,
  keyFn: (req) => String(req.authUser?.id || getClientIp(req)),
})
const webhookRateLimit = createRateLimiter({ max: 240, windowMs: 60_000 })
const webflowRateLimit = createRateLimiter({
  max: 180,
  windowMs: 60_000,
  keyFn: (req) => String(req.authUser?.id || getClientIp(req)),
})
const runRateLimit = createRateLimiter({
  max: 30,
  windowMs: 60_000,
  keyFn: (req) => String(req.authUser?.id || getClientIp(req)),
})

function ensureRuntimeStorageReady() {
  const dirs = [
    ROOT_DATA_DIR,
    path.dirname(TOKENS_PATH),
    path.dirname(PROCESSED_STRIPE_EVENTS_PATH),
    path.join(ROOT_DATA_DIR, "notifications"),
    path.join(ROOT_DATA_DIR, "schedules"),
  ]
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.accessSync(dir, fs.constants.W_OK)
  }
}

const sitePublishNextAllowedAt = new Map()
const sitePublishInFlight = new Set()
const authRelayStore = new Map()
const AUTH_RELAY_TTL_MS = 5 * 60 * 1000
const retryInFlight = new Set()
const PLAN_LIMITS = {
  free: { maxRunCount: 10, maxSchedules: 1 },
  paid: { maxRunCount: 100, maxSchedules: Number.POSITIVE_INFINITY },
}

async function notifyUser(input) {
  try {
    const row = addNotification(input || {})
    return row
  } catch {
    return null
  }
}

function pruneAuthRelay() {
  const now = Date.now()
  for (const [attemptId, row] of authRelayStore.entries()) {
    if (!row || now - Number(row.createdAt || 0) > AUTH_RELAY_TTL_MS) {
      authRelayStore.delete(attemptId)
    }
  }
}

function isValidAttemptId(input) {
  const value = String(input || "").trim()
  if (!value) return false
  if (value.length < 12 || value.length > 140) return false
  return /^[a-z0-9_-]+$/i.test(value)
}

setInterval(pruneAuthRelay, 30 * 1000).unref()

function ensureSupabaseServerConfig() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in backend/.env")
  }
}

function getBearerToken(req) {
  const h = String((req.headers && req.headers.authorization) || "").trim()
  if (!h.toLowerCase().startsWith("bearer ")) return ""
  return h.slice(7).trim()
}

async function getSupabaseUserFromToken(accessToken) {
  ensureSupabaseServerConfig()
  const token = String(accessToken || "").trim()
  if (!token) return null

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  return data && typeof data === "object" ? data : null
}

function getServiceHeaders(extra = {}) {
  ensureSupabaseServerConfig()
  return {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    ...(extra || {}),
  }
}

async function getOrCreateUserPlan(userId) {
  ensureSupabaseServerConfig()
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) return "free"

  const q = new URLSearchParams()
  q.set("user_id", `eq.${safeUserId}`)
  q.set("select", "plan")
  q.set("limit", "1")

  const getRes = await fetch(`${SUPABASE_URL}/rest/v1/user_plans?${q.toString()}`, {
    headers: getServiceHeaders(),
  })

  const rows = await getRes.json().catch(() => [])
  if (Array.isArray(rows) && rows[0] && rows[0].plan) {
    return String(rows[0].plan) === "paid" ? "paid" : "free"
  }

  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_plans`, {
    method: "POST",
    headers: getServiceHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify([{ user_id: safeUserId, plan: "free" }]),
  })
  const inserted = await upsertRes.json().catch(() => [])
  if (Array.isArray(inserted) && inserted[0] && inserted[0].plan) {
    return String(inserted[0].plan) === "paid" ? "paid" : "free"
  }
  return "free"
}

async function setUserPlan(userId, nextPlan) {
  ensureSupabaseServerConfig()
  const safeUserId = String(userId || "").trim()
  const plan = String(nextPlan || "").trim() === "paid" ? "paid" : "free"
  if (!safeUserId) throw new Error("Missing user id")

  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_plans`, {
    method: "POST",
    headers: getServiceHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify([{ user_id: safeUserId, plan }]),
  })

  if (!res.ok) {
    const msg = await res.text().catch(() => "")
    throw new Error(msg || "Could not save plan")
  }

  const data = await res.json().catch(() => [])
  const row = Array.isArray(data) ? data[0] : null
  const outPlan = row && row.plan ? String(row.plan) : plan
  return outPlan === "paid" ? "paid" : "free"
}

function getPlanLimits(plan) {
  return String(plan || "") === "paid" ? PLAN_LIMITS.paid : PLAN_LIMITS.free
}

function ensureStripeConfig() {
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID_PAID) {
    throw new Error("Missing STRIPE_SECRET_KEY or STRIPE_PRICE_ID_PAID in backend/.env")
  }
}

function ensureStripeWebhookConfig() {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET in backend/.env")
  }
}

async function stripeRequest(pathname, opts = {}) {
  ensureStripeConfig()
  const method = String(opts.method || "GET").toUpperCase()
  const form = opts.form && typeof opts.form === "object" ? opts.form : null
  const headers = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    ...(opts.headers || {}),
  }
  let body

  if (form) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(form)) {
      if (v === undefined || v === null) continue
      params.append(k, String(v))
    }
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    body = params.toString()
  }

  const res = await fetch(`https://api.stripe.com${pathname}`, {
    method,
    headers,
    body,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = String(data?.error?.message || data?.message || "Stripe request failed")
    const err = new Error(msg)
    err.statusCode = res.status
    throw err
  }
  return data
}

async function getUserPlanRow(userId) {
  ensureSupabaseServerConfig()
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) return null

  const q = new URLSearchParams()
  q.set("user_id", `eq.${safeUserId}`)
  q.set("select", "*")
  q.set("limit", "1")

  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_plans?${q.toString()}`, {
    headers: getServiceHeaders(),
  })
  const rows = await res.json().catch(() => [])
  if (Array.isArray(rows) && rows[0]) return rows[0]

  await fetch(`${SUPABASE_URL}/rest/v1/user_plans`, {
    method: "POST",
    headers: getServiceHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify([{ user_id: safeUserId, plan: "free" }]),
  })

  const res2 = await fetch(`${SUPABASE_URL}/rest/v1/user_plans?${q.toString()}`, {
    headers: getServiceHeaders(),
  })
  const rows2 = await res2.json().catch(() => [])
  return Array.isArray(rows2) && rows2[0] ? rows2[0] : null
}

async function upsertUserPlanRow(userId, patch = {}) {
  ensureSupabaseServerConfig()
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) throw new Error("Missing user id")

  const payload = [{ user_id: safeUserId, ...(patch || {}) }]
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_plans`, {
    method: "POST",
    headers: getServiceHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify(payload),
  })

  const rows = await res.json().catch(() => [])
  if (!res.ok) {
    const msg = Array.isArray(rows) ? "Could not upsert plan row" : String(rows?.message || "Could not upsert plan row")
    throw new Error(msg)
  }
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

async function findUserPlanByStripeRef(refKey, refValue) {
  ensureSupabaseServerConfig()
  const key = String(refKey || "").trim()
  const val = String(refValue || "").trim()
  if (!key || !val) return null
  const q = new URLSearchParams()
  q.set(key, `eq.${val}`)
  q.set("select", "*")
  q.set("limit", "1")
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_plans?${q.toString()}`, {
    headers: getServiceHeaders(),
  })
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

async function ensureStripeCustomerForUser(authUser) {
  const userId = String(authUser?.id || "").trim()
  const email = String(authUser?.email || "").trim().toLowerCase()
  if (!userId) throw new Error("Missing user")

  const row = await getUserPlanRow(userId)
  const existingCustomerId = String(row?.stripe_customer_id || "").trim()
  if (existingCustomerId) {
    try {
      await stripeRequest(`/v1/customers/${encodeURIComponent(existingCustomerId)}`)
      return existingCustomerId
    } catch (err) {
      const statusCode = Number(err?.statusCode)
      const msg = String(err?.message || "")
      const missingCustomer = statusCode === 404 || /no such customer/i.test(msg)
      if (!missingCustomer) throw err

      await upsertUserPlanRow(userId, {
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_price_id: null,
      })
    }
  }

  const customer = await stripeRequest("/v1/customers", {
    method: "POST",
    form: {
      email: email || undefined,
      "metadata[user_id]": userId,
    },
  })
  const customerId = String(customer?.id || "").trim()
  if (!customerId) throw new Error("Could not create Stripe customer")

  await upsertUserPlanRow(userId, { stripe_customer_id: customerId })
  return customerId
}

function verifyStripeSignature(req) {
  ensureStripeWebhookConfig()
  const header = String(req.headers["stripe-signature"] || "").trim()
  const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}), "utf8")
  if (!header || !rawBody) return false

  const parts = header.split(",").map((x) => String(x || "").trim())
  const timestampPart = parts.find((x) => x.startsWith("t="))
  const sigParts = parts.filter((x) => x.startsWith("v1="))
  if (!timestampPart || !sigParts.length) return false
  const t = String(timestampPart.slice(2) || "").trim()
  if (!/^\d+$/.test(t)) return false

  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - Number(t))
  if (ageSec > 300) return false

  const signedPayload = `${t}.${rawBody.toString("utf8")}`
  const expected = crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(signedPayload).digest("hex")

  for (const s of sigParts) {
    const received = String(s.slice(3) || "").trim()
    if (!received) continue
    const a = Buffer.from(expected, "utf8")
    const b = Buffer.from(received, "utf8")
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true
    }
  }
  return false
}

function toIsoFromUnix(unixSec) {
  const n = Number(unixSec)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toISOString()
}

function formatDateLabelFromIso(isoInput) {
  const iso = String(isoInput || "").trim()
  if (!iso) return ""
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ""
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function inferPlanFromSubscriptionStatus(status) {
  const s = String(status || "").trim().toLowerCase()
  if (s === "active" || s === "trialing" || s === "past_due") return "paid"
  return "free"
}

async function syncUserPlanRowFromStripe(row) {
  const safeRow = row && typeof row === "object" ? row : null
  if (!safeRow) return row
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID_PAID) return row

  const userId = String(safeRow.user_id || "").trim()
  const currentCustomerId = String(safeRow.stripe_customer_id || "").trim()
  const currentSubscriptionId = String(safeRow.stripe_subscription_id || "").trim()
  if (!userId || (!currentCustomerId && !currentSubscriptionId)) return row

  try {
    let sub = null
    if (currentSubscriptionId) {
      sub = await stripeRequest(`/v1/subscriptions/${encodeURIComponent(currentSubscriptionId)}`)
    } else {
      const list = await stripeRequest(`/v1/subscriptions?customer=${encodeURIComponent(currentCustomerId)}&status=all&limit=1`)
      sub = Array.isArray(list?.data) ? list.data[0] : null
    }

    if (!sub || typeof sub !== "object") return row

    const nextCustomerId = String(sub.customer || currentCustomerId || "").trim() || null
    const nextSubscriptionId = String(sub.id || currentSubscriptionId || "").trim() || null
    const nextStatus = String(sub.status || "").trim().toLowerCase()
    const nextCancelAtPeriodEnd = Boolean(sub.cancel_at_period_end)
    const nextPeriodEnd = toIsoFromUnix(sub.current_period_end)
    const nextStripePriceId = String(sub?.items?.data?.[0]?.price?.id || safeRow.stripe_price_id || "").trim() || null
    const nextPlan = inferPlanFromSubscriptionStatus(nextStatus)

    const hasChanged = (
      String(safeRow.plan || "").trim().toLowerCase() !== nextPlan
      || String(safeRow.subscription_status || "").trim().toLowerCase() !== nextStatus
      || Boolean(safeRow.cancel_at_period_end) !== nextCancelAtPeriodEnd
      || String(safeRow.current_period_end || "") !== String(nextPeriodEnd || "")
      || String(safeRow.stripe_customer_id || "") !== String(nextCustomerId || "")
      || String(safeRow.stripe_subscription_id || "") !== String(nextSubscriptionId || "")
      || String(safeRow.stripe_price_id || "") !== String(nextStripePriceId || "")
    )

    if (!hasChanged) return row

    await upsertUserPlanRow(userId, {
      plan: nextPlan,
      stripe_customer_id: nextCustomerId,
      stripe_subscription_id: nextSubscriptionId,
      stripe_price_id: nextStripePriceId,
      subscription_status: nextStatus || null,
      current_period_end: nextPeriodEnd,
      cancel_at_period_end: nextCancelAtPeriodEnd,
    })

    return {
      ...safeRow,
      plan: nextPlan,
      stripe_customer_id: nextCustomerId,
      stripe_subscription_id: nextSubscriptionId,
      stripe_price_id: nextStripePriceId,
      subscription_status: nextStatus || null,
      current_period_end: nextPeriodEnd,
      cancel_at_period_end: nextCancelAtPeriodEnd,
    }
  } catch {
    return row
  }
}

function pruneUserSchedulesToFreeLimit(userId) {
  const all = loadSchedules({ userId })
  if (!Array.isArray(all) || all.length <= 1) return 0
  const keepId = String(all[0]?.id || "")
  let pruned = 0
  for (const s of all) {
    const id = String(s?.id || "")
    if (!id || id === keepId) continue
    const ok = deleteSchedule(id, { userId })
    if (ok) pruned += 1
  }
  return pruned
}

function getPublicServerBase(req) {
  if (STRIPE_RETURN_BASE) return STRIPE_RETURN_BASE
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim() || "http"
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "localhost:3001").split(",")[0].trim() || "localhost:3001"
  return `${proto}://${host}`
}

function sendBillingResultPage(res, mode) {
  const safeMode = String(mode || "success").toLowerCase()
  const isSuccess = safeMode === "success"
  const title = isSuccess ? "Payment successful" : "Checkout canceled"
  const text = isSuccess
    ? "You can close this tab and return to Webflow."
    : "No changes were made. You can close this tab and return to Webflow."

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Loop Events Billing</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #eef2f8;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #0f172a;
      }
      .card {
        width: min(460px, calc(100vw - 24px));
        border-radius: 14px;
        border: 1px solid #dfe7f3;
        background: #fff;
        box-shadow: 0 16px 30px rgba(15, 23, 42, 0.12);
        padding: 14px;
      }
      .title { font-size: 16px; font-weight: 700; }
      .text { margin-top: 8px; font-size: 13px; color: #475569; }
      .btn {
        margin-top: 12px;
        height: 34px;
        border-radius: 10px;
        border: 1px solid #d7dfef;
        background: #fff;
        color: #1f2937;
        font-weight: 600;
        cursor: pointer;
        padding: 0 12px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="title">${title}</div>
      <div class="text">${text}</div>
      <button class="btn" type="button" onclick="window.close()">Close tab</button>
    </div>
    <script>
      setTimeout(function () {
        try { window.close() } catch (e) {}
      }, 1400)
    </script>
  </body>
</html>`

  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.send(html)
}

async function getUserPlanInfo(userId) {
  const plan = await getOrCreateUserPlan(userId)
  return {
    plan,
    limits: getPlanLimits(plan),
  }
}

function isAllowlistedPlanTester(email) {
  const safe = String(email || "").trim().toLowerCase()
  return Boolean(safe) && TEST_PLAN_ALLOWLIST.includes(safe)
}

async function requireAuth(req, res, next) {
  try {
    const accessToken = getBearerToken(req)
    if (!accessToken) {
      res.status(401).json({ ok: false, error: "Not authenticated" })
      return
    }

    const user = await getSupabaseUserFromToken(accessToken)
    if (!user || !user.id) {
      res.status(401).json({ ok: false, error: "Not authenticated" })
      return
    }

    req.authUser = {
      id: String(user.id),
      email: String(user.email || "").trim().toLowerCase(),
    }

    await notifyUser({
      userId: req.authUser.id,
      type: "account.welcome",
      category: "account",
      severity: "info",
      title: "Welcome to Loop Events",
      body: "Glad to have you here. Your setup is ready - start by picking fields in Step 1.",
      dedupeKey: `welcome:${req.authUser.id}`,
    })

    next()
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
}

function readTokens() {
  try {
    const dir = path.dirname(TOKENS_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(TOKENS_PATH) && fs.existsSync(LEGACY_TOKENS_PATH)) {
      try {
        fs.copyFileSync(LEGACY_TOKENS_PATH, TOKENS_PATH)
      } catch {}
    }
    if (!fs.existsSync(TOKENS_PATH)) return tokenMemoryStore
    const parsed = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"))
    if (parsed && typeof parsed === "object") {
      tokenMemoryStore = parsed
      return parsed
    }
    return tokenMemoryStore
  } catch {
    return tokenMemoryStore
  }
}

function writeTokens(tokens) {
  const safe = tokens && typeof tokens === "object" ? tokens : {}
  tokenMemoryStore = safe
  try {
    const dir = path.dirname(TOKENS_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(safe, null, 2), "utf8")
  } catch (err) {
    console.warn("[OAuth] Could not persist tokens to disk, using in-memory store:", String(err && err.message ? err.message : err))
  }
}

function getWebflowAccessTokenForUser(userId) {
  const tokens = readTokens()
  const safeUserId = String(userId || "").trim()
  if (safeUserId) {
    const byUser = tokens.users && typeof tokens.users === "object" ? tokens.users[safeUserId] : null
    const userToken = String(byUser?.access_token || "").trim()
    if (userToken) return userToken
  }
  return String(tokens.default?.access_token || "").trim()
}

function readProcessedStripeEvents() {
  try {
    const dir = path.dirname(PROCESSED_STRIPE_EVENTS_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(PROCESSED_STRIPE_EVENTS_PATH)) return []
    const parsed = JSON.parse(fs.readFileSync(PROCESSED_STRIPE_EVENTS_PATH, "utf8"))
    return Array.isArray(parsed) ? parsed.map((x) => String(x || "").trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function writeProcessedStripeEvents(list) {
  const dir = path.dirname(PROCESSED_STRIPE_EVENTS_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const safe = Array.isArray(list) ? list.map((x) => String(x || "").trim()).filter(Boolean) : []
  fs.writeFileSync(PROCESSED_STRIPE_EVENTS_PATH, JSON.stringify(safe.slice(-10000), null, 2), "utf8")
}

function hasProcessedStripeEvent(eventId) {
  const safeId = String(eventId || "").trim()
  if (!safeId) return false
  const all = readProcessedStripeEvents()
  return all.includes(safeId)
}

function markProcessedStripeEvent(eventId) {
  const safeId = String(eventId || "").trim()
  if (!safeId) return
  const all = readProcessedStripeEvents()
  if (all.includes(safeId)) return
  all.push(safeId)
  writeProcessedStripeEvents(all)
}

function getAuthorizeUrl(redirectUriOverride = "") {
  const clientId = process.env.WEBFLOW_CLIENT_ID
  const redirectUri = String(redirectUriOverride || process.env.WEBFLOW_REDIRECT_URI || "").trim()
  const scope = process.env.WEBFLOW_SCOPES || ""
  const state = process.env.WEBFLOW_STATE || ""

  if (!clientId) throw new Error("Missing WEBFLOW_CLIENT_ID in .env")
  if (!redirectUri) throw new Error("Missing WEBFLOW_REDIRECT_URI in .env")

  const params = new URLSearchParams()
  params.set("response_type", "code")
  params.set("client_id", clientId)
  params.set("redirect_uri", redirectUri)
  if (scope.trim()) params.set("scope", scope.trim())
  if (state.trim()) params.set("state", state.trim())

  return `https://webflow.com/oauth/authorize?${params.toString()}`
}

async function webflowFetch(endpoint, options = {}, userId = "") {
  const token = getWebflowAccessTokenForUser(userId)

  if (!token) {
    throw new Error("No access token stored. Visit /oauth/start first.")
  }

  const res = await fetch(`https://api.webflow.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })

  const contentType = res.headers.get("content-type") || ""
  const data = contentType.includes("application/json")
    ? await res.json().catch(() => ({}))
    : await res.text().catch(() => "")

  if (!res.ok) {
    console.error("[Webflow API] error:", res.status, endpoint, data)
    const msg =
      (typeof data === "object" && (data.message || data.error)) ||
      `Webflow API error: ${res.status}`
    throw new Error(msg)
  }

  return data
}

function normalizeItemResponse(data) {
  if (!data) return null
  if (data.item && typeof data.item === "object") return data.item
  if (Array.isArray(data.items)) return data.items[0] || null
  if (data.id) return data
  return null
}

function cloneFieldData(input) {
  const src = input && typeof input === "object" ? input : {}
  const out = { ...src }
  const deny = [
    "id",
    "_id",
    "created-on",
    "updated-on",
    "published-on",
    "createdOn",
    "updatedOn",
    "publishedOn",
    "_archived",
    "_draft",
  ]
  for (const key of deny) delete out[key]
  return out
}

function slugify(raw) {
  return String(raw || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item"
}

function applyUniqueSlug(fieldData, idx) {
  if (!fieldData || typeof fieldData !== "object") return fieldData
  if (!Object.prototype.hasOwnProperty.call(fieldData, "slug")) return fieldData
  const base = slugify(fieldData.slug || fieldData.name || "event")
  return {
    ...fieldData,
    slug: `${base}-${Date.now()}-${idx}`,
  }
}

async function getItemById(collectionId, itemId) {
  const safeId = String(itemId || "").trim()
  if (!safeId) return null

  try {
    const data = await webflowFetch(`/v2/collections/${collectionId}/items/${safeId}`)
    return normalizeItemResponse(data)
  } catch {
    const all = await getAllCollectionItems(collectionId)
    return all.find((it) => String(it && it.id) === safeId) || null
  }
}

async function getCollectionSchema(collectionId) {
  const data = await webflowFetch(`/v2/collections/${collectionId}`)
  return data && typeof data === "object" ? data : null
}

async function resolveFieldSlugs(collectionId, startFieldId, endFieldId, startFieldSlug, endFieldSlug) {
  const out = {
    startFieldSlug: String(startFieldSlug || "").trim(),
    endFieldSlug: String(endFieldSlug || "").trim(),
  }

  if (out.startFieldSlug && (out.endFieldSlug || !endFieldId)) return out

  const schema = await getCollectionSchema(collectionId)
  const fields = Array.isArray(schema && schema.fields) ? schema.fields : []

  if (!out.startFieldSlug && startFieldId) {
    const f = fields.find((x) => String(x && x.id) === String(startFieldId))
    if (f && f.slug) out.startFieldSlug = String(f.slug)
  }

  if (!out.endFieldSlug && endFieldId) {
    const f = fields.find((x) => String(x && x.id) === String(endFieldId))
    if (f && f.slug) out.endFieldSlug = String(f.slug)
  }

  return out
}

function fieldTypeLooksDateTime(rawType) {
  const t = String(rawType || "").toLowerCase().replace(/\s+/g, "")
  return t.includes("datetime") || t.includes("date-time") || t.includes("date_time") || t === "datetime-local"
}

async function resolveFieldDateTime(collectionId, fieldId, fieldSlug) {
  const schema = await getCollectionSchema(collectionId)
  const fields = Array.isArray(schema && schema.fields) ? schema.fields : []
  const byId = fields.find((x) => String(x && x.id) === String(fieldId || ""))
  const bySlug = fields.find((x) => String(x && x.slug) === String(fieldSlug || ""))
  const f = byId || bySlug
  return Boolean(f && fieldTypeLooksDateTime(f.type))
}

async function getAllCollectionItems(collectionId) {
  const data = await webflowFetch(`/v2/collections/${collectionId}/items`)
  return Array.isArray(data && data.items) ? data.items : []
}

function getSiteTimezoneFromList(sites, siteId) {
  const list = Array.isArray(sites) ? sites : []
  const safeId = String(siteId || "").trim()
  const found = list.find((s) => String(s && s.id) === safeId)
  const tz = String((found && (found.timezone || found.timeZone)) || "").trim()
  return tz || "UTC"
}

function getSiteFromList(sites, siteId) {
  const list = Array.isArray(sites) ? sites : []
  const safeId = String(siteId || "").trim()
  return list.find((s) => String(s && s.id) === safeId) || null
}

function isTooManyRequestsError(err) {
  const msg = String(err && err.message ? err.message : err).toLowerCase()
  return msg.includes("too many requests") || msg.includes("429")
}

function isTransientRunReason(reason) {
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
  if (isTransientRunReason(msg)) return 15000
  return 0
}

async function mapLimit(items, limit, worker) {
  const list = Array.isArray(items) ? items : []
  const max = Math.max(1, Number(limit) || 1)
  const out = new Array(list.length)
  let idx = 0

  async function run() {
    while (idx < list.length) {
      const i = idx
      idx += 1
      out[i] = await worker(list[i], i)
    }
  }

  const workers = []
  const n = Math.min(max, list.length)
  for (let i = 0; i < n; i++) workers.push(run())
  await Promise.all(workers)
  return out
}

function getSitePublishBlockReason(siteId) {
  const safeSiteId = String(siteId || "").trim()
  if (!safeSiteId) return "Missing site id for publish"
  if (sitePublishInFlight.has(safeSiteId)) return "Publish already in progress. Please retry in a few seconds"

  const nextAllowed = Number(sitePublishNextAllowedAt.get(safeSiteId) || 0)
  const now = Date.now()
  if (nextAllowed > now) {
    const sec = Math.max(1, Math.ceil((nextAllowed - now) / 1000))
    return `Too Many Requests. Retry in ~${sec}s`
  }

  return ""
}

async function getSitePublishTargets(siteId) {
  const safeId = String(siteId || "").trim()
  if (!safeId) return { domainUrls: [], domainIds: [] }

  try {
    const data = await webflowFetch("/v2/sites")
    const sites = Array.isArray(data && data.sites) ? data.sites : Array.isArray(data) ? data : []
    const site = getSiteFromList(sites, safeId)
    const customDomains = Array.isArray(site && site.customDomains) ? site.customDomains : []
    const domainUrls = customDomains.map((d) => String(d && d.url ? d.url : "")).filter(Boolean)
    const domainIds = customDomains.map((d) => String(d && d.id ? d.id : "")).filter(Boolean)
    return { domainUrls, domainIds }
  } catch {
    return { domainUrls: [], domainIds: [] }
  }
}

async function publishSiteNow(siteId, targets) {
  const safeSiteId = String(siteId || "").trim()
  if (!safeSiteId) return { ok: false, reason: "Missing site id" }

  const blocked = getSitePublishBlockReason(safeSiteId)
  if (blocked) return { ok: false, reason: blocked }

  sitePublishInFlight.add(safeSiteId)

  const domainUrls = Array.isArray(targets && targets.domainUrls) ? targets.domainUrls : []
  const domainIds = Array.isArray(targets && targets.domainIds) ? targets.domainIds : []

  const attempts = [
    { publishToWebflowSubdomain: true, customDomains: domainIds },
    { publishToWebflowSubdomain: true, customDomains: domainUrls },
    { publishToWebflowSubdomain: true },
  ]

  let lastErr = ""
  try {
    for (const body of attempts) {
      try {
        await webflowFetch(`/v2/sites/${safeSiteId}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        sitePublishNextAllowedAt.set(safeSiteId, Date.now() + 12000)
        return { ok: true }
      } catch (e) {
        lastErr = String(e && e.message ? e.message : e)
        if (isTooManyRequestsError(e)) {
          sitePublishNextAllowedAt.set(safeSiteId, Date.now() + 60000)
          return { ok: false, reason: "Too Many Requests" }
        }
      }
    }
  } finally {
    sitePublishInFlight.delete(safeSiteId)
  }

  return { ok: false, reason: lastErr || "Site publish failed" }
}

async function resolveSiteTimezone(siteId, fallback) {
  const safe = String(fallback || "").trim()
  if (safe) return safe
  if (!siteId) return safe || "UTC"
  try {
    const data = await webflowFetch("/v2/sites")
    const sites = Array.isArray(data && data.sites) ? data.sites : Array.isArray(data) ? data : []
    return getSiteTimezoneFromList(sites, siteId)
  } catch {
    return safe || "UTC"
  }
}

function toDatePartsInTz(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const parts = fmt.formatToParts(date)
  const map = {}
  for (const p of parts) map[p.type] = p.value
  return {
    year: Number(map.year || "0"),
    month: Number(map.month || "0"),
    day: Number(map.day || "0"),
    hour: Number(map.hour || "0"),
    minute: Number(map.minute || "0"),
  }
}

function parseWallDateTime(value) {
  const m = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/)
  if (!m) return null
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] || "0"),
    minute: Number(m[5] || "0"),
    hasTime: Boolean(m[4] && m[5]),
  }
}

function wallToUtcIso(value, timeZone) {
  const parsed = parseWallDateTime(value)
  if (!parsed) return String(value || "")
  if (!parsed.hasTime) return `${String(value || "").slice(0, 10)}`

  const desired = Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute)
  let guessMs = desired

  for (let i = 0; i < 4; i++) {
    const got = toDatePartsInTz(new Date(guessMs), timeZone)
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute)
    const deltaMin = Math.round((desired - gotAsUtc) / 60000)
    if (!deltaMin) break
    guessMs += deltaMin * 60000
  }

  return new Date(guessMs).toISOString()
}

function valueToWallKey(value, hasTime, timeZone) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  if (!hasTime) return raw.slice(0, 10)

  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    const p = parseWallDateTime(raw)
    if (!p || !p.hasTime) return raw.slice(0, 10)
    const m = String(p.month).padStart(2, "0")
    const day = String(p.day).padStart(2, "0")
    const hh = String(p.hour).padStart(2, "0")
    const mm = String(p.minute).padStart(2, "0")
    return `${p.year}-${m}-${day}T${hh}:${mm}`
  }

  const x = toDatePartsInTz(d, timeZone)
  const m = String(x.month).padStart(2, "0")
  const day = String(x.day).padStart(2, "0")
  const hh = String(x.hour).padStart(2, "0")
  const mm = String(x.minute).padStart(2, "0")
  return `${x.year}-${m}-${day}T${hh}:${mm}`
}

function nowWallKey(timeZone, hasTime) {
  const d = new Date()
  const x = toDatePartsInTz(d, timeZone)
  const m = String(x.month).padStart(2, "0")
  const day = String(x.day).padStart(2, "0")
  if (!hasTime) return `${x.year}-${m}-${day}`
  const hh = String(x.hour).padStart(2, "0")
  const mm = String(x.minute).padStart(2, "0")
  return `${x.year}-${m}-${day}T${hh}:${mm}`
}

async function getItemsByIds(collectionId, ids) {
  const list = Array.isArray(ids) ? ids.map((x) => String(x)).filter(Boolean) : []
  if (!list.length) return []

  const all = await getAllCollectionItems(collectionId)
  const byId = new Map()
  for (const it of all) {
    const id = String(it && it.id ? it.id : "")
    if (id) byId.set(id, it)
  }
  return list.map((id) => byId.get(id)).filter(Boolean)
}

async function createItem(collectionId, fieldData, isDraft) {
  const body = {
    isArchived: false,
    isDraft: Boolean(isDraft),
    fieldData,
  }

  const createdRaw = await webflowFetch(`/v2/collections/${collectionId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const createdItem = normalizeItemResponse(createdRaw)

  return createdItem
}

async function setItemsDraftState(collectionId, itemIds, isDraft) {
  const ids = Array.isArray(itemIds) ? itemIds.map((x) => String(x)).filter(Boolean) : []
  await mapLimit(ids, 1, async (id) => {
    await webflowFetch(`/v2/collections/${collectionId}/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDraft: Boolean(isDraft), isArchived: false }),
    })
  })
}

async function publishItems(collectionId, itemIds, siteId) {
  const ids = Array.isArray(itemIds) ? itemIds.map((x) => String(x)).filter(Boolean) : []
  if (!ids.length) return { mode: "none" }

  try {
    await setItemsDraftState(collectionId, ids, false)
  } catch (e) {
    const msg = String(e && e.message ? e.message : e)
    return { mode: "failed", reason: msg }
  }

  const safeSiteId = String(siteId || "").trim()
  if (!safeSiteId) {
    try {
      await setItemsDraftState(collectionId, ids, true)
    } catch {
      // ignore rollback failure
    }
    return { mode: "failed", reason: "Missing site id for publish" }
  }

  const targets = await getSitePublishTargets(safeSiteId)
  const sitePublish = await publishSiteNow(safeSiteId, targets)
  if (sitePublish.ok) return { mode: "published" }

  try {
    await setItemsDraftState(collectionId, ids, true)
  } catch {
    // ignore rollback failure
  }

  return {
    mode: "failed",
    reason: sitePublish.reason || "Site publish failed",
  }
}

async function unpublishItems(collectionId, itemIds) {
  const ids = Array.isArray(itemIds) ? itemIds.map((x) => String(x)).filter(Boolean) : []
  const done = []

  for (const id of ids) {
    try {
      await webflowFetch(`/v2/collections/${collectionId}/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDraft: true }),
      })
      done.push(id)
    } catch {
      // ignore one-off failures
    }
  }

  return done
}

async function archiveItems(collectionId, itemIds) {
  const ids = Array.isArray(itemIds) ? itemIds.map((x) => String(x)).filter(Boolean) : []
  const done = []
  for (const id of ids) {
    try {
      await webflowFetch(`/v2/collections/${collectionId}/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      })
      done.push(id)
    } catch {
      // ignore one-off failures
    }
  }
  return done
}

async function deleteItems(collectionId, itemIds) {
  const ids = Array.isArray(itemIds) ? itemIds.map((x) => String(x)).filter(Boolean) : []
  const done = []
  const results = await mapLimit(ids, 4, async (id) => {
    try {
      await webflowFetch(`/v2/collections/${collectionId}/items/${id}`, {
        method: "DELETE",
      })
      return id
    } catch {
      return ""
    }
  })
  for (const id of results) if (id) done.push(id)
  return done
}

async function createFromStarts(args) {
  const {
    siteId,
    collectionId,
    templateItemId,
    startFieldSlug,
    endFieldSlug,
    siteTimezone,
    startHasTime,
    endHasTime,
    starts,
    ends,
    status,
  } = args
  const effectiveStartHasTime = Boolean(startHasTime || /t\d{2}:\d{2}/i.test(String((starts && starts[0]) || "")))
  const effectiveEndHasTime = Boolean(endHasTime || /t\d{2}:\d{2}/i.test(String((ends && ends[0]) || "")))

  const template = await getItemById(collectionId, templateItemId)
  if (!template) throw new Error("Template item not found")

  const createdItemIds = []
  const createdStartKeys = []
  const errors = []
  const createAsDraft = status !== "staged"
  const startList = Array.isArray(starts) ? starts.map((x) => String(x)) : []
  const endList = Array.isArray(ends) ? ends.map((x) => String(x)) : []

  if (status === "publish") {
    const blocked = getSitePublishBlockReason(siteId)
    if (blocked) {
      return {
        createdItemIds: [],
        createdStartKeys: [],
        lastIssuedStartKey: "",
        createdCount: 0,
        errors,
        warning: "",
        publishError: blocked,
      }
    }
  }

  const createResults = await mapLimit(startList, 1, async (startISO, i) => {
    const safeStartISO = String(startISO || "")
    if (!safeStartISO) return { ok: false, idx: i, err: "Missing start date" }

    const startOut = effectiveStartHasTime ? wallToUtcIso(safeStartISO, siteTimezone) : safeStartISO.slice(0, 10)

    const fdBase = cloneFieldData(template.fieldData)
    const fdNext = {
      ...fdBase,
      [startFieldSlug]: startOut,
    }

    if (endFieldSlug) {
      const endRaw = endList[i] || ""
      fdNext[endFieldSlug] = effectiveEndHasTime ? wallToUtcIso(endRaw, siteTimezone) : String(endRaw).slice(0, 10)
    }

    const fdWithSlug = applyUniqueSlug(fdNext, i)
    try {
      const created = await createItem(collectionId, fdWithSlug, createAsDraft)
      if (created && created.id) {
        return { ok: true, idx: i, itemId: String(created.id), startKey: safeStartISO }
      }
      return { ok: false, idx: i, err: "Create returned no item id" }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      return { ok: false, idx: i, err: msg }
    }
  })

  for (const r of createResults) {
    if (!r || typeof r !== "object") continue
    if (r.ok) {
      createdItemIds.push(String(r.itemId || ""))
      createdStartKeys.push(String(r.startKey || ""))
    } else {
      errors.push(`copy ${Number(r.idx) + 1}: ${String(r.err || "unknown")}`)
    }
  }

  let warning = ""
  if (errors.length) {
    warning = `${errors.length} item(s) failed to create.`
  }

  if (status === "publish" && createdItemIds.length) {
    const publishRes = await publishItems(collectionId, createdItemIds, siteId)
    if (!publishRes || publishRes.mode !== "published") {
      const reason = String((publishRes && publishRes.reason) || "Publish failed").trim()
      try {
        await deleteItems(collectionId, createdItemIds)
      } catch {
        // ignore cleanup failure
      }
      return {
        createdItemIds: [],
        createdStartKeys: [],
        lastIssuedStartKey: "",
        createdCount: 0,
        errors,
        warning,
        publishError: reason,
      }
    }
  }

  return {
    createdItemIds,
    createdStartKeys,
    lastIssuedStartKey: createdStartKeys.length ? createdStartKeys[createdStartKeys.length - 1] : "",
    createdCount: createdItemIds.length,
    errors,
    warning,
  }
}

async function createCopiesFromTemplate(args) {
  const { schedule, templateItem, missing, existingStarts, issuedStartKeys, lastIssuedStartKey } = args
  const effectiveStartHasTime = Boolean(schedule.startHasTime || /t\d{2}:\d{2}/i.test(String(schedule.seedStartISO || "")))
  const effectiveEndHasTime = Boolean(schedule.endHasTime || /t\d{2}:\d{2}/i.test(String(schedule.seedEndISO || "")))
  const existing = new Set((Array.isArray(existingStarts) ? existingStarts : []).map((x) => String(x)).filter(Boolean))
  const issued = new Set((Array.isArray(issuedStartKeys) ? issuedStartKeys : []).map((x) => String(x)).filter(Boolean))
  const resolved = await resolveFieldSlugs(
    schedule.collectionId,
    schedule.startFieldId,
    schedule.endFieldId,
    schedule.startFieldSlug,
    schedule.endFieldSlug
  )
  const startKey = resolved.startFieldSlug || schedule.startFieldId
  const endKey = resolved.endFieldSlug || schedule.endFieldId

  const candidates = buildPreviewStarts({
    startISO: schedule.seedStartISO,
    count: 200,
    repeatType: schedule.repeatType,
    interval: schedule.interval,
    weekdaySet: schedule.weekdaySet,
    customRule: schedule.customRule,
    nth: schedule.nth,
    nthWeekday: schedule.nthWeekday,
    startWantsTime: effectiveStartHasTime,
  })

  const nextStarts = []
  const nowKey = nowWallKey(schedule.siteTimezone || "UTC", effectiveStartHasTime)
  let cutoffKey = String(lastIssuedStartKey || "")
  if (!cutoffKey || nowKey > cutoffKey) cutoffKey = nowKey

  for (const iso of candidates) {
    const key = String(iso || "")
    if (!key) continue
    if (cutoffKey && key <= cutoffKey) continue
    if (existing.has(key) || issued.has(key)) continue
    existing.add(key)
    issued.add(key)
    nextStarts.push(key)
    if (nextStarts.length >= missing) break
  }

  if (!nextStarts.length) {
    const issuedList = Array.from(issued).sort()
    return {
      createdItemIds: [],
      createdStartKeys: [],
      issuedStartKeys: issuedList,
      lastIssuedStartKey: issuedList.length ? issuedList[issuedList.length - 1] : cutoffKey,
    }
  }

  const nextEnds = endKey
    ? buildPreviewEnds({
        endFieldId: endKey,
        endISO: schedule.seedEndISO || schedule.seedStartISO,
        startISO: schedule.seedStartISO,
        previewStarts: nextStarts,
        endWantsTime: schedule.endHasTime,
      })
    : []

  const createdItemIds = []
  const createdStartKeys = []
  const createAsDraft = schedule.status !== "staged"

  if (schedule.status === "publish") {
    const blocked = getSitePublishBlockReason(schedule.siteId)
    if (blocked) {
      const issuedListBlocked = Array.from(issued).sort()
      return {
        createdItemIds: [],
        createdStartKeys: [],
        issuedStartKeys: issuedListBlocked,
        lastIssuedStartKey: issuedListBlocked.length ? issuedListBlocked[issuedListBlocked.length - 1] : cutoffKey,
        publishError: blocked,
      }
    }
  }

  const createResults = await mapLimit(nextStarts, 1, async (start, i) => {
    const fdBase = cloneFieldData(templateItem.fieldData)
    const startOut = effectiveStartHasTime
      ? wallToUtcIso(start, schedule.siteTimezone || "UTC")
      : String(start || "").slice(0, 10)
    const fdNext = {
      ...fdBase,
      [startKey]: startOut,
    }

    if (endKey) {
      const endRaw = nextEnds[i] || ""
      fdNext[endKey] = effectiveEndHasTime
        ? wallToUtcIso(endRaw, schedule.siteTimezone || "UTC")
        : String(endRaw).slice(0, 10)
    }

    const fdWithSlug = applyUniqueSlug(fdNext, i)
    const created = await createItem(schedule.collectionId, fdWithSlug, createAsDraft)
    return created && created.id ? { ok: true, id: String(created.id), start: String(start) } : { ok: false }
  })

  for (const r of createResults) {
    if (r && r.ok) {
      createdItemIds.push(String(r.id || ""))
      createdStartKeys.push(String(r.start || ""))
    }
  }

  if (schedule.status === "publish" && createdItemIds.length) {
    const publishRes = await publishItems(schedule.collectionId, createdItemIds, schedule.siteId)
    if (!publishRes || publishRes.mode !== "published") {
      const reason = String((publishRes && publishRes.reason) || "Publish failed")
      console.log("[AutoRefill] publish failed", schedule.id, reason)

      try {
        await deleteItems(schedule.collectionId, createdItemIds)
      } catch {
        // ignore cleanup failure
      }

      for (const s of nextStarts) issued.delete(String(s))
      const rolledIssued = Array.from(issued).sort()
      return {
        createdItemIds: [],
        createdStartKeys: [],
        issuedStartKeys: rolledIssued,
        lastIssuedStartKey: rolledIssued.length ? rolledIssued[rolledIssued.length - 1] : cutoffKey,
        publishError: reason,
      }
    }
  }

  const issuedList = Array.from(issued).sort()
  return {
    createdItemIds,
    createdStartKeys,
    issuedStartKeys: issuedList,
    lastIssuedStartKey: issuedList.length ? issuedList[issuedList.length - 1] : cutoffKey,
  }
}

const schedulerDeps = {
  webflow: {
    getItemById,
    getItemsByIds,
    createCopiesFromTemplate,
    resolveFieldSlugs,
    resolveFieldDateTime,
    resolveSiteTimezone,
    archiveItems,
    deleteItems,
    unpublishItems,
  },
  notify: notifyUser,
}

/* -------------------------
   OAuth
-------------------------- */

app.get("/oauth/start", async (req, res) => {
  try {
    const existing = readTokens()
    const existingToken = String(existing?.default?.access_token || "").trim()
    if (existingToken) {
      try {
        const probeRes = await fetch("https://api.webflow.com/v2/sites", {
          headers: { Authorization: `Bearer ${existingToken}` },
        })
        if (probeRes.ok) {
          console.log("[OAuth] Existing token already valid, skipping new authorization")
          return res.redirect("https://loop-events.webflow.io")
        }
      } catch {
        // proceed to regular OAuth authorization
      }
    }

    const dynamicRedirectUri = `${getPublicServerBase(req)}/oauth/callback`
    const authorizeUrl = getAuthorizeUrl(dynamicRedirectUri)
    console.log("[OAuth] Starting authorization")
    console.log("[OAuth] Full authorize URL:", authorizeUrl)
    console.log("[OAuth] Redirect URI in auth request:", dynamicRedirectUri)
    res.redirect(authorizeUrl)
  } catch (err) {
    console.error("[OAuth start]", err)
    res.status(500).send(String(err?.message || err))
  }
})

app.get("/oauth/callback", async (req, res) => {
  const code = String(req.query.code || "")
  const state = String(req.query.state || "")
  const oauthError = String(req.query.error || "")
  const oauthErrorDesc = String(req.query.error_description || "")

  if (oauthError) {
    console.error("[OAuth] Error from Webflow:", oauthError, oauthErrorDesc)
    return res.status(400).send(`Webflow OAuth error: ${oauthError}\n${oauthErrorDesc}`)
  }

  if (!code) return res.status(400).send("Missing code")

  if (process.env.WEBFLOW_STATE && state && state !== process.env.WEBFLOW_STATE) {
    return res.status(400).send("State does not match")
  }

  const clientId = process.env.WEBFLOW_CLIENT_ID
  const clientSecret = process.env.WEBFLOW_CLIENT_SECRET
  const envRedirectUri = String(process.env.WEBFLOW_REDIRECT_URI || "").trim()

  if (!clientId || !clientSecret) {
    console.error("[OAuth] Missing env vars:", {
      WEBFLOW_CLIENT_ID: Boolean(clientId),
      WEBFLOW_CLIENT_SECRET: Boolean(clientSecret),
      WEBFLOW_REDIRECT_URI: Boolean(envRedirectUri),
    })
    return res
      .status(500)
      .send("Missing WEBFLOW_CLIENT_ID or WEBFLOW_CLIENT_SECRET in backend env")
  }

  // Helper function to redirect back to Webflow after OAuth
  function redirectToWebflow(res) {
    // Redirect to Webflow Apps page after short delay
    res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Loop Events - Redirecting...</title>
    <meta http-equiv="refresh" content="2;url=https://loop-events.webflow.io" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        text-align: center;
        padding: 20px;
      }
      .container {
        max-width: 400px;
      }
      .icon {
        font-size: 64px;
        margin-bottom: 20px;
      }
      h1 {
        margin: 0 0 16px;
        font-size: 28px;
        font-weight: 600;
      }
      p {
        margin: 0 0 24px;
        font-size: 16px;
        opacity: 0.9;
        line-height: 1.5;
      }
      .button {
        display: inline-block;
        padding: 12px 24px;
        background: rgba(255, 255, 255, 0.2);
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 8px;
        color: white;
        text-decoration: none;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .button:hover {
        background: rgba(255, 255, 255, 0.3);
        border-color: rgba(255, 255, 255, 0.5);
      }
      .spinner {
        margin-top: 20px;
        font-size: 14px;
        opacity: 0.7;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="icon">✓</div>
      <h1>Installation Complete!</h1>
      <p>Loop Events has been successfully installed to your Webflow site.</p>
      <a href="https://loop-events.webflow.io" class="button">Go to Loop Events</a>
      <p class="spinner">Redirecting automatically in 2 seconds...</p>
    </div>
  </body>
</html>`);
  }

  console.log("[OAuth] Callback received. Code:", code.substring(0, 10) + "...")
  console.log("[OAuth] Full callback URL:", req.originalUrl || req.url)
  console.log("[OAuth] Full query params:", JSON.stringify(req.query))

  try {
    const callbackRedirectUri = `${getPublicServerBase(req)}/oauth/callback`
    const redirectCandidates = Array.from(new Set([
      String(envRedirectUri || "").trim(),
      String(callbackRedirectUri || "").trim(),
      "",
    ].filter(Boolean)))

    console.log("[OAuth] Attempting token exchange...")

    let tokenData = null
    let lastFailure = ""

    for (const redirectUri of [...redirectCandidates, ""]) {
      const bodyParams = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
      })
      if (redirectUri) bodyParams.set("redirect_uri", redirectUri)

      const tokenRes = await fetch("https://api.webflow.com/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyParams,
      })

      const data = await tokenRes.json().catch(() => ({}))
      if (tokenRes.ok && String(data?.access_token || "").trim()) {
        tokenData = data
        break
      }

      const reason = String(data?.error_description || data?.error || `HTTP ${tokenRes.status}`)
      lastFailure = reason
      console.error("[OAuth] Token exchange attempt failed:", {
        status: tokenRes.status,
        error: data?.error,
        description: data?.error_description,
        redirectUri: redirectUri || "<omitted>",
      })
    }

    if (!tokenData) {
      return res.status(502).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Loop Events - Connection failed</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f8fc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; padding: 16px; }
      .card { width: min(540px, calc(100vw - 24px)); background: #fff; border: 1px solid #dbe3f2; border-radius: 14px; box-shadow: 0 14px 28px rgba(15,23,42,0.12); padding: 16px; }
      .title { font-size: 20px; font-weight: 700; margin: 0 0 8px; }
      .text { margin: 0 0 10px; color: #334155; line-height: 1.5; font-size: 14px; }
      .code { margin: 10px 0; padding: 10px; border-radius: 10px; background: #eef2ff; border: 1px solid #d8e0ff; color: #1e293b; font-size: 12px; word-break: break-word; }
      .btn { display: inline-block; margin-top: 8px; text-decoration: none; background: #1f2937; color: #fff; padding: 10px 14px; border-radius: 10px; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 class="title">Could not connect Webflow site</h1>
      <p class="text">OAuth finished, but token exchange failed. Please verify app OAuth settings and try Connect Site again.</p>
      <div class="code">${String(lastFailure || "Token exchange failed")}</div>
      <a class="btn" href="https://loop-events.webflow.io">Back to Loop Events</a>
    </div>
  </body>
</html>`)
    }

    console.log("[OAuth] Token exchange successful")

    const tokens = readTokens()
    tokens.default = {
      access_token: tokenData.access_token,
      created_at: Date.now(),
      raw: tokenData,
    }
    writeTokens(tokens)

    console.log("[OAuth] Stored access token.")
    return redirectToWebflow(res)
  } catch (err) {
    console.error("[OAuth] Exception during token exchange:", err)
    return res.status(502).send("OAuth token exchange failed. Check Render logs for details.")
  }
})

/* -------------------------
   Health
-------------------------- */

app.get("/health", (req, res) => {
  res.json({ ok: true })
})

app.get("/billing/success", (req, res) => {
  sendBillingResultPage(res, "success")
})

app.get("/billing/cancel", (req, res) => {
  sendBillingResultPage(res, "cancel")
})

app.get("/billing/return", (req, res) => {
  sendBillingResultPage(res, "success")
})

app.get("/auth/callback", (req, res) => {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Loop Events Auth</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #eef2f8;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #0f172a;
      }
      .card {
        width: min(460px, calc(100vw - 24px));
        border-radius: 14px;
        border: 1px solid #dfe7f3;
        background: #fff;
        box-shadow: 0 16px 30px rgba(15, 23, 42, 0.12);
        padding: 14px;
      }
      .title {
        font-size: 16px;
        font-weight: 700;
      }
      .text {
        margin-top: 8px;
        font-size: 13px;
        color: #475569;
      }
      .btn {
        margin-top: 12px;
        height: 34px;
        border-radius: 10px;
        border: 1px solid #d7dfef;
        background: #fff;
        color: #1f2937;
        font-weight: 600;
        cursor: pointer;
        padding: 0 12px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div id="title" class="title">Completing authentication...</div>
      <div id="text" class="text">Please wait a moment.</div>
      <button class="btn" type="button" onclick="window.close()">Close tab</button>
    </div>
    <script>
      (async function () {
        var qs = new URLSearchParams(window.location.search || "")
        var hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""))
        var attemptId = String(qs.get("auth_attempt") || "").trim()
        var accessToken = String(hash.get("access_token") || "").trim()
        var refreshToken = String(hash.get("refresh_token") || "").trim()
        var err = String(hash.get("error_description") || hash.get("error") || "").trim()
        var titleEl = document.getElementById("title")
        var textEl = document.getElementById("text")

        function setState(title, text) {
          if (titleEl) titleEl.textContent = title
          if (textEl) textEl.textContent = text
        }

        if (err) {
          setState("Could not complete authentication", err)
          return
        }

        if (!accessToken || !refreshToken) {
          setState("Could not complete authentication", "Missing callback data. Please go back to Webflow and try again.")
          return
        }

        try {
          if (window.opener && window.opener !== window) {
            window.opener.postMessage(
              {
                type: "loop-events-auth-session",
                access_token: accessToken,
                refresh_token: refreshToken,
              },
              "*"
            )
            window.opener.postMessage({ type: "loop-events-auth-complete" }, "*")
          }

          if (attemptId) {
            var res = await fetch("/api/auth/relay", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                attemptId: attemptId,
                accessToken: accessToken,
                refreshToken: refreshToken,
              }),
            })
            if (!res.ok) {
              var data = await res.json().catch(function () { return {} })
              throw new Error(String((data && data.error) || "Auth relay failed"))
            }
          }

          setState("Confirmation successful", "You can close this tab and go back to Webflow.")
          setTimeout(function () {
            try { window.close() } catch (e) {}
          }, 1400)
        } catch (e) {
          setState("Could not complete authentication", String((e && e.message) || e || "Auth relay failed"))
        }
      })()
    </script>
  </body>
</html>`

  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.send(html)
})

app.post("/api/auth/relay", authRelayRateLimit, (req, res) => {
  try {
    const body = req.body || {}
    const attemptId = String(body.attemptId || "").trim()
    const accessToken = String(body.accessToken || "").trim()
    const refreshToken = String(body.refreshToken || "").trim()

    if (!isValidAttemptId(attemptId) || !accessToken || !refreshToken) {
      return res.status(400).json({ ok: false, error: "Missing relay payload" })
    }

    authRelayStore.set(attemptId, {
      accessToken,
      refreshToken,
      createdAt: Date.now(),
    })

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.get("/api/auth/relay/:attemptId", authRelayRateLimit, (req, res) => {
  try {
    const attemptId = String(req.params.attemptId || "").trim()
    if (!isValidAttemptId(attemptId)) return res.status(400).json({ ok: false, error: "Invalid attemptId" })

    const row = authRelayStore.get(attemptId)
    if (!row) return res.json({ ok: true, status: "pending" })

    authRelayStore.delete(attemptId)
    res.json({
      ok: true,
      status: "ready",
      accessToken: String(row.accessToken || ""),
      refreshToken: String(row.refreshToken || ""),
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.post("/api/billing/checkout", requireAuth, billingRateLimit, async (req, res) => {
  try {
    ensureStripeConfig()
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })

    const returnBase = getPublicServerBase(req)
    const customerId = await ensureStripeCustomerForUser(authUser)
    const checkout = await stripeRequest("/v1/checkout/sessions", {
      method: "POST",
      form: {
        mode: "subscription",
        customer: customerId,
        "line_items[0][price]": STRIPE_PRICE_ID_PAID,
        "line_items[0][quantity]": 1,
        success_url: `${returnBase}/billing/success`,
        cancel_url: `${returnBase}/billing/cancel`,
        client_reference_id: userId,
        "metadata[user_id]": userId,
        "subscription_data[metadata][user_id]": userId,
      },
    })

    res.json({ ok: true, url: String(checkout?.url || "") })
  } catch (err) {
    console.error("[Stripe Checkout] error", err && err.message ? err.message : String(err))
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.post("/api/billing/portal", requireAuth, billingRateLimit, async (req, res) => {
  try {
    ensureStripeConfig()
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })

    const returnBase = getPublicServerBase(req)
    const customerId = await ensureStripeCustomerForUser(authUser)
    const portal = await stripeRequest("/v1/billing_portal/sessions", {
      method: "POST",
      form: {
        customer: customerId,
        return_url: `${returnBase}/billing/return`,
      },
    })

    res.json({ ok: true, url: String(portal?.url || "") })
  } catch (err) {
    console.error("[Stripe Portal] error", err && err.message ? err.message : String(err))
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.post("/api/stripe/webhook", webhookRateLimit, async (req, res) => {
  try {
    if (!verifyStripeSignature(req)) {
      return res.status(400).json({ ok: false, error: "Invalid Stripe signature" })
    }

    const event = req.body && typeof req.body === "object" ? req.body : {}
    const eventId = String(event.id || "").trim()
    if (eventId && hasProcessedStripeEvent(eventId)) {
      return res.json({ received: true, duplicate: true })
    }
    const type = String(event.type || "")
    const obj = event?.data?.object || {}

    if (type === "checkout.session.completed") {
      const userId = String(obj?.metadata?.user_id || obj?.client_reference_id || "").trim()
      const customerId = String(obj?.customer || "").trim()
      const subscriptionId = String(obj?.subscription || "").trim()
      if (userId) {
        await upsertUserPlanRow(userId, {
          plan: "paid",
          stripe_customer_id: customerId || null,
          stripe_subscription_id: subscriptionId || null,
          stripe_price_id: STRIPE_PRICE_ID_PAID || null,
          subscription_status: "active",
          cancel_at_period_end: false,
        })
      }
      if (eventId) markProcessedStripeEvent(eventId)
      return res.json({ received: true })
    }

    if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
      const customerId = String(obj?.customer || "").trim()
      const subscriptionId = String(obj?.id || "").trim()
      const status = String(obj?.status || "").trim().toLowerCase()
      const cancelAtPeriodEnd = Boolean(obj?.cancel_at_period_end)
      const periodEnd = toIsoFromUnix(obj?.current_period_end)
      const stripePriceId = String(obj?.items?.data?.[0]?.price?.id || "").trim()

      let row = null
      if (customerId) row = await findUserPlanByStripeRef("stripe_customer_id", customerId)
      if (!row && subscriptionId) row = await findUserPlanByStripeRef("stripe_subscription_id", subscriptionId)
      if (!row || !row.user_id) {
        if (eventId) markProcessedStripeEvent(eventId)
        return res.json({ received: true })
      }

      const userId = String(row.user_id)
      const nextPlan = inferPlanFromSubscriptionStatus(status)

      await upsertUserPlanRow(userId, {
        plan: nextPlan,
        stripe_customer_id: customerId || row.stripe_customer_id || null,
        stripe_subscription_id: subscriptionId || row.stripe_subscription_id || null,
        stripe_price_id: stripePriceId || row.stripe_price_id || null,
        subscription_status: status || null,
        current_period_end: periodEnd,
        cancel_at_period_end: cancelAtPeriodEnd,
      })

      if (nextPlan === "free") {
        pruneUserSchedulesToFreeLimit(userId)
      }

      if (eventId) markProcessedStripeEvent(eventId)
      return res.json({ received: true })
    }

    if (type === "invoice.payment_failed") {
      const customerId = String(obj?.customer || "").trim()
      if (customerId) {
        const row = await findUserPlanByStripeRef("stripe_customer_id", customerId)
        if (row && row.user_id) {
          await upsertUserPlanRow(String(row.user_id), {
            subscription_status: "past_due",
          })
        }
      }
      if (eventId) markProcessedStripeEvent(eventId)
      return res.json({ received: true })
    }

    if (eventId) markProcessedStripeEvent(eventId)
    return res.json({ received: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.get("/api/plan", requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    const email = String(authUser.email || "").trim().toLowerCase()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })

    let row = await getUserPlanRow(userId)
    row = await syncUserPlanRowFromStripe(row)
    const resolvedPlan = String(row?.plan || "").trim().toLowerCase() === "paid" ? "paid" : "free"
    const planInfo = {
      plan: resolvedPlan,
      limits: getPlanLimits(resolvedPlan),
    }
    const activeScheduleCount = loadSchedules({ userId }).length
    const maxSchedules = Number.isFinite(planInfo.limits.maxSchedules) ? planInfo.limits.maxSchedules : null
    const hasReachedScheduleLimit = Number.isFinite(maxSchedules) ? activeScheduleCount >= Number(maxSchedules) : false
    const subStatus = String(row?.subscription_status || "").trim().toLowerCase()

    if (subStatus === "past_due" || subStatus === "unpaid") {
      await notifyUser({
        userId,
        type: "billing.past_due",
        category: "billing",
        severity: "warning",
        title: "Billing needs attention",
        body: "Your subscription is past due. Open billing to update payment details.",
        dedupeKey: `billing:${subStatus}`,
      })
    }

    if (Boolean(row?.cancel_at_period_end)) {
      const cancelDateLabel = formatDateLabelFromIso(row?.current_period_end)
      await notifyUser({
        userId,
        type: "billing.cancel_at_period_end",
        category: "billing",
        severity: "warning",
        title: "Subscription cancellation scheduled",
        body: cancelDateLabel
          ? `Your paid plan is set to cancel on ${cancelDateLabel}.`
          : "Your paid plan is set to cancel at period end.",
        dedupeKey: cancelDateLabel
          ? `billing:cancel_at_period_end:${cancelDateLabel}`
          : "billing:cancel_at_period_end",
      })
    }

    res.json({
      ok: true,
      plan: planInfo.plan,
      limits: {
        maxRunCount: planInfo.limits.maxRunCount,
        maxSchedules,
      },
      usage: {
        activeScheduleCount,
        hasReachedScheduleLimit,
      },
      subscription: {
        status: subStatus,
        cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
        currentPeriodEnd: row?.current_period_end || null,
      },
      billingAvailable: Boolean(STRIPE_SECRET_KEY && STRIPE_PRICE_ID_PAID),
      testingMode: true,
      canTogglePlan: isAllowlistedPlanTester(email),
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.post("/api/plan", requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    const email = String(authUser.email || "").trim().toLowerCase()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })
    if (!isAllowlistedPlanTester(email)) {
      return res.status(403).json({ ok: false, error: "Plan switching is not enabled for this account" })
    }

    const nextPlanRaw = String((req.body || {}).plan || "").trim().toLowerCase()
    const pruneExcessSchedules = Boolean((req.body || {}).pruneExcessSchedules)
    if (nextPlanRaw !== "free" && nextPlanRaw !== "paid") {
      return res.status(400).json({ ok: false, error: "Invalid plan value" })
    }

    const existingSchedules = loadSchedules({ userId })
    if (nextPlanRaw === "free" && existingSchedules.length > 1 && !pruneExcessSchedules) {
      return res.status(409).json({
        ok: false,
        code: "DOWNGRADE_REQUIRES_PRUNE",
        error: "Downgrading to Free keeps only one schedule. Confirm to delete the rest.",
        usage: {
          activeScheduleCount: existingSchedules.length,
        },
      })
    }

    let prunedCount = 0
    if (nextPlanRaw === "free" && existingSchedules.length > 1 && pruneExcessSchedules) {
      const keepId = String(existingSchedules[0]?.id || "")
      for (const s of existingSchedules) {
        const id = String(s && s.id ? s.id : "")
        if (!id || id === keepId) continue
        const ok = deleteSchedule(id, { userId })
        if (ok) prunedCount += 1
      }
    }

    const savedPlan = await setUserPlan(userId, nextPlanRaw)
    const limits = getPlanLimits(savedPlan)
    const activeScheduleCount = loadSchedules({ userId }).length
    const maxSchedules = Number.isFinite(limits.maxSchedules) ? limits.maxSchedules : null
    const hasReachedScheduleLimit = Number.isFinite(maxSchedules) ? activeScheduleCount >= Number(maxSchedules) : false
    res.json({
      ok: true,
      plan: savedPlan,
      limits: {
        maxRunCount: limits.maxRunCount,
        maxSchedules,
      },
      usage: {
        activeScheduleCount,
        hasReachedScheduleLimit,
      },
      prunedCount,
      testingMode: true,
      canTogglePlan: true,
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.get("/api/notifications", requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })

    await notifyUser({
      userId,
      type: "account.welcome",
      category: "account",
      severity: "info",
      title: "Welcome to Loop Events",
      body: "Glad to have you here. Your setup is ready - start by picking fields in Step 1.",
      dedupeKey: `welcome:${userId}`,
    })

    const notifications = loadNotifications({ userId, max: 200 })
    return res.json({ ok: true, notifications })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })
    const changed = markAllRead(userId)
    return res.json({ ok: true, changed })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })
    const id = String(req.params.id || "").trim()
    if (!id) return res.status(400).json({ ok: false, error: "Missing notification id" })
    const row = markRead(userId, id)
    if (!row) return res.status(404).json({ ok: false, error: "Notification not found" })
    return res.json({ ok: true, notification: row })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.delete("/api/notifications/:id", requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })
    const id = String(req.params.id || "").trim()
    if (!id) return res.status(400).json({ ok: false, error: "Missing notification id" })
    const ok = deleteNotification(userId, id)
    if (!ok) return res.status(404).json({ ok: false, error: "Notification not found" })
    return res.json({ ok: true, deleted: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.post("/api/notifications/account-event", requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })
    const event = String((req.body || {}).event || "").trim().toLowerCase()
    const map = {
      password_changed: {
        type: "account.password_changed",
        title: "Password updated",
        body: "Your password was changed successfully.",
        severity: "success",
      },
      notification_prefs_updated: {
        type: "account.notification_prefs_updated",
        title: "Notification preferences updated",
        body: "Your notification preferences were saved.",
        severity: "success",
      },
    }
    const payload = map[event]
    if (!payload) return res.status(400).json({ ok: false, error: "Unknown account event" })
    const row = await notifyUser({
      userId,
      category: "account",
      dedupeKey: `${payload.type}:${Date.now()}`,
      ...payload,
    })
    return res.json({ ok: true, notification: row })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.use("/api/schedules", requireAuth, createSchedulesRouter({
  getUserPlan: getUserPlanInfo,
  notify: notifyUser,
}))

app.get("/api/schedules/:id/runs", requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })

    const scheduleId = String(req.params.id || "").trim()
    if (!scheduleId) return res.status(400).json({ ok: false, error: "Missing schedule id" })

    const schedule = loadSchedules({ userId }).find((x) => String(x && x.id ? x.id : "") === scheduleId)
    if (!schedule) return res.status(404).json({ ok: false, error: "Schedule not found" })

    const runs = Array.isArray(schedule.runs) ? schedule.runs.slice().reverse() : []
    return res.json({ ok: true, runs })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.post("/api/schedules/:id/runs/:runId/rollback", requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })

    const scheduleId = String(req.params.id || "").trim()
    const runId = String(req.params.runId || "").trim()
    if (!scheduleId) return res.status(400).json({ ok: false, error: "Missing schedule id" })
    if (!runId) return res.status(400).json({ ok: false, error: "Missing run id" })

    const schedule = loadSchedules({ userId }).find((x) => String(x && x.id ? x.id : "") === scheduleId)
    if (!schedule) return res.status(404).json({ ok: false, error: "Schedule not found" })

    const runs = Array.isArray(schedule.runs) ? schedule.runs : []
    const runIdx = runs.findIndex((r) => String(r && r.runId ? r.runId : "") === runId)
    if (runIdx < 0) return res.status(404).json({ ok: false, error: "Run not found" })

    const targetRun = runs[runIdx] || {}
    if (targetRun.rolledBackAt) {
      return res.json({ ok: true, alreadyRolledBack: true, schedule })
    }

    const createdItemIds = Array.isArray(targetRun.createdItemIds)
      ? targetRun.createdItemIds.map((id) => String(id || "")).filter(Boolean)
      : []
    const createdStartKeys = Array.isArray(targetRun.createdStartKeys)
      ? targetRun.createdStartKeys.map((k) => String(k || ""))
      : []

    let deletedIds = []
    if (createdItemIds.length) {
      deletedIds = await deleteItems(schedule.collectionId, createdItemIds)
    }

    const deletedSet = new Set((Array.isArray(deletedIds) ? deletedIds : []).map((id) => String(id || "")).filter(Boolean))
    const deletedCount = deletedSet.size
    const failedCount = Math.max(0, createdItemIds.length - deletedCount)

    const nextRuns = runs.slice()
    nextRuns[runIdx] = {
      ...targetRun,
      rolledBackAt: Date.now(),
      rollbackDeletedCount: deletedCount,
      rollbackFailedCount: failedCount,
      rollbackError: failedCount > 0 ? "Some items could not be removed." : "",
    }

    const nextTrackedIds = (Array.isArray(schedule.createdItemIds) ? schedule.createdItemIds : []).filter(
      (id) => !deletedSet.has(String(id || ""))
    )
    const nextCreatedCount = Math.max(0, Number(schedule.createdCount || 0) - deletedCount)

    const rollbackHistoryAdds = []
    for (let i = 0; i < createdItemIds.length; i++) {
      const id = String(createdItemIds[i] || "")
      if (!id || !deletedSet.has(id)) continue
      rollbackHistoryAdds.push({
        itemId: id,
        startISO: String(createdStartKeys[i] || ""),
        source: "rollback",
        state: "deleted",
        createdAt: Date.now(),
        outputMode: String(targetRun.outputMode || schedule.status || "draft"),
      })
    }
    const nextHistory = [...(Array.isArray(schedule.history) ? schedule.history : []), ...rollbackHistoryAdds].slice(-1000)

    const updated = patchSchedule(scheduleId, {
      createdItemIds: nextTrackedIds,
      createdCount: nextCreatedCount,
      history: nextHistory,
      runs: nextRuns,
    }, { userId })

    if (!updated) return res.status(500).json({ ok: false, error: "Could not update schedule after rollback" })

    await notifyUser({
      userId,
      type: failedCount > 0 ? "schedule.rollback_partial" : "schedule.rollback_completed",
      category: "schedule",
      severity: failedCount > 0 ? "warning" : "success",
      title: failedCount > 0 ? "Rollback completed with warnings" : "Rollback completed",
      body: failedCount > 0
        ? `${String(schedule.templateTitle || "Schedule")}: removed ${deletedCount}, ${failedCount} could not be removed.`
        : `${String(schedule.templateTitle || "Schedule")}: removed ${deletedCount} item(s) from selected run.`,
    })

    return res.json({
      ok: true,
      schedule: updated,
      deletedCount,
      failedCount,
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

app.post("/api/schedules/:id/retry", requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" })

    const scheduleId = String(req.params.id || "").trim()
    if (!scheduleId) return res.status(400).json({ ok: false, error: "Missing schedule id" })

    const schedule = loadSchedules({ userId }).find((x) => String(x && x.id ? x.id : "") === scheduleId)
    if (!schedule) return res.status(404).json({ ok: false, error: "Schedule not found" })
    if (retryInFlight.has(scheduleId) || String(schedule.lastRunStatus || "") === "running") {
      return res.status(409).json({ ok: false, code: "IN_PROGRESS", error: "Retry already in progress", schedule })
    }

    retryInFlight.add(scheduleId)
    try {
      patchSchedule(scheduleId, {
        lastRunStatus: "running",
        lastRunMessage: "Run in progress",
      }, { userId })

      const run = await runSchedule(schedule, schedulerDeps)
      if (!run || run.ok !== true) {
        const reason = String(run && run.reason ? run.reason : "Schedule run failed")
        if (Boolean((run && run.transient) || isTransientRunReason(reason))) {
          const backoffMs = parseRetryBackoffMs(reason)
          const updatedTransient = patchSchedule(scheduleId, {
            lastRunAt: Date.now(),
            lastRunStatus: "ok",
            lastRunMessage: reason,
            errorStreak: 0,
            lastTickAt: backoffMs ? Date.now() + Math.max(0, backoffMs - 10000) : Date.now(),
          }, { userId })
          return res.status(409).json({
            ok: false,
            code: "TRANSIENT",
            error: reason,
            schedule: updatedTransient || null,
          })
        }
        const nextErrorStreak = Number(schedule.errorStreak || 0) + 1
        const fatalTemplateMissing = /template item not found/i.test(reason)
        const shouldPause = fatalTemplateMissing || nextErrorStreak >= 5
        const updated = patchSchedule(scheduleId, {
          lastRunAt: Date.now(),
          lastRunStatus: "error",
          lastRunMessage: shouldPause
            ? `${reason} (Auto refill paused after repeated failures)`
            : reason,
          errorStreak: nextErrorStreak,
          isPaused: shouldPause ? true : Boolean(schedule.isPaused),
        }, { userId })
        await notifyUser({
          userId,
          type: shouldPause ? "schedule.paused" : "schedule.retry_failed",
          category: "schedule",
          severity: shouldPause ? "warning" : "error",
          title: shouldPause ? "Auto refill paused" : "Retry failed",
          body: shouldPause
            ? `${String(schedule.templateTitle || "Schedule")} paused after repeated failures.`
            : `${String(schedule.templateTitle || "Schedule")}: ${reason}`,
          dedupeKey: shouldPause ? `paused:${scheduleId}:${nextErrorStreak}` : "",
        })
        return res.status(500).json({
          ok: false,
          error: reason,
          schedule: updated || null,
        })
      }

      const updated = patchSchedule(scheduleId, {
        lastRunAt: Date.now(),
        lastRunStatus: "ok",
        lastRunMessage: run.created > 0 ? `Created ${run.created} item(s)` : "No refill needed",
        errorStreak: 0,
      }, { userId })

      await notifyUser({
        userId,
        type: "schedule.retry_succeeded",
        category: "schedule",
        severity: "success",
        title: "Retry succeeded",
        body: `${String(schedule.templateTitle || "Schedule")} ran successfully.`,
      })

      return res.json({
        ok: true,
        message: run.created > 0 ? `Created ${run.created} item(s)` : "No refill needed",
        schedule: updated || null,
      })
    } catch (err) {
      const reason = String(err && err.message ? err.message : err)
      if (isTransientRunReason(reason)) {
        const backoffMs = parseRetryBackoffMs(reason)
        const updatedTransient = patchSchedule(scheduleId, {
          lastRunAt: Date.now(),
          lastRunStatus: "ok",
          lastRunMessage: reason,
          errorStreak: 0,
          lastTickAt: backoffMs ? Date.now() + Math.max(0, backoffMs - 10000) : Date.now(),
        }, { userId })
        return res.status(409).json({ ok: false, code: "TRANSIENT", error: reason, schedule: updatedTransient || null })
      }
      const nextErrorStreak = Number(schedule.errorStreak || 0) + 1
      const shouldPause = nextErrorStreak >= 5
      const updated = patchSchedule(scheduleId, {
        lastRunAt: Date.now(),
        lastRunStatus: "error",
        lastRunMessage: shouldPause
          ? `${reason} (Auto refill paused after repeated failures)`
          : reason,
        errorStreak: nextErrorStreak,
        isPaused: shouldPause ? true : Boolean(schedule.isPaused),
      }, { userId })

      await notifyUser({
        userId,
        type: shouldPause ? "schedule.paused" : "schedule.retry_failed",
        category: "schedule",
        severity: shouldPause ? "warning" : "error",
        title: shouldPause ? "Auto refill paused" : "Retry failed",
        body: shouldPause
          ? `${String(schedule.templateTitle || "Schedule")} paused after repeated failures.`
          : `${String(schedule.templateTitle || "Schedule")}: ${reason}`,
        dedupeKey: shouldPause ? `paused:${scheduleId}:${nextErrorStreak}` : "",
      })

      return res.status(500).json({ ok: false, error: reason, schedule: updated || null })
    } finally {
      retryInFlight.delete(scheduleId)
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

/* -------------------------
   Webflow data endpoints
-------------------------- */

app.get("/api/webflow/sites", requireAuth, webflowRateLimit, async (req, res) => {
  try {
    const data = await webflowFetch("/v2/sites", {}, req.authUser?.id)
    res.json(data)
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) })
  }
})

app.get("/api/webflow/sites/:siteId/collections", requireAuth, webflowRateLimit, async (req, res) => {
  try {
    const { siteId } = req.params
    const data = await webflowFetch(`/v2/sites/${siteId}/collections`, {}, req.authUser?.id)
    res.json(data)
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) })
  }
})

app.get("/api/webflow/collections/:collectionId", requireAuth, webflowRateLimit, async (req, res) => {
  try {
    const { collectionId } = req.params
    const data = await webflowFetch(`/v2/collections/${collectionId}`, {}, req.authUser?.id)
    res.json(data)
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) })
  }
})

app.get("/api/webflow/collections/:collectionId/items", requireAuth, webflowRateLimit, async (req, res) => {
  try {
    const { collectionId } = req.params
    const data = await webflowFetch(`/v2/collections/${collectionId}/items`, {}, req.authUser?.id)
    res.json(data)
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) })
  }
})

/* -------------------------
   Your "Finish button" endpoint
-------------------------- */

app.post("/api/loop-events/run", requireAuth, runRateLimit, async (req, res) => {
  try {
    const authUser = req.authUser || {}
    const userId = String(authUser.id || "").trim()
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" })
    }

    const planInfo = await getUserPlanInfo(userId)
    const limits = planInfo.limits

    const tokens = readTokens()
    const token = tokens.default?.access_token

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Not authorized. Visit /oauth/start first.",
        authorize_url: "/oauth/start",
      })
    }

    const payload = req.body || {}

    const collectionId = String(payload.collectionId || "")
    const siteId = String(payload.siteId || "")
    const siteTimezoneRaw = String(payload.siteTimezone || "")
    const templateItemId = String(payload.templateItemId || "")
    const startFieldId = String(payload.startFieldId || "")
    const startFieldSlugRaw = String(payload.startFieldSlug || "")
    const endFieldId = String(payload.endFieldId || "")
    const endFieldSlugRaw = String(payload.endFieldSlug || "")
    const startHasTime = Boolean(payload.startHasTime)
    const endHasTime = Boolean(payload.endHasTime)
    const starts = Array.isArray(payload.starts) ? payload.starts : []
    const ends = Array.isArray(payload.ends) ? payload.ends : []
    const status = String(payload.status || "draft")

    if (starts.length > Number(limits.maxRunCount || 10)) {
      return res.status(403).json({
        ok: false,
        error: `Your current plan allows up to ${limits.maxRunCount} items per run.`,
        code: "PLAN_RUN_LIMIT",
        limits: {
          maxRunCount: limits.maxRunCount,
          maxSchedules: Number.isFinite(limits.maxSchedules) ? limits.maxSchedules : null,
        },
      })
    }

    if (!collectionId || !templateItemId || !startFieldId) {
      return res.status(400).json({ ok: false, error: "Missing required run fields" })
    }

    const resolved = await resolveFieldSlugs(
      collectionId,
      startFieldId,
      endFieldId,
      startFieldSlugRaw,
      endFieldSlugRaw
    )

    if (!resolved.startFieldSlug) {
      return res.status(400).json({ ok: false, error: "Could not resolve start field slug" })
    }

    const siteTimezone = await resolveSiteTimezone(siteId, siteTimezoneRaw || "UTC")

    const created = await createFromStarts({
      siteId,
      collectionId,
      templateItemId,
      startFieldSlug: resolved.startFieldSlug,
      endFieldSlug: resolved.endFieldSlug,
      siteTimezone,
      startHasTime,
      endHasTime,
      starts,
      ends,
      status,
    })

    if (created.publishError) {
      return res.status(400).json({
        ok: false,
        error: String(created.publishError),
        createdCount: 0,
        createdItemIds: [],
        createdStartKeys: [],
        errors: created.errors,
      })
    }

    if (created.createdCount === 0 && Array.isArray(created.errors) && created.errors.length) {
      return res.status(400).json({
        ok: false,
        error: created.errors[0],
        createdCount: 0,
        createdItemIds: [],
        createdStartKeys: [],
        errors: created.errors,
      })
    }

    res.json({
      ok: true,
      createdCount: created.createdCount,
      createdItemIds: created.createdItemIds,
      createdStartKeys: created.createdStartKeys,
      lastIssuedStartKey: created.lastIssuedStartKey,
      warning: created.warning || "",
      errors: created.errors,
      startFieldSlug: resolved.startFieldSlug,
      endFieldSlug: resolved.endFieldSlug,
      siteTimezone,
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) })
  }
})

ensureRuntimeStorageReady()

if (SCHEDULER_ENABLED) {
  startScheduler(schedulerDeps)
} else {
  console.log("[AutoRefill] scheduler disabled (SCHEDULER_ENABLED=false)")
}

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
  console.log(`OAuth start: http://localhost:${PORT}/oauth/start`)
})
