import type { EmbeddedBrowserToolArgs } from './embeddedBrowserToolTypes';

const MAX_TEXT_CHARS = 20000;
const MAX_HEADINGS = 50;
const MAX_LINKS = 100;
const MAX_INSPECT_ELEMENTS = 120;

function diagnosticRedactionPrelude(): string {
  return `const redactDiagnosticUrl = (value) => {
    if (!value) return '';
    try {
      const url = new URL(String(value), location.href);
      if (url.username) url.username = '[redacted]';
      if (url.password) url.password = '[redacted]';
      if (url.hash) url.hash = '#[redacted]';
      const sensitive = /(^|[-_])(access_token|auth|authorization|code|cookie|csrf|xsrf|key|pass|password|pwd|secret|session|sig|signature|token)($|[-_])/i;
      for (const key of Array.from(url.searchParams.keys())) if (sensitive.test(key)) url.searchParams.set(key, '[redacted]');
      return url.toString();
    } catch {
      return /(^|[-_])(access_token|auth|authorization|code|cookie|csrf|xsrf|key|pass|password|pwd|secret|session|sig|signature|token)($|[-_])/i.test(String(value)) ? '[redacted]' : String(value);
    }
  };`;
}

// In-page expression builders ─────────────────────────────────────────────
//
// Each returns a self-contained IIFE string evaluated in the page's main
// world. Caller-supplied selector/text are embedded via JSON.stringify so
// they become valid JS string literals (no injection, correct escaping).

/** Read title/url/visible text/headings/links, all capped. */
export function readPageExpression(): string {
  return `(() => {
    ${diagnosticRedactionPrelude()}
    const cap = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s) || '';
    const text = document.body ? document.body.innerText : '';
    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .slice(0, ${MAX_HEADINGS})
      .map((h) => ({ tag: h.tagName, text: (h.innerText || '').trim().slice(0, 200) }))
      .filter((h) => h.text);
    const links = Array.from(document.querySelectorAll('a[href]'))
      .slice(0, ${MAX_LINKS})
      .map((a) => ({ text: (a.innerText || '').trim().slice(0, 100), href: redactDiagnosticUrl(a.href) }))
      .filter((l) => l.href);
    return { title: document.title, url: redactDiagnosticUrl(location.href), text: cap(text, ${MAX_TEXT_CHARS}), headings, links };
  })()`;
}

export function inspectExpression(): string {
  return `(() => {
    ${diagnosticRedactionPrelude()}
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const labelFor = (el) => {
      if (el.id) {
        const explicit = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (explicit?.innerText) return explicit.innerText;
      }
      return '';
    };
    const accessibleName = (el) => (
      el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') || '').split(/\\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ').trim() ||
      labelFor(el) ||
      el.getAttribute('placeholder') ||
      el.alt ||
      el.title ||
      el.innerText ||
      el.value ||
      ''
    ).trim().slice(0, 160);
    const label = (el) => accessibleName(el);
    const clickableSelector = 'a,button,[role=button],input[type=submit],input[type=button],summary,label,option,[onclick]';
    const focusableSelector = 'a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"]),[contenteditable=true]';
    const mapEl = (el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        type: el.getAttribute('type') || '',
        name: accessibleName(el),
        text: label(el),
        selector: el.id ? '#' + CSS.escape(el.id) : '',
        visible: visible(el),
        disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
        clickable: el.matches(clickableSelector) && visible(el),
        focusable: el.matches(focusableSelector) && visible(el) && !el.disabled,
        ariaExpanded: el.getAttribute('aria-expanded'),
        ariaSelected: el.getAttribute('aria-selected'),
        ariaChecked: el.getAttribute('aria-checked') || (typeof el.checked === 'boolean' ? String(el.checked) : null),
        rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      };
    };
    const elements = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role=button],[role=link],[role=menuitem],summary,label'))
      .slice(0, ${MAX_INSPECT_ELEMENTS})
      .map(mapEl);
    const forms = Array.from(document.forms).slice(0, 20).map((form) => ({
      id: form.id || '',
      name: form.getAttribute('name') || '',
      action: redactDiagnosticUrl(form.action || ''),
      method: form.method || '',
      controls: Array.from(form.elements).slice(0, 50).map((el) => ({
        tag: el.tagName,
        type: el.getAttribute('type') || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        label: label(el),
        disabled: !!el.disabled,
        required: !!el.required,
        valid: typeof el.checkValidity === 'function' ? el.checkValidity() : true,
        validationMessage: el.validationMessage || '',
      })),
    }));
    const dialogs = Array.from(document.querySelectorAll('dialog,[role=dialog],[role=alertdialog],[popover]')).slice(0, 20).map(mapEl);
    return {
      title: document.title,
      url: redactDiagnosticUrl(location.href),
      readyState: document.readyState,
      viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      elements,
      forms,
      dialogs,
      activeElement: document.activeElement ? mapEl(document.activeElement) : null,
    };
  })()`;
}

