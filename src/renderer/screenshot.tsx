import { createRoot } from 'react-dom/client';

// Import styles
import './styles/globals.css';
import './styles/Screenshot.css';

// Import the main screenshot component
import { App } from './screenshot/index';
import { createLogger } from './lib/utilities/logger';
const logger = createLogger('[Screenshot]');

// Render the app
const container = document.getElementById('root');
if (container) {
  logger.debug('📸 [SCREENSHOT] Root element found, creating React root');
  const root = createRoot(container);
  root.render(<App />);
} else {
  logger.error('📸 [SCREENSHOT] Failed to find root element');
}
