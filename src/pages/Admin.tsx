import { useEffect, useState, type ReactNode } from 'react'
import { useBytecode, useConfig, useDeployContract, useReadContract, useReadContracts, useTransactionCount } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { erc20Abi, formatUnits, getAddress, getContractAddress, isAddress, parseUnits, zeroAddress, type Address } from 'viem'
import { robinhood } from '@reown/appkit/networks'
import { ASSETS } from '../config/markets'
import { ADDRESSES, ADMIN, DEFAULT_COLLATERAL } from '../config/protocol'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { AssetIcon } from '../components/AssetIcon'
import { NeedWallet, TxNotice } from '../components/Status'
import { LarryOptionsAbi, LarryPerpsAbi, LarryPoolAbi, aggregatorAbi } from '../lib/abis'
import { LarryOptionsBytecode, LarryPerpsBytecode, LarryPoolBytecode } from '../contracts/bytecode'
import { useProtocol, type OptionMarket, type PerpMarket } from '../lib/protocol'
import { useTx } from '../lib/tx'
import { useWallet } from '../lib/wallet'
import { cls, num, shortAddr } from '../lib/format'

const explorer = (a: string) => `${ROBINHOOD_CHAIN.explorerUrl}/address/${a}`

function Section({ n, title, children, hint }: { n: string; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="card admin-section">
      <div className="admin-head">
        <span className="mono accent">{n}</span>
        <div>
          <h2>{title}</h2>
          {hint && <p className="muted small">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Field({ label, value, onChange, suffix, wide }: { label: string; value: string; onChange(v: string): void; suffix?: string; wide?: boolean }) {
  return (
    <label className={cls('field', wide && 'wide')}>
      <span>
        {label} {suffix && <em className="muted">{suffix}</em>}
      </span>
      <input value={value} onChange={(e) => onChange(e.target.value.trim())} spellCheck={false} />
    </label>
  )
}

export function Admin() {
  const p = useProtocol()
  const w = useWallet()
  const connected = w.address ? getAddress(w.address) : null
  // Before VITE_LARRY_ADMIN is set, the connected wallet acts as the deployer so setup can start.
  const deployer = ADMIN ?? connected
  const addresses = deployer
    ? {
        pool: ADDRESSES?.pool ?? getContractAddress({ from: deployer, nonce: 0n }),
        perps: ADDRESSES?.perps ?? getContractAddress({ from: deployer, nonce: 1n }),
        options: ADDRESSES?.options ?? getContractAddress({ from: deployer, nonce: 2n }),
      }
    : null
  const owner = p.pool.owner ? getAddress(p.pool.owner) : null
  // The deployer runs setup; after an ownership transfer the new owner runs the protocol.
  const isAdmin = !!connected && (connected === deployer || connected === owner)

  return (
    <div className="app-page container admin">
      <div className="page-head">
        <div>
          <p className="eyebrow accent">Admin</p>
          <h1>Protocol control room</h1>
          <p className="muted">Deploy, configure and run Larry. Every action is a transaction you sign with the admin wallet.</p>
        </div>
      </div>

      <div className="card admin-status">
        <div>
          <span className="eyebrow">Admin wallet</span>
          <b className="mono">{deployer ? shortAddr(deployer) : 'Not set'}</b>
          {!ADMIN && <span className="tag warn-tag">Not configured</span>}
        </div>
        <div>
          <span className="eyebrow">Connected</span>
          <b className="mono">{connected ? shortAddr(connected) : 'None'}</b>
          {connected && <span className={cls('tag', !isAdmin && 'warn-tag')}>{isAdmin ? 'Admin' : 'Not admin'}</span>}
        </div>
        <div>
          <span className="eyebrow">Status</span>
          <b>{p.live ? 'Live' : p.deployed.pool ? 'Partly deployed' : 'Not deployed'}</b>
        </div>
      </div>

      {!connected && (
        <div className="card narrow">
          <NeedWallet label="Connect admin wallet" />
        </div>
      )}
      {connected && !w.onRobinhood && (
        <div className="card narrow">
          <NeedWallet />
        </div>
      )}
      {connected && !isAdmin && ADMIN && (
        <div className="notice err">This wallet is not the admin. Connect {shortAddr(owner ?? ADMIN)} to make changes.</div>
      )}
      {connected && p.live && <AcceptOwnership me={connected} />}
      {!ADMIN && connected && (
        <div className="callout">
          <b>One time setup</b>
          <div>
            This site does not know its admin wallet yet, so it is using the connected wallet {shortAddr(connected)}. After
            deploying, set <span className="kbd">VITE_LARRY_ADMIN={connected}</span> in your hosting settings and redeploy the
            site, so every visitor finds the contracts.
          </div>
        </div>
      )}

      {deployer && addresses && isAdmin && w.onRobinhood && (
        <>
          <DeploySteps deployer={deployer} addresses={addresses} />
          {p.live && (
            <>
              <MarketsSection />
              <ControlsSection />
              <LiquidationsSection />
              <OwnershipSection />
            </>
          )}
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ deploy

type Key = 'pool' | 'perps' | 'options'
type Addrs = { pool: Address; perps: Address; options: Address }
type MaybeAddrs = Partial<Addrs>

function DeploySteps({ deployer, addresses }: { deployer: Address; addresses: Addrs }) {
  const p = useProtocol()
  const tx = useTx()
  const config = useConfig()
  const { deployContractAsync } = useDeployContract()
  const [collateral, setCollateral] = useState<string>(DEFAULT_COLLATERAL)
  const [cap, setCap] = useState('50000')
  const [copied, setCopied] = useState(false)

  // Addresses come from the deploy receipts when the wallet wasn't fresh, so they are kept
  // in this browser until they are set as VITE_LARRY_* in the hosting settings.
  const storeKey = `larry:deploy:${deployer.toLowerCase()}`
  const [local, setLocal] = useState<MaybeAddrs>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? '{}')
    } catch {
      return {}
    }
  })
  const save = (k: Key, a: Address) =>
    setLocal((prev) => {
      const next = { ...prev, [k]: a }
      try {
        localStorage.setItem(storeKey, JSON.stringify(next))
      } catch {}
      return next
    })
  const has = (c: { data?: string }) => !!c.data && c.data !== '0x'
  const nonce = useTransactionCount({ address: deployer, query: { refetchInterval: 8000 } })
  const predictedPool = useBytecode({ address: addresses.pool, query: { refetchInterval: 8000 } })
  // The precomputed addresses only hold when the wallet was fresh. Once it has sent other
  // transactions, trust nothing but the addresses recorded from this browser's deploy receipts.
  const usedWallet = !!local.pool || (!has(predictedPool) && (nonce.data ?? 0) > 0)
  const pick = (k: Key) => (usedWallet ? local[k] : (local[k] ?? addresses[k]))
  const addr = { pool: pick('pool'), perps: pick('perps'), options: pick('options') }

  const poolCode = useBytecode({ address: addr.pool, query: { enabled: !!addr.pool, refetchInterval: 8000 } })
  const perpsCode = useBytecode({ address: addr.perps, query: { enabled: !!addr.perps, refetchInterval: 8000 } })
  const optionsCode = useBytecode({ address: addr.options, query: { enabled: !!addr.options, refetchInterval: 8000 } })
  const done = {
    pool: !!addr.pool && has(poolCode),
    perps: !!addr.perps && has(perpsCode),
    options: !!addr.options && has(optionsCode),
  }
  const pool = addr.pool ?? zeroAddress

  const code = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: isAddress(collateral) ? collateral : zeroAddress, abi: erc20Abi, functionName: 'symbol' },
      { address: isAddress(collateral) ? collateral : zeroAddress, abi: erc20Abi, functionName: 'decimals' },
    ],
    query: { enabled: isAddress(collateral) },
  })
  const tokenSymbol = code.data?.[0]?.result as string | undefined
  const tokenDecimals = code.data?.[1]?.result as number | undefined

  const wired = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: pool, abi: LarryPoolAbi, functionName: 'isProduct', args: [addr.perps ?? zeroAddress] },
      { address: pool, abi: LarryPoolAbi, functionName: 'isProduct', args: [addr.options ?? zeroAddress] },
    ],
    query: { enabled: done.pool, refetchInterval: 8000 },
  })
  const perpsWired = wired.data?.[0]?.result === true
  const optionsWired = wired.data?.[1]?.result === true

  async function deploy(label: string, key: Key, run: () => Promise<`0x${string}`>) {
    await tx.run(`${label} deployed`, async () => {
      tx.setStatus({ kind: 'pending', label: `${label}: confirm in your wallet` })
      let hash: `0x${string}`
      try {
        hash = await run()
      } catch (e) {
        if (/invalid param|missing or invalid|not supported|unsupported/i.test(String((e as Error)?.message)))
          throw new Error(
            'Your wallet refused the deployment. Many mobile wallets can’t deploy contracts. Open this page on a computer with MetaMask or Rabby and deploy from there.',
          )
        throw e
      }
      tx.setStatus({ kind: 'pending', label: `${label}: waiting for confirmation` })
      const receipt = await waitForTransactionReceipt(config, { hash })
      if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${label} deployment failed onchain. Try again with more gas.`)
      save(key, getAddress(receipt.contractAddress))
      p.refetch()
    })
  }

  const allDone = done.pool && done.perps && done.options && perpsWired && optionsWired
  const siteKnows = !!ADDRESSES && ADDRESSES.pool === addr.pool && ADDRESSES.perps === addr.perps && ADDRESSES.options === addr.options
  const envLines = `VITE_LARRY_POOL=${addr.pool ?? ''}\nVITE_LARRY_PERPS=${addr.perps ?? ''}\nVITE_LARRY_OPTIONS=${addr.options ?? ''}`

  const steps: { title: string; done: boolean; body: ReactNode; action?: ReactNode }[] = [
    {
      title: 'Deploy the liquidity vault',
      done: done.pool,
      body: (
        <div className="form-grid">
          <Field label="Collateral token" suffix={tokenSymbol ? `${tokenSymbol}, ${tokenDecimals} decimals` : 'not a token'} value={collateral} onChange={setCollateral} wide />
          <Field label="Initial deposit cap" suffix={tokenSymbol} value={cap} onChange={setCap} />
        </div>
      ),
      action: (
        <button
          className="btn btn-accent"
          disabled={tx.busy || done.pool || !tokenSymbol || tokenDecimals == null}
          onClick={() =>
            deploy('Vault', 'pool', () =>
              deployContractAsync({ chainId: robinhood.id, abi: LarryPoolAbi, bytecode: LarryPoolBytecode, args: [collateral as Address, parseUnits(cap || '0', tokenDecimals!)] }),
            )
          }
        >
          Deploy vault
        </button>
      ),
    },
    {
      title: 'Deploy perpetuals',
      done: done.perps,
      body: <p className="muted small">Points at the vault at {shortAddr(pool)}.</p>,
      action: (
        <button
          className="btn btn-accent"
          disabled={tx.busy || !done.pool || done.perps}
          onClick={() => deploy('Perps', 'perps', () => deployContractAsync({ chainId: robinhood.id, abi: LarryPerpsAbi, bytecode: LarryPerpsBytecode, args: [pool] }))}
        >
          Deploy perps
        </button>
      ),
    },
    {
      title: 'Deploy options',
      done: done.options,
      body: <p className="muted small">Points at the vault at {shortAddr(pool)}.</p>,
      action: (
        <button
          className="btn btn-accent"
          disabled={tx.busy || !done.perps || done.options}
          onClick={() => deploy('Options', 'options', () => deployContractAsync({ chainId: robinhood.id, abi: LarryOptionsAbi, bytecode: LarryOptionsBytecode, args: [pool] }))}
        >
          Deploy options
        </button>
      ),
    },
    {
      title: 'Connect perps and options to the vault',
      done: perpsWired && optionsWired,
      body: <p className="muted small">Lets both products reserve and pay out vault liquidity. Two signatures.</p>,
      action: (
        <button
          className="btn btn-accent"
          disabled={tx.busy || !done.options || (perpsWired && optionsWired)}
          onClick={() =>
            tx.run('Products connected', async () => {
              if (!perpsWired)
                await tx.write('Enable perps', { address: pool, abi: LarryPoolAbi, functionName: 'setProduct', args: [addr.perps!, true] })
              if (!optionsWired)
                await tx.write('Enable options', { address: pool, abi: LarryPoolAbi, functionName: 'setProduct', args: [addr.options!, true] })
              p.refetch()
            })
          }
        >
          Connect
        </button>
      ),
    },
  ]

  return (
    <Section n="01" title="Deploy" hint="Deploy from a computer with MetaMask or Rabby. Most mobile wallets refuse contract deployments.">
      <ol className="deploy-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={cls(s.done && 'done')}>
            <span className="step-n">{s.done ? '✓' : String(i + 1).padStart(2, '0')}</span>
            <div className="deploy-body">
              <b>{s.title}</b>
              {!s.done && s.body}
              {i < 3 &&
                (() => {
                  const a = [addr.pool, addr.perps, addr.options][i]
                  return a ? (
                    <a className="mono small muted" href={explorer(a)} target="_blank" rel="noreferrer">
                      {a}
                    </a>
                  ) : (
                    <span className="mono small muted">Address assigned when deployed</span>
                  )
                })()}
            </div>
            {!s.done && s.action}
          </li>
        ))}
      </ol>
      <TxNotice status={tx.status} />
      {done.pool && !siteKnows && (
        <div className="callout">
          <b>Last step: tell the site where the contracts are</b>
          <div>
            Add these {allDone ? '' : '(after all steps are done) '}as environment variables in Vercel, Settings, Environment Variables, then
            redeploy the site:
            <pre className="code">{envLines}</pre>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(envLines)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch {}
              }}
            >
              {copied ? 'Copied' : 'Copy all'}
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

// ----------------------------------------------------------------- markets

interface PerpForm {
  heartbeat: string
  maxLeverage: string
  openFeeBps: string
  closeFeeBps: string
  borrowBpsPerDay: string
  maintenanceBps: string
  liquidationFeeBps: string
  maxProfitMultiple: string
  maxOpenInterest: string
}
interface OptForm {
  heartbeat: string
  vol: string
  spreadBps: string
  minPremiumBps: string
  maxExpiryDays: string
  maxOpenNotional: string
}

function perpDefaults(kind: 'crypto' | 'stock', m: PerpMarket | null, amount: (v: bigint) => number): PerpForm {
  if (m)
    return {
      heartbeat: String(m.heartbeat),
      maxLeverage: String(m.maxLeverage),
      openFeeBps: String(m.openFeeBps),
      closeFeeBps: String(m.closeFeeBps),
      borrowBpsPerDay: String(m.borrowBpsPerDay),
      maintenanceBps: String(m.maintenanceBps),
      liquidationFeeBps: String(m.liquidationFeeBps),
      maxProfitMultiple: String(m.maxProfitMultiple),
      maxOpenInterest: String(amount(m.maxOpenInterest)),
    }
  return {
    heartbeat: kind === 'crypto' ? '90000' : '21600',
    maxLeverage: kind === 'crypto' ? '20' : '10',
    openFeeBps: '10',
    closeFeeBps: '10',
    borrowBpsPerDay: '5',
    maintenanceBps: kind === 'crypto' ? '100' : '200',
    liquidationFeeBps: '50',
    maxProfitMultiple: '9',
    maxOpenInterest: '100000',
  }
}

function optDefaults(kind: 'crypto' | 'stock', vol: number, m: OptionMarket | null, amount: (v: bigint) => number): OptForm {
  if (m)
    return {
      heartbeat: String(m.heartbeat),
      vol: String(Number(formatUnits(m.vol, 18)) * 100),
      spreadBps: String(m.spreadBps),
      minPremiumBps: String(m.minPremiumBps),
      maxExpiryDays: String(Math.round(m.maxExpiry / 86400)),
      maxOpenNotional: String(amount(m.maxOpenNotional)),
    }
  return {
    heartbeat: kind === 'crypto' ? '90000' : '21600',
    vol: String(Math.round(vol * 100)),
    spreadBps: '300',
    minPremiumBps: '5',
    maxExpiryDays: '63',
    maxOpenNotional: '200000',
  }
}

function MarketsSection() {
  return (
    <Section
      n="02"
      title="Markets"
      hint={
        <>
          Paste the Chainlink price feed (proxy) address for each asset on Robinhood Chain from{' '}
          <a className="link" href="https://data.chain.link" target="_blank" rel="noreferrer">
            data.chain.link
          </a>
          . Heartbeat is how old a price may be before trading pauses.
        </>
      }
    >
      <div className="market-admin-list">
        {ASSETS.map((a, i) => (
          <MarketRow key={a.symbol} idx={i} />
        ))}
      </div>
    </Section>
  )
}

function MarketRow({ idx }: { idx: number }) {
  const p = useProtocol()
  const tx = useTx()
  const a = ASSETS[idx]
  const perp = p.perps.markets[idx]
  const opt = p.options.markets[idx]
  const [open, setOpen] = useState(false)
  const [feed, setFeed] = useState<string>(perp?.feed ?? opt?.feed ?? '')
  const [pf, setPf] = useState<PerpForm>(() => perpDefaults(a.kind, perp, p.amount))
  const [of, setOf] = useState<OptForm>(() => optDefaults(a.kind, a.vol, opt, p.amount))
  useEffect(() => {
    if (perp) setPf(perpDefaults(a.kind, perp, p.amount))
    if (opt) setOf(optDefaults(a.kind, a.vol, opt, p.amount))
    const saved = perp?.feed ?? opt?.feed
    // Only replace the input when it holds a different feed, so a re-render doesn't reload the feed check.
    if (saved) setFeed((cur) => (cur.toLowerCase() === saved.toLowerCase() ? cur : saved))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perp?.feed, opt?.feed])

  const feedOk = isAddress(feed)
  const info = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: feedOk ? (feed as Address) : zeroAddress, abi: aggregatorAbi, functionName: 'description' },
      { address: feedOk ? (feed as Address) : zeroAddress, abi: aggregatorAbi, functionName: 'latestRoundData' },
      { address: feedOk ? (feed as Address) : zeroAddress, abi: aggregatorAbi, functionName: 'decimals' },
    ],
    query: { enabled: feedOk },
  })
  const desc = info.data?.[0]?.result as string | undefined
  const round = info.data?.[1]?.result as readonly [bigint, bigint, bigint, bigint, bigint] | undefined
  const dec = info.data?.[2]?.result as number | undefined
  const age = round ? Math.round((Date.now() / 1000 - Number(round[3])) / 60) : null
  const decimals = p.token?.decimals ?? 6
  const opts = ADDRESSES!

  const savePerp = () =>
    tx.run(`${a.symbol} perps saved`, () =>
      tx.write(`List ${a.symbol} perps`, {
        address: opts.perps,
        abi: LarryPerpsAbi,
        functionName: 'setMarket',
        args: [
          BigInt(idx),
          {
            feed: feed as Address,
            heartbeat: Number(pf.heartbeat),
            maxLeverage: Number(pf.maxLeverage),
            openFeeBps: Number(pf.openFeeBps),
            closeFeeBps: Number(pf.closeFeeBps),
            borrowBpsPerDay: Number(pf.borrowBpsPerDay),
            maintenanceBps: Number(pf.maintenanceBps),
            liquidationFeeBps: Number(pf.liquidationFeeBps),
            maxProfitMultiple: Number(pf.maxProfitMultiple),
            maxOpenInterest: parseUnits(pf.maxOpenInterest || '0', decimals),
            enabled: true,
          },
        ],
      }),
    )
  const saveOpt = () =>
    tx.run(`${a.symbol} options saved`, () =>
      tx.write(`List ${a.symbol} options`, {
        address: opts.options,
        abi: LarryOptionsAbi,
        functionName: 'setMarket',
        args: [
          BigInt(idx),
          {
            feed: feed as Address,
            heartbeat: Number(of.heartbeat),
            vol: parseUnits(String(Number(of.vol) / 100), 18),
            spreadBps: Number(of.spreadBps),
            minPremiumBps: Number(of.minPremiumBps),
            maxExpiry: Number(of.maxExpiryDays) * 86400,
            maxOpenNotional: parseUnits(of.maxOpenNotional || '0', decimals),
            enabled: true,
          },
        ],
      }),
    )
  const toggle = (product: 'perps' | 'options', enabled: boolean) =>
    tx.run(`${a.symbol} ${product} ${enabled ? 'enabled' : 'disabled'}`, () =>
      product === 'perps'
        ? tx.write('Toggle market', { address: opts.perps, abi: LarryPerpsAbi, functionName: 'setMarketEnabled', args: [BigInt(idx), enabled] })
        : tx.write('Toggle market', { address: opts.options, abi: LarryOptionsAbi, functionName: 'setMarketEnabled', args: [BigInt(idx), enabled] }),
    )

  const pfSet = (k: keyof PerpForm) => (v: string) => setPf({ ...pf, [k]: v })
  const ofSet = (k: keyof OptForm) => (v: string) => setOf({ ...of, [k]: v })

  return (
    <div className={cls('market-admin', open && 'open')}>
      <button className="market-admin-head" onClick={() => setOpen(!open)}>
        <span className="asset-cell">
          <AssetIcon symbol={a.symbol} size={28} />
          <b>{a.symbol}</b>
          <span className="muted small">{a.name}</span>
        </span>
        <span className="market-flags">
          <span className={cls('tag', !perp?.enabled && 'off')}>Perps {perp?.enabled ? 'on' : 'off'}</span>
          <span className={cls('tag', !opt?.enabled && 'off')}>Options {opt?.enabled ? 'on' : 'off'}</span>
          <span className="muted">{open ? '×' : '+'}</span>
        </span>
      </button>
      {open && (
        <div className="market-admin-body">
          <Field label="Chainlink feed" value={feed} onChange={setFeed} wide />
          {feedOk && (
            <p className={cls('small', desc ? 'muted' : 'down')}>
              {desc && round && dec != null
                ? `${desc} · ${num(Number(formatUnits(round[1], dec)))} · updated ${age} min ago`
                : 'No Chainlink feed found at this address.'}
            </p>
          )}
          <div className="two-col">
            <div>
              <h4 className="eyebrow">Perpetuals</h4>
              <div className="form-grid">
                <Field label="Heartbeat" suffix="sec" value={pf.heartbeat} onChange={pfSet('heartbeat')} />
                <Field label="Max leverage" suffix="x" value={pf.maxLeverage} onChange={pfSet('maxLeverage')} />
                <Field label="Open fee" suffix="bps" value={pf.openFeeBps} onChange={pfSet('openFeeBps')} />
                <Field label="Close fee" suffix="bps" value={pf.closeFeeBps} onChange={pfSet('closeFeeBps')} />
                <Field label="Borrow" suffix="bps per day" value={pf.borrowBpsPerDay} onChange={pfSet('borrowBpsPerDay')} />
                <Field label="Maintenance" suffix="bps" value={pf.maintenanceBps} onChange={pfSet('maintenanceBps')} />
                <Field label="Liquidation fee" suffix="bps" value={pf.liquidationFeeBps} onChange={pfSet('liquidationFeeBps')} />
                <Field label="Max profit" suffix="x collateral" value={pf.maxProfitMultiple} onChange={pfSet('maxProfitMultiple')} />
                <Field label="OI cap per side" suffix={p.token?.symbol} value={pf.maxOpenInterest} onChange={pfSet('maxOpenInterest')} />
              </div>
              <div className="row-actions">
                <button className="btn btn-accent btn-sm" disabled={tx.busy || !desc} onClick={savePerp}>
                  {perp ? 'Update perps' : 'List perps'}
                </button>
                {perp && (
                  <button className="btn btn-ghost btn-sm" disabled={tx.busy} onClick={() => toggle('perps', !perp.enabled)}>
                    {perp.enabled ? 'Disable' : 'Enable'}
                  </button>
                )}
              </div>
            </div>
            <div>
              <h4 className="eyebrow">Options</h4>
              <div className="form-grid">
                <Field label="Heartbeat" suffix="sec" value={of.heartbeat} onChange={ofSet('heartbeat')} />
                <Field label="Implied vol" suffix="%" value={of.vol} onChange={ofSet('vol')} />
                <Field label="Spread" suffix="bps" value={of.spreadBps} onChange={ofSet('spreadBps')} />
                <Field label="Min premium" suffix="bps of spot" value={of.minPremiumBps} onChange={ofSet('minPremiumBps')} />
                <Field label="Max expiry" suffix="days" value={of.maxExpiryDays} onChange={ofSet('maxExpiryDays')} />
                <Field label="Notional cap" suffix={p.token?.symbol} value={of.maxOpenNotional} onChange={ofSet('maxOpenNotional')} />
              </div>
              <div className="row-actions">
                <button className="btn btn-accent btn-sm" disabled={tx.busy || !desc} onClick={saveOpt}>
                  {opt ? 'Update options' : 'List options'}
                </button>
                {opt && (
                  <button className="btn btn-ghost btn-sm" disabled={tx.busy} onClick={() => toggle('options', !opt.enabled)}>
                    {opt.enabled ? 'Disable' : 'Enable'}
                  </button>
                )}
              </div>
            </div>
          </div>
          <TxNotice status={tx.status} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- controls

function ControlsSection() {
  const p = useProtocol()
  const tx = useTx()
  const A = ADDRESSES!
  const d = p.token?.decimals ?? 6
  const [cap, setCap] = useState(String(p.amount(p.pool.depositCap)))
  const [lockH, setLockH] = useState(String(p.pool.lockPeriod / 3600))
  const [treasury, setTreasury] = useState<string>(p.pool.treasury ?? '')
  const [share, setShare] = useState(String(p.perps.protocolShareBps))
  const [optFee, setOptFee] = useState(String(p.options.protocolFeeBps))
  const [minCol, setMinCol] = useState(String(p.amount(p.perps.minCollateral)))

  const sw = (label: string, on: boolean, act: () => Promise<unknown>) => (
    <div className="switch-row">
      <span>{label}</span>
      <button className={cls('btn btn-sm', on ? 'btn-sell' : 'btn-ghost')} disabled={tx.busy} onClick={() => tx.run('Saved', act)}>
        {on ? 'Paused. Resume' : 'Live. Pause'}
      </button>
    </div>
  )

  return (
    <Section n="03" title="Controls" hint="Pausing blocks new trades or deposits only. Users can always close positions and withdraw.">
      <div className="switches">
        {sw('Perps trading', p.perps.paused, () => tx.write('Perps pause', { address: A.perps, abi: LarryPerpsAbi, functionName: 'setPaused', args: [!p.perps.paused] }))}
        {sw('Options trading', p.options.paused, () => tx.write('Options pause', { address: A.options, abi: LarryOptionsAbi, functionName: 'setPaused', args: [!p.options.paused] }))}
        {sw('Vault deposits', p.pool.depositsPaused, () => tx.write('Deposits pause', { address: A.pool, abi: LarryPoolAbi, functionName: 'setDepositsPaused', args: [!p.pool.depositsPaused] }))}
      </div>
      <div className="form-grid controls-grid">
        <div className="control">
          <Field label="Vault deposit cap" suffix={p.token?.symbol} value={cap} onChange={setCap} />
          <button className="btn btn-ghost btn-sm" disabled={tx.busy} onClick={() => tx.run('Cap saved', () => tx.write('Set cap', { address: A.pool, abi: LarryPoolAbi, functionName: 'setDepositCap', args: [parseUnits(cap || '0', d)] }))}>
            Save
          </button>
        </div>
        <div className="control">
          <Field label="Deposit lock" suffix="hours" value={lockH} onChange={setLockH} />
          <button className="btn btn-ghost btn-sm" disabled={tx.busy} onClick={() => tx.run('Lock saved', () => tx.write('Set lock', { address: A.pool, abi: LarryPoolAbi, functionName: 'setLockPeriod', args: [BigInt(Math.round(Number(lockH) * 3600))] }))}>
            Save
          </button>
        </div>
        <div className="control">
          <Field label="Treasury" value={treasury} onChange={setTreasury} />
          <button className="btn btn-ghost btn-sm" disabled={tx.busy || !isAddress(treasury)} onClick={() => tx.run('Treasury saved', () => tx.write('Set treasury', { address: A.pool, abi: LarryPoolAbi, functionName: 'setTreasury', args: [treasury as Address] }))}>
            Save
          </button>
        </div>
        <div className="control">
          <Field label="Perps fee share to treasury" suffix="bps" value={share} onChange={setShare} />
          <button className="btn btn-ghost btn-sm" disabled={tx.busy} onClick={() => tx.run('Saved', () => tx.write('Set share', { address: A.perps, abi: LarryPerpsAbi, functionName: 'setProtocolShareBps', args: [BigInt(share || '0')] }))}>
            Save
          </button>
        </div>
        <div className="control">
          <Field label="Options protocol fee" suffix="bps" value={optFee} onChange={setOptFee} />
          <button className="btn btn-ghost btn-sm" disabled={tx.busy} onClick={() => tx.run('Saved', () => tx.write('Set fee', { address: A.options, abi: LarryOptionsAbi, functionName: 'setProtocolFeeBps', args: [BigInt(optFee || '0')] }))}>
            Save
          </button>
        </div>
        <div className="control">
          <Field label="Min perp collateral" suffix={p.token?.symbol} value={minCol} onChange={setMinCol} />
          <button className="btn btn-ghost btn-sm" disabled={tx.busy} onClick={() => tx.run('Saved', () => tx.write('Set min', { address: A.perps, abi: LarryPerpsAbi, functionName: 'setMinCollateral', args: [parseUnits(minCol || '0', d)] }))}>
            Save
          </button>
        </div>
      </div>
      <TxNotice status={tx.status} />
    </Section>
  )
}

// ------------------------------------------------------------ liquidations

function LiquidationsSection() {
  const p = useProtocol()
  const tx = useTx()
  const perps = ADDRESSES!.perps
  const count = useReadContract({ address: perps, abi: LarryPerpsAbi, functionName: 'openPositionCount', query: { refetchInterval: 15_000 } })
  const ids = useReadContract({
    address: perps,
    abi: LarryPerpsAbi,
    functionName: 'openPositionIds',
    args: [0n, 300n],
    query: { enabled: (count.data ?? 0n) > 0n, refetchInterval: 15_000 },
  })
  const list = ids.data ?? []
  const states = useReadContracts({
    allowFailure: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: list.map((id) => ({ address: perps, abi: LarryPerpsAbi, functionName: 'positionState', args: [id] })) as any[],
    query: { enabled: list.length > 0, refetchInterval: 15_000 },
  })
  const liquidatable = list.filter((_, i) => (states.data?.[i]?.result as readonly unknown[] | undefined)?.[4] === true)

  return (
    <Section n="04" title="Liquidations" hint="Anyone can liquidate, and the caller earns the liquidation fee. Check here or run a keeper bot.">
      <p className="muted small">
        {String(count.data ?? 0n)} open positions, {liquidatable.length} liquidatable.
      </p>
      {liquidatable.map((id) => (
        <div className="switch-row" key={String(id)}>
          <span className="mono">Position #{String(id)}</span>
          <button
            className="btn btn-sm btn-sell"
            disabled={tx.busy}
            onClick={() => tx.run(`Liquidated #${id}`, () => tx.write('Liquidate', { address: perps, abi: LarryPerpsAbi, functionName: 'liquidate', args: [id] }))}
          >
            Liquidate
          </button>
        </div>
      ))}
      <TxNotice status={tx.status} />
      <span className="muted small">{p.perps.paused ? 'Perps paused. Liquidations still work.' : ''}</span>
    </Section>
  )
}

