/**
 * 01 — Session API surface contract, measured against the REAL installed DSH.
 *
 * Root question this settles (PRs #1 / #7 / #16 / #18 disagree about it):
 * does `@deepseek-ai/dsh-session`'s `Session` expose `.events` and `.cwd`, or only
 * `snapshotEvents()` and `header.cwd`?
 *
 * Run: node test/session-api/01-session-surface.mjs
 * Exit code 0 = the plugin's current `session.events` / `session.cwd` reads are SAFE
 *               on this DSH build; non-zero = they read `undefined`.
 */

import { existsSync } from 'node:fs'
import { initHome, importReal, makeChecks, pkgVersion, resolveScope } from './_harness.mjs'

initHome('01') // must precede any plugin import

const scope = resolveScope(['dsh-session'])
const sessionVersion = pkgVersion(scope, 'dsh-session')
console.log(`@deepseek-ai scope : ${scope}`)
console.log(`dsh-session version: ${sessionVersion}\n`)

const { Session, SessionId } = await importReal(scope, 'dsh-session/lib/index.js')

const checks = makeChecks()
const CWD = 'C:/Users/Teddy/Desktop/dshhhh/_gh/wt/session/test/session-api/.tmp/01/ws'
const SID = 'sess_surface_01'
const HEADER = { version: 4, id: SID, createdAt: Date.now(), isSeeded: false, cwd: CWD }

// A real event log entry, so `snapshotEvents()` has something meaningful to return.
const SEED = [{
  seq: 0,
  time: Date.now(),
  type: 'tool/call',
  data: {
    callId: 'call_surface_01',
    toolName: 'str-replace-editor',
    arguments: JSON.stringify({ file_path: `${CWD}/TARGET_A.txt` }),
  },
}]

let session
try {
  session = Session.create(SessionId(SID), SEED, HEADER)
  console.log('constructed real Session with a tool/call seed event\n')
} catch (error) {
  console.error(`FAIL  Session.create threw: ${error.message}`)
  process.exit(1)
}

// ── The contract the plugin actually depends on ──────────────────────────────
console.log(`instance own keys = ${Object.keys(session).sort().join(', ')}`)

checks.check(
  '`session.snapshotEvents` is a function (the modern event-accessor)',
  typeof session.snapshotEvents === 'function',
  `typeof = ${typeof session.snapshotEvents}`,
)
checks.check(
  '`session.snapshotEvents()` returns the tool/call event',
  Array.isArray(session.snapshotEvents()) &&
    session.snapshotEvents().some((e) => e.type === 'tool/call' && e.data.callId === 'call_surface_01'),
  'snapshotEvents() did not surface the seeded tool/call event',
)
checks.check(
  '`session.header.cwd` is the session working directory',
  session.header?.cwd === CWD,
  `header.cwd = ${JSON.stringify(session.header?.cwd)}`,
)
checks.check('`session.id` is present', session.id === SID, `id = ${JSON.stringify(session.id)}`)
checks.check('`session.seq` is a number', typeof session.seq === 'number', `seq = ${session.seq}`)

// ── The two reads the plugin still performs at 12cd607 ───────────────────────
const eventsUndefined = session.events === undefined
checks.check(
  '`session.events` is undefined  →  resolveToolCallFiles(req.callId, session.events) gets undefined',
  eventsUndefined,
  `session.events = ${JSON.stringify(session.events)} (this DSH build DOES expose .events)`,
)

const cwdUndefined = session.cwd === undefined
checks.check(
  '`session.cwd` is undefined  →  `typeof session.cwd === "string"` guard yields baseDir = ""',
  cwdUndefined,
  `session.cwd = ${JSON.stringify(session.cwd)} (this DSH build DOES expose .cwd)`,
)

// ── Report-only: how the OLD (npx-cached) surface differed ───────────────────
const oldScope = [
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/npm-cache/_npx` : null,
].filter(Boolean)[0]
let oldNote = 'not probed'
if (oldScope && existsSync(oldScope)) {
  oldNote = 'see REPORT.md — legacy 0.1.0-rc.6 exposes .events and no snapshotEvents()'
}
console.log(`\nlegacy-surface note: ${oldNote}`)

checks.summary()
