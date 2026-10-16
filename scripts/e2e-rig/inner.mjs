/**
 * The part of the e2e rig that runs inside the isolated process namespace (see rig.mjs).
 *
 * It starts, in this order: N fake freqtrade bots (tools/fakebot, REST + WebSocket + SQLite
 * ledgers + a fake ftcache daemon), one stand-in `freqtrade trade` process per bot (so that the
 * gateway's /proc discovery finds the fake bots exactly like real ones), and the gateway. A small
 * control server on loopback lets the specs read the writes the fake bots recorded, change a bot's
 * mode and stop or start the gateway. Nothing here touches a real bot: the namespace only contains
 * the processes started below.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => a.replace(/^--/, '').split('='))
    .map(([k, v]) => [k, v ?? 'true']),
);
const dir = args.dir;
const fbDir = args['fb-dir'] ?? join(dir, 'fb');
const binDir = args['bin-dir'];
const botCount = Number(args.bots ?? 40);
const gwPort = Number(args['gw-port']);
const ctrlPort = Number(args['control-port']);
const uiOrigins = (args['ui-origins'] ?? '').split(',').filter(Boolean);
const password = args.password;
const closed = Number(args.closed ?? 400);
// True inside the private PID + mount namespace of rig.mjs (see the stand-in processes below)
const isolated = args.isolated === '1';

const children = new Set();

function run(cmd, argv, opts = {}) {
  const child = spawn(cmd, argv, { stdio: ['pipe', 'pipe', 'pipe'], ...opts });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function killAll() {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
}

/** Names that exercise the layouts: long names, a clash-prone prefix, a few plain ones. */
function displayName(index, base) {
  if (index % 8 === 3) {
    return `${base}-hippo_original_multi_dynv1_short_sharpe_ladder_v2_xxl`;
  }
  if (index % 11 === 5) return `${base} (très long nom de stratégie avec accents éèà)`;
  return base;
}

mkdirSync(join(dir, 'cfg'), { recursive: true });
mkdirSync(join(dir, 'gw'), { recursive: true });

// ---- fake bots ----
const fakebot = run(join(binDir, 'fakebot'), [
  '--bots',
  String(botCount),
  '--dir',
  fbDir,
  '--closed',
  String(closed),
  '--open',
  '4',
  '--history-days',
  '60',
  '--snapshot-ms',
  '4000',
  '--writer-ms',
  '6000',
]);
fakebot.stderr.on('data', (d) => process.stderr.write(`[fakebot] ${d}`));
const fakebotLines = createInterface({ input: fakebot.stdout })[Symbol.asyncIterator]();
const next = async () => {
  const { value, done } = await fakebotLines.next();
  if (done) throw new Error('fakebot ended');
  return JSON.parse(value);
};
const manifest = await next();

/** One command at a time on the fakebot stdin; the replies come back in order. */
let chain = Promise.resolve();
function fakebotCmd(cmd) {
  const job = chain.then(async () => {
    fakebot.stdin.write(`${JSON.stringify(cmd)}\n`);
    return next();
  });
  chain = job.catch(() => undefined);
  return job;
}

// ---- stand-in freqtrade processes + their configs ----
const bots = manifest.bots.map((b) => ({
  index: b.index,
  name: displayName(b.index, b.name),
  port: b.port,
  live: b.live,
  user: b.user,
  password: b.password,
}));
for (const b of manifest.bots) {
  const cfg = {
    bot_name: displayName(b.index, b.name),
    strategy: 'FakeStrategy',
    dry_run: !b.live,
    db_url: `sqlite:///${b.db_path}`,
    stake_currency: 'USDC',
    available_capital: b.capital,
    max_open_trades: 4,
    exchange: {
      name: 'hyperliquid',
      trading_mode: 'futures',
      ...(b.wallet ? { walletAddress: b.wallet } : {}),
    },
    api_server: {
      enabled: true,
      listen_ip_address: '127.0.0.1',
      listen_port: b.port,
      username: b.user,
      password: b.password,
      jwt_secret_key: 'rig-shared-secret',
      ws_token: 'rig-ws-token',
    },
  };
  const file = join(dir, 'cfg', `${b.name}.json`);
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  // The discovery of a gateway looks for `trade` and an argument containing `freqtrade` in the
  // argv of a process. A PID namespace does not hide a process from the /proc of the host, so
  // the production gateway used to find these stand-ins too and listed fake bots and positions
  // among the real ones (B210). In the namespace the real argv is therefore harmless
  // (`rig-standin`), and the discovery-shaped one is bind-mounted over /proc/<pid>/cmdline
  // of the namespace's own procfs: only the rig's gateway sees it.
  const discoveryArgv = [process.execPath, 'trade', 'freqtrade', '--config', file];
  const stand = isolated
    ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)', 'rig-standin', b.name], {
        stdio: 'ignore',
        cwd: dir,
      })
    : spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)', ...discoveryArgv.slice(1)], {
        stdio: 'ignore',
        cwd: dir,
      });
  if (isolated) {
    const cmdlineFile = join(dir, 'cfg', `${b.name}.cmdline`);
    writeFileSync(cmdlineFile, `${discoveryArgv.join('\0')}\0`);
    const r = spawnSync('mount', ['--bind', cmdlineFile, `/proc/${stand.pid}/cmdline`], {
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      throw new Error(`cannot mask the stand-in argv of ${b.name}: ${r.stderr || r.error}`);
    }
  }
  children.add(stand);
}

