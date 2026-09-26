import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the actual transport module with a synthetic Vite environment and
// mocked fetch. These tests never read .env or contact any server.
const source = await readFile(new URL('../src/publicApi.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source.replaceAll('import.meta.env', '__TEST_ENV__'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function setup({ env = {}, fetch = async () => { throw new Error('Unexpected fetch') }, online = true } = {}) {
  const requests = []
  const timers = new Set()
  const sandbox = {
    exports: {},
    __TEST_ENV__: { VITE_SUPABASE_URL: 'https://example.invalid/', VITE_SUPABASE_ANON_KEY: 'test-public-key', ...env },
    AbortController,
    navigator: { onLine: online },
    window: {
      setTimeout(callback, ms) {
        const timer = setTimeout(() => { timers.delete(timer); callback() }, ms)
        timers.add(timer)
        return timer
      },
      clearTimeout(timer) { timers.delete(timer); clearTimeout(timer) },
    },
    fetch: async (...args) => { requests.push(args); return fetch(...args) },
  }
  vm.runInNewContext(compiled, sandbox, { filename: 'publicApi.compiled.js' })
  return { publicPost: sandbox.exports.publicPost, requests, timers }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const path = 'functions/v1/public-rsvp'

test('successful lookup uses one POST with no guest data in the URL', async () => {
  const payload = { guest: { id: 'fixture-id', full_name: 'Pessoa de Exemplo', status: 'pending' }, token: 'fixture-token' }
  const { publicPost, requests, timers } = setup({ fetch: async () => json(payload) })
  assert.deepEqual(await publicPost(path, { action: 'lookup', name: 'Pessoa de Exemplo', keyword: 'fixture-phrase' }), payload)
  assert.equal(requests.length, 1)
  const [url, options] = requests[0]
  assert.equal(url, 'https://example.invalid/functions/v1/public-rsvp')
  assert.equal(options.method, 'POST')
  assert.equal(options.credentials, 'omit')
  assert.equal(options.cache, 'no-store')
  assert.equal(options.headers['Content-Type'], 'text/plain;charset=UTF-8')
  assert.deepEqual(JSON.parse(options.body), { action: 'lookup', name: 'Pessoa de Exemplo', keyword: 'fixture-phrase', appKey: 'test-public-key' })
  assert.equal(timers.size, 0)
})

for (const payload of [{ notFound: true }, { ambiguous: true }, { ok: true }]) {
  test(`passes ${Object.keys(payload)[0]} without retrying or changing its meaning`, async () => {
    const { publicPost, requests } = setup({ fetch: async () => json(payload) })
    assert.deepEqual(await publicPost(path, { action: 'lookup' }), payload)
    assert.equal(requests.length, 1)
  })
}

test('settings RPC retains its required API key header', async () => {
  const { publicPost, requests } = setup({ fetch: async () => json({ couple_names: 'Example' }) })
  await publicPost('rest/v1/rpc/get_public_wedding', {})
  assert.equal(requests[0][1].headers.apikey, 'test-public-key')
  assert.equal(requests[0][1].headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(requests[0][1].body), {})
})

for (const field of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
  test(`missing ${field} fails before making a request`, async () => {
    const { publicPost, requests, timers } = setup({ env: { [field]: '' } })
    await assert.rejects(publicPost(path, {}), /conexão do site está indisponível/)
    assert.equal(requests.length, 0)
    assert.equal(timers.size, 0)
  })
}

test('server errors retain actionable text and are not retried', async () => {
  const { publicPost, requests, timers } = setup({ fetch: async () => json({ error: 'A palavra-chave não confere.' }, 403) })
  await assert.rejects(publicPost(path, {}), /A palavra-chave não confere/)
  assert.equal(requests.length, 1)
  assert.equal(timers.size, 0)
})

test('rate limiting returns a specific message when no server error is provided', async () => {
  const { publicPost } = setup({ fetch: async () => json({}, 429) })
  await assert.rejects(publicPost(path, {}), /muitas tentativas/)
})

test('invalid response JSON is handled without leaving a running timeout', async () => {
  const { publicPost, timers } = setup({ fetch: async () => new Response('not json') })
  await assert.rejects(publicPost(path, {}), /ler a resposta/)
  assert.equal(timers.size, 0)
})

test('unexpected array response is rejected', async () => {
  const { publicPost } = setup({ fetch: async () => json([]) })
  await assert.rejects(publicPost(path, {}), /resposta inválida/)
})

test('offline network errors return a connection message', async () => {
  const { publicPost, timers } = setup({ online: false })
  await assert.rejects(publicPost(path, {}), /sem conexão/)
  assert.equal(timers.size, 0)
})

test('already aborted calls do not start a fetch', async () => {
  const controller = new AbortController()
  controller.abort()
  const { publicPost, requests, timers } = setup()
  await assert.rejects(publicPost(path, {}, { signal: controller.signal }), error => error.name === 'AbortError')
  assert.equal(requests.length, 0)
  assert.equal(timers.size, 0)
})

test('abort during fetch releases the caller and aborts the network request', async () => {
  const controller = new AbortController()
  const { publicPost, requests, timers } = setup({ fetch: () => new Promise(() => {}) })
  const request = publicPost(path, {}, { signal: controller.signal })
  controller.abort()
  await assert.rejects(request, error => error.name === 'AbortError')
  assert.equal(requests[0][1].signal.aborted, true)
  assert.equal(timers.size, 0)
})

test('timeout releases the caller even if fetch never settles', async () => {
  const { publicPost, requests, timers } = setup({ fetch: () => new Promise(() => {}) })
  await assert.rejects(publicPost(path, {}, { timeoutMs: 10, timeoutMessage: 'Test deadline reached' }), /Test deadline reached/)
  assert.equal(requests[0][1].signal.aborted, true)
  assert.equal(timers.size, 0)
})

test('timeout also covers a response body that never finishes', async () => {
  const { publicPost, requests, timers } = setup({ fetch: async () => ({ ok: true, json: () => new Promise(() => {}) }) })
  await assert.rejects(publicPost(path, {}, { timeoutMs: 10, timeoutMessage: 'Body deadline reached' }), /Body deadline reached/)
  assert.equal(requests[0][1].signal.aborted, true)
  assert.equal(timers.size, 0)
})
