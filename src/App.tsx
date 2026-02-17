import React, { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { Session, User } from "@supabase/supabase-js"

import "./styles.css"
import "./styles.mobile.css"
import { getSupabaseClient, getSupabaseConfigError } from "./lib/supabase"

import { useLoopEvents } from "./logic/useLoopEvents"

import AuthCallbackScreen from "./ui/AuthCallbackScreen"
import AuthScreen from "./ui/AuthScreen"
import AutoRefillEditModal from "./ui/AutoRefillEditModal"
import LogoIcon from "./ui/LogoIcon"
import Sidebar from "./ui/Sidebar"
import Step1 from "./ui/Step1"
import Step2 from "./ui/Step2"
import Step3 from "./ui/Step3"
import Step4 from "./ui/Step4"
import Step5 from "./ui/Step5"

function lockBodyScroll(lock: boolean) {
  const body = document.body
  if (!body) return

  if (lock) {
    const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = "hidden"
    body.style.paddingRight = scrollBarWidth > 0 ? `${scrollBarWidth}px` : "0px"
  } else {
    body.style.overflow = ""
    body.style.paddingRight = ""
  }
}

function readAuthHash() {
  const raw = String(window.location.hash || "").replace(/^#/, "")
  const params = new URLSearchParams(raw)
  const accessToken = String(params.get("access_token") || "").trim()
  const refreshToken = String(params.get("refresh_token") || "").trim()
  const tokenType = String(params.get("token_type") || "").trim()
  const err = String(params.get("error_description") || params.get("error") || "").trim()
  return {
    hasAuthTokens: Boolean(accessToken && tokenType),
    accessToken,
    refreshToken,
    error: err,
  }
}

function backendApiUrl(path: string) {
  const raw = String((window as any).__LOOP_EVENTS_BACKEND__ || "").trim()
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

function parseMaxSchedules(value: any): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

type NotificationPrefs = {
  billing: boolean
  scheduleFailures: boolean
  productUpdates: boolean
  newsletter: boolean
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  billing: true,
  scheduleFailures: true,
  productUpdates: true,
  newsletter: true,
}

function parseNotificationPrefs(input: any): NotificationPrefs {
  const src = input && typeof input === "object" ? input : {}
  return {
    billing: typeof src.billing === "boolean" ? src.billing : DEFAULT_NOTIFICATION_PREFS.billing,
    scheduleFailures: typeof src.scheduleFailures === "boolean" ? src.scheduleFailures : DEFAULT_NOTIFICATION_PREFS.scheduleFailures,
    productUpdates: typeof src.productUpdates === "boolean" ? src.productUpdates : DEFAULT_NOTIFICATION_PREFS.productUpdates,
    newsletter: typeof src.newsletter === "boolean" ? src.newsletter : DEFAULT_NOTIFICATION_PREFS.newsletter,
  }
}

const FAQ_ITEMS: Array<{ section: string; q: string; a: string }> = [
  {
    section: "Getting Started",
    q: "Why is no item being created?",
    a: "Check that your start field and template are set, and that Step 4 output mode is selected correctly.",
  },
  {
    section: "Getting Started",
    q: "What does each step do?",
    a: "Step 1 maps your fields, Step 2 picks the source item, Step 3 controls recurrence/copies, Step 4 controls output and automation, Step 5 confirms everything.",
  },
  {
    section: "Getting Started",
    q: "Can I safely test before publishing?",
    a: "Yes. Use Draft or Staged output first, verify generated items in CMS, then switch to Publish later.",
  },
  {
    section: "Troubleshooting",
    q: "What happens when Auto refill fails repeatedly?",
    a: "After repeated failures, the schedule is auto-paused for safety. Use Retry to test a fix, then Resume.",
  },
  {
    section: "Troubleshooting",
    q: "When should I use Retry?",
    a: "Retry is intended for failed runs only. Fix the issue first (template/fields/permissions), then click retry beside Last run.",
  },
  {
    section: "Plans",
    q: "Can I edit schedules on the Free plan?",
    a: "Free plan allows one active schedule and no schedule editing. Paid unlocks unlimited schedules and editing.",
  },
  {
    section: "Troubleshooting",
    q: "Why does publish fail sometimes?",
    a: "Publish can fail when Webflow is rate-limited. The app rolls back created items for that run and reports the error.",
  },
  {
    section: "Account",
    q: "How do notifications work?",
    a: "The bell shows in-app alerts for schedule and billing events. You can configure preference toggles in Edit account > Notifications.",
  },
  {
    section: "Account",
    q: "Can I change my account information?",
    a: "Yes. Open Edit account to update full name, notification preferences, and password (email/password accounts).",
  },
]

const DOC_SECTIONS: Array<{ title: string; bullets: string[] }> = [
  {
    title: "Step 1 - Pick fields",
    bullets: [
      "Choose your CMS collection.",
      "Select the main start date field.",
      "Optionally map an end date field to preserve event duration.",
      "Use this step to ensure date mapping is correct before creating anything.",
    ],
  },
  {
    title: "Step 2 - Template",
    bullets: [
      "Pick the CMS item that should be cloned.",
      "The new events copy this item as the base content.",
      "Template title/thumbnail are shown in schedule cards for quick recognition.",
    ],
  },
  {
    title: "Step 3 - Repeat",
    bullets: [
      "Set Repeat type, Every, and Copies.",
      "Weekly/custom rules control which days are generated.",
      "Preview helps verify generated dates before run.",
    ],
  },
  {
    title: "Step 4 - Output and Auto refill",
    bullets: [
      "Output status: draft, staged, or publish.",
      "Old items: keep/archive/delete/unpublish.",
      "Auto refill runs every 10 seconds when enabled.",
    ],
  },
  {
    title: "Step 5 - Review and finish",
    bullets: [
      "Confirm all settings before finalizing.",
      "Finish creates the run and stores schedule settings.",
      "After finish, manage schedules from Menu > Auto refill.",
    ],
  },
  {
    title: "Plan and limits",
    bullets: [
      "Free: one active schedule, limited edit controls.",
      "Paid: unlimited schedules and full schedule editing.",
      "Use Compare plans in menu to see current limits.",
    ],
  },
  {
    title: "Notifications and account",
    bullets: [
      "Bell icon opens in-app notifications.",
      "Notification categories can be toggled in Edit account.",
      "Email/password users can update password in Security tab.",
      "Google-auth users manage password via Google sign-in.",
    ],
  },
]

const TUTORIAL_STEPS: Array<{ title: string; text: string }> = [
  {
    title: "Step 1 of 8",
    text: "Welcome to Loop Events. This guide shows the complete flow so you can confidently create repeat CMS events.",
  },
  {
    title: "Step 2 of 8",
    text: "Choose the CMS collection and your date field. If you have an end date field, set that too so copied events keep duration.",
  },
  {
    title: "Step 3 of 8",
    text: "Pick a template item that has the content you want to clone. Every generated event starts from this template.",
  },
  {
    title: "Step 4 of 8",
    text: "Set repeat rule, interval, and copy count. Use preview to verify dates before creating anything.",
  },
  {
    title: "Step 5 of 8",
    text: "Set output mode (draft, staged, publish), then configure Auto refill timing and old-item handling.",
  },
  {
    title: "Step 6 of 8",
    text: "Review Step 5 carefully before finish. This is the best place to catch wrong field mapping or recurrence settings.",
  },
  {
    title: "Step 7 of 8",
    text: "Open Menu > Auto refill to pause, resume, edit schedule settings, inspect details, and retry failed runs.",
  },
  {
    title: "Step 8 of 8",
    text: "Congratulations - you are all set. You now have a reliable workflow to generate and manage events with confidence.",
  },
]

type AppNotification = {
  id: string
  title: string
  body: string
  createdAt: number
  readAt?: number | null
}

function AuthenticatedApp(props: {
  user: User
  accessToken: string
  onSignOut: () => Promise<void>
  onUpdateProfile: (fullName: string) => Promise<{ ok: boolean; error?: string }>
  onUpdatePassword: (currentPassword: string, nextPassword: string) => Promise<{ ok: boolean; error?: string }>
  notificationPrefs: NotificationPrefs
  onUpdateNotificationPrefs: (nextPrefs: NotificationPrefs) => Promise<{ ok: boolean; error?: string }>
  planLabel: "Free" | "Paid"
  activeScheduleCount: number
  maxSchedules: number | null
  hasReachedScheduleLimit: boolean
  billingAvailable: boolean
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  planBusy: boolean
  planMessage: string
  onRefreshPlan: () => Promise<{ plan: "free" | "paid"; hasReachedScheduleLimit: boolean } | null>
  onStartCheckout: () => Promise<{ ok: boolean; error?: string }>
  onOpenBillingPortal: () => Promise<{ ok: boolean; error?: string }>
}) {
  const {
    user,
    accessToken,
    onSignOut,
    onUpdateProfile,
    onUpdatePassword,
    notificationPrefs,
    onUpdateNotificationPrefs,
    planLabel,
    activeScheduleCount,
    maxSchedules,
    hasReachedScheduleLimit,
    billingAvailable,
    planBusy,
    planMessage,
    onRefreshPlan,
    onStartCheckout,
    onOpenBillingPortal,
  } = props
  const le = useLoopEvents(accessToken)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDowngrade, setConfirmDowngrade] = useState(false)
  const [comparePlansOpen, setComparePlansOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [accountTab, setAccountTab] = useState<"profile" | "security" | "notifications">("profile")
  const [accountName, setAccountName] = useState("")
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountStatus, setAccountStatus] = useState("")
  const [accountStatusTone, setAccountStatusTone] = useState<"ok" | "err">("ok")
  const [passwordCurrent, setPasswordCurrent] = useState("")
  const [passwordNext, setPasswordNext] = useState("")
  const [passwordConfirm, setPasswordConfirm] = useState("")
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordStatus, setPasswordStatus] = useState("")
  const [passwordStatusTone, setPasswordStatusTone] = useState<"ok" | "err">("ok")
  const [prefsDraft, setPrefsDraft] = useState<NotificationPrefs>(notificationPrefs)
  const [prefsBusy, setPrefsBusy] = useState(false)
  const [prefsStatus, setPrefsStatus] = useState("")
  const [prefsStatusTone, setPrefsStatusTone] = useState<"ok" | "err">("ok")
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [faqOpen, setFaqOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [tutorialIndex, setTutorialIndex] = useState(0)
  const [retryingScheduleId, setRetryingScheduleId] = useState<string | null>(null)
  const [rollingBackRunId, setRollingBackRunId] = useState<string | null>(null)
  const [rollbackStatus, setRollbackStatus] = useState("")
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [notificationsError, setNotificationsError] = useState("")
  const mainScrollRef = useRef<HTMLElement | null>(null)
  const planPollIntervalRef = useRef<number | null>(null)
  const planPollStopRef = useRef<number | null>(null)
  const [planSyncing, setPlanSyncing] = useState(false)
  const [planSyncedAt, setPlanSyncedAt] = useState<number>(0)
  const userEmail = String(user?.email || "").trim()
  const authProvider = String((user as any)?.app_metadata?.provider || "email").toLowerCase()
  const canChangePassword = authProvider === "email"
  const profileName = String((user as any)?.user_metadata?.full_name || (user as any)?.user_metadata?.name || "").trim()
  const userName = String(profileName || userEmail.split("@")[0] || "Signed in").trim()
  const maxRunCount = planLabel === "Paid" ? 100 : 10
  const canEditSchedules = planLabel === "Paid"
  const autoRefillLocked = planLabel === "Free" && hasReachedScheduleLimit

  async function fetchNotifications() {
    try {
      const res = await fetch(backendApiUrl("/api/notifications"), {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        throw new Error(txt || "Could not fetch notifications")
      }
      const data = await res.json().catch(() => ({}))
      const list = Array.isArray((data as any)?.notifications) ? (data as any).notifications : []
      setNotifications(
        list.map((n: any) => ({
          id: String(n?.id || ""),
          title: String(n?.title || "Notification"),
          body: String(n?.body || ""),
          createdAt: Number(n?.createdAt || 0),
          readAt: n?.readAt ? Number(n.readAt) : null,
        }))
      )
      setNotificationsError("")
    } catch (err: any) {
      const endpoint = backendApiUrl("/api/notifications")
      setNotificationsError(`${String(err?.message || err || "Could not load notifications")} (via ${endpoint})`)
    }
  }

  function stopPlanSyncPolling() {
    if (planPollIntervalRef.current) {
      window.clearInterval(planPollIntervalRef.current)
      planPollIntervalRef.current = null
    }
    if (planPollStopRef.current) {
      window.clearTimeout(planPollStopRef.current)
      planPollStopRef.current = null
    }
    setPlanSyncing(false)
  }

  function startPlanSyncPolling() {
    stopPlanSyncPolling()
    setPlanSyncing(true)
    let ticks = 0
    const runTick = async () => {
      ticks += 1
      const out = await onRefreshPlan().catch(() => null)
      if (out) {
        setPlanSyncedAt(Date.now())
      }
      if (ticks >= 40) {
        stopPlanSyncPolling()
      }
    }
    void runTick()
    planPollIntervalRef.current = window.setInterval(runTick, 3000)
    planPollStopRef.current = window.setTimeout(() => {
      stopPlanSyncPolling()
    }, 120000)
  }

  useEffect(() => {
    setAccountName(profileName)
  }, [profileName])

  useEffect(() => {
    setPrefsDraft(notificationPrefs)
  }, [notificationPrefs])

  useEffect(() => {
    if (!accessToken) return
    void fetchNotifications()
    const id = window.setInterval(() => {
      void fetchNotifications()
    }, 20000)
    return () => {
      window.clearInterval(id)
      stopPlanSyncPolling()
    }
  }, [accessToken])

  useEffect(() => {
    const key = `loop-events-tutorial-dismissed-${String(user?.id || "anon")}`
    let dismissed = ""
    try {
      dismissed = String(window.localStorage.getItem(key) || "")
    } catch {
      dismissed = ""
    }
    if (!dismissed) {
      setTutorialOpen(true)
      setTutorialIndex(0)
    }
  }, [user?.id])

  useEffect(() => {
    if (Number(le.count || 0) > maxRunCount) {
      le.setCount(maxRunCount)
    }
  }, [maxRunCount])

  useEffect(() => {
    lockBodyScroll(le.drawerOpen)
    return () => lockBodyScroll(false)
  }, [le.drawerOpen])

  useEffect(() => {
    if (le.step !== 4) return
    void onRefreshPlan()
  }, [le.step, onRefreshPlan])

  async function markNotificationsSeen() {
    const res = await fetch(backendApiUrl("/api/notifications/read-all"), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => null)
    if (!res || !res.ok) return
    const now = Date.now()
    setNotifications((prev) => (Array.isArray(prev) ? prev.map((n) => ({ ...n, readAt: n.readAt || now })) : []))
  }

  async function dismissNotification(id: string) {
    const safeId = String(id || "").trim()
    if (!safeId) return
    const res = await fetch(backendApiUrl(`/api/notifications/${encodeURIComponent(safeId)}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => null)

    if (!res || !res.ok) {
      const readRes = await fetch(backendApiUrl(`/api/notifications/${encodeURIComponent(safeId)}/read`), {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => null)
      if (!readRes || !readRes.ok) return
    }

    setNotifications((prev) => (Array.isArray(prev) ? prev.filter((n) => n.id !== safeId) : []))
  }

  const stepTitle =
    le.step === 1 ? "Pick fields"
    : le.step === 2 ? "Choose template"
    : le.step === 3 ? "Repeat"
    : le.step === 4 ? "Output"
    : "Review"

  function scrollWorkAreaToTop() {
    const main = mainScrollRef.current
    if (main) {
      main.scrollTop = 0
      main.scrollTo({ top: 0, behavior: "auto" })
    }
    const panel = (main?.querySelector(".le-panel") as HTMLElement | null)
      || (typeof document !== "undefined" ? (document.querySelector(".le-main .le-panel") as HTMLElement | null) : null)
    if (panel) {
      panel.scrollTop = 0
      panel.scrollTo({ top: 0, behavior: "auto" })
    }
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0)
      if (document?.documentElement) document.documentElement.scrollTop = 0
      if (document?.body) document.body.scrollTop = 0
    }
  }

  return (
    <div className="le-app">
      <Sidebar
        step={le.step}
        steps={le.steps}
        stepperPct={le.stepperPct}
        maxReachableStep={le.maxReachableStep}
        onGoTo={le.goTo}
        onOpenMenu={() => {
          le.setDrawerOpen(true)
          le.setDrawerView("menu")
        }}
        onReset={le.resetAll}
        planLabel={planLabel}
        scheduledCount={le.schedules.length}
        onOpenPlans={() => setComparePlansOpen(true)}
        onOpenSchedules={() => {
          le.setDrawerOpen(true)
          le.setDrawerView("autoRefill")
        }}
        unreadNotifications={notifications.filter((n) => !n.readAt).length}
        onOpenNotifications={() => {
          setNotificationOpen(true)
        }}
      />

      {le.drawerOpen ? (
        <>
          <div
            className="le-drawerOverlay"
            onClick={() => {
              le.setDrawerOpen(false)
              setEditId(null)
              setDetailsId(null)
              setConfirmDeleteId(null)
              setConfirmDowngrade(false)
              setComparePlansOpen(false)
            }}
            role="button"
            tabIndex={0}
            aria-label="Close menu"
          />
          <div className="le-drawer" role="dialog" aria-label="Menu">
            <div className="le-drawerTop">
              <div className="le-drawerTitle">{le.drawerView === "menu" ? "Menu" : "Auto refill"}</div>

              <div className="le-drawerTopRight">
                {le.drawerView !== "menu" ? (
                  <button
                    className="le-drawerIconBtn"
                    onClick={() => le.setDrawerView("menu")}
                    type="button"
                    aria-label="Back"
                    title="Back"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M15.5 5.5 9 12l6.5 6.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                ) : null}

                <button
                  className="le-drawerClose"
                  onClick={() => {
                    le.setDrawerOpen(false)
                    setConfirmDowngrade(false)
                    setComparePlansOpen(false)
                  }}
                  type="button"
                  aria-label="Close"
                  title="Close"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>

            {le.drawerView === "menu" ? (
              <div className="le-drawerBody le-drawerBodyMenu">
                <button
                  className="le-drawerItem le-drawerItemPrimary"
                  type="button"
                  onClick={() => le.setDrawerView("autoRefill")}
                >
                  <div className="le-drawerPrimaryRow">
                    <div className="le-drawerPrimaryLeft">
                      <span className="le-drawerPrimaryIcon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M5 12a7 7 0 0 1 11.9-4.95M19 12a7 7 0 0 1-11.9 4.95" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                          <path d="M16.8 3.9v3.2h-3.2M7.2 20.1v-3.2h3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                      <span className="le-drawerItemTitle">Auto refill</span>
                    </div>
                    <span className="le-drawerCountBadge">Scheduled: {Array.isArray(le.schedules) ? le.schedules.length : 0}</span>
                  </div>
                  <div className="le-drawerItemSub">Pause, edit, resume, and delete schedules, and view run status.</div>
                </button>

                <div className="le-drawerBottom">
                  <div className="le-drawerItem le-drawerItemPlan">
                    <div className="le-planCardTop">
                      <div className="le-drawerItemTitle">Current plan</div>
                      <span className={`le-planInlineLabel ${planLabel.toLowerCase()}`}>{planLabel}</span>
                    </div>
                    <div className="le-drawerItemSub">Manage limits and billing from here.</div>
                    <div className="le-planSwitchRow">
                      <button
                        className="le-btn ghost le-planSwitchBtn"
                        type="button"
                        onClick={() => setComparePlansOpen(true)}
                      >
                        Compare plans
                      </button>
                      {billingAvailable && planLabel === "Paid" ? (
                        <button
                          className="le-btn ghost le-planSwitchBtn"
                          type="button"
                          disabled={planBusy}
                          onClick={async () => {
                            const out = await onOpenBillingPortal()
                            if (out.ok) startPlanSyncPolling()
                            if (!out.ok) window.alert(String(out.error || "Could not open billing"))
                          }}
                        >
                          {planBusy ? "Opening..." : "Manage billing"}
                        </button>
                      ) : null}
                    </div>
                    {planSyncing ? <div className="le-planSyncHint">Syncing billing status...</div> : null}
                    {!planSyncing && planSyncedAt ? <div className="le-planSyncHint">Last updated: {new Date(planSyncedAt).toLocaleTimeString()}</div> : null}
                    {planMessage ? <div className="le-planMessage">{planMessage}</div> : null}
                  </div>

                  <div className="le-drawerToolsRow">
                    <button className="le-toolIconBtn" type="button" onClick={() => setFaqOpen(true)}>
                      <span className="le-toolIcon" aria-hidden="true">?</span>
                      <span className="le-toolLabel">FAQ</span>
                    </button>
                    <button
                      className="le-toolIconBtn"
                      type="button"
                      onClick={() => {
                        setTutorialIndex(0)
                        setTutorialOpen(true)
                        le.setDrawerOpen(false)
                      }}
                    >
                      <span className="le-toolIcon" aria-hidden="true">✦</span>
                      <span className="le-toolLabel">Tutorial</span>
                    </button>
                  </div>

                  <div className="le-drawerAuthRow">
                    <div className="le-drawerAuthInfo">
                      <div className="le-drawerItemTitle">{userName || "Signed in"}</div>
                      <div className="le-drawerItemSub" title={userEmail || "No email"}>{userEmail || "No email"}</div>
                    </div>
                    <div className="le-drawerAuthActions">
                      <button
                        className="le-btn ghost le-editAccountBtn"
                        type="button"
                        aria-label="Edit account"
                        title="Edit account"
                        onClick={() => {
                          setAccountStatus("")
                          setAccountStatusTone("ok")
                          setPasswordStatus("")
                          setPasswordStatusTone("ok")
                          setPrefsStatus("")
                          setAccountTab("profile")
                          setAccountModalOpen(true)
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M4 20h4.2l9.9-9.9a1.9 1.9 0 0 0 0-2.7l-1.5-1.5a1.9 1.9 0 0 0-2.7 0L4 15.8V20z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
                          <path d="M12.6 7.4l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                        </svg>
                      </button>

                      <button
                        className="le-btn ghost le-signOutBtn"
                        type="button"
                        aria-label="Sign out"
                        title="Sign out"
                        onClick={async () => {
                          await onSignOut()
                          le.setDrawerOpen(false)
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M14 7V4.75A1.75 1.75 0 0 0 12.25 3h-6.5A1.75 1.75 0 0 0 4 4.75v14.5C4 20.216 4.784 21 5.75 21h6.5A1.75 1.75 0 0 0 14 19.25V17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                          <path d="M10 12h10M17 8l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  </div>

                  {confirmDowngrade && typeof document !== "undefined" && document.body
                    ? createPortal(
                        <>
                          <div className="le-modalOverlay" />
                          <div className="le-modal" role="dialog" aria-label="Confirm downgrade">
                            <div className="le-modalHeader">
                              <div className="le-modalTitle">Downgrade to Free?</div>
                              <div className="le-modalTopRight">
                                <button className="le-modalIconBtn" type="button" onClick={() => setConfirmDowngrade(false)} aria-label="Close" title="Close">
                                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
                                  </svg>
                                </button>
                              </div>
                            </div>
                            <div className="le-modalText">
                              Opens billing portal to manage your downgrade.
                            </div>

                            <div className="le-modalActions">
                              <button className="le-btn ghost" type="button" onClick={() => setConfirmDowngrade(false)}>
                                Cancel
                              </button>

                              <button
                                className="le-btn le-btnDanger"
                                type="button"
                                disabled={planBusy}
                                onClick={async () => {
                                  const out = await onOpenBillingPortal()
                                  if (out.ok) startPlanSyncPolling()
                                  if (out.ok) setConfirmDowngrade(false)
                                }}
                              >
                                {planBusy ? "Opening..." : "Downgrade"}
                              </button>
                            </div>
                          </div>
                        </>,
                        document.body
                      )
                    : null}

                  {comparePlansOpen && typeof document !== "undefined" && document.body
                    ? createPortal(
                        <>
                          <div className="le-modalOverlay" onClick={() => setComparePlansOpen(false)} />
                          <div className="le-modal le-planCompareModal" role="dialog" aria-label="Compare plans">
                            <div className="le-modalHeader">
                              <div className="le-modalTitle">Compare plans</div>
                              <div className="le-modalTopRight">
                                <button className="le-modalIconBtn" type="button" onClick={() => setComparePlansOpen(false)} aria-label="Close" title="Close">
                                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
                                  </svg>
                                </button>
                              </div>
                            </div>

                            <div className="le-planCompareGrid">
                              <div className={`le-planCard ${planLabel === "Free" ? "is-current" : ""}`}>
                                <div className="le-planCardHead">
                                  <div className="le-planCardTitle">Free</div>
                                </div>
                                <div className="le-planRow"><span className="ok">✓</span><span>Limited to 10 copies per run</span></div>
                                <div className="le-planRow"><span className="ok">✓</span><span>Max 1 Auto refill schedule</span></div>
                                <div className="le-planRow"><span className="ok">✓</span><span>Pause, resume, delete, and history</span></div>
                                <div className="le-planRow"><span className="no">✕</span><span>Edit schedule</span></div>
                              </div>

                              <div className={`le-planCard ${planLabel === "Paid" ? "is-current" : ""}`}>
                                <div className="le-planCardHead">
                                  <div className="le-planCardTitle">Paid</div>
                                  <div className="le-planCardPrice">$10/mo</div>
                                </div>
                                <div className="le-planRow"><span className="ok">✓</span><span>Up to 100 copies per run</span></div>
                                <div className="le-planRow"><span className="ok">✓</span><span>Unlimited Auto refill schedules</span></div>
                                <div className="le-planRow"><span className="ok">✓</span><span>Pause, resume, delete, and history</span></div>
                                <div className="le-planRow"><span className="ok">✓</span><span>Edit schedule</span></div>
                              </div>
                            </div>

                            <div className="le-modalActions">
                              {!billingAvailable ? (
                                <button className="le-btn ghost" type="button" disabled>
                                  Billing coming soon
                                </button>
                              ) : planLabel === "Free" ? (
                                <div className="le-planUpgradeWrap">
                                  <button
                                    className="le-btn le-btnUpgrade"
                                    type="button"
                                    disabled={planBusy}
                                    onClick={async () => {
                                      const out = await onStartCheckout()
                                      if (out.ok) startPlanSyncPolling()
                                      if (out.ok) setComparePlansOpen(false)
                                    }}
                                  >
                                    {planBusy ? "Opening..." : "Upgrade to Paid"}
                                  </button>
                                  {planMessage ? <div className="le-planUpgradeError">{planMessage}</div> : null}
                                </div>
                              ) : (
                                <button
                                  className="le-btn le-btnDanger"
                                  type="button"
                                  disabled={planBusy}
                                  onClick={() => {
                                    setComparePlansOpen(false)
                                    setConfirmDowngrade(true)
                                  }}
                                >
                                  {planBusy ? "Opening..." : "Downgrade to Free"}
                                </button>
                              )}
                            </div>
                          </div>
                        </>,
                        document.body
                      )
                    : null}
              </div>
            ) : (
              <div className="le-drawerBody">
                <div className="le-schedHeaderRow">
                  <span className="le-drawerCountBadge">Scheduled: {le.schedules.length}</span>
                </div>

                {le.schedules.length === 0 ? (
                  <div className="le-drawerEmpty">
                    No schedules yet.
                    <div className="le-drawerEmptySub">Turn on Auto refill in Step 4 and click Finish.</div>
                  </div>
                ) : (
                  <div className="le-drawerList">
                    {le.schedules.map((s: any) => {
                      const pauseLabel = s.isPaused ? "Resume" : "Pause"
                      const pauseBtnClass = s.isPaused ? "le-actionIcon--amber" : "le-actionIcon--blue"
                      const outputLabel = s.status === "publish" ? "Publish" : s.status === "staged" ? "Staged" : "Draft"
                      const cleanupLabel =
                        s.cleanupMode === "archive"
                          ? "Archive old"
                          : s.cleanupMode === "delete"
                          ? "Delete old"
                          : s.cleanupMode === "unpublish"
                          ? "Unpublish old"
                          : "Keep old"
                      return (
                        <div className="le-schedCard" key={s.id}>
                          <div className="le-schedTop">
                            <div className="le-schedTitleWrap">
                              <div className="le-schedThumb">
                                {s.templateThumbnailUrl ? <img src={s.templateThumbnailUrl} alt="" loading="lazy" /> : <span aria-hidden="true">◌</span>}
                              </div>
                              <div className="le-schedTitle">{s.templateTitle}</div>
                            </div>
                          </div>

                          <div className="le-schedChips">
                            <div className="le-schedChip">Rule: {s.repeatType}</div>
                            <div className="le-schedChip">Every {s.interval}</div>
                            <div className="le-schedChip">Copies {s.count}</div>
                            <div className="le-schedChip">{outputLabel}</div>
                            <div className="le-schedChip">{cleanupLabel}</div>
                          </div>

                          <div className="le-schedStats">
                            <div className="le-schedStat">Created <strong>{s.createdCount}</strong></div>
                            <div className="le-schedRunWrap">
                              <div className={`le-schedRunBadge ${s.lastRunStatus === "error" ? "is-error" : ""}`}>
                                {s.lastRunStatus === "running"
                                  ? "Last run: in progress"
                                  : s.lastRunStatus === "error"
                                  ? "Last run: error"
                                  : s.lastRunStatus === "ok"
                                  ? "Last run: ok"
                                  : "Last run: idle"}
                              </div>
                              <button
                                className={`le-inlineRetry ${s.lastRunStatus === "error" ? "" : "is-disabled"}`}
                                type="button"
                                onClick={async () => {
                                  if (s.lastRunStatus !== "error") return
                                  if (retryingScheduleId) return
                                  le.updateSchedule(String(s.id || ""), {
                                    lastRunStatus: "running",
                                    lastRunMessage: "Run in progress",
                                  } as any)
                                  setRetryingScheduleId(String(s.id || ""))
                                  const out = await le.retrySchedule(String(s.id || ""))
                                  setRetryingScheduleId(null)
                                  if (!out.ok) {
                                    const msg = String(out.error || "Retry failed")
                                    if (/in progress/i.test(msg) || String(out.code || "") === "IN_PROGRESS") {
                                      return
                                    }
                                    window.alert(msg)
                                  }
                                }}
                                disabled={s.lastRunStatus !== "error" || Boolean(retryingScheduleId) || s.lastRunStatus === "running"}
                                aria-label="Retry failed run"
                                title={s.lastRunStatus === "error" ? "Retry failed run" : "Retry is available after an error"}
                              >
                                ↻
                              </button>
                            </div>
                          </div>

                          <div className="le-schedActions">
                            <button
                              className={`le-actionIcon ${pauseBtnClass}`}
                              type="button"
                              onClick={() => le.toggleSchedulePause(s.id)}
                              disabled={s.isStopped}
                              aria-label={s.isPaused ? "Resume" : "Pause"}
                              title={s.isPaused ? "Resume" : "Pause"}
                            >
                              <span aria-hidden="true">
                                {s.isPaused ? (
                                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M8 6.5v11l8-5.5-8-5.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                ) : (
                                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M9 6.5v11M15 6.5v11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                                  </svg>
                                )}
                              </span>
                              <span className="le-actionLabel">{pauseLabel}</span>
                            </button>

                            <button
                              className={`le-actionIcon le-actionIcon--green ${!canEditSchedules ? "is-locked" : ""}`}
                              type="button"
                              onClick={() => {
                                if (!canEditSchedules) return
                                setConfirmDeleteId(null)
                                setEditId(s.id)
                              }}
                              aria-label="Edit"
                              title={canEditSchedules ? "Edit" : "Paid plan required"}
                              disabled={!canEditSchedules}
                            >
                              <span aria-hidden="true">
                                {canEditSchedules ? (
                                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M4 20h4.2l9.9-9.9a1.9 1.9 0 0 0 0-2.7l-1.5-1.5a1.9 1.9 0 0 0-2.7 0L4 15.8V20z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
                                    <path d="M12.6 7.4l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                                  </svg>
                                ) : (
                                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M8 10V8a4 4 0 0 1 8 0v2M7.2 10h9.6c.66 0 1.2.54 1.2 1.2v7.6c0 .66-.54 1.2-1.2 1.2H7.2A1.2 1.2 0 0 1 6 18.8v-7.6c0-.66.54-1.2 1.2-1.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </span>
                              <span className="le-actionLabel">Edit</span>
                            </button>

                            <button
                              className="le-actionIcon le-actionIcon--red"
                              type="button"
                              onClick={() => setConfirmDeleteId(s.id)}
                              aria-label="Delete"
                              title="Delete"
                            >
                              <span aria-hidden="true">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M9 4.75h6a1 1 0 0 1 .95.68l.52 1.57H20a.75.75 0 0 1 0 1.5h-.78l-.7 10.1A2.1 2.1 0 0 1 16.43 20H7.57a2.1 2.1 0 0 1-2.09-1.4l-.7-10.1H4a.75.75 0 0 1 0-1.5h3.53l.52-1.57A1 1 0 0 1 9 4.75Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                                  <path d="M10 10v6.2M14 10v6.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                                </svg>
                              </span>
                              <span className="le-actionLabel">Delete</span>
                            </button>

                            <button
                              className="le-actionIcon"
                              type="button"
                              onClick={() => {
                                setRollbackStatus("")
                                setDetailsId(s.id)
                              }}
                              aria-label="Details"
                              title="Details"
                            >
                              <span aria-hidden="true">⋯</span>
                              <span className="le-actionLabel">Details</span>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {confirmDeleteId && typeof document !== "undefined" && document.body
                  ? createPortal(
                      <>
                        <div className="le-modalOverlay" />
                        <div className="le-modal" role="dialog" aria-label="Confirm delete">
                          <div className="le-modalHeader">
                            <div className="le-modalTitle">Delete schedule?</div>
                            <div className="le-modalTopRight">
                              <button className="le-modalIconBtn" type="button" onClick={() => setConfirmDeleteId(null)} aria-label="Close" title="Close">
                                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div className="le-modalText">This removes it from your saved schedules.</div>

                          <div className="le-modalActions">
                            <button
                              className="le-btn ghost"
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Back
                            </button>

                            <button
                              className="le-btn le-btnDanger"
                              type="button"
                              onClick={() => {
                                le.deleteSchedule(confirmDeleteId)
                                setConfirmDeleteId(null)
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </>,
                      document.body
                    )
                  : null}

                {detailsId && typeof document !== "undefined" && document.body
                  ? (() => {
                      const s = le.schedules.find((x: any) => x.id === detailsId)
                      if (!s) return null

                    const outputLabel = s.status === "publish" ? "Publish" : s.status === "staged" ? "Staged" : "Draft"
                    const cleanupLabel =
                      s.cleanupMode === "archive"
                        ? "Archive old items"
                        : s.cleanupMode === "delete"
                        ? "Delete old items"
                        : s.cleanupMode === "unpublish"
                        ? "Unpublish old items"
                        : "Keep old items"
                    const runEntries = (Array.isArray(s.runs) ? s.runs : [])
                      .filter((run: any) => {
                        const createdCount = Number(run?.createdCount || 0)
                        const createdIds = Array.isArray(run?.createdItemIds) ? run.createdItemIds : []
                        const rollbackDeleted = Number(run?.rollbackDeletedCount || 0)
                        const rollbackFailed = Number(run?.rollbackFailedCount || 0)
                        const warning = String(run?.warning || "").trim()
                        const error = String(run?.error || "").trim()
                        const rollbackError = String(run?.rollbackError || "").trim()
                        return (
                          createdCount > 0 ||
                          createdIds.length > 0 ||
                          rollbackDeleted > 0 ||
                          rollbackFailed > 0 ||
                          Boolean(run?.rolledBackAt) ||
                          Boolean(warning) ||
                          Boolean(error) ||
                          Boolean(rollbackError)
                        )
                      })
                      .slice(-30)
                      .reverse()

                      return createPortal(
                        <>
                          <div className="le-modalOverlay" onClick={() => {
                            setRollbackStatus("")
                            setDetailsId(null)
                          }} />
                          <div className="le-modal" role="dialog" aria-label="Schedule details">
                          <div className="le-modalHeader">
                            <div className="le-modalTitle">Schedule details</div>
                            <div className="le-modalTopRight">
                              <button className="le-modalIconBtn" type="button" onClick={() => {
                                setRollbackStatus("")
                                setDetailsId(null)
                              }} aria-label="Close" title="Close">
                                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div className="le-modalText le-modalTextWithThumb">
                            <span className="le-modalThumb">
                              {s.templateThumbnailUrl ? <img src={s.templateThumbnailUrl} alt="" loading="lazy" /> : <span aria-hidden="true">◌</span>}
                            </span>
                            <span className="le-detailsScheduleName">{s.templateTitle}</span>
                          </div>

                          <div className="le-detailsSection">
                            <div className="le-detailsSectionTitle">Schedule settings</div>
                            <div className="le-detailsList">
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Repeat:</strong><span className="le-detailsLineValue">{s.repeatType}</span></div>
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Every:</strong><span className="le-detailsLineValue">{s.interval}</span></div>
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Copies:</strong><span className="le-detailsLineValue">{s.count}</span></div>
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Output status:</strong><span className="le-detailsLineValue">{outputLabel}</span></div>
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Old items:</strong><span className="le-detailsLineValue">{cleanupLabel}</span></div>
                            </div>
                          </div>

                          <div className="le-detailsSection">
                            <div className="le-detailsSectionTitle">Context</div>
                            <div className="le-detailsList">
                              {(() => {
                                const weekdaySetLabel = Object.entries(s.weekdaySet || {})
                                  .filter(([, on]) => Boolean(on))
                                  .map(([k]) => k)
                                  .join(", ")
                                const showWeekdaySet =
                                  s.repeatType === "weekly" ||
                                  (s.repeatType === "custom" && (s.customRule === "weekdays" || s.customRule === "weekends"))
                                const showCustomRule = s.repeatType === "custom"
                                const showNthWeekday = s.repeatType === "custom" && s.customRule === "nthWeekday"
                                return (
                                  <>
                                    <div className="le-detailsLine"><strong className="le-detailsLineLabel">Collection:</strong><span className="le-detailsLineValue">{s.collectionName}</span></div>
                                    <div className="le-detailsLine"><strong className="le-detailsLineLabel">Template:</strong><span className="le-detailsLineValue">{s.templateTitle}</span></div>
                                    <div className="le-detailsLine"><strong className="le-detailsLineLabel">Fields:</strong><span className="le-detailsLineValue">{s.startFieldName}{s.endFieldId ? ` -> ${s.endFieldName}` : ""}</span></div>
                                    {showWeekdaySet ? <div className="le-detailsLine"><strong className="le-detailsLineLabel">Weekday set:</strong><span className="le-detailsLineValue">{weekdaySetLabel || "-"}</span></div> : null}
                                    {showCustomRule ? <div className="le-detailsLine"><strong className="le-detailsLineLabel">Custom rule:</strong><span className="le-detailsLineValue">{s.customRule || "-"}</span></div> : null}
                              {showNthWeekday ? (
                                      <div className="le-detailsLine"><strong className="le-detailsLineLabel">Nth / weekday:</strong><span className="le-detailsLineValue">{s.nth || "-"} / {Number.isFinite(Number(s.nthWeekday)) ? Number(s.nthWeekday) : "-"}</span></div>
                              ) : null}
                                  </>
                                )
                              })()}
                            </div>
                          </div>

                          <div className="le-detailsSection">
                            <div className="le-detailsSectionTitle">Health</div>
                            <div className="le-detailsList">
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Last run:</strong><span className="le-detailsLineValue">{s.lastRunStatus || "idle"}</span></div>
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Last message:</strong><span className="le-detailsLineValue">{s.lastRunMessage || "-"}</span></div>
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Paused:</strong><span className="le-detailsLineValue">{s.isPaused ? "Yes" : "No"}</span></div>
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Stopped:</strong><span className="le-detailsLineValue">{s.isStopped ? "Yes" : "No"}</span></div>
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Error streak:</strong><span className="le-detailsLineValue">{Number(s.errorStreak || 0)}</span></div>
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Last tick:</strong><span className="le-detailsLineValue">{s.lastTickAt ? new Date(s.lastTickAt).toLocaleString() : "-"}</span></div>
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Issued keys:</strong><span className="le-detailsLineValue">{Array.isArray(s.issuedStartKeys) ? s.issuedStartKeys.length : 0}</span></div>
                              <div className="le-detailsLine"><strong className="le-detailsLineLabel">Last issued key:</strong><span className="le-detailsLineValue">{s.lastIssuedStartKey || "-"}</span></div>
                            </div>
                          </div>

                          <div className="le-detailsHistoryWrap">
                            <div className="le-modalTitle">History ({Array.isArray(s.history) ? s.history.length : 0})</div>
                            {Array.isArray(s.history) && s.history.length > 0 ? (
                              <div className="le-detailsHistoryList">
                                {[...s.history]
                                  .slice(-200)
                                  .reverse()
                                  .map((h: any, idx: number) => (
                                    <div className="le-detailsHistoryRow" key={`${h.itemId || "item"}-${h.createdAt || 0}-${idx}`}>
                                      <div className="le-detailsHistoryTop">
                                        <span className="le-detailsHistoryItem">
                                          {h.startISO
                                            ? le.formatISO(h.startISO, String(h.startISO).includes("T"))
                                            : "No start date"}
                                        </span>
                                      </div>
                                      <div className="le-detailsHistoryPills">
                                        <span className={`le-detailsHistoryState is-${String(h.state || "created")}`}>{h.state || "created"}</span>
                                        <span className="le-detailsHistoryState">{h.source || "initial"}</span>
                                        <span className="le-detailsHistoryState">{h.outputMode || "-"}</span>
                                      </div>
                                      <div className="le-detailsHistoryMeta">
                                        <span>Item: {h.itemId || "-"}</span>
                                        <span>{h.createdAt ? new Date(h.createdAt).toLocaleString() : "-"}</span>
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            ) : (
                              <div className="le-drawerEmptySub" style={{ marginTop: 8 }}>No history yet.</div>
                            )}
                          </div>

                          <div className="le-detailsHistoryWrap" style={{ marginTop: 10 }}>
                            <div className="le-modalTitle">Run history ({runEntries.length})</div>
                            {runEntries.length > 0 ? (
                              <div className="le-detailsHistoryList">
                                {runEntries.map((run: any, idx: number) => {
                                    const runId = String(run?.runId || "")
                                    const canRollback = !run?.rolledBackAt && Number(run?.createdCount || 0) > 0
                                    const disabled = !runId || !canRollback || rollingBackRunId === runId
                                    const sourceLabel = String(run?.source || "") === "manual" ? "Initial run" : "Auto-refill"
                                    const runTimeLabel = run?.createdAt ? new Date(run.createdAt).toLocaleString() : "-"
                                    return (
                                      <div className="le-detailsHistoryRow" key={`${runId || "run"}-${idx}`}>
                                        <div className="le-detailsHistoryTop">
                                          <span className="le-detailsHistoryItem">{runTimeLabel}</span>
                                          {canRollback ? (
                                            <button
                                              className="le-detailsRunRollback"
                                              type="button"
                                              disabled={disabled}
                                              onClick={() => {
                                                if (!runId || !s.id) return
                                                const yes = window.confirm("Rollback this run? This removes items created by this run.")
                                                if (!yes) return
                                                setRollbackStatus("")
                                                setRollingBackRunId(runId)
                                                void le.rollbackScheduleRun(String(s.id), runId).then((out: any) => {
                                                  if (!out?.ok) {
                                                    setRollbackStatus(String(out?.error || "Rollback failed"))
                                                  } else {
                                                    setRollbackStatus(String(out?.message || "Rollback complete"))
                                                  }
                                                  setRollingBackRunId(null)
                                                })
                                              }}
                                              aria-label="Rollback run"
                                              title="Rollback run"
                                            >
                                              {rollingBackRunId === runId ? (
                                                "..."
                                              ) : (
                                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                                  <path d="M13 3a9 9 0 1 0 6.37 2.63" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                                  <path d="M13 8v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                                  <path d="M20.5 2.5v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                                </svg>
                                              )}
                                            </button>
                                          ) : null}
                                        </div>
                                        <div className="le-detailsHistoryPills">
                                          <span className="le-detailsHistoryState is-source">{sourceLabel}</span>
                                          <span className={`le-detailsHistoryState is-${String(run?.status || "ok")}`}>{run?.status || "ok"}</span>
                                          <span className="le-detailsHistoryState">Created {Number(run?.createdCount || 0)} item(s)</span>
                                          {run?.rolledBackAt ? <span className="le-detailsHistoryState">Rolled back</span> : null}
                                        </div>
                                        <div className="le-detailsHistoryMeta">
                                          {run?.rolledBackAt ? <span>Rollback: {new Date(run.rolledBackAt).toLocaleString()}</span> : null}
                                          {run?.warning ? <span>{String(run.warning)}</span> : null}
                                          {run?.error ? <span>{String(run.error)}</span> : null}
                                          {run?.rollbackError ? <span>{String(run.rollbackError)}</span> : null}
                                        </div>
                                      </div>
                                    )
                                  })}
                              </div>
                            ) : (
                              <div className="le-drawerEmptySub" style={{ marginTop: 8 }}>No runs yet.</div>
                            )}
                            {rollbackStatus ? <div className="le-modalText" style={{ marginTop: 8 }}>{rollbackStatus}</div> : null}
                          </div>

                            <div className="le-modalActions">
                              <button className="le-btn primary" type="button" onClick={() => {
                                setRollbackStatus("")
                                setDetailsId(null)
                              }}>
                                Close
                              </button>
                            </div>
                          </div>
                        </>,
                        document.body
                      )
                    })()
                  : null}
              </div>
            )}
          </div>
        </>
      ) : null}

      {notificationOpen && typeof document !== "undefined" && document.body
        ? createPortal(
            <>
              <div className="le-modalOverlay" onClick={() => setNotificationOpen(false)} />
              <div className="le-modal le-modalNotif" role="dialog" aria-label="Notifications">
                <div className="le-modalHeader">
                  <div className="le-modalTitle">Notifications</div>
                  <div className="le-modalTopRight">
                    <button className="le-modalIconBtn" type="button" onClick={() => setNotificationOpen(false)} aria-label="Close" title="Close">
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
                {notifications.filter((n) => !n.readAt).length === 0 ? (
                  <div className="le-modalText">{notificationsError ? `Could not load notifications: ${notificationsError}` : "No unread notifications."}</div>
                ) : (
                  <div className="le-notificationList">
                    {[...notifications]
                      .filter((n) => !n.readAt)
                      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
                      .map((n) => {
                        return (
                          <div className="le-notificationItem is-unread" key={n.id}>
                            <div className="le-notificationTop">
                              <div className="le-notificationTitle">{n.title}</div>
                              <button
                                className="le-notificationDismiss"
                                type="button"
                                onClick={() => void dismissNotification(n.id)}
                                aria-label="Remove notification"
                                title="Remove"
                              >
                                ×
                              </button>
                            </div>
                            <div className="le-notificationBody">{n.body}</div>
                            <div className="le-notificationAt">{n.createdAt ? new Date(n.createdAt).toLocaleString() : ""}</div>
                          </div>
                        )
                      })}
                  </div>
                )}
                <div className="le-modalActions le-modalActionsSticky">
                  <button className="le-btn ghost" type="button" onClick={markNotificationsSeen}>Mark as read</button>
                  <button className="le-btn primary" type="button" onClick={() => setNotificationOpen(false)}>Close</button>
                </div>
              </div>
            </>,
            document.body
          )
        : null}

      {faqOpen && typeof document !== "undefined" && document.body
        ? createPortal(
            <>
              <div className="le-modalOverlay" onClick={() => setFaqOpen(false)} />
              <div className="le-modal" role="dialog" aria-label="FAQ">
                <div className="le-modalHeader">
                  <div className="le-modalTitle">FAQ</div>
                  <div className="le-modalTopRight">
                    <button className="le-modalIconBtn" type="button" onClick={() => setFaqOpen(false)} aria-label="Close" title="Close">
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="le-stack le-helpStack">
                  {Object.entries(
                    FAQ_ITEMS.reduce((acc: Record<string, Array<{ q: string; a: string }>>, item) => {
                      const key = item.section || "General"
                      if (!acc[key]) acc[key] = []
                      acc[key].push({ q: item.q, a: item.a })
                      return acc
                    }, {})
                  ).map(([section, rows]) => (
                    <div key={section} className="le-helpGroup">
                      <div className="le-helpSectionTitle">{section}</div>
                      {rows.map((item) => (
                        <div key={item.q} className="le-helpItem">
                          <div className="le-helpQ">{item.q}</div>
                          <div className="le-helpA">{item.a}</div>
                        </div>
                      ))}
                    </div>
                  ))}

                  <div className="le-helpGroup">
                    <div className="le-helpSectionTitle">Guides</div>
                    {DOC_SECTIONS.map((section) => (
                      <div key={section.title} className="le-helpItem">
                        <div className="le-helpQ">{section.title}</div>
                        <div className="le-helpA">
                          {section.bullets.map((b) => (
                            <div key={b}>- {b}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>,
            document.body
          )
        : null}

      {accountModalOpen && typeof document !== "undefined" && document.body
        ? createPortal(
            <>
              <div className="le-modalOverlay" onClick={() => setAccountModalOpen(false)} />
              <div className="le-modal" role="dialog" aria-label="Edit account">
                <div className="le-modalHeader">
                  <div className="le-modalTitle">Edit account</div>
                  <div className="le-modalTopRight">
                    <button className="le-modalIconBtn" type="button" onClick={() => setAccountModalOpen(false)} aria-label="Close" title="Close">
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="le-accountTabs">
                  <button className={`le-toolIconBtn le-accountToolTab ${accountTab === "profile" ? "is-active" : ""}`} type="button" onClick={() => setAccountTab("profile")}>
                    <span className="le-toolIcon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
                        <path fill="currentColor" d="M12 12.5a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 1.5c-3.4 0-6.75 1.65-6.75 4.25 0 .41.34.75.75.75h12c.41 0 .75-.34.75-.75 0-2.6-3.35-4.25-6.75-4.25Z"/>
                      </svg>
                    </span>
                    <span className="le-toolLabel">Profile</span>
                  </button>
                  <button className={`le-toolIconBtn le-accountToolTab ${accountTab === "security" ? "is-active" : ""}`} type="button" onClick={() => setAccountTab("security")}>
                    <span className="le-toolIcon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
                        <path fill="currentColor" d="M12 3.75a4 4 0 0 0-4 4v1.75h-.25A2.75 2.75 0 0 0 5 12.25v6A2.75 2.75 0 0 0 7.75 21h8.5A2.75 2.75 0 0 0 19 18.25v-6a2.75 2.75 0 0 0-2.75-2.75H16V7.75a4 4 0 0 0-4-4Zm-2.5 5.75V7.75a2.5 2.5 0 0 1 5 0V9.5h-5Z"/>
                      </svg>
                    </span>
                    <span className="le-toolLabel">Security</span>
                  </button>
                  <button className={`le-toolIconBtn le-accountToolTab ${accountTab === "notifications" ? "is-active" : ""}`} type="button" onClick={() => setAccountTab("notifications")}>
                    <span className="le-toolIcon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
                        <path fill="currentColor" d="M12 3.75a4.25 4.25 0 0 0-4.25 4.25v1.9c0 .67-.22 1.33-.64 1.86l-.95 1.2c-.82 1.03-.08 2.54 1.23 2.54h9.22c1.31 0 2.05-1.51 1.23-2.54l-.95-1.2a2.98 2.98 0 0 1-.64-1.86V8A4.25 4.25 0 0 0 12 3.75Zm-1.9 13.5a1.9 1.9 0 0 0 3.8 0h-3.8Z"/>
                      </svg>
                    </span>
                    <span className="le-toolLabel">Alerts</span>
                  </button>
                </div>

                {accountTab === "profile" ? (
                  <div className="le-accountTabPanel le-stack">
                    <div>
                      <div className="le-label">Full name</div>
                      <input
                        className="le-input"
                        type="text"
                        value={accountName}
                        onChange={(e) => setAccountName(e.target.value)}
                        placeholder="Your name"
                        autoComplete="name"
                      />
                    </div>
                    <div>
                      <div className="le-label">Email</div>
                      <div className="le-readOnlyEmail">{userEmail || "No email"}</div>
                    </div>
                    {accountStatus ? <div className={accountStatusTone === "ok" ? "le-accountEditSuccess" : "le-accountEditError"}>{accountStatus}</div> : null}
                    <div className="le-modalActions">
                      <button className="le-btn ghost" type="button" onClick={() => setAccountModalOpen(false)}>Cancel</button>
                      <button
                        className="le-btn primary"
                        type="button"
                        disabled={accountBusy || !accountName.trim()}
                        onClick={async () => {
                          if (!accountName.trim()) return
                          setAccountBusy(true)
                          setAccountStatus("")
                          setAccountStatusTone("ok")
                          const out = await onUpdateProfile(accountName.trim())
                          setAccountBusy(false)
                          if (!out.ok) {
                            setAccountStatusTone("err")
                            setAccountStatus(String(out.error || "Could not save changes"))
                            return
                          }
                          setAccountStatusTone("ok")
                          setAccountStatus("Profile updated")
                        }}
                      >
                        {accountBusy ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {accountTab === "security" ? (
                  <div className="le-accountTabPanel le-stack">
                    {!canChangePassword ? (
                      <div className="le-modalText" style={{ marginTop: 0 }}>
                        You are signed in with Google. Password changes are only available for email/password accounts.
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="le-label">Current password</div>
                          <input className="le-input" type="password" value={passwordCurrent} onChange={(e) => setPasswordCurrent(e.target.value)} minLength={6} autoComplete="current-password" />
                        </div>
                        <div>
                          <div className="le-label">New password</div>
                          <input className="le-input" type="password" value={passwordNext} onChange={(e) => setPasswordNext(e.target.value)} minLength={6} autoComplete="new-password" />
                        </div>
                        <div>
                          <div className="le-label">Confirm password</div>
                          <input className="le-input" type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} minLength={6} autoComplete="new-password" />
                        </div>
                        {passwordStatus ? <div className={passwordStatusTone === "ok" ? "le-accountEditSuccess" : "le-accountEditError"}>{passwordStatus}</div> : null}
                        <div className="le-modalActions">
                          <button
                            className="le-btn primary"
                            type="button"
                            disabled={passwordBusy || !passwordCurrent || !passwordNext || !passwordConfirm}
                            onClick={async () => {
                              if (passwordNext !== passwordConfirm) {
                                setPasswordStatusTone("err")
                                setPasswordStatus("Passwords do not match")
                                return
                              }
                              setPasswordBusy(true)
                              setPasswordStatus("")
                              setPasswordStatusTone("ok")
                              const out = await onUpdatePassword(passwordCurrent, passwordNext)
                              setPasswordBusy(false)
                              if (!out.ok) {
                                setPasswordStatusTone("err")
                                setPasswordStatus(String(out.error || "Could not update password"))
                                return
                              }
                              setPasswordCurrent("")
                              setPasswordNext("")
                              setPasswordConfirm("")
                              setPasswordStatusTone("ok")
                              setPasswordStatus("Password updated")
                            }}
                          >
                            {passwordBusy ? "Updating..." : "Update password"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : null}

                {accountTab === "notifications" ? (
                  <div className="le-accountTabPanel le-stack">
                    {([
                      ["billing", "Billing updates"],
                      ["scheduleFailures", "Schedule failure alerts"],
                      ["productUpdates", "Product updates"],
                      ["newsletter", "Newsletter"],
                    ] as Array<[keyof NotificationPrefs, string]>).map(([key, label]) => (
                      <div className="le-switchRow" key={key}>
                        <div className="le-switchLabel">{label}</div>
                        <button
                          className={`le-switch ${prefsDraft[key] ? "is-on" : ""}`}
                          type="button"
                          onClick={() => setPrefsDraft((prev) => ({ ...prev, [key]: !prev[key] }))}
                          aria-label={label}
                          aria-pressed={prefsDraft[key]}
                        >
                          <span className="le-switchKnob" />
                        </button>
                      </div>
                    ))}
                    {prefsStatus ? <div className={prefsStatusTone === "ok" ? "le-accountEditSuccess" : "le-accountEditError"}>{prefsStatus}</div> : null}
                    <div className="le-modalActions">
                      <button
                        className="le-btn primary"
                        type="button"
                        disabled={prefsBusy}
                        onClick={async () => {
                          setPrefsBusy(true)
                          setPrefsStatus("")
                          setPrefsStatusTone("ok")
                          const out = await onUpdateNotificationPrefs(prefsDraft)
                          setPrefsBusy(false)
                          if (!out.ok) {
                            setPrefsStatusTone("err")
                            setPrefsStatus(String(out.error || "Could not save notification preferences"))
                            return
                          }
                          setPrefsStatusTone("ok")
                          setPrefsStatus("Notification preferences updated")
                        }}
                      >
                        {prefsBusy ? "Saving..." : "Save preferences"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>,
            document.body
          )
        : null}

      <main className="le-main" ref={mainScrollRef}>
        <div className="le-titlebar">
          <div className="le-titlebar-title">{stepTitle}</div>
        </div>

        {le.showLoadingBanner ? <div className="le-alert">Loading Webflow CMS data</div> : null}

        {!le.serverOk ? (
          <div className="le-alert warn">
            Backend not reachable. Set window.__LOOP_EVENTS_BACKEND__ or use relative local backend.
          </div>
        ) : null}

          <section className="le-panel">
            {le.step === 1 ? <Step1 le={le} /> : null}
            {le.step === 2 ? <Step2 le={le} /> : null}
            {le.step === 3 ? <Step3 le={le} maxRunCount={maxRunCount} /> : null}
            {le.step === 4 ? (
              <Step4
                le={le}
                planLabel={planLabel}
                scheduleCount={activeScheduleCount}
                maxSchedules={maxSchedules}
                autoRefillLocked={autoRefillLocked}
              />
            ) : null}
            {le.step === 5 ? <Step5 le={le} /> : null}
          </section>

        <footer className="le-footer">
          <button className="le-btn ghost" onClick={() => {
            scrollWorkAreaToTop()
            le.goBack()
            window.setTimeout(scrollWorkAreaToTop, 0)
          }} disabled={le.step === 1} type="button">
            Back
          </button>

          {le.step < 5 ? (
            <button className="le-btn primary" onClick={() => {
              scrollWorkAreaToTop()
              le.goNext()
              window.setTimeout(scrollWorkAreaToTop, 0)
            }} disabled={le.primaryDisabled} type="button">
              Next
            </button>
          ) : (
            <button className="le-btn ghost" onClick={le.resetAll} type="button">
              Start over
            </button>
          )}
        </footer>
        <AutoRefillEditModal
          open={Boolean(editId)}
          schedule={editId ? le.schedules.find((x: any) => x.id === editId) : null}
          onClose={() => setEditId(null)}
          onSave={(id, patch) => le.updateSchedule(id, patch)}
        />
      </main>

      {tutorialOpen && typeof document !== "undefined" && document.body
        ? createPortal(
            <div className="le-tutorialCard" role="dialog" aria-label="Tutorial">
          <div className="le-tutorialStep">{TUTORIAL_STEPS[tutorialIndex]?.title || "Tutorial"}</div>
          <div className="le-tutorialText">{TUTORIAL_STEPS[tutorialIndex]?.text || ""}</div>
          <div className="le-tutorialActions">
            <button
              className="le-btn ghost"
              type="button"
              onClick={() => {
                setTutorialOpen(false)
                const key = `loop-events-tutorial-dismissed-${String(user?.id || "anon")}`
                try { window.localStorage.setItem(key, "1") } catch {
                  // ignore
                }
              }}
            >
              Skip
            </button>
            <button className="le-btn ghost le-tutorialNavBtn" type="button" aria-label="Previous" disabled={tutorialIndex <= 0} onClick={() => setTutorialIndex((v) => Math.max(0, v - 1))}>←</button>
            <button
              className="le-btn primary le-tutorialNavBtn"
              type="button"
              aria-label={tutorialIndex >= TUTORIAL_STEPS.length - 1 ? "Done" : "Next"}
              onClick={() => {
                if (tutorialIndex >= TUTORIAL_STEPS.length - 1) {
                  setTutorialOpen(false)
                  const key = `loop-events-tutorial-dismissed-${String(user?.id || "anon")}`
                  try { window.localStorage.setItem(key, "1") } catch {
                    // ignore
                  }
                  return
                }
                setTutorialIndex((v) => Math.min(TUTORIAL_STEPS.length - 1, v + 1))
              }}
            >
              {tutorialIndex >= TUTORIAL_STEPS.length - 1 ? "✓" : "→"}
            </button>
          </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

export default function App() {
  const qs = new URLSearchParams(window.location.search)
  const authAttemptId = String(qs.get("auth_attempt") || "").trim()
  const hashState = readAuthHash()
  const isAuthCallback = qs.get("auth_callback") === "1" || hashState.hasAuthTokens
  const authCallbackError = String(qs.get("error_description") || qs.get("error") || hashState.error || "").trim()
  const supabase = getSupabaseClient()
  const configError = getSupabaseConfigError()
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [planLabel, setPlanLabel] = useState<"Free" | "Paid">("Free")
  const [planMaxSchedules, setPlanMaxSchedules] = useState<number | null>(1)
  const [activeScheduleCount, setActiveScheduleCount] = useState(0)
  const [hasReachedScheduleLimit, setHasReachedScheduleLimit] = useState(false)
  const [, setPlanStateLoading] = useState(false)
  const [billingAvailable, setBillingAvailable] = useState(false)
  const [, setSubscriptionStatus] = useState("")
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false)
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null)
  const [, setCanTogglePlan] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [planMessage, setPlanMessage] = useState("")
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS)

  async function fetchPlanState(activeSession?: Session | null): Promise<{ plan: "free" | "paid"; hasReachedScheduleLimit: boolean } | null> {
    if (!supabase) return null
    try {
      setPlanStateLoading(true)
      const s = activeSession || (await supabase.auth.getSession()).data.session
      const token = String(s?.access_token || "").trim()
      if (!token) {
        setPlanLabel("Free")
        setPlanMaxSchedules(1)
        setActiveScheduleCount(0)
        setHasReachedScheduleLimit(false)
        setBillingAvailable(false)
        setSubscriptionStatus("")
        setCancelAtPeriodEnd(false)
        setCurrentPeriodEnd(null)
        setCanTogglePlan(false)
        return { plan: "free", hasReachedScheduleLimit: false }
      }

      const res = await fetch(backendApiUrl("/api/plan"), {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPlanLabel("Free")
        setPlanMaxSchedules(1)
        setActiveScheduleCount(0)
        setHasReachedScheduleLimit(false)
        setBillingAvailable(false)
        setSubscriptionStatus("")
        setCancelAtPeriodEnd(false)
        setCurrentPeriodEnd(null)
        setCanTogglePlan(false)
        return { plan: "free", hasReachedScheduleLimit: false }
      }

      const planRaw = String((data as any)?.plan || "free").toLowerCase()
      setPlanLabel(planRaw === "paid" ? "Paid" : "Free")
      const maxSchedulesRaw = (data as any)?.limits?.maxSchedules
      const parsedMaxSchedules = parseMaxSchedules(maxSchedulesRaw)
      setPlanMaxSchedules(parsedMaxSchedules)
      const activeCountRaw = (data as any)?.usage?.activeScheduleCount
      const activeCount = Number.isFinite(Number(activeCountRaw)) ? Number(activeCountRaw) : 0
      setActiveScheduleCount(activeCount)
      const reachedRaw = (data as any)?.usage?.hasReachedScheduleLimit
      const reachedByCount = Number.isFinite(parsedMaxSchedules as number) ? activeCount >= Number(parsedMaxSchedules) : false
      setHasReachedScheduleLimit(Boolean(typeof reachedRaw === "boolean" ? reachedRaw : reachedByCount))
      setBillingAvailable(Boolean((data as any)?.billingAvailable))
      setSubscriptionStatus(String((data as any)?.subscription?.status || ""))
      setCancelAtPeriodEnd(Boolean((data as any)?.subscription?.cancelAtPeriodEnd))
      setCurrentPeriodEnd((data as any)?.subscription?.currentPeriodEnd || null)
      setCanTogglePlan(Boolean((data as any)?.canTogglePlan))
      return {
        plan: planRaw === "paid" ? "paid" : "free",
        hasReachedScheduleLimit: Boolean(typeof reachedRaw === "boolean" ? reachedRaw : reachedByCount),
      }
    } catch {
      setPlanLabel("Free")
      setPlanMaxSchedules(1)
      setActiveScheduleCount(0)
      setHasReachedScheduleLimit(false)
      setBillingAvailable(false)
      setSubscriptionStatus("")
      setCancelAtPeriodEnd(false)
      setCurrentPeriodEnd(null)
      setCanTogglePlan(false)
      return { plan: "free", hasReachedScheduleLimit: false }
    } finally {
      setPlanStateLoading(false)
    }
    return null
  }

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      setSession(null)
      return
    }

    let mounted = true

    async function syncSession(nextSession: Session | null) {
      if (!mounted) return
      if (!nextSession) {
        setSession(null)
        setAuthLoading(false)
        return
      }

      try {
        const { data, error } = await supabase.auth.getUser(nextSession.access_token)
        if (!mounted) return
        if (error || !data?.user) {
          await supabase.auth.signOut()
          if (!mounted) return
          setSession(null)
          setAuthLoading(false)
          return
        }
      } catch {
        await supabase.auth.signOut()
        if (!mounted) return
        setSession(null)
        setAuthLoading(false)
        return
      }

      setSession(nextSession)
      setAuthLoading(false)
    }

    void supabase.auth.getSession().then(({ data }) => {
      void syncSession(data.session || null)
    }).catch(() => undefined)

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncSession(nextSession || null)
    })

    function refreshOnFocus() {
      if (document.visibilityState === "hidden") return
      void supabase.auth.getSession().then(({ data }) => {
        void syncSession(data.session || null)
      })
    }

    window.addEventListener("focus", refreshOnFocus)
    document.addEventListener("visibilitychange", refreshOnFocus)

    return () => {
      mounted = false
      data.subscription.unsubscribe()
      window.removeEventListener("focus", refreshOnFocus)
      document.removeEventListener("visibilitychange", refreshOnFocus)
    }
  }, [supabase])

  useEffect(() => {
    (window as any).__LOOP_EVENTS_AUTH_TOKEN__ = String(session?.access_token || "")
    void fetchPlanState(session)
  }, [session])

  useEffect(() => {
    const raw = (session?.user as any)?.user_metadata?.notification_prefs
    setNotificationPrefs(parseNotificationPrefs(raw))
  }, [session?.user])

  useEffect(() => {
    if (!supabase) return
    function onAuthDone(evt: MessageEvent) {
      const data = evt && typeof evt.data === "object" ? (evt.data as any) : null
      if (!data) return

      if (data.type === "loop-events-auth-session") {
        const accessToken = String(data.access_token || "").trim()
        const refreshToken = String(data.refresh_token || "").trim()
        if (!accessToken || !refreshToken) return
        void supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ data: next, error }) => {
          if (!error) {
            setSession(next.session || null)
          }
          setAuthLoading(false)
        })
        return
      }

      if (data.type !== "loop-events-auth-complete") return

      void supabase.auth.getSession().then(({ data: next }) => {
        setSession(next.session || null)
        setAuthLoading(false)
      })
    }
    window.addEventListener("message", onAuthDone)
    return () => window.removeEventListener("message", onAuthDone)
  }, [supabase])

  useEffect(() => {
    if (!isAuthCallback || authLoading) return
    void (async () => {
      if (hashState.accessToken && hashState.refreshToken && authAttemptId) {
        try {
          await fetch(backendApiUrl("/api/auth/relay"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attemptId: authAttemptId,
              accessToken: hashState.accessToken,
              refreshToken: hashState.refreshToken,
            }),
          })
        } catch {
          // ignore relay failure and keep postMessage fallback below
        }
      }

      try {
        if (hashState.accessToken && hashState.refreshToken && window.opener && window.opener !== window) {
          window.opener.postMessage(
            {
              type: "loop-events-auth-session",
              access_token: hashState.accessToken,
              refresh_token: hashState.refreshToken,
            },
            window.location.origin
          )
        }
        if (window.opener && window.opener !== window) {
          window.opener.postMessage({ type: "loop-events-auth-complete" }, window.location.origin)
        }
      } catch {
        // ignore cross-window notify errors
      }
    })()

    if (!authCallbackError && window.opener && window.opener !== window) {
      const id = window.setTimeout(() => {
        try {
          window.close()
        } catch {
          // ignore close failures
        }
      }, 1400)
      return () => window.clearTimeout(id)
    }
  }, [isAuthCallback, authLoading, authCallbackError, hashState.accessToken, hashState.refreshToken, authAttemptId])

  if (isAuthCallback) {
    const mergedError = authCallbackError || configError
    return <AuthCallbackScreen loading={authLoading} error={mergedError} />
  }

  if (!supabase) {
    return <AuthScreen supabase={null} configError={configError} />
  }

  if (authLoading) {
    return (
      <div className="le-authWrap">
        <div className="le-authCard le-authLoadingCard">
          <div className="le-authBrand">
            <span className="le-authBrandLogo" aria-hidden="true">
              <LogoIcon />
            </span>
            <span className="le-authBrandName">Loop Events</span>
          </div>
          <div className="le-authLoadingTitle">Checking your session</div>
          <div className="le-authLoadingSub">One moment...</div>
          <div className="le-authDots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    )
  }

  if (!session?.user) {
    return <AuthScreen supabase={supabase} configError={configError} />
  }

  return (
    <AuthenticatedApp
      user={session.user}
      accessToken={String(session.access_token || "")}
      onSignOut={async () => {
        await supabase.auth.signOut()
      }}
      onUpdateProfile={async (fullName) => {
        try {
          const trimmed = String(fullName || "").trim()
          if (!trimmed) return { ok: false, error: "Name is required" }
          const { error } = await supabase.auth.updateUser({
            data: {
              full_name: trimmed,
              name: trimmed,
            },
          })
          if (error) return { ok: false, error: String(error.message || error) }

          const { data } = await supabase.auth.getSession()
          setSession(data.session || null)
          return { ok: true }
        } catch (err: any) {
          return { ok: false, error: String(err?.message || err || "Could not update account") }
        }
      }}
      onUpdatePassword={async (currentPassword, nextPassword) => {
        try {
          const pwd = String(nextPassword || "")
          const current = String(currentPassword || "")
          if (pwd.length < 6) return { ok: false, error: "Password must be at least 6 characters" }
          if (current.length < 6) return { ok: false, error: "Current password is required" }
          const email = String(session?.user?.email || "").trim()
          if (!email) return { ok: false, error: "No email found for this account" }

          const verify = await supabase.auth.signInWithPassword({ email, password: current })
          if (verify.error) return { ok: false, error: "Current password is incorrect" }

          const { error } = await supabase.auth.updateUser({ password: pwd })
          if (error) return { ok: false, error: String(error.message || error) }

          const token = String(session?.access_token || "").trim()
          if (token) {
            void fetch(backendApiUrl("/api/notifications/account-event"), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ event: "password_changed" }),
            })
          }

          return { ok: true }
        } catch (err: any) {
          return { ok: false, error: String(err?.message || err || "Could not update password") }
        }
      }}
      notificationPrefs={notificationPrefs}
      onUpdateNotificationPrefs={async (nextPrefs) => {
        try {
          const safePrefs = parseNotificationPrefs(nextPrefs)
          const { error } = await supabase.auth.updateUser({
            data: {
              notification_prefs: safePrefs,
            },
          })
          if (error) return { ok: false, error: String(error.message || error) }
          setNotificationPrefs(safePrefs)
          const { data } = await supabase.auth.getSession()
          setSession(data.session || null)

          const token = String(data.session?.access_token || session?.access_token || "").trim()
          if (token) {
            void fetch(backendApiUrl("/api/notifications/account-event"), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ event: "notification_prefs_updated" }),
            })
          }

          return { ok: true }
        } catch (err: any) {
          return { ok: false, error: String(err?.message || err || "Could not update preferences") }
        }
      }}
      planLabel={planLabel}
      activeScheduleCount={activeScheduleCount}
      maxSchedules={planMaxSchedules}
      hasReachedScheduleLimit={hasReachedScheduleLimit}
      billingAvailable={billingAvailable}
      cancelAtPeriodEnd={cancelAtPeriodEnd}
      currentPeriodEnd={currentPeriodEnd}
      planBusy={planBusy}
      planMessage={planMessage}
      onRefreshPlan={async () => {
        return await fetchPlanState(session)
      }}
      onStartCheckout={async () => {
        try {
          if (!supabase) return { ok: false, error: "Auth not ready" }
          setPlanBusy(true)
          setPlanMessage("")
          const billingTab = window.open("", "loop-events-billing")
          if (!billingTab) {
            setPlanBusy(false)
            const msg = "Popup blocked. Please allow popups and try again."
            setPlanMessage(msg)
            return { ok: false, error: msg }
          }
          const s = (await supabase.auth.getSession()).data.session
          const token = String(s?.access_token || "").trim()
          if (!token) {
            try { billingTab?.close() } catch { /* ignore close error */ }
            setPlanBusy(false)
            return { ok: false, error: "Not authenticated" }
          }

          const res = await fetch(backendApiUrl("/api/billing/checkout"), {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          })
          const data = await res.json().catch(() => ({}))
          setPlanBusy(false)
          if (!res.ok) {
            try { billingTab?.close() } catch { /* ignore close error */ }
            const msg = String((data as any)?.error || "Could not start checkout")
            setPlanMessage(msg)
            return { ok: false, error: msg }
          }
          const url = String((data as any)?.url || "").trim()
          if (!url) {
            try { billingTab?.close() } catch { /* ignore close error */ }
            setPlanMessage("Missing checkout url")
            return { ok: false, error: "Missing checkout url" }
          }

          billingTab.location.href = url
          return { ok: true }
        } catch (err: any) {
          setPlanBusy(false)
          const msg = String(err?.message || err || "Could not start checkout")
          setPlanMessage(msg)
          return { ok: false, error: msg }
        }
      }}
      onOpenBillingPortal={async () => {
        try {
          if (!supabase) return { ok: false, error: "Auth not ready" }
          setPlanBusy(true)
          setPlanMessage("")
          const billingTab = window.open("", "loop-events-billing")
          if (!billingTab) {
            setPlanBusy(false)
            const msg = "Popup blocked. Please allow popups and try again."
            setPlanMessage(msg)
            return { ok: false, error: msg }
          }
          const s = (await supabase.auth.getSession()).data.session
          const token = String(s?.access_token || "").trim()
          if (!token) {
            try { billingTab?.close() } catch { /* ignore close error */ }
            setPlanBusy(false)
            return { ok: false, error: "Not authenticated" }
          }

          const res = await fetch(backendApiUrl("/api/billing/portal"), {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          })
          const data = await res.json().catch(() => ({}))
          setPlanBusy(false)
          if (!res.ok) {
            try { billingTab?.close() } catch { /* ignore close error */ }
            const msg = String((data as any)?.error || "Could not open billing portal")
            setPlanMessage(msg)
            return { ok: false, error: msg }
          }
          const url = String((data as any)?.url || "").trim()
          if (!url) {
            try { billingTab?.close() } catch { /* ignore close error */ }
            setPlanMessage("Missing billing portal url")
            return { ok: false, error: "Missing billing portal url" }
          }

          billingTab.location.href = url
          return { ok: true }
        } catch (err: any) {
          setPlanBusy(false)
          const msg = String(err?.message || err || "Could not open billing portal")
          setPlanMessage(msg)
          return { ok: false, error: msg }
        }
      }}
    />
  )
}
