import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { CampoOnboarding } from "./CampoOnboarding";
import { camposDaOrigem } from "../lib/onboardingSpec";
import { AbrirBiblioteca } from "./AbrirBiblioteca";
import { AutorizacaoDoLead } from "./AutorizacaoDoLead";
import { AnaliseDoLead } from "./AnaliseDoLead";
export const campoComercial = {
  width: "100%",
  padding: 8,
  marginBlock: 5,
  background: "var(--bg-subtle)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 5
};
export const reais = c => c == null ? "A confirmar" : (c / 100).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL"
});
export function OpcoesProposta({
  proposta
}) {
  return <><div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 12
    }}>{proposta.opcoes?.map(o => <article key={o.chave} style={{
        flex: "1 1 220px",
        padding: 14,
        border: "1px solid var(--border)",
        borderRadius: 8
      }}><strong>{o.titulo}</strong><p>{o.recorrente ? `${reais(o.mensalCentavos)}/mês${o.unicoCentavos !== 0 ? ` + ${reais(o.unicoCentavos)} pelo serviço inicial` : ""}` : `${reais(o.unicoCentavos)} pelo serviço`}</p><p>{o.escopo}</p></article>)}</div><p>Regularização: {proposta.regularizacaoCentavos == null ? "orçamento separado, quando necessária" : reais(proposta.regularizacaoCentavos)} · Taxas públicas: {reais(proposta.taxasCentavos)}{proposta.taxasConfirmadas ? " (confirmadas)" : " (a conferir)"}</p><p style={{
      whiteSpace: "pre-wrap"
    }}>{proposta.condicoes}</p></>;
}

import { FichaAvulsa } from "./FichaAvulsa";
import { AcoesDaEtapa } from "./AcoesDaEtapa";
import { ConferenciaPublicaManual } from "./ConferenciaPublicaManual";
import { DevolutivaDoLead } from "./DevolutivaDoLead";
import { montarJornada } from "../lib/jornadaComercial";
import { ProgressoDoLead, CamposDaEtapa, DiagnosticoDoLead, MensagemDoPasso, OrientacaoDoPasso } from "./PassosDoLead";

