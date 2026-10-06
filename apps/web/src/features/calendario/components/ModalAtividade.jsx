import { VERIFICADORES_CARTEIRA, chaveDaObrigacaoCarteira } from '@contabilidade/shared/fluxo-carteira';
import { useEffect, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { normalizarAgenda } from '../../../../../../packages/shared/src/agenda.js';
import { editarJanela } from '../lib/editarJanela';
import { MiniCalendarioAgenda } from './MiniCalendarioAgenda';
import { CORES_PRIORIDADE, RECORRENCIAS } from '../lib/agendaWorkspace';

export function ModalAtividade({ inicial, empresas, api, onFechar, onSalvo, onAlterarConclusao, onExcluir, onConfigurarObrigacao, onOpenCompany, onRascunho }) {
  const regra = inicial.regraEdicao || inicial.regraOriginal;
  const modoRegra = Boolean(inicial.regraEdicao);
  const edicao = Boolean(inicial.tarefaId || inicial.ocorrenciaIds || modoRegra);
  const eraObrigacao = Boolean(regra?.tipo !== 'TAREFA' && regra) || inicial.tipo === 'obrigacao';
  const [passo, setPasso] = useState(1), [obrigacao, setObrigacao] = useState(eraObrigacao);
  const [alcance, setAlcance] = useState(modoRegra ? 'SERIE' : 'ESTA');
  const edicaoSerie = edicao && alcance === 'SERIE';
  const conversao = edicao && obrigacao && !eraObrigacao;
  const precisaFiscal = obrigacao && (!edicao || edicaoSerie || conversao);
  const grupoEmpresas = inicial.ocorrenciaIds?.length > 1 && inicial.tipo === 'tarefa';
  const podeEditarSerie = !grupoEmpresas && Boolean(inicial.tarefaId || inicial.obrigacaoOriginal || regra);
  const empresaFixa = edicao && inicial.obrigacaoOriginal && !regra;
  const [dados, setDados] = useState({ titulo: '', descricao: '', recorrencia: 'AVULSA', ajusteDiaUtil: 'MANTER', prioridade: '', horaInicio: '', horaFim: '', ...inicial });
  const [horario, setHorario] = useState(inicial.horaInicio ? inicial.horaFim ? 'INTERVALO' : 'FIXO' : 'SEM');
  const [fiscal, setFiscal] = useState({ categoria: 'fiscal', diaVencimento: '', mesReferencia: Number(inicial.dataInicio.slice(5,7)), defasagemMeses: 1, ajusteDiaUtil: 'ANTECIPAR', antecedenciaLembreteDias: 5, verificador: '', escopo: inicial.companyId ? 'SELECAO_MANUAL' : 'TODAS', aplicarANovas: true, vencimentoFiscal: inicial.dataVencimento || inicial.vencimentoFiscal || inicial.dataFim, ...inicial.obrigacaoOriginal, ...inicial.modeloCarteira, ...regra, regimes: regra?.filtros?.regimes || inicial.modeloCarteira?.filtros?.regimes || [], empresasIds: regra?.filtros?.empresasIds || (inicial.companyId ? [inicial.companyId] : []), temFolha: regra?.filtros?.temFolha === true });
  const [previa, setPrevia] = useState(null), [erro, setErro] = useState(''), [ocupado, setOcupado] = useState(false);
  const [empresasTarefa, setEmpresasTarefa] = useState([]);
  const [buscaEmpresa, setBuscaEmpresa] = useState('');
  const [compartilhar, setCompartilhar] = useState(false);
  useEffect(() => {
    if (!edicao) onRascunho?.({titulo:dados.titulo,dataInicio:dados.dataInicio,dataFim:dados.dataFim,horaInicio:horario === 'SEM' ? null : dados.horaInicio,horaFim:horario === 'INTERVALO' ? dados.horaFim : null});
  }, [edicao,onRascunho,dados.titulo,dados.dataInicio,dados.dataFim,dados.horaInicio,dados.horaFim,horario]);
  const set = (chave, valor) => setDados(d => editarJanela(d, chave, valor));
  function mudarAlcance(proximo) {
    if (proximo !== alcance) setDados(d => {
      const deSerie = alcance === 'SERIE';
      const atualInicio = deSerie ? inicial.dataInicioOriginal || inicial.dataInicio : inicial.dataInicio;
      const atualFim = deSerie ? inicial.dataFimOriginal || inicial.dataFim : inicial.dataFim;
      const datas = d.dataInicio === atualInicio && d.dataFim === atualFim ? {
        dataInicio: proximo === 'SERIE' ? inicial.dataInicioOriginal || inicial.dataInicio : inicial.dataInicio,
        dataFim: proximo === 'SERIE' ? inicial.dataFimOriginal || inicial.dataFim : inicial.dataFim,
      } : {};
      return { ...d, ...datas, ...(proximo === 'ESTA' ? { recorrencia: inicial.recorrencia || 'AVULSA', repetirAte: inicial.repetirAte || null, ajusteDiaUtil: inicial.ajusteDiaUtil || 'MANTER' } : {}) };
    });
    setAlcance(proximo);
  }
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
      if (precisaFiscal && passo === 1) { setPasso(2); return; }
      setOcupado(true);
      let out;
      if (!obrigacao && empresasTarefa.length) {
        if (!compartilhar) throw new Error('Confirme a visibilidade da tarefa para a equipe.');
        out = await api.vincularTarefasEmpresas({titulo:dados.titulo, descricao:dados.descricao, config, empresasIds:empresasTarefa, compartilhar, ...(inicial.tarefaId ? {tarefaId:inicial.tarefaId} : {})});
      }
      else if (!precisaFiscal && inicial.ocorrenciaIds && !edicaoSerie) out = await api.editarOcorrenciasAgenda(inicial.ocorrenciaIds, { ...config, titulo:dados.titulo, descricao:dados.descricao });
      else if (!precisaFiscal && inicial.tarefaId) out = await api.acaoTarefaAgenda(inicial.tarefaId, { acao: edicaoSerie ? 'EDITAR_SERIE' : 'EDITAR', cicloChave: inicial.cicloChave, alteracoes: { ...config, titulo: dados.titulo, descricao: dados.descricao } });
      else if (!precisaFiscal && edicaoSerie && inicial.obrigacaoOriginal) out = await api.updateObrigacao(inicial.obrigacaoOriginal.obrigacaoId, { ...inicial.obrigacaoOriginal, nome:dados.titulo, descricao:dados.descricao, periodicidade:config.recorrencia, agendaConfig:config, dataInicio:config.dataInicio, dataFim:config.dataFim });
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
        // Alterar nome/conclusão de uma regra antiga não cria uma janela baseada na data de hoje.
        const baseJanela = {recorrencia:'AVULSA',ajusteDiaUtil:'MANTER',prioridade:'',...inicial};
        const janelaInalterada = ['dataInicio','dataFim','horaInicio','horaFim','repetirAte','recorrencia','ajusteDiaUtil','prioridade'].every(k => (dados[k] || '') === (baseJanela[k] || ''));
        if (regra && !regra.agendaConfig && janelaInalterada && horario === (inicial.horaFim ? 'INTERVALO' : inicial.horaInicio ? 'FIXO' : 'SEM')) {
          delete payload.agendaConfig; delete payload.dataInicio; delete payload.dataFim; delete payload.dataVencimento;
        }
        out = await (conversao && inicial.tarefaId ? api.converterTarefaEmObrigacao(inicial.tarefaId, { cicloChave: inicial.cicloChave, regra: payload })
          : regra ? api.updateRegraObrigacao(regra.regraId || regra.id, payload)
          : edicao && inicial.obrigacaoOriginal ? api.updateObrigacao(inicial.obrigacaoOriginal.obrigacaoId, payload)
          : api.createRegraObrigacao(payload));
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
  const compacto = passo === 1 && !modoRegra;
  const formatarData = data => new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR', { day:'numeric', month:'short' });
  const resumoData = dados.dataInicio ? `${formatarData(dados.dataInicio)}${dados.dataFim && dados.dataFim !== dados.dataInicio ? ` – ${formatarData(dados.dataFim)}` : ''}` : 'Escolher prazo';
  const campo = (rotulo, chave, tipo = 'text', extra = {}) => <label className="agenda-field">{rotulo}<input type={tipo} value={dados[chave] || ''} onChange={e => set(chave, e.target.value)} {...extra} /></label>;
  const fiscalInput = (rotulo, chave, extra = {}) => <label className="agenda-field">{rotulo}<input type="number" value={fiscal[chave]} onChange={e => setF(chave, e.target.value)} {...extra}/></label>;
  return <Modal titulo={modoRegra ? 'Configurar obrigação' : edicao ? 'Editar atividade' : passo === 1 ? 'Nova atividade' : 'Obrigação'} aoFechar={onFechar} ocupado={ocupado} tamanho={compacto ? 'sm' : 'md'} className={compacto ? 'agenda-editor' : ''} ancora={compacto ? inicial.ancora : null}>
    <form className="agenda-form" onSubmit={salvar} onInvalid={e => { const details = e.target.closest('details'); if (details) details.open = true; }}>
      {passo === 1 ? <>
        {campo('Título', 'titulo', 'text', { required: true, maxLength: 200, placeholder: 'O que você gostaria de fazer?', autoFocus: true, 'data-modal-autofocus': true })}
        {onConfigurarObrigacao && <button type="button" className="agenda-text-action" onClick={onConfigurarObrigacao}>Configurar obrigação</button>}
        {!obrigacao && inicial.companyId && !grupoEmpresas && <div className="agenda-task-status"><span>{inicial.empresa || empresas.find(e => e.companyId === inicial.companyId)?.razao || 'Empresa atual'}</span>{onOpenCompany && <Button type="button" variant="secondary" onClick={() => onOpenCompany(inicial.companyId)}>Abrir empresa</Button>}</div>}
        {!obrigacao && !inicial.companyId && !inicial.ocorrenciaIds && <details className="agenda-editor-section agenda-editor-companies"><summary>Empresas <span>{empresasTarefa.length ? `${empresasTarefa.length} selecionadas` : 'Pessoal'}</span></summary><fieldset className="agenda-scope"><legend>Empresas da tarefa (opcional)</legend>
          <input className="agenda-company-search" aria-label="Buscar empresa da tarefa" placeholder="Razão social ou CNPJ" value={buscaEmpresa} onChange={e => setBuscaEmpresa(e.target.value)}/>
          <div className="agenda-company-choices">{empresas.filter(e => `${e.razao || e.nome} ${e.cnpj || ''}`.toLowerCase().includes(buscaEmpresa.toLowerCase())).map(e => <label key={e.companyId}><input type="checkbox" checked={empresasTarefa.includes(e.companyId)} onChange={ev => {setEmpresasTarefa(ids => ev.target.checked ? [...ids,e.companyId] : ids.filter(id => id !== e.companyId)); setCompartilhar(false);}}/>{e.razao || e.nome}{e.cnpj ? ` · ${e.cnpj}` : ''}</label>)}</div>
          {empresasTarefa.length ? <label><input type="checkbox" checked={compartilhar} onChange={e => setCompartilhar(e.target.checked)}/>Compartilhar com a equipe autorizada das empresas selecionadas. Cada empresa terá sua própria conclusão.{inicial.tarefaId ? ' A tarefa pessoal será substituída somente se não tiver histórico; o vínculo vale para toda a série.' : ''}</label> : <small>Sem seleção, esta tarefa continua pessoal.</small>}
        </fieldset></details>}
        {onAlterarConclusao && !conversao && <div className="agenda-task-status">
          <span aria-live="polite">{inicial.resolvido ? 'Concluída' : 'Pendente'}</span>
          <Button type="button" variant="secondary" disabled={ocupado} onClick={alterarConclusao}>{inicial.resolvido ? 'Reabrir tarefa' : 'Concluir tarefa'}</Button>
        </div>}
        <label className="agenda-field agenda-editor-description">Descrição<textarea placeholder="Descrição ou notas" rows={3} maxLength={10000} value={dados.descricao || ''} onChange={e => set('descricao', e.target.value)} /></label>
        <details className="agenda-editor-section agenda-editor-dates" open={inicial.modeloCarteira ? true : undefined}><summary>◷ <span>{resumoData}{horario !== 'SEM' ? ` · ${dados.horaInicio}${horario === 'INTERVALO' ? `–${dados.horaFim}` : ''}` : ' · Dia inteiro'}</span></summary><div className="agenda-editor-panel">
        <MiniCalendarioAgenda dataInicio={dados.dataInicio} dataFim={dados.dataFim} onChange={datas => setDados(d => ({...d,...datas}))}/>
        <label className="agenda-field">Horário<select value={horario} onChange={e => setHorario(e.target.value)}><option value="SEM">Sem horário</option><option value="FIXO">Horário fixo</option><option value="INTERVALO">De uma hora até outra</option></select></label>
        {horario !== 'SEM' && <div className="agenda-form-row">{campo(horario === 'FIXO' ? 'Às' : 'Horário inicial', 'horaInicio', 'time', { required: true })}{horario === 'INTERVALO' && campo('Horário final', 'horaFim', 'time', { required: true })}</div>}
        <div className="agenda-duration-presets" aria-label="Duração">{[30,60,90,120].map(m => <button type="button" key={m} onClick={() => { const [h,min] = (dados.horaInicio || '08:00').split(':').map(Number); const fim = Math.min(1439,h*60+min+m); setHorario('INTERVALO'); set('horaInicio',dados.horaInicio || '08:00'); set('horaFim',`${String(Math.floor(fim/60)).padStart(2,'0')}:${String(fim%60).padStart(2,'0')}`); }}>{m < 60 ? `${m} min` : `${m/60} h`}</button>)}</div>
        </div></details>
        <details className="agenda-editor-section"><summary>Repetição e tipo <span>{RECORRENCIAS[dados.recorrencia]}</span></summary><div className="agenda-editor-panel">
        <div className="agenda-form-row"><label className="agenda-field">Tipo<select value={obrigacao ? 'OBRIGACAO' : 'TAREFA'} disabled={eraObrigacao || grupoEmpresas} onChange={e => { setObrigacao(e.target.value === 'OBRIGACAO'); if (edicao) mudarAlcance('SERIE'); }}><option value="TAREFA">Tarefa</option><option value="OBRIGACAO">Obrigação</option></select></label><label className="agenda-field">Recorrência<select value={dados.recorrencia} disabled={edicao && !podeEditarSerie} onChange={e => { set('recorrencia', e.target.value); if (edicao) mudarAlcance('SERIE'); }}>{Object.entries(RECORRENCIAS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label></div>
        {dados.recorrencia !== 'AVULSA' && <>
          <label className="agenda-field">Em dias não úteis<select value={dados.ajusteDiaUtil || 'MANTER'} disabled={edicao && !podeEditarSerie} onChange={e => { set('ajusteDiaUtil', e.target.value); if (edicao) mudarAlcance('SERIE'); }}><option value="MANTER">Manter a data</option><option value="ANTECIPAR">Antecipar para o dia útil anterior</option></select></label>
          <label className="agenda-field">Repetir até<input type="date" value={dados.repetirAte || ''} min={dados.dataInicio} disabled={edicao && !podeEditarSerie} onChange={e => { set('repetirAte',e.target.value); if (edicao) mudarAlcance('SERIE'); }}/></label>
        </>}
        {edicao && !modoRegra && podeEditarSerie && <label className="agenda-field">Aplicar alterações<select value={alcance} disabled={conversao} onChange={e => mudarAlcance(e.target.value)}><option value="ESTA">Somente esta ocorrência</option><option value="SERIE">{inicial.tarefaId ? 'Esta e próximas ocorrências' : 'Toda a série'}</option></select></label>}
        </div></details>
        <div className="agenda-form-row agenda-form-bottom">{!obrigacao && inicial.tipo !== 'obrigacao' && <fieldset className="agenda-priorities"><legend>Prioridade</legend>{Object.entries(CORES_PRIORIDADE).map(([v,c], index) => <button key={v} type="button" aria-label={['Sem prioridade','Baixa','Média','Alta','Urgente'][index]} aria-pressed={(dados.prioridade || '') === v} title={['Sem prioridade','Baixa','Média','Alta','Urgente'][index]} style={{ '--priority': c }} onClick={() => set('prioridade', v)} />)}</fieldset>}
        </div>
      </> : <>
        <div className="agenda-form-row"><label className="agenda-field">Área<select value={fiscal.categoria} onChange={e => setF('categoria',e.target.value)}><option value="fiscal">Fiscal</option><option value="contabil">Contábil</option><option value="trabalhista">Pessoal</option><option value="societario">Societário</option></select></label>
        {porData ? <label className="agenda-field">Vencimento fiscal<input type="date" required value={fiscal.vencimentoFiscal} onChange={e => setF('vencimentoFiscal',e.target.value)}/></label> : fiscalInput(chaveDaObrigacaoCarteira(fiscal.verificador) ? 'Dia do prazo interno' : 'Dia do vencimento fiscal','diaVencimento',{min:1,max:31,required:true})}</div>
        <div className="agenda-form-row"><label className="agenda-field">Dia não útil<select value={curta ? 'MANTER' : fiscal.ajusteDiaUtil} disabled={curta} onChange={e => setF('ajusteDiaUtil',e.target.value)}><option value="ANTECIPAR">Antecipar</option><option value="POSTERGAR">Prorrogar</option><option value="MANTER">Manter</option></select></label>{fiscalInput('Defasagem da competência (meses)','defasagemMeses',{min:0,max:12})}</div>
        <div className="agenda-form-row">{fiscalInput('Antecedência do lembrete (dias)','antecedenciaLembreteDias',{min:0,max:90})}<label className="agenda-field">Conclusão<select value={porData ? '' : fiscal.verificador} disabled={porData} onChange={e => setF('verificador', e.target.value)}><option value="">Manual</option><option value="APURACAO_TRANSMITIDA">Apuração transmitida</option><option value="MES_FECHADO">Mês contábil fechado</option>{Object.entries(VERIFICADORES_CARTEIRA).map(([v,t]) => <option key={v} value={v}>{t}</option>)}</select></label></div>
        {empresaFixa ? <label className="agenda-field">Empresa<input readOnly value={inicial.empresa || inicial.obrigacaoOriginal.empresa || 'Empresa atual'}/></label> : <label className="agenda-field">Aplicar a<select value={fiscal.escopo} onChange={e => setF('escopo',e.target.value)}><option value="TODAS">Todas as empresas</option><option value="POR_FILTRO">Por regime ou folha</option><option value="SELECAO_MANUAL">Empresas específicas</option></select></label>}
        {fiscal.escopo === 'POR_FILTRO' && <fieldset className="agenda-scope"><legend>Empresas relacionadas</legend>{[['SIMPLES','Simples Nacional'],['LUCRO_PRESUMIDO','Lucro Presumido'],['LUCRO_REAL','Lucro Real']].map(([v,l]) => <label key={v}><input type="checkbox" checked={fiscal.regimes.includes(v)} onChange={e => setF('regimes',e.target.checked ? [...fiscal.regimes,v] : fiscal.regimes.filter(r => r !== v))}/>{l}</label>)}<label><input type="checkbox" checked={fiscal.temFolha} onChange={e => setF('temFolha',e.target.checked)}/>Somente com folha</label></fieldset>}
        {!empresaFixa && fiscal.escopo === 'SELECAO_MANUAL' && <fieldset className="agenda-scope agenda-company-choices"><legend>Empresas</legend>{empresas.map(e => <label key={e.companyId}><input type="checkbox" checked={fiscal.empresasIds.includes(e.companyId)} onChange={ev => setF('empresasIds',ev.target.checked ? [...fiscal.empresasIds,e.companyId] : fiscal.empresasIds.filter(id => id !== e.companyId))}/>{e.razao || e.nome}</label>)}</fieldset>}
        {fiscal.escopo !== 'SELECAO_MANUAL' && <label className="agenda-toggle"><input type="checkbox" checked={fiscal.aplicarANovas} onChange={e => setF('aplicarANovas',e.target.checked)}/>Incluir novas empresas deste grupo</label>}
        <div className="agenda-scope-preview" aria-live="polite">{previa ? previa.ok ? `${previa.total} ${previa.total === 1 ? 'empresa' : 'empresas'}` : previa.message : 'Consultando empresas…'}</div>
      </>}
      {erro && <p role="alert" className="agenda-error">{erro}</p>}
      <div className="agenda-form-actions">{onExcluir && <button className="agenda-text-action agenda-task-delete" type="button" disabled={ocupado} onClick={onExcluir}>Excluir ocorrência</button>}<Button variant="secondary" type="button" disabled={ocupado} onClick={passo === 2 ? () => setPasso(1) : onFechar}>{passo === 2 ? 'Anterior' : 'Cancelar'}</Button><Button type="submit" disabled={ocupado || (passo === 2 && !previa?.total)}>{ocupado ? 'Salvando…' : passo === 1 && precisaFiscal ? 'Continuar' : 'Salvar'}</Button></div>
    </form>
  </Modal>;
}
