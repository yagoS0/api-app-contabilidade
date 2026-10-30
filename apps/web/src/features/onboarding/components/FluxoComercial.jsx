import { nomeDaOportunidade } from '../../comercial/comercialModel';
import { campoComercial, textoComercial } from './FluxoComercial.shared.js';
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { DestinoComercialSimples } from "./DestinoComercialSimples";
import { CadastroComercialSimples } from "./CadastroComercialSimples";
import { ProcuracaoSimples, SituacaoFiscalSimples, ApresentacaoSimples, FichaDocumentosSimples, PagamentoComercialSimples, EnviarContratoSimples } from "./EtapasComerciaisSimples";
import { AnaliseDoLead } from "./AnaliseDoLead";
import { FormularioContrato } from "./FormularioContrato";


import { ApresentacaoProposta as OpcoesProposta } from "./ApresentacaoProposta";
export { ApresentacaoProposta as OpcoesProposta } from "./ApresentacaoProposta";

import { FichaAvulsa } from "./FichaAvulsa";
import { ValoresDaProposta } from "./ValoresDaProposta";
import { montarJornada } from "../lib/jornadaComercial";
import { ProgressoDoLead, CamposDaEtapa, DiagnosticoDoLead, MensagemDoPasso, } from "./PassosDoLead";

export function FluxoComercial(props) {
  return <FluxoDaFicha key={props.onboardingId} {...props} />;
}

