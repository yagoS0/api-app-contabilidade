// RETENÇÃO NA FONTE SOBRE SERVIÇOS — leitura da norma, e nada além disso.
//
// ⚠⚠ O QUE ESTE MÓDULO **NÃO** FAZ, e é a parte que importa: ele **não calcula retenção**, não monta
// o grupo `tribFed` da DPS e não decide se uma nota tem retenção. Ele responde perguntas que a
// norma responde — quanto é a alíquota, qual é o piso, quem está dispensado — e para aí.
//
// Quem vai produzir `vPis`/`vCofins`/`vRetCSLL` por nota é o motor da emissão, e ele precisa de
// TRÊS coisas, das quais este módulo entrega **uma**:
//
//   1. o REGIME da empresa .................. do cadastro (`CadastroFiscal.regime`)
//   2. o serviço estar na lista do art. 30 .. DECLARADO pelo contador, por perfil
//   3. o tomador ser PESSOA JURÍDICA ........ derivado do documento da nota (CPF ⇒ não retém)
//
// ⚠ O item 2 não se deriva do CNAE, e isso está nomeado em `NAO_VERSIONADO.listaServicosProfissionais`:
// o caput do art. 30 remete ao rol de "serviços profissionais" da legislação do IR, que não está
// versionado aqui. Adivinhar erraria nos dois sentidos — declarar retenção indevida, ou omitir a
// devida.
//
// Fonte, hashes e as quatro armadilhas de extração: `docs/retencao-fonte/README.md`.

import {
  ALIQUOTAS_ART30,
  PISO_DISPENSA,
  DISPENSA_SIMPLES_NACIONAL,
  SERVICOS_ART30,
  NAO_VERSIONADO,
} from "./retencao.data.js";

export {
  ALIQUOTAS_ART30,
  PISO_DISPENSA,
  DISPENSA_SIMPLES_NACIONAL,
  SERVICOS_ART30,
  NAO_VERSIONADO,
};

/**
 * ⚠ TRÊS RESPOSTAS, e a terceira não é "não".
 *
 * Mesma forma de `obrigatoriedadeEfd.js` e `obrigatoriedadeDefis.js`, e pelo mesmo motivo: ausência
 * de regime cadastrado **não** afirma "é do Simples" nem "não é". Um sistema que respondesse
 * `DEVIDA` para regime desconhecido reteria de optante do Simples — o que o art. 32, III proíbe.
 */
export const RESPOSTA = Object.freeze({
  DISPENSADA: "dispensada",
  DEVIDA: "devida",
  INDEFINIDA: "indefinida",
});

/** As duas grafias que este projeto usa para o mesmo regime — ver `dpsCodigos.ALIAS_REGIME`. */
const EH_SIMPLES = new Set(["SIMPLES", "SIMPLES_NACIONAL"]);
const NAO_OPTANTES = new Set(["LUCRO_PRESUMIDO", "LUCRO_REAL"]);

/**
 * A retenção federal do art. 30 é devida sobre pagamentos a esta empresa?
 *
 * ⚠⚠ Responde SÓ pela metade que o REGIME decide. `DEVIDA` aqui significa *"o regime não dispensa"*,
 * **não** *"retenha"* — faltam o item 2 (serviço na lista) e o item 3 (tomador PJ) do cabeçalho.
 * Tratar esta resposta como ordem de reter é o erro que o nome tenta impedir.
 *
 * ⚠ O MEI fica em `INDEFINIDA` de propósito: ele é optante (LC 123), mas nada aqui foi conferido
 * para ele, e `dpsCodigos.MEI_NAO_MAPEADO` já recusa a emissão de MEI por falta de evidência.
 * Responder `DISPENSADA` por analogia seria a mesma inferência que aquele bloco recusa.
 *
 * @param {string|null|undefined} regime `CadastroFiscal.regime` ou `Company.regimeTributario`
 * @returns {{resposta: string, fonte: string|null, motivo: string|null}}
 */
export function retencaoFederalPeloRegime(regime) {
  const bruto = String(regime ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (!bruto) {
    return {
      resposta: RESPOSTA.INDEFINIDA,
      fonte: null,
      motivo: "Esta empresa não tem regime tributário cadastrado.",
    };
  }
  if (EH_SIMPLES.has(bruto)) {
    return {
      resposta: RESPOSTA.DISPENSADA,
      fonte: DISPENSA_SIMPLES_NACIONAL.pisCofinsCsll.fonte,
      motivo: null,
    };
  }
  if (NAO_OPTANTES.has(bruto)) {
    return { resposta: RESPOSTA.DEVIDA, fonte: ALIQUOTAS_ART30.fonte, motivo: null };
  }
  return {
    resposta: RESPOSTA.INDEFINIDA,
    fonte: null,
    motivo: `Regime "${regime}" não reconhecido — não dá para afirmar dispensa nem exigência.`,
  };
}

/**
 * O valor a reter fica abaixo do piso do art. 31, § 3º?
 *
 * ⚠⚠ O PISO É R$ 10,00 SOBRE O VALOR RETIDO, não sobre o valor da nota. E o antigo limite de
 * R$ 5.000 **não existe mais**: a Lei 13.137/2015 revogou o § 4º, que era a regra de somar os
 * pagamentos do mês à mesma PJ. Sistema que ainda a aplique DEIXA DE RETER o que é devido.
 *
 * ⚠ A comparação é `<=` — "valor igual ou inferior a R$ 10,00", literal.
 *
 * ⚠ `darfEletronicoSiafi` é a exceção do próprio parágrafo, e ela é do universo de órgãos públicos.
 * Fica no contrato porque a norma a tem; nenhum caminho deste projeto a liga hoje.
 *
 * @returns {{dispensada: boolean, fonte: string, motivo: string|null}}
 */
export function dispensadaPeloPiso(valorRetido, { darfEletronicoSiafi = false } = {}) {
  // ⚠⚠ `Number(null)`, `Number("")` e `Number([])` são todos **0** — e FINITOS. Sem guarda, ausência
  // de valor virava zero, zero é `<= 10`, e a função respondia DISPENSADA para uma nota cujo valor
  // ninguém informou: deixar de reter tributo devido. Mesma armadilha de `folhaAusenteNaoEZero`.
  //
  // ⚠ A guarda é por TIPO ACEITO, não por lista de ausências — a primeira versão enumerava
  // `null`/`undefined`/`""` e **`[]` passou**. Enumerar o que se recusa deixa sempre um caso de
  // fora; enumerar o que se aceita, não.
  const ehNumero = typeof valorRetido === "number";
  const ehStringNumerica = typeof valorRetido === "string" && valorRetido.trim() !== "";
  const v = ehNumero || ehStringNumerica ? Number(valorRetido) : NaN;
  if (!Number.isFinite(v)) {
    return {
      dispensada: false,
      fonte: PISO_DISPENSA.fonte,
      motivo: "Valor não numérico — na dúvida não se dispensa a retenção.",
    };
  }
  if (darfEletronicoSiafi) {
    return {
      dispensada: false,
      fonte: PISO_DISPENSA.fonte,
      motivo: `Exceção do § 3º: ${PISO_DISPENSA.excecao}.`,
    };
  }
  return {
    dispensada: v <= PISO_DISPENSA.valor,
    fonte: PISO_DISPENSA.fonte,
    motivo: null,
  };
}
