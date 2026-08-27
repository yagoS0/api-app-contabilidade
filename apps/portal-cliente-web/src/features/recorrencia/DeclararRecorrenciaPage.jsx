// DECLARAR O QUE SE REPETE — o cliente conta, o contador confirma.
//
// > Dono, 25/08/2026: *"o contador deve poder indicar o que é recorrência também, ou o próprio
// > cliente — 'essa é a taxa anual que pago de Conselho', ou '1.000 que eu pago de jantar todo mês
// > para meus clientes'."*
//
// ⚠⚠ ESTA TELA NÃO PÕE NADA NO FLUXO DE CAIXA. A série nasce **PENDENTE** e só passa a valer depois
// que o contador confirma — e a tela diz isso ANTES do botão, não depois do envio. É o caminho
// principal para o que o detector **não enxerga**: a despesa que só aparece no extrato, e qualquer
// padrão que não seja mensal (a taxa anual do Conselho é o caso do dono).
//
// ⚠⚠ NENHUMA CONTA APARECE AQUI. O cliente não tem plano de contas, e esta declaração é sobre
// **CAIXA**. A conta é sugerida depois, para o contador, como em qualquer outra linha da fila dele.
//
// ⚠ A EXTRAÇÃO DE TEXTO LIVRE NÃO EXISTE — o plano previa uma LLM lendo a frase do dono, e **não há
// nenhuma integração de LLM neste projeto**. A tela pergunta os três campos. Aceitar um texto e
// fingir que foi lido seria pior que perguntar.
//
// ⚠ Regra de tela em `lib/declaracaoDeRecorrencia.js`, com teste próprio. Aqui é só a LIGAÇÃO.
// ⚠ SEM `style={{}}` e SEM classe nova: `.filters`, `.hint` e `.alerta` já existem neste portal.

import { useCallback, useEffect, useState } from "react";
import { AlertaErro } from "../../components/ui";
import { mascararValorDigitado } from "../emitir/lib/valorDaNota";
import {
  EXEMPLOS,
  FRASE_DA_RECUSA,
  LADO,
  PERIODICIDADE,
  ROTULO_DA_PERIODICIDADE,
  ROTULO_DO_LADO,
  corpoDaDeclaracao,
  faltasDaDeclaracao,
  leituraDoEnvio,
  podeEnviar,
} from "./lib/declaracaoDeRecorrencia";

const VAZIO = Object.freeze({ lado: LADO.DESPESA, rotulo: "", periodicidade: PERIODICIDADE.MENSAL, valor: "" });

