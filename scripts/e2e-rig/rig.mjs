#!/usr/bin/env node
/**
 * The end-to-end rig of FreqUI Ultimate: fake freqtrade bots, the real gateway in front of them
 * and the Vite dev server, all on loopback and all throwaway.
 *
 *   pnpm e2e:rig            start the rig, run the Playwright specs against it, stop everything
 *   pnpm e2e:rig:up         start the rig and keep it up (for manual checks and screenshots)
 *
 * Options: --bots N (default 40), --keep (keep the scratch directory), and after `--` any
 * Playwright argument (a spec file, --grep, --headed...).
 *
 * Safety: the fake bots, their stand-in `freqtrade trade` processes and the gateway run in a new
 * PID namespace (`unshare -Urpf --mount-proc`), so the gateway's /proc discovery can only see the
 * rig and never a real bot of the host. The opposite direction needs care too: a child PID
 * namespace stays visible in the /proc of the host, so the stand-ins carry a harmless argv there
 * (`rig-standin`) and the one the discovery looks for is bind-mounted over their cmdline inside
 * the namespace only (inner.mjs); a gateway of the host cannot mistake them for bots.
 * Where unshare is not available the rig refuses to start, unless FQ_RIG_ALLOW_HOST_PROCS=1 says
 * that no real freqtrade runs on this machine, and even then it refuses while something listens
 * on 9399 (production gateway) or 9400 (bot with the SPA).
 *
 * Ports: UI 3021..3029, control 3030..3039, gateway 3040..3049 (never 9399 or 9400).
 * Binaries: gateway/target/release (built with cargo when missing); FQ_RIG_BIN_DIR overrides.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const argv = process.argv.slice(2);
const mode = argv[0] === 'up' ? 'up' : 'test';
const rest = argv[0] === 'up' || argv[0] === 'test' ? argv.slice(1) : argv;
const dashdash = rest.indexOf('--');
const own = dashdash === -1 ? rest : rest.slice(0, dashdash);
const passthrough = dashdash === -1 ? [] : rest.slice(dashdash + 1);
const botsOpt = own.find((a) => a.startsWith('--bots='));
const bots = botsOpt ? Number(botsOpt.split('=')[1]) : 40;
const keep = own.includes('--keep');

function freePort(from, to) {
  return new Promise((resolvePort, reject) => {
    const tryPort = (p) => {
      if (p > to) return reject(new Error(`no free port in ${from}..${to}`));
      const srv = net.createServer();
      srv.once('error', () => tryPort(p + 1));
      srv.once('listening', () => srv.close(() => resolvePort(p)));
      srv.listen(p, '127.0.0.1');
    };
    tryPort(from);
  });
}

function binDir() {
  const dir = process.env.FQ_RIG_BIN_DIR ?? join(root, 'gateway', 'target', 'release');
  if (existsSync(join(dir, 'fakebot')) && existsSync(join(dir, 'frequi-gateway'))) return dir;
  if (process.env.FQ_RIG_BIN_DIR) throw new Error(`no fakebot / frequi-gateway in ${dir}`);
  console.error('[rig] building fakebot and frequi-gateway (cargo, release, 6 jobs)');
  const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` };
  const r = spawnSync(
    'cargo',
    ['build', '--release', '-j6', '-p', 'fakebot', '-p', 'frequi-gateway'],
    { cwd: join(root, 'gateway'), stdio: 'inherit', env },
  );
  if (r.status !== 0) throw new Error('cargo build failed');
  return dir;
}

function namespaceAvailable() {
  const r = spawnSync('unshare', ['-Urpf', '--mount-proc', 'true'], { stdio: 'ignore' });
  return r.status === 0;
}

/** True when something accepts a connection on this loopback port. */
function listening(port) {
  return new Promise((res) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.once('connect', () => {
      sock.destroy();
      res(true);
    });
    sock.once('error', () => res(false));
  });
}

const children = [];
let scratch = null;
let socketDir = null;

async function teardown() {
  for (const c of children.splice(0).reverse()) {
    try {
      c.kill('SIGTERM');
    } catch {
      // gone already
    }
    await new Promise((r) => {
      const t = setTimeout(() => {
        try {
          c.kill('SIGKILL');
        } catch {
          // gone
        }
        r();
      }, 4000);
      c.once('exit', () => {
        clearTimeout(t);
        r();
      });
      if (c.exitCode !== null) {
        clearTimeout(t);
        r();
      }
    });
  }
  if (!keep) {
    for (const d of [scratch, socketDir]) {
      if (d) rmSync(d, { recursive: true, force: true });
    }
  }
}

