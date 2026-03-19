import React, { useRef, useEffect } from 'react'

import '../../../styles/Agent.css';
import { MarkdownEditorProps } from './types'

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  showPreview,
  onTogglePreview,
  readOnly = false
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Removed auto-resize height logic, keeping textarea at fixed height with scrollbar

  // Simple Markdown rendering function
  const renderMarkdown = (text: string): string => {
    // Split by lines for processing
    const lines = text.split('\n')
    const result: string[] = []
    let inList = false
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      
      if (!line) {
        // Empty line handling
        if (inList) {
          result.push('</ul>')
          inList = false
        }
        result.push('<br>')
        continue
      }
      
      // Headers
      if (line.startsWith('### ')) {
        if (inList) {
          result.push('</ul>')
          inList = false
        }
        result.push(`<h3>${line.substring(4)}</h3>`)
      } else if (line.startsWith('## ')) {
        if (inList) {
          result.push('</ul>')
          inList = false
        }
        result.push(`<h2>${line.substring(3)}</h2>`)
      } else if (line.startsWith('# ')) {
        if (inList) {
          result.push('</ul>')
          inList = false
        }
        result.push(`<h1>${line.substring(2)}</h1>`)
      } else if (line.startsWith('- ')) {
        // List items
        if (!inList) {
          result.push('<ul>')
          inList = true
        }
        let listContent = line.substring(2)
        // Apply inline formatting
        listContent = listContent
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
        result.push(`<li>${listContent}</li>`)
      } else {
        // Regular paragraphs
        if (inList) {
          result.push('</ul>')
          inList = false
        }
        let content = line
        // Apply inline formatting
        content = content
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
        result.push(`<p>${content}</p>`)
      }
    }
    
    // Close any open list
    if (inList) {
      result.push('</ul>')
    }
    
    return result.join('')
  }

  return (
    <div className="markdown-editor">

      {/* Content Area */}
      <div className="content-area">
        {showPreview ? (
          /* Preview Mode */
          <div
            className="preview-content"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(value)
            }}
          />
        ) : (
          /* Edit Mode */
          <textarea
            ref={textareaRef}
            className={`edit-textarea ${readOnly ? 'readonly' : ''}`}
            value={value}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            readOnly={readOnly}
            style={readOnly ? { cursor: 'not-allowed', backgroundColor: '#f5f5f5' } : undefined}
            placeholder="Enter your system prompt here...

You can use Markdown formatting:
# Headers
**Bold text**
*Italic text*
- List items

Example:
You are a helpful AI assistant specialized in [your domain].

## Guidelines
- Be professional and helpful
- Provide accurate information
- Ask clarifying questions when needed

## Specific Instructions
[Add your specific instructions here...]"
          />
        )}
      </div>

      </div>
  )
}

export default MarkdownEditor