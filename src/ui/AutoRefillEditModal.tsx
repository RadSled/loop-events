import React, { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

type AutoCheckUnit = "seconds" | "minutes" | "hours" | "days"
type CleanupMode = "off" | "archive" | "delete" | "unpublish"
type OutputStatus = "draft" | "staged" | "publish"
type RepeatType = "daily" | "weekly" | "monthly" | "custom"
type CustomRule = "weekdays" | "weekends" | "nthWeekday"

type AutoRefillSchedule = {
  id: string
  createdAt: number
  isPaused: boolean
  isStopped: boolean
  createdCount: number
  lastTickAt?: number

  collectionId: string
  collectionName: string
  startFieldId: string
  startFieldName: string
  endFieldId: string
  endFieldName: string
  templateItemId: string
  templateTitle: string
  templateThumbnailUrl?: string
  siteTimezone?: string
  seedStartISO?: string
  seedEndISO?: string

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
}

const WEEKDAYS = [
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
  { key: "sun", label: "S" },
]

export default function AutoRefillEditModal(props: {
  open: boolean
  schedule: AutoRefillSchedule | null
  onClose: () => void
  onSave: (id: string, patch: Partial<AutoRefillSchedule>) => void
}) {
  const { open, schedule, onClose, onSave } = props

  const [repeatType, setRepeatType] = useState<RepeatType>("weekly")
  const [interval, setInterval] = useState(1)
  const [count, setCount] = useState(10)
  const [weekdaySet, setWeekdaySet] = useState<Record<string, boolean>>({})
  const [customRule, setCustomRule] = useState<CustomRule>("weekdays")
  const [nth, setNth] = useState(2)
  const [nthWeekday, setNthWeekday] = useState(1)

  const [cleanupMode, setCleanupMode] = useState<CleanupMode>("off")
  const [status, setStatus] = useState<OutputStatus>("draft")

  const title = useMemo(() => schedule?.templateTitle || "Schedule", [schedule])

  useEffect(() => {
    if (!open || !schedule) return

    setRepeatType(schedule.repeatType)
    setInterval(schedule.interval)
    setCount(schedule.count)
    setWeekdaySet({ ...schedule.weekdaySet })
    setCustomRule(schedule.customRule)
    setNth(schedule.nth)
    setNthWeekday(schedule.nthWeekday)

    setCleanupMode(schedule.cleanupMode || "off")
    setStatus(schedule.status)
  }, [open, schedule])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open || !schedule) return null

  const content = (
    <>
      <div className="le-modalOverlay" onClick={onClose} />

      <div className="le-modal" role="dialog" aria-label="Edit schedule">
        <div className="le-modalHeader">
          <div className="le-modalTitle">Edit schedule</div>
          <div className="le-modalTopRight">
            <button className="le-modalIconBtn" type="button" onClick={onClose} aria-label="Close" title="Close">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="le-modalText le-modalTextWithThumb">
          <span className="le-modalThumb">
            {schedule.templateThumbnailUrl ? <img src={schedule.templateThumbnailUrl} alt="" loading="lazy" /> : <span aria-hidden="true">◌</span>}
          </span>
          <span>{title}</span>
        </div>

        <div className="le-stack" style={{ marginTop: 14 }}>

          {/* Repeat type */}
          <div className="le-field">
              <div className="le-label">Repeat</div>
            <select
              className="le-input"
              value={repeatType}
              onChange={(e) => setRepeatType(e.target.value as RepeatType)}
            >
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="custom">custom</option>
            </select>
          </div>

          {/* Weekly selector */}
          {repeatType === "weekly" && (
            <div className="le-week">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={`le-day ${weekdaySet?.[d.key] ? "is-on" : ""}`}
                  onClick={() =>
                    setWeekdaySet((prev) => ({
                      ...prev,
                      [d.key]: !prev?.[d.key],
                    }))
                  }
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}

          {/* Custom rule */}
          {repeatType === "custom" && (
            <>
              <div className="le-field">
                <div className="le-label">Custom rule</div>
                <select
                  className="le-input"
                  value={customRule}
                  onChange={(e) => setCustomRule(e.target.value as CustomRule)}
                >
                  <option value="weekdays">weekdays</option>
                  <option value="weekends">weekends</option>
                  <option value="nthWeekday">nth weekday of month</option>
                </select>
              </div>

              {customRule === "nthWeekday" ? (
                <div className="le-row2">
                  <div className="le-field">
                    <div className="le-label">Nth</div>
                    <input className="le-input" type="number" min={1} max={5} value={nth} onChange={(e) => setNth(Number(e.target.value))} />
                  </div>
                  <div className="le-field">
                    <div className="le-label">Weekday (0-6)</div>
                    <input className="le-input" type="number" min={0} max={6} value={nthWeekday} onChange={(e) => setNthWeekday(Number(e.target.value))} />
                  </div>
                </div>
              ) : null}
            </>
          )}

          {/* Interval + count */}
          <div className="le-row2">
            <div className="le-field">
              <div className="le-label">Every</div>
              <input
                className="le-input"
                type="number"
                min={1}
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
              />
            </div>

            <div className="le-field">
              <div className="le-label">Copies</div>
              <input
                className="le-input"
                type="number"
                min={1}
                max={200}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Status */}
          <div className="le-field">
            <div className="le-label">Output status</div>
            <select
              className="le-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as OutputStatus)}
            >
              <option value="draft">draft</option>
              <option value="staged">staged</option>
              <option value="publish">publish</option>
            </select>
          </div>

          <div className="le-field">
            <div className="le-label">Old items</div>
            <select
              className="le-input"
              value={cleanupMode}
              onChange={(e) => setCleanupMode(e.target.value as CleanupMode)}
            >
              <option value="off">keep old items</option>
              <option value="archive">archive old items</option>
              <option value="delete">delete old items</option>
              <option value="unpublish">unpublish old items</option>
            </select>
          </div>

        </div>

        <div className="le-modalActions">
          <button className="le-btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>

          <button
            className="le-btn primary"
            type="button"
            onClick={() => {
              onSave(schedule.id, {
                repeatType,
                interval,
                count,
                weekdaySet,
                customRule,
                nthWeekday,
                nth,
                cleanupMode,
                status,
              })
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </>
  )

  if (typeof document !== "undefined" && document.body) {
    return createPortal(content, document.body)
  }

  return content
}
