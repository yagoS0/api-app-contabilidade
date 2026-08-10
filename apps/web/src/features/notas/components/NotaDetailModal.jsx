// A ÍNTEGRA DE UMA NOTA — abre ao clicar na linha da tabela.
//
// A aba continua ENXUTA (2 janelas, sem stats/legendas/rodapé): o pedido era profundidade ao
// clicar, não poluição na lista. Tudo o que não cabe numa linha mora aqui.
//
// ⚠ REGRA DURA — AUSÊNCIA NUNCA É RESPOSTA. Campo que não temos aparece como "não temos", em itálico
// e na tinta mais apagada (`--text-faint`), NUNCA como um traço no lugar de um valor, e nunca some
// da tela. As duas coisas que a base real obriga a distinguir, medidas em 10/08/2026:
//   • 29 de 29 NF-e SEM `xmlRaw`, SEM `tomadorNome`/`tomadorDoc` e SEM nenhum item;
//   • 16.128 de 16.128 NFS-e COM `xmlRaw` (4,4–11,4 KB) e com item descrito.
// Se as duas parecessem iguais na tela, o contador não saberia se a NF-e está incompleta na origem
// ou se o app deixou de mostrar.
//
// Estilo reusado, não inventado: mesma casca de modal do `ProcuracaoCreateModal` (overlay fixo,
// `PANEL` de `notasStyles`, `Button` de `components/ui`). Cores só por `var(--…)`.

import { useState } from "react";
import { PANEL, fmtMoney, fmtDate } from "./notasStyles";
import { Button } from "../../../components/ui/Button";

const TIPO_LABEL = { NFSE: "Nota de serviço (NFS-e)", NFE: "Nota de venda (NF-e)" };
const PAPEL_LABEL = { EMIT: "Emitida pela empresa", DEST: "Recebida pela empresa" };

// A frase única de ausência. Uma só, para não virar quatro sinônimos pela tela.
function SemDado({ children = "não temos este dado" }) {
  return (
    <span style={{ color: "var(--text-faint)", fontStyle: "italic", fontWeight: 400 }}>{children}</span>
  );
}

function Campo({ rotulo, valor, mono = false, quebra = false }) {
  const vazio = valor == null || valor === "";
  return (
    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: "0.68rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {rotulo}
      </span>
      <span
        title={!vazio && mono ? String(valor) : undefined}
        style={{
          fontSize: "0.82rem", color: PANEL.text,
          fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
          wordBreak: quebra ? "break-all" : "normal",
          overflow: quebra ? "visible" : "hidden",
          textOverflow: "ellipsis", whiteSpace: quebra ? "normal" : "nowrap",
        }}
      >
        {vazio ? <SemDado /> : String(valor)}
      </span>
    </div>
  );
}

function Secao({ titulo, children, aviso }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h4 style={{
        margin: "0 0 8px", fontSize: "0.72rem", fontWeight: 700, color: PANEL.muted,
        textTransform: "uppercase", letterSpacing: "0.06em",
        borderBottom: `1px solid ${PANEL.border}`, paddingBottom: 5,
      }}>
        {titulo}
      </h4>
      {aviso && (
        <p style={{ margin: "0 0 8px", fontSize: "0.76rem", color: "var(--text-faint)", lineHeight: 1.45 }}>
          {aviso}
        </p>
      )}
      {children}
    </section>
  );
}

const GRADE = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "10px 18px" };

// Status usa os tokens de ESTADO no significado deles: cancelada bloqueia (danger), rejeitada pede
// ação (warn), autorizada está concluída (ok). Verde aqui é ESTADO, nunca botão.
const STATUS_TOKEN = {
  cancelada: { cor: "var(--state-danger)", fundo: "var(--state-danger-surface)" },
  rejeitada: { cor: "var(--state-warn)", fundo: "var(--state-warn-surface)" },
  substituida: { cor: "var(--state-warn)", fundo: "var(--state-warn-surface)" },
  autorizada: { cor: "var(--state-ok)", fundo: "var(--state-ok-surface)" },
};

