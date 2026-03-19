// Copyright (C) Microsoft Corporation. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";

import { css, keyframes } from '../common/styled';
import { OKIcon } from '../common/svg';
import { createElement } from "react";
import { sleep } from "../common/utils/time";
import { useStopMove } from './hooks';

const SOverlay = css`
  z-index: 1000;
  position: fixed;
  inset: 0;
`;
const SBox = css`
  z-index: 1001;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);

  height: 160px;
  width: 160px;
  background-color: #616161;
  border-radius: 4px;
  color: white;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
`;
const rotate = keyframes`
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
`;
const SSPin = css`
  height: 40px;
  width: 40px;
  box-sizing: border-box;
  border-radius: 50%;
  border-width: 1.5px;
  border-style: solid;
  border-color: rgb(0, 120, 212) rgb(199, 224, 244) rgb(199, 224, 244);
  border-image: initial;
  animation: ${rotate} 1.3s infinite;
  animation-timing-function: cubic-bezier(0.53, 0.21, 0.29, 0.67);
`;
const SText = css`
  width: 100px;
  text-align: center;
`;

function Overlay() {
  const r = useStopMove();
  return <div className={SOverlay} ref={r} />;
}

interface Props {
  text: string;
  type?: 'success' | 'loading' | 'error';
  modal?: boolean;
}
function View(props: Props) {
  const r = useStopMove();
  const { text, type = 'success', modal } = props;

  let icon: React.ReactNode;
  if (type === 'success') {
    icon = <OKIcon size={40} color="#09d651" />;
  } else if (type === 'error') {
    icon = <OKIcon size={40} color="#ff4d4f" />;
  } else if (type === 'loading') {
    icon = <div className={SSPin} />;
  }

  return <>
    {modal && <Overlay />}
    <div className={SBox} ref={r}>
      <div>
        {icon}
      </div>
      <div role="alert" aria-live='assertive' aria-label={text} className={SText}>{text}</div>
    </div>
  </>;
}

export function Message(props: Props) {
  return ReactDOM.createPortal(
    createElement(View, props),
    container,
  );
}

const container = document.createElement('div');
document.body.append(container);

interface MessageConfig extends Props {
  duration?: number;
}
export function message(config: MessageConfig) {
  const { duration = 1000, text, type, modal } = config;
  const root = createRoot(container);
  const hide = () => root.unmount();
  root.render(createElement(View, { text, type, modal }));
  return sleep(duration).then(hide);
}
