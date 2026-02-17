import React from "react"

export default function Step2(props: { le: any }) {
  const le = props.le
  const filteredItems = Array.isArray(le.filteredItems) ? le.filteredItems : []

  return (
    <div className="le-stack">
      <div className="le-row">
        <div className="le-field le-grow">
          <div className="le-label">Search items</div>
          <input
            className="le-input"
            placeholder="Search by name..."
            value={le.search}
            onChange={(e) => le.setSearch(e.target.value)}
          />
        </div>
        <div className="le-pillbox">{filteredItems.length}</div>
      </div>

      <div className="le-list le-list--max">
        {filteredItems.map((i: any) => {
          const active = i.id === le.selectedItemId
          const subtitle = i.startISO ? le.formatISO(i.startISO, Boolean(le.startWantsTime)) : "No start date on this item"

          return (
            <button
              key={i.id}
              className={`le-list-item ${active ? "is-active" : ""}`}
              onClick={() => {
                le.setSelectedItemId(i.id)
                le.seedFromItem(i)
              }}
              type="button"
            >
              <div className="le-li-media">
                {i.thumbnailUrl ? (
                  <div className="le-li-thumb">
                    <img src={i.thumbnailUrl} alt="" loading="lazy" />
                  </div>
                ) : (
                  <div className="le-li-thumb is-placeholder" aria-hidden="true">◌</div>
                )}
              </div>

              <div className="le-li-left">
                <div className="le-li-title">{i.title}</div>
                <div className="le-li-sub">{subtitle}</div>
              </div>

              <div className="le-li-right">
                <span className={`le-check ${active ? "is-on" : ""}`} aria-hidden="true">
                  {active ? "✓" : ""}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {filteredItems.length === 0 ? (
        <div className="le-alert warn">No items found. Double-check the collection and Start date field.</div>
      ) : null}
    </div>
  )
}
