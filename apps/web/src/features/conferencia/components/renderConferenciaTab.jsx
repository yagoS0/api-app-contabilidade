// A ABA CONFERÊNCIA — a nota recebida vira despesa, o extrato vira o pagamento dela.
//
// ⚠ ONDE ELA VIVE, E POR QUÊ: dentro da EMPRESA, no grupo **Contabilidade**, logo depois de
// Lançamentos. Ela não é fiscal — o que sai daqui é `AccountingEntry`, e o contador chega nela
// vindo de Lançamentos, não de Notas Fiscais.
//
// ⚠⚠ ESTA TELA NÃO DECIDE NADA. Quem diz se uma transição pode acontecer é `aplicarTransicao`, no
// servidor, que enxerga o estado do instante do clique. O que mora no front é a LEITURA
// (`../lib/conferenciaTela.js`, com teste próprio): rótulo, cor, ordem, e qual botão sequer
// aparece. Reimplementar a regra aqui faria a tela oferecer o que o servidor recusa.
//
// ⚠⚠ E ELA NÃO OFERECE "ANEXAR COMPROVANTE". `AnexoDeclarado` existe no schema e **não tem
// escritor** — nenhuma rota, nenhum serviço. Desenhar o botão prometeria um caminho que não existe.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "../../../api/client";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { ModalDaVarredura } from "./ModalDaVarredura";
import { ModalDeContabilizacao } from "./ModalDeContabilizacao";
import { PainelDeCasamentos } from "./PainelDeCasamentos";
// ⚠⚠ A RECORRÊNCIA NÃO É ABA — decisão do dono (*"muitas abas"*, 24/08/2026). O plano manda a
// marcação morar na LINHA DO FLUXO e as declarações pendentes do cliente entrarem na fila da
// Conferência; enquanto o fluxo (Fase E) não existe, o painel vive aqui, que é a mesma fila de
// "coisas para o contador confirmar". ⚠ A feature é PRÓPRIA para o fluxo importá-la depois.
import { PainelDeRecorrencias } from "../../recorrencia/components/PainelDeRecorrencias";
import { PainelDeSaidasDoCliente } from "./PainelDeSaidasDoCliente";
import { PainelDeMexidasDoCliente } from "./PainelDeMexidasDoCliente";
import { PainelDeLancadosPorRegra } from "./PainelDeLancadosPorRegra";
import { PainelDeRegras } from "./PainelDeRegras";
import { NATUREZA, SECAO, origemDaLinha } from "../lib/naturezaDaConferencia";
import { debitosQueCasamComNota } from "../lib/contabilizacaoEmLote";
import {
  ACAO,
  COMPETENCIA_AUSENTE,
  ORIGEM_PAGAMENTO,
  acaoPedeData,
  acoesDaLinha,
  agruparPorFornecedor,
  cnpjFormatado,
  contaQueSeraUsada,
  contagemParaTela,
  dataCivil,
  dataSugeridaParaPagamento,
  dinheiro,
  leituraDaOrigemDoPagamento,
  leituraDoDocumento,
  leituraDoEstado,
  ROTULO_CURTO_DO_MOTIVO,
  motivoDeBloqueio,
  variantDoTom,
} from "../lib/conferenciaTela";
import {
  ESTADO_DO_PLANO,
  FRASE_DO_MOTIVO_DA_CONTA,
  completoDoReduzido,
  contasOferecidas,
  motivoDoSeletorVazio,
  problemaDoCaixa,
  reduzidoDoCompleto,
} from "../lib/contaDaConferencia";

// Mesmo padrão da aba de Auditoria e do SITFIS: a aba faz a própria chamada, porque não há `api` no
// escopo do detalhe da empresa para estas rotas.
const conferenciaApi = createApiClient();

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};

/**
 * ⚠⚠ A MOLDURA QUE RESPONDE AO PEDIDO DO DONO — *"separe visualmente o que são regras, saídas do
 * cliente, o que é para virar lançamento e o que é para o fluxo"*.
 *
 * A tela tinha SEIS painéis mais a fila, todos com o MESMO `card` neutro, empilhados num `grid` sem
 * um único título: nada dizia que confirmar numa caixa cria lançamento contábil e na caixa de cima
 * não cria nada. A seção diz.
 *
 * ⚠ SEM COR DE ESTADO, e isso é a regra da casa, não economia: `--state-danger` bloqueia
 * fechamento, verde é concluído, âmbar é pendência — e uma seção não é nenhuma das três. Ela se
 * distingue por **título + frase + uma barra de `--border`**. Pintá-la com um token de estado faria
 * a tela inteira gritar uma cor que significa outra coisa.
 *
 * ⚠ O TEXTO NÃO MORA AQUI: vem de `lib/naturezaDaConferencia.js`, e é o texto que a tela JÁ dizia
 * (a frase do modal de confirmação e a do painel de saídas). Redigir de novo aqui faria a mesma
 * tela afirmar duas coisas sobre o mesmo ato.
 */
function SecaoDaConferencia({ natureza, children }) {
  const { titulo, frase } = SECAO[natureza];
  return (
    // ⚠ `<section>` com `aria-label`, não um `<div>`: quem navega por leitor de tela pula de região
    // em região, e a separação que o dono pediu tem de existir também para quem não a vê.
    <section
      aria-label={titulo}
      style={{ display: "grid", gap: 16, borderLeft: "2px solid var(--border)", paddingLeft: 16 }}
    >
      <div style={{ display: "grid", gap: 2 }}>
        <strong style={{ fontSize: "0.95rem" }}>{titulo}</strong>
        {/* ⚠ A frase é do CORPO, nunca `title`: ela diz se o clique mexe na contabilidade, e
            `title` não aparece no teclado nem no toque. */}
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{frase}</span>
      </div>
      {children}
    </section>
  );
}

