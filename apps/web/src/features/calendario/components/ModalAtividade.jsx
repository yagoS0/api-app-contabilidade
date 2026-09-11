import { useEffect, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { normalizarAgenda } from '../../../../../../packages/shared/src/agenda.js';
import { CORES_PRIORIDADE, RECORRENCIAS } from '../lib/agendaWorkspace';

export function ModalAtividade({ inicial, empresas, api, onFechar, onSalvo, onAlterarConclusao, onExcluir, onConfigurarObrigacao }) {
  const regra = inicial.regraEdicao;
  const edicao = Boolean(inicial.tarefaId || inicial.ocorrenciaIds || regra);
  const [passo, setPasso] = useState(1), [obrigacao, setObrigacao] = useState(Boolean(regra));
  const [dados, setDados] = useState({ titulo: '', descricao: '', recorrencia: 'AVULSA', prioridade: '', horaInicio: '', horaFim: '', ...inicial });
  const [horario, setHorario] = useState(inicial.horaInicio ? inicial.horaFim ? 'INTERVALO' : 'FIXO' : 'SEM');
  const [fiscal, setFiscal] = useState({ categoria: 'fiscal', diaVencimento: '', mesReferencia: Number(inicial.dataInicio.slice(5,7)), defasagemMeses: 1, ajusteDiaUtil: 'ANTECIPAR', antecedenciaLembreteDias: 5, verificador: '', escopo: inicial.companyId ? 'SELECAO_MANUAL' : 'TODAS', aplicarANovas: true, vencimentoFiscal: inicial.dataVencimento || inicial.vencimentoFiscal || inicial.dataFim, ...regra, regimes: regra?.filtros?.regimes || [], empresasIds: regra?.filtros?.empresasIds || (inicial.companyId ? [inicial.companyId] : []), temFolha: regra?.filtros?.temFolha === true });
  const [previa, setPrevia] = useState(null), [erro, setErro] = useState(''), [ocupado, setOcupado] = useState(false);
  const set = (chave, valor) => setDados(d => ({ ...d, [chave]: valor }));
  const setF = (chave, valor) => setFiscal(f => ({ ...f, [chave]: valor }));
  const filtros = fiscal.escopo === 'POR_FILTRO' ? { regimes: fiscal.regimes, temFolha: fiscal.temFolha || null } : fiscal.escopo === 'SELECAO_MANUAL' ? { empresasIds: fiscal.empresasIds } : null;
  const filtroChave = JSON.stringify(filtros);
  const porData = ['AVULSA','DIARIA','SEMANAL'].includes(dados.recorrencia);
  const curta = ['DIARIA','SEMANAL'].includes(dados.recorrencia);
  useEffect(() => {
    if (passo !== 2) return;
    const f=JSON.parse(filtroChave);
    if((fiscal.escopo==='POR_FILTRO' && !f.regimes.length && !f.temFolha) || (fiscal.escopo==='SELECAO_MANUAL' && !f.empresasIds.length)) {
      setPrevia({ok:false,total:0,message:'Selecione o grupo de empresas.'});return;
    }
    let ativo = true; setPrevia(null);
    api.previewEscopoRegra({ escopo: fiscal.escopo, filtros: JSON.parse(filtroChave) }).then(out => { if (ativo) setPrevia(out); }).catch(e => { if (ativo) setPrevia({ ok: false, message: e.message }); });
    return () => { ativo = false; };
  }, [api, passo, fiscal.escopo, filtroChave]);
  async function salvar(e) {
    e.preventDefault(); setErro('');
    try {
      if (horario !== 'SEM' && !dados.horaInicio) throw new Error('Informe o horário.');
      if (horario === 'INTERVALO' && !dados.horaFim) throw new Error('Informe o horário final.');
      const config = normalizarAgenda({ ...dados, horaInicio: horario === 'SEM' ? null : dados.horaInicio, horaFim: horario === 'INTERVALO' ? dados.horaFim : null });
      if (config.horaFim && config.horaFim <= config.horaInicio) throw new Error('O horário final deve ser posterior ao inicial.');
      if (!dados.titulo.trim()) throw new Error('Informe o título.');
      if (obrigacao && passo === 1) { setPasso(2); return; }
      setOcupado(true);
      let out;
      if (!obrigacao && inicial.ocorrenciaIds) out = await api.editarOcorrenciasAgenda(inicial.ocorrenciaIds, { ...config, titulo:dados.titulo, descricao:dados.descricao });
      else if (!obrigacao && edicao) out = await api.acaoTarefaAgenda(inicial.tarefaId, { acao: 'EDITAR', cicloChave: inicial.cicloChave, alteracoes: { ...config, titulo: dados.titulo, descricao: dados.descricao } });
      else if (!obrigacao && inicial.companyId) out = await api.createObrigacao(inicial.companyId, { nome:dados.titulo, descricao:dados.descricao, tipo:'TAREFA', periodicidade:config.recorrencia, agendaConfig:config, dataInicio:config.dataInicio, dataFim:config.dataFim, diaVencimento:Number(config.dataFim.slice(8)), mesReferencia:Number(config.dataInicio.slice(5,7)), ajusteDiaUtil:'MANTER', defasagemMeses:0 });
      else if (!obrigacao) out = await api.salvarTarefaAgenda({ titulo: dados.titulo, descricao: dados.descricao, config });
      else {
        if (!previa?.ok || !previa.total) throw new Error(previa?.message || 'Selecione as empresas desta obrigação.');
        const payload = {
          nome: dados.titulo, descricao: dados.descricao, tipo: 'OBRIGACAO', periodicidade: config.recorrencia,
          agendaConfig: { ...config, ...(porData ? { vencimentoFiscal: fiscal.vencimentoFiscal || config.dataFim } : {}) },
          dataInicio: config.dataInicio, dataFim: config.dataFim, dataVencimento: fiscal.vencimentoFiscal || config.dataFim,
          categoria: fiscal.categoria, diaVencimento: Number(fiscal.diaVencimento) || Number(config.dataFim.slice(8)),
          mesReferencia: Number(fiscal.mesReferencia), defasagemMeses: Number(fiscal.defasagemMeses),
          ajusteDiaUtil: curta ? 'MANTER' : fiscal.ajusteDiaUtil, antecedenciaLembreteDias: Number(fiscal.antecedenciaLembreteDias),
          verificador: porData ? null : fiscal.verificador || null, escopo: fiscal.escopo, filtros,
          aplicarANovas: fiscal.escopo !== 'SELECAO_MANUAL' && fiscal.aplicarANovas,
        };
        out = await (regra ? api.updateRegraObrigacao(regra.regraId || regra.id, payload) : api.createRegraObrigacao(payload));
      }
      if (out?.ok === false) throw new Error(out.message || 'Não foi possível salvar.');
      onSalvo({ dataInicio:config.dataInicio });
    } catch (e) { setErro(e.message); } finally { setOcupado(false); }
  }
  async function alterarConclusao() {
    setErro(''); setOcupado(true);
    try { await onAlterarConclusao(); }
    catch (e) { setErro(e.message); }
    finally { setOcupado(false); }
  }
  const campo = (rotulo, chave, tipo = 'text', extra = {}) => <label className="agenda-field">{rotulo}<input type={tipo} value={dados[chave] || ''} onChange={e => set(chave, e.target.value)} {...extra} /></label>;
  const fiscalInput = (rotulo, chave, extra = {}) => <label className="agenda-field">{rotulo}<input type="number" value={fiscal[chave]} onChange={e => setF(chave, e.target.value)} {...extra}/></label>;
  return <Modal titulo={regra ? 'Configurar obrigação' : edicao ? 'Editar atividade' : passo === 1 ? 'Nova atividade' : 'Obrigação'} aoFechar={onFechar} ocupado={ocupado} tamanho="md">
    <form className="agenda-form" onSubmit={salvar}>
      {passo === 1 ? <>
        {onConfigurarObrigacao && <button type="button" className="agenda-text-action" onClick={onConfigurarObrigacao}>Configurar obrigação</button>}
        {campo('Título', 'titulo', 'text', { required: true, maxLength: 200, placeholder: 'Ex.: Conferir NFS-e do mês', autoFocus: true })}
        {onAlterarConclusao && <div className="agenda-task-status">
          <span aria-live="polite">{inicial.resolvido ? 'Concluída' : 'Pendente'}</span>
          <Button type="button" variant="secondary" disabled={ocupado} onClick={alterarConclusao}>{inicial.resolvido ? 'Reabrir tarefa' : 'Concluir tarefa'}</Button>
        </div>}
        <label className="agenda-field">Descrição<textarea rows={3} maxLength={10000} value={dados.descricao || ''} onChange={e => set('descricao', e.target.value)} /></label>
        <div className="agenda-form-row">{campo('De', 'dataInicio', 'date', { required: true })}{campo('Até', 'dataFim', 'date', { required: true, min: dados.dataInicio })}</div>
        <label className="agenda-field">Horário<select value={horario} onChange={e => setHorario(e.target.value)}><option value="SEM">Sem horário</option><option value="FIXO">Horário fixo</option><option value="INTERVALO">De uma hora até outra</option></select></label>
        {horario !== 'SEM' && <div className="agenda-form-row">{campo(horario === 'FIXO' ? 'Às' : 'Horário inicial', 'horaInicio', 'time', { required: true })}{horario === 'INTERVALO' && campo('Horário final', 'horaFim', 'time', { required: true })}</div>}
        {(!edicao || regra) && <div className="agenda-form-row"><label className="agenda-field">Recorrência<select value={dados.recorrencia} onChange={e => set('recorrencia', e.target.value)}>{Object.entries(RECORRENCIAS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>{dados.recorrencia !== 'AVULSA' && campo('Repetir até', 'repetirAte', 'date', { min: dados.dataInicio })}</div>}
        <div className="agenda-form-row agenda-form-bottom">{!obrigacao && inicial.tipo !== 'obrigacao' && <fieldset className="agenda-priorities"><legend>Prioridade</legend>{Object.entries(CORES_PRIORIDADE).map(([v,c], index) => <button key={v} type="button" aria-label={['Sem prioridade','Baixa','Média','Alta','Urgente'][index]} aria-pressed={(dados.prioridade || '') === v} title={['Sem prioridade','Baixa','Média','Alta','Urgente'][index]} style={{ '--priority': c }} onClick={() => set('prioridade', v)} />)}</fieldset>}
        {!edicao && <label className="agenda-field">Tipo<select value={obrigacao ? 'OBRIGACAO' : 'TAREFA'} onChange={e => setObrigacao(e.target.value === 'OBRIGACAO')}><option value="TAREFA">Tarefa</option><option value="OBRIGACAO">Obrigação</option></select></label>}</div>
      </> : <>
        <div className="agenda-form-row"><label className="agenda-field">Área<select value={fiscal.categoria} onChange={e => setF('categoria',e.target.value)}><option value="fiscal">Fiscal</option><option value="contabil">Contábil</option><option value="trabalhista">Pessoal</option><option value="societario">Societário</option></select></label>
        {porData ? <label className="agenda-field">Vencimento fiscal<input type="date" required value={fiscal.vencimentoFiscal} onChange={e => setF('vencimentoFiscal',e.target.value)}/></label> : fiscalInput('Dia do vencimento fiscal','diaVencimento',{min:1,max:31,required:true})}</div>
        <div className="agenda-form-row"><label className="agenda-field">Dia não útil<select value={curta ? 'MANTER' : fiscal.ajusteDiaUtil} disabled={curta} onChange={e => setF('ajusteDiaUtil',e.target.value)}><option value="ANTECIPAR">Antecipar</option><option value="POSTERGAR">Prorrogar</option><option value="MANTER">Manter</option></select></label>{fiscalInput('Defasagem da competência (meses)','defasagemMeses',{min:0,max:12})}</div>
        <div className="agenda-form-row">{fiscalInput('Antecedência do lembrete (dias)','antecedenciaLembreteDias',{min:0,max:90})}<label className="agenda-field">Conclusão<select value={porData ? '' : fiscal.verificador} disabled={porData} onChange={e => setF('verificador', e.target.value)}><option value="">Manual</option><option value="APURACAO_TRANSMITIDA">Apuração transmitida</option><option value="MES_FECHADO">Mês contábil fechado</option></select></label></div>
        <label className="agenda-field">Aplicar a<select value={fiscal.escopo} onChange={e => setF('escopo',e.target.value)}><option value="TODAS">Todas as empresas</option><option value="POR_FILTRO">Por regime ou folha</option><option value="SELECAO_MANUAL">Empresas específicas</option></select></label>
        {fiscal.escopo === 'POR_FILTRO' && <fieldset className="agenda-scope"><legend>Empresas relacionadas</legend>{[['SIMPLES','Simples Nacional'],['LUCRO_PRESUMIDO','Lucro Presumido'],['LUCRO_REAL','Lucro Real']].map(([v,l]) => <label key={v}><input type="checkbox" checked={fiscal.regimes.includes(v)} onChange={e => setF('regimes',e.target.checked ? [...fiscal.regimes,v] : fiscal.regimes.filter(r => r !== v))}/>{l}</label>)}<label><input type="checkbox" checked={fiscal.temFolha} onChange={e => setF('temFolha',e.target.checked)}/>Somente com folha</label></fieldset>}
        {fiscal.escopo === 'SELECAO_MANUAL' && <fieldset className="agenda-scope agenda-company-choices"><legend>Empresas</legend>{empresas.map(e => <label key={e.companyId}><input type="checkbox" checked={fiscal.empresasIds.includes(e.companyId)} onChange={ev => setF('empresasIds',ev.target.checked ? [...fiscal.empresasIds,e.companyId] : fiscal.empresasIds.filter(id => id !== e.companyId))}/>{e.razao || e.nome}</label>)}</fieldset>}
        {fiscal.escopo !== 'SELECAO_MANUAL' && <label className="agenda-toggle"><input type="checkbox" checked={fiscal.aplicarANovas} onChange={e => setF('aplicarANovas',e.target.checked)}/>Incluir novas empresas deste grupo</label>}
        <div className="agenda-scope-preview" aria-live="polite">{previa ? previa.ok ? `${previa.total} ${previa.total === 1 ? 'empresa' : 'empresas'}` : previa.message : 'Consultando empresas…'}</div>
      </>}
      {erro && <p role="alert" className="agenda-error">{erro}</p>}
      <div className="agenda-form-actions">{onExcluir && <button className="agenda-text-action agenda-task-delete" type="button" disabled={ocupado} onClick={onExcluir}>Excluir ocorrência</button>}<Button variant="secondary" type="button" disabled={ocupado} onClick={passo === 2 ? () => setPasso(1) : onFechar}>{passo === 2 ? 'Anterior' : 'Cancelar'}</Button><Button type="submit" disabled={ocupado || (passo === 2 && !previa?.total)}>{ocupado ? 'Salvando…' : passo === 1 && obrigacao ? 'Continuar' : 'Salvar'}</Button></div>
    </form>
  </Modal>;
}
