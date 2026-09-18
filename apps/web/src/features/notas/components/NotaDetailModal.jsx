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
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { lerCicloDaNota, temHistoria } from "../lib/cicloNotaTela";
import { podeReaproveitar } from "../lib/reaproveitarNota";
import { lerRecusaDanfse, nomeDoArquivoDanfse, podeGerarDanfse } from "../lib/danfseDaNota";

const TIPO_LABEL = { NFSE: "Nota de serviço (NFS-e)", NFE: "Nota de venda (NF-e)" };
const PAPEL_LABEL = { EMIT: "Emitida pela empresa", DEST: "Recebida pela empresa" };

// Emissão é uma data civil do documento. Meia-noite UTC não deve virar o dia anterior no Brasil.
function dataCivilDaNota(valor) {
  const partes = String(valor || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : fmtDate(valor);
}

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

// ⚠ O MAPA DE COR DAQUI ESTAVA MORTO, E O PORQUÊ IMPORTA — SENÃO ALGUÉM O "CONSERTA" DE VOLTA.
//
// Ele vivia neste arquivo com uma entrada `substituida`, e era alimentado por `nota.statusEfetivo`.
// Só que `statusEfetivo` NUNCA vale "substituida": tem dois valores (`autorizada`/`cancelada`),
// zero linhas em produção com um terceiro, e o próprio schema documenta que gravá-lo quebraria os
// filtros de dinheiro (o faturamento exige `=== "autorizada"`). Ou seja: aquele âmbar nunca acendeu
// uma única vez, e o detalhe mostrava "cancelada" em vermelho para a nota que a lista já mostrava
// como "substituída" em âmbar.
//
// Hoje o mapa mora em `../lib/cicloNotaTela.js`, é o MESMO da lista, e quem o alimenta é
// `ciclo.situacao` — derivado do EVENTO e do VÍNCULO, não do `statusEfetivo`.
//
// Status usa os tokens de ESTADO no significado deles: cancelada bloqueia (danger), substituída
// pede leitura (warn), autorizada está concluída (ok). Verde aqui é ESTADO, nunca botão.
function StatusChip({ ciclo }) {
  if (!ciclo.situacao) {
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
  return (
    <span
      title={ciclo.tituloAjuda}
      style={{
        padding: "3px 10px", borderRadius: 12, fontSize: "0.72rem", fontWeight: 600,
        background: ciclo.fundo, color: ciclo.cor, border: `1px solid ${ciclo.cor}`,
      }}
    >
      {ciclo.rotulo}
      {/* Cancelada sem evento gravado não pode se apresentar com a mesma confiança de uma cujo
          cancelamento nós registramos — mesma marca da lista, de propósito. */}
      {ciclo.semEvento && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> · sem evento</span>}
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
            ? "XML completo indisponível. Importe o XML desta NF-e para consultar seus itens e baixar o DANFE."
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


  return (
    <Secao titulo="XML do documento">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: aberto ? 10 : 0 }}>
        {/* Secundários os dois: o XML é consulta, não a ação principal da tela. */}
        <Button variant="secondary" size="sm" onClick={() => setAberto((v) => !v)}>
          {aberto ? "Ocultar XML" : "Ver XML"}
        </Button>

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

// ── AS AÇÕES DA NOTA ─────────────────────────────────────────────────────────
//
// O defeito relatado pelo dono (18/08/2026): *"o portal do contador não está habilitado as notas do
// jeito que lhe disse, como no portal do cliente, podendo apenas clicar em uma nota já emitida para
// copiar dados entre outras coisas"*. Até aqui, clicar numa nota dava três coisas para LER e nenhuma
// para FAZER — o detalhe era uma ficha, não uma tela de trabalho.
//
// Ficam no TOPO, antes da ficha, porque é isto que se veio fazer; a ficha é a conferência.
//
// ⚠ BOTÃO IMPOSSÍVEL NÃO SOME — fica desabilitado DIZENDO POR QUÊ, em texto (não em `title`:
// `title` não é descobrível, some ao mover o mouse e não existe no toque). Botão ausente é
// indistinguível de "esta versão do app não faz isso", e a diferença é justamente a informação.
function BlocoAcoes({ nota, onReaproveitar, onBaixarDanfse }) {
  const [danfse, setDanfse] = useState({ estado: "ocioso", recusa: null });

  const reuso = podeReaproveitar(nota);
  const danfsePode = nota.type === "NFE"
    ? { pode: false, texto: "Para baixar o DANFE desta NF-e, selecione a nota na lista e use Baixar DANFE / DANFSe. É necessário ter o XML completo guardado." }
    : podeGerarDanfse(nota);
  const gerando = danfse.estado === "gerando";

  async function baixarDanfse() {
    if (!onBaixarDanfse || !nota?.id) return;
    setDanfse({ estado: "gerando", recusa: null });
    try {
      const blob = await onBaixarDanfse(nota.id);
      // Mesmo caminho do "Baixar XML" logo abaixo e do download de Documentos da empresa: o token
      // não viaja num `<a href>`, então o arquivo vem por `fetch` com Bearer e é entregue por um
      // link temporário. ⚠ O `revoke` é adiado — revogar no mesmo tick corta o download em alguns
      // browsers antes de ele começar.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeDoArquivoDanfse(nota);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setDanfse({ estado: "pronto", recusa: null });
    } catch (err) {
      // ⚠ A RECUSA APARECE INTEIRA, com o motivo do servidor. Tela em branco ou "falha ao baixar"
      // aqui esconderia justamente o que o 503 existe para dizer.
      setDanfse({ estado: "recusado", recusa: lerRecusaDanfse(err) });
    }
  }

  function baixarXml() {
    const url = URL.createObjectURL(new Blob([nota.xml.conteudo], { type: "application/xml" }));
    const a = document.createElement("a"); a.href = url;
    a.download = `${nota.type}-${nota.numero || nota.id}.xml`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return (
    <section aria-label="Ações da nota" style={{ padding: "14px 0", borderTop: `1px solid ${PANEL.border}`, borderBottom: `1px solid ${PANEL.border}`, marginBottom: 20 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button disabled={!reuso.pode || !onReaproveitar}
          title={!reuso.pode ? reuso.texto : "Abre uma nova emissão com os dados desta nota"}
          onClick={() => onReaproveitar?.(nota)}>Emitir outra a partir desta</Button>
        <Button variant="secondary" disabled={!danfsePode.pode || !onBaixarDanfse || gerando}
          title={!danfsePode.pode ? danfsePode.texto : "Baixar o documento auxiliar em PDF"}
          onClick={baixarDanfse}>{gerando ? "Gerando o DANFSe…" : "Baixar DANFSe (PDF)"}</Button>
        <Button variant="secondary" disabled={!nota.xml?.conteudo || nota.xml?.truncadoPorTamanho}
          title={!nota.xml?.conteudo ? "XML completo indisponível nesta visualização; use o download em lote" : "Baixar XML"}
          onClick={baixarXml}>Baixar XML</Button>
      </div>
      <details style={{ marginTop: 8, color: PANEL.muted, fontSize: "0.76rem" }}>
        <summary style={{ cursor: "pointer" }}>Sobre as ações</summary>
        <p>Emitir outra abre uma nota nova; a original continua exatamente como está.</p>
        {!reuso.pode && <p>{reuso.texto}</p>}
        <p>O PDF é gerado na hora a partir do XML e não fica guardado.</p>
        {!danfsePode.pode && <p>{danfsePode.texto}</p>}
      </details>
      {danfse.estado === "recusado" && danfse.recusa && <div role="alert" style={{ marginTop: 10, color: "var(--state-danger)" }}>
        <strong>{danfse.recusa.titulo}</strong> — {danfse.recusa.texto}
        {danfse.recusa.motivo && <p>{danfse.recusa.motivo}</p>}
        {danfse.recusa.porQue && <p>{danfse.recusa.porQue}</p>}
      </div>}
      {danfse.estado === "pronto" && <small role="status" style={{ color: "var(--state-ok)" }}>DANFSe gerado e baixado.</small>}
    </section>
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

// ── O CICLO: CANCELAMENTO E SUBSTITUIÇÃO ─────────────────────────────────────
//
// O caso concreto que o dono relatou: *"a ATIM consta uma nota; nós cancelamos essa nota, emitimos
// outra e depois a substituímos, e a nossa aba deve mostrar isso."* Até aqui o detalhe não lia
// `ciclo`, `eventos`, `chaveSubstituida` nem `motivoSubstituicao` — a lista contava a história e o
// detalhe da mesma nota a desmentia.
//
// ⚠ O VÍNCULO TEM DOIS LADOS, e os dois existem no schema:
//   • `chaveSubstituida` (coluna da própria nota) → "EU substituo aquela";
//   • `PortalInvoiceEvent.chaveSubstituta`        → "aquela substituiu A MIM".
// Uma nota pode ter os dois (substituiu alguém e depois foi substituída) — 3 casos medidos.

// A nota do outro lado do vínculo. ⚠ `naBase: false` É RESPOSTA: quer dizer "o vínculo é real, a
// outra nota é que não foi capturada". Sumir com o vínculo nesse caso seria esconder o fato.
function ReferenciaNota({ rotulo, alvo, explicacao, ausente, onAbrirNota }) {
  if (!alvo) return null;
  const rotuloNota = alvo.numero ? `nº ${alvo.numero}` : "sem número registrado";
  return (
    <div style={{
      display: "grid", gap: 6, padding: 10, borderRadius: 6,
      background: "var(--bg-page)", border: `1px solid ${PANEL.border}`,
    }}>
      <span style={{ fontSize: "0.68rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {rotulo}
      </span>
      <span style={{ fontSize: "0.85rem", color: PANEL.text, fontWeight: 600 }}>
        {alvo.numero ? rotuloNota : <SemDado>{rotuloNota}</SemDado>}
      </span>
      <span style={{
        fontSize: "0.7rem", color: PANEL.muted, wordBreak: "break-all",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}>
        {alvo.chaveAcesso || <SemDado>sem chave de acesso</SemDado>}
      </span>
      {explicacao && (
        <span style={{ fontSize: "0.74rem", color: "var(--text-faint)", lineHeight: 1.45 }}>{explicacao}</span>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {/* A pergunta seguinte do contador é "então qual é a nota que vale?" — daqui ele chega
            nela. ⚠ Botão desabilitado NOMEIA o motivo: sem `title` ele seria só um botão morto. */}
        <Button
          variant="secondary" size="sm"
          disabled={!alvo.naBase || !alvo.notaId || !onAbrirNota}
          title={
            !alvo.naBase || !alvo.notaId
              ? ausente
              : !onAbrirNota ? "Esta tela não permite trocar de nota." : "Abrir esta nota"
          }
          onClick={alvo.naBase && alvo.notaId && onAbrirNota ? () => onAbrirNota(alvo.notaId) : undefined}
        >
          Abrir esta nota
        </Button>
        {(!alvo.naBase || !alvo.notaId) && <SemDado>{ausente}</SemDado>}
      </div>
    </div>
  );
}

function BlocoEventos({ eventos }) {
  const lista = Array.isArray(eventos) ? eventos : [];
  if (!lista.length) return null;
  const th = { padding: "6px 8px", textAlign: "left", fontWeight: 600 };
  const td = { padding: "6px 8px", verticalAlign: "top" };
  return (
    <div style={{ overflowX: "auto", marginTop: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
        <thead>
          <tr style={{ background: PANEL.field, color: PANEL.muted }}>
            <th style={th}>Evento</th>
            <th style={th}>Código</th>
            <th style={th}>Data</th>
            <th style={th}>Motivo</th>
            <th style={th}>Capturado em</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((e, i) => (
            <tr key={e.id || i} style={{ borderTop: `1px solid ${PANEL.border}`, color: PANEL.text }}>
              <td style={td}>{e.tipo || <SemDado>tipo não reconhecido</SemDado>}</td>
              <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>
                {e.tpEvento || <SemDado>—</SemDado>}
                {e.nSeqEvento != null ? ` · seq ${e.nSeqEvento}` : ""}
              </td>
              <td style={td}>{fmtDataHora(e.dataEvento) || <SemDado>sem data</SemDado>}</td>
              <td style={{ ...td, minWidth: 180, whiteSpace: "pre-wrap" }}>
                {e.motivo || <SemDado>sem motivo declarado</SemDado>}
              </td>
              <td style={td}>{fmtDataHora(e.capturadoEm) || <SemDado>—</SemDado>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlocoCiclo({ nota, ciclo, onAbrirNota }) {
  const eventos = Array.isArray(nota?.eventos) ? nota.eventos : [];

  // ⚠ AUSÊNCIA NUNCA É RESPOSTA — mas "não foi cancelada nem substituída" É uma resposta, e é
  // DIFERENTE de "não temos o evento". As duas precisam de frases próprias, senão a nota quieta e
  // a nota sobre a qual não sabemos nada se parecem na tela.
  if (!temHistoria(ciclo, eventos)) {
    return (
      <Secao titulo="Ciclo da nota">
        <p style={{ margin: 0, fontSize: "0.82rem", color: PANEL.text, lineHeight: 1.5 }}>
          Esta nota <strong>não foi cancelada nem substituída</strong>, e não substitui nenhuma
          outra. Não há evento registrado porque não houve evento a registrar.
        </p>
      </Secao>
    );
  }

  const evento = ciclo.evento;
  const dataDoCiclo = evento?.dataEvento || null;
  // Houve substituição de fato? Qualquer um dos dois lados do vínculo serve como evidência.
  const ehSubstituicao = Boolean(ciclo.substitui || ciclo.substituidaPor || ciclo.situacao === "substituida");

  return (
    <Secao titulo="Ciclo da nota — cancelamento e substituição">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <StatusChip ciclo={ciclo} />
        {ciclo.ehSubstituta && (
          <span style={{
            padding: "3px 10px", borderRadius: 12, fontSize: "0.72rem", fontWeight: 600,
            background: "var(--accent-purple-surface)", color: "var(--accent-purple)",
            border: "1px solid var(--accent-purple-border)",
          }}>
            {/* Ser substituta é PAPEL, não situação: a nota pode ser substituta e, depois, ter sido
                substituída também. Por isso o selo fica AO LADO, não no lugar. */}
            substituta
          </span>
        )}
      </div>

      {/* ⚠ O AVISO VEM DO PRÓPRIO MÓDULO DO CICLO, com o texto dele. Reescrevê-lo aqui faria a
          tela dizer uma coisa e a regra outra — é o mesmo erro que produziu o defeito. */}
      {ciclo.avisos.map((a) => (
        <p key={a.codigo} style={{
          margin: "0 0 10px", padding: 10, borderRadius: 6, fontSize: "0.78rem", lineHeight: 1.5,
          background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)",
          color: "var(--state-warn)",
        }}>
          {a.texto}
        </p>
      ))}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <ReferenciaNota
          rotulo="Foi substituída por"
          alvo={ciclo.substituidaPor}
          explicacao="Esta é a nota que passou a valer no lugar desta."
          ausente="A nota substituta não está no sistema — ela existe (o vínculo vem do evento), mas não foi capturada."
          onAbrirNota={onAbrirNota}
        />
        <ReferenciaNota
          rotulo="Esta nota substitui"
          alvo={ciclo.substitui}
          explicacao="A nota anterior, que esta veio substituir."
          ausente="A nota substituída não está no sistema — o vínculo é real (vem do XML desta nota), mas ela não foi capturada."
          onAbrirNota={onAbrirNota}
        />
      </div>

      <div style={{ ...GRADE, marginTop: 12 }}>
        {/* ⚠ O RÓTULO SEGUE O FATO. Numa nota apenas CANCELADA, escrever "motivo da substituição:
            não temos este dado" sugere uma substituição que ninguém afirmou — é o oposto do que
            este bloco existe para fazer. Só há motivo DE SUBSTITUIÇÃO onde há substituição. */}
        {ehSubstituicao
          ? <Campo rotulo="Motivo da substituição" valor={ciclo.motivoSubstituicao} />
          : (evento || ciclo.semEvento) && <Campo rotulo="Motivo do evento" valor={evento?.motivo} />}
        {/* ⚠ Data e tipo do EVENTO só cabem numa nota que teve evento. Numa nota SUBSTITUTA
            (autorizada, que só declara quem ela substituiu) o evento vive na nota do outro lado —
            pedir a data aqui e responder "não temos este dado" faria parecer que falta um dado
            nosso, quando o que falta é a pergunta. */}
        {(evento || ciclo.semEvento) && (
          <>
            <Campo rotulo="Data do evento" valor={fmtDataHora(dataDoCiclo)} />
            <Campo rotulo="Tipo do evento" valor={evento?.tipo} />
          </>
        )}
      </div>

      {/* ⚠ O QUARTO ESTADO. `eventoRegistrado: false` numa nota que não está autorizada significa
          "NÃO SABEMOS", nunca "não aconteceu" — e uma tela que se cala aqui afirma mais do que
          sabe. 556 canceladas em produção estão exatamente assim. */}
      {ciclo.semEvento && !ciclo.avisos.length && (
        <p style={{
          margin: "12px 0 0", padding: 10, borderRadius: 6, fontSize: "0.78rem", lineHeight: 1.5,
          background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)",
          color: "var(--state-warn)",
        }}>
          Não guardamos o evento desta nota — não temos a data, o motivo, nem se foi cancelamento
          simples ou substituição. Isso <strong>não quer dizer que o evento não existiu</strong>:
          quer dizer que ele não foi gravado por nós.
        </p>
      )}

      {eventos.length > 0
        ? <BlocoEventos eventos={eventos} />
        : (
          <p style={{ margin: "12px 0 0", fontSize: "0.76rem", color: "var(--text-faint)", lineHeight: 1.45 }}>
            Nenhum evento guardado para esta nota.
          </p>
        )}
    </Secao>
  );
}

export function NotaDetailModal({ nota, loading, error, onClose, onAbrirNota, onReaproveitar, onBaixarDanfse }) {
  const titulo = nota
    ? `${TIPO_LABEL[nota.type] || nota.type || "Nota"} nº ${nota.numero || "—"}`
    : "Nota fiscal";

  // A MESMA leitura da lista, do mesmo módulo. É o que impede o chip do cabeçalho de dizer
  // "cancelada" numa nota que a tabela já mostrou como "substituída".
  const ciclo = lerCicloDaNota(nota);

  return (
    <Modal titulo="Detalhe da nota fiscal" aoFechar={onClose} tamanho="lg" rodape={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, color: PANEL.text, fontSize: "1rem" }}>{titulo}</h3>
            {nota && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                <StatusChip ciclo={ciclo} />
                <span style={{ fontSize: "0.76rem", color: PANEL.muted }}>
                  {PAPEL_LABEL[nota.papel] || <SemDado>papel não registrado</SemDado>}
                </span>
              </div>
            )}
          </div>

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
            {/* Primeiro o que se pode FAZER, depois a ficha para conferir. */}
            <BlocoAcoes key={nota.id} nota={nota} onReaproveitar={onReaproveitar} onBaixarDanfse={onBaixarDanfse} />

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
                <Campo rotulo="Data de emissão" valor={nota.issueDate ? dataCivilDaNota(nota.issueDate) : null} />
                <Campo rotulo="Competência" valor={fmtCompetencia(nota.competencia)} />
              </div>
              {!nota.competencia && <p style={{ color: PANEL.muted, fontSize: "0.82rem" }}>Competência não informada: confira o XML e o documento de origem. Se necessário, corrija a informação na origem e reimporte o XML. A data de emissão não será usada automaticamente como competência.</p>}
            </Secao>

            <Secao
              titulo="Situação"
              aviso={
                "Situação usada na apuração. Cancelamentos e substituições aparecem no histórico abaixo."
              }
            >
              <div style={GRADE}>
                <Campo rotulo="Situação efetiva" valor={nota.statusEfetivo} />
                <Campo rotulo="Status na origem" valor={nota.status} />
                <Campo
                  rotulo="Chegou após o fechamento"
                  valor={nota.competenciaPosFechamento == null ? null : (nota.competenciaPosFechamento ? "sim" : "não")}
                />
              </div>
            </Secao>

            <BlocoCiclo nota={nota} ciclo={ciclo} onAbrirNota={onAbrirNota} />

            <BlocoItens itens={nota.itens} nota={nota} />
            <BlocoXml xml={nota.xml} nota={nota} />

            <details style={{ color: PANEL.muted, fontSize: "0.82rem" }}><summary style={{ cursor: "pointer", marginBottom: 10 }}>Dados de captura e identificação interna</summary><Secao
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
            </Secao></details>
          </>
        )}

    </Modal>
  );
}
