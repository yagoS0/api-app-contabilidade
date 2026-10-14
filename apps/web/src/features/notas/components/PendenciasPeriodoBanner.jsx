import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
export function PendenciasPeriodoBanner({ api, companyId, competencia, revisao, ocupado = false }) {
  const escopo = `${companyId}:${competencia || ''}`;
  const [estado, setEstado] = useState(null);
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    let ativo = true;
    if (!companyId) return;
    Promise.resolve().then(() => api.listPendenciasPosFechamento(companyId, { competencia }))
      .then(lista => { if (!Array.isArray(lista)) throw Error('Resposta inválida'); if (ativo) setEstado({ escopo, lista }); })
      .catch(() => { if (ativo) setEstado({ escopo, erro: true }); });
    return () => { ativo = false; };
  }, [api, companyId, competencia, revisao, tentativa, escopo]);
  if (estado?.escopo !== escopo) return <p role="status">Conferindo pendências do período…</p>;
  if (estado.erro) return <div role="alert" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBlock: 16 }}><span>Não foi possível conferir as pendências.</span><Button variant="secondary" type="button" style={{ minHeight: 44 }} onClick={() => setTentativa(n => n + 1)}>Tentar novamente</Button></div>;
  const abertas = estado.lista.filter(p => !p.resolvida && (!competencia || p.competencia === competencia));
  if (!abertas.length) return null;
  return <aside role="status" style={{ padding: 14, marginBottom: 16, border: '1px solid var(--state-warn)', borderRadius: 8, background: 'var(--state-warn-surface)' }}>
    <strong>{abertas.length === 100 ? '100 ou mais' : abertas.length} pendência(s) em períodos fechados ou apurados</strong>
    <p>Há documentos que precisam de revisão. Confira a receita já considerada antes de recalcular ou retificar.</p>
    {ocupado
      ? <span role="link" aria-disabled="true" title="Aguarde a conclusão da operação para revisar as competências.">Revisar competências</span>
      : <a href={`/companies/${encodeURIComponent(companyId)}/auditoria`}>Revisar competências</a>}
  </aside>;
}
