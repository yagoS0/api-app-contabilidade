// R2 — "NOVO PARCELAMENTO": o contrato antes do documento.
//
// ⚠ ESTE MODAL CRIA O PARCELAMENTO SEM NENHUMA GUIA. É a inversão que a fase inteira existe para
// fazer: o parcelamento é um CONTRATO de dívida de até 60 meses e a guia é evidência MENSAL e
// OPCIONAL — ela não existe em débito automático, e não existe nas prestações de um acordo migrado
// de outra contabilidade. `POST /parcelamentos/ingestao` já aceitava `guideId` ausente ponta a
// ponta; o que faltava era a tela.
//
// As REGRAS (validação, derivações, payload) moram em `../lib/wizardParcelamento.js`, com teste
// próprio. Aqui fica só a ligação.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { AccountCodeInput } from "../../entries/components/renderAccountingEntriesParts";
import {
  MODALIDADES, FORMAS_PAGAMENTO, SITUACOES, PASSOS, ROLE_LABEL,
  PAPEIS_PROVISAO, linhaComPapel, papelDivergeDoLado,
  estadoInicial, validarPasso, montarPayloadIngestao, oQueSePerdeAoFechar,
  textoDoRodapePasso2, somasProvisao, competenciaProximaParcela, proximaParcela,
  parcelasRestantes, vencimentoDaCompetencia, formatarMoeda, numero, inteiro, rotuloModalidade,
} from "../lib/wizardParcelamento";

const PANEL = {
  surface: "#21222C", field: "#282A36", border: "#44475A",
  text: "#F8F8F2", muted: "#aeb6d3",
};
const FIELD = {
  background: PANEL.field, border: `1px solid ${PANEL.border}`, color: PANEL.text,
  borderRadius: 6, padding: "6px 10px", fontSize: "0.85rem", width: "100%",
};
const LBL = { fontSize: "0.72rem", color: PANEL.muted, display: "block", marginBottom: 2 };

function Campo({ label, hint, erro, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={LBL}>{label}</span>
      {children}
      {hint && !erro && <span style={{ display: "block", fontSize: "0.66rem", color: PANEL.muted, marginTop: 2, lineHeight: 1.35 }}>{hint}</span>}
      {erro && <span style={{ display: "block", fontSize: "0.68rem", color: "var(--state-danger)", marginTop: 2, lineHeight: 1.35 }}>{erro}</span>}
    </label>
  );
}

function Aviso({ tom = "warn", titulo, children }) {
  const cor = tom === "danger" ? "var(--state-danger)" : tom === "ok" ? "var(--state-ok)" : "var(--state-warn)";
  const fundo = tom === "danger" ? "var(--state-danger-surface)" : tom === "ok" ? "var(--state-ok-surface)" : "var(--state-warn-surface)";
  return (
    <div role="status" style={{ padding: "7px 10px", borderRadius: 6, background: fundo, border: `1px solid ${cor}` }}>
      {titulo && <div style={{ color: cor, fontWeight: 700, fontSize: "0.72rem" }}>{titulo}</div>}
      <div style={{ color: PANEL.muted, fontSize: "0.7rem", marginTop: titulo ? 2 : 0, lineHeight: 1.4 }}>{children}</div>
    </div>
  );
}

/** Indicador de progresso: concluído = ✓ em `--state-ok`, atual = accent, futuro = `--text-faint`. */
function Progresso({ passo }) {
  return (
    <ol style={{ display: "flex", gap: 8, listStyle: "none", margin: 0, padding: 0, flexWrap: "wrap" }}>
      {PASSOS.map((p) => {
        const concluido = p.id < passo;
        const atual = p.id === passo;
        const cor = concluido ? "var(--state-ok)" : atual ? "var(--accent-purple)" : "var(--text-faint)";
        return (
          <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }} aria-current={atual ? "step" : undefined}>
            <span style={{
              width: 20, height: 20, borderRadius: 999, border: `1px solid ${cor}`, color: cor,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.66rem", fontWeight: 700,
              background: atual ? "var(--accent-purple-surface)" : "transparent",
            }}>
              {concluido ? "✓" : p.id}
            </span>
            <span style={{ color: cor, fontSize: "0.74rem", fontWeight: atual ? 700 : 600 }}>{p.titulo}</span>
            {p.id < PASSOS.length && <span style={{ color: "var(--text-faint)", marginLeft: 4 }}>›</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function ParcelamentoWizard({
  onIngest, onClose, onConsultSerpro, getContasProvisao,
  accounts = [], onSearchHistoricos, onGetHistoricosByCode,
  saving = false,
}) {
  const [passo, setPasso] = useState(1);
  const [dados, setDados] = useState(estadoInicial);
  const [tocado, setTocado] = useState(false);        // já tentou avançar neste passo?
  const [erroServidor, setErroServidor] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);

  // Passo 1 — atalho SERPRO (opcional, NUNCA obrigatório).
  const [serproBusy, setSerproBusy] = useState(false);
  const [serproDesfecho, setSerproDesfecho] = useState(null); // { tom, titulo, detalhe }

  // Passo 3 — modo edição das linhas + composição por tributo colapsada.
  const [editando, setEditando] = useState(false);
  const [composicaoAberta, setComposicaoAberta] = useState(false);
  const [templateConhecido, setTemplateConhecido] = useState(null); // null = ainda não sei

  const set = useCallback((patch) => setDados((d) => ({ ...d, ...patch })), []);

  const validacao = useMemo(() => validarPasso(passo, dados), [passo, dados]);

  // ─── memória de contas por modalidade ─────────────────────────────────────────────────────────
  // ⚠ A MEMÓRIA DO PARCELAMENTO É DO ESCRITÓRIO, NÃO DA EMPRESA. `memorizeMapaContaTributo` grava
  // com `portalClientId: null` (escopo GLOBAL) desde a Q21 — preencher as contas aqui já vira o
  // padrão de TODAS as empresas. É por isso que NÃO existe checkbox "salvar como padrão da
  // modalidade": ele descreveria uma escolha que não existe, e desmarcá-lo não faria nada.
  const modelo = dados.modeloContas || dados.tipo;
  useEffect(() => {
    let cancelado = false;
    if (!getContasProvisao) { setTemplateConhecido(false); return undefined; }
    (async () => {
      const contas = await getContasProvisao(modelo);
      if (cancelado) return;
      const algumaConta = contas && Object.values(contas).some((c) => String(c || "").trim());
      setTemplateConhecido(Boolean(algumaConta));
      // ⚠ PRIMEIRA VEZ DE UMA MODALIDADE: sem template, o passo 3 abre DIRETO em modo edição, com
      // as descrições sugeridas e as contas em branco. Uma tabela read-only vazia esperaria que o
      // contador descobrisse sozinho que existe um link "Editar lançamentos".
      if (!algumaConta) setEditando(true);
      setDados((d) => ({
        ...d,
        provisaoLines: d.provisaoLines.map((l) => (!l.conta && contas?.[l.tipoLinha] ? { ...l, conta: contas[l.tipoLinha] } : l)),
        pagamentoLines: d.pagamentoLines.map((l) => (!l.conta && contas?.[l.tipoLinha] ? { ...l, conta: contas[l.tipoLinha] } : l)),
      }));
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo]);

  // A modalidade escolhida no passo 1 é o modelo default — mas o contador pode apontar para outra.
  useEffect(() => { setDados((d) => ({ ...d, modeloContas: d.tipo })); }, [dados.tipo]);

  // ─── passo 2: o principal a provisionar alimenta as linhas ────────────────────────────────────
  const restantes = parcelasRestantes(dados);
  const projetado = Math.round(numero(dados.valorParcela) * restantes * 100) / 100;

  function setLinhaProvisao(i, chave, valor) {
    setDados((d) => {
      // ⚠ ESCOLHER O PAPEL LEVA O LADO JUNTO — é metade do conserto de "D↔C e papel divergem".
      // `setLinhaProvisao` escrevia SÓ a chave editada, e por isso trocar D↔C deixava o papel para
      // trás: em produção há um CRÉDITO marcado `PRINCIPAL` (`OUTRO nº 3`) nascido exatamente assim.
      // A derivação só vale nesta direção (papel → lado), porque o papel é uma escolha EXPLÍCITA e o
      // lado dele é determinístico. Na direção oposta nada é reescrito por baixo do contador: mudar
      // o lado para o lado errado do papel é RECUSADO por `validarPasso3`, com o motivo na tela.
      const linhas = d.provisaoLines.map((l, idx) => {
        if (idx !== i) return l;
        return chave === "tipoLinha" ? linhaComPapel(l, valor) : { ...l, [chave]: valor };
      });
      // O crédito do passivo espelha o total dos DÉBITOS enquanto o contador não o edita à mão — é
      // o que mantém Σ D = Σ C sem obrigá-lo a digitar o mesmo número duas vezes.
      //
      // ⚠ O ESPELHO SÓ VALE QUANDO A LINHA EDITADA É DE DÉBITO. Espelhando também na edição de uma
      // linha de CRÉDITO, o valor digitado é sobrescrito no mesmo tick: o campo "não aceita" o que
      // se escreve nele, e — pior — fica IMPOSSÍVEL desbalancear de propósito, o que faz a trava de
      // D ≠ C parecer funcionando quando na verdade nunca é alcançada.
      //
      // ⚠ O ESPELHO TAMBÉM CORRE NA TROCA DE PAPEL, e por um motivo concreto desta fase: agora a
      // contrapartida é `principal + juros + multa`, e mudar o papel de uma linha pode mudar de
      // lado (D↔C) e portanto mudar a soma dos débitos. Sem isto, marcar uma linha como JUROS
      // deixaria o crédito parado no valor anterior — Σ D ≠ Σ C sem ninguém ter digitado nada.
      if ((chave === "valor" || chave === "tipoLinha") && (linhas[i]?.tipo === "D" || chave === "tipoLinha")) {
        const debito = linhas.filter((l) => l.tipo === "D").reduce((s, l) => s + numero(l.valor), 0);
        const idxParc = linhas.findIndex((l) => l.tipo === "C" && l.tipoLinha === "PARC");
        if (idxParc >= 0 && idxParc !== i) linhas[idxParc] = { ...linhas[idxParc], valor: debito ? String(Math.round(debito * 100) / 100) : "" };
      }
      return {
        ...d,
        provisaoLines: linhas,
        contasEditadas: chave === "conta" ? inteiro(d.contasEditadas) + 1 : d.contasEditadas,
      };
    });
  }
  // ⚠ A LINHA NOVA NASCE **SEM PAPEL**, e a ausência é a entrega. Ela nascia `tipoLinha: "PRINCIPAL"`
  // cravado, e era esse chute que fazia o contador escolher a conta 501 (juros), digitar o valor e o
  // sistema gravar "principal" — a provisão torta da SINTROPIA saiu daí. Sem papel, `validarPasso3`
  // recusa e o backend recusa junto (400 `PAPEL_DE_LINHA_AUSENTE`): o contador PRECISA declarar.
  const addLinhaProvisao = () => setDados((d) => ({ ...d, provisaoLines: [...d.provisaoLines, { tipoLinha: "", label: "", tipo: "D", conta: "", valor: "" }] }));
  const rmLinhaProvisao = (i) => setDados((d) => ({ ...d, provisaoLines: d.provisaoLines.length > 1 ? d.provisaoLines.filter((_, idx) => idx !== i) : d.provisaoLines }));
  const setLinhaPagamento = (i, chave, valor) => setDados((d) => ({
    ...d,
    pagamentoLines: d.pagamentoLines.map((l, idx) => (idx === i ? { ...l, [chave]: valor } : l)),
    contasEditadas: chave === "conta" ? inteiro(d.contasEditadas) + 1 : d.contasEditadas,
  }));
  const addLinhaPagamento = () => setDados((d) => ({ ...d, pagamentoLines: [...d.pagamentoLines, { tipoLinha: "PARC", label: "", tipo: "D", conta: "" }] }));
  const rmLinhaPagamento = (i) => setDados((d) => ({ ...d, pagamentoLines: d.pagamentoLines.length > 1 ? d.pagamentoLines.filter((_, idx) => idx !== i) : d.pagamentoLines }));

  const setTributo = (i, k, v) => setDados((d) => ({ ...d, tributos: d.tributos.map((t, idx) => (idx === i ? { ...t, [k]: v } : t)) }));
  const addTributo = () => setDados((d) => ({ ...d, tributos: [...d.tributos, { codigoTributo: "", principal: "", multa: "", juros: "" }] }));
  const rmTributo = (i) => setDados((d) => ({ ...d, tributos: d.tributos.filter((_, idx) => idx !== i) }));

  // ─── navegação ────────────────────────────────────────────────────────────────────────────────
  function avancar() {
    setTocado(true);
    if (!validacao.ok) return;
    setTocado(false);
    setPasso((p) => Math.min(PASSOS.length, p + 1));
  }
  function voltar() {
    // ⚠ Voltar PRESERVA os dados: `dados` é um estado só, e nenhum passo o zera.
    setTocado(false);
    setErroServidor("");
    setPasso((p) => Math.max(1, p - 1));
  }

  const perde = oQueSePerdeAoFechar(dados);
  function pedirParaFechar() {
    if (!perde.length) { onClose?.(); return; }
    setConfirmandoSaida(true);
  }

  // ESC fecha (passando pela confirmação); clicar fora NÃO — o formulário é longo.
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") pedirParaFechar(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function consultarSerpro() {
    setSerproDesfecho(null);
    if (!String(dados.numeroParcelamento || "").trim()) {
      setSerproDesfecho({ tom: "warn", titulo: "Informe o nº do parcelamento", detalhe: "A consulta do SERPRO é por CÓDIGO — sem o número não há o que consultar." });
      return;
    }
    setSerproBusy(true);
    try {
      const dto = await onConsultSerpro({ tipo: dados.tipo, numeroParcelamento: String(dados.numeroParcelamento).trim() });
      if (!dto) {
        setSerproDesfecho({ tom: "warn", titulo: "O SERPRO não devolveu dados", detalhe: "Preencha os campos à mão — o wizard continua normalmente." });
        return;
      }
      set({
        totalParcelas: dto.quantidadeParcelas != null ? String(dto.quantidadeParcelas) : dados.totalParcelas,
        saldoConsolidado: dto.valorTotal != null ? String(dto.valorTotal) : dados.saldoConsolidado,
      });
      setSerproDesfecho({ tom: "ok", titulo: "Consulta concluída", detalhe: "Os campos que vieram preenchidos estão no passo 2 — confira antes de seguir." });
    } catch (err) {
      // ⚠ CAMINHO DE FALHA ESPERADO. A flag `INTEGRACAO_SERPRO_PARCELAMENTO` está DESLIGADA em
      // produção, e a rota responde 400 `SERPRO_PARC_FLAG_OFF` com a mensagem. Isso não é um erro
      // do contador nem impede nada: o atalho é opcional, e o motivo fica na tela em vez de sumir
      // num alert.
      const codigo = err?.error || err?.code || "";
      const detalhe = codigo === "SERPRO_PARC_FLAG_OFF"
        ? "A integração de parcelamento do SERPRO está desligada neste ambiente (ela só é ligada depois de validada no sandbox). Preencha os valores à mão — nada aqui depende dela."
        : (err?.message || "Não foi possível consultar. Preencha os valores à mão — nada aqui depende do SERPRO.");
      setSerproDesfecho({ tom: "warn", titulo: "Consulta não realizada", detalhe });
    } finally {
      setSerproBusy(false);
    }
  }

  async function concluir() {
    setTocado(true);
    setErroServidor("");
    if (!validacao.ok) return;
    setBusy(true);
    try {
      const body = montarPayloadIngestao(dados);
      const res = await onIngest(body);
      if (res?.ok === false) {
        setErroServidor(res?.message || res?.error || "O servidor recusou o parcelamento.");
        return;
      }
      onClose?.(res);
    } catch (err) {
      setErroServidor(err?.message || "Falha ao criar o parcelamento.");
    } finally {
      setBusy(false);
    }
  }

  const erros = tocado ? validacao.erros : {};
  const trabalhando = busy || saving;
  const somas = somasProvisao(dados.provisaoLines);
  const compProxima = competenciaProximaParcela(dados);

  const iconBtn = { background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.text, borderRadius: 6, width: 26, height: 26, lineHeight: "22px", textAlign: "center", cursor: "pointer", fontSize: "1rem", padding: 0 };
  const th = { textAlign: "left", padding: "4px 6px", fontSize: "0.66rem", color: PANEL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" };
  const td = { padding: "4px 6px", fontSize: "0.78rem", color: PANEL.text };

  // ⚠ O SELETOR D/C ESTAVA SENDO ESPREMIDO — e a largura do MODAL não tinha nada com isso.
  //
  // A coluna era `width: 52`, e o `<td>` cobra `padding: "4px 6px"` POR CIMA dela. Como o `FIELD`
  // traz `width: "100%"`, sobravam 52 − 12 = **40px** para um `<select>` que o browser mede em
  // **44px** para desenhar "D" e a seta lado a lado: os 4px que faltam saem de cima da letra, a
  // seta come o "D". Nos modais irmãos (`ParcelamentoModals.jsx`) o MESMO select recebe 56 − 6 =
  // 50px — é por isso que só aqui aparece.
  //
  // Alargar o modal não resolveria: a coluna é fixa e mede 52px igual em 1366px e em 900px de
  // viewport (o `min(96vw, 900px)` só encolhe a Descrição, que é a coluna flexível). O que resolve
  // é dar largura à COLUNA — os 12px extras saem da Descrição, ninguém rola nada de lado.
  //
  // O `minWidth` é a trava, não a folga: a seta do `<select>` é mais larga em alguns sistemas, e
  // sem um piso o próximo tema/zoom repõe o defeito em silêncio. Ele também impede a coluna de
  // colapsar abaixo disso quando a tabela aperta.
  const COL_DC = 64;
  const selectDC = { ...FIELD, padding: "4px 6px", colorScheme: "dark", minWidth: 46 };

  // ⚠ A COLUNA DE PAPEL — a casa que não existia. Mesma disciplina de largura da coluna D/C: valor
  // fixo no `<th>` + `minWidth` no `<select>` como piso, e a folga sai da Descrição (a coluna
  // flexível), nunca do modal. O rótulo mais longo é "Parcelamento a pagar (passivo)"; ele é
  // truncado pelo próprio `<select>` sem empurrar a tabela.
  const COL_PAPEL = 168;
  const selectPapel = { ...FIELD, padding: "4px 6px", colorScheme: "dark", minWidth: 140 };

  // ⚠ E A TABELA ROLA DENTRO DELA MESMA, não some pela borda. O painel do modal é
  // `overflowX: "hidden"`: abaixo de ~710px de viewport a tabela (640px de mínimo) já não cabia e a
  // coluna do "×" era simplesmente CORTADA, sem barra nenhuma para alcançá-la — o mesmo desfecho
  // que o card do parcelamento teve no incidente das 60 prestações. Alargar a coluna D/C empurra
  // esse limiar em 12px, então a rolagem entra junto: `apps/web/CLAUDE.md` manda o conteúdo largo
  // rolar no PRÓPRIO container, e o corpo da página nunca na horizontal — o `overflowX: "hidden"`
  // do painel continua garantindo a segunda metade. Acima do limiar nada muda: sem transbordo, sem
  // barra. O dropdown do `AccountCodeInput` é `position: fixed` justamente para não ser cortado por
  // isto (ver o comentário dele), e nenhum ancestral tem `transform`, então ele segue escapando.
  const rolagemTabela = { overflowX: "auto" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1600, padding: 16 }}>
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 20, width: "min(96vw, 900px)", maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", color: PANEL.text, display: "flex", flexDirection: "column", gap: 14 }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <strong style={{ fontSize: "1.05rem" }}>Novo parcelamento</strong>
            <div style={{ fontSize: "0.74rem", color: PANEL.muted, marginTop: 2, lineHeight: 1.4 }}>
              O contrato é registrado <strong>sem nenhuma guia</strong>. A guia de cada mês é evidência
              opcional — em débito automático ela não existe.
            </div>
          </div>
          <button type="button" onClick={pedirParaFechar} aria-label="Fechar" style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>

        <Progresso passo={passo} />

        {/* ─── PASSO 1 — Identificação ───────────────────────────────────────────────────────── */}
        {passo === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <Campo label="Modalidade *" erro={erros.tipo}>
                <select value={dados.tipo} onChange={(e) => set({ tipo: e.target.value })} style={{ ...FIELD, colorScheme: "dark" }}>
                  {MODALIDADES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </Campo>
              <Campo label="Nº do parcelamento *" erro={erros.numeroParcelamento} hint="Número oficial (RFB).">
                <input value={dados.numeroParcelamento} onChange={(e) => set({ numeroParcelamento: e.target.value })} placeholder="ex.: 1234567" style={FIELD} />
              </Campo>
              <Campo label="Data de adesão *" erro={erros.dataAdesao} hint="É a data do lançamento da provisão.">
                <input type="date" value={dados.dataAdesao} onChange={(e) => set({ dataAdesao: e.target.value })} style={{ ...FIELD, colorScheme: "dark" }} />
              </Campo>
            </div>

            <fieldset style={{ border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 10, margin: 0 }}>
              <legend style={{ ...LBL, marginBottom: 0, padding: "0 4px" }}>Situação *</legend>
              <div style={{ display: "grid", gap: 6 }}>
                {SITUACOES.map(([v, titulo, detalhe]) => (
                  <label key={v} style={{
                    display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 9px", borderRadius: 6, cursor: "pointer",
                    border: `1px solid ${dados.situacao === v ? "var(--accent-purple)" : PANEL.border}`,
                    background: dados.situacao === v ? "var(--accent-purple-surface)" : "transparent",
                  }}>
                    <input type="radio" name="situacao-parcelamento" checked={dados.situacao === v} onChange={() => set({ situacao: v })} style={{ marginTop: 2 }} />
                    <span>
                      <span style={{ display: "block", fontSize: "0.8rem", fontWeight: 700 }}>{titulo}</span>
                      <span style={{ display: "block", fontSize: "0.68rem", color: PANEL.muted, lineHeight: 1.35 }}>{detalhe}</span>
                    </span>
                  </label>
                ))}
              </div>
              {erros.situacao && <div style={{ fontSize: "0.68rem", color: "var(--state-danger)", marginTop: 4 }}>{erros.situacao}</div>}
            </fieldset>

            <Campo label="Descrição (opcional)" hint="Quais competências foram parceladas.">
              <textarea rows={2} value={dados.descricao} onChange={(e) => set({ descricao: e.target.value })}
                placeholder="Ex.: DAS de SET/OUT/NOV/2024 e MAR..NOV/2025" style={{ ...FIELD, resize: "vertical" }} />
            </Campo>

            {/* Atalho OPCIONAL. Nunca é caminho obrigatório e nunca bloqueia o wizard. */}
            <div style={{ border: `1px dashed ${PANEL.border}`, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>Consultar no SERPRO (opcional)</div>
                  <div style={{ fontSize: "0.68rem", color: PANEL.muted }}>Tenta preencher total de parcelas e saldo a partir do nº informado.</div>
                </div>
                <Button size="sm" variant="secondary" type="button" onClick={consultarSerpro} disabled={serproBusy || !onConsultSerpro}
                  title={!onConsultSerpro ? "A consulta não está disponível neste modo de API." : "Consulta paga — usa o nº do parcelamento acima."}>
                  {serproBusy ? "Consultando…" : "Consultar no SERPRO"}
                </Button>
              </div>
              {serproDesfecho && (
                <Aviso tom={serproDesfecho.tom} titulo={serproDesfecho.titulo}>{serproDesfecho.detalhe}</Aviso>
              )}
            </div>
          </div>
        )}

        {/* ─── PASSO 2 — Valores e parcelas ──────────────────────────────────────────────────── */}
        {passo === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <Campo label="Saldo consolidado atual (R$) *" erro={erros.saldoConsolidado}
                hint="Informativo: fica gravado e é exibido para conferência. Não vira lançamento.">
                <input value={dados.saldoConsolidado} onChange={(e) => set({ saldoConsolidado: e.target.value })} placeholder="0,00" inputMode="decimal" style={{ ...FIELD, textAlign: "right" }} />
              </Campo>
              <Campo label="Valor da parcela (R$) *" erro={erros.valorParcela}>
                <input value={dados.valorParcela} onChange={(e) => set({ valorParcela: e.target.value })} placeholder="0,00" inputMode="decimal" style={{ ...FIELD, textAlign: "right" }} />
              </Campo>
              <Campo label="Total de parcelas *" erro={erros.totalParcelas}>
                <input type="number" min="1" max="120" value={dados.totalParcelas} onChange={(e) => set({ totalParcelas: e.target.value })} style={FIELD} />
              </Campo>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {dados.situacao === "EM_ANDAMENTO" ? (
                <Campo label="Parcelas já pagas *" erro={erros.parcelasJaPagas}
                  hint="Entram como histórico: contam como quitadas e NÃO geram lançamento (não houve pagamento nosso).">
                  <input type="number" min="1" value={dados.parcelasJaPagas} onChange={(e) => set({ parcelasJaPagas: e.target.value })} style={FIELD} />
                </Campo>
              ) : <div />}
              <Campo label="Competência da 1ª parcela *" erro={erros.competenciaPrimeiraParcela}
                hint="É dela que sai o cronograma inteiro — não é a competência da próxima.">
                <input type="month" value={dados.competenciaPrimeiraParcela} onChange={(e) => set({ competenciaPrimeiraParcela: e.target.value })} style={{ ...FIELD, colorScheme: "dark" }} />
              </Campo>
              {/* ⚠ O CAMPO QUE MAIS IMPORTA: é a data que decide atraso quando não há guia. */}
              <Campo label="Vencimento mensal (dia) *" erro={erros.diaVencimento}
                hint="Quando não há guia, é esta data que decide se a prestação está em atraso.">
                <input type="number" min="1" max="31" value={dados.diaVencimento} onChange={(e) => set({ diaVencimento: e.target.value })} placeholder="ex.: 20" style={FIELD} />
              </Campo>
            </div>

            <fieldset style={{ border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 10, margin: 0 }}>
              <legend style={{ ...LBL, marginBottom: 0, padding: "0 4px" }}>Forma de pagamento</legend>
              <div style={{ display: "grid", gap: 6 }}>
                {FORMAS_PAGAMENTO.map(([v, titulo, detalhe]) => (
                  <label key={v || "nao-declarada"} style={{
                    display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 9px", borderRadius: 6, cursor: "pointer",
                    border: `1px solid ${dados.formaPagamento === v ? "var(--accent-purple)" : PANEL.border}`,
                    background: dados.formaPagamento === v ? "var(--accent-purple-surface)" : "transparent",
                  }}>
                    <input type="radio" name="forma-pagamento" checked={dados.formaPagamento === v} onChange={() => set({ formaPagamento: v })} style={{ marginTop: 2 }} />
                    <span>
                      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 700 }}>{titulo}</span>
                      <span style={{ display: "block", fontSize: "0.66rem", color: PANEL.muted, lineHeight: 1.35 }}>{detalhe}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Rodapé que recalcula a cada tecla. */}
            <div style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--accent-purple)" }}>{textoDoRodapePasso2(dados)}</div>
              <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginTop: 3, lineHeight: 1.45 }}>
                Próxima prestação: <strong style={{ color: PANEL.text }}>{proximaParcela(dados)}</strong>
                {inteiro(dados.totalParcelas) ? ` de ${inteiro(dados.totalParcelas)}` : ""}
                {compProxima ? ` · competência ${compProxima}` : ""}
                {compProxima && inteiro(dados.diaVencimento) ? ` · vence ${vencimentoDaCompetencia(compProxima, dados.diaVencimento)}` : ""}
                {restantes > 0 && numero(dados.valorParcela) > 0
                  ? ` · parcela × restantes = R$ ${formatarMoeda(projetado)}`
                  : ""}
              </div>
            </div>

            {validacao.alertas.map((a) => (
              <Aviso key={a.slice(0, 40)} tom="warn" titulo="Confira">{a}</Aviso>
            ))}
          </div>
        )}

        {/* ─── PASSO 3 — Contabilização ──────────────────────────────────────────────────────── */}
        {passo === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, alignItems: "start" }}>
              <Campo label="Modelo de contas" hint="De qual modalidade puxar as contas já aprendidas.">
                <select value={dados.modeloContas} onChange={(e) => set({ modeloContas: e.target.value })} style={{ ...FIELD, colorScheme: "dark" }}>
                  {MODALIDADES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </Campo>
              {/* ⚠ SEM CHECKBOX "SALVAR COMO PADRÃO DA MODALIDADE" — ver o comentário do efeito acima:
                  o backend SEMPRE grava global, então o checkbox prometeria uma escolha inexistente. */}
              <div style={{ fontSize: "0.7rem", color: PANEL.muted, lineHeight: 1.45, paddingTop: 18 }}>
                As contas preenchidas aqui viram o <strong style={{ color: PANEL.text }}>padrão desta modalidade para todas as
                empresas do escritório</strong> — a memória do parcelamento é global, não há padrão por empresa.
                {templateConhecido === false && (
                  <> Esta é a <strong style={{ color: "var(--state-warn)" }}>primeira vez</strong> de {rotuloModalidade(modelo)}: as contas
                  começam em branco.</>
                )}
              </div>
            </div>

            {/* PROVISÃO — com números. */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>Provisão da adesão</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {editando && <button type="button" onClick={addLinhaProvisao} title="Adicionar linha" style={iconBtn}>+</button>}
                  <button type="button" onClick={() => setEditando((e) => !e)}
                    style={{ background: "none", border: "none", color: "var(--accent-purple)", cursor: "pointer", fontWeight: 700, fontSize: "0.72rem", textDecoration: "underline", padding: 0 }}>
                    {editando ? "Concluir edição" : "Editar lançamentos"}
                  </button>
                </div>
              </div>
              <div style={rolagemTabela}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Descrição</th>
                  {/* ⚠ A COLUNA QUE FALTAVA. Sem ela não existia COMO DIZER que uma linha era juros:
                      o contador escolhia a conta 501 e digitava o valor, e o papel gravado continuava
                      "principal". É a causa raiz da provisão torta da SINTROPIA. */}
                  <th style={{ ...th, width: COL_PAPEL }}>Papel</th>
                  <th style={{ ...th, width: COL_DC }}>D/C</th>
                  <th style={{ ...th, width: 130 }}>Conta</th>
                  <th style={{ ...th, width: 130, textAlign: "right" }}>Valor</th>
                  {editando && <th style={{ width: 26 }} />}
                </tr></thead>
                <tbody>
                  {dados.provisaoLines.map((l, i) => {
                    const temValor = numero(l.valor) > 0;
                    const semPapel = temValor && !String(l.tipoLinha || "").trim();
                    const diverge = temValor && papelDivergeDoLado(l);
                    return (
                    <tr key={`prov-${i}`} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                      <td style={td}>
                        {editando
                          ? <input value={l.label} onChange={(e) => setLinhaProvisao(i, "label", e.target.value)} placeholder="descrição" style={{ ...FIELD, padding: "4px 6px" }} />
                          : (l.label || ROLE_LABEL[l.tipoLinha] || l.tipoLinha || "—")}
                      </td>
                      {/* O papel é editável SEMPRE, não só em "Editar lançamentos": ele é declaração
                          do contador sobre o que a linha É, e escondê-lo atrás de um link foi como
                          ele acabou implícito. Fora do modo edição a linha nova (sem papel) fica
                          nomeada — "escolha o papel" —, nunca em branco. */}
                      <td style={td}>
                        <select
                          value={l.tipoLinha || ""}
                          onChange={(e) => setLinhaProvisao(i, "tipoLinha", e.target.value)}
                          aria-label={`Papel da linha ${i + 1} da provisão`}
                          style={{
                            ...selectPapel,
                            border: `1px solid ${semPapel || diverge ? "var(--state-danger)" : PANEL.border}`,
                          }}
                        >
                          <option value="">— escolha o papel —</option>
                          {PAPEIS_PROVISAO.map((p) => <option key={p} value={p}>{ROLE_LABEL[p] || p}</option>)}
                        </select>
                        {diverge && (
                          <span style={{ display: "block", fontSize: "0.64rem", color: "var(--state-danger)", marginTop: 2, lineHeight: 1.3 }}>
                            {ROLE_LABEL[l.tipoLinha] || l.tipoLinha} não é {l.tipo === "C" ? "crédito" : "débito"} na provisão.
                          </span>
                        )}
                      </td>
                      <td style={td}>
                        {editando
                          ? (
                            <select value={l.tipo} onChange={(e) => setLinhaProvisao(i, "tipo", e.target.value)} style={selectDC}>
                              <option value="D">D</option><option value="C">C</option>
                            </select>
                          )
                          : l.tipo}
                      </td>
                      <td style={td}>
                        {editando
                          ? (
                            <AccountCodeInput
                              value={l.conta}
                              onChange={(v) => setLinhaProvisao(i, "conta", v)}
                              accounts={accounts}
                              onSearchHistoricos={onSearchHistoricos}
                              onGetHistoricosByCode={onGetHistoricosByCode}
                              placeholder="—"
                            />
                          )
                          : (l.conta || <span style={{ color: "var(--state-warn)" }}>em branco</span>)}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>
                        {/* Os valores dos DÉBITOS são digitados aqui mesmo fora do modo edição:
                            uma tabela totalmente read-only sem valor nenhum não teria como ser
                            preenchida sem descobrir o link "Editar lançamentos". Juros e multa
                            ficam em branco quando não existem — componente zerado não vira linha. */}
                        {(editando || (l.tipo === "D")) ? (
                          <input value={l.valor} onChange={(e) => setLinhaProvisao(i, "valor", e.target.value)} placeholder="0,00" inputMode="decimal"
                            style={{ ...FIELD, padding: "4px 6px", textAlign: "right" }} />
                        ) : (numero(l.valor) ? `R$ ${formatarMoeda(numero(l.valor))}` : "—")}
                      </td>
                      {editando && (
                        <td style={{ ...td, textAlign: "center" }}>
                          <button type="button" onClick={() => rmLinhaProvisao(i)} aria-label="Remover linha" style={{ background: "transparent", border: "none", color: "var(--state-danger)", cursor: "pointer" }}>×</button>
                        </td>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              {/* ⚠ A CONTRAPARTIDA É UMA SÓ, e o rodapé diz de que ela é feita. Sem esta frase, um
                  contador que digitou principal, juros e multa não tem como conferir que o crédito
                  do passivo é a SOMA dos três — que é exatamente o que o dono pediu. */}
              <div style={{ fontSize: "0.68rem", color: PANEL.muted, marginTop: 4, lineHeight: 1.45 }}>
                A provisão da adesão lança <strong style={{ color: PANEL.text }}>um débito por natureza</strong> (principal,
                juros, multa) e <strong style={{ color: PANEL.text }}>um único crédito</strong> em Parcelamento a pagar,
                pela soma dos três. Juros e multa podem apontar para a <strong style={{ color: PANEL.text }}>mesma conta</strong> —
                o papel continua separado. Natureza sem valor não vira lançamento.
              </div>
              <div style={{ textAlign: "right", fontSize: "0.72rem", color: somas.balanceado ? PANEL.muted : "var(--state-danger)", marginTop: 4 }}>
                Σ D <strong style={{ color: PANEL.text }}>R$ {formatarMoeda(somas.debito)}</strong>
                {" · "}Σ C <strong style={{ color: PANEL.text }}>R$ {formatarMoeda(somas.credito)}</strong>
                {somas.balanceado ? " ✓" : "  ⚠ D ≠ C"}
              </div>
              {/* Conferência: o saldo declarado NUNCA é lançado — ele aparece aqui ao lado do que
                  será provisionado, para o contador comparar. */}
              <div style={{ fontSize: "0.68rem", color: PANEL.muted, marginTop: 4, lineHeight: 1.45 }}>
                Conferência — saldo consolidado declarado: <strong style={{ color: PANEL.text }}>R$ {formatarMoeda(numero(dados.saldoConsolidado))}</strong>
                {" · "}valor da parcela × {restantes} restantes: <strong style={{ color: PANEL.text }}>R$ {formatarMoeda(projetado)}</strong>.
                {" "}O saldo é informativo e não vira lançamento.
              </div>
            </div>

            {/* PAGAMENTO — esquema, SEM valores. */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>Pagamento de cada parcela</div>
                {editando && <button type="button" onClick={addLinhaPagamento} title="Adicionar linha" style={iconBtn}>+</button>}
              </div>
              <div style={rolagemTabela}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Descrição</th>
                  <th style={{ ...th, width: COL_DC }}>D/C</th>
                  <th style={{ ...th, width: 130 }}>Conta</th>
                  <th style={{ ...th, width: 130, textAlign: "right" }}>Valor</th>
                  {editando && <th style={{ width: 26 }} />}
                </tr></thead>
                <tbody>
                  {dados.pagamentoLines.map((l, i) => (
                    <tr key={`pag-${i}`} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                      <td style={td}>
                        {editando
                          ? <input value={l.label} onChange={(e) => setLinhaPagamento(i, "label", e.target.value)} placeholder="descrição" style={{ ...FIELD, padding: "4px 6px" }} />
                          : (l.label || ROLE_LABEL[l.tipoLinha] || l.tipoLinha)}
                      </td>
                      <td style={td}>
                        {editando
                          ? (
                            <select value={l.tipo} onChange={(e) => setLinhaPagamento(i, "tipo", e.target.value)} style={selectDC}>
                              <option value="D">D</option><option value="C">C</option>
                            </select>
                          )
                          : l.tipo}
                      </td>
                      <td style={td}>
                        {editando
                          ? (
                            <AccountCodeInput
                              value={l.conta}
                              onChange={(v) => setLinhaPagamento(i, "conta", v)}
                              accounts={accounts}
                              onSearchHistoricos={onSearchHistoricos}
                              onGetHistoricosByCode={onGetHistoricosByCode}
                              placeholder="—"
                            />
                          )
                          : (l.conta || <span style={{ color: "var(--state-warn)" }}>em branco</span>)}
                      </td>
                      {/* ⚠ SEM VALOR, e isso é o ponto: a provisão tem números, a baixa é ESQUEMA.
                          O valor de cada parcela sai do comprovante na hora da baixa. */}
                      <td style={{ ...td, textAlign: "right", color: PANEL.muted, fontStyle: "italic" }}>da baixa</td>
                      {editando && (
                        <td style={{ ...td, textAlign: "center" }}>
                          <button type="button" onClick={() => rmLinhaPagamento(i)} aria-label="Remover linha" style={{ background: "transparent", border: "none", color: "var(--state-danger)", cursor: "pointer" }}>×</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>

            {/* Composição por tributo — opcional, colapsada. */}
            <div>
              <button type="button" onClick={() => setComposicaoAberta((a) => !a)} aria-expanded={composicaoAberta}
                style={{ background: "none", border: "none", color: "var(--accent-purple)", cursor: "pointer", fontWeight: 700, fontSize: "0.74rem", padding: 0 }}>
                {composicaoAberta ? "▾" : "▸"} Composição por tributo (opcional)
              </button>
              {composicaoAberta && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: "0.68rem", color: PANEL.muted, marginBottom: 6, lineHeight: 1.4 }}>
                    Serve para a baixa futura separar principal, juros e multa por código de receita.
                    Sem ela o contrato funciona igual — quem traz a composição é o comprovante.
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>
                      <th style={th}>Código</th>
                      <th style={{ ...th, textAlign: "right" }}>Principal</th>
                      <th style={{ ...th, textAlign: "right" }}>Multa</th>
                      <th style={{ ...th, textAlign: "right" }}>Juros</th>
                      <th style={{ width: 26 }} />
                    </tr></thead>
                    <tbody>
                      {dados.tributos.map((t, i) => (
                        <tr key={`trib-${i}`} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                          <td style={td}><input value={t.codigoTributo} onChange={(e) => setTributo(i, "codigoTributo", e.target.value)} placeholder="1001" style={{ ...FIELD, padding: "4px 6px" }} /></td>
                          {["principal", "multa", "juros"].map((k) => (
                            <td key={k} style={td}><input value={t[k]} onChange={(e) => setTributo(i, k, e.target.value)} placeholder="0,00" inputMode="decimal" style={{ ...FIELD, padding: "4px 6px", textAlign: "right" }} /></td>
                          ))}
                          <td style={{ ...td, textAlign: "center" }}>
                            <button type="button" onClick={() => rmTributo(i)} aria-label="Remover tributo" style={{ background: "transparent", border: "none", color: "var(--state-danger)", cursor: "pointer" }}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 6 }}>
                    <Button size="sm" variant="secondary" type="button" onClick={addTributo}>+ Tributo</Button>
                  </div>
                </div>
              )}
            </div>

            {validacao.alertas.map((a) => <Aviso key={a.slice(0, 40)} tom="warn" titulo="Confira">{a}</Aviso>)}
            {tocado && Object.values(validacao.erros).map((m) => <Aviso key={m.slice(0, 40)} tom="danger" titulo="Não dá para concluir">{m}</Aviso>)}
            {erroServidor && <Aviso tom="danger" titulo="O servidor recusou">{erroServidor}</Aviso>}
          </div>
        )}

        {/* ─── Barra de navegação ────────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderTop: `1px solid ${PANEL.border}`, paddingTop: 12 }}>
          <button type="button" onClick={pedirParaFechar} disabled={trabalhando}
            style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.muted, borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: "0.85rem" }}>
            Cancelar
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {passo > 1 && <Button variant="secondary" type="button" onClick={voltar} disabled={trabalhando}>‹ Voltar</Button>}
            {passo < PASSOS.length
              ? <Button variant="primary" type="button" onClick={avancar}>Continuar ›</Button>
              : <Button variant="primary" type="button" onClick={concluir} disabled={trabalhando}>{trabalhando ? "Criando…" : "Criar parcelamento"}</Button>}
          </div>
        </div>

        {/* Passo 1/2: os erros do passo aparecem embaixo, depois da 1ª tentativa de avançar. */}
        {passo < PASSOS.length && tocado && Object.values(validacao.erros).length > 0 && (
          <Aviso tom="danger" titulo="Falta preencher">
            {Object.values(validacao.erros).join(" · ")}
          </Aviso>
        )}
      </div>

      {/* ⚠ FECHAR COM DADOS PREENCHIDOS NOMEIA O QUE SE PERDE. */}
      {confirmandoSaida && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1700, padding: 16 }}>
          <div style={{ background: PANEL.surface, border: `1px solid var(--state-danger)`, borderRadius: 10, padding: 18, width: "min(94vw, 460px)", color: PANEL.text, display: "flex", flexDirection: "column", gap: 10 }}>
            <strong style={{ fontSize: "0.95rem" }}>Descartar este parcelamento?</strong>
            <div style={{ fontSize: "0.78rem", color: PANEL.muted, lineHeight: 1.5 }}>
              Você perde: {perde.join(" · ")}. Nada foi gravado ainda.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" type="button" onClick={() => setConfirmandoSaida(false)}>Continuar preenchendo</Button>
              <Button variant="danger" type="button" onClick={() => { setConfirmandoSaida(false); onClose?.(); }}>Descartar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ParcelamentoWizard;
