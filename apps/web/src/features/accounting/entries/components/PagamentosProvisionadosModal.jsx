import { useState } from 'react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';
import { BaixaModal } from '../../baixa/components/renderBaixaModal';
import { PANEL_FIELD_STYLE } from '../lib/accountingEntriesShared';
const formatar = comp => { const [ano, mes] = comp.split('-'); return new Date(Number(ano), Number(mes)-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}); };
export function PagamentosProvisionadosModal({ pendentes, competencia, accounts, onSave, saving, onLoadBaixaTemplate, onClose }) {
  const [origem, setOrigem] = useState('');
  const [entry, setEntry] = useState(null);
  const competencias = [...new Set(pendentes.itens.map(e => e.competencia))].sort().reverse();
  const itens = pendentes.itens.filter(e => !origem || e.competencia === origem);
  if (entry) return <BaixaModal entry={entry} accounts={accounts} saving={saving} competenciaPagamento={competencia} onLoadBaixaTemplate={onLoadBaixaTemplate} onClose={() => setEntry(null)} onSave={async input => { await onSave(entry.id, input); onClose(); }} />;
  return <Modal titulo="Pagamentos" aoFechar={onClose} tamanho="lg">
    <label style={{display:'grid',gap:6,maxWidth:300,fontSize:'.85rem'}}>Competência
      <select aria-label="Competência da provisão" style={{...PANEL_FIELD_STYLE,width:'100%',height:38}} value={origem} onChange={e => setOrigem(e.target.value)}>
        <option value="">Todas as competências</option>{competencias.map(comp => <option key={comp} value={comp}>{formatar(comp)}</option>)}
      </select>
    </label>
    {pendentes.loading && <p role="status">Carregando pagamentos…</p>}
    {pendentes.error && <p role="alert" className="feedback error">{pendentes.error} <Button size="sm" onClick={pendentes.reload}>Tentar novamente</Button></p>}
    {!pendentes.loading && !pendentes.error && !itens.length && <p className="hint">Nenhum pagamento pendente.</p>}
    {!!itens.length && <div style={{overflowX:'auto',marginTop:16}}><table style={{width:'100%'}}><thead><tr><th>Imposto / descrição</th><th>Competência</th><th>Saldo</th><th>Ações</th></tr></thead><tbody>{itens.map(e => <tr key={e.id}><td>{e.subtipo || e.historico}</td><td>{e.competencia.split('-').reverse().join('/')}</td><td>{Number(e.saldo ?? e.valor ?? e.totalD).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</td><td><Button size="sm" onClick={() => setEntry(e)}>Dar baixa</Button></td></tr>)}</tbody></table></div>}
  </Modal>;
}
