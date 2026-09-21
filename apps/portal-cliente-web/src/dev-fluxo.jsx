import React from 'react';import {createRoot} from 'react-dom/client';
import {api} from './api';import {fluxoDeCaixaDoMock} from './api/mock/fluxoDeCaixaDoMock';
import {BlocoDeDemonstracao} from './features/painel/BlocoDeDemonstracao';
import './styles/tokens.css';import './styles/app.css';import './features/painel/painel-responsive.css';
if(import.meta.env.DEV&&import.meta.env.VITE_API_MODE==='mock'){api.getFluxoCaixa=async(_id,opts)=>({...fluxoDeCaixaDoMock('pc-001','2026-08',opts),alertaDeGuias:null});createRoot(document.getElementById('root')).render(<main style={{maxWidth:1280,margin:'auto',padding:24}}><p>Desenvolvimento · dados fictícios</p><BlocoDeDemonstracao companyId="pc-006" competencia="2026-08"/></main>);

}
