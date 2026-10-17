import { useEffect, useState, type ReactNode } from 'react'
import { useBytecode, useConfig, useDeployContract, useReadContract, useReadContracts, useSendTransaction, useTransactionCount } from 'wagmi'
import { getBalance, waitForTransactionReceipt } from 'wagmi/actions'
import { erc20Abi, formatEther, formatUnits, getAddress, parseEther, getContractAddress, isAddress, parseUnits, zeroAddress, type Address } from 'viem'
import { robinhood } from '@reown/appkit/networks'
import { ASSETS } from '../config/markets'
import { ADDRESSES, ADMIN, ARENA, DEFAULT_COLLATERAL, OPTIONS_LEGACY } from '../config/protocol'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { AssetIcon } from '../components/AssetIcon'
import { NeedWallet, TxNotice } from '../components/Status'
import { LarryArenaAbi, LarryBuybackAbi, LarryVaultOracleAbi, LarryOptionsAbi, LarryPerpsAbi, LarryPoolAbi, aggregatorAbi } from '../lib/abis'
import { LarryArenaBytecode, LarryBuybackBytecode, LarryOptionsBytecode, LarryPerpsBytecode, LarryPoolBytecode, LarryVaultOracleBytecode } from '../contracts/bytecode'
import { LLP_ORACLE, MORPHO, MorphoAbi, llpMarket } from '../config/credit'
import { useProtocol, type OptionMarket, type PerpMarket } from '../lib/protocol'
import { BUYBACK_CONTRACT, LARRY_POOL, LARRY_TOKEN } from '../config/token'
import { findV4Pool, keeperKey, useBrowserKeeper } from '../lib/buybackKeeper'
import { privateKeyToAccount } from 'viem/accounts'
import { usePublicClient } from 'wagmi'
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
              <ZeroDteSection deployer={deployer} />
              <ArenaSection />
              <BuybackSection />
              <CreditSection />
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
  const daily = p.options.daily[idx]
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
          BigInt(a.id),
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
          BigInt(a.id),
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
        ? tx.write('Toggle market', { address: opts.perps, abi: LarryPerpsAbi, functionName: 'setMarketEnabled', args: [BigInt(a.id), enabled] })
        : tx.write('Toggle market', { address: opts.options, abi: LarryOptionsAbi, functionName: 'setMarketEnabled', args: [BigInt(a.id), enabled] }),
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
          {daily && <span className="tag zdte">0DTE</span>}
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
                {opt && p.options.supportsDaily && (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={tx.busy}
                    onClick={() =>
                      tx.run(`${a.symbol} 0DTE ${daily ? 'off' : 'on'}`, () =>
                        tx.write('Daily expiries', { address: opts.options, abi: LarryOptionsAbi, functionName: 'setDailyExpiries', args: [[BigInt(a.id)], !daily] }),
                      )
                    }
                  >
                    {daily ? 'Turn 0DTE off' : 'Turn 0DTE on'}
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

// -------------------------------------------------------------------- 0DTE

/**
 * Daily (0DTE) expiries need the second options contract. This moves options over without
 * touching the vault or perps: deploy, copy the market listings, turn on dailies, connect it to
 * the vault, then point the site at it. Options on the old contract stay claimable.
 */
function ZeroDteSection({ deployer }: { deployer: Address }) {
  const p = useProtocol()
  const tx = useTx()
  const config = useConfig()
  const { deployContractAsync } = useDeployContract()
  const A = ADDRESSES!
  const storeKey = `larry:options-v2:${A.pool.toLowerCase()}`
  const [v2, setV2] = useState<Address | null>(() => {
    try {
      const a = localStorage.getItem(storeKey)
      return a && isAddress(a) ? getAddress(a) : null
    } catch {
      return null
    }
  })
  const [copied, setCopied] = useState(false)
  const listedIdx = ASSETS.map((_, i) => i).filter((i) => !!p.options.markets[i])
  const [dailyPick, setDailyPick] = useState<number[]>(() => listedIdx.filter((i) => ASSETS[i].kind === 'crypto'))

  const target = v2 ?? zeroAddress
  const reads = useReadContracts({
    allowFailure: true,
    // Mixed contracts in one multicall, read back by index.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: [
      { address: target, abi: LarryOptionsAbi, functionName: 'shortDatedSpreadBps' },
      { address: A.pool, abi: LarryPoolAbi, functionName: 'isProduct', args: [target] },
      ...listedIdx.map((i) => ({ address: target, abi: LarryOptionsAbi, functionName: 'markets', args: [BigInt(ASSETS[i].id)] }) as const),
      ...listedIdx.map((i) => ({ address: target, abi: LarryOptionsAbi, functionName: 'dailyExpiries', args: [BigInt(ASSETS[i].id)] }) as const),
    ] as any[],
    query: { enabled: !!v2, refetchInterval: 8000 },
  })
  const rd = reads.data ?? []
  const deployed = rd[0]?.status === 'success'
  const wired = rd[1]?.result === true
  const copiedMarkets = deployed && listedIdx.every((_, k) => ((rd[2 + k]?.result as readonly unknown[] | undefined)?.[0] ?? zeroAddress) !== zeroAddress)
  const dailyOn = deployed && listedIdx.some((_, k) => rd[2 + listedIdx.length + k]?.result === true)
  const switched = p.options.supportsDaily
  const old = A.options
  const envLines = `VITE_LARRY_OPTIONS=${v2 ?? ''}\nVITE_LARRY_OPTIONS_LEGACY=${old}`

  // Already on the daily contract: only the old contract's housekeeping is left.
  if (switched) {
    return OPTIONS_LEGACY.length > 0 ? <LegacyOptions /> : null
  }

  const steps = [
    {
      title: 'Deploy the new options contract',
      done: deployed,
      body: <p className="muted small">Same vault, same rules, plus daily expiries at 08:00 UTC and an extra spread on options with less than a day left.</p>,
      action: (
        <button
          className="btn btn-accent btn-sm"
          disabled={tx.busy}
          onClick={() =>
            tx.run('Options v2 deployed', async () => {
              tx.setStatus({ kind: 'pending', label: 'Confirm the deployment in your wallet' })
              const hash = await deployContractAsync({ chainId: robinhood.id, abi: LarryOptionsAbi, bytecode: LarryOptionsBytecode, args: [A.pool] })
              tx.setStatus({ kind: 'pending', label: 'Waiting for the block' })
              const r = await waitForTransactionReceipt(config, { hash, chainId: robinhood.id })
              if (!r.contractAddress) throw new Error('No contract address in the receipt')
              const a = getAddress(r.contractAddress)
              try {
                localStorage.setItem(storeKey, a)
              } catch {}
              setV2(a)
            })
          }
        >
          Deploy
        </button>
      ),
    },
    {
      title: `Copy ${listedIdx.length} options markets`,
      done: copiedMarkets,
      body: <p className="muted small">One transaction lists every current options market on the new contract with the same settings.</p>,
      action: (
        <button
          className="btn btn-accent btn-sm"
          disabled={tx.busy || !deployed}
          onClick={() =>
            tx.run('Markets copied', async () => {
              const ids = listedIdx.map((i) => BigInt(ASSETS[i].id))
              const ms = listedIdx.map((i) => {
                const m = p.options.markets[i]!
                return { feed: m.feed, heartbeat: m.heartbeat, vol: m.vol, spreadBps: m.spreadBps, minPremiumBps: m.minPremiumBps, maxExpiry: m.maxExpiry, maxOpenNotional: m.maxOpenNotional, enabled: m.enabled }
              })
              await tx.write('Copy markets', { address: v2!, abi: LarryOptionsAbi, functionName: 'setMarkets', args: [ids, ms] })
              if (p.options.protocolFeeBps !== 30)
                await tx.write('Copy fee', { address: v2!, abi: LarryOptionsAbi, functionName: 'setProtocolFeeBps', args: [BigInt(p.options.protocolFeeBps)] })
            })
          }
        >
          Copy
        </button>
      ),
    },
    {
      title: 'Turn on 0DTE',
      done: dailyOn,
      body: (
        <div>
          <p className="muted small">Pick the markets that get daily expiries. Crypto trades around the clock; stock feeds only update in market hours, so leave stocks on Fridays.</p>
          <div className="pick-list">
            {listedIdx.map((i) => (
              <label key={i} className={cls('pick', dailyPick.includes(i) && 'on')}>
                <input type="checkbox" checked={dailyPick.includes(i)} onChange={(e) => setDailyPick(e.target.checked ? [...dailyPick, i] : dailyPick.filter((x) => x !== i))} />
                {ASSETS[i].symbol}
              </label>
            ))}
          </div>
        </div>
      ),
      action: (
        <button
          className="btn btn-accent btn-sm"
          disabled={tx.busy || !copiedMarkets || dailyPick.length === 0}
          onClick={() =>
            tx.run('0DTE on', () =>
              tx.write('Daily expiries', { address: v2!, abi: LarryOptionsAbi, functionName: 'setDailyExpiries', args: [dailyPick.map((i) => BigInt(ASSETS[i].id)), true] }),
            )
          }
        >
          Turn on
        </button>
      ),
    },
    {
      title: 'Connect it to the vault',
      done: wired,
      body: <p className="muted small">The old options contract stays connected so its options can still be claimed.</p>,
      action: (
        <button
          className="btn btn-accent btn-sm"
          disabled={tx.busy || !dailyOn}
          onClick={() => tx.run('Connected', () => tx.write('Enable options v2', { address: A.pool, abi: LarryPoolAbi, functionName: 'setProduct', args: [v2!, true] }))}
        >
          Connect
        </button>
      ),
    },
  ]
  const allDone = steps.every((s) => s.done)

  return (
    <Section n="0DTE" title="Upgrade options for daily expiries" hint={`Signed by ${shortAddr(deployer)}. Nothing changes for traders until the site points at the new contract.`}>
      <ol className="deploy-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={cls(s.done && 'done')}>
            <span className="step-n">{s.done ? '✓' : String(i + 1).padStart(2, '0')}</span>
            <div className="deploy-body">
              <b>{s.title}</b>
              {!s.done && s.body}
              {i === 0 && v2 && (
                <a className="mono small muted" href={explorer(v2)} target="_blank" rel="noreferrer">
                  {v2}
                </a>
              )}
            </div>
            {!s.done && s.action}
          </li>
        ))}
      </ol>
      <TxNotice status={tx.status} />
      {allDone && (
        <div className="callout">
          <b>Last step: point the site at the new contract</b>
          <div>
            Set these in Vercel, Settings, Environment Variables, then redeploy. The second line keeps options bought on the old contract visible and claimable.
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
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

/** Agent Arena: deploy the registry, then pause joining or hide an agent with an abusive name. */
function ArenaSection() {
  const tx = useTx()
  const config = useConfig()
  const { deployContractAsync } = useDeployContract()
  const A = ADDRESSES!
  const storeKey = `larry:arena:${A.options.toLowerCase()}`
  const [fresh, setFresh] = useState<Address | null>(() => {
    try {
      const a = localStorage.getItem(storeKey)
      return a && isAddress(a) ? getAddress(a) : null
    } catch {
      return null
    }
  })
  const [copied, setCopied] = useState(false)
  const arena = ARENA ?? fresh
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: arena ?? zeroAddress, abi: LarryArenaAbi, functionName: 'agentCount' },
      { address: arena ?? zeroAddress, abi: LarryArenaAbi, functionName: 'joinsPaused' },
      { address: arena ?? zeroAddress, abi: LarryArenaAbi, functionName: 'agents', args: [0n, 500n] },
      { address: arena ?? zeroAddress, abi: LarryArenaAbi, functionName: 'options' },
    ],
    query: { enabled: !!arena, refetchInterval: 10_000 },
  })
  const count = q.data?.[0]?.result as bigint | undefined
  const paused = q.data?.[1]?.result === true
  const list = q.data?.[2]?.result as readonly [readonly Address[], readonly { name: string; hidden: boolean }[]] | undefined
  const arenaOptions = q.data?.[3]?.result as Address | undefined
  const envLine = `VITE_LARRY_ARENA=${arena ?? ''}`

  return (
    <Section n="Arena" title="Agent Arena" hint="A public registry of AI agents. It holds no funds and cannot touch trades; the leaderboard is computed from each agent's trades on Larry.">
      {!arena && (
        <div className="switch-row">
          <div>
            <b>Deploy the arena</b>
            <div className="muted small">Points at LarryPerps {shortAddr(A.perps)} and LarryOptions {shortAddr(A.options)}.</div>
          </div>
          <button
            className="btn btn-accent btn-sm"
            disabled={tx.busy}
            onClick={() =>
              tx.run('Arena deployed', async () => {
                tx.setStatus({ kind: 'pending', label: 'Confirm the deployment in your wallet' })
                const hash = await deployContractAsync({ chainId: robinhood.id, abi: LarryArenaAbi, bytecode: LarryArenaBytecode, args: [A.perps, A.options] })
                tx.setStatus({ kind: 'pending', label: 'Waiting for the block' })
                const r = await waitForTransactionReceipt(config, { hash, chainId: robinhood.id })
                if (!r.contractAddress) throw new Error('No contract address in the receipt')
                const a = getAddress(r.contractAddress)
                try {
                  localStorage.setItem(storeKey, a)
                } catch {}
                setFresh(a)
              })
            }
          >
            Deploy
          </button>
        </div>
      )}
      {arena && !ARENA && (
        <div className="callout">
          <b>Open the arena: point the site at it</b>
          <div>
            Set this in Vercel, Settings, Environment Variables, then redeploy. Until then the Arena page says it opens soon.
            <pre className="code">{envLine}</pre>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(envLine)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch {}
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
      {arena && (
        <div className="switches">
          {arenaOptions && arenaOptions.toLowerCase() !== A.options.toLowerCase() && (
            <div className="notice err">This arena counts options on {shortAddr(arenaOptions)}, not the current options contract. Deploy a new arena to follow it.</div>
          )}
          <div className="switch-row">
            <div>
              <b>New agents joining</b>
              <div className="mono small muted">
                {shortAddr(arena)} · {count === undefined ? '…' : `${count} agents`}
              </div>
            </div>
            <button
              className={cls('btn btn-sm', paused ? 'btn-ghost' : 'btn-accent')}
              disabled={tx.busy || count === undefined}
              onClick={() => tx.run(paused ? 'Joining open' : 'Joining paused', () => tx.write('Arena joins', { address: arena, abi: LarryArenaAbi, functionName: 'setJoinsPaused', args: [!paused] }))}
            >
              {paused ? 'Paused, open' : 'Pause joining'}
            </button>
          </div>
          {list?.[0].map((a, i) => (
            <div className="switch-row" key={a}>
              <div>
                <b>{list[1][i].name}</b>
                <div className="mono small muted">{shortAddr(a)}</div>
              </div>
              <button
                className={cls('btn btn-sm', list[1][i].hidden ? 'btn-accent' : 'btn-ghost')}
                disabled={tx.busy}
                onClick={() => tx.run(list[1][i].hidden ? 'Agent shown' : 'Agent hidden', () => tx.write('Arena hide', { address: arena, abi: LarryArenaAbi, functionName: 'setHidden', args: [a, !list[1][i].hidden] }))}
              >
                {list[1][i].hidden ? 'Hidden, show' : 'Hide'}
              </button>
            </div>
          ))}
        </div>
      )}
      <TxNotice status={tx.status} />
    </Section>
  )
}

/** $LARRY buyback and burn: deploy the contract, fund it, allow the swap route, and run it. */
function BuybackSection() {
  const tx = useTx()
  const config = useConfig()
  const { deployContractAsync } = useDeployContract()
  const { sendTransactionAsync } = useSendTransaction()
  const storeKey = 'larry:buyback'
  const [fresh, setFresh] = useState<Address | null>(() => {
    try {
      const a = localStorage.getItem(storeKey)
      return a && isAddress(a) ? getAddress(a) : null
    } catch {
      return null
    }
  })
  const bb = BUYBACK_CONTRACT ?? fresh
  const [keeper, setKeeper] = useState('')
  const [perBuy, setPerBuy] = useState('0.0001')
  const [perDay, setPerDay] = useState('0.02')
  const [fund, setFund] = useState('0.02')
  const [target, setTarget] = useState('')
  const [copied, setCopied] = useState(false)
  const c = { address: bb ?? zeroAddress, abi: LarryBuybackAbi } as const
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...c, functionName: 'keeper' },
      { ...c, functionName: 'maxPerBuy' },
      { ...c, functionName: 'maxPerDay' },
      { ...c, functionName: 'leftToday' },
      { ...c, functionName: 'paused' },
      { ...c, functionName: 'buys' },
      { ...c, functionName: 'totalBurned' },
      { ...c, functionName: 'poolManager' },
      { ...c, functionName: 'v4Pool' },
      { ...c, functionName: 'allowedTarget', args: [LARRY_POOL] },
    ],
    query: { enabled: !!bb, refetchInterval: 8000 },
  })
  const [pm, setPm] = useState('')
  const [fee, setFee] = useState('3000')
  const [spacing, setSpacing] = useState('60')
  const [hooks, setHooks] = useState('0x0000000000000000000000000000000000000000')
  const bal = useReadContracts({
    allowFailure: true,
    contracts: [{ ...c, functionName: 'allowedTarget', args: [isAddress(target) ? getAddress(target) : zeroAddress] }],
    query: { enabled: !!bb && isAddress(target) },
  })
  const [k, mb, md, left, paused, buys, burned, curPm, curPool, poolAllowed] = (q.data ?? []).map((r) => r.result) as [
    Address?, bigint?, bigint?, bigint?, boolean?, bigint?, bigint?, Address?, (readonly [Address, Address, number, number, Address] | undefined)?, boolean?,
  ]
  const v4Set = !!curPm && curPm !== zeroAddress
  const targetAllowed = bal.data?.[0]?.result === true
  const envLine = `VITE_LARRY_BUYBACK=${bb ?? ''}`
  const num6 = (v?: bigint) => (v === undefined ? '…' : Number(formatEther(v)).toFixed(6))
  const eth = (v: string) => {
    try {
      return parseEther(v)
    } catch {
      return 0n
    }
  }

  if (!bb) {
    return (
      <Section n="Burn" title="$LARRY buyback and burn" hint="A contract that holds ETH, buys $LARRY in small amounts and sends every token it buys to the dead address. A keeper bot (buyback/ in the repo) triggers each buy.">
        <div className="form-grid">
          <Field label="Keeper wallet" suffix="the bot's address" value={keeper} onChange={setKeeper} wide />
          <Field label="Max per buy" suffix="ETH" value={perBuy} onChange={setPerBuy} />
          <Field label="Max per day" suffix="ETH" value={perDay} onChange={setPerDay} />
        </div>
        <button
          className="btn btn-accent btn-sm"
          disabled={tx.busy || !isAddress(keeper) || eth(perBuy) === 0n || eth(perDay) < eth(perBuy)}
          onClick={() =>
            tx.run('Buyback contract deployed', async () => {
              tx.setStatus({ kind: 'pending', label: 'Confirm the deployment in your wallet' })
              const hash = await deployContractAsync({ chainId: robinhood.id, abi: LarryBuybackAbi, bytecode: LarryBuybackBytecode, args: [LARRY_TOKEN.address, getAddress(keeper), eth(perBuy), eth(perDay)] })
              tx.setStatus({ kind: 'pending', label: 'Waiting for the block' })
              const r = await waitForTransactionReceipt(config, { hash, chainId: robinhood.id })
              if (!r.contractAddress) throw new Error('No contract address in the receipt')
              const a = getAddress(r.contractAddress)
              try {
                localStorage.setItem(storeKey, a)
              } catch {}
              setFresh(a)
            })
          }
        >
          Deploy
        </button>
        <TxNotice status={tx.status} />
      </Section>
    )
  }

  return (
    <Section n="Burn" title="$LARRY buyback and burn" hint={`Contract ${shortAddr(bb)}. The keeper bot triggers each buy; every $LARRY bought goes to the dead address in the same transaction.`}>
      <div className="admin-status">
        <div>
          <span className="eyebrow">Buybacks</span>
          <b className="mono">{buys?.toString() ?? '…'}</b>
        </div>
        <div>
          <span className="eyebrow">Burned</span>
          <b className="mono">{burned === undefined ? '…' : Math.round(Number(formatEther(burned))).toLocaleString('en-US')} LARRY</b>
        </div>
        <div>
          <span className="eyebrow">Left today</span>
          <b className="mono">{num6(left)} of {num6(md)} ETH</b>
        </div>
        <div>
          <span className="eyebrow">Keeper</span>
          <b className="mono">{k ? shortAddr(k) : '…'}</b>
        </div>
      </div>
      <div className="switches">
        <div className="switch-row">
          <Field label="Send ETH to the contract" suffix="ETH" value={fund} onChange={setFund} />
          <button
            className="btn btn-accent btn-sm"
            disabled={tx.busy || eth(fund) === 0n}
            onClick={() =>
              tx.run('Buyback funded', async () => {
                tx.setStatus({ kind: 'pending', label: 'Confirm in your wallet' })
                const hash = await sendTransactionAsync({ to: bb, value: eth(fund), chainId: robinhood.id })
                await waitForTransactionReceipt(config, { hash, chainId: robinhood.id })
              })
            }
          >
            Fund
          </button>
        </div>
        <div className="switch-row">
          <div>
            <b>$LARRY pool</b>
            <div className="muted small">
              Pons pool {shortAddr(LARRY_POOL)}, where $LARRY trades. {poolAllowed ? 'Allowed: the keeper buys here.' : 'Allow it once so the contract can buy there.'}
            </div>
          </div>
          <button
            className="btn btn-accent btn-sm"
            disabled={tx.busy || poolAllowed !== false}
            onClick={() => tx.run('$LARRY pool allowed', () => tx.write('Allow the $LARRY pool', { address: bb, abi: LarryBuybackAbi, functionName: 'setTarget', args: [LARRY_POOL, true] }))}
          >
            {poolAllowed ? 'Allowed' : 'Allow the pool'}
          </button>
        </div>
        <details className="advanced">
          <summary className="muted small">Advanced: Uniswap V4 pool and other routes</summary>
        <div className="switch-row">
          <div>
            <b>Uniswap V4 pool</b>
            <div className="muted small">
              {v4Set && curPool
                ? `Buying on PoolManager ${shortAddr(curPm!)}, fee ${curPool[2]}, tick spacing ${curPool[3]}, hooks ${shortAddr(curPool[4])}.`
                : 'Where $LARRY trades. The bot\'s detect command prints these values from any $LARRY buy.'}
            </div>
            <FindPool
              onFound={(f) => {
                setPm(f.poolManager)
                setFee(String(f.key.fee))
                setSpacing(String(f.key.tickSpacing))
                setHooks(f.key.hooks)
              }}
            />
            <div className="form-grid">
              <Field label="PoolManager" value={pm} onChange={setPm} wide />
              <Field label="Fee" value={fee} onChange={setFee} />
              <Field label="Tick spacing" value={spacing} onChange={setSpacing} />
              <Field label="Hooks" value={hooks} onChange={setHooks} wide />
            </div>
          </div>
          <button
            className="btn btn-accent btn-sm"
            disabled={tx.busy || !isAddress(pm) || !isAddress(hooks) || !/^\d+$/.test(fee) || !/^-?\d+$/.test(spacing)}
            onClick={() =>
              tx.run('V4 pool set', () =>
                tx.write('Set V4 pool', {
                  address: bb,
                  abi: LarryBuybackAbi,
                  functionName: 'setV4Pool',
                  args: [getAddress(pm), { currency0: zeroAddress, currency1: LARRY_TOKEN.address, fee: Number(fee), tickSpacing: Number(spacing), hooks: getAddress(hooks) }],
                }),
              )
            }
          >
            {v4Set ? 'Update pool' : 'Set pool'}
          </button>
        </div>
        <div className="switch-row">
          <Field label="Allow a swap route" suffix="only for the 0x or router routes, not V4" value={target} onChange={setTarget} wide />
          <button
            className="btn btn-accent btn-sm"
            disabled={tx.busy || !isAddress(target) || targetAllowed}
            onClick={() => tx.run('Route allowed', () => tx.write('Allow route', { address: bb, abi: LarryBuybackAbi, functionName: 'setTarget', args: [getAddress(target), true] }))}
          >
            {targetAllowed ? 'Allowed' : 'Allow'}
          </button>
        </div>
        </details>
        <div className="switch-row">
          <div className="form-grid">
            <Field label="Max per buy" suffix={`ETH, now ${num6(mb)}`} value={perBuy} onChange={setPerBuy} />
            <Field label="Max per day" suffix={`ETH, now ${num6(md)}`} value={perDay} onChange={setPerDay} />
          </div>
          <button
            className="btn btn-ghost btn-sm"
            disabled={tx.busy || eth(perBuy) === 0n || eth(perDay) < eth(perBuy)}
            onClick={() => tx.run('Limits updated', () => tx.write('Buyback limits', { address: bb, abi: LarryBuybackAbi, functionName: 'setLimits', args: [eth(perBuy), eth(perDay)] }))}
          >
            Set limits
          </button>
        </div>
        <div className="switch-row">
          <div>
            <b>Buybacks</b>
            <div className="muted small">Pausing stops the bot at once. Withdraw takes all unspent ETH back to this wallet.</div>
          </div>
          <div className="row-gap">
            <button
              className={cls('btn btn-sm', paused ? 'btn-accent' : 'btn-ghost')}
              disabled={tx.busy || paused === undefined}
              onClick={() => tx.run(paused ? 'Buybacks resumed' : 'Buybacks paused', () => tx.write('Buyback pause', { address: bb, abi: LarryBuybackAbi, functionName: 'setPaused', args: [!paused] }))}
            >
              {paused ? 'Paused, resume' : 'Pause'}
            </button>
            <WithdrawAll bb={bb} />
          </div>
        </div>
      </div>
      <BrowserKeeper bb={bb} keeper={k} route={poolAllowed ? 'pons' : v4Set ? 'v4' : null} />
      {!BUYBACK_CONTRACT && (
        <div className="callout">
          <b>Show it on the burn page</b>
          <div>
            Set this in Vercel and redeploy, then put the same address in the bot's BUYBACK_CONTRACT.
            <pre className="code">{envLine}</pre>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(envLine)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch {}
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
      <TxNotice status={tx.status} />
    </Section>
  )
}

function FindPool({ onFound }: { onFound: (f: Awaited<ReturnType<typeof findV4Pool>>) => void }) {
  const pub = usePublicClient({ chainId: robinhood.id })
  const [hash, setHash] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="find-pool">
      <Field label="Find it from a $LARRY buy" suffix="paste the transaction hash" value={hash} onChange={setHash} wide />
      <button
        className="btn btn-ghost btn-sm"
        disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(hash) || !pub}
        onClick={async () => {
          setBusy(true)
          setMsg('Reading the transaction…')
          try {
            const f = await findV4Pool(pub as never, hash as `0x${string}`)
            if (f.key.currency1.toLowerCase() !== LARRY_TOKEN.address.toLowerCase() || f.key.currency0 !== zeroAddress)
              throw new Error('That swap is not in the ETH / $LARRY pool')
            onFound(f)
            setMsg(`Found: fee ${f.key.fee}, tick spacing ${f.key.tickSpacing}. Press Set pool.`)
          } catch (e) {
            setMsg((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        Find
      </button>
      {msg && <div className="muted small">{msg}</div>}
    </div>
  )
}

/** Runs the buybacks from this browser tab, so no server is needed. */
function BrowserKeeper({ bb, keeper, route }: { bb: Address; keeper?: Address; route: 'pons' | 'v4' | null }) {
  const tx = useTx()
  const config = useConfig()
  const { sendTransactionAsync } = useSendTransaction()
  const [key, setKey] = useState(() => keeperKey())
  const kAddr = key ? privateKeyToAccount(key).address : null
  const isKeeper = !!kAddr && !!keeper && kAddr.toLowerCase() === keeper.toLowerCase()
  const k = useBrowserKeeper(bb)
  const [every, setEvery] = useState('10')
  const [amount, setAmount] = useState('0.00001')
  k.settings.current = { ...k.settings.current, route: route ?? 'pons', everySec: Math.max(3, Number(every) || 10), amountEth: amount }

  return (
    <div className="keeper card">
      <div className="keeper-head">
        <div>
          <b>Run buybacks from this browser</b>
          <div className="muted small">No server needed. Buys keep going while this tab stays open; on a phone keep the screen on.</div>
        </div>
        {k.running && (
          <span className="burn-live">
            <i /> RUNNING
          </span>
        )}
      </div>
      {!kAddr ? (
        <button className="btn btn-accent btn-sm" onClick={() => setKey(keeperKey(true))}>
          Create a keeper key in this browser
        </button>
      ) : (
        <>
          <div className="muted small mono">Keeper {shortAddr(kAddr)}</div>
          {!isKeeper && (
            <button
              className="btn btn-accent btn-sm"
              disabled={tx.busy}
              onClick={() =>
                tx.run('This browser is the keeper', async () => {
                  await tx.write('Set keeper', { address: bb, abi: LarryBuybackAbi, functionName: 'setKeeper', args: [kAddr] })
                  tx.setStatus({ kind: 'pending', label: 'Send gas to the keeper: confirm in your wallet' })
                  const hash = await sendTransactionAsync({ to: kAddr, value: parseEther('0.001'), chainId: robinhood.id })
                  await waitForTransactionReceipt(config, { hash, chainId: robinhood.id })
                })
              }
            >
              Make this browser the keeper (and send it 0.001 ETH for gas)
            </button>
          )}
          {isKeeper && (
            <div className="form-grid">
              <Field label="Every" suffix="seconds" value={every} onChange={setEvery} />
              <Field label="Per buy" suffix="ETH" value={amount} onChange={setAmount} />
            </div>
          )}
          {isKeeper && (
            <button className={cls('btn btn-sm', k.running ? 'btn-ghost' : 'btn-accent')} disabled={!route} onClick={() => k.setRunning(!k.running)}>
              {!route ? 'Allow the $LARRY pool first' : k.running ? 'Stop' : 'Start buybacks'}
            </button>
          )}
          {k.stats.buys > 0 && (
            <div className="muted small">
              This session: {k.stats.buys} buys, ~{Math.round(k.stats.burned).toLocaleString('en-US')} LARRY burned
            </div>
          )}
          <div className="keeper-log">
            {k.log.map((l) => (
              <div key={l.t} className={cls('small mono', l.ok ? 'up' : 'muted')}>
                {new Date(l.t).toLocaleTimeString()} {l.ok ? '🔥 ' : ''}
                {l.text}{' '}
                {l.hash && (
                  <a className="link" href={`${ROBINHOOD_CHAIN.explorerUrl}/tx/${l.hash}`} target="_blank" rel="noreferrer">
                    tx ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      <TxNotice status={tx.status} />
    </div>
  )
}

function WithdrawAll({ bb }: { bb: Address }) {
  const tx = useTx()
  const w = useWallet()
  const config = useConfig()
  return (
    <button
      className="btn btn-ghost btn-sm"
      disabled={tx.busy || !w.address}
      onClick={() =>
        tx.run('ETH withdrawn', async () => {
          const b = await getBalance(config, { address: bb, chainId: robinhood.id })
          await tx.write('Withdraw', { address: bb, abi: LarryBuybackAbi, functionName: 'withdraw', args: [getAddress(w.address!), b.value] })
        })
      }
    >
      Withdraw ETH
    </button>
  )
}

/** The previous options contract after the move: stop new buys there, keep claims working. */
function LegacyOptions() {
  const tx = useTx()
  const old = OPTIONS_LEGACY[0]
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: old, abi: LarryOptionsAbi, functionName: 'paused' },
      { address: ADDRESSES!.pool, abi: LarryPoolAbi, functionName: 'totalReserved' },
    ],
    query: { refetchInterval: 15_000 },
  })
  const paused = q.data?.[0]?.result === true
  return (
    <Section n="0DTE" title="Old options contract" hint="0DTE is live on the new contract. The old one only needs to let its last options settle and be claimed.">
      <div className="switches">
        <div className="switch-row">
          <div>
            <b>Buying on the old contract</b>
            <div className="mono small muted">{shortAddr(old)}</div>
          </div>
          <button
            className={cls('btn btn-sm', paused ? 'btn-ghost' : 'btn-accent')}
            disabled={tx.busy}
            onClick={() => tx.run(paused ? 'Old contract resumed' : 'Old contract paused', () => tx.write('Old options pause', { address: old, abi: LarryOptionsAbi, functionName: 'setPaused', args: [!paused] }))}
          >
            {paused ? 'Paused, resume' : 'Pause new buys'}
          </button>
        </div>
      </div>
      <p className="muted small">Keep it connected to the vault: claims and settlement still go through it. Pausing does not block either.</p>
      <TxNotice status={tx.status} />
    </Section>
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
  const [shortSpread, setShortSpread] = useState(String(p.options.shortDatedSpreadBps))
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
        {p.options.supportsDaily && (
          <div className="control">
            <Field label="Extra spread under 1 day (0DTE)" suffix="bps" value={shortSpread} onChange={setShortSpread} />
            <button className="btn btn-ghost btn-sm" disabled={tx.busy} onClick={() => tx.run('Saved', () => tx.write('Set 0DTE spread', { address: A.options, abi: LarryOptionsAbi, functionName: 'setShortDatedSpreadBps', args: [BigInt(shortSpread || '0')] }))}>
              Save
            </button>
          </div>
        )}
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

/** LLP credit on Morpho: deploy the LLP price oracle, then open the LLP / USDG market on Morpho Blue. */
function CreditSection() {
  const tx = useTx()
  const config = useConfig()
  const { deployContractAsync } = useDeployContract()
  const A = ADDRESSES!
  const storeKey = `larry:llp-oracle:${A.pool.toLowerCase()}`
  const [fresh, setFresh] = useState<Address | null>(() => {
    try {
      const a = localStorage.getItem(storeKey)
      return a && isAddress(a) ? getAddress(a) : null
    } catch {
      return null
    }
  })
  const [copied, setCopied] = useState('')
  const oracle = LLP_ORACLE ?? fresh
  const m = llpMarket(oracle)
  const q = useReadContracts({
    allowFailure: true,
    contracts: m
      ? [
          { address: MORPHO, abi: MorphoAbi, functionName: 'market', args: [m.id] },
          { address: m.params.oracle, abi: LarryVaultOracleAbi, functionName: 'price' },
        ]
      : [],
    query: { enabled: !!m, refetchInterval: 10_000 },
  })
  const mk = q.data?.[0]?.result as readonly bigint[] | undefined
  const price = q.data?.[1]?.result as bigint | undefined
  const created = !!mk && mk[4] > 0n
  const envLine = `VITE_LLP_ORACLE=${oracle ?? ''}`
  const copy = async (k: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(k)
      setTimeout(() => setCopied(''), 1500)
    } catch {}
  }

  return (
    <Section
      n="Credit"
      title="LLP credit market (Morpho)"
      hint="Lets LPs borrow USDG against their LLP on Morpho Blue, up to 62.5% of its value. Morpho holds the funds; Larry only provides the LLP price. Anyone can lend USDG to the market and earn the interest."
    >
      <div className="switches">
        <div className="switch-row">
          <div>
            <b>1. LLP price oracle</b>
            <div className="mono small muted">
              {oracle ? `${shortAddr(oracle)} · 1 LLP = ${price === undefined ? '…' : num(Number(price) / 1e30, 4)} USDG` : 'Prices LLP at what it redeems for in the vault.'}
            </div>
          </div>
          {!oracle && (
            <button
              className="btn btn-accent btn-sm"
              disabled={tx.busy}
              onClick={() =>
                tx.run('Oracle deployed', async () => {
                  tx.setStatus({ kind: 'pending', label: 'Confirm the deployment in your wallet' })
                  const hash = await deployContractAsync({ chainId: robinhood.id, abi: LarryVaultOracleAbi, bytecode: LarryVaultOracleBytecode, args: [A.pool] })
                  tx.setStatus({ kind: 'pending', label: 'Waiting for the block' })
                  const r = await waitForTransactionReceipt(config, { hash, chainId: robinhood.id })
                  if (!r.contractAddress) throw new Error('No contract address in the receipt')
                  const a = getAddress(r.contractAddress)
                  try {
                    localStorage.setItem(storeKey, a)
                  } catch {}
                  setFresh(a)
                })
              }
            >
              Deploy
            </button>
          )}
        </div>
        {m && (
          <div className="switch-row">
            <div>
              <b>2. Market on Morpho</b>
              <div className="mono small muted">{created ? `Open · id ${m.id.slice(0, 10)}…` : 'LLP collateral, USDG loans, 62.5% LLTV'}</div>
            </div>
            {created ? (
              <button className="btn btn-ghost btn-sm" onClick={() => copy('id', m.id)}>
                {copied === 'id' ? 'Copied' : 'Copy id'}
              </button>
            ) : (
              <button
                className="btn btn-accent btn-sm"
                disabled={tx.busy || !mk}
                onClick={() => tx.run('Market created', () => tx.write('Create market', { address: MORPHO, abi: MorphoAbi, functionName: 'createMarket', args: [m.params] }))}
              >
                Create
              </button>
            )}
          </div>
        )}
      </div>
      {oracle && !LLP_ORACLE && (
        <div className="callout">
          <b>3. Show it on the site</b>
          <div>
            Set this in Vercel, Settings, Environment Variables, then redeploy. The Vault page then shows Borrow against your LLP.
            <pre className="code">{envLine}</pre>
            <button className="btn btn-ghost btn-sm" onClick={() => copy('env', envLine)}>
              {copied === 'env' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
      {created && (
        <div className="muted small">
          Market id <span className="mono">{m!.id}</span>. Lend USDG to it from the Vault page so borrowers have liquidity. Any Morpho app on Robinhood Chain,
          EmpireX's Credit tab included, can list it with this id.
        </div>
      )}
    </Section>
  )
}
