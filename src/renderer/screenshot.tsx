import { createRoot } from 'react-dom/client';

// Import styles
import './styles/globals.css';
import './styles/Screenshot.css';

// Import screenshot main component
import { App } from './screenshot/index';

// Render application
const container = document.getElementById('root');
if (container) {
  console.log('📸 [SCREENSHOT] Root element found, creating React root');
  const root = createRoot(container);
  root.render(<App />);
} else {
  console.error('📸 [SCREENSHOT] Failed to find root element');
}
