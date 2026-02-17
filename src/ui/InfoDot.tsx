import React, { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

export default function InfoDot(props: { text: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 220 })
  const ref = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const node = ref.current
    if (!node) return
    const r = node.getBoundingClientRect()
    const width = Math.min(260, Math.max(180, window.innerWidth - 24))
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, r.left + r.width / 2 - width / 2))
    const top = Math.max(8, r.top - 10)
    setPos({ top, left, width })
  }, [open])

  return (
    <>
      <button
        ref={ref}
        className="le-infoDot"
        type="button"
        aria-label={props.text}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>

      {open && typeof document !== "undefined" && document.body
        ? createPortal(
            <div
              className="le-infoPopover"
              style={{
                top: `${pos.top}px`,
                left: `${pos.left}px`,
                width: `${pos.width}px`,
              }}
            >
              {props.text}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