export function runtimeDiagnosticsExpression(): string {
  return `(() => {
    ${diagnosticRedactionPrelude()}
    const resources = performance.getEntriesByType('resource').slice(-100).map((r) => ({
      name: redactDiagnosticUrl(r.name),
      initiatorType: r.initiatorType || '',
      duration: Math.round(r.duration || 0),
      transferSize: r.transferSize || 0,
      responseStatus: typeof r.responseStatus === 'number' ? r.responseStatus : null,
    }));
    const images = Array.from(document.images).slice(0, 100).map((img) => ({
      src: redactDiagnosticUrl(img.currentSrc || img.src),
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      visible: !!(img.offsetWidth || img.offsetHeight || img.getClientRects().length),
    }));
    const canvases = Array.from(document.querySelectorAll('canvas')).slice(0, 50).map((canvas) => {
      let nonEmpty = null;
      try {
        const ctx = canvas.getContext('2d');
        if (ctx && canvas.width && canvas.height) {
          const data = ctx.getImageData(0, 0, Math.min(canvas.width, 64), Math.min(canvas.height, 64)).data;
          nonEmpty = data.some((v) => v !== 0);
        }
      } catch (e) {}
      return { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight, nonEmpty };
    });
    const videos = Array.from(document.querySelectorAll('video')).slice(0, 50).map((video) => ({
      src: redactDiagnosticUrl(video.currentSrc || video.src),
      readyState: video.readyState,
      paused: video.paused,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    }));
    return {
      readyState: document.readyState,
      location: redactDiagnosticUrl(location.href),
      viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      resources,
      images,
      canvases,
      videos,
    };
  })()`;
}

/**
 * Resolve a click target to its viewport-center coordinates. CSS selector
 * takes precedence; otherwise the shortest visible-text match among common
 * clickable elements wins (so "Submit" picks the button, not its wrapper).
 * Scrolls the element into view first so the rect is on-screen.
 */
export function resolveTargetExpression(args: EmbeddedBrowserToolArgs): string {
  return `(() => {
    ${locatorPrelude(args)}
    const el = resolveLocator();
    const count = el ? 1 : 0;
    if (!el) return { found: false, count: 0 };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return {
      found: true,
      count,
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      tag: el.tagName,
      text: accessibleName(el),
      role: el.getAttribute('role') || '',
    };
  })()`;
}

export function elementRectExpression(args: Pick<EmbeddedBrowserToolArgs, 'selector' | 'text' | 'role' | 'name' | 'exact' | 'frameSelector' | 'shadowSelector' | 'label' | 'placeholder' | 'testId'>): string {
  return `(() => {
    ${locatorPrelude(args)}
    const el = resolveLocator();
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  })()`;
}

/** Focus a field, select its existing value (so typing replaces it). */
export function focusFieldExpression(args: EmbeddedBrowserToolArgs): string {
  return `(() => {
    ${locatorPrelude(args)}
    const el = resolveLocator();
    if (!el) return { found: false };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    if (typeof el.focus === 'function') el.focus();
    try { if (typeof el.select === 'function') el.select(); } catch (e) {}
    const r = el.getBoundingClientRect();
    return {
      found: true,
      count: 1,
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      tag: el.tagName,
      text: accessibleName(el) || el.innerText || el.textContent || '',
      role: el.getAttribute('role') || implicitRole(el),
    };
  })()`;
}

