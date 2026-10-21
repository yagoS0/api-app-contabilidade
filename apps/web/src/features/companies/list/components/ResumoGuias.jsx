import { resumirGuias } from '../lib/resumoGuias';
import { GuiaChip } from './renderGuiaChip';
import { Link } from 'react-router-dom';
import './resumoGuias.css';

export function ResumoGuias({ company, aberto, onToggle, detailId }) {
  const resumo = resumirGuias(company.guideCompliance);
  const secondary = [
    resumo.faltantes ? { text: `${resumo.faltantes} faltante${resumo.faltantes > 1 ? 's' : ''}` } : null,
    resumo.enviadas ? { text: `${resumo.enviadas} enviada${resumo.enviadas > 1 ? 's' : ''}` } : null,
    resumo.falhas ? { text: `${resumo.falhas} falha${resumo.falhas > 1 ? 's' : ''}`, error: true } : null,
  ].filter(Boolean);
  const label = !resumo.completo ? 'A conferir' : resumo.esperadas ? resumo.rotulo : 'Não exigível';
  const tom = resumo.falhas ? 'perigo' : !resumo.completo || resumo.faltantes ? 'pendente'
    : !resumo.esperadas ? 'neutro' : resumo.enviadas === resumo.esperadas ? 'ok' : 'info';
  return <span className="resumo-guias">
    <button type="button" className={`carteira-tag carteira-tag--${tom} resumo-guias__controle`} aria-expanded={aberto} aria-controls={detailId}
      title={`${resumo.rotulo} · ${resumo.unidade}`} onClick={onToggle}
      aria-label={`Guias de ${company.razao || company.razaoSocial || company.companyId}: ${resumo.rotulo}${secondary.length ? `; ${secondary.map(item => item.text).join(', ')}` : ''}${resumo.parcelas.length ? `; ${resumo.documentosParcelamento} documentos de parcelamento disponíveis` : ''}`}>
      <span>{label}</span>
      {resumo.parcelas.length > 0 && <span>· {resumo.documentosParcelamento} {resumo.documentosParcelamento === 1 ? 'guia de parcela' : 'guias de parcelas'}</span>}
      <svg className="resumo-guias__seta" aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  </span>;
}

function EstadoGuia({ label, tom, icon, coluna }) {
  return <span className="resumo-guias__estado">
    <span className="resumo-guias__rotulo-movel">{coluna}</span>
    <span className={`carteira-tag carteira-tag--${tom}`}><span aria-hidden="true">{icon}</span>{label}</span>
  </span>;
}

export function DetalheGuias({ id, company, competencia, acoes = {} }) {
  const resumo = resumirGuias(company.guideCompliance);
  return <section id={id} className="resumo-guias__detalhe" aria-label={`Guias de ${company.razao || company.companyId}`}>
    <p className="resumo-guias__contexto"><strong>Guias · {competencia?.split('-').reverse().join('/')}</strong><span>{resumo.unidade}</span></p>
    {!resumo.completo && <p role="status">Confira a cobertura e os dados da competência.</p>}
    <div className="resumo-guias__cabecalho" aria-hidden="true"><span>Obrigação</span><span>Documento</span><span>Envio</span><span>Detalhes e ações</span></div>
    {resumo.items.map(item => <div key={item.key || item.label} className="resumo-guias__item" role="group" aria-label={item.label}>
      <strong className="resumo-guias__obrigacao">{item.label}</strong>
      <EstadoGuia coluna="Documento" label={item.documento}
        tom={item.disponivel ? 'ok' : item.dispensada ? 'neutro' : item.state === 'conflito' ? 'perigo' : 'pendente'}
        icon={item.disponivel ? '✓' : item.dispensada ? '—' : '!'} />
      <EstadoGuia coluna="Envio" label={item.comunicacao === '—' ? item.faltante ? 'Aguarda guia' : 'Não disponível' : item.comunicacao}
        tom={item.enviada ? 'ok' : item.falha ? 'perigo' : item.envioPendente ? 'pendente' : 'neutro'}
        icon={item.enviada ? '✓' : item.falha ? '×' : item.envioPendente ? '◷' : '—'} />
      <span className="resumo-guias__acoes"><GuiaChip compacto tag={item} empresa={company} competencia={competencia} acoes={acoes}/></span>
    </div>)}
    {!resumo.items.length && <p>Nenhum item de cobertura informado.</p>}
    {resumo.parcelas.length > 0 && <>
      <p className="resumo-guias__contexto"><strong>Parcelamentos · {resumo.parcelas[0].mesOperacional?.split('-').reverse().join('/')}</strong><span>{resumo.documentosParcelamento} {resumo.documentosParcelamento === 1 ? 'documento disponível' : 'documentos disponíveis'}</span></p>
      {resumo.parcelas.map(item => <div key={item.id} className="resumo-guias__item" role="group" aria-label={`${item.tipo || 'Parcelamento a identificar'} ${item.numeroParcela ? `parcela ${item.numeroParcela}` : item.numeroParcelamento || 'do mês'}`}>
        <strong className="resumo-guias__obrigacao">{item.tipo || 'Parcelamento a identificar'}{item.numeroParcelamento ? ` · ${item.numeroParcelamento}` : ''}{item.numeroParcela ? ` · parcela ${item.numeroParcela}` : ''}</strong>
        <EstadoGuia coluna="Documento" label={{ disponivel: 'Disponível', a_conferir: 'A conferir', nao_exigido: 'Débito automático', faltante: 'Faltante' }[item.documento] || 'A conferir'} tom={item.documento === 'disponivel' ? 'ok' : item.documento === 'nao_exigido' ? 'neutro' : 'pendente'} icon={item.documento === 'disponivel' ? '✓' : '—'} />
        <EstadoGuia coluna="Envio" label={{ enviada: 'Enviada', pendente: 'Pendente', nao_exigida: 'Não exigido', aguarda_documento: 'Aguarda documento' }[item.comunicacao] || 'A conferir'} tom={item.comunicacao === 'enviada' ? 'ok' : 'neutro'} icon={item.comunicacao === 'enviada' ? '✓' : '—'} />
        <span className="resumo-guias__acoes"><Link to={`/companies/${encodeURIComponent(company.companyId || company.id)}/parcelamento`}>Ver parcelamento</Link></span>
      </div>)}
    </>}
  </section>;
}
