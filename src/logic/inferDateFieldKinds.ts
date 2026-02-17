type CMSItem = Record<string, any>

function looksLikeDateTime(value: any) {
  const s = String(value || "").trim()
  if (!s) return false

  // ISO datetime, or "YYYY-MM-DD HH:mm"
  if (s.includes("T")) return true
  if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(s)) return true

  // Anything that includes an HH:mm somewhere
  if (/\b\d{1,2}:\d{2}\b/.test(s)) return true

  return false
}

export function inferFieldWantsTimeFromItems(args: {
  items: CMSItem[]
  fieldId: string
  sampleSize?: number
}) {
  const items = Array.isArray(args.items) ? args.items : []
  const fieldId = String(args.fieldId || "")
  const sampleSize = Math.max(10, Math.min(300, Number(args.sampleSize || 120)))

  if (!fieldId || items.length === 0) return false

  let checked = 0
  for (let i = 0; i < items.length && checked < sampleSize; i++) {
    const v = items[i]?.[fieldId]
    if (v == null || v === "") continue

    checked += 1

    if (looksLikeDateTime(v)) {
      // One strong hit is enough
      return true
    }

  }

  // If we saw only YYYY-MM-DD values, treat as date-only.
  // If we saw weird stuff but not dateTime, stay date-only.
  return false
}
