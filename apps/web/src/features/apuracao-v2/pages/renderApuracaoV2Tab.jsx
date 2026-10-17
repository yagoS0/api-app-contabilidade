import { HistoricoPgdas } from "../components/HistoricoPgdas";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rotuloEstadoApuracao, RBT12_NOME } from "../../../lib/vocabulario";

import { PANEL, fmtDate, fmtMoney } from "../../notas/components/notasStyles.shared.js";
import { ResolverPendenciaModal } from "../components/ResolverPendenciaModal";
import { SugestaoAnexoTabela } from "../components/SugestaoAnexoPanel";
import { SugestaoModal } from "../components/SugestaoModal";
import { baseTabelaAnexo } from "../lib/baseTabelaAnexo";
import { ComparacaoTributaria } from "../components/ComparacaoTributaria";
import { TabelaAnexoReferencia } from "../components/TabelaAnexoReferencia";
import { FechamentoModal } from "../../apuracao/components/FechamentoModal";
import { entregaPgdasDoFechamento, CORES_TOM } from "../../apuracao/lib/entregaPgdas";
import { RelatorioFaturamentoPanel } from "../components/RelatorioFaturamentoPanel";
import { estadoDaClassificacao, kpiDasApurado } from "../lib/relatorioFaturamento";
import { companyTabPath } from "../../companies/detail/lib/rotasDaEmpresa";
import { oNavegadorAssumeOClique } from "../../../components/ui/cliqueDeLink";
import { Aviso } from "../../../components/ui/Aviso";
import { Modal } from "../../../components/ui/Modal";
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
  return <span style={{ color: cor, fontWeight: 600 }}>{rotuloEstadoApuracao(estado)}</span>;
}

// ⚠ `SecaoTabs` MORREU AQUI em 24/08/2026 — ver o cabeçalho. Ela desenhava a TERCEIRA barra de abas
// empilhada na mesma tela, e o comentário que ela carregava já denunciava o problema: *"três barras
// de aba empilhadas na mesma tela"*. Não é para voltar; se um conteúdo novo precisar de lugar, ele
// é seção da página (com título) ou aba de verdade, com URL.

