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
import { estadoDoRegime, ESTADO_DO_REGIME } from "../lib/perfilFiscalTela";

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
function RegimeDaEmpresa({ regime, prefill }) {
  // ⚠ REGRA em `lib/perfilFiscalTela.js` (com teste) — aqui é só a ligação.
  const r = estadoDoRegime({ regime, prefill });

  // ⚠⚠ VERDE SÓ PARA O QUE FOI CADASTRADO. Nesta casa verde quer dizer CONCLUÍDO, e um regime que
  // veio do DEFAULT do sistema (`mapRegime` termina em `return "SIMPLES_NACIONAL"`) não é
  // conclusão nenhuma. Era exatamente assim que a tela afirmava, em verde, um regime que ninguém
  // tinha conferido — e o backend já mandava `prefill: true` para distinguir, sem ninguém ler.
  const cor = r.estado === ESTADO_DO_REGIME.CADASTRADO && r.rotulo === "Simples Nacional"
    ? "var(--state-ok)"
    : (r.estado === ESTADO_DO_REGIME.DERIVADO ? "#FFB347" : PANEL.muted);

  return (
    <div style={{ padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, fontSize: "0.85rem", color: PANEL.text }}>
      Regime tributário: <strong style={{ color: cor }}>{r.rotulo}</strong>
      {r.estado === ESTADO_DO_REGIME.DERIVADO ? (
        <span style={{ color: "#FFB347", fontSize: "0.74rem", marginLeft: 6 }}>⚠ não conferido</span>
      ) : null}
      {r.nota ? (
        <div style={{ color: PANEL.muted, fontSize: "0.78rem", marginTop: 2 }}>{r.nota}</div>
      ) : null}
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
      <RegimeDaEmpresa regime={panel?.cadastro?.regime} prefill={panel?.cadastroPrefill} />
      <AbaFiscalPanel panel={panel} />
    </div>
  );
}
