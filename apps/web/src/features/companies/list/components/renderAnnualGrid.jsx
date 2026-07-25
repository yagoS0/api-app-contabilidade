// C8: visão ANUAL — linha de meses (Jan…Dez) × coluna de empresas.
//
// Cada célula carrega DOIS indicadores (decisão do dono): fechamento CONTÁBIL do mês e
// apuração transmitida. São coisas diferentes e podem divergir — uma empresa pode estar
// apurada sem o mês estar fechado, e vice-versa —, por isso não viram um indicador só.
//
//   ■ à esquerda  = fechamento contábil (teal = fechado, cinza = aberto)
//   ● à direita   = apuração (verde = transmitida, cinza = não)
//
// Clicar na célula abre a empresa naquela competência.

import { useEffect, useState } from "react";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const COR_FECHADO = "#2DD4BF";
const COR_APURADA = "#69FF47";
const COR_VAZIO = "#3b3d51";

function Celula({ mes, razao, onOpen }) {
  const titulo = [
    `${razao} · ${mes.competencia}`,
    mes.fechado ? "Fechamento contábil: FECHADO" : "Fechamento contábil: aberto",
    mes.apurada ? `Apuração: ${mes.estadoApuracao || "transmitida"}` : "Apuração: não transmitida",
  ].join("\n");

  return (
    <td style={{ padding: 2, textAlign: "center" }}>
      <button
        type="button"
        onClick={() => onOpen?.(mes.competencia)}
        title={titulo}
        aria-label={titulo}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3,
          width: 40, height: 24, padding: 0, cursor: "pointer",
          background: mes.fechado || mes.apurada ? "rgba(255,255,255,0.03)" : "transparent",
          border: "1px solid #2b2d45", borderRadius: 5,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 2, background: mes.fechado ? COR_FECHADO : COR_VAZIO }} />
        <span style={{ width: 9, height: 9, borderRadius: 999, background: mes.apurada ? COR_APURADA : COR_VAZIO }} />
      </button>
    </td>
  );
}

export function AnnualGrid({ api, onOpenCompany }) {
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [linhas, setLinhas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let cancelado = false;
    if (!api || typeof api.getCompaniesAnnual !== "function") {
      setErro("Visão anual indisponível nesta versão da API.");
      return undefined;
    }
    setLoading(true);
    setErro(null);
    api.getCompaniesAnnual(ano)
      .then((out) => {
        if (cancelado) return;
        setLinhas(Array.isArray(out?.empresas) ? out.empresas : []);
      })
      .catch((err) => { if (!cancelado) setErro(err?.message || "Falha ao carregar a visão anual."); })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [api, ano]);

  const navBtn = {
    background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6, color: "#F8F8F2",
    padding: "4px 10px", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", lineHeight: 1,
  };

  return (
    <section aria-label="Visão anual" style={{ marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" style={navBtn} onClick={() => setAno((a) => a - 1)} title="Ano anterior">‹</button>
          <strong style={{ color: "#F8F8F2", fontSize: "1.05rem", minWidth: 54, textAlign: "center" }}>{ano}</strong>
          <button type="button" style={navBtn} onClick={() => setAno((a) => a + 1)} title="Próximo ano">›</button>
        </div>
        {/* Legenda: sem ela os dois quadradinhos não significam nada pra quem abre a tela. */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#A7B0C0", fontSize: "0.78rem" }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: COR_FECHADO }} /> fechamento contábil
          <span style={{ width: 9, height: 9, borderRadius: 999, background: COR_APURADA, marginLeft: 8 }} /> apuração transmitida
        </span>
      </div>

      {erro && (
        <div style={{ margin: "0 0 12px", padding: "8px 12px", borderRadius: 6, fontSize: "0.85rem", background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", color: "#FF4757" }}>
          {erro}
        </div>
      )}

      <div style={{ overflowX: "auto", border: "1px solid #2b2d45", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ background: "#21222C", textAlign: "left" }}>
              <th style={{ padding: "8px 10px", position: "sticky", left: 0, background: "#21222C", minWidth: 220 }}>
                Empresa
              </th>
              {MESES.map((m) => (
                <th key={m} style={{ padding: "8px 4px", textAlign: "center", color: "#A7B0C0", fontWeight: 600 }}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={13} style={{ padding: 16, textAlign: "center", color: "#A7B0C0" }}>Carregando…</td></tr>
            )}
            {!loading && linhas.length === 0 && !erro && (
              <tr><td colSpan={13} style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>Nenhuma empresa.</td></tr>
            )}
            {!loading && linhas.map((l) => (
              <tr key={l.companyId} style={{ borderTop: "1px solid #2b2d45" }}>
                <td style={{ padding: "6px 10px", color: "#F8F8F2", position: "sticky", left: 0, background: "#1A1B26" }}>
                  {l.razao}
                  <div style={{ color: "#6272A4", fontSize: "0.72rem" }}>{l.cnpj}</div>
                </td>
                {l.meses.map((mes) => (
                  <Celula
                    key={mes.competencia}
                    mes={mes}
                    razao={l.razao}
                    onOpen={(competencia) => onOpenCompany?.(l.companyId, competencia)}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
