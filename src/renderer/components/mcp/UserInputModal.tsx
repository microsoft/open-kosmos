/**
 * UserInputModal Component
 * A Modal for collecting user-configurable input fields.
 *
 * Uses the unified UserInputField type (from backend UserInputPlaceholderParser)
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Folder, FileText } from 'lucide-react';
import {
  UserInputField,
  validateUserInputValue,
  convertUserInputValue
} from '../../lib/utilities/processUserInputPlaceholder';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import './UserInputModal.css';
import { createLogger } from '../../lib/utilities/logger';
import { useI18n } from '../../lib/i18n/useI18n';
const logger = createLogger('[UserInputModal]');

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
  const { t } = useI18n();
  const [formData, setFormData] = useState<FormData>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize form data
  useEffect(() => {
    if (isOpen && fields.length > 0) {
      const initialData: FormData = {};

      fields.forEach(field => {
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
        logger.error('Workspace API not available');
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
      logger.error('Failed to select folder:', error);
    }
  }, [errors]);

  const handleFileSelect = useCallback(async (key: string) => {
    try {
      if (!window.electronAPI.fs) {
        logger.error('FS API not available');
        return;
      }

      const result = await window.electronAPI.fs.selectFile();

      if (result.success && result.filePath) {
        setFormData(prev => ({
          ...prev,
          [key]: result.filePath!
        }));

        if (errors[key]) {
          setErrors(prev => {
            const newErrors = { ...prev };
            delete newErrors[key];
            return newErrors;
          });
        }
      }
    } catch (error) {
      logger.error('Failed to select file:', error);
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
      // Convert user input values to the correct types
      const userInputs: Record<string, any> = {};

      fields.forEach(field => {
        const value = formData[field.key] || '';
        if (value) {
          userInputs[field.key] = convertUserInputValue(value, field.type);
        }
      });

      onSubmit(userInputs);
    } catch (error) {
      logger.error('Failed to process user inputs:', error);
      // An error message can be shown here
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

    switch (field.control) {
      case 'folder':
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
                placeholder={t('mcp.userInput.selectFolderPlaceholder')}
                readOnly
              />
              <button
                type="button"
                onClick={() => handleFolderSelect(field.key)}
                className="folder-select-btn"
                title={t('mcp.userInput.selectFolder')}
              >
                <Folder size={16} />
              </button>
            </div>
            {error && <div className="input-error">{error}</div>}
          </div>
        );

      case 'file':
        return (
          <div key={field.key} className="user-input-field">
            <label className="user-input-label">
              {field.label}
              {field.isRequired && <span className="required-asterisk">*</span>}
            </label>
            <div className="folder-input-wrapper">
              <input
                value={value}
                onChange={(e) => handleInputChange(field.key, e.target.value)}
                className={`user-input-control folder-input ${error ? 'error' : ''}`}
                placeholder={t('mcp.userInput.selectFilePlaceholder')}
                readOnly
              />
              <button
                type="button"
                onClick={() => handleFileSelect(field.key)}
                className="folder-select-btn"
                title={t('mcp.userInput.selectFile')}
              >
                <FileText size={16} />
              </button>
            </div>
            {error && <div className="input-error">{error}</div>}
          </div>
        );

      case 'text':
      default:
        let inputType = 'text';
        let placeholder = '';

        switch (field.type) {
          case 'INT':
            inputType = 'number';
            placeholder = t('mcp.userInput.enterInteger');
            break;
          case 'DOUBLE':
            inputType = 'number';
            placeholder = t('mcp.userInput.enterDecimal');
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
                  <option value="">{t('mcp.userInput.selectValue')}</option>
                  <option value="true">{t('interactive.true')}</option>
                  <option value="false">{t('interactive.false')}</option>
                </select>
                {error && <div className="input-error">{error}</div>}
              </div>
            );
          default:
            placeholder = t('mcp.userInput.enterValue');
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
  }, [formData, errors, handleFileSelect, handleInputChange, handleFolderSelect, t]);

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[560px]">
        {/* Header */}
        <DialogHeader>
          <DialogTitle>{t('mcp.userInput.configureTitle', { name: serverName })}</DialogTitle>
        </DialogHeader>

        {/* Body */}
        <div className="mt-2 max-h-[60vh] overflow-y-auto">
          <p className="modal-description">
            {t('mcp.userInput.description')}
            {contact && (
              <>
                {' '}{t('mcp.userInput.contactPrefix')}{' '}
                <a href={`mailto:${contact}`} className="contact-link">
                  {contact}
                </a>
                {' '}{t('mcp.userInput.contactSuffix')}
              </>
            )}
          </p>

          <div className="user-input-form">
            {fields.map(field => renderInputField(field))}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="mt-6">
          <button
            className="btn-secondary"
            onClick={handleSkip}
            disabled={isSubmitting}
            type="button"
          >
            {t('mcp.userInput.skipLater')}
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={isSubmitting}
            type="button"
          >
            {isSubmitting ? t('mcp.userInput.configuring') : t('mcp.userInput.confirmContinue')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UserInputModal;