// Bundles the MCP server and the SDK into single files with no install step, and copies the
// server into the site so it can be downloaded from larry.exchange/agent/larry-mcp.mjs.
import fs from 'node:fs'
import { build } from '../node_modules/esbuild/lib/main.js'

const require = 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'
const common = { bundle: true, minify: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning', legalComments: 'none' }
await build({ ...common, entryPoints: ['src/mcp.ts'], outfile: 'dist/larry-mcp.mjs', banner: { js: `#!/usr/bin/env node\n${require}` } })
await build({ ...common, entryPoints: ['src/larry.ts'], outfile: 'dist/larry-sdk.mjs', banner: { js: require } })
fs.chmodSync('dist/larry-mcp.mjs', 0o755)
fs.mkdirSync('../public/agent', { recursive: true })
for (const f of ['larry-mcp.mjs', 'larry-sdk.mjs']) fs.copyFileSync(`dist/${f}`, `../public/agent/${f}`)

// One line install: `npx -y https://larry.exchange/agent/larry-mcp.tgz` runs the server from this package.
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'larry-pack-'))
fs.copyFileSync('dist/larry-mcp.mjs', path.join(pkg, 'larry-mcp.mjs'))
fs.chmodSync(path.join(pkg, 'larry-mcp.mjs'), 0o755)
fs.writeFileSync(
  path.join(pkg, 'package.json'),
  JSON.stringify({ name: 'larry-mcp', version: JSON.parse(fs.readFileSync('package.json', 'utf8')).version, description: 'Larry MCP server: AI agents trade, hold, pay and burn on Larry (Robinhood Chain)', type: 'module', bin: { 'larry-mcp': 'larry-mcp.mjs' }, engines: { node: '>=20' }, license: 'MIT' }, null, 2),
)
const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', path.resolve('dist')], { cwd: pkg }).toString().trim().split('\n').pop()
fs.copyFileSync(path.join('dist', tgz), '../public/agent/larry-mcp.tgz')
fs.rmSync(pkg, { recursive: true })
console.log('built dist/larry-mcp.mjs, dist/larry-sdk.mjs and larry-mcp.tgz, copied to public/agent/')
