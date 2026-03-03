import React, { useEffect, useMemo, useRef, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import LogoIcon from "./LogoIcon"

declare global {
  interface Window {
    __LOOP_EVENTS_BACKEND__?: string
  }
}

function authCallbackUrl() {
  return window.location.origin
}

const PRODUCTION_BACKEND = "https://loop-events.onrender.com"

function backendBaseUrl() {
  return PRODUCTION_BACKEND
}

function oauthCallbackUrl() {
  return `${backendBaseUrl()}/auth/callback`
}

function createAuthAttemptId() {
  const rand = Math.random().toString(36).slice(2)
  return `att_${Date.now().toString(36)}_${rand}`
}

export default function AuthScreen(props: {
  supabase: SupabaseClient | null
  configError?: string
}) {
  const { supabase, configError = "" } = props
  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ type: "idle" | "ok" | "err"; msg: string }>({
    type: "idle",
    msg: "",
  })
  const oauthPopupRef = useRef<Window | null>(null)

  const ctaLabel = useMemo(() => (mode === "signin" ? "Log in" : "Sign up"), [mode])
  const busyLabel = useMemo(() => {
    if (!busy) return ctaLabel
    return mode === "signin" ? "Signing in..." : "Creating account..."
  }, [busy, ctaLabel, mode])
  const callbackUrl = authCallbackUrl()
  const oauthCallback = oauthCallbackUrl()

  useEffect(() => {
    try {
      const saved = String(window.localStorage.getItem("loop-events-remember-email") || "").trim()
      if (saved) {
        setEmail(saved)
        setRememberMe(true)
      }
    } catch {
      // ignore storage failures
    }

    return () => {
      if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
        try {
          oauthPopupRef.current.close()
        } catch {
          // ignore close failures
        }
      }
    }
  }, [])

  async function onEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!supabase) return
    setStatus({ type: "idle", msg: "" })
    setBusy(true)

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) throw error
        try {
          if (rememberMe) {
            window.localStorage.setItem("loop-events-remember-email", email.trim())
          } else {
            window.localStorage.removeItem("loop-events-remember-email")
          }
        } catch {
          // ignore storage failures
        }
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: callbackUrl,
            data: {
              full_name: fullName.trim(),
              name: fullName.trim(),
            },
          },
        })
        if (error) throw error
        setStatus({ type: "ok", msg: "Account created. You can now log in." })
        setMode("signin")
      }
    } catch (err: any) {
      const msg = String(err?.message || err || "Authentication failed")
      if (/user already registered/i.test(msg)) {
        setStatus({
          type: "err",
          msg: "This user account already exists.",
        })
      } else {
        setStatus({ type: "err", msg })
      }
    } finally {
      setBusy(false)
    }
  }

  async function onForgotPassword() {
    if (busy || !supabase) return
    const safeEmail = String(email || "").trim()
    if (!safeEmail) {
      setStatus({ type: "err", msg: "Enter your email first, then click Forgot password." })
      return
    }
    setBusy(true)
    setStatus({ type: "idle", msg: "" })
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(safeEmail)
      if (error) throw error
      setStatus({ type: "ok", msg: "If this account exists, a password reset email was sent." })
    } catch (err: any) {
      setStatus({ type: "err", msg: String(err?.message || err || "Could not send reset email") })
    } finally {
      setBusy(false)
    }
  }

  async function signInWith(provider: "google") {
    if (busy) return
    if (!supabase) return
    setStatus({ type: "idle", msg: "" })
    setBusy(true)
    const popup = window.open("", "loop-events-oauth", "popup=yes,width=540,height=720")
    if (!popup) {
      setStatus({ type: "err", msg: "Popup blocked. Please allow popups and try again." })
      setBusy(false)
      return
    }
    try {
      const oauthRes = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${oauthCallback}?auth_attempt=${encodeURIComponent(createAuthAttemptId())}`,
          skipBrowserRedirect: true,
        },
      })
      if (oauthRes.error) throw oauthRes.error
      const nextUrl = String(oauthRes?.data?.url || "").trim()
      if (!nextUrl) throw new Error("Could not start OAuth flow")
      try {
        const u = new URL(nextUrl)
        const redirectTo = String(u.searchParams.get("redirect_to") || "").trim()
        if (redirectTo) {
          const callback = new URL(redirectTo)
          const attemptId = String(callback.searchParams.get("auth_attempt") || "").trim()
          if (attemptId) {
            window.sessionStorage.setItem("loop-events-auth-attempt", attemptId)
          }
        }
      } catch {
        // ignore malformed OAuth URL details
      }
      oauthPopupRef.current = popup
      popup.location.href = nextUrl
      setBusy(false)
    } catch (err: any) {
      try {
        popup.close()
      } catch {
        // ignore close errors
      }
      setStatus({ type: "err", msg: String(err?.message || err || `${provider} login failed`) })
      setBusy(false)
    }
  }

  return (
    <div className="le-authWrap">
      <div className="le-authCard le-authMainCard">
        <div className="le-authHero">
          <div className="le-authHead">
            <div className="le-authBrand">
              <span className="le-authBrandLogo" aria-hidden="true">
                <LogoIcon />
              </span>
              <span className="le-authBrandName">Loop Events</span>
            </div>
          </div>
        </div>

        <div className="le-authFormShell">

        {configError ? <div className="le-alert warn">{configError}</div> : null}

        <form className="le-stack" onSubmit={onEmailSubmit}>
          <div className="le-authSignupTitle">{mode === "signin" ? "Login" : "Sign up"}</div>
          {mode === "signup" ? (
            <div>
              <div className="le-label">Full name</div>
              <input
                className="le-input"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
                required
                autoComplete="name"
              />
            </div>
          ) : null}
          <div>
            <div className="le-label">Email</div>
            <input
              className="le-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <div className="le-label">Password</div>
            <input
              className="le-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "Minimum 6 characters" : "Your password"}
              minLength={mode === "signup" ? 6 : undefined}
              required
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
            {mode === "signup" ? <div className="le-hint">Minimum 6 characters</div> : null}
          </div>

          {mode === "signin" ? (
            <div className="le-authOptionsRow">
              <label className="le-authRemember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(Boolean(e.target.checked))}
                />
                <span>Remember me</span>
              </label>
              <button className="le-linkBtn" type="button" onClick={onForgotPassword} disabled={busy || !supabase}>
                Forgot password?
              </button>
            </div>
          ) : null}

          {mode === "signin" && status.msg ? (
            <div className={`le-authStatus ${status.type === "err" ? "is-err" : status.type === "ok" ? "is-ok" : ""}`}>{status.msg}</div>
          ) : null}

          <button className="le-btn primary" type="submit" disabled={busy || !supabase}>
            {busyLabel}
          </button>
        </form>

        <div className="le-authBottom">
          {mode === "signin" ? (
            <button className="le-linkBtn" type="button" onClick={() => setMode("signup")} disabled={busy}>
              No account yet? Sign up
            </button>
          ) : (
            <button
              className="le-linkBtn"
              type="button"
              onClick={() => {
                setMode("signin")
                setFullName("")
              }}
              disabled={busy}
            >
              Already have an account? Log in
            </button>
          )}
        </div>

        {mode === "signin" ? (
          <>
            <div className="le-authDivider">or continue with Google</div>
            <div className="le-authSocials">
              <button className="le-socialBtn le-socialBtnGoogle" type="button" onClick={() => signInWith("google")} disabled={busy || !supabase}>
                <span className="le-socialIcon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M21.6 12.23c0-.74-.07-1.45-.19-2.13H12v4.03h5.39a4.61 4.61 0 0 1-2 3.03v2.51h3.23c1.88-1.73 2.98-4.28 2.98-7.44z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 22c2.7 0 4.97-.89 6.63-2.41l-3.23-2.51c-.89.6-2.02.96-3.4.96-2.61 0-4.83-1.76-5.62-4.13H3.05v2.58A9.99 9.99 0 0 0 12 22z"
                      fill="#34A853"
                    />
                    <path
                      d="M6.38 13.91a6 6 0 0 1 0-3.82V7.51H3.05a9.99 9.99 0 0 0 0 8.98l3.33-2.58z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a9.99 9.99 0 0 0-8.95 5.51l3.33 2.58c.79-2.37 3.01-4.13 5.62-4.13z"
                      fill="#EA4335"
                    />
                  </svg>
                </span>
                <span className="le-socialText">Continue with Google</span>
              </button>
            </div>
          </>
        ) : null}

        {mode !== "signin" && status.msg ? <div className={`le-authStatus ${status.type === "err" ? "is-err" : status.type === "ok" ? "is-ok" : ""}`}>{status.msg}</div> : null}
        </div>
      </div>
    </div>
  )
}
