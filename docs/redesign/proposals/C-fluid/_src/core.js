/* ==========================================================================
   Proposition C « Pouls » : données factices + primitives d'interaction.
   Aucune donnée réelle : noms génériques, montants inventés, pas d'adresse.
   ========================================================================== */
(function () {
  'use strict';
  const P = (window.Pouls = {});

  /* ---------- PRNG déterministe ---------- */
  let seed = 20261015;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const between = (a, b) => a + (b - a) * rnd();
  P.rnd = rnd; P.between = between;

  /* ---------- Formatage FR ---------- */
  const MINUS = '−';
  const nf = {};
  const getNf = (d) => (nf[d] ||= new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  P.fmt = (n, d = 2, sign = false) => {
    const s = getNf(d).format(Math.abs(n));
    if (n < 0 && Math.abs(n) >= Math.pow(10, -d) / 2) return MINUS + s;
    return (sign && n > 0 ? '+' : '') + s;
  };
  P.pct = (n, d = 1, sign = true) => P.fmt(n, d, sign) + ' %';
  P.cls = (n) => (n > 0.004 ? 'up' : n < -0.004 ? 'down' : 'muted');
  P.ago = (s) => (s < 10 ? "à l'instant" : s < 60 ? `il y a ${Math.round(s)} s` : s < 3600 ? `il y a ${Math.round(s / 60)} min` : `il y a ${Math.round(s / 3600)} h`);
  P.dur = (h) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}` : `${Math.floor(h / 24)} j ${Math.round(h % 24)} h`);
  const COLORS = ['#7C6CF0', '#E0663E', '#2BA98B', '#C24E86', '#3C8DDE', '#B58A1F', '#5E9E3A', '#9A5BD6', '#D2504F', '#2F9DB0', '#8C7A5B', '#4F6BD8'];
  P.color = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  P.initials = (name) => name.split('_').slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  /* ---------- Flotte factice ---------- */
  // state : ok | off (hors ligne) | stale (données périmées) | paused (entrées en pause)
  const B = (name, strat, group, mode, dir, cap, day, latent, d7, d30, dd, slots, state = 'ok', age = 4) =>
    ({ id: '', name, strat, group, mode, dir, cap, day, latent, d7, d30, dd, slots, state, age });
  P.bots = [
    B('hippo_multi', 'HippoOriginalMulti', 'Hippo', 'live', 'long', 2728, 41.82, 18.40, 212.6, 640.3, -4.1, [5, 8]),
    B('hippo_stocks', 'HippoOriginalStocks', 'Hippo', 'live', 'long', 600, 6.12, -3.20, 18.9, 44.0, -2.6, [2, 4]),
    B('hippo_mat', 'HippoOriginalMat', 'Hippo', 'live', 'long', 400, -1.48, -6.90, 9.4, 21.7, -3.9, [1, 3]),
    B('hippo_ladder', 'HippoLadderOut', 'Hippo', 'dry', 'long', 1000, 12.30, 4.10, 51.2, 133.8, -5.2, [3, 6]),
    B('dynv1_short', 'DynV1Short', 'DynV', 'live', 'short', 900, -22.64, -58.37, -71.4, -12.9, -17.8, [4, 5]),
    B('dynv1_long', 'DynV1Long', 'DynV', 'live', 'long', 900, 9.87, 3.55, 40.2, 96.4, -6.4, [2, 5]),
    B('dynv2_short', 'DynV2Short', 'DynV', 'live', 'short', 450, 0, -9.80, -4.2, 15.1, -8.8, [2, 4], 'off', 840),
    B('btc_regime_long', 'BtcRegimeV1', 'Régime BTC', 'live', 'long', 800, 14.20, 22.75, 58.1, 188.0, -3.1, [1, 1]),
    B('btc_ensemble_long', 'BtcEnsembleV1', 'Régime BTC', 'live', 'long', 600, 7.05, 11.30, 30.6, 92.5, -2.2, [1, 1]),
    B('xyz_vwap_short', 'XyzVwapShort', 'XYZ HIP-3', 'live', 'short', 300, 4.48, -1.15, 12.0, 30.9, -4.7, [2, 4]),
    B('xyz_nvda_mr', 'XyzNvdaMeanRev', 'XYZ HIP-3', 'live', 'long', 250, 2.31, 0.84, 6.6, 9.2, -3.3, [1, 2]),
    B('xyz_silver_mr', 'XyzSilverMeanRev', 'XYZ HIP-3', 'live', 'long', 250, 1.12, -2.40, -1.9, 4.4, -6.0, [1, 2], 'stale', 420),
    B('xyz_gold_rates', 'XyzGoldRates', 'XYZ HIP-3', 'dry', 'long', 1000, 3.90, 6.20, 14.8, 27.5, -1.8, [1, 2]),
    B('xyz_nyopen_short', 'XyzNyOpenShort', 'XYZ HIP-3', 'dry', 'short', 1000, -6.70, 0, -12.4, -30.2, -9.1, [0, 3]),
    B('cci_ao_short', 'CciAoShort', 'Générés', 'live', 'short', 150, 1.94, -4.62, 5.8, 11.3, -7.4, [2, 3]),
    B('kelt_dpo_long', 'KeltDpoLong', 'Générés', 'live', 'long', 150, -0.86, 1.20, 3.1, 8.0, -5.5, [1, 3]),
    B('gen_b23_s04', 'GenB23S04', 'Générés', 'dry', 'short', 1000, 8.40, -2.10, 22.3, 61.0, -6.9, [2, 4]),
    B('gen_b23_s11', 'GenB23S11', 'Générés', 'dry', 'long', 1000, -3.10, 5.50, 9.9, 18.6, -4.4, [1, 4]),
    B('gen_b24_s02', 'GenB24S02', 'Générés', 'dry', 'short', 1000, 0.95, 0, 4.2, 7.7, -3.0, [0, 4], 'paused'),
    B('stpmt_short', 'StpmtShort', 'Générés', 'dry', 'short', 1000, -1.25, -0.80, -5.5, -9.4, -7.7, [1, 3]),
    B('eth_mr_long', 'EthMeanRevLong', 'Mean-rev', 'live', 'long', 500, 5.66, 2.10, 21.4, 50.2, -3.6, [1, 2]),
    B('sol_mr_short', 'SolMeanRevShort', 'Mean-rev', 'live', 'short', 400, 3.02, -1.75, 10.8, 26.1, -5.0, [1, 2]),
    B('rsi_dip_long', 'RsiDipLong', 'Mean-rev', 'live', 'long', 300, -2.14, -4.05, -6.0, 14.9, -6.6, [2, 4]),
    B('funding_fade_short', 'FundingFadeShort', 'Mean-rev', 'live', 'short', 300, 6.85, 2.95, 19.7, 37.3, -2.9, [1, 3]),
    B('meme_fade_short', 'MemeFadeShort', 'Mean-rev', 'dry', 'short', 1000, 11.40, -6.30, 35.0, 77.4, -10.2, [3, 5]),
    B('casino_dry', 'CasinoV3', 'Expérimental', 'dry', 'long', 1000, -9.80, -12.40, -31.6, -54.0, -14.0, [4, 6]),
    B('miracle_mot2', 'MiracleMot2', 'Expérimental', 'dry', 'long', 1000, 0, 0, 2.2, 15.8, -2.0, [0, 2]),
    B('vol_breakout_long', 'VolBreakoutLong', 'Expérimental', 'dry', 'long', 1000, 4.10, 1.80, 8.7, 12.1, -3.8, [1, 3]),
  ];
  P.bots.forEach((b, i) => {
    b.id = 'ftbot.' + (i + 1);
    b.port = 8878 + i * 23;
    if (b.name === 'hippo_multi') b.port = 9400;
    b.expo = Math.round(b.cap * (b.slots[0] / Math.max(1, b.slots[1])) * between(0.9, 1.6));
    let v = 0; b.spark = Array.from({ length: 28 }, (_, k) => (v += (b.d7 / 28) + between(-1, 1) * Math.max(2, Math.abs(b.d7) / 9)));
    b.ddMax = -15;
  });
  P.groups = [...new Set(P.bots.map((b) => b.group))];
  P.bot = (name) => P.bots.find((b) => b.name === name);
  P.isFresh = (b) => b.state !== 'off' && b.state !== 'stale';

  /* ---------- Positions ouvertes ---------- */
  const PAIRS = [
    ['BTC', 67250], ['ETH', 2614], ['SOL', 151.8], ['HYPE', 24.31], ['DOGE', .1184], ['AVAX', 27.42], ['LINK', 11.82], ['SUI', 2.214],
    ['WIF', 1.912], ['PENGU', .0213], ['TAO', 352.4], ['ENA', .3315], ['ONDO', .7782], ['AAVE', 151.2], ['XRP', .5321], ['APT', 8.91],
  ];
  const XYZ = [['xyz:NVDA', 138.42], ['xyz:TSLA', 251.7], ['xyz:GOLD', 2668.1], ['xyz:SILVER', 31.42], ['xyz:SPX', 5822]];
  P.positions = [];
  let tid = 400;
  P.bots.forEach((b) => {
    const pool = b.group === 'XYZ HIP-3' || (b.group === 'Hippo' && b.name !== 'hippo_multi' && b.name !== 'hippo_ladder') ? XYZ : PAIRS;
    const n = b.slots[0];
    let restLatent = b.latent;
    for (let k = 0; k < n; k++) {
      const [base, px] = pool[Math.floor(rnd() * pool.length)];
      const short = b.dir === 'short';
      const lat = k === n - 1 ? restLatent : +(b.latent / n * between(0.2, 1.8)).toFixed(2);
      restLatent -= lat;
      const lev = b.group === 'Hippo' ? 3 : b.name.startsWith('btc') ? 2 : 3;
      const dcaMax = b.group === 'Régime BTC' ? 1 : b.group === 'XYZ HIP-3' ? 3 : 5;
      const dca = Math.min(dcaMax, 1 + Math.floor(rnd() * dcaMax));
      const stake = +(b.cap / b.slots[1] * between(.4, 1.1) * (1 + (dca - 1) * .45)).toFixed(2);
      const pnlPct = lat / stake * 100;
      const entry = px * (1 - (short ? -1 : 1) * pnlPct / 100 / lev);
      P.positions.push({
        id: ++tid, bot: b.name, pair: base + (base.startsWith('xyz:') ? '' : '/USDC'), base, short, lev, dca, dcaMax,
        stake, latent: lat, pct: pnlPct, entry, price: px, hours: between(0.4, 96), durPct: Math.round(between(10, 99)),
        liq: +between(14, 48).toFixed(1), mode: b.mode, state: b.state,
      });
    }
  });
  // dynv1_short : positions écrites à la main (cohérentes avec son latent −58,37 et son échelle DCA)
  P.positions = P.positions.filter((p) => p.bot !== 'dynv1_short');
  [['ENA', .3315, 4, 98, -24.10, 14.4, 84, 26.8], ['XRP', .5321, 4, 92, -17.27, 27.3, 22, 24.9], ['SOL', 151.8, 3, 72, -12.40, 30.1, 91, 14.2], ['HYPE', 24.31, 2, 41, -4.60, 6.2, 40, 31.5]]
    .forEach(([base, price, dca, stake, latent, hours, durPct, liq]) => P.positions.unshift({
      id: ++tid, bot: 'dynv1_short', pair: base + '/USDC', base, short: true, lev: 3, dca, dcaMax: 5, stake, latent, pct: latent / stake * 100,
      price, hours, durPct, liq, mode: 'live', state: 'ok' }));
  // position orpheline sur le wallet (aucun bot ne la porte)
  P.orphan = { pair: 'HYPE/USDC', side: 'short', amount: 0.92, notional: 22.37 };

  /* ---------- Alertes structurées (calculées par la passerelle) ---------- */
  P.alerts = [
    { id: 'a1', sev: 'high', type: 'drawdown', icon: 'trending-down', bot: 'dynv1_short', title: 'Drawdown au-delà du seuil', value: '−17,8 %', thr: 'seuil −15 %', since: 'depuis 38 min', act: 'Ouvrir le bot' },
    { id: 'a2', sev: 'high', type: 'orphan', icon: 'ghost', bot: null, title: 'Position orpheline sur le wallet', value: 'HYPE 0,92', thr: 'short · 22,37 USDC, sans bot', since: 'depuis 12 min', act: 'Réconcilier' },
    { id: 'a3', sev: 'high', type: 'offline', icon: 'unplug', bot: 'dynv2_short', title: 'Bot hors ligne', value: '14 min', thr: '2 positions sans suivi', since: 'depuis 18:28', act: 'Voir les logs' },
    { id: 'a4', sev: 'mid', type: 'stale', icon: 'hourglass', bot: 'xyz_silver_mr', title: 'Données périmées', value: '7 min', thr: 'exclu des totaux', since: 'depuis 18:35', act: 'Diagnostiquer' },
    { id: 'a5', sev: 'mid', type: 'exit', icon: 'ban', bot: 'cci_ao_short', title: 'Sortie refusée 3 fois', value: 'ENA short', thr: 'confirm_trade_exit', since: 'depuis 9 min', act: 'Voir le trade' },
  ];

  /* ---------- Événements ---------- */
  P.events = [
    { t: '18:42', icon: 'circle-check', k: 'up', txt: '<b>eth_mr_long</b> a fermé ETH long', v: '+4,18' },
    { t: '18:39', icon: 'layers', k: 'info', txt: '<b>dynv1_short</b> renfort DCA 4/5 sur SOL', v: '45,00' },
    { t: '18:35', icon: 'hourglass', k: 'warn', txt: '<b>xyz_silver_mr</b> ne répond plus aux sondages', v: '' },
    { t: '18:31', icon: 'circle-arrow-down', k: 'info', txt: '<b>hippo_multi</b> a ouvert AVAX long', v: '61,20' },
    { t: '18:28', icon: 'unplug', k: 'down', txt: '<b>dynv2_short</b> hors ligne', v: '' },
    { t: '18:22', icon: 'circle-check', k: 'up', txt: '<b>funding_fade_short</b> a fermé WIF short', v: '+2,73' },
    { t: '18:14', icon: 'circle-x', k: 'down', txt: '<b>rsi_dip_long</b> stop sur SUI long', v: '−3,96' },
  ];

  /* ---------- Agrégats (la passerelle les calcule ; ici dans le navigateur pour la maquette) ---------- */
  P.agg = () => {
    const fresh = P.bots.filter(P.isFresh);
    const sum = (k, arr = fresh) => arr.reduce((a, b) => a + b[k], 0);
    const live = fresh.filter((b) => b.mode === 'live');
    const longN = P.positions.filter((p) => !p.short && P.isFresh(P.bot(p.bot))).reduce((a, p) => a + p.stake * p.lev, 0);
    const shortN = P.positions.filter((p) => p.short && P.isFresh(P.bot(p.bot))).reduce((a, p) => a + p.stake * p.lev, 0);
    return {
      day: sum('day'), latent: sum('latent'), d7: sum('d7'), d30: sum('d30'), dayLive: sum('day', live), latentLive: sum('latent', live),
      excluded: P.bots.length - fresh.length, online: P.bots.filter((b) => b.state !== 'off').length, total: P.bots.length,
      live: P.bots.filter((b) => b.mode === 'live').length, dry: P.bots.filter((b) => b.mode === 'dry').length,
      slots: [sum('slots', []) || P.bots.reduce((a, b) => a + b.slots[0], 0), P.bots.reduce((a, b) => a + b.slots[1], 0)],
      longN, shortN, positions: P.positions.length,
    };
  };

  /* ---------- Icônes ---------- */
  P.icons = (root) => { if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 }, root: root || document }); };
  P.ic = (name, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;

  /* ---------- Sparkline SVG (sans librairie) ---------- */
  P.spark = (arr, w = 80, h = 24, color) => {
    const min = Math.min(...arr), max = Math.max(...arr), r = max - min || 1;
    const pts = arr.map((v, i) => [(i / (arr.length - 1)) * w, h - 2 - ((v - min) / r) * (h - 4)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const c = color || (arr[arr.length - 1] >= arr[0] ? 'var(--profit)' : 'var(--loss)');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d} L${w} ${h} L0 ${h} Z" fill="${c}" opacity=".12"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  };

  /* ---------- Chiffres animés (tick) ---------- */
  const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  P.tick = (el, to, { d = 2, sign = true, from, flash = true, color = true } = {}) => {
    if (!el) return;
    const start = from ?? +(el.dataset.v ?? 0);
    el.dataset.v = to;
    const render = (v) => { el.textContent = P.fmt(v, d, sign); };
    if (color) { el.classList.remove('up', 'down', 'muted'); el.classList.add(P.cls(to)); }
    if (flash && from === undefined && to !== start) {
      el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(to > start ? 'flash-up' : 'flash-down');
    }
    if (reduce()) return render(to);
    const t0 = performance.now(), D = 600;
    const step = (t) => { const k = Math.min(1, (t - t0) / D); const e = 1 - Math.pow(1 - k, 3); render(start + (to - start) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };

  /* ---------- Contrôle segmenté ---------- */
  P.seg = (root, onChange) => {
    const thumb = document.createElement('span'); thumb.className = 'thumb'; root.prepend(thumb);
    const place = () => { const on = root.querySelector('button.on') || root.querySelector('button'); thumb.style.left = on.offsetLeft + 'px'; thumb.style.width = on.offsetWidth + 'px'; };
    root.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; root.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); place(); onChange && onChange(b.dataset.v, b); });
    requestAnimationFrame(place); window.addEventListener('resize', place);
    document.fonts && document.fonts.ready.then(place);
  };

  /* ---------- Thème ---------- */
  P.theme = () => {
    const saved = localStorage.getItem('pouls-theme');
    const q = new URLSearchParams(location.search).get('theme');
    document.documentElement.dataset.theme = q || saved || 'dark';
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-theme-toggle]')) return;
      const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t; localStorage.setItem('pouls-theme', t);
      document.dispatchEvent(new CustomEvent('themechange'));
    });
  };

  /* ---------- Connexion : passerelle / direct / hors ligne (clic = démo des états) ---------- */
  P.conn = () => {
    const modes = ['gateway', 'direct', 'offline'];
    const set = (m) => {
      document.body.dataset.conn = m;
      document.querySelectorAll('.conn').forEach((c) => {
        c.dataset.mode = m;
        c.querySelector('.txt').textContent = m === 'gateway' ? 'Passerelle' : m === 'direct' ? 'Direct' : 'Hors ligne';
        c.querySelector('.ms').textContent = m === 'gateway' ? '42 ms' : m === 'direct' ? 'sondage 10 s' : 'reconnexion 4 s';
      });
    };
    document.addEventListener('click', (e) => { const c = e.target.closest('.conn'); if (!c) return; const i = modes.indexOf(document.body.dataset.conn || 'gateway'); set(modes[(i + 1) % 3]); });
    set(new URLSearchParams(location.search).get('conn') || 'gateway');
    // battement unique à chaque delta WebSocket simulé
    setInterval(() => { if (document.body.dataset.conn !== 'gateway') return; document.querySelectorAll('.conn').forEach((c) => { c.classList.remove('beat'); void c.offsetWidth; c.classList.add('beat'); }); }, 3000);
  };
  P.connHtml = () => `<button class="conn" data-mode="gateway" title="État de la connexion (clic : démo des 3 états)"><span class="d"></span><span class="txt">Passerelle</span><span class="ms lbl-long">42 ms</span></button>`;

  /* ---------- Coquille (rail + onglets + barre compacte + couches) ---------- */
  const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h4l2.5-6 4 11 2.5-5H21"/></svg>`;
  P.shell = (active, alertsN = 5) => {
    const nav = [
      ['dashboard', 'Flotte', 'activity', 'dashboard.html', 'G F'],
      ['bot', 'Bots', 'bot', 'bot-detail.html', 'G B'],
      ['charts', 'Graphiques', 'chart-candlestick', 'charts.html', 'G G'],
      ['journal', 'Journal', 'book-open-text', 'journal.html', 'G J'],
    ];
    const rail = `<aside class="rail" aria-label="Navigation">
      <a class="brand" href="dashboard.html"><span class="logo">${LOGO}</span><b>FreqUI <span>Ultimate</span></b></a>
      <div class="sect">Pilotage</div>
      ${nav.map(([k, l, i, h, kb]) => `<a class="nav ${k === active ? 'on' : ''}" href="${h}" title="${l}">${P.ic(i)}<span class="lbl">${l}</span>${k === 'dashboard' ? `<span class="badge-n">${alertsN}</span>` : ''}<span class="kbd faint mono" style="font-size:11px">${kb}</span></a>`).join('')}
      <div class="sep"></div>
      <div class="sect">Surveillance</div>
      <a class="nav" href="#" title="Logs">${P.ic('scroll-text')}<span class="lbl">Logs</span></a>
      <a class="nav" href="#" title="Santé et réconciliation">${P.ic('shield-check')}<span class="lbl">Santé</span><span class="badge-n" style="background:var(--warn);color:#1a1200">1</span></a>
      <div class="grow"></div>
      <button class="nav" id="toolsBtn" title="Outils">${P.ic('wrench')}<span class="lbl">Outils</span><span class="kbd faint" style="font-size:11px">${P.ic('chevron-right', 'i14')}</span></button>
      <a class="nav" href="#" title="Réglages">${P.ic('settings-2')}<span class="lbl">Réglages</span></a>
      <button class="nav" data-theme-toggle title="Thème clair ou sombre">${P.ic('sun-moon')}<span class="lbl">Thème</span><span class="kbd faint mono" style="font-size:11px">T</span></button>
    </aside>`;
    const tabs = `<nav class="tabbar" aria-label="Navigation">
      ${nav.map(([k, l, i, h]) => `<a class="tab ${k === active ? 'on' : ''}" href="${h}"><span class="pill">${P.ic(i)}</span>${l}${k === 'dashboard' ? `<span class="dot">${alertsN}</span>` : ''}</a>`).join('')}
      <button class="tab" id="moreBtn"><span class="pill">${P.ic('ellipsis')}</span>Plus</button>
    </nav>`;
    const tools = `<div class="sheet" id="toolsSheet" role="dialog" aria-label="Outils">
      <div class="grab"></div>
      <div class="sh-h"><b style="font-size:17px">Plus</b><span class="sp" style="flex:1"></span><button class="btn icon ghost" data-close>${P.ic('x')}</button></div>
      <div class="sh-b">
        <div class="label" style="margin:0 0 8px">Surveillance</div>
        <div class="card" style="margin-bottom:16px"><ul class="list">
          ${[['scroll-text', 'Logs', 'Flux de tous les bots, erreurs en premier'], ['shield-check', 'Santé et réconciliation', '1 orpheline, budget rate 62 %'], ['bell-ring', 'Alertes', 'Seuils, silences, notifications']].map(([i, t, s]) => `<li class="row">${P.ic(i)}<div style="flex:1"><div style="font-weight:550">${t}</div><div class="faint" style="font-size:13px">${s}</div></div>${P.ic('chevron-right', 'i16 faint')}</li>`).join('')}
        </ul></div>
        <div class="label" style="margin:0 0 8px">Outils</div>
        <div class="card" style="margin-bottom:16px"><ul class="list">
          ${[['flask-conical', 'Labo de stratégie'], ['history', 'Backtest'], ['download', 'Télécharger des données'], ['list-filter', 'Configurer une pairlist'], ['radar', 'Diagnostic réseau et rate-limit'], ['zap', 'Test de choc (stress test)']].map(([i, t]) => `<li class="row">${P.ic(i)}<div style="flex:1;font-weight:500">${t}</div>${P.ic('chevron-right', 'i16 faint')}</li>`).join('')}
        </ul></div>
        <div class="label" style="margin:0 0 8px">Application</div>
        <div class="card"><ul class="list">
          <li class="row">${P.ic('settings-2')}<div style="flex:1;font-weight:500">Réglages</div>${P.ic('chevron-right', 'i16 faint')}</li>
          <li class="row" data-theme-toggle style="cursor:pointer">${P.ic('sun-moon')}<div style="flex:1;font-weight:500">Basculer le thème</div></li>
        </ul></div>
      </div>
    </div>`;
    const layers = `<div class="scrim" id="scrim"></div><div class="scrim s2" id="scrim2"></div>
      <div class="confirm" id="confirm" role="alertdialog" aria-modal="true"></div>
      <div class="toasts" id="toasts" aria-live="polite"></div>`;
    document.body.insertAdjacentHTML('afterbegin', rail);
    document.body.insertAdjacentHTML('beforeend', tabs + tools + layers);
    document.addEventListener('click', (e) => {
      if (e.target.closest('#moreBtn') || e.target.closest('#toolsBtn')) { e.preventDefault(); P.openSheet('toolsSheet'); }
    });
  };

  /* ---------- Barre compacte au défilement ---------- */
  P.compactOn = (sentinel) => {
    if (!sentinel) return;
    new IntersectionObserver(([en]) => document.body.classList.toggle('is-compact', !en.isIntersecting), { rootMargin: '-52px 0px 0px 0px' }).observe(sentinel);
  };

  /* ---------- Feuilles adaptatives ---------- */
  const stack = [];
  P.openSheet = (id) => {
    const s = document.getElementById(id); if (!s) return;
    stack.push(s); s.classList.add('on'); document.getElementById('scrim').classList.add('on');
    if (stack.length > 1) s.classList.add('sheet-2');
    P.icons(s);
  };
  P.closeSheet = () => {
    const s = stack.pop(); if (s) { s.classList.remove('on'); s.style.transform = ''; }
    if (!stack.length) document.getElementById('scrim').classList.remove('on');
  };
  document.addEventListener('click', (e) => {
    if (e.target.id === 'scrim' || e.target.closest('[data-close]')) P.closeSheet();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (document.getElementById('confirm')?.classList.contains('on')) P.closeConfirm(); else P.closeSheet(); } });
  // glisser vers le bas sur la poignée pour fermer (mobile)
  document.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.sheet .grab, .sheet .sh-h'); if (!g || window.innerWidth >= 1024) return;
    const s = g.closest('.sheet'); const y0 = e.clientY; let dy = 0;
    s.style.transition = 'none';
    const mv = (ev) => { dy = Math.max(0, ev.clientY - y0); s.style.transform = `translateY(${dy}px)`; };
    const up = () => { s.style.transition = ''; if (dy > 110) P.closeSheet(); else s.style.transform = ''; removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });

  /* ---------- Confirmation argent réel ---------- */
  // opts : { title, verb, bot, pair, side, rows:[[label, value, cls]], notes:[txt], typeName:bool, onDone }
  let inflight = new Set();
  P.closeConfirm = () => { document.getElementById('confirm').classList.remove('on'); document.getElementById('scrim2').classList.remove('on'); };
  P.confirm = (o) => {
    const b = P.bot(o.bot) || { name: o.bot, mode: 'live', strat: '', port: '' };
    const key = o.key || o.bot + ':' + o.verb;
    const el = document.getElementById('confirm');
    const live = b.mode === 'live';
    const needType = o.typeName && live;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <div style="font-size:17px;font-weight:650;flex:1">${o.title}</div>
        <button class="btn icon ghost sm" data-cancel aria-label="Annuler">${P.ic('x')}</button>
      </div>
      <div class="target ${live ? 'live' : ''}">
        <div class="avatar" style="background:${P.color(b.name)}">${P.initials(b.name)}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:6px;align-items:center"><b style="font-size:15px">${b.name}</b><span class="badge ${b.mode}">${b.mode === 'live' ? 'Live' : 'Dry'}</span></div>
          <div class="faint" style="font-size:12.5px">${b.strat} · port ${b.port}${o.pair ? ' · <b class="muted">' + o.pair + '</b>' : ''}</div>
        </div>
      </div>
      ${o.rows ? `<div class="impact">${o.rows.map(([l, v, c]) => `<div><div class="label">${l}</div><div class="v num ${c || ''}">${v}</div></div>`).join('')}</div>` : '<div style="height:12px"></div>'}
      ${(o.notes || []).map((n) => `<div class="note">${P.ic('triangle-alert')}<div>${n}</div></div>`).join('')}
      ${needType ? `<label class="label" style="display:block;margin:4px 0 6px">Tapez <b class="mono" style="color:var(--text);text-transform:none;letter-spacing:0">${b.name}</b> pour déverrouiller</label><input class="typein" id="typein" autocomplete="off" spellcheck="false" placeholder="${b.name}"><div style="height:10px"></div>` : ''}
      <button class="hold" id="hold" ${needType ? 'disabled' : ''}>${P.ic(o.icon || 'hand')}<span>Maintenir pour ${o.verb}</span></button>
      <div class="faint" style="font-size:12px;text-align:center;margin-top:8px">${live ? 'Argent réel. ' : 'Simulation (dry). '}Ordre unique, aucun renvoi automatique. Journalisé.</div>`;
    P.icons(el);
    document.getElementById('scrim2').classList.add('on'); el.classList.add('on');
    el.querySelector('[data-cancel]').onclick = P.closeConfirm;
    const hold = el.querySelector('#hold');
    const ti = el.querySelector('#typein');
    if (ti) ti.oninput = () => { hold.disabled = ti.value.trim() !== b.name; };
    let raf, t0;
    const HOLD = 900;
    const reset = () => { cancelAnimationFrame(raf); hold.style.setProperty('--p', 0); hold.classList.remove('past'); };
    const done = () => {
      hold.classList.add('done'); hold.querySelector('span').textContent = 'Envoyé';
      if (inflight.has(key)) return; inflight.add(key);
      document.querySelectorAll(`[data-key="${key}"]`).forEach((x) => x.classList.add('busy'));
      setTimeout(() => { P.closeConfirm(); P.result(o, b, key); }, 260);
    };
    const frame = (t) => { const p = Math.min(1, (t - t0) / HOLD); hold.style.setProperty('--p', p); hold.classList.toggle('past', p > .5); if (p >= 1) return done(); raf = requestAnimationFrame(frame); };
    hold.onpointerdown = (e) => { e.preventDefault(); t0 = performance.now(); raf = requestAnimationFrame(frame); };
    hold.onpointerup = hold.onpointerleave = hold.onpointercancel = () => { if (!hold.classList.contains('done')) reset(); };
    hold.onkeydown = (e) => { if (e.key === 'Enter' && !e.repeat) { t0 = performance.now(); raf = requestAnimationFrame(frame); } };
    hold.onkeyup = (e) => { if (e.key === 'Enter' && !hold.classList.contains('done')) reset(); };
  };
  // retour d'état : en attente de l'ordre réel, puis exécuté ou refusé (jamais « succès HTTP »)
  P.result = (o, b, key) => {
    const t = P.toast('pending', `${o.pendingTxt || 'Ordre envoyé'} · ${b.name}`, 'En attente de confirmation de l’exchange', 0);
    setTimeout(() => {
      P.dismiss(t);
      P.toast('ok', o.okTxt || 'Exécuté', `${b.name}${o.pair ? ' · ' + o.pair : ''}${o.okSub ? ' · ' + o.okSub : ''}`, 5200);
      inflight.delete(key);
      document.querySelectorAll(`[data-key="${key}"]`).forEach((x) => x.classList.remove('busy'));
      o.onDone && o.onDone();
    }, 1600);
  };
  P.toast = (kind, title, sub, ms = 4000) => {
    const icon = kind === 'ok' ? 'circle-check' : kind === 'err' ? 'circle-x' : 'loader-circle';
    const el = document.createElement('div'); el.className = 'toast ' + kind;
    el.innerHTML = `${P.ic(icon)}<div style="flex:1;min-width:0"><b>${title}</b><span class="muted">${sub || ''}</span></div>${kind !== 'pending' ? '<button class="btn sm ghost" data-undo>Détails</button>' : ''}`;
    document.getElementById('toasts').appendChild(el); P.icons(el);
    if (ms) setTimeout(() => P.dismiss(el), ms);
    return el;
  };
  P.dismiss = (el) => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };

  /* ---------- Glisser pour agir ---------- */
  P.swipe = (root) => {
    root.querySelectorAll('.swipe').forEach((s) => {
      const over = s.querySelector('.over'); let x0, dx = 0, open = false, moved = false;
      s.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; x0 = e.clientX; dx = 0; moved = false; s.classList.add('dragging'); });
      s.addEventListener('pointermove', (e) => { if (x0 == null) return; dx = e.clientX - x0 + (open ? -152 : 0); if (Math.abs(e.clientX - x0) > 6) moved = true; over.style.transform = `translateX(${Math.min(0, Math.max(-170, dx))}px)`; });
      const end = () => { if (x0 == null) return; x0 = null; s.classList.remove('dragging'); open = dx < -70; over.style.transform = open ? 'translateX(-152px)' : ''; };
      s.addEventListener('pointerup', end); s.addEventListener('pointercancel', end);
      s.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
    });
  };

  // une fois l'apparition jouée, on retire la classe : plus de calque de composition inutile
  document.addEventListener('animationend', (e) => { if (e.target.classList && e.target.classList.contains('reveal')) e.target.classList.remove('reveal'); });

  /* ---------- Démarrage commun ---------- */
  P.boot = (active, after) => {
    P.theme();
    P.shell(active);
    P.conn();
    document.body.classList.add('loading');
    const go = () => { document.body.classList.remove('loading'); after && after(); P.icons(); };
    // squelette visible ~700 ms au premier chargement (snapshot WS initial)
    const q = new URLSearchParams(location.search);
    if (q.get('skeleton') === '1') { P.icons(); return; }
    setTimeout(go, 420);
    P.icons();
  };
})();