export function clearFieldExpression(args: EmbeddedBrowserToolArgs): string {
  return `(() => {
    ${locatorPrelude(args)}
    const el = resolveLocator();
    if (!el || !('value' in el)) return { found: false };
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true };
  })()`;
}

export function selectOptionExpression(args: EmbeddedBrowserToolArgs, value: string): string {
  const valJson = JSON.stringify(value);
  return `(() => {
    ${locatorPrelude(args)}
    const select = resolveLocator();
    const needle = String(${valJson}).trim().toLowerCase();
    if (!select || select.tagName !== 'SELECT') return { found: false };
    const option = Array.from(select.options).find((opt) =>
      String(opt.value).toLowerCase() === needle || String(opt.textContent || '').trim().toLowerCase() === needle
    );
    if (!option) return { found: false };
    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true, value: option.value, text: option.textContent || '' };
  })()`;
}

export function fileInputObjectExpression(args: EmbeddedBrowserToolArgs): string {
  return `(() => {
    ${locatorPrelude(args)}
    const input = resolveLocator();
    if (!input || input.tagName !== 'INPUT' || String(input.type || '').toLowerCase() !== 'file') {
      return null;
    }
    return input;
  })()`;
}

export function scrollExpression(args: EmbeddedBrowserToolArgs, x: number, y: number): string {
  const toJson = JSON.stringify(args.scrollTo ?? null);
  const percentJson = JSON.stringify(Number.isFinite(args.percent) ? Number(args.percent) : null);
  return `(() => {
    ${locatorPrelude(args)}
    const to = ${toJson};
    const percent = ${percentJson};
    const target = resolveLocator() || window;
    if (!target) return { found: false, error: 'No scroll target matched the selector.' };
    if (target === window) {
      if (to === 'top') window.scrollTo(window.scrollX, 0);
      else if (to === 'bottom') window.scrollTo(window.scrollX, document.documentElement.scrollHeight);
      else if (to === 'left') window.scrollTo(0, window.scrollY);
      else if (to === 'right') window.scrollTo(document.documentElement.scrollWidth, window.scrollY);
      else if (typeof percent === 'number') {
        const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
        window.scrollTo(window.scrollX, maxY * Math.min(Math.max(percent, 0), 100) / 100);
      } else window.scrollBy(${JSON.stringify(x)}, ${JSON.stringify(y)});
      return { found: true, target: 'window', scrollX: window.scrollX, scrollY: window.scrollY };
    }
    if (to === 'top') target.scrollTop = 0;
    else if (to === 'bottom') target.scrollTop = target.scrollHeight;
    else if (to === 'left') target.scrollLeft = 0;
    else if (to === 'right') target.scrollLeft = target.scrollWidth;
    else if (typeof percent === 'number') {
      const maxY = Math.max(0, target.scrollHeight - target.clientHeight);
      target.scrollTop = maxY * Math.min(Math.max(percent, 0), 100) / 100;
    } else target.scrollBy(${JSON.stringify(x)}, ${JSON.stringify(y)});
    return { found: true, target: target.tagName || 'element', scrollLeft: target.scrollLeft, scrollTop: target.scrollTop };
  })()`;
}

export function setSliderExpression(args: EmbeddedBrowserToolArgs, percent: number): string {
  const pctJson = JSON.stringify(Math.min(Math.max(percent, 0), 100));
  return `(() => {
    ${locatorPrelude(args)}
    const el = resolveLocator();
    if (!el) return { found: false };
    const pct = ${pctJson};
    const role = el.getAttribute('role');
    if (el.tagName === 'INPUT' && String(el.type || '').toLowerCase() === 'range') {
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const value = min + (max - min) * pct / 100;
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, value: el.value, percent: pct };
    }
    if (role === 'slider') {
      const min = Number(el.getAttribute('aria-valuemin') || 0);
      const max = Number(el.getAttribute('aria-valuemax') || 100);
      const value = min + (max - min) * pct / 100;
      el.setAttribute('aria-valuenow', String(value));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value) }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, value, percent: pct };
    }
    return { found: false };
  })()`;
}

