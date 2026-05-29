export * from './common';
export { default as MainToolbar } from './screenshot-bar';

export const stopEvent = (ev: React.MouseEvent) => ev.stopPropagation();
