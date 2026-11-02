/* BJA install page (desktop-kit/site): offers the right install for the device in front of it and says "Open from device"
 * when the app is already there. Every visible word comes from ../i18n/<lang>.json (data-i18n / t()).
 * "Already there" is only claimed on proof:
 *   1. the desktop copy answers http://127.0.0.1:<port>/app-version to this page (CORS only for our own page origin), or
 *   2. this browser opened it through the bja-<app>:// link before (a hint, shown as the Open button, and dropped if
 *      the link finds nothing), or
 *   3. this page runs as the installed phone companion (display-mode: standalone). */
'use strict';
(() => {
  const APP = document.body.dataset.app;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* private window */ } },
  };
  const HINT = `bja-open-${APP}`;
  let strings = {}, lang = 'en', data = null, os = 'unknown', macArm = true;
  let running = null;          // { version } once the desktop copy answered
  let notFound = false;        // the open link found nothing
  let message = null;          // { key, vars, ok }
  let installEvent = null;

  const t = (key, vars = {}) => String(strings[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const appName = () => t(`app.${APP}.name`);
  const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1; return 0; };

  function detectOS() {
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
    if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
    return 'unknown';
  }
  const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  async function loadStrings(l) {
    for (const code of [l, 'en']) {
      try { const r = await fetch(`../i18n/${code}.json`, { cache: 'no-cache' }); if (r.ok) { strings = await r.json(); lang = code; return; } } catch { /* next */ }
    }
  }
  function pickLang() {
    const q = new URLSearchParams(location.search).get('lang');
    return (q || store.get('bja-install-lang') || navigator.language || 'en').slice(0, 2).toLowerCase() === 'fr' ? 'fr' : 'en';
  }

  /* ---------- the desktop copy ---------- */
  async function probe() {
    const port = data && data.apps[APP] && data.apps[APP].port;
    if (!port) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/app-version`, { mode: 'cors', cache: 'no-store', signal: ctl.signal });
      const j = await r.json();
      return j && j.app === APP && j.mode === 'desktop' ? { version: j.version } : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }
  /* open the app through its link protocol; true when the browser handed over (focus left the page) */
  function tryOpen() {
    const scheme = data && data.apps[APP] ? data.apps[APP].scheme : `bja-${APP}`;
    return new Promise((resolve) => {
      const frame = document.createElement('iframe');
      let timer;
      const finish = (v) => {
        clearTimeout(timer); frame.remove();
        window.removeEventListener('blur', onAway); window.removeEventListener('pagehide', onAway); document.removeEventListener('visibilitychange', onHide);
        resolve(v);
      };
      const onAway = () => finish(true);
      const onHide = () => { if (document.hidden) finish(true); };
      window.addEventListener('blur', onAway); window.addEventListener('pagehide', onAway); document.addEventListener('visibilitychange', onHide);
      timer = setTimeout(() => finish(false), 2500);
      frame.hidden = true; frame.src = `${scheme}://open`;
      document.body.appendChild(frame);
    });
  }
  async function openFromDevice() {
    message = { key: 'status.trying', vars: { app: appName() } }; render();
    const handled = await tryOpen();
    if (handled) { store.set(HINT, '1'); notFound = false; message = { key: 'status.opened', vars: { app: appName() }, ok: true }; }
    else if (running) message = null;
    else { store.del(HINT); notFound = true; message = { key: 'status.notFound', vars: { app: appName() } }; }
    render();
  }

  /* ---------- rendering ---------- */
  const fileFor = () => {
    const files = data && data.apps[APP] ? data.apps[APP].files : {};
    if (os === 'windows') return { platform: 'win-x64', ...files['win-x64'] };
    if (os === 'mac') {
      const want = macArm ? 'mac-arm64' : 'mac-x64', alt = macArm ? 'mac-x64' : 'mac-arm64';
      const pick = files[want] ? want : (files[alt] ? alt : want);
      return { platform: pick, ...files[pick] };
    }
    return null;
  };
  const urlOf = (f) => (data.base ? data.base.replace(/\/?$/, '/') : '../downloads/') + f.file;
  const osLabel = { 'win-x64': 'os.windows', 'mac-arm64': 'os.mac', 'mac-x64': 'os.macIntel' };

  function setText() {
    document.documentElement.lang = lang;
    document.title = t('page.title', { app: appName() });
    for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n, { app: appName() });
    for (const n of document.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
    for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    $('appName').textContent = appName();
    $('appLead').textContent = t(`app.${APP}.lead`);
  }

  function renderDesktop() {
    const f = fileFor();
    const mac = os === 'mac';
    const latest = data && data.apps[APP] ? data.apps[APP].version : null;
    $('osNote').textContent = t(mac ? 'note.mac' : 'note.windows');
    const hint = store.get(HINT) === '1' && !notFound;
    const show = (el, on) => { el.hidden = !on; };
    const open = !!running || hint;
    $('primary').textContent = t('btn.open');
    show($('primary'), open);
    const dl = $('download');
    if (f && f.file) {
      dl.href = urlOf(f); dl.setAttribute('download', f.file);
      dl.textContent = open ? t('btn.install', { app: appName() }) : t('btn.install', { app: appName() });
      dl.className = open ? 'secondary link' : 'big link';
      show(dl, true);
    } else { show(dl, false); }
    show($('openAlready'), !open);
    $('openAlready').textContent = t('btn.openAlready');
    const intel = $('intel');
    const otherKey = f && f.platform === 'mac-arm64' ? 'mac-x64' : 'mac-arm64';
    const other = mac && data && data.apps[APP] ? data.apps[APP].files[otherKey] : null;
    if (other) { intel.href = urlOf(other); intel.setAttribute('download', other.file); intel.textContent = otherKey === 'mac-x64' ? t('btn.intel') : t('os.mac'); show(intel, !open); } else show(intel, false);
    $('versionLine').textContent = latest ? t('version.latest', { version: latest }) : t('version.none');
    // steps
    const list = $('stepList'); list.textContent = '';
    const kind = mac ? 'mac' : 'windows';
    for (let i = 1; strings[`steps.${kind}.${i}`]; i++) { const li = document.createElement('li'); li.textContent = t(`steps.${kind}.${i}`, { app: appName() }); list.appendChild(li); }
    $('warnText').textContent = t(`warn.${kind}`);
    $('stepsPanel').hidden = !!running;
    $('phone').hidden = true;
    // status line: the message of the last action, else what we know
    let line = message;
    if (!line && running) line = { key: 'status.present', vars: { app: appName(), version: running.version || '' }, ok: true };
    if (!line && hint) line = { key: 'status.hint', vars: { app: appName() } };
    let text = line ? t(line.key, line.vars) : (data ? '' : '');
    if (running && latest && running.version && cmp(running.version, latest) < 0) text += ' ' + t('status.update', { latest });
    $('status').textContent = text; $('status').className = 'status' + (line && line.ok ? ' ok' : '');
  }

  function renderPhone() {
    for (const id of ['primary', 'download', 'openAlready', 'intel']) $(id).hidden = true;
    $('stepsPanel').hidden = true;
    $('phone').hidden = false;
    $('osNote').textContent = t(os === 'unknown' || os === 'linux' ? 'note.unsupported' : 'note.mobile');
    const latest = data && data.apps[APP] ? data.apps[APP].version : null;
    $('versionLine').textContent = latest ? t('version.latest', { version: latest }) : t('version.none');
    $('phone').querySelector('[data-i18n="phone.lead"]').textContent = t('phone.lead', { app: appName() });
    const standalone = isStandalone();
    $('pwaInstall').hidden = standalone || !installEvent;
    const hint = $('iosHint');
    hint.hidden = standalone || !(os === 'ios' || (os === 'android' && !installEvent));
    hint.textContent = t(os === 'ios' ? 'phone.ios' : 'phone.android');
    const notes = data && data.apps[APP] && data.apps[APP].whatsNew ? (data.apps[APP].whatsNew[lang] || data.apps[APP].whatsNew.en || []) : [];
    const ul = $('whatsNewList'); ul.textContent = '';
    for (const line of notes) { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); }
    $('whatsNew').hidden = false;
    if (!notes.length) { const li = document.createElement('li'); li.textContent = t('whatsnew.empty'); ul.appendChild(li); }
    $('status').textContent = standalone ? t('status.standalone', { app: appName() }) : (message ? t(message.key, message.vars) : '');
    $('status').className = 'status' + (standalone || (message && message.ok) ? ' ok' : '');
  }

  function renderOthers() {
    const files = data && data.apps[APP] ? data.apps[APP].files : {};
    const ul = $('otherList'); ul.textContent = '';
    for (const [platform, f] of Object.entries(files)) {
      const li = document.createElement('li');
      const a = document.createElement('a'); a.href = urlOf(f); a.setAttribute('download', f.file);
      a.textContent = t('others.row', { os: t(osLabel[platform]), size: (f.size / 1048576).toFixed(1) });
      const sum = document.createElement('span'); sum.className = 'sum'; sum.textContent = t('others.sha', { sum: f.sha256 });
      li.append(a, sum); ul.appendChild(li);
    }
    const nav = $('appsNav'); nav.textContent = '';
    for (const id of Object.keys(data ? data.apps : { [APP]: {} })) {
      const a = document.createElement('a'); a.href = `../${id}/`; a.textContent = t(`app.${id}.name`);
      if (id === APP) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    }
  }

  function render() {
    setText();
    if (os === 'windows' || os === 'mac') renderDesktop(); else renderPhone();
    renderOthers();
  }

  /* ---------- start ---------- */
  async function refreshProbe() {
    if (os !== 'windows' && os !== 'mac') return;
    const p = await probe();
    const was = !!running;
    running = p;
    if (p) { notFound = false; store.set(HINT, '1'); message = message && message.key === 'status.notFound' ? null : message; }
    if (!!p !== was) render(); else if (p) render();
  }

  async function init() {
    os = detectOS();
    await loadStrings(pickLang());
    try { const r = await fetch('../downloads/downloads.json', { cache: 'no-cache' }); data = r.ok ? await r.json() : null; } catch { data = null; }
    if (os === 'mac' && navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      try { const h = await navigator.userAgentData.getHighEntropyValues(['architecture']); if (h.architecture === 'x86') macArm = false; } catch { /* keep Apple chip */ }
    }
    if (isStandalone()) message = null;
    render();
    for (const b of document.querySelectorAll('.lang button')) b.addEventListener('click', async () => { store.set('bja-install-lang', b.dataset.lang); await loadStrings(b.dataset.lang); render(); });
    $('primary').addEventListener('click', openFromDevice);
    $('openAlready').addEventListener('click', openFromDevice);
    $('shareLink').addEventListener('click', async () => {
      try { if (navigator.share) { await navigator.share({ title: appName(), url: location.href }); return; } } catch { return; }
      try { await navigator.clipboard.writeText(location.href); message = { key: 'phone.copied', vars: {}, ok: true }; } catch { message = { key: 'phone.copied', vars: {} }; }
      render();
    });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; render(); });
    window.addEventListener('appinstalled', () => { installEvent = null; render(); });
    $('pwaInstall').addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); try { await installEvent.userChoice; } catch { /* closed */ } installEvent = null; render(); });
    if (os === 'windows' || os === 'mac') {
      $('status').textContent = t('status.checking', { app: appName() });
      await refreshProbe();
      render();
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshProbe(); });
      setInterval(() => { if (!document.hidden) refreshProbe(); }, 8000);
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* page works without it */ });
  }
  init();
})();
