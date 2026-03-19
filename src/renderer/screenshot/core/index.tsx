
import { istyled } from './common/styled';
istyled(':root')`
  --main-color: #0078d7;
  --mask-color: rgba(0, 0, 0, 0.6);
  --huge-size: 999999px;
  --font-list: "Segoe UI Variable Display", "Segoe UI", "Segoe UI Web (West European)", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", sans-serif;
`;

import Canvas from './canvas';
import { FRE } from './fre';
import { initialAtom, InitHooks, BgSource } from './state';
import { ModelProvider } from './context';
import { createElement } from 'react';

interface Props {
  source: Promise<BgSource>;
  hooks: InitHooks;
}

function Initialization(props: Props) {
  initialAtom.useCreation().initOnce(props.source, props.hooks);
  return (
    <>
      <Canvas />
      <FRE />
    </>
  );
}

export function Screenshot(props: Props) {
  return (
    <ModelProvider>
      {createElement(Initialization, props)}
    </ModelProvider>
  );
}
