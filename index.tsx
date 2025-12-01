
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// --- POLYFILLS FOR SIMPLE-PEER ---
// This is critical for the P2P engine to work in browser/Electron
import { Buffer } from 'buffer';
import process from 'process';

if (typeof window !== 'undefined') {
    (window as any).Buffer = Buffer;
    (window as any).process = process;
}
// ---------------------------------

// FIX: Cast to any to resolve missing DOM types for 'document'.
const rootElement = (window as any).document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <App />
);
