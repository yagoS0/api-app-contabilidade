import { Button } from "../../../../components/ui/Button";
import { rotuloRegime, SITUACAO_FISCAL_SIMBOLO } from "../../../../lib/vocabulario";
import { GuiaChip, todasConcluidas } from "./renderGuiaChip";
import { estadoCertificado } from "../lib/certificado";
import { empresaSemObrigacoes, TITULO_ZERADA } from "../lib/estadoDominante";

// Tributos potencialmente exibidos no card de compliance.
// A ordem aqui define a ordem visual das tags (DAS primeiro para Simples; depois Presumidos; PARC_DAS no fim).
const COMPLIANCE_CANDIDATES = [
  { key: "das",       label: "DAS" },
  { key: "irpj",      label: "IRPJ" },
  { key: "csll",      label: "CSLL" },
  { key: "pisCofins", label: "PIS/COFINS" },
  { key: "iss",       label: "ISS" },
  { key: "inss",      label: "INSS" },
  // ⚠ "Parcelamento", não "PARC DAS": desde que a guia da parcela deixou de satisfazer o nó do DAS,
  // uma parcela de INSS parcelado também cai aqui — chamá-la de DAS seria trocar um erro por outro.
  // O tipo real (PARCSN, PERT_SN…) e o número da parcela ficam no popover do chip.
  { key: "parcDas",   label: "Parcelamento" },
];

