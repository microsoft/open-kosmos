import {
  createRedactor,
  isTextFile,
  redactDeep,
  redactFileContent,
  redactRuntimeStateJson,
  redactScheduleJson,
} from '../redact';

describe('createRedactor', () => {
  it('replaces user alias with <REDACTED_ALIAS>', () => {
    const redact = createRedactor({ userAlias: 'alice' });
    expect(redact('Processing profile: alice')).toBe('Processing profile: <REDACTED_ALIAS>');
  });

  it('replaces alias in path segments', () => {
    const redact = createRedactor({ userAlias: 'alice' });
    expect(redact('profiles/alice/schedules')).toBe('profiles/<REDACTED_ALIAS>/schedules');
  });

  it('works when userAlias is null', () => {
    const redact = createRedactor({ userAlias: null });
    expect(redact('hello world')).toBe('hello world');
  });

  it('works when no options provided', () => {
    const redact = createRedactor();
    expect(redact('hello world')).toBe('hello world');
  });

  it('redacts Authorization Bearer header', () => {
    const redact = createRedactor();
    expect(redact('Authorization: Bearer ghp_abc123xyz')).toBe('Authorization: Bearer <REDACTED>');
  });

  it('redacts Authorization Basic header', () => {
    const redact = createRedactor();
    expect(redact('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: Basic <REDACTED>');
  });

  it('redacts GitHub tokens', () => {
    const redact = createRedactor();
    expect(redact('token is ghp_1234567890abcdef')).toBe('token is <REDACTED>');
    expect(redact('token is gho_abc123')).toBe('token is <REDACTED>');
    expect(redact('token is ghs_server456')).toBe('token is <REDACTED>');
    expect(redact('token is ghr_refresh789')).toBe('token is <REDACTED>');
    expect(redact('token is github_pat_abcdef123')).toBe('token is <REDACTED>');
  });

  it('redacts TOKEN=value patterns', () => {
    const redact = createRedactor();
    expect(redact('ACCESS_TOKEN=secret123')).toBe('ACCESS_TOKEN=<REDACTED>');
    expect(redact('PASSWORD=mypass')).toBe('PASSWORD=<REDACTED>');
    expect(redact('API_SECRET="hidden"')).toContain('<REDACTED>');
    expect(redact('PRIVATE_KEY=pk_abc')).toBe('PRIVATE_KEY=<REDACTED>');
  });

  it('redacts Set-Cookie headers', () => {
    const redact = createRedactor();
    expect(redact('Set-Cookie: sid=abc123; Path=/')).toBe('Set-Cookie: <REDACTED>');
  });

  it('redacts JSON-style Authorization fields', () => {
    const redact = createRedactor();
    expect(redact('"Authorization": "Bearer tok123"')).toContain('<REDACTED>');
    expect(redact('"Authorization": "Bearer tok123"')).not.toContain('tok123');
  });

  it('redacts Cookie headers', () => {
    const redact = createRedactor();
    expect(redact('Cookie: session=abc; id=xyz')).toBe('Cookie: <REDACTED>');
  });

  it('redacts email addresses', () => {
    const redact = createRedactor();
    expect(redact('contact user@example.com for help')).toBe('contact <EMAIL> for help');
  });

  it('redacts macOS user paths', () => {
    const redact = createRedactor();
    expect(redact('path is /Users/johndoe/Documents')).toBe('path is /Users/<USER>/Documents');
  });

  it('redacts Windows user paths', () => {
    const redact = createRedactor();
    expect(redact('path is C:\\Users\\johndoe\\Documents')).toContain('<USERPROFILE>');
  });

  it('redacts x-api-key header patterns', () => {
    const redact = createRedactor();
    expect(redact('x-api-key: my-secret-key')).toBe('x-api-key: <REDACTED>');
  });
});

describe('redactDeep', () => {
  it('redacts strings', () => {
    const redact = (s: string) => s.replace('secret', '<REDACTED>');
    expect(redactDeep('my secret', redact)).toBe('my <REDACTED>');
  });

  it('redacts nested objects', () => {
    const redact = (s: string) => s.replace('secret', '<REDACTED>');
    const input = { a: { b: 'secret value' } };
    expect(redactDeep(input, redact)).toEqual({ a: { b: '<REDACTED> value' } });
  });

  it('redacts arrays', () => {
    const redact = (s: string) => s.replace('secret', '<REDACTED>');
    expect(redactDeep(['secret', 'safe'], redact)).toEqual(['<REDACTED>', 'safe']);
  });

  it('passes through numbers and booleans', () => {
    const redact = (s: string) => s;
    expect(redactDeep(42, redact)).toBe(42);
    expect(redactDeep(true, redact)).toBe(true);
    expect(redactDeep(null, redact)).toBe(null);
  });
});

describe('redactScheduleJson', () => {
  it('redacts message, description, and name fields', () => {
    const input = JSON.stringify({
      schedulerJobs: [
        {
          id: 'job-1',
          description: 'Send daily report to alice',
          name: 'Daily Report',
          message: 'Please summarize my emails from alice@corp.com',
          scheduleType: 'cron',
          cronExpression: '0 9 * * *',
          enabled: true,
          agentId: 'agent-1',
          status: 'pending',
        },
      ],
    }, null, 2);

    const redact = createRedactor({ userAlias: 'alice' });
    const result = JSON.parse(redactScheduleJson(input, redact));

    expect(result.schedulerJobs[0].message).toBe('<REDACTED>');
    expect(result.schedulerJobs[0].description).toBe('<REDACTED>');
    expect(result.schedulerJobs[0].name).toBe('<REDACTED>');
    // Non-sensitive fields preserved
    expect(result.schedulerJobs[0].id).toBe('job-1');
    expect(result.schedulerJobs[0].cronExpression).toBe('0 9 * * *');
    expect(result.schedulerJobs[0].status).toBe('pending');
  });

  it('handles multiple jobs', () => {
    const input = JSON.stringify({
      schedulerJobs: [
        { id: '1', message: 'prompt1', description: 'd1', name: 'n1' },
        { id: '2', message: 'prompt2', description: 'd2', name: 'n2' },
      ],
    });
    const redact = createRedactor();
    const result = JSON.parse(redactScheduleJson(input, redact));
    expect(result.schedulerJobs).toHaveLength(2);
    expect(result.schedulerJobs[0].message).toBe('<REDACTED>');
    expect(result.schedulerJobs[1].message).toBe('<REDACTED>');
    expect(result.schedulerJobs[0].id).toBe('1');
    expect(result.schedulerJobs[1].id).toBe('2');
  });

  it('handles JSON with missing schedulerJobs field', () => {
    const input = JSON.stringify({ other: 'value' });
    const redact = createRedactor();
    const result = JSON.parse(redactScheduleJson(input, redact));
    expect(result.schedulerJobs).toEqual([]);
  });

  it('falls back to text redaction on invalid JSON', () => {
    const redact = createRedactor({ userAlias: 'alice' });
    const result = redactScheduleJson('not valid json with alice', redact);
    expect(result).toContain('<REDACTED_ALIAS>');
    expect(result).not.toContain('alice');
  });
});

describe('redactRuntimeStateJson', () => {
  it('redacts alias field', () => {
    const input = JSON.stringify({
      schemaVersion: 1,
      alias: 'alice',
      isActive: true,
      lastActivatedAt: '2025-04-15T09:00:00Z',
    }, null, 2);

    const redact = createRedactor({ userAlias: 'alice' });
    const result = JSON.parse(redactRuntimeStateJson(input, redact));

    expect(result.alias).toBe('<REDACTED_ALIAS>');
    expect(result.schemaVersion).toBe(1);
    expect(result.isActive).toBe(true);
  });

  it('handles JSON without alias field', () => {
    const input = JSON.stringify({ schemaVersion: 1, isActive: false });
    const redact = createRedactor();
    const result = JSON.parse(redactRuntimeStateJson(input, redact));
    expect(result.alias).toBe('<REDACTED_ALIAS>');
    expect(result.schemaVersion).toBe(1);
  });

  it('falls back to text redaction on invalid JSON', () => {
    const redact = createRedactor({ userAlias: 'alice' });
    const result = redactRuntimeStateJson('broken json alice', redact);
    expect(result).not.toContain('alice');
  });
});

describe('redactFileContent', () => {
  it('uses schedule redactor for schedule month files', () => {
    const input = JSON.stringify({
      schedulerJobs: [{ id: '1', message: 'secret prompt', description: 'desc', name: 'n', status: 'pending' }],
    });
    const redact = createRedactor();
    const result = JSON.parse(redactFileContent(input, 'profiles/alice/schedules/202504.json', redact));
    expect(result.schedulerJobs[0].message).toBe('<REDACTED>');
  });

  it('uses schedule redactor for Windows backslash paths', () => {
    const input = JSON.stringify({
      schedulerJobs: [{ id: '1', message: 'secret', description: 'desc', name: 'n', status: 'pending' }],
    });
    const redact = createRedactor();
    const result = JSON.parse(redactFileContent(input, 'profiles\\<REDACTED_ALIAS>\\schedules\\202504.json', redact));
    expect(result.schedulerJobs[0].message).toBe('<REDACTED>');
    expect(result.schedulerJobs[0].description).toBe('<REDACTED>');
  });

  it('uses schedule redactor for mixed-separator paths', () => {
    const input = JSON.stringify({
      schedulerJobs: [{ id: '1', message: 'secret', description: 'desc', name: 'n', status: 'pending' }],
    });
    const redact = createRedactor();
    const result = JSON.parse(redactFileContent(input, 'profiles\\<REDACTED_ALIAS>\\schedules/202504.json', redact));
    expect(result.schedulerJobs[0].message).toBe('<REDACTED>');
  });

  it('uses runtime state redactor for runtime-state.json', () => {
    const input = JSON.stringify({ alias: 'alice', schemaVersion: 1 });
    const redact = createRedactor({ userAlias: 'alice' });
    const result = JSON.parse(redactFileContent(input, 'profiles/x/schedules/runtime-state.json', redact));
    expect(result.alias).toBe('<REDACTED_ALIAS>');
  });

  it('uses runtime state redactor for Windows backslash path', () => {
    const input = JSON.stringify({ alias: 'alice', schemaVersion: 1 });
    const redact = createRedactor({ userAlias: 'alice' });
    const result = JSON.parse(redactFileContent(input, 'profiles\\x\\schedules\\runtime-state.json', redact));
    expect(result.alias).toBe('<REDACTED_ALIAS>');
  });

  it('uses generic redactor for log files', () => {
    const redact = createRedactor({ userAlias: 'alice' });
    const result = redactFileContent('Processing profile: alice', 'logs/app.log', redact);
    expect(result).toBe('Processing profile: <REDACTED_ALIAS>');
  });

  it('uses generic redactor for non-schedule JSON files', () => {
    const input = JSON.stringify({ path: '/Users/johndoe/data' });
    const redact = createRedactor();
    const result = redactFileContent(input, 'state/current-run.json', redact);
    expect(result).toContain('/Users/<USER>');
    expect(result).not.toContain('johndoe');
  });
});

describe('isTextFile', () => {
  it('returns true for text extensions', () => {
    expect(isTextFile('app.json')).toBe(true);
    expect(isTextFile('main.log')).toBe(true);
    expect(isTextFile('readme.txt')).toBe(true);
    expect(isTextFile('config.yaml')).toBe(true);
    expect(isTextFile('.env')).toBe(false); // dotfiles have no extension per path.extname
    expect(isTextFile('config.env')).toBe(true);
    expect(isTextFile('data.xml')).toBe(true);
    expect(isTextFile('config.yml')).toBe(true);
    expect(isTextFile('config.toml')).toBe(true);
    expect(isTextFile('config.ini')).toBe(true);
    expect(isTextFile('script.sh')).toBe(true);
    expect(isTextFile('script.bat')).toBe(true);
    expect(isTextFile('notes.md')).toBe(true);
    expect(isTextFile('data.csv')).toBe(true);
  });

  it('returns false for binary extensions', () => {
    expect(isTextFile('crash.dmp')).toBe(false);
    expect(isTextFile('image.png')).toBe(false);
    expect(isTextFile('data.bin')).toBe(false);
    expect(isTextFile('app.exe')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isTextFile('FILE.JSON')).toBe(true);
    expect(isTextFile('LOG.LOG')).toBe(true);
  });
});
