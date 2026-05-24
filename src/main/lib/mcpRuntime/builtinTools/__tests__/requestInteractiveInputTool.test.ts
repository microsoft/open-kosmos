import { RequestInteractiveInputTool } from '../requestInteractiveInputTool';

describe('RequestInteractiveInputTool.execute', () => {
  it('normalizes form fields that use id instead of key and string arrays for select options', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Additional Information',
      schema: {
        kind: 'form',
        fields: [
          {
            id: 'gender',
            label: 'Gender',
            control: 'select',
            required: true,
            options: ['Male', 'Female', 'Prefer not to say'],
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.interactive_request).toEqual({
      title: 'Additional Information',
      source: 'assistant',
      submitLabel: 'Continue',
      skipLabel: 'Skip',
      schema: {
        kind: 'form',
        fields: [
          {
            key: 'gender',
            label: 'Gender',
            control: 'select',
            required: true,
            options: [
              { value: 'Male', label: 'Male' },
              { value: 'Female', label: 'Female' },
              { value: 'Prefer not to say', label: 'Prefer not to say' },
            ],
          },
        ],
      },
    });
  });

  it('accepts option objects once field id is normalized into key', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Configure analysis',
      schema: {
        kind: 'form',
        fields: [
          {
            id: 'platform',
            label: 'Platform',
            control: 'select',
            required: true,
            options: [
              { value: 'ios', label: 'iOS' },
              { value: 'android', label: 'Android' },
            ],
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.interactive_request?.schema.kind).toBe('form');
    if (result.interactive_request?.schema.kind !== 'form') {
      throw new Error('Expected form schema');
    }

    expect(result.interactive_request.schema.fields[0].key).toBe('platform');
    expect(result.interactive_request.schema.fields[0].options).toEqual([
      { value: 'ios', label: 'iOS' },
      { value: 'android', label: 'Android' },
    ]);
  });

  it('normalizes fieldName and name aliases into key', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Collect filters',
      schema: {
        kind: 'form',
        fields: [
          {
            fieldName: 'targetProduct',
            label: 'Target Product',
            control: 'text',
            required: true,
          },
          {
            name: 'focusAreas',
            label: 'Focus Areas',
            control: 'textarea',
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.interactive_request?.schema.kind).toBe('form');
    if (result.interactive_request?.schema.kind !== 'form') {
      throw new Error('Expected form schema');
    }

    expect(result.interactive_request.schema.fields.map((field) => field.key)).toEqual([
      'targetProduct',
      'focusAreas',
    ]);
  });

  it('normalizes option objects when only label or value is provided', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Choose platform',
      schema: {
        kind: 'choice',
        mode: 'single',
        options: [
          { label: 'iOS' },
          { value: 'android' },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.interactive_request).toEqual({
      title: 'Choose platform',
      source: 'assistant',
      submitLabel: 'Continue',
      skipLabel: 'Skip',
      schema: {
        kind: 'choice',
        mode: 'single',
        minSelections: 1,
        maxSelections: 1,
        options: [
          { label: 'iOS', value: 'iOS' },
          { value: 'android', label: 'android' },
        ],
      },
    });
  });

  it('defaults missing choice mode to single', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Your Gender',
      schema: {
        kind: 'choice',
        options: ['Male', 'Female', 'Prefer not to say'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.interactive_request).toEqual({
      title: 'Your Gender',
      source: 'assistant',
      submitLabel: 'Continue',
      skipLabel: 'Skip',
      schema: {
        kind: 'choice',
        mode: 'single',
        minSelections: 1,
        maxSelections: 1,
        options: [
          { value: 'Male', label: 'Male' },
          { value: 'Female', label: 'Female' },
          { value: 'Prefer not to say', label: 'Prefer not to say' },
        ],
      },
    });
  });

  it('maps choice question into top-level description when description is missing', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Your Gender',
      schema: {
        kind: 'choice',
        question: 'Are you male or female?',
        options: ['Male', 'Female', 'Prefer not to say'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.interactive_request?.description).toBe('Are you male or female?');
    expect(result.interactive_request?.schema.kind).toBe('choice');
    if (result.interactive_request?.schema.kind !== 'choice') {
      throw new Error('Expected choice schema');
    }

    expect(result.interactive_request.schema.mode).toBe('single');
  });

  it('accepts time as a supported form control', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Confirm schedule',
      schema: {
        kind: 'form',
        fields: [
          {
            key: 'run_time',
            label: 'Run time',
            control: 'time',
            type: 'string',
            required: true,
            defaultValue: '09:00',
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.interactive_request?.schema.kind).toBe('form');
    if (result.interactive_request?.schema.kind !== 'form') {
      throw new Error('Expected form schema');
    }

    expect(result.interactive_request.schema.fields[0]).toMatchObject({
      key: 'run_time',
      label: 'Run time',
      control: 'time',
      required: true,
      defaultValue: '09:00',
    });
  });
});