/**
 * Orin AI Desktop — Electron main.js
 * Persistent WebView of orinai.org + auto-starting Python executor agent.
 */
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');

const APP_URL = 'https://orinai.org';
const ALLOWED_HOSTS = new Set(['orinai.org', 'www.orinai.org']);
const SESSION_PARTITION = 'persist:orin-main';

// Bump whenever bundled agent scripts change so installs refresh stale copies.
const AGENT_VERSION = '2';

let win = null, tray = null, agentProc = null;
app.isQuitting = false;

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
  } catch { return false; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1300, height: 880, minWidth: 900, minHeight: 600,
    title: 'Orin AI', icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: SESSION_PARTITION,
      contextIsolation: true, nodeIntegration: false, webSecurity: true,
    },
    show: false, backgroundColor: '#0f172a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });
  win.loadURL(APP_URL + '/#agent?panel=desktop');
  win.once('ready-to-show', () => {
    // Spoof UA so Google/Firebase treat this as a real Chrome browser
    win.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );
    win.show();
  });

  // Popups to non-orinai origins go to the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedUrl(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  // In-frame navigation is restricted to orinai.org — every other origin opens
  // externally. This keeps the window.orinDesktop bridge away from third-party pages.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  const img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(img.resize({ width: 16, height: 16 }));
  tray.setToolTip('Orin AI');
  const rebuild = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Orin AI',   click: () => { win?.show(); win?.focus(); } },
    { label: 'Agent Mode',     click: () => { win?.show(); win?.loadURL(APP_URL + '/#agent?panel=desktop'); } },
    { type: 'separator' },
    { label: agentProc ? '● PC Agent running' : '○ PC Agent stopped', enabled: false },
    { label: agentProc ? 'Stop Agent' : 'Start Agent',
      click: () => agentProc ? stopAgent() : startAgent() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  rebuild(); tray.on('click', () => win?.show());
  ipcMain.on('agent-state-changed', rebuild);
}

function findPython() {
  const candidates = ['python3','python','py'];
  for (const c of candidates) {
    try { const result = spawnSync(c, ['--version'], { stdio: 'ignore', shell: false }); if (result.status === 0) return c; } catch {}
  }
  return 'python';
}

/** Copies bundled agent scripts into userData, refreshing them when AGENT_VERSION changes. */
function syncAgentScripts() {
  const userData = app.getPath('userData');
  const versionFile = path.join(userData, '.agent_version');
  const needsCopy = !fs.existsSync(versionFile) || fs.readFileSync(versionFile, 'utf8').trim() !== AGENT_VERSION;
  const files = [
    ['agent.py', 'agent.py'],
    ['executor.py', 'executor.py'],
    ['broker_client.py', 'broker_client.py'],
  ];
  let copied = false;
  for (const [src, dst] of files) {
    const srcPath = path.join(__dirname, 'assets', src);
    const dstPath = path.join(userData, dst);
    if (!fs.existsSync(srcPath)) continue;
    if (needsCopy || !fs.existsSync(dstPath)) {
      fs.copyFileSync(srcPath, dstPath);
      copied = true;
    }
  }
  if (copied || !fs.existsSync(versionFile)) {
    fs.writeFileSync(versionFile, AGENT_VERSION);
  }
  return path.join(userData, 'agent.py');
}

function startAgent() {
  if (agentProc) return { ok: true, status: 'already_running' };
  syncAgentScripts();
  const agentPath = path.join(app.getPath('userData'), 'agent.py');
  if (!fs.existsSync(agentPath))
    return { ok: false, error: 'agent.py not found. Download from orinai.org/agent' };

  const py = findPython();
  agentProc = spawn(py, [agentPath], {
    cwd: app.getPath('userData'), detached: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  agentProc.stdout?.on('data', d => console.log('[agent]', d.toString().trim()));
  agentProc.stderr?.on('data', d => console.warn('[agent err]', d.toString().trim()));
  agentProc.on('exit', () => { agentProc = null; ipcMain.emit('agent-state-changed'); });
  ipcMain.emit('agent-state-changed');
  return { ok: true, status: 'running' };
}

function stopAgent() {
  if (agentProc) { agentProc.kill(); agentProc = null; }
  ipcMain.emit('agent-state-changed');
}

/**
 * One-click pairing from the website:
 * stages {pair_id, pair_code} into the agent's state file, then (re)starts the
 * agent so it completes the handshake itself and begins polling.
 */
ipcMain.handle('register-agent', async (_event, payload) => {
  const pairId = String(payload?.pair_id || '').trim();
  const pairCode = String(payload?.pair_code || '').trim().toUpperCase();
  if (!/^[0-9a-f]{32}$/.test(pairId)) return { ok: false, error: 'invalid pair_id' };
  if (!/^[A-Z0-9]{6}$/.test(pairCode)) return { ok: false, error: 'invalid pair_code' };

  const stateFile = path.join(require('os').homedir(), '.orin_agent.json');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  state.pending_pair = { pair_id: pairId, pair_code: pairCode };
  delete state.pair_id;
  delete state.hmac_secret;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

  // Restart so the fresh state is picked up at startup
  if (agentProc) stopAgent();
  setTimeout(() => startAgent(), 500);
  return { ok: true };
});

/**
 * Browser-based sign-in (device flow):
 *  1. Ask the Orin backend for a device code
 *  2. Open orinai.org/#device-auth?code=<USER-CODE> in the system browser
 *  3. Poll until the user approves (or timeout)
 *  4. Resolve with a Firebase custom token the renderer exchanges for a session
 */
async function browserLogin() {
  const res = await fetch('https://orinai.org/api/auth/device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start' }),
  });
  if (!res.ok) throw new Error(`Could not start sign-in (HTTP ${res.status})`);
  const start = await res.json();
  shell.openExternal(start.verify_url);

  const deadline = Date.now() + Math.min(start.expires_in || 600, 900) * 1000;
  const intervalMs = Math.max((start.interval || 3) * 1000, 2000);
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const poll = await fetch('https://orinai.org/api/auth/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'token', device_code: start.device_code }),
      });
      if (!poll.ok) continue;
      const data = await poll.json();
      if (data.status === 'approved') return { ok: true, customToken: data.custom_token };
      if (data.status === 'denied') return { ok: false, error: 'Sign-in was denied in the browser.' };
      if (data.status === 'expired') return { ok: false, error: 'Sign-in request expired. Try again.' };
    } catch { /* transient network error — keep polling */ }
  }
  return { ok: false, error: 'Sign-in timed out. Try again.' };
}

ipcMain.handle('browser-login', async () => {
  try { return await browserLogin(); }
  catch (e) { return { ok: false, error: e?.message || 'Sign-in failed' }; }
});

ipcMain.handle('start-local-agent', async () => startAgent());
ipcMain.handle('stop-local-agent',  async () => { stopAgent(); return { ok: true }; });
ipcMain.handle('agent-status',      async () => ({ running: !!agentProc }));

app.whenReady().then(() => {
  createWindow(); createTray();
  // Auto-start agent shortly after launch (it waits for pairing state)
  setTimeout(() => startAgent(), 3000);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) createWindow(); else win.show(); });
app.on('before-quit', () => { app.isQuitting = true; stopAgent(); });
