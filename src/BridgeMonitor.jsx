import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Users,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Search,
  Radio,
  Plus,
  X,
  Info,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

const DEFAULT_BRIDGES = [
  {
    name: "Base Native Bridge",
    protocol: "OP Stack (L2StandardBridge)",
    address: "0x4200000000000000000000000000000000000010",
    color: "#7C6CF6",
  },
  {
    name: "Across Protocol",
    protocol: "SpokePool",
    address: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
    color: "#35D0BA",
  },
  {
    name: "Stargate (V1 Router)",
    protocol: "LayerZero",
    address: "0x45f1A95A4D3f3836523F5c83673c797f4d4d263B",
    color: "#F5A623",
  },
];

const QUICK_TOKENS = [
  { label: "$owockibot", address: "0xfdc933ff4e2980d18becf48e4e030d8463a2bb07" },
  { label: "WETH (demo)", address: "0x4200000000000000000000000000000000000006" },
  { label: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
];

const BASE_CHAIN_ID = 8453;
const LIFI_BASE = "https://li.quest/v1";
const EXPLORER = "https://basescan.org";
const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";

function short(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function fmtAmount(n) {
  if (!isFinite(n)) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "K";
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

export default function BridgeMonitor() {
  const [tokenAddress, setTokenAddress] = useState(QUICK_TOKENS[0].address);
  const [tokenInput, setTokenInput] = useState(QUICK_TOKENS[0].address);
  const [apiKey, setApiKey] = useState("");
  const [bridges, setBridges] = useState(DEFAULT_BRIDGES);
  const [newBridgeName, setNewBridgeName] = useState("");
  const [newBridgeAddr, setNewBridgeAddr] = useState("");

  const [chainsById, setChainsById] = useState({});
  const [lifi, setLifi] = useState({ status: "idle" });
  const [onchain, setOnchain] = useState({ status: "idle" });
  const [lastRefreshed, setLastRefreshed] = useState(null);

  useEffect(() => {
    fetchJson(`${LIFI_BASE}/chains`)
      .then((d) => {
        const map = {};
        (d.chains || []).forEach((c) => (map[c.id] = c.name));
        setChainsById(map);
      })
      .catch(() => {});
  }, []);

  const checkLifi = useCallback(async (address) => {
    setLifi({ status: "loading" });
    try {
      const tokenInfo = await fetchJson(
        `${LIFI_BASE}/token?chain=${BASE_CHAIN_ID}&token=${address}`
      );
      const [outRes, inRes] = await Promise.allSettled([
        fetchJson(`${LIFI_BASE}/connections?fromChain=${BASE_CHAIN_ID}&fromToken=${address}`),
        fetchJson(`${LIFI_BASE}/connections?toChain=${BASE_CHAIN_ID}&toToken=${address}`),
      ]);
      const outConns = outRes.status === "fulfilled" ? outRes.value.connections || [] : [];
      const inConns = inRes.status === "fulfilled" ? inRes.value.connections || [] : [];
      setLifi({ status: "ok", tokenInfo, outConns, inConns });
    } catch (e) {
      setLifi({ status: "unsupported", error: String(e.message || e) });
    }
  }, []);

  const scanOnchain = useCallback(async (address, key, bridgeList) => {
    setOnchain({ status: "loading" });
    const key_ = key?.trim() || "YourApiKeyToken";
    try {
      const results = await Promise.all(
        bridgeList.map(async (b) => {
          const url = `${ETHERSCAN_V2_BASE}?chainid=${BASE_CHAIN_ID}&module=account&action=tokentx&contractaddress=${address}&address=${b.address}&sort=desc&page=1&offset=100&apikey=${key_}`;
          const data = await fetchJson(url);
          if (data.status !== "1") {
            return { bridge: b, error: data.result || "no data", txs: [] };
          }
          return { bridge: b, txs: data.result || [] };
        })
      );

      let outVolume = 0,
        inVolume = 0;
      const outAddrs = new Set();
      const inAddrs = new Set();
      const perBridge = [];
      let anyError = null;
      let anyOk = false;

      for (const r of results) {
        if (r.error) {
          anyError = r.error;
          perBridge.push({ name: r.bridge.name, in: 0, out: 0, color: r.bridge.color });
          continue;
        }
        anyOk = true;
        let bOut = 0,
          bIn = 0;
        for (const tx of r.txs) {
          const amt = Number(tx.value) / 10 ** Number(tx.tokenDecimal || 18);
          if (tx.to?.toLowerCase() === r.bridge.address.toLowerCase()) {
            bOut += amt;
            outAddrs.add(tx.from?.toLowerCase());
          } else if (tx.from?.toLowerCase() === r.bridge.address.toLowerCase()) {
            bIn += amt;
            inAddrs.add(tx.to?.toLowerCase());
          }
        }
        outVolume += bOut;
        inVolume += bIn;
        perBridge.push({ name: r.bridge.name, in: bIn, out: bOut, color: r.bridge.color });
      }

      setOnchain({
        status: anyOk ? "ok" : "error",
        error: anyOk ? null : anyError,
        outVolume,
        inVolume,
        uniqueOut: outAddrs.size,
        uniqueIn: inAddrs.size,
        perBridge,
        sampleNote:
          "Based on the most recent 100 token-transfer events per bridge contract (Etherscan V2 tokentx).",
      });
    } catch (e) {
      setOnchain({ status: "error", error: String(e.message || e) });
    }
  }, []);

  const runScan = useCallback(
    (address) => {
      checkLifi(address);
      scanOnchain(address, apiKey, bridges);
      setLastRefreshed(new Date());
    },
    [apiKey, bridges, checkLifi, scanOnchain]
  );

  useEffect(() => {
    runScan(tokenAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trendingRoutes = useMemo(() => {
    if (onchain.status !== "ok") return [];
    return [...onchain.perBridge]
      .map((b) => ({ ...b, total: b.in + b.out }))
      .sort((a, b) => b.total - a.total);
  }, [onchain]);

  const netFlow =
    onchain.status === "ok" ? onchain.inVolume - onchain.outVolume : null;

  return (
    <div className="min-h-screen bg-[#0B1020] text-[#E7ECFF] font-sans">
      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:.35} }
        .live-dot { animation: pulse-dot 1.6s ease-in-out infinite; }
      `}</style>

      <header className="border-b border-[#232C4D] px-6 py-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#8B93B8]">
            <Radio size={12} className="text-[#35D0BA] live-dot" />
            Base · Bridge Activity Monitor
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold mt-1 tracking-tight">
            Cross-chain flow tracker
          </h1>
        </div>
        <button
          onClick={() => runScan(tokenAddress)}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-[#232C4D] bg-[#121933] px-4 py-2 text-sm font-medium hover:border-[#7C6CF6] transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </header>

      <main className="px-6 py-6 max-w-6xl mx-auto space-y-8">
        <section className="rounded-xl border border-[#232C4D] bg-[#121933] p-5">
          <div className="flex flex-wrap gap-2 mb-3">
            {QUICK_TOKENS.map((t) => (
              <button
                key={t.address}
                onClick={() => {
                  setTokenInput(t.address);
                  setTokenAddress(t.address);
                  runScan(t.address);
                }}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  tokenAddress.toLowerCase() === t.address.toLowerCase()
                    ? "border-[#7C6CF6] bg-[#7C6CF6]/15 text-white"
                    : "border-[#232C4D] text-[#8B93B8] hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 flex items-center gap-2 bg-[#0B1020] border border-[#232C4D] rounded-lg px-3 py-2">
              <Search size={14} className="text-[#8B93B8] shrink-0" />
              <input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Token contract address on Base (0x…)"
                className="bg-transparent outline-none text-sm font-mono w-full placeholder:text-[#4A5280]"
              />
            </div>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Etherscan API key (required — etherscan.io/apis)"
              className="bg-[#0B1020] border border-[#232C4D] rounded-lg px-3 py-2 text-sm font-mono outline-none placeholder:text-[#4A5280] md:w-80"
            />
            <button
              onClick={() => {
                setTokenAddress(tokenInput.trim());
                runScan(tokenInput.trim());
              }}
              className="rounded-lg bg-[#7C6CF6] hover:bg-[#6a5ae0] transition-colors px-4 py-2 text-sm font-medium text-white"
            >
              Scan
            </button>
          </div>
          <p className="text-xs text-[#8B93B8] mt-3 flex items-start gap-1.5">
            <Info size={13} className="mt-0.5 shrink-0" />
            BaseScan's old API was retired in favor of Etherscan's unified V2
            API. Get a free key at etherscan.io/apis (works for Base and every
            other chain through the same key) and paste it above.
          </p>
        </section>

        <section className="rounded-xl border border-[#232C4D] bg-[#121933] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#8B93B8] mb-3">
            Bridge-aggregator support (LI.FI)
          </h2>
          {lifi.status === "loading" && (
            <p className="text-sm text-[#8B93B8]">Checking LI.FI…</p>
          )}
          {lifi.status === "unsupported" && (
            <div className="flex items-start gap-2 text-sm text-[#F5A623]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">
                  This token isn't indexed by LI.FI's aggregator.
                </p>
                <p className="text-[#8B93B8] mt-1">
                  That's expected for a new, low-liquidity token — bridge
                  aggregators only list assets they can route through their own
                  liquidity or DEX paths. It doesn't mean the token can't move
                  cross-chain manually, only that no one-click aggregated route
                  exists yet. ({lifi.error})
                </p>
              </div>
            </div>
          )}
          {lifi.status === "ok" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-[#8B93B8]">Symbol </span>
                  <span className="font-mono">{lifi.tokenInfo.symbol}</span>
                </div>
                <div>
                  <span className="text-[#8B93B8]">Name </span>
                  {lifi.tokenInfo.name}
                </div>
                {lifi.tokenInfo.priceUSD && (
                  <div>
                    <span className="text-[#8B93B8]">Price </span>$
                    {Number(lifi.tokenInfo.priceUSD).toPrecision(4)}
                  </div>
                )}
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <RouteList
                  title="Outbound (Base → elsewhere)"
                  connections={lifi.outConns}
                  chainsById={chainsById}
                  dir="out"
                />
                <RouteList
                  title="Inbound (elsewhere → Base)"
                  connections={lifi.inConns}
                  chainsById={chainsById}
                  dir="in"
                />
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[#232C4D] bg-[#121933] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#8B93B8]">
              On-chain bridge-contract activity
            </h2>
            <BridgeRegistryEditor
              bridges={bridges}
              setBridges={setBridges}
              newBridgeName={newBridgeName}
              setNewBridgeName={setNewBridgeName}
              newBridgeAddr={newBridgeAddr}
              setNewBridgeAddr={setNewBridgeAddr}
              onChange={() => scanOnchain(tokenAddress, apiKey, bridges)}
            />
          </div>

          {onchain.status === "loading" && (
            <p className="text-sm text-[#8B93B8]">Scanning bridge contracts…</p>
          )}
          {onchain.status === "error" && (
            <div className="flex items-start gap-2 text-sm text-[#FF6B6B]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>{onchain.error || "Could not reach Etherscan's API."}</p>
            </div>
          )}
          {onchain.status === "ok" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  icon={<ArrowUpRight size={16} />}
                  label="Bridged out"
                  value={fmtAmount(onchain.outVolume)}
                  color="#F5A623"
                />
                <StatCard
                  icon={<ArrowDownLeft size={16} />}
                  label="Bridged in"
                  value={fmtAmount(onchain.inVolume)}
                  color="#35D0BA"
                />
                <StatCard
                  icon={<Users size={16} />}
                  label="Unique bridgers"
                  value={onchain.uniqueOut + onchain.uniqueIn}
                  color="#7C6CF6"
                />
                <StatCard
                  icon={netFlow >= 0 ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                  label="Net flow"
                  value={(netFlow >= 0 ? "+" : "") + fmtAmount(netFlow)}
                  color={netFlow >= 0 ? "#35D0BA" : "#F5A623"}
                />
              </div>

              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendingRoutes}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#232C4D" />
                    <XAxis dataKey="name" stroke="#8B93B8" fontSize={12} />
                    <YAxis stroke="#8B93B8" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: "#0B1020",
                        border: "1px solid #232C4D",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="in" name="In" fill="#35D0BA" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="out" name="Out" fill="#F5A623" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <p className="text-xs text-[#8B93B8]">{onchain.sampleNote}</p>
            </div>
          )}
        </section>

        <footer className="text-xs text-[#4A5280] pb-6 space-y-1">
          <p>
            Sources: LI.FI aggregator API (li.quest) · Etherscan V2 API
            (tokentx, chainid=8453) · bridge-contract registry defined in
            source.
          </p>
          {lastRefreshed && <p>Last refreshed {lastRefreshed.toLocaleTimeString()}</p>}
          <p>
            Not financial advice. $owockibot is a low-liquidity token — treat
            all figures as directional, not authoritative.
          </p>
        </footer>
      </main>
    </div>
  );
}

function RouteList({ title, connections, chainsById, dir }) {
  const chains = useMemo(() => {
    const set = new Map();
    (connections || []).forEach((c) => {
      const id = dir === "out" ? c.toChainId : c.fromChainId;
      set.set(id, (chainsById[id] || `Chain ${id}`));
    });
    return [...set.entries()];
  }, [connections, chainsById, dir]);

  return (
    <div>
      <p className="text-xs text-[#8B93B8] mb-2">{title}</p>
      {chains.length === 0 ? (
        <p className="text-sm text-[#4A5280]">No routes found.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {chains.map(([id, name]) => (
            <span
              key={id}
              className="text-xs px-2 py-1 rounded-md bg-[#0B1020] border border-[#232C4D]"
            >
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }) {
  return (
    <div className="rounded-lg bg-[#0B1020] border border-[#232C4D] p-3">
      <div className="flex items-center gap-1.5 text-xs text-[#8B93B8]">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="text-lg font-mono font-semibold mt-1">{value}</div>
    </div>
  );
}

function BridgeRegistryEditor({
  bridges,
  setBridges,
  newBridgeName,
  setNewBridgeName,
  newBridgeAddr,
  setNewBridgeAddr,
  onChange,
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-[#8B93B8] hover:text-white flex items-center gap-1"
      >
        <Plus size={12} />
        {bridges.length} contracts tracked
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-[#0B1020] border border-[#232C4D] rounded-lg p-3 z-10 shadow-xl">
          <div className="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
            {bridges.map((b) => (
              <div
                key={b.address}
                className="flex items-center justify-between text-xs gap-2"
              >
                <div>
                  <div>{b.name}</div>
                  <div className="text-[#4A5280] font-mono">{short(b.address)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`${EXPLORER}/address/${b.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#7C6CF6]"
                  >
                    <ExternalLink size={12} />
                  </a>
                  <button
                    onClick={() => {
                      setBridges(bridges.filter((x) => x.address !== b.address));
                    }}
                    className="text-[#8B93B8] hover:text-[#FF6B6B]"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <input
              value={newBridgeName}
              onChange={(e) => setNewBridgeName(e.target.value)}
              placeholder="Bridge name"
              className="bg-[#121933] border border-[#232C4D] rounded px-2 py-1 text-xs outline-none"
            />
            <input
              value={newBridgeAddr}
              onChange={(e) => setNewBridgeAddr(e.target.value)}
              placeholder="Contract address (0x…)"
              className="bg-[#121933] border border-[#232C4D] rounded px-2 py-1 text-xs font-mono outline-none"
            />
            <button
              onClick={() => {
                if (!newBridgeAddr.trim()) return;
                setBridges([
                  ...bridges,
                  {
                    name: newBridgeName.trim() || short(newBridgeAddr),
                    protocol: "custom",
                    address: newBridgeAddr.trim(),
                    color: "#" + Math.floor(Math.random() * 16777215).toString(16),
                  },
                ]);
                setNewBridgeName("");
                setNewBridgeAddr("");
              }}
              className="bg-[#7C6CF6] hover:bg-[#6a5ae0] rounded px-2 py-1 text-xs font-medium"
            >
              Add contract
            </button>
          </div>
        </div>
      )}
    </div>
  );
      }
