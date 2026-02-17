import { useEffect, useMemo, useState } from "react"

import { isoTodayDate, splitISO, combineISO, formatISO } from "./dateUtils"
import { WEEKDAYS, buildPreviewStarts, buildPreviewEnds } from "./previewLogic"

type FieldType = "date" | "datetime" | "text"

export type RepeatType = "daily" | "weekly" | "monthly" | "custom"
export type CustomRule = "weekdays" | "weekends" | "nthWeekday"
export type OutputStatus = "draft" | "staged" | "publish"
export type Step = 1 | 2 | 3 | 4 | 5
export type AutoCheckUnit = "seconds" | "minutes" | "hours" | "days"
export type CleanupMode = "off" | "archive" | "delete" | "unpublish"

type WebflowSite = { id: string; displayName?: string; name?: string; timezone?: string }
type WebflowCollection = { id: string; displayName?: string; name?: string }
type WebflowField = {
  id: string
  slug: string
  displayName?: string
  name?: string
  type: string
  validations?: any
  settings?: any
  constraints?: any
  [key: string]: any
}
type WebflowCollectionSchema = {
  id: string
  displayName?: string
  name?: string
  fields?: WebflowField[]
}
type WebflowItemsResponse = {
  items?: Array<{
    id: string
    fieldData?: Record<string, any>
  }>
}

type DrawerView = "menu" | "autoRefill"

export type Collection = {
  id: string
  name: string
  fields: { id: string; name: string; type: FieldType; slug: string; raw?: any }[]
}

export type CmsItem = {
  id: string
  title: string
  startISO: string
  endISO?: string
  thumbnailUrl?: string
  rawFieldData: Record<string, any>
}

export type AutoRefillSchedule = {
  id: string
  createdAt: number
  isPaused: boolean
  isStopped: boolean
  createdCount: number
  lastTickAt?: number

  collectionId: string
  collectionName: string
  siteId: string
  siteTimezone: string
  startFieldId: string
  startFieldSlug: string
  startFieldName: string
  endFieldId: string
  endFieldSlug: string
  endFieldName: string
  templateItemId: string
  templateTitle: string
  templateThumbnailUrl?: string

  seedStartISO: string
  seedEndISO: string
  startHasTime: boolean
  endHasTime: boolean

  repeatType: RepeatType
  interval: number
  count: number
  weekdaySet: Record<string, boolean>
  customRule: CustomRule
  nth: number
  nthWeekday: number

  autoEvery: number
  autoUnit: AutoCheckUnit
  cleanupMode: CleanupMode

  status: OutputStatus

  createdItemIds?: string[]
  issuedStartKeys?: string[]
  lastIssuedStartKey?: string
  lastRunAt?: number
  lastRunStatus?: string
  lastRunMessage?: string
  errorStreak?: number
  history?: Array<{
    itemId: string
    startISO: string
    source: string
    state: string
    createdAt: number
    outputMode: string
  }>
}

declare global {
  interface Window {
    __LOOP_EVENTS_BACKEND__?: string
    __LOOP_EVENTS_AUTH_TOKEN__?: string
  }
}

