import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Square, X, ExternalLink } from 'lucide-react';
import { EmbeddedBrowserAtom } from './embeddedBrowser.atom';
import { embeddedBrowserApi, embeddedBrowserEvents } from '@/ipc/embeddedBrowser';
import { useI18n } from '../../lib/i18n/useI18n';

/**
 * Resizable divider on the LEFT edge of the embedded browser panel.
 * Dragging left grows the panel (see EmbeddedBrowserAtom.startResize).
 */
export const EmbeddedBrowserDivider: React.FC = () => {
  const [{ resizing }, { startResize }] = EmbeddedBrowserAtom.use();
  return (
    <div
      className={`resizable-divider ${resizing ? 'dragging' : ''}`}
      onMouseDown={startResize}
    >
      <div className="divider-handle" />
    </div>
  );
};

interface EmbeddedBrowserPanelProps {
  /** The chat session this panel belongs to; scopes every IPC call. */
  sessionId: string;
}

/**
 * Turn raw address-bar text into a loadable URL:
 *  - http(s) URL → use as-is
 *  - loopback shorthand (localhost:3000, 127.0.0.1:8080, ::1:9229, [::1]:9229) → http://
 *  - any other scheme → reject
 *  - looks like a host (has a dot, no spaces) → prepend https://
 *  - otherwise treat it as a search query
 */