// --------------------------------------------------------------- ownership

function OwnershipSection() {
  const tx = useTx()
  const A = ADDRESSES!
  const [to, setTo] = useState('')
  const pending = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: A.pool, abi: LarryPoolAbi, functionName: 'pendingOwner' },
      { address: A.perps, abi: LarryPerpsAbi, functionName: 'pendingOwner' },
      { address: A.options, abi: LarryOptionsAbi, functionName: 'pendingOwner' },
    ],
  })
  const pend = (pending.data ?? []).map((x) => x.result as Address | undefined).find((x) => x && x !== zeroAddress)

  return (
    <Section n="05" title="Ownership" hint="Two step transfer: the new owner must accept from their wallet. Consider a multisig such as Safe.">
      {pend && <p className="small">Pending new owner: <span className="mono">{pend}</span></p>}
      <div className="control">
        <Field label="New owner for all three contracts" value={to} onChange={setTo} wide />
        <button
          className="btn btn-ghost btn-sm"
          disabled={tx.busy || !isAddress(to)}
          onClick={() =>
            tx.run('Transfer started. The new owner must accept.', async () => {
              await tx.write('Vault', { address: A.pool, abi: LarryPoolAbi, functionName: 'transferOwnership', args: [to as Address] })
              await tx.write('Perps', { address: A.perps, abi: LarryPerpsAbi, functionName: 'transferOwnership', args: [to as Address] })
              await tx.write('Options', { address: A.options, abi: LarryOptionsAbi, functionName: 'transferOwnership', args: [to as Address] })
            })
          }
        >
          Transfer
        </button>
      </div>
      <TxNotice status={tx.status} />
    </Section>
  )
}

