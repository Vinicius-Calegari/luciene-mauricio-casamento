import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

// Run the real Edge Function with a fake Deno runtime and mocked database HTTP.
// No environment files, credentials, production data, or network are used.
const source = await readFile(new URL('../supabase/functions/public-rsvp/index.ts', import.meta.url), 'utf8')
const publicKey = source.match(/const PUBLIC_KEY = ["']([^"']+)["']/)?.[1]
assert.ok(publicKey, 'The public application key must be discoverable in the source')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const origin = 'https://vinicius-calegari.github.io'
const endpoint = 'https://example.invalid/functions/v1/public-rsvp'
const serviceKey = 'test-service-key-must-never-be-returned'
const lookup = { action: 'lookup', name: 'Pessoa Sintetica do Teste', keyword: 'fixture-phrase', last4: '' }
const answer = { action: 'answer', token: 'A'.repeat(43), status: 'confirmed', message: null, keyword: 'fixture-phrase' }
const sha256 = value => createHash('sha256').update(value).digest('hex')
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup(fetch = async () => { throw new Error('Unexpected database request') }, { timeoutSignal } = {}) {
  const requests = []
  const logs = []
  const timeoutCalls = []
  let handler
  const sandbox = {
    exports: {},
    Deno: {
      env: { get: name => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: serviceKey, SB_REGION: 'test-region' })[name] },
      serve: callback => { handler = callback },
    },
    Request, Response, Headers, TextEncoder, AbortController,
    AbortSignal: { timeout(ms) { timeoutCalls.push(ms); return timeoutSignal ? timeoutSignal(ms) : AbortSignal.timeout(ms) } },
    crypto: webcrypto,
    performance,
    btoa,
    console: Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [level, (...args) => logs.push({ level, args })])),
    fetch: async (...args) => { requests.push(args); return fetch(...args) },
  }
  vm.runInNewContext(compiled, sandbox, { filename: 'edge-rsvp.compiled.js' })
  assert.equal(typeof handler, 'function')
  const call = (body, { method = 'POST', headers = {}, raw } = {}) => handler(new Request(endpoint, {
    method,
    headers: { Origin: origin, 'Content-Type': 'text/plain;charset=UTF-8', ...headers },
    ...(method === 'GET' || method === 'OPTIONS' ? {} : { body: raw ?? JSON.stringify({ appKey: publicKey, ...body }) }),
  }))
  return { call, requests, logs, timeoutCalls }
}

function assertPrivateLogs(logs, values = []) {
  const text = JSON.stringify(logs)
  for (const secret of [serviceKey, lookup.name, lookup.keyword, answer.token, ...values]) {
    assert.ok(!text.includes(secret), `Logs must not contain private request data: ${secret.slice(0, 8)}`)
  }
}

function assertTelemetry(response, logs, operation, status) {
  const requestId = response.headers.get('x-request-id')
  assert.match(requestId, /^[a-f0-9-]{36}$/i)
  assert.match(response.headers.get('access-control-expose-headers'), /X-Request-Id/)
  assert.match(response.headers.get('access-control-expose-headers'), /Server-Timing/)
  const durations = response.headers.get('server-timing').match(/^app;dur=([\d.]+), db;dur=([\d.]+)$/)
  assert.ok(durations, 'Both application and database transport duration are exposed')
  assert.ok(Number(durations[1]) >= Number(durations[2]))
  assert.equal(logs.length, 1)
  assert.equal(logs[0].level, 'info')
  const data = JSON.parse(logs[0].args[0])
  assert.deepEqual(Object.keys(data).sort(), ['databaseMs', 'durationMs', 'operation', 'requestId', 'status'])
  assert.deepEqual(data, { requestId, operation, status, durationMs: Number(durations[1]), databaseMs: Number(durations[2]) })
}

test('Edge permits the invitation origin and answers preflight without database access', async () => {
  const { call, requests } = setup()
  const response = await call({}, { method: 'OPTIONS' })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  assert.match(response.headers.get('access-control-allow-methods'), /POST/)
  assert.equal(requests.length, 0)
})

test('Edge rejects a foreign origin before database access', async () => {
  const { call, requests } = setup()
  const response = await call(lookup, { headers: { Origin: 'https://untrusted.invalid' } })
  assert.equal(response.status, 403)
  assert.notEqual(response.headers.get('access-control-allow-origin'), 'https://untrusted.invalid')
  assert.match((await response.json()).error, /Origem não permitida/)
  assert.equal(requests.length, 0)
})

