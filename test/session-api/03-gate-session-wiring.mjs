/**
 * 03 — End-to-end: does the plugin read the Session correctly at the call sites
 *      at 12cd607 (`session.events`, `session.cwd`)?
 *
 * The plugin is driven with a mock cordis ctx and a REAL `Session`
 * (`@deepseek-ai/dsh-session`, installed build). Two independent scenarios, each
 * entering through the deterministic whitelist layer so `flash`/`llm` is never
 * reached and the observable is exact:
 *
 *   A. `resolveToolCallFiles(req.callId, session.events)`  — B layer
 *      The session carries a real `tool/call` event whose `arguments` name the
 *      target file. The justification names no path at all, so the only way the
 *      path can reach `events.jsonl` is the structured B layer. On 12cd607
 *      `session.events` is `undefined` → `resolveToolCallFiles` returns `null` →
 *      `files` silently degrades to `extractFiles(justification)` = `[]`.
 *
 *   B. `session.cwd`                                       — baseDir
 *      The justification names a path relative to the session cwd. The snapshot
 *      can only resolve (and record `cwd`) if `sessionCwd === session.header.cwd`.
 *      On 12cd607 `session.cwd` is `undefined` → baseDir `''` → the relative path
 *      resolves against `process.cwd()` and finds nothing → no snapshot.
 *
 * Expected on 12cd607: both scenarios FAIL. After PR #1's hunks: both PASS.
 *
 * Run: node test/session-api/03-gate-session-wiring.mjs
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { initHome, importReal, makeChecks, makeMockCtx, resolveScope, WORKTREE } from './_harness.mjs'

const home = initHome('03')
const scope = resolveScope(['dsh-session'])
const { Session, SessionId } = await importReal(scope, 'dsh-session/lib/index.js')

// Redirect DSH_HOME *before* importing the plugin (it reads it at module load).
const plugin = (await import(pathToFileURL(join(WORKTREE, 'src', 'index.mjs')).href)).default

const checks = makeChecks()
const DATA_DIR = join(home, 'auto-approve')

// ── Fixtures ────────────────────────────────────────────────────────────────
const WS = join(WORKTREE, 'test', 'session-api', '.tmp', '03', 'ws')
// `resolveToolCallFiles` -> `addPath` rejects bare filenames (no path separator), so
// both fixtures use a directory-qualified relative path.
const REL_A = 'notedir-abs/TARGET_A.txt'
const REL_C = 'snapdir-rel/TARGET_C.txt'
const ABS_TARGET_A = join(WS, REL_A)
const ABS_TARGET_C = join(WS, REL_C)

rmSync(WS, { recursive: true, force: true })
mkdirSync(join(WS, 'notedir-abs'), { recursive: true })
mkdirSync(join(WS, 'snapdir-rel'), { recursive: true })
writeFileSync(ABS_TARGET_A, 'content of TARGET_A\n', 'utf8')
writeFileSync(ABS_TARGET_C, 'content of TARGET_C\n', 'utf8')

// Precondition for scenario B: the relative path must NOT resolve under the
// process cwd, otherwise the pre-fix build would pass by accident.
checks.check(
  'precondition: process.cwd() does not contain the relative fixture path',
  !existsSync(join(process.cwd(), REL_C)),
  `unexpectedly found ${join(process.cwd(), REL_C)}`,
)

const readEvents = () => {
  try {
    return readFileSync(join(DATA_DIR, 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch { return [] }
}
const readSnapshots = (id) => {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, 'snapshots', `${id}.json`), 'utf8'))
  } catch { return null }
}
const resetSnapshots = () => rmSync(join(DATA_DIR, 'snapshots'), { recursive: true, force: true })

const REASON_A = 'escalate sandbox to workspace-write: persist the generated artifact'
const REASON_B = `escalate sandbox to workspace-write: update the notes under ${REL_C}`

// ── Scenario A: structured B-layer path via a real tool/call event ──────────
{
  console.log('\n─── Scenario A: resolveToolCallFiles(callId, session.events) ───')
  resetSnapshots()

  const SID = 'sess_wiring_A'
  const session = Session.create(SessionId(SID), [{
    seq: 0,
    time: Date.now(),
    type: 'tool/call',
    data: {
      callId: 'call_A',
      toolName: 'str-replace-editor',
      arguments: JSON.stringify({ file_path: REL_A }),
    },
  }], {
    version: 4, id: SID, createdAt: Date.now(), isSeeded: false, cwd: WS,
  })

  let presetArg
  const mock = makeMockCtx({ onPresetArg: (a) => { presetArg = a } })
  plugin.apply(mock.ctx)

  let nextCalled = false
  const outcome = await mock.fire(
    { agent: { session }, toolName: 'str-replace-editor', reason: REASON_A, callId: 'call_A' },
    async () => { nextCalled = true; return 'rejected' },
  )

  checks.check('gate took over (did not fall through to next())', !nextCalled, 'next() was called')
  checks.check('gate returned allowed-once', outcome === 'allowed-once', `outcome = ${JSON.stringify(outcome)}`)
  checks.check(
    'permissionPresets.current() received the Session object itself',
    presetArg === session,
    `received ${presetArg === undefined ? 'undefined' : typeof presetArg}`,
  )

  const ev = readEvents().at(-1)
  checks.check('an event was recorded', Boolean(ev), 'events.jsonl is empty')
  checks.check(
    'B layer: events.jsonl `files` carries the structured tool/call path, not a justification fallback',
    Array.isArray(ev?.files) && ev.files.includes(REL_A),
    `files = ${JSON.stringify(ev?.files)} (expected to include ${JSON.stringify(REL_A)})`,
  )
}

// ── Scenario B: baseDir from session.header.cwd ─────────────────────────────
{
  console.log('\n─── Scenario B: baseDir <- session.cwd / session.header.cwd ───')
  resetSnapshots()

  const SID = 'sess_wiring_B'
  const session = Session.create(SessionId(SID), [], {
    version: 4, id: SID, createdAt: Date.now(), isSeeded: false, cwd: WS,
  })

  const mock = makeMockCtx()
  plugin.apply(mock.ctx)

  const outcome = await mock.fire(
    { agent: { session }, toolName: 'str-replace-editor', reason: REASON_B, callId: 'call_B' },
    async () => 'rejected',
  )
  checks.check('gate returned allowed-once', outcome === 'allowed-once', `outcome = ${JSON.stringify(outcome)}`)

  const ev = readEvents().at(-1)
  checks.check(
    'C layer: the relative justification path was extracted',
    Array.isArray(ev?.files) && ev.files.includes(REL_C),
    `files = ${JSON.stringify(ev?.files)}`,
  )

  const snap = ev ? readSnapshots(ev.id) : null
  checks.check('a pre-change snapshot was written', Boolean(snap), 'no snapshots/<id>.json was produced')
  checks.check(
    'snapshot `cwd` is the session working directory (session.header.cwd)',
    snap?.cwd === WS,
    `cwd = ${JSON.stringify(snap?.cwd)} (expected ${JSON.stringify(WS)})`,
  )
  checks.check(
    'snapshot resolved the relative path against the session cwd',
    Array.isArray(snap?.snapshots) && snap.snapshots.some((s) => resolve(s.path) === resolve(ABS_TARGET_C)),
    `paths = ${JSON.stringify(snap?.snapshots?.map((s) => s.path))}`,
  )
}

checks.summary()
