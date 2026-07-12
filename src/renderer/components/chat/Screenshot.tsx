import { useState } from 'react';
import { RotateCw, Camera } from 'lucide-react';
import { screenshotApi } from '../../ipc/screenshot-main';
import { useI18n } from '../../lib/i18n/useI18n';


export function ScreenshotEntry(props: {
  onFile: (file: File) => void;
}) {
  const { t } = useI18n();
  const [isProcessing, setIsProcessing] = useState(false);

  async function startScreenthot() {
    /* v8 ignore next -- defensive double-submit guard; the UI disables the button while processing */
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const result = await screenshotApi.capture();
      if (result && result.type === 'success') {
        const uint8Array = new Uint8Array(result.data);
        const blob = new Blob([uint8Array], { type: 'image/png' });
        const file = new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' });
        props.onFile(file);
      }
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <button
      className="attachment-button file-attachment-button"
      onClick={startScreenthot}
      disabled={isProcessing}
      title={t('chat.input.attachFile')}
    >
      {isProcessing ? (
        <RotateCw className="screenshot-icon animate-spin" size={16} />
      ) : (
        <Camera className="screenshot-icon" size={16} />
      )}
    </button>
  );
}
