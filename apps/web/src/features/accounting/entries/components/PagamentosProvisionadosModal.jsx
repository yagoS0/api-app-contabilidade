import './pagamentosProvisionados.css';
import { recusaDeAcesso } from '../../parcelamento/lib/recusaDeAcesso';
import { useRef, useState } from 'react';
import { leituraDoPagamento } from '../../circular/lib/procedenciaDoPagamento';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';
import { BaixaModal } from '../../baixa/components/renderBaixaModal';
import { PANEL_FIELD_STYLE } from '../lib/accountingEntriesShared';
import { fmtDataCivil } from '../../../../lib/format';
const formatar = comp => { const [ano, mes] = comp.split('-'); return new Date(Number(ano), Number(mes)-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}); };
export function PagamentosProvisionadosModal({ pendentes, competencia, accounts, onSave, saving, onLoadBaixaTemplate, onClose, onBuscarPagamento }) {
  const [origem, setOrigem] = useState('');
  const [entry, setEntry] = useState(null);
  const [buscando, setBuscando] = useState(null);
  const [resultado, setResultado] = useState(null);
  const buscaLock = useRef(false);
  async function consultar(e) {
    if (buscaLock.current || !e.sourceGuide?.id) return;
    buscaLock.current = true; setBuscando(e.id); setResultado(null);
    try {
      const r = await onBuscarPagamento(e.sourceGuide.id);
      if (r?.ok === false || typeof r?.encontrado !== "boolean") throw new Error(r?.message || "Consulta sem resultado confirmado. Confira antes de repetir.");
      setResultado({ texto: r?.encontrado ? 'Pagamento localizado na Receita. Use Dar baixa para registrar os lançamentos.' : r?.motivo || 'Pagamento ainda não localizado na Receita.' });
      await pendentes.reload();
    } catch (err) { setResultado({ erro: true, texto: recusaDeAcesso(err?.message) || err?.message || recusaDeAcesso(err?.code) || 'Não foi possível consultar o pagamento.' }); }
    finally { buscaLock.current = false; setBuscando(null); }
  }
  const competencias = [...new Set(pendentes.itens.map(e => e.competencia))].sort().reverse();
  const itens = pendentes.itens.filter(e => !origem || e.competencia === origem);
  const leituraAtual = useRef(pendentes);
  leituraAtual.current = pendentes;
  const bloqueioLeitura = pendentes.loading || pendentes.error || pendentes.anterior
    ? 'Leitura anterior preservada. Volte à lista e confirme a atualização dos pagamentos antes de registrar a baixa.'
    : entry && !pendentes.itens.some(item => item.id === entry.id && JSON.stringify(item) === JSON.stringify(entry))
      ? 'Os dados desta provisão mudaram. Volte à lista para conferir.' : '';
  if (entry) return <BaixaModal entry={entry} accounts={accounts} saving={saving} bloqueioLeitura={bloqueioLeitura} competenciaPagamento={competencia} onLoadBaixaTemplate={onLoadBaixaTemplate} onClose={() => setEntry(null)} onSave={async input => {
    const atual = leituraAtual.current;
    if (atual.loading || atual.error || atual.anterior || !atual.itens.some(item => item.id === entry.id && JSON.stringify(item) === JSON.stringify(entry))) throw new Error('Atualize os pagamentos antes de registrar a baixa.');
    await onSave(entry.id, input); onClose();
  }} />;
  return <Modal titulo="Pagamentos" aoFechar={onClose} tamanho="lg" ocupado={!!buscando}>
    <div className="pagamentos-provisionados"><label style={{display:'grid',gap:6,maxWidth:300,fontSize:'.85rem'}}>Competência
      <select aria-label="Competência da provisão" style={{...PANEL_FIELD_STYLE,width:'100%',height:38}} value={origem} onChange={e => setOrigem(e.target.value)}>
        <option value="">Todas as competências</option>{competencias.map(comp => <option key={comp} value={comp}>{formatar(comp)}</option>)}
      </select>
    </label>
    {pendentes.loading && <p role="status">Carregando pagamentos…</p>}
    {pendentes.anterior && !!itens.length && <p role="status">Leitura anterior preservada. Aguarde uma atualização confirmada antes de registrar a baixa.</p>}
    {resultado && <p role={resultado.erro ? 'alert' : 'status'}>{resultado.texto}</p>}
    {pendentes.error && <p role="alert" className="feedback error">{recusaDeAcesso(pendentes.error) || pendentes.error} <Button size="sm" variant="secondary" onClick={pendentes.reload}>Tentar novamente</Button></p>}
    {!pendentes.loading && !pendentes.error && !itens.length && <p className="hint">Nenhum pagamento pendente.</p>}
    {!!itens.length && <div className="pagamentos-provisionados-scroll" role="region" aria-label="Pagamentos provisionados" tabIndex={0}><table style={{width:'100%'}}><thead><tr><th>Imposto / descrição</th><th>Competência</th><th>Saldo</th><th>Consulta</th><th>Ações</th></tr></thead><tbody>{itens.map(e => {
      const pagamento = leituraDoPagamento(e.sourceGuide);
      return <tr key={e.id}><td data-label="Imposto / descrição">{e.subtipo || e.historico}</td><td data-label="Competência">{e.competencia.split('-').reverse().join('/')}</td><td data-label="Saldo">{Number(e.saldo ?? e.valor ?? e.totalD).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</td>
        <td data-label="Consulta"><div className="pagamentos-provisionados-consulta"><span>{pagamento?.rotulo || (e.pagamentoLocalizado ? 'Pagamento localizado' : e.sourceGuide?.id ? 'Sem pagamento confirmado' : 'Sem guia vinculada')}</span>
          {pagamento?.detalhe && <small style={{display:'block'}}>{pagamento.detalhe}</small>}
          {pagamento?.procedencia === 'CLIENTE' && e.sourceGuide?.paymentConfirmedAt && <small style={{display:'block'}}>Data informada pelo cliente: {fmtDataCivil(e.sourceGuide.paymentConfirmedAt)}</small>}
          {e.comprovante?.dataArrecadacao && <small style={{display:'block'}}>Arrecadação: {e.comprovante.dataArrecadacao}</small>}
          {e.comprovante?.total != null && <small style={{display:'block'}}>Total: {Number(e.comprovante.total).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</small>}
          {e.sourceGuide?.id && onBuscarPagamento && <Button size="sm" variant="secondary" disabled={!!buscando || pendentes.loading} onClick={() => consultar(e)}>{buscando === e.id ? 'Buscando…' : 'Buscar pagamento'}</Button>}
        </div></td><td data-label="Ações"><Button size="sm" disabled={!!buscando || pendentes.loading || !!pendentes.error || pendentes.anterior} onClick={() => setEntry(e)}>Dar baixa</Button></td></tr>;
    })}</tbody></table></div>}
  </div></Modal>;
}
