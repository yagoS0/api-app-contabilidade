import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { ACCOUNTING_PANEL, fmtMoney } from "../../entries/lib/accountingEntriesShared";
import { TIPO_GROUP_ACCENT } from "../../entries/lib/accountingEntriesShared";

const GROUP_ORDER = ["RECEITA", "PROVISAO", "BAIXA"];
const GROUP_LABELS = {
  RECEITA: "Receitas",
  PROVISAO: "Provisões / Impostos",
  BAIXA: "Pagamentos / Baixas",
};

const STRATEGY_LABELS = {
  LAST_DAY_OF_MONTH: "Último dia do mês da competência",
  DUE_DATE: "Data de vencimento da guia",
  SYNC_DATE: "Data da sincronização",
  MANUAL: "Definida manualmente pelo contador",
};

function ScopeBadge({ scope }) {
  if (scope === "COMPANY") {
    return <span style={{ fontSize: "0.7rem", color: "#1A1B26", background: "#69FF47", padding: "2px 7px", borderRadius: 999, fontWeight: 700 }}>Personalizada</span>;
  }
  if (scope === "GLOBAL") {
    return <span style={{ fontSize: "0.7rem", color: "#1A1B26", background: "#8BE9FD", padding: "2px 7px", borderRadius: 999, fontWeight: 700 }}>Global</span>;
  }
  return <span style={{ fontSize: "0.7rem", color: "#aeb6d3", background: "#44475A", padding: "2px 7px", borderRadius: 999, fontWeight: 600 }}>Padrão do sistema</span>;
}

