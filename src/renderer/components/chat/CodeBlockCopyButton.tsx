import React, { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';

interface CodeBlockCopyButtonProps {
  code: string;
}

const CodeBlockCopyButton: React.FC<CodeBlockCopyButtonProps> = ({ code }) => {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <button
      className="code-block-copy-btn"
      onClick={handleCopy}
      title={t('common.copyCode')}
      aria-label={t('common.copyCode')}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
};

export default CodeBlockCopyButton;
