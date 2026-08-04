// A carteira em TABELA — a visão padrão no desktop.
//
// POR QUE ELA EXISTE
// O trabalho do contador aqui é varredura e comparação ("quais faltam? quais têm pendência?"), mas
// o card fragmenta a informação e mostra 8 empresas por tela. Em tabela cabem 15+ em 1080p, e as
// colunas alinhadas deixam comparar de relance — que é o gesto real.
//
// Padrão herdado do `renderAnnualGrid` (mesma feature): tabela HTML pura, primeira coluna STICKY
// (o nome da empresa não pode sumir no scroll horizontal) e razão + CNPJ empilhados.
//
// Os cards continuam existindo e são o padrão no celular — a grade de 6 colunas não sobrevive a
// 375px de largura.

import { useMemo, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { getComplianceTags } from "./renderCompanyCard";
import { GuiaChip, todasConcluidas } from "./renderGuiaChip";
import { estadoDominante, pesoUrgencia } from "../lib/estadoDominante";
import { rotuloRegime } from "../../../../lib/vocabulario";

const CELULA = { padding: "8px 10px", borderTop: "1px solid var(--border)", verticalAlign: "middle" };
const CABECALHO = {
  padding: "8px 10px", textAlign: "left", fontSize: "0.68rem", fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)",
  background: "var(--bg-subtle)", position: "sticky", top: 0, zIndex: 2, whiteSpace: "nowrap",
};

const fmtMoeda = (v) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function corRegime(regime) {
  if (regime === "SIMPLES") return "var(--accent-cyan)";
  if (regime === "LUCRO_PRESUMIDO") return "var(--accent-orange)";
  if (regime === "LUCRO_REAL") return "var(--accent-purple)";
  return "var(--text-faint)";
}

/** Configuração da empresa (A1, SERPRO, parc, folha) — sai da linha para não competir com estado. */
function PopoverConfig({ company, onFechar }) {
  const ref = useRef(null);
  const legacy = company?.legacyCompany || null;
  const temCert = Boolean(legacy?.certStorageKey);
  const certExpira = legacy?.certExpiresAt ? new Date(legacy.certExpiresAt) : null;
  const certVencido = temCert && certExpira && certExpira.getTime() < Date.now();
  const linhas = [
    ["Certificado A1", !temCert ? "não cadastrado" : certVencido ? `vencido em ${certExpira.toLocaleDateString("pt-BR")}` : "ativo"],
    ["SERPRO", company?.serproStatus?.eligible ? "apta" : "não apta — confira procuração e certificado"],
    ["Folha", company?.temFolha ? "tem empregado registrado" : "sem folha"],
    ["Parcelamento", (company?.temParcelamento || company?.fiscalSituacao === "EM_PARCELAMENTO") ? "ativo" : "não"],
    ["E-mail do cliente", company?.guideNotificationEmail || company?.ownerEmail || "—"],
  ];
  return (
    <div
      ref={ref}
      role="dialog"
      onClick={(e) => e.stopPropagation()}
      onMouseLeave={onFechar}
      style={{
        position: "absolute", top: "100%", left: 0, zIndex: 300, minWidth: 280,
        background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10,
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)", padding: 10, fontSize: "0.76rem",
        fontWeight: 400, whiteSpace: "normal",
      }}
    >
      {linhas.map(([rotulo, valor]) => (
        <div key={rotulo} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
          <span style={{ color: "var(--text-muted)", flex: "0 0 46%" }}>{rotulo}</span>
          <span style={{ color: "var(--text)" }}>{valor}</span>
        </div>
      ))}
    </div>
  );
}

