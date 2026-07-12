import React, { useState, useEffect, useRef } from 'react';
import { Keyboard, X, Check } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';

interface ShortcutRecorderProps {
  value: string;
  onChange: (shortcut: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Requires shortcut to include a modifier key (Ctrl/Cmd/Alt/Shift) */
  requireModifier?: boolean;
}

interface KeyCombination {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  key: string;
  keyCode: number;
}

const ShortcutRecorder: React.FC<ShortcutRecorderProps> = ({
  value,
  onChange,
  onSave,
  onCancel,
  placeholder,
  className = "",
  disabled = false,
  requireModifier = false
}) => {
  const { t } = useI18n();
  const [isRecording, setIsRecording] = useState(false);
  const [currentKeys, setCurrentKeys] = useState<string[]>([]);
  const [recordedShortcut, setRecordedShortcut] = useState(value);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  // Reset recorded shortcut when value prop changes
  useEffect(() => {
    setRecordedShortcut(value);
  }, [value]);

  // Convert key event to Electron accelerator format
  const eventToAccelerator = (event: KeyboardEvent): string => {
    const modifiers: string[] = [];
    const key = event.key;

    // Handle modifier keys
    if (event.ctrlKey || event.metaKey) {
      modifiers.push('CommandOrControl');
    }
    if (event.altKey) {
      modifiers.push('Alt');
    }
    if (event.shiftKey) {
      modifiers.push('Shift');
    }

    // Handle special keys
    let keyName = key;
    switch (key) {
      case ' ':
        keyName = 'Space';
        break;
      case 'ArrowUp':
        keyName = 'Up';
        break;
      case 'ArrowDown':
        keyName = 'Down';
        break;
      case 'ArrowLeft':
        keyName = 'Left';
        break;
      case 'ArrowRight':
        keyName = 'Right';
        break;
      case 'Escape':
        keyName = 'Esc';
        break;
      case 'Delete':
        keyName = 'Delete';
        break;
      case 'Backspace':
        keyName = 'Backspace';
        break;
      case 'Enter':
        keyName = 'Return';
        break;
      case 'Tab':
        keyName = 'Tab';
        break;
      default:
        // For alphanumeric keys, use uppercase
        if (key.length === 1 && key.match(/[a-z]/i)) {
          keyName = key.toUpperCase();
        }
        break;
    }

    // Don't record if it's only modifier keys
    if (['Control', 'Alt', 'Shift', 'Meta', 'Cmd'].includes(keyName)) {
      return '';
    }

    // Build the accelerator string
    if (modifiers.length > 0) {
      return `${modifiers.join('+')}+${keyName}`;
    } else {
      return keyName;
    }
  };

  // Get display keys for visual feedback
  const getDisplayKeys = (event: KeyboardEvent): string[] => {
    const keys: string[] = [];

    if (event.ctrlKey || event.metaKey) {
      keys.push(process.platform === 'darwin' ? 'Cmd' : 'Ctrl');
    }
    if (event.altKey) {
      keys.push('Alt');
    }
    if (event.shiftKey) {
      keys.push('Shift');
    }

    const key = event.key;
    if (!['Control', 'Alt', 'Shift', 'Meta', 'Cmd'].includes(key)) {
      switch (key) {
        case ' ':
          keys.push('Space');
          break;
        case 'ArrowUp':
          keys.push('↑');
          break;
        case 'ArrowDown':
          keys.push('↓');
          break;
        case 'ArrowLeft':
          keys.push('←');
          break;
        case 'ArrowRight':
          keys.push('→');
          break;
        case 'Escape':
          keys.push('Esc');
          break;
        default:
          keys.push(key.length === 1 ? key.toUpperCase() : key);
          break;
      }
    }

    return keys;
  };

  const startRecording = () => {
    if (disabled) return;
    setIsRecording(true);
    setCurrentKeys([]);
    setValidationError(null);

    // Focus the input element to capture key events
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    setCurrentKeys([]);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isRecording) return;

    event.preventDefault();
    event.stopPropagation();

    const nativeEvent = event.nativeEvent;
    const accelerator = eventToAccelerator(nativeEvent);
    const displayKeys = getDisplayKeys(nativeEvent);

    // Update visual feedback
    setCurrentKeys(displayKeys);

    // If we have a valid accelerator, record it
    if (accelerator) {
      const hasModifier = nativeEvent.ctrlKey || nativeEvent.metaKey || nativeEvent.altKey || nativeEvent.shiftKey;
      if (requireModifier && !hasModifier) {
        setValidationError(t('shortcut.modifierRequired'));
        return;
      }
      setValidationError(null);
      setRecordedShortcut(accelerator);
      onChange(accelerator);
    }
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isRecording) return;

