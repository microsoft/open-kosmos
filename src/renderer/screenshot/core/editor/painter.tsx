import React, { ReactNode } from 'react';
import { StrokeEvent, keyboardPainter } from '../common/keyboard-painter';
import { PainterConfig, ShapeConfig } from './toolbar';
import { MEvent } from '../common/drag-limiter';
import { CrossCursor, PencilCursor, MosicCursor, TextCursor } from '../common/cursor';
import { Painters } from './shape';

const PainterType = new Set(['square', 'ellipse', 'arrow', 'pencil', 'mosaic', 'text', 'preset']);
export function isPainterConfig(tool?: ShapeConfig | null): tool is PainterConfig {
  return Boolean(tool && PainterType.has(tool.type));
}

export function startDrawByMouse(painter: Painters, tool: PainterConfig, ev: MEvent) {
  if (tool.type === 'square') {
    const strokeWidth = tool.size;
    painter.square.current?.start(tool.color, strokeWidth, ev);
  } else if (tool.type === 'ellipse') {
    const strokeWidth = tool.size;
    painter.ellipse.current?.start(tool.color, strokeWidth, ev);
  } else if (tool.type === 'arrow') {
    const size = tool.size;
    painter.arrow.current?.start(tool.color, size, ev);
  } else if (tool.type === 'pencil') {
    const strokeWidth = tool.size;
    painter.pencil.current?.start(tool.color, strokeWidth, ev);
  } else if (tool.type === 'mosaic') {
    const size = tool.size;
    painter.mosaic.current?.start(size, ev);
  } else if (tool.type === 'text') {
    painter.text.current?.start(tool.color, tool.size, ev);
  } else if (tool.type === 'preset') {
    painter.preset.current?.start(ev, tool.content);
  }
}

export function startDrawByKeyboard(painter: Painters, tool: PainterConfig, ev: StrokeEvent) {
  if (tool.type === 'square') {
    const strokeWidth = tool.size;
    return painter.square.current?.keyStart(ev, tool.color, strokeWidth);
  } else if (tool.type === 'ellipse') {
    const strokeWidth = tool.size;
    return painter.ellipse.current?.keyStart(ev, tool.color, strokeWidth);
  } else if (tool.type === 'arrow') {
    const size = tool.size;
    return painter.arrow.current?.keyStart(ev, tool.color, size);
  } else if (tool.type === 'pencil') {
    const strokeWidth = tool.size;
    return painter.pencil.current?.keyStart(ev, tool.color, strokeWidth);
  } else if (tool.type === 'mosaic') {
    const size = tool.size;
    return painter.mosaic.current?.keyStart(ev, size);
  } else if (tool.type === 'text') {
    return painter.text.current?.keyStart(ev, tool.color, tool.size);
  } else if (tool.type === 'preset') {
    return painter.preset.current?.keyStart(ev, tool.content);
  }
}


export function updateCursorForKeyboard(tool: PainterConfig) {
  let cursor: ReactNode = null;
  if (tool) {
    switch (tool.type) {
      case 'square':
      case 'ellipse':
      case 'arrow':
      case 'preset':
        cursor = <CrossCursor size={14} />;
        break;
      case 'pencil':
        cursor = <PencilCursor color={tool.color} />;
        break;
      case 'mosaic':
        cursor = <MosicCursor size={tool.size} />;
        break;
      case 'text':
        cursor = TextCursor;
        break;
    }
  }
  return keyboardPainter.setCursor(cursor);
}