async function waitHttp(url, timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${url} did not answer in time`);
}

async function main() {
  const bin = binDir();
  const hasNs = namespaceAvailable();
  if (!hasNs && process.env.FQ_RIG_ALLOW_HOST_PROCS !== '1') {
    throw new Error(
      'unshare -Urpf is not available: the gateway would discover the real freqtrade bots of this host. ' +
        'Set FQ_RIG_ALLOW_HOST_PROCS=1 only on a machine that runs none.',
    );
  }
  if (!hasNs) {
    // Without the namespace the stand-ins are plain host processes: a gateway of the host would
    // list them among its real bots
    for (const port of [9399, 9400]) {
      if (await listening(port)) {
        throw new Error(
          `something listens on 127.0.0.1:${port}: without a PID namespace the rig's stand-in ` +
            'processes would be discovered by it as bots. Not starting.',
        );
      }
    }
  }
  const uiPort = await freePort(3021, 3029);
  const ctrlPort = await freePort(3030, 3039);
  const gwPort = await freePort(3040, 3049);
  scratch = mkdtempSync(join(tmpdir(), 'fq-rig-'));
  // The fake ftcache daemon listens on a unix socket in the fakebot directory: its path must stay
  // under SUN_LEN (about 100 bytes), which a deep TMPDIR does not allow, so the ledgers live in a
  // short directory of their own.
  socketDir = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'fqb-'));
  const password = `rig-${Math.random().toString(36).slice(2, 12)}`;
  const uiOrigins = [`http://127.0.0.1:${uiPort}`, `http://localhost:${uiPort}`];

  const innerArgs = [
    join(here, 'inner.mjs'),
    `--dir=${scratch}`,
    `--fb-dir=${socketDir}`,
    `--bin-dir=${bin}`,
    `--bots=${bots}`,
    `--gw-port=${gwPort}`,
    `--control-port=${ctrlPort}`,
    `--ui-origins=${uiOrigins.join(',')}`,
    `--password=${password}`,
    `--isolated=${hasNs ? 1 : 0}`,
  ];
  const inner = hasNs
    ? spawn('unshare', ['-Urpf', '--mount-proc', process.execPath, ...innerArgs], {
        stdio: ['pipe', 'pipe', 'inherit'],
      })
    : spawn(process.execPath, innerArgs, { stdio: ['pipe', 'pipe', 'inherit'] });
  children.push(inner);
  const ready = await new Promise((res, rej) => {
    const rl = createInterface({ input: inner.stdout });
    rl.on('line', (l) => {
      try {
        const j = JSON.parse(l);
        if (j.ready) res(j);
      } catch {
        // not the ready line
      }
    });
    inner.once('exit', () => rej(new Error('the rig process ended before it was ready')));
  });
  const rigFile = ready.file;

  const vite = spawn(
    join(root, 'node_modules', '.bin', 'vite'),
    ['--port', String(uiPort), '--strictPort', '--host', '127.0.0.1'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  children.push(vite);
  const baseUrl = `http://127.0.0.1:${uiPort}`;
  await waitHttp(baseUrl);

  const info = JSON.parse(readFileSync(rigFile, 'utf8'));
  console.error(`[rig] UI ${baseUrl}  gateway ${info.gateway}  control ${info.control}`);
  console.error(`[rig] ${bots} fake bots, rig file ${rigFile}`);

  if (mode === 'up') {
    console.error('[rig] up; Ctrl+C to stop');
    return new Promise(() => {
      // the signal handlers below stop the rig
    });
  }

  const pw = spawn(
    join(root, 'node_modules', '.bin', 'playwright'),
    ['test', '--project=rig-disruptive', ...passthrough],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, FQ_E2E_BASE_URL: baseUrl, FQ_E2E_RIG: rigFile },
    },
  );
  return new Promise((res) => pw.once('exit', (code) => res(code ?? 1)));
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    teardown().finally(() => process.exit(mode === 'up' ? 0 : 130));
  });
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error(`[rig] ${e instanceof Error ? e.message : e}`);
} finally {
  await teardown();
}
process.exit(code);
