import { createClient, type SupabaseClient } from "@supabase/supabase-js"

declare global {
  interface Window {
    __SUPABASE_URL__?: string
    __SUPABASE_ANON_KEY__?: string
  }
}

let cachedClient: SupabaseClient | null = null

function readConfig() {
  const url = String(window.__SUPABASE_URL__ || "").trim()
  const anonKey = String(window.__SUPABASE_ANON_KEY__ || "").trim()
  return { url, anonKey }
}

export function getSupabaseClient() {
  if (cachedClient) return cachedClient
  const { url, anonKey } = readConfig()
  if (!url || !anonKey) return null
  cachedClient = createClient(url, anonKey)
  return cachedClient
}

export function getSupabaseConfigError() {
  const { url, anonKey } = readConfig()
  if (url && anonKey) return ""
  return "Missing Supabase config. Set window.__SUPABASE_URL__ and window.__SUPABASE_ANON_KEY__ in public/index.html"
}
