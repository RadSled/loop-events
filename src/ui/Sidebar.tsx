import React from "react"

type Step = 1 | 2 | 3 | 4 | 5

export default function Sidebar(props: {
  step: Step
  steps: { n: Step }[]
  stepperPct: number
  maxReachableStep: Step
  onGoTo: (n: Step) => void
  onOpenMenu: () => void
  onOpenNotifications?: () => void
  unreadNotifications?: number
  onReset: () => void
  planLabel?: "Free" | "Paid"
  scheduledCount?: number
  currentSiteName?: string
  isCurrentSiteConnected?: boolean
  onOpenSiteConnection?: () => void
  onOpenPlans?: () => void
  onOpenSchedules?: () => void
}) {
  const siteTextRef = React.useRef<HTMLSpanElement | null>(null)
  const [siteTruncated, setSiteTruncated] = React.useState(false)

  React.useEffect(() => {
    function checkSiteOverflow() {
      const el = siteTextRef.current
      if (!el) {
        setSiteTruncated(false)
        return
      }
      setSiteTruncated(el.scrollWidth > el.clientWidth + 1)
    }

    checkSiteOverflow()
    window.addEventListener("resize", checkSiteOverflow)
    return () => {
      window.removeEventListener("resize", checkSiteOverflow)
    }
  }, [props.currentSiteName])

  function openMenuNow(e?: React.SyntheticEvent) {
    if (e && typeof e.preventDefault === "function") e.preventDefault()
    props.onOpenMenu()
  }

  return (
    <aside className="le-sidebar">
      <div className="le-sb-top">
        <div className="le-sb-left le-sbSummary">
          <button
            className={`le-sbPlanBadge ${(props.planLabel || "Free").toLowerCase()}`}
            type="button"
            onClick={() => props.onOpenPlans && props.onOpenPlans()}
            aria-label="Open compare plans"
            title="Compare plans"
          >
            {props.planLabel || "Free"}
          </button>
          <button
            className="le-sbStatChip"
            type="button"
            onClick={() => props.onOpenSchedules && props.onOpenSchedules()}
            aria-label="Open auto refill schedules"
            title="Open auto refill schedules"
          >
            <span className="le-sbStatIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 12a7 7 0 0 1 11.9-4.95M19 12a7 7 0 0 1-11.9 4.95" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M16.8 3.9v3.2h-3.2M7.2 20.1v-3.2h3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
            <span>{Math.max(0, Number(props.scheduledCount || 0))}</span>
          </button>
        </div>

        {props.currentSiteName ? (
          <button
            type="button"
            className={`le-sbSiteMeta ${props.isCurrentSiteConnected ? "is-connected" : "is-disconnected"} ${siteTruncated ? "is-truncated" : ""}`}
            title={`Connected site: ${props.currentSiteName}`}
            aria-label={`Connected site: ${props.currentSiteName}`}
            onClick={() => props.onOpenSiteConnection && props.onOpenSiteConnection()}
          >
            <span className="le-sbSiteIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8.5 4.5v4M15.5 4.5v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M6.5 9h11v2.5a5.5 5.5 0 0 1-5.5 5.5h0a5.5 5.5 0 0 1-5.5-5.5V9Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                <path d="M12 17v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M9.7 20h4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </span>
            <span ref={siteTextRef} className="le-sbSiteText">{props.currentSiteName}</span>
          </button>
        ) : null}

        <div className="le-sb-actions">
          <button
            className="le-iconBtnBell"
            type="button"
            title="Notifications"
            aria-label="Notifications"
            onClick={() => props.onOpenNotifications && props.onOpenNotifications()}
          >
            <span aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 4.25a4.75 4.75 0 0 0-4.75 4.75v2.26c0 .88-.3 1.73-.86 2.42l-1.02 1.27c-.79.98-.09 2.45 1.17 2.45h10.92c1.26 0 1.96-1.47 1.17-2.45l-1.02-1.27a3.86 3.86 0 0 1-.86-2.42V9A4.75 4.75 0 0 0 12 4.25Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                <path d="M9.5 18.25a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </span>
            {Number(props.unreadNotifications || 0) > 0 ? <span className="le-iconDot" aria-hidden="true" /> : null}
          </button>

          <button
            className="le-iconBtn"
            type="button"
            title="Menu"
            aria-label="Menu"
            onClick={openMenuNow}
            onMouseDown={openMenuNow}
            onTouchEnd={openMenuNow}
          >
            ☰
          </button>
        </div>
      </div>

      <nav className="le-nav" aria-label="Steps">
        <div className="le-steps">
          <div className="le-stepsTop">
            <div className="le-steps-row" role="tablist" aria-label="Steps">
              {props.steps.map((s, idx) => {
                const active = s.n === props.step
                const done = s.n < props.step
                const isLocked = s.n > props.maxReachableStep
                const disable = isLocked

                return (
                  <React.Fragment key={s.n}>
                    <button
                      className={`le-step ${active ? "is-active" : ""} ${done ? "is-done" : ""} ${isLocked ? "is-locked" : ""}`}
                      onClick={() => {
                        if (disable) return
                        props.onGoTo(s.n)
                      }}
                      type="button"
                      title={`Step ${s.n}`}
                      aria-current={active ? "step" : undefined}
                      disabled={disable}
                    >
                      {s.n}
                    </button>

                    {idx < props.steps.length - 1 ? (
                      <div className={`le-step-line ${props.step > s.n ? "is-done" : ""}`} aria-hidden="true" />
                    ) : null}
                  </React.Fragment>
                )
              })}
            </div>
            <button className="le-stepReset" type="button" onClick={props.onReset} title="Start over" aria-label="Start over">
              ↺
            </button>
          </div>
        </div>
      </nav>
    </aside>
  )
}
