import React, { useRef, useState } from 'react';
import { getString } from '../../../common/localString';
import { css } from '../../../common/styled';
import { handleDrag } from '../../../common/utils/drag';
import { shapesAtom } from '../../../state';
import { useModel } from '../../../context';

const SFlexCenter = css`
  display: flex;
  align-items: center;
  justify-content: center;
`;
const SSlider = css`
  width: 100%;
  height: 14px;
  padding: 0 8px;
  cursor: pointer;
`;
const SSliderRunway = css`
  width: 100%;
  height: 2px;
  background-color: rgba(0, 0, 0, 0.62);
  border-radius: 2px;
  position: relative;
  @media screen and (forced-colors: active) {
    forced-color-adjust: none;
    background: fieldtext;
    * {
      forced-color-adjust: none;
    }
  }
`;

const SSliderBar = css`
  background: #2169EB;
  height: 100%;
  position: absolute;
  left: 0;
`;

const SThumbCursor = css`
  width: 14px;
  height: 14px;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.18);
  position: absolute;
  top: 0;
  transform: translate(-50%, -50%);
  &::after {
    content: "";
    display: block;
    width: 10px;
    height: 10px;
    border-radius: 10px;
    background: #2169EB;
  }
  @media screen and (forced-colors: active) {
    border-color: fieldtext;
  }
`;

const SSliderTooptip = css`
  position: absolute;
  top: -26px;
  padding: 0px 4px;
  border-radius: 2px;
  background: rgba(252, 252, 252, 0.85);
  backdrop-filter: blur(30px);
  background-blend-mode: color;
  box-shadow: 0px 1px 2px 0px #00000024, 0px 0px 2px 0px #0000001F;
  font-size: 11px;
  font-weight: 400;
  line-height: 14px;
  text-align: center;
  transform: translate(-50%, 0);
`;

interface Props {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}
function SliderThumb(props: Props) {
  const { min, max, value, onChange } = props;
  const slider = useRef<HTMLDivElement>(null);
  const sliderCursor = useRef<HTMLDivElement>(null);
  const [showFlag, setShowFlag] = useState(false);
  const model = useModel();

  const timer = useRef<number | null>(null);
  function debounceCommit() {
    if (timer.current) {
      clearTimeout(timer.current);
    } else {
      model.startTransaction();
    }
    timer.current = window.setTimeout(() => {
      model.endTransaction();
      timer.current = null;
    }, 1000);
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    let x = 0; let width = 0;
    if (slider.current) {
      let rect = slider.current.getBoundingClientRect();
      x = rect.x;
      width = rect.width;
    }
    model.startTransaction();
    handleDrag({
      onMove: (e) => onUpdateValue(e, x, width, true),
      onEnd: () => model.endTransaction(),
    })
  };

  const onSliderClick = (e: React.PointerEvent) => {
    e.stopPropagation();
    let x = 0; let width = 0;
    if (slider.current) {
      let rect = slider.current.getBoundingClientRect();
      x = rect.x;
      width = rect.width;
    }
    onUpdateValue(e, x, width);
  }

  /**
   *
   * @param e React.PointerEvent | PointerEvent
   * @param x slider left position
   * @param width slider width
   * @param drag
   */
  const onUpdateValue = (e: React.PointerEvent | PointerEvent, x: number, width: number, drag = false) => {
    e.stopPropagation();
    setShowFlag(true);
    let offsetX = e.clientX - x;
    if ( offsetX < 0 ) offsetX = 0;
    if ( offsetX > width ) offsetX = width;
    let radio = offsetX / width;
    let num = Math.round(radio * ( max - min )) + min;
    drag ? onChange(num) : changeValue(num);
  };

  const changeValue = (num: number) => {
    if ( value !== num ) {
      onChange(num);
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    switch (e.key) {
      case 'ArrowLeft':
        onStep(-1);
        break;
      case 'ArrowRight':
        onStep(1);
        break;
      case 'ArrowUp':
        onStep(-1);
        break;
      case 'ArrowDown':
        onStep(1);
        break;
      case 'Enter':
        sliderCursor.current?.blur();
        break;
      default:
        break;
    }
  }

  const onStep = (step: number) => {
    debounceCommit();
    setShowFlag(true);
    const current = value + step;
    if ( current < min || current > max ) return;
    changeValue(current);
  }

  return (
    <div  className={`${SSlider} ${SFlexCenter}`}
          ref={slider}
          aria-label='slider'
          onPointerDown={onSliderClick}>
      <div  className={SSliderRunway}>
        <div className={SSliderBar} style={{width: `${(value - min) / (max - min) * 100}%`}}></div>
        <div  className={`${SThumbCursor} ${SFlexCenter}`}
              style={{left: `${(value - min) / (max - min) * 100}%`}}
              tabIndex={0}
              role="slider"
              aria-label={getString('size')}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={value}
              aria-valuetext={`${value}`}
              ref={sliderCursor}
              onMouseEnter={() => setShowFlag(true)}
              onMouseLeave={() => setShowFlag(false)}
              onKeyDown={onKeyDown}
              onFocus={() => setShowFlag(true)}
              onPointerDown={onPointerDown}>
        </div>
        {showFlag && <div className={SSliderTooptip} style={{left: `${(value - min) / (max - min) * 100}%`}}>{value}</div>}
      </div>
    </div>
  );
}

export default SliderThumb;
