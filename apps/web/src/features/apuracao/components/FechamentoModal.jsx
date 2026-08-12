// Q15.7 — Modal de fechamento da apuração.
// Faturamento (read-only, das notas), folha 12m (grade), atividades (editável),
// aviso de disparidade, alíquota/DAS calculado. Botões: Calcular | Salvar | Transmitir.
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Feedback } from "../../../components/ui/Feedback";
import { CadastroFiscalForm } from "../../apuracao-v2/components/CadastroFiscalForm";
import { RelatorioFaturamentoPanel } from "../../apuracao-v2/components/RelatorioFaturamentoPanel";
import { PANEL, fmtMoney } from "../../notas/components/notasStyles";
import { EmpresaZeradaPanel } from "./EmpresaZeradaPanel";

function pasAnteriores(competencia, n = 12) {
  const [y, m] = String(competencia).split("-").map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function FechamentoModal({ api, feedback, portalClientId, competencia, razao, retificar = false, onClose, onChanged }) {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [atividades, setAtividades] = useState([]);
  const [atividadeOpcoes, setAtividadeOpcoes] = useState([]); // Q19: catálogo PGDAS-D p/ dropdown
  const [folha, setFolha] = useState({}); // { pa: valor }
  const [resultado, setResultado] = useState(null);
  const [showTransmit, setShowTransmit] = useState(false);
  const [confirmComp, setConfirmComp] = useState("");
  const [semMovimento, setSemMovimento] = useState(false); // declaração zerada (empresa sem receita)
  // Relatório de faturamento — gerado logo depois do Calcular (ver `gerarRelatorio`).
  const [relatorio, setRelatorio] = useState(null);
  const [relatorioGerando, setRelatorioGerando] = useState(false);
  const [relatorioErro, setRelatorioErro] = useState(null);
  // Q44: Cadastro Fiscal acessível no próprio fluxo de apuração (a aba "Apuração V2" saiu do menu).
  const [showCadastro, setShowCadastro] = useState(false);
  const [cadastroData, setCadastroData] = useState(null); // { cadastro, cnaePrincipalRef }
  const [savingCadastro, setSavingCadastro] = useState(false);

  async function abrirCadastro() {
    try {
      const out = await api.getCadastroFiscal?.(portalClientId);
      // pré-preenche o CNAE que a empresa já tem (Company) quando não há CadastroFiscal ainda
      const cadastro = out?.cadastro || (dados?.cnaePrincipal ? { cnaePrincipal: dados.cnaePrincipal, regime: "SIMPLES_NACIONAL" } : null);
      setCadastroData({ cadastro, cnaePrincipalRef: out?.cnaePrincipalRef || null });
    } catch {
      setCadastroData({ cadastro: dados?.cnaePrincipal ? { cnaePrincipal: dados.cnaePrincipal, regime: "SIMPLES_NACIONAL" } : null, cnaePrincipalRef: null });
    }
    setShowCadastro(true);
  }

  async function salvarCadastro(payload) {
    setSavingCadastro(true);
    try {
      const out = await api.saveCadastroFiscal?.(portalClientId, payload);
      if (out && out.ok === false) throw new Error(out?.message || out?.error || "Falha ao salvar cadastro");
      feedback?.notifySuccess?.("Cadastro fiscal salvo.");
      setShowCadastro(false);
      await load(); // recarrega dados (atividades/anexo do CNAE, cadastroCompleto)
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro ao salvar cadastro fiscal");
    } finally { setSavingCadastro(false); }
  }

  async function load() {
    setLoading(true);
    try {
      // Q19: carrega o catálogo oficial de atividades (de-para idAtividade) em paralelo.
      const [out, atvOut] = await Promise.all([
        api.getFechamento(portalClientId, competencia),
        api.listAtividadesPgdasd?.(portalClientId, `${competencia}-01`).catch(() => null),
      ]);
      const d = out?.dados || out;
      setDados(d);
      // Dica: empresa marcada como zerada + sem faturamento → já sugere o modo sem movimento.
      // `semFaturamento` é a afirmação POR MÊS feita na aba Lançamentos; `empresaZerada` é da
      // empresa inteira. Qualquer uma das duas pré-marca a caixa — mas só PRÉ-MARCA: quem aperta
      // o botão continua sendo o contador, porque isto vira ato fiscal.
      if (d?.semMovimentoDisponivel && (d?.empresaZerada || d?.semFaturamento)) setSemMovimento(true);
      setAtividadeOpcoes(Array.isArray(atvOut?.atividades) ? atvOut.atividades : []);
      setAtividades(Array.isArray(d?.atividades) ? d.atividades.filter((a) => a && a.idAtividade != null) : []);
      // folha: pré-preenche da memória se houver
      const folhaInit = {};
      if (Array.isArray(d?.folhaMensal12)) for (const f of d.folhaMensal12) folhaInit[f.pa] = f.valor;
      setFolha(folhaInit);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao carregar fechamento");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [portalClientId, competencia]);

  const temFatorR = atividades.some((a) => a.sujeitoFatorR);
  const folhaSerie = pasAnteriores(competencia).map((pa) => ({ pa, valor: Number(folha[pa] || 0) }));

  // ⚠ ZERADA É QUEM **SOMA** ZERO — não quem tem a lista vazia.
  //
  // A caixa "Declarar SEM MOVIMENTO" morava dentro do ramo `atividades.length === 0`, e por isso
  // era INALCANÇÁVEL justamente na empresa sem faturamento: o backend preenche a lista sem
  // depender de receita nenhuma — pela memória da última competência, ou pelo CNAE
  // (`montarAtividadesDoCnae` emite a linha "mesmo com faturamento 0, só pra TRAZER o ANEXO").
  // Medido em produção: 166 das 190 competências sem faturamento chegam aqui com UMA atividade de
  // R$ 0,00 — tabela na tela, caixa nenhuma, e o botão Calcular ativo mandando ao SERPRO (pago) um
  // payload que o próprio `buildDeclaracaoPayload` esvazia antes de enviar.
  const somaAtividades = atividades.reduce(
    (s, a) => s + Number(a?.valorInterno || 0) + Number(a?.valorExterno || 0), 0,
  );
  const declaracaoZerada = somaAtividades === 0;
  // O backend recusa antes de gastar a chamada; aqui é só antecipação, com o motivo à vista.
  const motivoCalcularBloqueado = !declaracaoZerada || semMovimento
    ? ""
    : (dados?.semMovimentoDisponivel
      ? "As atividades somam R$ 0,00. Marque \"Declarar SEM MOVIMENTO\" se o mês não teve receita."
      : `A empresa tem faturamento de ${fmtMoney(dados?.faturamento?.total)} na competência — preencha os valores das atividades antes de calcular.`);

  // Conferência da folha: o backend deriva dos lançamentos contábeis (FolhaDerivadaService).
  // Serve para COMPARAR com o que é digitado — o Fator R decide Anexo III ou V e, até aqui, esse
  // número não tinha nenhuma segunda fonte.
  const derivada = dados?.folhaDerivada || null;
  const derivadaDisponivel = Boolean(derivada?.disponivel);
  // Casa pelo MESMO formato que o modal usa em `pasAnteriores` ("YYYY-MM"). A série do backend
  // também traz `pa` numérico (AAAAMM, formato do PGDAS-D); usar aquele aqui não casa com nada e a
  // comparação por mês fica silenciosamente vazia.
  const derivadaPorPa = new Map((derivada?.porMes || []).map((m) => [String(m.competencia), Number(m.valor)]));
  const totalDerivado = Number(derivada?.total || 0);
  const totalDigitado = folhaSerie.reduce((s, f) => s + Number(f.valor || 0), 0);
  const folhaConfere = derivadaDisponivel && Math.abs(totalDigitado - totalDerivado) <= 0.01;
  // Quais contas o backend somou. Aparece no title da caixa: quando o plano de contas da empresa
  // não casa com as dicas do template, o derivado vem zerado — e "não tem folha" e "não achei a
  // conta" são coisas diferentes que a tela precisa conseguir distinguir.
  const contasDaConferencia = Array.isArray(derivada?.contasConsideradas) ? derivada.contasConsideradas : [];

  // ⚠ CAMPO LIMPO CONTINUA LIMPO. `Number("") || 0` é `0`, e enquanto era isso que ficava no estado,
  // apagar o campo escrevia um ZERO — indistinguível de "o contador conferiu e é zero mesmo". O
  // backend deixa `null` de propósito quando não sabe o valor (memória com 2+ atividades: não existe
  // regra de rateio), e essa distinção morreria na primeira tecla. `null` some no envio: tanto
  // `somaAtividades` quanto `buildDeclaracaoPayload` leem `Number(v || 0)`.
  function setAtvValor(idx, campo, valor) {
    const limpo = String(valor).trim() === "" ? null : (Number(valor) || 0);
    setAtividades((prev) => prev.map((a, i) => i === idx ? { ...a, [campo]: limpo } : a));
  }

  // Q19: trocar a atividade de uma linha → o anexo/mercado/Fator-R vêm junto (do catálogo).
  function setAtvAtividade(idx, idAtividade) {
    const opt = atividadeOpcoes.find((o) => String(o.idAtividade) === String(idAtividade));
    if (!opt) return;
    setAtividades((prev) => prev.map((a, i) => i === idx ? {
      ...a,
      idAtividade: opt.idAtividade,
      descricao: opt.descricao,
      anexoImplicito: opt.anexoImplicito,
      mercado: opt.mercado,
      sujeitoFatorR: opt.sujeitoFatorR,
      tipoReceita: opt.tipoReceita,
    } : a));
  }

  function addAtividade() {
    const opt = atividadeOpcoes[0];
    if (!opt) { feedback?.notifyError?.("Catálogo de atividades indisponível."); return; }
    setAtividades((prev) => [...prev, {
      idAtividade: opt.idAtividade, descricao: opt.descricao, anexoImplicito: opt.anexoImplicito,
      mercado: opt.mercado, sujeitoFatorR: opt.sujeitoFatorR, tipoReceita: opt.tipoReceita,
      valorInterno: 0, valorExterno: 0,
    }]);
  }

  function removeAtividade(idx) {
    setAtividades((prev) => prev.filter((_, i) => i !== idx));
  }

  // Rótulo da opção no dropdown: descrição + anexo (+ ★FR).
  function optLabel(o) {
    return `${o.descricao || `#${o.idAtividade}`} — Anexo ${o.anexoImplicito}${o.sujeitoFatorR ? " ★FR" : ""}`;
  }

  // ⚠ O RELATÓRIO DE FATURAMENTO É **GERADO** AQUI, E NÃO APENAS LIDO — a decisão e o porquê.
  //
  // O pedido do dono foi *"deve ser exibido esse relatorio ao calcularmos e ele deve ser salvo"*.
  // Só exibir o salvo cumpriria a letra e falharia o sentido: na primeira apuração de uma
  // competência não existe foto nenhuma (a tela mostraria o vazio bem no momento em que o
  // relatório deveria aparecer), e nas seguintes apareceria a foto de ANTES do que se acabou de
  // conferir — um relatório com data de geração velha ao lado de um DAS recém-calculado é pior
  // que relatório nenhum.
  //
  // Gerar é seguro e barato: o `POST /relatorio-faturamento/:competencia` não chama ADN, SEFAZ nem
  // SERPRO (é leitura do nosso banco), e o pré-apurado roda o motor local com `persistir: false` —
  // ele NÃO grava `ApuracaoSnapshot` e não muda o estado da apuração da empresa.
  //
  // ⚠ E ELE NÃO ESTÁ NO CAMINHO DO CALCULAR. A chamada sai DEPOIS de `setResultado` e do
  // `notifySuccess`, em `try/catch` próprio e com `acting` já liberado: o Calcular não fica mais
  // lento nem falha por causa do relatório. Se a geração falhar, o cálculo continua valendo e o
  // painel abaixo diz que o relatório não saiu, com "Gerar relatório" para tentar de novo.
  async function gerarRelatorio() {
    if (!api?.gerarRelatorioFaturamento) return;
    setRelatorioGerando(true);
    try {
      const out = await api.gerarRelatorioFaturamento(portalClientId, competencia);
      if (out?.ok === false) throw new Error(out?.message || out?.error || "Falha ao gerar o relatório");
      setRelatorio(out?.relatorio || null);
      setRelatorioErro(null);
    } catch (err) {
      setRelatorio(null);
      setRelatorioErro(err?.message || "O relatório de faturamento não foi gerado.");
    } finally { setRelatorioGerando(false); }
  }

  async function handleCalcular() {
    setActing(true);
    let calculou = false;
    try {
      const out = await api.calcularFechamento(portalClientId, competencia, {
        atividades, folhaMensal12: folhaSerie, regimeApuracao: dados?.regimeApuracao,
        // Pela SOMA, não pelo comprimento — é o que o payload do PGDAS-D de fato leva.
        semMovimento: semMovimento && declaracaoZerada,
      });
      if (!out?.ok) throw new Error(out?.message || out?.error || "Falha");
      setResultado(out.result);
      feedback?.notifySuccess?.(`DAS calculado: ${fmtMoney(out.result?.dasValor || 0)}`);
      calculou = true;
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro no cálculo (SERPRO)");
    } finally { setActing(false); }

    // ⚠ FORA do try/finally do cálculo: o resultado já está na tela e os botões já foram
    // liberados antes desta chamada começar. Ver o comentário de `gerarRelatorio`.
    if (calculou) await gerarRelatorio();
  }

  async function handleSalvar() {
    setActing(true);
    try {
      const out = await api.salvarFechamento(portalClientId, competencia, {
        atividades, folhaMensal12: folhaSerie, regimeApuracao: dados?.regimeApuracao,
      });
      if (!out?.ok) throw new Error(out?.message || out?.error || "Falha");
      feedback?.notifySuccess?.("Apuração fechada (pronta pra apurar em lote).");
      onChanged?.();
      onClose?.();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro ao salvar");
    } finally { setActing(false); }
  }

  async function handleTransmitir() {
    if (confirmComp !== competencia) { feedback?.notifyError?.("Digite a competência exata."); return; }
    setActing(true);
    try {
      // Q55: em modo retificar, retransmite como RETIFICADORA (tipoDeclaracao:2, fura o guard "já declarado").
      const out = retificar
        ? await api.retificarFechamento(portalClientId, competencia, confirmComp)
        : await api.transmitirFechamento(portalClientId, competencia, confirmComp);
      if (!out?.ok) throw new Error(out?.message || out?.error || "Falha");
      const r = out.result || {};
      const base = retificar
        ? `Retificadora transmitida! Declaração ${r.numeroDeclaracao || "?"}`
        : (r.jaDeclarado ? "PA já declarado — não retransmitido." : `Transmitida! Declaração ${r.numeroDeclaracao || "?"}`);
      // C12: a transmissão já traz extrato + guia DAS junto — avisa o que veio (ou o que faltou),
      // pra ninguém sair rodando "buscar extrato/guia" achando que ficou pendente.
      const pos = r.posTransmissao || null;
      const partes = [];
      if (pos?.extrato?.ok) partes.push("extrato reconsultado");
      else if (pos?.extrato?.skipped) partes.push("extrato não veio (rode a busca)");
      if (pos?.guia?.guideId) {
        const v = pos.guia.valor != null
          ? ` (R$ ${Number(pos.guia.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })})`
          : "";
        partes.push(`guia DAS disponível${v}`);
      } else if (pos?.guia?.skipped) partes.push("guia DAS não veio (rode a busca)");
      feedback?.notifySuccess?.(partes.length ? `${base} · ${partes.join(" · ")}` : base);
      setShowTransmit(false);
      onChanged?.();
      onClose?.();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro na transmissão");
    } finally { setActing(false); }
  }

  const inputS = { background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 4, color: PANEL.text, padding: "4px 8px", fontSize: "0.8rem" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 22, width: "min(96vw, 1040px)", maxHeight: "94vh", overflowY: "auto", overflowX: "hidden", color: PANEL.text, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>🔒 Fechamento — {razao} · {competencia}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>

        {loading && <div style={{ color: PANEL.muted, padding: 20 }}>Carregando…</div>}

        {dados && !loading && (
          <>
            {/* Q44: Cadastro fiscal acessível aqui (a aba "Apuração V2" saiu do menu). */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {!dados.cadastroCompleto && (
                <span style={{ padding: "6px 10px", background: "rgba(255,179,71,0.12)", border: "1px solid #FFB347", borderRadius: 6, color: "#FFB347", fontSize: "0.82rem" }}>
                  ⚠ Cadastro fiscal incompleto (sem CNAE) — o anexo pode não vir automático.
                </span>
              )}
              <button type="button" onClick={() => (showCadastro ? setShowCadastro(false) : abrirCadastro())}
                style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: PANEL.field, color: PANEL.text, cursor: "pointer", fontSize: "0.82rem" }}>
                {showCadastro ? "Fechar cadastro" : "📋 Cadastro fiscal"}
              </button>
            </div>

            {showCadastro && (
              <div style={{ padding: 12, background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
                <CadastroFiscalForm
                  cadastro={cadastroData?.cadastro}
                  cnaePrincipalRef={cadastroData?.cnaePrincipalRef}
                  saving={savingCadastro}
                  onSave={salvarCadastro}
                />
              </div>
            )}

            {/* Resumo read-only compacto (Q19) — uma linha em vez de 4 cards */}
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 16, padding: "8px 12px",
              background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8,
              fontSize: "0.8rem", color: PANEL.muted,
            }}>
              <span>Fat. interno <strong style={{ color: "#69FF47" }}>{fmtMoney(dados.faturamento?.interno)}</strong></span>
              <span>Fat. externo <strong style={{ color: "#8BE9FD" }}>{fmtMoney(dados.faturamento?.externo)}</strong></span>
              <span>RBT12 <strong style={{ color: PANEL.text }}>{fmtMoney(dados.rbt12)}</strong>{dados.rbt12Origem ? ` (${dados.rbt12Origem})` : ""}</span>
              <span>Regime <strong style={{ color: PANEL.text }}>{dados.regimeApuracao}</strong></span>
            </div>

            {/* Disparidades */}
            {Array.isArray(dados.disparidades) && dados.disparidades.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {dados.disparidades.map((d, i) => (
                  <div key={i} style={{ padding: 8, background: "rgba(255,179,71,0.12)", border: "1px solid #FFB347", borderRadius: 6, color: "#FFB347", fontSize: "0.78rem" }}>
                    ⚠ {d.descricao}
                  </div>
                ))}
              </div>
            )}

            {/* Atividades — Q19: a Atividade é um dropdown; o Anexo segue a seleção.
                Empresa pode ter várias atividades (incl. Anexo V) — "+ atividade" / "×". */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>Atividades (o anexo vem da atividade escolhida)</div>
                <button onClick={addAtividade} disabled={atividadeOpcoes.length === 0}
                  style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.text, borderRadius: 6, padding: "4px 10px", cursor: atividadeOpcoes.length === 0 ? "not-allowed" : "pointer", fontSize: "0.78rem" }}>
                  + atividade
                </button>
              </div>
              {atividades.length === 0 ? (
                <div style={{ color: PANEL.muted, fontSize: "0.8rem", padding: 10, background: PANEL.field, borderRadius: 6 }}>
                  Nenhuma atividade. Use “+ atividade” pra adicionar, ou classifique as notas (Apuração V2).
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead><tr style={{ color: PANEL.muted, textAlign: "left" }}>
                    <th style={{ padding: 4 }}>Atividade</th>
                    <th style={{ padding: 4, width: 90 }}>Anexo</th>
                    <th style={{ padding: 4, textAlign: "right", width: 120 }}>Interno</th>
                    <th style={{ padding: 4, textAlign: "right", width: 120 }}>Externo</th>
                    <th style={{ padding: 4, width: 32 }}></th>
                  </tr></thead>
                  <tbody>
                    {atividades.map((a, idx) => (
                      <tr key={idx} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                        <td style={{ padding: 4 }}>
                          {atividadeOpcoes.length > 0 ? (
                            <select value={a.idAtividade} onChange={(e) => setAtvAtividade(idx, e.target.value)}
                              style={{ ...inputS, width: "100%", colorScheme: "dark" }}>
                              {/* garante a opção atual mesmo se fora do catálogo */}
                              {!atividadeOpcoes.some((o) => String(o.idAtividade) === String(a.idAtividade)) && (
                                <option value={a.idAtividade}>{a.descricao || `#${a.idAtividade}`}</option>
                              )}
                              {atividadeOpcoes.map((o) => (
                                <option key={o.idAtividade} value={o.idAtividade}>{optLabel(o)}</option>
                              ))}
                            </select>
                          ) : (
                            <span>{a.descricao || `#${a.idAtividade}`} <span style={{ color: PANEL.muted }}>({a.idAtividade})</span></span>
                          )}
                        </td>
                        <td style={{ padding: 4 }}>{a.anexoImplicito}{a.sujeitoFatorR ? " ★FR" : ""}</td>
                        <td style={{ padding: 4, textAlign: "right" }}>
                          {/* ⚠ `?? ""`, NUNCA `|| 0`. Com `|| 0` o campo renderiza **0** para
                              null/undefined, e o "vazio" que o backend manda quando não sabe o
                              valor nunca chegaria à tela — a mudança inteira ficaria invisível, com
                              um zero fabricado no lugar do campo em branco. */}
                          <input type="number" step="0.01" placeholder="—" value={a.valorInterno ?? ""} onChange={(e) => setAtvValor(idx, "valorInterno", e.target.value)} style={{ ...inputS, width: 110, textAlign: "right" }} />
                        </td>
                        <td style={{ padding: 4, textAlign: "right" }}>
                          <input type="number" step="0.01" placeholder="—" value={a.valorExterno ?? ""} onChange={(e) => setAtvValor(idx, "valorExterno", e.target.value)} style={{ ...inputS, width: 110, textAlign: "right" }} />
                        </td>
                        <td style={{ padding: 4, textAlign: "center" }}>
                          <button onClick={() => removeAtividade(idx)} title="Remover atividade"
                            style={{ background: "transparent", border: "none", color: "var(--state-danger)", cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* ⚠ POR QUE O VALOR ESTÁ EM BRANCO — a explicação anda junto do campo vazio.
                  O backend deixa o valor `null` quando a configuração lembrada tem 2+ atividades:
                  não existe regra de rateio entre elas, e dividir por conta própria seria o portal
                  chutando o que vai numa declaração. Campo vazio SEM motivo, porém, parece campo
                  quebrado — e o contador reporia "o que estava lá antes", que é justamente o valor
                  de outra competência que esta mudança tirou do caminho. */}
              {dados?.prefillValor?.indefinido && (
                <div style={{ marginTop: 8, padding: 10, background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)", borderRadius: 6, color: "var(--state-warn)", fontSize: "0.78rem" }}>
                  ⚠ Os valores vieram em branco de propósito. {dados.prefillValor.motivo}
                  {dados.prefillValor.total > 0 && (
                    <div style={{ color: PANEL.muted, marginTop: 4 }}>
                      Faturamento desta competência: <strong>{fmtMoney(dados.prefillValor.total)}</strong>.
                    </div>
                  )}
                </div>
              )}
              {/* O caminho normal: uma atividade lembrada, e o faturamento DESTA competência entrando
                  no mercado que a memória guarda. Dizer o mercado em voz alta importa porque ele é a
                  única informação de exportação que esta base tem — `flagExportacao` nunca é escrita
                  para NFS-e, então a nota da empresa exportadora chega aqui como se fosse interna. */}
              {dados?.prefillValor?.origem === "faturamento_da_competencia" && !dados.prefillValor.indefinido && atividades.length > 0 && (
                <div style={{ marginTop: 8, fontSize: "0.74rem", color: PANEL.muted }}>
                  Valor pré-preenchido com o faturamento <strong>desta competência</strong> ({fmtMoney(dados.prefillValor.total)})
                  {dados.prefillValor.mercadoAplicado === "EXTERNO"
                    ? <> no mercado <strong>EXTERNO</strong>, como a configuração desta empresa indica.</>
                    : <> no mercado interno.</>}
                  {" "}A memória guarda a atividade e o anexo — nunca o valor de outro mês.
                </div>
              )}

              {/* Sem movimento — FORA do ramo "lista vazia", porque quem decide é a SOMA.
                  A empresa sem faturamento chega aqui com a atividade do CNAE (ou da memória da
                  competência anterior) valendo R$ 0,00: a lista NÃO está vazia, e enquanto esta
                  caixa vivia dentro daquele ramo ela nunca aparecia — o modo "sem movimento",
                  que é o caminho da declaração zerada, era inalcançável na tela. */}
              {dados?.semMovimentoDisponivel && declaracaoZerada && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: 10, marginTop: 8, background: "rgba(139,233,253,0.08)", border: "1px solid #8BE9FD", borderRadius: 6, fontSize: "0.82rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={semMovimento} onChange={(e) => setSemMovimento(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>
                    <strong>Declarar SEM MOVIMENTO (zerado)</strong> — a empresa não teve receita nesta competência.
                    Vai transmitir o PGDAS-D com receita <strong>R$ 0,00</strong> à Receita.
                    {atividades.length > 0 ? " As atividades listadas somam R$ 0,00 e não vão no envio." : ""}
                    {dados?.empresaZerada ? " (Empresa marcada como zerada.)" : ""}
                  </span>
                </label>
              )}

              {/* EMPRESA ZERADA — o pedido do dono, e a fronteira que ele NÃO atravessa.
                  Aparece quando a competência não tem receita (ou já foi marcada), porque é aí que
                  a pergunta "isto está resolvido?" tem três respostas possíveis. A caixa acima
                  ("Declarar SEM MOVIMENTO") continua sendo o caminho de TRANSMITIR daqui; esta é o
                  registro do que aconteceu FORA. As duas coexistem de propósito — colapsá-las faria
                  "fechei aqui" e "entreguei lá" virarem a mesma frase na tela. */}
              {(dados?.semMovimentoDisponivel || dados?.semFaturamento) && (
                <div style={{ marginTop: 8 }}>
                  <EmpresaZeradaPanel
                    api={api}
                    feedback={feedback}
                    dados={dados}
                    portalClientId={portalClientId}
                    competencia={competencia}
                    razao={razao}
                    onChanged={async () => { await load(); onChanged?.(); }}
                  />
                </div>
              )}
            </div>

            {/* Folha 12m (Fator-R) — só se houver atividade sujeita */}
            {temFatorR && (
              <div>
                <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 6 }}>
                  ★ Folha de salários (12 meses) — pro Fator-R. A RFB decide Anexo III↔V.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 6 }}>
                  {pasAnteriores(competencia).map((pa) => {
                    // Valor derivado dos lançamentos daquele mês, para comparar célula a célula.
                    const derivadoMes = derivadaPorPa.get(String(pa));
                    const digitadoMes = Number(folha[pa] || 0);
                    const divergeMes = derivadaDisponivel && derivadoMes != null
                      && Math.abs(derivadoMes - digitadoMes) > 0.01;
                    return (
                      <label key={pa} style={{ fontSize: "0.7rem", color: PANEL.muted, display: "flex", flexDirection: "column", gap: 2 }}>
                        {pa}
                        <input
                          type="number" step="0.01" value={folha[pa] || ""}
                          onChange={(e) => setFolha((p) => ({ ...p, [pa]: e.target.value }))}
                          placeholder="0,00"
                          style={divergeMes ? { ...inputS, borderColor: "#FFB347" } : inputS}
                        />
                        {divergeMes && (
                          <span style={{ color: "#FFB347", fontSize: "0.65rem" }} title="Débito na conta de despesa de folha/pró-labore desta competência (o pagamento não entra)">
                            lançado: {fmtMoney(derivadoMes)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {/* CONFERÊNCIA — mostra os DOIS números, nunca escolhe. Os lançamentos podem estar
                    incompletos numa empresa recém-migrada; substituir o valor do contador por um
                    derivado incompleto trocaria um erro raro por um sistemático.
                    O número já esteve errado (contava o lançamento de PAGAMENTO junto com a provisão
                    e usava uma janela um mês à frente da grade) e só voltou para cá depois de
                    conferido contra a base real com `scripts/diag-folha-derivada.mjs`. */}
                {derivadaDisponivel && (
                  <div
                    title={contasDaConferencia.length
                      ? `Somando o débito nas contas ${contasDaConferencia.join(", ")}. O lançamento de pagamento fica de fora.`
                      : undefined}
                    style={{
                      marginTop: 8, padding: "8px 10px", borderRadius: 6, fontSize: "0.75rem",
                      background: folhaConfere ? "rgba(105,255,71,0.08)" : "rgba(255,179,71,0.10)",
                      border: `1px solid ${folhaConfere ? "#69FF47" : "#FFB347"}`,
                      color: folhaConfere ? "#69FF47" : "#FFB347",
                    }}
                  >
                    {folhaConfere ? (
                      <>✓ Confere com os lançamentos de folha ({fmtMoney(totalDerivado)}).</>
                    ) : (
                      <>
                        Digitado <strong>{fmtMoney(totalDigitado)}</strong> · lançamentos somam{" "}
                        <strong>{fmtMoney(totalDerivado)}</strong> · diferença{" "}
                        <strong>{fmtMoney(Math.abs(totalDigitado - totalDerivado))}</strong>.
                        <div style={{ color: PANEL.muted, marginTop: 4 }}>
                          Conferência, não correção — os lançamentos podem estar incompletos.
                          {derivada?.mesesComLancamento != null
                            && ` Há folha lançada em ${derivada.mesesComLancamento} dos 12 meses.`}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {/* Fator-R com folha zerada: a RFB recebe 12 zeros como se fossem folha de verdade,
                    Fator-R dá 0 e a empresa cai no Anexo V sem erro nenhum. Avisa, não bloqueia. */}
                {totalDigitado === 0 && derivadaDisponivel && (
                  <div style={{
                    marginTop: 6, padding: "8px 10px", borderRadius: 6, fontSize: "0.75rem",
                    background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", color: "#FFB347",
                  }}>
                    ⚠ A folha está zerada e a atividade é sujeita ao Fator-R. Calculando assim, o
                    Fator-R dá zero e a RFB aplica o <strong>Anexo V</strong> — mas há folha lançada
                    no período.
                  </div>
                )}
              </div>
            )}

            {/* Resultado.
                ⚠ `dasValor` é `null` quando a RFB responde 200 SEM `valoresDevidos` — e isso
                acontece: o retorno traz só `mensagens` explicando o que ela recusou. Antes a caixa
                pintava de verde, mostrava "—" e jogava as mensagens fora, então "calculou e não
                apareceu nada" era literalmente o que a tela fazia. Sem DAS a caixa fica âmbar e as
                mensagens da RFB aparecem — elas são a única explicação que existe. */}
            {resultado && (
              <div style={{
                padding: 12, borderRadius: 6,
                background: resultado.dasValor != null ? "rgba(105,255,71,0.10)" : "rgba(255,179,71,0.10)",
                border: `1px solid ${resultado.dasValor != null ? "#69FF47" : "#FFB347"}`,
              }}>
                <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase" }}>
                  {resultado.dasValor != null ? "DAS calculado (oficial SERPRO)" : "A RFB não devolveu valor devido"}
                </div>
                {resultado.dasValor != null && (
                  <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "#69FF47" }}>{fmtMoney(resultado.dasValor)}</div>
                )}
                {resultado.rbt12 != null && <div style={{ fontSize: "0.75rem", color: PANEL.muted }}>RBT12 usado: {fmtMoney(resultado.rbt12)}</div>}
                {Array.isArray(resultado.mensagens) && resultado.mensagens.length > 0 && (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.75rem", color: PANEL.muted }}>
                    {resultado.mensagens.map((m, i) => (
                      <li key={i}>{typeof m === "string" ? m : (m?.texto || m?.mensagem || JSON.stringify(m))}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* ⚠ O RELATÓRIO APARECE AO CALCULAR — é o pedido do dono, e é aqui que ele cai.
                Só é montado depois de haver cálculo (ou tentativa de geração): antes disso não há
                o que mostrar, e um painel vazio no topo do modal roubaria a atenção do que a tela
                existe para fazer. O `compacto` tira o quadro-resumo, que é o rodapé do impresso e
                cabe melhor na aba; aqui o que importa é o detalhe por tipo de operação. */}
            {(resultado || relatorio || relatorioGerando || relatorioErro) && (
              <RelatorioFaturamentoPanel
                relatorio={relatorio}
                gerando={relatorioGerando}
                erro={relatorioErro}
                onGerar={gerarRelatorio}
                compacto
              />
            )}

            {/* Q44: feedback das ações (Calcular/Salvar/Transmitir) — antes os notify* eram invisíveis */}
            {(feedback?.message || feedback?.error) && (
              <Feedback message={feedback?.message} error={feedback?.error} />
            )}

            {/* Botões */}
            {/* ⚠ O accent (ação primária) ANDA COM O PASSO, e isso é decisão, não descuido.
                Sem `resultado` os dois últimos botões nascem desabilitados: pintar de accent um
                controle que não pode ser clicado faz do elemento mais alto da tela o único
                inutilizável — a hierarquia passaria a apontar pra parede. Então antes de calcular o
                accent é o 🧮 Calcular (o único ato possível); depois de calcular ele passa pro
                📤 Apurar/Transmitir, que é o ato que a tela existe pra fazer. Em qualquer instante
                há UM accent, e ele é sempre o próximo passo legítimo.
                As cores antigas eram token de ESTADO em botão de AÇÃO (ciano = categoria,
                âmbar = pendência) — ver `apps/web/CLAUDE.md`. */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              {/* ⚠ Desabilitado NOMEIA o motivo. Antes a condição era `atividades.length === 0 &&
                  !semMovimento`: com a lista preenchida de R$ 0,00 o botão ficava ATIVO e o clique
                  virava chamada PAGA ao SERPRO para levar 400 da RFB ("O valor da atividade deve
                  ser maior que zero") — e, quando ficava desabilitado, ficava sem nenhum título
                  dizendo por quê. */}
              <Button onClick={handleCalcular} disabled={acting || Boolean(motivoCalcularBloqueado)}
                title={motivoCalcularBloqueado}
                variant={resultado ? "secondary" : "primary"}>{acting ? "…" : (declaracaoZerada && semMovimento ? "🧮 Calcular sem movimento" : "🧮 Calcular (simulação)")}</Button>
              <Button onClick={handleSalvar} disabled={acting || !resultado}
                variant="secondary" title={!resultado ? "Calcule antes de salvar" : ""}>💾 Salvar (fechar)</Button>
              <Button onClick={() => setShowTransmit(true)} disabled={acting || !resultado}
                variant={resultado ? "primary" : "secondary"} title={!resultado ? "Calcule antes de transmitir" : ""}>
                {retificar ? "🔄 Retransmitir (retificadora)" : "📤 Apurar/Transmitir"}
              </Button>
            </div>

            {/* Confirmação de transmissão individual */}
            {showTransmit && (
              <div style={{ padding: 12, background: "rgba(255,71,87,0.08)", border: "1px solid #FF4757", borderRadius: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ color: "#FF4757", fontSize: "0.85rem", fontWeight: 600 }}>
                  {retificar
                    ? `⚠ RETIFICADORA OFICIAL — substitui a declaração já enviada. Digite a competência (${competencia}) pra confirmar:`
                    : `⚠ Transmissão OFICIAL — digite a competência (${competencia}) pra confirmar:`}
                </div>
                {/* Pela SOMA: a atividade listada valendo R$ 0,00 é descartada no payload, então o
                    que sai é a declaração ZERADA — e quem vai confirmar precisa ler isso. */}
                {declaracaoZerada && (
                  <div style={{ color: "#8BE9FD", fontSize: "0.8rem" }}>
                    Declaração <strong>SEM MOVIMENTO</strong>: será transmitido o PGDAS-D com receita R$ 0,00.
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={confirmComp} onChange={(e) => setConfirmComp(e.target.value)} placeholder={competencia} style={{ ...inputS, fontFamily: "monospace", flex: 1 }} />
                  {/* Este é o clique irreversível do lado da Receita — `danger` é o único lugar
                      desta tela onde o vermelho é a AÇÃO, e ele já vive dentro da caixa de
                      confirmação com a competência digitada. */}
                  <Button onClick={handleTransmitir} disabled={acting || confirmComp !== competencia} variant="danger">{acting ? "Transmitindo…" : "Confirmar"}</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ⚠ O helper `btn(bg, color)` foi REMOVIDO. Ele existia só pra pintar botão com hex literal, e os
// hexes que recebia eram tokens de ESTADO (#8BE9FD categoria, #FFB347 pendência) usados como cor
// de AÇÃO. Botão do app é `components/ui/Button.jsx`; não recrie um irmão aqui.
