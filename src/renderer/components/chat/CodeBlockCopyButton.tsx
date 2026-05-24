import React, { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeBlockCopyButtonProps {
  code: string;
}

const CodeBlockCopyButton: React.FC<CodeBlockCopyButtonProps> = ({ code }) => {
  const [copied, setCopied] = useState(false);

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
      title="Copy code"
      aria-label="Copy code"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
};

export default CodeBlockCopyButton;
