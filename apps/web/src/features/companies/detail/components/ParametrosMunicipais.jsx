import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { resumoParametrosMunicipais } from './resumoParametrosMunicipais';

const ESTADOS = { CONSULTANDO: 'Consulta iniciada, sem conclusão registrada. Confira antes de iniciar outra.',
  RECEBIDO_PARA_CONFERENCIA: 'Retorno recebido para conferência', FALHOU: 'Consulta falhou; nenhum parâmetro foi confirmado' };

export function ParametrosMunicipais({ companyId, api, podeConsultar }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [recurso, setRecurso] = useState('convenio');
  const [servico, setServico] = useState('');
  const [complemento, setComplemento] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [competencia, setCompetencia] = useState('');
  const tentativa = useRef(null);
  const trava = useRef(false);
  const ativo = useRef(false);
  useEffect(() => {
    if (!podeConsultar) return undefined;
    ativo.current = true;
    let vigente = true;
    Promise.resolve().then(() => api.getParametrosMunicipais(companyId)).then(r => {
      if (!vigente) return;
      setDados(r); setMunicipio(r.municipio || ''); setServico(r.servicos?.[0] || '');
      setComplemento(r.codigoServicoNacional === r.servicos?.[0] ? r.codigoServicoMunicipal || '' : '');
    }).catch(e => { if (vigente) setErro(e.message || 'Não foi possível carregar as consultas.'); });
    return () => { vigente = false; ativo.current = false; };
  }, [companyId, api, podeConsultar]);
  async function consultar() {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setErro('');
    const entrada = { municipio, recurso, ...(recurso === 'servico' ? { codigoServico: servico, codigoServicoMunicipal: complemento } : {}) };
    // Resposta HTTP perdida reutiliza o mesmo identificador, sem repetir o GET oficial.
    if (!tentativa.current) tentativa.current = { ...entrada, requestKey: crypto.randomUUID() };
    try {
      const registro = await api.consultarParametrosMunicipais(companyId, tentativa.current);
      if (!ativo.current) return;
      setDados(d => ({ ...d, consultas: [registro, ...(d?.consultas || []).filter(r => r.id !== registro.id)].slice(0, 20) }));
      if (registro.status !== 'CONSULTANDO') tentativa.current = null;
    } catch (e) {
      if ([400, 409].includes(e.status)) tentativa.current = null;
      if (ativo.current) setErro(e.message || 'Não foi possível conferir o resultado. Tente recuperar a mesma consulta.');
    }
    finally { trava.current = false; if (ativo.current) setOcupado(false); }
  }
  if (!podeConsultar) return null;
  return <section className="nfse-section" aria-label="Parâmetros municipais oficiais">
    <h3>Parâmetros municipais oficiais</h3>
    <p>Consulte o convênio e o histórico de alíquotas do serviço para apoiar a conferência fiscal. O retorno não altera a configuração da empresa.</p>
    {erro && <p role="alert">{erro}</p>}
    {!dados ? <p role="status">{erro ? 'Consultas indisponíveis.' : 'Carregando consultas salvas…'}</p> : <>
      <p>{dados.demonstracao ? 'Demonstração local — dados sintéticos' : dados.ambiente === 'homolog' ? 'Ambiente de produção restrita (testes)' : 'Ambiente de produção'}</p>
      {!dados.habilitado ? <p role="status">Integração ainda não habilitada neste ambiente.</p> : <>
        <div className="form-grid">
          <label>Município da consulta (IBGE)<input value={municipio} inputMode="numeric" maxLength={7} disabled={ocupado || !!tentativa.current}
            onChange={e => { setMunicipio(e.target.value.replace(/\D/g, '')); setComplemento(''); }} /></label>
          <label>Consultar<select value={recurso} disabled={ocupado || !!tentativa.current} onChange={e => setRecurso(e.target.value)}>
            <option value="convenio">Convênio municipal</option><option value="servico">Histórico de alíquotas do serviço</option>
          </select></label>
          {recurso === 'servico' && <><label>Serviço nacional<select value={servico} disabled={ocupado || !!tentativa.current} onChange={e => { setServico(e.target.value); setComplemento(''); }}>
            {(dados.servicos || []).map(c => <option key={c} value={c}>{c}</option>)}
          </select></label>
          <label>Complemento municipal (3 dígitos)<input value={complemento} inputMode="numeric" maxLength={3} disabled={ocupado || !!tentativa.current}
            onChange={e => setComplemento(e.target.value.replace(/\D/g, ''))} /></label></>}
        </div>
        <Button type="button" disabled={ocupado || !/^\d{7}$/.test(municipio) || (recurso === 'servico' && (!servico || !/^\d{3}$/.test(complemento)))} onClick={consultar}>
          {ocupado ? 'Consultando…' : tentativa.current ? 'Recuperar consulta' : 'Consultar fonte oficial'}
        </Button>
      </>}
      <p>A data de consulta não comprova vigência para uma nota retroativa. Alíquotas, retenções, benefícios e inscrição municipal continuam sujeitos à conferência.</p>
      <label>Dia da prestação para conferir vigência<input type="date" value={competencia} onChange={e => setCompetencia(e.target.value)} /></label>
      <p>Esta comparação usa o histórico já consultado, sem nova chamada ao ADN. A alíquota municipal não substitui a apuração do Simples nem confirma retenção de ISS.</p>
      {!dados.consultas?.length && <p>Nenhuma consulta registrada neste ambiente.</p>}
      {(dados.consultas || []).map(r => <details key={r.id}>
        <summary>{r.recurso === 'convenio' ? 'Convênio' : `Serviço ${r.codigoServico}`} · IBGE {r.municipio} · {ESTADOS[r.status] || 'Estado desconhecido'}</summary>
        <p>Consulta registrada em {new Date(r.createdAt).toLocaleString('pt-BR')}. {r.httpStatus ? `Retorno HTTP ${r.httpStatus}.` : ''}</p>
        <p>Fonte: {r.origem || 'ADN'} · {r.ambiente === 'homolog' ? 'Homologação' : r.ambiente === 'producao' ? 'Produção' : 'Ambiente não informado'} · {r.caminho}</p>
        {resumoParametrosMunicipais(r, competencia).filter(v => v.abrange).length > 1 && <p role="alert">Mais de um período alcança a competência. Confira as regras e os intervalos antes de aplicar qualquer parâmetro.</p>}
        {resumoParametrosMunicipais(r, competencia).map((v, i) => <div key={`${v.servico}-${i}`}>
          <p>Serviço {v.servico} · Incidência informada: {v.incidencia} · Alíquota: {v.aliquota == null ? 'não informada' : `${v.aliquota.toLocaleString('pt-BR')}%`}</p>
          <p>Vigência: {v.inicio || 'não identificada'} até {v.fim || 'sem término identificado'}. {v.situacao}</p>
        </div>)}
        {r.recurso === 'servico' && r.status === 'RECEBIDO_PARA_CONFERENCIA' && !resumoParametrosMunicipais(r, competencia).length && <p>Não foi possível identificar períodos de alíquota no retorno. Isso não comprova ausência de incidência.</p>}
        {r.status === 'FALHOU' && <p>Confira a disponibilidade e a autorização da integração. Falha não significa ausência de obrigação.</p>}
        {r.resposta != null && <><p>Resposta da fonte para conferência:</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' }}>{JSON.stringify(r.resposta, null, 2)}</pre></>}
      </details>)}
    </>}
  </section>;
}
