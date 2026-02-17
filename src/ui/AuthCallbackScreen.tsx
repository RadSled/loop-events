import React from "react"
import LogoIcon from "./LogoIcon"

export default function AuthCallbackScreen(props: {
  loading: boolean
  error: string
}) {
  const { loading, error } = props

  const title = error
    ? "Could not complete authentication"
    : loading
    ? "Completing authentication..."
    : "Confirmation successful"

  const body = error
    ? error
    : loading
    ? "Please wait a moment."
    : "You can close this tab and go back to Webflow."

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
          <button className="le-btn ghost" type="button" onClick={() => window.close()}>
            Close tab
          </button>
        </div>
      </div>
    </div>
  )
}
