import { useState } from 'react';
import { RotateCw, Camera } from 'lucide-react';
import { screenshotApi } from '../../ipc/screenshot-main';


export function ScreenshotEntry(props: {
  onFile: (file: File) => void;
}) {
  const [isProcessing, setIsProcessing] = useState(false);

  async function startScreenthot() {
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
      title="Attach File (Images & Text Files)"
    >
      {isProcessing ? (
        <RotateCw className="screenshot-icon animate-spin" size={16} />
      ) : (
        <Camera className="screenshot-icon" size={16} />
      )}
    </button>
  );
}

