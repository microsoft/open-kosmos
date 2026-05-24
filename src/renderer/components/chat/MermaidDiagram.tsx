import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Maximize2 } from 'lucide-react';
import MermaidFullscreenView from './MermaidFullscreenView';

let mermaidIdCounter = 0;
let mermaidInitialized = false;
// Lazy-loaded mermaid module cache
let mermaidCache: typeof import('mermaid').default | null = null;

const getMermaid = async (): Promise<typeof import('mermaid').default> => {
  if (!mermaidCache) {
    const mod = await import(/* webpackChunkName: "mermaid" */ 'mermaid');
    mermaidCache = mod.default;
  }
  return mermaidCache;
};

const initMermaid = async () => {
  if (!mermaidInitialized) {
    const mermaid = await getMermaid();
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'Segoe Sans, -apple-system, BlinkMacSystemFont, sans-serif',
    });
    mermaidInitialized = true;
  }
};

interface MermaidDiagramProps {
  definition: string;
}

const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ definition }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const idRef = useRef<string>(`mermaid-${++mermaidIdCounter}`);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!definition.trim()) return;

    let cancelled = false;

    const renderDiagram = async () => {
      try {
        await initMermaid();
        const mermaid = await getMermaid();
        const { svg: renderedSvg } = await mermaid.render(idRef.current, definition.trim());
        if (!cancelled) {
          setSvg(renderedSvg);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSvg('');
        }
        // mermaid.render may insert an error element into the DOM on failure; clean it up
        const errorElement = document.getElementById(`d${idRef.current}`);
        if (errorElement) {
          errorElement.remove();
        }
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [definition]);

  const openFullscreen = useCallback(() => {
    // Move the SVG DOM node into the fullscreen overlay to avoid duplicating it
    // (duplicate SVG IDs cause rendering artifacts). We hide the inline wrapper
    // while fullscreen is open and restore it on close.
    setIsFullscreen(true);
  }, []);

  const closeFullscreen = useCallback(() => {
    setIsFullscreen(false);
  }, []);

  if (error) {
    return (
      <div className="mermaid-diagram-wrapper mermaid-diagram-error">
        <div className="mermaid-error-label">Mermaid diagram error</div>
        <pre className="mermaid-error-code">{definition}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="mermaid-diagram-wrapper mermaid-diagram-loading">
        <pre className="mermaid-loading-code">{definition}</pre>
      </div>
    );
  }

  return (
    <>
      <div
        ref={wrapperRef}
        className="mermaid-diagram-wrapper mermaid-diagram-wrapper-interactive"
        style={isFullscreen ? { visibility: 'hidden' } : undefined}
      >
        <button
          className="mermaid-fullscreen-btn"
          onClick={openFullscreen}
          title="Fullscreen"
        >
          <Maximize2 size={8} />
        </button>
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>

      {isFullscreen && (
        <MermaidFullscreenView svgHtml={svg} onClose={closeFullscreen} />
      )}
    </>
  );
};

export default MermaidDiagram;
