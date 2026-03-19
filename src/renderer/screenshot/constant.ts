import { screenshotApi } from "../ipc/screenshot-overlay";

const displayIdStr = new URLSearchParams(window.location.search).get('displayId') || '-1';
export const displayId = Number(displayIdStr);
export const initData = screenshotApi.getInitData(displayId);