function authHeaders(tokenInput?: string) {
  const token = String(tokenInput || window.__LOOP_EVENTS_AUTH_TOKEN__ || "").trim()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

function apiUrl(path: string) {
  const raw = String(window.__LOOP_EVENTS_BACKEND__ || "").trim()
  let base = raw || "http://localhost:3001"
  if (/^localhost:\d+$/i.test(base) || /^127\.0\.0\.1:\d+$/i.test(base)) {
    base = `http://${base}`
  }
  if (!/^https?:\/\//i.test(base)) {
    base = "http://localhost:3001"
  }
  base = base.replace(":1337", ":3001")
  const clean = base.replace(/\/+$/, "")
  const p = path.startsWith("/") ? path : `/${path}`
  return `${clean}${p}`
}

function safeLower(v: any) {
  return String(v || "").toLowerCase()
}

function pickTitle(fieldData: Record<string, any>) {
  return (
    fieldData?.name ||
    fieldData?.title ||
    fieldData?.["event-name"] ||
    fieldData?.["heading"] ||
    "Untitled"
  )
}

function normalizeKey(v: any) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

function extractImageUrl(raw: any): string {
  if (!raw) return ""
  if (typeof raw === "string") {
    const s = raw.trim()
    if (/^https?:\/\//i.test(s)) return s
    return ""
  }

  if (Array.isArray(raw)) {
    for (const x of raw) {
      const u = extractImageUrl(x)
      if (u) return u
    }
    return ""
  }

  if (typeof raw === "object") {
    const candidates = [raw.url, raw.file?.url, raw.asset?.url, raw.original?.url]
    for (const c of candidates) {
      const u = extractImageUrl(c)
      if (u) return u
    }
  }

  return ""
}

function scoreImageField(keyRaw: string): number {
  const key = normalizeKey(keyRaw)
  if (!key) return 0
  if (key.includes("thumbnail") || key.includes("thumb")) return 120
  if (key.includes("preview")) return 110
  if (key.includes("cover") || key.includes("poster") || key.includes("hero")) return 100
  if (key.includes("featured") && key.includes("image")) return 95
  if (key.includes("event") && key.includes("image")) return 90
  if (key.includes("image") || key.includes("photo") || key.includes("picture")) return 80
  return 10
}

function isImageFieldType(typeRaw: any) {
  const t = normalizeKey(typeRaw)
  if (!t) return false
  return t.includes("image") || t.includes("multiimage")
}

function pickThumbnailUrlFromSchema(fieldData: Record<string, any>, fieldsRaw: WebflowField[]) {
  const fd = fieldData && typeof fieldData === "object" ? fieldData : {}
  const fields = Array.isArray(fieldsRaw) ? fieldsRaw : []

  const imageFields = fields
    .filter((f) => isImageFieldType((f as any)?.type))
    .map((f) => ({
      slug: String((f as any)?.slug || "").trim(),
      name: String((f as any)?.displayName || (f as any)?.name || (f as any)?.slug || "").trim(),
    }))
    .filter((f) => Boolean(f.slug))

  if (!imageFields.length) return ""

  let bestUrl = ""
  let bestScore = -1
  let firstUrl = ""

  for (const f of imageFields) {
    const key = f.slug
    const value = fd[key]
    const url = extractImageUrl(value)
    if (!url) continue
    if (!firstUrl) firstUrl = url

    const score = Math.max(scoreImageField(key), scoreImageField(f.name))
    if (score > bestScore) {
      bestScore = score
      bestUrl = url
    }
  }

  return bestUrl || firstUrl || ""
}

/*
Extract HH:mm from a date-like value.
Supports:
- YYYY-MM-DD
- YYYY-MM-DDTHH:mm...
- YYYY-MM-DD HH:mm...
Returns null if no time exists.
*/
function extractTimeHM(value: string): string | null {
  const s = String(value || "").trim()
  if (!s) return null

  // date only
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null

  // ISO T
  const m1 = s.match(/^\d{4}-\d{2}-\d{2}t(\d{2}):(\d{2})/i)
  if (m1 && m1[1] && m1[2]) return `${m1[1]}:${m1[2]}`

  // space separator
  const m2 = s.match(/^\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})/i)
  if (m2 && m2[1] && m2[2]) {
    const hh = String(m2[1]).padStart(2, "0")
    return `${hh}:${m2[2]}`
  }

  // fallback: any HH:mm in the string
  const m3 = s.match(/\b(\d{1,2}):(\d{2})\b/)
  if (m3 && m3[1] && m3[2]) {
    const hh = String(m3[1]).padStart(2, "0")
    return `${hh}:${m3[2]}`
  }

  return null
}

/*
Smarter sniff:
- If times vary across items (more than 1 unique HH:mm), it is datetime.
- If time is always the same (common for date-only returned with timezone offset), treat as date,
  unless schema clearly says time picker enabled.
- If we only see YYYY-MM-DD, treat as date.
Returns:
- true: definitely datetime (varied times)
- false: learned that it behaves like date-only
- null: could not learn anything
*/
function sniffHasTimeFromItems(items: CmsItem[], slug: string): boolean | null {
  if (!slug) return null
  const list = Array.isArray(items) ? items : []

  let sawAny = false
  let sawDateOnly = false
  const times = new Set<string>()

  // cap work to keep UI snappy
  let checked = 0
  const maxCheck = Math.min(200, list.length)

  for (let i = 0; i < list.length && checked < maxCheck; i++) {
    const raw = list[i]?.rawFieldData?.[slug]
    if (typeof raw !== "string") continue
    const v = raw.trim()
    if (!v) continue

    sawAny = true
    checked += 1

    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      sawDateOnly = true
      continue
    }

    const hm = extractTimeHM(v)
    if (hm) times.add(hm)

    if (times.size > 1) {
      return true
    }
  }

  if (!sawAny) return null

  // If we saw only YYYY-MM-DD values, it is date.
  if (sawDateOnly && times.size === 0) return false

  // If we saw timestamps but time is constant (or not extractable), treat as date unless schema upgrades it.
  if (times.size <= 1) return false

  return true
}

function pickBool(...vals: any[]): boolean | null {
  for (const v of vals) if (v === true) return true
  for (const v of vals) if (v === false) return false
  return null
}

