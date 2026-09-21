import React from 'react';
import {createRoot} from 'react-dom/client';
import {createApiClient} from '../api/client';
import {FluxoLeitura} from '../features/relatorios/components/FluxoLeitura';
import '../index.css';import '../App.css';
if(import.meta.env.DEV&&import.meta.env.VITE_API_MODE==='mock')createRoot(document.getElementById('root')).render(<main style={{maxWidth:1440,margin:'auto'}}><p>Desenvolvimento · dados fictícios</p><FluxoLeitura api={createApiClient()} companyId="conferencia-demo" competenciaReferencia="2026-08" razaoSocial="Empresa de demonstração"/></main>);
