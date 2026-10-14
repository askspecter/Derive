// Browser end to end test: drives the real UI against a local Hardhat chain.
// Usage: PW=<path to playwright> node test/e2e/ui.cjs <site url> <env.json> <screenshot dir> [stage]
const fs = require('fs')
const path = require('path')
const { chromium } = require(process.env.PW || 'playwright')

const [url, envFile, out] = process.argv.slice(2)
const env = JSON.parse(fs.readFileSync(envFile))
const shim = fs.readFileSync(path.join(__dirname, 'wallet-shim.js'), 'utf8')
const log = (...a) => console.log('•', ...a)

async function waitText(page, text, timeout = 60000) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout })
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript(`window.__E2E_ACCOUNT = ${JSON.stringify(env.admin)};\n${shim}`)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const shot = (n) => page.screenshot({ path: path.join(out, `e2e-${n}.png`), fullPage: true })
  const as = async (who) => {
    await page.evaluate((a) => window.__setAccount(a), env[who])
    await page.waitForTimeout(800)
  }

  try {
    // ---------------------------------------------------------- admin: connect
    await page.goto(`${url}/#/admin`)
    // The injected wallet may already be connected on load.
    const connectBtn = page.getByRole('button', { name: 'Connect admin wallet' })
    if (await connectBtn.isVisible({ timeout: 4000 }).catch(() => false)) await connectBtn.click()
    // Reown connects straight away when only one browser wallet exists; otherwise pick it.
    const pick = page.getByText('E2E Wallet').first()
    if (await pick.isVisible({ timeout: 5000 }).catch(() => false)) await pick.click()
    await waitText(page, 'Deploy the liquidity vault')
    log('admin connected')

    // ---------------------------------------------------------- admin: deploy
    const collateral = page.locator('label.field', { hasText: 'Collateral token' }).locator('input')
    await collateral.fill(env.usdg)
    await waitText(page, 'USDG, 6 decimals')
    const cap = page.locator('label.field', { hasText: 'Initial deposit cap' }).locator('input')
    await cap.fill('1000000')
    await page.getByRole('button', { name: 'Deploy vault' }).click()
    await waitText(page, 'Vault deployed')
    log('vault deployed')
    await page.getByRole('button', { name: 'Deploy perps' }).click()
    await waitText(page, 'Perps deployed')
    log('perps deployed')
    await page.getByRole('button', { name: 'Deploy options' }).click()
    await waitText(page, 'Options deployed')
    log('options deployed')
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await waitText(page, 'Products connected')
    await waitText(page, '02')
    log('products connected')
    if (process.env.STAGE === 'flex') {
      // Used wallet: the site can't derive addresses, so it must show them for the hosting settings.
      await waitText(page, 'Last step: tell the site where the contracts are')
      const env = await page.locator('pre.code').innerText()
      if (!/VITE_LARRY_POOL=0x[0-9a-fA-F]{40}/.test(env)) throw new Error('env lines missing')
      await shot('flex-deployed')
      log('used wallet deploy worked, env lines:', env.replace(/\n/g, ' '))
      return
    }
    log('protocol live')
    await shot('1-admin-deployed')

    // ---------------------------------------------------------- admin: markets
    for (const sym of ['ETH', 'TSLA']) {
      const row = page.locator('.market-admin', { hasText: sym }).first()
      await row.locator('.market-admin-head').click()
      await row.locator('label.field', { hasText: 'Chainlink feed' }).locator('input').fill(env.feeds[sym])
      await row.getByText(`${sym} / USD`).waitFor({ timeout: 20000 })
      await row.getByRole('button', { name: 'List perps' }).click()
      await row.getByText(`${sym} perps saved`).waitFor({ timeout: 60000 })
      await page.waitForTimeout(1500) // let the listing refresh settle before the next click
      await row.getByRole('button', { name: 'List options' }).click()
      await row.getByText(`${sym} options saved`).waitFor({ timeout: 60000 })
      log(`${sym} listed`)
    }
    await shot('2-admin-markets')

    // ---------------------------------------------------------- LP deposit
    await as('lp')
    await page.goto(`${url}/#/vaults`)
    await waitText(page, 'Your position')
    await page.locator('aside input').fill('200000')
    await page.locator('aside > button.btn-lg', { hasText: 'Deposit' }).click()
    await waitText(page, 'Deposited')
    log('LP deposited 200,000')
    await page.waitForTimeout(1500)
    await shot('3-vault')

    // ---------------------------------------------------------- trader perps
    await as('trader')
    await page.goto(`${url}/#/perps?asset=ETH`)
    await waitText(page, 'Market rules')
    await page.locator('aside label.field', { hasText: 'Collateral' }).locator('input').fill('1000')
    await page.getByRole('button', { name: 'Long ETH' }).click()
    await waitText(page, 'Opened long ETH')
    await page.locator('.positions tbody tr').first().waitFor({ timeout: 30000 })
    log('perp long opened')
    await shot('4-perps-open')
    await page.locator('.positions tbody tr').first().getByRole('button', { name: 'Close' }).click()
    await waitText(page, 'Position closed')
    log('perp closed')

    // ---------------------------------------------------------- trader options
    await page.goto(`${url}/#/options?asset=ETH`)
    await waitText(page, 'Click a price to buy')
    await page.locator('td.quote').nth(8).click()
    await page.getByText('Total cost').waitFor()
    await page.waitForTimeout(1500)
    await page.locator('aside').getByRole('button', { name: /Buy (call|put)/ }).click()
    await waitText(page, 'Bought ETH option')
    await page.locator('.positions tbody tr').first().waitFor({ timeout: 30000 })
    log('option bought')
    await shot('5-options')

    // ---------------------------------------------------------- settle and claim
    {
      const { encodeFunctionData, parseUnits } = await import('viem')
      const rpc = async (method, params = []) => {
        const r = await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
        return (await r.json()).result
      }
      const chainNow = Number((await rpc('eth_getBlockByNumber', ['latest', false])).timestamp)
      // first listed expiry, as the UI computes it
      let expiry = chainNow - ((chainNow - 115200) % 604800) + 604800
      if (expiry - 604800 > chainNow + 3600) expiry -= 604800
      await rpc('evm_increaseTime', [expiry - chainNow + 60])
      await rpc('evm_mine')
      const data = encodeFunctionData({
        abi: [{ type: 'function', name: 'setAnswer', inputs: [{ type: 'int256' }], outputs: [], stateMutability: 'nonpayable' }],
        functionName: 'setAnswer',
        args: [parseUnits('3600', 8)],
      })
      await rpc('eth_sendTransaction', [{ from: env.infra, to: env.feeds.ETH, data }])
      await page.clock.setSystemTime(new Date((expiry + 120) * 1000))
      await page.goto(`${url}/#/options?asset=ETH`)
      await page.getByRole('button', { name: 'Settle and claim' }).click({ timeout: 30000 })
      await waitText(page, 'Payout claimed')
      await waitText(page, 'Settled at') .catch(() => {})
      await page.waitForTimeout(2500)
      await shot('5b-options-claimed')
      log('option settled from the first oracle round after expiry and claimed')
    }

    // ---------------------------------------------------------- overview pages
    await page.goto(`${url}/#/portfolio`)
    await waitText(page, 'Your options')
    await page.waitForTimeout(2500)
    await shot('6-portfolio')
    await page.goto(`${url}/#/`)
    await page.waitForTimeout(3000)
    await shot('7-home')
    await page.goto(`${url}/#/stats`)
    await page.waitForTimeout(2000)
    await shot('8-stats')
    // ---------------------------------------------------------- no dashes anywhere
    const dashes = {}
    for (const r of ['/', '/perps', '/options', '/vaults', '/portfolio', '/stats', '/admin', '/docs/introduction', '/docs/perpetuals', '/docs/options', '/docs/vault', '/docs/fees', '/docs/contracts', '/docs/risks', '/docs/faq']) {
      await page.goto(`${url}/#${r}`)
      await page.waitForTimeout(1200)
      const t = await page.evaluate(() => document.body.innerText)
      // addresses and hashes are fine; flag dashes in words and numbers
      const hits = t.split('\n').filter((l) => /[\u2010-\u2015\u2212]|[A-Za-z0-9]-[A-Za-z0-9]| - /.test(l))
      if (hits.length) dashes[r] = hits.slice(0, 3)
    }
    log('dash scan:', JSON.stringify(dashes))

    // ---------------------------------------------------------- phone layout
    await page.setViewportSize({ width: 390, height: 844 })
    for (const r of ['/', '/perps', '/options', '/vaults', '/admin']) {
      await page.goto(`${url}/#${r}`)
      await page.waitForTimeout(1200)
      const w = await page.evaluate(() => document.documentElement.scrollWidth)
      if (w > 390) log(`horizontal overflow on ${r}: ${w}px`)
    }
    await page.goto(`${url}/#/perps`)
    await page.waitForTimeout(1500)
    await shot('9-mobile-perps')
    log('done, page errors:', JSON.stringify(errors))
  } catch (e) {
    console.error('FAILED:', e.message.split('\n')[0])
    await shot('failure')
    console.error('page errors:', JSON.stringify(errors.slice(0, 5)))
    process.exitCode = 1
  } finally {
    await browser.close()
  }
})()
