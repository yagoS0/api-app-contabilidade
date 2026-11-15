import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';

// Translate the saved period evidence only; unknown/legacy values prove no stage.
const periodEvidence = {
  TRANSMITIDA: ['Transmissão registrada na época do aviso', 'Conferir o impacto na declaração antes de decidir sobre retificação.'],
  APURADA: ['Apuração calculada ou simulada', 'Conferir o impacto no cálculo salvo. Cálculo não comprova transmissão.'],
  FECHADA: ['Período fechado', 'Conferir o impacto no fechamento. Fechamento não comprova transmissão.'],
  COMPROVACAO_PENDENTE: ['Comprovação da apuração pendente', 'Conferir as evidências do período antes de concluir a revisão.'],
};

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
    {(!compact || error || !data || data.total > 0) && <button type="button" className={compact ? 'operacoes-aviso-etapa' : 'operacoes-quadro'} aria-label={compact ? `Avisos de apuração ${error || (!data && !api?.getOperationAlerts) ? 'indisponíveis' : !data ? 'carregando' : `${data.total} ${data.total === 1 ? 'pendente' : 'pendentes'}`} · todas as competências` : undefined} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      {!compact && <span>Notas para revisão</span>}<strong className={data?.total ? 'operacoes-erro' : ''}>{compact && <span aria-hidden="true">⚠ </span>}{error || !data ? '—' : data.total}</strong>{(!compact || error || !data) && <small>{error ? 'Leitura indisponível' : !data ? (api?.getOperationAlerts ? 'Carregando' : 'Indisponível') : 'Todas as competências'}</small>}
    </button>}
    {open && <Modal className="operacoes-dialogo operacoes-avisos-dialogo" tamanho="lg" titulo="Notas para revisão" aoFechar={() => setOpen(false)} rodape={<Button variant="secondary" onClick={() => setOpen(false)}>Fechar</Button>}>
      <p>Todas as competências · pendências de revisão registradas. Abrir o aviso não altera a apuração nem consulta o Fisco.</p>
      {error ? <p role="alert">Não foi possível atualizar os avisos. Tente novamente ao voltar à página.</p> : !data ? <p role="status">{api?.getOperationAlerts ? 'Carregando avisos…' : 'Avisos indisponíveis neste ambiente.'}</p> : null}
      {data?.total === 0 && !error && <p role="status">Nenhuma pendência de revisão registrada nas empresas acessíveis. Isso não comprova ausência de notas ou de obrigações.</p>}
      {!error && data?.total > data?.items.length && <div className="operacoes-acoes"><p>Exibindo {data.items.length} de {data.total} avisos · página {page + 1}.</p><Button variant="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button><Button variant="secondary" disabled={(page + 1) * 200 >= data.total} onClick={() => setPage(p => p + 1)}>Próxima</Button></div>}
      {!error && data?.items.length > 0 && <p className="operacoes-avisos-scroll-hint">Deslize a tabela para conferir as evidências e o próximo passo.</p>}
      {!error && data?.items.length > 0 && <div className="operacoes-tabela-scroll" role="region" aria-label="Notas para revisão — tabela com rolagem horizontal" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th scope="col">Empresa / competência</th><th scope="col">Situação registrada / consequência</th><th scope="col">Fato / evidência registrada</th><th scope="col">Próximo passo</th></tr></thead><tbody>{data.items.map(item => {
        const [situation, consequence] = periodEvidence[item.situacaoPeriodo] || ['Situação do período a verificar', 'Conferir a situação e as evidências na auditoria da empresa.'];
        return <tr key={item.id}>
          <th scope="row">{item.portalClient.razao}<small>Competência {item.competencia}</small></th>
          <td>{situation}<p>{consequence}</p></td>
          <td>{item.observacoes || 'Causa não informada; conferir auditoria.'}</td>
          <td><div className="operacoes-acoes"><InternalLink className="btn btn-secondary btn-sm" aria-label={`Revisar competência ${item.competencia} de ${item.portalClient.razao}`} href={`${companyTabPath(item.portalClientId, 'auditoria')}?competencia=${item.competencia}`}>Revisar competência {item.competencia}</InternalLink><InternalLink className="btn btn-secondary btn-sm" aria-label={`Abrir apuração de ${item.portalClient.razao}, competência ${item.competencia}`} href={`${companyTabPath(item.portalClientId, 'cadastroFiscal')}?competencia=${item.competencia}`}>Abrir apuração</InternalLink></div></td>
        </tr>;
      })}</tbody></table></div>}
    </Modal>}
  </div>;
}