// A few unhealthy bots for the stale / offline states
const staleSpec = [
  [botCount - 4, 'down'],
  [botCount - 3, 'starting'],
];
for (const [index, mode] of staleSpec) {
  if (index >= 0) await fakebotCmd({ cmd: 'mode', bot: index, mode });
}

// ---- gateway ----
async function startGateway() {
  const hasher = run(join(binDir, 'frequi-gateway'), ['hash-password']);
  hasher.stdin.end(`${password}\n`);
  let hash = '';
  hasher.stdout.on('data', (d) => (hash += d));
  await new Promise((res) => hasher.on('exit', res));
  hash = hash.trim();
  const secrets = join(dir, 'secrets.toml');
  writeFileSync(secrets, `[auth]\npassword_hash = "${hash}"\n`);
  chmodSync(secrets, 0o600);
  const toml = [
    '[general]',
    'timezone = "Europe/Paris"',
    '[server]',
    `listen = "127.0.0.1:${gwPort}"`,
    `cors_origins = [${uiOrigins.map((o) => JSON.stringify(o)).join(', ')}]`,
    '[auth]',
    'modes = ["token_proof", "bot_credentials", "password"]',
    'login_rate_per_min = 1000',
    'global_login_rate_per_min = 1000',
    'lockout_after_failures = 1000',
    'actions_per_min = 1000',
    '[discovery]',
    'proc_scan = true',
    'read_api_credentials_from_config = true',
    '[ftcache]',
    `socket = ${JSON.stringify(manifest.daemon_socket)}`,
    '[market]',
    'coingecko = false',
    '[storage]',
    `data_dir = ${JSON.stringify(join(dir, 'gw'))}`,
    '[log]',
    'level = "warn"',
    'format = "text"',
    '',
  ].join('\n');
  const cfgPath = join(dir, 'gateway.toml');
  writeFileSync(cfgPath, toml);
  const gw = run(join(binDir, 'frequi-gateway'), [
    'run',
    '--config',
    cfgPath,
    '--secrets',
    secrets,
  ]);
  gw.stdout.on('data', (d) => process.stderr.write(`[gateway] ${d}`));
  gw.stderr.on('data', (d) => process.stderr.write(`[gateway] ${d}`));
  return gw;
}

let gateway = await startGateway();

async function waitHello(timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${gwPort}/gw/v1/hello`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('the gateway did not come up');
}
await waitHello();

// ---- control server ----
const control = http.createServer(async (req, res) => {
  const body = await new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => resolve(s));
  });
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.url === '/fakebot' && req.method === 'POST') {
      return send(200, await fakebotCmd(JSON.parse(body)));
    }
    if (req.url === '/gateway/stop' && req.method === 'POST') {
      gateway.kill('SIGTERM');
      await new Promise((r) => gateway.once('exit', r));
      return send(200, { ok: true });
    }
    if (req.url === '/gateway/start' && req.method === 'POST') {
      // Already running (a spec restored it): nothing to start
      if (gateway.exitCode === null && gateway.signalCode === null) return send(200, { ok: true });
      gateway = await startGateway();
      await waitHello();
      return send(200, { ok: true });
    }
    return send(404, { error: 'unknown route' });
  } catch (e) {
    return send(500, { error: String(e) });
  }
});
await new Promise((r) => control.listen(ctrlPort, '127.0.0.1', r));

const info = {
  gateway: `http://127.0.0.1:${gwPort}`,
  control: `http://127.0.0.1:${ctrlPort}`,
  password,
  dir,
  bots,
  // Bot indexes in the states set above, for the specs
  down: staleSpec.filter(([, m]) => m === 'down').map(([i]) => i),
  starting: staleSpec.filter(([, m]) => m === 'starting').map(([i]) => i),
};
writeFileSync(join(dir, 'rig.json'), JSON.stringify(info, null, 2));
console.log(JSON.stringify({ ready: true, file: join(dir, 'rig.json') }));

const stop = async () => {
  try {
    await fakebotCmd({ cmd: 'quit' });
  } catch {
    // stopping anyway
  }
  killAll();
  control.close();
  setTimeout(() => process.exit(0), 300);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdin.on('end', stop);
process.stdin.resume();
