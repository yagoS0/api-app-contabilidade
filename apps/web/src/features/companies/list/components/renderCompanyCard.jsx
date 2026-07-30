import { Button } from "../../../../components/ui/Button";
import { rotuloRegime, SITUACAO_FISCAL_SIMBOLO } from "../../../../lib/vocabulario";

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

// C6: os selos de identidade da empresa (regime · SERPRO · A1) agora usam UM design só —
// pílula com borda colorida. Antes SERPRO era badge com classe CSS e A1 era fonte colorida.
function Pill({ color, title, children }) {
  return (
    <span
      style={{
        fontSize: "0.7rem", fontWeight: 700, padding: "1px 8px", borderRadius: 999,
        border: `1px solid ${color}`, color,
      }}
      title={title}
    >
      {children}
    </span>
  );
}

// C6: situação fiscal (SITFIS) — só avisa quando há algo a dizer. `null` (nunca consultada)
// não vira selo: não afirmamos nada sobre o fisco sem ter consultado.
// Só a PENDÊNCIA aparece no card, com símbolo E palavra. O parcelamento saiu daqui: virou a tag
// "parc" ao lado do regime, junto da identidade da empresa.
const FISCAL_META = {
  COM_PENDENCIA: {
    label: `${SITUACAO_FISCAL_SIMBOLO.COM_PENDENCIA} Pendência`, color: "#FF4757",
    title: "Situação fiscal: empresa COM PENDÊNCIA (SITFIS)",
  },
};