test('Edge rejects an incorrect application key without touching the database', async () => {
  const { call, requests } = setup()
  const response = await call({ ...lookup, appKey: 'wrong-key' })
  assert.equal(response.status, 401)
  assert.match((await response.json()).error, /Chave de aplicação inválida/)
  assert.equal(requests.length, 0)
})

test('Edge keeps support for the previous apikey header transport', async () => {
  const { call, requests } = setup(async () => json({ notFound: true, http_status: 200 }))
  const response = await call({ ...lookup, appKey: undefined }, { headers: { apikey: publicKey, 'Content-Type': 'application/json' } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { notFound: true })
  assert.equal(requests.length, 1)
})

test('Edge only accepts POST for operations', async () => {
  const { call, requests } = setup()
  const response = await call({}, { method: 'GET' })
  assert.equal(response.status, 405)
  assert.equal(requests.length, 0)
})

for (const raw of ['not JSON', 'null', '[]']) {
  test(`Edge rejects invalid JSON request shape ${raw}`, async () => {
    const { call, requests } = setup()
    assert.equal((await call({}, { raw })).status, 400)
    assert.equal(requests.length, 0)
  })
}

const invalidInputs = [
  ['unknown action', { ...lookup, action: 'dump-guests' }],
  ['short name', { ...lookup, name: 'ab' }],
  ['missing name', { ...lookup, name: undefined }],
  ['oversized name', { ...lookup, name: 'A'.repeat(181) }],
  ['invalid last four digits', { ...lookup, last4: '1a34' }],
  ['incomplete last four digits', { ...lookup, last4: '123' }],
  ['invalid token', { ...answer, token: 'invalid' }],
  ['invalid answer status', { ...answer, status: 'pending' }],
  ['oversized message', { ...answer, message: 'A'.repeat(501) }],
  ['invalid message type', { ...answer, message: { invalid: true } }],
]
for (const [label, body] of invalidInputs) {
  test(`Edge validates ${label} before database access`, async () => {
    const { call, requests } = setup()
    const response = await call(body)
    assert.equal(response.status, 400)
    assert.equal(typeof (await response.json()).error, 'string')
    assert.equal(requests.length, 0)
  })
}

test('Edge lookup issues exactly one RPC and returns only guest identity and a session token', async () => {
  const guest = { id: 'synthetic-guest', full_name: lookup.name, status: 'pending' }
  const { call, requests, logs, timeoutCalls } = setup(async () => json({ guest, http_status: 200 }))
  const response = await call({ ...lookup, keyword: '  FIXTURE-PHRASE  ' }, { headers: { 'cf-connecting-ip': '192.0.2.1' } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  assert.match(response.headers.get('server-timing'), /app;dur=/)
  const result = await response.json()
  assert.deepEqual(Object.keys(result).sort(), ['guest', 'token'])
  assert.deepEqual(result.guest, guest)
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(requests.length, 1)
  const [url, options] = requests[0]
  assert.equal(url, 'https://example.invalid/rest/v1/rpc/rsvp_request')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers.Authorization, `Bearer ${serviceKey}`)
  const payload = JSON.parse(options.body)
  assert.equal(payload.p_action, 'lookup')
  assert.equal(payload.p_keyword_hash, sha256('fixture-phrase'))
  assert.equal(payload.p_fingerprint, sha256(`192.0.2.1|${serviceKey}`))
  assert.deepEqual(payload.p_payload, { name: lookup.name, last4: '', token_hash: sha256(result.token) })
  assert.deepEqual(timeoutCalls, [8000])
  assert.ok(options.signal instanceof AbortSignal)
  assertTelemetry(response, logs, 'lookup', 200)
  assertPrivateLogs(logs, [result.token])
})

for (const payload of [{ notFound: true }, { ambiguous: true }]) {
  test(`Edge forwards ${Object.keys(payload)[0]} without leaking a session token`, async () => {
    const { call, requests, logs } = setup(async () => json({ ...payload, http_status: 200 }))
    const response = await call(lookup)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), payload)
    assert.equal(requests.length, 1)
    assertPrivateLogs(logs)
  })
}

const ruleErrors = [
  [429, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.'],
  [403, 'A palavra-chave não confere.'],
  [400, 'Digite a palavra-chave informada no convite.'],
]
for (const [status, error] of ruleErrors) {
  test(`Edge preserves database validation status ${status}: ${error}`, async () => {
    const { call, requests, logs } = setup(async () => json({ http_status: status, error }))
    const response = await call({ ...lookup, keyword: status === 400 ? '' : lookup.keyword })
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error })
    assert.equal(requests.length, 1)
    if (status === 400) assert.equal(JSON.parse(requests[0][1].body).p_keyword_hash, '')
    assertPrivateLogs(logs)
  })
}

