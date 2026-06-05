/**
 * Zoho Books vendor CSV → FINOS Vendor mapper
 *
 * Zoho exports a tab-delimited or comma-delimited CSV with headers that include
 * spaces and mixed casing. This module normalises the header keys and maps each
 * row to the shape expected by the /api/vendors/import route.
 */

export interface ZohoVendorRow {
  contactId: string
  contactName: string
  companyName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  mobilePhone: string
  currencyCode: string
  notes: string
  website: string
  status: string
  paymentTermsLabel: string
  paymentTerms: string
  openingBalance: string
  billingAttention: string
  billingAddress: string
  billingStreet2: string
  billingCity: string
  billingState: string
  billingCountry: string
  billingCode: string
}

export interface MappedVendor {
  externalVendorId: string
  companyName: string
  contactName: string | null
  email: string | null
  phone: string | null
  billingAddress: string | null
  billingCity: string | null
  billingState: string | null
  billingCountry: string | null
  billingPostalCode: string | null
  paymentTerms: number
  openingBalance: number
  currency: string
  notes: string | null
  website: string | null
  isActive: boolean
}

/** Normalise a header string: lowercase, strip spaces / parentheses / slashes */
function normaliseKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s()/]+/g, '_')
    .replace(/_+$/, '')
}

function cell(row: Record<string, string>, key: string): string {
  return (row[key] ?? '').trim()
}

function nullableStr(v: string): string | null {
  return v === '' ? null : v
}

/** Parse a Zoho vendor CSV string (comma or tab delimited) into mapped rows. */
export function parseZohoVendorCsv(csvText: string): {
  rows: MappedVendor[]
  skipped: number
} {
  const lines = csvText.split(/\r?\n/)
  if (lines.length < 2) return { rows: [], skipped: 0 }

  // Auto-detect delimiter: tab or comma
  const delimiter = lines[0].includes('\t') ? '\t' : ','

  const rawHeaders = lines[0].split(delimiter).map((h) => h.replace(/^"|"$/g, '').trim())
  const headers = rawHeaders.map(normaliseKey)

  const rows: MappedVendor[] = []
  let skipped = 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Simple CSV split (handles quoted fields)
    const values = splitCsvLine(line, delimiter)
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? '').replace(/^"|"$/g, '').trim()
    })

    const contactId = cell(row, 'contact_id')
    if (!contactId) { skipped++; continue }

    // Company name: prefer Contact Name, fall back to Company Name
    const displayName =
      cell(row, 'contact_name') ||
      cell(row, 'company_name') ||
      cell(row, 'display_name')

    if (!displayName) { skipped++; continue }

    const firstName = cell(row, 'first_name')
    const lastName  = cell(row, 'last_name')
    const contactName = [firstName, lastName].filter(Boolean).join(' ') || null

    const phone = cell(row, 'phone') || cell(row, 'mobilephone') || null

    const paymentTermsRaw = cell(row, 'payment_terms')
    const paymentTerms = paymentTermsRaw === '' ? 0 : parseInt(paymentTermsRaw, 10) || 0

    const openingBalanceRaw = cell(row, 'opening_balance')
    const openingBalance = openingBalanceRaw === '' ? 0 : parseFloat(openingBalanceRaw) || 0

    const statusRaw = cell(row, 'status').toLowerCase()
    const isActive = statusRaw !== 'inactive'

    const currency = cell(row, 'currency_code') || 'NGN'

    // Billing address: combine street1 + street2
    const street1 = cell(row, 'billing_address')
    const street2 = cell(row, 'billing_street2')
    const billingAddress = [street1, street2].filter(Boolean).join(', ') || null

    rows.push({
      externalVendorId: contactId,
      companyName: displayName,
      contactName: nullableStr(contactName ?? ''),
      email: nullableStr(cell(row, 'emailid')),
      phone: nullableStr(phone ?? ''),
      billingAddress,
      billingCity: nullableStr(cell(row, 'billing_city')),
      billingState: nullableStr(cell(row, 'billing_state')),
      billingCountry: nullableStr(cell(row, 'billing_country')),
      billingPostalCode: nullableStr(cell(row, 'billing_code')),
      paymentTerms,
      openingBalance,
      currency,
      notes: nullableStr(cell(row, 'notes')),
      website: nullableStr(cell(row, 'website')),
      isActive,
    })
  }

  return { rows, skipped }
}

/** Split a single CSV/TSV line respecting double-quoted fields. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}
