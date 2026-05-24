# Git Push Automation Prompt

## Task Description
Analyze current project file changes, generate standardized commit messages, and execute the complete Git commit and push workflow.

## Execution Steps
1. **Check Current Status**
   - View current branch status
   - Check changes in working directory and staging area

2. **Analyze Change Content**
   - Identify added, modified, and deleted files
   - Analyze affected functional modules and scope of impact
   - Determine change type (feature, fix, refactor, documentation, etc.)

3. **Generate Commit Message**
    - Use conventional commit format: `type(scope): description`
    - Types include: feat, fix, docs, style, refactor, test, chore
    - **All content must be in English (including description and detailed change points)**
    - The final commit message must include the required trailer:
      `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
    - Strictly follow the format specification below:

   ### Commit Message Format Specification
   
    **Basic Format:**
    ```
    type(scope): concise English description
    
    - Detailed change point 1
    - Detailed change point 2
    - Detailed change point 3

    Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
    ```
   
   **Example:**
    ```
    fix(mcp): fix subprocess persistence issue after app closure
   
   - Implement MCPClient-level subprocess tracking and forced cleanup mechanism
   - Add MCPClientManager timeout protection and system-level cleanup
    - Refactor app exit flow with 4-stage subprocess cleanup sequence
    - Support SIGTERM graceful termination and SIGKILL forced termination
    - Fix npm/uvx/python subprocess cleanup issue from StdioClientTransport

    Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
    ```

4. **Execute Git Operations**
    - Review changed files before staging to avoid committing unintended files
    - `git add <intended files>` - Stage only the intended files; do not blindly use `git add .`
    - Use a commit command that preserves subject, body, and trailer (for example multiple `-m` flags or `git commit -F <file>`)
    - `git push` - Push to remote repository

## Output Requirements
The response should be concise and use this exact structure:

### Changed Files
- List the files that are going to be committed

### Commit Message
```text
<full generated commit message including body and trailer>
```

### Git Result
- Summarize the executed Git commands and their results
- State clearly whether the push succeeded
- If push did not run or failed, state the blocking reason explicitly

## Notes
- Ensure commit message follows project conventions
- Check for files that need to be excluded
- Verify remote repository connection status
- Each detailed change point must be meaningful, avoid repetition or vague descriptions
- **All change points must be described in English**, concise yet containing key information
- Do not fabricate a successful push result; report the actual outcome
