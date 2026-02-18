import React from "react"

type Props = {
  index: number
  startISO: string
  endISO?: string
  showEnd: boolean
  startWithTime: boolean
  endWithTime: boolean
  formatISO: (iso: string, withTime: boolean) => string
}

export default function CopyPreviewRow(props: Props) {
  const { index, startISO, endISO, showEnd, startWithTime, endWithTime, formatISO } = props

  const startFmt = String(formatISO(startISO, startWithTime))
  const startDateTxt = startFmt.split(" ")[0] || ""
  const startTimeTxt = startFmt.split(" ").slice(1).join(" ")

  const endFmt = endISO ? String(formatISO(endISO, endWithTime)) : ""
  const endDateTxt = endFmt ? endFmt.split(" ")[0] || "" : ""
  const endTimeTxt = endFmt ? endFmt.split(" ").slice(1).join(" ") : ""

  return (
    <div className="le-previewRow">
      <div className="le-previewIdx">{String(index + 1).padStart(2, "0")}</div>

      <div className="le-previewText">
        <div className="le-startLine">
          <div className="le-copyDate">{startDateTxt}</div>
          {startWithTime ? <div className="le-copyTime">{startTimeTxt}</div> : null}
        </div>

        {showEnd && endISO ? (
          <div className="le-endLine">
            <div className="le-arrow" aria-hidden="true">→</div>
            <div className="le-copyDate le-muted">{endDateTxt}</div>
            {endWithTime ? <div className="le-copyTime le-muted">{endTimeTxt}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
