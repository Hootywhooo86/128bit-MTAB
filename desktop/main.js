// 128bitPlay for Windows: serves the app's web export (./web) from app://128bit/ in a
// desktop window. Signs in to the same account server as the phone and TV apps.
const { app, BrowserWindow, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, 'web');
const HOME = 'app://128bit/';

// Standard + secure so storage (sign-in, settings) persists and fetch/media work like https.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

function serve() {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    const file = path.join(ROOT, rel);
    // Routes like /title or /settings/account have no file: hand them the app shell.
    const inside = file.startsWith(ROOT) && path.extname(file);
    return net.fetch(pathToFileURL(inside ? file : path.join(ROOT, 'index.html')).toString());
  });
  // Addons, TorBox and book sites aren't built for browsers; drop the Origin some of them reject.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (d, done) => {
    delete d.requestHeaders.Origin;
    done({ requestHeaders: d.requestHeaders });
  });
}

function open() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: '128bitPlay',
    // webSecurity off = no CORS, the same as the phone apps.
    webPreferences: { webSecurity: false, contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.loadURL(HOME);
  // Links to other sites (TorBox, Trakt sign-in, downloads) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(HOME)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  const nav = win.webContents.navigationHistory;
  // Mouse back/forward buttons, Alt+←/→, F11 = full screen.
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward' && nav.canGoBack()) nav.goBack();
    if (cmd === 'browser-forward' && nav.canGoForward()) nav.goForward();
  });
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.alt && i.key === 'ArrowLeft' && nav.canGoBack()) nav.goBack();
    else if (i.alt && i.key === 'ArrowRight' && nav.canGoForward()) nav.goForward();
    else if (i.key === 'F11') win.setFullScreen(!win.isFullScreen());
    else return;
    e.preventDefault();
  });
  return win;
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(() => {
  serve();
  open();
});
app.on('window-all-closed', () => app.quit());
