import React from "react"
import CopyPreviewRow from "./CopyPreviewRow"

export default function Step5(props: { le: any }) {
  const le = props.le
  const toTitle = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : "")
  const previewStarts = Array.isArray(le.previewStarts) ? le.previewStarts : []
  const previewEnds = Array.isArray(le.previewEnds) ? le.previewEnds : []
  const repeatLabel = toTitle(String(le.repeatType || ""))
  const createAsLabel = toTitle(String(le.status || ""))
  const oldItemsLabel =
    le.cleanupMode === "archive"
      ? "Archive old items"
      : le.cleanupMode === "delete"
      ? "Delete old items"
      : le.cleanupMode === "unpublish"
      ? "Unpublish old items"
      : "Keep old items"
  const weekdayLabel = Array.isArray(le.WEEKDAYS)
    ? le.WEEKDAYS.filter((d: any) => Boolean(le.weekdaySet?.[d.key])).map((d: any) => d.name).join(", ")
    : ""

  const showFinishBtn = le.runStatus.type === "idle" || le.runStatus.type === "err"
  const statusClass =
    le.runStatus.type === "ok" ? "ok"
    : le.runStatus.type === "err" ? "warn"
    : le.runStatus.type === "busy" ? "busy"
    : ""

  return (
    <>
      <div className="le-reviewList">
        <div className="le-reviewRow">
          <div className="le-reviewTitle">Collection</div>
          <div className="le-reviewValue">{le.selectedCollection?.name || "Collection"}</div>
        </div>

        <div className="le-reviewDivider" />

        <div className="le-reviewRow">
          <div className="le-reviewTitle">Start Date Field</div>
          <div className="le-reviewValue">
            {le.startField ? `${le.startField.name} ${le.startField.type === "datetime" ? "(date + time)" : "(date)"}` : "None"}
          </div>
        </div>

        {le.endFieldId ? (
          <>
            <div className="le-reviewDivider" />
              <div className="le-reviewRow">
              <div className="le-reviewTitle">End Date Field (Optional)</div>
              <div className="le-reviewValue">
                {le.endField ? `${le.endField.name} ${le.endField.type === "datetime" ? "(date + time)" : "(date)"}` : "None"}
              </div>
            </div>
          </>
        ) : null}

        <div className="le-reviewDivider" />

        <div className="le-reviewRow">
          <div className="le-reviewTitle">Template</div>
          <div className="le-reviewValue">{le.selectedItem?.title || "None selected"}</div>
        </div>

        <div className="le-reviewDivider" />

        <div className="le-reviewRow">
          <div className="le-reviewTitle">Repeat</div>
          <div className="le-reviewValue">{repeatLabel || "-"}</div>
        </div>

        <div className="le-reviewDivider" />

        <div className="le-reviewRow">
          <div className="le-reviewTitle">Repeat Interval</div>
          <div className="le-reviewValue">{le.interval || 1}</div>
        </div>

        {le.repeatType === "weekly" ? (
          <>
            <div className="le-reviewDivider" />
            <div className="le-reviewRow">
              <div className="le-reviewTitle">Pick Weekdays</div>
              <div className="le-reviewValue">{weekdayLabel || "None selected"}</div>
            </div>
          </>
        ) : null}

        <div className="le-reviewDivider" />

        <div className="le-reviewRow">
          <div className="le-reviewTitle">Copies ({previewStarts.length})</div>
          <div className="le-reviewValue">
            <div className={`le-copiesScroll ${previewStarts.length > 10 ? "is-scroll" : ""}`}>
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
          </div>
        </div>

        <div className="le-reviewDivider" />

        <div className="le-reviewRow">
          <div className="le-reviewTitle">Start</div>
          <div className="le-reviewValue">{le.formatISO(le.startISO, Boolean(le.startWantsTime))}</div>
        </div>

        {le.endFieldId ? (
          <>
            <div className="le-reviewDivider" />
            <div className="le-reviewRow">
              <div className="le-reviewTitle">End</div>
              <div className="le-reviewValue">{le.formatISO(le.endISO, Boolean(le.endWantsTime))}</div>
            </div>
          </>
        ) : null}

        <div className="le-reviewDivider" />

        <div className="le-reviewRow">
          <div className="le-reviewTitle">Create As</div>
          <div className="le-reviewValue">{createAsLabel || "draft"}</div>
        </div>

        <div className="le-reviewDivider" />

        <div className="le-reviewRow">
          <div className="le-reviewTitle">Auto Refill</div>
          <div className="le-reviewValue">{le.autoRefillEnabled ? "On (every 10 seconds)" : "Off"}</div>
        </div>

        {le.autoRefillEnabled ? (
          <>
            <div className="le-reviewDivider" />
            <div className="le-reviewRow">
              <div className="le-reviewTitle">Old Items</div>
              <div className="le-reviewValue">{oldItemsLabel}</div>
            </div>
          </>
        ) : null}
      </div>

      {le.runStatus.type !== "idle" ? (
        <div className={`le-alert le-alert--prominent ${statusClass}`}>
          <span>{le.runStatus.msg}</span>
          {le.runStatus.type === "busy" ? <span className="le-spinner" aria-hidden="true" /> : null}
        </div>
      ) : null}

      {showFinishBtn ? (
        <button
          className="le-btn primary le-finishBtn"
          onClick={le.onFinish}
          type="button"
          disabled={le.isFinishing}
        >
          {le.isFinishing ? "Creating copies…" : "Finish"}
        </button>
      ) : null}
    </>
  )
}
