import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { defaultCompetencia } from '../apuracao/hooks/useApuracao';
import { ColetasCbs } from './ColetasCbs';
import { MensalConsumo } from './MensalConsumo';

const PENDENCIAS = {
  COLETA_OFICIAL_NAO_IMPLEMENTADA: 'A coleta oficial ainda não está disponível.',
  PREPARACAO_LOCAL_DESABILITADA: 'A preparação local está desabilitada.',
  CREDENCIAL_NAO_REFERENCIADA: 'Nenhuma credencial do cofre foi vinculada.',
  CREDENCIAL_REFERENCIADA_INDISPONIVEL: 'A credencial vinculada não está mais disponível no cofre. Revise a referência antes da integração.',
  ENQUADRAMENTO_REGULAR_NAO_CONFIRMADO_PARA_TODO_O_MES: 'Confirme o enquadramento regular de todos os estabelecimentos durante toda a competência.',
};
const CAPACIDADES = { coletar: 'Coleta oficial', conferir: 'Conferência', confirmarOficial: 'Confirmação oficial', emitirGuia: 'Emissão de guia', consultarPagamento: 'Consulta de pagamento' };

export function BaseApuracaoConsumo(props) { return <Base key={props.companyId} {...props} />; }
function Base({ companyId, api, cadastroVersao }) {
  const [aberto, setAberto] = useState(false), [tributo, setTributo] = useState('CBS'), [ambiente, setAmbiente] = useState('HOMOLOGACAO');
  const [contextoVersao, setContextoVersao] = useState(0);
  const [competencia, setCompetencia] = useState(defaultCompetencia);
  return <details onToggle={e => setAberto(e.currentTarget.open)}>
    <summary>Preparação da apuração IBS/CBS</summary>
    {aberto && <>
      <p>Cadastre a preparação local por tributo e ambiente. Esta etapa não ativa sincronização nem realiza atos no Fisco.</p>
      <div className="reforma-grid">
        <label>Tributo<select value={tributo} onChange={e => setTributo(e.target.value)}><option>CBS</option><option>IBS</option></select></label>
        <label>Ambiente<select value={ambiente} onChange={e => setAmbiente(e.target.value)}><option value="HOMOLOGACAO">Homologação</option><option value="PRODUCAO">Produção</option></select></label>
        <label>Competência da preparação<input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} /></label>
      </div>
      {competencia && <Preparacao key={`${companyId}:${tributo}:${ambiente}:${competencia}:${cadastroVersao}`} api={api} companyId={companyId} tributo={tributo} ambiente={ambiente} competencia={competencia} onAlteracao={() => setContextoVersao(v => v + 1)} />}
      {competencia && <MensalConsumo key={`${cadastroVersao}:${contextoVersao}`} api={api} companyId={companyId} tributo={tributo} ambiente={ambiente} competencia={competencia} />}
      {tributo === 'CBS' && <ColetasCbs api={api} companyId={companyId} ambiente={ambiente} />}
    </>}
  </details>;
}
function Preparacao({ api, companyId, tributo, ambiente, competencia, onAlteracao }) {
  const [base, setBase] = useState(null), [erro, setErro] = useState(''), [aviso, setAviso] = useState(''), [recarga, setRecarga] = useState(0);
  const [ocupado, setOcupado] = useState(false), [habilitado, setHabilitado] = useState(false);
  const [referenciaContrato, setReferenciaContrato] = useState(''), [motivo, setMotivo] = useState(''), [motivoRevisao, setMotivoRevisao] = useState('');
  const vivo = useRef(false), bloqueio = useRef(false), intencoes = useRef({});
  const apiAtual = useRef(api); apiAtual.current = api;
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    let cancelado = false; setBase(null); setErro('');
    Promise.resolve().then(() => {
      if (!api?.getBaseApuracaoConsumo) throw new Error('A preparação de IBS/CBS ainda não está disponível neste ambiente.');
      return api.getBaseApuracaoConsumo(companyId, { tributo, ambiente, competencia });
    }).then(r => {
      if (cancelado) return;
      if (!r?.ok || r.tributo !== tributo || r.ambiente !== ambiente || r.competencia !== competencia) throw new Error('Resposta da preparação não corresponde ao período e ambiente selecionados.');
      setBase(r); setHabilitado(r.configuracao?.habilitado === true);
      setReferenciaContrato(r.configuracao?.dados?.referenciaContrato || ''); setMotivo(''); setMotivoRevisao('');
    }).catch(e => { if (!cancelado) setErro(e.message || 'Não foi possível carregar a preparação.'); });
    return () => { cancelado = true; };
  }, [api, companyId, tributo, ambiente, competencia, recarga]);
  const podeEditar = base?.podeEditar && !base.demonstracao;
  async function executar(acao, payload, chaveRetorno) {
    if (!podeEditar || bloqueio.current || apiAtual.current !== api) return;
    bloqueio.current = true; setOcupado(true); setErro(''); setAviso('');
    const serializado = JSON.stringify(payload);
    if (acao !== 'vincularEstabelecimentosConsumo') {
      if (intencoes.current[acao]?.serializado !== serializado) intencoes.current[acao] = { serializado, id: crypto.randomUUID() };
      payload = { ...payload, id: intencoes.current[acao].id };
    }
    try {
      const r = await api[acao](companyId, payload);
      if (!vivo.current || apiAtual.current !== api) return;
      if (!r?.ok || !r[chaveRetorno]) throw new Error('Gravação sem confirmação. Recarregue para conferir o registro.');
      delete intencoes.current[acao];
      onAlteracao?.();
      setBase(null); setAviso('Preparação local registrada. Nenhuma consulta ou emissão foi realizada.'); setRecarga(v => v + 1);
    } catch (e) { if (vivo.current && apiAtual.current === api) setErro(e.message || 'Não foi possível confirmar o registro.'); }
    finally { bloqueio.current = false; if (vivo.current) setOcupado(false); }
  }
  function salvar(e) {
    e.preventDefault();
    const anteriores = base.configuracao?.dados || {};
    executar('salvarConfiguracaoConsumo', { tributo, ambiente, versao: base.configuracao?.versao || 0, habilitado,
      dados: { motivo, referenciaContrato, ...(anteriores.credencialId ? { credencialId: anteriores.credencialId, credencialPortalClientId: anteriores.credencialPortalClientId } : {}) } }, 'configuracao');
  }
  function preparar(e) { e.preventDefault(); executar('prepararRevisaoConsumo', { tributo, ambiente, competencia, versao: base.revisao?.versao || 0, motivo: motivoRevisao }, 'revisao'); }
  return <section aria-label="Base da apuração IBS/CBS">
    {erro && <p role="alert">{erro}</p>}{aviso && <p role="status">{aviso}</p>}
    {!base && !erro && <p role="status">Carregando preparação…</p>}
    {base && <>
      {tributo === 'IBS' && base.integracaoIbs && <aside className="reforma-alert" aria-label="Limites da integração IBS">
        <p><strong>Integração IBS indisponível</strong> · contrato {base.integracaoIbs.versaoContrato}, verificado em {base.integracaoIbs.verificadoEm}.</p>
        <p>A habilitação e o download de arquivos dependem de endereços oficiais ainda não confirmados. Saldo, guias e confirmação de pagamento aguardam especificação e homologação. O cadastro local não libera essas operações.</p>
        {base.integracaoIbs.fonte?.startsWith('https://cgibs.gov.br/') && <a href={base.integracaoIbs.fonte} target="_blank" rel="noopener noreferrer">Consultar manual oficial do CGIBS</a>}
      </aside>}
      {base.demonstracao && <p>Demonstração: a preparação de IBS/CBS não grava dados e não habilita serviços oficiais.</p>}
      {!base.contribuinte ? <>
        <p>Esta empresa ainda não está vinculada à base de apuração.</p>
        {podeEditar && <Button disabled={ocupado} onClick={() => executar('vincularEstabelecimentosConsumo', { portalClientIds: [companyId] }, 'contribuinte')}>Vincular esta empresa</Button>}
      </> : <>
        <p>CNPJ-base: <strong>{base.contribuinte.cnpjBase}</strong></p>
        <ul>{base.contribuinte.estabelecimentos.map(e => <li key={e.id}>{e.razao} · {e.cnpj}</li>)}</ul>
        <form onSubmit={salvar}><fieldset disabled={ocupado || !podeEditar}>
          <legend>Configuração local · versão {base.configuracao?.versao || 0}</legend>
          <label>Preparação local<select value={habilitado ? 'sim' : 'nao'} onChange={e => setHabilitado(e.target.value === 'sim')}><option value="nao">Desabilitada</option><option value="sim">Habilitada somente no cadastro local</option></select></label>
          <label>Referência do contrato<input maxLength={500} value={referenciaContrato} onChange={e => setReferenciaContrato(e.target.value)} /></label>
          <label>Motivo da configuração<textarea required maxLength={1500} value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
          <p>{base.credencialDisponivel === false ? PENDENCIAS.CREDENCIAL_REFERENCIADA_INDISPONIVEL : base.configuracao?.dados?.credencialId ? 'Referência de credencial preservada no cofre.' : 'Sem credencial vinculada. O vínculo com o cofre será configurado na etapa de integração.'}</p>
          {podeEditar && <Button type="submit" disabled={!motivo.trim() || ocupado}>Salvar preparação local</Button>}
        </fieldset></form>
        {base.configuracao && <form onSubmit={preparar}><fieldset disabled={ocupado || !podeEditar}>
          <legend>Revisão da competência {competencia}</legend>
          <label>Motivo da preparação da competência<textarea required maxLength={1500} value={motivoRevisao} onChange={e => setMotivoRevisao(e.target.value)} /></label>
          {podeEditar && <Button type="submit" disabled={!motivoRevisao.trim() || ocupado}>Registrar preparação da competência</Button>}
        </fieldset></form>}
      </>}
      {base.revisao && <>
        <p>Última revisão: {base.revisao.versao} · {base.revisao.estado === 'PREPARACAO' ? 'Em preparação' : 'Estado não reconhecido'} · {base.revisao.competencia}</p>
        <p className="reforma-evidence">{base.revisao.dados?.motivo}</p>
        {base.desatualizada && <p className="reforma-alert">Preparação desatualizada: o cadastro, os estabelecimentos ou a configuração mudaram. Registre nova revisão após conferir.</p>}
        <ul>{(base.revisao.dados?.pendencias || []).map(p => <li key={p}>{PENDENCIAS[p] || `Pendência a conferir: ${p}`}</li>)}</ul>
        <p>Valores oficiais: ainda não coletados. Esta revisão não confirma a apuração nem o pagamento.</p>
      </>}
      <details><summary>Disponibilidade dos serviços</summary><ul>{Object.entries(CAPACIDADES).map(([k, nome]) => <li key={k}>{nome}: {base.capacidades?.[k] === true ? 'Informada como disponível; operação não oferecida nesta etapa.' : 'Indisponível nesta etapa.'}</li>)}</ul></details>
    </>}
    <div className="reforma-actions"><Button variant="secondary" disabled={ocupado} onClick={() => { intencoes.current = {}; setRecarga(v => v + 1); }}>Recarregar preparação</Button></div>
  </section>;
}
