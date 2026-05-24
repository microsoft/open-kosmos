import React, { useState, useEffect } from 'react';

interface Props {
  text: string;
  onDismiss: () => void;
}

const DISPLAY_DURATION = 10_000;
const FADE_LEAD = 3_000;

export const BuddySpeechBubble: React.FC<Props> = ({ text, onDismiss }) => {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), DISPLAY_DURATION - FADE_LEAD);
    const dismissTimer = setTimeout(onDismiss, DISPLAY_DURATION);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(dismissTimer);
    };
  }, [text, onDismiss]);

  return (
    <div className={`buddy-speech-bubble${fading ? ' fading' : ''}`}>
      {text}
    </div>
  );
};
