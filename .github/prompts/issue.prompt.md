# GitHub Issue Creation Assistant

## Task Objective
Create new Issues in the https://github.com/ai-microsoft/Kosmos.app/ repository based on user input.

## Workflow

### 1. Information Collection
Collect necessary information from the user in the following order:

#### Required Fields
- **Title**
  - Concisely and clearly describe the problem or requirement
  - Suggested format: `[Type] Brief description`
  
- **Description**
  - Detailed explanation of problem background, reproduction steps, or feature requirements
  - For Bug: Include reproduction steps, expected behavior, actual behavior
  - For Feature: Include use cases, expected effects, priority rationale
  - For Task: Include task objectives, acceptance criteria, dependencies

#### Optional Fields
- **Assignees**
  - Use GitHub username (alias)
  - Can specify multiple assignees
  - If not specified, can leave empty for later assignment

#### Classification Labels
- **Type**
  - `Bug`: Software defects or errors
  - `Feature`: New feature requests
  - `Task`: Development tasks or improvements

- **Priority**
  - `P0`: Urgent, blocking issue, requires immediate attention
  - `P1`: High priority, important feature or serious issue
  - `P2`: Medium priority, regular requirement or issue

#### Project Management
- **Project**: Kosmos Iterative Development
  - Automatically link to iterative development project

- **Status**
  - `Backlog`: Pending planning, not yet started
  - `Ready`: Ready to start execution
  - `In Progress`: Currently in progress
  - `In Review`: Development complete, awaiting code review
  - `Done`: Completed and passed review

### 2. Creation Steps
Use GitHub MCP Server tools following these steps:

1. **Verify Information Completeness**
   - Confirm all required fields are filled
   - Validate field value validity
   - Confirm Assignee uses correct GitHub username format

2. **Use `mcp_github_create_issue` tool to create complete Issue in one operation**
   
   **Must correctly set the following parameters:**
   
   - `owner`: "ai-microsoft" (fixed value)
   - `repo`: "Kosmos.app" (fixed value)
   - `title`: Title provided by user, keep as-is
   - `body`: Description provided by user, keep as-is, do not simplify or modify
   - `assignees`: Assignee array, use correct GitHub username (e.g., `["v-yunn"]`)
   - `type`: Issue type ("Bug", "Feature", or "Task"), note case sensitivity
   - `labels`: Label array, add according to Priority (e.g., `["P0"]`, `["P1"]`, or `["P2"]`)
   
   **Important Notes:**
   - Title and Body must completely pass all user-provided information
   - Do not omit any user-provided details
   - Assignee must use correct GitHub username format (usually `alias`)
   - Type parameter is the formal Issue Type, must be set accurately
   - Priority is set through labels parameter

3. **Project Association After Issue Creation**
   
   Although the `mcp_github_create_issue` tool will attempt to automatically link to "Kosmos Iterative Development" project,
   note that:
   - Project Status field (e.g., "Backlog", "Ready", "In Progress", etc.) needs to be manually set in the project board
   - Or set separately using GitHub Projects API (if relevant tools available)

4. **Confirm and Return**
   - Return created Issue link
   - Display Issue number and summary information
   - Confirm all properties are correctly set

### 3. Interaction Examples

**User Input Example:**
```
Create a Bug Issue:
Title: Chat history loading failed
Description: When clicking historical conversation, the app crashes and displays error message. Reproduction steps: 1. Open app 2. Click left sidebar history 3. App crashes. Expected behavior: Load historical conversation normally. Actual behavior: App crashes and displays "Unable to load data" error.
Assignee: yanhu
Priority: P1
Type: Bug
Status: In Progress
```

**AI Response Flow:**
1. Confirm all collected information
2. Use `mcp_github_create_issue` tool to create Issue with the following parameters:
   ```
   owner: "ai-microsoft"
   repo: "Kosmos.app"
   title: "Chat history loading failed"
   body: "When clicking historical conversation, the app crashes and displays error message. Reproduction steps: 1. Open app 2. Click left sidebar history 3. App crashes. Expected behavior: Load historical conversation normally. Actual behavior: App crashes and displays 'Unable to load data' error."
   assignees: ["yanhu"]
   type: "Bug"
   labels: ["P1"]
   ```
3. Return result: `✅ Issue #123 created: Chat history loading failed`
4. Provide direct access link

