import { useWorkspaceNavigation } from "../../app/navigation/WorkspaceNavigation";
import { useState } from 'react';
import { buscarConfiguracoes, CONFIG_GERAIS } from './catalogo';
export function Engrenagem({ href, onClick, label }) {
 return <a className="config-gear" href={href} aria-label={label} title={label} onClick={e=>{if(onClick && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button===0){e.preventDefault();onClick();}}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 1-3-2-2 1-3-3-2-3 1-2-3Z"/><circle cx="12" cy="11" r="3"/></svg></a>;
}
export function ConfiguracoesLayout({ titulo, subtitulo, itens, atual, children, onNavigate, voltar='/', voltarTexto='Voltar ao trabalho' }) {
 const navigation = useWorkspaceNavigation();
 const [busca,setBusca]=useState('');const encontrados=buscarConfiguracoes(itens,busca);
 const link = (i, conteudo, classe) => <a key={i.id} className={classe} href={i.href} aria-current={atual===i.id?'page':undefined} onClick={e=>{if((onNavigate || navigation) && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button===0){e.preventDefault();if(onNavigate) onNavigate(i); else navigation.navigate(i.href);}}}>{conteudo}</a>;
 return <section className="config-page"><header className="config-heading"><a href={voltar} onClick={e=>{if(navigation && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button===0){e.preventDefault();navigation.goBack(voltar);}}}>← {voltarTexto}</a><h1>{titulo}</h1><p>{subtitulo}</p></header><div className="config-columns"><aside><label>Buscar configuração<input type="search" value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Ex.: WhatsApp, ISS, certificado"/></label><nav aria-label={titulo}>{encontrados.map(i=>link(i,<><small>{i.grupo}</small><span>{i.titulo}</span></>,'config-nav-item'))}</nav>{!encontrados.length && <p role="status">Nenhuma configuração encontrada.</p>}</aside><div className="config-content">{children || <div className="config-cards">{encontrados.map(i=>link(i,<><small>{i.grupo}</small><h2>{i.titulo}</h2><p>{i.descricao}</p></>,'config-card'))}</div>}</div></div></section>;
}
export function ConfiguracoesGeraisPage() {
 const atendimento=window.location.pathname==='/configuracoes/atendimento';
 return <ConfiguracoesLayout titulo="Configurações gerais do escritório" subtitulo="Padrões compartilhados pela equipe. Configurações de uma empresa ficam na engrenagem da própria empresa." itens={CONFIG_GERAIS} atual={atendimento?'atendimento':null}>
 {atendimento ? <article><h2>WhatsApp e IA</h2><p>Atendimento humano de segunda a sexta, das 9h às 17h, no horário do Rio de Janeiro, considerando feriados nacionais, estaduais e municipais.</p><p>O assistente utiliza atalhos e texto livre. A consulta de documentos respeita os acessos de cada número; emissão e cancelamento exigem confirmação.</p><p>Configure destinatários e permissões em <strong>Configurações da empresa → Contatos, acessos e envios</strong>.</p><p>Credenciais, modelo de IA e ativação das integrações são administrados na Railway. Esta tela não altera esses valores.</p><a href="/whatsapp">Abrir central de atendimento →</a></article> : null}
 </ConfiguracoesLayout>;
}

export function ConfiguracoesGeraisLayout({ atual, children }) {return <ConfiguracoesLayout titulo="Configurações gerais do escritório" subtitulo="Padrões compartilhados pela equipe." itens={CONFIG_GERAIS} atual={atual}><div className="config-embedded-global">{children}</div></ConfiguracoesLayout>;}