function AcceptOwnership({ me }: { me: Address }) {
  const tx = useTx()
  const A = ADDRESSES!
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: A.pool, abi: LarryPoolAbi, functionName: 'pendingOwner' },
      { address: A.perps, abi: LarryPerpsAbi, functionName: 'pendingOwner' },
      { address: A.options, abi: LarryOptionsAbi, functionName: 'pendingOwner' },
    ],
    query: { refetchInterval: 15_000 },
  })
  const mine = (q.data ?? []).map((x) => (x.result as Address | undefined)?.toLowerCase() === me.toLowerCase())
  if (!mine.some(Boolean)) return null
  return (
    <div className="callout">
      <b>Ownership offered to this wallet</b>
      <div className="row-actions">
        <span>Accept to become the owner of the Larry contracts.</span>
        <button
          className="btn btn-accent btn-sm"
          disabled={tx.busy}
          onClick={() =>
            tx.run('You are now the owner', async () => {
              if (mine[0]) await tx.write('Vault', { address: A.pool, abi: LarryPoolAbi, functionName: 'acceptOwnership' })
              if (mine[1]) await tx.write('Perps', { address: A.perps, abi: LarryPerpsAbi, functionName: 'acceptOwnership' })
              if (mine[2]) await tx.write('Options', { address: A.options, abi: LarryOptionsAbi, functionName: 'acceptOwnership' })
            })
          }
        >
          Accept ownership
        </button>
      </div>
      <TxNotice status={tx.status} />
    </div>
  )
}
