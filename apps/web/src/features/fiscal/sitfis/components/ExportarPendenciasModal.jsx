import { useState } from 'react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';

export function ExportarPendenciasModal({ fontes, aoExportar, aoFechar, ocupado, erro }) {
  const [origens, setOrigens] = useState(() => new Set(fontes.filter(f => f.linhas.length).map(f => f.id)));
  const [registros, setRegistros] = useState(() => new Set(fontes.flatMap(f => f.linhas.map(l => l.id))));
  const recorte = fontes.filter(f => origens.has(f.id)).map(f => ({ ...f, linhas: f.linhas.filter(l => registros.has(l.id)) }));
  const quantidade = recorte.reduce((n, f) => n + f.linhas.length, 0);
  function marcarFonte(fonte, marcado) {
    setOrigens(atual => { const proximo = new Set(atual); marcado ? proximo.add(fonte.id) : proximo.delete(fonte.id); return proximo; });
    setRegistros(atual => { const proximo = new Set(atual); fonte.linhas.forEach(l => marcado ? proximo.add(l.id) : proximo.delete(l.id)); return proximo; });
  }
  function marcarRegistro(fonte, linha, marcado) {
    const proximo = new Set(registros);
    marcado ? proximo.add(linha.id) : proximo.delete(linha.id);
    setRegistros(proximo);
    setOrigens(atual => { const nova = new Set(atual); fonte.linhas.some(l => proximo.has(l.id)) ? nova.add(fonte.id) : nova.delete(fonte.id); return nova; });
  }
  return <Modal titulo="Escolher conteúdo do PDF" ocupado={ocupado} aoFechar={aoFechar} rodape={<>
    <Button variant="secondary" disabled={ocupado} onClick={aoFechar}>Cancelar</Button>
    <Button disabled={ocupado || !recorte.length} onClick={() => aoExportar(recorte)}>{ocupado ? 'Gerando PDF…' : 'Gerar PDF'}</Button>
  </>}>
    <p className="hint">Escolha as tabelas e os registros que deseja enviar ao cliente. Receita e Contabilidade podem representar a mesma dívida.</p>
    <div className="pf-pdf-controls"><strong>{recorte.length} tabela(s) · {quantidade} registro(s)</strong>
      <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => { setOrigens(new Set(fontes.map(f => f.id))); setRegistros(new Set(fontes.flatMap(f => f.linhas.map(l => l.id)))); }}>Selecionar tudo</Button>
      <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => { setOrigens(new Set()); setRegistros(new Set()); }}>Limpar</Button>
    </div>
    {erro && <p role="alert" className="feedback error">{erro}</p>}
    {fontes.map(f => <fieldset key={f.id} className="pf-pdf-source" disabled={ocupado}>
      <legend><label><input type="checkbox" aria-label={`Incluir tabela ${f.nome}`} checked={origens.has(f.id)} onChange={e => marcarFonte(f, e.target.checked)} /> {f.nome}</label></legend>
      {f.linhas.length ? f.linhas.map(l => <label key={l.id} className="pf-pdf-row">
        <input type="checkbox" aria-label={`Incluir ${l.tributo || l.titulo} ${l.competencia || ''} de ${f.nome}`} checked={origens.has(f.id) && registros.has(l.id)} onChange={e => marcarRegistro(f, l, e.target.checked)} />
        <span><strong>{l.tributo || l.titulo}</strong><small>{[l.competencia, l.situacao, l.manual ? 'Manual' : null].filter(Boolean).join(' · ')}</small></span>
        <span>{l.total == null ? '—' : (l.total / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
      </label>) : <p className="hint">Sem registros. Incluir somente a situação desta fonte.</p>}
    </fieldset>)}
  </Modal>;
}
