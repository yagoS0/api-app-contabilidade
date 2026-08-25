import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { Button } from "../../../../components/ui/Button";
import { Feedback } from "../../../../components/ui/Feedback";

const PANEL = {
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#6272A4",
  accent: "#BD93F9",
  success: "var(--success)",
  warning: "#FFB347",
  danger: "#FF5757",
};

// Competência inicial = mês anterior (mesmo padrão das outras telas)
function getPreviousMonthCompetencia() {
  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
}

const COLUMNS_SIMPLES = [
  { key: "DAS",      label: "DAS" },
  { key: "INSS",     label: "INSS" },
  // ⚠ A coluna PARC carrega DOIS conteúdos e só um deles é enviável:
  //   • guia da parcela (SERPRO/V2) — tem PDF, tem e-mail, PRECISA entrar no envio;
  //   • linha leve de rastreio do V1 (`isParcelamento`) — sem documento, só informa.
  // Enquanto o "info-only" era da COLUNA, o segundo caso apagava o primeiro: empresa cuja única
  // pendência do mês era a parcela sumia do filtro "só pendentes" e ninguém conseguia selecioná-la.
  // Por isso a distinção passou para o VALOR da célula.
  { key: "PARC_DAS", label: "PARC" },
];

const COLUMNS_PRESUMIDO = [
  { key: "IRPJ",       label: "IRPJ" },
  { key: "CSLL",       label: "CSLL" },
  { key: "PIS_COFINS", label: "PIS/COFINS" },
  { key: "ISS",        label: "ISS" },
  { key: "INSS",       label: "INSS" },
];

const cellBaseStyle = {
  padding: "10px 8px", textAlign: "center", fontSize: "0.8rem",
  borderBottom: `1px solid ${PANEL.border}`, whiteSpace: "nowrap",
};

function GuideStatusCell({ value }) {
  // Q16/Q17: 5 estados — ✗ ausente / "vazio" (amarelo) / "contendo guia" / "enviado" / "falhou".
  if (!value) {
    return <td style={{ ...cellBaseStyle, color: PANEL.danger }} title="Sem guia">✗</td>;
  }
  // Rastreio do parcelamento sem guia capturada: informa, não anexa.
  if (value.isParcelamento) {
    return <td style={{ ...cellBaseStyle, color: PANEL.warning }} title="Parcelamento ativo (sem PDF para anexar)">●</td>;
  }
  // Q17: marcador VAZIO = ausência confirmada pelo contador (não é guia enviável).
  if (value.vazio) {
    return (
      <td style={{ ...cellBaseStyle, color: PANEL.warning }} title="Marcada como vazio (sem guia no mês). Desfaça na aba Guias da empresa para subir a guia real.">
        ⊘ vazio
      </td>
    );
  }
  const valorTitle = value.valor != null ? `R$ ${Number(value.valor).toFixed(2)}` : "";
  if (value.emailStatus === "SENT") {
    const quando = value.emailSentAt ? new Date(value.emailSentAt).toLocaleDateString("pt-BR") : "";
    return (
      <td style={{ ...cellBaseStyle, color: PANEL.success, fontWeight: 600 }} title={`Enviado${quando ? ` em ${quando}` : ""}. ${valorTitle}`}>
        ✓ enviado
      </td>
    );
  }
  // ⚠ A TENTATIVA QUE FALHOU NÃO PODE PARECER A QUE NUNCA FOI FEITA.
  //
  // Esta célula pintava PENDING, ERROR e null tudo como "📄 guia". O `emailStatus` já vinha no
  // payload e era jogado fora aqui — então a única tela onde o contador decide o que enviar
  // mostrava a guia que falhou exatamente como a que está esperando a vez. Como nada drena
  // `emailNextRetryAt` (o laço saiu na Q55), essa guia ficava em ERROR até alguém clicar por acaso.
  //
  // Continua SELECIONÁVEL: o envio manual alcança `ERROR` (`whereGuiaPendenteDeEnvio()` sem janela
  // de retry), então marcar a linha e clicar "Enviar e-mails" tenta de novo agora. A mudança é de
  // exibição, não de elegibilidade.
  if (value.falhou || value.emailStatus === "ERROR") {
    const tentativas = Number(value.emailAttempts || 0);
    return (
      <td
        style={{ ...cellBaseStyle, color: PANEL.danger, fontWeight: 600 }}
        title={
          `O ENVIO FALHOU${tentativas > 1 ? ` (${tentativas} tentativas)` : ""} e nada tentará de novo sozinho.`
          + `${value.emailLastError ? ` Motivo: ${value.emailLastError}.` : ""}`
          + ` Selecione a linha e clique em "Enviar e-mails" para tentar agora. ${valorTitle}`
        }
      >
        ✖ falhou
      </td>
    );
  }
  // contendo guia (PENDING/null) — capturada, ainda não tentada
  return (
    <td style={{ ...cellBaseStyle, color: PANEL.accent }} title={`Contendo guia (não enviada). ${valorTitle}`}>
      📄 guia
    </td>
  );
}

