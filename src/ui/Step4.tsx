import React from "react"
import InfoDot from "./InfoDot"

export default function Step4(props: {
  le: any
  planLabel?: "Free" | "Paid"
  scheduleCount?: number
  maxSchedules?: number | null
  autoRefillLocked?: boolean
}) {
  const le = props.le
  const scheduleCount = Number(props.scheduleCount || 0)
  const maxSchedules = props.maxSchedules
  const autoRefillLocked =
    typeof props.autoRefillLocked === "boolean"
      ? props.autoRefillLocked
      : Number.isFinite(maxSchedules as number) && scheduleCount >= Number(maxSchedules)

  React.useEffect(() => {
    if (!autoRefillLocked) return
    if (le.autoRefillEnabled) {
      le.setAutoRefillEnabled(false)
    }
  }, [autoRefillLocked, le.autoRefillEnabled])

  return (
    <div className="le-stack">
      <div className="le-row2">
        <div className="le-field">
          <div className="le-label le-labelRow">Create as <InfoDot text="Choose whether new copies are draft, staged, or published immediately." /></div>
          <select className="le-input" value={le.status} onChange={(e) => le.setStatus(e.target.value)}>
            <option value="draft">Draft</option>
            <option value="staged">Staged</option>
            <option value="publish">Publish</option>
          </select>
        </div>

        <div className="le-field">
          <div className="le-label le-labelWithLock">
            <span>Auto refill</span>
            {autoRefillLocked ? (
              <span className="le-lockBadge" title="Paid plan unlocks unlimited schedules" aria-label="Locked for free plan">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 10V8a4 4 0 0 1 8 0v2M7.2 10h9.6c.66 0 1.2.54 1.2 1.2v7.6c0 .66-.54 1.2-1.2 1.2H7.2A1.2 1.2 0 0 1 6 18.8v-7.6c0-.66.54-1.2 1.2-1.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>Paid</span>
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className={`le-check ${le.autoRefillEnabled ? "is-on" : ""} ${autoRefillLocked ? "is-locked" : ""}`}
            onClick={() => {
              if (autoRefillLocked) return
              le.setAutoRefillEnabled((v: boolean) => !v)
            }}
            aria-pressed={le.autoRefillEnabled}
            disabled={autoRefillLocked}
          >
            {le.autoRefillEnabled ? "✓" : ""}
          </button>
          <div className="le-hint">
            {autoRefillLocked
              ? "Free plan allows one active Auto refill schedule. Switch to Paid for unlimited schedules."
              : "When enabled, the backend keeps this schedule topped up to your Copies count."}
          </div>
        </div>

        {le.autoRefillEnabled ? (
          <>
            <div className="le-field">
              <div className="le-label le-labelRow">Old items <InfoDot text="Choose what happens to past items when Auto refill runs." /></div>
              <select className="le-input" value={le.cleanupMode} onChange={(e) => le.setCleanupMode(e.target.value)}>
                <option value="off">Keep old items</option>
                <option value="archive">Archive old items</option>
                <option value="delete">Delete old items</option>
                <option value="unpublish">Unpublish old items</option>
              </select>
              <div className="le-hint">Checks every 10 seconds. Old means start date/time is in the past.</div>
            </div>
          </>
        ) : null}
      </div>

      {le.status === "publish" ? <div className="le-alert warn">Publishing is not reversible</div> : null}
    </div>
  )
}
