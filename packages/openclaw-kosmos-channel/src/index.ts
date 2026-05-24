// OpenClaw Kosmos Channel Plugin — Entry Point

import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/channel-core';
import { kosmosPlugin } from './plugin';

export * from './types';

const entry: any = defineChannelPluginEntry({
  id: 'kosmos',
  name: 'Kosmos',
  description: 'Connect Kosmos desktop app to OpenClaw',
  plugin: kosmosPlugin,
});
export default entry;