export function setDateExpression(args: EmbeddedBrowserToolArgs, value: string): string {
  const valueJson = JSON.stringify(value);
  return `(() => {
    ${locatorPrelude(args)}
    const el = resolveLocator();
    if (!el || el.tagName !== 'INPUT' || !['date', 'datetime-local', 'month', 'time', 'week'].includes(String(el.type || '').toLowerCase())) {
      return { found: false };
    }
    el.value = ${valueJson};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true, value: el.value, type: el.type };
  })()`;
}

export function multiSelectExpression(args: EmbeddedBrowserToolArgs, values: string[]): string {
  const valuesJson = JSON.stringify(values);
  return `(() => {
    ${locatorPrelude(args)}
    const select = resolveLocator();
    if (!select || select.tagName !== 'SELECT' || !select.multiple) return { found: false };
    const needles = ${valuesJson}.map((value) => String(value).trim().toLowerCase());
    const selected = [];
    for (const option of Array.from(select.options)) {
      const match = needles.includes(String(option.value).toLowerCase()) ||
        needles.includes(String(option.textContent || '').trim().toLowerCase());
      option.selected = match;
      if (match) selected.push({ value: option.value, text: option.textContent || '' });
    }
    if (selected.length === 0) return { found: false };
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true, selected };
  })()`;
}

export function networkErrorsExpression(): string {
  return `(() => {
    ${diagnosticRedactionPrelude()}
    const failures = performance.getEntriesByType('resource')
      .filter((entry) => typeof entry.responseStatus === 'number' && entry.responseStatus >= 400)
      .slice(-100)
      .map((entry) => ({
        name: redactDiagnosticUrl(entry.name),
        initiatorType: entry.initiatorType || '',
        responseStatus: entry.responseStatus,
        duration: Math.round(entry.duration || 0),
      }));
    return { failures };
  })()`;
}

export function inspectFramesExpression(): string {
  return `(() => {
    ${diagnosticRedactionPrelude()}
    const frames = Array.from(document.querySelectorAll('iframe,frame')).slice(0, 100).map((frame) => {
      const r = frame.getBoundingClientRect();
      let sameOrigin = false;
      let title = '';
      let url = frame.src || '';
      try {
        sameOrigin = !!frame.contentDocument;
        title = frame.contentDocument?.title || '';
        url = frame.contentWindow?.location?.href || url;
      } catch (e) {}
      return {
        tag: frame.tagName,
        src: redactDiagnosticUrl(frame.src || ''),
        name: frame.name || '',
        title,
        url: redactDiagnosticUrl(url),
        sameOrigin,
        visible: r.width > 0 && r.height > 0,
        rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      };
    });
    return { frames };
  })()`;
}

export function layoutAuditExpression(): string {
  return `(() => {
    const viewport = { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth };
    const horizontalOverflow = document.documentElement.scrollWidth > innerWidth + 1;
    const elements = Array.from(document.querySelectorAll('body *')).filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }).slice(0, 500);
    const clipped = [];
    const offscreen = [];
    const overlaps = [];
    const imageAspectAnomalies = [];
    const labelFor = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      const label = labelFor(el);
      if (r.right > innerWidth + 1 || r.left < -1) offscreen.push({ selector: label, x: Math.round(r.x), width: Math.round(r.width) });
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        clipped.push({ selector: label, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
      }
      if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
        const rendered = r.width / r.height;
        const natural = el.naturalWidth / el.naturalHeight;
        const ratioDelta = Math.abs(rendered - natural) / natural;
        if (r.width > 8 && r.height > 8 && ratioDelta > 0.2) {
          imageAspectAnomalies.push({ selector: label, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, renderedWidth: Math.round(r.width), renderedHeight: Math.round(r.height), ratioDelta: Number(ratioDelta.toFixed(2)) });
        }
      }
    }
    const candidates = elements.filter((el) => {
      const tag = el.tagName.toLowerCase();
      return ['button','a','input','select','textarea','summary'].includes(tag) || el.getAttribute('role') || getComputedStyle(el).position === 'fixed';
    }).slice(0, 150);
    for (let i = 0; i < candidates.length && overlaps.length < 50; i++) {
      const a = candidates[i];
      const ar = a.getBoundingClientRect();
      for (let j = i + 1; j < candidates.length && overlaps.length < 50; j++) {
        const b = candidates[j];
        if (a.contains(b) || b.contains(a)) continue;
        const br = b.getBoundingClientRect();
        const width = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
        const height = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
        if (width > 4 && height > 4) {
          overlaps.push({ a: labelFor(a), b: labelFor(b), overlap: { width: Math.round(width), height: Math.round(height) } });
        }
      }
    }
    return { viewport, horizontalOverflow, offscreen: offscreen.slice(0, 50), clipped: clipped.slice(0, 50), overlaps, imageAspectAnomalies: imageAspectAnomalies.slice(0, 50) };
  })()`;
}

