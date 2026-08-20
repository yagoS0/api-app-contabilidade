// RELATÓRIO "Faturamento no Período — Consolidado" — a tela.
//
// A FORMA veio do impresso que o dono trouxe (bloco por tipo de operação com total próprio · total
// do mês · total consolidado · quadro-resumo no rodapé), e ele liberou o resto: *"o print que te
// mandei é apenas uma base do que quero, não precisa ser exatamente igual"*.
//
// ⚠ O VOCABULÁRIO É O DA RECEITA E VEM DO BACKEND. Nenhum rótulo fiscal é escrito aqui: os textos
// oficiais viajam em `dados.vocabulario` (Manual do PGDAS-D e DEFIS, itens 6.5 e 6.6.1) e nos
// próprios grupos. Inventar rótulo aqui repetiria o erro dos códigos `01`/`02` do Scritta.
//
// ⚠ O QUE A TELA PODE AFIRMAR está em `../lib/relatorioFaturamento.js`, com teste próprio. Este
// arquivo desenha; ele decide. Em especial: o número do nosso motor NUNCA se apresenta como o da
// Receita, e `INDETERMINADA`/`NAO_APURADO` nunca são renderizados como "não tem".
//
// ⚠ IMPRESSÃO REUSA O MECANISMO ÚNICO do `App.css` (`body.imprimindo` + `data-print-area`,
// `data-print-only`, `data-print-tabela`, `data-print-hide`) — ver `renderPlanejamentoPage.jsx`.
// Não existe segundo mecanismo e não entra biblioteca de PDF.
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Painel } from "../../../components/ui/Painel";
import { Aviso } from "../../../components/ui/Aviso";
import { PANEL, fmtMoney } from "../../notas/components/notasStyles";
import {
  avisosDoRelatorio,
  procedenciaDoDas,
  recusaDoPreApurado,
  rotuloSegregacao,
  rotuloQualificacoes,
  recusaEcoaOTopo,
  TOM,
} from "../lib/relatorioFaturamento";

function fmtDataHora(v) {
  if (!v) return "—";
  try { return new Date(v).toLocaleString("pt-BR"); } catch { return String(v); }
}

function fmtDataCurta(v) {
  if (!v) return "—";
  try { return new Date(v).toLocaleDateString("pt-BR"); } catch { return String(v); }
}

