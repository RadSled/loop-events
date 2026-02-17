import React from "react"
import CopyPreviewRow from "./CopyPreviewRow"
import InfoDot from "./InfoDot"

export default function Step3(props: { le: any; maxRunCount?: number }) {
  const le = props.le
  const maxRunCount = Number(props.maxRunCount || 200)
  const WEEKDAYS = Array.isArray(le.WEEKDAYS) ? le.WEEKDAYS : []
  const previewStarts = Array.isArray(le.previewStarts) ? le.previewStarts : []
  const previewEnds = Array.isArray(le.previewEnds) ? le.previewEnds : []

  return (
    <div className="le-stack">
      <div className="le-row2">
        <div className="le-field">
          <div className="le-label le-labelRow">Repeat <InfoDot text="Choose how dates repeat: daily, weekly, monthly, or a custom rule." /></div>
          <select className="le-input" value={le.repeatType} onChange={(e) => le.setRepeatType(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom</option>
          </select>

          {le.repeatType === "custom" ? (
            <div className="le-customRules">
              <div className="le-row2">
                <div className="le-field">
                  <div className="le-label">Rule</div>
                  <select className="le-input" value={le.customRule} onChange={(e) => le.setCustomRule(e.target.value)}>
                    <option value="weekdays">Every weekday (Mon to Fri)</option>
                    <option value="weekends">Weekends only (Sat and Sun)</option>
                    <option value="nthWeekday">Nth weekday of month</option>
                  </select>
                </div>

                {le.customRule === "nthWeekday" ? (
                  <>
                    <div className="le-field">
                      <div className="le-label">Nth</div>
                      <select className="le-input" value={le.nth} onChange={(e) => le.setNth(Number(e.target.value))}>
                        <option value={1}>1st</option>
                        <option value={2}>2nd</option>
                        <option value={3}>3rd</option>
                        <option value={4}>4th</option>
                        <option value={5}>5th</option>
                      </select>
                    </div>

                    <div className="le-field">
                      <div className="le-label">Weekday</div>
                      <select className="le-input" value={le.nthWeekday} onChange={(e) => le.setNthWeekday(Number(e.target.value))}>
                        <option value={1}>Monday</option>
                        <option value={2}>Tuesday</option>
                        <option value={3}>Wednesday</option>
                        <option value={4}>Thursday</option>
                        <option value={5}>Friday</option>
                        <option value={6}>Saturday</option>
                        <option value={0}>Sunday</option>
                      </select>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="le-field">
          <div className="le-label le-labelRow">
            Repeat interval <InfoDot text="How many periods to skip between copies. Example: 1 = every period, 2 = every second period." />
          </div>
          <input className="le-input" type="number" min={1} max={365} value={le.interval} onChange={(e) => le.setInterval(Number(e.target.value))} />
          <div className="le-hint">1 means every {le.repeatType === "weekly" ? "week" : le.repeatType === "monthly" ? "month" : "day"}.</div>
        </div>

        <div className="le-field">
          {le.repeatType === "weekly" ? (
            <>
              <div className="le-label le-labelRow">Pick weekdays <InfoDot text="Choose which weekdays can receive generated copies." /></div>
              <div className="le-week">
                {WEEKDAYS.map((d: any) => (
                  <button
                    key={d.key}
                    className={`le-day ${le.weekdaySet[d.key] ? "is-on" : ""}`}
                    onClick={() => le.setWeekdaySet((s: any) => ({ ...s, [d.key]: !s[d.key] }))}
                    type="button"
                    title={d.name}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {WEEKDAYS.length > 0 && WEEKDAYS.every((d: any) => !le.weekdaySet[d.key]) ? (
                <div className="le-hint">Pick at least one weekday.</div>
              ) : null}
            </>
          ) : (
            <div className="le-spacer" aria-hidden="true" />
          )}
        </div>

        <div className="le-field">
          <div className="le-label">Start</div>
          <div className="le-dateRow">
            <input className="le-input" type="date" value={le.startDate} onChange={(e) => le.setStartDate(e.target.value)} />
            {le.startWantsTime ? (
              <input className="le-input le-time" type="time" value={le.startTime} onChange={(e) => le.setStartTime(e.target.value)} />
            ) : null}
          </div>
        </div>

        {le.endFieldId ? (
          <div className="le-field">
            <div className="le-label">End</div>
            <div className="le-dateRow">
              <input className="le-input" type="date" value={le.endDate} onChange={(e) => le.setEndDate(e.target.value)} />
              {le.endWantsTime ? (
                <input className="le-input le-time" type="time" value={le.endTime} onChange={(e) => le.setEndTime(e.target.value)} />
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="le-field">
          <div className="le-label le-labelRow">Copies <InfoDot text="Maximum number of future items the schedule should maintain." /></div>
          <input
            className="le-input"
            type="number"
            min={1}
            max={maxRunCount}
            value={le.count}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              le.setCount(Math.max(1, Math.min(maxRunCount, n)))
            }}
          />
          <div className="le-hint">Max {maxRunCount} for your current plan.</div>
        </div>
      </div>

      <div className="le-schedHead">
        <div className="le-schedHeadTitle">Scheduled copies</div>
        <div className="le-schedHeadCount">{previewStarts.length}</div>
      </div>

      {previewStarts.length === 0 ? (
        <div className="le-alert warn">No dates yet. Adjust your rule.</div>
      ) : (
        <div className={`le-previewList ${previewStarts.length > 18 ? "is-scroll" : ""}`}>
          {previewStarts.map((iso: string, idx: number) => (
            <CopyPreviewRow
              key={`${iso}-${idx}`}
              index={idx}
              startISO={iso}
              endISO={previewEnds[idx]}
              showEnd={Boolean(le.endFieldId)}
              startWithTime={Boolean(le.startWantsTime)}
              endWithTime={Boolean(le.endWantsTime)}
              formatISO={le.formatISO}
            />
          ))}
        </div>
      )}
    </div>
  )
}
