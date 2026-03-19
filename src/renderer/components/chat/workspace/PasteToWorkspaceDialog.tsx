import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, Clipboard, Loader2, FileText, Sparkles } from 'lucide-react';
import '../../../styles/PasteToWorkspaceDialog.css';

export interface PasteToWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (content: string, fileName: string) => Promise<void>;
  workspacePath: string;
}

/**
 * PasteToWorkspaceDialog - Dialog for pasting text to Workspace
 * 
 * Features:
 * 1. Provides a text input for users to paste content
 * 2. Automatically calls LLM to generate file name and extension
 * 3. Allows users to edit the file name
 * 4. Saves the file to the current workspace directory
 */
const PasteToWorkspaceDialog: React.FC<PasteToWorkspaceDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  workspacePath
}) => {
  // State
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reset state
  const resetState = useCallback(() => {
    setContent('');
    setFileName('');
    setIsGeneratingName(false);
    setIsSaving(false);
    setError(null);
    if (generateTimeoutRef.current) {
      clearTimeout(generateTimeoutRef.current);
      generateTimeoutRef.current = null;
    }
  }, []);

  // Close dialog
  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // Focus textarea when dialog opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
    
    // Clean up old state
    if (isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  // Generate file name (with debounce)
  const generateFileName = useCallback(async (contentToAnalyze: string) => {
    if (!contentToAnalyze.trim() || contentToAnalyze.trim().length < 10) {
      return;
    }

    setIsGeneratingName(true);
    setError(null);

    try {
      const result = await window.electronAPI?.llm?.generateFileName?.(contentToAnalyze);
      
      if (result?.success && result.data?.fullFileName) {
        setFileName(result.data.fullFileName);
      } else if (result?.data?.fullFileName) {
        // Even if success is false, there may be a fallback file name
        setFileName(result.data.fullFileName);
      } else {
        // Fallback: generate timestamp-based file name
        const timestamp = Date.now();
        setFileName(`pasted-content-${timestamp}.txt`);
      }
    } catch (err) {
      console.error('[PasteToWorkspaceDialog] Error generating file name:', err);
      // Fallback
      const timestamp = Date.now();
      setFileName(`pasted-content-${timestamp}.txt`);
    } finally {
      setIsGeneratingName(false);
    }
  }, []);

  // Trigger file name generation on content change (with debounce)
  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    setError(null);

    // Clear previous timer
    if (generateTimeoutRef.current) {
      clearTimeout(generateTimeoutRef.current);
    }

    // Only trigger generation when content is long enough
    if (newContent.trim().length >= 10) {
      generateTimeoutRef.current = setTimeout(() => {
        generateFileName(newContent);
      }, 800); // 800ms debounce
    }
  }, [generateFileName]);

  // Manually trigger file name regeneration
  const handleRegenerateFileName = useCallback(() => {
    if (content.trim().length >= 10) {
      generateFileName(content);
    }
  }, [content, generateFileName]);

  // Handle file name input
  const handleFileNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    // Clean file name: remove illegal characters
    const cleanedName = newName.replace(/[<>:"/\\|?*]/g, '');
    setFileName(cleanedName);
  }, []);

  // Save file
  const handleSave = useCallback(async () => {
    if (!content.trim()) {
      setError('Please enter some content to save.');
      return;
    }

    if (!fileName.trim()) {
      setError('Please enter a file name.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(content, fileName);
      handleClose();
    } catch (err) {
      console.error('[PasteToWorkspaceDialog] Error saving file:', err);
      setError(err instanceof Error ? err.message : 'Failed to save file.');
    } finally {
      setIsSaving(false);
    }
  }, [content, fileName, onSave, handleClose]);

  // Handle Ctrl+Enter shortcut to save
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isSaving && content.trim() && fileName.trim()) {
        handleSave();
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    }
  }, [handleSave, handleClose, isSaving, content, fileName]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div className="paste-to-workspace-overlay" onClick={handleClose}>
      <div 
        className="paste-to-workspace-dialog" 
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="paste-dialog-header">
          <div className="paste-dialog-title">
            <Clipboard size={20} />
            <span>Paste to Knowledge Base</span>
          </div>
          <button 
            className="paste-dialog-close-btn"
            onClick={handleClose}
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Area */}
        <div className="paste-dialog-body">
          {/* Text Input */}
          <div className="paste-content-section">
            <label className="paste-section-label">Content</label>
            <textarea
              ref={textareaRef}
              className="paste-content-textarea"
              value={content}
              onChange={handleContentChange}
              placeholder="Paste content here..."
              disabled={isSaving}
            />
          </div>

          {/* File Name Input */}
          <div className="paste-filename-section">
            <div className="paste-filename-header">
              <label className="paste-section-label">
                <FileText size={14} />
                <span>File Name</span>
              </label>
              {content.trim().length >= 10 && (
                <button
                  className="paste-regenerate-btn"
                  onClick={handleRegenerateFileName}
                  disabled={isGeneratingName || isSaving}
                  title="Regenerate file name with AI"
                >
                  <Sparkles size={14} />
                  <span>Regenerate</span>
                </button>
              )}
            </div>
            <div className="paste-filename-input-wrapper">
              <input
                type="text"
                className="paste-filename-input"
                value={fileName}
                onChange={handleFileNameChange}
                placeholder={isGeneratingName ? 'Generating...' : 'Enter file name...'}
                disabled={isSaving}
              />
              {isGeneratingName && (
                <div className="paste-filename-loading">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              )}
            </div>
            <p className="paste-filename-hint">
              AI auto-generates file name based on content format (text, markdown, json, html, js, etc.)
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="paste-error-message">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="paste-dialog-footer">
          <button
            className="paste-dialog-btn secondary"
            onClick={handleClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            className="paste-dialog-btn primary"
            onClick={handleSave}
            disabled={isSaving || !content.trim() || !fileName.trim()}
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PasteToWorkspaceDialog;
