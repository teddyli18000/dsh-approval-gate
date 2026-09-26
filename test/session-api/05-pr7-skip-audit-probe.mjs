/**
 * 05 — Cost probe for PR #7's `SKIP` audit line (evaluated for triage; NOT a
 *      regression guard for landed code).
 *
 * PR #7 adds, on the *common* path where a session is not pinned to
 * `auto-approve`:
 *
 *     if (preset !== PRESET_NAME) {
 *       audit(`SKIP    preset=${preset}（需 ${PRESET_NAME}）${toolName} ${reason.slice(0,120)}`)
 *       return next()
 *     }
 *
 * `audit()` (src/index.mjs:650) unconditionally appends to
 * `$DSH_HOME/auto-approve/audit.log`. This probe fires N approval requests for a
 * session whose preset is `workspace-write` against PR #7's `src/index.mjs` and
 * counts the lines that appear, to quantify the log growth.
 *
 * The PR #7 variant is read from `test/session-api/.tmp/variants/pr7-index.mjs`
 * (regenerate with:
 *   git -C <clone> show up/pr/7:src/index.mjs > test/session-api/.tmp/variants/pr7-index.mjs
 * ) or from `$PR7_VARIANT`. Exits 0 with a SKIP notice when it is unavailable.
 *
 * Run: node test/session-api/05-pr7-skip-audit-probe.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HERE, initHome, makeChecks, makeMockCtx } from './_harness.mjs'

const variant = process.env.PR7_VARIANT || join(HERE, '.tmp', 'variants', 'pr7-index.mjs')
if (!existsSync(variant)) {
  console.log(`SKIP  PR #7 variant not found at ${variant}`)
  console.log('      regenerate: git -C <clone> show up/pr/7:src/index.mjs > <that path>')
  process.exit(0)
}

const home = initHome('05')
const plugin = (await import(pathToFileURL(variant).href)).default

const checks = makeChecks()
const AUDIT = join(home, 'auto-approve', 'audit.log')
const readAuditLines = () => {
  try { return readFileSync(AUDIT, 'utf8').split('\n').filter(Boolean).length } catch { return 0 }
}

const mock = makeMockCtx({ presetResult: 'workspace-write' }) // the default, non-auto-approve case
plugin.apply(mock.ctx)

const N = 5
const before = readAuditLines()
for (let i = 0; i < N; i += 1) {
  await mock.fire(
    {
      agent: { session: { id: 'sess_pr7', header: { cwd: process.cwd() } } },
      toolName: 'read',
      reason: `escalate sandbox to workspace-write: read file ${i}`,
      callId: `call_pr7_${i}`,
    },
    async () => 'rejected',
  )
}
const after = readAuditLines()

console.log(`approval requests fired (preset=workspace-write): ${N}`)
console.log(`audit.log lines before/after: ${before}/${after}`)
console.log('sample:\n' + readFileSync(AUDIT, 'utf8').split('\n').slice(0, 3).map((l) => '  ' + l).join('\n'))

checks.check('PR #7 writes one SKIP audit line per non-auto-approve approval request', after - before === N,
  `delta = ${after - before} for ${N} requests`)
checks.check('each SKIP line echoes the raw reason (session content leaks into an unbounded log)', true,
  'informational')

checks.summary()
