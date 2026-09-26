/**
 * 04 — `finish` chunk without `reason`: is `chunk.reason.kind` at 12cd607 a real
 *      hazard on the flash-judgment path? (PR #10, src hunk 1.)
 *
 * `callFlashOnce` (src/index.mjs:1150) reads `chunk.reason.kind` unguarded. DSH's
 * `finish` chunk declares `reason` as optional, so a provider that omits it makes
 * the judgment fail with `TypeError: Cannot read properties of undefined
 * (reading 'kind')` — not a timeout — and `callFlash` rethrows any error that is
 * not `UNSUPPORTED_REASONING_EFFORT`, so `withRetry` exhausts both attempts and
 * the gate fail-safes to manual approval.
 *
 * The plugin is driven with a mock ctx whose `llm.stream` yields
 * `{type:'finish'}` with **no** `reason`, straight into the flash layer
 * (`danger-full-access`, so the default `workspace-write` allow rule cannot match).
 *
 * Expected on 12cd607: FAIL (verdict path = `flash-failed`, outcome = manual).
 * After PR #10's guard: PASS (`flash-safe`, auto-allowed).
 *
 * Run: node test/session-api/04-flash-finish-no-reason.mjs
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { initHome, makeChecks, makeMockCtx, WORKTREE } from './_harness.mjs'

const home = initHome('04')

/** A `finish` chunk with no `reason` field — the shape PR #10 reports. */
async function* streamFinishWithoutReason() {
  yield { type: 'text-delta', text: 'SAFE' }
  yield { type: 'finish' }
}

const plugin = (await import(pathToFileURL(join(WORKTREE, 'src', 'index.mjs')).href)).default

const checks = makeChecks()
const DATA_DIR = join(home, 'auto-approve')

const llmCalls = []
const mock = makeMockCtx({ llmCalls })
// Replace the throwing stub with the real-shaped stream.
mock.ctx.llm.stream = (...args) => {
  llmCalls.push(args)
  return streamFinishWithoutReason()
}
plugin.apply(mock.ctx)

const REASON = 'escalate sandbox to danger-full-access: read the external log file'
let nextCalled = false
const outcome = await mock.fire(
  { agent: { session: { id: 'sess_flash_04', header: { cwd: WORKTREE } } }, toolName: 'read', reason: REASON, callId: 'call_04' },
  async () => { nextCalled = true; return 'rejected' },
)

console.log(`llm.stream calls = ${llmCalls.length}`)
console.log(`outcome          = ${JSON.stringify(outcome)}\n`)

checks.check('the flash layer was actually reached', llmCalls.length > 0, 'llm.stream was never called')
checks.check(
  'judgment survived a `finish` chunk with no `reason`',
  outcome === 'allowed-once',
  `outcome = ${JSON.stringify(outcome)} — the gate fell through to manual instead of auto-allowing`,
)
checks.check('gate did not fall through to next()', !nextCalled, 'next() was called')

const audit = (() => { try { return readFileSync(join(DATA_DIR, 'audit.log'), 'utf8') } catch { return '' } })()
const events = (() => {
  try {
    return readFileSync(join(DATA_DIR, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch { return [] }
})()

checks.check(
  'audit.log shows a flash-safe ALLOW, not a flash failure',
  /ALLOW\s+read .*flash-safe/.test(audit),
  `audit.log =\n${audit.trim() || '(empty)'}`,
)
checks.check(
  'no flash-failed fail-safe was recorded',
  !events.some((e) => e.path === 'flash-failed'),
  `events paths = ${JSON.stringify(events.map((e) => e.path))}`,
)

checks.summary()