function StatusChip({ status }) {
  if (!status) {
    return (
      <span style={{
        padding: "3px 10px", borderRadius: 12, fontSize: "0.72rem",
        background: "var(--state-neutral-surface)", color: "var(--text-faint)",
        border: "1px solid var(--border)", fontStyle: "italic",
      }}>
        situação não registrada
      </span>
    );
  }
  const s = String(status).toLowerCase();
  const t = STATUS_TOKEN[s] || { cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" };
  return (
    <span style={{
      padding: "3px 10px", borderRadius: 12, fontSize: "0.72rem", fontWeight: 600,
      background: t.fundo, color: t.cor, border: `1px solid ${t.cor}`,
    }}>
      {s}
    </span>
  );
}

function fmtBytes(b) {
  if (b == null) return null;
  if (b < 1024) return `${b} B`;
  return `${(b / 1024).toFixed(1)} KB`;
}

function fmtDataHora(d) {
  if (!d) return null;
  try { return new Date(d).toLocaleString("pt-BR"); } catch { return String(d); }
}

// Competência é mês, não dia — mostrar "01/06/2026" sugeriria uma data que ninguém escolheu.
function fmtCompetencia(d) {
  if (!d) return null;
  try {
    const dt = new Date(d);
    return `${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${dt.getUTCFullYear()}`;
  } catch { return String(d); }
}

function BlocoXml({ xml, nota }) {
  const [aberto, setAberto] = useState(false);

  if (!xml?.disponivel) {
    return (
      <Secao
        titulo="XML do documento"
        aviso={
          nota?.type === "NFE"
            ? "Não guardamos o XML desta nota. A captura de NF-e pela SEFAZ traz o resumo do documento (DFe); o XML completo só vem depois da manifestação do destinatário."
            : "Não guardamos o XML desta nota."
        }
      >
        <SemDado>arquivo não disponível para esta nota</SemDado>
      </Secao>
    );
  }

  if (xml.truncadoPorTamanho) {
    return (
      <Secao
        titulo="XML do documento"
        aviso={`O XML existe (${fmtBytes(xml.bytes) || "tamanho desconhecido"}) mas é grande demais para ser exibido aqui. Ele continua guardado — use o download de notas em lote.`}
      >
        <SemDado>conteúdo não carregado por tamanho</SemDado>
      </Secao>
    );
  }

  function baixar() {
    const blob = new Blob([xml.conteudo], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nota?.type || "nota"}-${nota?.numero || nota?.chaveAcesso || nota?.id}.xml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  return (
    <Secao titulo="XML do documento">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: aberto ? 10 : 0 }}>
        {/* Secundários os dois: o XML é consulta, não a ação principal da tela. */}
        <Button variant="secondary" size="sm" onClick={() => setAberto((v) => !v)}>
          {aberto ? "Ocultar XML" : "Ver XML"}
        </Button>
        <Button variant="secondary" size="sm" onClick={baixar}>Baixar XML</Button>
        <span style={{ fontSize: "0.74rem", color: PANEL.muted }}>{fmtBytes(xml.bytes)}</span>
      </div>
      {aberto && (
        <pre style={{
          margin: 0, maxHeight: 320, overflow: "auto",
          background: "var(--bg-page)", border: `1px solid ${PANEL.border}`, borderRadius: 6,
          padding: 12, fontSize: "0.72rem", lineHeight: 1.5, color: PANEL.text,
          whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {xml.conteudo}
        </pre>
      )}
    </Secao>
  );
}

function BlocoItens({ itens, nota }) {
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) {
    return (
      <Secao
        titulo="Itens da nota"
        aviso={
          nota?.type === "NFE"
            ? "Nenhum item guardado. O resumo do DFe não traz os itens da NF-e — eles só chegam com o XML completo."
            : "Nenhum item guardado para esta nota."
        }
      >
        <SemDado>sem itens registrados</SemDado>
      </Secao>
    );
  }
  const th = { padding: "6px 8px", textAlign: "left", fontWeight: 600 };
  const td = { padding: "6px 8px", verticalAlign: "top" };
  return (
    <Secao titulo={`Itens da nota (${lista.length})`}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
          <thead>
            <tr style={{ background: PANEL.field, color: PANEL.muted }}>
              <th style={th}>Descrição</th>
              <th style={th}>Cód. serviço (LC 116)</th>
              <th style={th}>CFOP</th>
              <th style={th}>NCM</th>
              <th style={{ ...th, textAlign: "right" }}>Valor</th>
              <th style={th}>Classificação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((it) => (
              <tr key={it.id} style={{ borderTop: `1px solid ${PANEL.border}`, color: PANEL.text }}>
                <td style={{ ...td, minWidth: 220, whiteSpace: "pre-wrap" }}>
                  {it.descricao || <SemDado>sem descrição</SemDado>}
                </td>
                <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>{it.codigoServico || <SemDado>—</SemDado>}</td>
                <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>{it.cfop || <SemDado>—</SemDado>}</td>
                <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>{it.ncm || <SemDado>—</SemDado>}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{fmtMoney(it.valor)}</td>
                <td style={td}>
                  {/* Classificação é da apuração, não desta tela. Ela ou existe, ou se diz que não
                      rodou — anexo em branco parecendo "Anexo nenhum" seria pior que a ausência. */}
                  {it.tipoReceita || it.anexoResolvido
                    ? [it.tipoReceita, it.anexoResolvido && `Anexo ${it.anexoResolvido}`].filter(Boolean).join(" · ")
                    : <SemDado>não classificado</SemDado>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

export function NotaDetailModal({ nota, loading, error, onClose }) {
  const titulo = nota
    ? `${TIPO_LABEL[nota.type] || nota.type || "Nota"} nº ${nota.numero || "—"}`
    : "Nota fiscal";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe da nota fiscal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1700,
        display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 16px",
        overflowY: "auto",
      }}
    >
      <div style={{
        background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
        padding: 24, width: "100%", maxWidth: 900,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, color: PANEL.text, fontSize: "1rem" }}>{titulo}</h3>
            {nota && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                <StatusChip status={nota.statusEfetivo || nota.status} />
                <span style={{ fontSize: "0.76rem", color: PANEL.muted }}>
                  {PAPEL_LABEL[nota.papel] || <SemDado>papel não registrado</SemDado>}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {loading && (
          <div style={{ padding: 32, textAlign: "center", color: PANEL.muted, fontSize: "0.85rem" }}>
            Carregando a nota…
          </div>
        )}

        {!loading && error && (
          <div style={{
            padding: 12, borderRadius: 6, marginBottom: 12,
            background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)",
            color: "var(--state-danger)", fontSize: "0.82rem",
          }}>
            {error}
          </div>
        )}

        {!loading && nota && (
          <>
            <Secao titulo="Identificação">
              <div style={GRADE}>
                <Campo rotulo="Número" valor={nota.numero} mono />
                <Campo rotulo="Série" valor={nota.serie} mono />
                <Campo rotulo="Tipo" valor={TIPO_LABEL[nota.type] || nota.type} />
                <Campo rotulo="Chave de acesso" valor={nota.chaveAcesso} mono quebra />
                <Campo rotulo="ID NFS-e" valor={nota.idNfse} mono quebra />
                <Campo rotulo="ID DPS" valor={nota.idDps} mono quebra />
              </div>
            </Secao>

            <Secao titulo="Partes">
              <div style={GRADE}>
                <Campo rotulo="Emitente" valor={nota.emitenteNome} />
                <Campo rotulo="CNPJ/CPF do emitente" valor={nota.emitenteDoc} mono />
                <Campo rotulo="Tomador / destinatário" valor={nota.tomadorNome} />
                <Campo rotulo="CNPJ/CPF do tomador" valor={nota.tomadorDoc} mono />
              </div>
            </Secao>

            <Secao titulo="Valores e datas">
              <div style={GRADE}>
                <Campo rotulo="Valor total" valor={nota.total == null ? null : fmtMoney(nota.total)} mono />
                <Campo rotulo="Data de emissão" valor={nota.issueDate ? fmtDate(nota.issueDate) : null} />
                <Campo rotulo="Competência" valor={fmtCompetencia(nota.competencia)} />
              </div>
            </Secao>

            <Secao titulo="Situação">
              <div style={GRADE}>
                <Campo rotulo="Situação efetiva" valor={nota.statusEfetivo} />
                <Campo rotulo="Status na origem" valor={nota.status} />
                <Campo
                  rotulo="Chegou após o fechamento"
                  valor={nota.competenciaPosFechamento == null ? null : (nota.competenciaPosFechamento ? "sim" : "não")}
                />
              </div>
            </Secao>

            <BlocoItens itens={nota.itens} nota={nota} />
            <BlocoXml xml={nota.xml} nota={nota} />

            <Secao
              titulo="Captura"
              aviso="Quando esta nota entrou na nossa base — não é a data da nota, é a data em que a capturamos."
            >
              <div style={GRADE}>
                <Campo rotulo="Registrada em" valor={fmtDataHora(nota.createdAt)} />
                <Campo rotulo="Atualizada em" valor={fmtDataHora(nota.updatedAt)} />
                <Campo rotulo="Última sincronização" valor={fmtDataHora(nota.lastSyncAt)} />
                <Campo rotulo="Hash do XML" valor={nota.xmlHash} mono quebra />
                <Campo rotulo="Identificador interno" valor={nota.id} mono quebra />
              </div>
            </Secao>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>
  );
}
