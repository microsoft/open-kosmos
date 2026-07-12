/**
 * Standalone real-Electron integration probe for the embedded-browser automation
 * PRIMITIVES that the `browser` built-in tool depends on. This is NOT the mocked
 * unit suite — it launches the actual built app and, inside the real main
 * process (app.evaluate), drives a live WebContentsView through the exact same
 * Electron calls EmbeddedBrowserManager uses:
 *   - executeJavaScript(expr, true)         → read_page / wait_for / resolver
 *   - capturePage().toPNG().toString('b64') → screenshot (raw base64, vision)
 *   - debugger.attach('1.3') + sendCommand(Input.*) → CDP trusted click / type
 *
 * It proves these mechanics actually work on this Electron build/host, which the
 * unit tests (which mock the manager) cannot. Run from the project root:
 *   node tests/manual/embedded-browser-primitives.e2e.mjs
 */
import { _electron as electron } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';

const results = [];
const rec = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const PAGE = `data:text/html,${encodeURIComponent(`
<!doctype html><html><head><title>Probe Page</title></head><body>
  <h1>Hello Probe</h1>
  <p>Some visible body text for read_page.</p>
  <a href="https://example.com/">Example Link</a>
  <input id="field" />
  <button id="btn" style="width:120px;height:40px">Submit</button>
  <div id="status">idle</div>
  <script>
    // Simulate a controlled input: mirror value into a data-attr on every input event
    const field = document.getElementById('field');
    field.addEventListener('input', () => { field.setAttribute('data-mirror', field.value); });
    document.getElementById('btn').addEventListener('click', () => {
      document.getElementById('status').textContent = 'clicked';
    });
    // A delayed element to exercise wait_for
    setTimeout(() => {
      const t = document.createElement('div');
      t.id = 'toast'; t.textContent = 'success';
      document.body.appendChild(t);
    }, 400);
  </script>
</body></html>`)}`;

