import React, { CSSProperties, ReactNode, createElement, useEffect, useRef, useMemo, RefObject, PureComponent } from 'react';
import { css } from '../../../common/styled';
import cls from '../../../common/classnames';
import { uuid } from '../../../context';

/**
 * --------------------------------------------------------------------------------
 * Component styles
 * --------------------------------------------------------------------------------
 */

const ButtonBox = css`
  position: relative;
  box-sizing: border-box;
  * {
    box-sizing: border-box;
  }

  &>.btn-content {
    height: 100%;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: 200ms;
  }

  &>.btn-expand {
    position: absolute;
    z-index: 100;
    left: 0;
    top: calc(100% + 2px);
    cursor: move;
  }
  &>.btn-tooltip {
    display: none;
    position: absolute;
    z-index: 100;
    top: calc(100% + 2px);
    left: 50%;
    transform: translateX(-50%);
    padding: 0 8px;
    background: #ffffff;
    border: 1px solid #f3f3f3;
    box-shadow: 0px 0px 2px 0px rgba(0, 0, 0, 0.12),
    0px 4px 8px 0px rgba(0, 0, 0, 0.14);
    border-radius: 4px;
    font-size: 12px;
    line-height: 28px;
    color: rgba(0, 0, 0, 0.86);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  &:hover > .btn-tooltip,
  &:focus-within > .btn-tooltip {
    display: block;
  }
  &:hover>.btn-content,
  &.btn-active>.btn-content {
    background: rgba(0, 0, 0, 0.05);
  }
  @media screen and (forced-colors: active) {
    forced-color-adjust: auto;
    & > .btn-content {
      * {
        color: ButtonText;
      }
      &:hover {
        background-color: Highlight;
        * {
          color: HighlightText;
          fill: HighlightText;
          stroke: HighlightText;;
        }
      }
    }
    &.disabled > .btn-content {
      &:hover {
        background: transparent;
      }
      * {
        color: GrayText;
        fill: GrayText;
        stroke: GrayText;;
      }
    }
  }
`;

const SqureBox = css`
  &>.btn-content {
    height: 28px;
    min-width: 28px;
    border-radius: 2px;
  }
  &.btn-active::after {
    display: block;
    content: '';
    position: absolute;
    background: var(--main-color, #0078d7);
    width: 100%;
    height: 2px;
    left: 0;
    bottom: 0;
    border-radius: 0 0 2px 2px;
  }
`;

/**
 * --------------------------------------------------------------------------------
 * Component styles
 * --------------------------------------------------------------------------------
 */

function alignExpand(box: HTMLElement) {
  const { bottom, right } = box.getBoundingClientRect();
  const { innerHeight, innerWidth } = window;
  if (bottom > innerHeight) {
    box.style.top = 'auto';
    box.style.bottom = 'calc(100% + 2px)';
  }
  if (right > innerWidth) {
    box.style.left = 'auto';
    box.style.right = '0px';
  }
}
function drag(ref: RefObject<HTMLElement | null>) {
  let [x, y] = [0, 0];
  let position = { left: 0, right: 0, top: 0, bottom: 0 };
  function onMove(ev: PointerEvent) {
    if (!ref.current) return;
    let dx = ev.movementX, dy = ev.movementY;
    const { innerWidth, innerHeight } = window;
    const { left, right, top, bottom } = position;
    if (right + dx > innerWidth || left + dx < 0) dx = 0;
    if (bottom + dy > innerHeight || top + dy < 0) dy = 0;
    position.left += dx;
    position.right += dx;
    position.top += dy;
    position.bottom += dy;
    x += dx;
    y += dy;
    ref.current.style.transform = `translate(${x}px, ${y}px)`;
  }

  function onMouseUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onMouseUp);
  }

  return () => {
    const element = ref.current;
    if (element) {
      const { left, top, right, bottom} = element.getBoundingClientRect();
      position = { left, top, right, bottom};
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onMouseUp);
  };
}
function Expand(props: { children: ReactNode, className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => alignExpand(ref.current!), []);
  const onPointerDown = useMemo(() => drag(ref), []);
  const className = props.className ? `btn-expand ${props.className}` : 'btn-expand';
  return createElement('div', { ref, className, onPointerDown: onPointerDown }, props.children);
}

