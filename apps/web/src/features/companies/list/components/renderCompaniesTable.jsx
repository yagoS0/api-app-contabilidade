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
import { GuiaChip, Popover, todasConcluidas, todasPorGerar, ehParcela } from "./renderGuiaChip";
import { empresaSemObrigacoes, TITULO_ZERADA } from "../lib/estadoDominante";
import { estadoApuracao, detalheApuracao } from "../lib/estadoApuracao";
import { situacaoFiscalDaLinha } from "../lib/situacaoFiscal";
import { rotuloRegime } from "../../../../lib/vocabulario";
import { estadoCertificado } from "../lib/certificado";

// TRÊS PERGUNTAS, TRÊS COLUNAS — e a leitura esquerda→direita é o próprio fluxo de trabalho:
//   Apuração ......... como está o mês?          (trabalho nosso)
//   Situação fiscal .. como está com o fisco?    (dívida do cliente)
//   Guias ............ o que falta entregar?     (o que sai para o cliente)
//
// ⚠ Cada célula tem NO MÁXIMO UM CHIP. A versão anterior empilhava duas linhas de status na mesma
// célula e produzia combinações que não queriam dizer nada — "Falta apurar" com "Sem pendência" em
// verde logo abaixo, misturando andamento do mês com relação com a Receita.

/**
 * O quanto as GUIAS de uma empresa pedem atenção. Mesma escala das outras colunas.
 *
 * 0 = falta gerar (ou conflito) · 1 = gerada, falta enviar · 2 = tudo terminal · 3 = nada a entregar.
 *
 * ⚠ Empresa zerada não tem guia a entregar — as tags "faltando" dela são artefato, não trabalho.
 * Sem esta guarda ela subia ao topo como se tivesse guia atrasada.
 */
function severidadeGuias(company) {
  if (empresaSemObrigacoes(company)) return 3;
  const tags = getComplianceTags(company.guideCompliance);
  if (!tags.length) return 3;
  if (tags.some((t) => t.state === "missing" || t.state === "conflito")) return 0;
  if (tags.some((t) => t.state === "gerada")) return 1;
  return 2;
}

/**
 * A severidade da LINHA = a pior das três colunas. É ela que ordena por padrão.
 * 0 = danger · 1 = warning · 2 = neutro · 3 = fechada (sempre por último, fora do fluxo).
 */
function severidadeDaLinha(company, trava) {
  const ap = estadoApuracao(company, trava);
  if (ap.chave === "fechada") return 3;
  return Math.min(ap.severidade, situacaoFiscalDaLinha(company).estado.severidade, severidadeGuias(company));
}

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
  const cert = estadoCertificado(company);
  const linhas = [
    ["Certificado A1", cert.chave === "ausente"
      ? "não cadastrado"
      : cert.chave === "vencido"
        ? `vencido em ${cert.expiraEm.toLocaleDateString("pt-BR")}`
        : cert.expiraEm ? `ativo até ${cert.expiraEm.toLocaleDateString("pt-BR")}` : "ativo"],
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

/**
 * O chip agregado das guias por gerar — clicável, com a lista de QUAIS faltam.
 *
 * ⚠ Condensar quatro chips num só resolve o muro vermelho, mas cobra um preço: o detalhe some. O
 * `title` do HTML não paga essa conta — ele não é descobrível (ninguém sabe que há algo ali), some
 * ao mover o mouse e não existe no toque. Por isso o agregado abre o MESMO popover dos outros
 * chips: a informação continua a um clique, e o gesto é o que o contador já aprendeu no chip de
 * parcelamento.
 */
function ChipGuiasFaltando({ tributos, empresa, competencia, acoes }) {
  const [aberto, setAberto] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label={`${tributos.length} guias por gerar: ${tributos.map((t) => t.label).join(", ")}`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
          fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
          background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)",
          color: "var(--state-danger)", cursor: "pointer", font: "inherit", lineHeight: 1.6,
        }}
      >
        <span aria-hidden="true">⚠</span>{tributos.length} guias
      </button>

      {aberto && (
        <Popover onFechar={() => setAberto(false)}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>
            {tributos.length} guias por gerar · {competencia}
          </div>
          <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>
            Todas dependem da mesma coisa: apurar o mês.
          </div>
          <ul style={{ margin: "0 0 10px", padding: 0, listStyle: "none", display: "grid", gap: 3 }}>
            {tributos.map((t) => (
              <li key={t.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ color: "var(--state-danger)" }}>⚠</span>
                <span style={{ color: "var(--text)" }}>{t.label}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => acoes.onAbrirEmpresa?.(empresa.companyId)}
            style={{
              padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: "transparent",
              border: "1px solid var(--border)", color: "var(--text)", font: "inherit",
              fontSize: "0.76rem", fontWeight: 600,
            }}
          >
            Abrir apuração
          </button>
        </Popover>
      )}
    </span>
  );
}

