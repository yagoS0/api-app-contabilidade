import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { CampoOnboarding } from "./CampoOnboarding";
import { camposDaOrigem } from "../lib/onboardingSpec";
import { RecursosComerciais } from "./RecursosComerciais";
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
      }}><strong>{o.titulo}</strong><p>{reais(o.unicoCentavos)} pelo serviço{o.recorrente ? ` + ${reais(o.mensalCentavos)}/mês` : ""}</p><p>{o.escopo}</p></article>)}</div><p>Regularização: {reais(proposta.regularizacaoCentavos)} · Taxas públicas: {reais(proposta.taxasCentavos)}{proposta.taxasConfirmadas ? " (confirmadas)" : " (a conferir)"}</p><p style={{
      whiteSpace: "pre-wrap"
    }}>{proposta.condicoes}</p></>;
}
export function FluxoComercial({
  api,
  onboardingId
}) {
  const [estado, setEstado] = useState(null),
    [recursos, setRecursos] = useState([]),
    [erro, setErro] = useState(""),
    [ocupado, setOcupado] = useState(false),
    [link, setLink] = useState("");
  const [ajustes, setAjustes] = useState({}),
    [justificativa, setJustificativa] = useState(""),
    [evidencia, setEvidencia] = useState(""),
    [entrega, setEntrega] = useState(""),
    [marco, setMarco] = useState("DOCUMENTACAO_CONFERIDA"),
    [evidenciaMarco, setEvidenciaMarco] = useState(""),
    [modeloId, setModeloId] = useState(""),
    [vars, setVars] = useState({}),
    [documentoId, setDocumentoId] = useState("");
  const [campoEdicao, setCampoEdicao] = useState(""),
    [valorCampo, setValorCampo] = useState("");
  const trava = useRef(false);
  const base = `/onboardings/${encodeURIComponent(onboardingId)}`;
  async function carregar() {
    const [e, r] = await Promise.all([api.comercial(base), api.comercial("/recursos")]);
    setEstado(e);
    setRecursos(r.recursos);
  }
  useEffect(() => {
    if (api.comercial) carregar().catch(e => setErro(e.message));
  }, [api, onboardingId]);
  async function executar(fn) {
    if (trava.current) return;
    trava.current = true;
    setOcupado(true);
    setErro("");
    try {
      await fn();
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }
  const acao = (path, body = {}) => executar(() => api.comercial(base + path, body));
  if (!api.comercial) return <p>Fluxo comercial disponível com a API atualizada.</p>;
  const modelos = recursos.filter(r => r.tipo === "CONTRATO" && r.aprovadoEm);
  const modelo = modelos.find(r => r.id === modeloId);
  const marcadores = [...new Set([...(modelo?.texto || "").matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))].filter(k => !["servico", "honorarios", "condicoes"].includes(k));
  const campos = estado ? camposDaOrigem(estado.onboarding.origem) : [];
  const descritor = campos.find(d => d.campo === campoEdicao);
  return <section aria-label="Propostas e contratação" style={{
    padding: 16,
    border: "1px solid var(--border)",
    borderRadius: 8,
    marginBlock: 16
  }}>
    <h3>Propostas e contratação</h3><p>Revise os dados coletados na conversa, confira o escopo e aprove a proposta. O aceite prepara o contrato; a assinatura é conferida separadamente.</p>
    {erro && <p role="alert">{erro}</p>}
    <Button variant="secondary" disabled={ocupado} onClick={() => executar(async () => {})}>Atualizar atendimento</Button>
    <RecursosComerciais api={api} recursos={recursos} onAtualizar={carregar} />
    {estado && <fieldset disabled={ocupado} style={{
      border: 0,
      padding: 0
    }}>
      <p><strong>{estado.onboarding.responsavelNome || "Nome a confirmar"}</strong> · {estado.onboarding.origem} · {estado.onboarding.status}</p>
      <details><summary>Conferir dados coletados na conversa</summary><dl>{Object.entries(estado.onboarding.dados || {}).map(([k, v]) => <div key={k}><dt>{campos.find(c => c.campo === k)?.rotulo || k}</dt><dd>{typeof v === "boolean" ? v ? "Sim" : "Não" : typeof v === "object" ? JSON.stringify(v) : String(v)} · {estado.onboarding.fontesDados?.[k]?.conferido ? "Conferido pelo escritório" : "A conferir"}</dd></div>)}</dl>
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
      </details>
      {estado.atendimento && <details><summary>Procuração e consulta fiscal</summary><p>Representante: {estado.atendimento.representanteVerificadoEm ? "Conferido" : "A conferir"} · Autorização: {estado.atendimento.autorizacao?.estado || "Não verificada"}</p><label>Evidência da representação<textarea style={campoComercial} value={evidencia} onChange={e => setEvidencia(e.target.value)} placeholder="Como foi conferida a identidade e a representação desta empresa" /></label><Button onClick={() => acao("/representante", {
          evidencia
        })}>Registrar conferência do representante</Button><div style={{
          display: "flex",
          gap: 8,
          marginBlock: 10
        }}><Button variant="secondary" onClick={() => acao("/consultas", {
            tipo: "PROCURACAO"
          })}>Verificar procuração</Button><Button variant="secondary" onClick={() => acao("/consultas", {
            tipo: "SITFIS"
          })}>Solicitar SITFIS</Button></div>{estado.trabalhos.map(t => <p key={t.id}>{t.tipo} · {t.status} · {t.resultado?.mensagem}</p>)}</details>}
      <details><summary>Preparar uma nova proposta</summary><p>A mensalidade é calculada pelo catálogo aprovado. Preencha abaixo somente valores conferidos ou ajustes necessários.</p>{[["aberturaCentavos", "Abertura"], ["servicoCentavos", "Outro serviço avulso"], ["mensalCentavos", "Mensalidade personalizada"], ["regularizacaoCentavos", "Regularização"], ["taxasCentavos", "Taxas públicas"]].map(([k, nome]) => <label key={k}>{nome} (R$)<input style={campoComercial} inputMode="decimal" value={ajustes[k] || ""} onChange={e => setAjustes({
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
              escopoAvulso: justificativa
            }
          });
        })}>Gerar proposta para revisão</Button></details>
      {estado.propostas.map(p => <article key={p.id} style={{
        paddingBlock: 16,
        borderBottom: "1px solid var(--border)"
      }}><strong>Proposta {p.versao} · {p.revogadaEm ? "Substituída" : p.status}</strong><OpcoesProposta proposta={p.snapshot} />{p.snapshot.pendencias?.length > 0 && <ul>{p.snapshot.pendencias.map(x => <li key={x}>{x}</li>)}</ul>}{!p.revogadaEm && <div style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap"
        }}>{p.status === "APROVADA" && estado.atendimento && <Button onClick={() => acao(`/propostas/${p.id}/enviar`)}>Assumir e enviar proposta no WhatsApp</Button>}{p.status === "RASCUNHO" && <Button onClick={() => acao(`/propostas/${p.id}/aprovar`)}>Aprovar esta versão</Button>}{["APROVADA", "ENVIADA"].includes(p.status) && <Button onClick={() => executar(async () => {
            const r = await api.comercial(base + `/propostas/${p.id}/link`, {});
            setLink(`${window.location.origin}/proposta/publica#token=${encodeURIComponent(r.token)}`);
          })}>Gerar link da proposta</Button>}{p.status === "ACEITA" && <Button disabled={!modeloId} onClick={() => acao(`/propostas/${p.id}/contrato`, {
            modeloId,
            variaveis: vars
          })}>Gerar contrato da opção aceita</Button>}</div>}</article>)}
      {link && <label>Link pessoal da proposta — envie pela conversa<input style={campoComercial} value={link} readOnly onFocus={e => e.target.select()} /></label>}
      <details><summary>Contrato e assinatura</summary><label>Modelo aprovado<select style={campoComercial} value={modeloId} onChange={e => {
            setModeloId(e.target.value);
            setVars({});
          }}><option value="">Selecione o modelo</option>{modelos.map(m => <option key={m.id} value={m.id}>{m.titulo} · v{m.versao}</option>)}</select></label>{marcadores.map(k => <label key={k}>{k}<input style={campoComercial} value={vars[k] ?? ""} onChange={e => setVars({
            ...vars,
            [k]: e.target.value
          })} /></label>)}
        {estado.contratos.map(c => <article key={c.id}><strong>Contrato · {c.status}</strong><pre style={{
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
          })}>Baixar contrato em PDF</Button>{c.status === "MINUTA" && <Button onClick={() => acao(`/contratos/${c.id}/aprovar`)}>Conferi a minuta: liberar para assinatura</Button>}{c.status === "AGUARDANDO_ASSINATURA" && <Button disabled={!documentoId} onClick={() => acao(`/contratos/${c.id}/assinatura`, {
            documentoId
          })}>Conferi as assinaturas no PDF selecionado</Button>}</article>)}
        <label>Anexar contrato assinado ou documento (PDF, até 5 MB)<input style={campoComercial} type="file" accept="application/pdf" onChange={e => {
            const f = e.target.files?.[0];
            if (f) executar(async () => {
              const r = await api.documentoComercial(onboardingId, f);
              setDocumentoId(r.documento.id);
            });
          }} /></label><label>Documento para conferência<select style={campoComercial} value={documentoId} onChange={e => setDocumentoId(e.target.value)}><option value="">Selecione</option>{estado.documentos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}</select></label><p>A anexação não confirma a assinatura. Abra e confira o documento antes de registrar a conferência.</p>
        {documentoId && <Button onClick={() => executar(async () => {
          const blob = await api.baixarDocumentoComercial(onboardingId, documentoId);
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank", "noopener");
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        })}>Abrir PDF para conferir</Button>}
      </details>
      <details><summary>Conferências do serviço</summary><label>Conferência<select style={campoComercial} value={marco} onChange={e => setMarco(e.target.value)}><option value="DOCUMENTACAO_CONFERIDA">Documentação conferida</option><option value="PAGAMENTO_HONORARIOS_CONFERIDO">Pagamento de honorários conferido</option><option value="ANALISE_REVISADA">Análise revisada pelo contador</option></select></label><label>Evidência da conferência<textarea style={campoComercial} value={evidenciaMarco} onChange={e => setEvidenciaMarco(e.target.value)} /></label><Button onClick={() => acao("/marcos", {
          tipo: marco,
          evidencia: evidenciaMarco
        })}>Registrar conferência</Button><p>O registro do pagamento depende da conferência do comprovante pelo escritório.</p>{estado.marcos?.map(m => <p key={m.id}>{{
            DOCUMENTACACAO_CONFERIDA: "Documentação",
            DOCUMENTACAO_CONFERIDA: "Documentação",
            PAGAMENTO_HONORARIOS_CONFERIDO: "Pagamento de honorários",
            ANALISE_REVISADA: "Análise"
          }[m.tipo]} · {new Date(m.createdAt).toLocaleString("pt-BR")} · {m.dados?.evidencia}</p>)}</details>
      <details><summary>Concluir serviço avulso</summary><label>Entrega realizada<textarea style={campoComercial} value={entrega} onChange={e => setEntrega(e.target.value)} /></label><Button onClick={() => acao("/concluir-avulso", {
          evidencia: entrega
        })}>Registrar conclusão do serviço avulso</Button></details>
    </fieldset>}
  </section>;
}
