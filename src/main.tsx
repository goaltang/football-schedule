import { createRoot } from 'react-dom/client';
import App from './App';
import '../styles.css';
import '@fontsource-variable/big-shoulders/wght.css';
import { registerServiceWorker } from './pwa';
createRoot(document.getElementById('root')!).render(<App />);
registerServiceWorker();
