/**
 * cursorRenderer — the PURE, electron-free render layer for the AI cursor.
 *
 * This module owns everything needed to *draw* the cursor and project a
 * manager-emitted signal into the window-local payload the in-page renderer
 * consumes:
 *   - {@link CursorSignal} / {@link CursorPayload} data shapes,
 *   - {@link toLocalCss} / {@link buildPayload} / {@link cursorInvocation}
 *     pure projection helpers, and
 *   - {@link BOOTSTRAP_SCRIPT}, the self-contained in-page DOM/animation script.
 *
 * It deliberately imports NOTHING from electron (and only `import type` from
 * `./types`), so the exact same code that ships in the overlay window can be
 * rasterized in a plain Chromium/jsdom context. That is what lets the render
 * smoke test (`tests/e2e/cursor-overlay.e2e.ts`) inject the REAL bootstrap and
 * assert the cursor actually paints visible pixels — a class of regression
 * (invisible cursor: zero opacity, transparent colour, broken payload mapping,
 * content-protection) that the fake-window unit tests cannot catch because they
 * only assert call sequences, never on-screen pixels.
 *
 * {@link CursorOverlay} (in `cursorOverlay.ts`) owns the electron window
 * lifecycle and re-exports these symbols so existing importers are unaffected.
 */

import type { DisplayBounds, MouseButton, Point } from './types';

/** A single visualization request emitted by the manager for a pointer action. */
export interface CursorSignal {
  kind: 'move' | 'click' | 'double' | 'drag' | 'scroll';
  /** Primary action point, in LOGICAL (DIP) screen coordinates. */
  point: Point;
  /** Drag end point, in LOGICAL (DIP) screen coordinates. */
  to?: Point;
  /** Mouse button (right-click is styled distinctly). */
  button?: MouseButton;
  /** Display the action targets; bounds position the overlay window. */
  display: { id: number; bounds: DisplayBounds };
}

/** Local (window-relative) CSS-pixel payload handed to the in-page renderer. */
export interface CursorPayload {
  kind: CursorSignal['kind'];
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  button?: MouseButton;
}

/** Convert a logical screen point to window-local CSS pixels for an overlay at `bounds`. */
export function toLocalCss(point: Point, bounds: DisplayBounds): Point {
  return { x: point.x - bounds.x, y: point.y - bounds.y };
}

/** Project a signal's logical points into the window-local payload sent to the page. */
export function buildPayload(sig: CursorSignal): CursorPayload {
  const p = toLocalCss(sig.point, sig.display.bounds);
  const payload: CursorPayload = { kind: sig.kind, x: p.x, y: p.y };
  if (sig.to) {
    const q = toLocalCss(sig.to, sig.display.bounds);
    payload.x2 = q.x;
    payload.y2 = q.y;
  }
  if (sig.button) {
    payload.button = sig.button;
  }
  return payload;
}

/** Build the JS expression that drives the in-page renderer with a payload. */
export function cursorInvocation(payload: CursorPayload): string {
  return `window.__cu && window.__cu(${JSON.stringify(payload)});`;
}

/**
 * In-page bootstrap: builds the cursor DOM + animations and defines `window.__cu`.
 * Authored as a self-contained, defensively-guarded IIFE with no template
 * interpolation so it can be injected verbatim via `executeJavaScript`.
 */
