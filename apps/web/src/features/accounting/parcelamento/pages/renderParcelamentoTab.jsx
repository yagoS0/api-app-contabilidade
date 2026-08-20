// Aba "Parcelamento" (grupo Contabilidade) — e, desde a F2.3, a PORTA DE ENTRADA do parcelamento.
//
// ⚠ A CRIAÇÃO INVERTEU. Antes o parcelamento nascia como efeito colateral de subir uma guia; hoje
// ele é um CONTRATO de dívida, criado aqui pelo botão "+ Novo parcelamento", sem documento nenhum.
// A guia é evidência MENSAL e OPCIONAL — não existe em débito automático nem nas prestações de um
// acordo migrado de outra contabilidade — e entra depois, pelo "+ Subir Guia → PARCELAMENTO".
//
// Esta aba também é onde as parcelas são acompanhadas: conferência, baixa, contas e rescisão. O ato
// contábil de cada domínio vive no lugar onde ele é acompanhado — tributos na Circular, parcelas
// aqui.
//
// Dados: hook useParcelamentos (accountingPanel.parcelamentos). Ele carrega sozinho no mount
// e recarrega após cada ação (rescindir/config/conferência/criação).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ParcelamentosList, ConferenciaParcelasPanel } from "../components/ParcelamentoModals";
import { ParcelamentoWizard } from "../components/ParcelamentoWizard";
import { BaixaManualParcelaModal } from "../components/BaixaManualParcelaModal";
import { DeclararComposicaoParcelaModal } from "../components/DeclararComposicaoParcelaModal";
import { InformarValorEmLoteModal } from "../components/InformarValorEmLoteModal";
import { ExclusaoParcelamentoModal, DesfazerRescisaoModal } from "../components/AtoParcelamentoModal";
import {
  rotuloDaSituacao, explicarRecusa, formatarMoeda,
  agruparBloqueiosDaFila, tituloDoGrupo, rotuloDoBloqueio,
} from "../lib/baixaManualParcela";
import { avisoForaDaFila } from "../lib/exclusaoParcelamento";
import { Button } from "../../../../components/ui/Button";
import { createApiClient } from "../../../../api/client";
// ⚠ O vencimento contratado da prestação é DATA CIVIL (meia-noite UTC). Lido no fuso do navegador
// ele saía um dia antes — e nesta MESMA linha o selo "Vencida"/"Vence hoje" vem do SERVIDOR, então
// a tela se contradizia sobre a mesma prestação. Os irmãos (`ParcelasDoAcordo`,
// `InformarValorEmLoteModal`, `ParcelamentoModals`) já liam em UTC; só esta ficou para trás.
import { fmtDataCivil } from "../../../../lib/format";

const PANEL = { text: "#F8F8F2", muted: "#A7B0C0", border: "#44475A", surface: "#21222C", field: "#282A36" };
const parcelaApi = createApiClient();

// ─── OS TRÊS ÁTOMOS DA REFORMA ────────────────────────────────────────────────────────────────
//
// ⚠ EXPLICAÇÃO DE SISTEMA NÃO OCUPA ESPAÇO DE DADO — palavras do dono. O que sai da linha e da
// moldura é a explicação REPETIDA; nenhum motivo, nenhuma linha e nenhuma capacidade saem junto.

/**
 * `ℹ` — a explicação que aparece UMA vez, e só quando pedida.
 *
 * ⚠ NÃO É `title`. `title` não existe em toque e não alcança quem navega por teclado, e este projeto
 * já pagou por isso em quatro telas ("o motivo em texto VISÍVEL, não só no `title`"). Aqui o ℹ é um
 * `<button>` de verdade: recebe foco, abre com Enter/Espaço, e o texto vira conteúdo na página —
 * com o `title` de brinde para quem passa o mouse. O que ele economiza é ESPAÇO PERMANENTE, não
 * acesso.
 */
function Explicacao({ children, rotulo = "O que isto quer dizer" }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={aberto}
        aria-label={rotulo}
        title={rotulo}
        onClick={() => setAberto((a) => !a)}
        style={{
          background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.muted,
          borderRadius: 999, cursor: "pointer", fontSize: "0.7rem", lineHeight: 1,
          width: 20, height: 20, padding: 0, flexShrink: 0, fontWeight: 700,
        }}
      >
        ℹ
      </button>
      {aberto && (
        <div style={{ flexBasis: "100%", color: PANEL.muted, fontSize: "0.74rem", lineHeight: 1.45, marginTop: 4 }}>
          {children}
        </div>
      )}
    </>
  );
}

/** Estado como BADGE CURTO — nunca texto colorido solto no meio da linha. */
function Badge({ cor, fundo, children, title }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-block", padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap",
        fontSize: "0.62rem", fontWeight: 700, color: cor, background: fundo, border: `1px solid ${cor}`,
      }}
    >
      {children}
    </span>
  );
}

/**
 * SEÇÃO VAZIA É UMA LINHA, NÃO UM BOX — pedido literal do dono.
 *
 * ⚠ E ELA CONTINUA DIZENDO O QUE "VAZIA" SIGNIFICA. A fila vazia nunca quis dizer "tudo pago": há
 * regras de quem entra e de quem não entra, e elas são INFORMAÇÃO. O que muda é o suporte — a
 * moldura, o título grande e o parágrafo permanente viram uma linha com `ℹ`. Ausência nunca é
 * resposta; ausência DIAGRAMADA COMO CARD é ruído.
 */
function SecaoVazia({ titulo, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "2px 2px" }}>
      <span style={{ color: PANEL.muted, fontSize: "0.78rem" }}>
        <strong style={{ color: PANEL.text, fontWeight: 600 }}>{titulo}:</strong> nenhuma.
      </span>
      <Explicacao>{children}</Explicacao>
    </div>
  );
}

// Uma formatação só para as DUAS filas — elas mostram valores lado a lado na mesma tela, e duas
// cópias divergiriam no primeiro ajuste de casas decimais.
const fmtMoney = formatarMoeda;

// Os motivos de RECUSA da baixa, cada um com a saída que o contador precisa.
const MOTIVOS_RECUSA = {
  ja_baixada: "esta parcela já tem lançamento de baixa.",
  provisao_inexistente: "o parcelamento não tem a provisão de abertura — lance a adesão antes.",
  // ⚠ ESTE TEXTO MUDOU, E TINHA DE MUDAR. Ele descrevia o beco sem dizer a saída, porque saída não
  // havia: a fila recusava, e a outra tela (a da prestação SEM guia) recusa toda prestação que TEM
  // guia. Guia de UPLOAD chega assim — medido em produção, o `extracted` de um `ExibirDAS-*.pdf`
  // traz só tipo/valor/vencimento/competência e `TributoParcela` vem ZERO —, então isto não é caso
  // de borda: é o caminho normal de quem sobe o PDF do DAS à mão. A saída agora existe e está no
  // botão ao lado, e o texto tem de dizê-la — um motivo sem saída é o contador parado.
  sem_composicao: "a parcela não tem composição por tributo, então o sistema não sabe separar "
    + "principal, juros e multa. Isso não impede mais a baixa: informe a composição você mesmo, "
    + "lendo o DAS, no botão ao lado.",
  // A declaração perdeu a corrida para o documento — e isso é o desenho, não uma falha.
  composicao_ja_existe: "a composição desta parcela apareceu (a busca do comprovante no SERPRO roda "
    + "sozinha). O documento vence a declaração: use “Dar baixa”, que os valores vêm de lá.",
  principal_invalido: "o principal informado não é um valor válido — ele é o que amortiza o passivo, "
    + "e não se inventa.",
  acrescimo_invalido: "juros ou multa não foram entendidos. Deixe em branco quando não houve.",
  acrescimo_negativo: "juros e multa não podem ser negativos.",
  comprovante_nao_e_parcela: "o documento arrecadado não é uma parcela deste parcelamento.",
  nao_e_parcela: "esta guia não pertence a um parcelamento.",
  guide_not_found: "guia não encontrada.",
  parcelamento_not_found: "parcelamento não encontrado.",
};

/**
 * ⚠ A RECUSA QUE TEM SAÍDA **NESTA** TELA — e ela é uma só.
 *
 * `sem_composicao` se resolve aqui (a decomposição é do contador, lendo o DAS); todas as outras se
 * resolvem em OUTRO lugar (lançar a adesão, estornar a baixa, conferir a guia). Só a primeira
 * habilita o botão de declarar — oferecê-lo nas demais prometeria uma ação que não resolve nada.
 * É a mesma fronteira que `corrigivelNaTela` desenha na fila de baixo.
 */
function composicaoDeclaravel(motivo) {
  return motivo === "sem_composicao";
}

/**
 * ⚠ AUSÊNCIA NUNCA É RESPOSTA. Este painel fazia `if (!carregando && parcelas.length === 0) return
 * null` sobre um `catch { setParcelas([]) }`: uma falha de rede produzia EXATAMENTE o mesmo pixel
 * que "não há nada pendente" — zero. O padrão certo já existia no módulo (`ParcelasDoAcordo`):
 * o motivo em texto VISÍVEL, não só no `title`.
 *
 * Os três estados são distintos agora: carregando · falhou (com o motivo e "Tentar de novo") ·
 * vazio de verdade (dito, não escondido).
 */
