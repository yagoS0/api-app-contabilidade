// CONTABILIZAR VÁRIAS LINHAS DE UMA VEZ — o modal SOBRE a fila.
//
// > Dono, 25/08/2026: *"ai clicamos em importar e abre o modal para trabalharmos nele."*
//
// ⚠⚠ ELE FICA **SOBRE** A FILA, NUNCA NO LUGAR DELA. A fila é o objeto durável — paginação, recorte
// por competência, `porEstado`, pré-voo de mês fechado. O modal é um instrumento de trabalho em
// cima dela, e o precedente está na própria aba (`ModalDaVarredura`, `ModalDaAcao`).
//
// ⚠⚠ UMA COLUNA DE CONTA, NÃO DUAS — e a diferença para o modal de folha do escritório é
// deliberada: `montarLancamento` **crava** o crédito em `111010001` (medido, 155/155). Oferecer uma
// coluna de crédito prometeria liberdade que o servidor não tem, e o valor escolhido seria
// **descartado em silêncio**. Uma frase no cabeçalho diz que a contrapartida é o caixa.
//
// ⚠⚠ ELE NÃO DECIDE NADA. Quem separa o que entra do que fica de fora é `../lib/contabilizacaoEmLote.js`
// (puro, com teste próprio), que por sua vez REUSA o pré-voo da fila (`motivoDeBloqueio`) e a
// tradução de conta (`contaDaConferencia`). Uma segunda regra aqui faria o modal aceitar o que a
// linha recusa, e o servidor decidiria a divergência com um 409.

import { useCallback, useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import {
  FORA_DO_LOTE,
  FRASE_DO_FORA_DO_LOTE,
  aplicarEmMassa,
  contasIniciais,
  pendentes,
  planoDoEnvio,
  separarParaOLote,
} from "../lib/contabilizacaoEmLote";
import {
  ESTADO_DO_PLANO,
  FRASE_DO_MOTIVO_DA_CONTA,
  completoDoReduzido,
  contasOferecidas,
  motivoDoSeletorVazio,
  problemaDoCaixa,
} from "../lib/contaDaConferencia";
import { cnpjFormatado, dataCivil, dinheiro, leituraDaOrigemDoPagamento } from "../lib/conferenciaTela";

const LISTA_DE_CONTAS = "contas-do-lote";

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 12,
};

/** ⚠ Um `<input>` por linha, com a MESMA tradução do envio — a tela não valida por um caminho e
 * envia por outro. */
function CelulaDaConta({ id, valor, contas, onChange, desabilitado, deQuem }) {
  const traducao = useMemo(() => completoDoReduzido(valor, contas), [valor, contas]);
  return (
    <div style={{ display: "grid", gap: 2, minWidth: 150 }}>
      <input
        list={LISTA_DE_CONTAS}
        value={valor}
        disabled={desabilitado}
        onChange={(e) => onChange(id, e.target.value)}
        placeholder="reduzido — ex.: 401"
        // ⚠⚠ O NOME ACESSÍVEL NOMEIA A LINHA. Os vinte campos carregavam o MESMO rótulo — quem
        // navega por leitor de tela ouvia vinte campos idênticos, sem saber de qual fornecedor.
        // O dado que distingue já está na linha; só não era referenciado.
        aria-label={deQuem ? `Conta contábil da despesa — ${deQuem}` : "Conta contábil da despesa"}
        style={{
          width: "100%",
          ...(valor && traducao.motivo ? { borderColor: "var(--state-danger)" } : null),
        }}
      />
      {/* ⚠ O motivo da recusa é NOMEADO, na linha — nunca "conta inválida" numa barra no topo, que
          não diz de qual das vinte linhas está falando. */}
      {valor && traducao.motivo ? (
        <span style={{ fontSize: "0.72rem", color: "var(--state-danger)" }}>
          {FRASE_DO_MOTIVO_DA_CONTA[traducao.motivo]}
        </span>
      ) : traducao.conta ? (
        // ⚠ Conta aceita: a tela diz QUAL é, pelo nome. Código sozinho não se confere.
        <span style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>{traducao.conta.nome}</span>
      ) : null}
    </div>
  );
}

