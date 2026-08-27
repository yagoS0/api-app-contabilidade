import { useEffect, useRef, useState, useMemo } from "react";
import { createApiClient } from "../../../../api/client";
import { Aviso } from "../../../../components/ui/Aviso";
import { Button } from "../../../../components/ui/Button";
// ⚠ AS DUAS CONVIVEM DE PROPÓSITO: `fmtDataCivil` para o VENCIMENTO (data civil, meia-noite UTC —
// `fmtDate` a imprimiria um dia antes) e `fmtDate` para `liberadaEm`, que é timestamp de verdade e
// deve mesmo sair no fuso de quem lê.
import { fmtDataCivil, fmtDate, fmtMoney } from "../../../../lib/format";
import { GuideCaptureModal } from "../../capture/components/renderGuideCaptureModal";
import { GuiaDeParcelamentoModal } from "./GuiaDeParcelamentoModal";
import { ehGuiaDeParcelamento, rotuloTipoGuia, tituloTipoGuia } from "../../lib/rotuloGuia";
import { estadoVazioDasGuias } from "../lib/estadoVazioGuias";
import { BotaoCopiar } from "../../../../components/ui/BotaoCopiar";
import { linhaDigitavelDaGuia } from "../../lib/linhaDigitavelTela";
import { MOTIVOS_GUIA_VAZIA, TEM_LISTA_DE_MOTIVOS, motivoParaGravar, motivoSuficiente } from "../lib/motivoGuiaVazia";
import { fraseDoLote, relatorioDoLote, DESFECHO } from "../lib/loteDoTrimestre";
import { competenciaAtual } from "../../../../lib/competencia";

// Q17: guias ESPERADAS do mês (por regime/prolabore) com botão "Vazio" (ausência confirmada).
// Mapeia a chave do compliance → tipo de Guide pra marcar Vazio.
const EXPECTED_GUIDE_ROWS = [
  { key: "das", label: "DAS (Simples)", tipo: "SIMPLES" },
  { key: "inss", label: "INSS", tipo: "INSS" },
  { key: "irpj", label: "IRPJ", tipo: "IRPJ" },
  { key: "csll", label: "CSLL", tipo: "CSLL" },
  { key: "pisCofins", label: "PIS/COFINS", tipo: "PIS" },
  { key: "iss", label: "ISS", tipo: "ISS" },
];

function prevMonthCompetencia() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const expectedGuidesApi = createApiClient();