/*
Fallback from schema when items cannot tell us anything.
Return null when unknown.
*/
function fieldHasTimeEnabledFromSchema(f: WebflowField): boolean | null {
  const v = f?.validations || {}
  const s = f?.settings || {}
  const c = f?.constraints || {}

  const validationsRaw = f?.validations
  if (validationsRaw === null) return false

  // Webflow varies the key names across versions
  const guess = pickBool(
    v?.includeTimePicker,
    v?.timePicker,
    v?.useTimePicker,
    v?.timePickerEnabled,
    v?.enableTimePicker,
    v?.hasTimePicker,
    v?.includeTime,
    v?.timeEnabled,

    s?.includeTimePicker,
    s?.timePicker,
    s?.useTimePicker,
    s?.timePickerEnabled,
    s?.enableTimePicker,
    s?.hasTimePicker,
    s?.includeTime,
    s?.timeEnabled,

    c?.includeTimePicker,
    c?.timePicker,
    c?.useTimePicker,
    c?.timePickerEnabled,
    c?.enableTimePicker,
    c?.hasTimePicker,
    c?.includeTime,
    c?.timeEnabled,

    f?.includeTimePicker,
    f?.timePicker,
    f?.useTimePicker,
    f?.timePickerEnabled,
    f?.enableTimePicker,
    f?.hasTimePicker,
    f?.includeTime,
    f?.timeEnabled
  )

  if (guess !== null) return guess

  const fmtFromValidations = safeLower((f?.validations as any)?.format)
  if (fmtFromValidations) {
    const hasTime = fmtFromValidations.includes("time")
    const hasDateOnly = fmtFromValidations === "date" || fmtFromValidations === "yyyy-mm-dd"
    if (hasTime) return true
    if (hasDateOnly) return false
  }

  const fmt = safeLower(s?.format || c?.format || f?.format)
  if (fmt) {
    const hasTime = fmt.includes("time")
    const hasDateOnly = fmt === "date" || fmt === "yyyy-mm-dd"
    if (hasTime) return true
    if (hasDateOnly) return false
  }

  return null
}

function normalizeFieldType(f: WebflowField, itemsForSniff: CmsItem[]): FieldType {
  const rawType = safeLower(f?.type).replace(/\s+/g, "")
  const slug = String(f?.slug || "")

  // If it is not any kind of date field, bail.
  const isSomeDate = rawType.includes("date")
  if (!isSomeDate) return "text"

  // First try schema, because item values can include timezone offsets even for date-only fields.
  const schema = fieldHasTimeEnabledFromSchema(f)
  if (schema === true) return "datetime"
  if (schema === false) return "date"

  // Schema unknown, sniff items by checking if time varies.
  const sniff = sniffHasTimeFromItems(itemsForSniff, slug)
  if (sniff === true) return "datetime"
  return "date"
}

