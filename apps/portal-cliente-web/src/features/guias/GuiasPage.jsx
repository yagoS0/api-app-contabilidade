import { useEffect, useState } from "react";
import { api } from "../../api";
import { AlertaErro, BotaoCopiar, Carregando, Chip, Vazio } from "../../components/ui";
import { linhaDigitavelDaGuia } from "./lib/linhaDigitavelTela";
import { detalheDaGuia, rotuloDaGuia } from "./lib/rotuloGuia";
import {
  avisoAntesDeConfirmar, avisoAntesDePedir, avisoDosAcrescimos, leituraDaRecusa,
  podeConfirmarPagamento, podePedirGuiaAtualizada, motivoDaGuiaNaoLiberada, podeBaixarPdf,
} from "./lib/recalculoDaGuia";
import { useCarregamento } from "../../lib/hooks";
import { mensagemDeErro } from "../../lib/mensagens";
import {
  TRACO,
  brl,
  competenciaPadrao,
  competenciasRecentes,
  fmtCompetencia,
  fmtDateBr,
  inteiro,
  texto, hojeNoCampoDeData, } from "../../lib/format";

const OPCOES_COMPETENCIA = competenciasRecentes(12);
const LIMITE = 25;

// Guide.paymentStatus: OPEN | PAID | OVERDUE (apps/api/prisma/schema.prisma).
// ⚠ Verde é CONCLUÍDO: só a guia PAGA leva verde. "Em aberto" é pendência
// (âmbar) e "vencida" é problema (vermelho) — se tudo fosse vermelho, nada se
// destacaria justamente na linha que precisa ser vista.
export const CHIP_POR_PAGAMENTO = {
  // ⚠⚠ O `status` daqui vira `data-status` no DOM e é o vocabulário que o app mobile espelha.
  // Era emprestado da NOTA — `PAID → "emitida"`, `OVERDUE → "rejeitada"`, `OPEN → "rascunho"` —
  // e a cor saía certa por acidente: uma guia VENCIDA aparecia no atributo como nota REJEITADA.
  // Guia não é nota. Mesmas superfícies, nome certo (ver `app.css`).
  PAID: { status: "paga", rotulo: "Paga" },
  OVERDUE: { status: "vencida", rotulo: "Vencida" },
  OPEN: { status: "aberta", rotulo: "Em aberto" },
};

export function chipDaGuia(paymentStatus) {
  const chave = String(paymentStatus || "").toUpperCase();
  return CHIP_POR_PAGAMENTO[chave] || { status: null, rotulo: texto(paymentStatus) };
}

/**
 * LINHA DIGITÁVEL — o número que o cliente digita no aplicativo do banco para pagar.
 *
 * ⚠⚠ AS TRÊS AUSÊNCIAS NÃO SÃO DESENHADAS IGUAIS (a regra está em `lib/linhaDigitavelTela.js`):
 * "ainda não lemos" · "o documento não traz" · "em conferência com o contador". Um traço mudo para
 * as três apagaria a diferença entre um problema que existe e um dado que ninguém buscou.
 *
 * ⚠ NA DIVERGÊNCIA O CLIENTE NÃO VÊ OS DOIS VALORES — isso é material de trabalho do contador. Aqui
 * ele vê que o número está em conferência e que o PDF continua servindo para pagar.
 *
 * ⚠ O NÚMERO APARECE INTEIRO, com máscara, e é de propósito: esta é a tela de quem vai DIGITAR, e
 * um número truncado obriga a abrir outra coisa. O botão copia os 48 dígitos LIMPOS.
 */
function CelulaLinhaDigitavel({ guia }) {
  const leitura = linhaDigitavelDaGuia(guia);
  if (leitura.linhaLimpa) {
    return (
      <td>
        <span
          style={{
            display: "block",
            fontVariantNumeric: "tabular-nums",
            fontSize: ".8rem",
            lineHeight: 1.35,
            wordBreak: "keep-all",
          }}
        >
          {leitura.linhaFormatada}
        </span>
        <BotaoCopiar valor={leitura.linhaLimpa} rotulo={`Copiar a linha digitável da guia ${rotuloDaGuia(guia)}`} />
      </td>
    );
  }
  return (
    <td>
      {/* ⚠ A COR fica inline porque é CONDICIONAL (só a conferência tem conflito conhecido); o
          tamanho vem da classe. Estilo que depende do dado fica no `style`; estilo fixo, não. */}
      <span
        className="meta"
        style={{ color: leitura.tom === "atencao" ? "var(--warning)" : undefined }}
      >
        {leitura.aviso}
      </span>
    </td>
  );
}

function baixarArquivo({ contentBase64, fileName, mimeType }) {
  const binario = window.atob(contentBase64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType || "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "guia.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sem o revoke o blob fica retido até a aba fechar.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * As guias da empresa.
 *
 * ⚠⚠ **ESTE BLOCO DIZIA "Guias liberadas ao cliente" E FICOU FALSO EM 30/08/2026.** Dono:
 * *"arruma a aba de guias, INSS e parcelamento não aparecem"*. A rota parou de filtrar por
 * `liberadaCliente` — ela negava a existência de guias que o FLUXO, na tela ao lado, já mostrava,
 * inclusive pelo botão *"Ver todas as guias"* que leva até aqui.
 *
 * ⚠⚠ **O GATE NÃO CAIU — ELE MUDOU DE ALCANCE.** Download, recálculo e confirmação de pagamento
 * continuam exigindo `liberadaCliente: true` no servidor, cada um no seu `where`. Esta tela
 * continua sem qualquer controle que contorne isso: o que ela ganhou foi a obrigação de DIZER,
 * na linha, que a guia ainda não foi liberada — ver `motivoDaGuiaNaoLiberada`.
 *
 * Contrato lido em `toGuideResponse`
 * (apps/api/src/application/guides/GuideService.js) — o app mobile não consome
 * esta rota, então ela foi conferida na origem, não copiada de lá.
 */
export function GuiasPage({ empresa, competencia: competenciaDaCasca, aoTrocarCompetencia }) {
  const companyId = empresa.companyId;
  // ⚠ Abre no mês CORRENTE — decisão do dono, 18/08/2026 (ver `competenciaPadrao` em
  // `lib/format.js`). Antes abria em "Todas".
  //
  // ⚠ AQUI O ESTREITAMENTO MORDE MAIS QUE NAS NOTAS, e é por isso que o estado vazio é o que é: a
  // guia da competência 07 costuma ser LIBERADA em agosto, então a competência corrente
  // frequentemente não tem guia nenhuma. "Nenhuma guia" sem dizer de qual mês, numa tela em que o
  // cliente vem procurar o que pagar, é indistinguível de "o contador não liberou nada".
  // ⚠⚠ A COMPETÊNCIA VEM DA CASCA — ver `AppShell.jsx`. Era a TERCEIRA cópia do mesmo
  // `useState(competenciaPadrao)` (as outras duas eram Início e Notas), e a divergência apareceu
  // na tela assim que as duas primeiras foram unificadas: Início e Notas em 06/2026, Guias em
  // 08/2026, sobre a mesma empresa, com o mês escrito no vazio de cada uma.
  // ⚠ O "Todas" daqui é o mesmo de Notas (string vazia) — as duas são listas.
  const competencia = competenciaDaCasca ?? competenciaPadrao();
  const setCompetencia = aoTrocarCompetencia || (() => {});
  const [pagina, setPagina] = useState(1);
  const [baixandoId, setBaixandoId] = useState(null);
  const [erroDownload, setErroDownload] = useState(null);

  useEffect(() => {
    setPagina(1);
  }, [companyId, competencia]);

  const query = useCarregamento(
    () => api.getGuides(companyId, { competencia: competencia || undefined, page: pagina, limit: LIMITE }),
    [companyId, competencia, pagina]
  );

  const resposta = query.dados;
  const guias = resposta?.data || [];
  const [pedido, setPedido] = useState(null);        // { guia, aviso }
  const [pedindo, setPedindo] = useState(false);
  const [recusa, setRecusa] = useState(null);
  const [avisoAcrescimo, setAvisoAcrescimo] = useState(null);
  const [confirmacao, setConfirmacao] = useState(null);   // { guia, aviso }
  /**
   * ⚠⚠ O DIA EM QUE ELE PAGOU — e ele nasce VAZIO, de propósito (30/08/2026).
   *
   * > Dono: *"ao clicar em confirmar pagamento, o pagamento foi posto no dia 30 de agosto mesmo não
   * > sendo verdade."*
   *
   * ⚠⚠ **NÃO PODE NASCER COM "HOJE" PREENCHIDO.** Um padrão é aceito com um clique, e aí a tela
   * volta a gravar o dia do clique — exatamente o defeito relatado, só que com a aparência de ter
   * sido conferido. É a mesma regra que o lote já carrega para o município do tomador: *"valor
   * escolhido pelo sistema fica indistinguível de valor conferido por uma pessoa"*.
   */
  const [pagoEm, setPagoEm] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [avisoConfirmacao, setAvisoConfirmacao] = useState(null);
  const total = resposta?.total ?? 0;
  const limite = resposta?.limit ?? LIMITE;
  const totalPaginas = Math.max(1, Math.ceil(total / limite));
  const paginaAtual = resposta?.page ?? pagina;

  // ⚠⚠ PEDIR A GUIA ATUALIZADA É O PRIMEIRO BOTÃO DESTE PORTAL QUE GASTA DINHEIRO DO ESCRITÓRIO:
  // uma consulta PAGA ao SERPRO, contra o teto mensal da carteira inteira. Por isso ele só aparece
  // na guia VENCIDA (decisão do dono), a confirmação REPETE o que vai acontecer, e a recusa do teto
  // chega sem número nenhum — quem resolve isso é o contador.
  async function pedirGuiaAtualizada() {
    const guia = pedido?.guia;
    if (!guia || pedindo) return;
    setPedindo(true);
    setRecusa(null);
    try {
      const r = await api.recalcularGuia(companyId, guia.guideId);
      setPedido(null);
      // ⚠ O aviso dos acréscimos FICA na tela depois do fecho do diálogo: se a guia nova veio sem
      // juros e multa, quem vai pagar precisa ler isso antes de pagar — não pode sumir com o modal.
      setAvisoAcrescimo(avisoDosAcrescimos(r?.acrescimos));
      await query.recarregar();
    } catch (err) {
      // ⚠ O corpo INTEIRO carrega `podeTentarDeNovo`; `err.message` sozinho perderia a diferença
      // entre "espere um pouco" e "só o contador resolve".
      setRecusa(leituraDaRecusa(err?.corpo || { message: mensagemDeErro(err, "Não foi possível pedir a guia atualizada.") }));
    } finally {
      setPedindo(false);
    }
  }

  // ⚠⚠ CONFIRMAR QUE PAGOU — e isto NÃO lança a baixa contábil. É a mesma forma da confirmação por
  // consulta de pagamento: marca a guia e para aí. A guarda que garante isso está no SERVIDOR
  // (`pagamentoAlcancaOContabil`), não aqui — regra que só mora na tela não protege o razão.
  // ⚠ ZERO CUSTO: é escrita local, sem chamada externa. Nada a ver com o "Pedir guia atualizada".
  async function confirmarPagamento() {
    const guia = confirmacao?.guia;
    if (!guia || confirmando) return;
    setConfirmando(true);
    setRecusa(null);
    try {
      const r = await api.confirmarPagamentoDaGuia(companyId, guia.guideId, { pagoEm });
      setConfirmacao(null);
      setPagoEm("");
      setAvisoConfirmacao(r?.aviso || null);
      await query.recarregar();
    } catch (err) {
      setRecusa(leituraDaRecusa(err?.corpo || { message: mensagemDeErro(err, "Não foi possível registrar o pagamento.") }));
    } finally {
      setConfirmando(false);
    }
  }

  async function baixar(guia) {
    if (baixandoId) return;
    setBaixandoId(guia.guideId);
    setErroDownload(null);
    try {
      const arquivo = await api.downloadGuide(companyId, guia.guideId);
      if (!arquivo?.contentBase64) {
        setErroDownload("O arquivo desta guia ainda não está disponível.");
        return;
      }
      baixarArquivo(arquivo);
    } catch (err) {
      setErroDownload(mensagemDeErro(err, "Não foi possível baixar a guia."));
    } finally {
      setBaixandoId(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Guias</h1>
      </div>

      <div className="card">
        <div className="filters">
          <label htmlFor="competencia-guias">
            Competência
            <select
              id="competencia-guias"
              disabled={!aoTrocarCompetencia}
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
        </div>
      </div>

      {erroDownload ? (
        <div className="alerta alerta-erro" role="alert">
          <p>{erroDownload}</p>
        </div>
      ) : null}

      {/* ⚠⚠ FICA NA TELA DEPOIS DO DIÁLOGO FECHAR. Se a guia nova voltou SEM juros e multa — e não
          está confirmado que o serviço da Receita gere a versão com acréscimos —, quem vai pagar
          precisa ler isso ANTES de pagar. Some junto com o modal seria pior que não avisar. */}
      {avisoAcrescimo ? (
        <div className="alerta alerta-atencao" role="status">
          <p><strong>{avisoAcrescimo.titulo}</strong></p>
          <p>{avisoAcrescimo.texto}</p>
          <button type="button" className="btn" onClick={() => setAvisoAcrescimo(null)}>Entendi</button>
        </div>
      ) : null}

      {/* ⚠ O que a confirmação FEZ e o que ela NÃO fez — dito depois, não só antes. Sem isso o
          cliente conclui que o assunto está encerrado dos dois lados, e liga perguntando por quê a
          contabilidade ainda não mostra o pagamento. */}
      {avisoConfirmacao ? (
        <div className="alerta alerta-sucesso" role="status">
          <p>{avisoConfirmacao}</p>
          <button type="button" className="btn" onClick={() => setAvisoConfirmacao(null)}>Entendi</button>
        </div>
      ) : null}

      {/* ⚠⚠ A CONFIRMAÇÃO REPETE O QUE ELA FAZ **E O QUE NÃO FAZ**. Um "confirmar pagamento?" seco
          faria o cliente achar que a baixa contábil também aconteceu. */}
      {confirmacao?.aviso ? (
        <div className="alerta alerta-atencao" role="alertdialog" aria-label={confirmacao.aviso.titulo}>
          <p><strong>{confirmacao.aviso.titulo}</strong></p>
          <p>{confirmacao.aviso.texto}</p>
          <p className="meta">
            Guia {rotuloDaGuia(confirmacao.guia)} · {fmtCompetencia(confirmacao.guia.competencia)}
          </p>
          {/* ⚠⚠ A DATA É DIGITADA, NÃO DEDUZIDA. É ela que vai para `paymentConfirmedAt`, o campo de
              onde o fluxo tira o MÊS e o DIA em que o dinheiro saiu — e só o cliente sabe qual é.
              ⚠ `max` de HOJE fecha a porta do futuro no próprio campo, antes da viagem; a recusa do
              servidor continua existindo, porque quem valida não pode ser a tela. */}
          <label className="campo" htmlFor="pago-em">
            <span>Em que dia você pagou?</span>
            <input
              id="pago-em"
              type="date"
              value={pagoEm}
              /* ⚠⚠ `hojeNoCampoDeData`, NUNCA `toISOString()`: aquele converte para UTC e às 21h
                 de Brasília devolve o dia SEGUINTE — o campo passaria a aceitar amanhã. Achado no
                 NAVEGADOR: com `toISOString()` o `max` saiu 2026-08-31 num dia 30. */
              max={hojeNoCampoDeData()}
              onChange={(e) => setPagoEm(e.target.value)}
              disabled={confirmando}
              required
            />
          </label>
          {/* ⚠ O botão só abre com a data preenchida — e o `title` diz por quê, senão ele fica
              cinza sem explicação e a pessoa não sabe o que falta. */}
          <button
            type="button"
            className="btn"
            disabled={confirmando || !pagoEm}
            title={!pagoEm ? "Informe o dia em que você pagou esta guia." : undefined}
            onClick={confirmarPagamento}
          >
            {confirmando ? "Registrando…" : confirmacao.aviso.rotuloConfirmar}
          </button>
          <button
            type="button"
            className="btn"
            disabled={confirmando}
            onClick={() => { setConfirmacao(null); setPagoEm(""); }}
          >
            Cancelar
          </button>
        </div>
      ) : null}

      {/* ⚠ A recusa do teto chega SEM número: consumo e teto do escritório não são assunto do
          cliente. E "tentar de novo" só aparece quando adianta — repetir contra teto estourado
          gasta a paciência dele e não resolve nada. */}
      {recusa ? (
        <div className="alerta alerta-erro" role="alert">
          <p>{recusa.texto}</p>
          {recusa.podeTentarDeNovo ? (
            <button type="button" className="btn" disabled={pedindo} onClick={pedirGuiaAtualizada}>
              Tentar de novo
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ⚠⚠ A CONFIRMAÇÃO REPETE O QUE VAI ACONTECER, e não pergunta "tem certeza?". O texto vem
          PRONTO do servidor — o portal do contador lê o MESMO campo, na versão dele. */}
      {pedido?.aviso ? (
        <div className="alerta alerta-atencao" role="alertdialog" aria-label={pedido.aviso.titulo}>
          <p><strong>{pedido.aviso.titulo}</strong></p>
          <p>{pedido.aviso.texto}</p>
          <p className="meta">
            Guia {rotuloDaGuia(pedido.guia)} · {fmtCompetencia(pedido.guia.competencia)}
          </p>
          <button type="button" className="btn" disabled={pedindo} onClick={pedirGuiaAtualizada}>
            {pedindo ? "Pedindo…" : pedido.aviso.rotuloConfirmar}
          </button>
          <button type="button" className="btn" disabled={pedindo} onClick={() => setPedido(null)}>
            Cancelar
          </button>
        </div>
      ) : null}

      <AlertaErro
        erro={query.erro}
        padrao="Não foi possível carregar as guias."
        aoTentarNovamente={query.recarregar}
      />

      {query.carregando ? (
        <Carregando>Carregando guias…</Carregando>
      ) : query.erro ? null : guias.length === 0 ? (
        <Vazio>
          {competencia
            ? `Nenhuma guia em ${fmtCompetencia(competencia)} — a guia costuma sair no mês seguinte. Escolha "Todas" para ver o histórico.`
            : "Nenhuma guia liberada para esta empresa até agora."}
        </Vazio>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Guia</th>
                  <th scope="col">Competência</th>
                  <th scope="col">Vencimento</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="num">
                    Valor
                  </th>
                  <th scope="col">Linha digitável</th>
                  <th scope="col">Arquivo</th>
                </tr>
              </thead>
              <tbody>
                {guias.map((guia) => {
                  const chip = chipDaGuia(guia.paymentStatus);
                  return (
                    /* ⚠ `data-liberada` é audível no DOM, como `data-status` — e a distinção
                       da linha não é só cor: a frase do motivo está na célula de ações. */
                    <tr key={guia.guideId} data-liberada={guia.liberadaCliente ? "sim" : "nao"}>
                      <td>
                        <span className="truncar" title={detalheDaGuia(guia) || rotuloDaGuia(guia)}>
                          {rotuloDaGuia(guia)}
                        </span>
                        {guia.numeroParcela != null ? (
                          <span className="meta">
                            Parcela {inteiro(guia.numeroParcela)}
                            {guia.quantidadeParcelas != null
                              ? ` de ${inteiro(guia.quantidadeParcelas)}`
                              : ""}
                          </span>
                        ) : null}
                      </td>
                      <td>{fmtCompetencia(guia.competencia)}</td>
                      <td>{fmtDateBr(guia.vencimento)}</td>
                      <td>
                        <Chip status={chip.status}>{chip.rotulo}</Chip>
                        {guia.paymentConfirmedAt ? (
                          <span className="meta meta--bloco">
                            em {fmtDateBr(guia.paymentConfirmedAt)}
                          </span>
                        ) : null}
                      </td>
                      <td className="num">
                        {/* `valor` é nullable no schema: guia sem valor lido do PDF sai como
                            traço, nunca como R$ 0,00 — zero aqui seria afirmar que não se deve nada. */}
                        {guia.valor == null ? TRACO : brl(guia.valor)}
                        {guia.valorRecalculado != null && guia.valorRecalculado !== guia.valor ? (
                          <span className="meta meta--bloco">
                            recalculado {brl(guia.valorRecalculado)}
                          </span>
                        ) : null}
                      </td>
                      <CelulaLinhaDigitavel guia={guia} />
                      <td>
                        {/* ⚠⚠ GUIA NÃO LIBERADA NÃO PERDE O BOTÃO — ele fica DESABILITADO, com o
                            motivo ao lado. Sumir com ele esconderia que o documento existe, e o
                            cliente não saberia o que pedir ao contador. ⚠ O `title` carrega a
                            mesma frase, para quem chega pelo teclado. */}
                        <button
                          type="button"
                          className="btn"
                          /* ⚠ `Boolean(baixandoId)`, não `=== guia.guideId`: o `baixar()` já
                             recusa reentrada (`if (baixandoId) return`), então com o `disabled`
                             só da própria linha os outros 24 botões ficavam com APARÊNCIA normal
                             e o clique não fazia nada — sem spinner, sem erro, sem fila. Filtro
                             fantasma no botão que é a saída de pagamento da guia. */
                          disabled={Boolean(baixandoId) || !podeBaixarPdf(guia)}
                          title={motivoDaGuiaNaoLiberada(guia) || undefined}
                          onClick={() => baixar(guia)}
                        >
                          {baixandoId === guia.guideId ? "Baixando…" : "Baixar PDF"}
                        </button>
                        {motivoDaGuiaNaoLiberada(guia) ? (
                          <span className="meta meta--bloco">{motivoDaGuiaNaoLiberada(guia)}</span>
                        ) : null}
                        {/* ⚠⚠ SÓ NA GUIA VENCIDA (decisão do dono). Guia em aberto não tem por que
                            ser regerada pelo cliente: o valor seria o mesmo, e o gasto, não.
                            ⚠ Quem decide é `podePedirGuiaAtualizada`, que lê o veredito PRONTO do
                            servidor — a tela não deriva "vencida" por conta própria. */}
                        {/* ⚠ Confirmar o pagamento é ZERO custo e vale para QUALQUER guia em
                            aberto — vencida ou não. É o "Pedir guia atualizada" que é restrito. */}
                        {podeConfirmarPagamento(guia) ? (
                          <button
                            type="button"
                            className="btn"
                            style={{ marginTop: 6 }}
                            disabled={confirmando}
                            /* ⚠ Abrir a caixa ZERA a data: a que sobrou de outra guia seria aceita por engano na
                               próxima, e ninguém veria — são pagamentos diferentes. */
                            onClick={() => { setRecusa(null); setPagoEm(""); setConfirmacao({ guia, aviso: avisoAntesDeConfirmar(guia) }); }}
                          >
                            Já paguei
                          </button>
                        ) : null}
                        {podePedirGuiaAtualizada(guia) ? (
                          <button
                            type="button"
                            className="btn"
                            style={{ marginTop: 6 }}
                            disabled={pedindo}
                            onClick={() => { setRecusa(null); setPedido({ guia, aviso: avisoAntesDePedir(guia) }); }}
                          >
                            Pedir guia atualizada
                          </button>
                        ) : null}
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
              Página {inteiro(paginaAtual)} de {inteiro(totalPaginas)} · {inteiro(total)} guia(s)
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
    </>
  );
}