export function assertVisibleExpression(args: EmbeddedBrowserToolArgs): string {
  return `(() => {
    ${locatorPrelude(args)}
    const el = resolveLocator();
    if (!el) return { found: false, visible: false };
    return { found: true, visible: visible(el), text: accessibleName(el), tag: el.tagName };
  })()`;
}

export function assertTextExpression(args: EmbeddedBrowserToolArgs): string {
  return `(() => {
    ${locatorPrelude(args)}
    const scopedLocatorRequested = !!(sel || role || name || label || placeholder || testId);
    if (__locatorScopeError) return { found: false, text: '', scoped: true, reason: __locatorScopeError };
    const el = resolveLocator();
    if (!el && scopedLocatorRequested) return { found: false, text: '', scoped: true, reason: 'not_found' };
    const rootText = root ? (root.body?.innerText || root.textContent || '') : '';
    const haystack = el ? (el.innerText || el.value || accessibleName(el) || '') : rootText;
    return { found: matchesText(haystack, txt), text: String(haystack).slice(0, 500), scoped: !!el };
  })()`;
}

export function assertClickableExpression(args: EmbeddedBrowserToolArgs): string {
  return `(() => {
    ${locatorPrelude(args)}
    const el = resolveLocator();
    if (!el) return { found: false, clickable: false, reason: 'not_found' };
    const r = el.getBoundingClientRect();
    if (!visible(el)) return { found: true, clickable: false, reason: 'not_visible', tag: el.tagName };
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { found: true, clickable: false, reason: 'disabled', tag: el.tagName };
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    const style = getComputedStyle(el);
    const receivesPointer = top === el || el.contains(top);
    const clickable = receivesPointer && style.pointerEvents !== 'none';
    return { found: true, clickable, reason: clickable ? 'clickable' : 'covered', tag: el.tagName, topTag: top?.tagName || null, rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
  })()`;
}

export function enabledStateExpression(args: EmbeddedBrowserToolArgs): string {
  return `(() => {
    ${locatorPrelude(args)}
    const el = resolveLocator();
    if (!el) return { found: false, enabled: false, reason: 'not_found' };
    const disabled = !!el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('fieldset[disabled]') !== null;
    return { found: true, enabled: !disabled, disabled, tag: el.tagName, text: accessibleName(el) };
  })()`;
}

export function notBlankExpression(): string {
  return `(() => {
    const bodyText = (document.body?.innerText || '').trim();
    const visibleElements = Array.from(document.querySelectorAll('body *')).filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    }).length;
    const mediaElements = document.querySelectorAll('img,svg,canvas,video,iframe').length;
    const blank = bodyText.length === 0 && visibleElements === 0 && mediaElements === 0;
    return { blank, textLength: bodyText.length, visibleElements, mediaElements, readyState: document.readyState };
  })()`;
}

export function imagesLoadedExpression(): string {
  return `(() => {
    ${diagnosticRedactionPrelude()}
    const images = Array.from(document.images).slice(0, 200).map((img) => ({
      src: redactDiagnosticUrl(img.currentSrc || img.src),
      alt: img.alt || '',
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      renderedWidth: Math.round(img.getBoundingClientRect().width),
      renderedHeight: Math.round(img.getBoundingClientRect().height),
    }));
    const failures = images.filter((img) => !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0);
    return { passed: failures.length === 0, total: images.length, failures, images };
  })()`;
}

