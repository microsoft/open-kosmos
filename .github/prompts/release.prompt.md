# Release Automation Prompt

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
   - **All content must be in English (including description and commit body)**
   - Add detailed commit body if necessary

4. **Execute Git Operations**
   - `git add .` - Add all changed files
   - `git commit -m "generated commit message"` - Commit changes
   - `git push` - Push to remote repository

## Release Publication Workflow

### 5. **Version Update**
Ask user to choose version update type:
   - patch (patch version) - Bug fixes, backward compatible
   - minor (minor version) - New features, backward compatible  
   - major (major version) - Major changes, may not be backward compatible

Execute corresponding command based on user choice:
   - `npm run prepare:release:patch` - Patch version: 1.0.7 → 1.0.8
   - `npm run prepare:release:minor` - Minor version: 1.0.7 → 1.1.0  
   - `npm run prepare:release:major` - Major version: 1.0.7 → 2.0.0

### 6. **Generate Version Changelog**
   - Get current version tag: `git describe --tags --abbrev=0`
   - Analyze change scope: All modifications from current version tag commit to latest commit
   - Use `git log --oneline <current version tag>..HEAD` to get commit history
   - Automatically analyze and update specific content in `CHANGELOG.md`
   - **All CHANGELOG entries must be in English**
   - Ensure changelog includes:
     - Features - Commits starting with feat:
     - Bug Fixes - Commits starting with fix:
     - Breaking Changes - Commits containing BREAKING CHANGE
     - Improvements - Commits starting with refactor:, perf:, style:
     - Documentation - Commits starting with docs:
     - Others - Commits starting with chore:, test:

### 7. **Create Release Tag and Commit**
   - `git add .` - Add all changes (including version and changelog)
   - Create release commit using standard format:
     ```
     v{version number}
     
     {CHANGELOG content summary}
     ```
     Example:
     ```
     v1.0.21
     
     ### New Features
     - Add MCP client manager functionality
     - Add model data retrieval API
     
     ### Bug Fixes
     - Fix sandbox write EIO error
     - Fix token auto-refresh mechanism
     
     ### Improvements
     - Optimize ChatInput interface design
     - Enhance GitHub Actions configuration
     ```
   - `git commit -m "v{version number}" -m "{CHANGELOG content}"` - Execute commit
   - `git tag v{version number}` - Create version tag
   - `git push origin main --tags` - Push code and tags to remote repository

## Output Requirements
- Display list of changed files
- Generated commit message
- Current version number and target version number
- **Change History Analysis**:
  - Current version tag information
  - Number and list of commits since current version
  - Change statistics by type (feat, fix, docs, refactor, etc.)
- **Changelog Update Content**:
  - Auto-generated CHANGELOG entries
  - Categorized feature change descriptions
- **Release Commit Format**:
  - Standardized release commit message (version number + changelog summary)
- Executed Git commands and their results
- Tag creation and push success confirmation

## Notes
- Ensure commit message follows project conventions
- Check for files that need to be excluded
- Verify remote repository connection status
- Confirm version number increment follows semantic versioning specification
- **Changelog Scope Confirmation**:
  - Ensure correct identification of current version tag
  - Verify change scope covers all commits from current tag to HEAD
  - Check for any missing important changes
- **Release Commit Format Validation**:
  - First line must be version number format: `v{version number}`
  - Second line is blank separator
  - Third line starts with CHANGELOG content summary
  - Ensure commit message is concise but contains key change points
- Check CHANGELOG.md content completeness and format correctness before release
- Verify tag is successfully created and correctly pushed to remote repository