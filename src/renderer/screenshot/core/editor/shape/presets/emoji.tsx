import React, { PureComponent } from 'react';
import { Point } from '../../../type';
import { PainterProps, ShapeProps } from './common';
import { uuid, PresetEmoji } from '../../model';
import { Coord, Heart, Flag, Pushpin, RoundPushpin } from './assets';

function renderGraph (type: PresetEmoji['emoji'], coord: Coord, onPointerDown?: (e: React.PointerEvent) => void) {
  switch (type) {
    case 'heart':
      return <Heart coord={coord} onPointerDown={onPointerDown} />;
    case 'flag':
      return <Flag coord={coord} onPointerDown={onPointerDown} />;
    case 'pushpin':
      return <Pushpin coord={coord} onPointerDown={onPointerDown} />;
    case 'roundPushpin':
      return <RoundPushpin coord={coord} onPointerDown={onPointerDown} />;
    default:
      return null;
  }
}

const DefaultSize = 20;
export class EmojiPainter extends PureComponent<PainterProps<'emoji'>> {
  public createDefault(at: Point) {
    const { area, addPreset, config } = this.props;
    const [ , , w, h ] = area;
    let [ x, y ] = at;
    const half: number = DefaultSize / 2;
    x = Math.max(half, Math.min(x, w - half));
    y = Math.max(half, Math.min(y, h - half));
    addPreset({
      id: uuid(),
      type: 'preset',
      rect: [x - half, y - half, DefaultSize, DefaultSize],
      content: config,
    });
  }

  public finish() {
    const { addPreset, rect, config } = this.props;
    if (!rect) return;
    addPreset({
      id: uuid(),
      type: 'preset',
      rect,
      content: config,
    });
  }

  public render() {
    const { rect, config } = this.props;
    if (!rect) return null;
    const [x, y, w, h] = rect;
    const coord = { x, y, width: w, height: h };
    return renderGraph(config.emoji, coord);
  }
}


export class EmojiShape extends PureComponent<ShapeProps<'emoji'>> {

  public render() {
    const { rect, content, onPointerDown } = this.props;
    const [x, y, w, h] = rect;
    const coord = { x, y, width: w, height: h, cursor: 'move' };
    return renderGraph(content.emoji, coord, onPointerDown);
  }
}