async function safeJson(res: Response) {
  const text = await res.text().catch(() => "")
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

export function useLoopEvents(authToken?: string) {
  const [step, setStep] = useState<Step>(1)
  const [serverOk, setServerOk] = useState(false)

  const [sites, setSites] = useState<WebflowSite[]>([])
  const [siteId, setSiteId] = useState("")

  const [collections, setCollections] = useState<WebflowCollection[]>([])
  const [collectionId, setCollectionId] = useState("")

  const [collectionSchema, setCollectionSchema] = useState<WebflowCollectionSchema | null>(null)
  const [items, setItems] = useState<CmsItem[]>([])

  const [loadingSites, setLoadingSites] = useState(false)
  const [loadingCollections, setLoadingCollections] = useState(false)
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [loadingItems, setLoadingItems] = useState(false)

  const [startFieldId, setStartFieldId] = useState("")
  const [endFieldId, setEndFieldId] = useState("")

  const [search, setSearch] = useState("")
  const [selectedItemId, setSelectedItemId] = useState("")

  const [repeatType, setRepeatType] = useState<RepeatType>("weekly")
  const [interval, setInterval] = useState(1)
  const [count, setCount] = useState(10)

  const [weekdaySet, setWeekdaySet] = useState<Record<string, boolean>>({
    mon: true,
    tue: false,
    wed: false,
    thu: false,
    fri: false,
    sat: false,
    sun: false,
  })

  const [customRule, setCustomRule] = useState<CustomRule>("weekdays")
  const [nth, setNth] = useState(2)
  const [nthWeekday, setNthWeekday] = useState(2)

  const [startDate, setStartDate] = useState(isoTodayDate())
  const [startTime, setStartTime] = useState("09:00")

  const [endDate, setEndDate] = useState(isoTodayDate())
  const [endTime, setEndTime] = useState("10:00")

  const [status, setStatus] = useState<OutputStatus>("draft")

  const [autoRefillEnabled, setAutoRefillEnabled] = useState(false)
  const [autoEvery, setAutoEvery] = useState(10)
  const [autoUnit, setAutoUnit] = useState<AutoCheckUnit>("seconds")
  const [cleanupMode, setCleanupMode] = useState<CleanupMode>("off")

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerView, setDrawerView] = useState<DrawerView>("menu")
  const [schedules, setSchedules] = useState<AutoRefillSchedule[]>([])
  const [schedulesLoaded, setSchedulesLoaded] = useState(false)
  const [schedulesLoading, setSchedulesLoading] = useState(false)

  const [isFinishing, setIsFinishing] = useState(false)
  const [runStatus, setRunStatus] = useState<{ type: "idle" | "ok" | "err" | "busy"; msg: string }>({
    type: "idle",
    msg: "",
  })

  async function fetchSchedules() {
    setSchedulesLoading(true)
    try {
      const res = await fetch(apiUrl("/api/schedules"), {
        headers: { ...authHeaders(authToken) },
      })
      const data = await safeJson(res)
      const list = Array.isArray((data as any)?.schedules) ? (data as any).schedules : []
      setSchedules(list)
    } catch {
      setSchedules([])
    } finally {
      setSchedulesLoaded(true)
      setSchedulesLoading(false)
    }
  }

  const steps = useMemo(() => [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }] as { n: Step }[], [])

  // Health
  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const res = await fetch(apiUrl("/health"))
        const data = await safeJson(res)
        if (!cancelled) setServerOk(Boolean((data as any)?.ok))
      } catch {
        if (!cancelled) setServerOk(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!serverOk || !String(authToken || "").trim()) {
      setSchedules([])
      setSchedulesLoaded(false)
      return
    }
    void fetchSchedules()
  }, [serverOk, authToken])

  useEffect(() => {
    if (!serverOk || !drawerOpen || drawerView !== "autoRefill") return
    const id = window.setInterval(() => {
      void fetchSchedules()
    }, 10000)
    return () => window.clearInterval(id)
  }, [serverOk, drawerOpen, drawerView])

  // Sites
  useEffect(() => {
    let cancelled = false
    if (!serverOk || !String(authToken || "").trim()) return

    async function run() {
      setLoadingSites(true)
      try {
        const res = await fetch(apiUrl("/api/webflow/sites"), { headers: authHeaders(authToken) })
        const data = await safeJson(res)

        const list = Array.isArray((data as any)?.sites)
          ? (data as any).sites
          : Array.isArray(data)
          ? data
          : []

        const mapped = list.map((s: any) => ({
          id: String(s.id),
          displayName: s.displayName || s.name || "Untitled site",
          timezone: String(s.timezone || s.timeZone || "").trim(),
        }))

        if (!cancelled) {
          setSites(mapped)
          if (!siteId && mapped[0]?.id) setSiteId(mapped[0].id)
        }
      } catch {
        if (!cancelled) setSites([])
      } finally {
        if (!cancelled) setLoadingSites(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [serverOk, siteId, authToken])

  // Collections
  useEffect(() => {
    let cancelled = false
    if (!serverOk || !siteId || !String(authToken || "").trim()) return

    async function run() {
      setLoadingCollections(true)
      try {
        const res = await fetch(apiUrl(`/api/webflow/sites/${siteId}/collections`), {
          headers: authHeaders(authToken),
        })
        const data = await safeJson(res)

        const list = Array.isArray((data as any)?.collections)
          ? (data as any).collections
          : Array.isArray(data)
          ? data
          : []

        const mapped = list.map((c: any) => ({
          id: String(c.id),
          displayName: c.displayName || c.name || "Untitled collection",
        })).reverse()

        if (!cancelled) {
          setCollections(mapped)
          if (!collectionId && mapped[0]?.id) setCollectionId(mapped[0].id)
        }
      } catch {
        if (!cancelled) setCollections([])
      } finally {
        if (!cancelled) setLoadingCollections(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [serverOk, siteId, collectionId, authToken])

  // Items
  useEffect(() => {
    let cancelled = false
    if (!serverOk || !collectionId || !String(authToken || "").trim()) return

    async function run() {
      setLoadingItems(true)
      try {
        const res = await fetch(apiUrl(`/api/webflow/collections/${collectionId}/items`), {
          headers: authHeaders(authToken),
        })
        const data = (await safeJson(res)) as WebflowItemsResponse | null

        const list = Array.isArray(data?.items) ? data!.items! : []
        const mapped: CmsItem[] = list.map((it: any) => {
          const fieldData = it.fieldData || {}
          return {
            id: String(it.id),
            title: pickTitle(fieldData),
            startISO: "",
            endISO: "",
            thumbnailUrl: "",
            rawFieldData: fieldData,
          }
        })

        if (!cancelled) setItems(mapped)
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoadingItems(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [serverOk, collectionId, authToken])

  // Schema
  useEffect(() => {
    let cancelled = false
    if (!serverOk || !collectionId || !String(authToken || "").trim()) return

    async function run() {
      setLoadingSchema(true)
      try {
        const res = await fetch(apiUrl(`/api/webflow/collections/${collectionId}`), {
          headers: authHeaders(authToken),
        })
        const data = (await safeJson(res)) as WebflowCollectionSchema | null

        if (!cancelled) {
          setCollectionSchema(data)

          const fieldsRaw = Array.isArray(data?.fields) ? data!.fields! : []
          const dateFieldsLocal = fieldsRaw
            .map((f) => ({
              id: String(f.id),
              slug: String(f.slug),
              name: String(f.displayName || f.name || f.slug),
              type: normalizeFieldType(f as WebflowField, items),
            }))
            .filter((f) => f.type === "date" || f.type === "datetime")

          if (dateFieldsLocal.length) {
            if (!startFieldId) setStartFieldId(dateFieldsLocal[0].id)
            if (startFieldId && !dateFieldsLocal.some((f) => f.id === startFieldId)) setStartFieldId(dateFieldsLocal[0].id)
            if (endFieldId && !dateFieldsLocal.some((f) => f.id === endFieldId)) setEndFieldId("")
          } else {
            setStartFieldId("")
            setEndFieldId("")
          }
        }
      } catch {
        if (!cancelled) setCollectionSchema(null)
      } finally {
        if (!cancelled) setLoadingSchema(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [serverOk, collectionId, startFieldId, endFieldId, items, authToken])

  const selectedCollection = useMemo<Collection>(() => {
    const name =
      collections.find((c) => c.id === collectionId)?.displayName ||
      collectionSchema?.displayName ||
      "Collection"

    const fieldsRaw = Array.isArray(collectionSchema?.fields) ? collectionSchema!.fields! : []
    const fields = fieldsRaw.map((f) => ({
      id: String(f.id),
      slug: String(f.slug),
      name: String(f.displayName || f.name || f.slug),
      type: normalizeFieldType(f as WebflowField, items),
      raw: f,
    }))

    return { id: collectionId || "", name, fields }
  }, [collectionId, collections, collectionSchema, items])

  const dateFields = useMemo(() => {
    return selectedCollection.fields.filter((f) => f.type === "date" || f.type === "datetime")
  }, [selectedCollection.fields])

  const startField = useMemo(() => {
    return selectedCollection.fields.find((f) => f.id === startFieldId) || null
  }, [selectedCollection.fields, startFieldId])

  const endField = useMemo(() => {
    return selectedCollection.fields.find((f) => f.id === endFieldId) || null
  }, [selectedCollection.fields, endFieldId])

  const selectedSiteTimezone = useMemo(() => {
    const site = (Array.isArray(sites) ? sites : []).find((s) => s.id === siteId)
    const tz = String(site?.timezone || "").trim()
    return tz || "UTC"
  }, [sites, siteId])

  const startWantsTime = startField?.type === "datetime"
  const endWantsTime = endField?.type === "datetime"

  const itemsWithDates = useMemo(() => {
    const sSlug = startField?.slug || ""
    const eSlug = endField?.slug || ""
    const schemaFields = Array.isArray(collectionSchema?.fields) ? collectionSchema!.fields! : []

    return (Array.isArray(items) ? items : []).map((i) => {
      const startVal = sSlug ? i.rawFieldData?.[sSlug] : ""
      const endVal = eSlug ? i.rawFieldData?.[eSlug] : ""

      return {
        ...i,
        startISO: typeof startVal === "string" ? startVal : "",
        endISO: typeof endVal === "string" ? endVal : "",
        thumbnailUrl: pickThumbnailUrlFromSchema(i.rawFieldData || {}, schemaFields),
      }
    })
  }, [items, startField?.slug, endField?.slug, collectionSchema])

  const selectedItem = useMemo(() => {
    return itemsWithDates.find((i) => i.id === selectedItemId) || null
  }, [itemsWithDates, selectedItemId])

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return itemsWithDates
    return itemsWithDates.filter((i) => i.title.toLowerCase().includes(q))
  }, [itemsWithDates, search])

  function seedFromItem(item: CmsItem) {
    const s = splitISO(item.startISO || "")
    setStartDate(s.date)
    setStartTime(s.time)

    if (endFieldId && item.endISO) {
      const e = splitISO(item.endISO)
      setEndDate(e.date)
      setEndTime(e.time)
    }
  }

  const startISO = useMemo(() => {
    return combineISO(startDate, startTime, Boolean(startWantsTime))
  }, [startDate, startTime, startWantsTime])

  const endISO = useMemo(() => {
    return combineISO(endDate, endTime, Boolean(endWantsTime))
  }, [endDate, endTime, endWantsTime])

  const previewStarts = useMemo(() => {
    const base = startISO || isoTodayDate()
    return buildPreviewStarts({
      startISO: base,
      count,
      repeatType,
      interval,
      weekdaySet,
      customRule,
      nth,
      nthWeekday,
      startWantsTime: Boolean(startWantsTime),
    })
  }, [startISO, count, repeatType, interval, weekdaySet, customRule, nth, nthWeekday, startWantsTime])

  const previewEnds = useMemo(() => {
    const base = endISO || startISO || isoTodayDate()
    return buildPreviewEnds({
      endFieldId,
      endISO: base,
      startISO: startISO || isoTodayDate(),
      previewStarts,
      endWantsTime: Boolean(endWantsTime),
    })
  }, [endFieldId, endISO, startISO, previewStarts, endWantsTime])

  const canNextFrom1 = Boolean(collectionId) && Boolean(startFieldId) && dateFields.length > 0
  const canNextFrom2 = Boolean(selectedItemId)
  const canNextFrom3 =
    previewStarts.length > 0 &&
    count >= 1 &&
    count <= 200 &&
    interval >= 1 &&
    interval <= 365 &&
    (repeatType !== "weekly" || WEEKDAYS.some((d) => weekdaySet[d.key]))

  const maxReachableStep = useMemo<Step>(() => {
    let max: Step = 1
    if (canNextFrom1) max = 2
    if (max >= 2 && canNextFrom2) max = 3
    if (max >= 3 && canNextFrom3) max = 4
    if (max >= 4) max = 5
    return max
  }, [canNextFrom1, canNextFrom2, canNextFrom3])

  function goTo(n: Step) {
    if (n <= maxReachableStep) setStep(n)
  }

  function goNext() {
    setStep((s) => {
      const next = (s < 5 ? (s + 1) : s) as Step
      return next <= maxReachableStep ? next : s
    })
  }

  function goBack() {
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s))
  }

  const primaryDisabled =
    (step === 1 && !canNextFrom1) ||
    (step === 2 && !canNextFrom2) ||
    (step === 3 && !canNextFrom3)

  const stepperPct = ((step - 1) / 4) * 100
  const showLoadingBanner = loadingSites || loadingCollections || loadingSchema || loadingItems

  function resetAll() {
    setStep(1)

    setCollectionId("")
    setCollectionSchema(null)
    setItems([])
    setCollections([])

    setStartFieldId("")
    setEndFieldId("")

    setSearch("")
    setSelectedItemId("")

    setRepeatType("weekly")
    setInterval(1)
    setCount(10)
    setWeekdaySet({ mon: true, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false })
    setCustomRule("weekdays")
    setNth(2)
    setNthWeekday(2)

    setStartDate(isoTodayDate())
    setStartTime("09:00")
    setEndDate(isoTodayDate())
    setEndTime("10:00")

    setStatus("draft")
    setAutoRefillEnabled(false)
    setAutoEvery(10)
    setAutoUnit("seconds")
    setCleanupMode("off")

    setDrawerOpen(false)
    setDrawerView("menu")

    setIsFinishing(false)
    setRunStatus({ type: "idle", msg: "" })
  }

  function buildScheduleFromCurrent(createdCount: number, createdItemIds: string[], createdStartKeys: string[]): AutoRefillSchedule | null {
    if (!autoRefillEnabled) return null
    if (!selectedItem || !startField) return null

    const endFieldName = endField ? endField.name : ""
    const endFieldIdSafe = endFieldId || ""

    const now = Date.now()
    const outputMode = status === "publish" ? "publish" : status === "staged" ? "staged" : "draft"
    const state = status === "publish" ? "published" : status === "staged" ? "staged" : "draft"
    const history = (Array.isArray(createdItemIds) ? createdItemIds : []).map((itemId: string, idx: number) => ({
      itemId: String(itemId || ""),
      startISO: String((Array.isArray(createdStartKeys) ? createdStartKeys[idx] : "") || ""),
      source: "initial",
      state,
      createdAt: now,
      outputMode,
    }))

    return {
      id: `sched_${Math.random().toString(16).slice(2)}_${Date.now()}`,
      createdAt: Date.now(),
      isPaused: false,
      isStopped: false,
      createdCount: Math.max(0, createdCount),
      lastTickAt: undefined,

      collectionId,
      collectionName: selectedCollection.name,
      siteId,
      siteTimezone: selectedSiteTimezone,
      startFieldId,
      startFieldSlug: startField.slug,
      startFieldName: startField.name,
      endFieldId: endFieldIdSafe,
      endFieldSlug: endField ? endField.slug : "",
      endFieldName,
      templateItemId: selectedItemId,
      templateTitle: selectedItem.title,
      templateThumbnailUrl: selectedItem.thumbnailUrl || "",

      seedStartISO: startISO,
      seedEndISO: endFieldId ? endISO : "",
      startHasTime: Boolean(startWantsTime),
      endHasTime: Boolean(endWantsTime),

      repeatType,
      interval,
      count,
      weekdaySet,
      customRule,
      nth,
      nthWeekday,

      autoEvery,
      autoUnit,
      cleanupMode,

      status,
      createdItemIds: Array.isArray(createdItemIds) ? createdItemIds : [],
      issuedStartKeys: Array.isArray(createdStartKeys) ? createdStartKeys : [],
      lastIssuedStartKey: Array.isArray(createdStartKeys) && createdStartKeys.length ? createdStartKeys[createdStartKeys.length - 1] : "",
      history,
    }
  }

  async function onFinish() {
    if (isFinishing) return

    setRunStatus({ type: "busy", msg: `Creating ${previewStarts.length} copies` })
    setIsFinishing(true)

    const payload: any = {
      siteId,
      siteTimezone: selectedSiteTimezone,
      collectionId,
      templateItemId: selectedItemId,
      startFieldId,
      startFieldSlug: startField?.slug || "",
      startHasTime: Boolean(startWantsTime),
      endFieldId: endFieldId || "",
      endFieldSlug: endField?.slug || "",
      endHasTime: Boolean(endWantsTime),
      cleanupMode,
      starts: previewStarts,
      ends: endFieldId ? previewEnds : [],
      status,
    }

    try {
      const res = await fetch(apiUrl("/api/loop-events/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(authToken) },
        body: JSON.stringify(payload),
      })

      const data = await safeJson(res)

      if (!res.ok) {
        const msg = String((data as any)?.error || (data as any)?.message || "Run failed")
        setRunStatus({ type: "err", msg })
        setIsFinishing(false)
        return
      }

      const okFlag = (data as any)?.ok
      const createdCountRaw = (data as any)?.createdCount
      const createdItemIdsRaw = (data as any)?.createdItemIds
      const createdStartKeysRaw = (data as any)?.createdStartKeys
      const runErrors = Array.isArray((data as any)?.errors) ? (data as any).errors : []
      const runWarning = String((data as any)?.warning || "").trim()
      const createdItemIds = Array.isArray(createdItemIdsRaw) ? createdItemIdsRaw.map((x: any) => String(x)) : []
      const createdStartKeys = Array.isArray(createdStartKeysRaw)
        ? createdStartKeysRaw.map((x: any) => String(x)).filter(Boolean)
        : []
      const created = Number.isFinite(createdCountRaw) ? Number(createdCountRaw) : previewStarts.length

      if (okFlag === false) {
        const msg = String((data as any)?.error || runErrors[0] || "Run failed")
        setRunStatus({ type: "err", msg })
        setIsFinishing(false)
        return
      }

      if (created <= 0) {
        const msg = String(runErrors[0] || (data as any)?.error || "No items were created")
        setRunStatus({ type: "err", msg })
        setIsFinishing(false)
        return
      }

      const sched = buildScheduleFromCurrent(created, createdItemIds, createdStartKeys)
      if (sched) {
        try {
          const saveRes = await fetch(apiUrl("/api/schedules"), {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders(authToken) },
            body: JSON.stringify(sched),
          })
          const saveData = await safeJson(saveRes)
          if (!saveRes.ok) {
            const saveErr = String((saveData as any)?.error || "Failed to save schedule")
            setRunStatus({ type: "err", msg: `Created ${created} items, but failed to save Auto refill schedule: ${saveErr}` })
            setIsFinishing(false)
            return
          }
          const saved = (saveData as any)?.schedule
          if (saved && typeof saved === "object") {
            setSchedules((prev) => [saved, ...(Array.isArray(prev) ? prev.filter((x: any) => x.id !== saved.id) : [])])
          } else {
            setRunStatus({ type: "err", msg: `Created ${created} items, but schedule was not saved.` })
            setIsFinishing(false)
            return
          }
        } catch (e: any) {
          setRunStatus({
            type: "err",
            msg: `Created ${created} items, but failed to save Auto refill schedule: ${String(e?.message || e || "unknown")}`,
          })
          setIsFinishing(false)
          return
        }
      }

      const msg = runWarning
        ? `Finished. Created ${created} items. ${runWarning}`
        : `Finished. Created ${created} items.`
      setRunStatus({ type: "ok", msg })
      setIsFinishing(false)
    } catch (e: any) {
      setRunStatus({ type: "err", msg: String(e?.message || e || "Run failed") })
      setIsFinishing(false)
    }
  }

  function toggleSchedulePause(id: string) {
    const found = schedules.find((x) => x.id === id)

    setSchedules((prev) =>
      (Array.isArray(prev) ? prev : []).map((s) => {
        if (s.id !== id) return s
        if (s.isStopped) return s
        return { ...s, isPaused: !s.isPaused }
      })
    )

    if (!found || found.isStopped) return
    void fetch(apiUrl(`/api/schedules/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(authToken) },
      body: JSON.stringify({ isPaused: !found.isPaused }),
    })
  }

  function deleteSchedule(id: string) {
    setSchedules((prev) => (Array.isArray(prev) ? prev : []).filter((s) => s.id !== id))
    void fetch(apiUrl(`/api/schedules/${id}`), { method: "DELETE", headers: { ...authHeaders(authToken) } })
  }

  function updateSchedule(id: string, patch: Partial<AutoRefillSchedule>) {
    const safeId = String(id || "")
    if (!safeId) return

    setSchedules((prev) =>
      (Array.isArray(prev) ? prev : []).map((s) => {
        if (s.id !== safeId) return s
        return { ...s, ...patch }
      })
    )

    void fetch(apiUrl(`/api/schedules/${safeId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(authToken) },
      body: JSON.stringify(patch || {}),
    })
  }

  async function retrySchedule(id: string): Promise<{ ok: boolean; error?: string; message?: string; code?: string }> {
    const safeId = String(id || "").trim()
    if (!safeId) return { ok: false, error: "Missing schedule id" }
    try {
      const res = await fetch(apiUrl(`/api/schedules/${encodeURIComponent(safeId)}/retry`), {
        method: "POST",
        headers: { ...authHeaders(authToken) },
      })
      const data = await safeJson(res)
      const updated = (data as any)?.schedule
      if (updated && typeof updated === "object") {
        setSchedules((prev) => {
          const list = Array.isArray(prev) ? prev : []
          return list.map((s) => (s.id === safeId ? { ...s, ...updated } : s))
        })
      }
      if (!res.ok) {
        return {
          ok: false,
          error: String((data as any)?.error || "Retry failed"),
          code: String((data as any)?.code || ""),
        }
      }
      return { ok: true, message: String((data as any)?.message || "Retry completed") }
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err || "Retry failed") }
    }
  }

  return {
    step,
    steps,
    serverOk,

    sites: Array.isArray(sites) ? sites : [],
    siteId,
    setSiteId,

    collections: Array.isArray(collections) ? collections : [],
    collectionId,
    setCollectionId,

    selectedCollection,

    collectionSchema,

    items: Array.isArray(items) ? items : [],
    itemsWithDates: Array.isArray(itemsWithDates) ? itemsWithDates : [],
    filteredItems: Array.isArray(filteredItems) ? filteredItems : [],

    dateFields: Array.isArray(dateFields) ? dateFields : [],
    startFieldId,
    setStartFieldId,
    endFieldId,
    setEndFieldId,

    startField,
    endField,
    startWantsTime,
    endWantsTime,

    search,
    setSearch,

    selectedItemId,
    setSelectedItemId,
    selectedItem,
    seedFromItem,

    repeatType,
    setRepeatType,
    interval,
    setInterval,
    count,
    setCount,

    weekdaySet,
    setWeekdaySet,

    customRule,
    setCustomRule,
    nth,
    setNth,
    nthWeekday,
    setNthWeekday,

    startDate,
    setStartDate,
    startTime,
    setStartTime,
    endDate,
    setEndDate,
    endTime,
    setEndTime,

    startISO,
    endISO,

    previewStarts: Array.isArray(previewStarts) ? previewStarts : [],
    previewEnds: Array.isArray(previewEnds) ? previewEnds : [],

    status,
    setStatus,

    autoRefillEnabled,
    setAutoRefillEnabled,
    autoEvery,
    setAutoEvery,
    autoUnit,
    setAutoUnit,
    cleanupMode,
    setCleanupMode,

    drawerOpen,
    setDrawerOpen,
    drawerView,
    setDrawerView,

    schedules: Array.isArray(schedules) ? schedules : [],
    schedulesLoaded,
    schedulesLoading,
    refreshSchedules: fetchSchedules,
    toggleSchedulePause,
    deleteSchedule,
    updateSchedule,
    retrySchedule,

    isFinishing,
    runStatus,

    canNextFrom1,
    canNextFrom2,
    canNextFrom3,
    maxReachableStep,
    primaryDisabled,
    stepperPct,
    showLoadingBanner,

    goTo,
    goNext,
    goBack,
    resetAll,
    onFinish,

    formatISO,
    WEEKDAYS,
  }
}
