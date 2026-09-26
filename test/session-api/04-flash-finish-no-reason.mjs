/**
 * 04 — A nonconforming `finish` chunk must fail closed on the flash path.
 *
 * DSH's StreamChunk contract requires `finish.reason`. If an adapter omits it
 * after emitting SAFE, the gate must retry, then hand approval to a human and
 * record a useful error instead of treating the incomplete stream as SAFE.
 *
 * The plugin is driven with a mock ctx whose `llm.stream` yields
 * `{type:'finish'}` with **no** `reason`, straight into the flash layer
 * (`danger-full-access`, so the default `workspace-write` allow rule cannot match).
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
  'missing finish.reason is retried, then handed to a human',
  llmCalls.length === 2 && outcome === 'rejected',
  `calls = ${llmCalls.length}, outcome = ${JSON.stringify(outcome)}`,
)
checks.check('the human approval handler was called', nextCalled, 'next() was not called')

const audit = (() => { try { return readFileSync(join(DATA_DIR, 'audit.log'), 'utf8') } catch { return '' } })()
const events = (() => {
  try {
    return readFileSync(join(DATA_DIR, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch { return [] }
})()

checks.check(
  'audit.log records the adapter contract failure',
  /FAILED\s+read .*finish\.reason 缺失/.test(audit),
  `audit.log =\n${audit.trim() || '(empty)'}`,
)
checks.check(
  'manual events carry the failure reason and no auto approval is recorded',
  events.length >= 2 && events.every((e) => e.path === 'flash-failed' && /finish\.reason 缺失/.test(e.judgeError || '')),
  `events = ${JSON.stringify(events)}`,
)

checks.summary()
