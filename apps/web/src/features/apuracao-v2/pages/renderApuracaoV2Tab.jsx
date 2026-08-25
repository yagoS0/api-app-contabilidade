// Grupo "Fiscal" da empresa → aba "Apuração". É onde a empresa é FECHADA para apuração,
// transmitida e retificada — tudo por dentro da própria empresa.
//
// ⚠⚠ ESTA ABA TINHA TRÊS SEÇÕES INTERNAS (Apuração · Perfil fiscal · Sugestão) ATÉ 24/08/2026 — um
// TERCEIRO nível de navegação, sem URL, depois de grupo → sub-aba. O dono, olhando a tela como
// contador: *"está confusa, sem tabela do anexo e muitas abas"*. As seções morreram:
//
//   · **Perfil fiscal** virou aba própria do grupo **Empresa** (`renderPerfilFiscalTab.jsx`) — é
//     CADASTRO (atividades permitidas por CNAE), não o trabalho do mês;
//   · **Sugestão** virou MODAL, aberto pelo botão de pendências que já existia nesta barra;
//   · **Apuração** ficou sendo a página inteira, e ganhou a TABELA DO ANEXO que faltava.
//
// ⚠ E isto continua a limpeza que o próprio dono começou: foi ele quem removeu a sub-aba "Motor
// local" no commit `cc1670e4` ("removidos Motor local, Produtos/Servicos…"). Ele tirou a ABA, não a
// INFORMAÇÃO — por isso a tabela volta como CONTEÚDO desta página, e não como uma quarta seção.
//
// O fluxo de calcular/fechar/transmitir/retificar reaproveita o FechamentoModal (o MESMO da tela de
// lote), aberto por um botão — então a lógica validada não muda. A tela de lote (renderApuracaoPage)
// virou só "selecionar as fechadas e apurar em lote".
import { useCallback, useEffect, useState } from "react";
import { rotuloEstadoApuracao, RBT12_NOME } from "../../../lib/vocabulario";
import { PANEL, fmtDate, fmtMoney } from "../../notas/components/notasStyles";
import { ResolverPendenciaModal } from "../components/ResolverPendenciaModal";
import { SugestaoAnexoTabela } from "../components/SugestaoAnexoPanel";
import { SugestaoModal } from "../components/SugestaoModal";
import { TabelaAnexoReferencia } from "../components/TabelaAnexoReferencia";
import { FechamentoModal } from "../../apuracao/components/FechamentoModal";
import { entregaPgdasDoFechamento, CORES_TOM } from "../../apuracao/lib/entregaPgdas";
import { RelatorioFaturamentoPanel } from "../components/RelatorioFaturamentoPanel";
import { estadoDaClassificacao, kpiDasApurado, CORES_TOM_RELATORIO } from "../lib/relatorioFaturamento";
import { companyTabPath } from "../../companies/detail/lib/rotasDaEmpresa";
import { oNavegadorAssumeOClique } from "../../../components/ui/cliqueDeLink";
import { Aviso } from "../../../components/ui/Aviso";
import { Button } from "../../../components/ui/Button";

function competenciaAnterior() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ⚠ Cor de token, não hex literal — e cada uma no seu significado: `--state-ok` é CONCLUÍDO
// (fechada, confirmada), `--accent-cyan` é a mesma tinta que a carteira usa para "fora do fluxo"
// (transmitida) e `--state-warn` é o que ainda pede ação (calculada, falta transmitir).
const ESTADO_COR = {
  fechada: "var(--state-ok)",
  transmitida: "var(--accent-cyan)",
  calculada: "var(--state-warn)",
  confirmada: "var(--state-ok)",
};
// Mostra em que ponto do TRABALHO a competência está, não o nome do registro no banco.
// "calculada" e "bloqueada_pendencias" descrevem a linha da tabela; o contador quer saber se
// ainda falta transmitir.
function EstadoBadge({ estado }) {
  if (!estado || estado === "pendente" || estado === "aberta") {
    return <span style={{ color: PANEL.muted }}>{rotuloEstadoApuracao(estado)}</span>;
  }
  const cor = ESTADO_COR[estado] || "var(--state-warn)";
  return <span style={{ color: cor, fontWeight: 700 }}>{rotuloEstadoApuracao(estado)}</span>;
}

