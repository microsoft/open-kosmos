# GitHub PR Automation Prompt

## Task Description
Analyze the current branch, summarize the committed changes, and create a pull request with GitHub CLI (`gh`).

## Execution Steps
1. **Check PR Readiness**
   - Confirm the current branch is not the default branch
   - Confirm there are committed changes to open as a PR
   - Confirm the branch has been pushed to the remote
   - Review `git status --short --branch` and avoid including unrelated uncommitted work in the PR summary

2. **Analyze Change Content**
   - Compare the current branch against the target base branch
   - Identify the main functional areas affected
   - Determine the change type and user-visible impact
   - Note tests, docs, or follow-up risks when relevant

3. **Generate PR Content**
   - Write the PR title in English and keep it under 70 characters
   - Use a concise, reviewer-friendly PR body in English
   - Base the content on the actual diff; do not fabricate work that is not present
   - Keep the summary focused on merged intent, impact, and verification signals
   - Do not add extra PR body sections beyond the required structure below unless the user explicitly asks for them

   ### PR Title Format
   ```text
   type(scope): concise English description
   ```

   ### PR Body Format
   ```markdown
   ## Summary
   - Key change 1
   - Key change 2
   - Key change 3

   ## Testing
   - Test or verification item 1
   - Test or verification item 2

   ## Risks
   - Risk, limitation, or follow-up note
   ```

4. **Create Pull Request**
   - Use GitHub CLI, not manual URL instructions
   - Use `gh pr create` with explicit `--base`, `--head`, `--title`, and `--body` (or `--body-file`)
   - If the base branch is not explicitly provided, infer it from the repository default branch
   - Prefer passing explicit content to `gh pr create`; do not rely on interactive prompts or auto-filled content
   - If PR creation fails, report the real blocking reason instead of claiming success

## Output Requirements
The response should be concise and use this exact structure only:

### PR Title
```text
<generated PR title>
```

### PR Body
```markdown
<generated PR body>
```

### PR Result
- Summarize the `gh` commands that were executed
- State clearly whether the PR was created successfully
- If created, include the PR URL
- If not created, state the blocking reason explicitly

Do not add any other top-level sections before, between, or after these three sections.

## Notes
- Use `gh` CLI for PR creation; do not ask the user to open GitHub manually unless `gh` is unavailable or authentication is blocked
- Do not include unrelated local changes in the PR description
- Do not fabricate successful creation, CI status, reviewer assignment, or labels
- If there is meaningful risk or incomplete verification, mention it in the PR body instead of hiding it