// Dropdown "Marcar vazio" — lista as guias OBRIGATÓRIAS que ainda faltam no mês e permite marcá-las
// como VAZIO (ausência confirmada). Ao marcar, a guia aparece na própria tabela de Guias como VAZIO.
function MarcarVazioDropdown({ companyId, competencia, refreshKey, onChanged }) {
  const [compliance, setCompliance] = useState(null);
  const [monthClosed, setMonthClosed] = useState(false); // Q18: mês fechado bloqueia
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [r, fech] = await Promise.all([
          expectedGuidesApi.getExpectedGuides(companyId, competencia),
          expectedGuidesApi.getFechamentoContabil(companyId, competencia).catch(() => null),
        ]);
        if (cancel) return;
        setCompliance(r?.compliance || null);
        setMonthClosed(Boolean(fech?.fechado));
      } catch { if (!cancel) setCompliance(null); }
    })();
    // ⚠ O relatório do lote é sobre a competência em que ele foi disparado — trocar de mês o deixa
    // falando de outro contexto. Achado no navegador: ele seguia visível em 2026-04 depois de ter
    // sido disparado a partir de 2026-06.
    setRelatorio(null);
    return () => { cancel = true; };
  }, [companyId, competencia, refreshKey]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Candidatos = guias obrigatórias que ainda faltam (não presentes e ainda não marcadas vazio).
  const candidatos = EXPECTED_GUIDE_ROWS.filter((r) => {
    const node = compliance?.[r.key];
    return node?.required && node.state === "missing";
  });

  // ⚠ RECUSA COM `precisaConfirmar` NÃO É ERRO — é a evidência chegando ANTES da afirmação fiscal.
  // Enquanto isto caía no `window.alert` junto com as falhas de verdade, o contador via "Não dá para
  // marcar" e não tinha saída nenhuma pela tela (ver `lib/motivoGuiaVazia.js`).
  const [confirmacao, setConfirmacao] = useState(null); // { tipo, faturamento, message }
  const [motivoChave, setMotivoChave] = useState("");
  const [motivoTexto, setMotivoTexto] = useState("");
  // ⚠⚠ O LOTE DO TRIMESTRE nasce DESMARCADO. IRPJ/CSLL são trimestrais e os dois meses que não
  // fecham o trimestre não têm guia deles — mas marcar três meses de uma vez é uma afirmação fiscal
  // maior que marcar um, e alcance maior não pode acontecer por inércia. Mesmo desenho do escopo
  // GLOBAL da resolução de pendência.
  const [incluirTrimestre, setIncluirTrimestre] = useState(false);
  const [relatorio, setRelatorio] = useState(null);
  const lote = fraseDoLote(competencia, competenciaAtual());

  function fecharConfirmacao() {
    setConfirmacao(null); setMotivoChave(""); setMotivoTexto(""); setIncluirTrimestre(false);
  }

  async function marcar(tipo, { confirmado = false } = {}) {
    setBusy(true);
    try {
      const motivo = confirmado ? motivoParaGravar({ chave: motivoChave, texto: motivoTexto }) : "";
      // ⚠ As duas formas de recusa: o cliente real LANÇA em não-2xx, o mock devolve `{ok:false}` no
      // corpo. Tratar só uma deixaria a confirmação inalcançável em metade dos ambientes.
      const r = await expectedGuidesApi.markGuideVazio(companyId, tipo, competencia, motivo, { confirmado });
      if (r?.ok === false) throw Object.assign(new Error(r.message || "Falha ao marcar vazio."), r);

      // ⚠⚠ O LOTE É A MESMA CHAMADA, REPETIDA — nunca um atalho pela guarda. Cada mês passa pelo
      // mesmo `confirmado` e pelo mesmo motivo obrigatório, e cada um vira uma LINHA PRÓPRIA em
      // `Guide`, com `vazioEm`/`vazioPor`/`vazioMotivo` próprios: o lote poupa digitação, não
      // registro. E é SEQUENCIAL de propósito — o relatório precisa da ordem, e concorrência aqui
      // só serviria para dificultar a leitura do que falhou.
      const doLote = [];
      if (confirmado && incluirTrimestre && lote.podeOferecer) {
        for (const mes of lote.meses) {
          try {
            const rr = await expectedGuidesApi.markGuideVazio(companyId, tipo, mes, motivo, { confirmado: true });
            if (rr?.ok === false) throw Object.assign(new Error(rr.message || "Falha ao marcar vazio."), rr);
            doLote.push({ competencia: mes, desfecho: DESFECHO.MARCADA });
          } catch (e) {
            // ⚠ Um mês que falha NÃO derruba os outros — e o motivo dele aparece NOMEADO. Mês
            // contábil fechado devolve 409 `MES_FECHADO`, e silêncio ali faria "marquei o trimestre"
            // se ler como sucesso total.
            doLote.push({ competencia: mes, desfecho: DESFECHO.FALHOU, motivo: e?.message || null });
          }
        }
      }

      setOpen(false);
      fecharConfirmacao();
      setRelatorio(doLote.length ? relatorioDoLote(doLote) : null);
      if (onChanged) await onChanged();
    } catch (err) {
      if (err?.precisaConfirmar || err?.error === "GUIA_VAZIA_COM_FATURAMENTO") {
        setOpen(false);
        setConfirmacao({ tipo, faturamento: err.faturamento, message: err.message });
        return;
      }
      // eslint-disable-next-line no-alert
      window.alert(err?.message || "Falha ao marcar vazio.");
    } finally { setBusy(false); }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* ⚠ O desfecho do lote fica NA TELA depois que o modal fecha — sem ele, um mês que falhou
          (mês contábil fechado, por exemplo) some junto com o diálogo. */}
      {relatorio ? (
        <Aviso
          compacto
          tom={relatorio.tom}
          titulo={relatorio.titulo}
          role="status"
          style={{ marginBottom: 6 }}
          acao={<Button variant="secondary" size="sm" onClick={() => setRelatorio(null)}>Fechar</Button>}
        >
          {relatorio.texto}
        </Aviso>
      ) : null}
      <Button
        variant="secondary" size="sm" type="button"
        disabled={busy || monthClosed}
        title={monthClosed ? "Mês fechado — reabra a empresa para alterar." : "Marcar uma guia obrigatória como vazia neste mês"}
        onClick={() => setOpen((o) => !o)}
      >
        {monthClosed ? "🔒 Marcar vazio" : "Marcar vazio ▾"}
      </Button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          background: "#24253A", border: "1px solid #44475A", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: 200, overflow: "hidden",
        }}>
          <div style={{
            padding: "8px 12px", fontSize: "0.7rem", color: "var(--text-faint)",
            textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700,
            borderBottom: "1px solid #44475A",
          }}>
            Marcar vazia ({competencia})
          </div>
          {candidatos.length === 0 ? (
            <div style={{ padding: "8px 12px", fontSize: "0.8rem", color: "var(--text-faint)" }}>
              Nenhuma guia obrigatória pendente.
            </div>
          ) : candidatos.map((r) => (
            <button
              key={r.key} type="button" disabled={busy}
              onClick={() => marcar(r.tipo)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                background: "transparent", border: "none", color: "var(--text)",
                fontSize: "0.875rem", cursor: "pointer", fontWeight: 500,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* ⚠ CONFIRMAÇÃO QUE REPETE A EVIDÊNCIA — não é um "tem certeza?".
          O valor das notas da competência aparece por extenso, e o MOTIVO é obrigatório: é ele que
          responde "por que o contador afirmou ausência de guia havendo nota emitida?". Mesmo
          desenho de `avisosDeDuplicidade` ("DUPLICIDADE AVISA, NUNCA RECUSA"). */}
      {confirmacao && (
        <div onClick={fecharConfirmacao} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "var(--space-5)", width: "min(96vw, 520px)", color: "var(--text)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div style={{ fontSize: "1rem", fontWeight: 700 }}>
              Marcar {rotuloDoTipoEsperado(confirmacao.tipo)} como sem movimento?
            </div>
            <Aviso compacto tom="atencao" titulo="Há faturamento nesta competência">
              {confirmacao.faturamento != null && (
                <>Notas emitidas autorizadas somam <strong>{fmtMoney(confirmacao.faturamento)}</strong> em {competencia}. </>
              )}
              Marcar como sem movimento afirma que, mesmo assim, não há guia a pagar.
            </Aviso>

            {TEM_LISTA_DE_MOTIVOS && (
              <label style={{ display: "grid", gap: 4, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Motivo
                <select value={motivoChave} onChange={(e) => setMotivoChave(e.target.value)}
                  style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", padding: "6px 8px", fontSize: "0.85rem", colorScheme: "dark" }}>
                  <option value="">Escolha…</option>
                  {MOTIVOS_GUIA_VAZIA.map((m) => <option key={m.chave} value={m.chave}>{m.rotulo}</option>)}
                  {/* ⚠ Valor PRÓPRIO, não `""`: com dois `value=""` no mesmo select, "não escolhi"
                      e "escolhi Outro" ficariam indistinguíveis. `OUTRO` não casa com nenhuma chave
                      da lista, então `motivoParaGravar` cai no texto livre — que é o desejado. */}
                  <option value="OUTRO">Outro (descrever abaixo)</option>
                </select>
              </label>
            )}

            <label style={{ display: "grid", gap: 4, fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {TEM_LISTA_DE_MOTIVOS ? "Detalhe (obrigatório se \"Outro\")" : "Motivo (obrigatório)"}
              <textarea value={motivoTexto} onChange={(e) => setMotivoTexto(e.target.value)} rows={3}
                placeholder="Ex.: por que não há guia a pagar nesta competência"
                style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", padding: "6px 8px", fontSize: "0.85rem", resize: "vertical" }} />
            </label>
            {/* ⚠⚠ O LOTE DO TRIMESTRE — e a frase NOMEIA OS MESES. "Marcar o trimestre inteiro"
                seria mentira em duas direções: o mês do fechamento não entra (é nele que IRPJ e
                CSLL são apurados) e mês que ainda não terminou também não. */}
            {lote.podeOferecer ? (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={incluirTrimestre}
                  onChange={(e) => setIncluirTrimestre(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  {lote.texto}
                  {lote.ressalva ? (
                    <span style={{ display: "block", color: "var(--text-faint)", fontSize: "0.72rem" }}>
                      {lote.ressalva}
                    </span>
                  ) : null}
                </span>
              </label>
            ) : null}

            <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>
              Fica gravado com o seu usuário e a data, e aparece na guia.
              {lote.podeOferecer ? " Cada mês fica com o seu próprio registro." : ""}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <Button variant="secondary" size="sm" onClick={fecharConfirmacao} style={{ marginRight: "auto" }}>Cancelar</Button>
              {/* ⚠ Desabilitado NOMEIA o motivo — regra da casa. */}
              <Button size="sm" disabled={busy || !motivoSuficiente({ chave: motivoChave, texto: motivoTexto })}
                title={motivoSuficiente({ chave: motivoChave, texto: motivoTexto }) ? "" : "Informe o motivo para confirmar"}
                onClick={() => marcar(confirmacao.tipo, { confirmado: true })}>
                {busy ? "…" : "Confirmar sem movimento"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** O nome que o contador lê para o tipo de guia — a mesma lista do dropdown, não uma segunda. */
function rotuloDoTipoEsperado(tipo) {
  return EXPECTED_GUIDE_ROWS.find((r) => r.tipo === tipo)?.label || tipo;
}

// Tipos sempre disponíveis (qualquer regime).
//
// ⚠ `PARCELAMENTO` É UM TIPO NORMAL DESTE MENU, e isso é a entrega R4. Ele não é um tipo de guia no
// banco (a guia de uma parcela continua sendo SIMPLES/INSS/…): é o TIPO DE OPERAÇÃO — "esta guia é
// evidência de uma prestação de um contrato que já existe" — e abre o modal em que o parcelamento
// vem primeiro. O item anterior era uma entrada à parte, âmbar, chamada "Parcelamento…", que abria
// um modal de três opções capaz de CRIAR o contrato a partir da guia: exatamente o guia-first que
// esta fase inverteu.
const GUIDE_TYPES = ["SIMPLES", "INSS", "FGTS", "DARF", "ISS", "PIS", "COFINS", "IRPJ", "CSLL", "OUTRA"];

export const TIPO_UPLOAD_PARCELAMENTO = "PARCELAMENTO";

// Filtro contextual: empresas Simples não têm IRPJ/CSLL/PIS/COFINS/ISS (são exclusivos de Presumidos).
// Quando o regime não é conhecido, mostra tudo (comportamento conservador — usuário não fica travado).
const GUIDE_TYPES_BY_REGIME = {
  SIMPLES: ["SIMPLES", "INSS", "FGTS", "OUTRA"],
  LUCRO_PRESUMIDO: ["IRPJ", "CSLL", "PIS", "COFINS", "ISS", "DARF", "INSS", "FGTS", "OUTRA"],
  LUCRO_REAL: ["IRPJ", "CSLL", "PIS", "COFINS", "ISS", "DARF", "INSS", "FGTS", "OUTRA"],
};

function getAvailableGuideTypes(regimeTributario) {
  const r = String(regimeTributario || "").trim().toUpperCase();
  // PARCELAMENTO vale para QUALQUER regime: um parcelamento de INSS existe em Presumido também.
  return [...(GUIDE_TYPES_BY_REGIME[r] || GUIDE_TYPES), TIPO_UPLOAD_PARCELAMENTO];
}

const S = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  modal: {
    background: "#24253A", border: "1px solid #44475A", borderRadius: 8,
    padding: "24px 28px", width: 380, maxWidth: "95vw", color: "var(--text)",
  },
  title: { margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "var(--text)" },
  field: { marginBottom: 14 },
  label: { display: "block", fontSize: 12, color: "var(--text-faint)", marginBottom: 4 },
  input: {
    width: "100%", background: "#1A1B26", border: "1px solid #44475A",
    borderRadius: 4, color: "var(--text)", padding: "6px 10px", fontSize: 14, boxSizing: "border-box",
  },
  select: {
    width: "100%", background: "#1A1B26", border: "1px solid #44475A",
    borderRadius: 4, color: "var(--text)", padding: "6px 10px", fontSize: 14, boxSizing: "border-box",
  },
  btnRow: { display: "flex", gap: 8, marginTop: 16 },
  error: { fontSize: 12, color: "var(--state-danger)", marginBottom: 10 },
  checkbox: { width: 16, height: 16, cursor: "pointer", accentColor: "#BD93F9" },
};

function MetadataDialog({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    tipo: initial?.tipo || "",
    competencia: initial?.competencia || "",
    valor: initial?.valor != null ? String(initial.valor) : "",
    vencimento: initial?.vencimento ? String(initial.vencimento).slice(0, 10) : "",
  });
  const [error, setError] = useState("");

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    if (!form.tipo) { setError("Selecione o tipo da guia."); return; }
    if (!form.competencia.match(/^\d{4}-\d{2}$/)) {
      setError("Competência deve estar no formato AAAA-MM (ex: 2026-01).");
      return;
    }
    setError("");
    onSave({
      tipo: form.tipo,
      competencia: form.competencia,
      valor: form.valor !== "" ? Number(form.valor) : null,
      vencimento: form.vencimento || null,
    });
  }

  return (
    <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div style={S.modal}>
        <h3 style={S.title}>Identificar guia</h3>
        <p style={{ fontSize: 13, color: "var(--text-faint)", margin: "0 0 16px" }}>
          Não conseguimos identificar automaticamente esta guia. Preencha os dados abaixo.
        </p>

        {error && <div style={S.error}>{error}</div>}

        <div style={S.field}>
          <label style={S.label}>Tipo *</label>
          <select style={S.select} value={form.tipo} onChange={(e) => setField("tipo", e.target.value)}>
            <option value="">Selecione...</option>
            {GUIDE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div style={S.field}>
          <label style={S.label}>Competência * (AAAA-MM)</label>
          <input
            style={S.input} type="text" placeholder="2026-01"
            value={form.competencia}
            onChange={(e) => setField("competencia", e.target.value)}
          />
        </div>

        <div style={S.field}>
          <label style={S.label}>Valor (R$)</label>
          <input
            style={S.input} type="number" step="0.01" placeholder="0,00"
            value={form.valor}
            onChange={(e) => setField("valor", e.target.value)}
          />
        </div>

        <div style={S.field}>
          <label style={S.label}>Vencimento</label>
          <input
            style={S.input} type="date"
            value={form.vencimento}
            onChange={(e) => setField("vencimento", e.target.value)}
          />
        </div>

        <div style={S.btnRow}>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar guia"}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}

function normalizeValue(value) {
  return String(value || "").trim().toUpperCase();
}

function formatGuideStatus(status) {
  const n = normalizeValue(status);
  if (n === "PROCESSED") return { label: "Processada", tone: "success" };
  if (n === "ERROR") return { label: "Aguardando envio", tone: "warning" };
  if (n === "PENDING") return { label: "Pendente", tone: "muted" };
  return { label: status || "-", tone: "default" };
}

function formatEmailStatus(status) {
  const n = normalizeValue(status);
  if (n === "PENDING") return { label: "Pendente", tone: "accent" };
  if (n === "SENT") return { label: "Enviado", tone: "success" };
  if (n === "ERROR") return { label: "Erro", tone: "danger" };
  return { label: status || "-", tone: "default" };
}

function formatPaymentStatus(status) {
  const n = normalizeValue(status);
  if (n === "PAID") return { label: "Paga", tone: "success" };
  if (n === "OVERDUE") return { label: "Vencida", tone: "danger" };
  return { label: "Em aberto", tone: "warning" };
}

/**
 * LINHA DIGITÁVEL da guia — o número que o cliente digita no banco.
 *
 * ⚠⚠ AS TRÊS AUSÊNCIAS TÊM DESENHOS DIFERENTES, e é o ponto desta célula:
 *   • "não lida"                     → cinza, sem drama: ninguém olhou o documento ainda.
 *   • "sem linha no documento"       → cinza, mas com frase própria: olhamos e não havia.
 *   • "confira: valores divergentes" → ÂMBAR, e é a única em que o contador precisa AGIR.
 * Desenhar as três iguais devolveria ao balde único que este trabalho existe para desfazer.
 *
 * ⚠ NA DIVERGÊNCIA A LINHA NÃO APARECE. Ela é internamente íntegra (os cinco dígitos verificadores
 * fecham), mas discorda do valor da guia, e não se sabe qual dos dois está errado. Mostrar o número
 * seria oferecer como meio de pagamento algo que não se conferiu; omitir o conflito seria pior.
 * Então o que aparece é o CONFLITO, com os dois valores.
 *
 * ⚠ ÂMBAR, NUNCA VERMELHO: vermelho neste portal é o que BLOQUEIA o fechamento, e uma linha que não
 * bate não bloqueia nada. E nunca verde: verde é concluído, e ter o número não é etapa concluída.
 *
 * ⚠ A MÁSCARA É PARA O OLHO; O BOTÃO COPIA OS 48 DÍGITOS LIMPOS — é o que se digita no banco.
 */
function CelulaLinhaDigitavel({ guide }) {
  const leitura = linhaDigitavelDaGuia(guide);
  const temNumero = Boolean(leitura.linhaLimpa);
  return (
    <span
      className="guides-grid__cell guides-grid__cell--linha"
      role="cell"
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className="guides-grid__linha-numero"
        style={{ color: leitura.tom }}
        // ⚠ O `title` carrega a frase inteira e, quando o motivo NÃO está catalogado, o valor cru
        // junto — é por ele que uma auditoria recupera um motivo que a tela ainda não sabe nomear.
        title={leitura.motivoCru && !temNumero ? `${leitura.titulo} (${leitura.motivoCru})` : leitura.titulo}
      >
        {leitura.resumo}
      </span>
      {temNumero && (
        <BotaoCopiar
          valor={leitura.linhaLimpa}
          rotulo={`Copiar a linha digitável da guia ${rotuloTipoGuia(guide)} ${guide.competencia || ""}`.trim()}
          titulo="Copiar os 48 dígitos, sem máscara — é o que se digita no banco"
        />
      )}
    </span>
  );
}

export function CompanyGuidesTable({
  companyId,
  competencia: competenciaGlobal,  // do seletor do header — uma competência para a empresa inteira
  companyRegime,  // regime tributário da empresa: filtra opções do dropdown "+ Subir Guia"
  guides,
  loadingGuides,
  onResendGuide,
  onConfirmGuidePayment,
  onRecalculateGuide,
  onRecalcularInss,   // Q53: recálculo/traga explícito do INSS por competência
  recalcInssBusy,
  onLiberarGuia,      // Portal Cliente: libera SÓ a guia selecionada ao cliente (envia só ela por e-mail)
  liberarGuiasBusy,
  onDeleteGuide,
  resendingGuideId,
  confirmingGuideId,
  recalculatingGuideId,
  onUploadGuide,
  uploadingGuide,
  // Novos: identificação/completar guia já existente + fetch do PDF para o iframe.
  onIdentifyGuide,
  onFetchGuidePdf,
  // Hook de parcelamentos: alimenta o "+ Subir Guia → PARCELAMENTO" (lista de contratos ativos +
  // `ingest`, que é quem vincula a guia à prestação).
  parcelamentos,
  // Leva à criação do contrato (o wizard, na aba Parcelamentos) a partir do "＋ Criar novo…".
  onCriarParcelamento,
  // Sugestão de contas nos campos D/C — mesmo autocomplete usado em Lançamentos, Circular e OFX.
  accounts = [],
  onSearchHistoricos,
  onGetHistoricosByCode,
  // Estado vazio: leva à aba Apuração quando a competência ainda não foi apurada. Sem a prop o
  // texto continua aparecendo — o que se perde é só o atalho.
  onIrParaApuracao,
  // ⚠⚠ `onRefresh` ERA LIDO SEM SER DECLARADO — `ReferenceError` esperando um clique.
  //
  // Achado por varredura de `no-undef` em 25/08/2026 (a mesma que pegou o `secao` da Apuração, que
  // caiu em produção). Referenciar identificador não declarado dentro de um `if` **lança** — não é
  // `undefined`, é erro. Então "Marcar vazio", desfazer o vazio e anexar guia ao parcelamento
  // derrubavam a aba Guias no `ErrorBoundary`, nas linhas 477 e 754.
  //
  // ⚠ Vivo desde `e1ec3a8e` (09/08/2026). Nenhum chamador passa a prop hoje, então declará-la com
  // `null` mantém o comportamento pretendido (não recarrega nada) e tira o erro. Quem quiser a
  // recarga só precisa passá-la — que é o que o código já esperava poder fazer.
  onRefresh = null,
}) {
  // R4 — "+ Subir Guia → PARCELAMENTO": anexar uma guia a um contrato que JÁ EXISTE.
  //
  // ⚠ O QUE SAIU DAQUI (R1): `linkingGuide` (o modal-surpresa "Registrar 1ª parcela" que aparecia
  // DEPOIS de salvar a guia), `entradaOpen`/`serproPrefill` (o modal "Novo parcelamento" de três
  // opções) e `attachParc` (o desvio que subia a guia com tipo forçado e ainda confirmava o
  // pagamento dela). Os três eram o desenho guia-first.
  const [anexoParcelamentoOpen, setAnexoParcelamentoOpen] = useState(false);
  const [anexoArquivo, setAnexoArquivo] = useState(null);
  const [anexoParcelamentoId, setAnexoParcelamentoId] = useState("");
  const [anexoSaving, setAnexoSaving] = useState(false);
  const anexoFileInputRef = useRef(null);
  // "Marcar vazio": força recarga do dropdown + da lista de guias quando o estado muda.
  const [vazioRefreshKey, setVazioRefreshKey] = useState(0);
  async function refreshAfterVazio() {
    setVazioRefreshKey((k) => k + 1);
    if (onRefresh) await onRefresh();
  }
  async function handleUndoVazio(guide) {
    try {
      await expectedGuidesApi.undoGuideVazio(companyId, guide.tipo, guide.competencia);
      await refreshAfterVazio();
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(err?.message || "Falha ao desfazer vazio.");
    }
  }
  // Tipos disponíveis no dropdown filtrados pelo regime da empresa.
  // Simples não vê IRPJ/CSLL/PIS/COFINS/ISS; Presumido não vê SIMPLES.
  const availableUploadTypes = useMemo(
    () => getAvailableGuideTypes(companyRegime),
    [companyRegime],
  );
  // Q19: filtro único de competência (mês), default = mês anterior ao atual.
  // ⚠ A COMPETÊNCIA VEM DO HEADER. O que sobra aqui é "ver todas" — e ele virou EXPLÍCITO.
  //
  // Era um `input type="month"` com o mês anterior por padrão, e o único jeito de ver o histórico
  // era APAGAR o conteúdo do campo — gesto que ninguém descobre e que, feito sem querer, deixava a
  // tela mostrando guias de todos os meses sem dizer que estava fazendo isso. Agora o mês é o da
  // empresa (um controle só) e o histórico é uma caixa com nome.
  const [verTodasCompetencias, setVerTodasCompetencias] = useState(false);
  const filterCompetencia = verTodasCompetencias ? "" : (competenciaGlobal || prevMonthCompetencia());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  // Guia já enviada aguardando confirmação de reenvio (modal do "Liberar ao cliente").
  const [resendConfirm, setResendConfirm] = useState(null);
  const [recalcConfirm, setRecalcConfirm] = useState(null); // { guideId, aviso }

  // Upload flow (modal split): tipo escolhido no dropdown + arquivo + estado de salvamento
  const [uploadTipo, setUploadTipo] = useState(null);  // "DAS"|"INSS"|... — null = modal fechado
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const uploadMenuRef = useRef(null);

  // Completar flow (modal split p/ guia já existente)
  const [completingGuide, setCompletingGuide] = useState(null);
  const [completingSaving, setCompletingSaving] = useState(false);

  const filteredGuides = useMemo(() => {
    return guides.filter((g) => {
      // Competência vazia = mostra todas; senão filtra pelo mês escolhido.
      if (filterCompetencia && g.competencia !== filterCompetencia) return false;
      return true;
    });
  }, [filterCompetencia, guides]);

  // ── POR QUE NÃO HÁ GUIA — o contexto que transforma o vazio em resposta ──────────────────────
  //
  // ⚠ SÓ BUSCA QUANDO HÁ VAZIO A EXPLICAR. Competência com guia não paga chamada nenhuma; o efeito
  // depende de `precisaExplicarVazio` justamente para isso.
  //
  // São DUAS perguntas diferentes, e é por isso que são duas chamadas:
  //   `getFechamento`          → `estado` da APURAÇÃO (aberta/calculada/fechada/transmitida)
  //   `getFechamentoContabil`  → `semFaturamento`, a afirmação de que o mês não teve receita
  // ⚠ `monthClosed` (fechamento CONTÁBIL) é uma TERCEIRA pergunta e não entra aqui: mês fechado no
  // razão não diz nada sobre haver ou não guia a pagar.
  const precisaExplicarVazio = !loadingGuides && filteredGuides.length === 0;
  const [contextoVazio, setContextoVazio] = useState({ carregando: false, erro: null, semFaturamento: null, estadoApuracao: null });

  useEffect(() => {
    if (!precisaExplicarVazio || !companyId || !filterCompetencia) return undefined;
    let cancel = false;
    setContextoVazio((p) => ({ ...p, carregando: true }));
    (async () => {
      try {
        const [apuracao, contabil] = await Promise.all([
          expectedGuidesApi.getFechamento(companyId, filterCompetencia),
          expectedGuidesApi.getFechamentoContabil(companyId, filterCompetencia),
        ]);
        if (cancel) return;
        setContextoVazio({
          carregando: false,
          erro: null,
          semFaturamento: contabil?.semFaturamento === true,
          estadoApuracao: apuracao?.dados?.estado || apuracao?.estado || null,
        });
      } catch (err) {
        if (cancel) return;
        // ⚠ A FALHA É GUARDADA, NÃO ENGOLIDA. Era este o defeito: sem o erro, o vazio afirmava
        // "não há guia" sobre uma competência que ninguém conseguiu consultar.
        setContextoVazio({ carregando: false, erro: err, semFaturamento: null, estadoApuracao: null });
      }
    })();
    return () => { cancel = true; };
  }, [precisaExplicarVazio, companyId, filterCompetencia, vazioRefreshKey]);

  const leituraDoVazio = useMemo(() => estadoVazioDasGuias({
    competencia: filterCompetencia,
    erro: contextoVazio.erro,
    semFaturamento: contextoVazio.semFaturamento,
    estadoApuracao: contextoVazio.estadoApuracao,
  }), [filterCompetencia, contextoVazio]);

  const filteredIds = useMemo(
    () => filteredGuides.map((g) => g.guideId || g.id),
    [filteredGuides]
  );

  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someSelected = filteredIds.some((id) => selectedIds.has(id));
  const selectedCount = filteredIds.filter((id) => selectedIds.has(id)).length;

  // When exactly one guide is selected, expose it for single-guide actions
  const selectedGuide = useMemo(() => {
    if (selectedCount !== 1) return null;
    const selectedId = filteredIds.find((id) => selectedIds.has(id));
    return filteredGuides.find((g) => (g.guideId || g.id) === selectedId) ?? null;
  }, [selectedCount, filteredIds, filteredGuides, selectedIds]);

  const selectedGuideId = selectedGuide ? (selectedGuide.guideId || selectedGuide.id) : null;

  // Ações da guia selecionada -------------------------------------------------
  // Recalcular é UM botão só: detecta o tipo e chama o endpoint certo.
  //   INSS  → sync SERPRO DCTFweb da competência   ·  DAS/SIMPLES → recálculo PGDAS-D da guia.
  //
  // ⚠ A PARCELA de parcelamento é decidida ANTES do tipo — ela é `tipo:"SIMPLES"`, idêntica ao DAS
  // do mês, e caía inteira na regra do DAS acima.
  //
  // ⚠⚠ ESTE BLOCO DIZIA "**O backend não recusa**" ATÉ 27/08/2026, E ISSO DEIXOU DE SER VERDADE:
  // `especieDoRecalculo` (`application/guides/lib/recalculoDaGuia.js`) devolve `null` para guia com
  // `parcelamentoId`, então a rota recusa. A guarda subiu para o servidor porque o PORTAL DO CLIENTE
  // passou a alcançar a mesma rota — e regra que só mora nesta tela não protege porta nenhuma, nem
  // um `curl`. A guarda daqui FICA: dupla checagem é inofensiva, e removê-la faria a proteção
  // depender de uma camada só.
  //
  // O que acontecia ao clicar, quando só esta tela protegia:
  //   1. `POST /guides/:id/recalculate` passa na guarda e emite o **DAS DO MÊS** (PGDAS-D, chamada
  //      PAGA) passando o id da PARCELA como `existingGuideId`;
  //   2. `createOrUpdateGuideFromProcessing` faz UPDATE nessa linha — valor, vencimento, PDF,
  //      `sourceFileId`, `hash` e `extracted` viram os do DAS do mês. `parcelamentoId` não está no
  //      update e sobrevive, então a linha segue se chamando "PARCSN Nº X · 3/10" com o DAS dentro;
  //   3. `capturePgdasGuideForCompany` termina apagando as outras guias SIMPLES/SERPRO da
  //      competência — filtrando por `tipo`, sem `parcelamentoId`: o DAS de verdade do mês vai junto;
  //   4. a rota ainda chama o worker de e-mail e **manda o PDF trocado ao cliente**.
  // É a mesma classe de erro da ERISANGELA, agora destrutiva. Quem decide é o VÍNCULO, nunca o tipo.
  const selTipo = String(selectedGuide?.tipo || "").toUpperCase();
  const ehParcela = ehGuiaDeParcelamento(selectedGuide);
  const isInss = !ehParcela && selTipo === "INSS";
  const isDas = !ehParcela && selTipo === "SIMPLES";
  // ⚠⚠ A DARF DO PRESUMIDO (decisão do dono, 27/08/2026). A ESPÉCIE VEM DO BACKEND, nunca de um
  // `tipo === "OUTRA"` escrito aqui: a guia de INSS/DCTFWeb é `tipo: "OUTRA"` com `source: "SERPRO"`
  // também, e lê-la por tipo mandaria uma para o caminho da outra.
  const ehDarfLp = !ehParcela && selectedGuide?.especieRecalculo === "DARF_PRESUMIDO";
  // A parcela mantém o botão VISÍVEL e desabilitado, com o motivo no `title` — mesmo tratamento que
  // o INSS já pago recebe logo abaixo. Sumir seria pior: a parcela senta na mesma tabela que o DAS,
  // e sem explicação a saída natural é selecionar a linha de cima e recalcular aquela.
  const canShowRecalcular = isInss || isDas || ehParcela || ehDarfLp;
  const inssPaid = String(selectedGuide?.paymentStatus || "").toUpperCase() === "PAID";
  let recalcDisabled;
  if (ehParcela) recalcDisabled = true;
  else if (isDas || ehDarfLp) recalcDisabled = !selectedGuide?.canRecalculate || !!recalculatingGuideId;
  else recalcDisabled = inssPaid || !!recalcInssBusy;
  const recalcBusy = !ehParcela && ((isDas || ehDarfLp) ? (recalculatingGuideId === selectedGuideId) : !!recalcInssBusy);
  // O "porquê" viaja com o botão: desabilitado sem motivo à vista vira chamado de suporte.
  let recalcTitle;
  if (ehParcela) {
    recalcTitle = "Parcela de parcelamento não se recalcula aqui: Recalcular emite o DAS do MÊS "
      + "(PGDAS-D), que é outro documento. A parcela é emitida pelo parcelamento, na captura do SERPRO.";
  } else if (isInss) {
    recalcTitle = "Busca/recalcula no SERPRO a guia de INSS desta competência. Guia já paga é bloqueada.";
  } else if (ehDarfLp) {
    recalcTitle = "Pede à Receita a DARF do Lucro Presumido desta competência outra vez (GERARGUIA31).";
  } else {
    recalcTitle = "Recalcula a guia do DAS no PGDAS-D.";
  }
  // "Liberar ao cliente" substitui o Reenviar: se a guia já foi enviada, confirma reenvio no modal.
  const alreadySent = String(selectedGuide?.emailStatus || "").toUpperCase() === "SENT";

  // ⚠⚠ RECALCULAR GUIA VENCIDA GERA OUTRA GUIA, COM JUROS E MULTA — e até 27/08/2026 a tela não
  // sabia o que era "vencida" (medido: zero ocorrências de `isGuideOverdue` no front, e `OVERDUE` só
  // num mapa de rótulo). O contador clicava e descobria o valor novo depois.
  //
  // ⚠ O TEXTO VEM PRONTO DO BACKEND (`avisoDeRecalculo`), e o portal do cliente lê o MESMO. Escrito
  // aqui, os dois divergiriam na primeira correção — e este aviso precede um gasto e um valor maior.
  function handleRecalcularDispatch() {
    if (!selectedGuide) return;
    if (isInss) { onRecalcularInss?.(selectedGuide.competencia); return; }
    if (!isDas && !ehDarfLp) return;
    const aviso = selectedGuide?.avisoDeRecalculo;
    // ⚠ Sem aviso (contrato antigo, ou guia que a regra não reconhece) o comportamento é o de
    // ANTES: recalcula direto. Bloquear por ausência de um campo novo tiraria uma ação que funciona.
    if (!aviso) { onRecalculateGuide?.(selectedGuideId); return; }
    setRecalcConfirm({ guideId: selectedGuideId, aviso });
  }

  function confirmarRecalculo() {
    const alvo = recalcConfirm?.guideId;
    setRecalcConfirm(null);
    if (alvo) onRecalculateGuide?.(alvo);
  }

  function handleLiberarClick() {
    if (!selectedGuide) return;
    if (alreadySent) setResendConfirm(selectedGuide);           // já enviada → pergunta antes de reenviar
    else onLiberarGuia?.(selectedGuideId);                      // não enviada → libera + envia SÓ esta guia
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  function toggleOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Fluxo de upload: usuário escolhe tipo no dropdown → file picker → modal split com PDF lado-a-lado.
  //
  // ⚠ `PARCELAMENTO` NÃO É UM TIPO DE GUIA — é o tipo de OPERAÇÃO, e desvia para o modal em que o
  // contrato vem primeiro (`GuiaDeParcelamentoModal`). Lá o PDF é escolhido DEPOIS do parcelamento,
  // porque é o contrato que pré-preenche competência, vencimento e valor.
  function handleStartUpload(tipo) {
    setUploadMenuOpen(false);
    if (tipo === TIPO_UPLOAD_PARCELAMENTO) {
      setAnexoArquivo(null);
      setAnexoParcelamentoId("");
      setAnexoParcelamentoOpen(true);
      return;
    }
    setUploadTipo(tipo);
    // Dispara file picker no próximo tick (precisa do input já no DOM)
    requestAnimationFrame(() => fileInputRef.current?.click());
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      // Cancelou o picker — fecha o estado de upload
      setUploadTipo(null);
      return;
    }
    setUploadFile(file);
    // O modal split abre quando uploadFile + uploadTipo estão setados
  }

  async function handleCaptureSave(metadata) {
    if (!uploadFile || !onUploadGuide) return { ok: false };
    const result = await onUploadGuide(uploadFile, { ...metadata, tipo: uploadTipo || metadata.tipo });
    if (result?.ok || (result && !result.needsMetadata)) {
      setUploadFile(null);
      setUploadTipo(null);
      // ⚠ NÃO HÁ MAIS MODAL-SURPRESA PÓS-SALVAR. Subir uma guia normal salva a guia e acaba: o
      // "Registrar 1ª parcela do parcelamento" que abria sozinho aqui era o guia-first — ele fazia
      // um contrato de até 60 meses nascer como efeito colateral de um upload.
      return { ok: true };
    }
    return { ok: false, message: result?.message || result?.error || "Falha ao enviar guia." };
  }

  function handleCaptureCancel() {
    setUploadFile(null);
    setUploadTipo(null);
  }

  // ─── R4: anexar guia a um parcelamento ────────────────────────────────────────────────────────
  function handleAnexoFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) setAnexoArquivo(file);
  }

  async function handleAnexoSalvar({ metadata, header }) {
    if (!onUploadGuide || !parcelamentos) return { ok: false, message: "Upload indisponível." };
    setAnexoSaving(true);
    try {
      const result = await onUploadGuide(anexoArquivo, metadata);
      const guide = result?.guide || result;
      const guideId = guide?.guideId || guide?.id;
      if (!guideId) {
        return { ok: false, message: result?.message || result?.error || "A guia não foi criada — nada foi vinculado." };
      }
      // Vincula a guia à prestação do contrato. `POST /parcelamentos/ingestao` com o parcelamento
      // já existente NÃO recria a provisão (`aberturaEntryId` já está setado) — ele só casa a guia
      // com a parcela e grava a composição.
      //
      // ⚠ E SÓ ISSO. O caminho antigo chamava `onConfirmGuidePayment(gid)` logo aqui, dentro de um
      // `try { } catch {}` mudo: anexar o documento CONFIRMAVA o pagamento dele, e quando essa
      // confirmação falhava (mês fechado, por exemplo) ninguém ficava sabendo.
      await parcelamentos.ingest({ guideId, header });
      setAnexoParcelamentoOpen(false);
      setAnexoArquivo(null);
      setAnexoParcelamentoId("");
      if (onRefresh) await onRefresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err?.message || "Falha ao anexar a guia ao parcelamento." };
    } finally {
      setAnexoSaving(false);
    }
  }

  // Fluxo de completar guia já existente (modal split com fetch do PDF)
  async function handleCompleteSave(metadata) {
    if (!completingGuide || !onIdentifyGuide) return { ok: false };
    const gid = completingGuide.guideId || completingGuide.id;
    setCompletingSaving(true);
    try {
      const result = await onIdentifyGuide(gid, metadata);
      if (result?.ok !== false) {
        // ⚠ A HEURÍSTICA DE FALLBACK POR TIPO SAIU (R1). Ela abria o modal de vínculo de
        // parcelamento em TODA guia `SIMPLES|INSS|DARF|PIS|COFINS|IRPJ|CSLL|ISS` — ou seja, em
        // praticamente toda guia do sistema — mesmo sem ninguém ter dito que aquilo era parcela.
        // Completar uma guia agora completa a guia e acaba; anexar guia a parcelamento é um caminho
        // próprio e explícito ("+ Subir Guia → PARCELAMENTO").
        setCompletingGuide(null);
        return { ok: true };
      }
      return { ok: false, message: result?.message || result?.error || "Falha ao identificar guia." };
    } finally {
      setCompletingSaving(false);
    }
  }

  // Fecha o menu de upload ao clicar fora
  useEffect(() => {
    if (!uploadMenuOpen) return undefined;
    function onDocClick(e) {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target)) {
        setUploadMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [uploadMenuOpen]);

  async function handleDelete() {
    if (!onDeleteGuide || selectedCount === 0) return;
    const ids = filteredIds.filter((id) => selectedIds.has(id));
    const label = ids.length === 1 ? "esta guia" : `estas ${ids.length} guias`;
    if (!window.confirm(`Tem certeza que deseja excluir ${label}? Esta ação não pode ser desfeita.`)) return;
    setDeleting(true);
    for (const id of ids) {
      try { await onDeleteGuide(id); } catch { /* surfaced by handler */ }
    }
    setDeleting(false);
    clearSelection();
  }

  const actionsBusy = deleting || !!confirmingGuideId || !!recalculatingGuideId;

  return (
    <section className="guides-page">
      {/* Modal split de upload: PDF lado-a-lado do form. Abre quando tipo + arquivo estão prontos. */}
      {uploadTipo && uploadFile && (
        <GuideCaptureModal
          mode="upload"
          initialTipo={uploadTipo}
          pdfFile={uploadFile}
          onSave={handleCaptureSave}
          onClose={handleCaptureCancel}
          saving={uploadingGuide}
        />
      )}

      {/* Modal split de completar: para guias já no banco que estão pendentes/erro */}
      {completingGuide && (
        <GuideCaptureModal
          mode="complete"
          initialMetadata={completingGuide}
          loadPdfBlob={onFetchGuidePdf ? () => onFetchGuidePdf(completingGuide.guideId || completingGuide.id) : null}
          onSave={handleCompleteSave}
          onClose={() => setCompletingGuide(null)}
          saving={completingSaving}
        />
      )}

      {/* ⚠⚠ CONFIRMAÇÃO ANTES DE RECALCULAR — e ela REPETE A EVIDÊNCIA, não pergunta "tem certeza?".
          Uma pergunta genérica se aprende a clicar sem ler, e o clique na linha errada recebe a
          mesma pergunta que o clique na certa. Aqui a caixa diz o que vai acontecer com ESTA guia:
          se ela venceu, quando venceu (e se a data é ESTIMADA), que a Receita gera uma guia NOVA
          com juros e multa, e que o pedido custa uma chamada paga. */}
      {recalcConfirm && (
        <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && setRecalcConfirm(null)}>
          <div style={S.modal}>
            <h3 style={S.title}>{recalcConfirm.aviso.titulo}</h3>
            <Aviso
              tom={recalcConfirm.aviso.tom === "atencao" ? "atencao" : "neutro"}
              titulo={recalcConfirm.aviso.vencida ? "O que vai acontecer" : "Sobre este pedido"}
              compacto
              style={{ margin: "0 0 16px" }}
            >
              {recalcConfirm.aviso.texto}
            </Aviso>
            <div style={S.btnRow}>
              <Button variant="primary" size="sm" disabled={!!recalculatingGuideId} onClick={confirmarRecalculo}>
                {recalculatingGuideId ? "Recalculando..." : "Recalcular mesmo assim"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setRecalcConfirm(null)}>Cancelar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de reenvio: "Liberar ao cliente" numa guia que já foi enviada. */}
      {resendConfirm && (
        <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && setResendConfirm(null)}>
          <div style={S.modal}>
            <h3 style={S.title}>Guia já enviada</h3>
            <p style={{ fontSize: 13, color: "var(--text-faint)", margin: "0 0 16px" }}>
              Esta guia ({rotuloTipoGuia(resendConfirm)} · {resendConfirm.competencia}) já foi enviada ao cliente por
              e-mail. Deseja reenviar?
            </p>
            <div style={S.btnRow}>
              <Button
                variant="primary" size="sm"
                disabled={!!resendingGuideId}
                onClick={async () => {
                  const gid = resendConfirm.guideId || resendConfirm.id;
                  await onResendGuide?.(gid);
                  setResendConfirm(null);
                }}
              >
                {resendingGuideId ? "Reenviando..." : "Reenviar"}
              </Button>
              <Button
                variant="secondary" size="sm"
                disabled={!!resendingGuideId}
                onClick={() => setResendConfirm(null)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Action toolbar — always visible above the table */}
      <div className="guides-toolbar">
        <div className="guides-toolbar__actions">
          {onUploadGuide && (
            <>
              <input ref={fileInputRef} type="file" accept="application/pdf"
                style={{ display: "none" }} onChange={handleFileChange} />
              <div ref={uploadMenuRef} style={{ position: "relative" }}>
                <Button
                  variant="primary" size="sm" type="button"
                  disabled={uploadingGuide}
                  onClick={() => setUploadMenuOpen((o) => !o)}
                >
                  {uploadingGuide ? "Enviando..." : "+ Subir Guia ▾"}
                </Button>
                {uploadMenuOpen && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
                    background: "#24253A", border: "1px solid #44475A", borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: 180, overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "8px 12px", fontSize: "0.7rem", color: "var(--text-faint)",
                      textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700,
                      borderBottom: "1px solid #44475A",
                    }}>
                      Tipo de guia
                    </div>
                    {/* ⚠ PARCELAMENTO é o ÚLTIMO da lista e um item NORMAL — sem cor própria, sem
                        separador âmbar. O item antigo ("Parcelamento…", âmbar, fora da lista de
                        tipos) sinalizava um caminho especial que criava contrato a partir de guia. */}
                    {availableUploadTypes.map((tipo) => (
                      <button
                        key={tipo}
                        type="button"
                        onClick={() => handleStartUpload(tipo)}
                        disabled={tipo === TIPO_UPLOAD_PARCELAMENTO && !parcelamentos}
                        title={tipo === TIPO_UPLOAD_PARCELAMENTO
                          ? (parcelamentos
                            ? "Anexa a guia a uma prestação de um parcelamento que já existe."
                            : "Indisponível: os parcelamentos desta empresa não foram carregados.")
                          : undefined}
                        style={{
                          display: "block", width: "100%", textAlign: "left",
                          padding: "8px 12px", background: "transparent", border: "none",
                          borderTop: tipo === TIPO_UPLOAD_PARCELAMENTO ? "1px solid #44475A" : "none",
                          color: tipo === TIPO_UPLOAD_PARCELAMENTO && !parcelamentos ? "var(--text-faint)" : "var(--text)",
                          fontSize: "0.875rem",
                          cursor: tipo === TIPO_UPLOAD_PARCELAMENTO && !parcelamentos ? "not-allowed" : "pointer",
                          fontWeight: 500,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        {tipo}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {/* Marcar guias obrigatórias como VAZIO no mês (aparecem na tabela abaixo como vazio). */}
          <MarcarVazioDropdown
            companyId={companyId}
            competencia={filterCompetencia}
            refreshKey={vazioRefreshKey}
            onChanged={refreshAfterVazio}
          />
          {/* Barra única de ações da guia selecionada (uma guia por vez). */}
          {selectedCount === 1 && selectedGuide && (
            <>
              {/* Recalcular: um botão só — INSS (SERPRO DCTFweb) ou DAS (PGDAS-D), conforme o tipo. */}
              {canShowRecalcular && (
                <Button
                  variant="secondary" size="sm"
                  disabled={recalcDisabled}
                  onClick={handleRecalcularDispatch}
                  title={recalcTitle}
                >
                  {recalcBusy ? "Recalculando..." : "Recalcular"}
                </Button>
              )}
              {/* ⚠ Confirmar pagamento e Liberar ao cliente (abaixo) NÃO têm o problema do
                  Recalcular, e a diferença é a mesma nos dois: eles agem sobre ESTA guia, sem
                  reemitir nada. `POST /guides/:id/confirm-payment` só marca `paymentStatus=PAID`
                  (o lançamento da parcela vive na aba Parcelamento) e `.../liberar-cliente` envia
                  o PDF desta linha — que numa parcela é o DAS da parcela. Pagar e liberar uma
                  parcela são atos reais; recalcular é que não existe para ela. */}
              <Button
                variant="secondary" size="sm"
                disabled={!selectedGuide?.canConfirmPayment || !!confirmingGuideId}
                onClick={() => selectedGuideId && onConfirmGuidePayment(selectedGuideId)}
              >
                {confirmingGuideId === selectedGuideId ? "..." : "Confirmar pagamento"}
              </Button>
              {/* Baixar o PDF da guia (se houver). */}
              {onFetchGuidePdf && selectedGuide.status === "PROCESSED" && (
                <Button
                  variant="secondary" size="sm"
                  onClick={async () => {
                    try {
                      const blob = await onFetchGuidePdf(selectedGuideId);
                      if (!blob) { window.alert("Esta guia não tem PDF para baixar."); return; }
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `guia-${selectedGuide.tipo || "guia"}-${selectedGuide.competencia || ""}.pdf`;
                      document.body.appendChild(a); a.click(); a.remove();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } catch (err) {
                      window.alert(err?.message || "Falha ao baixar a guia.");
                    }
                  }}
                >
                  ⬇ Baixar
                </Button>
              )}
              {/* Liberar ao cliente = envio por e-mail SÓ desta guia (substitui o Reenviar).
                  Se já enviada, confirma reenvio no modal. */}
              {onLiberarGuia && (
                <Button
                  variant="secondary" size="sm"
                  disabled={selectedGuide?.status !== "PROCESSED" || !!liberarGuiasBusy}
                  onClick={handleLiberarClick}
                  title="Libera esta guia ao cliente e envia só ela por e-mail."
                >
                  {liberarGuiasBusy ? "Liberando..." : "Liberar ao cliente"}
                </Button>
              )}
              {/* Completar: aparece quando a guia selecionada está em ERROR ou faltando tipo/competência.
                  Abre o modal split com o PDF lado-a-lado pra editar metadados. */}
              {onIdentifyGuide && (selectedGuide.status === "ERROR" || !selectedGuide.tipo || !selectedGuide.competencia) && (
                <Button
                  variant="secondary" size="sm"
                  onClick={() => setCompletingGuide(selectedGuide)}
                >
                  ✎ Completar
                </Button>
              )}
              {onDeleteGuide && (
                <Button
                  variant="danger" size="sm"
                  disabled={actionsBusy}
                  onClick={handleDelete}
                >
                  {deleting ? "Excluindo..." : "Excluir"}
                </Button>
              )}
            </>
          )}
        </div>

        {selectedCount > 0 && (
          <div className="guides-toolbar__selection">
            <span className="guides-toolbar__count">
              {selectedCount} selecionada{selectedCount !== 1 ? "s" : ""}
            </span>
            <button className="guides-toolbar__clear" onClick={clearSelection} type="button">
              Limpar
            </button>
          </div>
        )}
      </div>

      <div className="guides-list-panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
          <h2 className="guides-list-panel__title" style={{ margin: 0 }}>Guias</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label
              style={{ fontSize: "0.8rem", color: "#aeb6d3", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}
              title="Mostra as guias de todas as competências, ignorando o mês do topo da página."
            >
              <input
                type="checkbox"
                checked={verTodasCompetencias}
                onChange={() => setVerTodasCompetencias((v) => !v)}
                style={{ cursor: "pointer" }}
              />
              Ver todas as competências
            </label>
            {/* Filtro ativo NUNCA fica sem rastro visível — mesma regra que a listagem já aplica.
                Sem esta linha, a tabela mostrando doze meses seria indistinguível de um mês
                cheio, e é assim que se confere uma guia achando que é de outro período. */}
            {!verTodasCompetencias && (
              <span style={{ fontSize: "0.8rem", color: "#aeb6d3" }}>
                Competência: <strong style={{ color: "var(--text)" }}>{filterCompetencia}</strong>
              </span>
            )}
          </div>
        </div>

        {loadingGuides ? (
          <p className="text-muted">Carregando...</p>
        ) : filteredGuides.length === 0 ? (
          // ⚠ ERA UMA FRASE SÓ — "Nenhuma guia encontrada para os filtros atuais." — para situações
          // que exigem ações OPOSTAS, e uma delas era o servidor não ter respondido. Ver a regra e
          // o porquê em `../lib/estadoVazioGuias.js`.
          contextoVazio.carregando ? (
            <p className="text-muted">Nenhuma guia em {filterCompetencia}. Verificando o estado da competência…</p>
          ) : (
            <Aviso
              tom={leituraDoVazio.chave === "FALHA" ? "erro" : "neutro"}
              titulo={leituraDoVazio.titulo}
              style={{ maxWidth: 640 }}
            >
              <div>{leituraDoVazio.explicacao}</div>
              {leituraDoVazio.acao && (
                <div style={{ marginTop: "var(--space-3)" }}>
                  {leituraDoVazio.acao.destino === "apuracao" && onIrParaApuracao && (
                    <Button size="sm" variant="secondary" onClick={onIrParaApuracao}>
                      {leituraDoVazio.acao.rotulo}
                    </Button>
                  )}
                  {leituraDoVazio.acao.destino === "upload" && (
                    <Button size="sm" variant="secondary" onClick={() => setUploadMenuOpen(true)}>
                      {leituraDoVazio.acao.rotulo}
                    </Button>
                  )}
                </div>
              )}
            </Aviso>
          )
        ) : (
          <div className="guides-grid" role="table" aria-label="Lista de guias">
            <div className="guides-grid__head" role="rowgroup">
              <div className="guides-grid__row guides-grid__row--head" role="row">
                <span className="guides-grid__cell guides-grid__cell--check" role="columnheader">
                  <input
                    type="checkbox"
                    style={S.checkbox}
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    aria-label="Selecionar todas"
                  />
                </span>
                <span className="guides-grid__cell guides-grid__cell--type" role="columnheader">Tipo</span>
                <span className="guides-grid__cell guides-grid__cell--competencia" role="columnheader">Competência</span>
                <span className="guides-grid__cell guides-grid__cell--valor" role="columnheader">Valor</span>
                <span className="guides-grid__cell guides-grid__cell--competencia" role="columnheader">Vencimento</span>
                <span className="guides-grid__cell guides-grid__cell--status" role="columnheader">Status</span>
                <span className="guides-grid__cell guides-grid__cell--status" role="columnheader">Situação</span>
                <span className="guides-grid__cell guides-grid__cell--email" role="columnheader">E-mail</span>
                <span className="guides-grid__cell guides-grid__cell--linha" role="columnheader">Linha digitável</span>
              </div>
            </div>

            <div className="guides-grid__body" role="rowgroup">
              {filteredGuides.map((guide) => {
                const guideId = guide.guideId || guide.id;
                const isSelected = selectedIds.has(guideId);
                const status = formatGuideStatus(guide.status);
                const paymentStatus = formatPaymentStatus(guide.paymentStatus);
                const emailStatus = formatEmailStatus(guide.emailStatus);

                return (
                  <div
                    key={guideId}
                    className={`guides-grid__row${isSelected ? " guides-grid__row--selected" : ""}`}
                    role="row"
                    onClick={() => toggleOne(guideId)}
                    style={{ cursor: "pointer" }}
                  >
                    <span className="guides-grid__cell guides-grid__cell--check" role="cell"
                      onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        style={S.checkbox}
                        checked={isSelected}
                        onChange={() => toggleOne(guideId)}
                        aria-label={`Selecionar guia ${rotuloTipoGuia(guide)} ${guide.competencia}`}
                      />
                    </span>
                    <span className="guides-grid__cell guides-grid__cell--type" role="cell" title={tituloTipoGuia(guide)}>
                      {rotuloTipoGuia(guide)}
                    </span>
                    <span className="guides-grid__cell guides-grid__cell--competencia" role="cell">{guide.competencia || "-"}</span>
                    <span className="guides-grid__cell guides-grid__cell--valor guides-grid__money" role="cell">
                      {fmtMoney(guide.valor)}
                      {guide.valorRecalculado != null && (
                        <span
                          style={{ marginLeft: 6, fontSize: "0.7rem", color: "#92400e", fontWeight: 700 }}
                          title={`Guia recalculada pelo SERPRO. Valor do extrato (apuração): R$ ${fmtMoney(guide.valor)}. Valor atual da guia: R$ ${fmtMoney(guide.valorRecalculado)}.`}
                        >
                          ↻ R$ {fmtMoney(guide.valorRecalculado)}
                        </span>
                      )}
                    </span>
                    <span className="guides-grid__cell guides-grid__cell--competencia" role="cell">{fmtDataCivil(guide.vencimento)}</span>
                    <span className={`guides-grid__cell guides-grid__cell--status guides-grid__tone guides-grid__tone--${status.tone}`} role="cell">
                      {status.label}
                    </span>
                    <span className={`guides-grid__cell guides-grid__cell--status guides-grid__tone guides-grid__tone--${paymentStatus.tone}`} role="cell"
                      onClick={(e) => e.stopPropagation()}>
                      {guide.status === "VAZIO" ? (
                        <button
                          type="button"
                          onClick={() => handleUndoVazio(guide)}
                          title="Desfazer marcação de vazio"
                          style={{ fontSize: "0.7rem", padding: "3px 8px", cursor: "pointer", background: "transparent", color: "#aeb6d3", border: "1px solid #44475A", borderRadius: 4 }}
                        >
                          desfazer vazio
                        </button>
                      ) : paymentStatus.label}
                    </span>
                    <span
                      className={`guides-grid__cell guides-grid__cell--email guides-grid__tone guides-grid__tone--${emailStatus.tone}`}
                      role="cell"
                      onClick={guide.emailLastError ? () => {
                        // eslint-disable-next-line no-alert
                        window.prompt("Erro no envio do e-mail (Ctrl+C para copiar):", guide.emailLastError);
                      } : undefined}
                      style={guide.emailLastError ? { cursor: "pointer", textDecoration: "underline" } : undefined}
                    >
                      {emailStatus.label}
                      {guide.emailLastError ? " ⓘ" : ""}
                      {/* Portal Cliente (#3.1): selo de guia liberada ao app do cliente. */}
                      {guide.liberadaCliente && (
                        <span
                          title={`Liberada ao cliente${guide.liberadaEm ? ` em ${fmtDate(guide.liberadaEm)}` : ""}`}
                          style={{ marginLeft: 6, color: "var(--success)", fontWeight: 700 }}
                        >
                          📤
                        </span>
                      )}
                    </span>
                    <CelulaLinhaDigitavel guide={guide} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* R4 — "+ Subir Guia → PARCELAMENTO": o contrato primeiro, a guia como anexo dele. */}
      {anexoParcelamentoOpen && parcelamentos && (
        <>
          <input
            ref={anexoFileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={handleAnexoFileChange}
          />
          <GuiaDeParcelamentoModal
            parcelamentosAtivos={parcelamentos.parcelamentos || []}
            guias={guides}
            arquivo={anexoArquivo}
            onEscolherArquivo={() => anexoFileInputRef.current?.click()}
            /* "＋ Criar novo…" leva ao wizard, que vive na aba Parcelamentos — a mesma porta de
               criação, sem uma segunda cópia do formulário aqui. */
            onCriarNovoParcelamento={onCriarParcelamento ? () => { setAnexoParcelamentoOpen(false); onCriarParcelamento(); } : null}
            parcelamentoIdInicial={anexoParcelamentoId}
            saving={anexoSaving || uploadingGuide}
            onSalvar={handleAnexoSalvar}
            onClose={() => { setAnexoParcelamentoOpen(false); setAnexoArquivo(null); }}
          />
        </>
      )}
    </section>
  );
}