// ⚠ `SecaoTabs` MORREU AQUI em 24/08/2026 — ver o cabeçalho. Ela desenhava a TERCEIRA barra de abas
// empilhada na mesma tela, e o comentário que ela carregava já denunciava o problema: *"três barras
// de aba empilhadas na mesma tela"*. Não é para voltar; se um conteúdo novo precisar de lugar, ele
// é seção da página (com título) ou aba de verdade, com URL.

function Kpi({ label, value, cor, title }) {
  return (
    <div title={title} style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ fontSize: "0.68rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: "1.05rem", fontWeight: 700, color: cor || PANEL.text, fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

export function ApuracaoV2Tab({
  panel, api, companyId, feedback, razao,
  competencia: competenciaGlobal, onCompetenciaChange,
  // ⚠ Quem navega é a PÁGINA (ela tem o `switchTab`); esta aba só sabe para onde. Sem o retorno
  // de chamada o `<a href>` continua funcionando — só recarrega a página inteira em vez de navegar
  // por dentro do app.
  onAbrirPerfilFiscal = null,
}) {
  // ⚠ Era `const [secao, setSecao] = useState("apuracao")` — o estado do terceiro nível de abas.
  // Sobrou só a pergunta que ele de fato respondia: a classificação está aberta ou não.
  const [sugestaoAberta, setSugestaoAberta] = useState(false);
  const [resolvendo, setResolvendo] = useState(null);
  // ⚠ A COMPETÊNCIA É DA EMPRESA, não desta aba — vem do seletor do header.
  // Era `useState(competenciaAnterior())`: sair de Lançamentos em maio e entrar aqui mostrava
  // junho, sem nada indicar a troca. A apuração é o ato fiscal do mês; apurar a competência errada
  // por causa de dois seletores discordando é o erro mais caro que esta tela pode produzir.
  // O fallback local cobre a aba montada fora da página de detalhe (não há chamador assim hoje).
  const competencia = competenciaGlobal || competenciaAnterior();
  const setCompetencia = onCompetenciaChange || (() => {});

  // ── Apuração (fechamento) ─────────────────────────────────────────────
  const [fechDados, setFechDados] = useState(null);
  const [fechLoading, setFechLoading] = useState(false);
  const [fechErro, setFechErro] = useState(null);
  const [snap, setSnap] = useState(null);
  const [fechando, setFechando] = useState(null); // { retificar } → abre o FechamentoModal
  // Extrato do Simples (o que realmente foi pra Receita) — botão explícito (bate no SERPRO).
  const [extrato, setExtrato] = useState(null);
  const [extratoLoading, setExtratoLoading] = useState(false);
  // Relatório de faturamento salvo desta competência (GET; nunca gera sozinho).
  const [relatorio, setRelatorio] = useState(null);
  const [relatorioLoading, setRelatorioLoading] = useState(false);
  const [relatorioGerando, setRelatorioGerando] = useState(false);
  const [relatorioErro, setRelatorioErro] = useState(null);

  const carregarApuracao = useCallback(async () => {
    if (!api || !companyId || !/^\d{4}-\d{2}$/.test(competencia)) return;
    setFechLoading(true);
    try {
      const [fech, snapshot] = await Promise.all([
        api.getFechamento?.(companyId, competencia),
        api.getApuracaoSnapshot?.(companyId, competencia).catch(() => null),
      ]);
      setFechDados(fech?.dados || fech || null);
      setSnap(snapshot?.snapshot || snapshot || null);
      setFechErro(null);
    } catch (err) {
      // ⚠ FALHA DE BACKEND NÃO PODE SE PARECER COM "EMPRESA SEM FATURAMENTO".
      //
      // Era `catch { setFechDados(null); }`: sem `notifyError`, sem log, sem estado de erro. Os
      // KPIs renderizavam "—" e a competência ficava indistinguível de um mês zerado — que é
      // justamente a leitura que a tela toda existe para não deixar acontecer (a mesma classe do
      // zero fabricado e do "0 pendências" verde). O dado some do mesmo jeito, mas agora a tela
      // diz POR QUE ele sumiu.
      setFechDados(null);
      setSnap(null);
      setFechErro(err?.message || "Falha ao carregar a apuração desta competência.");
      feedback?.notifyError?.(err?.message || "Falha ao carregar a apuração desta competência.");
      // eslint-disable-next-line no-console
      console.error("[apuracao-v2] falha ao carregar a apuração", { companyId, competencia, err });
    } finally {
      setFechLoading(false);
    }
  }, [api, companyId, competencia, feedback]);

  // ⚠ LER NÃO GERA. Abrir a aba mostra a FOTO SALVA (ou o vazio, com o botão) — um GET que gerasse
  // recalcularia a competência inteira a cada visita, e o relatório tem data de geração impressa.
  const carregarRelatorio = useCallback(async () => {
    if (!api?.getRelatorioFaturamento || !companyId || !/^\d{4}-\d{2}$/.test(competencia)) return;
    setRelatorioLoading(true);
    try {
      const out = await api.getRelatorioFaturamento(companyId, competencia);
      if (out?.ok === false) throw new Error(out?.message || out?.error || "Falha ao ler o relatório");
      setRelatorio(out?.relatorio || null);
      setRelatorioErro(null);
    } catch (err) {
      setRelatorio(null);
      setRelatorioErro(err?.message || "Falha ao ler o relatório de faturamento salvo.");
    } finally {
      setRelatorioLoading(false);
    }
  }, [api, companyId, competencia]);

  async function gerarRelatorio() {
    if (!api?.gerarRelatorioFaturamento) return;
    setRelatorioGerando(true);
    try {
      const out = await api.gerarRelatorioFaturamento(companyId, competencia);
      if (out?.ok === false) throw new Error(out?.message || out?.error || "Falha ao gerar o relatório");
      setRelatorio(out?.relatorio || null);
      setRelatorioErro(null);
      feedback?.notifySuccess?.(`Relatório de faturamento de ${competencia} gerado e salvo.`);
    } catch (err) {
      setRelatorioErro(err?.message || "Falha ao gerar o relatório de faturamento.");
      feedback?.notifyError?.(err?.message || "Falha ao gerar o relatório de faturamento.");
    } finally {
      setRelatorioGerando(false);
    }
  }

  useEffect(() => {
    if (secao === "apuracao") carregarApuracao();
  }, [secao, carregarApuracao]);

  // O relatório também alimenta a leitura de "0 pendências" (o botão de classificação e o modal) — por isso ele é
  // carregado nas duas, e não só onde é desenhado.
  useEffect(() => {
    if (secao === "apuracao" || secao === "sugestao") carregarRelatorio();
  }, [secao, carregarRelatorio]);

  async function abrirRetificar() {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Reabrir a apuração de ${razao || "esta empresa"} (${competencia}) para RETIFICAR?\n\nVocê corrige os valores e retransmite uma declaração RETIFICADORA (substitui a anterior).`)) return;
    try {
      const r = await api.reabrirFechamento?.(companyId, competencia);
      if (r?.ok === false) throw new Error(r?.message || r?.error || "Falha ao reabrir");
      feedback?.notifySuccess?.("Apuração reaberta — corrija e clique em Transmitir/Retificar dentro do modal.");
      setFechando({ retificar: true });
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao reabrir para retificar");
    }
  }

  async function buscarExtrato() {
    setExtratoLoading(true);
    try {
      const out = await api.syncPgdasCircular?.(companyId, competencia);
      const r = out?.result || out;
      setExtrato(r || null);
      if (out?.ok === false) feedback?.notifyError?.(out?.message || "Falha ao buscar extrato.");
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao buscar extrato do Simples.");
    } finally {
      setExtratoLoading(false);
    }
  }

  // O PDF vem por blob autenticado, não por `<a href>`: a rota exige o token no header, e a URL
  // gravada no banco é `file:///…` quando o storage é LOCAL.
  async function abrirExtratoPdf(tipo) {
    try {
      const blob = await api.fetchPgdasPdfBlob?.(companyId, competencia, tipo);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "O arquivo não está mais no armazenamento.");
    }
  }

  // ── Sugestão (state no pai → sobrevive à troca de sub-aba) ─────────────
  const [sugData, setSugData] = useState(null);
  const [sugLoading, setSugLoading] = useState(false);
  const [sugErro, setSugErro] = useState(null);
  const [classificando, setClassificando] = useState(false);

  async function sugerir() {
    setSugLoading(true); setSugErro(null);
    try {
      const out = await panel.getSugestao(competencia);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      setSugData(out);
    } catch (e) {
      setSugErro(e?.message || "Erro"); setSugData(null);
    } finally { setSugLoading(false); }
  }

  async function classificar() {
    setClassificando(true);
    try {
      await panel.classificarV2({ competencia });
      if (sugData) await sugerir();
    } catch { /* o hook já exibe o erro via feedback */ }
    finally { setClassificando(false); }
  }

  const pendencias = panel.pendencias || [];
  const inputStyle = { background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 10px", fontSize: "0.85rem", colorScheme: "dark" };
  /* `btnPrimary`/`btnGhost` foram removidos: eram o `Button` redesenhado à mão com raio 6 e
     altura 31 — a mesma dupla primário/secundário, dois pixels fora. */

  const fat = fechDados?.faturamento || {};
  const estado = fechDados?.estado || snap?.estado;
  // ⚠ O KPI CARREGA A PROCEDÊNCIA. Era `dasRetornadoSerpro ?? dasCalculadoLocal` sob o rótulo
  // único "DAS apurado": o número do nosso motor e o da Receita saíam com o MESMO nome. Hoje o
  // backend separa os três (transmitido · simulado · nosso motor) e o rótulo diz qual é.
  // O estado "procedência ambígua" continua existindo — para os snapshots gravados ANTES da
  // separação, cuja procedência não pôde ser provada pela própria linha.
  const das = kpiDasApurado(snap);
  const extDados = extrato?.dados || extrato?.circular || null;
  const classificacao = estadoDaClassificacao({ pendencias, relatorio });

  return (
    // Q63: maxWidth sem margem automática colava o módulo à esquerda — centraliza como em Lançamentos.
    /* Era `maxWidth: 1100`. A aba tem as tabelas da memória de cálculo e a grade de PAs — em
       1100px elas rolavam na horizontal com meia tela vazia ao lado. Largura de trabalho (~90%). */
    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "var(--content-wide)", marginLeft: "auto", marginRight: "auto" }}>
      {/* ── APURAÇÃO — a página inteira, sem o terceiro nível de abas ──── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, color: PANEL.text }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
            {/* ⚠ Sem `input type="month"` aqui: quem troca a competência é o seletor do header, um
                só para a empresa inteira. O RÓTULO fica — ele diz sobre que mês esta barra fala,
                e sumir com ele deixaria os botões "Calcular / Fechar" sem período à vista. */}
            <span style={{ display: "grid", gap: 3, fontSize: "0.75rem", color: PANEL.muted }}>
              Competência
              <strong style={{ fontSize: "0.95rem", color: PANEL.text, paddingBottom: 4 }}>{competencia}</strong>
            </span>
            <span style={{ fontSize: "0.82rem", color: PANEL.muted, paddingBottom: 6 }}>Estado: <EstadoBadge estado={estado} /></span>
            <div style={{ flex: 1 }} />
            {/* ⚠ A PENDÊNCIA É NOMEADA, NÃO BLOQUEIA — e isso é decisão, não descuido.
                O caso CARO já é bloqueado onde importa: `motivoCalcularBloqueado`
                (`apuracao/components/FechamentoModal.jsx`) impede a chamada PAGA ao SERPRO quando
                as atividades somam zero, com o motivo no `title`. Desabilitar aqui deixaria a
                empresa com pendência crônica sem saída pela tela — o botão é a única porta para o
                modal, que é onde se resolve. Então o que faltava não era a trava: era o contador
                saber, ANTES de clicar, que há pendência aberta e quantas. */}
            {/* ⚠⚠ ELE RENDERIZA SEMPRE, E ISSO É O QUE SALVA A LEITURA DE TRÊS ESTADOS.
                Ele era condicionado à existência de pendência, e funcionava porque a seção Sugestão estava ali ao
                lado para mostrar o resto. Com a seção virando modal, este botão passou a ser a
                ÚNICA porta: mantido o `> 0`, a resposta *"nenhuma pendência aberta — e isso ainda
                NÃO quer dizer classificada"* (`estadoDaClassificacao`, o caso de 16.153/16.153
                itens sem `tipoReceita` em produção) ficaria sem nenhum lugar na tela. Lista vazia
                se leria como trabalho concluído, que é exatamente o que aquela regra existe para
                impedir.
                ⚠ Rótulo e tom saem da MESMA leitura que o modal usa — não há segundo texto. */}
            {(() => {
              const { cor, fundo } = CORES_TOM_RELATORIO[classificacao.tom];
              return (
                <button type="button" onClick={() => setSugestaoAberta(true)}
                  title={classificacao.detalhe}
                  style={{
                    background: fundo, border: `1px solid ${cor}`, color: cor,
                    borderRadius: "var(--radius-sm)", cursor: "pointer",
                    padding: "6px 10px", fontSize: "0.78rem", fontWeight: 600, marginBottom: 2,
                  }}>
                  {classificacao.tom === "ok" ? "✓ " : "⚠ "}{classificacao.rotulo}
                </button>
              );
            })()}
            <Button onClick={() => setFechando({ retificar: false })} disabled={fechLoading}>
              {estado === "aberta" || !estado ? "Calcular / Fechar" : "Revisar / Fechar"}
            </Button>
            {estado === "transmitida" && (
              <Button variant="secondary" onClick={abrirRetificar} title="Reabrir para corrigir e retransmitir como retificadora.">
                🔄 Retificar
              </Button>
            )}
          </div>

          {/* Faturamento + valor apurado (a prévia completa — CNAEs/alíquota/DAS — sai no modal ao Calcular). */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Kpi label="Fat. interno" value={`${fmtMoney(fat.interno)}`} />
            <Kpi label="Fat. externo" value={`${fmtMoney(fat.externo)}`} />
            <Kpi label="Receita 12 meses" title={`${RBT12_NOME} (RBT12)`} value={`${fmtMoney(fechDados?.rbt12)}`} />
            <Kpi
              label={das.label}
              title={das.titulo}
              value={das.valor != null ? `${fmtMoney(das.valor)}` : "—"}
              // Procedência ambígua não ganha a cor de categoria do Simples: âmbar diz que há uma
              // pergunta em aberto sobre o número.
              cor={das.procedencia === "ambigua" ? "var(--state-warn)" : "var(--accent-cyan)"}
            />
          </div>

          {/* ⚠ ERRO ≠ AUSÊNCIA. Sem esta caixa, uma falha de backend deixava os KPIs em "—" com a
              tela inteira parecendo uma empresa sem faturamento. */}
          {fechErro && !fechLoading && (
            <div style={{ padding: 10, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)", borderRadius: 8, color: "var(--state-danger)", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: 1, minWidth: 240 }}>
                ⚠ Os dados da apuração não puderam ser carregados: {fechErro}
                <div style={{ color: PANEL.muted, marginTop: 2 }}>
                  Os valores acima estão vazios por falha de leitura — isto <strong>não</strong> quer
                  dizer que a competência esteja sem faturamento.
                </div>
              </span>
              <Button variant="secondary" onClick={carregarApuracao} disabled={fechLoading}>Tentar de novo</Button>
            </div>
          )}
          {/* ⚠ ESTA FAIXA É A TELA DOS "TRÊS MESES DEPOIS".
              Uma competência fechada como EMPRESA ZERADA não passa pelo `estado` da apuração (não
              há snapshot: 190 competências zeradas em produção, 190 sem snapshot), então a linha
              "Estado: pendente" acima é tudo o que ela mostrava — indistinguível de um mês que
              ninguém tocou, e mais ainda de um mês entregue. Aqui a competência diz o que é: zerada
              do nosso lado, e ONDE está a declaração (entregue por aqui · entregue fora · devendo).
              A regra é a mesma do modal, importada — não reescrita. */}
          {fechDados?.semFaturamento && (() => {
            const entrega = entregaPgdasDoFechamento(fechDados);
            const { cor, fundo } = CORES_TOM[entrega.tom];
            return (
              <div style={{ padding: 10, background: fundo, border: `1px solid ${cor}`, borderRadius: 8, color: cor, fontSize: "0.82rem", display: "flex", flexDirection: "column", gap: 3 }}>
                <strong>
                  Empresa zerada nesta competência
                  {fechDados?.semFaturamentoEm ? ` (marcada em ${fmtDate(fechDados.semFaturamentoEm)})` : ""}
                  {" · "}
                  {entrega.provada ? "✓" : "⚠"} {entrega.rotulo}
                </strong>
                <span style={{ color: PANEL.muted }}>{entrega.detalhe}</span>
              </div>
            );
          })()}
          {/* ⚠ O TEXTO DIZIA "aba Cadastro", E ESSA ABA NÃO EXISTE MAIS COM ESSE NOME. A sub-aba
              foi renomeada para **Perfil fiscal** justamente porque "Cadastro" já era o grupo de
              abas da empresa E a tela de ficha (ver `SecaoTabs` acima) — o contador ia procurar na
              aba errada. ⚠ Mudou só o TEXTO: a chave `"cadastro"` continua a mesma, porque é ela
              que circula na navegação, e o app não tem `<Route>` — o despacho é cadeia de `if`, e
              trocar a chave quebraria em silêncio. */}
          {fechDados?.cadastroCompleto === false && (
            <Aviso compacto tom="atencao" titulo="Cadastro fiscal incompleto">
              A empresa está sem CNAE. Ajuste em <strong>Empresa → Perfil fiscal</strong> antes de fechar.
              <div style={{ marginTop: "var(--space-2)" }}>
                {/* ⚠ Era `onClick={() => setSecao("cadastro")}` — trocava a seção interna, que não
                    existe mais. Virou LINK DE VERDADE, no mesmo padrão da engrenagem da aba Notas
                    Fiscais: `href` de `companyTabPath` (a MESMA fonte da navegação das abas) +
                    `oNavegadorAssumeOClique`, então Ctrl+clique abre em nova guia e o clique
                    simples navega por dentro do app.
                    ⚠ É `<a>` com as classes do botão único, e NÃO `<Button as="a">`: `Button`
                    renderiza `<button>` sempre, e um `href` ali viraria atributo inválido — link
                    que não navega. O precedente é `renderNotasFiscaisTab.jsx:214`. */}
                <a
                  className="btn btn-secondary btn-sm"
                  href={companyTabPath(companyId, "perfilFiscal")}
                  style={{ textDecoration: "none" }}
                  onClick={(event) => {
                    if (oNavegadorAssumeOClique(event)) return;
                    event.preventDefault();
                    onAbrirPerfilFiscal?.();
                  }}
                >
                  Abrir Perfil fiscal
                </a>
              </div>
            </Aviso>
          )}

          {/* ⚠⚠ A TABELA DO ANEXO — o pedido do dono ("sem tabela do anexo"). Ela fica AQUI, logo
              abaixo dos KPIs e antes do relatório, porque a pergunta que ela responde ("em que
              faixa esta empresa está?") se lê junto do RBT12 e do DAS, que estão nos KPIs acima.
              ⚠ `folha12m` vem do snapshot e pode ser NULA — é `null` que faz a regra dizer "depende
              do Fator R" em vez de escolher o Anexo III sozinha. Não trocar por `|| 0`. */}
          <TabelaAnexoReferencia
            atividades={fechDados?.atividades}
            rbt12={fechDados?.rbt12}
            folha12m={snap?.folha12m}
          />

          {/* ⚠ O RELATÓRIO DE FATURAMENTO — pedido do dono: exibido ao calcular, SALVO, e visível
              aqui. Ao abrir a aba mostra a foto salva (GET); gerar é um clique. Nem o GET nem o
              POST chamam ADN/SEFAZ/SERPRO, e o POST não persiste `ApuracaoSnapshot`.
              `imprimivel={!fechando}`: só pode existir UM `data-print-area` por página, e com o
              modal aberto quem imprime é o de dentro dele. */}
          <RelatorioFaturamentoPanel
            relatorio={relatorio}
            loading={relatorioLoading}
            gerando={relatorioGerando}
            erro={relatorioErro}
            onGerar={gerarRelatorio}
            imprimivel={!fechando}
          />

          {/* Extrato do Simples — o que realmente foi pra Receita (conferência). */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: "0.9rem" }}>Extrato do Simples Nacional</strong>
              <Button variant="secondary" onClick={buscarExtrato} disabled={extratoLoading}>
                {extratoLoading ? "Buscando…" : "Buscar extrato"}
              </Button>
            </div>
            {extDados && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <Kpi label="Receita bruta" value={`${fmtMoney(extDados.receitaBruta)}`} />
                <Kpi label="DAS (Receita)" value={`${fmtMoney(extDados.dasTotal ?? extDados.impostoApurado)}`} cor="var(--accent-cyan)" />
                {/* ⚠ Estes dois botões existiam e NUNCA apareciam: liam `files.declaracaoUrl`, e o
                    backend devolve `files.declaracaoFileId`. O campo errado é sempre `undefined`,
                    então a condição nunca era verdadeira — botão escrito, nunca renderizado.
                    E não dá para usar a URL mesmo quando ela existe: com o provider LOCAL ela é
                    `file:///…`. Quem serve o arquivo é a rota `/pgdas/:competencia/pdf`, com o
                    token no header — por isso blob, não `<a href>`. */}
                {extrato?.files?.declaracaoFileId && (
                  <Button type="button" variant="secondary" onClick={() => abrirExtratoPdf("declaracao")}>Declaração (PDF)</Button>
                )}
                {extrato?.files?.reciboFileId && (
                  <Button type="button" variant="secondary" onClick={() => abrirExtratoPdf("recibo")}>Recibo (PDF)</Button>
                )}
              </div>
            )}
          </div>
      </div>

      {/* ⚠ A seção CADASTRO saiu daqui e virou a aba **Perfil fiscal**, do grupo Empresa
          (`renderPerfilFiscalTab.jsx`). Junto com ela foi consertado o default que imprimia
          "Simples Nacional" para empresa SEM REGIME cadastrado — ausência de dado virando
          afirmação, em verde, que nesta casa quer dizer concluído. */}

      {/* ⚠ A seção SUGESTÃO saiu daqui e virou MODAL (`components/SugestaoModal.jsx`), aberto
          pelo botão de pendências da barra acima — que já era a porta natural dela. Modal, e não
          painel embutido, porque esta página é impressa (`data-print-area`) e só pode haver UM por
          página: a classificação não fala do relatório de faturamento. */}
      {sugestaoAberta && (
        <SugestaoModal
          competencia={competencia}
          pendencias={pendencias}
          classificacao={classificacao}
          sugerir={sugerir}
          sugLoading={sugLoading}
          classificar={classificar}
          classificando={classificando}
          sugErro={sugErro}
          sugData={sugData}
          SugestaoAnexoTabela={SugestaoAnexoTabela}
          onClassificarPendencia={(p) => { setResolvendo(p); setSugestaoAberta(false); }}
          onClose={() => setSugestaoAberta(false)}
        />
      )}

      {/* Modal de fechamento reusado (calcular/fechar/transmitir/retificar). */}
      {fechando && api && (
        <FechamentoModal
          api={api}
          feedback={feedback}
          portalClientId={companyId}
          razao={razao}
          competencia={competencia}
          retificar={fechando.retificar === true}
          onClose={() => setFechando(null)}
          onChanged={() => carregarApuracao()}
        />
      )}

      {resolvendo && (
        <ResolverPendenciaModal
          pendencia={resolvendo}
          saving={panel.saving}
          onClose={() => setResolvendo(null)}
          onResolver={async (payload) => {
            await panel.resolverPendencia(resolvendo.id, payload);
            setResolvendo(null);
          }}
        />
      )}
    </div>
  );
}