export function DeclararRecorrenciaPage({ empresa, api, aoVoltar }) {
  // ⚠⚠ É `companyId`, NÃO `id` — o mesmo defeito que a tela do extrato pagou, achado no navegador
  // em 26/08/2026. O objeto de empresa deste portal vem de `GET /client/companies`, e lá a chave é
  // `companyId`; com `empresa.id` a chamada sai com `undefined`.
  const companyId = empresa?.companyId;
  const [campos, setCampos] = useState(VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [desfecho, setDesfecho] = useState(null);
  const [tentouEnviar, setTentouEnviar] = useState(false);

  // ⚠⚠ A GUARDA GÊMEA das telas irmãs — *"guarda de um lado só não é guarda"*. A casca fecha o modo
  // ao trocar de empresa, mas `empresaAtiva` é um `useMemo` e pode mudar sem passar por
  // `escolherEmpresa`. Um "anotado" da empresa ANTERIOR, sob o nome da nova, faria o cliente achar
  // que declarou para a empresa errada.
  useEffect(() => {
    setCampos(VAZIO);
    setErro(null);
    setDesfecho(null);
    setTentouEnviar(false);
  }, [companyId]);

  const trocar = useCallback((campo, valor) => {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
    // ⚠ Mexer no formulário apaga o desfecho: um "anotado" em cima de um formulário já editado
    // faria o cliente achar que o que está na tela foi enviado.
    setDesfecho(null);
  }, []);

  const enviar = useCallback(async () => {
    setTentouEnviar(true);
    if (!podeEnviar(campos) || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.declararRecorrencia(companyId, corpoDaDeclaracao(campos));
      setDesfecho(leituraDoEnvio(r, campos));
      // ⚠ O formulário se limpa no SUCESSO: deixá-lo preenchido convida ao segundo clique, e o
      // segundo clique reescreveria a mesma série sem o cliente saber.
      setCampos(VAZIO);
      setTentouEnviar(false);
    } catch (e) {
      // ⚠ A recusa do SERVIDOR chega com o texto dela. E o `code` NOMEADO desarma o fallback para o
      // mock por construção (`api/index.js`) — sem ele, um 503 viraria um "anotado" fictício.
      setErro(e);
    } finally {
      setEnviando(false);
    }
  }, [api, campos, companyId, enviando]);

  const faltas = faltasDaDeclaracao(campos);
  // ⚠⚠ AS FALTAS SÓ APARECEM DEPOIS DA PRIMEIRA TENTATIVA. Um formulário que abre em vermelho acusa
  // quem ainda não digitou nada — e ensina a ignorar o vermelho.
  const mostrarFaltas = tentouEnviar && faltas.length > 0;

  return (
    <section className="page">
      <div className="page-header">
        <h1>Declarar o que se repete</h1>
        <button type="button" className="btn" onClick={aoVoltar}>Voltar</button>
      </div>

      {/* ⚠⚠ A CONSEQUÊNCIA DITA ANTES DO BOTÃO: isto não entra no fluxo sozinho. Dizê-lo só depois
          do envio faria o cliente clicar achando que estava mexendo no próprio fluxo de caixa. */}
      <p className="hint">
        Conte ao seu contador o que acontece todo mês (ou todo ano) e o sistema ainda não enxerga —
        uma anuidade, um aluguel, uma assinatura. <strong>Nada entra no fluxo de caixa até ele
        confirmar.</strong>
      </p>

      <div className="card stack-gap">
        {/* ⚠ `fieldset`/`legend`: sem eles, quem usa leitor de tela ouve duas opções soltas sem
            saber a que pergunta elas respondem. */}
        <fieldset>
          <legend>É dinheiro que sai ou que entra?</legend>
          {Object.values(LADO).map((l) => (
            <label key={l} htmlFor={`rec-lado-${l}`} className="select-auto">
              <input
                id={`rec-lado-${l}`}
                type="radio"
                name="rec-lado"
                value={l}
                checked={campos.lado === l}
                onChange={() => trocar("lado", l)}
              />
              {" "}{ROTULO_DO_LADO[l]}
            </label>
          ))}
        </fieldset>

        <div className="filters">
          <label htmlFor="rec-rotulo">
            O que é?
            <input
              id="rec-rotulo"
              type="text"
              value={campos.rotulo}
              maxLength={120}
              // ⚠⚠ EXEMPLO NO PLACEHOLDER, nunca no valor: preencher o campo faria o cliente enviar
              // o exemplo achando que era dele.
              placeholder={`Ex.: ${EXEMPLOS[0]}`}
              onChange={(e) => trocar("rotulo", e.target.value)}
            />
          </label>

          <label htmlFor="rec-valor">
            Quanto costuma ser? (R$)
            {/* ⚠⚠ CAMPO DE MOEDA MASCARADO — a MESMA máscara da emissão de nota, e pelo mesmo
                motivo: o teclado é lido como FLUXO DE DÍGITOS, então `1.500` não pode ser digitado
                e a grafia ambígua (mil e quinhentos × um vírgula cinco) deixa de existir em vez de
                ser adivinhada. Aqui o erro não emite nota, mas põe no fluxo do cliente um número
                mil vezes menor que o dele — e ninguém confere um número que "parece" certo. */}
            <input
              id="rec-valor"
              type="text"
              inputMode="numeric"
              placeholder="0,00"
              value={campos.valor}
              onChange={(e) => trocar("valor", mascararValorDigitado(e.target.value))}
            />
          </label>

          <label htmlFor="rec-periodicidade">
            De quanto em quanto tempo?
            <select
              id="rec-periodicidade"
              value={campos.periodicidade}
              onChange={(e) => trocar("periodicidade", e.target.value)}
            >
              {Object.values(PERIODICIDADE).map((p) => (
                <option key={p} value={p}>{ROTULO_DA_PERIODICIDADE[p]}</option>
              ))}
            </select>
          </label>
        </div>

        {/* ⚠ A ANUAL existe por causa da taxa do Conselho: um desenho que conte MESES quebra nela —
            ela nunca teria três meses seguidos. */}
        <span className="hint">
          Um valor aproximado basta — seu contador confere contra o que já aconteceu. Coisas que
          acontecem uma vez por ano também contam.
        </span>

        {/* ⚠⚠ AS FALTAS SAEM TODAS DE UMA VEZ, cada uma com o conserto dela. Uma por clique é a
            forma mais cansativa possível de preencher um formulário de quatro campos. */}
        {mostrarFaltas ? (
          <div className="alerta alerta-erro" role="alert">
            {faltas.map((f) => (
              <p key={f}>{FRASE_DA_RECUSA[f]}</p>
            ))}
          </div>
        ) : null}

        <AlertaErro erro={erro} padrao="Não foi possível enviar esta declaração." />

        {/* ⚠⚠ OS DOIS DESFECHOS NÃO SE PARECEM. "Anotado" e "seu contador já tinha decidido" pedem
            reações diferentes — dizer "registramos" nos dois casos seria mentira no segundo. */}
        {desfecho ? (
          <div
            className={desfecho.tom === "aviso" ? "alerta alerta-aviso" : "alerta alerta-info"}
            role="status"
          >
            <p><strong>{desfecho.titulo}</strong></p>
            <p>{desfecho.frase}</p>
          </div>
        ) : null}

        <div className="form-actions">
          <button type="button" className="btn btn-primary" disabled={enviando} onClick={enviar}>
            {enviando ? "Enviando…" : "Enviar ao meu contador"}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>O que acontece depois</h2>
        <ul className="meta meta--bloco">
          <li>Seu contador vê esta declaração junto das outras coisas que ele confere.</li>
          {/* ⚠⚠ *"O OBSERVADO VENCE"* — decisão do dono. O cliente precisa saber que o número dele
              pode ser substituído pelo que as notas mostram, e por quê. */}
          <li>
            Se as notas já mostrarem esse gasto, <strong>o que aconteceu de verdade vale mais</strong>{" "}
            que o valor que você informou — e ele vai ver os dois.
          </li>
          <li>Enquanto ele não confirmar, isto não aparece no seu fluxo de caixa.</li>
        </ul>
      </div>
    </section>
  );
}