export function getComplianceTags(guideCompliance) {
  if (!guideCompliance || typeof guideCompliance !== "object") return [];

  // Novo formato: cada tributo é um nó com o CICLO DE VIDA
  // (missing → gerada → enviada, ou missing → vazio; mais `conflito`).
  // Itera todos os candidatos e inclui só os marcados como required pelo backend
  // (que decide com base no regime tributário + pró-labore).
  const tags = [];
  for (const { key, label } of COMPLIANCE_CANDIDATES) {
    const node = guideCompliance[key];
    if (node?.required) {
      // A parcela se identifica pelo número: "Parcela 3/60" diz o que precisa ser entregue ESTE
      // mês. "Parcelamento" (a existência do acordo) é assunto da coluna Situação fiscal — dizer o
      // mesmo nos dois lugares foi o que fez o parcelamento aparecer duplicado.
      const rotulo = key === "parcDas" && node.numeroParcela && node.quantidadeParcelas
        ? `Parcela ${node.numeroParcela}/${node.quantidadeParcelas}`
        : label;
      tags.push({
        key, label: rotulo, ok: Boolean(node.ok),
        // `present` é o formato antigo — sem `emailStatus` não dá para saber se foi enviada,
        // então cai em "gerada", que é o estado que ainda pede ação.
        state: node.state === "present" ? "gerada" : (node.state || (node.ok ? "gerada" : "missing")),
        // Carimbo da guia: é o que permite enviar e auditar a marcação direto do chip.
        guideId: node.guideId || null,
        emailStatus: node.emailStatus || null,
        emailSentAt: node.emailSentAt || null,
        // O envio agora tem CANAL. É o que permite o popover dizer "WhatsApp · 05/08 14:32 ·
        // ✓✓ lida" em vez de assumir e-mail — e é a informação que o contador usa para saber por
        // onde a guia chegou (ou não) ao cliente.
        canalEnvio: node.canalEnvio || null,
        envioStatus: node.envioStatus || null,
        envioEm: node.envioEm || null,
        envioErro: node.envioErro || null,
        envioDestino: node.envioDestino || null,
        vazioEm: node.vazioEm || null,
        vazioPor: node.vazioPor || null,
        vazioMotivo: node.vazioMotivo || null,
        faturamento: node.faturamento || 0,
        origem: node.origem || null,
        // Só o nó `parcDas` traz estes — identificam QUAL acordo e QUAL parcela no popover.
        tipoParcelamento: node.tipoParcelamento || null,
        numeroParcelamento: node.numeroParcelamento || null,
        numeroParcela: node.numeroParcela || null,
        quantidadeParcelas: node.quantidadeParcelas || null,
        atrasada: Boolean(node.atrasada),
      });
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

/**
 * Pílula da linha de identidade.
 *
 * ⚠ Dois tipos de selo se misturavam aqui e passaram a ter visuais distintos:
 *
 * - **configuração** (`tone="config"`) — parc, folha, SERPRO, A1. São atributos da empresa, não
 *   eventos do mês. Fundo neutro e texto secundário: informam sem competir.
 * - **categoria** (`tone="categoria"`) — o regime. Ganha cor de ACENTO (nunca de estado), porque
 *   agrupar Simples × Presumido de relance é útil e não tem nada a ver com urgência.
 *
 * A cor de ESTADO (vermelho/âmbar/verde) fica reservada para o que precisa de ação. Era isso que
 * estava embaralhado: com quase tudo colorido, nada se destacava.
 */
function Pill({ color, tone = "config", title, children }) {
  const estilo = tone === "categoria"
    ? { border: `1px solid ${color}`, color }
    : { border: "1px solid transparent", background: "var(--state-neutral-surface)", color: color || "var(--text-muted)" };
  return (
    <span
      style={{ fontSize: "0.7rem", fontWeight: 700, padding: "1px 8px", borderRadius: 999, ...estilo }}
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
    label: `${SITUACAO_FISCAL_SIMBOLO.COM_PENDENCIA} Pendência`, color: "var(--state-danger)",
    title: "Situação fiscal: empresa COM PENDÊNCIA (SITFIS)",
  },
};

export function CompanyCard({ company, onAccess, acoesGuia }) {
  const tags = getComplianceTags(company.guideCompliance);
  // Condensa só quando TODAS estão em estado terminal (enviada ou sem movimento).
  const concluidas = todasConcluidas(tags);
  const serproEligible = Boolean(company?.serproStatus?.eligible);
  // Q52: selo de certificado A1 da empresa — verde (ativo), vermelho (vencido), apagado (sem cert).
  // certExpiresAt null com cert presente conta como ativo (upload legado sem validade extraída).
  const legacy = company?.legacyCompany || null;
  // A leitura do certificado é UMA só (card, tabela e filtro) — antes eram três, e a do filtro
  // olhava só a presença, deixando empresa com A1 VENCIDO passar por "com certificado".
  const cert = estadoCertificado(company);
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
    ? { background: "var(--state-closed-surface)", borderColor: "var(--state-closed)" }
    : undefined;
  const fechadaTitle = fechada
    ? `Empresa fechada${company.fechamentoContabil?.fechadoEm ? ` em ${new Date(company.fechamentoContabil.fechadoEm).toLocaleDateString("pt-BR")}` : ""}`
    : undefined;
  // Regime tributário — tag Simples/Presumido/Real (vem do cadastro legado).
  const regime = legacy?.regimeTributario || null;
  const regimeLabel = rotuloRegime(regime) || null;
  const regimeColor = regime === "SIMPLES" ? "var(--accent-cyan)"
    : regime === "LUCRO_PRESUMIDO" ? "var(--accent-orange)"
    : regime === "LUCRO_REAL" ? "var(--accent-purple)" : "var(--text-faint)";
  // Empresa zerada (sem movimento) — só enviamos obrigações zeradas; não há guias/impostos.
  // Mesma função da tabela: a regra vivia só aqui e a tabela mostrava chips na mesma empresa.
  const zerada = empresaSemObrigacoes(company);
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
        <p style={{ color: "var(--text)" }}>CNPJ: {company.cnpj}</p>
        {/* C6: identidade da empresa — regime, SERPRO e A1 juntos e no MESMO design (pílula). */}
        <p style={{ margin: "4px 0 0", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {regimeLabel && (
            <Pill tone="categoria" color={regimeColor} title={`Regime tributário: ${regimeLabel}`}>{regimeLabel}</Pill>
          )}
          {/* SELO SÓ PARA EXCEÇÃO. Antes "SERPRO" e "A1" apareciam em TODAS as empresas — e selo
              que nunca varia não informa nada: ocupa espaço e não distingue ninguém. O estado
              esperado (apta ao SERPRO, certificado válido) é silêncio; quem precisa gritar é o
              que está faltando ou vencendo. */}
          {/* Parcelamento fica JUNTO da tributação: é característica da empresa, não do mês. */}
          {emParcelamento && (
            <Pill title="Empresa com parcelamento — há parcelas a acompanhar">parc</Pill>
          )}
          {/* Folha entra aqui pelo mesmo motivo do parc: é característica da empresa, não evento
              do mês. Não contraria a regra do "selo só para exceção" logo abaixo — aquela vale
              para ESTADO (SERPRO apto, A1 válido), onde o normal é silêncio. Aqui o campo varia
              entre empresas e é o que diz quais obrigações trabalhistas fazem sentido. */}
          {temFolha && (
            <Pill title="Empresa com folha de pagamento (empregado registrado)">folha</Pill>
          )}
          {/* Presente = silêncio; faltando = a própria palavra. Estes dois pedem ação (sem A1 não
              se captura NFS-e; sem procuração não se busca no SERPRO), mas NÃO bloqueiam o
              fechamento — por isso âmbar, não vermelho. O vermelho fica para quem trava o mês. */}
          {!serproEligible && (
            <Pill color="var(--state-warn)" title="Empresa NÃO apta ao fluxo SERPRO — confira procuração e certificado">
              ⚠ SERPRO
            </Pill>
          )}
          {/* Cinza, não âmbar: âmbar é ação rápida disponível e vermelho é o que trava o
              fechamento. Certificado faltando não é nem um nem outro — é configuração. Estava em
              âmbar, e com isso a mesma empresa contava histórias diferentes no card e na tabela. */}
          {!cert.ativo && (
            <Pill color={cert.cor} title={cert.titulo}>{cert.rotulo}</Pill>
          )}
          {/* Zerada é informativo, não exige ação: neutro, com ícone próprio. */}
          {zerada && (
            <Pill title="Empresa zerada (sem movimento) — só enviamos obrigações zeradas">
              🚫 Zerada
            </Pill>
          )}
        </p>
      </div>
      <p className="company-serpro-status" aria-label="Apuração e situação fiscal">
        {/* Q52: selo de empresa apurada (apuração transmitida/confirmada na competência). */}
        {/* Mesma regra: apuração transmitida é o esperado. O que merece destaque é a que AINDA
            NÃO foi — é ela que tem trabalho pendente. */}
        {/* ⚠ CINZA, não âmbar. No começo do mês 29 de 30 empresas estão "falta apurar" — é o
            estado PADRÃO, não a exceção. Em âmbar, a tela inteira alertava e nada se destacava.
            Cor forte fica para o que precisa de ação agora. */}
        {!apurada && (
          <span
            style={{ fontSize: "0.82rem", fontWeight: 700, padding: "2px 6px", color: "var(--state-neutral)" }}
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
          style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}
          title={`${notas.quantidade || 0} nota(s) emitida(s) autorizada(s) na competência ${notas.competencia || ""}`}
        >
          Notas emitidas: <strong style={{ color: notasTotal > 0 ? "var(--text)" : "var(--text-faint)" }}>
            R$ {notasTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
        </p>
      )}
      {/* `div`, não `p`: o chip abre um popover `<div>`, e `<div>` dentro de `<p>` é HTML inválido —
          o browser fecha o parágrafo sozinho e o React reclama de nesting a cada render. */}
      <div className="compliance-tags" aria-label="Status de guias obrigatórias">
        {zerada ? (
          /* Mesma TAG da tabela, não a frase inteira: card e tabela contando a mesma história com
             o mesmo tamanho. A explicação vive no `title`, que é onde ela é procurada. */
          <span
            title={TITULO_ZERADA}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
              fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
              background: "var(--state-neutral-surface)", border: "1px solid var(--state-neutral)",
              color: "var(--state-neutral)",
            }}
          >
            <span aria-hidden="true">◌</span>Zerada
          </span>
        ) : concluidas ? (
          /* ⚠ "Guias CONCLUÍDAS", não "enviadas": estado terminal inclui a guia enviada E a
             marcada sem movimento. Condensar só é seguro quando não há mais nada a fazer — antes
             disso, esconder detalhe é esconder trabalho. Guia nova/recalculada volta a PENDING no
             backend, o estado deixa de ser terminal e os chips reaparecem. */
          <span
            style={{ fontSize: "0.85rem", fontWeight: 700, padding: "2px 6px", color: "var(--state-ok)" }}
            title={tags.map((t) => `${t.label}: ${t.state === "vazio" ? "sem movimento" : "enviada"}`).join(" · ")}
          >
            ✓ Guias concluídas
          </span>
        ) : (
        <>
        {tags.map((tag) => (
          <GuiaChip
            key={tag.label}
            tag={tag}
            empresa={company}
            competencia={company?.guideCompliance?.competencia || ""}
            acoes={acoesGuia || {}}
          />
        ))}
        {/* O selo PARC que ficava aqui subiu para junto da tributação — parcelamento é
            característica da empresa, não obrigação daquele mês. O chip "Parcelamento" segue nesta
            linha: esse sim é a PARCELA da competência, com o mesmo ciclo de vida das outras guias. */}
        {!tags.length && !temParcelamento ? (
          <span style={{ fontSize: "0.72rem", padding: "2px 6px", color: "var(--text-muted)" }}>
            Sem obrigações
          </span>
        ) : null}
        </>
        )}
      </div>
      <Button type="button" className="company-tile__action" onClick={() => onAccess(company.companyId)}>
        Acessar
      </Button>
    </article>
  );
}