function Kpi({ label, value, cor, title }) {
  return (
    <div title={title} style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ fontSize: "0.875rem", color: PANEL.muted }}>{label}</div>
      <div style={{ fontSize: "1.05rem", fontWeight: 600, color: cor || PANEL.text, fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

export function ApuracaoV2Tab({
  panel, api, companyId, feedback, razao, myRole,
  competencia: competenciaGlobal,
  // ⚠ Quem navega é a PÁGINA (ela tem o `switchTab`); esta aba só sabe para onde. Sem o retorno
  // de chamada o `<a href>` continua funcionando — só recarrega a página inteira em vez de navegar
  // por dentro do app.
  onAbrirPerfilFiscal = null,
}) {
  // ⚠ Era `const [secao, setSecao] = useState("apuracao")` — o estado do terceiro nível de abas.
  // Sobrou só a pergunta que ele de fato respondia: a classificação está aberta ou não.
  const [relatorioAberto, setRelatorioAberto] = useState(false);
  const [sugestaoAberta, setSugestaoAberta] = useState(false);
  const [resolvendo, setResolvendo] = useState(null);
  // ⚠ A COMPETÊNCIA É DA EMPRESA, não desta aba — vem do seletor do header.
  // Era `useState(competenciaAnterior())`: sair de Lançamentos em maio e entrar aqui mostrava
  // junho, sem nada indicar a troca. A apuração é o ato fiscal do mês; apurar a competência errada
  // por causa de dois seletores discordando é o erro mais caro que esta tela pode produzir.
  // O fallback local cobre a aba montada fora da página de detalhe (não há chamador assim hoje).
  const competencia = competenciaGlobal || competenciaAnterior();

  const contexto = useMemo(() => ({ companyId, competencia }), [companyId, competencia]);
  const contextoAtual = useRef(contexto);
  contextoAtual.current = contexto;
  useEffect(() => {
    contextoAtual.current = contexto;
    return () => { if (contextoAtual.current === contexto) contextoAtual.current = null; };
  }, [contexto]);

  // ── Apuração (fechamento) ─────────────────────────────────────────────
  const [fechDados, setFechDados] = useState(null);
  const [fechLoading, setFechLoading] = useState(false);
  const [fechErro, setFechErro] = useState(null);
  const leituraApuracao = useRef(0);
  const [snap, setSnap] = useState(null);
  const [fechando, setFechando] = useState(null); // { retificar } → abre o FechamentoModal
  const [confirmarRetificacao, setConfirmarRetificacao] = useState(false);
  const [motivoRetificacao, setMotivoRetificacao] = useState('');
  const [reabrindo, setReabrindo] = useState(false);
  const reaberturaEmCurso = useRef(false);
  const reaberturaConfirmada = useRef(null);
  const [aguardandoReleitura, setAguardandoReleitura] = useState(false);
  // Extrato do Simples (o que realmente foi pra Receita) — botão explícito (bate no SERPRO).
  const [extrato, setExtrato] = useState(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [extratoLoading, setExtratoLoading] = useState(false);
  // Relatório de faturamento salvo desta competência (GET; nunca gera sozinho).
  const [relatorio, setRelatorio] = useState(null);
  const [relatorioLoading, setRelatorioLoading] = useState(false);
  const [relatorioGerando, setRelatorioGerando] = useState(false);
  const [relatorioErro, setRelatorioErro] = useState(null);

  const carregarApuracao = useCallback(async () => {
    if (!api || !companyId || !/^\d{4}-\d{2}$/.test(competencia)) return;
    const leitura = ++leituraApuracao.current;
    setFechLoading(true);
    try {
      if (typeof api.getFechamento !== 'function') throw new Error('Leitura da apuração indisponível.');
      const [fech, snapshot] = await Promise.all([
        api.getFechamento(companyId, competencia),
        api.getApuracaoSnapshot?.(companyId, competencia).catch(() => null),
      ]);
      if (contextoAtual.current !== contexto || leitura !== leituraApuracao.current) return;
      if (!fech || fech.ok === false) throw new Error(fech?.message || fech?.error || 'Resposta da apuração indisponível.');
      const dados = fech?.dados || fech;
      if (reaberturaConfirmada.current === contexto && dados?.estado !== 'aberta') {
        throw new Error('A leitura ainda não confirma a competência aberta.');
      }
      setFechDados(dados);
      setExtrato((fech?.dados || fech)?.entregaPgdas?.extratoSalvo || null);
      setSnap(snapshot?.snapshot || snapshot || null);
      setFechErro(null);
      if (reaberturaConfirmada.current === contexto) {
        reaberturaConfirmada.current = null;
        setAguardandoReleitura(false);
        feedback?.notifySuccess?.("Apuração reaberta para retificação.");
        setFechando({ retificar: true });
      }
    } catch (err) {
      if (contextoAtual.current !== contexto || leitura !== leituraApuracao.current) return;
      // ⚠ FALHA DE BACKEND NÃO PODE SE PARECER COM "EMPRESA SEM FATURAMENTO".
      //
      // Era `catch { setFechDados(null); }`: sem `notifyError`, sem log, sem estado de erro. Os
      // KPIs renderizavam "—" e a competência ficava indistinguível de um mês zerado — que é
      // justamente a leitura que a tela toda existe para não deixar acontecer (a mesma classe do
      // zero fabricado e do "0 pendências" verde). O dado some do mesmo jeito, mas agora a tela
      // diz POR QUE ele sumiu.
      setFechDados(null);
      setSnap(null);
      setFechErro(reaberturaConfirmada.current === contexto
        ? `Reabertura confirmada; falta conferir o estado atualizado. ${err?.message || 'Falha de leitura.'}`
        : err?.message || "Falha ao carregar a apuração desta competência.");
      feedback?.notifyError?.(err?.message || "Falha ao carregar a apuração desta competência.");
      // eslint-disable-next-line no-console
      console.error("[apuracao-v2] falha ao carregar a apuração", { companyId, competencia, err });
    } finally {
      if (contextoAtual.current === contexto && leitura === leituraApuracao.current) setFechLoading(false);
    }
  }, [api, companyId, competencia, contexto, feedback]);

  // ⚠ LER NÃO GERA. Abrir a aba mostra a FOTO SALVA (ou o vazio, com o botão) — um GET que gerasse
  // recalcularia a competência inteira a cada visita, e o relatório tem data de geração impressa.
  const carregarRelatorio = useCallback(async () => {
    if (!api?.getRelatorioFaturamento || !companyId || !/^\d{4}-\d{2}$/.test(competencia)) return;
    setRelatorioLoading(true);
    try {
      const out = await api.getRelatorioFaturamento(companyId, competencia);
      if (contextoAtual.current !== contexto) return;
      if (out?.ok === false) throw new Error(out?.message || out?.error || "Falha ao ler o relatório");
      setRelatorio(out?.relatorio || null);
      setRelatorioErro(null);
    } catch (err) {
      if (contextoAtual.current !== contexto) return;
      setRelatorio(null);
      setRelatorioErro(err?.message || "Falha ao ler o relatório de faturamento salvo.");
    } finally {
      if (contextoAtual.current === contexto) setRelatorioLoading(false);
    }
  }, [api, companyId, competencia, contexto]);

  async function gerarRelatorio() {
    if (!api?.gerarRelatorioFaturamento) return;
    setRelatorioGerando(true);
    try {
      const out = await api.gerarRelatorioFaturamento(companyId, competencia);
      if (contextoAtual.current !== contexto) return;
      if (out?.ok === false) throw new Error(out?.message || out?.error || "Falha ao gerar o relatório");
      setRelatorio(out?.relatorio || null);
      setRelatorioErro(null);
      feedback?.notifySuccess?.(`Relatório de faturamento de ${competencia} gerado e salvo.`);
    } catch (err) {
      if (contextoAtual.current !== contexto) return;
      setRelatorioErro(err?.message || "Falha ao gerar o relatório de faturamento.");
      feedback?.notifyError?.(err?.message || "Falha ao gerar o relatório de faturamento.");
    } finally {
      if (contextoAtual.current === contexto) setRelatorioGerando(false);
    }
  }

  // ⚠⚠ ESTES DOIS EFEITOS AINDA LIAM `secao`, QUE DEIXOU DE EXISTIR — e o resultado foi
  // `ReferenceError: secao is not defined` **em produção**, com a aba Apuração inteira caindo no
  // ErrorBoundary. (Relatado pelo dono em 25/08/2026, logo depois do deploy.)
  //
  // ⚠ O terceiro nível de abas foi removido: não há mais "seção", a aba SEMPRE mostra a apuração.
  // Então a condição não tem mais o que decidir — some, e o efeito passa a rodar sempre.
  //
  // ⚠⚠ POR QUE NADA PEGOU ISSO: `ReferenceError` é erro de RUNTIME. O `npm run build` compila sem
  // reclamar (o bundler não resolve identificadores livres) e o `npm test` não monta esta aba. É
  // exatamente a lacuna que o `apps/web/CLAUDE.md` já nomeia para o JSX — só que aqui nem o build
  // salva. Quem pegaria é o ESLint com `no-undef`, ou um teste que monte o componente.
  useEffect(() => {
    setExtrato(null); setFechDados(null); setSnap(null); setSugData(null); setSugErro(null); setSugLoading(false);
    setExtratoLoading(false);
    carregarApuracao();
  }, [carregarApuracao]);

  // O relatório também alimenta a leitura de "0 pendências" (o botão de classificação e o modal) — por isso ele é
  // carregado sempre, e não só onde é desenhado.
  useEffect(() => {
    setRelatorio(null); setRelatorioErro(null); setRelatorioGerando(false);
    setSugestaoAberta(false); setResolvendo(null); setClassificando(false);
    carregarRelatorio();
  }, [carregarRelatorio]);

  useEffect(() => {
    reaberturaEmCurso.current = false; reaberturaConfirmada.current = null;
    setReabrindo(false); setAguardandoReleitura(false); setConferindoEnvio(false);
    setFechando(null); setConfirmarRetificacao(false); setRelatorioAberto(false); setHistoricoAberto(false); }, [contexto]);
  const [conferindoEnvio, setConferindoEnvio] = useState(false);
  async function conferirEnvio() {
    if (conferindoEnvio) return;
    setConferindoEnvio(true);
    try {
      const out = await api.conferirTransmissaoFechamento(companyId, competencia);
      if (contextoAtual.current !== contexto) return;
      if (!out?.ok) throw new Error(out?.message || 'Falha ao conferir envio');
      if (out.result?.confirmada) feedback?.notifySuccess?.(out.result.mensagem);
      else feedback?.notifyError?.(out.result?.mensagem || 'Entrega ainda não confirmada.');
      await carregarApuracao();
    } catch (err) { if (contextoAtual.current === contexto) feedback?.notifyError?.(err?.message || 'Falha ao conferir envio'); }
    finally { if (contextoAtual.current === contexto) setConferindoEnvio(false); }
  }

  async function abrirRetificar() {
    if (reaberturaEmCurso.current || reaberturaConfirmada.current === contexto || !motivoRetificacao.trim()) return;
    reaberturaEmCurso.current = true;
    setReabrindo(true);
    try {
      if (typeof api?.reabrirFechamento !== 'function') throw new Error('Reabertura indisponível. Atualize a página e tente novamente.');
      const r = await api.reabrirFechamento(companyId, competencia, motivoRetificacao.trim());
      if (contextoAtual.current !== contexto) return;
      if (r?.ok !== true || r?.result?.snapshot?.estado !== 'aberta') throw new Error(r?.message || r?.error || "Não foi possível confirmar a reabertura. Confira o estado antes de tentar novamente.");
      reaberturaConfirmada.current = contexto;
      setAguardandoReleitura(true);
      setConfirmarRetificacao(false);
      await carregarApuracao();
    } catch (err) {
      if (contextoAtual.current === contexto) feedback?.notifyError?.(err?.message || "Falha ao reabrir para retificar");
    } finally {
      if (contextoAtual.current === contexto) {
        reaberturaEmCurso.current = false;
        setReabrindo(false);
      }
    }
  }

  async function buscarExtrato(atualizar = false) {
    setExtratoLoading(true);
    try {
      const out = await api.syncPgdasCircular?.(companyId, competencia, { atualizar });
      if (contextoAtual.current !== contexto) return;
      if (out?.ok === false) throw new Error(out?.message || "Falha ao buscar extrato.");
      const r = out?.result || out;
      setExtrato(r || null);
    } catch (err) {
      if (contextoAtual.current !== contexto) return;
      feedback?.notifyError?.(err?.message || "Falha ao buscar extrato do Simples.");
    } finally {
      if (contextoAtual.current === contexto) setExtratoLoading(false);
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
      if (contextoAtual.current !== contexto) return;
      if (!out?.ok) throw new Error(out?.message || "Falha");
      setSugData(out);
    } catch (e) {
      if (contextoAtual.current !== contexto) return;
      setSugErro(e?.message || "Erro"); setSugData(null);
    } finally { if (contextoAtual.current === contexto) setSugLoading(false); }
  }

  async function classificar(opcoes = {}) {
    setClassificando(true);
    try {
      await panel.classificarV2({ competencia, ...opcoes });
      if (contextoAtual.current !== contexto) return;
      await Promise.all([carregarApuracao(), gerarRelatorio()]);
      if (contextoAtual.current === contexto && sugData) await sugerir();
    } finally { if (contextoAtual.current === contexto) setClassificando(false); }
  }

  const pendencias = panel.pendencias || [];

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
  const classificacaoAlterada = String(snap?.idempotencyKey || '').startsWith('reclassificada:');
  const calculoDesatualizado = classificacaoAlterada || Boolean(fechDados?.calculoSalvo && !fechDados?.calculoRecuperavel && fechDados?.calculoRecuperacaoMotivo);
  const motivoCalculoDesatualizado = classificacaoAlterada
    ? 'A classificação foi alterada. O DAS exibido pertence ao cálculo anterior; calcule novamente antes de fechar ou transmitir.'
    : fechDados?.calculoRecuperacaoMotivo;
  const baseCarga = Number(fat.interno) + Number(fat.externo);
  const cargaCalculada = !calculoDesatualizado && das.valor != null && Number.isFinite(baseCarga) && baseCarga > 0
    ? `${(Number(das.valor) / baseCarga * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—";
  const extDados = extrato?.dados || extrato?.circular || null;
  const classificacao = estadoDaClassificacao({ pendencias, relatorio });

  return (
    // Q63: maxWidth sem margem automática colava o módulo à esquerda — centraliza como em Lançamentos.
    /* Era `maxWidth: 1100`. A aba tem as tabelas da memória de cálculo e a grade de PAs — em
       1100px elas rolavam na horizontal com meia tela vazia ao lado. Largura de trabalho (~90%). */
    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "var(--content-wide)", marginLeft: "auto", marginRight: "auto" }}>
      {/* ── APURAÇÃO — a página inteira, sem o terceiro nível de abas ──── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, color: PANEL.text }}>
          <section aria-label="Resumo e ações da competência" style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
            {/* ⚠ Sem `input type="month"` aqui: quem troca a competência é o seletor do header, um
                só para a empresa inteira. O RÓTULO fica — ele diz sobre que mês esta barra fala,
                e sumir com ele deixaria os botões "Calcular / Fechar" sem período à vista. */}
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <span style={{ display: "grid", gap: 3, fontSize: "0.875rem", color: PANEL.muted }}>
              Competência
              <strong style={{ fontSize: "0.95rem", color: PANEL.text }}>{competencia}</strong>
              <span style={{ fontSize: "0.8rem" }}><EstadoBadge estado={estado} />{extDados ? " · Extrato salvo" : ""}</span>
            </span>


              {!extDados && <Button variant="secondary" onClick={() => buscarExtrato()} disabled={extratoLoading || fechLoading}>{extratoLoading ? "Buscando…" : "Buscar extrato"}</Button>}
              <Button variant="secondary" onClick={() => buscarExtrato(true)} disabled={extratoLoading} title="Faz nova consulta paga para atualizar a declaração salva.">Atualizar na Receita</Button>
              {extrato?.files?.declaracaoFileId && <Button variant="secondary" onClick={() => abrirExtratoPdf("declaracao")}>Declaração (PDF)</Button>}
              {extrato?.files?.reciboFileId && <Button variant="secondary" onClick={() => abrirExtratoPdf("recibo")}>Recibo (PDF)</Button>}
              <Button variant="secondary" onClick={() => setHistoricoAberto(true)} disabled={extratoLoading}>Histórico PGDAS-D</Button>
              {historicoAberto && <HistoricoPgdas key={`${companyId}:${competencia}`} api={api} companyId={companyId} competencia={competencia} onClose={() => setHistoricoAberto(false)} onAtualizado={setExtrato} bloqueado={extratoLoading || ['transmitindo', 'erro_transmissao'].includes(estado)} />}
              <Button variant="secondary" onClick={() => setRelatorioAberto(true)}>Relatório de faturamento</Button>
            <Button onClick={() => setFechando({ retificar: false })} disabled={fechLoading || aguardandoReleitura || ['transmitindo', 'erro_transmissao'].includes(estado)}>
              {estado === "aberta" || !estado ? "Calcular / Fechar" : "Revisar / Fechar"}
            </Button>
            {estado === 'erro_transmissao' && <Button variant="secondary" onClick={conferirEnvio} disabled={conferindoEnvio}>Conferir envio na Receita</Button>}
            {estado === "transmitida" && (
              <Button variant="secondary" onClick={() => { setMotivoRetificacao(''); setConfirmarRetificacao(true); }} disabled={reabrindo || fechLoading || aguardandoReleitura} title="Reabrir apuração para retificar">
                Retificar
              </Button>
            )}
            </div>


          {/* Faturamento + valor apurado (a prévia completa — CNAEs/alíquota/DAS — sai no modal ao Calcular). */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(130px, 100%), 1fr))", gap: 10 }}>
            <Kpi label="Fat. interno" value={`${fmtMoney(fat.interno)}`} />
            <Kpi label="Fat. externo" value={`${fmtMoney(fat.externo)}`} />
            <Kpi label="Carga efetiva calculada" value={cargaCalculada}
              title={`${das.label} dividido pelo faturamento interno e externo desta competência. Não indica pagamento.${baseCarga > 0 ? "" : " Receita ausente ou zero: percentual indisponível."}`} />
            <Kpi label="Receita 12 meses" title={`${RBT12_NOME} (RBT12)`} value={`${fmtMoney(fechDados?.rbt12)}`} />
            <Kpi
              label={calculoDesatualizado ? "DAS salvo · revisar base" : das.label}
              title={das.titulo}
              value={das.valor != null ? `${fmtMoney(das.valor)}` : "—"}
              // Procedência ambígua não ganha a cor de categoria do Simples: âmbar diz que há uma
              // pergunta em aberto sobre o número.
              cor={das.procedencia === "ambigua" ? "var(--state-warn)" : "var(--accent-cyan)"}
            />
          </div>
          {calculoDesatualizado && <p role="status" style={{ margin: 0, fontSize: "0.875rem", color: "var(--state-warn)" }}>{motivoCalculoDesatualizado}</p>}
          </section>

          {/* ⚠ ERRO ≠ AUSÊNCIA. Sem esta caixa, uma falha de backend deixava os KPIs em "—" com a
              tela inteira parecendo uma empresa sem faturamento. */}
          {!(Number.isFinite(baseCarga) && baseCarga > 0) && <p style={{ margin: 0, color: PANEL.muted, fontSize: "0.875rem" }}>Receita ausente ou zero: percentual indisponível.</p>}
          {fechErro && !fechLoading && (
            <div role="alert" style={{ padding: 10, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)", borderRadius: 8, color: "var(--state-danger)", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
              A empresa está sem CNAE. Ajuste em <strong>Configurações da empresa → Perfil fiscal</strong> antes de fechar.
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
              A recuperação validada fornece atividades, RBT12 e folha da mesma simulação.
              Ausência de folha continua nula; não converter lista vazia em zero. */}
          <TabelaAnexoReferencia compacta {...baseTabelaAnexo(fechDados, snap)} onClassificar={() => setSugestaoAberta(true)} classificacao={classificacao} />
          <ComparacaoTributaria key={`${companyId}:${competencia}`} competencia={competencia}
            {...baseTabelaAnexo(fechDados, snap)}
            origem={fechDados?.rbt12Origem} receitaMensal={fat.interno}
            receitaExterna={fat.externo} />

      </div>

      {relatorioAberto && <Modal titulo={`Relatório de faturamento · ${competencia}`} tamanho="lg" aoFechar={() => setRelatorioAberto(false)}>
        <RelatorioFaturamentoPanel apuracaoAtual={snap} extratoSalvo={extrato} relatorio={relatorio}
          loading={relatorioLoading} gerando={relatorioGerando} erro={relatorioErro} onGerar={gerarRelatorio}
          onAbrirClassificacao={() => { setRelatorioAberto(false); setSugestaoAberta(true); }} imprimivel={!fechando} />
      </Modal>}

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

      {confirmarRetificacao && <Modal titulo="Reabrir apuração para retificar" tamanho="sm" ocupado={reabrindo} aoFechar={() => setConfirmarRetificacao(false)} rodape={<><Button variant="secondary" disabled={reabrindo} onClick={() => setConfirmarRetificacao(false)}>Cancelar</Button><Button disabled={reabrindo || !motivoRetificacao.trim()} onClick={abrirRetificar}>{reabrindo ? 'Reabrindo…' : 'Reabrir apuração'}</Button></>}>
        <p><strong>{razao || 'Empresa'}</strong> · {competencia}</p>
        <p>A declaração anterior permanece no histórico. Revise os valores antes de transmitir a retificadora.</p>
        <label style={{ display: 'grid', gap: 6 }}>Motivo<textarea value={motivoRetificacao} onChange={e => setMotivoRetificacao(e.target.value)} disabled={reabrindo} rows={3} maxLength={2000} /></label>
      </Modal>}
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
           onChanged={async (mudanca) => { await carregarApuracao(); if (mudanca?.relatorioGerado) await carregarRelatorio(); else await gerarRelatorio(); }}
        />
      )}

      {resolvendo && (
        <ResolverPendenciaModal
          pendencia={resolvendo}
          myRole={myRole}
          saving={panel.saving}
          onClose={() => setResolvendo(null)}
          onResolver={async (payload) => {
            await panel.resolverPendencia(resolvendo.id, payload);
            if (contextoAtual.current !== contexto) return;
            setResolvendo(null);
            await Promise.all([carregarApuracao(), gerarRelatorio()]);
          }}
        />
      )}
    </div>
  );
}
