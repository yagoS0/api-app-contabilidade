// PERFIL FISCAL DA EMPRESA — regime + atividades permitidas por CNAE.
//
// ⚠⚠ ESTA TELA VEIO DE DENTRO DA ABA APURAÇÃO em 24/08/2026, a pedido do dono ("muitas abas"). Lá
// ela era a seção "Perfil fiscal", o TERCEIRO nível de navegação da página da empresa — grupo →
// sub-aba → seção, sem URL nenhuma. Ela é CADASTRO (o que a empresa pode fazer), não o trabalho do
// mês, e por isso passou para o grupo **Empresa**, ao lado da ficha.
//
// ⚠ O CONTEÚDO NÃO MUDOU: é o mesmo `AbaFiscalPanel`, alimentado pelo mesmo `useApuracaoV2`. O que
// mudou foi o endereço. Uma segunda leitura das atividades faria as duas telas discordarem sobre a
// mesma empresa — é o defeito que este projeto já pagou com `legacyCompanySelect`.

import { PANEL } from "../../notas/components/notasStyles";
import { AbaFiscalPanel } from "../components/AbaFiscalPanel";

/**
 * O regime, dito com honestidade.
 *
 * ⚠⚠ O CÓDIGO ANTIGO IMPRIMIA "Simples Nacional" PARA EMPRESA SEM REGIME CADASTRADO — o default
 * `|| "SIMPLES_NACIONAL"` caía no ramo do Simples e a tela afirmava, em verde, um regime que
 * ninguém tinha informado. É exatamente o default que o projeto já recusa em `PerfilFiscalService`
 * e em `apuracaoV2.mapRegime` ("Regime atual sem default (…) aqui texto irreconhecível devolve
 * `null` e a tela diz que não sabe"), e a mesma família do `folhaAusenteNaoEZero`: ausência de dado
 * virando afirmação.
 *
 * ⚠ E verde, nesta casa, quer dizer CONCLUÍDO. Regime desconhecido não é conclusão nenhuma.
 */
function RegimeDaEmpresa({ regime }) {
  const bruto = String(regime || "").trim();

  if (!bruto) {
    return (
      <div style={{ padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, fontSize: "0.85rem", color: PANEL.text }}>
        Regime tributário: <strong style={{ color: PANEL.muted }}>não cadastrado</strong>
        <div style={{ color: PANEL.muted, fontSize: "0.78rem", marginTop: 2 }}>
          Sem o regime não dá para afirmar o enquadramento desta empresa — informe no cadastro.
        </div>
      </div>
    );
  }

  const ehSimples = bruto.toUpperCase() === "SIMPLES_NACIONAL";
  return (
    <div style={{ padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, fontSize: "0.85rem", color: PANEL.text }}>
      Regime tributário:{" "}
      <strong style={{ color: ehSimples ? "var(--state-ok)" : PANEL.text }}>
        {ehSimples ? "Simples Nacional" : bruto}
      </strong>
    </div>
  );
}

export function PerfilFiscalTab({ panel }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 14,
        width: "var(--content-wide)", marginLeft: "auto", marginRight: "auto",
      }}
    >
      <RegimeDaEmpresa regime={panel?.cadastro?.regime} />
      <AbaFiscalPanel panel={panel} />
    </div>
  );
}
