/**
 * createGithubIssueTool — create a GitHub Issue.
 * Used only by the Doctor Agent.
 *
 * Returns a pre-filled GitHub new-issue URL so the user can submit it directly.
 */

import { appendDebugLog } from '../log';

const GITHUB_ISSUES_URL = 'https://github.com/microsoft/open-kosmos/issues/new';

export const createGithubIssueToolDef = {
  type: 'function' as const,
  function: {
    name: 'create_github_issue',
    description: `Create a GitHub issue in the OpenKosmos repository. Use this tool after you have finished analyzing the bug report and collected all relevant context. The body should be well-structured Markdown including: problem summary, environment info, relevant logs, and your analysis.`,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Concise issue title summarizing the bug',
        },
        body: {
          type: 'string',
          description: 'Full issue body in Markdown format',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional labels to apply (e.g. ["crash", "ui"]). "bug" and "user-feedback" are always added.',
        },
      },
      required: ['title', 'body'],
    },
  },
};

export async function executeCreateGithubIssue(args: {
  title: string;
  body: string;
  labels?: string[];
}): Promise<string> {
  const { title, labels } = args;
  let { body } = args;
  if (!title || !body) {
    return JSON.stringify({ success: false, error: 'title and body are required.' });
  }

  const GITHUB_BODY_LIMIT = 61440; // 60kb, github limit is 64kb
  if (body.length > GITHUB_BODY_LIMIT) {
    const notice = `\n\n---\n_⚠️ Body truncated: original length ${body.length} exceeded GitHub's 65536-char limit._\n`;
    body = body.slice(0, GITHUB_BODY_LIMIT - notice.length) + notice;
  }

  const allLabels = ['doctor', ...(labels || [])];

  const params = new URLSearchParams({ title, body, labels: allLabels.join(',') });
  const issueUrl = `${GITHUB_ISSUES_URL}?${params.toString()}`;

  appendDebugLog(
    'create_github_issue → pre-filled URL',
    [
      `**URL:** ${issueUrl}`,
      `**Title:** ${title}`,
      `**Labels:** ${allLabels.join(', ')}`,
      `**Body length:** ${body.length}`,
      '',
      '### Issue Body',
      '',
      body,
    ].join('\n'),
  );

  return JSON.stringify({
    success: true,
    issueUrl,
    message: 'Open the URL to submit the issue on GitHub.',
  });
}

