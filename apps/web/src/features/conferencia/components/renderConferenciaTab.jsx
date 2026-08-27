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
import { PainelDeCasamentos } from "./PainelDeCasamentos";
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

// Mesmo padrão da aba de Auditoria e do SITFIS: a aba faz a própria chamada, porque não há `api` no
// escopo do detalhe da empresa para estas rotas.
const conferenciaApi = createApiClient();

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};

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
export function montarCorpo({ acao, item, data, motivo, valor, cfg }) {
  const corpo = {};
  if (acaoPedeData(acao, item) && data) {
    corpo.dataPagamento = data;
    corpo.origemPagamento = ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR;
  }
  if (cfg?.pedeMotivo && motivo) corpo.motivoRecusa = motivo;
  if (cfg?.pedeValor && valor) corpo.valorAjustado = valor;
  // ⚠ A conta que o servidor vai usar. Sem ela e sem `contaSugerida` gravada, `podeTransitar`
  // recusa com `sem_conta` — por isso o botão já nasce bloqueado (ver `motivoDeBloqueio`).
  if (cfg?.criaLancamento && item?.sugestao?.conta) corpo.contaAplicada = item.sugestao.conta;
  return corpo;
}

/** ⚠ O modal pergunta o que a ação precisa ANTES de enviar — a tela não descobre a regra pelo erro. */
function ModalDaAcao({ acao, item, ocupado, aviso, onFechar, onConfirmar }) {
  const cfg = ACAO[acao];
  const [data, setData] = useState(() => dataSugeridaParaPagamento(item));
  const [motivo, setMotivo] = useState("");
  const [valor, setValor] = useState(() => String(item?.valorAjustado ?? item?.valor ?? ""));

  const pedeData = acaoPedeData(acao, item);
  // ⚠ A recusa exige motivo não-vazio (o servidor devolve `sem_motivo`). Ausência nunca é resposta.
  const faltaMotivo = cfg?.pedeMotivo && !motivo.trim();
  const faltaData = pedeData && !data;
  const podeEnviar = !faltaData && !faltaMotivo;

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
            title={faltaData ? "Informe a data do pagamento." : faltaMotivo ? "Escreva o motivo da recusa." : undefined}
            onClick={() => onConfirmar(montarCorpo({ acao, item, data, motivo, valor, cfg }))}
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

function LinhaDoDeclarado({ item, podeEscrever, onAgir }) {
  const estado = leituraDoEstado(item.estado);
  const doc = leituraDoDocumento(item);
  const acoes = acoesDaLinha(item);

  return (
    <tr>
      <td>
        <div style={{ display: "grid", gap: 2 }}>
          <span>{item.descricaoOriginal}</span>
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
            const bloqueio = motivoDeBloqueio(acao, item, { podeEscrever });
            return (
              <Button
                key={acao}
                size="sm"
                variant={variantDoTom(ACAO[acao].tom)}
                disabled={Boolean(bloqueio)}
                // ⚠⚠ O botão fica VISÍVEL e desabilitado, com o motivo — botão que some esconde que
                // a ação existe, e botão mudo não diz se é permissão, mês fechado ou defeito.
                title={bloqueio || undefined}
                onClick={() => onAgir(acao, item)}
              >
                {ACAO[acao].rotulo}
              </Button>
            );
          })}
        </div>
      </td>
    </tr>
  );
}

export function ConferenciaTab({ companyId, competencia, podeEscrever = true }) {
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
  // ⚠ Casar muda a FILA (a nota ganha data e passa a A_CONFERIR) e muda o PAINEL (o débito some).
  // Este contador força o remonte do painel para os dois ficarem coerentes — sem ele, o contador vê
  // o débito sumir de um lado e a nota continuar "sem pagamento identificado" do outro.
  const [versao, setVersao] = useState(0);

  const competenciaDaConsulta = recorte === "sem-competencia" ? COMPETENCIA_AUSENTE : competencia;

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

  return (
    <div style={{ display: "grid", gap: 16 }}>
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
                  <LinhaDoDeclarado key={item.id} item={item} podeEscrever={podeEscrever} onAgir={abrir} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

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

      {acaoAberta ? (
        <ModalDaAcao
          acao={acaoAberta.acao}
          item={acaoAberta.item}
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