export function CompanyCard({ company, onAccess }) {
  const tags = getComplianceTags(company.guideCompliance);
  const serproEligible = Boolean(company?.serproStatus?.eligible);
  // Q52: selo de certificado A1 da empresa — verde (ativo), vermelho (vencido), apagado (sem cert).
  // certExpiresAt null com cert presente conta como ativo (upload legado sem validade extraída).
  const legacy = company?.legacyCompany || null;
  const hasCert = Boolean(legacy?.certStorageKey);
  const certExpiresAt = legacy?.certExpiresAt ? new Date(legacy.certExpiresAt) : null;
  const certExpirado = hasCert && certExpiresAt && certExpiresAt.getTime() < Date.now();
  const certAtivo = hasCert && !certExpirado;
  const certColor = certAtivo ? "#69FF47" : certExpirado ? "#FF5757" : "#6272A4";
  const certTitle = certAtivo
    ? `Certificado A1 ativo${certExpiresAt ? ` — válido até ${certExpiresAt.toLocaleDateString("pt-BR")}` : " — validade desconhecida"}`
    : certExpirado
      ? `Certificado A1 vencido em ${certExpiresAt.toLocaleDateString("pt-BR")}`
      : "Empresa sem certificado A1";
  // Q52: total de notas emitidas da competência filtrada + selo de apuração transmitida.
  const notas = company?.notasEmitidas || null;
  const notasTotal = Number(notas?.total || 0);
  const apuracao = company?.apuracao || null;
  const apurada = Boolean(apuracao?.apurada);
  const apuradaTitle = apurada
    ? `Apuração ${apuracao?.estado === "confirmada" ? "confirmada" : "transmitida"}${apuracao?.transmitidoEm ? ` em ${new Date(apuracao.transmitidoEm).toLocaleDateString("pt-BR")}` : ""}`
    : `Apuração da competência ainda não transmitida`;
  // Q17: empresa FECHADA (contábil) → card inteiro fica verde-azulado (teal) + cadeado no título.
  const fechada = Boolean(company?.fechamentoContabil?.fechado);
  const cardStyle = fechada
    ? { background: "rgba(45,212,191,0.10)", borderColor: "#2DD4BF" }
    : undefined;
  const fechadaTitle = fechada
    ? `Empresa fechada${company.fechamentoContabil?.fechadoEm ? ` em ${new Date(company.fechamentoContabil.fechadoEm).toLocaleDateString("pt-BR")}` : ""}`
    : undefined;
  // Regime tributário — tag Simples/Presumido/Real (vem do cadastro legado).
  const regime = legacy?.regimeTributario || null;
  const regimeLabel = rotuloRegime(regime) || null;
  const regimeColor = regime === "SIMPLES" ? "#8BE9FD"
    : regime === "LUCRO_PRESUMIDO" ? "#FFB86C"
    : regime === "LUCRO_REAL" ? "#BD93F9" : "#6272A4";
  // Empresa zerada (sem movimento) — só enviamos obrigações zeradas; não há guias/impostos.
  const zerada = Boolean(company?.empresaZerada);
  // C6: "Enviado" substitui as tags de guia só quando TODAS as guias do mês foram enviadas.
  const envio = company?.guidesEnvio || null;
  const todasEnviadas = Boolean(envio?.todasEnviadas);
  // C6: situação fiscal do SITFIS (⚠ ao lado de "apurada") e parcelamento ativo (selo PARC).
  const temParcelamento = Boolean(company?.temParcelamento);
  const temFolha = Boolean(company?.temFolha);
  const fiscalMeta = FISCAL_META[company?.fiscalSituacao] || null;
  // Parcelamento é identidade da empresa (como o regime), não evento do mês: vale tanto quando há
  // guia de parcelamento ativa quanto quando a situação fiscal do SITFIS diz que há débito
  // parcelado. As duas fontes viram a MESMA tag, ao lado da tributação.
  const emParcelamento = temParcelamento || company?.fiscalSituacao === "EM_PARCELAMENTO";

  return (
    <article className="company-tile" style={cardStyle}>
      <div className="company-tile__body">
        <h3>
          {company.razao}
          {fechada && <span title={fechadaTitle} style={{ marginLeft: 6 }}>🔒</span>}
        </h3>
        <p style={{ color: "#FFFFFF" }}>CNPJ: {company.cnpj}</p>
        {/* C6: identidade da empresa — regime, SERPRO e A1 juntos e no MESMO design (pílula). */}
        <p style={{ margin: "4px 0 0", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {regimeLabel && (
            <Pill color={regimeColor} title={`Regime tributário: ${regimeLabel}`}>{regimeLabel}</Pill>
          )}
          {/* SELO SÓ PARA EXCEÇÃO. Antes "SERPRO" e "A1" apareciam em TODAS as empresas — e selo
              que nunca varia não informa nada: ocupa espaço e não distingue ninguém. O estado
              esperado (apta ao SERPRO, certificado válido) é silêncio; quem precisa gritar é o
              que está faltando ou vencendo. */}
          {/* Parcelamento fica JUNTO da tributação: é característica da empresa, não do mês. */}
          {emParcelamento && (
            <Pill color="#FFB347" title="Empresa com parcelamento — há parcelas a acompanhar">parc</Pill>
          )}
          {/* Folha entra aqui pelo mesmo motivo do parc: é característica da empresa, não evento
              do mês. Não contraria a regra do "selo só para exceção" logo abaixo — aquela vale
              para ESTADO (SERPRO apto, A1 válido), onde o normal é silêncio. Aqui o campo varia
              entre empresas e é o que diz quais obrigações trabalhistas fazem sentido. */}
          {temFolha && (
            <Pill color="#FF79C6" title="Empresa com folha de pagamento (empregado registrado)">folha</Pill>
          )}
          {/* Presente = silêncio. Faltando = a própria palavra, em vermelho. Não "sem SERPRO":
              a ausência já é dita pela cor, e o "sem" só alongava a pílula. */}
          {!serproEligible && (
            <Pill color="#FF5757" title="Empresa NÃO apta ao fluxo SERPRO — confira procuração e certificado">
              SERPRO
            </Pill>
          )}
          {!certAtivo && (
            <Pill color="#FF5757" title={certTitle}>A1</Pill>
          )}
          {zerada && (
            <Pill color="#FFB347" title="Empresa zerada (sem movimento) — só enviamos obrigações zeradas">
              🚫 Zerada
            </Pill>
          )}
        </p>
      </div>
      <p className="company-serpro-status" aria-label="Apuração e situação fiscal">
        {/* Q52: selo de empresa apurada (apuração transmitida/confirmada na competência). */}
        {/* Mesma regra: apuração transmitida é o esperado. O que merece destaque é a que AINDA
            NÃO foi — é ela que tem trabalho pendente. */}
        {!apurada && (
          <span
            style={{ fontSize: "0.82rem", fontWeight: 700, padding: "2px 6px", color: "#FFB347" }}
            title={apuradaTitle}
          >
            Falta apurar
          </span>
        )}
        {/* C6: aviso de pendência fiscal (SITFIS) ao lado de "apurada". */}
        {fiscalMeta && (
          <span
            style={{ marginLeft: 8, fontSize: "0.82rem", fontWeight: 700, padding: "2px 6px", color: fiscalMeta.color }}
            title={fiscalMeta.title}
            aria-label={fiscalMeta.title}
          >
            {fiscalMeta.label}
          </span>
        )}
      </p>
      {/* Q52: total de notas emitidas da competência filtrada no dashboard. */}
      {notas && (
        <p
          style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#aeb6d3" }}
          title={`${notas.quantidade || 0} nota(s) emitida(s) autorizada(s) na competência ${notas.competencia || ""}`}
        >
          Notas emitidas: <strong style={{ color: notasTotal > 0 ? "#F8F8F2" : "#6272A4" }}>
            R$ {notasTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
        </p>
      )}
      <p className="compliance-tags" aria-label="Status de guias obrigatórias">
        {zerada ? (
          <span
            style={{ fontSize: "0.72rem", fontWeight: 700, padding: "2px 6px", color: "#FFB347" }}
            title="Empresa zerada (sem movimento) — sem guias/impostos; enviamos apenas obrigações zeradas"
          >
            Empresa zerada — sem obrigações com imposto
          </span>
        ) : todasEnviadas ? (
          /* C6: guias do mês todas enviadas → o "Enviado" ocupa o LUGAR das tags de guia.
             Guia nova/recalculada/retificada volta pra PENDING no backend → todasEnviadas vira
             false → as tags reaparecem até o novo envio. */
          <span
            style={{ fontSize: "0.9rem", fontWeight: 700, padding: "2px 6px", color: "#69FF47" }}
            title={`As ${envio.total} guia(s) do mês (${envio.competencia || ""}) foram enviadas ao cliente`}
          >
            📤 Enviado
          </span>
        ) : (
        <>
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
        {/* O selo PARC que ficava aqui subiu para junto da tributação — parcelamento é
            característica da empresa, não obrigação daquele mês. A tag "PARC DAS" segue nesta
            linha: essa sim é a PARCELA aberta na competência. */}
        {!tags.length && !temParcelamento ? (
          <span style={{ fontSize: "0.72rem", padding: "2px 6px", color: "#aeb6d3" }}>
            Sem obrigações
          </span>
        ) : null}
        </>
        )}
      </p>
      <Button type="button" className="company-tile__action" onClick={() => onAccess(company.companyId)}>
        Acessar
      </Button>
    </article>
  );
}
