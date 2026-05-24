# Release Note Generation Prompt

## Task Description
Given a start version and end version, analyze all commit messages in the range (start version < x <= end version) and generate **bilingual (English + Chinese) release notes** suitable for publishing on GitHub Releases.

## Input Parameters
- **Start Version**: The previous release tag (exclusive), e.g. `v1.0.7`
- **End Version**: The target release tag (inclusive), e.g. `v1.1.0`

## Execution Steps

### 1. **Retrieve Commit History**
   - Run `git log --oneline <start_version>..<end_version>` to get all commits in scope
   - If end version is not yet tagged, use `HEAD` instead
   - Example: `git log --oneline v1.0.7..v1.1.0`

### 2. **Analyze and Classify Commits**
   - Read through all commit messages
   - Classify each commit into one of the following categories:
     - 🚀 **New Features** — New capabilities or functionality additions
     - 🐛 **Bug Fixes** — Fixes for user-facing issues and defects
     - ⚡ **Performance Improvements** — Speed, memory, or efficiency optimizations
     - ✨ **Enhancements** — Improvements to existing features and user experience
     - 🗑️ **Deprecations** — Features removed or scheduled for removal

### 3. **Filter and Distill Content**
   - **Include**: User-facing feature changes, behavior changes, UX improvements, bug fixes, performance gains
   - **Exclude** the following types of changes (do NOT include in the release note):
     - Development environment setup or tooling changes
     - Internal architecture / code refactoring
     - Test additions or modifications
     - Specific code implementation details
     - Internationalization (i18n) / localization string changes
     - CI/CD pipeline changes
     - Documentation updates (unless user-facing)
     - Dependency version bumps (unless impactful to users)

### 4. **Generate Bilingual Release Notes**
   - Generate **two separate sections**: English first, then Chinese
   - Summarize each included change into a concise, user-friendly description
   - Use plain language that non-developer users can understand
   - Each bullet point should be one sentence, highlighting the **what** and **why** (not the how)
   - Group by category, omit empty categories
   - The Chinese version should NOT be a literal translation — it should be naturally written for Chinese readers

## Output Format

```markdown
## What's New in <end_version>

### 🚀 New Features
- Brief description of feature A
- Brief description of feature B

### 🐛 Bug Fixes
- Fixed issue where [symptom] occurred when [action]
- Fixed [specific problem description]

### ⚡ Performance Improvements
- Improved [area] performance for faster [outcome]

### ✨ Enhancements
- Improved [feature] to support [new capability]
- Optimized [user workflow] experience

### 🗑️ Deprecations
- Removed support for [feature/API]

---

## <end_version> Release Notes

### 🚀 New Features
- Brief description of feature A
- Brief description of feature B

### 🐛 Bug Fixes
- Fixed issue where [symptom] occurred when [action]
- Fixed [specific problem description]

### ⚡ Performance Improvements
- Improved [area] performance for faster [outcome]

### ✨ Enhancements
- Improved [feature] to support [new capability]
- Optimized [user workflow] experience

### 🗑️ Deprecations
- Removed support for [feature/API]
```

## Example

Given commits:
```
abc1234 feat(chat): add voice input support in chat window
def5678 fix(auth): fix token refresh failure on session timeout
ghi9012 refactor(core): extract message handler into separate module
jkl3456 feat(agent): add knowledge base file upload
mno7890 chore(deps): bump electron to v28
pqr1234 fix(ui): fix sidebar collapse animation glitch
stu5678 test(chat): add unit tests for message parser
vwx9012 perf(search): optimize full-text search indexing speed
yza3456 i18n: add Japanese language support
bcd7890 style(settings): adjust settings page layout spacing
```

Generated release note:
```markdown
## What's New in v1.1.0

### 🚀 New Features
- Added voice input support in the chat window for hands-free messaging
- Added knowledge base file upload for agents, enabling custom data sources

### 🐛 Bug Fixes
- Fixed token refresh failure that caused unexpected logouts during long sessions
- Fixed sidebar collapse animation glitch for smoother navigation

### ⚡ Performance Improvements
- Optimized full-text search indexing for faster search results

### ✨ Enhancements
- Improved settings page layout for better readability

---

## v1.1.0 Release Notes

### 🚀 New Features
- Added voice input support in the chat window for hands-free messaging
- Added knowledge base file upload for agents, enabling custom data sources

### 🐛 Bug Fixes
- Fixed token refresh failure that caused unexpected logouts during long sessions
- Fixed sidebar collapse animation glitch for smoother navigation

### ⚡ Performance Improvements
- Optimized full-text search indexing for faster search results

### ✨ Enhancements
- Improved settings page layout for better readability
```

## Notes
- The generated content is a **draft** — developers should review, adjust, and supplement before publishing
- Focus on **user value and impact**, not technical implementation
- Keep descriptions concise: aim for one line per item, no more than two sentences
- If a single commit contains multiple user-facing changes, split them into separate bullet points
- Merge related commits into a single bullet point when they address the same feature or fix
- Omit version categories that have no entries
- Chinese descriptions should use natural Chinese expression habits, not word-for-word translations
