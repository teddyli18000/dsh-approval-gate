/**
 * 02 — Why `permissionPresets.current()` needs the Session, not `session.events`.
 *
 * `PermissionPresetService.current(session)` delegates to
 * `permissionState(session)` → `ctx.sessionProjections.stateOf(session, 'permissions')`
 * (`dsh-permission-presets/lib/index.js:291,277,278`). The projection reads
 * `session.header`, so handing it the event array crashes inside `cellFor()`.
 *
 * This test drives the REAL `SessionProjectionRegistry` (no plugin code) to prove:
 *   - `stateOf(session, 'permissions')`            → works
 *   - `stateOf(session.events, 'permissions')`     → TypeError reading 'header'
 *
 * Run: node test/session-api/02-projection-crash.mjs
 */

import { initHome, importReal, makeChecks, pkgVersion, resolveScope } from './_harness.mjs'

initHome('02')

const scope = resolveScope(['dsh-session', 'dsh-session-projection', 'cordis'])
console.log(`dsh-session            ${pkgVersion(scope, 'dsh-session')}`)
console.log(`dsh-session-projection ${pkgVersion(scope, 'dsh-session-projection')}\n`)

const { Session, SessionId } = await importReal(scope, 'dsh-session/lib/index.js')
const { SessionProjectionRegistry } = await importReal(scope, 'dsh-session-projection/lib/index.js')
const { Context } = await importReal(scope, 'cordis/lib/index.js')

const checks = makeChecks()
const CWD = 'C:/Users/Teddy/Desktop/dshhhh/_gh/wt/session/test/session-api/.tmp/02/ws'
const SID = 'sess_projection_02'

const session = Session.create(SessionId(SID), [], {
  version: 4, id: SID, createdAt: Date.now(), isSeeded: false, cwd: CWD,
})

const ctx = new Context()
const registry = new SessionProjectionRegistry(ctx)
// A stand-in for the `permissions` unit that dsh-permission-presets registers.
registry.register({
  key: 'permissions',
  stateVersion: 0,
  init: () => ({ preset: null, sandbox: null, approval: null, seeded: false }),
  apply: (state) => state,
})

console.log('— crash path: event array handed to the projection (pre-fix behaviour) —')
try {
  registry.stateOf(session.events, 'permissions')
  checks.check("stateOf(session.events) throws", false, 'it did NOT throw')
} catch (error) {
  checks.check(
    "stateOf(session.events) throws TypeError reading 'header'",
    error instanceof TypeError && /reading 'header'/.test(error.message),
    `${error.name}: ${error.message}`,
  )
  const frame = String(error.stack || '').split('\n').find((l) => l.includes('cellFor'))
  checks.check('crash frame is inside cellFor()', Boolean(frame), 'no cellFor frame in stack')
  if (frame) console.log(`      ${frame.trim()}`)
}

console.log('\n— correct path: the Session itself (post-fix behaviour) —')
try {
  const state = registry.stateOf(session, 'permissions')
  checks.check('stateOf(session, "permissions") returns the folded state', state?.preset === null, JSON.stringify(state))
} catch (error) {
  checks.check('stateOf(session) must not throw', false, error.message)
}

checks.summary()
