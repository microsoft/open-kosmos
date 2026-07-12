/**
 * @vitest-environment happy-dom
 */

import { renderHook } from '@testing-library/react';
import { type Message, MessageHelper } from '@shared/types/chatTypes';
import { useActivitySlot } from '../ChatContainer.hooks';
import type { ChatRenderItem } from '../ChatRenderItem';

const createTextMessage = MessageHelper.createTextMessage;

describe('ChatContainer hooks', () => {
  it('does not reserve an activity slot for a missing streaming message outside loading status', () => {
    const user = createTextMessage('user-1', 'user', 'hello');
    const renderItems: ChatRenderItem[] = [
      { type: 'user', message: user as Message, index: 0 },
    ];

    const { result } = renderHook(() => (
      useActivitySlot(renderItems, 'missing-streaming-message', [], 'idle', [user])
    ));

    expect(result.current.renderItemsWithActivity).toBe(renderItems);
  });
});
