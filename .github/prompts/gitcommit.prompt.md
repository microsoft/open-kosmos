# Git Commit Automation Prompt

## Task Description
Analyze current project file changes, generate standardized commit messages, and execute the Git commit workflow.

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
   - Strictly follow the format specification below:

   ### Commit Message Format Specification
   
   **Basic Format:**
   ```
   type(scope): concise English description
   
   - Detailed change point 1
   - Detailed change point 2
   - Detailed change point 3
   ```
   
   **Example:**
   ```
   fix(mcp): fix subprocess persistence issue after app closure
   
   - Implement MCPClient-level subprocess tracking and forced cleanup mechanism
   - Add MCPClientManager timeout protection and system-level cleanup
   - Refactor app exit flow with 4-stage subprocess cleanup sequence
   - Support SIGTERM graceful termination and SIGKILL forced termination
   - Fix npm/uvx/python subprocess cleanup issue from StdioClientTransport
   ```

4. **Execute Git Operations**
   - `git add .` - Add all changed files
   - `git commit -m "generated commit message"` - Commit changes

## Output Requirements
- Display list of changed files
- Generated commit message
- Executed Git commands and their results
- Commit success confirmation

## Notes
- Ensure commit message follows project conventions
- Check for files that need to be excluded
- Each detailed change point must be meaningful, avoid repetition or vague descriptions
- **All change points must be described in English**, concise yet containing key information