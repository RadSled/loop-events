import React, { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

export default function TooltipIconButton(props: {
  label: string
  onClick: () => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const node = ref.current
    if (!node) return
    const r = node.getBoundingClientRect()
    const left = Math.max(88, Math.min(window.innerWidth - 88, r.left + r.width / 2))
    const top = Math.max(8, r.top - 8)
    setPos({ top, left })
  }, [open])

  return (
    <>
      <button
        ref={ref}
        className={props.className}
        type="button"
        disabled={props.disabled}
        onClick={props.onClick}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={props.label}
        title={props.label}
      >
        {props.children}
      </button>

      {open && !props.disabled && typeof document !== "undefined" && document.body
        ? createPortal(
            <div
              className="le-infoPopover"
              style={{
                top: `${pos.top}px`,
                left: `${pos.left}px`,
                transform: "translate(-50%, -100%)",
                width: "auto",
                maxWidth: "220px",
              }}
            >
              {props.label}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
