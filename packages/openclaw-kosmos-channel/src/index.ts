// OpenClaw OpenKosmos Channel Plugin — Entry Point

import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/channel-core';
import { kosmosPlugin } from './plugin';

export * from './types';

const entry: any = defineChannelPluginEntry({
  id: 'kosmos',
  name: 'OpenKosmos',
  description: 'Connect OpenKosmos desktop app to OpenClaw',
  plugin: kosmosPlugin,
});
export default entry;