export function mediaRenderedExpression(args: EmbeddedBrowserToolArgs): string {
  const selector = JSON.stringify(args.selector ?? null);
  return `(() => {
    ${diagnosticRedactionPrelude()}
    const scope = ${selector} ? [document.querySelector(${selector})].filter(Boolean) : Array.from(document.querySelectorAll('canvas,video,svg,[role="img"]'));
    const canvases = scope.filter((el) => el instanceof HTMLCanvasElement).map((canvas) => {
      let nonEmpty = false;
      try {
        const ctx = canvas.getContext('2d');
        if (ctx && canvas.width && canvas.height) {
          const data = ctx.getImageData(0, 0, Math.min(canvas.width, 64), Math.min(canvas.height, 64)).data;
          for (let i = 3; i < data.length; i += 4) { if (data[i] !== 0 || data[i - 1] !== 0 || data[i - 2] !== 0 || data[i - 3] !== 0) { nonEmpty = true; break; } }
        }
      } catch (e) {
        nonEmpty = canvas.width > 0 && canvas.height > 0 && canvas.clientWidth > 0 && canvas.clientHeight > 0;
      }
      return { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight, nonEmpty };
    });
    const videos = scope.filter((el) => el instanceof HTMLVideoElement).map((video) => ({
      src: redactDiagnosticUrl(video.currentSrc || video.src),
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      renderedWidth: Math.round(video.getBoundingClientRect().width),
      renderedHeight: Math.round(video.getBoundingClientRect().height),
    }));
    const svgs = scope.filter((el) => el instanceof SVGElement || el.getAttribute?.('role') === 'img').map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, renderedWidth: Math.round(r.width), renderedHeight: Math.round(r.height), children: el.children?.length ?? 0 };
    });
    const passed = canvases.some((c) => c.nonEmpty) || videos.some((v) => v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) || svgs.some((s) => s.renderedWidth > 0 && s.renderedHeight > 0);
    return { passed, canvases, videos, svgs };
  })()`;
}

export function dialogOpenExpression(args: EmbeddedBrowserToolArgs): string {
  const text = JSON.stringify(args.text ?? null);
  return `(() => {
    const expectedText = ${text};
    const dialogs = Array.from(document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]')).filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const open = el instanceof HTMLDialogElement ? el.open : true;
      return open && r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map((el) => ({ tag: el.tagName, role: el.getAttribute('role'), text: (el.innerText || el.textContent || '').trim().slice(0, 500) }));
    const matches = expectedText ? dialogs.filter((dialog) => dialog.text.toLowerCase().includes(String(expectedText).trim().toLowerCase())) : dialogs;
    return { found: matches.length > 0, count: dialogs.length, dialogs: matches.slice(0, 10) };
  })()`;
}

export function toastExpression(args: EmbeddedBrowserToolArgs): string {
  const text = JSON.stringify(args.text ?? null);
  return `(() => {
    const expectedText = ${text};
    const selectors = '[role="status"],[role="alert"],[aria-live],.toast,.Toast,.notification,.Notification,.snackbar,.Snackbar';
    const toasts = Array.from(document.querySelectorAll(selectors)).filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map((el) => ({ tag: el.tagName, role: el.getAttribute('role'), ariaLive: el.getAttribute('aria-live'), text: (el.innerText || el.textContent || '').trim().slice(0, 500) }));
    const matches = expectedText ? toasts.filter((toast) => toast.text.toLowerCase().includes(String(expectedText).trim().toLowerCase())) : toasts;
    return { found: matches.length > 0, count: toasts.length, toasts: matches.slice(0, 10) };
  })()`;
}

export function tableRowsExpression(args: EmbeddedBrowserToolArgs): string {
  const selector = JSON.stringify(args.selector ?? null);
  return `(() => {
    const table = ${selector} ? document.querySelector(${selector}) : document.querySelector('table,[role="table"],[role="grid"]');
    if (!table) return { found: false, rowCount: 0, rows: [] };
    const rows = Array.from(table.querySelectorAll('tbody tr,[role="row"]')).filter((row) => {
      const r = row.getBoundingClientRect();
      const style = getComputedStyle(row);
      return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map((row) => (row.innerText || row.textContent || '').trim().slice(0, 500));
    return { found: true, rowCount: rows.length, rows: rows.slice(0, 20) };
  })()`;
}