function ParcelasPendentesBaixa({ companyId, refreshKey = 0, pedido, onPedidoAtendido }) {
  const [parcelas, setParcelas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [lancando, setLancando] = useState(null);
  const [desfechos, setDesfechos] = useState({}); // guideId → { tom, texto }
  const [foco, setFoco] = useState(null);          // { id, label } destacado pela barra do card
  // ⚠ A LINHA CUJA COMPOSIÇÃO ESTÁ SENDO DECLARADA. Guardar a LINHA (e não só o id) é o que faz o
  // modal poder repetir competência, valor da guia e data do comprovante sem uma segunda chamada.
  const [declarando, setDeclarando] = useState(null);
  // guideId → true quando o servidor recusou por `sem_composicao`. É este conjunto que faz a saída
  // APARECER — a fila não sabe de antemão se a guia tem composição (a rota não devolve isso), e a
  // pergunta é respondida pelo próprio clique em "Dar baixa".
  const [semComposicao, setSemComposicao] = useState({});
  const secaoRef = useRef(null);

  const carregar = useCallback(async () => {
    if (!companyId) { setCarregando(false); return; }
    if (!parcelaApi?.listParcelasPendentesBaixa) {
      setErro("A fila de parcelas pendentes não está disponível neste modo de API.");
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      const out = await parcelaApi.listParcelasPendentesBaixa(companyId);
      setParcelas(Array.isArray(out?.parcelas) ? out.parcelas : []);
    } catch (err) {
      // ⚠ O `catch` NÃO zera mais a lista em silêncio: ele guarda o motivo e a tela o mostra.
      setErro(err?.message || "Não foi possível carregar as parcelas pendentes de baixa.");
    } finally { setCarregando(false); }
    // `refreshKey` recarrega quando um "Buscar pagamento" na linha da parcela localiza o
    // comprovante — é exatamente aí que a parcela ENTRA nesta lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, refreshKey]);

  useEffect(() => { carregar(); }, [carregar]);

  // ─── o que a barra de ações do card pede ──────────────────────────────────────────────────────
  // `Dar baixa` traz o contador ATÉ a fila (rolando e destacando); `Baixa em lote` roda todas as
  // pendentes daquele contrato, depois de uma confirmação que LISTA cada uma. Nenhum dos dois
  // inventa rota: os dois usam `POST /parcelamentos/parcelas/:guideId/baixa`, uma por parcela.
  useEffect(() => {
    if (!pedido) return;
    setFoco(pedido.parcelamentoId ? { id: pedido.parcelamentoId, label: pedido.label || null } : null);
    secaoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (pedido.lote) baixarEmLote(pedido.parcelamentoId);
    onPedidoAtendido?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido?.nonce]);

  function confirmacaoDaBaixa(p) {
    const quando = p.comprovante?.dataArrecadacao
      || (p.confirmadoEm ? new Date(p.confirmadoEm).toLocaleDateString("pt-BR") : "data do comprovante não conhecida");
    return `parcela ${p.numeroParcela ?? "?"} — competência ${p.competencia || "?"}, valor ${fmtMoney(p.valor)}, pagamento em ${quando}`;
  }

  // ⚠ `body` OPCIONAL — sem ele, é a baixa de sempre (a composição vem do documento). Com
  // `composicaoDeclarada`, é a MESMA rota recebendo a decomposição que o contador leu no DAS. Uma
  // função só, porque é um ato só: quem clica em qualquer um dos dois botões quer a mesma baixa.
  async function executarBaixa(p, body = null) {
    setDesfechos((d) => ({ ...d, [p.guideId]: null }));
    try {
      const out = await parcelaApi.lancarBaixaParcela(companyId, p.guideId, body);
      // ⚠ RECUSA NÃO É SUCESSO, E NÃO SOME. Antes o motivo saía num `window.alert` que desaparece
      // ao clicar OK; agora fica NA LINHA, como o `Desfecho` do `ParcelasDoAcordo` já fazia.
      if (out?.skipped) {
        // ⚠ A RECUSA VIRA A SAÍDA. `sem_composicao` deixa de ser um beco: ela LIGA o botão que
        // resolve o problema na própria linha, e a mensagem passa a apontá-lo. Sem esta marca o
        // botão não teria como aparecer — a fila não sabe de antemão quais guias têm composição.
        if (out.motivo === "sem_composicao") setSemComposicao((s) => ({ ...s, [p.guideId]: true }));
        // ⚠ E ela também DESLIGA: `composicao_ja_existe` significa que o documento chegou enquanto
        // a tela estava aberta. Deixar a saída acesa depois disso ofereceria uma declaração que o
        // servidor vai recusar de novo, para sempre.
        if (out.motivo === "composicao_ja_existe") {
          setSemComposicao((s) => ({ ...s, [p.guideId]: false }));
          setDeclarando(null);
        }
        setDesfechos((d) => ({
          ...d,
          [p.guideId]: { tom: "warn", texto: `Nada foi lançado: ${MOTIVOS_RECUSA[out.motivo] || out.motivo || "o servidor recusou."}` },
        }));
        // ⚠ A RECUSA PRECISA SUBIR PARA QUEM CHAMOU COM DECLARAÇÃO — o modal mostra o motivo dentro
        // dele e mantém o que foi digitado. Sem isto, ele fecharia anunciando sucesso sobre uma
        // baixa que não aconteceu. No caminho normal (sem `body`) nada é lançado, como antes.
        if (body) {
          const err = new Error(MOTIVOS_RECUSA[out.motivo] || out.motivo || "O servidor recusou a baixa.");
          err.motivo = out.motivo;
          throw err;
        }
        return;
      }
      if (out?.ok === false) throw new Error(out?.message || out?.error || "Falha ao lançar.");
      setSemComposicao((s) => ({ ...s, [p.guideId]: false }));
      setDesfechos((d) => ({
        ...d,
        [p.guideId]: {
          tom: "ok",
          // ⚠ O DESFECHO DIZ QUAL DAS DUAS VIAS FOI USADA. "Baixa lançada" nos dois casos apagaria,
          // na única tela onde o contador olha, a diferença que o razão preserva.
          texto: body?.composicaoDeclarada
            ? "Baixa lançada com a composição que você informou (o razão registra “composição declarada”)."
            : "Baixa lançada.",
        },
      }));
    } catch (err) {
      setDesfechos((d) => ({ ...d, [p.guideId]: { tom: "danger", texto: err?.message || "Falha ao lançar a baixa da parcela." } }));
      if (body) throw err;
    }
  }

  /**
   * O que o modal da composição declarada chama ao confirmar.
   *
   * ⚠ ELE NÃO TEM ROTA PRÓPRIA — é `executarBaixa` com o body preenchido, a MESMA chamada do botão
   * "Dar baixa" da linha. Duas portas para "dar baixa nesta guia" teriam duas guardas de
   * idempotência, e nenhuma enxergaria a outra: é literalmente o motivo pelo qual o servidor recusa
   * a prestação com guia na fila de baixo.
   */
  async function declararComposicao({ guideId, dataPagamento, composicaoDeclarada }) {
    const p = parcelas.find((x) => x.guideId === guideId) || declarando;
    if (!p) return;
    setLancando(guideId);
    try {
      await executarBaixa(p, { dataPagamento, composicaoDeclarada });
      setDeclarando(null);
      // ⚠ O DESFECHO SOBE PARA A SEÇÃO, e não é enfeite: a baixa TIRA a linha da fila, e o aviso
      // dela vive DENTRO da linha — recarregar apagaria a única confirmação de que algo aconteceu.
      // "Cliquei e não aconteceu nada" é literalmente a queixa que esta aba já pagou uma vez.
      setDesfechos((d) => ({
        ...d,
        __lote: {
          tom: "ok",
          texto: `Parcela ${p.numeroParcela ?? "?"} baixada com a composição que você informou `
            + "(o razão registra “composição declarada”).",
        },
      }));
      await carregar();
    } finally { setLancando(null); }
  }

  async function baixarEmLote(parcelamentoId) {
    const alvo = parcelas.filter((p) => !parcelamentoId || p.parcelamentoId === parcelamentoId);
    if (!alvo.length) {
      // ⚠ Nada a fazer TAMBÉM é resposta — e precisa ser dita, senão "cliquei e não aconteceu nada".
      setDesfechos((d) => ({ ...d, __lote: { tom: "warn", texto: "Nenhuma parcela paga deste contrato está aguardando lançamento." } }));
      return;
    }
    const lista = alvo.map((p) => `· ${confirmacaoDaBaixa(p)}`).join("\n");
    // eslint-disable-next-line no-alert
    if (!window.confirm(
      `Dar baixa em ${alvo.length} parcela(s):\n\n${lista}\n\n`
      + "Cada uma GRAVA lançamentos contábeis (principal, juros e multa separados) e amortiza o "
      + "passivo do parcelamento. Confirmar?",
    )) return;
    setLancando("__lote");
    try {
      for (const p of alvo) {
        // eslint-disable-next-line no-await-in-loop
        await executarBaixa(p);
      }
      await carregar();
    } finally { setLancando(null); }
  }

  async function lancar(p) {
    if (lancando) return;
    // ⚠ ATO DE CONSEQUÊNCIA CONFIRMA REPETINDO OS DADOS. A baixa grava até quatro lançamentos e
    // amortiza passivo; antes saía num clique só, sem nada entre a intenção e o razão.
    const texto = `Dar baixa na ${confirmacaoDaBaixa(p)}.\n\n`
      + "Isto GRAVA lançamentos contábeis (principal, juros e multa em lançamentos separados) e "
      + "amortiza o passivo do parcelamento. Confirmar?";
    // eslint-disable-next-line no-alert
    if (!window.confirm(texto)) return;

    setLancando(p.guideId);
    try {
      await executarBaixa(p);
      await carregar();
    } finally { setLancando(null); }
  }

  const th = { padding: "6px 8px", textAlign: "left", fontSize: "0.7rem", color: PANEL.muted, fontWeight: 700, textTransform: "uppercase" };
  const td = { padding: "6px 8px", fontSize: "0.82rem", color: PANEL.text, verticalAlign: "top" };

  const corpo = () => {
    if (carregando) return <div style={{ color: PANEL.muted, fontSize: "0.8rem" }}>Carregando as parcelas pagas…</div>;
    if (erro) {
      return (
        <div role="status" style={{ padding: "8px 10px", borderRadius: 6, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)" }}>
          <div style={{ color: "var(--state-danger)", fontWeight: 700, fontSize: "0.74rem" }}>Não foi possível saber se há parcelas pendentes</div>
          <div style={{ color: PANEL.muted, fontSize: "0.7rem", marginTop: 2, lineHeight: 1.4 }}>
            {erro} — isto <strong>não</strong> quer dizer que não há nada pendente.
          </div>
          <button type="button" onClick={carregar} style={{ marginTop: 6, background: "transparent", border: "1px solid var(--accent-purple)", color: "var(--accent-purple)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700 }}>
            Tentar de novo
          </button>
        </div>
      );
    }
    // ⚠ VAZIO NÃO IMPRIME NADA AQUI — quem responde é a linha única lá embaixo (`compacto`). O texto
    // não sumiu; deixou de ocupar um card inteiro.
    if (!parcelas.length) return null;
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: PANEL.field }}>
              <th style={th}>Parc.</th>
              <th style={th}>Competência</th>
              <th style={{ ...th, textAlign: "right" }}>Valor</th>
              <th style={th}>Pagamento</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {parcelas.map((p) => {
              const desfecho = desfechos[p.guideId];
              // ⚠ `Boolean(p.guideId) &&` NÃO É REDUNDANTE, é a mina que já explodiu uma vez.
              // `lancando` nasce `null`, e uma linha sem guia tem `guideId: null` — `null === null`
              // é `true`, e TODAS as linhas nasceriam dizendo "Lançando…" sem ninguém ter clicado.
              // Foi exatamente isso que fez 60 prestações afirmarem "Buscando…" em
              // `ParcelasDoAcordo` (consultas PAGAS anunciadas em voo), e o conserto de lá é este
              // mesmo. Hoje esta fila filtra por `guia`, então `guideId` nunca é nulo — a guarda
              // existe porque essa garantia é de QUERY, não de tipo, e a fila irmã (prestações sem
              // guia, logo abaixo) é feita das linhas que a violariam.
              const emVoo = (Boolean(p.guideId) && lancando === p.guideId) || lancando === "__lote";
              const destacada = Boolean(foco) && p.parcelamentoId === foco.id;
              return (
                <tr key={p.guideId} style={{
                  borderTop: `1px solid ${PANEL.border}`,
                  background: destacada ? "var(--accent-purple-surface)" : "transparent",
                }}>
                  <td style={{ ...td, fontFamily: "monospace" }}>{p.numeroParcela ?? "?"}</td>
                  <td style={td}>{p.competencia}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{fmtMoney(p.valor)}</td>
                  <td style={{ ...td, color: PANEL.muted }}>
                    {p.comprovante?.dataArrecadacao
                      ? `${p.comprovante.dataArrecadacao} (comprovante)`
                      : (p.confirmadoEm ? new Date(p.confirmadoEm).toLocaleDateString("pt-BR") : "—")}
                  </td>
                  <td style={{ ...td, textAlign: "right", minWidth: 200 }}>
                    <button
                      type="button"
                      onClick={() => lancar(p)}
                      disabled={Boolean(lancando)}
                      // ⚠ DESABILITADO SEMPRE COM O MOTIVO — o projeto proíbe o contrário.
                      title={lancando ? "Aguarde: outra baixa está sendo lançada." : "Grava os lançamentos de baixa desta parcela (pede confirmação)."}
                      // ⚠ 40px É PISO DE ALVO DE CLIQUE, não estética: botão de linha em tabela
                      // densa é o que mais se erra no toque, e errar aqui é lançar a baixa da
                      // prestação vizinha.
                      style={{
                        minHeight: 40, padding: "4px 12px", borderRadius: 6, cursor: lancando ? "not-allowed" : "pointer",
                        background: "transparent", border: "1px solid var(--accent-purple)", color: "var(--accent-purple)",
                        fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap",
                      }}
                    >
                      {emVoo ? "Lançando…" : "Dar baixa"}
                    </button>
                    {/* ⚠ A SAÍDA DO `sem_composicao`, NA PRÓPRIA LINHA QUE RECUSOU.
                        Ela só aparece depois da recusa, e é essa a ordem certa: a fila não sabe de
                        antemão quais guias têm composição (a rota não devolve isso), e oferecer
                        "informar a composição" em toda linha convidaria a declarar por cima de um
                        documento que existe. Aqui o botão nasce da resposta do servidor. */}
                    {semComposicao[p.guideId] && (
                      <div style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          onClick={() => setDeclarando(p)}
                          disabled={Boolean(lancando)}
                          title={lancando
                            ? "Aguarde: outra baixa está sendo lançada."
                            : "Abre a tela para você informar principal, juros e multa lendo o DAS — e lança a baixa."}
                          style={{
                            minHeight: 40, padding: "4px 12px", borderRadius: 6,
                            cursor: lancando ? "not-allowed" : "pointer",
                            background: "transparent", border: "1px solid var(--accent-purple)",
                            color: "var(--accent-purple)", fontSize: "0.76rem", fontWeight: 700,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Informar a composição
                        </button>
                      </div>
                    )}
                    {desfecho && (
                      <div role="status" style={{
                        marginTop: 4, padding: "5px 8px", borderRadius: 6, textAlign: "left", lineHeight: 1.35,
                        fontSize: "0.68rem",
                        color: PANEL.muted,
                        background: desfecho.tom === "ok" ? "var(--state-ok-surface)" : desfecho.tom === "danger" ? "var(--state-danger-surface)" : "var(--state-warn-surface)",
                        border: `1px solid ${desfecho.tom === "ok" ? "var(--state-ok)" : desfecho.tom === "danger" ? "var(--state-danger)" : "var(--state-warn)"}`,
                      }}>
                        {desfecho.texto}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ⚠ BORDA SÓ ONDE SIGNIFICA ALGO. A moldura âmbar dizia a MESMA coisa que o título âmbar e que a
  // contagem — três vezes o mesmo sinal, e mais uma cor competindo na tela. O estado ficou no BADGE
  // da contagem; a borda só muda quando o painel FALHOU, que é a única vez em que a moldura carrega
  // informação própria ("não confie no que está aqui dentro").
  const corBorda = erro ? "var(--state-danger)" : PANEL.border;
  const desfechoLote = desfechos.__lote;
  // ⚠ "CLIQUEI EM DAR BAIXA E NÃO ACONTECEU NADA" — era literalmente isto.
  // O `Dar baixa` do card não lança: ele TRAZ o contador até esta fila e destaca as parcelas do
  // contrato clicado. Quando o contrato não tem nenhuma parcela aqui, o clique rolava a página e o
  // subtítulo ainda dizia "Destacadas: as do contrato que você clicou" — com zero destacadas. Um
  // botão que promete uma ação e entrega silêncio é indistinguível de um botão quebrado.
  const focadas = foco && !erro && !carregando
    ? parcelas.filter((p) => p.parcelamentoId === foco.id).length
    : null;

  // ⚠ SEÇÃO VAZIA VIRA UMA LINHA. Nada de card inteiro para dizer "não há nada" — mas a linha
  // continua sendo uma SEÇÃO (o `Dar baixa` do card rola até ela, e ela precisa existir no DOM), e
  // continua dizendo, no `ℹ`, quem entra nesta fila e quem não entra.
  const compacto = !carregando && !erro && !parcelas.length && !foco && !desfechoLote;
  if (compacto) {
    return (
      <section ref={secaoRef} style={{ scrollMarginTop: 16 }}>
        <SecaoVazia titulo="Parcelas pagas aguardando lançamento">
          O pagamento já foi confirmado na guia e falta gerar a baixa contábil — hoje não há nenhuma.
          Uma prestação só entra <strong>nesta</strong> fila quando o pagamento dela está confirmado{" "}
          <strong>na guia</strong>: pela busca do comprovante no SERPRO (botão na linha da parcela) ou
          pelo “Confirmar pagamento” da aba Guias. Prestação <strong>sem guia</strong> vai para a fila
          de baixo, onde a baixa é declarada por você.
        </SecaoVazia>
      </section>
    );
  }

  return (
    <section ref={secaoRef} style={{ background: PANEL.surface, border: `1px solid ${corBorda}`, borderRadius: 10, padding: 14, scrollMarginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <strong style={{ color: PANEL.text, fontSize: "0.9rem" }}>
          Parcelas pagas aguardando lançamento
        </strong>
        {/* ⚠ UMA COR DE PENDÊNCIA, e ela é o âmbar — a pendência que o sistema CONSTATOU (o SERPRO
            disse que a guia foi paga). O número carrega o estado; o título e a moldura não repetem. */}
        {parcelas.length > 0 && (
          <Badge cor="var(--state-warn)" fundo="var(--state-warn-surface)" title="Pendência constatada pelo sistema: o pagamento da guia já foi confirmado.">
            {parcelas.length} a lançar
          </Badge>
        )}
        {focadas > 0 && (
          <span style={{ color: PANEL.muted, fontSize: "0.72rem" }}>
            Destacadas: as do contrato que você clicou.
          </span>
        )}
        <Explicacao rotulo="Quem entra nesta fila">
          O pagamento já foi confirmado <strong>na guia</strong> — pela busca do comprovante no SERPRO
          (botão na linha da parcela) ou pelo “Confirmar pagamento” da aba Guias. Falta só gerar a
          baixa contábil, e os valores vêm do documento.
        </Explicacao>
      </div>

      {/* ⚠ A RESPOSTA HONESTA DO "DAR BAIXA" QUE NÃO ACHA NADA — ela diz por que esta fila está
          vazia para aquele contrato E para onde ir.

          ⚠ ESTE TEXTO MUDOU, E TINHA DE MUDAR. Ele afirmava que "dar baixa a partir do extrato, sem
          documento, ainda não existe no sistema" — verdade até a fila irmã existir, e MENTIRA a
          partir dela. Deixar a frase antiga mandaria o contador embora convencido de que não há
          saída, com a saída na tela logo abaixo.

          ⚠ ELE DEIXOU DE SER ÂMBAR. Isto não é pendência — é a RESPOSTA a um clique, e pintá-la com
          a cor que significa "falta fazer" gastava o âmbar num lugar onde não há nada a fazer aqui. */}
      {focadas === 0 && (
        <div role="status" style={{
          marginBottom: 8, padding: "8px 10px", borderRadius: 6, lineHeight: 1.45,
          fontSize: "0.74rem", color: PANEL.muted,
          background: "var(--state-neutral-surface)", border: `1px solid ${PANEL.border}`,
        }}>
          <div style={{ color: PANEL.text, fontWeight: 700, marginBottom: 2 }}>
            Nenhuma parcela de {foco.label || "deste contrato"} está aguardando lançamento
          </div>
          Uma prestação só entra <strong>nesta</strong> fila quando o pagamento dela está confirmado{" "}
          <strong>na guia</strong> — pela busca do comprovante no SERPRO (botão na linha da parcela)
          ou pelo “Confirmar pagamento” da aba Guias. Prestação <strong>sem guia</strong> — débito
          automático, ou contrato migrado de outra contabilidade — não tem por onde entrar aqui:
          ela vai para <strong>“Prestações vencidas sem guia”</strong>, logo abaixo, onde a baixa é
          declarada por você em vez de lida de um documento.
        </div>
      )}
      {/* ⚠ O DESFECHO DE SEÇÃO GANHOU TOM. Ele era sempre âmbar porque só existia para o lote que
          não achava nada; agora ele também carrega a confirmação da baixa por composição declarada
          — a única que sobrevive ao recarregamento, porque a linha sai da fila. Pintar de âmbar um
          desfecho de SUCESSO diria "falta fazer" sobre algo que acabou de ser feito. */}
      {desfechoLote && (
        <div role="status" style={{
          marginBottom: 8, padding: "6px 9px", borderRadius: 6, fontSize: "0.72rem", color: PANEL.muted,
          background: desfechoLote.tom === "ok" ? "var(--state-ok-surface)" : "var(--state-warn-surface)",
          border: `1px solid ${desfechoLote.tom === "ok" ? "var(--state-ok)" : "var(--state-warn)"}`,
        }}>
          {desfechoLote.texto}
        </div>
      )}
      {corpo()}
      {/* ⚠ O CHAMADOR DO MODAL — ele vive DENTRO desta fila, ao lado da linha que recusou. É a fila
          que sabe qual guia é, quanto ela vale e quando foi paga; um modal pendurado na aba inteira
          teria de reconstruir tudo isso. */}
      {declarando && (
        <DeclararComposicaoParcelaModal
          linha={declarando}
          onConfirmar={declararComposicao}
          onClose={() => setDeclarando(null)}
        />
      )}
    </section>
  );
}

/**
 * A FILA DA PRESTAÇÃO **SEM GUIA** — e ela é um painel SEPARADO de propósito.
 *
 * ⚠ SÃO DUAS PERGUNTAS DIFERENTES, e juntá-las numa lista só faria o contador tratar declaração e
 * prova como a mesma coisa:
 *
 *   · o painel acima responde *"a guia foi paga, falta lançar"* — há um SINAL EXTERNO (o
 *     `paymentStatus` que veio do SERPRO). A ação é um clique: os valores vêm do documento.
 *   · este responde *"esta prestação venceu e não há guia; você declara que foi debitada?"* — não
 *     há sinal nenhum. A ação é um FORMULÁRIO: juros e multa são declarados, o total tem de fechar,
 *     e o que se grava é `origemBaixa: "MANUAL"` com "(declarado)" no razão.
 *
 * Uma lista única com um rótulo de seção ainda teria UMA coluna de ação, UM botão "Dar baixa" e um
 * "Baixa em lote" varrendo as duas metades — exatamente o apagamento da diferença. Os desfechos, as
 * recusas e o próprio verbo também não coincidem ("Dar baixa" × "Declarar"). Separados, cada fila
 * pode dizer o que sabe e o que NÃO sabe.
 *
 * ⚠ A COR NÃO É ÂMBAR. Âmbar, neste projeto, é a pendência que o sistema CONSTATOU — e é o que a
 * fila de cima é. Aqui o sistema constatou apenas que a prestação venceu sem evidência, e
 * `recalculoParcelamento.js` se recusa explicitamente a chamar isso de inadimplência (ausência de
 * guia não é prova de não-pagamento). Pintar de âmbar seria a tela afirmando uma pendência que a
 * regra logo atrás dela se nega a afirmar. O accent diz "há trabalho seu aqui" sem carimbar atraso;
 * o rótulo por linha (`Vencida` / `Vence hoje`) é que carrega o estado, e ele vem do servidor.
 */
function ParcelasSemGuiaPendentes({
  companyId, refreshKey = 0, foco = null, onBaixaLancada,
  // ⚠ O AVISO DOS RESCINDIDOS SUBIU. Ele era DUAS vezes a mesma informação: este painel imprimia o
  // parágrafo inteiro com a lista de contratos e o "Desfazer rescisão…", e a seção "Contratos
  // rescindidos" do rodapé imprimia de novo o contrato, a explicação e o mesmo botão. Agora quem
  // guarda a informação é a seção — um lugar só —, e a fila fica com UMA LINHA que aponta para lá.
  // A contagem viaja daqui porque é a fila quem sabe quantas prestações ficaram de fora.
  onForaDaFila, onVerRescindidos,
}) {
  const [parcelas, setParcelas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [alvo, setAlvo] = useState(null);       // a prestação cujo modal está aberto
  const [grupoEmLote, setGrupoEmLote] = useState(null); // o grupo "sem valor" com o modal aberto
  const [desfechos, setDesfechos] = useState({}); // parcelaId → { tom, texto }
  const [foraDaFila, setForaDaFila] = useState(null);

  const carregar = useCallback(async () => {
    if (!companyId) { setCarregando(false); return; }
    if (!parcelaApi?.listParcelasSemGuiaPendentes) {
      setErro("A fila de prestações sem guia não está disponível neste modo de API.");
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      const out = await parcelaApi.listParcelasSemGuiaPendentes(companyId);
      setParcelas(Array.isArray(out?.parcelas) ? out.parcelas : []);
      // ⚠ A REGRA CONTINUA A MESMA (`avisoForaDaFila`): `null` quando não há nada escondido — aviso
      // que aparece sempre é aviso que ninguém lê. O que mudou é ONDE ele é desenhado.
      const aviso = avisoForaDaFila(out?.foraDaFila);
      setForaDaFila(aviso);
      onForaDaFila?.(aviso);
    } catch (err) {
      // ⚠ O `catch` NÃO zera a lista: falha e vazio são o mesmo pixel e significam o oposto.
      setErro(err?.message || "Não foi possível carregar as prestações sem guia.");
    } finally { setCarregando(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, refreshKey]);

  useEffect(() => { carregar(); }, [carregar]);

  async function declarar({ parcelaId, dataPagamento, valorJuros, valorMulta, totalConferido }) {
    const out = await parcelaApi.lancarBaixaManualParcela(companyId, parcelaId, {
      dataPagamento, valorJuros, valorMulta, totalConferido,
    });
    // ⚠ `skipped` NÃO é sucesso silencioso — a rota devolve o motivo, e ele sobe como erro para o
    // modal mostrá-lo sem fechar (o contador perderia o que digitou).
    if (out?.skipped || out?.ok === false) {
      const err = new Error(out?.message || out?.resultado?.message || "");
      err.code = out?.motivo || out?.error;
      throw err;
    }
    setAlvo(null);
    setDesfechos((d) => ({ ...d, [parcelaId]: { tom: "ok", texto: "Baixa declarada e lançada." } }));
    await carregar();
    await onBaixaLancada?.();
  }

  /**
   * Corrige o valor CONTRATADO da prestação (`parcelas.valorPrevisto`) — outro ato, outra rota.
   *
   * ⚠ NÃO É "quanto eu paguei". O que foi pago a mais entra em juros/multa na mesma tela; isto
   * reescreve o que o ACORDO diz que a prestação vale, e persiste: é o número que a próxima tela
   * mostra. Por isso ele não viaja no body da baixa — dois fatos, duas chamadas.
   */
  async function corrigirValorContratado({ parcelaId, valorPrevisto, valorAnteriorConferido }) {
    if (!parcelaApi?.corrigirValorPrevistoParcela) {
      const err = new Error("A alteração do valor contratado não está disponível neste modo de API.");
      err.code = "CORRECAO_INDISPONIVEL";
      throw err;
    }
    const out = await parcelaApi.corrigirValorPrevistoParcela(companyId, parcelaId, {
      valorPrevisto, valorAnteriorConferido,
    });
    // ⚠ `skipped` NÃO é sucesso silencioso — mesma lição da baixa: sobe como erro para o modal
    // mostrar o motivo sem fechar (fechar apagaria o que foi digitado).
    if (out?.skipped || out?.ok === false) {
      const err = new Error(out?.message || out?.resultado?.message || "");
      err.code = out?.motivo || out?.error;
      throw err;
    }
    return out;
  }

  // ⚠ A CAPACIDADE É LIDA UMA VEZ, e ela vale para os DOIS caminhos (o lote do banner e o campo
  // Principal do modal de uma prestação só). Modo de API sem a rota desabilita os dois COM O MOTIVO,
  // em vez de oferecer um botão que abre uma tela onde nada pode ser informado.
  const podeCorrigirValor = Boolean(parcelaApi?.corrigirValorPrevistoParcela);
  const grupos = useMemo(() => agruparBloqueiosDaFila(parcelas), [parcelas]);

  const th = { padding: "6px 8px", textAlign: "left", fontSize: "0.7rem", color: PANEL.muted, fontWeight: 700, textTransform: "uppercase" };
  const td = { padding: "6px 8px", fontSize: "0.82rem", color: PANEL.text, verticalAlign: "top" };

  const corpo = () => {
    if (carregando) return <div style={{ color: PANEL.muted, fontSize: "0.8rem" }}>Carregando as prestações sem guia…</div>;
    if (erro) {
      return (
        <div role="status" style={{ padding: "8px 10px", borderRadius: 6, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)" }}>
          <div style={{ color: "var(--state-danger)", fontWeight: 700, fontSize: "0.74rem" }}>
            Não foi possível saber se há prestações sem guia vencidas
          </div>
          <div style={{ color: PANEL.muted, fontSize: "0.7rem", marginTop: 2, lineHeight: 1.4 }}>
            {erro} — isto <strong>não</strong> quer dizer que não há nenhuma.
          </div>
          <button type="button" onClick={carregar} style={{ marginTop: 6, background: "transparent", border: "1px solid var(--accent-purple)", color: "var(--accent-purple)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700 }}>
            Tentar de novo
          </button>
        </div>
      );
    }
    // ⚠ FILA VAZIA DIZ QUE ESTÁ VAZIA — e continua dizendo o que "vazia" significa aqui, que não é
    // "tudo pago". O texto não sumiu: virou a linha única de `compacto`, com o `ℹ`.
    if (!parcelas.length) return null;
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: PANEL.field }}>
              <th style={th}>Parc.</th>
              <th style={th}>Contrato</th>
              <th style={th}>Competência</th>
              <th style={th}>Vencimento</th>
              <th style={{ ...th, textAlign: "right" }}>Principal</th>
              <th style={th}>Estado</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {parcelas.map((p) => {
              const desfecho = desfechos[p.parcelaId];
              const destacada = Boolean(foco) && p.parcelamentoId === foco.id;
              const sit = rotuloDaSituacao(p.situacao);
              // ⚠ OS DOIS BLOQUEIOS NÃO SÃO O MESMO, E TRATÁ-LOS IGUAL FECHAVA A ÚNICA SAÍDA.
              // `provisao_inexistente` se resolve em OUTRA tela (lançar a adesão) — o botão fica
              // desabilitado com o motivo. `sem_valor_previsto` se resolve NESTE modal: é o estado
              // em que TODA prestação de um contrato criado sem guia nasce (`valorPrevisto = 0`),
              // e a mensagem antiga mandava "corrigir o valor da parcela no contrato" — um caminho
              // nomeado e inexistente. Desabilitar aqui era o sistema decidindo no lugar do
              // contador, calado, sobre um número que é dele.
              const corrigivelNaTela = p.motivoBloqueio === "sem_valor_previsto";
              const bloqueio = p.motivoBloqueio && !corrigivelNaTela ? explicarRecusa(p.motivoBloqueio) : null;
              // ⚠ O MOTIVO NÃO SAIU DA LINHA — saiu a REPETIÇÃO DELE. O parágrafo inteiro está no
              // banner do grupo (uma vez, com a contagem e as prestações) e no `title` do botão; na
              // linha fica o rótulo CURTO, que é o que amarra uma coisa à outra. Escondê-la, ou
              // escondê-lo, faria o contrato parecer em ordem justamente onde ele não está.
              const rotuloBloqueio = rotuloDoBloqueio(p.motivoBloqueio);
              return (
                <tr key={p.parcelaId} style={{
                  borderTop: `1px solid ${PANEL.border}`,
                  background: destacada ? "var(--accent-purple-surface)" : "transparent",
                }}>
                  <td style={{ ...td, fontFamily: "monospace" }}>
                    {p.numeroParcela ?? "?"}
                    <span style={{ color: PANEL.muted }}>/{p.parcelamento?.numParcelas ?? "?"}</span>
                  </td>
                  <td style={{ ...td, color: PANEL.muted, maxWidth: 220 }}>{p.parcelamento?.label || "—"}</td>
                  <td style={td}>{p.competencia || "—"}</td>
                  <td style={td}>
                    {p.vencimento ? fmtDataCivil(p.vencimento) : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>
                    {formatarMoeda(p.valorPrevisto)}
                  </td>
                  {/* ⚠ ESTADO É BADGE CURTO, NÃO PARÁGRAFO. Eram até três textos empilhados na
                      linha (situação colorida + motivo do bloqueio + aviso do "sem valor"); agora
                      são dois selos de duas palavras, e a explicação vive uma vez, acima. */}
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <Badge cor={sit.cor} fundo={sit.fundo} title={sit.titulo}>{sit.texto}</Badge>
                    {rotuloBloqueio && (
                      <>
                        {" "}
                        {/* ⚠ UMA COR DE PENDÊNCIA. O selo do bloqueio é âmbar sempre — o accent
                            ficou reservado à AÇÃO (o botão da linha, o do banner). Dois selos com
                            cores diferentes para dois bloqueios ensinariam uma hierarquia que não
                            existe: os dois impedem a baixa, o que muda é ONDE se resolve, e isso o
                            banner diz em palavras. */}
                        <Badge
                          cor="var(--state-warn)"
                          fundo="var(--state-warn-surface)"
                          title={explicarRecusa(p.motivoBloqueio)}
                        >
                          {rotuloBloqueio}
                        </Badge>
                      </>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "right", minWidth: 210 }}>
                    <button
                      type="button"
                      onClick={() => setAlvo(p)}
                      disabled={Boolean(bloqueio)}
                      // ⚠ DESABILITADO SEMPRE COM O MOTIVO — e o motivo também sai VISÍVEL, no
                      // banner do grupo logo acima, porque `title` some junto com o mouse.
                      title={bloqueio
                        || (corrigivelNaTela
                          ? "Abre a declaração: informe o valor contratado desta prestação (ela nasceu sem valor), mais juros e multa."
                          : "Abre a declaração: você informa juros e multa, e confere o total antes de gravar.")}
                      style={{
                        minHeight: 40, padding: "4px 12px", borderRadius: 6,
                        cursor: bloqueio ? "not-allowed" : "pointer",
                        background: "transparent",
                        border: `1px solid ${bloqueio ? PANEL.border : "var(--accent-purple)"}`,
                        color: bloqueio ? PANEL.muted : "var(--accent-purple)",
                        fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap",
                      }}
                    >
                      {/* ⚠ MESMO VERBO DA FILA INTEIRA. Aqui se DECLARA (não se "baixa"): o
                          desfecho diz "Baixa declarada e lançada" e o modal diz "Declarar". Um
                          botão que dissesse "baixar" abriria um nome que não reaparece em lugar
                          nenhum do fluxo. */}
                      {corrigivelNaTela ? "Informar valor e declarar…" : "Declarar baixa…"}
                    </button>
                    {desfecho && (
                      <div role="status" style={{
                        marginTop: 4, padding: "5px 8px", borderRadius: 6, textAlign: "left", lineHeight: 1.35,
                        fontSize: "0.68rem", color: PANEL.muted,
                        background: desfecho.tom === "ok" ? "var(--state-ok-surface)" : "var(--state-warn-surface)",
                        border: `1px solid ${desfecho.tom === "ok" ? "var(--state-ok)" : "var(--state-warn)"}`,
                      }}>
                        {desfecho.texto}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ⚠ A BORDA ROXA SAIU. Ela não comunicava nada — palavras do dono —, e ainda gastava o accent, que
  // nesta tela significa AÇÃO, para desenhar uma moldura clicável em nada. O que a fila é continua
  // dito onde sempre esteve: no texto de apoio e no badge da contagem. A borda só muda no ERRO.
  const corBorda = erro ? "var(--state-danger)" : PANEL.border;
  // A UMA LINHA que substituiu o box duplicado dos rescindidos — ver o comentário da prop
  // `onForaDaFila`. Ela não é a informação, é o PONTEIRO para ela.
  const linhaRescindidos = foraDaFila && !carregando && !erro && (
    <div role="status" style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ color: PANEL.muted, fontSize: "0.75rem" }}>
        <strong style={{ color: PANEL.text }}>{foraDaFila.titulo}.</strong>
      </span>
      {onVerRescindidos && (
        <button
          type="button"
          onClick={onVerRescindidos}
          title="Leva à seção “Contratos rescindidos”, onde estão a explicação, os contratos e as duas saídas (desfazer a rescisão ou excluir o contrato)."
          style={{
            minHeight: 40, background: "transparent", border: "1px solid var(--accent-purple)",
            color: "var(--accent-purple)", borderRadius: 6, padding: "2px 10px",
            cursor: "pointer", fontSize: "0.72rem", fontWeight: 700,
          }}
        >
          Ver contratos rescindidos
        </button>
      )}
    </div>
  );

  // ⚠ SEÇÃO VAZIA VIRA UMA LINHA — e continua dizendo quem entra e quem não entra, no `ℹ`. A linha
  // dos rescindidos sobrevive à compactação: é justamente com a fila vazia que ela importa.
  const compacto = !carregando && !erro && !parcelas.length;
  if (compacto) {
    return (
      <section>
        <SecaoVazia titulo="Prestações vencidas sem guia">
          Nenhuma prestação sem guia venceu até hoje sem baixa. Prestações <strong>futuras</strong> não
          entram (ainda não são devidas) e prestações <strong>com guia</strong> vão para a fila acima.
          Débito automático não gera guia: quando uma vencer sem baixa, ela aparece aqui para você
          declarar que o pagamento saiu.
        </SecaoVazia>
        {linhaRescindidos}
      </section>
    );
  }

  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${corBorda}`, borderRadius: 10, padding: 14 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ color: PANEL.text, fontSize: "0.9rem" }}>Prestações vencidas sem guia</strong>
          {parcelas.length > 0 && (
            <Badge
              cor="var(--accent-purple)"
              fundo="var(--accent-purple-surface)"
              title="Não é atraso constatado: ausência de guia não é prova de não-pagamento. É trabalho seu — a declaração."
            >
              {parcelas.length} a declarar
            </Badge>
          )}
        </div>
        {/* ⚠ A FRASE QUE SEPARA AS DUAS FILAS. Sem ela, a segunda tabela parece "mais do mesmo".
            ⚠ E ela é UM texto de apoio, no topo do grupo — não um aviso repetido linha a linha. */}
        <div style={{ color: PANEL.muted, fontSize: "0.78rem", lineHeight: 1.45, marginTop: 2 }}>
          Débito automático não gera guia: aqui <strong>não há documento nenhum</strong>. O sistema só
          sabe que a prestação venceu; quem afirma que o dinheiro saiu é <strong>você</strong>, e a
          baixa fica registrada como declarada por você.
        </div>
      </div>

      {/* ⚠ O MOTIVO UMA VEZ, PARA O GRUPO — e, quando há saída, a SAÍDA EM LOTE junto dele.
          Num contrato criado pelo wizard TODAS as prestações nascem sem valor: o mesmo parágrafo se
          repetia linha a linha, e a correção era abrir o mesmo modal N vezes para digitar o mesmo
          número. Aqui o texto aparece uma vez, dizendo em quantas prestações vale e quais são, e o
          botão resolve as N de uma vez — com cada uma ainda editável dentro do modal.
          ⚠ Nenhuma linha sai da tabela e nenhum motivo some: some a repetição. */}
      {grupos.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          {grupos.map((g) => (
            <div
              key={g.chave}
              role="note"
              style={{
                padding: "8px 10px", borderRadius: 6,
                background: "var(--state-neutral-surface)", border: `1px solid ${PANEL.border}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div style={{ color: PANEL.text, fontWeight: 700, fontSize: "0.76rem" }}>
                  {tituloDoGrupo(g)}
                </div>
                {g.corrigivelNaTela && podeCorrigirValor && (
                  <button
                    type="button"
                    onClick={() => setGrupoEmLote(g)}
                    title="Abre a lista das prestações: um valor vale para todas, e cada uma pode ser editada antes de gravar."
                    style={{
                      minHeight: 40, flexShrink: 0, background: "transparent",
                      border: "1px solid var(--accent-purple)", color: "var(--accent-purple)",
                      borderRadius: 6, padding: "2px 12px", cursor: "pointer",
                      fontSize: "0.74rem", fontWeight: 700,
                    }}
                  >
                    Informar valor
                  </button>
                )}
              </div>
              <div style={{ color: PANEL.muted, fontSize: "0.7rem", marginTop: 3, lineHeight: 1.4 }}>
                {g.texto}
              </div>
              {g.quantidade !== parcelas.length && g.listaDeNumeros && (
                <div style={{ color: PANEL.muted, fontSize: "0.66rem", marginTop: 2 }}>
                  Prestações: {g.listaDeNumeros}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {corpo()}

      {linhaRescindidos}

      {alvo && (
        <BaixaManualParcelaModal
          linha={alvo}
          onConfirmar={declarar}
          // ⚠ ISTO NÃO ERA PASSADO, e a capacidade inteira ficava inalcançável: sem
          // `onCorrigirValorContratado` o campo Principal do modal nasce DESABILITADO ("não está
          // disponível neste modo de API") e vazio, então o botão "Informar valor e baixar…" abria
          // uma tela onde nada podia ser informado. A rota, o mock e a regra já existiam.
          onCorrigirValorContratado={podeCorrigirValor ? corrigirValorContratado : null}
          onClose={() => setAlvo(null)}
        />
      )}

      {grupoEmLote && (
        <InformarValorEmLoteModal
          grupo={grupoEmLote}
          onInformar={corrigirValorContratado}
          onConcluido={carregar}
          onClose={() => setGrupoEmLote(null)}
        />
      )}
    </section>
  );
}

/**
 * OS CONTRATOS RESCINDIDOS — visíveis, e com as duas saídas.
 *
 * ⚠ ELES ERAM INVISÍVEIS. `ParcelamentosList` recebia `.filter((p) => p.status !== "RESCINDIDO")`, e
 * o backend nunca escondeu nada: quem sumia com o contrato era a tela. O efeito é o pior possível
 * para o pedido do dono — ele tinha um contrato rescindido POR ENGANO, com prestações sumindo da
 * fila de baixa, e nenhuma tela onde vê-lo. Contrato invisível é contrato incorrigível: sem esta
 * seção, "excluir o parcelamento errado" não teria de onde ser clicado.
 *
 * ⚠ ELES FICAM SEPARADOS, e não misturados na lista principal. Um acordo rescindido não é trabalho
 * em curso: ele não tem risco a acompanhar (`quadroDasParcelas` devolve `risco: null`), não tem
 * prestação em fila e não recebe baixa. Misturá-lo com os ativos faria o contador procurar
 * pendência onde não há — e é o mesmo motivo pelo qual esta seção nasce FECHADA quando não há
 * nenhum: seção vazia permanente é ruído que treina o olho a pular a região inteira.
 *
 * ⚠ ELA VIROU O ÚNICO LUGAR DA INFORMAÇÃO DOS RESCINDIDOS (Fase 1). A fila "Prestações vencidas sem
 * guia" imprimia, por baixo da tabela, o MESMO conteúdo: o parágrafo explicando que prestação de
 * acordo rescindido não entra em fila, a lista dos contratos com a contagem, e o mesmo botão
 * "Desfazer rescisão…". Duas cópias da mesma coisa a uma tela de distância — e a de baixo ainda
 * tinha MENOS: nem o número do contrato, nem quantas prestações ele tem, nem o "Excluir contrato…".
 *
 * ⚠ O QUE NÃO PODIA SUMIR — e não sumiu — é a CONTAGEM DE PRESTAÇÕES FORA DA FILA. Ela é o número
 * que o dono nunca viu: 69 prestações sumiram sem uma palavra, e ele passou um dia achando que a
 * baixa sem guia estava quebrada. `parcelasTotal` (o que a seção já mostrava) NÃO é esse número —
 * é o tamanho do contrato. Por isso o `foraDaFila` da fila SOBE até aqui e vira uma linha própria
 * por contrato. E a fila continua dizendo, em UMA LINHA, que há prestações fora dela, apontando
 * para cá: o ponteiro é navegação, o conteúdo é um só.
 */
function ContratosRescindidos({ parcelamentos, foraDaFila, onDesfazer, onExcluir, secaoRef, destacada }) {
  const rescindidos = (parcelamentos || []).filter((p) => p.status === "RESCINDIDO");
  const foraPorContrato = new Map(
    (foraDaFila?.contratos || []).map((c) => [c.parcelamentoId, c]),
  );
  // ⚠ ÓRFÃOS APARECEM MESMO ASSIM. Se a lista de parcelamentos falhar ao carregar (o `error` do
  // hook, que a tela já mostra), um contrato pode estar em `foraDaFila` e não estar aqui — e ele é
  // justamente o que está segurando prestações fora da fila. Sem esta linha, a informação sumiria
  // exatamente no caso em que ela é mais necessária.
  const orfaos = (foraDaFila?.contratos || []).filter(
    (c) => !rescindidos.some((p) => p.id === c.parcelamentoId),
  );
  if (!rescindidos.length && !orfaos.length) return null;

  const total = rescindidos.length + orfaos.length;
  const botao = (destrutivo) => ({
    minHeight: 40, background: "transparent", borderRadius: 6, padding: "3px 12px",
    fontSize: "0.72rem", fontWeight: 700,
    // ⚠ VERMELHO SÓ EM AÇÃO DESTRUTIVA — e "Excluir contrato…" é a única desta tela. "Desfazer
    // rescisão" devolve o contrato: é reparo, e usa o accent das demais ações.
    border: `1px solid ${destrutivo ? "var(--state-danger)" : "var(--accent-purple)"}`,
    color: destrutivo ? "var(--state-danger)" : "var(--accent-purple)",
  });

  return (
    <section
      ref={secaoRef}
      style={{
        background: PANEL.surface, borderRadius: 10, padding: 14, scrollMarginTop: 16,
        // ⚠ A moldura só muda quando o contador FOI TRAZIDO até aqui pelo ponteiro da fila — é a
        // única vez em que ela carrega informação ("é isto que você veio ver"), e some sozinha.
        border: `1px solid ${destacada ? "var(--accent-purple)" : PANEL.border}`,
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <strong style={{ color: PANEL.text, fontSize: "0.9rem" }}>
          Contratos rescindidos ({total})
        </strong>
        <div style={{ color: PANEL.muted, fontSize: "0.78rem", lineHeight: 1.45 }}>
          Rescindido, o acordo sai das filas de baixa e deixa de ter risco a acompanhar — as
          prestações dele não somem do sistema, elas deixam de ser cobradas aqui. Se a rescisão foi
          por engano, desfaça <strong>e elas voltam para a fila</strong>; se o contrato nunca deveria
          ter existido, exclua.
        </div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {rescindidos.map((p) => {
          const fora = foraPorContrato.get(p.id);
          return (
            <div
              key={p.id}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                flexWrap: "wrap", padding: "8px 10px", borderRadius: 8,
                background: PANEL.field, border: `1px solid ${PANEL.border}`,
              }}
            >
              <div style={{ minWidth: 220 }}>
                <div style={{ color: PANEL.text, fontSize: "0.82rem", fontWeight: 700 }}>
                  {p.tipo || "Parcelamento"}{p.numeroParcelamento ? ` nº ${p.numeroParcelamento}` : ""}
                </div>
                <div style={{ color: PANEL.muted, fontSize: "0.7rem" }}>
                  {p.label}
                  {" · "}
                  {p.parcelasTotal ?? 0} {(p.parcelasTotal ?? 0) === 1 ? "prestação" : "prestações"}
                  {p.parcelasPagas ? ` · ${p.parcelasPagas} quitada(s)` : ""}
                </div>
                {/* ⚠ O NÚMERO QUE VEIO DA FILA, e que a seção não tinha como saber sozinha: quantas
                    prestações DESTE contrato estão vencidas e fora da fila de baixa por causa da
                    rescisão. É a informação que estava duplicada lá embaixo e que agora mora aqui. */}
                {fora && (
                  <div style={{ color: PANEL.muted, fontSize: "0.7rem", marginTop: 2 }}>
                    <strong style={{ color: PANEL.text }}>
                      {fora.prestacoes} {fora.prestacoes === 1 ? "prestação vencida" : "prestações vencidas"}
                    </strong>{" "}
                    fora da fila de baixa por causa da rescisão.
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => onDesfazer?.(p)}
                  disabled={!onDesfazer}
                  title={onDesfazer
                    ? "Mostra o que volta (prestações, lançamentos, risco), exige motivo e grava quem desfez."
                    : "Desfazer rescisão não está disponível neste modo de API."}
                  style={{
                    ...botao(false),
                    color: onDesfazer ? "var(--accent-purple)" : PANEL.muted,
                    cursor: onDesfazer ? "pointer" : "not-allowed",
                  }}
                >
                  Desfazer rescisão…
                </button>
                <button
                  type="button"
                  onClick={() => onExcluir?.(p)}
                  disabled={!onExcluir}
                  title={onExcluir
                    ? "Mostra tudo o que será desfeito, com números, exige motivo e grava o ato."
                    : "Exclusão não está disponível neste modo de API."}
                  style={{
                    ...botao(true),
                    color: onExcluir ? "var(--state-danger)" : PANEL.muted,
                    cursor: onExcluir ? "pointer" : "not-allowed",
                  }}
                >
                  Excluir contrato…
                </button>
              </div>
            </div>
          );
        })}

        {orfaos.map((c) => (
          <div
            key={c.parcelamentoId}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
              flexWrap: "wrap", padding: "8px 10px", borderRadius: 8,
              background: PANEL.field, border: `1px dashed ${PANEL.border}`,
            }}
          >
            <div style={{ minWidth: 220 }}>
              <div style={{ color: PANEL.text, fontSize: "0.82rem", fontWeight: 700 }}>
                {c.tipo || "Parcelamento"}{c.numeroParcelamento ? ` nº ${c.numeroParcelamento}` : ""}
              </div>
              <div style={{ color: PANEL.muted, fontSize: "0.7rem" }}>
                {c.label}
                {" · "}
                <strong style={{ color: PANEL.text }}>
                  {c.prestacoes} {c.prestacoes === 1 ? "prestação vencida" : "prestações vencidas"}
                </strong>{" "}
                fora da fila de baixa. O contrato não veio na lista acima — ela pode estar incompleta.
              </div>
            </div>
            {onDesfazer && (
              <button
                type="button"
                onClick={() => onDesfazer({ id: c.parcelamentoId, label: c.label })}
                title="Abre a confirmação: mostra o que volta, exige motivo e grava quem desfez."
                style={{ ...botao(false), cursor: "pointer" }}
              >
                Desfazer rescisão…
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ParcelamentoTab({
  companyId, parcelamentos, accounts = [], onSearchHistoricos, onGetHistoricosByCode, onIrParaGuias,
  // R4 — o "＋ Criar novo…" do modal de anexo de guia chega aqui já pedindo o wizard aberto.
  abrirWizardAoMontar = false, onWizardAberto,
}) {
  // Recarga da fila de baixa pendente depois de um pagamento localizado na linha da parcela.
  const [baixaRefreshKey, setBaixaRefreshKey] = useState(0);
  const [wizardAberto, setWizardAberto] = useState(false);

  useEffect(() => {
    if (!abrirWizardAoMontar) return;
    setWizardAberto(true);
    onWizardAberto?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirWizardAoMontar]);
  // O que a barra de ações do card pede à fila de baixa. `nonce` porque o MESMO pedido pode ser
  // repetido (clicar "Dar baixa" duas vezes no mesmo contrato tem de rolar duas vezes).
  const [pedidoBaixa, setPedidoBaixa] = useState(null);
  // O mesmo contrato destacado nas DUAS filas. É estado próprio (e não `pedidoBaixa`, que é
  // consumido e zerado) porque o destaque tem de sobreviver ao atendimento do pedido — a prestação
  // que o contador procura pode estar na segunda fila, não na primeira.
  const [focoContrato, setFocoContrato] = useState(null);
  const pedirBaixa = useCallback((parc, lote) => {
    setFocoContrato(parc?.id ? { id: parc.id, label: parc.label || null } : null);
    setPedidoBaixa({
      parcelamentoId: parc?.id || null, label: parc?.label || null,
      lote: Boolean(lote), nonce: Date.now(),
    });
  }, []);

  // ⚠ MESMA ROTA DAS OUTRAS GUIAS. Uma parcela É uma `Guide` com `parcelamentoId`, então
  // `buscarPagamentoGuia(guideId)` é literalmente a chamada que a Circular já faz nos tributos.
  const buscarPagamentoParcela = useCallback(async (guideId) => {
    if (!parcelaApi?.buscarPagamentoGuia) {
      const err = new Error("A busca de pagamento não está disponível neste modo de API.");
      err.code = "BUSCA_INDISPONIVEL";
      throw err;
    }
    return parcelaApi.buscarPagamentoGuia(guideId);
  }, []);

  const aposLocalizarPagamento = useCallback(async () => {
    setBaixaRefreshKey((k) => k + 1);
    await parcelamentos?.load?.();
  }, [parcelamentos]);

  // ── OS ATOS DO CONTRATO ─────────────────────────────────────────────────────────────────────
  // ⚠ UM ESTADO SÓ para os dois modais (`{ tipo, parcelamento }`). Dois estados independentes
  // deixariam os dois abertos ao mesmo tempo se alguém clicasse rápido — e são atos opostos sobre o
  // MESMO contrato.
  const [ato, setAto] = useState(null);
  const contratos = parcelamentos?.parcelamentos || [];
  const abrirDesfazerPorId = useCallback((parcelamentoId) => {
    const alvo = contratos.find((p) => p.id === parcelamentoId);
    // O aviso da fila manda só o id; sem o contrato na lista, o modal ainda funciona (a prévia vem
    // do servidor) — o que faltaria é só o rótulo no topo.
    setAto({ tipo: "DESFAZER", parcelamento: alvo || { id: parcelamentoId } });
  }, [contratos]);

  // Depois de excluir ou desfazer, AS DUAS FILAS recarregam junto com a lista: a exclusão tira
  // prestações da fila de baixa e o desfazer as devolve. Recarregar só a lista deixaria a fila
  // mostrando prestação de um contrato que não existe mais.
  const aposAto = useCallback(async () => {
    setBaixaRefreshKey((k) => k + 1);
    await parcelamentos?.load?.();
  }, [parcelamentos]);

  // ── OS RESCINDIDOS, EM UM LUGAR SÓ ──────────────────────────────────────────────────────────
  // ⚠ A contagem de prestações fora da fila é DADO DA FILA (só ela consulta `foraDaFila`), mas a
  // informação sobre contratos rescindidos passou a morar na seção do rodapé — então o número sobe
  // por aqui em vez de ser desenhado duas vezes. Estado, e não prop derivada, porque quem o produz
  // é uma requisição de um filho.
  const [foraDaFila, setForaDaFila] = useState(null);
  const rescindidosRef = useRef(null);
  const [rescindidosDestacada, setRescindidosDestacada] = useState(false);
  // ⚠ O PONTEIRO TEM DE CHEGAR. Rolar sem marcar deixaria o contador olhando para uma tela que
  // mudou de posição sem dizer o que ele veio ver; o destaque some sozinho em 3s.
  const verRescindidos = useCallback(() => {
    rescindidosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setRescindidosDestacada(true);
    setTimeout(() => setRescindidosDestacada(false), 3000);
  }, []);

  if (!parcelamentos) {
    return <div style={{ padding: 24, color: PANEL.muted }}>Carregando…</div>;
  }

  return (
    /* Largura de trabalho (~90%): a lista de parcelamentos tem parcela, valor, vencimento, status
       e ações por linha, e em 1100px as colunas truncavam com a tela sobrando. */
    <div style={{ padding: "24px 0", width: "var(--content-wide)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.15rem", color: PANEL.text }}>Parcelamentos</h1>
          <span style={{ fontSize: "0.85rem", color: PANEL.muted }}>
            O contrato entra aqui, sem guia nenhuma. A guia de cada mês é evidência opcional e se
            anexa depois, pelo <strong>+ Subir Guia → PARCELAMENTO</strong> na aba Guias.
          </span>
        </div>
        <Button variant="primary" type="button" onClick={() => setWizardAberto(true)}>+ Novo parcelamento</Button>
      </div>

      {/* ⚠ `error` do hook aparece: `useParcelamentos` já o guardava e a tela o descartava, então
          falha ao listar parcelamentos era indistinguível de "esta empresa não tem parcelamento". */}
      {parcelamentos.error && (
        <div role="status" style={{ padding: "8px 12px", borderRadius: 8, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)" }}>
          <div style={{ color: "var(--state-danger)", fontWeight: 700, fontSize: "0.78rem" }}>Não foi possível carregar os parcelamentos</div>
          <div style={{ color: PANEL.muted, fontSize: "0.72rem", marginTop: 2 }}>
            {parcelamentos.error} — a lista abaixo pode estar incompleta.
          </div>
        </div>
      )}

      <ParcelasPendentesBaixa
        companyId={companyId}
        refreshKey={baixaRefreshKey}
        pedido={pedidoBaixa}
        onPedidoAtendido={() => setPedidoBaixa(null)}
      />

      {/* ⚠ A SEGUNDA FILA, e ela é separada de propósito — ver o comentário do componente. Ela vem
          DEPOIS porque a de cima tem prova (o comprovante do SERPRO) e esta tem declaração; a ordem
          na tela ensina qual é o caminho preferível quando os dois existem. */}
      <ParcelasSemGuiaPendentes
        companyId={companyId}
        refreshKey={baixaRefreshKey}
        foco={focoContrato}
        onBaixaLancada={aposLocalizarPagamento}
        onForaDaFila={setForaDaFila}
        onVerRescindidos={verRescindidos}
      />

      <ConferenciaParcelasPanel
        listConferencia={parcelamentos.listConferencia}
        aprovarConferencia={parcelamentos.aprovarConferencia}
      />

      <ParcelamentosList
        parcelamentos={(parcelamentos.parcelamentos || []).filter((p) => p.status !== "RESCINDIDO")}
        loading={parcelamentos.loading}
        onRescindir={(parcId, body) => parcelamentos.rescindir(parcId, body)}
        onOpenCreate={() => setWizardAberto(true)}
        getConfig={parcelamentos.getConfig}
        saveConfig={parcelamentos.saveConfig}
        accounts={accounts}
        onSearchHistoricos={onSearchHistoricos}
        onGetHistoricosByCode={onGetHistoricosByCode}
        onBuscarPagamentoParcela={buscarPagamentoParcela}
        onParcelaAtualizada={aposLocalizarPagamento}
        onDarBaixa={(parc) => pedirBaixa(parc, false)}
        onBaixaEmLote={(parc) => pedirBaixa(parc, true)}
        onSubirGuia={onIrParaGuias ? () => onIrParaGuias() : null}
        onExcluir={parcelamentos.previewExclusao ? (parc) => setAto({ tipo: "EXCLUSAO", parcelamento: parc }) : null}
      />

      {/* ⚠ ELES DEIXARAM DE SER INVISÍVEIS. A lista acima filtra `status !== "RESCINDIDO"` desde
          sempre, e o backend nunca escondeu nada — era a tela. Contrato invisível é contrato
          incorrigível, e era exatamente esse o caso do dono. */}
      <ContratosRescindidos
        parcelamentos={contratos}
        // ⚠ O número que a FILA descobriu, desenhado UMA vez — aqui. Ver o comentário do componente.
        foraDaFila={foraDaFila}
        secaoRef={rescindidosRef}
        destacada={rescindidosDestacada}
        onDesfazer={parcelamentos.previewDesfazerRescisao
          ? (parc) => (parc?.id && !contratos.some((c) => c.id === parc.id)
            // O contrato órfão manda só o id — `abrirDesfazerPorId` já sabe lidar com isso (a
            // prévia vem do servidor; o que faltaria seria só o rótulo no topo do modal).
            ? abrirDesfazerPorId(parc.id)
            : setAto({ tipo: "DESFAZER", parcelamento: parc }))
          : null}
        onExcluir={parcelamentos.previewExclusao ? (parc) => setAto({ tipo: "EXCLUSAO", parcelamento: parc }) : null}
      />

      {ato?.tipo === "EXCLUSAO" && (
        <ExclusaoParcelamentoModal
          parcelamento={ato.parcelamento}
          onLoadPreview={() => parcelamentos.previewExclusao(ato.parcelamento.id)}
          onConfirm={async ({ motivo, totalConferido }) => {
            await parcelamentos.excluir(ato.parcelamento.id, { motivo, totalConferido });
            await aposAto();
          }}
          onClose={() => setAto(null)}
        />
      )}

      {ato?.tipo === "DESFAZER" && (
        <DesfazerRescisaoModal
          parcelamento={ato.parcelamento}
          onLoadPreview={() => parcelamentos.previewDesfazerRescisao(ato.parcelamento.id)}
          onConfirm={async ({ motivo }) => {
            await parcelamentos.desfazerRescisao(ato.parcelamento.id, { motivo });
            await aposAto();
          }}
          onClose={() => setAto(null)}
        />
      )}

      {wizardAberto && (
        <ParcelamentoWizard
          onIngest={(body) => parcelamentos.ingest(body)}
          onConsultSerpro={parcelamentos.consultarSerpro}
          getContasProvisao={parcelamentos.getContasProvisao}
          accounts={accounts}
          onSearchHistoricos={onSearchHistoricos}
          onGetHistoricosByCode={onGetHistoricosByCode}
          saving={parcelamentos.saving}
          // ⚠ CRIAR CONTRATO TAMBÉM ENCHE AS DUAS FILAS DE BAIXA — e elas não recarregavam.
          // `ingest` já chama `parcelamentos.load()`, então o CARD aparecia na hora; as filas são
          // requisições dos filhos, presas em `baixaRefreshKey`, e continuavam com o número antigo.
          // Um contrato migrado nasce com N prestações vencidas sem guia: o trabalho que a criação
          // acabou de gerar ficava invisível até alguém sair da aba e voltar. `aposAto` é o MESMO
          // handler que a exclusão e o desfazer-rescisão já usam, pelo mesmo motivo.
          onClose={() => { setWizardAberto(false); aposAto(); }}
        />
      )}
    </div>
  );
}
