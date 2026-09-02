// A RETENÇÃO FEDERAL NA DPS (`trib/tribFed`) — regra PURA.
//
// ⚠⚠ TRÊS COISAS DECIDEM A RETENÇÃO, E SÓ UMA É DO PERFIL:
//
//   1. o **REGIME** — do cadastro. Optante do Simples **não sofre** essa retenção (Lei 10.833/2003,
//      art. 32, III; IN SRF 459/2004, art. 3º, II). ⚠ Não confundir com o art. 30, § 2º, que fala de
//      quem PAGA; o art. 32, III fala de quem RECEBE — e nosso cliente é o prestador.
//   2. o **SERVIÇO estar na lista do art. 30** — declarado pelo CONTADOR, no perfil.
//      ⚠⚠ O SISTEMA NÃO DERIVA ISSO DO CNAE, e a recusa é deliberada: errar aqui erra nos dois
//      sentidos — declarar retenção indevida, ou omitir a devida. A lista fechada dos "serviços
//      profissionais" do art. 30 remete ao rol do IRRF e **não está versionada** neste projeto.
//   3. o **TOMADOR ser PJ** — derivado do documento que a nota já tem. A retenção é obrigação da
//      FONTE PAGADORA, nos pagamentos PJ → PJ; nota para **pessoa física não sofre retenção**.
//      ⚠ Isso NÃO vira pergunta nova ao cliente: CPF (11 dígitos) ⇒ não retém; CNPJ (14) ⇒ aplica.
//
// E uma quarta, que não é condição e sim dispensa:
//
//   4. o **PISO**: valor retido **≤ R$ 10,00** dispensa (art. 31, § 3º, com a redação da Lei
//      13.137/2015). ⚠⚠ O antigo limite de R$ 5.000 **NÃO EXISTE MAIS** — a mesma lei REVOGOU o
//      § 4º, que era a regra de somar os pagamentos do mês. Sistema que ainda o aplique deixa de
//      reter o que é devido.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// O QUE SAI, E O QUE **NÃO** SAI
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//   `piscofins`  CST (do perfil) · vBCPisCofins · pAliqPis 0,65 · pAliqCofins 3,00 · vPis ·
//                vCofins · tpRetPisCofins = **3** (PIS/COFINS/CSLL Retidos)
//   `vRetCSLL`   1% da base — **obrigatório** pela RN E0724 sempre que `tpRetPisCofins` ≠ 0 e ≠ 2
//
//   ⚠ `vRetIRRF` **NÃO SAI**: a alíquota do IRRF vive na legislação do IR e **não está versionada**
//     aqui. Emitir um percentual de memória é exatamente o que a regra 1 do projeto proíbe.
//   ⚠ `vRetCP` **NÃO SAI**: a retenção previdenciária de 11% (Lei 8.212/1991, art. 31) e sua
//     interação com o Anexo IV do Simples não foram confirmadas em fonte primária.
//
// ⚠⚠ **SÓ EMITIMOS `tpRetPisCofins = 3` OU NADA.** As dez posições da enumeração cobrem
// combinações parciais (5 = só PIS, 6 = só COFINS, 8 = só CSLL…) para as quais este projeto não tem
// fonte nenhuma. Os 4,65% do art. 31 são uma retenção ÚNICA das três contribuições — é o `3`.
//
// ⚠ **O CST é do CONTADOR.** `TSTipoCST` tem 34 valores e não existe, em fonte versionada aqui, um
// de-para serviço → CST. Sem ele o grupo `piscofins` nem pode ser montado (o XSD o exige), e por
// isso a ausência é RECUSA NOMEADA, não um `01` fabricado.

import {
  ALIQUOTAS_ART30,
  PISO_DISPENSA,
  RESPOSTA,
  dispensadaPeloPiso,
  retencaoFederalPeloRegime,
} from "../fiscal/retencao/index.js";

/** As SEIS respostas. ⚠ Só a última emite; as outras cinco têm motivos DIFERENTES. */
export const SITUACAO = Object.freeze({
  /** O contador não declarou que este serviço está na lista do art. 30. É o estado de todo perfil. */
  NAO_DECLARADA: "nao_declarada",
  /** Optante do Simples Nacional — vedada por lei. */
  VEDADA_NO_SIMPLES: "vedada_no_simples",
  /** Nota para pessoa física: não há fonte pagadora PJ. */
  TOMADOR_PESSOA_FISICA: "tomador_pessoa_fisica",
  /** ⚠ Sem regime cadastrado não se afirma dispensa NEM exigência — e não se retém. */
  REGIME_INDEFINIDO: "regime_indefinido",
  /** Valor retido ≤ R$ 10,00 (art. 31, § 3º). */
  DISPENSADA_PELO_PISO: "dispensada_pelo_piso",
  DEVIDA: "devida",
});

