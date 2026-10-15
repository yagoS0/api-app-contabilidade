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
  return <div className="operacoes-avisos">
    <button type="button" className="operacoes-quadro" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <span>Notas para revisão</span><strong className={data?.total ? 'operacoes-erro' : ''}>{error || !data ? '—' : data.total}</strong><small>{error ? 'Leitura indisponível' : !data ? 'Carregando' : 'Ver empresas'} ↗</small>
    </button>
    {open && <Modal className="operacoes-dialogo" titulo="Notas para revisão" aoFechar={() => setOpen(false)} rodape={<Button variant="secondary" onClick={() => setOpen(false)}>Fechar</Button>}>
      <p>Revise a competência da empresa antes de retificar. Abrir o aviso não altera a apuração.</p>
      {error ? <p role="alert">Não foi possível atualizar os avisos. Tente novamente ao voltar à página.</p> : !data ? <p role="status">{api?.getOperationAlerts ? 'Carregando avisos…' : 'Avisos indisponíveis neste ambiente.'}</p> : null}
      {data?.total === 0 && !error && <p>Nenhuma nota aguardando revisão.</p>}
      {!error && data?.total > data?.items.length && <p>Exibindo os {data.items.length} avisos mais recentes de {data.total}.</p>}
      {!error && <ul className="operacoes-lista-modal">{data?.items.map(item => <li key={item.id}><div><strong>{item.portalClient.razao}</strong><small>{item.competencia} · {item.situacaoPeriodo === 'TRANSMITIDA' ? 'Declaração transmitida · revisar nota' : item.situacaoPeriodo === 'COMPROVACAO_PENDENTE' ? 'Comprovação da apuração pendente' : 'Período apurado ou fechado · revisar nota'}</small><details><summary>Ver evidências</summary><p>{item.observacoes}</p></details><div className="operacoes-acoes"><InternalLink href={`${companyTabPath(item.portalClientId, 'auditoria')}?competencia=${item.competencia}`}>Revisar competência {item.competencia}</InternalLink><InternalLink href={`${companyTabPath(item.portalClientId, 'cadastroFiscal')}?competencia=${item.competencia}`}>Abrir apuração</InternalLink></div></div></li>)}</ul>}
    </Modal>}
  </div>;
}
