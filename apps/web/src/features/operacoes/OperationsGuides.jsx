import { Button } from '../../components/ui/Button';
import { useEffect, useState } from 'react';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { lerEnvioDaGuia } from '../guides/lib/envioNaTela';
import { operationDate, operationInstant, operationMoney, reconcileOperationGuides } from './operationsDetails';

export function OperationsGuides({ api, rows, competencia, stage, onManualInss }) {
  const [data, setData] = useState({});
  const ids = rows.map(r => r.company.companyId).sort().join('|');
  useEffect(() => {
    let active = true; setData({});
    (async () => {
      for (const id of ids.split('|').filter(Boolean)) {
        let value;
        try {
          if (!api?.getCompanyGuides) throw Error('Leitura de documentos indisponível');
          const guides = await api.getCompanyGuides(id);
          if (!Array.isArray(guides)) throw Error('Resposta de documentos inválida');
          value = { guides };
        } catch (e) { value = { error: e.message }; }
        if (!active) return;
        setData(old => ({ ...old, [id]: value }));
      }
    })();
    return () => { active = false; };
  }, [api, ids, competencia]);
  return <>
    <p>As barras contam empresas. A tabela identifica documentos da competência, sem somar versões ou inferir transmissão. Pagamento não comprova envio.</p>
    {rows.map(row => {
      const { company } = row, source = data[company.companyId];
      let result, error = source?.error;
      if (source?.guides) { try { result = reconcileOperationGuides(source.guides, row, competencia); } catch (e) { error = e.message; } }
      const documents = result?.guides.filter(g => stage !== 'pago' || g.paymentStatus === 'PAID') || [];
      return <section key={company.companyId} aria-label={`Guias de ${company.razao || company.razaoSocial || company.cnpj}`}>
        <h3>{company.razao || company.razaoSocial || company.cnpj}</h3>{row.manualInss && <><p>INSS manual · {({PENDING_DOCUMENT:'Aguardando documento',DOCUMENT_REVIEW:'Documento para revisão',DOCUMENT_AVAILABLE:'Documento disponível',DOCUMENT_ABSENT:'Ausência registrada',NOT_APPLICABLE:'Não aplicável'})[row.manualInss.status] || 'A verificar'}</p><Button size="sm" variant="secondary" onClick={() => onManualInss?.(row)}>Ver detalhes do INSS manual</Button></>}
        <details><summary>Cobertura das obrigações e parcelas da barra</summary><div className="operacoes-tabela-scroll" role="region" aria-label="Cobertura da empresa" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Item esperado</th><th>Documento</th><th>Comunicação</th><th>Pagamento</th></tr></thead><tbody>{(row.guideSummary?.items || []).map(item => <tr key={item.key}><th scope="row">{item.label}</th><td>{item.documento}</td><td>{item.comunicacao}</td><td>Pagamento: {item.pagamento}</td></tr>)}</tbody></table></div><p>Esta projeção preserva débito automático e itens sem documento exigível. A lista documental abaixo não substitui sua exigibilidade.</p></details>
        {!source && <p role="status">Lendo documentos salvos…</p>}
        {error && <p role="alert">Leitura de guias: {error}. Abra Guias para conferir a fonte; não há confirmação de ausência.</p>}
        {result && <><div className="operacoes-tabela-scroll" role="region" aria-label="Documentos e parcelas" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Documento / parcela</th><th>Competência / vencimento</th><th>Valor do documento</th><th>Estado documental</th><th>Envio por canal</th><th>Pagamento / origem</th></tr></thead><tbody>{documents.map(g => {
          const delivery = lerEnvioDaGuia(g);
          return <tr key={g.guideId}><th scope="row">{g.parcelamentoLabel || g.tipo || 'Tipo a verificar'}{g.numeroParcela != null && ` · Parcela ${g.numeroParcela}`}<small>Documento {g.guideId}</small><small>Revisão de pagamento: {g.versaoPagamento || 'Não informada'}</small></th><td>{g.competencia}<br />{operationDate(g.vencimento)}</td><td>{operationMoney(g.valor)}{g.valorRecalculado != null && <small>Cobrança recalculada: {operationMoney(g.valorRecalculado)}</small>}</td><td>{({ PROCESSED: 'Processado', NEEDS_REVIEW: 'Em conferência', PROCESSING: 'Em processamento', ERROR: 'Erro de processamento', VAZIO: 'Ausência registrada', DOCUMENTO_NAO_ARRECADATORIO: 'Documento não arrecadatório' })[g.status] || 'A verificar'}</td><td>{delivery.resumo}{(g.envio?.canais || []).map((c, i) => <div key={c.tentativaId || i}><strong>{c.canal}</strong> · {c.destino || 'Destino não registrado'}<br />{c.status || 'A verificar'} · {operationInstant(c.lidoEm || c.entregueEm || c.em)}{c.erroMensagem && <p>Falha: {c.erroMensagem}. Confira a tentativa antes de repetir.</p>}{['indeterminado', 'enviando'].includes(c.status) && <p>Resultado incerto ou em processamento; não repetir envio.</p>}</div>)}</td><td>{g.paymentStatus === 'PAID' ? 'Paga' : 'Pagamento não confirmado'}<br />{(g.paymentStatus === 'PAID' ? { CLIENTE: 'Confirmada pelo cliente — declaração, não comprovante bancário', SERPRO: 'Confirmada na Receita', MANUAL: 'Confirmada pelo contador' } : { CLIENTE: 'Origem: informação do cliente', SERPRO: 'Origem: consulta SERPRO', MANUAL: 'Origem: registro manual' })[g.paymentStatusSource] || 'Origem não informada'}<small>Registro: {operationInstant(g.paymentConfirmedAt)}</small>{g.confirmacaoCliente && <small>Baixa: {g.confirmacaoCliente.estadoBaixa || 'A verificar'}</small>}</td></tr>;
        })}</tbody></table></div>
        {!documents.length && <p>{stage === 'pago' ? 'Nenhuma guia paga identificada neste retorno.' : 'Nenhum documento identificado nesta competência.'} Isso não dispensa obrigações.</p>}
        {result.missing.length > 0 && <p>Cobertura sem documento reconciliado por identidade: {result.missing.map(item => item.label || item.key).join(', ')}. Confira documentos faltantes, vigência e eventual débito automático em Guias.</p>}</>}
        <InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(company.companyId, 'guides')}?competencia=${encodeURIComponent(competencia)}`}>Abrir Guias — conferir canais e reenvio</InternalLink>
      </section>;
    })}
  </>;
}
