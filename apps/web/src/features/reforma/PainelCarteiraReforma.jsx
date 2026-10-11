import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { REGIMES_REFORMA, FORMAS_IBSCBS, SITUACOES_REFORMA, EMISSOR_REFORMA } from '@contabilidade/shared/reforma-cadastro';
import './reforma.css';
export function PainelCarteiraReforma({ api, competencia }) {
  const [aberto, setAberto] = useState(false);
  return <details className="reforma" onToggle={e => setAberto(e.currentTarget.open)}>
    <summary>Reforma tributária · carteira</summary>
    {aberto && <Carteira key={competencia} api={api} competencia={competencia} />}
  </details>;
}
function Carteira({ api, competencia }) {
  const [dados, setDados] = useState(null), [erro, setErro] = useState(''), [recarga, setRecarga] = useState(0);
  const [busca, setBusca] = useState(''), [pendentes, setPendentes] = useState(false);
  useEffect(() => {
    let cancelada = false; setDados(null); setErro('');
    Promise.resolve().then(() => api.getCarteiraReforma(competencia)).then(r => {
      if (cancelada) return;
      if (!r?.ok || !Array.isArray(r.empresas)) throw new Error('Não foi possível ler a carteira da reforma.');
      setDados(r);
    }).catch(e => { if (!cancelada) setErro(e.message || 'Falha ao carregar a carteira.'); });
    return () => { cancelada = true; };
  }, [api, competencia, recarga]);
  const temPendencia = e => e.pendente || !e.verificacao || e.desatualizada || !e.verificacao.resumo.total || e.verificacao.resumo.parcial || e.verificacao.resumo.erros || e.verificacao.resumo.revisao;
  const empresas = dados?.empresas || [];
  const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const linhas = empresas.filter(e => (!pendentes || temPendencia(e)) && normalizar(`${e.razao} ${e.cnpj}`).includes(normalizar(busca)));
  return <>
    <p>Referência: <strong>{competencia}</strong>. O enquadramento abaixo corresponde ao primeiro dia do mês. A conferência das notas usa a data de cada operação.</p>
    {dados?.demonstracao && <p className="reforma-alert">Demonstração, sem consulta fiscal ou análise de notas reais.</p>}
    {erro && <p role="alert">{erro}</p>}{!dados && !erro && <p role="status">Carregando carteira…</p>}
    {dados && <>
      <div className="reforma-cards" aria-label="Resumo da reforma">
        <span><strong>{empresas.length}</strong> empresas</span>
        <span><strong>{empresas.filter(e => e.situacao !== 'CONFIRMADA').length}</strong> enquadramentos a conferir</span>
        <span><strong>{empresas.filter(e => e.emissor !== 'VALIDADO').length}</strong> emissores a conferir</span>
        <span><strong>{empresas.filter(e => !e.verificacao || e.desatualizada).length}</strong> verificações pendentes</span>
      </div>
      <div className="reforma-grid"><label>Buscar na carteira da reforma<input type="search" value={busca} onChange={e => setBusca(e.target.value)} /></label><label>Exibir<select value={pendentes ? 'pendentes' : 'todas'} onChange={e => setPendentes(e.target.value === 'pendentes')}><option value="todas">Todas as empresas</option><option value="pendentes">Com pendências de preparação ou conferência</option></select></label></div>
      <div className="reforma-table"><table><thead><tr><th>Empresa</th><th>Enquadramento na referência</th><th>Emissor</th><th>NFS-e da competência</th><th>Ações</th></tr></thead><tbody>
        {linhas.map(e => <tr key={e.id}>
          <td>{e.razao}<br /><small>{e.cnpj}</small></td>
          <td>{e.periodo ? <>{REGIMES_REFORMA[e.periodo.regime]}<br />{FORMAS_IBSCBS[e.periodo.forma]}<br /><small>{SITUACOES_REFORMA[e.situacao]}</small></> : 'Sem vigência cadastrada'}</td>
          <td>{EMISSOR_REFORMA[e.emissor]}</td>
          <td>{!e.verificacao ? 'Ainda não verificada' : <>{e.desatualizada && <strong>Rever: base ou regras alteradas. </strong>}{e.verificacao.resumo.erros} com erro · {e.verificacao.resumo.revisao} para revisão<br /><small>{e.verificacao.resumo.verificadas} de {e.verificacao.resumo.total} documentos · {e.verificacao.resumo.parcial ? 'análise parcial' : 'base armazenada'}</small></>}</td>
          <td><a href={companyTabPath(e.id, 'perfilFiscal')}>Conferir cadastro</a><br /><a href={companyTabPath(e.id, 'notasFiscais')}>Conferir notas</a></td>
        </tr>)}
      </tbody></table></div>
      {!linhas.length && <p>Nenhuma empresa encontrada neste filtro.</p>}
    </>}
    <div className="reforma-actions"><Button variant="secondary" onClick={() => setRecarga(v => v + 1)}>Atualizar painel</Button></div>
  </>;
}
