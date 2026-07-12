import React from 'react';
import { EmbeddedBrowserAtom } from '../browser/embeddedBrowser.atom';
import { useCurrentChatSessionId } from '../../lib/chat/agentChatSessionCacheManager';
import { useEmbeddedBrowserEnabled } from '../../lib/userData/useEmbeddedBrowserEnabled';

function isHttpLink(href: unknown): href is string {
  return typeof href === 'string' && /^https?:\/\//i.test(href);
}

export const MarkdownLink: React.FC<any> = (props) => {
  const { href, children, ...rest } = props;
  const actions = EmbeddedBrowserAtom.useChange();
  const sessionId = useCurrentChatSessionId();
  const browserEnabled = useEmbeddedBrowserEnabled();
  const canRouteHttpLink = isHttpLink(href);
  const shouldRouteToEmbeddedBrowser = browserEnabled && canRouteHttpLink && typeof sessionId === 'string';

  return (
    <a
      {...rest}
      href={href}
      target={!shouldRouteToEmbeddedBrowser ? '_blank' : undefined}
      rel={!shouldRouteToEmbeddedBrowser ? 'noopener noreferrer' : undefined}
      className="text-primary-600 hover:text-primary-800 underline cursor-pointer"
      onClick={(e: React.MouseEvent) => {
        if (shouldRouteToEmbeddedBrowser) {
          e.preventDefault();
          actions.open(sessionId, href);
        }
      }}
    >
      {children}
    </a>
  );
};