function FluxoDaFicha({ api, onboardingId, conversaId: conversaInformada, janela = null, canalDisponivel = true, canalDeEnvio = null, revisao = 0, onAtualizar, onAbrirExecucao }) {
  const [estado, setEstado] = useState(null), [recursos, setRecursos] = useState([]), [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false), [passoEscolhido, setPassoEscolhido] = useState(null), [link, setLink] = useState("");
  const [documentoId, setDocumentoId] = useState("");
  const [destinoFicha, setDestinoFicha] = useState(null);
  const [erroLeitura, setErroLeitura] = useState("");
  const [visitados, setVisitados] = useState([]);
  const [evidenciaEntrega, setEvidenciaEntrega] = useState("");
  const trava = useRef(false), vivo = useRef(false), pedido = useRef(0), carregando = useRef(false), tituloRef = useRef(null);
  const contexto = useRef(onboardingId);
  contexto.current = onboardingId;
  const atualizarPai = useRef(onAtualizar);
  atualizarPai.current = onAtualizar;
  const base = "/onboardings/" + encodeURIComponent(onboardingId);
  const carregar = useCallback(async ({ propagar = false } = {}) => {
    const n = ++pedido.current; carregando.current = true;
    try {
      const [e, r] = await Promise.all([api.comercial(base), api.comercial("/recursos")]);
      if (vivo.current && n === pedido.current && contexto.current === onboardingId) {
        if (e?.ok === false || e?.onboarding?.id !== onboardingId || !Array.isArray(e.propostas) || !Array.isArray(e.contratos) || !Array.isArray(r?.recursos)) throw new Error('Resposta sem dados válidos do atendimento. Atualize antes de continuar.');
        setEstado(atual => atual?.onboarding?.id === e.onboarding?.id && atual?.onboarding?.versao > e.onboarding?.versao ? atual : e);
        setRecursos(r.recursos || []);
        setErroLeitura("");
        if (propagar) await atualizarPai.current?.({ origem: 'polling' });
      }
    } catch (e) {
      if (vivo.current && n === pedido.current && contexto.current === onboardingId) setErroLeitura(e.message);
      throw e;
    } finally { if (n === pedido.current) carregando.current = false; }
  }, [api, base, onboardingId]);
  useEffect(() => { const pedidoDaExecucao = pedido;
    vivo.current = true; trava.current = false; setOcupado(false); setEstado(null); setPassoEscolhido(null);
    carregar().catch(() => {});
    return () => { vivo.current = false; pedidoDaExecucao.current++; };
  }, [carregar]);
  useEffect(() => {
    if (revisao) carregar().catch(() => {});
  }, [revisao, carregar]);
  // Somente lê resultados salvos: nenhuma consulta fiscal ou geração de IA no polling.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden" && !trava.current && !carregando.current) carregar({ propagar: true }).catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [carregar, onboardingId]);
  async function executar(fn, { avancar = false } = {}) {
    if (trava.current || erroLeitura) return false;
    const id = onboardingId;
    trava.current = true; setOcupado(true); setErro("");
    try {
      await fn();
      if (!vivo.current || contexto.current !== id) return true;
      const atualizado = await atualizarAposAcao();
      if (avancar && atualizado && vivo.current && contexto.current === id) setPassoEscolhido(null);
      return atualizado;
    } catch (e) { if (vivo.current && contexto.current === id) { setErro(e.message); await carregar().catch(() => {}); } return false; }
    finally { if (vivo.current && contexto.current === id) { trava.current = false; setOcupado(false); } }
  }
  async function atualizarAposAcao() {
    const id = onboardingId;
    const resultados = await Promise.allSettled([carregar(), Promise.resolve().then(() => onAtualizar?.())]);
    const falha = resultados.find(r => r.status === 'rejected');
    if (falha && vivo.current && contexto.current === id) setErro(`A ação foi salva, mas não foi possível atualizar o atendimento. ${falha.reason.message}`);
    return !falha;
  }
  const acao = (path, body = {}) => executar(() => api.comercial(base + path, body), { avancar: true });
  const baseJornada = estado ? montarJornada(estado) : null;
  const servicoAvulso = baseJornada?.contrato?.dados?.opcao?.recorrente === false || baseJornada?.pessoaFisica;
  const tituloExecucao = servicoAvulso ? "Execução do serviço" : "Implantação";
  const jornada = baseJornada ? { ...baseJornada, passos: [...baseJornada.passos, { id: "conclusao", titulo: "Ficha e documentos", concluido: baseJornada.encerrado, acessivel: baseJornada.atual === "conclusao", pendencias: [] }] } : null;
  const passo = jornada && (jornada.passos.some(p => p.id === passoEscolhido && p.acessivel) ? passoEscolhido : jornada.atual);
  const contratoAtualId = baseJornada?.contrato?.id;
  const propostaAtualId = baseJornada?.proposta?.id;
  useEffect(() => { setLink(""); }, [propostaAtualId]);
  useEffect(() => { setEvidenciaEntrega(""); setDocumentoId(""); }, [contratoAtualId]);
  useEffect(() => { if (passo) setVisitados(v => v.includes(passo) ? v : [...v, passo]); }, [passo]);
  useEffect(() => { if (passo) tituloRef.current?.focus({ preventScroll: true }); }, [passo]);
  if (!api.comercial) return <p>Fluxo comercial disponível com a API atualizada.</p>;
  if (!estado) return <section aria-label="Propostas e contratação">{erroLeitura || erro ? <p role="alert">{erroLeitura || erro}</p> : <p role="status">Carregando passo a passo…</p>}<Button onClick={() => carregar().catch(() => {})}>Recarregar atendimento</Button></section>;
  // O chat informa o destino conferido. A ficha isolada não reaproveita o canal antigo do caso.
  const contextoDestino = `${onboardingId}:${estado.atendimento?.id || ''}:${estado.atendimento?.conversaId || ''}`;
  const destinoConfirmado = destinoFicha?.contexto === contextoDestino ? destinoFicha : null;
  const conversaId = conversaInformada || destinoConfirmado?.conversaId || null;
  const janelaAtual = conversaInformada ? janela : destinoConfirmado?.janela;
  const podeEnviar = Boolean(conversaId && canalDisponivel && (conversaInformada || destinoConfirmado?.podeResponder !== false) && (!janelaAtual || janelaAtual.situacao === "ABERTA"));
  const o = estado.onboarding;
  const pessoaFisica = o.origem === "PESSOA_FISICA";
  const contratosAtuais = estado.contratos.filter(c => c.propostaId === jornada.proposta?.id);
  const etapa = jornada.passos.find(p => p.id === passo);
  const trabalho = tipo => estado.trabalhos?.find(t => t.tipo === tipo && t.cnpj === o.cnpj);
  const camposOrcamento = <CamposDaEtapa interno sempreAberto onboarding={o} campos={pessoaFisica ? ["responsavelNome", "responsavelEmail", "servicoSolicitado"] : ["responsavelNome", "responsavelEmail", "modalidadeServico", jornada.abertura ? "regimePretendido" : "regimeAtual", "qtdFuncionarios", "notasRecebidasMes", "consultoriaMensal"]} ocupado={ocupado} onSalvar={b => acao("/campos", b)} />;
  const formulario = <MensagemDoPasso api={api} conversaId={conversaId} disabled={ocupado} onEnviado={atualizarAposAcao} rotulo={"Preparar formulário de " + jornada.nome.toLowerCase()} preparar={async () => {
    const r = await api.criarLinkOnboarding(onboardingId, { diasValidade: 7 });
    if (!r.token) throw new Error("Não foi possível confirmar o link.");
    return { texto: "Para continuarmos com seu atendimento, preencha este formulário: " + window.location.origin + "/onboarding/publico#token=" + encodeURIComponent(r.token) + "\nOs dados chegam diretamente ao nosso atendimento. Se preferir, pode responder por aqui." };
  }} />;
  return <section aria-label="Propostas e contratação" className="lead-journey">
    {conversaInformada && <p className="onboarding-help">{nomeDaOportunidade(o)}</p>}
    {jornada.contratacao?.ganha && !jornada.encerrado && <p role="status">Ganha · contratação confirmada. {servicoAvulso ? 'O serviço avulso segue seu acompanhamento de execução e entrega.' : <>Confira os requisitos de execução e implantação; {jornada.contratacao.carteiraPermitida ? 'a entrada na carteira está disponível após conferir o cadastro definitivo.' : 'a entrada na carteira depende da conferência dos requisitos cadastrais e contratuais.'}</>}</p>}
    {jornada.contratacao?.pagamentoFuturo && !jornada.contratacao?.ganha && <p role="status">Pagamento futuro contratado · recebimento pendente. A carteira não comprova Ganha ou implantação concluída.</p>}
    {o.status === 'CONVERTIDO' && jornada.comandosPermitidos?.conferirPagamento && !jornada.pagamento && <fieldset className="lead-actions" disabled={ocupado || Boolean(erroLeitura)} aria-label="Recebimento após entrada na carteira"><PagamentoComercialSimples somenteRecebimento api={api} estado={estado} jornada={jornada} ocupado={ocupado || Boolean(erroLeitura)} acao={acao} executar={executar} /></fieldset>}
    {jornada.contratacao?.execucaoIndependePagamento && !jornada.encerrado && <p className="onboarding-help">Execução depende dos dados e requisitos de cada atividade, sem exigir pagamento ou fim da coleta. Abertura deve ter constituição comprovada antes da implantação.</p>}
    {jornada.contratacao?.externa && <details><summary>Contratação externa registrada</summary><p>{jornada.contratacao.externa.justificativa}</p><p>{jornada.contratacao.externa.evidencia}</p><p>Registrada por {jornada.contratacao.externa.atorId} em {jornada.contratacao.externa.registradaEm}</p></details>}
    {erro && <p role="alert">{erro}</p>}
    {erroLeitura && <p role="alert">Não foi possível atualizar o atendimento. {erroLeitura} <Button variant="secondary" onClick={() => carregar().catch(() => {})}>Atualizar atendimento</Button></p>}
    {jornada.encerrado ? <><p role="status">{({ CONVERTIDO: jornada.contratacao?.politica ? (jornada.contratacao.ganha ? 'Ganha · na carteira' : 'Na carteira · recebimento pendente') : 'Na carteira · implantação em acompanhamento', CONCLUIDO_AVULSO: 'Serviço avulso concluído', DESISTIU: 'Atendimento encerrado por desistência' })[o.status] || 'Solicitação encerrada'}. O histórico está preservado.</p>{o.status === "CONCLUIDO_AVULSO" && jornada.abertura && <FichaAvulsa api={api} onboarding={o} somenteLeitura />}</> : <>
    <ProgressoDoLead jornada={jornada} selecionado={passo} onSelecionar={setPassoEscolhido} ocupado={ocupado} />
    {etapa && passo !== "conclusao" && <header className="lead-current-step">
      <div className="lead-step-meta"><span>{passo === jornada.atual ? "Etapa atual" : etapa.concluido ? "Etapa concluída" : "Etapa selecionada"}</span><small>Passo {jornada.passos.indexOf(etapa) + 1} de {jornada.passos.length}</small></div>
      <h4 ref={tituloRef} tabIndex={-1}>{etapa.titulo}</h4><details className="lead-step-help"><summary>Orientações da etapa</summary><p>{etapa.instrucao}</p></details>
    </header>}
    {!conversaInformada && <div hidden={!["autorizacao", "devolutiva", "proposta", "contrato", "pagamento", "conclusao"].includes(passo)}><DestinoComercialSimples api={api} conversaId={estado.atendimento?.conversaId} contexto={contextoDestino} disabled={ocupado || Boolean(erroLeitura)} onPreparado={setDestinoFicha} /></div>}
    <fieldset disabled={ocupado} className="lead-actions">
      {["cadastro", "autorizacao", "fiscal", "devolutiva", "proposta", "contrato", "pagamento"].includes(passo) && canalDeEnvio}
      {jornada.passos.filter(p => p.acessivel && (p.id === passo || visitados.includes(p.id))).map(({ id: passoDaSecao }) => {
      const selecionado = passoDaSecao === etapa?.id;
      const passo = passoDaSecao;
      return <fieldset key={passo} hidden={!selecionado} disabled={!selecionado || ocupado || Boolean(erroLeitura)} className="lead-actions">
      <div className="lead-stage-action">
      {passo === "cadastro" && <><details><summary>Enviar formulário</summary>{formulario}<p>Gerar outro formulário substitui o link anterior. O envio do link não conclui a coleta.</p></details><CamposDaEtapa sempreAberto onboarding={o} campos={pessoaFisica ? ["responsavelNome", "responsavelCpf", "responsavelEmail", "responsavelTelefone", "servicoSolicitado"] : ["responsavelNome", "atividadePretendida", "enderecoAbertura"]} ocupado={ocupado} onSalvar={b => acao("/campos", b)} /></>}
      {passo === "publica" && <CadastroComercialSimples key={onboardingId} api={api} onboarding={o} ocupado={ocupado} acao={acao} onAtualizar={atualizarAposAcao} />}
      {passo === "autorizacao" && <ProcuracaoSimples key={onboardingId + o.cnpj} api={api} recursos={recursos} estado={estado} conversaId={conversaId} ocupado={ocupado} carregar={atualizarAposAcao} acao={acao} trabalho={trabalho("PROCURACAO")} />}
      {passo === "fiscal" && <SituacaoFiscalSimples estado={estado} ocupado={ocupado} acao={acao} trabalho={trabalho("SITFIS")} />}
      {passo === "diagnostico" && <>
        {estado.jornada?.fiscalAlternativa ? <p role="status">{estado.jornada.fiscalAlternativa.dados?.limitacao || 'Situação fiscal sem consulta oficial válida.'}</p> : !["ABERTURA", "PESSOA_FISICA"].includes(o.origem) && <AnaliseDoLead api={api} onboarding={o} tipo="SITFIS" onAtualizar={atualizarAposAcao} conversaId={conversaId} />}
        <DiagnosticoDoLead sempreAberto key={onboardingId} jornada={estado.jornada} onboarding={o} ocupado={ocupado} onSalvarDados={b => acao("/campos", b)} onSalvar={b => acao("/jornada/diagnostico", b)} />
      </>}
      {passo === "devolutiva" && <ApresentacaoSimples key={onboardingId} api={api} estado={estado} conversaId={conversaId} podeEnviar={podeEnviar} ocupado={ocupado} executar={executar} />}
      {passo === "proposta" && <>
        {jornada.proposta ? <details><summary>Dados para o orçamento</summary>{camposOrcamento}</details> : camposOrcamento}
        {estado.jornada?.diagnostico && <p>Escopo conferido: {estado.jornada.diagnostico.dados.servicos}</p>}
        {jornada.proposta?.status !== "ACEITA" && (jornada.proposta?.snapshot?.pendencias?.length ? <>
          <div role="alert"><strong>Esta proposta ainda precisa de correção</strong><ul>{jornada.proposta.snapshot.pendencias.map(p => <li key={p}>{p}</li>)}</ul><p>Corrija abaixo e gere uma nova versão para revisar e aprovar.</p></div>
          <ValoresDaProposta key={jornada.proposta.id} onboarding={o} anterior={jornada.proposta} escopo={estado.jornada?.diagnostico?.dados.servicos} regularizacao={estado.jornada?.diagnostico?.dados.regularizacao} correcao onGerar={ajustes => acao("/propostas", { versao: o.versao, ajustes })} />
        </> : <details key={estado.propostas[0]?.id || "nova-proposta"}><summary>Preparar uma nova proposta em PDF</summary><ValoresDaProposta onboarding={o} anterior={jornada.proposta} escopo={estado.jornada?.diagnostico?.dados.servicos} regularizacao={estado.jornada?.diagnostico?.dados.regularizacao} onGerar={ajustes => acao("/propostas", { versao: o.versao, ajustes })} /></details>)}
      {estado.propostas.filter(p => p.id === jornada.proposta?.id).map(p => <article key={p.id} style={{
        paddingBlock: 16,
        borderBottom: "1px solid var(--border)"
      }}><strong>Proposta {p.versao} · {p.revogadaEm ? "Substituída" : textoComercial(p.status)}</strong><OpcoesProposta proposta={p.snapshot} />{api.baixarPropostaComercial && !p.revogadaEm && <Button variant="secondary" onClick={() => executar(async () => { const url = URL.createObjectURL(await api.baixarPropostaComercial(onboardingId, p.id)); const a = document.createElement("a"); a.href = url; a.download = "proposta-altan.pdf"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); })}>Baixar proposta em PDF</Button>}{!p.revogadaEm && <div style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap"
        }}>{p.status === "APROVADA" && estado.atendimento && <Button disabled={!podeEnviar} onClick={() => acao(`/propostas/${p.id}/enviar`, { conversaId })}>Assumir e enviar PDF da proposta no WhatsApp</Button>}{p.status === "RASCUNHO" && <Button disabled={Boolean(p.snapshot.pendencias?.length)} onClick={() => acao(`/propostas/${p.id}/aprovar`)}>Aprovar esta versão</Button>}{["APROVADA", "ENVIADA"].includes(p.status) && <Button variant="secondary" onClick={() => executar(async () => {
            const r = await api.comercial(base + `/propostas/${p.id}/link`, {});
            setLink(`${window.location.origin}/proposta/publica#token=${encodeURIComponent(r.token)}`);
          })}>Gerar link da proposta</Button>}{p.status === "ACEITA" && <Button onClick={() => setPassoEscolhido("contrato")}>Preparar contrato da opção aceita</Button>}</div>}</article>)}
      {link && <label>Link pessoal da proposta — envie pela conversa<input style={campoComercial} value={link} readOnly onFocus={e => e.target.select()} /></label>}

      </>}
      {passo === "contrato" && <>

        <section aria-label="Contrato">
        {estado.propostas.filter(p => p.id === jornada.proposta?.id && p.status === "ACEITA" && !p.revogadaEm && !estado.contratos.some(c => c.propostaId === p.id)).map(p => <FormularioContrato key={onboardingId + ":" + p.id} onboarding={o} proposta={p} recursos={recursos} onGerar={body => acao(`/propostas/${p.id}/contrato`, body)} />)}
        {contratosAtuais.map(c => <article key={c.id}><strong>Contrato · {textoComercial(c.status)}</strong><pre style={{
            whiteSpace: "pre-wrap",
            font: "inherit",
            maxHeight: 360,
            overflow: "auto"
          }}>{c.texto}</pre>{c.dados?.condicaoPagamento && <p>Condição para conferência neste contrato: entrada na carteira antes do recebimento, com vencimento em {c.dados.condicaoPagamento.vencimento}. Não confirma pagamento.</p>}<Button variant="secondary" onClick={() => executar(async () => {
            const url = URL.createObjectURL(await api.baixarContratoComercial(onboardingId, c.id));
            const a = document.createElement("a");
            a.href = url;
            a.download = "contrato-altan.pdf";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          })}>Baixar contrato em PDF</Button><Button variant="secondary" onClick={() => executar(async () => { const url = URL.createObjectURL(await api.baixarContratoComercial(onboardingId, c.id)); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60000); })}>Pré-visualizar PDF</Button>{c.status !== "MINUTA" && <EnviarContratoSimples api={api} onboardingId={onboardingId} contrato={c} conversaId={conversaId} podeEnviar={podeEnviar} ocupado={ocupado} executar={executar} />}{c.status === "MINUTA" && <Button onClick={() => acao(`/contratos/${c.id}/aprovar`)}>Aprovar contrato</Button>}</article>)}
        <details><summary>Registrar assinatura (opcional)</summary><label>Anexar contrato assinado ou documento (PDF, até 5 MB)<input style={campoComercial} type="file" accept="application/pdf" onChange={e => {
            const f = e.target.files?.[0];
            if (f) executar(async () => {
              const r = await api.documentoComercial(onboardingId, f);
              setDocumentoId(r.documento.id);
            });
          }} /></label><label>Documento para conferência<select style={campoComercial} value={documentoId} onChange={e => setDocumentoId(e.target.value)}><option value="">Selecione</option>{estado.documentos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}</select></label><p>O contrato usa o modelo aprovado e os valores da opção aceita. Confira o PDF antes de enviar. Alterações posteriores ao aceite exigem nova contratação ou aditivo.</p><p>A anexação não confirma a assinatura. Abra e confira o documento antes de registrar a conferência.</p>
        {documentoId && <Button variant="secondary" onClick={() => executar(async () => {
          const blob = await api.baixarDocumentoComercial(onboardingId, documentoId);
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank", "noopener");
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        })}>Abrir PDF para conferir</Button>}{contratosAtuais.filter(c => c.status === "AGUARDANDO_ASSINATURA").map(c => <Button key={c.id} variant="secondary" disabled={!documentoId} onClick={() => acao(`/contratos/${c.id}/assinatura`, { documentoId })}>Conferi as assinaturas no PDF selecionado</Button>)}</details>
      </section>

      </>}
      {passo === "pagamento" && <PagamentoComercialSimples key={contratoAtualId} api={api} estado={estado} jornada={jornada} conversaId={conversaId} ocupado={ocupado} acao={acao} executar={executar} />}
      {passo === "conclusao" && <><FichaDocumentosSimples api={api} estado={estado} conversaId={conversaId} ocupado={ocupado} acao={acao} executar={executar} formulario={formulario} /><div role="status"><h4 ref={selecionado ? tituloRef : undefined} tabIndex={-1}>{tituloExecucao}</h4><p>{servicoAvulso ? "Acompanhe a execução do serviço e registre a evidência após a entrega ao cliente." : "Confira os requisitos e acompanhe a execução nesta solicitação. A entrada na carteira não conclui a implantação."}</p>{onAbrirExecucao ? <Button onClick={onAbrirExecucao}>Abrir {tituloExecucao.toLowerCase()}</Button> : <a className="btn btn-primary btn-md" href={"/onboardings/" + encodeURIComponent(onboardingId) + "#implantacao"}>Abrir {tituloExecucao.toLowerCase()}</a>}</div>{jornada.contrato?.dados?.opcao?.recorrente === false && <>{jornada.abertura && <FichaAvulsa api={api} onboarding={o} onSalvo={atualizarAposAcao} />}<details><summary>Encerrar serviço avulso após a entrega</summary><p>Use somente quando o serviço contratado já tiver sido executado e entregue ao cliente.</p><label>Evidência da entrega<textarea maxLength={2000} rows={3} value={evidenciaEntrega} onChange={e => setEvidenciaEntrega(e.target.value)} /></label><Button disabled={evidenciaEntrega.trim().length < 10} onClick={() => acao("/concluir-avulso", { evidencia: evidenciaEntrega })}>Conferi a entrega: concluir serviço avulso</Button></details></>}</>}
      </div>
      </fieldset>; })}
    </fieldset>
    {etapa && jornada.passos.indexOf(etapa) > 0 && <Button variant="secondary" onClick={() => setPassoEscolhido(jornada.passos[jornada.passos.indexOf(etapa) - 1].id)}>Voltar</Button>}
    {etapa && passo !== jornada.atual && <Button variant="secondary" onClick={() => setPassoEscolhido(null)}>Continuar da etapa atual</Button>}
    </>}
  </section>;
}
