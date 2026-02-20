import React, { useEffect } from "react"
import LogoIcon from "./LogoIcon"

export default function AuthCallbackScreen(props: {
  loading: boolean
  error: string
}) {
  const { loading, error } = props

  useEffect(() => {
    if (!loading && !error) {
      const timer = setTimeout(() => {
        window.location.href = "https://loop-events.webflow.io"
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [loading, error])

  const title = error
    ? "Could not complete authentication"
    : loading
    ? "Completing authentication..."
    : "Installation Complete!"

  const body = error
    ? error
    : loading
    ? "Please wait a moment."
    : "Loop Events has been successfully installed to your Webflow site. Redirecting automatically..."

  return (
    <div className="le-authWrap">
      <div className="le-authCard le-authCallbackCard">
        <div className="le-authBrand">
          <span className="le-authBrandLogo" aria-hidden="true">
            <LogoIcon />
          </span>
          <span className="le-authBrandName">Loop Events</span>
        </div>

        <div className="le-authCallbackTitle">{title}</div>
        <div className="le-authCallbackText">{body}</div>

        <div className="le-authCallbackActions">
          <button
            className="le-btn primary"
            type="button"
            onClick={() => window.location.href = "https://webflow.com/apps"}
          >
            Go to Loop Events
          </button>
        </div>
      </div>
    </div>
  )
}