function Linha({ company, trava, competencia, onOpenCompany, acoesGuia, busca }) {
  const [config, setConfig] = useState(false);
  const [consultando, setConsultando] = useState(false);
  const apuracao = estadoApuracao(company, trava);
  const fechada = apuracao.chave === "fechada";
  const tags = getComplianceTags(company.guideCompliance);
  const concluidas = todasConcluidas(tags);
  const agregarGuias = todasPorGerar(tags);
  const zerada = empresaSemObrigacoes(company);
  const fiscal = situacaoFiscalDaLinha(company);
  const cert = estadoCertificado(company);
  const regime = company?.legacyCompany?.regimeTributario || null;
  const notasTotal = Number(company?.notasEmitidas?.total || 0);

  // ⚠ A consulta SITFIS é PAGA, tem trava de 4h por empresa, e o limite do `/Apoiar` é por
  // CONTRATANTE — ou seja, por escritório inteiro. Numa lista de trinta linhas, cliques distraídos
  // viram fatura E podem travar a consulta de todas as outras. Por isso o clique confirma primeiro,
  // dizendo o custo, em vez de disparar direto.
  async function consultarFiscal() {
    if (consultando) return;
    const ok = window.confirm(
      `Consultar a situação fiscal de ${company.razao}?\n\n`
      + "É uma consulta paga ao SERPRO, limitada a 1 por empresa a cada 4 horas.",
    );
    if (!ok) return;
    setConsultando(true);
    try { await acoesGuia?.onConsultarFiscal?.(company.companyId); } finally { setConsultando(false); }
  }

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
    /* ⚠ A LINHA NÃO NAVEGA. Clicar em qualquer ponto abria a empresa, e com chips, popovers e
       botão de enviar e-mail na mesma linha isso virava navegação por acidente. Só o botão
       "Acessar" abre — no mouse e no teclado. As setas ↑↓ continuam movendo o foco entre linhas,
       porque isso é leitura, não ação. */
    <tr
      tabIndex={0}
      data-linha-empresa={company.companyId}
      style={{ opacity: fechada ? 0.55 : 1, outlineOffset: -2 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <td style={{ ...CELULA, position: "relative" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            role="button"
            tabIndex={-1}
            onClick={() => setConfig((v) => !v)}
            title="Ver certificado, SERPRO, folha e e-mail"
            style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text)", lineHeight: 1.25, cursor: "pointer" }}
          >
            {nomeRender}
          </span>
          {/* ⚠ A TAG DE CERTIFICADO FICA NA LINHA, por decisão do dono — o plano v2 mandava tudo
              que é configuração para o popover, e sem A1 não se captura NFS-e: é a única
              configuração que faz a empresa parar de receber nota sem avisar.
              Presente = silêncio: selo que aparece em toda linha não distingue ninguém.
              Cinza, não âmbar: falta certificado não trava o fechamento do mês. */}
          {!cert.ativo && (
            <span
              title={cert.titulo}
              style={{
                fontSize: "0.64rem", fontWeight: 700, padding: "0 6px", borderRadius: 999,
                background: "var(--state-neutral-surface)", color: cert.cor, whiteSpace: "nowrap",
              }}
            >
              {cert.rotulo}
            </span>
          )}
        </span>
        {/* ⚠ REGIME DEIXOU DE SER COLUNA. Ele é atributo de leitura ocasional ("esta é do
            Presumido?"), não indicador de trabalho — e uma coluna inteira para ele roubava largura
            das três que respondem o que fazer hoje. Aqui, junto do CNPJ, continua a um olhar.
            O selo A1 também saiu daqui: configuração vive no popover do nome, e nada mais. */}
        <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {regime && <span style={{ color: corRegime(regime) }}>{rotuloRegime(regime)}</span>}
          {regime && " · "}
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{company.cnpj || "—"}</span>
        </span>
        {config && <PopoverConfig company={company} onFechar={() => setConfig(false)} />}
      </td>

      {/* APURAÇÃO — o pipeline do mês. Um chip, quatro estados possíveis, nada empilhado. */}
      <td style={CELULA}>
        <span
          title={detalheApuracao(apuracao, trava)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
            fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
            background: apuracao.fundo, border: `1px solid ${apuracao.cor}`, color: apuracao.cor,
          }}
        >
          <span aria-hidden="true">{apuracao.icone}</span>{apuracao.rotulo}
        </span>
      </td>

      {/* SITUAÇÃO FISCAL — a relação com a Receita. Estado bom não ganha pill: não grita. */}
      <td style={CELULA}>
        {fiscal.precisaConsultar ? (
          <button
            type="button"
            onClick={consultarFiscal}
            disabled={consultando}
            title={`${fiscal.titulo} — clique para consultar no SERPRO`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
              fontSize: "0.72rem", fontWeight: 600, padding: "2px 8px", borderRadius: 999,
              background: "transparent", border: "1px dashed var(--border)", color: "var(--text-faint)",
              cursor: consultando ? "wait" : "pointer", font: "inherit",
            }}
          >
            {consultando ? "consultando…" : <><span aria-hidden="true">{fiscal.estado.icone}</span>{fiscal.rotulo}</>}
          </button>
        ) : (
          <span
            title={fiscal.titulo}
            style={fiscal.estado.pill
              ? {
                display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
                fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                background: fiscal.estado.fundo, border: `1px solid ${fiscal.estado.cor}`, color: fiscal.estado.cor,
              }
              : { display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", fontSize: "0.72rem", color: fiscal.estado.cor }}
          >
            <span aria-hidden="true">{fiscal.estado.icone}</span>{fiscal.rotulo}
          </span>
        )}
      </td>

      <td style={{ ...CELULA }}>
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {zerada ? (
            /* Empresa zerada não tem guia. Dizer isso é diferente de não mostrar nada — coluna
               vazia significaria "não sabemos", e aqui sabemos. Mas basta a TAG: a frase inteira
               ocupava a coluna toda e desalinhava a leitura das outras linhas. A explicação fica no
               title, que é onde ela é procurada. */
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
            <span
              style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--state-ok)" }}
              title={tags.map((t) => `${t.label}: ${t.state === "vazio" ? "sem movimento" : "enviada"}`).join(" · ")}
            >
              ✓ Guias concluídas
            </span>
          ) : agregarGuias ? (
            /* ⚠ UM chip no lugar de quatro vermelhos. No Lucro Presumido são IRPJ + CSLL +
               PIS/COFINS + ISS, e no começo do mês os quatro dizem a mesma coisa e pedem a mesma
               ação. Quatro repetições da mesma informação em toda linha recriavam o muro vermelho
               que este redesign existe para derrubar. Assim que os estados divergirem, os chips
               voltam sozinhos — porque aí o detalhe passa a informar. */
            <>
              <ChipGuiasFaltando
                tributos={tags.filter((t) => !ehParcela(t))}
                empresa={company}
                competencia={competencia}
                acoes={acoesGuia || {}}
              />
              {/* A parcela nunca entra no agregado: ela não vem de apurar, vem de capturar o
                  parcelamento. Somá-la ali mandaria o contador para a ação errada. */}
              {tags.filter(ehParcela).map((tag) => (
                <GuiaChip key={tag.label} tag={tag} empresa={company} competencia={competencia} acoes={acoesGuia || {}} />
              ))}
            </>
          ) : tags.length ? tags.map((tag) => (
            <GuiaChip key={tag.label} tag={tag} empresa={company} competencia={competencia} acoes={acoesGuia || {}} />
          )) : (
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>—</span>
          )}
        </span>
      </td>

      <td style={{ ...CELULA, textAlign: "right", fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.78rem", color: notasTotal > 0 ? "var(--text)" : "var(--text-muted)" }}>
        {fmtMoeda(notasTotal)}
      </td>

      <td data-coluna-acao style={{ ...CELULA, textAlign: "right" }}>
        <Button type="button" onClick={() => onOpenCompany?.(company.companyId)} style={{ minHeight: 28, padding: "4px 12px", fontSize: "0.78rem" }}>
          Acessar
        </Button>
      </td>
    </tr>
  );
}

export function CompaniesTable({ companies, travas, competencia, onOpenCompany, acoesGuia, busca, imprimindo }) {
  const [ordem, setOrdem] = useState({ campo: "urgencia", asc: true });
  const [mostrarFechadas, setMostrarFechadas] = useState(false);
  const corpoRef = useRef(null);

  // ⚠ NA IMPRESSÃO AS FECHADAS SAEM SEMPRE. Elas ficam colapsadas na tela de propósito (estão fora
  // do fluxo de trabalho), mas imprimir assim entregaria uma lista INCOMPLETA sem avisar ninguém —
  // e uma folha que omite empresas em silêncio é pior que folha nenhuma.
  const fechadasVisiveis = mostrarFechadas || Boolean(imprimindo);

  const { abertas, fechadas } = useMemo(() => {
    const trava = (c) => travas?.get?.(c.companyId);
    const ordenar = (lista) => {
      const copia = [...lista];
      const dir = ordem.asc ? 1 : -1;
      copia.sort((a, b) => {
        if (ordem.campo === "empresa") return dir * String(a.razao || "").localeCompare(String(b.razao || ""));
        if (ordem.campo === "notas") return dir * (Number(a.notasEmitidas?.total || 0) - Number(b.notasEmitidas?.total || 0));
        // Cada coluna de indicador ordena pela SUA severidade — e o segundo clique inverte, que é
        // como se pede a pergunta oposta: "quais guias faltam?" no primeiro, "quais já estão
        // completas?" no segundo. Desempate alfabético em todas, senão empresas de mesmo estado
        // trocam de lugar a cada recarga.
        if (ordem.campo === "apuracao") {
          const p = estadoApuracao(a, trava(a)).severidade - estadoApuracao(b, trava(b)).severidade;
          return p !== 0 ? dir * p : String(a.razao || "").localeCompare(String(b.razao || ""));
        }
        if (ordem.campo === "fiscal") {
          const p = situacaoFiscalDaLinha(a).estado.severidade - situacaoFiscalDaLinha(b).estado.severidade;
          return p !== 0 ? dir * p : String(a.razao || "").localeCompare(String(b.razao || ""));
        }
        if (ordem.campo === "guias") {
          const p = severidadeGuias(a) - severidadeGuias(b);
          return p !== 0 ? dir * p : String(a.razao || "").localeCompare(String(b.razao || ""));
        }
        // ⚠ Padrão: o PIOR estado entre as TRÊS colunas de indicadores, não só o da apuração. Uma
        // empresa apurada e fechada no prazo, mas com pendência na Receita, precisa subir — ordenar
        // só pelo mês a esconderia no meio da lista. Desempate alfabético para a ordem não "dançar"
        // entre recargas.
        const p = severidadeDaLinha(a, trava(a)) - severidadeDaLinha(b, trava(b));
        return p !== 0 ? p : String(a.razao || "").localeCompare(String(b.razao || ""));
      });
      return copia;
    };
    const ehFechada = (c) => estadoApuracao(c, trava(c)).chave === "fechada";
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

  const Cabecalho = ({ campo, children, alinhar, largura }) => (
    <th scope="col" style={{ ...CABECALHO, textAlign: alinhar || "left", width: largura }}>
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
    <div data-print-tabela style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "auto", maxHeight: "calc(100vh - 320px)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }} onKeyDown={aoTeclar}>
        <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          Empresas da carteira na competência {competencia}, com estado do fechamento e guias do mês.
        </caption>
        <thead>
          <tr>
            <Cabecalho campo="empresa" largura="26%">Empresa</Cabecalho>
            <Cabecalho campo="apuracao" largura="16%">Apuração</Cabecalho>
            <Cabecalho campo="fiscal" largura="18%">Situação fiscal</Cabecalho>
            <Cabecalho campo="guias" largura="22%">Guias</Cabecalho>
            <Cabecalho campo="notas" alinhar="right" largura="10%">Notas</Cabecalho>
            <th scope="col" data-coluna-acao style={{ ...CABECALHO, textAlign: "right" }}>Ação</th>
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
                  aria-expanded={fechadasVisiveis}
                  style={{
                    width: "100%", textAlign: "left", padding: "8px 10px", background: "var(--bg-subtle)",
                    border: "none", color: "var(--state-closed)", font: "inherit", fontSize: "0.76rem",
                    fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {fechadasVisiveis ? "▾" : "▸"} Fechadas ({fechadas.length})
                </button>
              </td>
            </tr>
          )}
          {fechadasVisiveis && fechadas.map((c) => (
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