export function FluxoComercial({ api, onboardingId, conversaId: conversaInformada, janela = null, canalDisponivel = true, canalDeEnvio = null }) {
  const [estado, setEstado] = useState(null), [recursos, setRecursos] = useState([]), [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false), [passoEscolhido, setPassoEscolhido] = useState(null), [link, setLink] = useState("");
  const [ajustes, setAjustes] = useState({}), [justificativa, setJustificativa] = useState("");
  const [modeloId, setModeloId] = useState(""), [vars, setVars] = useState({}), [documentoId, setDocumentoId] = useState("");
  const [campoEdicao, setCampoEdicao] = useState(""), [valorCampo, setValorCampo] = useState("");
  const [evidenciaPagamento, setEvidenciaPagamento] = useState(""), [linkPagamento, setLinkPagamento] = useState("");
  const [evidenciaEntrega, setEvidenciaEntrega] = useState("");
  const trava = useRef(false), vivo = useRef(false), pedido = useRef(0), carregando = useRef(false), tituloRef = useRef(null);
  const base = "/onboardings/" + encodeURIComponent(onboardingId);
  const carregar = useCallback(async () => {
    const n = ++pedido.current; carregando.current = true;
    try {
      const [e, r] = await Promise.all([api.comercial(base), api.comercial("/recursos")]);
      if (vivo.current && n === pedido.current) { setEstado(e); setRecursos(r.recursos || []); }
    } finally { if (n === pedido.current) carregando.current = false; }
  }, [api, base]);
  useEffect(() => {
    vivo.current = true; setEstado(null); setPassoEscolhido(null);
    carregar().catch(e => { if (vivo.current) setErro(e.message); });
    return () => { vivo.current = false; pedido.current++; };
  }, [carregar]);
  // Somente lê resultados salvos: nenhuma consulta fiscal ou geração de IA no polling.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden" && !trava.current && !carregando.current) carregar().catch(e => { if (vivo.current) setErro(e.message); });
    }, 10000);
    return () => clearInterval(timer);
  }, [carregar]);
  async function executar(fn) {
    if (trava.current) return false;
    trava.current = true; setOcupado(true); setErro("");
    try { await fn(); await carregar(); if (vivo.current) setPassoEscolhido(null); return true; }
    catch (e) { if (vivo.current) { setErro(e.message); await carregar().catch(() => {}); } return false; }
    finally { trava.current = false; if (vivo.current) setOcupado(false); }
  }
  const acao = (path, body = {}) => executar(() => api.comercial(base + path, body));
  const baseJornada = estado ? { ...montarJornada(estado), ...(estado.jornada?.projecao || {}) } : null;
  const jornada = baseJornada ? { ...baseJornada, passos: [...baseJornada.passos, { id: "conclusao", titulo: "Ficha e documentos da empresa", concluido: baseJornada.encerrado, acessivel: baseJornada.atual === "conclusao", pendencias: [] }] } : null;
  const passo = jornada && (jornada.passos.some(p => p.id === passoEscolhido && p.acessivel) ? passoEscolhido : jornada.atual);
  useEffect(() => { if (passo) tituloRef.current?.focus({ preventScroll: true }); }, [passo]);
  if (!api.comercial) return <p>Fluxo comercial disponível com a API atualizada.</p>;
  if (!estado) return <section aria-label="Propostas e contratação">{erro ? <p role="alert">{erro}</p> : <p role="status">Carregando passo a passo…</p>}<Button onClick={() => executar(async () => {})}>Recarregar atendimento</Button></section>;
  // O chat informa o destino conferido. A ficha isolada não reaproveita o canal antigo do caso.
  const conversaId = conversaInformada || null;
  const podeEnviar = Boolean(conversaId && canalDisponivel && (!janela || janela.situacao === "ABERTA"));
  const modelos = recursos.filter(r => r.tipo === "CONTRATO" && r.aprovadoEm), modelo = modelos.find(r => r.id === modeloId);
  const marcadores = [...new Set([...(modelo?.texto || "").matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))].filter(k => !["servico", "honorarios", "condicoes"].includes(k));
  const o = estado.onboarding, d = o.dados || {};
  const contratosAtuais = estado.contratos.filter(c => c.propostaId === jornada.proposta?.id);
  const varsCadastro = { nome: o.responsavelNome || d.responsavelNome || "", cnpj: o.cnpj || "", contratante: o.razaoSocial || d.razaoSocial || "", email: o.responsavelEmail || d.responsavelEmail || "", cpf: d.responsavelCpf || "", endereco: d.endereco || d.enderecoPretendido || "" };
  const campos = camposDaOrigem(o.origem), descritor = campos.find(c => c.campo === campoEdicao);
  const etapa = jornada.passos.find(p => p.id === passo);
  const trabalho = tipo => estado.trabalhos?.find(t => t.tipo === tipo && t.cnpj === o.cnpj);
  const emConsulta = tipo => ["PENDENTE", "PROCESSANDO", "AGUARDANDO"].includes(trabalho(tipo)?.status);
  const camposOrcamento = <CamposDaEtapa sempreAberto onboarding={o} campos={["responsavelNome", "responsavelEmail", "modalidadeServico", jornada.abertura ? "regimePretendido" : "regimeAtual", "qtdFuncionarios", "notasRecebidasMes", "consultoriaMensal"]} ocupado={ocupado} onSalvar={b => acao("/campos", b)} />;
  const formulario = <MensagemDoPasso api={api} conversaId={conversaId} disabled={ocupado} onEnviado={carregar} rotulo={"Preparar formulário de " + jornada.nome.toLowerCase()} preparar={async () => {
    const r = await api.criarLinkOnboarding(onboardingId, { diasValidade: 7 });
    if (!r.token) throw new Error("Não foi possível confirmar o link.");
    return { texto: "Para continuarmos com seu atendimento, preencha este formulário: " + window.location.origin + "/onboarding/publico#token=" + encodeURIComponent(r.token) + "\nOs dados chegam diretamente ao nosso atendimento. Se preferir, pode responder por aqui." };
  }} />;
  return <section aria-label="Propostas e contratação" className="lead-journey">
    {erro && <p role="alert">{erro}</p>}
    {jornada.encerrado ? <><p role="status">Solicitação encerrada. O histórico está preservado; inicie outra solicitação para um novo serviço.</p>{o.status === "CONCLUIDO_AVULSO" && jornada.abertura && <FichaAvulsa api={api} onboarding={o} somenteLeitura />}</> : <>
    <ProgressoDoLead jornada={jornada} selecionado={passo} onSelecionar={setPassoEscolhido} ocupado={ocupado} />
    {etapa && passo !== "conclusao" && <header className="lead-current-step">
      <div className="lead-step-meta"><span>{passo === jornada.atual ? "Etapa atual" : etapa.concluido ? "Etapa concluída" : "Histórico do atendimento"}</span><small>Passo {jornada.passos.indexOf(etapa) + 1} de {jornada.passos.length}</small></div>
      <h4 ref={tituloRef} tabIndex={-1}>{etapa.titulo}</h4><p>{etapa.instrucao}</p>
    </header>}
    <fieldset disabled={ocupado} className="lead-actions">
      {["cadastro", "autorizacao", "devolutiva", "proposta", "contrato", "pagamento"].includes(passo) && canalDeEnvio}
      <AcoesDaEtapa key={passo + (passo === "proposta" ? ":" + (estado.propostas[0]?.id || "nova") : "")} tituloPrincipal={({ cadastro: "Preencher dados", publica: "Consultar CNPJ", autorizacao: "Verificar procuração", fiscal: "Consultar situação fiscal", proposta: "Dados e proposta", contrato: "Orientar assinatura" })[passo] || "Ação da etapa"} preferirAlternativa={passo === "contrato"}>
      {["autorizacao", "fiscal"].includes(passo) && jornada.comandosPermitidos?.diagnosticoLimitado && <details><summary>Continuar sem consulta automática</summary><p>Use quando o escopo puder ser definido com os dados públicos conferidos. Registre expressamente o que não foi consultado.</p><DiagnosticoDoLead sempreAberto limitado jornada={estado.jornada} onboarding={o} ocupado={ocupado} onSalvar={b => acao("/jornada/diagnostico", b)} /></details>}
      {passo === "cadastro" && <><details><summary>Enviar formulário</summary>{formulario}<p>Gerar outro formulário substitui o link anterior. O envio do link não conclui a coleta.</p></details><CamposDaEtapa sempreAberto onboarding={o} campos={["responsavelNome", "atividadePretendida", "municipioAtendimento", "enderecoPretendido"]} ocupado={ocupado} onSalvar={b => acao("/campos", b)} /></>}
      {passo === "publica" && <><AnaliseDoLead key={onboardingId} api={api} onboarding={o} onAtualizar={carregar} tipo="PUBLICA" />{jornada.publica && <Button onClick={() => acao("/jornada/conferencia", { versao: o.versao, tipo: "PUBLICA", analiseId: jornada.publica.id })}>Conferi os dados do CNPJ: continuar</Button>}<details><summary>Conferir manualmente</summary><ConferenciaPublicaManual onboarding={o} ocupado={ocupado} acao={acao} /></details><details><summary>Enviar formulário complementar</summary>{formulario}</details></>}
      {passo === "autorizacao" && <AutorizacaoDoLead key={onboardingId + o.cnpj} api={api} recursos={recursos} estado={estado} conversaId={conversaId} ocupado={ocupado} carregar={carregar} acao={acao} trabalho={trabalho("PROCURACAO")} />}
      {passo === "fiscal" && <>{estado.configuracao?.consultasFiscais === false && <p role="alert">A integração fiscal de leads precisa ser habilitada para continuar.</p>}<Button disabled={emConsulta("SITFIS") || estado.configuracao?.consultasFiscais === false} onClick={() => acao("/consultas", { tipo: "SITFIS" })}>{emConsulta("SITFIS") ? "Aguardando consulta fiscal…" : "Solicitar situação fiscal"}</Button>{trabalho("SITFIS") && <p role="status">{trabalho("SITFIS").status} · {trabalho("SITFIS").resultado?.mensagem}</p>}<AnaliseDoLead key={onboardingId} api={api} onboarding={o} onAtualizar={carregar} tipo="SITFIS" />{jornada.fiscal && <Button onClick={() => acao("/jornada/conferencia", { versao: o.versao, tipo: "SITFIS", analiseId: jornada.fiscal.id })}>Conferi o relatório fiscal: continuar</Button>}</>}
      {passo === "diagnostico" && <DiagnosticoDoLead sempreAberto key={estado.jornada?.diagnostico?.id || "novo"} jornada={estado.jornada} onboarding={o} ocupado={ocupado} onSalvar={b => acao("/jornada/diagnostico", b)} />}
      {passo === "devolutiva" && <DevolutivaDoLead key={estado.jornada?.diagnostico?.id} api={api} estado={estado} conversaId={conversaId} janela={janela} canalDisponivel={canalDisponivel} ocupado={ocupado} acao={acao} executar={executar} />}
      {passo === "proposta" && <>
        {jornada.proposta ? <details><summary>Dados para o orçamento</summary>{camposOrcamento}</details> : camposOrcamento}
        {estado.jornada?.diagnostico && <p>Escopo conferido: {estado.jornada.diagnostico.dados.servicos}</p>}
        <details key={estado.propostas[0]?.id || "nova-proposta"}><summary>Preparar uma nova proposta em PDF</summary><p>A mensalidade é calculada pelo catálogo aprovado. Você pode ajustar honorários, serviços e taxas antes do aceite, informando a justificativa. Após o aceite, os valores contratados ficam preservados.</p>{[["aberturaCentavos", "Abertura"], ["servicoCentavos", "Outro serviço avulso"], ["mensalCentavos", "Mensalidade personalizada"], ["regularizacaoCentavos", "Regularização"], ["taxasCentavos", "Taxas públicas"]].map(([k, nome]) => <label key={k}>{nome} (R$)<input style={campoComercial} inputMode="decimal" value={ajustes[k] || ""} onChange={e => setAjustes({
            ...ajustes,
            [k]: e.target.value
          })} /></label>)}<label>Fonte, escopo e justificativa dos ajustes<textarea style={campoComercial} value={justificativa} onChange={e => setJustificativa(e.target.value)} /></label><Button onClick={() => executar(async () => {
          const valores = {};
          for (const [k, v] of Object.entries(ajustes)) {
            if (!v.trim()) continue;
            if (!/^\d+(,\d{1,2})?$/.test(v)) throw new Error("Informe valores sem milhar, usando vírgula para centavos.");
            valores[k] = Math.round(Number(v.replace(",", ".")) * 100);
          }
          await api.comercial(base + "/propostas", {
            versao: estado.onboarding.versao,
            ajustes: {
              ...valores,
              justificativa,
              escopoAvulso: estado.jornada?.diagnostico?.dados.servicos || justificativa
            }
          });
        })}>Gerar proposta para revisão</Button></details>
      {estado.propostas.filter(p => p.id === jornada.proposta?.id).map(p => <article key={p.id} style={{
        paddingBlock: 16,
        borderBottom: "1px solid var(--border)"
      }}><strong>Proposta {p.versao} · {p.revogadaEm ? "Substituída" : p.status}</strong><OpcoesProposta proposta={p.snapshot} />{api.baixarPropostaComercial && !p.revogadaEm && <Button variant="secondary" onClick={() => executar(async () => { const url = URL.createObjectURL(await api.baixarPropostaComercial(onboardingId, p.id)); const a = document.createElement("a"); a.href = url; a.download = "proposta-altan.pdf"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); })}>Baixar proposta em PDF</Button>}{p.snapshot.pendencias?.length > 0 && <ul>{p.snapshot.pendencias.map(x => <li key={x}>{x}</li>)}</ul>}{!p.revogadaEm && <div style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap"
        }}>{p.status === "APROVADA" && estado.atendimento && <Button disabled={!podeEnviar} onClick={() => acao(`/propostas/${p.id}/enviar`, { conversaId })}>Assumir e enviar PDF da proposta no WhatsApp</Button>}{p.status === "RASCUNHO" && <Button onClick={() => acao(`/propostas/${p.id}/aprovar`)}>Aprovar esta versão</Button>}{["APROVADA", "ENVIADA"].includes(p.status) && <Button variant="secondary" onClick={() => executar(async () => {
            const r = await api.comercial(base + `/propostas/${p.id}/link`, {});
            setLink(`${window.location.origin}/proposta/publica#token=${encodeURIComponent(r.token)}`);
          })}>Gerar link da proposta</Button>}{p.status === "ACEITA" && <Button onClick={() => setPassoEscolhido("contrato")}>Preparar contrato da opção aceita</Button>}</div>}</article>)}
      {link && <label>Link pessoal da proposta — envie pela conversa<input style={campoComercial} value={link} readOnly onFocus={e => e.target.select()} /></label>}

      </>}
      {passo === "contrato" && <>
        {!modelos.length && <p role="status">Cadastre e aprove um modelo na biblioteca para preparar o contrato.</p>}
        <OrientacaoDoPasso api={api} recursos={recursos} chaves={["assinatura-govbr"]} onboarding={o} conversaId={conversaId} onEnviado={carregar} disabled={ocupado} />
        <details key={contratosAtuais.map(c => c.id + c.status).join(":")}><summary>{contratosAtuais.length ? "Conferir contrato e assinatura" : "Preparar contrato"}</summary><label>Modelo aprovado<select style={campoComercial} value={modeloId} onChange={e => {
            setModeloId(e.target.value);
            setVars({});
          }}><option value="">Selecione o modelo</option>{modelos.map(m => <option key={m.id} value={m.id}>{m.titulo} · v{m.versao}</option>)}</select></label>{marcadores.map(k => <label key={k}>{k}<input style={campoComercial} value={vars[k] ?? varsCadastro[k] ?? ""} onChange={e => setVars({
            ...vars,
            [k]: e.target.value
          })} /></label>)}
        {estado.propostas.filter(p => p.status === "ACEITA" && !p.revogadaEm && !estado.contratos.some(c => c.propostaId === p.id)).map(p => <p key={p.id}><Button disabled={!modeloId} onClick={() => acao(`/propostas/${p.id}/contrato`, { modeloId, variaveis: { ...varsCadastro, ...vars } })}>Gerar contrato da opção aceita</Button></p>)}
        {contratosAtuais.map(c => <article key={c.id}><strong>Contrato · {c.status}</strong><pre style={{
            whiteSpace: "pre-wrap",
            font: "inherit",
            maxHeight: 360,
            overflow: "auto"
          }}>{c.texto}</pre><Button variant="secondary" onClick={() => executar(async () => {
            const url = URL.createObjectURL(await api.baixarContratoComercial(onboardingId, c.id));
            const a = document.createElement("a");
            a.href = url;
            a.download = "contrato-altan.pdf";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          })}>Baixar contrato em PDF</Button>{conversaId && c.status !== "MINUTA" && api.enviarAnexoWhatsapp && <Button disabled={!podeEnviar} onClick={() => executar(async () => { const pdf = await api.baixarContratoComercial(onboardingId, c.id); await api.enviarAnexoWhatsapp(conversaId, new File([pdf], "contrato-altan.pdf", { type: "application/pdf" }), "Contrato de prestação de serviços para assinatura"); })}>Enviar contrato no WhatsApp</Button>}{c.status === "MINUTA" && <Button onClick={() => acao(`/contratos/${c.id}/aprovar`)}>Conferi a minuta: liberar para assinatura</Button>}{c.status === "AGUARDANDO_ASSINATURA" && <Button disabled={!documentoId} onClick={() => acao(`/contratos/${c.id}/assinatura`, {
            documentoId
          })}>Conferi as assinaturas no PDF selecionado</Button>}</article>)}
        <label>Anexar contrato assinado ou documento (PDF, até 5 MB)<input style={campoComercial} type="file" accept="application/pdf" onChange={e => {
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
        })}>Abrir PDF para conferir</Button>}
      </details>

      </>}
      {passo === "pagamento" && <><details><summary>Registrar conferência do pagamento</summary><p>Contrato com assinatura conferida. Registre o pagamento somente depois de verificar o comprovante.</p><label>Evidência do pagamento deste contrato<textarea rows={3} value={evidenciaPagamento} onChange={e => setEvidenciaPagamento(e.target.value)} /></label><Button disabled={evidenciaPagamento.trim().length < 10} onClick={() => acao("/jornada/pagamento", { contratoId: jornada.contrato.id, evidencia: evidenciaPagamento })}>Conferi o pagamento deste contrato</Button></details><details><summary>Enviar um link de cobrança já criada</summary><p>A criação automática da cobrança será integrada depois.</p><label>Link da cobrança Asaas<input type="url" value={linkPagamento} onChange={e => setLinkPagamento(e.target.value)} /></label><MensagemDoPasso key={linkPagamento} api={api} conversaId={conversaId} rotulo="Preparar link de pagamento" disabled={!linkPagamento} preparar={async () => { const u = new URL(linkPagamento); if (u.protocol !== "https:" || !(u.hostname === "asaas.com" || u.hostname.endsWith(".asaas.com"))) throw new Error("Informe o link HTTPS da cobrança emitida no Asaas."); return { texto: "Segue o link para pagamento dos serviços contratados: " + u.href }; }} /></details></>}
      {passo === "conclusao" && <><div role="status"><h4 ref={tituloRef} tabIndex={-1}>Atendimento comercial concluído</h4><p>A proposta foi aceita, a assinatura foi conferida e o pagamento deste contrato foi registrado.</p><a href={"/onboardings/" + encodeURIComponent(onboardingId)}>Continuar a execução do serviço no onboarding →</a></div>{jornada.contrato?.dados?.opcao?.recorrente === false && <>{jornada.abertura && <FichaAvulsa api={api} onboarding={o} onSalvo={carregar} />}<details><summary>Encerrar serviço avulso após a entrega</summary><p>Use somente quando o serviço contratado já tiver sido executado e entregue ao cliente.</p><label>Evidência da entrega<textarea maxLength={2000} rows={3} value={evidenciaEntrega} onChange={e => setEvidenciaEntrega(e.target.value)} /></label><Button disabled={evidenciaEntrega.trim().length < 10} onClick={() => acao("/concluir-avulso", { evidencia: evidenciaEntrega })}>Conferi a entrega: concluir serviço avulso</Button></details></>}</>}
      </AcoesDaEtapa>
    </fieldset>
    {etapa && passo !== jornada.atual && <Button variant="secondary" onClick={() => setPassoEscolhido(null)}>Continuar da etapa atual</Button>}
    </>}
    <section className="lead-support" aria-label="Dados capturados"><h4>Dados capturados</h4><dl>{Object.entries(estado.onboarding.dados || {}).map(([k, v]) => <div key={k}><dt>{campos.find(c => c.campo === k)?.rotulo || k}</dt><dd>{typeof v === "boolean" ? v ? "Sim" : "Não" : typeof v === "object" ? JSON.stringify(v) : String(v)} · {estado.onboarding.fontesDados?.[k]?.conferido ? "Conferido pelo escritório" : "A conferir"}</dd></div>)}</dl>
        <label>Corrigir campo<select style={campoComercial} value={campoEdicao} onChange={e => {
            setCampoEdicao(e.target.value);
            setValorCampo(estado.onboarding.dados?.[e.target.value] ?? "");
          }}><option value="">Selecione</option>{campos.map(d => <option key={d.campo} value={d.campo}>{d.rotulo}</option>)}</select></label>
        {descritor && <><CampoOnboarding descritor={descritor} dados={estado.onboarding.dados} valor={valorCampo} onChange={setValorCampo} /><Button onClick={() => acao("/campos", {
            versao: estado.onboarding.versao,
            operacoes: [{
              campo: campoEdicao,
              acao: valorCampo === "" || valorCampo === null ? "unset" : "set",
              valor: ["inteiro", "moeda"].includes(descritor.tipo) && valorCampo !== "" ? Number(String(valorCampo).replace(",", ".")) : valorCampo
            }]
          })}>Conferir e salvar campo</Button></>}
        <p><a href={`/onboardings/${encodeURIComponent(onboardingId)}/editar`}>Abrir formulário interno completo</a></p>
      <AbrirBiblioteca />
    </section>
  </section>;
}
