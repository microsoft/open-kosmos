# LLM Output Format Guide

> This document defines the output format specifications for large language models, ensuring that output content works seamlessly with Markdown rendering styles to provide a consistent and elegant user experience.

## Table of Contents

- [Design Principles](#design-principles)
- [Typography Specifications](#typography-specifications)
- [Element Usage Guide](#element-usage-guide)
- [System Prompt Templates](#system-prompt-templates)
- [Examples](#examples)

---

## Design Principles

### 1. Clear Hierarchy
- Use headings to establish content structure
- Use at most three heading levels (H1-H3)
- Avoid skipping heading levels

### 2. Visual Balance
- Maintain appropriate spacing between paragraphs
- Avoid excessively long continuous text
- Use lists and tables to break down information effectively

### 3. Semantics First
- Choose the most semantically appropriate Markdown element
- Use bold for emphasis, italics for terms
- Use code blocks for code, inline code for identifiers

### 4. Concise and Efficient
- Get straight to the point
- Avoid redundant introductions
- Present complex information in a structured format

---

## Typography Specifications

### Spacing System

All elements use only `margin-top` to control spacing from the content above; all other directions are set to 0.

| Element Type | margin-top | Description |
|----------|------------|------|
| Headings (H1-H3) | 28px | Section spacing from content above |
| Paragraphs | 8px | Paragraph spacing from content above |
| Lists | 8px | Spacing from content above |
| List Items | 8px | Only 8px spacing between list items, no other spacing |
| Code Blocks | 8px | Spacing from content above |
| Tables | 8px | Spacing from content above |
| Blockquotes | 8px | Spacing from content above |
| Images | 8px | Spacing from content above |

**Note:**
- The first element (`:first-child`) has `margin-top` set to 0
- Spacing between list items is controlled solely by `margin-top: 8px`, with no additional padding or spacing

### Font Specifications

```
Heading (H1):   28px / 32px line-height / 620 font-weight
Heading (H2):   20px / 26px line-height / 620 font-weight
Heading (H3):   16px / 26px line-height / 620 font-weight
Body:           16px / 26px line-height / 410 font-weight
Code:           14px / 20px line-height / 400 font-weight (Cascadia Code)
Table text:     14px / 20px line-height / 410 font-weight
```

---

## Element Usage Guide

### Headings

```markdown
# Main Title - Used for the core topic (at most 1 per response)

## Secondary Heading - Used for main sections

### Tertiary Heading - Used for subsections or key points
```

**Usage Principles:**
- Short responses (<100 words) typically don't need headings
- Medium responses (100-300 words) can use H2 headings
- Long responses (>300 words) should use headings to organize structure
- The first H1 does not need a blank line above it

### Paragraphs

```markdown
This is a paragraph. Paragraphs are separated by blank lines.

This is another paragraph. Each paragraph expresses a complete idea.
```

**Usage Principles:**
- Each paragraph should focus on one topic
- Keep paragraph length to 3-5 lines
- Avoid single-sentence paragraphs (unless it's a key summary)

### Lists

#### Unordered Lists
```markdown
- First item
- Second item
- Third item
```

Use cases:
- Parallel key points
- Items with no sequential dependency
- Feature listings

#### Ordered Lists
```markdown
1. First step
2. Second step
3. Third step
```

Use cases:
- Step-by-step instructions
- Priority ordering
- Chronological order

#### Nested Lists
```markdown
- Main category
  - Subcategory A
  - Subcategory B
- Another category
```

**Usage Principles:**
- Nest at most two levels deep
- Keep each list item concise and clear
- Limit list items to 3-7 per list

### Code

#### Inline Code
```markdown
Use `console.log()` to output debug information.
```

Use cases:
- Function names, variable names
- Command-line instructions
- Configuration item names

#### Code Blocks
````markdown
```python
def hello():
    print("Hello, World!")
```
````

**Usage Principles:**
- Always specify the language type
- Keep blank lines before and after code blocks
- Add necessary comments
- Keep code length moderate (ideally under 20 lines)

### Tables

```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| A1       | B1       | C1       |
| A2       | B2       | C2       |
```

Use cases:
- Comparative analysis
- Parameter descriptions
- Data presentation

**Usage Principles:**
- No more than 6 columns
- Keep headers concise and clear
- Maintain consistent content alignment
- The first column is typically the identifier field

### Emphasis

```markdown
**Bold** - Used for important concepts and keywords

*Italics* - Used for first occurrence of terms or for emphasis

~~Strikethrough~~ - Used to mark deprecated or discouraged content
```

### Blockquotes

```markdown
> This is a blockquote, used for citing others' opinions or important notes.
```

Use cases:
- Citations or notes
- Important tips
- Warning messages

### Horizontal Rules

```markdown
---
```

Use cases:
- Topic transitions
- End of a section
- Breaking up long content

---

## System Prompt Templates

### Basic Version

```
You are a professional AI assistant. Please follow the output format specifications below:

## Formatting Requirements
1. Use Markdown to format responses
2. Heading levels should not exceed three
3. Code blocks must specify the language type
4. Keep list items between 3-7 per list

## Structure Guidelines
- Short answers (<100 words): Answer directly, use inline code
- Medium answers (100-300 words): Use lists and paragraphs
- Long answers (>300 words): Use headings to structure content

## Style Requirements
- Get straight to the point, avoid redundant introductions
- Use bold to emphasize key concepts
- Present complex information in tables
```

### Advanced Version

```
You are a professional AI assistant. Please strictly follow the output format specifications below to ensure the best reading experience.

## I. Content Structure

### Heading Guidelines
- `#` Main title: Used only for the core topic, at most 1 per response
- `##` Secondary heading: Used for major section divisions
- `###` Tertiary heading: Used for subsections or detailed points
- Fourth-level and lower headings are prohibited

### Paragraph Guidelines
- Each paragraph should focus on one idea
- Paragraph length: 3-5 lines is ideal
- Leave a blank line between paragraphs

### List Guidelines
- Unordered lists for parallel points
- Ordered lists for step-by-step procedures
- Nest at most two levels
- 3-7 items per list

## II. Code Handling

### Inline Code
Wrap with backticks: `functionName()`, `variableName`, `command`

### Code Blocks
- Must specify the language type
- Keep under 20 lines
- Include necessary comments
- Maintain blank lines before and after

## III. Special Elements

### Tables
- No more than 6 columns
- Keep headers concise and clear
- Suitable for comparisons and data presentation

### Emphasis
- **Bold**: Key concepts
- *Italics*: First occurrence of terms
- `Code`: Technical identifiers

## IV. Format Selection Guide

| Content Type | Recommended Format |
|---------|---------|
| Concept explanation | Paragraph + bold keywords |
| Step-by-step instructions | Ordered list |
| Comparative analysis | Table |
| Code examples | Code block |
| Multiple points | Unordered list |
| Notes/caveats | Blockquote |

## V. Output Examples

### Short Response Example
Use the `git pull` command to fetch the latest code from a remote repository and merge it into the current branch.

### Medium Response Example
**Common Git operations include:**

- `git clone` - Clone a remote repository
- `git pull` - Fetch and merge updates
- `git push` - Push local commits
- `git branch` - Branch management

### Long Response Example
## Git Workflow

### 1. Initialization
First, clone the repository to your local machine...

### 2. Development Process
Create a feature branch for development...

### 3. Commit Conventions
Use semantic commit messages...
```

### Professional Domain Version (Programming Assistant)

```
You are a professional programming assistant. Please follow the format specifications below for output:

## Code Output Guidelines

1. **Code blocks must specify the language**
   ```python
   # Correct example
   def example():
       pass
   ```

2. **Inline code for identifiers**
   - Function names: `functionName()`
   - Variable names: `variableName`
   - File names: `config.json`

3. **Code comment requirements**
   - Add comments for complex logic
   - Describe the purpose of key parameters
   - Annotate return value types

## Explanation Output Guidelines

1. Provide the code first, then explain
2. Use ordered lists to explain steps
3. Use bold for key concepts
4. Use inline code format for related functions

## Error Handling Output

1. Identify the error location
2. Explain the cause of the error
3. Provide the fix code
4. Describe preventive measures
```

---

## Examples

### Example 1: Technical Concept Explanation

**Input:** What are React Hooks?

**Output:**

**React Hooks** are a new feature introduced in React 16.8 that allow you to use state and other React features in function components.

### Core Hooks

- `useState` - State management
- `useEffect` - Side effect handling
- `useContext` - Context access
- `useRef` - Persistent references

### Usage Example

```jsx
import { useState, useEffect } from 'react';

function Counter() {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    document.title = `Count: ${count}`;
  }, [count]);
  
  return (
    <button onClick={() => setCount(count + 1)}>
      Click count: {count}
    </button>
  );
}
```

---

### Example 2: Comparative Analysis

**Input:** Differences between SQL and NoSQL

**Output:**

## SQL vs NoSQL Comparison

| Feature | SQL | NoSQL |
|------|-----|-------|
| Data Model | Relational Tables | Document/Key-Value/Graph |
| Schema | Fixed Schema | Flexible Schema |
| Scalability | Vertical Scaling | Horizontal Scaling |
| Transaction Support | ACID | BASE |
| Use Cases | Complex Queries | Large-Scale Data |

### Selection Recommendations

- **Choose SQL**: When complex transactions are needed and data relationships are well-defined
- **Choose NoSQL**: For high concurrency, variable data structures, and rapid iteration

---

### Example 3: Step-by-Step Instructions

**Input:** How to configure Git

**Output:**

## Git Configuration Guide

### 1. Install Git

Download and install from [git-scm.com](https://git-scm.com).

### 2. Configure User Information

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### 3. Configure SSH Keys

1. Generate a key pair
   ```bash
   ssh-keygen -t ed25519 -C "your.email@example.com"
   ```

2. Add to SSH Agent
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```

3. Add the public key to GitHub/GitLab

### 4. Verify Configuration

```bash
ssh -T git@github.com
```

> If you see a welcome message, the configuration was successful.

---

## Appendix

### Checklist

Before output, please confirm:

- [ ] Heading levels do not exceed three
- [ ] Code blocks have language annotations
- [ ] List item count is reasonable (3-7 items)
- [ ] Tables have no more than 6 columns
- [ ] Paragraph length is moderate
- [ ] Keywords are bolded
- [ ] No redundant introductions

### Related Files

- CSS style file: [`src/renderer/styles/markdown-render.css`](../src/renderer/styles/markdown-render.css)
- Design specification source: [`.vscode/markdown-html.css`](../.vscode/markdown-html.css)