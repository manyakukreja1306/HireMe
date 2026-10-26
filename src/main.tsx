import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App.tsx';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "pk_test_c291Z2h0LWNob3ctODYuY2xlcmsuYWNjb3VudHMuZGV2JA";

if (!PUBLISHABLE_KEY) {
  createRoot(document.getElementById('root')!).render(
    <div style={{ padding: '3rem', fontFamily: 'sans-serif', textAlign: 'center', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: 'white', padding: '2rem', borderRadius: '1rem', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}>
        <h1 style={{ color: '#e11d48', marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 'bold' }}>Missing Clerk Publishable Key</h1>
        <p style={{ color: '#475569', marginBottom: '1.5rem', lineHeight: '1.5' }}>
          Please add <strong>VITE_CLERK_PUBLISHABLE_KEY</strong> to your environment variables in the AI Studio Secrets panel.
        </p>
        <p style={{ color: '#475569', marginBottom: '1rem' }}>
          You can find this key in your <a href="https://dashboard.clerk.com/last-active?path=api-keys" target="_blank" rel="noreferrer" style={{ color: '#4f46e5', textDecoration: 'underline' }}>Clerk Dashboard</a>.
        </p>
      </div>
    </div>
  );
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    </StrictMode>,
  );
}
