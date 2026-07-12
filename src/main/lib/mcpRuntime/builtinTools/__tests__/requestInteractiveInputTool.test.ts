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

  it('preserves host metadata for runtime-gated approvals', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Approve action',
      metadata: { computerUseConfirmationId: 'cu-1' },
      schema: {
        kind: 'choice',
        mode: 'single',
        options: ['approve', 'cancel'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.interactive_request?.metadata).toEqual({ computerUseConfirmationId: 'cu-1' });
  });

  it('rejects choice schemas that omit mode', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Your Gender',
      schema: {
        kind: 'choice',
        options: ['Male', 'Female', 'Prefer not to say'],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
    expect(result.message).toContain('schema.mode');
    expect(result.interactive_request).toBeUndefined();
  });

  it('maps choice question into top-level description when description is missing', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Your Gender',
      schema: {
        kind: 'choice',
        mode: 'single',
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

  it('getDefinition inputSchema exposes choice mode and form fields as structured properties', () => {
    const def = RequestInteractiveInputTool.getDefinition();
    const schemaProps = (def.inputSchema as any).properties.schema.properties;

    expect(schemaProps.kind.enum).toEqual(['choice', 'form']);
    expect(schemaProps.mode.enum).toEqual(['single', 'multi']);
    expect(schemaProps.options.type).toBe('array');
    expect(schemaProps.options.items.required).toEqual(['value', 'label']);
    expect(schemaProps.fields.type).toBe('array');
    expect(schemaProps.fields.items.properties.control.enum).toEqual(
      ['text', 'textarea', 'time', 'folder', 'file', 'number', 'checkbox', 'select', 'multiselect'],
    );
    expect(schemaProps.fields.items.required).toEqual(['key', 'label', 'control']);

    expect((def.inputSchema as any).properties.schema.required).toEqual(['kind']);
    expect((def.inputSchema as any).properties.schema.oneOf).toEqual([
      {
        properties: {
          kind: { type: 'string', enum: ['choice'] },
        },
        required: ['kind', 'mode', 'options'],
      },
      {
        properties: {
          kind: { type: 'string', enum: ['form'] },
        },
        required: ['kind', 'fields'],
      },
    ]);
  });

  it('returns non-record options unchanged in choice schema', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Choose',
      schema: {
        kind: 'choice',
        mode: 'single',
        options: [42, true],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('infers folder control from field key matching folder pattern', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Settings',
      schema: {
        kind: 'form',
        fields: [
          { key: 'output_directory', label: 'Output Directory', control: 'text' },
        ],
      },
    });

    expect(result.success).toBe(true);
    if (result.interactive_request?.schema.kind !== 'form') throw new Error('Expected form');
    expect(result.interactive_request.schema.fields[0].control).toBe('folder');
  });

  it('infers file control from field key matching file path pattern', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Settings',
      schema: {
        kind: 'form',
        fields: [
          { key: 'config_file', label: 'Config', control: 'text' },
        ],
      },
    });

    expect(result.success).toBe(true);
    if (result.interactive_request?.schema.kind !== 'form') throw new Error('Expected form');
    expect(result.interactive_request.schema.fields[0].control).toBe('file');
  });

  it('infers path control when control is omitted (undefined)', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Settings',
      schema: {
        kind: 'form',
        fields: [
          { key: 'workspace', label: 'Workspace Folder' },
        ],
      },
    });

    expect(result.success).toBe(true);
    if (result.interactive_request?.schema.kind !== 'form') throw new Error('Expected form');
    expect(result.interactive_request.schema.fields[0].control).toBe('folder');
  });

  it('normalizes email control to text', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Contact',
      schema: {
        kind: 'form',
        fields: [
          { key: 'email', label: 'Email', control: 'email' },
        ],
      },
    });

    expect(result.success).toBe(true);
    if (result.interactive_request?.schema.kind !== 'form') throw new Error('Expected form');
    expect(result.interactive_request.schema.fields[0].control).toBe('text');
  });

  it('returns non-record form fields unchanged', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Test',
      schema: {
        kind: 'form',
        fields: [42],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('returns args unchanged when args is not a record', async () => {
    const result = await RequestInteractiveInputTool.execute('not an object');

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('returns args unchanged when schema is not a record', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Test',
      schema: 'not-an-object',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('returns args unchanged when schema kind is neither choice nor form', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Test',
      schema: { kind: 'unknown' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('rejects choice with minSelections > maxSelections', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Pick',
      schema: {
        kind: 'choice',
        mode: 'multi',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
        ],
        minSelections: 3,
        maxSelections: 1,
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('minSelections must be less than or equal to maxSelections');
  });

  it('rejects form with duplicate field keys', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Info',
      schema: {
        kind: 'form',
        fields: [
          { key: 'name', label: 'First Name', control: 'text' },
          { key: 'name', label: 'Last Name', control: 'text' },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Duplicate field key: name');
  });

  it('rejects select control without options', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Config',
      schema: {
        kind: 'form',
        fields: [
          { key: 'lang', label: 'Language', control: 'select' },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('options are required for select controls');
  });

  it('rejects multiselect control without options', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Config',
      schema: {
        kind: 'form',
        fields: [
          { key: 'langs', label: 'Languages', control: 'multiselect' },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('options are required for multiselect controls');
  });

  it('rejects form field with minSelections > maxSelections', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Config',
      schema: {
        kind: 'form',
        fields: [
          {
            key: 'tags',
            label: 'Tags',
            control: 'multiselect',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
            minSelections: 5,
            maxSelections: 2,
          },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('minSelections must be less than or equal to maxSelections for field tags');
  });

  it('fills default minSelections/maxSelections for multi mode', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Multi choice',
      schema: {
        kind: 'choice',
        mode: 'multi',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
    });

    expect(result.success).toBe(true);
    if (result.interactive_request?.schema.kind !== 'choice') throw new Error('Expected choice');
    expect(result.interactive_request.schema.minSelections).toBe(0);
    expect(result.interactive_request.schema.maxSelections).toBeUndefined();
  });

  it('preserves explicit minSelections/maxSelections for choice', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Multi choice',
      schema: {
        kind: 'choice',
        mode: 'multi',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
        ],
        minSelections: 1,
        maxSelections: 2,
      },
    });

    expect(result.success).toBe(true);
    if (result.interactive_request?.schema.kind !== 'choice') throw new Error('Expected choice');
    expect(result.interactive_request.schema.minSelections).toBe(1);
    expect(result.interactive_request.schema.maxSelections).toBe(2);
  });

  it('normalizes option with neither value nor label to empty spread', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Choose',
      schema: {
        kind: 'choice',
        mode: 'single',
        options: [{ description: 'some desc' }],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('keeps existing description when choice schema has question field', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Title',
      description: 'Existing description',
      schema: {
        kind: 'choice',
        mode: 'single',
        question: 'Ignored question',
        options: ['A', 'B'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.interactive_request?.description).toBe('Existing description');
  });

  it('falls back to field.key when no key/id/fieldName/name string exists', async () => {
    const result = await RequestInteractiveInputTool.execute({
      title: 'Test',
      schema: {
        kind: 'form',
        fields: [
          { label: 'Something', control: 'text' },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
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