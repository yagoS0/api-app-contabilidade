import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';

// Avisos de todas as competências. Atualização só lê o banco; nunca captura notas.
export function OperationsAlerts({ api, compact = false }) {
  const [data, setData] = useState(null), [error, setError] = useState(false), [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [api]);
  useEffect(() => {
    setData(null); setError(false);
    if (!api?.getOperationAlerts) return;
    let active = true, generation = 0;
    const read = async () => {
      const current = ++generation;
      try {
        const next = await api.getOperationAlerts(page * 200);
        if (!Array.isArray(next?.items) || !Number.isInteger(next?.total) || next.total < next.items.length) throw Error('Resposta inválida');
        if (active && current === generation) { setData(next); setError(false); }
      }
      catch { if (active && current === generation) setError(true); }
    };
    read(); const timer = setInterval(read, 60000);
    window.addEventListener('focus', read);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', read); };
  }, [api, page]);
  return <div className="operacoes-avisos">
    {(!compact || error || !data || data.total > 0) && <button type="button" className={compact ? 'operacoes-aviso-etapa' : 'operacoes-quadro'} aria-label={compact ? `Avisos de apuração ${error || !data ? 'indisponíveis' : data.total} · todas as competências` : undefined} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      {!compact && <span>Notas para revisão</span>}<strong className={data?.total ? 'operacoes-erro' : ''}>{compact && '⚠ '}{error || !data ? '—' : data.total}</strong>{(!compact || error || !data) && <small>{error ? 'Leitura indisponível' : !data ? (api?.getOperationAlerts ? 'Carregando' : 'Indisponível') : 'Todas as competências'}</small>}
    </button>}
    {open && <Modal className="operacoes-dialogo" titulo="Notas para revisão" aoFechar={() => setOpen(false)} rodape={<Button variant="secondary" onClick={() => setOpen(false)}>Fechar</Button>}>
      <p>Revise a competência da empresa antes de retificar. Abrir o aviso não altera a apuração.</p>
      {error ? <p role="alert">Não foi possível atualizar os avisos. Tente novamente ao voltar à página.</p> : !data ? <p role="status">{api?.getOperationAlerts ? 'Carregando avisos…' : 'Avisos indisponíveis neste ambiente.'}</p> : null}
      {data?.total === 0 && !error && <p>Nenhuma nota aguardando revisão.</p>}
      {!error && data?.total > data?.items.length && <div className="operacoes-acoes"><p>Exibindo {data.items.length} de {data.total} avisos · página {page + 1}.</p><Button variant="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button><Button variant="secondary" disabled={(page + 1) * 200 >= data.total} onClick={() => setPage(p => p + 1)}>Próxima</Button></div>}
      {!error && <ul className="operacoes-lista-modal">{data?.items.map(item => <li key={item.id}><div><strong>{item.portalClient.razao}</strong><small>{item.competencia} · {item.situacaoPeriodo === 'TRANSMITIDA' ? 'Declaração transmitida · revisar nota' : item.situacaoPeriodo === 'COMPROVACAO_PENDENTE' ? 'Comprovação da apuração pendente' : 'Período apurado ou fechado · revisar nota'}</small><details><summary>Ver evidências</summary><p>{item.observacoes}</p></details><div className="operacoes-acoes"><InternalLink href={`${companyTabPath(item.portalClientId, 'auditoria')}?competencia=${item.competencia}`}>Revisar competência {item.competencia}</InternalLink><InternalLink href={`${companyTabPath(item.portalClientId, 'cadastroFiscal')}?competencia=${item.competencia}`}>Abrir apuração</InternalLink></div></div></li>)}</ul>}
    </Modal>}
  </div>;
}