const caixa = { background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8 };
const th = { padding: "6px 8px", textAlign: "left", color: PANEL.muted, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "6px 8px", verticalAlign: "top" };
const tdNum = { ...td, textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap" };

// ⚠ O `Aviso` LOCAL SAIU. Era a quarta cópia da mesma caixa no app (as outras estavam no cofre de
// senhas e no wizard de parcelamento), e cada cópia tinha o seu padding, o seu raio e o seu jeito
// de escolher a cor. Hoje é `components/ui/Aviso` — que traz de graça a trava que interessa aqui:
// tom inválido cai em `neutro`, NUNCA em `ok`. Numa tela que fala de apuração, uma caixa que
// conclui o que não foi feito é o defeito caro.
//
// ⚠ Os TONS da lib (`TOM.warn`/`danger`/`ok`/`neutral`) são traduzidos para os do componente aqui,
// num lugar só. O `CORES_TOM_RELATORIO` continua existindo na lib para quem colore texto solto.
const TOM_DO_AVISO = {
  [TOM.danger]: "erro",
  [TOM.warn]: "atencao",
  [TOM.ok]: "ok",
  [TOM.neutral]: "neutro",
};

/**
 * ⚠ "Não apurado" ganha o mesmo peso visual do valor apurado. Dimensão ausente diagramada em
 * cinza-claro vira ausência de dúvida — é a regra que o `CardRegime` do planejamento já segue.
 */
function CelulaDimensao({ leitura }) {
  return (
    <span
      title={leitura.titulo || undefined}
      style={{
        color: leitura.apurado === false ? "var(--state-warn)" : PANEL.text,
        borderBottom: leitura.apurado === false ? "1px dotted var(--state-warn)" : "none",
      }}
    >
      {leitura.texto}
    </span>
  );
}

function TabelaLinhas({ linhas }) {
  return (
    // A tabela larga rola DENTRO do próprio contêiner; a página não rola na horizontal.
    <div data-print-tabela style={{ overflowX: "auto", maxWidth: "100%" }}>
      <table style={{ width: "100%", minWidth: 780, borderCollapse: "collapse", fontSize: "0.78rem" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${PANEL.border}` }}>
            <th style={th}>Documento</th>
            <th style={th}>Data</th>
            <th style={th}>Tomador</th>
            <th style={th}>Descrição</th>
            <th style={th} title="NF-e classifica a operação pelo CFOP; NFS-e pelo código do serviço (LC 116). São campos diferentes — a fonte vai ao lado.">Operação</th>
            <th style={{ ...th, textAlign: "right" }}>Valor contábil</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={`${l.notaId}-${l.itemId || i}`} style={{ borderTop: `1px solid ${PANEL.border}` }}>
              <td style={td}>
                {l.modeloRotulo || l.tipoDocumento || "—"} nº {l.numero || "—"}
                {l.serie ? ` / ${l.serie}` : ""}
              </td>
              <td style={td}>{fmtDataCurta(l.data)}</td>
              <td style={td}>{l.tomadorNome || "—"}</td>
              <td style={td}>{l.descricao || <span style={{ color: PANEL.muted }}>— sem detalhe —</span>}</td>
              <td style={td}>
                {l.codigoOperacao || "—"}
                {l.codigoOperacaoFonte ? <span style={{ color: PANEL.muted }}> ({l.codigoOperacaoFonte})</span> : null}
              </td>
              <td style={tdNum}>{fmtMoney(l.valorContabil)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Um bloco por TIPO DE OPERAÇÃO, com total próprio — é a forma do impresso.
 *
 * ⚠ O grupo NÃO CLASSIFICADO vem por último (o backend já ordena assim) e NÃO é pintado de verde:
 * ele é o alarme do relatório. O SEM DETALHE CAPTURADO é outro bloco, com outro motivo.
 */
function BlocoGrupo({ grupo }) {
  const seg = rotuloSegregacao(grupo.segregacao);
  const qual = rotuloQualificacoes(grupo.qualificacoes);
  const alerta = grupo.classificado === false;
  // ⚠ O TÍTULO DEIXOU DE SER ÂMBAR — o CONTORNO ficou. O contorno responde "onde está o
  // problema?"; "qual é o problema" está na caixa de aviso do topo, escrita uma vez, com o número
  // e o que fazer. Pintar o título também fazia a mesma frase gritar duas vezes na mesma rolagem.
  const corTitulo = PANEL.text;

  return (
    <div style={{ ...caixa, padding: 12, display: "flex", flexDirection: "column", gap: 8, borderColor: alerta ? "var(--state-warn)" : PANEL.border }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <strong style={{ fontSize: "0.88rem", color: corTitulo }}>{grupo.rotulo}</strong>
        <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{fmtMoney(grupo.total?.valorContabil)}</span>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "0.74rem", color: PANEL.muted }}>
        <span>Segregação (item 6.5): <CelulaDimensao leitura={seg} /></span>
        <span>Qualificações (item 6.6.1): <CelulaDimensao leitura={qual} /></span>
        {grupo.linhaAtividade?.rfb ? (
          <span title={`Faltam: ${(grupo.linhaAtividade.rfb.faltam || []).join(", ")}. Linhas possíveis: ${(grupo.linhaAtividade.rfb.linhasAlternativas || []).join(", ")}. Fonte: ${grupo.linhaAtividade.rfb.fonte}`}>
            {/* ⚠ "pode ser a linha N": o de-para do nosso enum para as 14 linhas da RFB é PARCIAL
                por construção, e apresentá-lo como resolvido seria pior que não tê-lo. */}
            Linha da RFB: <span style={{ color: "var(--state-warn)", borderBottom: "1px dotted var(--state-warn)" }}>
              pode ser a {grupo.linhaAtividade.rfb.linha}
              {(grupo.linhaAtividade.rfb.linhasAlternativas || []).length ? ` (ou ${grupo.linhaAtividade.rfb.linhasAlternativas.join(", ")})` : ""}
            </span>
          </span>
        ) : null}
        <span>{grupo.total?.itens} {grupo.total?.itens === 1 ? "linha" : "linhas"}</span>
      </div>

      <TabelaLinhas linhas={grupo.linhas || []} />
    </div>
  );
}

/** O pré-apurado: o nosso número, o oficial, e a diferença — nunca um número sem dono. */
function BlocoPreApurado({ preApurado, avisos = [] }) {
  const proc = procedenciaDoDas(preApurado);
  const recusa = recusaDoPreApurado(preApurado);
  // ⚠ Ver `recusaEcoaOTopo` na lib: quando a caixa do topo já disse o mesmo, com o mesmo número e
  // o mesmo "como resolver", aqui sobra a AFIRMAÇÃO (o DAS não foi calculado) sem a repetição.
  const ecoa = recusaEcoaOTopo(avisos, recusa);

  return (
    <div style={{ ...caixa, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <strong style={{ fontSize: "0.88rem" }}>Simples Nacional — pré-apurado</strong>

      {/* ⚠⚠ A CAIXA CONTINUA INTEIRA — ELA SÓ DEIXA DE SER A SEGUNDA ÂMBAR DA TELA.
          A primeira versão desta mudança recolhia o conteúdo quando o topo já avisava, e o teste
          derrubou na hora, com razão: o MOTIVO NOMEADO ("a receita da competência não está
          classificada") e o TAMANHO DO BURACO só existem aqui — o topo traz o número e o
          procedimento, não a causa. Some o que era repetição pura: a COR. Uma tela com quatro
          âmbares para um fato é onde âmbar deixa de significar alguma coisa; uma tela com um
          âmbar e um bloco neutro continua dizendo tudo, e o olho sabe para onde ir. */}
      {recusa.bloqueado ? (
        <Aviso tom={ecoa ? "neutro" : TOM_DO_AVISO[recusa.tom]} titulo={recusa.titulo}>
          {recusa.detalhe}
          {recusa.buraco ? (
            <div style={{ marginTop: 4 }}>
              Tamanho do que falta: <strong>{fmtMoney(recusa.buraco.valor)}</strong>
              {recusa.buraco.itens != null ? ` em ${recusa.buraco.itens} ${recusa.buraco.itens === 1 ? "item" : "itens"}` : ""}
              {recusa.buraco.fracaoRotulo ? ` · ${recusa.buraco.fracaoRotulo} do total da competência` : ""}.
            </div>
          ) : null}
          {recusa.comoResolver ? <div style={{ marginTop: 4 }}>{recusa.comoResolver}</div> : null}
        </Aviso>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        {/* NOSSO — rotulado como cálculo do portal, explicitamente. */}
        <div style={{ padding: 10, border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
          <div style={{ fontSize: "0.68rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {proc.nosso.rotulo}
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "monospace", color: proc.nosso.disponivel ? PANEL.text : "var(--state-warn)" }}>
            {proc.nosso.disponivel ? fmtMoney(proc.nosso.valor) : "não calculado"}
          </div>
        </div>

        {/* OFICIAL — e, quando a coluna é ambígua, a tela diz que não sabe de quem é. */}
        <div style={{ padding: 10, border: `1px solid ${proc.oficial.ambiguo ? "var(--state-warn)" : PANEL.border}`, borderRadius: 8 }}>
          <div style={{ fontSize: "0.68rem", color: proc.oficial.ambiguo ? "var(--state-warn)" : PANEL.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {proc.oficial.rotulo}
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "monospace", color: proc.oficial.disponivel ? PANEL.text : PANEL.muted }}>
            {proc.oficial.disponivel ? fmtMoney(proc.oficial.valor) : "—"}
          </div>
          {proc.oficial.aviso ? (
            <div style={{ fontSize: "0.72rem", color: "var(--state-warn)", marginTop: 4 }}>⚠ {proc.oficial.aviso}</div>
          ) : null}
        </div>

        {/* A diferença só existe quando existem os DOIS números, e só quando os dois têm dono. */}
        {proc.comparavel ? (
          <div style={{ padding: 10, border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
            <div style={{ fontSize: "0.68rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Diferença (portal − Receita)
            </div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "monospace" }}>{fmtMoney(proc.diferenca)}</div>
          </div>
        ) : null}
      </div>

      {preApurado?.ok === true ? (
        <div style={{ fontSize: "0.72rem", color: PANEL.muted }}>
          {preApurado.rbt12 != null ? <>RBT12 usado: <strong>{fmtMoney(preApurado.rbt12)}</strong>. </> : null}
          O cálculo do portal é conferência: ele não foi transmitido, não foi gravado na apuração e
          não substitui o que a Receita responde no PGDAS-D.
        </div>
      ) : null}
    </div>
  );
}

export function RelatorioFaturamentoPanel({
  relatorio = null,
  loading = false,
  gerando = false,
  erro = null,
  onGerar = null,
  /** ⚠ Só UM `data-print-area` por página. Com o modal aberto, quem imprime é o de dentro dele. */
  imprimivel = true,
  compacto = false,
}) {
  const [imprimindo, setImprimindo] = useState(false);

  // Mesmo mecanismo do planejamento: liga a classe, imprime, desliga no `afterprint`.
  useEffect(() => {
    if (!imprimindo) return undefined;
    document.body.classList.add("imprimindo");
    const limpar = () => setImprimindo(false);
    window.addEventListener("afterprint", limpar);
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", limpar);
      document.body.classList.remove("imprimindo");
    };
  }, [imprimindo]);

  const dados = relatorio?.dados || null;
  const avisos = dados ? avisosDoRelatorio(dados) : [];

  const barra = (
    <div data-print-hide style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <strong style={{ fontSize: "0.9rem" }}>Relatório de faturamento</strong>
      {relatorio ? (
        <span style={{ fontSize: "0.74rem", color: PANEL.muted }}>
          foto gerada em {fmtDataHora(relatorio.geradoEm)}
        </span>
      ) : null}
      <div style={{ flex: 1 }} />
      {onGerar ? (
        <Button
          onClick={onGerar}
          disabled={gerando || loading}
          title={gerando ? "Gerando o relatório…" : (loading ? "Carregando o relatório salvo…" : "")}
        >
          {gerando ? "Gerando…" : (relatorio ? "Regerar" : "Gerar relatório")}
        </Button>
      ) : null}
      {relatorio && imprimivel ? (
        <Button variant="secondary" onClick={() => setImprimindo(true)} disabled={imprimindo}>
          🖨 Imprimir
        </Button>
      ) : null}
    </div>
  );

  if (!dados) {
    return (
      <div style={{ ...caixa, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {barra}
        {erro ? (
          <Aviso tom="erro" titulo="O relatório não pôde ser carregado">{erro}</Aviso>
        ) : (
          <div style={{ fontSize: "0.82rem", color: PANEL.muted }}>
            {loading
              ? "Carregando…"
              : "Nenhum relatório salvo para esta competência. Gerar tira uma foto do faturamento "
                + "agora — não consulta ADN, SEFAZ nem SERPRO, e não altera o estado da apuração."}
          </div>
        )}
      </div>
    );
  }

  const emp = dados.empresa || {};

  return (
    <div
      {...(imprimivel ? { "data-print-area": true } : {})}
      style={{ ...caixa, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}
    >
      {barra}

      {/* ⚠ CABEÇALHO SÓ-NO-PAPEL. O impresso circula sem esta tela por perto: sem ele, o relatório
          vira uma lista de números sem empresa, sem competência, sem data e — o que mais importa —
          sem as ressalvas de escopo. É a mesma razão pela qual o PDF do planejamento imprime a
          vigência das tabelas. */}
      {/* ⚠ Só existe quando ESTE painel é a área de impressão. `[data-print-only]` vira
          `display:block !important` em toda a página quando `body.imprimindo` está ligado — um
          cabeçalho de papel fora da área impressa ganharia altura (invisível, mas ocupando fluxo)
          e empurraria o relatório para a folha seguinte. */}
      {imprimivel && (
      <div data-print-only style={{ display: "none" }}>
        <h2 style={{ margin: "0 0 2px" }}>{dados.titulo}</h2>
        <p style={{ margin: "0 0 4px", fontSize: "0.85rem" }}>
          {dados.subtitulo} · {emp.razaoSocial} · CNPJ {emp.cnpj}
          {emp.municipio ? ` · ${emp.municipio}${emp.uf ? `/${emp.uf}` : ""}` : ""}
        </p>
        <p style={{ margin: "0 0 4px", fontSize: "0.85rem" }}>
          Competência {dados.competenciaExtenso} ({dados.competencia}) ·
          gerado em {fmtDataHora(relatorio.geradoEm)}
        </p>
        {/* Os avisos de escopo vão IMPRESSOS — é o que impede o papel de ser lido como apuração. */}
        <p style={{ margin: "0 0 4px", fontSize: "0.78rem" }}>
          <strong>⚠ Escopo:</strong> relatório de FATURAMENTO montado a partir dos documentos
          emitidos capturados pelo portal. Não é declaração, não foi transmitido à Receita, e o
          valor de Simples Nacional que aparece aqui é <strong>cálculo do portal para
          conferência</strong> — não o valor apurado pela RFB, salvo onde estiver escrito
          "oficial (SERPRO)".
        </p>
        {(dados.limitacoes || []).map((l) => (
          <p key={l.codigo} style={{ margin: "0 0 3px", fontSize: "0.74rem" }}>
            <strong>⚠ {l.titulo}.</strong> {l.efeito}
          </p>
        ))}
      </div>
      )}

      {/* Cabeçalho de tela */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: "1rem", fontWeight: 700 }}>{dados.titulo}</div>
        <div style={{ fontSize: "0.8rem", color: PANEL.muted }}>
          {dados.subtitulo} · {emp.razaoSocial} · CNPJ {emp.cnpj}
        </div>
        <div style={{ fontSize: "0.8rem", color: PANEL.muted }}>
          Competência <strong style={{ color: PANEL.text }}>{dados.competenciaExtenso}</strong> ·
          {" "}gerado em {fmtDataHora(relatorio.geradoEm)}
        </div>
      </div>

      {/* ⚠ OS AVISOS VÊM ANTES DO TOTAL. O grupo não classificado fica por último na lista de
          blocos (é a ordem do backend, e é proposital), mas o número dele sobe para cá: avisar
          depois do total é avisar tarde. */}
      {avisos.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {avisos.map((a) => (
            <Aviso key={a.codigo} tom={TOM_DO_AVISO[a.tom]} titulo={a.titulo}>
              {a.numeros?.valor != null ? (
                <div>
                  <strong>{fmtMoney(a.numeros.valor)}</strong>
                  {a.numeros.itens != null ? ` · ${a.numeros.itens} ${a.numeros.itens === 1 ? "item" : "itens"}` : ""}
                  {a.numeros.notas != null ? ` · ${a.numeros.notas} ${a.numeros.notas === 1 ? "nota" : "notas"}` : ""}
                  {a.numeros.fracaoRotulo ? ` · ${a.numeros.fracaoRotulo} do total do mês` : ""}
                </div>
              ) : null}
              {a.numeros?.relatorio != null ? (
                <div>
                  Relatório <strong>{fmtMoney(a.numeros.relatorio)}</strong> · faturamento da
                  competência <strong>{fmtMoney(a.numeros.faturamento)}</strong> · diferença{" "}
                  <strong>{fmtMoney(a.numeros.diferenca)}</strong>
                </div>
              ) : null}
              {a.detalhe ? <div style={{ marginTop: 2 }}>{a.detalhe}</div> : null}
            </Aviso>
          ))}
        </div>
      )}

      <BlocoPreApurado preApurado={dados.preApurado} avisos={avisos} />

      {/* Um bloco por tipo de operação, cada um com o seu total. */}
      {(dados.gruposPorTipoOperacao || []).length === 0 ? (
        <div style={{ fontSize: "0.82rem", color: PANEL.muted, padding: 8 }}>
          Nenhum documento emitido nesta competência.
        </div>
      ) : (
        (dados.gruposPorTipoOperacao || []).map((g) => <BlocoGrupo key={g.chave} grupo={g} />)
      )}

      {/* Total do mês e total consolidado — as duas linhas do modelo. */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "flex-end", padding: "8px 12px", border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
        <span style={{ fontSize: "0.85rem" }}>
          Total do mês:{" "}
          <strong style={{ fontFamily: "monospace" }}>{fmtMoney(dados.totalMes?.valorContabil)}</strong>
          <span style={{ color: PANEL.muted }}> ({dados.totalMes?.itens} linhas)</span>
        </span>
        <span style={{ fontSize: "0.85rem" }} title="O período deste relatório é sempre UMA competência, então o consolidado é igual ao total do mês.">
          Total consolidado:{" "}
          <strong style={{ fontFamily: "monospace" }}>{fmtMoney(dados.totalConsolidado?.valorContabil)}</strong>
        </span>
      </div>

      {/* Quadro-resumo por tipo de operação — o rodapé do modelo. */}
      {!compacto && (dados.resumoPorTipoOperacao || []).length > 0 && (
        <div style={{ ...caixa, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <strong style={{ fontSize: "0.88rem" }}>Resumo por tipo de operação</strong>
          <div data-print-tabela style={{ overflowX: "auto", maxWidth: "100%" }}>
            <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${PANEL.border}` }}>
                  <th style={th}>Tipo de operação</th>
                  <th style={th}>Segregação (6.5)</th>
                  <th style={th}>Qualificações (6.6.1)</th>
                  <th style={{ ...th, textAlign: "right" }}>Linhas</th>
                  <th style={{ ...th, textAlign: "right" }}>Valor contábil</th>
                </tr>
              </thead>
              <tbody>
                {dados.resumoPorTipoOperacao.map((r) => (
                  <tr key={r.chave} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                    <td style={{ ...td, color: r.classificado === false ? "var(--state-warn)" : PANEL.text }}>{r.rotulo}</td>
                    <td style={td}><CelulaDimensao leitura={rotuloSegregacao(r.segregacao)} /></td>
                    <td style={td}><CelulaDimensao leitura={rotuloQualificacoes(r.qualificacoes)} /></td>
                    <td style={tdNum}>{r.itens}</td>
                    <td style={tdNum}>{fmtMoney(r.valorContabil)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${PANEL.border}` }}>
                  <td style={{ ...td, fontWeight: 700 }} colSpan={3}>Total do mês</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{dados.totalMes?.itens}</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{fmtMoney(dados.totalMes?.valorContabil)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Conferência do próprio relatório — aparece sempre, inclusive quando fecha. */}
      {dados.conferencia ? (
        <div style={{ fontSize: "0.74rem", color: dados.conferencia.confere ? PANEL.muted : "var(--state-danger)" }}>
          {dados.conferencia.confere ? "✓ " : "⚠ "}
          Conferência: total do relatório {fmtMoney(dados.conferencia.totalRelatorio)} ·
          faturamento da competência {fmtMoney(dados.conferencia.faturamentoEmit)} ·
          diferença {fmtMoney(dados.conferencia.diferenca)}.
        </div>
      ) : null}

      {/* ⚠ AS LIMITAÇÕES SÃO NOTA DE RODAPÉ E SAEM TAMBÉM NO PAPEL (aqui e no cabeçalho de
          impressão). Elas substituem as quatro colunas vazias de IPI/ST/Outros/Líquido que o
          modelo tinha: coluna vazia atravessando o relatório é ruído; a ressalva escrita uma vez
          é denúncia. */}
      {(dados.limitacoes || []).length > 0 && (
        <details className="detalhe-recolhivel" style={{ borderTop: `1px solid ${PANEL.border}`, paddingTop: 8 }}>
          {/* ⚠⚠ RECOLHIDO NA TELA, ABERTO NO PAPEL — e a segunda metade é a que importa. Eram
              quatro parágrafos de 0,72rem sempre abertos no pé de uma tela que já é longa; quem
              lê o relatório todo mês passou a rolar por cima deles. Mas o IMPRESSO circula sem a
              tela por perto, e sem as ressalvas ele se lê como apuração: o bloco `@media print`
              do `App.css` força o conteúdo de todo `<details>` dentro de `[data-print-area]`.
              ⚠ O número no rótulo é o que impede o recolhimento de virar sumiço — a tela diz
              QUANTAS ressalvas existem antes de alguém decidir não abri-las. */}
          <summary>O que este relatório NÃO afirma ({dados.limitacoes.length})</summary>
          {dados.limitacoes.map((l) => (
            <div key={l.codigo} style={{ fontSize: "0.72rem", color: PANEL.muted }}>
              <strong>⚠ {l.titulo}.</strong> {l.efeito}
            </div>
          ))}
          {dados.vocabulario?.fonte ? (
            <div style={{ fontSize: "0.72rem", color: PANEL.muted, marginTop: 4 }}>
              Vocabulário oficial: {dados.vocabulario.fonte}.{" "}
              {dados.vocabulario.avisoCodigos}
            </div>
          ) : null}
        </details>
      )}
    </div>
  );
}

export default RelatorioFaturamentoPanel;
