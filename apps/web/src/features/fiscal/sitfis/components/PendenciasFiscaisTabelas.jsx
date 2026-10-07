import { useEffect, useMemo, useRef, useState } from 'react';
import { projetarPendenciasSitfis, subtotalDocumental } from '@contabilidade/shared/pendencias-fiscais';
import { projetarPendenciaManual, TIPOS_PENDENCIA, CAMPOS_VALOR } from '@contabilidade/shared/pendencias-manuais';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';
import { PendenciaManualModal } from './PendenciaManualModal';
import './pendenciasFiscais.css';
import { ExportarPendenciasModal } from './ExportarPendenciasModal';

const dinheiro = n => n == null ? '—' : (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const totalizar = linhas => subtotalDocumental(linhas.filter(l => !['PAGO', 'PARCELADO'].includes(l.estado)));
const COBERTURA = { NAO_CONSULTADO: 'Não consultado', SEM_REGISTROS: 'Sem pendências no relatório', PARCIAL: 'Conferir leitura', INCONCLUSIVO: 'Leitura inconclusiva' };

export function PendenciasFiscaisTabelas({ relatorio, manuais, contabeis, empresa }) {
  const projecao = useMemo(() => projetarPendenciasSitfis(relatorio), [relatorio]);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [selecao, setSelecao] = useState(new Set());
  const [editor, setEditor] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [remover, setRemover] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [exportando, setExportando] = useState(false);
  const [erroPdf, setErroPdf] = useState('');
  const [opcoesPdf, setOpcoesPdf] = useState(null);
  const [pdf, setPdf] = useState(null);
  const vigente = useRef(true);
  useEffect(() => { vigente.current = true; return () => { vigente.current = false; }; }, []);
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url); }, [pdf]);
  const exportLock = useRef(false);
  const lock = useRef(false);
  const fontes = projecao.fontes.map(f => ({ ...f, linhas: [...f.linhas, ...(manuais?.itens || []).filter(i => i.dados.fonte === f.id).map(projetarPendenciaManual)] }));
  if (contabeis?.disponivel) fontes.unshift({ id: "CONTABILIDADE", nome: "Contabilidade", cobertura: "CONTABILIDADE", avisos: [], linhas: contabeis.itens || [] });
  const selecionadas = fontes.flatMap(f => f.linhas).filter(l => selecao.has(l.id));
  const corresponde = l => (!tipo || l.tipo === tipo) && JSON.stringify([l.evidencia.registro, l.tributo, l.competencia, l.inscricao, l.titulo, l.situacao]).toLocaleLowerCase('pt-BR').includes(busca.trim().toLocaleLowerCase('pt-BR'));
  function escolherPdf() {
    const ids = new Set(selecionadas.map(l => l.id));
    setErroPdf('');
    setOpcoesPdf(fontes.map(f => ({ ...f, linhas: f.linhas.filter(l => ids.size ? ids.has(l.id) : corresponde(l)) })).filter(f => !ids.size || f.linhas.length));
  }
  async function exportarPdf(recorte) {
    if (exportLock.current || !recorte.length || manuais?.loading || manuais?.error || contabeis?.loading || contabeis?.error) return;
    exportLock.current = true; setExportando(true); setErroPdf('');
    const identificacao = empresa || { razao: relatorio?.contribuinte?.nome, cnpj: relatorio?.contribuinte?.cnpj };
    try {
      const { gerarPdfPendencias } = await import('../lib/pdfPendencias');
      const blob = await gerarPdfPendencias({ empresa: identificacao, fontes: recorte, emitidoEm: projecao.emitidoEm,
        escopo: 'Seleção personalizada de tabelas e registros' });
      if (vigente.current) { setOpcoesPdf(null); setPdf({ url: URL.createObjectURL(blob), empresa: identificacao.razao || identificacao.nome || 'Empresa', quantidade: recorte.reduce((n,f)=>n+f.linhas.length,0), nome: `pendencias-fiscais-${String(identificacao.cnpj || identificacao.razao || 'empresa').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60)}.pdf` }); }
    } catch (e) { setErroPdf(e.message || 'Não foi possível gerar o PDF.'); }
    finally { exportLock.current = false; setExportando(false); }
  }
  const resumo = linhas => {
    const consulta = totalizar(linhas.filter(l => !l.manual && l.origem !== "CONTABILIDADE")), manual = totalizar(linhas.filter(l => l.manual));
    const contabil = totalizar(linhas.filter(l => l.origem === "CONTABILIDADE"));
    return <>{contabil.quantidade > 0 && <span>Contabilidade <strong>{dinheiro(contabil.centavos)}</strong></span>}{consulta.quantidade > 0 && <span>Relatório <strong>{dinheiro(consulta.centavos)}</strong>{consulta.semValor > 0 && <small> · {consulta.semValor} sem valor</small>}</span>}
      {manual.quantidade > 0 && <span>Manual <strong>{dinheiro(manual.centavos)}</strong>{manual.semValor > 0 && <small> · {manual.semValor} sem valor</small>}</span>}</>;
  };
  function selecionar(id) { setSelecao(atual => { const nova = new Set(atual); if (nova.has(id)) nova.delete(id); else nova.add(id); return nova; }); }
  async function excluir() {
    if (lock.current) return;
    lock.current = true; setOcupado(true); setErro('');
    try { await manuais.excluir(remover.manual); setRemover(null); setDetalhe(null); setSelecao(s => { const n = new Set(s); n.delete(remover.id); return n; }); }
    catch (e) { setErro(e.reason || e.message); }
    finally { lock.current = false; setOcupado(false); }
  }
  return <section className="pendencias-fiscais" aria-label="Pendências por origem">
    <div className="pf-toolbar">
      <input aria-label="Buscar nas pendências" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar tributo, competência ou inscrição" />
      <select aria-label="Tipo de registro" value={tipo} onChange={e => setTipo(e.target.value)}><option value="">Todos os tipos</option>{Object.entries(TIPOS_PENDENCIA).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
      <Button variant="secondary" onClick={escolherPdf} disabled={exportando || manuais?.loading || !!manuais?.error || contabeis?.loading || !!contabeis?.error}>{exportando ? 'Gerando PDF…' : selecionadas.length ? 'PDF da seleção' : 'Exportar PDF'}</Button>
      <details className="pf-info"><summary>Sobre os valores</summary><p>Valores do relatório{projecao.emitidoEm ? ` de ${projecao.emitidoEm}` : ''} e valores manuais e contábeis são somados separadamente. Podem se referir ao mesmo débito. “—” indica valor não informado. Os subtotais não comprovam saldo negociável; acordos e registros manuais pagos ou parcelados ficam fora da soma.</p>{projecao.avisos.map((a,i) => <p key={i}>{a}</p>)}</details>
    </div>
    {erroPdf && !opcoesPdf && <p role="alert" className="feedback error">{erroPdf}</p>}
    {contabeis?.loading && <p role="status" className="hint">Carregando pendências da contabilidade…</p>}
    {contabeis?.error && <div role="alert" className="feedback error">{contabeis.error} <Button size="sm" variant="secondary" onClick={contabeis.reload}>Recarregar contabilidade</Button></div>}
    {manuais?.error && <div role="alert" className="feedback error">{manuais.error} <Button variant="secondary" size="sm" onClick={manuais.reload}>Recarregar lançamentos</Button></div>}
    {manuais?.loading && <p className="hint" role="status">Carregando lançamentos…</p>}
    {selecionadas.length > 0 && <div className="pf-selection" role="status"><strong>{selecionadas.length} selecionado(s)</strong>{resumo(selecionadas)}<Button size="sm" variant="secondary" onClick={() => setSelecao(new Set())}>Limpar seleção</Button></div>}
    {fontes.map(fonte => {
      const filtradas = fonte.linhas.filter(l => (!tipo || l.tipo === tipo) && JSON.stringify([l.evidencia.registro, l.tributo, l.competencia, l.inscricao, l.titulo, l.situacao]).toLocaleLowerCase('pt-BR').includes(busca.trim().toLocaleLowerCase('pt-BR')));
      return <section key={fonte.id} className="pf-source" aria-label={fonte.nome}>
        <header className="pf-source-header"><div><h3>{fonte.nome}</h3><span className="pf-count">{filtradas.length}</span>
          {COBERTURA[fonte.cobertura] && <span className="pf-muted">{COBERTURA[fonte.cobertura]}</span>}</div>
          {manuais?.disponivel && ['MUNICIPAL','ESTADUAL','RFB','PGFN'].includes(fonte.id) && <Button size="sm" variant="secondary" disabled={manuais.loading || !!manuais.error} onClick={() => setEditor({ fonte: fonte.id })}>Adicionar</Button>}
        </header>
        {!!fonte.avisos.length && <details className="pf-reading"><summary>Conferir leitura ({fonte.avisos.length})</summary>{fonte.avisos.map((a,i) => <p key={i}>{a}</p>)}</details>}
        {filtradas.length ? <><div className="pf-scroll" role="region" aria-label={`Tabela ${fonte.nome}`} tabIndex={0}>
          <table aria-label={`Pendências — ${fonte.nome}`}><thead><tr><th scope="col" className="th-narrow"><span className="pf-sr">Selecionar</span></th><th scope="col">Tributo / descrição</th><th scope="col">Competência</th><th scope="col">Vencimento</th><th scope="col" className="pf-money">Total informado</th><th scope="col">Situação</th><th scope="col"><span className="pf-sr">Ações</span></th></tr></thead>
          <tbody>{filtradas.map(l => <tr key={l.id} className={selecao.has(l.id) ? 'pf-selected' : ''}>
            <td><input type="checkbox" aria-label={`Selecionar ${l.tributo || l.titulo} ${l.competencia || l.inscricao || l.id}`} checked={selecao.has(l.id)} onChange={() => selecionar(l.id)} /></td>
            <td><strong>{l.tributo || l.evidencia.registro.Declaração || l.titulo}</strong><small>{l.origem === 'CONTABILIDADE' ? 'Contabilidade' : l.manual ? 'Manual' : TIPOS_PENDENCIA[l.tipo]}{l.inscricao ? ` · ${l.inscricao}` : ''}</small></td>
            <td>{l.competencia || '—'}</td><td>{l.vencimento || '—'}</td><td className="pf-money">{dinheiro(l.total)}</td>
            <td className="pf-situation" style={l.origem === "CONTABILIDADE" ? { color: "var(--danger)" } : undefined}>{l.situacao}</td><td className="pf-actions"><Button size="sm" variant="secondary" onClick={() => setDetalhe(l)}>Detalhes</Button></td>
          </tr>)}</tbody></table>
        </div><footer className="pf-subtotal">{resumo(filtradas)}</footer></> : <p className="pf-empty">{busca || tipo ? 'Nenhum registro para estes filtros.' : fonte.id === 'CONTABILIDADE' ? (contabeis?.error ? 'Consulta indisponível.' : contabeis?.loading ? 'Carregando…' : 'Nenhum saldo contábil em aberto em mês de pagamento fechado.') : 'Nenhum lançamento cadastrado.'}</p>}
      </section>;
    })}
    {editor && <PendenciaManualModal {...editor} salvar={manuais.salvar} aoFechar={() => setEditor(null)} />}
    {opcoesPdf && <ExportarPendenciasModal fontes={opcoesPdf} aoExportar={exportarPdf} aoFechar={() => setOpcoesPdf(null)} ocupado={exportando} erro={erroPdf} />}
    {pdf && <Modal titulo="PDF de pendências fiscais" tamanho="sm" aoFechar={() => setPdf(null)} rodape={<><Button variant="secondary" onClick={() => setPdf(null)}>Fechar</Button><a className="btn btn-primary btn-md" href={pdf.url} download={pdf.nome}>Baixar PDF</a></>}><p><strong>{pdf.empresa}</strong></p><p className="hint">Arquivo pronto · {pdf.quantidade} registro(s). Baixe para imprimir ou enviar ao cliente.</p></Modal>}
    {detalhe && <Modal titulo={detalhe.tributo || detalhe.titulo} aoFechar={() => setDetalhe(null)} rodape={detalhe.manual ? <><Button variant="danger" onClick={() => { setRemover(detalhe); setDetalhe(null); setErro(''); }}>Excluir</Button><Button onClick={() => { setEditor({ item: detalhe.manual }); setDetalhe(null); }}>Editar</Button></> : null}>
      <p className="hint">{detalhe.manual ? 'Lançamento manual' : detalhe.titulo}</p>
      <dl className="pf-detail">{Object.entries(CAMPOS_VALOR).map(([k,v]) => <div key={k}><dt>{v}</dt><dd>{dinheiro(detalhe[k])}</dd></div>)}
        {Object.entries(detalhe.evidencia.registro).map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{String(v ?? '—')}</dd></div>)}</dl>
      {Object.entries(detalhe.evidencia.anotacoes).map(([k,v]) => <p key={k}>{k}: {String(v)}</p>)}
      {[...detalhe.evidencia.descricao, ...detalhe.evidencia.anotacoesBloco].map((v,i) => <p key={i}>{String(v)}</p>)}
    </Modal>}
    {remover && <Modal titulo="Excluir pendência" tamanho="sm" ocupado={ocupado} aoFechar={() => setRemover(null)} rodape={<><Button variant="secondary" disabled={ocupado} onClick={() => setRemover(null)}>Cancelar</Button><Button variant="danger" disabled={ocupado} onClick={excluir}>{ocupado ? 'Excluindo…' : 'Excluir lançamento'}</Button></>}><p>Excluir o lançamento manual de {remover.tributo}?</p>{erro && <p role="alert" className="feedback error">{erro}</p>}</Modal>}
  </section>;
}
