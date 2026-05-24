import { Message, MessageHelper } from '../chatTypes';

describe('MessageHelper.getText', () => {
  it('preserves embedded newlines across multiple text parts', () => {
    const message: Message = {
      id: 'test-user-1',
      role: 'user',
      timestamp: 1000,
      content: [
        { type: 'text', text: 'line 1\n' },
        { type: 'text', text: 'line 2' },
      ],
    };

    expect(MessageHelper.getText(message)).toBe('line 1\nline 2');
  });

  it('does not inject spaces between adjacent text parts', () => {
    const message: Message = {
      id: 'test-assistant-1',
      role: 'assistant',
      timestamp: 1000,
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' World' },
      ],
    };

    expect(MessageHelper.getText(message)).toBe('Hello World');
  });
});