function Linha({ company, trava, competencia, onOpenCompany, acoesGuia, busca }) {
  const [config, setConfig] = useState(false);
  const estado = estadoDominante(company, trava);
  const fechada = estado.chave === "fechada";
  const tags = getComplianceTags(company.guideCompliance);
  const concluidas = todasConcluidas(tags);
  const regime = company?.legacyCompany?.regimeTributario || null;
  const notasTotal = Number(company?.notasEmitidas?.total || 0);

  // Destaque do trecho buscado: com 30 empresas de nome parecido, achar a certa no meio da lista é
  // metade do trabalho.
  const nome = company.razao || "—";
  const alvo = String(busca || "").trim();
  let nomeRender = nome;
  if (alvo) {
    const i = nome.toLowerCase().indexOf(alvo.toLowerCase());
    if (i >= 0) {
      nomeRender = (
        <>
          {nome.slice(0, i)}
          <mark style={{ background: "var(--state-warn-surface)", color: "var(--state-warn)", padding: 0 }}>
            {nome.slice(i, i + alvo.length)}
          </mark>
          {nome.slice(i + alvo.length)}
        </>
      );
    }
  }

  return (
    <tr
      tabIndex={0}
      data-linha-empresa={company.companyId}
      onClick={() => onOpenCompany?.(company.companyId)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onOpenCompany?.(company.companyId); }
      }}
      style={{ cursor: "pointer", opacity: fechada ? 0.55 : 1, outlineOffset: -2 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <td style={{ ...CELULA, position: "relative" }}>
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); setConfig((v) => !v); }}
          title="Ver certificado, SERPRO, folha e e-mail"
          style={{ display: "block", fontSize: "0.86rem", fontWeight: 600, color: "var(--text)", lineHeight: 1.25 }}
        >
          {nomeRender}
        </span>
        <span style={{ display: "block", fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          {company.cnpj || "—"}
        </span>
        {config && <PopoverConfig company={company} onFechar={() => setConfig(false)} />}
      </td>

      <td style={CELULA}>
        {regime && (
          <span style={{
            fontSize: "0.7rem", fontWeight: 700, padding: "1px 8px", borderRadius: 999,
            border: `1px solid ${corRegime(regime)}`, color: corRegime(regime), whiteSpace: "nowrap",
          }}>
            {rotuloRegime(regime)}
          </span>
        )}
      </td>

      <td style={CELULA}>
        <span
          title={estado.rotulo}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
            fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
            background: estado.fundo, border: `1px solid ${estado.cor}`, color: estado.cor,
          }}
        >
          <span aria-hidden="true">{estado.icone}</span>{estado.rotulo}
        </span>
      </td>

      <td style={{ ...CELULA }} onClick={(e) => e.stopPropagation()}>
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {concluidas ? (
            <span
              style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--state-ok)" }}
              title={tags.map((t) => `${t.label}: ${t.state === "vazio" ? "sem movimento" : "enviada"}`).join(" · ")}
            >
              ✓ Guias concluídas
            </span>
          ) : tags.length ? tags.map((tag) => (
            tag.accent ? (
              <span key={tag.label} style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--state-warn)" }} title={`${tag.label} — parcelamento ativo`}>
                {tag.label}
              </span>
            ) : (
              <GuiaChip key={tag.label} tag={tag} empresa={company} competencia={competencia} acoes={acoesGuia || {}} />
            )
          )) : (
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>—</span>
          )}
        </span>
      </td>

      <td style={{ ...CELULA, textAlign: "right", fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.78rem", color: notasTotal > 0 ? "var(--text)" : "var(--text-muted)" }}>
        {fmtMoeda(notasTotal)}
      </td>

      <td style={{ ...CELULA, textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
        <Button type="button" onClick={() => onOpenCompany?.(company.companyId)} style={{ minHeight: 28, padding: "4px 12px", fontSize: "0.78rem" }}>
          Acessar
        </Button>
      </td>
    </tr>
  );
}

export function CompaniesTable({ companies, travas, competencia, onOpenCompany, acoesGuia, busca }) {
  const [ordem, setOrdem] = useState({ campo: "urgencia", asc: true });
  const [mostrarFechadas, setMostrarFechadas] = useState(false);
  const corpoRef = useRef(null);

  const { abertas, fechadas } = useMemo(() => {
    const trava = (c) => travas?.get?.(c.companyId);
    const ordenar = (lista) => {
      const copia = [...lista];
      const dir = ordem.asc ? 1 : -1;
      copia.sort((a, b) => {
        if (ordem.campo === "empresa") return dir * String(a.razao || "").localeCompare(String(b.razao || ""));
        if (ordem.campo === "notas") return dir * (Number(a.notasEmitidas?.total || 0) - Number(b.notasEmitidas?.total || 0));
        if (ordem.campo === "status") return dir * (pesoUrgencia(a, trava(a)) - pesoUrgencia(b, trava(b)));
        // Padrão: urgência, com desempate alfabético — sem ele a ordem "dança" entre recargas.
        const p = pesoUrgencia(a, trava(a)) - pesoUrgencia(b, trava(b));
        return p !== 0 ? p : String(a.razao || "").localeCompare(String(b.razao || ""));
      });
      return copia;
    };
    const ehFechada = (c) => estadoDominante(c, trava(c)).chave === "fechada";
    return {
      abertas: ordenar((companies || []).filter((c) => !ehFechada(c))),
      fechadas: ordenar((companies || []).filter(ehFechada)),
    };
  }, [companies, travas, ordem]);

  function alternarOrdem(campo) {
    setOrdem((o) => (o.campo === campo ? { campo, asc: !o.asc } : { campo, asc: true }));
  }

  // Setas movem entre linhas. É o gesto natural numa lista densa — sem isso, navegar por teclado
  // exigiria Tab por todos os chips de cada linha antes de chegar na próxima.
  function aoTeclar(e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const linhas = [...(corpoRef.current?.querySelectorAll("tr[data-linha-empresa]") || [])];
    const atual = linhas.indexOf(document.activeElement.closest?.("tr") || document.activeElement);
    if (atual < 0) return;
    e.preventDefault();
    const proxima = linhas[atual + (e.key === "ArrowDown" ? 1 : -1)];
    proxima?.focus();
  }

  const Cabecalho = ({ campo, children, alinhar }) => (
    <th scope="col" style={{ ...CABECALHO, textAlign: alinhar || "left" }}>
      {campo ? (
        <button
          type="button"
          onClick={() => alternarOrdem(campo)}
          style={{ background: "none", border: "none", color: "inherit", font: "inherit", cursor: "pointer", padding: 0, textTransform: "inherit", letterSpacing: "inherit" }}
        >
          {children}{ordem.campo === campo ? (ordem.asc ? " ▲" : " ▼") : ""}
        </button>
      ) : children}
    </th>
  );

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "auto", maxHeight: "calc(100vh - 320px)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }} onKeyDown={aoTeclar}>
        <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          Empresas da carteira na competência {competencia}, com estado do fechamento e guias do mês.
        </caption>
        <thead>
          <tr>
            <Cabecalho campo="empresa">Empresa</Cabecalho>
            <Cabecalho>Regime</Cabecalho>
            <Cabecalho campo="status">Status</Cabecalho>
            <Cabecalho>Guias</Cabecalho>
            <Cabecalho campo="notas" alinhar="right">Notas</Cabecalho>
            <Cabecalho alinhar="right">Ação</Cabecalho>
          </tr>
        </thead>
        <tbody ref={corpoRef}>
          {abertas.map((c) => (
            <Linha
              key={c.companyId} company={c} trava={travas?.get?.(c.companyId)}
              competencia={competencia} onOpenCompany={onOpenCompany} acoesGuia={acoesGuia} busca={busca}
            />
          ))}

          {/* Fechadas ficam no fim, COLAPSADAS: estão fora do fluxo de trabalho, e no meio da lista
              só empurram para baixo o que ainda precisa de atenção. */}
          {fechadas.length > 0 && (
            <tr>
              <td colSpan={6} style={{ ...CELULA, padding: 0 }}>
                <button
                  type="button"
                  onClick={() => setMostrarFechadas((v) => !v)}
                  aria-expanded={mostrarFechadas}
                  style={{
                    width: "100%", textAlign: "left", padding: "8px 10px", background: "var(--bg-subtle)",
                    border: "none", color: "var(--state-closed)", font: "inherit", fontSize: "0.76rem",
                    fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {mostrarFechadas ? "▾" : "▸"} Fechadas ({fechadas.length})
                </button>
              </td>
            </tr>
          )}
          {mostrarFechadas && fechadas.map((c) => (
            <Linha
              key={c.companyId} company={c} trava={travas?.get?.(c.companyId)}
              competencia={competencia} onOpenCompany={onOpenCompany} acoesGuia={acoesGuia} busca={busca}
            />
          ))}

          {!abertas.length && !fechadas.length && (
            <tr>
              <td colSpan={6} style={{ ...CELULA, color: "var(--text-muted)", textAlign: "center", padding: 24 }}>
                Nenhuma empresa encontrada para os filtros atuais.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
