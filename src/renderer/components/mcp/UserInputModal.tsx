/**
 * UserInputModal Component
 * Modal for collecting user input configuration items
 * 
 * Uses the unified UserInputField type (from backend UserInputPlaceholderParser)
 */

import React, { useState, useCallback, useEffect } from 'react';
import { X, Folder, Mail } from 'lucide-react';
import { 
  UserInputField,
  validateUserInputValue, 
  convertUserInputValue 
} from '../../lib/utilities/processUserInputPlaceholder';
import '../../styles/Modal.css';
import './UserInputModal.css';

interface UserInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Uses the unified UserInputField type (from backend parser) */
  fields: UserInputField[];
  serverName: string;
  contact?: string;
  onSubmit: (userInputs: Record<string, any>) => void;
  onSkip: () => void;
}

interface FormData {
  [key: string]: string;
}

interface FormErrors {
  [key: string]: string;
}

const UserInputModal: React.FC<UserInputModalProps> = ({
  isOpen,
  onClose,
  fields,
  serverName,
  contact,
  onSubmit,
  onSkip
}) => {
  const [formData, setFormData] = useState<FormData>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize form data
  useEffect(() => {
    if (isOpen && fields.length > 0) {
      const initialData: FormData = {};
      
      fields.forEach(field => {
        // Use backend-provided default values (EMAIL type already generated in backend)
        initialData[field.key] = field.defaultValue || '';
      });
      
      setFormData(initialData);
      setErrors({});
    }
  }, [isOpen, fields]);

  const handleInputChange = useCallback((key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [key]: value
    }));

    // Clear error
    if (errors[key]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  }, [errors]);

  const handleFolderSelect = useCallback(async (key: string) => {
    try {
      if (!window.electronAPI.workspace) {
        console.error('Workspace API not available');
        return;
      }

      const result = await window.electronAPI.workspace.selectFolder();

      if (result.success && result.folderPath) {
        setFormData(prev => ({
          ...prev,
          [key]: result.folderPath!
        }));

        // Clear error
        if (errors[key]) {
          setErrors(prev => {
            const newErrors = { ...prev };
            delete newErrors[key];
            return newErrors;
          });
        }
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  }, [errors]);

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};
    
    fields.forEach(field => {
      const value = formData[field.key] || '';
      const validation = validateUserInputValue(value, field);
      
      if (!validation.isValid && validation.error) {
        newErrors[field.key] = validation.error;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, fields]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      // Convert user input values to correct types
      const userInputs: Record<string, any> = {};
      
      fields.forEach(field => {
        const value = formData[field.key] || '';
        if (value) {
          userInputs[field.key] = convertUserInputValue(value, field.type);
        }
      });

      onSubmit(userInputs);
    } catch (error) {
      console.error('Failed to process user inputs:', error);
      // Can show error toast here
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, fields, validateForm, onSubmit]);

  const handleSkip = useCallback(() => {
    onSkip();
  }, [onSkip]);

  const renderInputField = useCallback((field: UserInputField) => {
    const value = formData[field.key] || '';
    const error = errors[field.key];
    
    switch (field.subtype) {
      case 'FOLDER':
        return (
          <div key={field.key} className="user-input-field">
            <label className="user-input-label">
              {field.label}
              {field.isRequired && <span className="required-asterisk">*</span>}
            </label>
            <div className="folder-input-wrapper">
              <input
                type="text"
                value={value}
                onChange={(e) => handleInputChange(field.key, e.target.value)}
                className={`user-input-control folder-input ${error ? 'error' : ''}`}
                placeholder="Select a folder..."
                readOnly
              />
              <button
                type="button"
                onClick={() => handleFolderSelect(field.key)}
                className="folder-select-btn"
                title="Select folder"
              >
                <Folder size={16} />
              </button>
            </div>
            {error && <div className="input-error">{error}</div>}
          </div>
        );

      case 'EMAIL':
        return (
          <div key={field.key} className="user-input-field">
            <label className="user-input-label">
              {field.label}
              {field.isRequired && <span className="required-asterisk">*</span>}
            </label>
            <div className="email-input-wrapper">
              <Mail size={16} className="email-icon" />
              <input
                type="email"
                value={value}
                onChange={(e) => handleInputChange(field.key, e.target.value)}
                className={`user-input-control email-input ${error ? 'error' : ''}`}
                placeholder="user@microsoft.com"
              />
            </div>
            {error && <div className="input-error">{error}</div>}
          </div>
        );

      case 'NORMAL':
      default:
        let inputType = 'text';
        let placeholder = '';

        switch (field.type) {
          case 'INT':
            inputType = 'number';
            placeholder = 'Enter integer value...';
            break;
          case 'DOUBLE':
            inputType = 'number';
            placeholder = 'Enter decimal value...';
            break;
          case 'BOOLEAN':
            return (
              <div key={field.key} className="user-input-field">
                <label className="user-input-label">
                  {field.label}
                  {field.isRequired && <span className="required-asterisk">*</span>}
                </label>
                <select
                  value={value}
                  onChange={(e) => handleInputChange(field.key, e.target.value)}
                  className={`user-input-control boolean-select ${error ? 'error' : ''}`}
                >
                  <option value="">Select value...</option>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
                {error && <div className="input-error">{error}</div>}
              </div>
            );
          default:
            placeholder = 'Enter value...';
        }

        return (
          <div key={field.key} className="user-input-field">
            <label className="user-input-label">
              {field.label}
              {field.isRequired && <span className="required-asterisk">*</span>}
            </label>
            <input
              type={inputType}
              value={value}
              onChange={(e) => handleInputChange(field.key, e.target.value)}
              className={`user-input-control ${error ? 'error' : ''}`}
              placeholder={placeholder}
              step={field.type === 'DOUBLE' ? 'any' : undefined}
            />
            {error && <div className="input-error">{error}</div>}
          </div>
        );
    }
  }, [formData, errors, handleInputChange, handleFolderSelect]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container user-input-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header - using unified modal-header structure */}
        <div className="modal-header">
          <h2 className="modal-title">Configure {serverName}</h2>
          <button
            className="model-btn-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            <X size={12} />
          </button>
        </div>

        {/* Modal Body - using unified modal-body structure */}
        <div className="modal-body">
          <p className="modal-description">
            This MCP server requires some configuration. Please fill in the required information below.
            {contact && (
              <>
                {' '}If you encounter any issues during the configuration process, contact{' '}
                <a href={`mailto:${contact}`} className="contact-link">
                  {contact}
                </a>
                {' '}for assistance.
              </>
            )}
          </p>

          <div className="user-input-form">
            {fields.map(field => renderInputField(field))}
          </div>
        </div>

        {/* Modal Footer - using unified modal-footer structure */}
        <div className="modal-footer">
          <button
            className="btn-secondary"
            onClick={handleSkip}
            disabled={isSubmitting}
            type="button"
          >
            Skip, Set Up Later
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={isSubmitting}
            type="button"
          >
            {isSubmitting ? 'Configuring...' : 'Confirm and Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserInputModal;