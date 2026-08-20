import { useEffect, useState } from "react";
import { api } from "../../api";
import { AlertaErro, CardNumero, Carregando, Chip, Vazio } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import { baixarBlob } from "../../lib/baixarBlob";
import { modeloDeEmissaoDaNota, podeReaproveitar } from "../emitir/lib/reaproveitarNota";
import { lerRecusaDanfse, nomeDoArquivoDanfse, podeGerarDanfse } from "./lib/danfseDaNota";
import { lerRecusaLote, nomeDoArquivoLoteDanfse } from "./lib/loteDanfse";
import { podeCancelar } from "./lib/cancelamentoNota";
import { estadoDaLinhaDaNota } from "./lib/estadoDaLinhaDaNota";
import { ESCOPO } from "./lib/impedimento";
import { ConfirmarCancelamento } from "./ConfirmarCancelamento";
import {
  TRACO,
  brl,
  competenciaPadrao,
  competenciasRecentes,
  fmtCompetencia,
  fmtDateBr,
  fmtDoc,
  inteiro,
  somaOuTraco,
  texto,
} from "../../lib/format";

const OPCOES_COMPETENCIA = competenciasRecentes(12);
const LIMITE = 25;

// PortalInvoice.status: EMITIDA | CANCELADA | SUBSTITUIDA | REJEITADA | PENDENTE
// (apps/api/prisma/schema.prisma). O `data-status` do chip é o vocabulário do
// protótipo, então o de-para é explícito em vez de um toLowerCase() torcendo
// para bater.
const CHIP_POR_STATUS = {
  EMITIDA: { status: "emitida", rotulo: "Emitida" },
  CANCELADA: { status: "cancelada", rotulo: "Cancelada" },
  SUBSTITUIDA: { status: "substituida", rotulo: "Substituída" },
  REJEITADA: { status: "rejeitada", rotulo: "Rejeitada" },
  PENDENTE: { status: "processando", rotulo: "Pendente" },
};

function chipDaNota(status) {
  const chave = String(status || "").toUpperCase();
  return CHIP_POR_STATUS[chave] || { status: null, rotulo: texto(status) };
}

/**
 * Notas EMITIDAS pela empresa (direcao=emitidas, como no app mobile).
 *
 * ⚠ O `summary` é do FILTRO INTEIRO, não da página — é o backend que soma
 * (`prisma.aggregate`). Por isso ele vive fora da tabela: somar a coluna da
 * página daria outro número, menor, e ninguém saberia qual dos dois é o do mês.
 *
 * ── DE ONDE SE CLICA PARA REAPROVEITAR (dono, 19/08/2026) ────────────────────
 *
 * ⚠ O QUE ESTA TELA TINHA, MEDIDO ANTES DE INVENTAR NAVEGAÇÃO: uma tabela de 7
 * colunas, `<tr>` sem `onClick`, sem modal de detalhe, sem seleção e sem rota
 * por nota (o roteamento do portal é por HASH, com quatro destinos fixos —
 * `lib/hooks.js`). Ou seja: **hoje clicar numa nota não faz nada**, e não havia
 * nem detalhe onde pendurar a ação, como há no portal do escritório (lá ela mora
 * no `NotaDetailModal`).
 *
 * ⚠ POR ISSO A AÇÃO É UM BOTÃO NA LINHA, e não a linha inteira virando clicável:
 * linha clicável sem detalhe para abrir teria UM destino possível — começar uma
 * emissão —, e um clique acidental na lista abrindo a tela que pratica ato
 * fiscal é caro demais para ser adivinhado. Botão nomeado diz o que vai
 * acontecer antes de acontecer, e é alcançável pelo teclado.
 *
 * ⚠ BOTÃO IMPOSSÍVEL NÃO SOME: a nota que não serve de modelo (NF-e, ou nota em
 * que a tomadora é a própria empresa) fica DESABILITADA com o motivo em texto ao
 * lado — a mesma disciplina do portal do escritório. Sumir faria a ausência
 * parecer defeito.
 *
 * ⚠ A REGRA NÃO MORA AQUI: quem decide o que se copia, o que não se copia e o
 * que a tela é obrigada a dizer é `emitir/lib/reaproveitarNota.js`.
 *
 * ── A NOTA EMITIDA APARECE NA HORA (dono, 19/08/2026) ────────────────────────
 *
 * > *"ao emitir uma nota, ela deve aparecer para o cliente, e depois que
 * > consultar o ADN aí fica confirmada na tela; deve ficar mais clarinha e,
 * > quando confirmada ADN, ela fica viva como as outras. **Não coloque
 * > explicação disso na tela.***"
 *
 * A lista lia SÓ `PortalInvoice`, que é a projeção do ADN — entre emitir e a
 * próxima captura a nota simplesmente não existia aqui. Hoje o backend junta as
 * duas fontes NA LEITURA e marca cada linha com **`confirmadaPeloAdn`** (ver
 * `application/notas/notasEmitidasNaoConfirmadas.js`, que traz a chave de
 * deduplicação e a prova de que ela identifica).
 *
 * ⚠⚠ **A DISTINÇÃO É VISUAL E SÓ** — é instrução literal do dono, e ela veio
 * logo depois de ele mandar enxugar as legendas desta tela. Não há parágrafo,
 * legenda nem rodapé explicando os dois estados. O que existe:
 *   • `data-confirmada-adn` no `<tr>` — o estado fica **auditável no DOM**;
 *   • `opacity` no CSS (`styles/app.css`) — a linha "mais clarinha";
 *   • `title`/`aria-label` no chip — que **não são texto na tela** e são o que
 *     existe para quem passa o mouse e para quem usa leitor de tela. Opacidade
 *     sozinha não chega a quem não enxerga a diferença.
 */
/**
 * O botão do DANFSe de UMA nota.
 *
 * ⚠ BOTÃO IMPOSSÍVEL NÃO SOME — fica desabilitado com o motivo em texto ao lado, a mesma
 * disciplina de "Usar como modelo". A regra de quando ele pode não mora aqui: mora em
 * `lib/danfseDaNota.js`, que espelha o que o backend recusa.
 *
 * ⚠⚠ A RECUSA APARECE INTEIRA. A rota responde **503 `danfse_sem_qrcode`** quando o QR Code não
 * pôde ser gerado, e essa é a única resposta que a tela precisa EXPLICAR: um DANFSe sem QR Code
 * não é um DANFSe (NT 008 §2.2 e §2.4.3). Mostrar "falha ao baixar" — ou nada — aqui seria a
 * mentira que o 503 existe para impedir.
 */
function BotaoDanfse({ nota, companyId }) {
  const [estado, setEstado] = useState({ fase: "ocioso", recusa: null });
  const permissao = podeGerarDanfse(nota);
  const gerando = estado.fase === "gerando";

  async function baixar() {
    setEstado({ fase: "gerando", recusa: null });
    try {
      const blob = await api.fetchDanfseBlob(companyId, nota.invoiceId);
      baixarBlob(blob, nomeDoArquivoDanfse(nota));
      setEstado({ fase: "pronto", recusa: null });
    } catch (err) {
      setEstado({ fase: "recusado", recusa: lerRecusaDanfse(err) });
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn-link"
        disabled={!permissao.pode || gerando}
        title={permissao.pode ? "Gera e baixa o PDF da NFS-e" : permissao.texto || undefined}
        onClick={permissao.pode && !gerando ? baixar : undefined}
      >
        {gerando ? "Gerando…" : "Baixar DANFSe"}
      </button>
      {/* ⚠ Ver `lib/impedimento.js`. Impedimento da NOTA (é NF-e, ainda não confirmada) NÃO vira
          texto aqui: a linha inteira já o carrega — a coluna "Tipo", o chip e o `title`/`aria`
          dele —, e a coluna vizinha chegaria à mesma conclusão e escreveria a mesma frase. Até
          19/08/2026 "Ainda não confirmada." aparecia DUAS vezes na mesma linha.
          O que sobra aqui é o que só o DANFSe sabe: a nota não tem o XML guardado. */}
      {permissao.pode || permissao.escopo === ESCOPO.NOTA ? null : (
        <span className="muted" style={{ fontSize: ".78rem" }}>{permissao.resumo}</span>
      )}
      {estado.recusa ? (
        <span
          className="muted"
          style={{ fontSize: ".78rem", color: "var(--danger)", display: "block", maxWidth: 260 }}
        >
          ⚠ {estado.recusa.titulo} {estado.recusa.texto}
          {estado.recusa.porQue ? ` ${estado.recusa.porQue}` : ""}
        </span>
      ) : null}
    </>
  );
}

/**
 * O botão do DANFSe EM LOTE — o zip da competência que está na tela.
 *
 * > Pedido do dono (19/08/2026): *"a possibilidade de baixar notas em lote (…) quero o download no
 * > portal do cliente, e fazer o download dos DANFSe e não do XML."*
 *
 * ⚠ ELE MORA JUNTO DO FILTRO DE COMPETÊNCIA, e não numa coluna da tabela, porque **é o filtro que
 * ele baixa**. Nenhuma lista de notas sai daqui: o que vai ao servidor é a competência, e é lá que
 * o recorte é resolvido — com o mesmo `where` da listagem. Botão no cabeçalho, longe do seletor,
 * faria parecer que ele baixa "tudo".
 *
 * ⚠⚠ O ZIP TRAZ UM `RELATORIO.txt`, E A TELA DIZ ISSO ANTES DE A PESSOA ABRIR O ARQUIVO. Nem toda
 * nota gera DANFSe (NF-e, nota sem o XML guardado, nota sem QR Code, nota que o sistema nacional
 * ainda não devolveu), e a ausência **não pode ser descoberta contando arquivos**. O relatório é
 * onde ela está escrita, nota por nota, com o motivo — apontar para ele é o que transforma o
 * arquivo em resposta.
 *
 * ⚠ A RECUSA `lote_muito_grande` CHEGA COM OS NÚMEROS. Ela é a única resposta desta ação que a
 * tela precisa EXPLICAR: cada DANFSe é gerado na hora, e sem o teto o download morreria no meio
 * sem dizer quantas notas vieram. A regra do texto mora em `lib/loteDanfse.js`.
 */
function BotaoLoteDanfse({ companyId, cnpj, competencia, habilitado }) {
  const [estado, setEstado] = useState({ fase: "ocioso", recusa: null });
  const baixando = estado.fase === "baixando";

  async function baixar() {
    setEstado({ fase: "baixando", recusa: null });
    try {
      const blob = await api.baixarDanfseEmLote(companyId, { competencia: competencia || undefined });
      baixarBlob(blob, nomeDoArquivoLoteDanfse({ cnpj, competencia }));
      setEstado({ fase: "pronto", recusa: null });
    } catch (err) {
      setEstado({ fase: "recusado", recusa: lerRecusaLote(err) });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: ".25rem" }}>
      <button
        type="button"
        className="btn"
        disabled={!habilitado || baixando}
        title={
          habilitado
            ? "Gera os DANFSe das notas deste filtro e baixa tudo num arquivo .zip"
            : "Não há nota neste filtro para baixar."
        }
        onClick={habilitado && !baixando ? baixar : undefined}
      >
        {baixando ? "Gerando os PDFs…" : "Baixar DANFSe em lote (.zip)"}
      </button>
      {estado.fase === "pronto" ? (
        <span className="muted" style={{ fontSize: ".78rem", maxWidth: 340 }}>
          Arquivo baixado. Dentro dele, <strong>RELATORIO.txt</strong> lista as notas que não
          geraram DANFSe e o motivo de cada uma.
        </span>
      ) : null}
      {estado.recusa ? (
        <span
          className="muted"
          style={{ fontSize: ".78rem", color: "var(--danger)", display: "block", maxWidth: 340 }}
        >
          ⚠ {estado.recusa.titulo} {estado.recusa.texto}
          {estado.recusa.porQue ? ` ${estado.recusa.porQue}` : ""}
        </span>
      ) : null}
    </div>
  );
}

export function NotasPage({ empresa, aoReaproveitar, aoEmitir, aoPrepararLote }) {
  const companyId = empresa.companyId;
  // ⚠ Abre no mês CORRENTE — decisão do dono, 18/08/2026 (ver `competenciaPadrao` em
  // `lib/format.js`). Antes abria em "Todas". ⚠ Isto ESTREITA o que a tela mostra ao abrir: quem
  // emitiu no mês passado não vê a nota de cara. Por isso o estado vazio abaixo NOMEIA a
  // competência e aponta para "Todas" — some da tela, mas não some sem dizer para onde foi.
  const [competencia, setCompetencia] = useState(competenciaPadrao);
  const [pagina, setPagina] = useState(1);
  // ⚠ A nota que está em confirmação de CANCELAMENTO. Fica aqui, e não dentro da linha, porque o
  // diálogo é modal: uma confirmação por vez, e ela sobrevive à rolagem da tabela.
  const [notaParaCancelar, setNotaParaCancelar] = useState(null);
  // ⚠⚠ AS NOTAS QUE MANDAMOS CANCELAR NESTA SESSÃO. Elas NÃO vêm do servidor: a lista lê
  // `PortalInvoice`, a projeção do ADN, e nós deliberadamente não a escrevemos (ver
  // `notasEmitidasNaoConfirmadas.js`). Até a captura trazer o evento, o único lugar do mundo que
  // sabe do cancelamento é esta tela — e quem mandou cancelar precisa ver que funcionou.
  const [cancelamentosEnviados, setCancelamentosEnviados] = useState(() => new Set());

  // Trocar de empresa ou de competência recomeça na página 1: manter a página 4
  // de uma lista que agora tem 2 páginas mostra uma tela vazia que parece um bug.
  useEffect(() => {
    setPagina(1);
  }, [companyId, competencia]);

  // ⚠ TROCAR DE EMPRESA ESQUECE OS CANCELAMENTOS ENVIADOS. Os ids são de outra carteira; mantê-los
  // riscaria uma linha desta empresa por causa de um clique dado na outra. (A competência NÃO
  // limpa: a nota cancelada continua sendo a mesma nota se a pessoa voltar ao mês dela.)
  useEffect(() => {
    setCancelamentosEnviados(new Set());
  }, [companyId]);

  const query = useCarregamento(
    () => api.getInvoices(companyId, { competencia: competencia || undefined, page: pagina, limit: LIMITE }),
    [companyId, competencia, pagina]
  );

  const resposta = query.dados;
  const notas = resposta?.data || [];
  const total = resposta?.total ?? 0;
  const limite = resposta?.limit ?? LIMITE;
  const totalPaginas = Math.max(1, Math.ceil(total / limite));
  const paginaAtual = resposta?.page ?? pagina;

  return (
    <>
      <div className="page-header">
        <h1>Notas emitidas</h1>
        {/* ⚠⚠ ESTE BOTÃO SUBSTITUIU A ABA "EMITIR" (dono, 19/08/2026) — a aba foi removida
            INTEIRA: menu, rota e estado (`shell/AppShell.jsx`, `lib/hooks.js`).

            ⚠ ELE APARECE SEMPRE, inclusive para quem NÃO pode emitir, e isso é a razão de a aba
            aparecer sempre, herdada: escondê-lo deixaria o cliente sem saber que a emissão existe
            e que ela depende de um clique do contador. Quem não pode cai na tela do outro lado,
            que diz QUAL guarda está fechada e o que fazer — e que tem o seu próprio "Voltar".
            Um botão desabilitado aqui não serviria: o motivo não cabe num `title`, e o portão é
            resposta do servidor, não da lista. */}
        <button type="button" className="btn btn-primary" onClick={aoEmitir}>
          Emitir nota
        </button>
        {/* ⚠ "PREPARAR", E NÃO "EMITIR EM LOTE": a tela do outro lado baixa o modelo, lê a planilha
            preenchida e CONFERE linha a linha — ela não emite nada, e a emissão em lote não existe
            ainda. Um botão que prometesse emitir mandaria o cliente procurar um botão que não há.
            ⚠ Ele aparece SEMPRE, como o "Emitir nota" ao lado: baixar o modelo e conferir uma
            planilha são LEITURA (a rota entra sem papel mínimo), então não há portão a espelhar. */}
        <button type="button" className="btn" onClick={aoPrepararLote}>
          Preparar lote por planilha
        </button>
      </div>

      <div className="card">
        <div className="filters">
          <label htmlFor="competencia-notas">
            Competência
            <select
              id="competencia-notas"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
            >
              <option value="">Todas</option>
              {OPCOES_COMPETENCIA.map((c) => (
                <option key={c} value={c}>
                  {fmtCompetencia(c)}
                </option>
              ))}
            </select>
          </label>
          {/* ⚠ O botão do lote fica AQUI, colado no filtro, porque é o filtro que ele baixa. */}
          <BotaoLoteDanfse
            companyId={companyId}
            cnpj={empresa.cnpj}
            competencia={competencia}
            habilitado={notas.length > 0}
          />
        </div>
      </div>

      <div className="grid-2">
        <CardNumero
          rotulo={competencia ? `Notas em ${fmtCompetencia(competencia)}` : "Notas no período"}
          valor={resposta ? inteiro(resposta.summary?.totalInvoices) : TRACO}
          apoio="Total encontrado com o filtro atual"
        />
        <CardNumero
          rotulo="Valor total"
          valor={resposta ? somaOuTraco(resposta.summary?.totalAmount) : TRACO}
          apoio={
            resposta
              ? `Nesta página: ${somaOuTraco(resposta.summary?.pageAmount)}`
              : "Total encontrado com o filtro atual"
          }
          destaque
        />
      </div>

      <AlertaErro
        erro={query.erro}
        padrao="Não foi possível carregar as notas."
        aoTentarNovamente={query.recarregar}
      />

      {query.carregando ? (
        <Carregando>Carregando notas…</Carregando>
      ) : query.erro ? null : notas.length === 0 ? (
        <Vazio>
          {competencia
            ? `Nenhuma nota emitida em ${fmtCompetencia(competencia)}. Troque a competência acima — ou escolha "Todas" para ver o histórico inteiro.`
            : "Nenhuma nota emitida encontrada."}
        </Vazio>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Número</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Emissão</th>
                  <th scope="col">Competência</th>
                  <th scope="col">Tomador</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="num">
                    Valor
                  </th>
                  <th scope="col">DANFSe</th>
                  <th scope="col">Cancelar</th>
                  <th scope="col">Emitir outra</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((nota) => {
                  const chip = chipDaNota(nota.status);
                  const permissao = podeReaproveitar(nota, { cnpjDaEmpresa: empresa.cnpj });
                  // ⚠ O ESTADO DA LINHA MORA NUM LUGAR SÓ — `lib/estadoDaLinhaDaNota.js`. Ele
                  // distingue "emitida, aguardando o ADN" de "cancelamento enviado", que são dois
                  // fatos diferentes e têm desenhos diferentes.
                  const cancelamentoEnviado = cancelamentosEnviados.has(nota.invoiceId);
                  const estadoLinha = estadoDaLinhaDaNota(nota, { cancelamentoEnviado });
                  const cancelamento = podeCancelar(nota, {
                    cancelamentoEnviado,
                    // ⚠ O CNPJ da empresa é o que permite reconhecer a nota RECEBIDA quando
                    // `papel` não veio — a mesma fonte dupla de `podeReaproveitar`.
                    cnpjDaEmpresa: empresa.cnpj,
                  });
                  return (
                    <tr key={nota.invoiceId} data-estado-nota={estadoLinha.estado}>
                      <td>{texto(nota.numero)}</td>
                      <td>{texto(nota.type)}</td>
                      <td>{fmtDateBr(nota.issueDate)}</td>
                      <td>{fmtCompetencia(nota.competencia)}</td>
                      <td>
                        <span className="truncar" title={texto(nota.tomador?.nome)}>
                          {texto(nota.tomador?.nome)}
                        </span>
                        <span className="muted" style={{ fontSize: ".78rem" }}>
                          {nota.tomador?.cnpjCpf ? fmtDoc(nota.tomador.cnpjCpf) : TRACO}
                        </span>
                      </td>
                      <td>
                        {/* ⚠ O CHIP NÃO MUDA DE COR NEM DE RÓTULO. A nota FOI emitida; o que falta
                            é a confirmação do sistema nacional. Um rótulo diferente ("Pendente",
                            "Aguardando") a pintaria de azul de processando ou de cinza de
                            cancelada, que é justamente a confusão a evitar.

                            ⚠ `title`/`aria-label` NÃO são "explicação na tela" — são o que existe
                            para quem passa o mouse e para quem usa leitor de tela. A opacidade
                            sozinha não chega a quem não enxerga a diferença. */}
                        <Chip
                          status={chip.status}
                          title={estadoLinha.title || undefined}
                          aria-label={estadoLinha.aria ? `${chip.rotulo} — ${estadoLinha.aria}` : undefined}
                        >
                          {chip.rotulo}
                        </Chip>
                      </td>
                      <td className="num">{brl(nota.total)}</td>
                      <td>
                        <BotaoDanfse nota={nota} companyId={companyId} />
                      </td>
                      <td>
                        {/* ⚠⚠ ESTE BOTÃO NÃO CANCELA NADA — ele abre a confirmação, que repete os
                            dados da nota. Cancelar uma NFS-e é IRREVERSÍVEL, e um clique acidental
                            na linha errada de uma tabela é exatamente o acidente a evitar.
                            ⚠ BOTÃO IMPOSSÍVEL NÃO SOME: fica desabilitado com o motivo ao lado. */}
                        <button
                          type="button"
                          className="btn-link"
                          disabled={!cancelamento.pode}
                          title={cancelamento.texto || undefined}
                          onClick={() => setNotaParaCancelar(nota)}
                        >
                          Cancelar
                        </button>
                        {/* ⚠ Ver `lib/impedimento.js`: impedimento da NOTA não vira texto aqui —
                            a linha já o carrega (coluna Tipo, chip, `title`/`aria`), e cada botão
                            escrevendo o seu fazia a mesma frase aparecer duas vezes por linha. */}
                        {cancelamento.pode || cancelamento.escopo === ESCOPO.NOTA ? null : (
                          <span className="muted" style={{ fontSize: ".78rem" }}>
                            {cancelamento.resumo}
                          </span>
                        )}
                      </td>
                      <td>
                        {/* ⚠ O BOTÃO NÃO EMITE NADA — ele abre a tela de emissão pré-preenchida,
                            que continua tendo o portão, o aviso de cadastro incompleto e o botão
                            Emitir como sempre teve. */}
                        <button
                          type="button"
                          className="btn-link"
                          disabled={!permissao.pode}
                          title={permissao.texto || undefined}
                          onClick={() =>
                            aoReaproveitar?.(
                              modeloDeEmissaoDaNota(nota, {
                                companyId,
                                cnpjDaEmpresa: empresa.cnpj,
                              })
                            )
                          }
                        >
                          Usar como modelo
                        </button>
                        {permissao.pode ? null : (
                          <span className="muted" style={{ fontSize: ".78rem" }}>
                            {permissao.resumo}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="paginacao">
            <button
              type="button"
              className="btn"
              disabled={paginaAtual <= 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <span className="info">
              Página {inteiro(paginaAtual)} de {inteiro(totalPaginas)} · {inteiro(total)} nota(s)
            </span>
            <button
              type="button"
              className="btn"
              disabled={paginaAtual >= totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </>
      )}

      {notaParaCancelar ? (
        <ConfirmarCancelamento
          nota={notaParaCancelar}
          aoFechar={() => setNotaParaCancelar(null)}
          aoConfirmar={async ({ cMotivo, justificativa }) => {
            // ⚠ A recusa NÃO é engolida: o diálogo a captura e a mostra. Aqui só o desfecho feliz
            // fecha e recarrega — a lista precisa refletir a nota cancelada.
            const alvo = notaParaCancelar.invoiceId;
            await api.cancelarNota(companyId, alvo, { cMotivo, justificativa });
            // ⚠ MARCA ANTES DE RECARREGAR. O servidor vai devolver a nota como "EMITIDA" de novo
            // (a lista lê a projeção do ADN), então sem esta marca a linha voltaria ao normal e o
            // clique pareceria não ter funcionado.
            setCancelamentosEnviados((anterior) => new Set(anterior).add(alvo));
            setNotaParaCancelar(null);
            query.recarregar();
          }}
        />
      ) : null}
    </>
  );
}