    event.preventDefault();
    event.stopPropagation();

    // Stop recording when all keys are released
    if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      setTimeout(() => {
        stopRecording();
      }, 100); // Small delay to show the final key combination
    }
  };

  const handleSave = () => {
    if (onSave) {
      onSave();
    }
    stopRecording();
  };

  const handleCancel = () => {
    setRecordedShortcut(value); // Reset to original value
    onChange(value);
    if (onCancel) {
      onCancel();
    }
    stopRecording();
  };

  const clearShortcut = () => {
    setRecordedShortcut('');
    onChange('');
    setCurrentKeys([]);
  };

  return (
    <>
      <div className="shortcut-recorder-container">
        {/* Recording Input */}
        <div
          ref={inputRef}
          tabIndex={0}
          className={`
            flex-1 px-3 py-2 rounded-lg border transition-all duration-200 focus:outline-hidden
            ${
              isRecording
                ? 'bg-warm-900/5 border-warm-900 ring-2 ring-warm-900/20'
                : 'bg-white border-neutral-200 hover:border-neutral-300 focus:border-warm-900'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
          onClick={startRecording}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onBlur={() => {
            if (isRecording) {
              stopRecording();
            }
          }}
        >
          <div className="flex items-center gap-2 min-h-[24px]">
            <Keyboard className="w-4 h-4 text-neutral-400" />

            {isRecording ? (
              <div className="flex items-center gap-1">
                {currentKeys.length > 0 ? (
                  <>
                    {currentKeys.map((key, index) => (
                      <span key={index} className="flex items-center gap-1">
                        <kbd className="px-2 py-1 text-xs bg-warm-900 rounded border border-warm-900 text-white">
                          {key}
                        </kbd>
                        {index < currentKeys.length - 1 && (
                          <span className="text-neutral-400">+</span>
                        )}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="text-warm-900 text-sm animate-pulse">
                    {t('shortcut.pressCombination')}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                {recordedShortcut ? (
                  <div className="flex items-center gap-1">
                    {recordedShortcut.split('+').map((key, index, array) => (
                      <span key={index} className="flex items-center gap-1">
                        <kbd className="px-2 py-1 text-xs bg-warm-900 rounded border border-warm-900 text-white">
                          {key}
                        </kbd>
                        {index < array.length - 1 && (
                          <span className="text-neutral-400">+</span>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-neutral-400 text-sm">{placeholder ?? t('shortcut.placeholder')}</span>
                )}

                {recordedShortcut && !isRecording && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearShortcut();
                    }}
                    className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors"
                    title={t('shortcut.clear')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        {(onSave || onCancel) && (
          <div className="flex gap-2">
            {onSave && (
              <button
                onClick={handleSave}
                disabled={disabled || !recordedShortcut}
                className="px-3 py-2 bg-warm-900 hover:bg-warm-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-1"
                title={t('shortcut.save')}
              >
                <Check className="w-4 h-4" />
                {t('common.save')}
              </button>
            )}

            {onCancel && (
              <button
                onClick={handleCancel}
                disabled={disabled}
                className="px-3 py-2 bg-neutral-600 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-1"
                title={t('common.cancel')}
              >
                <X className="w-4 h-4" />
                {t('common.cancel')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Recording Status */}
      {isRecording && (
        <div className="mt-2 text-xs text-warm-900">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-warm-900 rounded-full animate-pulse"></div>
            {t('shortcut.recordingHint')}
          </div>
        </div>
      )}

      {validationError && !isRecording && (
        <div className="mt-2 text-xs text-danger-500">
          {validationError}
        </div>
      )}
    </>
  );
};

export default ShortcutRecorder;