import React from "react"
import InfoDot from "./InfoDot"

export default function Step1(props: { le: any }) {
  const le = props.le
  const dateFields = Array.isArray(le.dateFields) ? le.dateFields : []
  const collections = Array.isArray(le.collections) ? le.collections : []

  return (
    <div className="le-stack">
      <div className="le-row2">
        <div className="le-field">
          <div className="le-label">Collection</div>
          <select
            className="le-input"
            value={le.collectionId}
            disabled={!le.serverOk || collections.length === 0}
            onChange={(e) => {
              const nextId = e.target.value
              le.setCollectionId(nextId)

              le.setSelectedItemId("")
              le.setSearch("")
              le.setStartFieldId("")
              le.setEndFieldId("")
            }}
          >
            {collections.length === 0 ? <option value="">No collections</option> : null}
            {collections.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.displayName || c.id}
              </option>
            ))}
          </select>
        </div>

        <div className="le-field">
          <div className="le-label le-labelRow">Start date field <InfoDot text="This is the date/time field the app uses to generate each scheduled copy." /></div>
          <select
            className="le-input"
            value={le.startFieldId}
            disabled={!le.serverOk || dateFields.length === 0}
            onChange={(e) => le.setStartFieldId(e.target.value)}
          >
            {dateFields.length === 0 ? <option value="">No date fields</option> : null}
            {dateFields.map((f: any) => (
              <option key={f.id} value={f.id}>
                {f.name} {f.type === "datetime" ? "(date + time)" : "(date)"}
              </option>
            ))}
          </select>
        </div>

        <div className="le-field">
          <div className="le-label le-labelRow">End date field (optional) <InfoDot text="Use this if your events have duration and need an end date/time." /></div>
          <select
            className="le-input"
            value={le.endFieldId}
            disabled={!le.serverOk || dateFields.length === 0}
            onChange={(e) => le.setEndFieldId(e.target.value)}
          >
            <option value="">None</option>
            {dateFields
              .filter((f: any) => f.id !== le.startFieldId)
              .map((f: any) => (
                <option key={f.id} value={f.id}>
                  {f.name} {f.type === "datetime" ? "(date + time)" : "(date)"}
                </option>
              ))}
          </select>
        </div>
      </div>

      {!le.canNextFrom1 ? (
        <div className="le-alert warn">Pick a collection and a Start date field to continue.</div>
      ) : null}
    </div>
  )
}