function normalizeAddress(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  const unbracketedIpv6Loopback = text.match(/^::1(?::(\d+))?(\/.*)?$/i);
  if (unbracketedIpv6Loopback) {
    const [, port, path = ''] = unbracketedIpv6Loopback;
    return `http://[::1]${port ? `:${port}` : ''}${path}`;
  }
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(text)) {
    return `http://${text}`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null;
  if (!/\s/.test(text) && /\.[a-z]{2,}/i.test(text)) return `https://${text}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
}

/**
 * In-app browser side panel for a single chat session. The actual web page is
 * rendered by a native WebContentsView in the main process, floating above this
 * panel. This component only renders the chrome (toolbar) and an empty
 * placeholder whose pixel bounds are continuously reported to main so the
 * native view aligns.
 *
 * Mounting calls `show(sessionId)` (reuse or recreate the session's view);
 * unmounting calls `hide(sessionId)` (background it, 5-min idle reclaim). The
 * panel is keyed by sessionId in ChatSide, so switching sessions cleanly
 * unmounts the old panel (→ hide) before mounting the new one (→ show).
 */
export const EmbeddedBrowserPanel: React.FC<EmbeddedBrowserPanelProps> = ({ sessionId }) => {
  const [state, actions] = EmbeddedBrowserAtom.use();
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const session = state.sessions[sessionId];

  // Editable address bar. `addressInput` mirrors the live URL, but while the
  // field is focused we stop syncing so navigation events don't clobber what
  // the user is typing.
  const [addressInput, setAddressInput] = useState('');
  const [addressFocused, setAddressFocused] = useState(false);
  const liveUrl = session?.url ?? '';
  useEffect(() => {
    if (!addressFocused) setAddressInput(liveUrl);
  }, [liveUrl, addressFocused]);

  const submitAddress = () => {
    const url = normalizeAddress(addressInput);
    if (url) actions.navigate(sessionId, url);
  };

  // Bring this session's view to the foreground while mounted; background it on
  // unmount (session switch or user close).
  useEffect(() => {
    void embeddedBrowserApi.show(sessionId);
    return () => {
      void embeddedBrowserApi.hide(sessionId);
    };
  }, [sessionId]);

  // Subscribe to navigation-state events pushed from the main process and route
  // only this session's events into the atom.
  useEffect(() => {
    const unsubscribe = embeddedBrowserEvents.navStateChanged((_e, nav) => {
      if (nav.sessionId !== sessionId) return;
      actions.applyNavState(sessionId, {
        url: nav.url,
        title: nav.title,
        canGoBack: nav.canGoBack,
        canGoForward: nav.canGoForward,
        isLoading: nav.isLoading,
      });
    });
    return unsubscribe;
    // actions is a stable atom action object; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Report the placeholder's pixel bounds to main. WebContentsView.setBounds
  // expects DIPs, so we pass getBoundingClientRect() values directly (no
  // devicePixelRatio scaling). getBoundingClientRect() reflects any in-flight
  // CSS transform, so this also works mid-animation (see the slide-in effect).
  const report = useCallback(() => {
    const el = placeholderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    void embeddedBrowserApi.setBounds(sessionId, {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, [sessionId]);

  // Re-report whenever the placeholder changes size, moves, or the window
  // resizes.
  useEffect(() => {
    const el = placeholderRef.current;
    if (!el) return;

    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener('resize', report);
    report(); // initial

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [sessionId, state.width, report]);

  // Keep the native view aligned with the panel during its slide-in animation.
  // ResizeObserver does NOT fire on transform-only changes, so without this the
  // native WebContentsView would snap to the final x while only the DOM chrome
  // slides. Re-report every frame until the animation ends. The native view has
  // no opacity, so it slides (but cannot fade) in lockstep with the chrome.
  useEffect(() => {
    const panel = panelRef.current;
    const prefersReducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    // No animation to track → report the final position once and stop.
    if (!panel || prefersReducedMotion) {
      report();
      return;
    }

    let rafId = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      report();
      rafId = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(rafId);
      clearTimeout(safetyTimer);
      panel.removeEventListener('animationend', stop);
      report(); // settle on the final bounds
    };

    // Safety net in case `animationend` never fires (e.g. animation overridden).
    const safetyTimer = setTimeout(stop, 400);
    panel.addEventListener('animationend', stop, { once: true });
    rafId = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      clearTimeout(safetyTimer);
      panel.removeEventListener('animationend', stop);
    };
  }, [report]);

  const openExternal = () => {
    if (session?.url) window.open(session.url, '_blank', 'noopener,noreferrer');
  };

  // While a page is loading the reload button becomes a stop button (Chrome-style),
  // and an indeterminate progress bar is shown along the toolbar's bottom edge.
  const isLoading = !!session?.isLoading;

  return (
    <div
      ref={panelRef}
      className="embedded-browser-panel"
      style={{
        // Default (undefined width) → CSS `flex: 1` gives a 50/50 split.
        // After the user drags the divider, pin an explicit pixel width.
        ...(state.width != null ? { flex: `0 0 ${state.width}px` } : null),
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--background, var(--color-white))',
        borderLeft: '1px solid var(--border, rgba(0,0,0,0.1))',
      }}
    >
      {/* Toolbar */}
      <div
        className="embedded-browser-toolbar"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderBottom: '1px solid var(--border, rgba(0,0,0,0.1))',
          flex: '0 0 auto',
        }}
      >
        <button
          className="embedded-browser-btn"
          title={t('browser.back')}
          disabled={!session?.canGoBack}
          onClick={() => actions.goBack(sessionId)}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className="embedded-browser-btn"
          title={t('browser.forward')}
          disabled={!session?.canGoForward}
          onClick={() => actions.goForward(sessionId)}
        >
          <ArrowRight size={16} />
        </button>
        {isLoading ? (
          <button
            className="embedded-browser-btn"
            title={t('browser.stop')}
            onClick={() => actions.stop(sessionId)}
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            className="embedded-browser-btn"
            title={t('browser.reload')}
            onClick={() => actions.reload(sessionId)}
          >
            <RotateCw size={16} />
          </button>
        )}
        <input
          className="embedded-browser-address"
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder={t('browser.addressPlaceholder')}
          title={session?.url}
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onFocus={(e) => {
            setAddressFocused(true);
            e.target.select();
          }}
          onBlur={() => {
            setAddressFocused(false);
            setAddressInput(liveUrl);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitAddress();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setAddressInput(liveUrl);
              (e.target as HTMLInputElement).blur();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid transparent',
            outline: 'none',
            background: 'var(--muted, rgba(0,0,0,0.05))',
            color: 'inherit',
          }}
        />
        <button
          className="embedded-browser-btn"
          title={t('browser.openInSystem')}
          onClick={openExternal}
        >
          <ExternalLink size={16} />
        </button>
        <button
          className="embedded-browser-btn"
          title={t('common.close')}
          onClick={() => actions.close(sessionId)}
        >
          <X size={16} />
        </button>

        {/* Indeterminate loading bar pinned to the toolbar's bottom edge. The
            native WebContentsView covers the surface below, so the progress
            indicator must live in the chrome (here) to stay visible. It reads
            as the top border of the page, Chrome-style. */}
        {isLoading && (
          <div className="embedded-browser-progress" role="progressbar" aria-busy="true">
            <div className="embedded-browser-progress-bar" />
          </div>
        )}
      </div>

      {/* Placeholder region the native WebContentsView floats over. */}
      <div ref={placeholderRef} className="embedded-browser-surface" style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
};