/** ⚠ O desfecho de UMA linha do envio. Vocabulário fechado — `null` é "ainda não tentada". */
const DESFECHO = Object.freeze({
  ENVIANDO: "enviando",
  OK: "ok",
  RECUSADA: "recusada",
  /**
   * ⚠⚠ NÃO SE SABE SE ESTA LINHA VIROU LANÇAMENTO — e chamá-la de "recusada" seria mentir.
   *
   * O pedido saiu da máquina e a resposta não voltou. Ela pode ter sido contabilizada. É o mesmo
   * desenho da camada `TRANSPORTE` da emissão em lote de NFS-e, e pela mesma razão: entre afirmar
   * um desfecho e dizer que não se sabe, quem não pode ceder é a verdade.
   */
  INDETERMINADA: "indeterminada",
});

/**
 * ⚠⚠ O TETO DE ESPERA POR LINHA — sem ele o modal podia TRANCAR PARA SEMPRE.
 *
 * Medido por agente adversarial em 27/08/2026: com um `aoEnviarLinha` que nunca assenta (conexão
 * pendurada — e o `realApi` não passa `signal` nem timeout ao `fetch`), o laço ficava preso na
 * primeira linha, `enviando` nunca voltava a `false`, e o `ocupado` do primitivo `Modal` desligava
 * as TRÊS saídas de uma vez (✕, Esc e clique no fundo), com o `Cancelar` também desabilitado.
 * **Só recarregando a página.**
 *
 * ⚠ 45 s é folgado de propósito: ele existe para o pendurado, não para a rede lenta.
 */
const TETO_POR_LINHA_MS = 45_000;

/** ⚠ Uma corrida contra o relógio que NÃO cancela a chamada — ela só deixa de ser esperada. */
function comTeto(promessa, ms) {
  let bater;
  const relogio = new Promise((_, rejeitar) => {
    bater = setTimeout(() => rejeitar(Object.assign(new Error("tempo esgotado"), { estourouOTeto: true })), ms);
  });
  return Promise.race([promessa, relogio]).finally(() => clearTimeout(bater));
}

