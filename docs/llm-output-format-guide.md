# LLM Output Format Specification Guide

> This document defines formatting standards for large language model output, ensuring output content works seamlessly with Markdown rendering styles to provide a consistent and elegant user experience.

## Table of Contents

- [Design Principles](#design-principles)
- [Typography Standards](#typography-standards)
- [Element Usage Guide](#element-usage-guide)
- [System Prompt Templates](#system-prompt-templates)
- [Examples](#examples)

---

## Design Principles

### 1. Clear Hierarchy
- Use headings to establish content structure
- Use at most three heading levels (H1–H3)
- Avoid skipping heading levels

### 2. Visual Balance
- Maintain appropriate spacing between paragraphs
- Avoid excessively long continuous text
- Use lists and tables to break up information appropriately

### 3. Semantics First
- Choose the Markdown element that best matches the semantics
- Bold for emphasis, italic for terminology
- Code blocks for code, inline code for identifiers

### 4. Concise and Efficient
- Get to the point directly
- Avoid redundant preambles
- Present complex information in structured form

---

## Typography Standards

### Spacing System

All elements use only `margin-top` to control spacing from the content above; all other directions are 0.

| Element Type | margin-top | Notes |
|----------|------------|------|
| Headings (H1–H3) | 28px | Section spacing from content above |
| Paragraphs | 8px | Paragraph spacing from content above |
| Lists | 8px | Spacing from content above |
| List items | 8px | Only 8px between list items; no other spacing |
| Code blocks | 8px | Spacing from content above |
| Tables | 8px | Spacing from content above |
| Blockquotes | 8px | Spacing from content above |
| Images | 8px | Spacing from content above |

**Notes:**
- The first element (`:first-child`) has `margin-top` of 0
- Spacing between list items is controlled only by `margin-top: 8px`; no other padding or spacing

### Typography Standards

```
Heading (H1):   28px / line-height 32px / weight 620
Heading (H2):   20px / line-height 26px / weight 620
Heading (H3):   16px / line-height 26px / weight 620
Body text:      16px / line-height 26px / weight 410
Code:           14px / line-height 20px / weight 400 (Cascadia Code)
Table text:     14px / line-height 20px / weight 410
```

---

## Element Usage Guide

### Headings

```markdown
# Main Heading — for the core topic (at most 1 per reply)

## Second-level Heading — for major sections

### Third-level Heading — for subsections or key points
```

**Usage principles:**
- Short replies (<100 words) typically don't need headings
- Medium replies (100–300 words) may use second-level headings
- Long replies (>300 words) should use headings to organize structure
- The first H1 does not need a leading blank line

### Paragraphs

```markdown
This is a paragraph. Paragraphs are separated by blank lines.

This is another paragraph. Each paragraph expresses one complete idea.
```

**Usage principles:**
- Each paragraph focuses on one topic
- Keep paragraph length to 3–5 lines
- Avoid single-sentence paragraphs (unless it's a key summary)

### Lists

#### Unordered Lists
```markdown
- First item
- Second item
- Third item
```

Applicable scenarios:
- Parallel points
- Items with no order dependency
- Feature listings

#### Ordered Lists
```markdown
1. First step
2. Second step
3. Third step
```

Applicable scenarios:
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

**Usage principles:**
- Nest at most two levels deep
- Keep each list item concise
- Limit list items to 3–7 per group

### Code

#### Inline Code
```markdown
Use `console.log()` to output debug information.
```

Applicable scenarios:
- Function names, variable names
- Command-line instructions
- Configuration option names

#### Code Blocks
````markdown
```python
def hello():
    print("Hello, World!")
```
````

**Usage principles:**
- Always specify the language type
- Keep a blank line before and after code blocks
- Add necessary comments
- Keep code to a reasonable length (ideally under 20 lines)

### Tables

```markdown
| Col1 | Col2 | Col3 |
|-----|-----|-----|
| A1  | B1  | C1  |
| A2  | B2  | C2  |
```

Applicable scenarios:
- Comparative analysis
- Parameter descriptions
- Data presentation

**Usage principles:**
- No more than 6 columns
- Keep column headers concise
- Align content consistently
- First column is usually the identifier field

### Emphasis

```markdown
**Bold** — for important concepts and keywords

*Italic* — for first occurrence of a term or to add emphasis

~~Strikethrough~~ — to mark deprecated or not-recommended content
```

### Blockquotes

```markdown
> This is a blockquote, used to cite others' views or provide important notes.
```

Applicable scenarios:
- Citations from references or notes
- Important tips
- Warning information

### Dividers

```markdown
---
```

Applicable scenarios:
- Topic transitions
- End of a section
- Breaking up long content

---

## System Prompt Templates

### Basic Version

```
You are a professional AI assistant. Please follow these output format standards:

## Format Requirements
1. Use Markdown to format replies
2. Heading levels should not exceed three
3. Specify the language type in code blocks
4. Keep list items to 3–7 per group

## Structure Recommendations
- Short answers (<100 words): answer directly, use inline code
- Medium answers (100–300 words): use lists and paragraphs
- Long answers (>300 words): use headings to structure content

## Style Requirements
- Get to the point directly; avoid redundant preambles
- Use bold to emphasize key concepts
- Present complex information in tables
```

### Advanced Version

```
You are a professional AI assistant. Please strictly follow the output format standards below to ensure the best reading experience.

## I. Content Structure

### Heading Standards
- `#` Main heading: for the core topic only; at most 1 per reply
- `##` Second-level heading: for major section divisions
- `###` Third-level heading: for subsections or detailed points
- Fourth-level headings and below are prohibited

### Paragraph Standards
- Each paragraph focuses on one point
- Paragraph length: 3–5 lines recommended
- Leave one blank line between paragraphs

### List Standards
- Unordered lists for parallel points
- Ordered lists for step-by-step flows
- Nest at most two levels
- 3–7 items per list group

## II. Code Handling

### Inline Code
Wrap with backticks: `functionName()`, `variableName`, `command`

### Code Blocks
- Must specify language type
- Keep under 20 lines
- Include necessary comments
- Leave blank lines before and after

## III. Special Elements

### Tables
- No more than 6 columns
- Keep headers concise and clear
- Use for comparisons and data presentation

### Emphasis
- **Bold**: key concepts
- *Italic*: first occurrence of a term
- `Code`: technical identifiers

## IV. Format Selection Guide

| Content Type | Recommended Format |
|---------|---------|
| Concept explanation | Paragraph + bold keywords |
| Step-by-step instructions | Ordered list |
| Comparative analysis | Table |
| Code examples | Code block |
| Multiple points | Unordered list |
| Cautions | Blockquote |

## V. Output Examples

### Short reply example
Use the `git pull` command to fetch the latest code from the remote repository and merge it into the current branch.

### Medium reply example
**Common Git operations include:**

- `git clone` — Clone a remote repository
- `git pull` — Fetch and merge updates
- `git push` — Push local commits
- `git branch` — Branch management

### Long reply example
## Git Workflow

### 1. Initialization
Start by cloning the repository locally...

### 2. Development Flow
Create a feature branch for development...

### 3. Commit Standards
Use semantic commit messages...
```

### Domain-Specific Version (Programming Assistant)

```
You are a professional programming assistant. Please follow these format standards for output:

## Code Output Standards

1. **Code blocks must specify the language**
   ```python
   # Correct example
   def example():
       pass
   ```

2. **Use inline code for identifiers**
   - Function names: `functionName()`
   - Variable names: `variableName`
   - File names: `config.json`

3. **Code comment requirements**
   - Add comments for complex logic
   - Explain the purpose of key parameters
   - Annotate return value types

## Explanation Output Standards

1. Provide code first, then explanation
2. Use ordered lists to explain steps
3. Mark key concepts in bold
4. Format related functions as inline code

## Error Handling Output

1. Identify the location of the error
2. Explain the cause of the error
3. Provide a fix with code
4. Describe preventive measures
```

---

## Examples

### Example 1: Technical Concept Explanation

**Input:** What are React Hooks?

**Output:**

**React Hooks** are a feature introduced in React 16.8 that allow state and other React features to be used in function components.

### Core Hooks

- `useState` — State management
- `useEffect` — Side effect handling
- `useContext` — Context access
- `useRef` — Reference persistence

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

**Input:** What is the difference between SQL and NoSQL?

**Output:**

## SQL vs NoSQL Comparison

| Feature | SQL | NoSQL |
|------|-----|-------|
| Data model | Relational tables | Document/Key-value/Graph |
| Schema | Fixed schema | Flexible schema |
| Scalability | Vertical scaling | Horizontal scaling |
| Transaction support | ACID | BASE |
| Best for | Complex queries | Large-scale data |

### Selection Guide

- **Choose SQL**: complex transactions required, well-defined data relationships
- **Choose NoSQL**: high concurrency, variable data structures, rapid iteration

---

### Example 3: Step-by-Step Instructions

**Input:** How do I configure Git?

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

Before outputting, please confirm:

- [ ] Heading levels do not exceed three
- [ ] Code blocks specify the language
- [ ] List item count is reasonable (3–7 items)
- [ ] Table columns do not exceed 6
- [ ] Paragraph length is appropriate
- [ ] Keywords are bolded
- [ ] No redundant preamble

### Related Files

- CSS style file: [`src/renderer/styles/markdown-render.css`](../src/renderer/styles/markdown-render.css)
- Design spec source: [`.vscode/markdown-html.css`](../.vscode/markdown-html.css)
