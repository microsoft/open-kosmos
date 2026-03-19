import React, { useRef } from 'react';

function triggerPointDown(el: HTMLElement) {
  const pointerDownEvent = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    view: window,
    pointerType: 'mouse',
  });
  el.dispatchEvent(pointerDownEvent);
}

function useElement<P extends React.HTMLAttributes<any>>(type: 'button' | 'div', props: P) {
  const ref = useRef<HTMLElement>(null);
  const { onClick, onPointerDown } = props;
  return React.createElement(type, {
    ...props,
    ref,
    tabIndex: props.tabIndex || 0,
    onKeyDown: (onClick || onPointerDown) && ((e) => {
      if (e.key !== 'Enter') return;
      if (onClick) ref.current!.click();
      if (onPointerDown) triggerPointDown(ref.current!);
    }),
  }, props.children);
}

export function A11yDiv(props: React.HTMLAttributes<HTMLDivElement>) {
  return useElement('div', props);
}

export function A11yButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return useElement('button', props);
}