export function ModalDeContabilizacao({
  itens,
  contas,
  // ⚠ O modal recebe os IDS já resolvidos, não a resposta de `getConferenciaCasamentos`. Quem lê a
  // forma daquela resposta é `debitosQueCasamComNota`, uma vez, na aba — duas leituras dela
  // divergiriam, e a chave dela (`linhas`, não `casamentos`) já divergiu uma vez no mock.
  idsQueCasam,
  podeEscrever,
  podeEscolherConta,
  estadoDoPlano = ESTADO_DO_PLANO.OK,
  totalDaFila,
  aoFechar,
  aoEnviarLinha,
  aoConcluir,
}) {
  const separado = useMemo(
    () => separarParaOLote(itens, { idsQueCasam, podeEscrever, podeEscolherConta }),
    [itens, idsQueCasam, podeEscrever, podeEscolherConta],
  );
  const [contasPorLinha, setContasPorLinha] = useState(() => contasIniciais(separado.dentro, contas));
  const [emMassa, setEmMassa] = useState("");
  const [soPendentes, setSoPendentes] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // ⚠⚠ SUCESSO PARCIAL É O DESFECHO NORMAL — cada linha guarda o SEU desfecho e o SEU motivo. Um
  // "falhou" único no topo esconderia que 18 das 20 entraram, e o contador reenviaria as 18.
  const [desfechos, setDesfechos] = useState({});

  const oferecidas = useMemo(() => contasOferecidas(contas), [contas]);
  /**
   * ⚠⚠ O CAIXA É A CONTRAPARTIDA CRAVADA, E TORTO ELE DERRUBA **TODA** LINHA DA EMPRESA.
   *
   * `montarLancamento` credita sempre `111010001` e recusa com `CAIXA_FORA_DO_PLANO`,
   * `CAIXA_AMBIGUO` ou `CAIXA_SINTETICO` — por mais certa que esteja a conta escolhida.
   *
   * ⚠ `ModalDaAcao` já antecipava isso na linha individual; o LOTE não, e agente de verificação
   * mediu a consequência em 27/08/2026: com o plano sem `111010001`, o botão dizia "Contabilizar 1",
   * habilitado e MUDO, e o lote disparava N POSTs para colher N recusas. Duas telas, a mesma regra,
   * respostas opostas.
   */
  const caixaTorto = useMemo(
    () => (estadoDoPlano === ESTADO_DO_PLANO.OK ? problemaDoCaixa(contas) : null),
    [contas, estadoDoPlano],
  );
  /** ⚠ E o seletor vazio nunca é mudo: "não veio plano nenhum" tem três causas e três consertos. */
  const seletorVazio = useMemo(() => motivoDoSeletorVazio(contas, estadoDoPlano), [contas, estadoDoPlano]);
  const plano = useMemo(() => planoDoEnvio(separado.dentro, contasPorLinha, contas), [separado.dentro, contasPorLinha, contas]);
  const faltam = pendentes(separado.dentro, contasPorLinha);
  /**
   * ⚠⚠ O QUE AINDA FALTA ENVIAR — e não o tamanho do plano.
   *
   * Achado NO NAVEGADOR em 27/08/2026 (o teste não pegou, porque ele media a chamada e não o
   * rótulo): com as quatro linhas contabilizadas, o botão continuava dizendo "Contabilizar 4",
   * habilitado, e o clique **não fazia nada**. Botão que não faz nada é pior que botão ausente — é
   * a mesma regra que o primitivo `Modal` já aplica ao ✕ quando `ocupado`.
   *
   * ⚠ Ele fica ANTES de `enviar`, e nas dependências dela: é o mesmo objeto que o rótulo conta e
   * que o laço percorre. Duas listas aqui fariam o botão prometer um número e enviar outro.
   */
  const aEnviar = useMemo(
    // ⚠ O caixa torto zera o plano inteiro: nenhuma linha desta empresa pode ser contabilizada
    // enquanto ele não for consertado, e o botão precisa dizer isso em vez de tentar.
    () => (caixaTorto ? [] : plano.enviar.filter((l) => desfechos[l.item.id]?.estado !== DESFECHO.OK)),
    [plano.enviar, desfechos, caixaTorto],
  );

  const trocarConta = useCallback((id, valor) => {
    setContasPorLinha((atual) => ({ ...atual, [id]: valor }));
  }, []);

  const aplicarNasPendentes = useCallback(() => {
    // ⚠ As LINHAS, não as chaves do mapa — é o que faz `faltam` e "aplicar" falarem do mesmo
    // conjunto. Ver o comentário de `aplicarEmMassa`.
    setContasPorLinha((atual) => aplicarEmMassa(atual, emMassa, separado.dentro).contas);
  }, [emMassa, separado.dentro]);

  /**
   * ⚠⚠ N CHAMADAS, UMA POR LINHA, SEQUENCIAIS — reusando `POST /conferencia/:id/confirmar`.
   *
   * Não há rota de lote, e ela não deve existir: uma obrigaria a pôr `reavaliarAprendizado` dentro
   * da `$transaction`, o que é proibido por texto neste projeto (*"uma falha ao criar a regra
   * desfaria o lançamento que ele acabou de confirmar"*).
   *
   * ⚠ Sequencial, não `Promise.all`: cada linha cria um `AccountingEntry` e dispara o aprendizado;
   * vinte transações concorrentes sobre a mesma empresa é o que a emissão em lote já recusou por
   * escrito.
   */
  const enviar = useCallback(async () => {
    setEnviando(true);
    // ⚠ `aEnviar` já exclui as concluídas: um segundo `confirmar` sobre linha CONTABILIZADA volta
    // recusado e se lê como "o lote falhou".
    for (const linha of aEnviar) {
      const id = linha.item.id;
      setDesfechos((d) => ({ ...d, [id]: { estado: DESFECHO.ENVIANDO } }));
      try {
        // ⚠⚠ O CORPO LEVA **SÓ** A CONTA. A data NÃO viaja: `lerPagamentoDoCorpo` decide por
        // `hasOwnProperty` e, com a chave presente, lê `body.origemPagamento ?? null` — mandar a data
        // sozinha volta `origem_de_pagamento_invalida`, e mandá-la COM a origem apaga o `OFX` e
        // transforma prova em declaração, em silêncio. Por isso o lote só admite linha que já tem
        // data (ver `PRECISA_DE_DATA`) e nunca reenvia a que ela tem.
        await comTeto(Promise.resolve(aoEnviarLinha(id, { contaAplicada: linha.contaCompleta })), TETO_POR_LINHA_MS);
        setDesfechos((d) => ({ ...d, [id]: { estado: DESFECHO.OK } }));
      } catch (e) {
        if (e?.estourouOTeto) {
          // ⚠⚠ DESFECHO DESCONHECIDO **PARA O LOTE**, e é o precedente da emissão em lote de NFS-e:
          // continuar depois de uma resposta que não voltou é seguir sem saber onde se está. As
          // linhas seguintes ficam `nao_tentada`, que é a verdade — ninguém encostou nelas.
          setDesfechos((d) => ({ ...d, [id]: { estado: DESFECHO.INDETERMINADA } }));
          break;
        }
        // ⚠ A recusa do SERVIDOR chega com o texto dela, na linha dela. Ele é quem sabe o que fazer.
        setDesfechos((d) => ({ ...d, [id]: { estado: DESFECHO.RECUSADA, frase: e?.message || "O servidor recusou esta linha." } }));
      }
    }
    setEnviando(false);
    // ⚠ A fila recarrega DEPOIS do laço inteiro, uma vez — recarregar por linha faria a lista
    // debaixo do modal se remontar vinte vezes.
    aoConcluir?.();
  }, [aEnviar, aoEnviarLinha, aoConcluir]);

  // ⚠ Os contadores olham as linhas QUE ESTÃO NA TABELA, não o mapa inteiro de desfechos — senão o
  // rodapé conta linhas que já saíram da fila. Achado por agente adversarial em 27/08/2026.
  const contar = (estado) => separado.dentro.filter((i) => desfechos[i.id]?.estado === estado).length;
  const concluidas = contar(DESFECHO.OK);
  const recusadas = contar(DESFECHO.RECUSADA);
  const indeterminadas = contar(DESFECHO.INDETERMINADA);
  const jaEnviou = concluidas + recusadas + indeterminadas > 0;

  const visiveis = soPendentes
    ? separado.dentro.filter((i) => !String(contasPorLinha[i.id] ?? "").trim())
    : separado.dentro;

  return (
    <Modal
      titulo={`Contabilizar em lote — ${separado.dentro.length} lançamento(s)`}
      tamanho="lg"
      ocupado={enviando}
      aoFechar={aoFechar}
      rodape={
        <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {jaEnviou
              ? `${concluidas} contabilizada(s)${recusadas ? ` · ${recusadas} recusada(s)` : ""}`
                + `${indeterminadas ? ` · ${indeterminadas} sem resposta` : ""}`
              : `${plano.enviar.length} pronta(s) · ${faltam} sem conta`}
          </span>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={aoFechar} disabled={enviando}>
            {jaEnviou ? "Fechar" : "Cancelar"}
          </Button>
          <Button
            variant="primary"
            disabled={enviando || aEnviar.length === 0}
            // ⚠ Botão desabilitado NUNCA é mudo — e os dois zeros pedem consertos diferentes:
            // "escolha uma conta" × "acabou, feche".
            title={
              aEnviar.length > 0 ? undefined
                // ⚠ O caixa vence os outros dois: ele é o impedimento que nenhuma escolha resolve.
                : caixaTorto ? caixaTorto
                  : plano.enviar.length > 0 ? "Todas as linhas com conta já foram contabilizadas."
                    : "Nenhuma linha tem conta escolhida ainda."
            }
            onClick={enviar}
          >
            {enviando ? "Contabilizando…" : `Contabilizar ${aEnviar.length}`}
          </Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        {/* ⚠⚠ A CONTRAPARTIDA É O CAIXA, E A TELA DIZ ISSO. Sem esta frase, a ausência de uma coluna
            de crédito parece esquecimento — e o contador procuraria onde escolhê-la. */}
        <div style={{ ...card, fontSize: "0.85rem", color: "var(--text-muted)" }}>
          Cada linha vira um lançamento: <strong>débito na conta que você escolher</strong>, crédito no
          caixa. A contrapartida não é escolhida aqui — ela é sempre o caixa.
          {/* ⚠⚠ O LIMITE DA EXCLUSÃO, DITO EM VEZ DE SUPOSTO. O casamento débito × nota só olha notas
              que ainda esperam pagamento (`AGUARDANDO_PAGAMENTO`, medido em `DeclaradoService`).
              Uma nota cujo pagamento você já informou à mão saiu dessa lista — então o débito do
              extrato que a paga NÃO é reconhecido aqui, e contabilizar os dois dobra a despesa.
              Enquanto a regra de casamento não alcançar esse caso, a tela avisa. */}
          <div style={{ marginTop: 6, color: "var(--state-warn)" }}>
            ⚠ Se você já informou o pagamento de alguma nota <strong>à mão</strong>, o débito do extrato
            que a pagou não é reconhecido como par dela — confira antes de contabilizar os dois.
          </div>
        </div>

        {/* ⚠⚠ O CAIXA TORTO E O PLANO AUSENTE APARECEM ANTES DA TABELA, não só no `title` do botão:
            `title` não aparece no teclado nem no toque (regra do `apps/web/CLAUDE.md`, duas vezes). */}
        {caixaTorto ? (
          <div role="alert" style={{ ...card, borderColor: "var(--state-danger)", color: "var(--state-danger)", fontSize: "0.85rem" }}>
            {caixaTorto}
          </div>
        ) : null}
        {seletorVazio ? (
          <div role="alert" style={{ ...card, borderColor: "var(--state-warn)", color: "var(--state-warn)", fontSize: "0.85rem" }}>
            {seletorVazio}
          </div>
        ) : null}

        {/* ⚠⚠ A FILA É PAGINADA E O MODAL SÓ VÊ A PÁGINA — e ele precisa dizer isso.
            Mesma classe do bloco `ForaDoLote`: número menor sem explicação faz o contador concluir
            que o sistema perdeu despesa. `Number.isFinite` porque `total` ausente não é zero. */}
        {Number.isFinite(Number(totalDaFila)) && Number(totalDaFila) > (itens?.length ?? 0) ? (
          <div style={{ ...card, borderColor: "var(--state-warn)", fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Este lote vê <strong>{itens.length}</strong> das <strong>{Number(totalDaFila)}</strong> linhas
            da fila — a fila é paginada. Reduza por competência ou por estado para alcançar as demais.
          </div>
        ) : null}

        {/* ⚠⚠ O QUE FICOU DE FORA APARECE, COM O MOTIVO. Uma fila de 40 virando um modal de 31 sem
            explicação faz o contador procurar as 9 que "sumiram". */}
        {separado.fora.length ? <ForaDoLote fora={separado.fora} /> : null}

        {separado.dentro.length === 0 ? (
          <div style={{ ...card, color: "var(--text-muted)" }}>
            Nenhuma linha desta fila pode ser contabilizada em lote agora. Os motivos estão acima.
          </div>
        ) : (
          <>
            {/* ⚠⚠ A APLICAÇÃO EM MASSA SÓ TOCA AS PENDENTES, e o rótulo do botão diz isso. Sobrescrever
                a conta que o contador digitou à mão é o estrago silencioso deste modal. */}
            <div style={{ ...card, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Aplicar nas linhas sem conta</span>
                <input
                  list={LISTA_DE_CONTAS}
                  value={emMassa}
                  disabled={enviando}
                  onChange={(e) => setEmMassa(e.target.value)}
                  placeholder="reduzido — ex.: 401"
                />
              </label>
              <Button
                size="sm"
                variant="secondary"
                disabled={!emMassa.trim() || faltam === 0 || enviando}
                title={faltam === 0 ? "Todas as linhas já têm conta." : `Preenche as ${faltam} linha(s) ainda em branco.`}
                onClick={aplicarNasPendentes}
              >
                Aplicar nas {faltam} em branco
              </Button>
              <span style={{ flex: 1 }} />
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.82rem" }}>
                <input type="checkbox" checked={soPendentes} disabled={enviando} onChange={(e) => setSoPendentes(e.target.checked)} />
                Mostrar só as sem conta
              </label>
            </div>

            {/* ⚠ `<datalist>` memoizado e único para o modal inteiro — um por linha seriam vinte
                cópias das mesmas 229 opções no DOM. */}
            <datalist id={LISTA_DE_CONTAS}>
              {oferecidas.map((c) => (
                <option key={c.codigo} value={c.codigo}>{c.nome}</option>
              ))}
            </datalist>

            <div style={{ overflowX: "auto" }}>
              <table className="tabela--densa">
                <thead>
                  <tr>
                    <th scope="col">Descrição</th>
                    <th scope="col">Pagamento</th>
                    <th className="tabela__num">Valor</th>
                    <th scope="col">Conta (débito)</th>
                    <th scope="col">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((item) => (
                    <LinhaDoLote
                      key={item.id}
                      item={item}
                      valor={contasPorLinha[item.id] ?? ""}
                      contas={contas}
                      desfecho={desfechos[item.id]}
                      desabilitado={enviando || desfechos[item.id]?.estado === DESFECHO.OK}
                      onChange={trocarConta}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* ⚠ As linhas que a TELA recusa antes de enviar, contadas e nomeadas — elas não somem
                da tabela, mas o rodapé precisa explicar por que o botão diz um número menor. */}
            {plano.recusadas.length ? (
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                {plano.recusadas.length} linha(s) não serão enviadas enquanto a conta não for resolvida.
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}

/** ⚠ Agrupado por MOTIVO: vinte linhas repetindo a mesma frase é ruído, e o motivo é o que importa. */
function ForaDoLote({ fora }) {
  const porMotivo = useMemo(() => {
    const mapa = new Map();
    for (const f of fora) {
      // ⚠ A frase do PRÉ-VOO vence a genérica quando existe — ela nomeia o conserto (reabrir o mês,
      // definir a competência, corrigir a regra). Duas leituras do mesmo motivo divergiriam.
      const frase = f.frase || FRASE_DO_FORA_DO_LOTE[f.motivo] || "";
      const chave = `${f.motivo}|${frase}`;
      if (!mapa.has(chave)) mapa.set(chave, { motivo: f.motivo, frase, itens: [] });
      mapa.get(chave).itens.push(f.item);
    }
    return [...mapa.values()];
  }, [fora]);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {porMotivo.map((g) => (
        <div
          key={`${g.motivo}|${g.frase}`}
          style={{
            ...card,
            // ⚠⚠ `--state-warn`, nunca `--state-danger`: ficar de fora do lote não é erro. Vermelho
            // nesta casa bloqueia o fechamento contábil.
            borderColor: g.motivo === FORA_DO_LOTE.CASA_COM_NOTA ? "var(--state-warn)" : "var(--border)",
          }}
        >
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{g.frase}</div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-faint)", marginTop: 4 }}>
            {g.itens.length} linha(s): {g.itens.slice(0, 4).map((i) => i.descricaoOriginal).join(" · ")}
            {g.itens.length > 4 ? ` · e mais ${g.itens.length - 4}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function LinhaDoLote({ item, valor, contas, desfecho, desabilitado, onChange }) {
  const origem = leituraDaOrigemDoPagamento(item.origemPagamento);
  return (
    <tr>
      <td>
        <div style={{ display: "grid", gap: 2 }}>
          <span>{item.descricaoOriginal}</span>
          {item.cnpjFornecedor ? (
            <span style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>{cnpjFormatado(item.cnpjFornecedor)}</span>
          ) : null}
        </div>
      </td>
      <td>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <span>{dataCivil(item.dataPagamento)}</span>
          {/* ⚠⚠ A PROCEDÊNCIA DA DATA VIAJA ATÉ AQUI. Sem ela, uma data do extrato e uma declarada
              pelo contador ficam idênticas — e o lote é justamente onde se olha vinte de uma vez. */}
          <span
            style={{
              fontSize: "0.7rem",
              color: origem.ehProva ? "var(--text-faint)" : "var(--state-warn)",
              fontWeight: origem.ehProva ? 400 : 600,
            }}
          >
            {origem.rotulo}
          </span>
        </span>
      </td>
      <td className="tabela__num">{dinheiro(item.valorAjustado ?? item.valor)}</td>
      <td>
        <CelulaDaConta id={item.id} valor={valor} contas={contas} onChange={onChange} desabilitado={desabilitado} deQuem={item.descricaoOriginal} />
      </td>
      <td>
        {desfecho?.estado === DESFECHO.OK ? (
          <span style={{ color: "var(--state-ok)", fontSize: "0.8rem" }}>contabilizada</span>
        ) : desfecho?.estado === DESFECHO.ENVIANDO ? (
          <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>enviando…</span>
        ) : desfecho?.estado === DESFECHO.INDETERMINADA ? (
          // ⚠⚠ ÂMBAR, NUNCA VERMELHO — e nunca "recusada". O pedido saiu e a resposta não voltou:
          // esta linha PODE ter virado lançamento. A frase manda conferir, não repetir.
          <span role="alert" style={{ color: "var(--state-warn)", fontSize: "0.75rem" }}>
            sem resposta — pode ter sido contabilizada. Feche e atualize a fila para ver.
          </span>
        ) : desfecho?.estado === DESFECHO.RECUSADA ? (
          // ⚠ O motivo do SERVIDOR, na linha dele — não numa barra genérica no topo.
          <span role="alert" style={{ color: "var(--state-danger)", fontSize: "0.75rem" }}>{desfecho.frase}</span>
        ) : (
          <span style={{ color: "var(--text-faint)", fontSize: "0.8rem" }}>—</span>
        )}
      </td>
    </tr>
  );
}
