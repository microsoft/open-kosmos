import { memo, useEffect } from "react";
import SchedulesSidepane from "./SchedulesSidepane";
import SubAgentTasksSidepane from "./SubAgentTasksSidepane";
import MemexMemorySidepane from "./MemexMemorySidepane";
import WorkspaceExplorerSidepane from "./workspace/WorkspaceExplorerSidepane";
import { useCurrentChatSessionId } from "../../lib/chat/agentChatSessionCacheManager";
import {
  WorkspaceExplorerAtom,
  ScheduleSidepaneAtom,
  SubAgentTasksSidepaneAtom,
  MemexMemorySidepaneAtom,
} from "./chat-side.atom";
import { EmbeddedBrowserAtom, isBrowserOpenFor } from "../browser/embeddedBrowser.atom";
import { EmbeddedBrowserPanel, EmbeddedBrowserDivider } from "../browser/EmbeddedBrowserPanel";
import { embeddedBrowserApi, embeddedBrowserEvents } from "../../ipc/embeddedBrowser";


function ChatSide(props: {
  onSelectScheduledSession?: (sessionId: string) => void | Promise<void>;
}) {
  const currentSessionId = useCurrentChatSessionId();
  const [workspaceState, workspaceActions] = WorkspaceExplorerAtom.use();
  const [scheduleVisible] = ScheduleSidepaneAtom.use();
  const [subAgentState] = SubAgentTasksSidepaneAtom.use();
  const [memexState] = MemexMemorySidepaneAtom.use();
  const [browserState, browserActions] = EmbeddedBrowserAtom.use();
  const browserOpen = isBrowserOpenFor(browserState, currentSessionId);

  useEffect(() => {
    void embeddedBrowserApi.setActiveSession(currentSessionId ?? null);
    return () => {
      void embeddedBrowserApi.setActiveSession(null);
    };
  }, [currentSessionId]);

  // Any of the four singleton sidepanes being visible.
  const anySidepaneVisible =
    workspaceState.visible || scheduleVisible || subAgentState.visible || memexState.visible;

  useEffect(() => {
    (window as any).__inlineFilePreviewEnabled = true;

    // File-open requests arrive as a capture-phase CustomEvent. We open the file
    // in the Workspace Explorer's Preview mode. `detail.origin === 'tree'` (set by
    // the workspace file tree) gives the back-arrow flavor; everything else
    // (chat file chips, tool results, attachments) is a 'chat'-origin preview.
    const handleFileViewerOpen = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { file, origin } = customEvent.detail || {};
      if (file && file.name && file.url) {
        (customEvent as any)._inlineHandled = true;
        customEvent.preventDefault?.();
        customEvent.stopImmediatePropagation?.();
        workspaceActions.openPreview(file, origin === 'tree' ? 'tree' : 'chat');
      }
    };
    window.addEventListener('fileViewer:open', handleFileViewerOpen, true);
    return () => {
      (window as any).__inlineFilePreviewEnabled = false;
      window.removeEventListener('fileViewer:open', handleFileViewerOpen, true);
    };
    // workspaceActions is a stable atom action object; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mutual exclusion (direction 1): opening any singleton sidepane closes the
  // per-session browser panel. The reverse (browser open closes the sidepanes)
  // lives in EmbeddedBrowserAtom.open/toggle/revealForAutomation. This lives in
  // the component, not the atom, because the browser is session-scoped (the atom
  // would need the current sessionId, which is a renderer concern).
  useEffect(() => {
    if (anySidepaneVisible && currentSessionId && browserOpen) {
      browserActions.close(currentSessionId);
    }
    // browserActions is a stable atom action object; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anySidepaneVisible, currentSessionId, browserOpen]);

  // Auto-open the browser panel when an agent drives a session's view via the
  // `browser` built-in tool. The main process has already created and navigated
  // the native view; we only reveal the panel and mirror the URL (never re-open,
  // which would double-navigate). Subscribed here because ChatSide is always
  // mounted, so this fires even for a session whose panel isn't currently shown.
  useEffect(() => {
    return embeddedBrowserEvents.panelOpenRequested((_e, req) => {
      browserActions.revealForAutomation(req.sessionId, req.url);
    });
    // browserActions is a stable atom action object; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The per-session in-app browser takes priority over the default sidepanes.
  // Keyed by sessionId so a session switch unmounts the old panel (→ hide) before
  // mounting the new one (→ show).
  if (browserOpen && currentSessionId) {
    return (
      <>
        <EmbeddedBrowserDivider />
        <EmbeddedBrowserPanel sessionId={currentSessionId} key={currentSessionId} />
      </>
    );
  }

  return (
    <>
      <SubAgentTasksSidepane />
      <MemexMemorySidepane />
      <SchedulesSidepane onSelectSession={props.onSelectScheduledSession} />
      {/* Workspace Explorer Sidepane — also hosts the file Preview view mode */}
      <WorkspaceExplorerSidepane />
    </>
  );
}


export default memo(ChatSide);
