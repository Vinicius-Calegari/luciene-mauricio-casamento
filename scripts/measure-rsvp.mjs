import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// RSVP lookup measurements; creates short-lived lookup sessions, but never
// submits attendance or messages. Keep batches small to respect rate limits.
const configPath = process.argv[2]
const outputPath = process.argv[3]
if (!configPath || !outputPath) throw new Error('Usage: node --env-file=.env.local scripts/measure-rsvp.mjs PRIVATE_CONFIG OUTPUT_JSON')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const base = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
if (!base || !key || typeof config.name !== 'string' || !config.name.trim()
  || typeof config.keyword !== 'string' || !config.keyword.trim()) throw new Error('Missing public connection settings or private lookup inputs.')
const sampleCount = config.samples ?? 3
if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 5) throw new Error('Use between 1 and 5 samples per batch.')
const directory = path.resolve('private')
fs.mkdirSync(directory, { recursive: true })
const input = path.join(directory, `rsvp-measure-input-${process.pid}.json`)
const output = path.join(directory, `rsvp-measure-output-${process.pid}.json`)
const headers = path.join(directory, `rsvp-measure-headers-${process.pid}.txt`)
const samples = []
fs.writeFileSync(input, JSON.stringify({ action: 'lookup', name: config.name, keyword: config.keyword, last4: '', appKey: key }))
try {
  for (let i = 0; i < sampleCount; i++) {
    const raw = execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', [
      '--silent', '--show-error', '--max-time', '20', '--request', 'POST',
      '--header', 'Content-Type: text/plain;charset=UTF-8',
      '--header', 'Origin: https://vinicius-calegari.github.io',
      '--data-binary', `@${input}`, '--output', output, '--dump-header', headers,
      '--write-out', '%{json}', `${base}/functions/v1/public-rsvp`,
    ], { encoding: 'utf8', timeout: 22000 })
    const timing = JSON.parse(raw)
    const body = JSON.parse(fs.readFileSync(output, 'utf8'))
    const responseHeaders = fs.readFileSync(headers, 'utf8')
    const server = /server-timing:\s*app;dur=([\d.]+)/i.exec(responseHeaders)
    const database = /\bdb;dur=([\d.]+)/i.exec(responseHeaders)
    const sample = {
      status: timing.http_code, found: Boolean(body.guest),
      dnsMs: +(timing.time_namelookup * 1000).toFixed(1),
      tcpMs: +((timing.time_connect - timing.time_namelookup) * 1000).toFixed(1),
      tlsMs: +((timing.time_appconnect - timing.time_connect) * 1000).toFixed(1),
      firstByteMs: +(timing.time_starttransfer * 1000).toFixed(1),
      totalMs: +(timing.time_total * 1000).toFixed(1),
      serverMs: server ? Number(server[1]) : null,
      databaseMs: database ? Number(database[1]) : null,
    }
    samples.push(sample)
    console.log(JSON.stringify(sample))
    if (sample.status !== 200 || !sample.found) process.exitCode = 1
  }
} finally {
  for (const file of [input, output, headers]) if (fs.existsSync(file)) fs.unlinkSync(file)
  fs.writeFileSync(outputPath, JSON.stringify({ measuredAt: new Date().toISOString(), samples }, null, 2))
}