/** ⚠ `tpRetPisCofins = 3` — "PIS/COFINS/CSLL Retidos". A única posição que os 4,65% do art. 31 são. */
export const TP_RET_PIS_COFINS_CSLL_RETIDOS = "3";

/** ⚠ `TSDec15V2`: `0|0\.[0-9]{2}|[1-9]{1}[0-9]{0,14}(\.[0-9]{2})?`. Duas casas, sempre. */
const dinheiro = (n) => (Math.round(n * 100) / 100).toFixed(2);
/** ⚠ `TSDec2V2`: até dois dígitos inteiros e duas casas. `0.65` e `3.00` cabem. */
const percentual = (n) => (Math.round(n * 100) / 100).toFixed(2);

const texto = (v) => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * Decide a retenção federal desta nota.
 *
 * @param {object} p
 * @param {string|null} p.regime           o regime do cadastro
 * @param {object|null} p.perfil           o perfil de emissão
 * @param {number} p.valorServicos         a base (o montante pago — art. 31, caput)
 * @param {string|null} p.documentoTomador só dígitos: 11 = CPF, 14 = CNPJ
 */
export function retencaoFederalDaDps({ regime, perfil, valorServicos, documentoTomador }) {
  const naoInformar = (situacao, motivo) => ({ ok: true, situacao, informar: false, motivo });

  // ── 2. O SERVIÇO ESTÁ NA LISTA DO ART. 30? ────────────────────────────────────────────────
  // ⚠ Primeiro porque é o estado de 100% dos perfis: sem declaração, nada muda em nota nenhuma.
  if (perfil?.retencaoFederalArt30 !== true) {
    return naoInformar(
      SITUACAO.NAO_DECLARADA,
      "O contador não declarou, no perfil de emissão, que este serviço está na lista do art. 30 da "
      + "Lei 10.833/2003. Sem essa declaração a nota sai como hoje, sem retenção federal.",
    );
  }

  // ── 1. O REGIME ───────────────────────────────────────────────────────────────────────────
  const peloRegime = retencaoFederalPeloRegime(regime);
  // ⚠⚠ `.resposta` E `.dispensada` — AS DUAS FUNÇÕES DEVOLVEM OBJETO, NÃO BOOLEANO. Ler
  // `if (dispensadaPeloPiso(x))` faz a guarda disparar SEMPRE (objeto é truthy) e **dispensa toda
  // retenção** — defeito que a primeira versão deste arquivo teve e que o teste pegou.
  // ⚠⚠ SÓ `DEVIDA` PROSSEGUE — e isto é conserto de falha ABERTA que eu mesmo escrevi: a primeira
  // versão tratava só `DISPENSADA` e deixava tudo o mais passar, ou seja, **regime INDEFINIDO
  // RETINHA**. `retencaoFederalPeloRegime` tem TRÊS respostas, e a terceira não é "não": ela é
  // "não dá para afirmar". Reter sem saber o regime declara ao fisco uma retenção que talvez seja
  // vedada por lei. Falha FECHADA: sem prova de que é devida, não se retém.
  if (peloRegime.resposta === RESPOSTA.INDEFINIDA) {
    return naoInformar(
      SITUACAO.REGIME_INDEFINIDO,
      peloRegime.motivo
      || "Não dá para afirmar se esta empresa sofre a retenção do art. 30 sem o regime cadastrado. "
      + "A nota sai sem retenção — que é o desfecho seguro —, e o cadastro precisa ser conferido.",
    );
  }
  if (peloRegime.resposta === RESPOSTA.DISPENSADA) {
    // ⚠⚠ NÃO É RECUSA DA EMISSÃO — a nota SEM retenção é a nota CERTA para o Simples. O que seria
    // errado é sair COM retenção. Então emite-se normalmente e o motivo fica nomeado, para o painel
    // do contador poder dizer que aquela configuração não está tendo efeito nesta empresa.
    return naoInformar(
      SITUACAO.VEDADA_NO_SIMPLES,
      "Optante do Simples Nacional não sofre a retenção do art. 30 "
      + `(${peloRegime.fonte}). O perfil declara o serviço do art. 30, mas para esta empresa a `
      + "retenção não se aplica — e a nota sai correta sem ela.",
    );
  }

  // ── 3. O TOMADOR É PJ? ────────────────────────────────────────────────────────────────────
  const doc = String(documentoTomador ?? "").replace(/\D+/g, "");
  if (doc.length !== 14) {
    // ⚠ Inclui o documento ilegível: sem PROVA de que a fonte pagadora é PJ, não se retém. Falha
    // fechada na direção certa — reter de pessoa física é cobrar tributo de quem não deve.
    return naoInformar(
      SITUACAO.TOMADOR_PESSOA_FISICA,
      "A retenção do art. 30 é obrigação da fonte pagadora nos pagamentos entre pessoas jurídicas. "
      + "O tomador desta nota não é PJ, então não há retenção.",
    );
  }

  // ── O CST, que o grupo `piscofins` exige ──────────────────────────────────────────────────
  const cst = texto(perfil?.cstPisCofins);
  if (!cst) {
    return {
      ok: false,
      codigo: "NFSE_RETENCAO_FEDERAL_SEM_CST",
      message:
        "O perfil de emissão declara retenção federal, e o grupo PIS/COFINS da DPS exige o Código "
        + "de Situação Tributária (CST), que não foi declarado.",
      correcao:
        "Informe o CST do PIS/COFINS no perfil de emissão. ⚠ Ele não é derivado do serviço: não "
        + "existe, em fonte versionada neste projeto, um de-para serviço → CST.",
    };
  }

  const base = typeof valorServicos === "number" ? valorServicos : Number(valorServicos);
  if (!Number.isFinite(base) || base <= 0) {
    return {
      ok: false,
      codigo: "NFSE_RETENCAO_FEDERAL_SEM_BASE",
      message: "Não há valor de serviço para calcular a retenção federal.",
      correcao: "Informe o valor do serviço.",
    };
  }

  const vPis = Math.round(base * ALIQUOTAS_ART30.pisPasep) / 100;
  const vCofins = Math.round(base * ALIQUOTAS_ART30.cofins) / 100;
  const vCsll = Math.round(base * ALIQUOTAS_ART30.csll) / 100;
  // ⚠ O piso é sobre O VALOR RETIDO — a soma das três —, não sobre o valor da nota.
  const totalRetido = Math.round((vPis + vCofins + vCsll) * 100) / 100;

  // ── 4. O PISO ─────────────────────────────────────────────────────────────────────────────
  if (dispensadaPeloPiso(totalRetido).dispensada) {
    return naoInformar(
      SITUACAO.DISPENSADA_PELO_PISO,
      `O valor retido seria R$ ${dinheiro(totalRetido)}, e a retenção é dispensada em valor igual `
      + `ou inferior a R$ ${PISO_DISPENSA.valor.toFixed(2)} (Lei 10.833/2003, art. 31, § 3º). `
      + "⚠ O antigo limite de R$ 5.000 foi REVOGADO pela Lei 13.137/2015.",
    );
  }

  return {
    ok: true,
    situacao: SITUACAO.DEVIDA,
    informar: true,
    // ⚠ A ordem dos campos aqui NÃO é a do XML — quem monta na ordem do `xs:sequence` é o gerador.
    grupo: Object.freeze({
      piscofins: Object.freeze({
        CST: cst,
        vBCPisCofins: dinheiro(base),
        pAliqPis: percentual(ALIQUOTAS_ART30.pisPasep),
        pAliqCofins: percentual(ALIQUOTAS_ART30.cofins),
        vPis: dinheiro(vPis),
        vCofins: dinheiro(vCofins),
        tpRetPisCofins: TP_RET_PIS_COFINS_CSLL_RETIDOS,
      }),
      // ⚠⚠ OBRIGATÓRIO pela RN **E0724** sempre que `tpRetPisCofins` ≠ 0 e ≠ 2. Era a ausência dele
      // que fazia o gerador RECUSAR toda retenção declarada
      // (`NFSE_PIS_COFINS_RETENCAO_NAO_SUPORTADA`).
      vRetCSLL: dinheiro(vCsll),
    }),
    totalRetido: dinheiro(totalRetido),
  };
}
