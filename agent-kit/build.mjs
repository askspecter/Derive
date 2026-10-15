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
console.log('built dist/larry-mcp.mjs and dist/larry-sdk.mjs, copied to public/agent/')
