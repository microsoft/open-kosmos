/**
 * createGithubIssue.coverage.test.ts
 */

const mockAppendDebugLog = vi.hoisted(() => vi.fn());

vi.mock('../log', () => ({
  appendDebugLog: mockAppendDebugLog,
  clearDebugLog: vi.fn(),
}));

describe('createGithubIssueToolDef', () => {
  it('has correct function name', async () => {
    vi.resetModules();
    const { createGithubIssueToolDef } = await import('../createGithubIssue');
    expect(createGithubIssueToolDef.function.name).toBe('create_github_issue');
  });

  it('requires title and body', async () => {
    vi.resetModules();
    const { createGithubIssueToolDef } = await import('../createGithubIssue');
    expect(createGithubIssueToolDef.function.parameters.required).toContain('title');
    expect(createGithubIssueToolDef.function.parameters.required).toContain('body');
  });
});

describe('executeCreateGithubIssue – validation', () => {
  it('returns error when title is missing', async () => {
    vi.resetModules();
    const { executeCreateGithubIssue } = await import('../createGithubIssue');
    const result = await executeCreateGithubIssue({ title: '', body: 'some body' });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('required');
  });

  it('returns error when body is missing', async () => {
    vi.resetModules();
    const { executeCreateGithubIssue } = await import('../createGithubIssue');
    const result = await executeCreateGithubIssue({ title: 'Bug report', body: '' });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
  });
});

describe('executeCreateGithubIssue – success path', () => {
  it('returns a pre-filled GitHub issue URL', async () => {
    vi.resetModules();
    const { executeCreateGithubIssue } = await import('../createGithubIssue');
    const result = await executeCreateGithubIssue({ title: 'Bug', body: 'Description' });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.issueUrl).toContain('github.com');
    expect(parsed.issueUrl).toContain('title=Bug');
    expect(parsed.issueUrl).toContain('body=Description');
  });

  it('truncates body when it exceeds 60KB limit', async () => {
    vi.resetModules();
    const longBody = 'x'.repeat(70000);
    const { executeCreateGithubIssue } = await import('../createGithubIssue');
    const result = await executeCreateGithubIssue({ title: 'Big bug', body: longBody });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.issueUrl).toContain('truncated');
  });

  it('includes doctor label in URL', async () => {
    vi.resetModules();
    const { executeCreateGithubIssue } = await import('../createGithubIssue');
    const result = await executeCreateGithubIssue({ title: 'Bug', body: 'Details', labels: ['crash'] });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.issueUrl).toContain('doctor');
    expect(parsed.issueUrl).toContain('crash');
  });

  it('returns message field', async () => {
    vi.resetModules();
    const { executeCreateGithubIssue } = await import('../createGithubIssue');
    const result = await executeCreateGithubIssue({ title: 'Bug', body: 'Details' });
    const parsed = JSON.parse(result);
    expect(parsed.message).toContain('Open the URL');
  });
});