**Complete Information Transfer Example:**
If user provides detailed description including multiple paragraphs, lists, or other formats, must preserve completely:
```
User Input:
Description:
## Problem Background
Crash issue discovered in latest version

## Reproduction Steps
1. Open app
2. Click history
3. Select any conversation

## Expected Behavior
Load conversation content normally

## Actual Behavior
App crashes immediately

## Environment Information
- Version: 1.2.3
- System: Windows 11
- Log: See attachment

AI must:
- Pass the entire description unchanged to body parameter
- Do not simplify, summarize, or modify any content
- Maintain original format and structure
```

## Notes

### Information Completeness (Most Important)
- **Absolutely do not simplify or modify user-provided Title and Description**
- All user-provided information must be passed unchanged to GitHub Issue
- If user provides detailed description (including multiple paragraphs, lists, code blocks, etc.), must preserve completely
- Format, line breaks, markup symbols, etc. in Description must remain as-is

### Username Format
- GitHub usernames use the contributor's alias.
- If user only provides alias (e.g., `yanhu`, `v-yunn`), proactively ask for complete GitHub username
- Can refer to member list in `.github/acl/access.yml` file

### Required Field Validation
- **Title**: Must be provided, cannot be empty
- **Description**: Must be provided, cannot be empty or too simple
- **Type**: Must be one of "Bug", "Feature", or "Task" (note case sensitivity)
- **Assignees**: If user specifies assignee, must set correctly

### Optional Field Handling
- **Priority**: If user does not specify, can suggest based on description but must explicitly ask user to confirm
- **Labels**: Priority labels (P0/P1/P2) are set through labels parameter
- **Project Status**: May need to be manually set in GitHub project board after Issue creation

### API Parameter Mapping
Correct parameters when using `mcp_github_create_issue` tool:
- `title` → User's title (as-is)
- `body` → User's description (as-is, completely preserve all content)
- `assignees` → Array format, e.g., `["v-yunn"]`
- `type` → Formal Issue Type ("Bug", "Feature", "Task")
- `labels` → Array format, used to set priority, e.g., `["P1"]`

### Error Handling
- If user input is incomplete, proactively ask for missing required information
- If creation fails, provide clear error message and resolution suggestions
- Confirm if Assignee's GitHub username is correct
- Verify if Type case sensitivity meets requirements

## GitHub MCP Server Tool Reference

### Main Tool: `mcp_github_create_issue`

This is the core tool for creating GitHub Issues, capable of setting all necessary properties in one operation.

**Parameter Description:**
- `owner` (required): Repository owner, fixed as "ai-microsoft"
- `repo` (required): Repository name, fixed as "Kosmos.app"
- `title` (required): Issue title, must pass user input as-is
- `body` (optional but recommended required): Issue description, must completely pass all user-provided content
- `assignees` (optional): Assignee array, format: `["username1", "username2"]`
- `labels` (optional): Label array, used to set priority, etc., format: `["P0"]`, `["P1"]`, `["P2"]`
- `type` (optional): Issue type, options: "Bug", "Feature", "Task" (note case sensitivity)
- `milestone` (optional): Milestone number

**Usage Example:**
```javascript
mcp_github_create_issue({
  owner: "ai-microsoft",
  repo: "Kosmos.app",
  title: "[Feature] Add Workspace address from agentChat configuration in Context enhancement",
  body: "## Description\nAdd Workspace address from agentChat configuration in Context enhancement, so the model knows and can correctly operate the set target Workspace\n\n## Priority\nP1\n\n## Project\nKosmos Iterative Development\n\n## Status\nIn Progress",
  assignees: ["v-yunn"],
  type: "Feature",
  labels: ["P1"]
})
```

### Auxiliary Tools (If Needed)

If `mcp_github_create_issue` cannot meet all requirements, can use the following auxiliary tools:

- `mcp_github_update_issue`: Update created Issue
- `mcp_github_add_issue_comment`: Add comment to Issue
- `mcp_github_list_issues`: List Issues in repository

### Key Reminders
1. **Title and Body must be completely passed**: Do not simplify, summarize, or modify user input
2. **Assignees use array format**: Even with only one assignee, use array `["username"]`
3. **Type parameter is case-sensitive**: Must be "Bug", "Feature", or "Task"
4. **Priority set through labels**: Use `["P0"]`, `["P1"]`, or `["P2"]`
5. **Check return value**: After successful creation, will return Issue ID and URL, must display to user