function alignTip(box: HTMLElement) {
  const { bottom } = box.getBoundingClientRect();
  if (bottom > window.innerHeight) {
    box.style.top = 'auto';
    box.style.bottom = 'calc(100% + 2px)';
  }
}
function Tip(props: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => alignTip(ref.current!), []);
  return <div ref={ref} aria-hidden className="btn-tooltip">{props.children}</div>;
}

interface Props {
  className?: string;
  style?: CSSProperties;
  inStyle?: CSSProperties;
  disabled?: boolean;
  active?: boolean;
  tooltip?: string;
  'aria-label'?: string;
  'aria-expanded'?: boolean;
  expandClass?: string;
  expand?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
}
interface ButtonState {
  mouseIn: boolean;
  focused: boolean;
}

let TOOL_COUNT = 0;
const TOOL = 'c-' + uuid(); // class can not start with a number
const MoveFocusByKey: Record<string, number | undefined> =
  { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

function moveFocus(e: React.KeyboardEvent, from: Button) {
  const step = MoveFocusByKey[e.key];
  if (step === undefined) return;
  let active = -1;
  const items = Array.from(
    document.querySelectorAll<HTMLElement>(`.${TOOL}`),
    (el, i) => {
      if (el.id === from.id) active = i;
      return el;
    },
  );
  if (active === -1) return;
  const total = items.length;
  const next = (active + step + total) % total;
  from.tab(-1);
  items[next].focus();
  return true;
}


export class Button extends PureComponent<Props, ButtonState> {
  private index = -1;
  public readonly id = uuid();
  state = { mouseIn: false, focused: false };

  public tab(i: number) {
    if (this.index === i) return;
    this.index = i;
    this.forceUpdate();
  }

  componentDidMount() {
    if (TOOL_COUNT === 0) this.tab(0);
    TOOL_COUNT += 1;
  }

  componentWillUnmount() {
    TOOL_COUNT -= 1;
  }

  private handleMouseEnter = () => {
    this.setState({ mouseIn: true });
  };

  private handleMouseLeave = () => {
    this.setState({ mouseIn: false });
  };

  private handleFocus = () => {
    this.setState({ focused: true });
    this.tab(0);
  };

  private handleBlur = () => {
    this.setState({ focused: false });
  };

  private handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (this.props.disabled) return;
      this.props.onClick?.();
    } else if (moveFocus(e, this)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private renderFloat() {
    const { expand, tooltip, expandClass } = this.props;
    if (expand) {
      return <Expand className={expandClass}>{expand}</Expand>;
    }
    const { mouseIn, focused } = this.state;
    if ((mouseIn || focused) && tooltip) {
      return <Tip>{tooltip}</Tip>;
    }
  }

  render() {
    const { children, onClick, className, disabled, style, inStyle, active } = this.props;
    return (
      <div className={cls(className, SqureBox, ButtonBox, active && 'btn-active', { disabled })} style={style}>
        <div
          id={this.id}
          role='button'
          aria-label={this.props['aria-label']}
          aria-expanded={this.props['aria-expanded']}
          aria-disabled={disabled}
          tabIndex={this.index}
          className={'btn-content ' + TOOL}
          style={inStyle}
          onPointerDown={disabled ? undefined : onClick}
          onMouseEnter={this.handleMouseEnter}
          onMouseLeave={this.handleMouseLeave}
          onFocus={this.handleFocus}
          onBlur={this.handleBlur}
          onKeyDown={this.handleKeyDown}
        >
          {children}
        </div>
        {this.renderFloat()}
      </div>
    );
  }
}
