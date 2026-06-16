import { Button } from "../../../../components/ui/Button";

// Tributos potencialmente exibidos no card de compliance.
// A ordem aqui define a ordem visual das tags (DAS primeiro para Simples; depois Presumidos; PARC_DAS no fim).
const COMPLIANCE_CANDIDATES = [
  { key: "das",       label: "DAS" },
  { key: "irpj",      label: "IRPJ" },
  { key: "csll",      label: "CSLL" },
  { key: "pisCofins", label: "PIS/COFINS" },
  { key: "iss",       label: "ISS" },
  { key: "inss",      label: "INSS" },
  // PARC_DAS — só aparece quando há parcelamento ativo. tone diferenciado (laranja) no render.
  { key: "parcDas",   label: "PARC DAS", accent: true },
];

export function getComplianceTags(guideCompliance) {
  if (!guideCompliance || typeof guideCompliance !== "object") return [];

  // Novo formato: cada tributo é um nó { required, ok }.
  // Itera todos os candidatos e inclui só os marcados como required pelo backend
  // (que decide com base no regime tributário + pró-labore).
  const tags = [];
  for (const { key, label, accent } of COMPLIANCE_CANDIDATES) {
    const node = guideCompliance[key];
    if (node?.required) {
      // Q17: state present/vazio/missing → cor verde/amarelo/vermelho (só na tag).
      tags.push({ label, ok: Boolean(node.ok), accent: Boolean(accent), state: node.state || (node.ok ? "present" : "missing") });
    }
  }
  if (tags.length > 0) return tags;

  // Fallback legado (formato antigo com `expected`).
  if (!guideCompliance?.expected) return [];
  return [
    {
      label: guideCompliance.expected === "SIMPLES" ? "DAS" : "INSS",
      ok: Boolean(guideCompliance.ok),
    },
  ];
}

// Q17: cores por estado da tag (amarelo = vazio confirmado).
const TAG_STATE_COLOR = { present: "#69FF47", vazio: "#FFB347", missing: "#FF5757" };

export function CompanyCard({ company, onAccess }) {
  const tags = getComplianceTags(company.guideCompliance);
  const serproEligible = Boolean(company?.serproStatus?.eligible);
  // Q17: empresa FECHADA (contábil) → card inteiro fica verde-azulado (teal) + cadeado no título.
  const fechada = Boolean(company?.fechamentoContabil?.fechado);
  const cardStyle = fechada
    ? { background: "rgba(45,212,191,0.10)", borderColor: "#2DD4BF" }
    : undefined;
  const fechadaTitle = fechada
    ? `Empresa fechada${company.fechamentoContabil?.fechadoEm ? ` em ${new Date(company.fechamentoContabil.fechadoEm).toLocaleDateString("pt-BR")}` : ""}`
    : undefined;

  return (
    <article className="company-tile" style={cardStyle}>
      <div className="company-tile__body">
        <h3>
          {company.razao}
          {fechada && <span title={fechadaTitle} style={{ marginLeft: 6 }}>🔒</span>}
        </h3>
        <p style={{ color: "#FFFFFF" }}>CNPJ: {company.cnpj}</p>
      </div>
      <p className="company-serpro-status" aria-label="Status da integração SERPRO">
        <span
          className={serproEligible ? "company-serpro-status__badge company-serpro-status__badge--ok" : "company-serpro-status__badge company-serpro-status__badge--off"}
          title={serproEligible ? "Empresa apta ao fluxo SERPRO" : "Empresa não apta ao fluxo SERPRO"}
        >
          SERPRO
        </span>
        {/* Q16/Q17: selo de envio das guias — mesmo estilo das tags (só borda):
            verde se enviadas, vermelho se não. */}
        <span
          style={{
            // Q18: sem borda — cor na fonte (verde enviado / vermelho não enviado).
            marginLeft: 8, fontSize: "0.9rem", fontWeight: 700, padding: "2px 6px",
            color: company.monthEmailSent ? "#69FF47" : "#FF5757",
          }}
          title={
            company.monthEmailSent
              ? `Guias do mês (${company.monthEmailCompetencia || ""}) enviadas por e-mail`
              : `Guias do mês (${company.monthEmailCompetencia || ""}) ainda não enviadas`
          }
        >
          {company.monthEmailSent ? "📤 guias" : "✉ guias"}
        </span>
      </p>
      <p className="compliance-tags" aria-label="Status de guias obrigatórias">
        {tags.map((tag) => {
          // Q17: só a BORDA colorida por estado; texto neutro; cantos mais quadrados.
          // accent (PARC_DAS) = laranja; present=verde, vazio=amarelo, missing=vermelho.
          const color = tag.accent ? "#FFB347" : (TAG_STATE_COLOR[tag.state] || (tag.ok ? "#69FF47" : "#FF5757"));
          const title = tag.accent
            ? `${tag.label} — parcelamento ativo`
            : tag.state === "vazio"
              ? `${tag.label} — sem guia (confirmado)`
              : tag.ok ? `${tag.label} em dia` : `${tag.label} pendente`;
          return (
            <span
              key={tag.label}
              style={{
                // Q18: sem borda — a cor vai na FONTE (estado verde/amarelo/vermelho).
                fontSize: "0.72rem", fontWeight: 700, padding: "2px 6px", color,
              }}
              title={title}
            >
              {tag.label}
            </span>
          );
        })}
        {!tags.length ? (
          <span style={{ fontSize: "0.72rem", padding: "2px 6px", color: "#aeb6d3" }}>
            Sem obrigações
          </span>
        ) : null}
      </p>
      <Button type="button" className="company-tile__action" onClick={() => onAccess(company.companyId)}>
        Acessar
      </Button>
    </article>
  );
}
