import { useCallback, useEffect, useState } from "react";
import { AccountingRulesPage } from "./renderAccountingRulesPage";

/**
 * Container que gerencia o estado de carregamento/salvamento de regras
 * e chama os métodos do api client. Isola o componente puro de presentation.
 *
 * Props:
 *  - api: cliente realApi (precisa ter listAccountingRulesEventTypes, list*Rules, etc.)
 *  - scope: "COMPANY" | "GLOBAL"
 *  - companyId: obrigatório quando scope === "COMPANY"
 *  - accounts: plano de contas da empresa (apenas para scope COMPANY)
 *  - onOpenChartOfAccounts: callback opcional para abrir o modal de plano de contas
 */
export function AccountingRulesContainer({ api, scope, companyId, accounts = [], onOpenChartOfAccounts }) {
  const [eventTypes, setEventTypes] = useState([]);
  const [rules, setRules] = useState([]);
  const [globalRules, setGlobalRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [evResp, globalResp, scopedResp] = await Promise.all([
        api.listAccountingRulesEventTypes(),
        api.listGlobalAccountingRules().catch(() => ({ data: [] })),
        scope === "COMPANY" && companyId
          ? api.listAccountingRules(companyId)
          : Promise.resolve({ data: [] }),
      ]);
      setEventTypes(Array.isArray(evResp?.data) ? evResp.data : []);
      setGlobalRules(Array.isArray(globalResp?.data) ? globalResp.data : []);
      setRules(scope === "GLOBAL"
        ? (Array.isArray(globalResp?.data) ? globalResp.data : [])
        : (Array.isArray(scopedResp?.data) ? scopedResp.data : []));
    } catch (err) {
      setError(err?.message || "Falha ao carregar regras.");
    } finally {
      setLoading(false);
    }
  }, [api, scope, companyId]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSaveRule(payload, ruleId) {
    setSaving(true);
    try {
      if (ruleId) {
        if (scope === "COMPANY") await api.updateAccountingRule(companyId, ruleId, payload);
        else await api.updateAccountingRule(null, ruleId, payload); // global update via mesmo endpoint
      } else if (scope === "COMPANY") {
        await api.createAccountingRule(companyId, payload);
      } else {
        await api.createGlobalAccountingRule(payload);
      }
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivateRule(ruleId) {
    setSaving(true);
    try {
      if (scope === "COMPANY") await api.deactivateAccountingRule(companyId, ruleId);
      else await api.deactivateAccountingRule(null, ruleId);
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error && (
        <div style={{ padding: 10, marginBottom: 10, background: "rgba(255,87,87,0.15)", border: "1px solid #FF5757", color: "#FF5757", borderRadius: 6 }}>
          {error}
        </div>
      )}
      <AccountingRulesPage
        scope={scope}
        accounts={accounts}
        globalRules={globalRules}
        rules={rules}
        eventTypes={eventTypes}
        loading={loading}
        saving={saving}
        onSaveRule={handleSaveRule}
        onDeactivateRule={handleDeactivateRule}
        onOpenChartOfAccounts={onOpenChartOfAccounts}
      />
    </>
  );
}
