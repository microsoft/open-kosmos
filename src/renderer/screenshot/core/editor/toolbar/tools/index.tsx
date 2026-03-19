import React, { memo, useRef } from 'react';
import { Button } from '../components/button';
import { getString } from '../../../common/localString';
import { COPYIcon, OKIcon } from '../../../common/svg';

export { default as SquareTool } from './square';
export { default as ArrowTool } from './arrow';
export { default as EllipseTool } from './ellipse';
export { default as TextTool } from './text';
export { default as PencilTool } from './pencil';
export { default as MosaicTool } from './mosaic';
export { default as PresetTool } from './preset';

interface CommonToolProps {
  onClick?: () => void;
}

function a11yAlert(el: HTMLElement, text: string) {
  el.setAttribute('aria-label', '');
  el.textContent = '';
  setTimeout(() => {
    el.setAttribute('aria-label', text);
    el.textContent  = text;
  }, 100);
}

export const UndoTool = memo((props: CommonToolProps) => {
  const { onClick } = props;
  const message = useRef<HTMLDivElement>(null);

  const handleClick = onClick && (() => {
    onClick();
    a11yAlert(message.current!, getString('undoSuccess'));
  });

  return (
    <Button
      aria-label={getString('undo')}
      tooltip={getString('undo')}
      style={onClick ? {} : { cursor: 'not-allowed' }}
      disabled={!onClick}
      onClick={handleClick}
    >
      <div ref={message} role="alert" aria-live="assertive" style={{position:'absolute',color: 'transparent'}}></div>
      <svg width="20" height="20" viewBox="0 0 20 20" fill={onClick ? '#212121' : '#979593'}>
        <path d="M5.85355 2.64645C6.04882 2.84171 6.04882 3.15829 5.85355 3.35355L4.20711 5H11C14.3137 5 17 7.68629 17 11C17 14.3137 14.3137 17 11 17C7.68629 17 5 14.3137 5 11C5 10.7239 5.22386 10.5 5.5 10.5C5.77614 10.5 6 10.7239 6 11C6 13.7614 8.23858 16 11 16C13.7614 16 16 13.7614 16 11C16 8.23858 13.7614 6 11 6H4.20711L5.85355 7.64645C6.04882 7.84171 6.04882 8.15829 5.85355 8.35355C5.65829 8.54882 5.34171 8.54882 5.14645 8.35355L2.64645 5.85355C2.45118 5.65829 2.45118 5.34171 2.64645 5.14645L5.14645 2.64645C5.34171 2.45118 5.65829 2.45118 5.85355 2.64645Z" />
      </svg>
    </Button>
  );
});

export const SaveTool = memo((props: CommonToolProps) => {
  const { onClick } = props;
  return (
    <Button
      aria-label={getString('save')}
      tooltip={getString('save')}
      onClick={onClick}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="#212121">
        <path d="M15.5 16.9989C15.7761 16.9989 16 17.2227 16 17.4989C16 17.7443 15.8231 17.9485 15.5899 17.9908L15.5 17.9989H4.5C4.22386 17.9989 4 17.775 4 17.4989C4 17.2534 4.17688 17.0493 4.41012 17.0069L4.5 16.9989H15.5ZM10.0001 2.0011C10.2456 2.0011 10.4497 2.1781 10.492 2.41137L10.5 2.50124L10.496 14.2951L14.1414 10.6468C14.3148 10.473 14.5842 10.4535 14.7792 10.5883L14.8485 10.6461C15.0222 10.8195 15.0418 11.0889 14.907 11.2839L14.8492 11.3532L10.3574 15.8532C10.285 15.9259 10.1957 15.9715 10.1021 15.9902L9.99608 16C9.83511 16 9.69192 15.9239 9.60051 15.8057L5.14386 11.3538C4.94846 11.1587 4.94823 10.8421 5.14336 10.6467C5.3168 10.473 5.58621 10.4535 5.78117 10.5884L5.85046 10.6462L9.496 14.2871L9.5 2.50095C9.50008 2.22481 9.724 2.0011 10.0001 2.0011Z" />
      </svg>
    </Button>
  );
});

export const CancelTool = memo((props: CommonToolProps) => {
  const { onClick } = props;
  return (
    <Button
      aria-label={getString('cancel')}
      tooltip={getString('cancel')}
      onClick={onClick}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="#C50F1F">
        <path d="M4.08859 4.21569L4.14645 4.14645C4.32001 3.97288 4.58944 3.9536 4.78431 4.08859L4.85355 4.14645L10 9.293L15.1464 4.14645C15.32 3.97288 15.5894 3.9536 15.7843 4.08859L15.8536 4.14645C16.0271 4.32001 16.0464 4.58944 15.9114 4.78431L15.8536 4.85355L10.707 10L15.8536 15.1464C16.0271 15.32 16.0464 15.5894 15.9114 15.7843L15.8536 15.8536C15.68 16.0271 15.4106 16.0464 15.2157 15.9114L15.1464 15.8536L10 10.707L4.85355 15.8536C4.67999 16.0271 4.41056 16.0464 4.21569 15.9114L4.14645 15.8536C3.97288 15.68 3.9536 15.4106 4.08859 15.2157L4.14645 15.1464L9.293 10L4.14645 4.85355C3.97288 4.67999 3.9536 4.41056 4.08859 4.21569L4.14645 4.14645L4.08859 4.21569Z" />
      </svg>
    </Button>
  );
});

export const ConfirmTool = memo((props: CommonToolProps) => {
  const { onClick } = props;
  return (
    <Button
      aria-label={getString('copyMessage')}
      tooltip={getString('copyMessage')}
      onClick={onClick}
    >
      <OKIcon />
    </Button>
  );
});

export const CopyTool = memo((props: CommonToolProps) => {
  const { onClick } = props;
  return (
    <Button
      aria-label={getString('copyMessage')}
      tooltip={getString('copy')}
      onClick={onClick}
    >
      <COPYIcon />
    </Button>
  );
});