export const BOOTSTRAP_SCRIPT = `(function () {
  if (window.__cuInit) return;
  window.__cuInit = true;
  var d = document;
  var transparent = 'background:transparent;margin:0;padding:0;width:100%;height:100%;overflow:hidden;pointer-events:none;';
  d.documentElement.style.cssText = transparent;
  d.body.style.cssText = transparent + 'cursor:none;';

  var layer = d.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;';
  d.body.appendChild(layer);

  var ns = 'http://www.w3.org/2000/svg';
  var svg = d.createElementNS(ns, 'svg');
  svg.setAttribute('style', 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;');
  var line = d.createElementNS(ns, 'line');
  line.setAttribute('stroke', 'rgba(139,92,246,0.9)');
  line.setAttribute('stroke-width', '3');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-dasharray', '2 9');
  line.style.opacity = '0';
  svg.appendChild(line);
  layer.appendChild(svg);

  var cur = d.createElement('div');
  cur.style.cssText = 'position:fixed;left:0;top:0;transform:translate(-9999px,-9999px);transition:opacity .25s ease;will-change:transform;z-index:10;';
  var glow = d.createElement('div');
  glow.style.cssText = 'position:absolute;box-sizing:border-box;left:-22px;top:-22px;width:44px;height:44px;border-radius:50%;border:2px solid rgba(167,139,250,0.55);opacity:0;';
  var ring = d.createElement('div');
  ring.style.cssText = 'position:absolute;box-sizing:border-box;left:-17px;top:-17px;width:34px;height:34px;border-radius:50%;border:2px solid rgba(139,92,246,0.95);box-shadow:0 0 16px 4px rgba(139,92,246,0.55),inset 0 0 7px rgba(139,92,246,0.45);background:radial-gradient(circle at 50% 50%,rgba(167,139,250,0.30),rgba(139,92,246,0.04) 70%);transition:transform .16s cubic-bezier(.34,1.56,.64,1);';
  var dot = d.createElement('div');
  dot.style.cssText = 'position:absolute;left:-4px;top:-4px;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 9px 2px rgba(167,139,250,0.95);transition:transform .14s ease;';
  var arrow = d.createElement('div');
  arrow.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" style="position:absolute;left:5px;top:5px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))"><path d="M2 2 L2 17 L6 13 L9 20 L12 18.7 L9 12 L15 12 Z" fill="#fff" stroke="#7c3aed" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  var label = d.createElement('div');
  label.textContent = 'AI';
  label.style.cssText = 'position:absolute;left:20px;top:-27px;font:600 11px/1.4 system-ui,Segoe UI,sans-serif;color:#fff;background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:1px 7px;border-radius:9px;box-shadow:0 2px 8px rgba(99,102,241,.5);letter-spacing:.5px;white-space:nowrap;';
  cur.appendChild(glow);
  cur.appendChild(ring);
  cur.appendChild(arrow);
  cur.appendChild(dot);
  cur.appendChild(label);
  layer.appendChild(cur);

  var curX = -9999, curY = -9999, tgtX = -9999, tgtY = -9999, raf = 0, arriveCb = null;
  var settleWaiters = [];
  function place() { cur.style.transform = 'translate(' + curX + 'px,' + curY + 'px)'; }
  function flushSettle() {
    if (!settleWaiters.length) return;
    var ws = settleWaiters; settleWaiters = [];
    for (var i = 0; i < ws.length; i++) { try { ws[i](); } catch (e) {} }
  }
  function fireArrive() {
    if (arriveCb) { var cb = arriveCb; arriveCb = null; try { cb(); } catch (e) {} }
    flushSettle();
  }
  function tick() {
    raf = 0;
    var dx = tgtX - curX, dy = tgtY - curY;
    if (Math.hypot(dx, dy) < 0.6) { curX = tgtX; curY = tgtY; place(); fireArrive(); return; }
    curX += dx * 0.3; curY += dy * 0.3; place();
    raf = requestAnimationFrame(tick);
  }
  // Glide the cursor to (x,y); onArrive (optional) fires once it lands, so a click's
  // impact is stamped exactly where and when the cursor settles — not faded out mid-glide.
  function moveTo(x, y, instant, onArrive) {
    tgtX = x; tgtY = y; arriveCb = onArrive || null;
    cur.style.opacity = '1';
    if (instant || curX < -9000) { curX = x; curY = y; place(); fireArrive(); }
    else if (!raf) { raf = requestAnimationFrame(tick); }
  }
  function anim(el, frames, opts) {
    try { return el.animate(frames, opts); } catch (e) { return null; }
  }
  // Momentary "tap": ring snaps in then springs back past rest — a crisp click.
  function tap(depth) {
    anim(ring, [
      { transform: 'scale(1)' },
      { transform: 'scale(' + depth + ')', offset: 0.32 },
      { transform: 'scale(1.14)', offset: 0.62 },
      { transform: 'scale(1)' }
    ], { duration: 360, easing: 'ease-out' });
  }
  // Bright core pulse co-located with a click, so the hit point reads clearly.
  function coreFlash() {
    anim(dot, [
      { transform: 'scale(1)' },
      { transform: 'scale(2)', offset: 0.4 },
      { transform: 'scale(1)' }
    ], { duration: 320, easing: 'ease-out' });
  }
  // Sustained "button held down" state used for the whole duration of a drag:
  // the ring stays contracted, the core swells, and a halo breathes outward.
  var held = null;
  function holdStart() {
    if (held) { try { held.cancel(); } catch (e) {} held = null; }
    ring.style.transform = 'scale(0.72)';
    dot.style.transform = 'scale(1.35)';
    glow.style.opacity = '1';
    held = anim(glow, [
      { transform: 'scale(0.78)', opacity: 0.6 },
      { transform: 'scale(1.3)', opacity: 0 }
    ], { duration: 1000, iterations: Infinity, easing: 'ease-out' });
  }
  function holdEnd() {
    ring.style.transform = 'scale(1)';
    dot.style.transform = 'scale(1)';
    glow.style.opacity = '0';
    if (held) { try { held.cancel(); } catch (e) {} held = null; }
  }
  function ripple(x, y, color) {
    var r = d.createElement('div');
    r.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:2px solid ' + color + ';pointer-events:none;z-index:9;';
    layer.appendChild(r);
    function done() { if (r.parentNode) r.parentNode.removeChild(r); }
    var a = anim(r, [
      { transform: 'scale(0.35)', opacity: 0.9 },
      { transform: 'scale(2.6)', opacity: 0 }
    ], { duration: 520, easing: 'cubic-bezier(.22,.61,.36,1)' });
    if (a) { a.onfinish = done; a.oncancel = done; } else { setTimeout(done, 520); }
  }
  // Bold expanding "sonar" ring at the hit point. It travels OUTWARD past the cursor's
  // own glow, so it reads as a clear, deliberate click instead of blending into the
  // cursor — the single most perceptible co-located click signal, while staying elegant.
  function ping(x, y, color) {
    var r = d.createElement('div');
    r.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid ' + color + ';box-shadow:0 0 9px ' + color + ',inset 0 0 5px ' + color + ';pointer-events:none;z-index:9;';
    layer.appendChild(r);
    function done() { if (r.parentNode) r.parentNode.removeChild(r); }
    var a = anim(r, [
      { transform: 'scale(0.4)', opacity: 1 },
      { transform: 'scale(3.4)', opacity: 0 }
    ], { duration: 600, easing: 'cubic-bezier(.22,.61,.36,1)' });
    if (a) { a.onfinish = done; a.oncancel = done; } else { setTimeout(done, 600); }
  }
  function dragTo(x1, y1, x2, y2) {
    moveTo(x1, y1, true); holdStart();
    ripple(x1, y1, 'rgba(139,92,246,0.85)');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x1); line.setAttribute('y2', y1);
    line.style.opacity = '1';
    var p = 0;
    var t = setInterval(function () {
      p += 0.05; if (p > 1) p = 1;
      var ix = x1 + (x2 - x1) * p, iy = y1 + (y2 - y1) * p;
      moveTo(ix, iy, true);
      line.setAttribute('x2', ix); line.setAttribute('y2', iy);
      if (p >= 1) {
        clearInterval(t); holdEnd(); ripple(x2, y2, 'rgba(139,92,246,0.95)');
        setTimeout(function () { line.style.opacity = '0'; }, 260);
      }
    }, 16);
  }
  window.__cu = function (p) {
    try {
      if (!p) return;
      if (p.kind === 'drag' && typeof p.x2 === 'number') { dragTo(p.x, p.y, p.x2, p.y2); return; }
      if (p.kind === 'click' || p.kind === 'double') {
        var hc = p.button === 'right' ? 'rgba(244,114,182,0.95)' : 'rgba(139,92,246,0.95)';
        var dbl = p.kind === 'double';
        moveTo(p.x, p.y, false, function () {
          tap(0.5); coreFlash(); ping(p.x, p.y, hc);
          if (dbl) setTimeout(function () { tap(0.5); coreFlash(); ping(p.x, p.y, hc); }, 170);
        });
        return;
      }
      moveTo(p.x, p.y, false);
      if (p.kind === 'scroll') { tap(0.84); }
    } catch (e) {}
  };
  // Resolve when the cursor has glided to its current target (or after a short
  // safety cap so the caller never blocks). Lets the main process land the real
  // input only once the AI cursor has visibly arrived — "move there, THEN click".
  window.__cuSettle = function () {
    return new Promise(function (resolve) {
      try {
        if (curX === tgtX && curY === tgtY) { resolve(); return; }
        var done = false;
        function fin() { if (done) return; done = true; resolve(); }
        settleWaiters.push(fin);
        setTimeout(fin, 1000);
      } catch (e) { resolve(); }
    });
  };
})();`;
