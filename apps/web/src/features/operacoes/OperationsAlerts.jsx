import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';

// Avisos de todas as competências. Atualização só lê o banco; nunca captura notas.
export function OperationsAlerts({ api }) {
  const [data, setData] = useState(null), [error, setError] = useState(false), [open, setOpen] = useState(false);
  useEffect(() => {
    if (!api?.getOperationAlerts) return;
    let active = true;
    const read = async () => {
      try { const next = await api.getOperationAlerts(); if (active) { setData(next); setError(false); } }
      catch { if (active) setError(true); }
    };
    read(); const timer = setInterval(read, 60000);
    window.addEventListener('focus', read);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', read); };
  }, [api]);
  if (!api?.getOperationAlerts) return null;
  return <aside className="operacoes-avisos" aria-label="Avisos de notas após apuração">
    {error ? <p role="alert">Não foi possível atualizar os avisos de notas posteriores à apuração. Os dados anteriores podem estar desatualizados.</p>
      : !data ? <p role="status">Conferindo avisos de notas…</p> : null}
    {!!data?.total && <Button variant="secondary" onClick={() => setOpen(true)}>Ver notas e revisar retificação</Button>}
    {open && <Modal className="operacoes-dialogo" titulo="Notas posteriores à apuração" aoFechar={() => setOpen(false)} rodape={<Button variant="secondary" onClick={() => setOpen(false)}>Fechar</Button>}>
      <p>Confira se a receita já foi considerada antes de retificar. O aviso não reabre o fechamento nem transmite retificação.</p>
      {data.total > data.items.length && <p>Exibindo os {data.items.length} avisos mais recentes de {data.total}. Revise os demais na auditoria das empresas.</p>}
      <ul className="operacoes-lista-modal">{data.items.map(item => <li key={item.id}><div><strong>{item.portalClient.razao} · {item.competencia}</strong><p>{item.observacoes}</p><div className="operacoes-acoes"><InternalLink href={`${companyTabPath(item.portalClientId, 'auditoria')}?competencia=${item.competencia}`}>Revisar competência {item.competencia}</InternalLink><InternalLink href={`${companyTabPath(item.portalClientId, 'notasFiscais')}?competencia=${item.competencia}`}>Abrir apuração</InternalLink></div></div></li>)}</ul>
    </Modal>}
  </aside>;
}