function Selo({ token, children, title, onClick, ativo }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      title={title}
      type={onClick ? "button" : undefined}
      onClick={onClick}
      style={{
        cursor: onClick ? "pointer" : undefined,
        // ⚠ O selo ATIVO se distingue pela ESPESSURA da borda, não por outra cor: trocar a cor
        // quebraria a lei de estado (o token diz o que a linha É, não se ela está selecionada).
        outline: ativo ? `2px solid var(${token})` : undefined,
        outlineOffset: ativo ? 1 : undefined,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 12,
        // ⚠ O par `-surface` do token, NUNCA `${cor}22` — concatenar hex quebra em silêncio assim
        // que a cor vira `var(--…)` (regra do `apps/web/CLAUDE.md`).
        background: `var(${token}-surface)`,
        color: `var(${token})`,
        border: `1px solid var(${token})`,
        fontSize: "0.78rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * ⚠⚠ A PROCEDÊNCIA DA DATA, à vista na linha.
 *
 * Sem isto, uma data vinda do extrato e uma data que o contador digitou ficam **idênticas** na tela
 * — e a decisão do dono de 24/08/2026 (lançar sem comprovante) transforma essa indistinção em
 * afirmação falsa sobre quando a empresa pagou.
 */
function DataComProcedencia({ item }) {
  const origem = leituraDaOrigemDoPagamento(item.origemPagamento);
  if (!item.dataPagamento) {
    return (
      <span style={{ color: "var(--text-faint)" }} title={origem.frase}>
        —
      </span>
    );
  }
  return (
    <span title={origem.frase} style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <span>{dataCivil(item.dataPagamento)}</span>
      <span
        style={{
          fontSize: "0.72rem",
          // ⚠ `--text-faint` e não `#6b7280`: aquele hex mede 3,10:1 e está PROIBIDO como tinta.
          color: origem.ehProva ? "var(--text-faint)" : "var(--state-warn)",
          fontWeight: origem.ehProva ? 400 : 600,
        }}
      >
        {origem.rotulo}
      </span>
    </span>
  );
}

/**
 * ⚠⚠ O CORPO QUE VAI AO SERVIDOR — e ele já esteve ERRADO de um jeito que quebrava tudo.
 *
 * Achado por auditoria em 25/08/2026: a tela mandava `dataPagamento` SEMPRE (o modal a
 * pré-preenche) e **nunca** `origemPagamento`. Do outro lado, `lerPagamentoDoCorpo` decide por
 * `hasOwnProperty("dataPagamento")`: com a chave presente, ele lê `body.origemPagamento ?? null` e
 * **ignora a procedência que a linha já tinha**. `conferirPagamento` então recusa `null` com
 * `origem_de_pagamento_invalida`.
 *
 * ⚠⚠ Efeito: **CONFIRMAR falhava em produção para toda linha** — inclusive as que já tinham data
 * provada pelo extrato. E funcionava offline, porque o mock só ecoa o corpo. Só apareceria depois
 * do deploy.
 *
 * As duas regras que consertam isso:
 *
 * 1. ⚠ **A data só viaja quando a tela de fato a PEDIU** (`acaoPedeData`). Se a linha já tem data,
 *    não se manda nada — o servidor usa a que existe, com a procedência que ela já tem. Mandar a
 *    mesma data de volta apagaria o `OFX` e a transformaria em declaração.
 * 2. ⚠⚠ **Quando a data viaja, a procedência viaja junto — e é `DECLARADO_PELO_CONTADOR`.** É a
 *    verdade do ato: a tela só pergunta a data quando ninguém a provou, e o que a pessoa digita é
 *    declaração, não prova. Deixar o servidor adivinhar é o que produziu o defeito.
 */
export function montarCorpo({ acao, item, data, motivo, valor, cfg, contaCompleta = null }) {
  const corpo = {};
  if (acaoPedeData(acao, item) && data) {
    corpo.dataPagamento = data;
    corpo.origemPagamento = ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR;
  }
  if (cfg?.pedeMotivo && motivo) corpo.motivoRecusa = motivo;
  if (cfg?.pedeValor && valor) corpo.valorAjustado = valor;
  // ⚠⚠ A CONTA QUE O CONTADOR ESCOLHEU — em `codigoCompleto`, já traduzida pelo modal.
  //
  // Ela vence a sugestão porque é o ato dele; sem escolha, cai na sugestão derivada, que é o
  // comportamento de antes do seletor. ⚠ NUNCA string vazia: `""` cairia em `sem_conta` no servidor
  // e a tela descobriria a regra pelo erro — por isso `completoDoReduzido` devolve `null` + motivo.
  if (cfg?.criaLancamento) {
    const conta = contaCompleta || item?.sugestao?.conta || null;
    if (conta) corpo.contaAplicada = conta;
  }
  return corpo;
}

/** ⚠ O modal pergunta o que a ação precisa ANTES de enviar — a tela não descobre a regra pelo erro. */
function ModalDaAcao({ acao, item, contas, estadoDoPlano, ocupado, aviso, onFechar, onConfirmar }) {
  const cfg = ACAO[acao];
  const [data, setData] = useState(() => dataSugeridaParaPagamento(item));
  const [motivo, setMotivo] = useState("");
  const [valor, setValor] = useState(() => String(item?.valorAjustado ?? item?.valor ?? ""));
  // ⚠⚠ O CAMPO NASCE COM A SUGESTÃO, TRADUZIDA PARA O REDUZIDO — que é o número que o contador
  // reconhece. Mostrar `411020008` seria pôr a âncora interna na frente de quem nunca a viu.
  // ⚠ Sugestão ausente ⇒ campo VAZIO, nunca "a primeira conta do plano": eleger seria o sistema
  // decidindo em que conta a despesa entra, que é a decisão do contador.
  const [conta, setConta] = useState("");
  // ⚠ Quem responde "por que o campo não veio preenchido?" — `FORA_DO_PLANO` e `COMPLETO_AMBIGUO`
  // eram TEXTO MORTO: o motivo de `reduzidoDoCompleto` era descartado com `.valor || ""` e o campo
  // ficava vazio e mudo. Achado por agente de verificação em 26/08/2026.
  const daSugestao = useMemo(
    () => reduzidoDoCompleto(item?.sugestao?.conta || item?.contaSugerida, contas),
    [item, contas],
  );

  // ⚠⚠ O PLANO PODE CHEGAR DEPOIS DO MODAL ABRIR, e o `useState` inicializador roda UMA vez: o campo
  // nascia vazio e ficava vazio para sempre, com a sugestão evaporada em silêncio. Este efeito
  // preenche quando a tradução passa a existir — e só enquanto o contador não digitou nada, senão
  // ele sobrescreveria a escolha dele.
  const tocado = useRef(false);
  useEffect(() => {
    if (tocado.current) return;
    if (daSugestao.valor) setConta(daSugestao.valor);
  }, [daSugestao.valor]);

  const pedeConta = Boolean(cfg?.criaLancamento);
  const oferecidas = useMemo(() => contasOferecidas(contas), [contas]);
  const seletorVazio = useMemo(() => motivoDoSeletorVazio(contas, estadoDoPlano), [contas, estadoDoPlano]);
  const caixaTorto = useMemo(
    () => (estadoDoPlano === ESTADO_DO_PLANO.OK ? problemaDoCaixa(contas) : null),
    [contas, estadoDoPlano],
  );
  // ⚠ A tradução é a MESMA que vai ao POST — a tela não pode validar por um caminho e enviar por
  // outro. `traducao.motivo` é o que o campo mostra em vermelho.
  const traducao = useMemo(() => completoDoReduzido(conta, contas), [conta, contas]);

  const pedeData = acaoPedeData(acao, item);
  // ⚠ A recusa exige motivo não-vazio (o servidor devolve `sem_motivo`). Ausência nunca é resposta.
  const faltaMotivo = cfg?.pedeMotivo && !motivo.trim();
  const faltaData = pedeData && !data;
  const faltaConta = pedeConta && !traducao.valor;
  // ⚠⚠ `pedeValor` NÃO tinha guarda — achado por agente adversarial. Campo apagado, `"0"` ou `"-5"`
  // deixavam o botão HABILITADO, e `podeTransitar` recusava com `valor_ajustado_invalido`: a tela
  // descobrindo a regra pelo erro. O critério é o do servidor — número finito maior que zero.
  const valorNumero = Number(String(valor).replace(",", "."));
  const faltaValor = Boolean(cfg?.pedeValor) && !(Number.isFinite(valorNumero) && valorNumero > 0);
  // ⚠ O caixa é a contrapartida CRAVADA: torto, ele derruba a linha por mais certa que esteja a
  // conta escolhida.
  const podeEnviar = !faltaData && !faltaMotivo && !faltaConta && !faltaValor && !caixaTorto;

  return (
    <Modal
      titulo={`${cfg?.rotulo || acao} — ${item?.descricaoOriginal || ""}`}
      tamanho="md"
      ocupado={ocupado}
      aoFechar={onFechar}
      // ⚠ O `rodape` é do primitivo — os botões ficam fora do corpo que rola, senão o "confirmar"
      // some abaixo da dobra do próprio diálogo (o defeito dos ~40 modais escritos à mão).
      rodape={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onFechar} disabled={ocupado}>Cancelar</Button>
          <Button
            variant={variantDoTom(cfg?.tom)}
            disabled={!podeEnviar || ocupado}
            // ⚠ Botão desabilitado NUNCA é mudo — o motivo vai no `title`.
            title={
              faltaData ? "Informe a data do pagamento."
                : faltaMotivo ? "Escreva o motivo da recusa."
                  // ⚠ O motivo da tradução vence o genérico: "não existe no plano" e "é sintética"
                  // pedem consertos diferentes, e o campo já os nomeia.
                  : caixaTorto ? caixaTorto
                    : faltaValor ? "Informe um valor maior que zero."
                      : faltaConta ? (traducao.motivo ? FRASE_DO_MOTIVO_DA_CONTA[traducao.motivo] : "Escolha a conta contábil da despesa.")
                        : undefined
            }
            onClick={() => onConfirmar(montarCorpo({ acao, item, data, motivo, valor, cfg, contaCompleta: traducao.valor }))}
          >
            {ocupado ? "Enviando…" : cfg?.rotulo}
          </Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        {/* ⚠⚠ A RECUSA DO SERVIDOR APARECE AQUI DENTRO — achado por auditoria em 25/08/2026.
            Ela era desenhada no corpo da aba, ou seja **atrás do overlay do modal** (`.modal-fundo`
            é `position: fixed` com `z-index: 1000` e um scrim escuro), e o modal continua aberto
            quando a ação falha. O contador via o botão piscar "Enviando…", voltar, e nada mudar —
            exatamente o sintoma "o botão não faz nada" que o `CLAUDE.md` do web já nomeia. */}
        {aviso ? (
          <div
            role="alert"
            style={{
              ...card,
              borderColor: "var(--state-danger)",
              color: "var(--state-danger)",
              fontSize: "0.88rem",
            }}
          >
            {aviso}
          </div>
        ) : null}

        {/* ⚠ A confirmação REPETE OS DADOS. "Tem certeza?" não é confirmação: aprende-se a clicar
            sem ler, e o clique na linha errada recebe a mesma pergunta que o clique na certa. */}
        <div style={{ ...card, display: "grid", gap: 4, fontSize: "0.88rem" }}>
          <div><strong>{item?.descricaoOriginal}</strong></div>
          {item?.cnpjFornecedor ? <div style={{ color: "var(--text-muted)" }}>{cnpjFormatado(item.cnpjFornecedor)}</div> : null}
          <div style={{ color: "var(--text-muted)" }}>
            {dinheiro(item?.valorAjustado ?? item?.valor)}
            {item?.competencia ? ` · competência ${item.competencia}` : " · sem competência"}
          </div>
        </div>

        {/* ⚠⚠ O SELETOR DE CONTA — o pedido do dono: *"o contador deve poder selecionar a conta das
            notas, e deve ser salvo dessa forma"*. Ele digita e lê o REDUZIDO; o POST leva o
            `codigoCompleto`, traduzido aqui no submit. */}
        {pedeConta ? (
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Conta contábil da despesa</span>
            <input
              list="contas-da-conferencia"
              value={conta}
              onChange={(e) => { tocado.current = true; setConta(e.target.value); }}
              placeholder="código reduzido — ex.: 401"
              autoFocus={!pedeData}
              // ⚠ Campo com valor RECUSADO fica vermelho na hora, não só no clique.
              style={traducao.motivo ? { borderColor: "var(--state-danger)" } : undefined}
            />
            {/* ⚠⚠ A lista OFERECE só o que o servidor aceitaria: fora as sintéticas (ele recusa com
                `CONTA_SINTETICA`) e fora as sem `codigoCompleto` (viram `CONTA_FORA_DO_PLANO`).
                Oferecer qualquer uma das duas é a tela propondo o que o clique nega. */}
            <datalist id="contas-da-conferencia">
              {oferecidas.map((c) => (
                <option key={c.codigo} value={c.codigo}>{c.nome}</option>
              ))}
            </datalist>

            {/* ⚠⚠ POR QUE O CAMPO VEIO VAZIO — a sugestão existe e não traduziu. Sem isto,
                `FORA_DO_PLANO` e `COMPLETO_AMBIGUO` eram texto morto: o campo ficava vazio e mudo, e
                o contador não tinha como saber que HAVIA uma conta conhecida. */}
            {!conta && daSugestao.motivo ? (
              <span style={{ fontSize: "0.78rem", color: "var(--state-warn)" }}>
                {FRASE_DO_MOTIVO_DA_CONTA[daSugestao.motivo]}
              </span>
            ) : null}

            {/* ⚠ O motivo da recusa da tradução, NOMEADO — nunca "conta inválida". */}
            {traducao.motivo ? (
              <span style={{ fontSize: "0.78rem", color: "var(--state-danger)" }}>
                {FRASE_DO_MOTIVO_DA_CONTA[traducao.motivo]}
              </span>
            ) : traducao.conta ? (
              // ⚠ Conta aceita: a tela diz QUAL é, pelo nome. Código sozinho não se confere.
              <span style={{ fontSize: "0.78rem", color: "var(--text-faint)" }}>
                {traducao.conta.nome}
              </span>
            ) : null}

            {/* ⚠⚠ A PROCEDÊNCIA DA SUGESTÃO, à vista — *"por que este campo veio preenchido?"* é a
                pergunta que o contador faz, e responder é o que torna a sugestão conferível em vez
                de mágica. Mesmo desenho da procedência da data, logo abaixo. */}
            {item?.sugestao?.frase ? (
              <span style={{ fontSize: "0.78rem", color: "var(--text-faint)" }}>
                {item.sugestao.frase}
              </span>
            ) : null}

            {/* ⚠⚠ SELETOR VAZIO NÃO PODE SER MUDO — sem isto, o contador conclui que o sistema
                perdeu o plano de contas. Três motivos, três consertos. */}
            {/* ⚠⚠ O CAIXA É A CONTRAPARTIDA CRAVADA (`111010001`). Torto, ele derruba a linha por
                mais certa que esteja a conta escolhida — e a tela nunca dizia isso. */}
            {caixaTorto ? (
              <span role="alert" style={{ fontSize: "0.78rem", color: "var(--state-danger)" }}>
                {caixaTorto}
              </span>
            ) : null}

            {seletorVazio ? (
              <span role="alert" style={{ fontSize: "0.78rem", color: "var(--state-warn)" }}>
                {seletorVazio}
              </span>
            ) : null}
          </label>
        ) : null}

        {pedeData ? (
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Data do pagamento</span>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} autoFocus />
            {/* ⚠⚠ A frase diz que isto é DECLARAÇÃO. A data nasce sugerida com a EMISSÃO da nota —
                nunca com "hoje", que é a data do clique. */}
            <span style={{ fontSize: "0.78rem", color: "var(--text-faint)" }}>
              Sem comprovante, esta data é uma <strong>declaração sua</strong>, não uma prova. Ela fica
              registrada como tal. Vindo do extrato importado, ela é preenchida sozinha.
            </span>
          </label>
        ) : null}

        {cfg?.pedeValor ? (
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Valor a lançar</span>
            <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
            <span style={{ fontSize: "0.78rem", color: "var(--text-faint)" }}>
              O valor original da nota não é alterado — o ajuste fica registrado ao lado dele.
            </span>
          </label>
        ) : null}

        {cfg?.pedeMotivo ? (
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Motivo da recusa</span>
            <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
            <span style={{ fontSize: "0.78rem", color: "var(--text-faint)" }}>
              Obrigatório. Recusar pode ser desfeito depois — a linha volta para a fila.
            </span>
          </label>
        ) : null}

        {cfg?.criaLancamento ? (
          <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Isto cria um lançamento contábil: débito na conta da despesa, crédito no caixa.
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * ⚠⚠ QUAL CONTA SERÁ USADA, E DE ONDE ELA VEIO.
 *
 * A procedência importa tanto quanto o número: *"uma regra deste fornecedor"* e *"você já lançou
 * assim antes"* pedem conferências diferentes. E `FORA_DA_FAIXA` é **sinal, não silêncio** — é o
 * caso que a faixa existe para pegar (fornecedor conhecido, valor 10× fora do normal).
 */
function ContaSugerida({ item }) {
  const conta = contaQueSeraUsada(item);
  const s = item?.sugestao;

  if (!conta) {
    return (
      <span
        style={{ color: "var(--state-warn)", fontSize: "0.8rem" }}
        title={s?.frase || "Nenhuma regra e nenhum histórico conhecem esta despesa."}
      >
        {/* ⚠⚠ NEM TODO `conta: null` É "NÃO SEI". `fora_da_faixa`, `conta_sintetica` e
            `conta_ambigua` são "SEI, e o que está gravado não serve" — e o conserto de cada um é
            outro. Chamar os três de "sem conta" manda o contador procurar do zero e deixa a regra
            torta no lugar. ⚠ O rótulo mora em `lib/`, com o texto longo e o motivo do bloqueio:
            três leituras do mesmo motivo divergiriam na primeira correção. */}
        {ROTULO_CURTO_DO_MOTIVO[s?.motivo] || "sem conta"}
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }} title={s?.frase || undefined}>
      <span>{conta}</span>
      {s?.procedencia ? (
        <span style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>
          {s.procedencia === "REGRA_CNPJ" ? "regra do fornecedor" : s.procedencia === "REGRA_DESCRICAO" ? "regra da descrição" : "seu histórico"}
        </span>
      ) : null}
    </span>
  );
}

/**
 * ⚠ As frases DISTINTAS de bloqueio das ações desta linha.
 *
 * Distintas porque três botões bloqueados pelo mesmo mês fechado dariam a mesma frase três vezes.
 * A leitura é a MESMA de `motivoDeBloqueio` — uma segunda regra aqui faria o texto visível e o
 * `title` discordarem sobre a mesma linha.
 */
function motivosDeBloqueioVisiveis(acoes, item, opcoes) {
  const vistas = [];
  for (const acao of acoes) {
    const frase = motivoDeBloqueio(acao, item, opcoes);
    if (frase && !vistas.includes(frase)) vistas.push(frase);
  }
  return vistas;
}

function LinhaDoDeclarado({ item, podeEscrever, podeEscolherConta, onAgir }) {
  const estado = leituraDoEstado(item.estado);
  const doc = leituraDoDocumento(item);
  const acoes = acoesDaLinha(item);
  // ⚠⚠ É ISTO QUE RESPONDE "saídas do cliente" DENTRO da fila, sem duplicar a linha. A coluna
  // `origem` existe no model desde sempre, já viajava no serializador da rota, e **não aparecia em
  // lugar nenhum da tela**: a fila é homogênea por construção (toda linha é um `LancamentoDeclarado`),
  // então a heterogeneidade que o dono quer ver não está na tabela — está neste campo.
  const origem = origemDaLinha(item);

  return (
    <tr>
      <td>
        <div style={{ display: "grid", gap: 2 }}>
          <span>{item.descricaoOriginal}</span>
          {origem ? (
            // ⚠ Chip NEUTRO, e de propósito: de onde a despesa veio é PROCEDÊNCIA, não estado — não
            // pede ação nem diz que algo está concluído. Cor de estado aqui competiria com os selos
            // que dizem o que fazer. Mesmo argumento das pílulas de configuração da carteira.
            <span
              title={origem.titulo}
              style={{
                justifySelf: "start",
                fontSize: "0.7rem",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "0 6px",
              }}
            >
              {origem.rotulo}
            </span>
          ) : null}
          {item.detalheServico ? (
            // ⚠ `xDescServ` é DETALHE, nunca substituto do histórico: o histórico do lançamento é o
            // nome do fornecedor (medido nos 130 lançamentos do Excel).
            <span style={{ fontSize: "0.75rem", color: "var(--text-faint)" }}>{item.detalheServico}</span>
          ) : null}
        </div>
      </td>
      <td>
        {doc.temDocumento ? (
          <span title={doc.chaveAcesso || undefined}>{doc.rotulo}</span>
        ) : (
          // ⚠ Não some: diz por quê. Sumir faria parecer que nunca houve documento.
          <span style={{ color: "var(--text-faint)" }} title={doc.motivo}>—</span>
        )}
      </td>
      <td>{dataCivil(item.dataDocumento)}</td>
      <td><DataComProcedencia item={item} /></td>
      <td>
        {/* ⚠⚠ A SUGESTÃO DE CONTA (Fase C) — ela era calculada a cada leitura e NUNCA chegava à
            tela: o serializador da rota a descartava, e a tela não a lia. Duas camadas de trabalho
            invisível, achadas por auditoria em 25/08/2026. */}
        <ContaSugerida item={item} />
      </td>
      <td className="tabela__num">
        {dinheiro(item.valorAjustado ?? item.valor)}
        {item.valorAjustado ? (
          <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>
            original {dinheiro(item.valor)}
          </div>
        ) : null}
      </td>
      <td>
        {item.competencia || (
          <span style={{ color: "var(--state-warn)" }} title="Esta nota chegou sem competência e não é atribuída a mês nenhum.">
            sem competência
          </span>
        )}
      </td>
      <td><Selo token={estado.token} title={estado.frase}>{estado.rotulo}</Selo></td>
      <td>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {acoes.map((acao) => {
            const bloqueio = motivoDeBloqueio(acao, item, { podeEscrever, podeEscolherConta });
            return (
              <Button
                key={acao}
                size="sm"
                variant={variantDoTom(ACAO[acao].tom)}
                disabled={Boolean(bloqueio)}
                // ⚠⚠ O botão fica VISÍVEL e desabilitado, com o motivo — botão que some esconde que
                // a ação existe, e botão mudo não diz se é permissão, mês fechado ou defeito.
                // ⚠ O `title` é REFORÇO, nunca a única via: o texto sai visível logo abaixo.
                title={bloqueio || undefined}
                onClick={() => onAgir(acao, item)}
              >
                {ACAO[acao].rotulo}
              </Button>
            );
          })}
        </div>
        {/* ⚠⚠ O MOTIVO SAI VISÍVEL, e isto é conserto de defeito real — achado por agente
            adversarial em 26/08/2026. Ele vivia SÓ no `title`, e o `CLAUDE.md` deste app rejeita
            essa forma DUAS vezes, com a mesma frase: *"`title` não aparece no teclado nem no
            toque"*. Dois dos quatro motivos (mês fechado, papel insuficiente) não tinham eco
            nenhum na tela — numa competência fechada o contador via uma coluna inteira de botões
            cinzas e ZERO explicação.
            ⚠ Uma linha só, e só na linha BLOQUEADA: em regime normal ela não existe, então não
            vira ruído. E é `--text-faint`, não `--state-danger`: bloqueio aqui não é erro. */}
        {motivosDeBloqueioVisiveis(acoes, item, { podeEscrever, podeEscolherConta }).map((frase) => (
          <div
            key={frase}
            style={{
              fontSize: "0.72rem",
              color: "var(--text-faint)",
              textAlign: "right",
              marginTop: 4,
              maxWidth: 320,
              marginLeft: "auto",
            }}
          >
            {frase}
          </div>
        ))}
      </td>
    </tr>
  );
}

export function ConferenciaTab({ companyId, competencia, podeEscrever = true, aoVoltar }) {
  const [fila, setFila] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [recorte, setRecorte] = useState("competencia");
  // ⚠⚠ SEM ISTO, O PAINEL PROMETE UM NÚMERO SEM PORTA PARA ELE. A fila mostra por padrão só o que
  // espera alguém (`AGUARDANDO_PAGAMENTO` + `A_CONFERIR`) — mas a contagem mostra os CINCO estados.
  // "Contabilizado: 1" sem caminho para vê-lo é o defeito que este projeto documenta em outras
  // telas: o contador vê o número, não acha a linha, e conclui que o sistema perdeu a despesa.
  const [estadoFiltrado, setEstadoFiltrado] = useState(null);
  const [acaoAberta, setAcaoAberta] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [varrendo, setVarrendo] = useState(false);
  // ⚠⚠ O LOTE (Fase C). `null` = fechado; `{ idsQueCasam }` = aberto.
  const [lote, setLote] = useState(null);
  const [abrindoLote, setAbrindoLote] = useState(false);
  // ⚠ Casar muda a FILA (a nota ganha data e passa a A_CONFERIR) e muda o PAINEL (o débito some).
  // Este contador força o remonte do painel para os dois ficarem coerentes — sem ele, o contador vê
  // o débito sumir de um lado e a nota continuar "sem pagamento identificado" do outro.
  const [versao, setVersao] = useState(0);
  // ⚠⚠ O PLANO DE CONTAS — nenhuma rota nova: `GET /firm/companies/:id/chart-of-accounts` já existe
  // e já devolve a linha inteira, com `codigoCompleto` e `analitica`.
  //
  // ⚠ Ele é carregado UMA vez por empresa, fora do laço da fila: 229 linhas fariam 229 consultas.
  // ⚠ Falha aqui NÃO derruba a fila — ela continua legível, só sem seletor. O que não pode é a
  // aba inteira cair porque o plano não veio.
  const [contas, setContas] = useState([]);
  // ⚠⚠ TRÊS ESTADOS, NÃO DOIS. Lista vazia é indistinguível de "ainda perguntando" e de "a consulta
  // falhou" — e a tela dizia, para os três, *"esta empresa ainda não tem plano de contas"*, que é
  // uma AFIRMAÇÃO sobre o cadastro. Achado por agente adversarial em 26/08/2026.
  const [estadoDoPlano, setEstadoDoPlano] = useState(ESTADO_DO_PLANO.CARREGANDO);

  const competenciaDaConsulta = recorte === "sem-competencia" ? COMPETENCIA_AUSENTE : competencia;
  // ⚠ A pergunta que o pré-voo faz não é "existe seletor?", é "dá para contabilizar?". São duas
  // condições, e cada uma derruba tudo sozinha:
  //   · haver conta OFERECÍVEL (plano vazio, só sintéticas ou sem `codigoCompleto`);
  //   · o CAIXA estar são — `montarLancamento` credita sempre `111010001`, e sem ele TODA linha da
  //     empresa é recusada, por mais certa que esteja a conta que o contador escolheu.
  const problemaNoCaixa = useMemo(
    () => (estadoDoPlano === ESTADO_DO_PLANO.OK ? problemaDoCaixa(contas) : null),
    [contas, estadoDoPlano],
  );
  const podeEscolherConta = useMemo(
    () => estadoDoPlano === ESTADO_DO_PLANO.OK && !problemaNoCaixa && contasOferecidas(contas).length > 0,
    [contas, estadoDoPlano, problemaNoCaixa],
  );

  // ⚠⚠ "A ÚLTIMA CONSULTA VENCE" — achado por auditoria em 25/08/2026.
  //
  // Sem isto, duas cargas voltando fora de ordem faziam a tela mostrar o resultado da consulta
  // ANTIGA. Três sintomas, todos silenciosos: o contador clica ‹ ‹ para voltar dois meses e vê as
  // despesas de junho sob o cabeçalho de maio; o "Carregando…" desliga enquanto a nova ainda voa; e
  // — o pior — uma FALHA antiga chegando depois de um sucesso novo fazia `setErro` **e**
  // `setFila(null)`, apagando dados corretos e mostrando erro sobre uma consulta que deu certo.
  //
  // ⚠ Um contador, não `AbortController`: o `request` do `realApi` não aceita `signal`, então não
  // há o que abortar. O que se pode garantir é que resposta velha não escreve estado.
  const consultaAtual = useRef(0);

  const carregar = useCallback(async () => {
    if (!companyId) return;
    const minha = ++consultaAtual.current;
    setCarregando(true);
    setErro(null);
    try {
      const r = await conferenciaApi.getConferenciaFila(companyId, {
        competencia: competenciaDaConsulta,
        // ⚠ Sem filtro, o servidor decide o padrão. Não mandamos uma lista default daqui: duas
        // definições de "a fila" divergiriam na primeira mudança.
        ...(estadoFiltrado ? { estado: estadoFiltrado } : {}),
      });
      if (minha !== consultaAtual.current) return;
      setFila(r);
    } catch (e) {
      if (minha !== consultaAtual.current) return;
      // ⚠ O erro APARECE. "Não veio nada" e "deu erro" não podem ficar iguais.
      setErro(e?.message || "Não foi possível carregar a fila de conferência.");
      setFila(null);
    } finally {
      // ⚠ Só a consulta corrente desliga o "Carregando…" — senão a tela afirma estar pronta
      // enquanto a resposta que vai valer ainda está no ar.
      if (minha === consultaAtual.current) setCarregando(false);
    }
  }, [companyId, competenciaDaConsulta, estadoFiltrado]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // ⚠ O plano muda por EMPRESA, não por competência nem por filtro — por isso ele tem efeito
  // próprio, e não entra no `carregar`. Recarregá-lo a cada troca de mês seria uma consulta a mais
  // por clique, sobre um dado que não mudou.
  useEffect(() => {
    if (!companyId) return undefined;
    let vivo = true;
    // ⚠⚠ LIMPAR ANTES DE PERGUNTAR. Sem isto, na janela entre trocar de empresa e a resposta chegar,
    // o seletor oferece o plano da empresa ANTERIOR — e o contador escolheria uma conta que não é
    // desta empresa. Achado por agente de verificação em 26/08/2026.
    setContas([]);
    setEstadoDoPlano(ESTADO_DO_PLANO.CARREGANDO);
    // ⚠⚠ `try` E `.catch`, e os dois são necessários — achado por teste em 26/08/2026.
    //
    // O `.catch` pega a REJEIÇÃO (rede fora, 500). O `try` pega o lançamento SÍNCRONO — que foi o
    // que aconteceu: um cliente de API sem `getChartOfAccounts` estoura `TypeError` na CHAMADA,
    // antes de existir promessa, e derruba a aba inteira no `useEffect`. Só o `.catch` deixaria a
    // promessa de "isto não derruba a fila" valendo pela metade.
    try {
      Promise.resolve(conferenciaApi.getChartOfAccounts(companyId))
        .then((r) => {
          if (!vivo) return;
          setContas(Array.isArray(r) ? r : []);
          setEstadoDoPlano(ESTADO_DO_PLANO.OK);
        })
        // ⚠ A falha não derruba a aba — a fila continua legível. Mas ela é MARCADA, não engolida:
        // `FALHOU` é o que impede a tela de afirmar "esta empresa não tem plano de contas" sobre uma
        // consulta que ninguém conseguiu fazer.
        .catch(() => {
          if (!vivo) return;
          setContas([]);
          setEstadoDoPlano(ESTADO_DO_PLANO.FALHOU);
        });
    } catch {
      setContas([]);
      setEstadoDoPlano(ESTADO_DO_PLANO.FALHOU);
    }
    return () => { vivo = false; };
  }, [companyId]);

  const grupos = useMemo(() => agruparPorFornecedor(fila?.itens), [fila]);
  const contagem = useMemo(() => contagemParaTela(fila?.porEstado), [fila]);

  const agir = useCallback(
    async (corpo) => {
      if (!acaoAberta) return;
      setEnviando(true);
      try {
        await conferenciaApi.postConferenciaAcao(companyId, acaoAberta.item.id, acaoAberta.acao, corpo);
        setAcaoAberta(null);
        setAviso(null);
        await carregar();
      } catch (e) {
        // ⚠ A recusa do servidor chega ao contador com o texto dela — ele é quem sabe o que fazer.
        setAviso(e?.message || "O servidor recusou esta ação.");
      } finally {
        setEnviando(false);
      }
    },
    [acaoAberta, companyId, carregar],
  );

  const abrir = useCallback((acao, item) => {
    setAviso(null);
    setAcaoAberta({ acao, item });
  }, []);

  /**
   * ⚠⚠ ABRIR O LOTE EXIGE SABER QUAIS DÉBITOS JÁ CASAM COM UMA NOTA — e sem essa resposta ele NÃO
   * abre.
   *
   * Contabilizar à parte um débito de extrato que é o pagamento de uma nota da fila **duplica a
   * despesa**: a nota vira um lançamento e o débito vira outro, para o mesmo dinheiro que saiu uma
   * vez. É o erro mais caro desta aba, e é silencioso.
   *
   * ⚠ Por isso a falha aqui **fecha a porta** em vez de abrir sem o filtro. Em toda a outra
   * consulta desta tela a falha é tolerada (a fila continua legível sem o plano de contas); nesta
   * não dá: abrir sem a lista é abrir com a lista VAZIA, e a lista vazia autoriza justamente o que
   * ela existe para impedir.
   */
  const abrirLote = useCallback(async () => {
    setAviso(null);
    setAbrindoLote(true);
    try {
      const r = await conferenciaApi.getConferenciaCasamentos(companyId);
      // ⚠⚠ A PORTA FECHA PARA **FORMA**, NÃO SÓ PARA FALHA — achado por agente adversarial em
      // 27/08/2026. O `catch` abaixo só pega REJEIÇÃO; uma resposta 200 sem a chave `linhas`
      // (renome no backend, envelope novo) produzia `Set` vazio em silêncio, e lista vazia autoriza
      // exatamente o que esta consulta existe para impedir. É a mesma família do `casamentos` ×
      // `linhas` que já mordeu o mock — só que do lado que ninguém testa.
      if (!Array.isArray(r?.linhas)) {
        throw new Error("a resposta não veio na forma esperada (sem a lista `linhas`)");
      }
      setLote({ idsQueCasam: debitosQueCasamComNota(r) });
    } catch (e) {
      setAviso(
        "Não foi possível conferir quais débitos do extrato já casam com uma nota, e sem isso o lote "
        + "poderia lançar a mesma despesa duas vezes. Tente de novo em instantes. "
        + `(${e?.message || "falha na consulta"})`,
      );
    } finally {
      setAbrindoLote(false);
    }
  }, [companyId]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/*
        ⚠⚠ A MIGALHA É OBRIGATÓRIA DESDE 29/08/2026, e ela não é enfeite.

        A Conferência deixou de ser ABA do cabeçalho e virou um botão dentro de Lançamentos — então
        o cabeçalho agora marca "Lançamentos" enquanto esta tela está na frente. **Sem um caminho de
        volta explícito, esta é uma tela sem saída**: a aba de onde a pessoa veio não fica destacada
        de um jeito que pareça clicável, e o botão do navegador leva para fora da empresa quando ela
        chegou aqui por link direto.

        ⚠ Ele chama o MESMO `switchTab` das abas (`aoVoltar`), nunca `history.back()`.
        ⚠ Ausente o handler, a migalha NÃO renderiza — um "voltar" que não volta é pior que nenhum.
      */}
      {aoVoltar ? (
        <button
          type="button"
          onClick={aoVoltar}
          style={{
            justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 10px", borderRadius: 8, cursor: "pointer",
            font: "inherit", fontSize: "0.8rem",
            // ⚠ Os MESMOS tokens do resto desta tela (`card` acima) — nunca um hex novo aqui.
            color: "var(--text-2)", background: "transparent",
            border: "1px solid var(--border)",
          }}
        >
          ‹ Voltar aos lançamentos
        </button>
      ) : null}
      <div style={{ ...card, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {contagem.map((c) => (
            <Selo
              key={c.estado}
              token={c.token}
              ativo={estadoFiltrado === c.estado}
              // ⚠ O `title` continua carregando a FRASE do estado, que é o que ensina o vocabulário.
              title={`${c.frase} (clique para ver só estes)`}
              // ⚠ Clicar no selo já ativo LIMPA o filtro e volta ao padrão do servidor — sem isso, o
              // contador entra no recorte e não acha a saída.
              onClick={() => setEstadoFiltrado((atual) => (atual === c.estado ? null : c.estado))}
            >
              {c.rotulo}: {c.quantidade}
            </Selo>
          ))}
          <span style={{ flex: 1 }} />
          {/* ⚠ A varredura é ESCRITA (cria declarados), então respeita o mesmo piso de papel dos
              botões da linha. Ela NÃO cria lançamento — tudo nasce esperando pagamento. */}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setVarrendo(true)}
            disabled={!podeEscrever}
            title={podeEscrever ? "Trazer notas recebidas para a fila." : "Seu perfil não pode alterar lançamentos desta empresa."}
          >
            Trazer notas
          </Button>
          {/* ⚠⚠ A PORTA DO LOTE — *"ai clicamos em importar e abre o modal para trabalharmos nele"*.
              O botão fica VISÍVEL e desabilitado com o motivo: botão que some esconde que a ação
              existe. ⚠ Ele NÃO checa `podeEscolherConta` para aparecer — quem separa o que entra é
              a regra do lote, e ela nomeia cada linha que ficou de fora. Esconder o botão faria o
              contador não saber por quê. */}
          <Button
            size="sm"
            variant="secondary"
            onClick={abrirLote}
            disabled={!podeEscrever || abrindoLote || !(fila?.itens?.length)}
            title={
              !podeEscrever ? "Seu perfil não pode alterar lançamentos desta empresa."
                : !(fila?.itens?.length) ? "Não há linhas na fila para contabilizar."
                  : "Contabilizar várias linhas de uma vez."
            }
          >
            {abrindoLote ? "Abrindo…" : "Contabilizar em lote"}
          </Button>
          <Button size="sm" variant="secondary" onClick={carregar} disabled={carregando}>
            {carregando ? "Carregando…" : "Atualizar"}
          </Button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.85rem" }}>
          <span style={{ color: "var(--text-muted)" }}>Mostrar:</span>
          <Button
            size="sm"
            variant={recorte === "competencia" ? "primary" : "secondary"}
            onClick={() => setRecorte("competencia")}
          >
            {competencia || "competência atual"}
          </Button>
          {/* ⚠⚠ O RECORTE DAS SEM COMPETÊNCIA PRECISA DE BOTÃO PRÓPRIO. `where.competencia = "2026-07"`
              não casa com NULL em SQL: sem esta porta, a nota que chegou sem competência fica
              invisível para sempre — o defeito que a auditoria de notas já pagou e consertou. */}
          <Button
            size="sm"
            variant={recorte === "sem-competencia" ? "primary" : "secondary"}
            onClick={() => setRecorte("sem-competencia")}
            title="Notas que chegaram sem competência. Elas não são atribuídas a mês nenhum e não entram em apuração."
          >
            Sem competência
          </Button>
        </div>
      </div>

      <SecaoDaConferencia natureza={NATUREZA.VIRA_LANCAMENTO}>
        {/* ⚠ ACIMA DA FILA de propósito: um débito de extrato sem nota vinculada é o que pode virar
            despesa contada duas vezes, e é o que o contador precisa ver primeiro. O painel some
            sozinho quando não há nada a casar. */}
        <PainelDeCasamentos
          key={versao}
          companyId={companyId}
          podeEscrever={podeEscrever}
          aoCasar={() => {
            setVersao((v) => v + 1);
            carregar();
          }}
        />

        {/*
          ⚠⚠ O EXTRATO DO QUE ENTROU SEM CLIQUE vem ANTES das regras, e a ordem é a decisão.

          Ele é a CONSEQUÊNCIA da automação, e as regras são a causa. Quem abre esta tela precisa ver
          primeiro o que já aconteceu na contabilidade dele — e só depois mexer no que vai acontecer.
          Invertido, o contador ligaria mais uma regra sem ter olhado o que a anterior fez.
          ⚠ Ele some sozinho quando não há nada lançado por regra, que é o estado normal.
        */}
        {/*
          ⚠⚠ ELE NÃO LEVA `key={versao}`, e a ausência é a correção — achada no navegador (30/08/2026).

          Com a `key` amarrada a `versao`, desfazer bumpava a versão, a `key` mudava, o React
          DESMONTAVA o painel e o relatório *"1 de 2 desfeitos · dec-r2: a competência está fechada"*
          morria no mesmo instante em que nascia. Ficava a metade que já funcionava (o desfazer) e
          sumia a metade que este extrato existe para dar: **saber o que NÃO foi desfeito**.
          ⚠ Ele se recarrega sozinho depois de desfazer; quem precisa da `key` é o painel de
          casamentos, que não tem recarga própria.
        */}
        <PainelDeLancadosPorRegra
          companyId={companyId}
          competencia={competencia}
          podeEscrever={podeEscrever}
          aoDesfazer={() => {
            setVersao((v) => v + 1);
            carregar();
          }}
        />

        {erro ? (
          <div style={{ ...card, borderColor: "var(--state-danger)", color: "var(--state-danger)" }}>{erro}</div>
        ) : null}
        {/* ⚠ Só quando não há modal — com ele aberto, o aviso vai DENTRO dele (ver `ModalDaAcao`). */}
        {aviso && !acaoAberta ? (
          <div role="alert" style={{ ...card, borderColor: "var(--state-warn)", color: "var(--state-warn)" }}>
            {aviso}
          </div>
        ) : null}

        {!carregando && grupos.length === 0 ? (
          // ⚠⚠ ESTADO VAZIO DIZ POR QUÊ, e distingue as duas causas. "Nada aqui" faria "a fila está
          // limpa" e "ninguém varreu as notas ainda" ficarem iguais.
          <div style={{ ...card, color: "var(--text-muted)" }}>
            {estadoFiltrado ? (
              <>
                Nenhuma despesa neste estado
                {recorte === "sem-competencia" ? " sem competência" : competencia ? ` em ${competencia}` : ""}.
                {" "}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEstadoFiltrado(null)}>
                  Ver a fila inteira
                </button>
              </>
            ) : (
              <>
                Nenhuma despesa esperando conferência
                {recorte === "sem-competencia" ? " sem competência" : competencia ? ` em ${competencia}` : ""}.
                {" "}Se você esperava ver as notas recebidas aqui, elas ainda não foram varridas para a fila.
              </>
            )}
          </div>
        ) : null}

        {/* ⚠⚠ A LISTA É TRUNCADA E A TELA DIZ ISSO — achado por auditoria em 25/08/2026.
            O servidor devolve no máximo 50 linhas por página e a tela nunca lia `total`. Com 137 em
            `A_CONFERIR`, o selo dizia 137, a lista mostrava 50, e o contador concluía exatamente o que
            o desenho dos selos existe para impedir: que o sistema perdeu despesa. */}
        {fila && fila.total > (fila.itens?.length ?? 0) ? (
          <div style={{ ...card, borderColor: "var(--state-warn)", color: "var(--text-muted)" }}>
            Mostrando <strong>{fila.itens.length}</strong> de <strong>{fila.total}</strong> lançamentos.
            Use os filtros de estado e a competência para reduzir a fila — ainda não há navegação por página.
          </div>
        ) : null}

        {grupos.map((g) => (
          <div key={g.chave} style={{ ...card, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <strong>{g.nome}</strong>
              {g.cnpj ? (
                <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>{cnpjFormatado(g.cnpj)}</span>
              ) : null}
              <span style={{ flex: 1 }} />
              <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                {g.itens.length} lançamento(s) · {dinheiro(g.total)}
              </span>
            </div>
            {/* ⚠ `.tabela--densa` do `App.css` — a tela não manda `th`/`td` inline. */}
            <div style={{ overflowX: "auto" }}>
              <table className="tabela--densa">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Documento</th>
                    <th>Emissão</th>
                    <th>Pagamento</th>
                    <th>Conta</th>
                    <th className="tabela__num">Valor</th>
                    <th>Competência</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {g.itens.map((item) => (
                    <LinhaDoDeclarado
                      key={item.id}
                      item={item}
                      podeEscrever={podeEscrever}
                      podeEscolherConta={podeEscolherConta}
                      onAgir={abrir}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </SecaoDaConferencia>

      <SecaoDaConferencia natureza={NATUREZA.SO_FLUXO}>
        {/*
          ⚠⚠ ESTA POSIÇÃO MUDOU EM 01/09/2026, e a frase anterior ("ABAIXO do painel de casamentos e
          ACIMA da fila") virou falsa: a recorrência desceu para DEPOIS da fila, junto com o resto do
          fluxo. O argumento antigo — *"casar um débito evita a despesa em dobro AGORA; a recorrência
          olha para a frente"* — continua valendo e é o que a mantém no fim: ela é a mais distante do
          que a contabilidade precisa hoje. O que mudou foi a régua: a tela passou a agrupar por
          DESTINO, e recorrência não vira lançamento.
          ⚠ Ela some sozinha quando não há decisão esperando — mesmo desenho do painel de casamentos.
        */}
        <PainelDeRecorrencias companyId={companyId} podeEscrever={podeEscrever} />

        {/*
          ⚠⚠ A TERCEIRA FILA DESTA TELA (29/08/2026) — o que o CLIENTE escreveu no fluxo dele.

          Ela fica ao lado das recorrências, com a MESMA forma (confirmar · recusar com motivo): duas
          filas na mesma tela com desenhos diferentes fariam a pessoa reaprender a decisão em cada uma.
          ⚠ E ela é o que faz o pedido do dono fechar: *"essas saídas que o cliente digitar aparecem
          para o contador na aba de conferência"*.
        */}
        <PainelDeSaidasDoCliente companyId={companyId} podeEscrever={podeEscrever} />

        {/* ⚠⚠ DEPOIS das três filas de decisão, e não entre elas: esta é CIÊNCIA, não tarefa. Posta
            no meio, ela seria lida como mais uma coisa a resolver — e ela não espera nada de você.
            ⚠ Ela não desenha nada quando não há mexida nenhuma; ver o cabeçalho do painel. */}
        <PainelDeMexidasDoCliente companyId={companyId} podeEscrever={podeEscrever} />
      </SecaoDaConferencia>

      <SecaoDaConferencia natureza={NATUREZA.REGRA}>
        {/*
          ⚠⚠ AS REGRAS FICAM POR ÚLTIMO, e é a tela mais perigosa desta aba: marcar uma regra aqui faz
          nascer lançamento contábil sem ninguém clicar. Ela vem depois da fila de propósito — o
          contador chega nela tendo visto as despesas concretas, e não como primeiro ato.
          ⚠⚠ ESTA FRASE ERA FALSA ATÉ 01/09/2026: no DOM, `PainelDeRegras` renderizava ANTES do
          bloco da fila (o `{erro}` e o `grupos.map` vinham DEPOIS dele). O comentário descrevia a
          intenção, e ninguém conferiu o resultado. O agrupamento por seção a tornou verdadeira — a
          fila está na primeira seção, esta é a última.
          ⚠ `contas` é o plano JÁ CARREGADO desta tela: uma segunda busca daria dois planos possíveis
          para a mesma empresa, e o seletor da regra poderia oferecer conta que a fila recusa.
        */}
        <PainelDeRegras companyId={companyId} contas={contas} podeEscrever={podeEscrever} />
      </SecaoDaConferencia>

      {varrendo ? (
        <ModalDaVarredura
          companyId={companyId}
          aoFechar={() => setVarrendo(false)}
          aoConcluir={() => {
            // ⚠ A fila muda: as notas novas entram. Recarregar aqui evita o "varri e não apareceu
            // nada", que se lê como falha.
            carregar();
            setVersao((v) => v + 1);
          }}
        />
      ) : null}

      {lote ? (
        <ModalDeContabilizacao
          itens={fila?.itens || []}
          contas={contas}
          idsQueCasam={lote.idsQueCasam}
          podeEscrever={podeEscrever}
          podeEscolherConta={podeEscolherConta}
          // ⚠ Sem ele o modal não distingue "esta empresa não tem plano" de "a consulta falhou", e
          // não antecipa o caixa torto — que derruba TODA linha da empresa.
          estadoDoPlano={estadoDoPlano}
          // ⚠ A fila é paginada (50 por página) e o modal só vê a página. Sem isto ele diria
          // "Contabilizar em lote — 50 lançamento(s)" com 137 na fila, sem explicação.
          totalDaFila={fila?.total}
          // ⚠ O modal não conhece a api: ele recebe a função de enviar UMA linha. É o que faz o
          // dublê ser o caminho natural no teste, não o cuidadoso — mesma disciplina de
          // `emissaoLote.js`, que também não importa quem emite.
          aoEnviarLinha={(id, corpo) => conferenciaApi.postConferenciaAcao(companyId, id, "confirmar", corpo)}
          // ⚠⚠ A FILA **NÃO** RECARREGA DEBAIXO DO MODAL ABERTO — e recarregar era um defeito com
          // três caras, achado por agente adversarial em 27/08/2026:
          //
          //   1. `idsQueCasam` é um INSTANTÂNEO, tirado ao abrir. Com a fila trocando por baixo,
          //      uma linha nova podia entrar sem nunca ter sido conferida contra os casamentos —
          //      exatamente a despesa em dobro que o filtro existe para impedir;
          //   2. `contasPorLinha` nasce das linhas do mount; linha nova entrava SEM CHAVE, e o
          //      botão "Aplicar nas 2 em branco" ficava habilitado e inerte;
          //   3. o rodapé contava desfechos de linhas que não estavam mais na tabela.
          //
          // ⚠ Recarregar ao FECHAR resolve os três na raiz: enquanto o modal está aberto, o
          // conjunto é estável, e é sobre ele que todas as contagens falam.
          aoConcluir={() => setLote((l) => (l ? { ...l, mexeuNaFila: true } : l))}
          aoFechar={() => {
            const mexeu = lote.mexeuNaFila;
            setLote(null);
            if (!mexeu) return;
            // ⚠ A fila muda (as linhas viram CONTABILIZADO) e o painel também (débitos absorvidos).
            carregar();
            setVersao((v) => v + 1);
          }}
        />
      ) : null}

      {acaoAberta ? (
        <ModalDaAcao
          acao={acaoAberta.acao}
          item={acaoAberta.item}
          contas={contas}
          estadoDoPlano={estadoDoPlano}
          ocupado={enviando}
          aviso={aviso}
          onFechar={() => {
            setAcaoAberta(null);
            // ⚠ Fechar limpa o aviso: senão a recusa do modal reaparece no corpo da aba, sem o
            // contexto do que foi tentado.
            setAviso(null);
          }}
          onConfirmar={agir}
        />
      ) : null}
    </div>
  );
}
