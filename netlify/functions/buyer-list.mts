import { createHmac, timingSafeEqual } from 'node:crypto'

const SESSION_COOKIE = 'bl_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'
const PAGE_LIMIT = 100
const MAX_PAGES = 10

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

// Sessions are signed with a key derived from the passcode, so changing the
// passcode in Netlify immediately invalidates every cookie already issued.
function sessionKey(passcode: string) {
  return createHmac('sha256', passcode).update('buyer-list-session-v1').digest()
}

function signSession(passcode: string, expiresAt: number) {
  const payload = String(expiresAt)
  return `${payload}.${createHmac('sha256', sessionKey(passcode)).update(payload).digest('base64url')}`
}

function equalStrings(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function sessionIsValid(passcode: string, token?: string) {
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false
  const expiresAt = Number(payload)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false
  return equalStrings(signature, createHmac('sha256', sessionKey(passcode)).update(payload).digest('base64url'))
}

// Compare digests rather than raw input so the check stays constant-time
// regardless of how long a guessed passcode is.
function passcodeMatches(given: string, expected: string) {
  const hash = (value: string) => createHmac('sha256', 'buyer-list-passcode-compare').update(value).digest()
  return timingSafeEqual(hash(given), hash(expected))
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

function ghlHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: 'application/json' }
}

// A Private Integration token is scoped to one sub-account, but the contacts
// endpoint still wants the id spelled out. Prefer the configured value and only
// fall back to discovery for tokens that can list locations.
async function resolveLocationId(token: string) {
  const configured = Netlify.env.get('GHL_LOCATION_ID')
  if (configured) return configured.trim()

  const res = await fetch(`${GHL_BASE}/locations/search?limit=1`, { headers: ghlHeaders(token) })
  if (!res.ok) return undefined
  const data = await res.json().catch(() => null)
  return data?.locations?.[0]?.id
}

async function fetchContacts(token: string, locationId: string) {
  const collected: Record<string, unknown>[] = []
  let total = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${GHL_BASE}/contacts/search`, {
      method: 'POST',
      headers: { ...ghlHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        page,
        pageLimit: PAGE_LIMIT,
        sort: [{ field: 'dateAdded', direction: 'desc' }],
      }),
    })

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      const error = new Error(detail || `REI Lead Pros returned ${res.status}`) as Error & { status?: number }
      error.status = res.status
      throw error
    }

    const data = await res.json().catch(() => null)
    const batch = Array.isArray(data?.contacts) ? data.contacts : []
    if (typeof data?.total === 'number') total = data.total
    collected.push(...batch)
    if (batch.length < PAGE_LIMIT) break
  }

  return { contacts: collected, total: total || collected.length }
}

function normalizeContact(contact: Record<string, any>) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim()
  return {
    id: contact.id || '',
    name: name || contact.contactName || contact.name || '',
    email: contact.email || '',
    phone: contact.phone || '',
    city: contact.city || '',
    state: contact.state || '',
    source: contact.source || '',
    tags: Array.isArray(contact.tags) ? contact.tags.filter((tag: unknown) => typeof tag === 'string') : [],
    dateAdded: contact.dateAdded || contact.createdAt || '',
  }
}

async function handleLogin(req: Request, passcode: string) {
  let given = ''
  try {
    const body = await req.json()
    if (typeof body?.passcode === 'string') given = body.passcode
  } catch {
    given = ''
  }

  if (!given || !passcodeMatches(given, passcode)) {
    // Slow down guessing without keeping any server-side attempt state.
    await new Promise((resolve) => setTimeout(resolve, 450))
    console.warn('buyer-list: rejected passcode attempt')
    return json({ error: 'invalid_passcode', message: 'That passcode is not correct.' }, 401)
  }

  const expiresAt = Date.now() + SESSION_TTL_MS
  const cookie = [
    `${SESSION_COOKIE}=${signSession(passcode, expiresAt)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ].join('; ')

  return json({ ok: true, expiresAt }, 200, { 'Set-Cookie': cookie })
}

function handleLogout() {
  const cookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
  return json({ ok: true }, 200, { 'Set-Cookie': cookie })
}

async function handleContacts() {
  const token = Netlify.env.get('GHL_TOKEN')
  if (!token) {
    return json(
      { error: 'not_configured', message: 'GHL_TOKEN is not set on this site yet.' },
      503,
    )
  }

  const locationId = await resolveLocationId(token)
  if (!locationId) {
    return json(
      {
        error: 'no_location',
        message:
          'Could not work out which REI Lead Pros sub-account to read. Add a GHL_LOCATION_ID environment variable holding the sub-account id.',
      },
      503,
    )
  }

  try {
    const { contacts, total } = await fetchContacts(token, locationId)
    return json({
      contacts: contacts.map(normalizeContact),
      total,
      truncated: total > contacts.length,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    const status = (error as { status?: number }).status
    console.error('buyer-list: contacts lookup failed', status, (error as Error).message)
    if (status === 401 || status === 403) {
      return json(
        {
          error: 'ghl_unauthorized',
          message: 'REI Lead Pros rejected the token. Check that GHL_TOKEN is current and can read contacts.',
        },
        502,
      )
    }
    return json(
      { error: 'ghl_unavailable', message: 'Could not reach REI Lead Pros.', detail: (error as Error).message },
      502,
    )
  }
}

export default async (req: Request) => {
  const passcode = Netlify.env.get('BUYER_LIST_PASSCODE')
  if (!passcode) {
    return json(
      { error: 'not_configured', message: 'BUYER_LIST_PASSCODE is not set on this site yet.' },
      503,
    )
  }

  const route = new URL(req.url).pathname.replace(/\/+$/, '')

  if (route.endsWith('/session')) {
    if (req.method === 'POST') return handleLogin(req, passcode)
    if (req.method === 'DELETE') return handleLogout()
    return json({ error: 'method_not_allowed' }, 405)
  }

  if (route.endsWith('/contacts')) {
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
    if (!sessionIsValid(passcode, readCookie(req, SESSION_COOKIE))) {
      return json({ error: 'unauthorized', message: 'Enter the team passcode to continue.' }, 401)
    }
    return handleContacts()
  }

  return json({ error: 'not_found' }, 404)
}

export const config = {
  path: ['/api/buyer-list/session', '/api/buyer-list/contacts'],
}
