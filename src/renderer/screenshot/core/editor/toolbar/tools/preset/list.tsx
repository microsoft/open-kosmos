import React from 'react';
import { Number, Heart, Flag, Pushpin, RoundPushpin } from '../../../shape/presets/assets';
import { PresetConfig } from '../../common';
import { PresetModel, uuid } from '../../../model';


export interface Item {
  key: string;
  view: React.ReactNode;
  title: string;
  config: PresetModel['content'];
}

export const NumberColor = {
  red: '#D13438',
  orange: '#F7630C',
  green: '#359B35',
  blue: '#00A6ED',
}

export const Numbers: Item[] = [
  {
    key: uuid(),
    view: <Number coord={{ width: 20 }} fill={NumberColor.red} />,
    title: 'digit 1 with white foreground and red background',
    config: { type: 'order', index: 0, style: 'red', aspectRatio: 1 }
  },
  {
    key: uuid(),
    view: <Number coord={{ width: 20 }} fill={NumberColor.orange} />,
    title: 'digit 1 with white foreground and orange background',
    config: { type: 'order', index: 0, style: 'orange', aspectRatio: 1 }
  },
  {
    key: uuid(),
    view: <Number coord={{ width: 20 }} fill={NumberColor.green} />,
    title: 'digit 1 with white foreground and green background',
    config: { type: 'order', index: 0, style: 'green', aspectRatio: 1 }
  },
  {
    key: uuid(),
    view: <Number coord={{ width: 20 }} fill={NumberColor.blue} />,
    title: 'digit 1 with white foreground and blue background',
    config: { type: 'order', index: 0, style: 'blue', aspectRatio: 1 }
  }
];

export const Emojis: Item[] = [
  {
    key: uuid(),
    view: <Flag coord={{ width: 20 }} />,
    title: 'flag',
    config: { type: 'emoji', emoji: 'flag', aspectRatio: 1 }
  },
  {
    key: uuid(),
    view: <Heart coord={{ width: 20 }} />,
    title: 'heart',
    config: { type: 'emoji', emoji: 'heart', aspectRatio: 1 }
  },
  {
    key: uuid(),
    view: <Pushpin coord={{ width: 20 }} />,
    title: 'pushpin',
    config: { type: 'emoji', emoji: 'pushpin', aspectRatio: 1 }
  },
  {
    key: uuid(),
    view: <RoundPushpin coord={{ width: 20 }} />,
    title: 'roundPushpin',
    config: { type: 'emoji', emoji: 'roundPushpin', aspectRatio: 1 }
  }
]

export const DefaultPreset: PresetConfig = {
  type: 'preset',
  content: Numbers[0].config,
}

