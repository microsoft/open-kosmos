import React, { CSSProperties, useEffect, useRef } from 'react';
import { Editor } from './editor';
import { AreaSelector } from './area-selector';
import { initialAtom, freAtom, areaAtom, state_handlers } from './state';
import { define } from './context';
import { css } from './common/styled';
import globalKey from './common/utils/global-key';

const RootBox = css`
  height: 100vh;
  width: 100vw;
  position: relative;
  background-repeat: no-repeat;
  box-sizing: border-box;
  font-family: var(--font-list);
  touch-action: none;

  & * {
    box-sizing: border-box;
  }
`;

const validArea = define.compute((use) => {
  const { rect } = use(areaAtom);
  return Boolean(rect[2] || rect[3]);
});

function PressEscToQuit() {
  const { quit } = state_handlers.use();
  useEffect(() => globalKey.on((_, is) => is.Escape && quit()), []);
  return null;
}

export default function Canvas() {
  const hideFRE = freAtom.useCreation().hide;
  const { bg, startSelect } = initialAtom.useData();
  const areaActions = areaAtom.useCreation();
  const isValid = validArea.use();
  const selector = useRef<AreaSelector>(null);

  if (!bg.url) return <PressEscToQuit />;

  function onPointerDown(ev: React.PointerEvent) {
    if (ev.button === 0) {
      hideFRE();
      selector.current?.start(ev);
      startSelect();
    }
  }

  function renderContent() {
    if (isValid) return <Editor bg={bg}/>;
    return (
      <>
        <AreaSelector ref={selector} bg={bg} onSeleted={areaActions.setRect} hideFRE={hideFRE} enableFrames />
        <PressEscToQuit />
      </>
    );
  }

  let style: CSSProperties = { ...bg.css };
  if (!isValid) style.cursor = 'crosshair';
  return (
    <div
      className={RootBox}
      style={style}
      onContextMenu={e => e.preventDefault()}
      onPointerDown={isValid ? undefined : onPointerDown}
      // Todo: implement confirm on double-click
    >
      {renderContent()}
    </div>
  );
}