const root = process.cwd();
let app;
try {
  app = await electron.launch({
    args: [root, '--disable-gpu-sandbox', '--no-sandbox'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      OPENKOSMOS_TEST_USER_DATA_PATH: path.join(os.tmpdir(), `openkosmos-eb-primitives-${Date.now()}`),
    },
    timeout: 30000,
  });
  await app.firstWindow({ timeout: 20000 });
  rec('electron app launches', true);

  const out = await app.evaluate(async ({ WebContentsView, BrowserWindow }, page) => {
    const log = [];
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return { fatal: 'no BrowserWindow' };
    win.show();

    // Same webPreferences shape EmbeddedBrowserManager.ensureView uses.
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    const wc = view.webContents;
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 800, height: 600 });

    const waitStop = new Promise((res) => wc.once('did-stop-loading', res));
    await wc.loadURL(page);
    await waitStop;
    await new Promise((r) => setTimeout(r, 150)); // let first paint settle

    const result = {};

    // ── read_page primitive ──
    try {
      const read = await wc.executeJavaScript(`(() => ({
        title: document.title,
        url: location.href,
        text: document.body ? document.body.innerText : '',
        links: Array.from(document.querySelectorAll('a[href]')).map(a => ({ text: a.innerText, href: a.href })),
      }))()`, true);
      result.read = {
        ok: read.title === 'Probe Page' && /Hello Probe/.test(read.text) && read.links.length === 1,
        title: read.title, links: read.links.length,
      };
    } catch (e) { result.read = { ok: false, err: String(e) }; }

    // ── screenshot primitive (raw base64, PNG magic bytes) ──
    try {
      const img = await wc.capturePage();
      const b64 = img.toPNG().toString('base64');
      const buf = Buffer.from(b64, 'base64');
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      result.shot = { ok: b64.length > 100 && isPng && !b64.startsWith('data:'), bytes: buf.length };
    } catch (e) { result.shot = { ok: false, err: String(e) }; }

    // ── CDP type primitive: focus + Input.insertText fires a real input event ──
    try {
      const dbg = wc.debugger;
      if (!dbg.isAttached()) dbg.attach('1.3');
      await wc.executeJavaScript(`document.getElementById('field').focus()`, true);
      await dbg.sendCommand('Input.insertText', { text: 'hello' });
      const typed = await wc.executeJavaScript(`(() => {
        const f = document.getElementById('field');
        return { value: f.value, mirror: f.getAttribute('data-mirror') };
      })()`, true);
      // mirror is only set if a real 'input' event fired (controlled-input proof).
      result.type = { ok: typed.value === 'hello' && typed.mirror === 'hello', ...typed };
    } catch (e) { result.type = { ok: false, err: String(e) }; }

    // ── CDP click primitive: 3-step trusted mouse dispatch triggers handler ──
    try {
      const center = await wc.executeJavaScript(`(() => {
        const r = document.getElementById('btn').getBoundingClientRect();
        return { x: r.left + r.width/2, y: r.top + r.height/2 };
      })()`, true);
      const base = { x: center.x, y: center.y, button: 'left', clickCount: 1 };
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base });
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
      const status = await wc.executeJavaScript(`document.getElementById('status').textContent`, true);
      result.click = { ok: status === 'clicked', status };
    } catch (e) { result.click = { ok: false, err: String(e) }; }

    // ── wait_for primitive: poll until the delayed toast appears ──
    try {
      const start = Date.now();
      let found = false;
      while (Date.now() - start < 3000) {
        found = await wc.executeJavaScript(`!!document.getElementById('toast')`, true);
        if (found) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      result.wait = { ok: found, waitedMs: Date.now() - start };
    } catch (e) { result.wait = { ok: false, err: String(e) }; }

    // ── debugger re-attach guard (gotcha: attach throws if already attached) ──
    try {
      const dbg = wc.debugger;
      // Already attached above; a guarded second attach must be a no-op, while an
      // unguarded re-attach throws. This mirrors EmbeddedBrowserManager.ensureDebugger.
      let threwUnguarded = false;
      try { dbg.attach('1.3'); } catch { threwUnguarded = true; }
      const guardedNoop = dbg.isAttached(); // guard reads this before attaching
      result.dbgGuard = { ok: threwUnguarded && guardedNoop, threwUnguarded, isAttached: guardedNoop };
    } catch (e) { result.dbgGuard = { ok: false, err: String(e) }; }

    // cleanup
    try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch {}
    try { win.contentView.removeChildView(view); } catch {}

    // ── per-session isolation: two independent views hold separate DOM state ──
    try {
      const mk = async (marker) => {
        const v = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
        const stop = new Promise((res) => v.webContents.once('did-stop-loading', res));
        await v.webContents.loadURL('data:text/html,' + encodeURIComponent('<title>' + marker + '</title><body>' + marker));
        await stop;
        return v;
      };
      const a = await mk('SESSION_A');
      const b = await mk('SESSION_B');
      const ta = await a.webContents.executeJavaScript('document.title', true);
      const tb = await b.webContents.executeJavaScript('document.title', true);
      result.isolation = { ok: ta === 'SESSION_A' && tb === 'SESSION_B', a: ta, b: tb };
      try { a.webContents.close(); b.webContents.close(); } catch {}
    } catch (e) { result.isolation = { ok: false, err: String(e) }; }

    return result;
  }, PAGE);

  if (out.fatal) {
    rec('main-process automation', false, out.fatal);
  } else {
    rec('read_page primitive (executeJavaScript)', out.read.ok, `title=${out.read.title} links=${out.read.links ?? out.read.err}`);
    rec('screenshot primitive (capturePage→PNG base64)', out.shot.ok, out.shot.err || `${out.shot.bytes} bytes, PNG, no data: prefix`);
    rec('type primitive (CDP Input.insertText → real input event)', out.type.ok, out.type.err || `value=${out.type.value} mirror=${out.type.mirror}`);
    rec('click primitive (CDP 3-step trusted mouse → handler)', out.click.ok, out.click.err || `status=${out.click.status}`);
    rec('wait_for primitive (poll executeJavaScript)', out.wait.ok, out.wait.err || `found in ${out.wait.waitedMs}ms`);
    rec('debugger re-attach guard (isAttached gate)', out.dbgGuard.ok, out.dbgGuard.err || `unguardedThrew=${out.dbgGuard.threwUnguarded} isAttached=${out.dbgGuard.isAttached}`);
    rec('per-session isolation (two views, separate DOM)', out.isolation.ok, out.isolation.err || `a=${out.isolation.a} b=${out.isolation.b}`);
  }
} catch (e) {
  rec('probe harness', false, e && e.message ? e.message : String(e));
} finally {
  try { await app?.close(); } catch {}
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
