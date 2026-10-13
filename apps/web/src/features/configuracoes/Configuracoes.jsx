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
 const grupos = [...new Set(encontrados.map(i => i.grupo))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const campoBusca = <label className="config-search">Buscar configuração<input type="search" value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Nome ou assunto"/></label>;
 const vazio = !encontrados.length && <p role="status" className="config-empty">Nenhuma configuração encontrada.</p>;
 return <section className="config-page">
  <header className="config-heading">{voltar && <a href={voltar} onClick={e=>{if(navigation && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button===0){e.preventDefault();navigation.goBack(voltar);}}}>← {voltarTexto}</a>}<h1>{titulo}</h1>{subtitulo && <p>{subtitulo}</p>}</header>
  {children ? <div className="config-columns">
   <aside>{campoBusca}<nav aria-label={titulo}>{grupos.map(grupo=><div className="config-nav-group" key={grupo}><h2>{grupo}</h2>{encontrados.filter(i=>i.grupo===grupo).map(i=>link(i,<span>{i.titulo}</span>,'config-nav-item'))}</div>)}</nav>{vazio}</aside>
   <div className="config-content">{children}</div>
  </div> : <div className="config-index">
   {campoBusca}<nav aria-label={titulo} className="config-index-groups">{grupos.map(grupo=><section className="config-card-group" key={grupo}><h2>{grupo}</h2><div className="config-cards">{encontrados.filter(i=>i.grupo===grupo).map(i=>link(i,<><div><h3>{i.titulo}</h3>{i.descricao && <p>{i.descricao}</p>}</div><span aria-hidden="true">→</span></>,'config-card'))}</div></section>)}</nav>{vazio}
  </div>}
 </section>;
}
export function ConfiguracoesGeraisPage() {
 const atendimento=window.location.pathname==='/configuracoes/atendimento';
 return <ConfiguracoesLayout titulo="Configurações do escritório" itens={CONFIG_GERAIS} atual={atendimento?'atendimento':null}>
 {atendimento ? <article className="config-info">
  <header><h2>WhatsApp e IA</h2><a href="/whatsapp">Abrir central de atendimento →</a></header>
  <section><h3>Expediente</h3><p>Segunda a sexta, das 9h às 17h, no horário do Rio de Janeiro, exceto feriados nacionais, estaduais e municipais.</p></section>
  <section><h3>Contatos e permissões</h3><p>Em Configurações da empresa → Contatos, acessos e envios.</p></section>
  <details><summary>Assistente e integrações</summary><p>O assistente utiliza atalhos e texto livre. A consulta de documentos respeita os acessos de cada número; emissão e cancelamento exigem confirmação.</p><p>Credenciais, modelo de IA e ativação das integrações são administrados na Railway.</p></details>
 </article> : null}
 </ConfiguracoesLayout>;
}

export function ConfiguracoesGeraisLayout({ atual, children }) {return <ConfiguracoesLayout titulo="Configurações do escritório" itens={CONFIG_GERAIS} atual={atual}><div className="config-embedded-global">{children}</div></ConfiguracoesLayout>;}