function RuleCard({ eventType, accent, accounts, scope, existingRule, defaults, parentRule, onSave, onDeactivate, saving }) {
  const initialFromExisting = existingRule
    ? {
        descriptionTemplate: existingRule.descriptionTemplate || "",
        debitAccountCode: existingRule.debitAccountCode || "",
        creditAccountCode: existingRule.creditAccountCode || "",
        entryDateStrategy: existingRule.entryDateStrategy || defaults.entryDateStrategy || "LAST_DAY_OF_MONTH",
      }
    : {
        descriptionTemplate: defaults.descriptionTemplate || "",
        debitAccountCode: defaults.debitAccountCode || "",
        creditAccountCode: defaults.creditAccountCode || "",
        entryDateStrategy: defaults.entryDateStrategy || "LAST_DAY_OF_MONTH",
      };

  const [form, setForm] = useState(initialFromExisting);
  const [error, setError] = useState("");

  useEffect(() => { setForm(initialFromExisting); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [existingRule?.id]);

  const dirty = useMemo(() => {
    return (
      form.descriptionTemplate !== initialFromExisting.descriptionTemplate ||
      form.debitAccountCode !== initialFromExisting.debitAccountCode ||
      form.creditAccountCode !== initialFromExisting.creditAccountCode ||
      form.entryDateStrategy !== initialFromExisting.entryDateStrategy
    );
  }, [form, initialFromExisting]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setError("");
    if (!form.debitAccountCode.trim() || !form.creditAccountCode.trim()) {
      setError("Informe as contas de débito e crédito.");
      return;
    }
    if (!form.descriptionTemplate.trim()) {
      setError("Informe o histórico padrão.");
      return;
    }
    try {
      await onSave({
        eventType: eventType.key,
        descriptionTemplate: form.descriptionTemplate.trim(),
        debitAccountCode: form.debitAccountCode.trim(),
        creditAccountCode: form.creditAccountCode.trim(),
        amountSource: defaults.amountSource,
        entryDateStrategy: form.entryDateStrategy,
        isActive: true,
      }, existingRule?.id || null);
    } catch (err) {
      setError(err?.message || "Erro ao salvar.");
    }
  }

  async function handleDeactivate() {
    if (!existingRule?.id) return;
    if (!window.confirm("Restaurar para o padrão? Essa empresa voltará a usar a regra global ou padrão do sistema.")) return;
    try {
      await onDeactivate(existingRule.id);
    } catch (err) {
      setError(err?.message || "Erro ao restaurar.");
    }
  }

  const cardStyle = {
    background: "#1A1B26",
    border: `1px solid ${ACCOUNTING_PANEL.border}`,
    borderLeft: `4px solid ${accent}`,
    borderRadius: 10,
    padding: 18,
    marginBottom: 14,
  };

  const inputStyle = {
    width: "100%",
    background: "#24253A",
    border: `1px solid ${ACCOUNTING_PANEL.border}`,
    borderRadius: 6,
    color: ACCOUNTING_PANEL.text,
    padding: "8px 10px",
    fontSize: "0.9rem",
    boxSizing: "border-box",
  };

  const labelStyle = { display: "grid", gap: 4, fontSize: "0.78rem", color: ACCOUNTING_PANEL.muted };

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h4 style={{ margin: 0, fontSize: "1rem", color: ACCOUNTING_PANEL.text }}>{eventType.label}</h4>
          <code style={{ fontSize: "0.7rem", color: ACCOUNTING_PANEL.muted }}>{eventType.key}</code>
        </div>
        <ScopeBadge scope={existingRule ? scope : (parentRule ? "GLOBAL" : "FALLBACK")} />
      </div>

      {scope === "COMPANY" && !existingRule && parentRule && (
        <p style={{ fontSize: "0.78rem", color: "#8BE9FD", margin: "0 0 10px" }}>
          Usando regra global atual: D {parentRule.debitAccountCode} / C {parentRule.creditAccountCode}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <label style={labelStyle}>
          Conta Débito
          <input
            list={`accounts-debit-${eventType.key}`}
            value={form.debitAccountCode}
            onChange={(e) => setField("debitAccountCode", e.target.value)}
            placeholder="Código"
            style={inputStyle}
          />
          <datalist id={`accounts-debit-${eventType.key}`}>
            {accounts.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>)}
          </datalist>
          {form.debitAccountCode && (() => {
            const acc = accounts.find((a) => a.codigo === form.debitAccountCode);
            return acc ? <span style={{ fontSize: "0.72rem", color: "#aeb6d3" }}>{acc.nome}</span> : <span style={{ fontSize: "0.72rem", color: "#FFB347" }}>Conta não encontrada no plano</span>;
          })()}
        </label>

        <label style={labelStyle}>
          Conta Crédito
          <input
            list={`accounts-credit-${eventType.key}`}
            value={form.creditAccountCode}
            onChange={(e) => setField("creditAccountCode", e.target.value)}
            placeholder="Código"
            style={inputStyle}
          />
          <datalist id={`accounts-credit-${eventType.key}`}>
            {accounts.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>)}
          </datalist>
          {form.creditAccountCode && (() => {
            const acc = accounts.find((a) => a.codigo === form.creditAccountCode);
            return acc ? <span style={{ fontSize: "0.72rem", color: "#aeb6d3" }}>{acc.nome}</span> : <span style={{ fontSize: "0.72rem", color: "#FFB347" }}>Conta não encontrada no plano</span>;
          })()}
        </label>
      </div>

      <label style={{ ...labelStyle, marginBottom: 10 }}>
        Histórico padrão
        <input
          type="text"
          value={form.descriptionTemplate}
          onChange={(e) => setField("descriptionTemplate", e.target.value)}
          placeholder="Ex: VR REF DAS - {{competencia}}"
          style={inputStyle}
        />
        <span style={{ fontSize: "0.7rem", color: ACCOUNTING_PANEL.muted }}>
          Variáveis disponíveis: <code>&#123;&#123;competencia&#125;&#125;</code>, <code>&#123;&#123;companyName&#125;&#125;</code>, <code>&#123;&#123;cnpj&#125;&#125;</code>
        </span>
      </label>

      <label style={{ ...labelStyle, marginBottom: 12 }}>
        Estratégia da data
        <select
          value={form.entryDateStrategy}
          onChange={(e) => setField("entryDateStrategy", e.target.value)}
          style={inputStyle}
        >
          {Object.entries(STRATEGY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>

      {error && <p style={{ color: "#FF5757", fontSize: "0.8rem", margin: "0 0 8px" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {existingRule?.id && (
          <Button variant="secondary" size="sm" onClick={handleDeactivate} disabled={saving}>
            Restaurar padrão
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Salvando..." : (existingRule ? "Salvar" : "Salvar regra")}
        </Button>
      </div>
    </div>
  );
}

export function AccountingRulesPage({
  scope,                  // "COMPANY" | "GLOBAL"
  accounts = [],          // Plano de contas (vazio em GLOBAL)
  globalRules = [],       // Sempre carregadas (para mostrar como herança em escopo COMPANY)
  rules = [],             // Regras do escopo atual
  eventTypes = [],        // Metadata
  loading = false,
  saving = false,
  onSaveRule,             // (payload, ruleId|null) => Promise
  onDeactivateRule,       // (ruleId) => Promise
  onOpenChartOfAccounts,  // () => void
}) {
  const isCompanyScope = scope === "COMPANY";
  const requiresPlan = isCompanyScope && (accounts?.length || 0) === 0;

  const rulesByEvent = useMemo(() => {
    const m = {};
    for (const r of rules) m[r.eventType] = r;
    return m;
  }, [rules]);

  const globalByEvent = useMemo(() => {
    const m = {};
    for (const r of globalRules) m[r.eventType] = r;
    return m;
  }, [globalRules]);

  const eventsByGroup = useMemo(() => {
    const groups = { RECEITA: [], PROVISAO: [], BAIXA: [] };
    for (const ev of eventTypes) {
      const g = ev.group || "OUTRO";
      if (!groups[g]) groups[g] = [];
      groups[g].push(ev);
    }
    return groups;
  }, [eventTypes]);

  const containerStyle = {
    background: ACCOUNTING_PANEL.surface,
    borderRadius: 16,
    padding: 24,
    color: ACCOUNTING_PANEL.text,
  };

  if (requiresPlan) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "1.15rem", color: ACCOUNTING_PANEL.text }}>
            Importe o plano de contas primeiro
          </h3>
          <p style={{ color: ACCOUNTING_PANEL.muted, margin: "0 0 18px", maxWidth: 520, marginLeft: "auto", marginRight: "auto" }}>
            Para configurar lançamentos padrão personalizados desta empresa, é necessário ter o plano de contas cadastrado. Importe ou crie ao menos uma conta antes de continuar.
          </p>
          {onOpenChartOfAccounts && (
            <Button variant="primary" onClick={onOpenChartOfAccounts}>
              Abrir Plano de Contas
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: "1.2rem" }}>
          {isCompanyScope ? "Configurações de Lançamentos" : "Padrões Globais de Lançamentos"}
        </h2>
        <p style={{ color: ACCOUNTING_PANEL.muted, margin: 0, fontSize: "0.875rem" }}>
          {isCompanyScope
            ? "Configure as contas e históricos usados nos lançamentos automáticos desta empresa. Sobrescreve os padrões globais."
            : "Defina valores padrão usados por todas as empresas. Cada empresa pode sobrescrever na sua aba Configurações."}
        </p>
      </div>

      {loading && <p style={{ color: ACCOUNTING_PANEL.muted }}>Carregando...</p>}

      {!loading && GROUP_ORDER.map((group) => {
        const events = eventsByGroup[group] || [];
        if (events.length === 0) return null;
        const accent = TIPO_GROUP_ACCENT[group] || "#6272A4";
        return (
          <section key={group} style={{ marginBottom: 26 }}>
            <h3 style={{
              fontSize: "0.85rem", letterSpacing: "0.05em", textTransform: "uppercase",
              color: accent, fontWeight: 700, margin: "0 0 12px",
              borderTop: `2px solid ${accent}`, paddingTop: 10,
            }}>
              {GROUP_LABELS[group] || group}
            </h3>
            {events.map((ev) => (
              <RuleCard
                key={ev.key}
                eventType={ev}
                accent={accent}
                accounts={isCompanyScope ? accounts : []}
                scope={scope}
                existingRule={rulesByEvent[ev.key] || null}
                defaults={ev.defaults || {}}
                parentRule={isCompanyScope ? globalByEvent[ev.key] : null}
                onSave={onSaveRule}
                onDeactivate={onDeactivateRule}
                saving={saving}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
