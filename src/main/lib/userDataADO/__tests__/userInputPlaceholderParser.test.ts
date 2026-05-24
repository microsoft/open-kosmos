import { userInputPlaceholderParser } from '../userInputPlaceholderParser';

describe('userInputPlaceholderParser', () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('parseSinglePlaceholder', () => {
    it('parses TEXT control placeholders into control=text', () => {
      expect(
        userInputPlaceholderParser.parseSinglePlaceholder(
          'CLIENT_ID',
          '@USER_INPUT_STRING_TEXT_REQUIRED_client_id',
        ),
      ).toEqual({
        key: 'CLIENT_ID',
        originalValue: '@USER_INPUT_STRING_TEXT_REQUIRED_client_id',
        type: 'STRING',
        control: 'text',
        varName: 'client_id',
        isRequired: true,
        label: 'Client Id',
      });
    });

    it('parses FOLDER and FILE controls into lowercase control values', () => {
      expect(
        userInputPlaceholderParser.parseSinglePlaceholder(
          'WORKSPACE',
          '@USER_INPUT_STRING_FOLDER_REQUIRED_workspace',
        ),
      ).toMatchObject({
        control: 'folder',
        label: 'Workspace (Select folder)',
      });

      expect(
        userInputPlaceholderParser.parseSinglePlaceholder(
          'CONFIG_PATH',
          '@USER_INPUT_STRING_FILE_REQUIRED_config_path',
        ),
      ).toMatchObject({
        control: 'file',
        label: 'Config Path (Select file)',
      });
    });

    it('rejects legacy EMAIL and NORMAL placeholders', () => {
      expect(
        userInputPlaceholderParser.parseSinglePlaceholder(
          'EMAIL',
          '@USER_INPUT_STRING_EMAIL_REQUIRED_email',
        ),
      ).toBeNull();

      expect(
        userInputPlaceholderParser.parseSinglePlaceholder(
          'NAME',
          '@USER_INPUT_STRING_NORMAL_REQUIRED_name',
        ),
      ).toBeNull();
    });

    it('rejects non-text controls for numeric and boolean types', () => {
      expect(
        userInputPlaceholderParser.parseSinglePlaceholder(
          'COUNT',
          '@USER_INPUT_INT_FOLDER_REQUIRED_count',
        ),
      ).toBeNull();

      expect(
        userInputPlaceholderParser.parseSinglePlaceholder(
          'FLAG',
          '@USER_INPUT_BOOLEAN_FILE_REQUIRED_flag',
        ),
      ).toBeNull();
    });
  });

  describe('parseConfig', () => {
    it('finds placeholders recursively and returns unified controls', () => {
      const result = userInputPlaceholderParser.parseConfig({
        env: {
          WORKING_PATH: '@USER_INPUT_STRING_FOLDER_REQUIRED_working_path',
          CONFIG_FILE: '@USER_INPUT_STRING_FILE_OPTIONAL_config_file',
          CLIENT_ID: '@USER_INPUT_STRING_TEXT_REQUIRED_client_id',
        },
      });

      expect(result.hasUserInputFields).toBe(true);
      expect(result.fields).toEqual([
        expect.objectContaining({ key: 'WORKING_PATH', control: 'folder' }),
        expect.objectContaining({ key: 'CONFIG_FILE', control: 'file' }),
        expect.objectContaining({ key: 'CLIENT_ID', control: 'text' }),
      ]);
    });
  });
});