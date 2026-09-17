import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConferenciaTab } from '../features/conferencia/components/renderConferenciaTab';
import '../index.css';
import '../App.css';
import '../styles/conferencia.css';

// Esta entrada só monta no servidor dev em modo mock. Não oferece conexão com produção.
if (import.meta.env.DEV && import.meta.env.VITE_API_MODE === 'mock') {
  createRoot(document.getElementById('root')).render(
    <main style={{ maxWidth: 1640, margin: '0 auto', padding: '24px clamp(12px, 3vw, 40px)' }}>
      <aside className="cq-notice" style={{ marginBottom: 24 }}>Desenvolvimento · empresa fictícia · nenhuma conexão com produção.</aside>
      <ConferenciaTab companyId="conferencia-demo" competencia="2026-08" />
    </main>,
  );
}
