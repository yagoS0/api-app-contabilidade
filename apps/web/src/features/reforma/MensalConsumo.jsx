import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { evidenciaValida, evidenciaVazia, moedaCentavos, valorParaCentavos } from './leituraMensalConsumo';

const CONTEXTO = ['tributo', 'ambiente', 'competencia'];
function valida(r, ctx) {
  return r?.ok && CONTEXTO.every(k => r[k] === ctx[k]) && Number.isInteger(r.versao) && r.dados && ['guias', 'pagamentos', 'alocacoes', 'pendencias'].every(k => Array.isArray(r.dados[k]));
}
export function MensalConsumo(props) {
  return <Entrada key={`${props.companyId}:${props.tributo}:${props.ambiente}:${props.competencia}`} {...props} />;
}
function Entrada(props) {
  const [aberto, setAberto] = useState(false);
  return <details onToggle={e => setAberto(e.currentTarget.open)}><summary>Conferência e pagamentos da competência</summary>{aberto && <Painel {...props} />}</details>;
}
function Painel({ api, companyId, tributo, ambiente, competencia }) {
  const ctx = { tributo, ambiente, competencia };
  const [registro, setRegistro] = useState(null), [carregando, setCarregando] = useState(true), [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(''), [aviso, setAviso] = useState('');
  const vivo = useRef(false), sequencia = useRef(0), bloqueio = useRef(false), atual = useRef(null), intencoes = useRef(new Map());
  const apiAtual = useRef(api); apiAtual.current = api;
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; atual.current = null; sequencia.current++; }; }, []);
  const carregar = useCallback(async () => {
    const vez = ++sequencia.current;
    const vigente = () => vivo.current && apiAtual.current === api && sequencia.current === vez;
    atual.current = null; setCarregando(true); setErro('');
    try {
      if (!api?.getMensalConsumo) throw new Error('O acompanhamento mensal ainda não está disponível neste ambiente.');
      const r = await api.getMensalConsumo(companyId, { tributo, ambiente, competencia });
      if (!vigente()) return;
      if (!valida(r, { tributo, ambiente, competencia })) throw new Error('A resposta não corresponde ao tributo, ambiente e competência selecionados.');
      atual.current = r; setRegistro({ api, valor: r });
    } catch (e) { if (vigente()) setErro(e.message || 'Não foi possível ler a competência.'); }
    finally { if (vigente()) setCarregando(false); }
  }, [api, companyId, tributo, ambiente, competencia]);
  useEffect(() => { carregar(); return () => { sequencia.current++; }; }, [carregar]);
  const r = registro?.api === api ? registro.valor : null;
  const podeEditar = Boolean(r && atual.current === r && !carregando && !ocupado && !r.demonstracao && r.capacidades?.editar === true);
  async function executar(acao, dados) {
    if (!podeEditar || atual.current !== r || bloqueio.current || !vivo.current || apiAtual.current !== api) return false;
    if (acao === 'CONFERIR_LOCAL' && (!r.podeConferir || r.capacidades?.conferirLocal !== true || r.estado === 'CONFERIDA_LOCAL' || r.desatualizada)) return false;
    bloqueio.current = true; setOcupado(true); setErro(''); setAviso('');
    if (acao === 'REGISTRAR_BASE' && !/^[a-f\d]{64}$/i.test(r.contextoHash || '')) { bloqueio.current = false; setOcupado(false); setErro('Atualize a competência antes de revisar a base.'); return false; }
    const payload = { ...ctx, versao: r.versao, acao, dados, ...(acao === 'REGISTRAR_BASE' ? { contextoHash: r.contextoHash } : {}) };
    const chave = JSON.stringify(payload);
    if (!intencoes.current.has(chave)) intencoes.current.set(chave, crypto.randomUUID());
    try {
      const resposta = await api.registrarAcaoMensalConsumo(companyId, { ...payload, id: intencoes.current.get(chave) });
      if (!vivo.current || apiAtual.current !== api) return false;
      if (!valida(resposta, ctx)) throw new Error('Registro sem confirmação válida. Atualize o histórico local antes de repetir.');
      atual.current = resposta; setRegistro({ api, valor: resposta }); intencoes.current.delete(chave);
      setAviso('Registro local salvo. Nenhuma transmissão, emissão ou consulta ao Fisco foi realizada.');
      return true;
    } catch (e) { if (vivo.current && apiAtual.current === api) setErro(e.message || 'Não foi possível confirmar o registro local.'); return false; }
    finally { bloqueio.current = false; if (vivo.current) setOcupado(false); }
  }
  return <section aria-label="Acompanhamento mensal IBS CBS">
    <p><strong>{tributo} · {competencia} · {ambiente === 'PRODUCAO' ? 'Produção' : 'Homologação'}</strong></p>
    <p>Conferência do escritório, guias obtidas fora do sistema e pagamentos declarados. Esses registros não confirmam a apuração nem a baixa no Fisco.</p>
    {carregando && <p role="status">Lendo a competência…</p>}{erro && <p role="alert">{erro}</p>}{aviso && <p role="status">{aviso}</p>}
    {r && <>
      {r.demonstracao && <p>Demonstração: registros mensais indisponíveis; nenhum ato oficial será realizado.</p>}
      {atual.current !== r && <p className="reforma-alert">Exibindo a última leitura. Atualize o histórico para liberar as ações.</p>}
      <p>Versão {r.versao} · {r.estado === 'CONFERIDA_LOCAL' ? 'Conferida pelo escritório — confirmação exclusivamente local' : 'Em conferência local'}</p>
      {r.desatualizada && <p className="reforma-alert">Conferência desatualizada. Revise a base e as evidências antes de conferir novamente.</p>}
      <p>Valores oficiais: não disponíveis. Emissão de guias, confirmação da apuração e consulta oficial de pagamento permanecem desativadas.</p>
      {!!r.pendenciasCalculadas?.length && <ul aria-label="Impedimentos para conferência">{r.pendenciasCalculadas.map((p, i) => <li key={`${p.codigo}:${i}`}>{p.mensagem}</li>)}</ul>}
      <div className="reforma-cards"><span>Débitos declarados: <strong>{moedaCentavos(r.dados.valoresDeclarados?.debitosCentavos)}</strong></span><span>Créditos declarados: <strong>{moedaCentavos(r.dados.valoresDeclarados?.creditosCentavos)}</strong></span></div>
      {r.dados.cobertura && <p>Cobertura declarada manualmente: {r.dados.cobertura.inicio} a {r.dados.cobertura.fim}. A referência documental não comprova integração ou cobertura oficial.</p>}
      <div key={`${r.versao}:${r.contextoHash || ''}`}>
        {r.dados.conferencia && <p>Última conferência local: {r.dados.conferencia.motivo}</p>}
        <BaseDeclarada registro={r} disabled={!podeEditar || !/^[a-f\d]{64}$/i.test(r.contextoHash || '')} executar={executar} />
        <Pendencias registro={r} disabled={!podeEditar} executar={executar} />
        <Conferencia disabled={!podeEditar || !r.podeConferir || r.capacidades?.conferirLocal !== true || r.estado === 'CONFERIDA_LOCAL' || r.desatualizada} executar={executar} />
        <Financeiro registro={r} disabled={!podeEditar} executar={executar} />
        <HistoricoMensal api={api} companyId={companyId} contexto={ctx} />
      </div>
    </>}
    <div className="reforma-actions"><Button variant="secondary" disabled={carregando || ocupado} onClick={carregar}>Atualizar histórico mensal local</Button></div>
  </section>;
}
function Evidencia({ value, onChange, prefixo }) {
  const [calculando, setCalculando] = useState(false), [erroHash, setErroHash] = useState('');
  const vigente = useRef(0), montado = useRef(false);
  useEffect(() => { montado.current = true; return () => { montado.current = false; vigente.current++; }; }, []);
  async function calcular(file) {
    const vez = ++vigente.current; setErroHash('');
    if (!file) { setCalculando(false); return; }
    onChange(anterior => ({ ...anterior, sha256: '' }));
    if (file.size > 50 * 1024 * 1024) { setCalculando(false); setErroHash('Selecione um arquivo de até 50 MB para calcular o hash localmente.'); return; }
    setCalculando(true);
    try {
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      if (!montado.current || vigente.current !== vez) return;
      const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      onChange(anterior => ({ ...anterior, sha256 }));
    } catch { if (montado.current && vigente.current === vez) setErroHash('Não foi possível calcular o hash local. Você pode informar o SHA-256 manualmente.'); }
    finally { if (montado.current && vigente.current === vez) setCalculando(false); }
  }
  return <fieldset><legend>Evidência declarada · {prefixo}</legend>
    <p><small>Informe a referência e o hash do documento que você conferiu. O arquivo não é enviado, armazenado ou verificado por este formulário.</small></p>
    <label>Referência documental · {prefixo}<input required maxLength={500} value={value.referencia} onChange={e => onChange({ ...value, referencia: e.target.value })} /></label>
    <label>Calcular hash de arquivo local · {prefixo}<input type="file" onChange={e => calcular(e.target.files?.[0])} /></label>
    <p><small>Arquivo usado apenas para calcular o SHA-256 neste navegador; não é enviado nem armazenado.</small></p>
    {calculando && <p role="status">Calculando hash local…</p>}{erroHash && <p role="alert">{erroHash}</p>}
    <label>SHA-256 do documento · {prefixo}<input required pattern="[a-fA-F0-9]{64}" maxLength={64} value={value.sha256} onChange={e => { vigente.current++; setCalculando(false); onChange({ ...value, sha256: e.target.value }); }} /></label>
    <label>Descrição da evidência · {prefixo}<textarea required maxLength={1500} value={value.descricao} onChange={e => onChange({ ...value, descricao: e.target.value })} /></label>
  </fieldset>;
}
const textoValor = v => v == null || !/^\d+$/.test(String(v)) ? '' : `${BigInt(v) / 100n},${String(BigInt(v) % 100n).padStart(2, '0')}`;
function BaseDeclarada({ registro: r, disabled, executar }) {
  const c = r.dados.cobertura;
  const [tratamento, setTratamento] = useState(r.dados.tratamento?.tipo || 'NAO_DEFINIDO');
  const [debitos, setDebitos] = useState(textoValor(r.dados.valoresDeclarados?.debitosCentavos)), [creditos, setCreditos] = useState(textoValor(r.dados.valoresDeclarados?.creditosCentavos));
  const [inicio, setInicio] = useState(c?.inicio || ''), [fim, setFim] = useState(c?.fim || ''), [ids, setIds] = useState(c?.estabelecimentoIds || []), [recursos, setRecursos] = useState(c?.recursos || []);
  const [evidencia, setEvidencia] = useState(c?.evidencia ? { referencia: c.evidencia.referencia, sha256: c.evidencia.sha256, descricao: c.evidencia.descricao } : evidenciaVazia()), [pendencias, setPendencias] = useState(r.dados.pendencias.map(p => ({ id: p.id, descricao: p.descricao })));
  const alternar = (valores, valor) => valores.includes(valor) ? valores.filter(v => v !== valor) : [...valores, valor];
  const valido = valorParaCentavos(debitos) !== null && valorParaCentavos(creditos) !== null && inicio && fim && inicio <= fim && ids.length && recursos.length && evidenciaValida(evidencia) && pendencias.every(p => p.descricao.trim());
  return <details><summary>Base declarada e cobertura documental</summary><form onSubmit={e => { e.preventDefault(); if (valido) executar('REGISTRAR_BASE', { valoresDeclarados: { debitosCentavos: valorParaCentavos(debitos), creditosCentavos: valorParaCentavos(creditos) }, cobertura: { inicio, fim, estabelecimentoIds: ids, recursos, evidencia }, tratamento: { tipo: tratamento, evidencia }, pendencias }); }}><fieldset disabled={disabled}>
    <legend>Revisar base local</legend><p>Valores informados pelo escritório. Não são valores oficiais coletados nem estimativas calculadas pelo sistema. Alterar a base reinicia a conferência e reabre todas as pendências reenviadas. As resoluções anteriores permanecem no histórico.</p>
    <div className="reforma-grid"><label>Débitos declarados (R$)<input required maxLength={32} inputMode="decimal" value={debitos} onChange={e => setDebitos(e.target.value)} /></label><label>Créditos declarados (R$)<input required inputMode="decimal" value={creditos} onChange={e => setCreditos(e.target.value)} /></label><label>Início da cobertura<input type="date" required value={inicio} onChange={e => setInicio(e.target.value)} /></label><label>Fim da cobertura<input type="date" required value={fim} onChange={e => setFim(e.target.value)} /></label></div>
    <fieldset><legend>Estabelecimentos cobertos</legend>{(r.estabelecimentos || []).map(est => <label className="reforma-check" key={est.id}><input type="checkbox" checked={ids.includes(est.id)} onChange={() => setIds(alternar(ids, est.id))} />{est.razao || est.id}</label>)}{!r.estabelecimentos?.length && <p>Nenhum estabelecimento vinculado. Revise a preparação.</p>}</fieldset>
    <fieldset><legend>Recursos cobertos</legend>{[['DEBITOS', 'Débitos'], ['CREDITOS', 'Créditos']].map(([id, nome]) => <label className="reforma-check" key={id}><input type="checkbox" checked={recursos.includes(id)} onChange={() => setRecursos(alternar(recursos, id))} />{nome}</label>)}</fieldset>
    <label>Tratamento declarado<select value={tratamento} onChange={e => setTratamento(e.target.value)}><option value="NAO_DEFINIDO">Ainda não definido</option><option value="REGULAR_PADRAO">Regular padrão</option><option value="ESPECIFICO">Regime específico</option><option value="DERE">DERE</option></select></label><p>A classificação é declarada pelo escritório, com a mesma evidência da cobertura; não é um diagnóstico fiscal automático. Regimes específicos e DERE exigem fluxo próprio e impedem esta conferência local.</p>
    <Evidencia value={evidencia} onChange={setEvidencia} prefixo="cobertura" />
    <fieldset><legend>Pendências identificadas</legend>{pendencias.map((p, i) => <div key={p.id}><label>Pendência {i + 1}<textarea readOnly={r.dados.pendencias.some(item => item.id === p.id && !item.resolvida)} required maxLength={1000} value={p.descricao} onChange={e => setPendencias(pendencias.map(item => item.id === p.id ? { ...item, descricao: e.target.value } : item))} /></label>{!r.dados.pendencias.some(item => item.id === p.id && !item.resolvida) && <Button type="button" variant="secondary" onClick={() => setPendencias(pendencias.filter(item => item.id !== p.id))}>Remover pendência {i + 1} da revisão</Button>}</div>)}<p>Pendências já abertas mantêm sua descrição; registre uma resolução documentada antes de revisá-las.</p><Button type="button" variant="secondary" disabled={pendencias.length >= 200} onClick={() => setPendencias([...pendencias, { id: crypto.randomUUID(), descricao: '' }])}>Adicionar pendência</Button></fieldset>
    <Button type="submit" disabled={!valido}>Salvar base declarada</Button>
  </fieldset></form></details>;
}
function Pendencias({ registro, disabled, executar }) {
  return <details><summary>Pendências ({registro.dados.pendencias.filter(p => !p.resolvida).length} abertas)</summary>{registro.dados.pendencias.map(p => <article className="reforma-finding" key={p.id}><p><strong>{p.descricao}</strong> · {p.resolvida ? 'Resolvida localmente' : 'Aberta'}</p>{p.resolvida ? <p>{p.resolucao}</p> : <Justificativa prefixo={`pendência ${p.descricao}`} rotulo="Resolução" botao="Registrar resolução" disabled={disabled} onSubmit={(resolucao, evidencia) => executar('RESOLVER_PENDENCIA', { pendenciaId: p.id, resolucao, evidencia })} />}</article>)}{!registro.dados.pendencias.length && <p>Nenhuma pendência declarada. Os impedimentos calculados acima continuam válidos.</p>}</details>;
}
function Justificativa({ prefixo, rotulo = 'Motivo', botao, disabled, onSubmit, confirmar = false }) {
  const [motivo, setMotivo] = useState(''), [evidencia, setEvidencia] = useState(evidenciaVazia), [aceite, setAceite] = useState(false);
  return <form onSubmit={e => { e.preventDefault(); if (motivo.trim() && evidenciaValida(evidencia) && (!confirmar || aceite)) onSubmit(motivo, evidencia); }}><fieldset disabled={disabled}>
    <label>{rotulo} · {prefixo}<textarea required maxLength={1000} value={motivo} onChange={e => setMotivo(e.target.value)} /></label><Evidencia value={evidencia} onChange={setEvidencia} prefixo={prefixo} />
    {confirmar && <label className="reforma-check"><input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} />Conferi os documentos e a cobertura desta competência. Esta confirmação é somente do escritório.</label>}
    <Button type="submit" disabled={!motivo.trim() || !evidenciaValida(evidencia) || (confirmar && !aceite)}>{botao}</Button>
  </fieldset></form>;
}
function Conferencia({ disabled, executar }) { return <details><summary>Conferência do escritório</summary><p>Exige cobertura de toda a competência, estabelecimentos e recursos, além da resolução das pendências. Não transmite confirmação ao Fisco.</p><Justificativa prefixo="conferência" botao="Conferir localmente" disabled={disabled} confirmar onSubmit={(motivo, evidencia) => executar('CONFERIR_LOCAL', { motivo, evidencia, documentosConferidos: true })} /></details>; }
function Financeiro({ registro: r, disabled, executar }) {
  return <>
    <details><summary>Guias registradas manualmente ({r.dados.guias.length})</summary><p>Cadastre uma guia obtida fora do sistema. A origem permanece declarada, sem validação automática da autenticidade.</p><RegistroDocumento tipo="guia" disabled={disabled} executar={executar} />
      {r.dados.guias.map(g => <article className="reforma-finding" key={g.id}><h4>{g.referencia} · {g.cancelada ? 'Cancelada localmente' : 'Guia declarada'}</h4><p>Valor: {moedaCentavos(g.valorCentavos)} · Vencimento: {g.vencimento}</p><EvidenciaRegistrada evidencia={g.evidencia} /><p>Alocado localmente: {moedaCentavos(g.alocadoCentavos)} · Saldo local: {moedaCentavos(g.saldoCentavos)}</p>{!g.cancelada && <details><summary>Cancelar registro da guia</summary><p>Estorne as alocações ativas antes de cancelar.</p><Justificativa prefixo={`cancelamento da guia ${g.referencia}`} botao="Cancelar registro da guia" disabled={disabled || BigInt(g.alocadoCentavos || '0') > 0n} onSubmit={(motivo, evidencia) => executar('CANCELAR_GUIA', { guiaId: g.id, motivo, evidencia })} /></details>}</article>)}
    </details>
    <details><summary>Pagamentos e extinções declarados ({r.dados.pagamentos.length})</summary><p>Comprovantes informados manualmente. A alocação abaixo não representa confirmação oficial do pagamento ou extinção.</p><RegistroDocumento tipo="pagamento" disabled={disabled} executar={executar} />
      {r.dados.pagamentos.map(p => <article className="reforma-finding" key={p.id}><h4>{p.referencia} · {p.cancelado ? 'Cancelado localmente' : p.tipo === 'EXTINCAO_MANUAL' ? 'Extinção declarada' : 'Pagamento declarado'}</h4><p>Valor: {moedaCentavos(p.valorCentavos)} · Data: {p.data}</p><EvidenciaRegistrada evidencia={p.evidencia} /><p>Alocado localmente: {moedaCentavos(p.alocadoCentavos)} · Disponível localmente: {moedaCentavos(p.saldoCentavos)}</p>{!p.cancelado && <details><summary>Cancelar registro do pagamento</summary><p>Estorne as alocações ativas antes de cancelar.</p><Justificativa prefixo={`cancelamento do pagamento ${p.referencia}`} botao="Cancelar registro do pagamento" disabled={disabled || BigInt(p.alocadoCentavos || '0') > 0n} onSubmit={(motivo, evidencia) => executar('CANCELAR_PAGAMENTO', { pagamentoId: p.id, motivo, evidencia })} /></details>}</article>)}
    </details>
    <details><summary>Alocação local de pagamentos</summary><Alocacao registro={r} disabled={disabled} executar={executar} />{r.dados.alocacoes.map(a => <article className="reforma-finding" key={a.id}><p>{r.dados.pagamentos.find(p => p.id === a.pagamentoId)?.referencia || 'Pagamento'} → {r.dados.guias.find(g => g.id === a.guiaId)?.referencia || 'Guia'} · {moedaCentavos(a.valorCentavos)} · {a.estornada ? 'Estornada localmente' : 'Alocação local'}</p>{!a.estornada && <details><summary>Estornar alocação</summary><Justificativa prefixo="estorno da alocação" botao="Estornar alocação local" disabled={disabled} onSubmit={(motivo, evidencia) => executar('ESTORNAR_ALOCACAO', { alocacaoId: a.id, motivo, evidencia })} /></details>}</article>)}</details>
  </>;
}
function RegistroDocumento({ tipo, disabled, executar }) {
  const [referencia, setReferencia] = useState(''), [valor, setValor] = useState(''), [data, setData] = useState(''), [natureza, setNatureza] = useState('PAGAMENTO_MANUAL'), [evidencia, setEvidencia] = useState(evidenciaVazia);
  const centavos = valorParaCentavos(valor), valido = referencia.trim() && centavos !== null && BigInt(centavos) > 0n && data && evidenciaValida(evidencia);
  return <form onSubmit={e => { e.preventDefault(); if (valido) executar(tipo === 'guia' ? 'REGISTRAR_GUIA' : 'REGISTRAR_PAGAMENTO', { referencia, valorCentavos: centavos, ...(tipo === 'guia' ? { vencimento: data } : { data, tipo: natureza }), evidencia }); }}><fieldset disabled={disabled}>
    <legend>Novo registro de {tipo}</legend><div className="reforma-grid"><label>Referência {tipo === 'guia' ? 'da guia' : 'do pagamento'}<input required maxLength={200} value={referencia} onChange={e => setReferencia(e.target.value)} /></label><label>Valor {tipo === 'guia' ? 'da guia' : 'do pagamento'} (R$)<input required inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} /></label><label>{tipo === 'guia' ? 'Vencimento da guia' : 'Data do pagamento ou extinção'}<input type="date" required value={data} onChange={e => setData(e.target.value)} /></label></div>
    {tipo === 'pagamento' && <label>Tipo do registro<select value={natureza} onChange={e => setNatureza(e.target.value)}><option value="PAGAMENTO_MANUAL">Pagamento manual</option><option value="EXTINCAO_MANUAL">Outra extinção declarada</option></select></label>}
    <Evidencia value={evidencia} onChange={setEvidencia} prefixo={tipo} /><Button type="submit" disabled={!valido}>{tipo === 'guia' ? 'Registrar guia declarada' : 'Registrar pagamento ou extinção'}</Button>
  </fieldset></form>;
}
function Alocacao({ registro: r, disabled, executar }) {
  const [guiaId, setGuia] = useState(''), [pagamentoId, setPagamento] = useState(''), [valor, setValor] = useState('');
  const guias = r.dados.guias.filter(g => !g.cancelada), pagamentos = r.dados.pagamentos.filter(p => !p.cancelado);
  const guia = guias.find(g => g.id === guiaId), pagamento = pagamentos.find(p => p.id === pagamentoId), centavos = valorParaCentavos(valor);
  const valido = guia && pagamento && centavos !== null && BigInt(centavos) > 0n && /^\d+$/.test(guia.saldoCentavos) && /^\d+$/.test(pagamento.saldoCentavos) && BigInt(centavos) <= BigInt(guia.saldoCentavos) && BigInt(centavos) <= BigInt(pagamento.saldoCentavos);
  return <form onSubmit={e => { e.preventDefault(); if (valido) executar('ALOCAR', { guiaId, pagamentoId, valorCentavos: centavos }); }}><fieldset disabled={disabled}>
    <legend>Alocar valor parcial ou total</legend><div className="reforma-grid"><label>Guia a vincular<select required value={guiaId} onChange={e => setGuia(e.target.value)}><option value="">Selecione a guia</option>{guias.map(g => <option key={g.id} value={g.id}>{g.referencia} · saldo {moedaCentavos(g.saldoCentavos)}</option>)}</select></label><label>Pagamento a vincular<select required value={pagamentoId} onChange={e => setPagamento(e.target.value)}><option value="">Selecione o pagamento</option>{pagamentos.map(p => <option key={p.id} value={p.id}>{p.referencia} · disponível {moedaCentavos(p.saldoCentavos)}</option>)}</select></label><label>Valor a alocar (R$)<input required inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} /></label></div>
    <p>O valor deve caber no saldo local da guia e do pagamento. CBS e IBS não compartilham alocações.</p><Button type="submit" disabled={!valido}>Registrar alocação local</Button>
  </fieldset></form>;
}
const ACOES = { REGISTRAR_BASE: 'Base declarada revisada', RESOLVER_PENDENCIA: 'Pendência resolvida', CONFERIR_LOCAL: 'Conferência local registrada', REGISTRAR_GUIA: 'Guia declarada registrada', REGISTRAR_PAGAMENTO: 'Pagamento ou extinção declarado', ALOCAR: 'Valor alocado localmente', ESTORNAR_ALOCACAO: 'Alocação estornada', CANCELAR_GUIA: 'Guia cancelada localmente', CANCELAR_PAGAMENTO: 'Pagamento cancelado localmente' };
function HistoricoMensal({ api, companyId, contexto }) {
  const [aberto, setAberto] = useState(false), [lista, setLista] = useState(null), [erro, setErro] = useState('');
  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setLista(null); setErro('');
    Promise.resolve().then(() => api.getHistoricoMensalConsumo(companyId, contexto)).then(r => {
      if (cancelado) return;
      if (!r?.ok || !CONTEXTO.every(k => r[k] === contexto[k]) || !Array.isArray(r.historico)) throw new Error('Histórico incompatível com a competência selecionada.');
      setLista(r);
    }).catch(e => { if (!cancelado) setErro(e.message || 'Não foi possível ler o histórico.'); });
    return () => { cancelado = true; };
  }, [aberto, api, companyId, contexto.tributo, contexto.ambiente, contexto.competencia]);
  return <details onToggle={e => setAberto(e.currentTarget.open)}><summary>Histórico auditável da competência</summary>{aberto && <>
    {erro && <p role="alert">{erro}</p>}{!lista && !erro && <p>Lendo histórico local…</p>}
    {lista && <>{lista.truncado && <p>Exibindo as 100 revisões mais recentes.</p>}{lista.historico.map(h => <article className="reforma-finding" key={h.id}><p>Versão {h.versao} · {ACOES[h.acao] || 'Revisão local'} · {new Date(h.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>{h.comando?.dados?.motivo && <p>{h.comando.dados.motivo}</p>}{h.comando?.dados?.resolucao && <p>{h.comando.dados.resolucao}</p>}</article>)}{!lista.historico.length && <p>Nenhuma revisão local registrada.</p>}</>}
  </>}</details>;
}

function EvidenciaRegistrada({ evidencia: e }) { return e ? <details><summary>Evidência declarada do documento</summary><p className="reforma-evidence">{e.referencia}<br />{e.descricao}<br />SHA-256: {e.sha256}</p><p>Referência declarada; arquivo não armazenado ou validado pelo sistema.</p></details> : null; }


