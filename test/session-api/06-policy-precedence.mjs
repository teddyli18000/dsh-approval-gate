/** User rejections must beat the default workspace-write allow rule and model output. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { initHome, makeChecks, makeMockCtx, WORKTREE } from './_harness.mjs'

const home = initHome('06')
const dataDir = join(home, 'auto-approve')
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'allowlist.json'), JSON.stringify({
  version: 3,
  allowRules: [{ mode: 'workspace-write', description: 'default workspace rule' }],
  denyRules: [{ tool: 'read', mode: 'workspace-write', category: 'neutral', contains: 'notes/report.txt' }],
  learning: { enabled: false },
}))

const plugin = (await import(pathToFileURL(join(WORKTREE, 'src', 'index.mjs')).href)).default
const checks = makeChecks()
const llmCalls = []
const mock = makeMockCtx({ llmCalls })
plugin.apply(mock.ctx)
const session = { id: 'policy_06', header: { cwd: WORKTREE } }

let humanCalls = 0
const denied = await mock.fire(
  { agent: { session }, toolName: 'read', reason: 'escalate sandbox to workspace-write: inspect notes/report.txt' },
  async () => { humanCalls++; return 'rejected' },
)
checks.check('rejected operation reaches the human despite the default allow rule', denied === 'rejected' && humanCalls === 1)
checks.check('rejected operation never calls the model', llmCalls.length === 0)

const allowed = await mock.fire(
  { agent: { session }, toolName: 'read', reason: 'escalate sandbox to workspace-write: inspect notes/other.txt' },
  async () => { humanCalls++; return 'rejected' },
)
checks.check('unrelated workspace operation still uses the allow rule', allowed === 'allowed-once' && humanCalls === 1)

const brokenPreset = makeMockCtx({ llmCalls })
brokenPreset.ctx.permissionPresets.current = () => { throw new Error('projection unavailable') }
plugin.apply(brokenPreset.ctx)
const fallback = await brokenPreset.fire(
  { agent: { session }, toolName: 'read', reason: 'escalate sandbox to workspace-write: inspect notes/fallback.txt' },
  async () => 'rejected',
)
const audit = readFileSync(join(dataDir, 'audit.log'), 'utf8')
checks.check('preset lookup failure reaches the human and leaves an audit record',
  fallback === 'rejected' && /FAILED\s+preset lookup read.*projection unavailable/.test(audit))

checks.summary()
