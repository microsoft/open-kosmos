// OpenClaw OpenKosmos Channel Plugin — Entry Point

import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/channel-core';
import { openkosmosPlugin } from './plugin';

export * from './types';

const entry: any = defineChannelPluginEntry({
  id: 'openkosmos',
  name: 'OpenKosmos',
  description: 'Connect OpenKosmos desktop app to OpenClaw',
  plugin: openkosmosPlugin,
});
export default entry;
