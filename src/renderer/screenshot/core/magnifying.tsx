import React, { PureComponent, CSSProperties } from 'react';
import { EditArea, Point, RGB, RGBA } from './type';
import { isBlack, isDark } from './common/utils/color';
import { BackgroundImage } from './common/utils/bg';
import throttle from 'lodash/throttle';
import { css } from './common/styled';

const Box = css`
  position: absolute;
  pointer-events: none;
  user-select: none;
  border: 1px solid white;
  border-radius: 2px 2px 2px 0;
  background-repeat: no-repeat;

  .magnifying-img {
    height: 100%;
    width: 100%;
    overflow: hidden;
  }
  .magnify-cross-up {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
  }
  .magnify-cross-down {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
  }
  .magnify-cross-left {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
  }
  .magnify-cross-right {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
  }
  .magnifying-info {
    position: absolute;
    top: calc(100% + 1px);
    left: -1px;
    color: white;
    font-size: 10px;
    line-height: 12px;
    padding: 4px 8px;
    text-align: center;
    background: #3b3b3b;
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.13), 0 0 5px rgba(0, 0, 0, 0.11);
    border-radius: 0 0 2px 2px;
  }
`;

interface Props {
  bg: BackgroundImage;
  area?: EditArea;
  size?: number;
  zoom?: number;
}

interface State {
  position?: [x: number, y: number];
  color?: RGBA;
}

function MagnifyingInfo(props: {
  position: Point;
  color?: RGBA;
  area?: EditArea;
}) {
  // Todo: may show position or color in the future
  const { area } = props;
  if (!area) return null;
  const [, , w, h] = area;
  return (
    <div className="magnifying-info">
      <div>{w} × {h}</div>
    </div>
  );
}


class Magnifying extends PureComponent<Props, State> {
  public state: State = {};
  private unmounted = false;

  public updateColor = throttle((x: number, y: number) => {
    if (this.unmounted) return;
    const color = this.props.bg.getColor(x, y);
    this.setState({ color });
  }, 50);

  private handleMove = (ev: MouseEvent) => {
    const [x, y] = [ev.clientX, ev.clientY];
    this.setState({ position: [x, y] });
    this.updateColor(x, y);
  };

  private handleMouseLeave = () => {
    if (this.unmounted) return;
    this.setState({ position: undefined });
  };

  componentDidMount() {
    document.addEventListener('mousemove', this.handleMove);
    // Todo if window is inactive, there's a bug on mac
    document.addEventListener('mouseleave', this.handleMouseLeave);
  }

  componentWillUnmount() {
    this.unmounted = true;
    document.removeEventListener('mousemove', this.handleMove);
    document.removeEventListener('mouseleave', this.handleMouseLeave);
  }

  private renderCross(color: string, size: number, length: number) {
    return (
      <>
        <div style={{ background: color, height: length, width: size }} className="magnify-cross-up" />
        <div style={{ background: color, height: length, width: size }} className="magnify-cross-down" />
        <div style={{ background: color, width: length, height: size }} className="magnify-cross-left" />
        <div style={{ background: color, width: length, height: size }} className="magnify-cross-right" />
      </>
    );
  }

  render() {
    const { bg, size = 100, zoom = 4, area } = this.props;
    const { position, color } = this.state;

    if (!position) return null;

    const [x, y] = position;
    const boxStyle: CSSProperties = {
      left: x + 8,
      top: y + 8,
      width: size,
      height: size,
      borderColor: (color && isBlack(color)) ? 'black' : 'white',
    };
    const imgStyle: CSSProperties = {
      backgroundImage: `url("${bg.url}")`,
      backgroundSize: `${bg.width * zoom}px ${bg.height * zoom}px`,
      backgroundPosition: `${(size / 2) - x * zoom}px ${(size / 2) - y * zoom}px`,
      backgroundRepeat: 'no-repeat',
    };

    const crossColor = (color && isDark(color)) ? '#0078D4' : '#F3F3F3';
    const crossSize = 4;
    const crossLength = (size - crossSize - 2) / 2;

    return (
      <div style={boxStyle} className={Box}>
        <div className="magnifying-img" style={imgStyle} />
        {this.renderCross(crossColor, crossSize, crossLength)}
        <MagnifyingInfo position={position} color={color} area={area} />
      </div>
    );
  }
}

export default Magnifying;