// Q10.4: chave composta `${portalClientId}::${competencia}` — cada linha representa
// 1 envio (empresa + competência). Mesma empresa pode aparecer em meses diferentes.
const rowKey = (row) => `${row.portalClientId}::${row.competencia}`;

function CompanySection({ title, rows, columns, selectedKeys, onToggle, onToggleAll, onlyPending, showCompetencia }) {
  // Q16: só é "enviável" se tem guia NÃO enviada (SENT = display-only, não re-seleciona).
  const rowHasSendable = (row) => columns.some((c) => {
    const cell = row.tiposGuias?.[c.key];
    // VAZIO não é enviável (sem PDF); rastreio de parcelamento idem; SENT é display-only.
    return cell && !cell.vazio && !cell.isParcelamento && cell.emailStatus !== "SENT";
  });
  const visibleRows = onlyPending ? rows.filter(rowHasSendable) : rows;

  const sendableKeys = visibleRows.filter(rowHasSendable).map(rowKey);
  const allSelected = sendableKeys.length > 0 && sendableKeys.every((k) => selectedKeys.has(k));
  const someSelected = sendableKeys.some((k) => selectedKeys.has(k));

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: "0.95rem", margin: "0 0 8px", color: PANEL.text }}>
        {title} <span style={{ color: PANEL.muted, fontSize: "0.8rem", fontWeight: 400 }}>({visibleRows.length})</span>
      </h3>
      {visibleRows.length === 0 ? (
        <p style={{ color: PANEL.muted, fontSize: "0.85rem", margin: 0 }}>
          {onlyPending ? "Nenhuma empresa com guias pendentes nessa categoria." : "Nenhuma empresa cadastrada."}
        </p>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: PANEL.field }}>
                <th style={{ ...cellBaseStyle, width: 40, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={() => onToggleAll(sendableKeys, !allSelected)}
                    style={{ width: 16, height: 16, cursor: "pointer", accentColor: PANEL.accent }}
                    title="Selecionar todas com pendência"
                  />
                </th>
                <th style={{ ...cellBaseStyle, textAlign: "left", color: "#aeb6d3", textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.04em" }}>
                  Empresa
                </th>
                {showCompetencia && (
                  <th style={{ ...cellBaseStyle, color: "#aeb6d3", textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.04em" }}>
                    Competência
                  </th>
                )}
                {columns.map((col) => (
                  <th key={col.key} style={{ ...cellBaseStyle, color: "#aeb6d3", textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.04em" }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const hasSendable = rowHasSendable(row);
                const k = rowKey(row);
                const isSelected = selectedKeys.has(k);
                return (
                  <tr
                    key={k}
                    onClick={() => hasSendable && onToggle(k)}
                    style={{
                      cursor: hasSendable ? "pointer" : "default",
                      background: isSelected ? "rgba(189,147,249,0.08)" : "transparent",
                      opacity: hasSendable ? 1 : 0.5,
                    }}
                  >
                    <td style={{ ...cellBaseStyle, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!hasSendable}
                        onChange={() => onToggle(k)}
                        style={{ width: 16, height: 16, cursor: hasSendable ? "pointer" : "not-allowed", accentColor: PANEL.accent }}
                      />
                    </td>
                    <td style={{ ...cellBaseStyle, textAlign: "left", color: PANEL.text }}>
                      <div style={{ fontWeight: 600 }}>{row.razao || "—"}</div>
                      <div style={{ fontSize: "0.7rem", color: PANEL.muted }}>{row.cnpj || ""}</div>
                    </td>
                    {showCompetencia && (
                      <td style={{ ...cellBaseStyle, color: PANEL.text, fontWeight: 600 }}>{row.competencia || "—"}</td>
                    )}
                    {columns.map((col) => (
                      <GuideStatusCell key={col.key} value={row.tiposGuias?.[col.key]} />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Página "Envio de e-mails em lote".
 *
 * Mostra todas as empresas em 2 seções (Simples + Presumido), com colunas por tipo de guia.
 * - Azul 📄 guia = guia capturada, ainda não tentada
 * - Vermelho ✖ falhou = tentou enviar e NÃO saiu (motivo no `title`); segue selecionável
 * - Verde ✓ enviado = guia já enviada por e-mail (display-only)
 * - Vermelho ✗ = guia ainda não capturada
 * - Amarelo ⊘ vazio = marcada como "sem guia no mês" (ausência confirmada, não enviável)
 * - Laranja ● = parcelamento ativo (info-only, sem anexo de PDF)
 *
 * O contador seleciona empresas e clica "Enviar e-mails (N)" — backend envia 1 e-mail
 * por empresa com TODAS as guias da competência anexadas. Após envio, linhas saem da matriz
 * (porque emailStatus passa a SENT, não aparecem mais).
 */
export function BatchEmailPage({
  report,
  loading,
  sending,
  onBack,
  onLoad,
  onSend,
  message,
  error,
}) {
  // Q10.4: competência opcional ("" = todas). Q19: default = mês anterior (mesmo
  // padrão do dashboard/guias/notas); usuário pode trocar para "Todas" no seletor.
  const [competencia, setCompetencia] = useState(getPreviousMonthCompetencia());
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [onlyPending, setOnlyPending] = useState(true);

  // Carrega ao montar e quando muda competência
  useEffect(() => {
    onLoad?.(competencia || null);
    setSelectedKeys(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competencia]);

  function toggleOne(key) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllInSection(keys, addAll) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (addAll) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  const totalSelected = selectedKeys.size;
  const canSend = totalSelected > 0 && !sending;

  async function handleSend() {
    if (!canSend) return;
    // Q10.4: cada selectedKey é "portalClientId::competencia" — parseia pra enviar.
    const items = [...selectedKeys].map((key) => {
      const [portalClientId, comp] = String(key).split("::");
      return { portalClientId, competencia: comp };
    });
    await onSend?.(items);
    setSelectedKeys(new Set());
  }

  const simples = report?.simples || [];
  const presumidos = report?.presumidos || [];
  const competenciasPresentes = report?.competenciasPresentes || [];

  /**
   * Quem FALHOU, contado uma vez por linha (empresa × competência).
   *
   * ⚠ O aviso não pode depender de varrer a matriz com os olhos. Numa carteira de 30+ empresas,
   * uma célula vermelha no meio de oito colunas passa batido — e ela é justamente o caso em que
   * ninguém mais vai olhar, porque nada tenta de novo sozinho. Por isso o número sobe para o topo,
   * junto do botão que seleciona exatamente essas linhas.
   */
  const linhasComFalha = useMemo(() => {
    const chaves = [];
    for (const row of [...simples, ...presumidos, ...(report?.outros || [])]) {
      const celulas = Object.values(row?.tiposGuias || {});
      const falhou = celulas.some((c) => c && (c.falhou || c.emailStatus === "ERROR"));
      if (falhou) chaves.push(rowKey(row));
    }
    return chaves;
  }, [simples, presumidos, report]);
  // Mostra coluna de competência quando exibindo várias (filtro "Todas")
  const showCompetencia = !competencia;

  return (
    <PageShell
      title="Envio de e-mails em lote"
      subtitle="Selecione empresas e dispare o envio das guias capturadas (1 e-mail por empresa com PDFs anexados)."
      onBack={onBack}
      actions={
        <>
          <Button variant="secondary" onClick={() => onLoad?.(competencia)} disabled={loading}>
            {loading ? "Carregando..." : "Atualizar"}
          </Button>
          <Button variant="primary" onClick={handleSend} disabled={!canSend}>
            {sending ? "Enviando..." : `Enviar e-mails (${totalSelected})`}
          </Button>
        </>
      }
    >
      <AppShell>
        <div style={{
          display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
          marginBottom: 18, padding: "12px 14px",
          background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8,
        }}>
          <label style={{ fontSize: "0.85rem", color: PANEL.muted, display: "flex", alignItems: "center", gap: 8 }}>
            Competência:
            <select
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              style={{
                background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6,
                color: PANEL.text, padding: "6px 10px", fontSize: "0.9rem", colorScheme: "dark",
                minWidth: 200,
              }}
            >
              <option value="">Todas pendentes</option>
              {competenciasPresentes.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "0.85rem", color: PANEL.muted, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={onlyPending}
              onChange={(e) => setOnlyPending(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: PANEL.accent, cursor: "pointer" }}
            />
            Só empresas com pendências
          </label>
          {totalSelected > 0 && (
            <div style={{ marginLeft: "auto", fontSize: "0.85rem", color: PANEL.accent, fontWeight: 600 }}>
              {totalSelected} empresa{totalSelected === 1 ? "" : "s"} selecionada{totalSelected === 1 ? "" : "s"}
            </div>
          )}
        </div>

        {/* ⚠ AUSÊNCIA NÃO É RESPOSTA: sem esta faixa, "nenhum aviso" é o que a tela mostra tanto
            quando está tudo certo quanto quando três clientes não receberam a guia. Ela só aparece
            havendo falha — aviso permanente vira paisagem. */}
        {!loading && linhasComFalha.length > 0 && (
          <div style={{
            display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
            marginBottom: 18, padding: "10px 14px", borderRadius: 8,
            background: "rgba(255,87,87,0.10)", border: `1px solid ${PANEL.danger}`,
            color: PANEL.text, fontSize: "0.85rem",
          }}>
            <strong style={{ color: PANEL.danger }}>✖</strong>
            <span>
              <strong>{linhasComFalha.length}</strong> envio{linhasComFalha.length === 1 ? "" : "s"} falhou
              {linhasComFalha.length === 1 ? "" : "ram"} e <strong>não há retentativa automática</strong> —
              essas guias não chegaram ao cliente. Passe o mouse na célula <strong>✖ falhou</strong> para o motivo.
            </span>
            <Button
              variant="secondary"
              onClick={() => toggleAllInSection(linhasComFalha, true)}
              style={{ marginLeft: "auto" }}
            >
              Selecionar as {linhasComFalha.length} com falha
            </Button>
          </div>
        )}

        {loading ? (
          <p style={{ color: PANEL.muted }}>Carregando…</p>
        ) : (
          <>
            <CompanySection
              title="Empresas — Simples Nacional"
              rows={simples}
              columns={COLUMNS_SIMPLES}
              selectedKeys={selectedKeys}
              onToggle={toggleOne}
              onToggleAll={toggleAllInSection}
              onlyPending={onlyPending}
              showCompetencia={showCompetencia}
            />
            <CompanySection
              title="Empresas — Lucro Presumido / Lucro Real"
              rows={presumidos}
              columns={COLUMNS_PRESUMIDO}
              selectedKeys={selectedKeys}
              onToggle={toggleOne}
              onToggleAll={toggleAllInSection}
              onlyPending={onlyPending}
              showCompetencia={showCompetencia}
            />
            {/* Legenda */}
            <div style={{
              marginTop: 8, padding: "10px 12px", background: PANEL.field, border: `1px solid ${PANEL.border}`,
              borderRadius: 8, fontSize: "0.75rem", color: PANEL.muted, display: "flex", gap: 24, flexWrap: "wrap",
            }}>
              <span><strong style={{ color: PANEL.accent }}>📄 guia</strong> Contendo guia — não enviada (será anexada)</span>
              <span><strong style={{ color: PANEL.danger }}>✖ falhou</strong> Tentou e não saiu — passe o mouse para o motivo</span>
              <span><strong style={{ color: PANEL.success }}>✓ enviado</strong> E-mail já enviado</span>
              <span><strong style={{ color: PANEL.danger }}>✗</strong> Sem guia</span>
              <span><strong style={{ color: PANEL.warning }}>●</strong> Parcelamento ativo (info, sem anexo de PDF)</span>
            </div>
          </>
        )}

        <Feedback message={message} error={error} />
      </AppShell>
    </PageShell>
  );
}

export default BatchEmailPage;