export function formValidityExpression(args: EmbeddedBrowserToolArgs): string {
  const selector = JSON.stringify(args.selector ?? null);
  return `(() => {
    const form = ${selector} ? document.querySelector(${selector}) : document.querySelector('form');
    if (!form) return { found: false, valid: false, invalidControls: [] };
    const controls = Array.from(form.querySelectorAll('input,select,textarea')).filter((el) => !el.disabled);
    const invalidControls = controls.filter((el) => typeof el.checkValidity === 'function' && !el.checkValidity()).map((el) => ({
      tag: el.tagName,
      name: el.getAttribute('name') || '',
      id: el.id || '',
      validationMessage: el.validationMessage || '',
      valueMissing: !!el.validity?.valueMissing,
      typeMismatch: !!el.validity?.typeMismatch,
      patternMismatch: !!el.validity?.patternMismatch,
    }));
    return { found: true, valid: typeof form.checkValidity === 'function' ? form.checkValidity() : invalidControls.length === 0, invalidControls, controlCount: controls.length };
  })()`;
}

export function semanticContainerExpression(args: EmbeddedBrowserToolArgs, kind: 'menu' | 'tooltip' | 'drawer' | 'card'): string {
  const text = JSON.stringify(args.text ?? null);
  const selectorByKind = {
    menu: '[role="menu"],[role="menubar"],[data-radix-menu-content],.menu,.Menu',
    tooltip: '[role="tooltip"],[data-radix-tooltip-content],.tooltip,.Tooltip',
    drawer: '[role="dialog"][data-side],.drawer,.Drawer,.sheet,.Sheet,[data-radix-dialog-content]',
    card: '[role="article"],article,.card,.Card,[data-card]',
  }[kind];
  return `(() => {
    const expectedText = ${text};
    const items = Array.from(document.querySelectorAll(${JSON.stringify(selectorByKind)})).filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map((el) => ({ tag: el.tagName, role: el.getAttribute('role'), text: (el.innerText || el.textContent || '').trim().slice(0, 500) }));
    const matches = expectedText ? items.filter((item) => item.text.toLowerCase().includes(String(expectedText).trim().toLowerCase())) : items;
    return { found: matches.length > 0, count: items.length, matches: matches.slice(0, 10) };
  })()`;
}

export function listItemsExpression(args: EmbeddedBrowserToolArgs): string {
  const selector = JSON.stringify(args.selector ?? null);
  return `(() => {
    const list = ${selector} ? document.querySelector(${selector}) : document.querySelector('ul,ol,[role="list"],[role="listbox"]');
    if (!list) return { found: false, itemCount: 0, items: [] };
    const items = Array.from(list.querySelectorAll('li,[role="listitem"],[role="option"]')).filter((item) => {
      const r = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map((item) => (item.innerText || item.textContent || '').trim().slice(0, 500));
    return { found: true, itemCount: items.length, items: items.slice(0, 50) };
  })()`;
}

/** Boolean existence check for wait_for (selector match or visible text). */
export function existsExpression(args: EmbeddedBrowserToolArgs): string {
  const txtJson = JSON.stringify(args.text ?? null);
  return `(() => {
    ${locatorPrelude(args)}
    const txt = ${txtJson};
    if (__locatorScopeError) return false;
    if (resolveLocator()) return true;
    if (txt) return !!(document.body && document.body.innerText.toLowerCase().includes(String(txt).trim().toLowerCase()));
    return false;
  })()`;
}