test('Edge answer performs one write RPC without replaying it', async () => {
  const { call, requests, logs } = setup(async () => json({ ok: true, http_status: 200 }))
  const response = await call(answer)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(requests.length, 1)
  assertTelemetry(response, logs, 'answer', 200)
  assert.deepEqual(JSON.parse(requests[0][1].body).p_payload, { token_hash: sha256(answer.token), status: 'confirmed', message: null })
  assertPrivateLogs(logs)
})

test('Edge forwards an expired answer session without retrying the write', async () => {
  const error = 'Sua sessão expirou. Busque seu nome novamente.'
  const { call, requests } = setup(async () => json({ error, http_status: 400 }))
  const response = await call(answer)
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error })
  assert.equal(requests.length, 1)
})

test('Edge does not return database details or service keys on an upstream HTTP failure', async () => {
  const internal = `internal diagnostic ${serviceKey} ${lookup.name}`
  const { call, requests, logs } = setup(async () => json({ error: internal }, 500))
  const response = await call(lookup)
  assert.equal(response.status, 503)
  const result = await response.json()
  assert.equal(typeof result.error, 'string')
  assert.ok(!JSON.stringify(result).includes(serviceKey))
  assert.ok(!JSON.stringify(result).includes(lookup.name))
  assert.equal(requests.length, 1)
  assertTelemetry(response, logs, 'lookup', 503)
  assertPrivateLogs(logs)
})

test('Edge returns a sanitized 503 on a network failure and never replays an answer', async () => {
  const { call, requests, logs } = setup(async () => { throw new Error(`Network problem ${serviceKey} ${answer.token}`) })
  const response = await call(answer)
  assert.equal(response.status, 503)
  const body = await response.text()
  assert.ok(!body.includes(serviceKey))
  assert.ok(!body.includes(answer.token))
  assert.match(body, /Busque seu nome novamente para conferir se a resposta foi registrada/)
  assert.equal(requests.length, 1)
  assertTelemetry(response, logs, 'answer', 503)
  assertPrivateLogs(logs)
})

test('Edge bounds a hanging database fetch with an 8000 ms signal and a sanitized 503', { timeout: 2000 }, async () => {
  const deadline = new AbortController()
  let notifyFetch
  const fetchStarted = new Promise(resolve => { notifyFetch = resolve })
  const { call, requests, logs, timeoutCalls } = setup(async (_url, options) => {
    notifyFetch()
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  }, { timeoutSignal: () => deadline.signal })
  const pending = call(answer)
  await fetchStarted
  // Trigger the real signal path immediately instead of waiting eight seconds.
  deadline.abort(new DOMException('Synthetic upstream deadline', 'TimeoutError'))
  const response = await pending
  assert.equal(response.status, 503)
  assert.deepEqual(timeoutCalls, [8000])
  assert.equal(requests.length, 1, 'Timed out writes must not be automatically replayed')
  assert.equal(requests[0][1].signal.aborted, true)
  assert.ok(!(await response.text()).includes('Synthetic upstream deadline'))
  assertTelemetry(response, logs, 'answer', 503)
  assertPrivateLogs(logs)
})

test('Edge database deadline also covers a response body that stalls', { timeout: 2000 }, async () => {
  const deadline = new AbortController()
  let notifyBody
  const bodyStarted = new Promise(resolve => { notifyBody = resolve })
  const { call, requests, logs, timeoutCalls } = setup(async (_url, options) => ({
    ok: true,
    json: () => {
      notifyBody()
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
    },
  }), { timeoutSignal: () => deadline.signal })
  const pending = call(lookup)
  await bodyStarted
  deadline.abort(new DOMException('Synthetic body deadline', 'TimeoutError'))
  const response = await pending
  assert.equal(response.status, 503)
  assert.deepEqual(timeoutCalls, [8000])
  assert.equal(requests.length, 1)
  assertTelemetry(response, logs, 'lookup', 503)
  assertPrivateLogs(logs)
})

test('RSVP timeout changes leave activation rate-limit transport unchanged', async () => {
  const { call, requests, timeoutCalls } = setup(async () => json(true))
  const response = await call({ action: 'activate', code: 'invalid', email: 'synthetic@example.invalid', password: 'fixture-password' })
  assert.equal(response.status, 400)
  assert.equal(requests.length, 1)
  assert.equal(requests[0][0], 'https://example.invalid/rest/v1/rpc/rsvp_rate_limit')
  assert.equal(requests[0][1].signal, undefined)
  assert.deepEqual(timeoutCalls, [])
})
