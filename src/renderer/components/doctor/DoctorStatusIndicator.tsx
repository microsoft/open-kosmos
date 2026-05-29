import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { doctorAnalyzeAtom } from '@/states/doctor.atom';
import AgentQuestionForm from './AgentQuestionForm';
import { doctor_icon } from './Icon';

const TOOLTIP_AUTO_MS = 2000;
const POPOVER_GAP = 4;
const POPOVER_WIDTH = 340;
const TOOLTIP_GAP = 4;

const DoctorStatusIndicator: React.FC = () => {
  const [analyze, actions] = doctorAnalyzeAtom.use();
  const [hovered, setHovered] = useState(false);
  const [autoTooltipUntil, setAutoTooltipUntil] = useState(0);
  const [, force] = useState(0);
  const anchorRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!analyze.step) return;
    setAutoTooltipUntil(analyze.step.at + TOOLTIP_AUTO_MS);
    const timer = setTimeout(() => force((n) => n + 1), TOOLTIP_AUTO_MS);
    return () => clearTimeout(timer);
  }, [analyze.step?.at]);

  if (analyze.status === 'idle') return null;

  const isLoading =
    analyze.status === 'pending' ||
    analyze.status === 'analyzing' ||
    analyze.status === 'creating_issue' ||
    analyze.status === 'waiting_for_user';
  const isDone = analyze.status === 'done';
  const isError = analyze.status === 'error';

  const showAutoTooltip = Date.now() < autoTooltipUntil;
  const terminalTooltip = isDone
    ? 'Diagnosis complete and reported'
    : isError
      ? (analyze.error || 'An error occurred during diagnosis')
      : null;
  const tooltipText = terminalTooltip ?? analyze.step?.info ?? null;
  const tooltipVisible =
    !analyze.question &&
    !!tooltipText &&
    (terminalTooltip ? hovered : (showAutoTooltip || hovered));
  const popoverVisible = !!analyze.question;

  const onClick = () => {
    if (isDone || isError) {
      actions.dismiss();
    }
  };

  const clickable = isDone || isError;

  return (
    <>
      <button
        ref={anchorRef}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={analyze.step?.info || 'Doctor running'}
        type="button"
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent transition-colors hover:bg-white/10 ${
          clickable ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        {isLoading && <LoadingIndicator />}
        {isDone && <CheckCircle2 size={20} className="text-emerald-500" strokeWidth={2.25} />}
        {isError && <AlertTriangle size={20} className="text-red-500" strokeWidth={2.25} />}
      </button>

      {tooltipVisible && tooltipText && (
        <PortalLayer anchorRef={anchorRef} placement="tooltip">
          <div className="max-w-[280px] rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg pointer-events-none flex flex-col items-center gap-1">
            {doctor_icon}
            <span className="text-center leading-snug">{tooltipText}</span>
          </div>
        </PortalLayer>
      )}

      {popoverVisible && analyze.question && (
        <PortalLayer anchorRef={anchorRef} placement="popover">
          <div role="dialog" aria-modal="true">
            <AgentQuestionForm payload={analyze.question} />
          </div>
        </PortalLayer>
      )}

      <style>{`
        @keyframes doctor-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes doctor-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </>
  );
};

const LoadingIndicator: React.FC = () => (
  <div className="relative h-[18px] w-[18px]">
    <svg
      width="18" height="18" viewBox="0 0 20 20" fill="none"
      className="absolute inset-0"
      style={{ animation: 'doctor-pulse 2s ease-in-out infinite' }}
    >
      <circle cx="10" cy="10" r="9" stroke="#3b82f6" strokeOpacity="0.15" strokeWidth="2" />
    </svg>
    <svg
      width="18" height="18" viewBox="0 0 20 20" fill="none"
      className="absolute inset-0"
      style={{ animation: 'doctor-spin 1.2s linear infinite' }}
    >
      <defs>
        <linearGradient id="doctor-grad" x1="0" y1="0" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path
        d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364"
        stroke="url(#doctor-grad)" strokeWidth="2" strokeLinecap="round"
      />
    </svg>
    <svg
      width="18" height="18" viewBox="0 0 20 20" fill="none"
      className="absolute inset-0"
      style={{ animation: 'doctor-pulse 1.5s ease-in-out infinite' }}
    >
      <circle cx="10" cy="10" r="2" fill="#3b82f6" />
    </svg>
  </div>
);

interface PortalLayerProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  placement: 'tooltip' | 'popover';
  children: React.ReactNode;
}
/**
 * Renders children into document.body, positioned above the anchor.
 * Re-positions on scroll/resize to stay glued to the indicator.
 */
const PortalLayer: React.FC<PortalLayerProps> = ({ anchorRef, placement, children }) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const compute = () => {
      const a = anchorRef.current;
      if (!a) return;
      const rect = a.getBoundingClientRect();
      if (placement === 'tooltip') {
        const layerW = layerRef.current?.offsetWidth ?? 0;
        setPos({
          top: rect.top - TOOLTIP_GAP,
          left: rect.left + rect.width / 2 - layerW / 2,
        });
      } else {
        const margin = 8;
        let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
        const maxLeft = window.innerWidth - POPOVER_WIDTH - margin;
        if (left > maxLeft) left = maxLeft;
        if (left < margin) left = margin;
        setPos({ top: rect.top - POPOVER_GAP, left });
      }
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [anchorRef, placement, children]);

  return ReactDOM.createPortal(
    <div
      ref={layerRef}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        transform: 'translateY(-100%)',
        zIndex: placement === 'popover' ? 1000 : 999,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body
  );
};

export default DoctorStatusIndicator;