function locatorPrelude(args: Pick<EmbeddedBrowserToolArgs, 'selector' | 'text' | 'role' | 'name' | 'exact' | 'frameSelector' | 'shadowSelector' | 'label' | 'placeholder' | 'testId'>): string {
  const selJson = JSON.stringify(args.selector ?? null);
  const txtJson = JSON.stringify(args.text ?? null);
  const roleJson = JSON.stringify(args.role ?? null);
  const nameJson = JSON.stringify(args.name ?? null);
  const exactJson = JSON.stringify(!!args.exact);
  const frameJson = JSON.stringify(args.frameSelector ?? null);
  const shadowJson = JSON.stringify(args.shadowSelector ?? null);
  const labelJson = JSON.stringify(args.label ?? null);
  const placeholderJson = JSON.stringify(args.placeholder ?? null);
  const testIdJson = JSON.stringify(args.testId ?? null);
  return `
    const sel = ${selJson};
    const txt = ${txtJson};
    const role = ${roleJson};
    const name = ${nameJson};
    const exact = ${exactJson};
    const frameSelector = ${frameJson};
    const shadowSelector = ${shadowJson};
    const label = ${labelJson};
    const placeholder = ${placeholderJson};
    const testId = ${testIdJson};
    let __locatorScopeError = null;
    const rootDocument = (() => {
      if (!frameSelector) return document;
      const frame = document.querySelector(frameSelector);
      if (!frame) { __locatorScopeError = 'frame not found'; return null; }
      try {
        const doc = frame.contentDocument || frame.contentWindow?.document;
        if (!doc) __locatorScopeError = 'frame inaccessible';
        return doc;
      } catch (e) { __locatorScopeError = 'frame inaccessible'; return null; }
    })();
    const root = (() => {
      if (!rootDocument) return null;
      if (!shadowSelector) return rootDocument;
      const host = rootDocument.querySelector(shadowSelector);
      if (!host) { __locatorScopeError = 'shadow host not found'; return null; }
      if (!host.shadowRoot) { __locatorScopeError = 'shadow root unavailable'; return null; }
      return host.shadowRoot;
    })();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const labelFor = (el) => {
      if (el.id) {
        const explicit = root.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (explicit?.innerText) return explicit.innerText;
      }
      const wrapped = el.closest?.('label');
      return wrapped?.innerText || '';
    };
    const accessibleName = (el) => (
      el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') || '').split(/\\s+/).map((id) => root.getElementById?.(id)?.innerText || '').join(' ').trim() ||
      labelFor(el) ||
      el.getAttribute('placeholder') ||
      el.alt ||
      el.title ||
      el.innerText ||
      el.value ||
      ''
    ).trim();
    const matchesText = (value, needle) => {
      const a = String(value || '').trim().toLowerCase();
      const b = String(needle || '').trim().toLowerCase();
      return b && (exact ? a === b : a.includes(b));
    };
    const all = (query) => Array.from(root.querySelectorAll(query)).filter(visible);
    const implicitRole = (el) => {
      const tag = el.tagName;
      if (tag === 'A' && el.href) return 'link';
      if (tag === 'BUTTON') return 'button';
      if (tag === 'SELECT') return 'combobox';
      if (tag === 'TEXTAREA') return 'textbox';
      if (tag === 'INPUT') {
        const type = String(el.type || 'text').toLowerCase();
        if (['button', 'submit', 'reset'].includes(type)) return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        return 'textbox';
      }
      return '';
    };
    const resolveLocator = () => {
      if (__locatorScopeError || !root) return null;
      if (sel) return root.querySelector(sel);
      if (testId) {
        const escaped = CSS.escape(String(testId));
        return root.querySelector('[data-testid="' + escaped + '"],[data-test-id="' + escaped + '"],[data-test="' + escaped + '"]');
      }
      if (placeholder) {
        const matches = all('input,textarea').filter((el) => matchesText(el.getAttribute('placeholder'), placeholder));
        return matches[0] || null;
      }
      if (label) {
        const matches = all('input,textarea,select,button,[role]').filter((el) => matchesText(labelFor(el), label));
        return matches[0] || null;
      }
      if (role || name) {
        const matches = all('[role],a,button,input,textarea,select,summary,label,[onclick]').filter((el) => {
          const actualRole = el.getAttribute('role') || implicitRole(el);
          if (role && actualRole.toLowerCase() !== String(role).toLowerCase()) return false;
          return name ? matchesText(accessibleName(el), name) : true;
        });
        return matches[0] || null;
      }
      if (txt) {
        const matches = all('a,button,[role=button],input[type=submit],input[type=button],summary,label,option,[onclick],li,span,div').filter((el) =>
          matchesText(el.innerText || el.value || el.getAttribute('aria-label'), txt)
        );
        matches.sort((a, b) => (accessibleName(a) || '').length - (accessibleName(b) || '').length);
        return matches[0] || null;
      }
      return null;
    };
  `;
}

// ── helpers ──────────────────────────────────────────────────────────────

/** Add a scheme when missing: localhost/loopback → http, otherwise https. */
