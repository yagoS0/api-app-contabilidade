// MOTOR DO SIMPLES NACIONAL — cálculo local, para SIMULAÇÃO.
//
// ⚠ ISTO NÃO É O DAS. A verdade do DAS vem da RFB (simulação PGDAS-D), e o projeto já trata isso
// assim no módulo de Apuração. Aqui o cálculo serve para COMPARAR REGIMES: a pergunta é "quanto
// custaria no Simples × no Presumido", não "quanto vou pagar neste mês". Usar este número como
// valor a recolher seria trocar a fonte oficial por uma reimplementação.
//
// Todas as constantes vêm de `tabelasFiscais.js`, que cita o documento FONTES FISCAIS seção a seção.

import {
  ANEXOS, FATOR_R_LIMITE, LIMITES_SIMPLES, ENCARGOS_FOLHA, ISS_FAIXA_LEGAL,
  LIMITE_PROPORCIONAL_INICIO,
} from "./tabelasFiscais";

/** A faixa do RBT12 dentro de um anexo. Acima do teto de EPP não há faixa — a empresa não pode optar. */
export function faixaDoRbt12(anexo, rbt12) {
  const v = Number(rbt12) || 0;
  return anexo.faixas.find((f) => v >= f.de - 0.005 && v <= f.ate) || null;
}

/**
 * INÍCIO DE ATIVIDADE — o RBT12 PROPORCIONALIZADO — FONTES_FISCAIS §1.12 (art. 18, § 2º).
 *
 * Empresa recém-aberta não tem 12 meses de história, e a lei não manda esperar um ano: manda
 * proporcionalizar. Fontes conferidas em 06/08/2026, no texto oficial:
 *
 *   LC 123/2006, art. 18, § 2º (red. LC 155/2016) — texto compilado do Planalto:
 *     "Em caso de início de atividade, os valores de receita bruta acumulada constantes dos Anexos
 *      I a V desta Lei Complementar devem ser proporcionalizados ao número de meses de atividade
 *      no período."
 *
 *   Resolução CGSN 140/2018, art. 22 — a OPERACIONALIZAÇÃO, que é o que dá para codar:
 *     § 2º  no 1º mês de atividade, o sujeito passivo utiliza como receita bruta total acumulada
 *           "a receita auferida no próprio mês de apuração multiplicada por 12";
 *     § 3º  "nos 11 (onze) meses posteriores ao do início de atividade", utiliza "a média aritmética
 *           da receita bruta total auferida nos meses ANTERIORES ao do período de apuração,
 *           multiplicada por 12";
 *     § 4º  início no ano-calendário anterior ao da opção: regra do § 3º até completar 12 meses de
 *           atividade, e a do § 1º (RBT12 real) a partir do 13º mês.
 *
 *   Resolução CGSN 140/2018, art. 21, parágrafo único:
 *     "Apenas para efeito de determinação das alíquotas efetivas, quando a RBT12 [...] for igual a
 *      zero, considerar-se-á R$ 1,00 (um real)."
 *
 * ⚠ O § 3º DIZ "MESES ANTERIORES", NÃO "MESES DECORRIDOS" — e a diferença muda o número. No 2º mês
 * a média é a receita do 1º mês sozinha; o mês corrente NÃO entra. Boa parte do material de
 * terceiros descreve a regra como "receita acumulada ÷ meses decorridos × 12", que inclui o mês
 * corrente e dá outro resultado. O texto acima foi conferido em duas fontes independentes; quem
 * for mexer aqui confere na Resolução, não em blog.
 *
 * ⚠ A PROPORCIONALIZAÇÃO É DO § 2º DO ART. 18, QUE FALA DAS TABELAS. O art. 3º, § 2º proporcionaliza
 * outra coisa — o LIMITE de enquadramento no ano de início ("proporcional ao número de meses [...]
 * inclusive as frações de meses"). São regras distintas: uma escolhe a faixa, a outra decide se a
 * empresa continua podendo ser do Simples. `podeOptarPorReceita` NÃO implementa a segunda.
 */
export const INICIO_ATIVIDADE = Object.freeze({
  /** Do 1º ao 12º mês o RBT12 é proporcionalizado; do 13º em diante é o real (art. 22, § 4º, II). */
  ultimoMesProporcionalizado: 12,
  /** Art. 21, parágrafo único — vale só dentro da fórmula da alíquota, nunca como faturamento. */
  rbt12ZeroValePor: 1,
  fonte: "LC 123/2006, art. 18, § 2º; Resolução CGSN 140/2018, arts. 21, par. único, e 22, §§ 2º a 4º",
});

/**
 * O RBT12 de quem está em início de atividade, mês a mês.
 *
 * `mesesDeAtividade` é o número do mês de apuração dentro da atividade (1 = primeiro mês). É
 * ENTRADA OBRIGATÓRIA e não se infere da receita: duas empresas com o mesmo faturamento acumulado
 * podem estar no 2º ou no 9º mês, e a alíquota sai diferente.
 *
 * A receita entra de uma de duas formas, e a escolha não é estética:
 *  • `receitasMensais` — a série real, índice 0 = 1º mês. É a única forma que exercita o § 3º de
 *    verdade, porque só com receita variável a média dos meses anteriores difere do mês corrente.
 *  • `receitaMensalMedia` — receita mensal uniforme. É o que a TELA tem (ela trabalha em ano, não
 *    em série), e é premissa declarada, não simplificação escondida.
 */
export function rbt12InicioAtividade({ mesesDeAtividade, receitasMensais = null, receitaMensalMedia = null }) {
  const n = Math.trunc(Number(mesesDeAtividade));
  if (!Number.isFinite(n) || n < 1) return null;

  const serie = Array.isArray(receitasMensais) ? receitasMensais.map((v) => Number(v) || 0) : null;
  const media = receitaMensalMedia == null ? null : Number(receitaMensalMedia) || 0;
  if (!serie && media == null) return null;

  // A receita de um mês (1-based): da série quando ela existe, da média uniforme quando não.
  const mes = (i) => (serie ? (serie[i - 1] ?? 0) : media);
  const somar = (de, ate) => {
    let s = 0;
    for (let i = de; i <= ate; i += 1) s += mes(i);
    return s;
  };

  // 13º mês em diante: o § 4º, II devolve a regra do § 1º — RBT12 real dos 12 meses anteriores.
  if (n > INICIO_ATIVIDADE.ultimoMesProporcionalizado) {
    return resultadoRbt12({ rbt12: somar(n - 12, n - 1), proporcionalizado: false, regra: "art. 22, § 1º", mesesNaMedia: 12, mesAtividade: n });
  }

  // § 2º — o ÚNICO caso em que o próprio mês de apuração entra na conta.
  if (n === 1) {
    return resultadoRbt12({ rbt12: mes(1) * 12, proporcionalizado: true, regra: "art. 22, § 2º", mesesNaMedia: 1, mesAtividade: n });
  }

  // § 3º — média dos meses ANTERIORES ao de apuração; o corrente fica de fora.
  return resultadoRbt12({ rbt12: (somar(1, n - 1) / (n - 1)) * 12, proporcionalizado: true, regra: "art. 22, § 3º", mesesNaMedia: n - 1, mesAtividade: n });
}

function resultadoRbt12({ rbt12, proporcionalizado, regra, mesesNaMedia, mesAtividade }) {
  return Object.freeze({
    rbt12,
    // ⚠ SÓ para a fórmula (art. 21, par. único). Não é faturamento e não vai para a tela como tal:
    // exibir "RBT12 de R$ 1,00" seria trocar uma convenção de cálculo por um fato sobre a empresa.
    rbt12ParaAliquota: rbt12 === 0 ? INICIO_ATIVIDADE.rbt12ZeroValePor : rbt12,
    proporcionalizado,
    regra,
    mesesNaMedia,
    mesAtividade,
  });
}

/**
 * ALÍQUOTA EFETIVA — FONTES_FISCAIS §1.2 (LC 123/2006, art. 18, §§ 1º e 1º-A):
 *
 *     [(RBT12 × ALIQ_nominal) − PD] / RBT12
 *
 * ⚠ RBT12 ZERO devolve `null`, não 0%: a fórmula divide por ele, e 0% faria a empresa nova parecer
 * isenta enquanto a nominal a faria parecer mais cara que a real.
 *
 * ⚠⚠ E POR QUE O R$ 1,00 DO ART. 21, PAR. ÚNICO NÃO É APLICADO AQUI. A Resolução manda tratar
 * RBT12 zero como R$ 1,00 — o que joga a empresa na 1ª faixa (PD zero) e faz a efetiva sair igual à
 * nominal. Isso é correto quando o zero é um FATO (não houve receita). Aqui, `rbt12` zero quase
 * sempre significa outra coisa: o usuário não informou. Aplicar o R$ 1,00 nesse caso daria alíquota
 * de 1ª faixa a uma empresa de R$ 3 mi de receita — exatamente o "número errado com cara de
 * comparável" que este `null` existe para impedir. O piso legal é aplicado onde o zero é conhecido:
 * em `rbt12InicioAtividade`, via `rbt12ParaAliquota`.
 */
export function aliquotaEfetiva(anexo, rbt12) {
  const v = Number(rbt12) || 0;
  if (v <= 0) return null;
  const faixa = faixaDoRbt12(anexo, v);
  if (!faixa) return null;
  return (v * faixa.aliquota - faixa.pd) / v;
}

/**
 * A REPARTIÇÃO por tributo, já com o TETO DO ISS aplicado.
 *
 * ⚠ O TETO É ABSOLUTO, NÃO PROPORCIONAL: o ISS efetivo não passa de 5% DA RECEITA. Quando a
 * alíquota efetiva supera o gatilho da faixa, o ISS trava em 5% e o que sobra
 * (alíquota efetiva − 5%) é repartido entre os federais por percentuais PRÓPRIOS — que não são os
 * mesmos da partilha normal da faixa. Aplicar a partilha comum e depois "cortar" o ISS daria um
 * total diferente da alíquota efetiva, e a soma dos tributos deixaria de fechar com o DAS.
 */
export function repartirPorTributo(anexo, rbt12) {
  const efetiva = aliquotaEfetiva(anexo, rbt12);
  if (efetiva == null) return null;
  const faixa = faixaDoRbt12(anexo, rbt12);

  const teto = anexo.tetoIss;
  const aplicaTeto = teto && faixa.faixa === teto.faixa && efetiva > teto.aliquotaEfetivaGatilho;

  if (!aplicaTeto) {
    const out = {};
    for (const [trib, pct] of Object.entries(faixa.partilha)) out[trib] = efetiva * pct;
    return { aliquotaEfetiva: efetiva, faixa: faixa.faixa, porTributo: out, tetoIssAplicado: false };
  }

  const excedente = efetiva - ISS_FAIXA_LEGAL.maximo;
  const out = { iss: ISS_FAIXA_LEGAL.maximo };
  for (const [trib, pct] of Object.entries(teto.redistribuicao)) out[trib] = excedente * pct;
  return { aliquotaEfetiva: efetiva, faixa: faixa.faixa, porTributo: out, tetoIssAplicado: true };
}

/**
 * ⚠⚠ O QUE SAI DO DAS ACIMA DO SUBLIMITE — LC 123/2006, art. 13-A (§1.1).
 *
 * Passando de R$ 3,6 mi de RBT12 (a 6ª faixa), ICMS e ISS deixam de ser recolhidos no DAS e passam
 * a ser pagos por fora, pelas regras estaduais/municipais. A empresa continua no Simples para os
 * federais — o que muda é que o DAS encolhe SEM a empresa pagar menos.
 *
 * ⚠ QUAL DELES SAI NÃO É HARDCODE: é o que a própria tabela do anexo mostra — o tributo que existe
 * nas faixas de baixo e SOME na 6ª. O Anexo I perde o ICMS; o III, IV e V perdem o ISS; o II perde
 * o ICMS e mantém o IPI. Escrever a lista à mão aqui a faria divergir da tabela no dia em que a
 * tabela mudar, que é o único dia em que isso importa.
 */
export function tributosForaDoDasNaSextaFaixa(anexo) {
  const primeira = anexo.faixas[0].partilha;
  const sexta = anexo.faixas[anexo.faixas.length - 1].partilha;
  return ["icms", "iss"].filter((t) => primeira[t] != null && sexta[t] == null);
}

/**
 * FATOR R — FONTES_FISCAIS §1.8 (art. 18, §§ 5º-J e 5º-M).
 *
 *     Fator R = folha de 12 meses / RBT12
 *
 * A folha INCLUI pró-labore e encargos. Apuração mensal sobre os 12 meses anteriores: o
 * enquadramento pode alternar mês a mês, e é por isso que a tela mostra a margem, não só o lado.
 *
 * ⚠⚠ FOLHA `null` (NÃO INFORMADA) DEVOLVE `null`, NÃO ZERO — e esta é a guarda mais cara do módulo.
 * `Number(null)` é 0, e 0 é finito: sem esta linha, uma folha DESCONHECIDA produzia Fator R 0,00%,
 * `anexoPorFatorR` respondia "V" (a alíquota maior), e o comparativo passava a recomendar regime
 * com base num número que ninguém informou — num PDF que vai para o cliente do contador. Folha
 * zero de verdade continua sendo `0`, e continua dando Fator R 0: o que muda é que AUSÊNCIA deixou
 * de ser confundida com ela.
 */
export function fatorR(folha12m, rbt12) {
  const r = Number(rbt12) || 0;
  if (r <= 0) return null;
  if (folha12m == null || !Number.isFinite(Number(folha12m))) return null;
  return Number(folha12m) / r;
}

/** ≥ 28% → Anexo III; abaixo → Anexo V. Só vale para atividade sujeita ao fator (§ 5º-M). */
export function anexoPorFatorR(folha12m, rbt12) {
  const fr = fatorR(folha12m, rbt12);
  if (fr == null) return null;
  return fr >= FATOR_R_LIMITE ? "III" : "V";
}

/**
 * A FOLHA QUE FALTA para alcançar o Fator R de 28% — em reais, não em pontos percentuais.
 *
 * "Faltam 2,3 p.p." não diz o que fazer. `folhaParaFatorR` responde "aumente R$ X de folha no ano",
 * que é a decisão. Já no lado ≥ 28%, devolve a MARGEM: quanto a folha pode cair antes de a empresa
 * despencar para o Anexo V.
 */
export function folhaParaFatorR(folha12m, rbt12) {
  const r = Number(rbt12) || 0;
  if (r <= 0) return null;
  // Par da guarda de `fatorR`: sem folha informada não há "quanto falta" nem "quanto pode cair".
  // O gauge não renderiza — e quem explica o que falta é o card do Simples, que sai indisponível.
  if (folha12m == null || !Number.isFinite(Number(folha12m))) return null;
  const necessaria = r * FATOR_R_LIMITE;
  const atual = Number(folha12m) || 0;
  return {
    fatorR: atual / r,
    folhaNecessaria: necessaria,
    // Positivo: falta folha. Negativo: é a margem de sobra até cair para o Anexo V.
    diferenca: necessaria - atual,
    atinge: atual / r >= FATOR_R_LIMITE,
  };
}

/**
 * Custo anual no Simples.
 *
 * ⚠ `cppPorFora` NÃO É DETALHE. No Anexo IV a CPP fica FORA do DAS (art. 18, § 5º-C): a empresa
 * paga 20% de INSS patronal por fora, como qualquer outra. Comparar o Anexo IV com outro regime sem
 * somar isso faz ele parecer artificialmente barato — o próprio documento de fontes abre um alerta
 * para esse erro. Aqui a soma é obrigatória e aparece separada no resultado.
 *
 * ⚠ `mesesDeAtividade` (1 = primeiro mês) LIGA A REGRA DE INÍCIO DE ATIVIDADE e, com ela, uma
 * PREMISSA: sem série mensal, a receita informada é lida como projeção ANUALIZADA, e a média mensal
 * é ela ÷ 12. Sob receita uniforme o RBT12 proporcionalizado coincide com a receita anual — o que
 * muda não é o número, é ele existir: antes desta entrada a empresa nova caía em `indisponivel`.
 * Com receita em rampa (o caso real de quem abriu agora) a série muda o resultado, e aí o motor
 * precisa dela — passe `receitasMensais`.
 *
 * ⚠⚠ `aliquotaIss` SÓ TEM EFEITO NA 6ª FAIXA, e a assimetria é a regra, não uma exceção do código:
 * abaixo do sublimite o ISS JÁ ESTÁ no DAS (está na partilha da faixa), e somá-lo de novo cobraria
 * o mesmo imposto duas vezes. Acima do sublimite ele saiu do DAS (art. 13-A) e passa a ser custo
 * por fora — se não entrar aqui, o Simples aparece mais barato exatamente onde ele não é, enquanto
 * o card do Presumido soma o ISS e ainda imprime o que ficou de fora. Era a comparação decidida por
 * um imposto que existe nos dois lados e só aparecia em um.
 *
 * ⚠⚠ E LIGA TAMBÉM A GUARDA DE ELEGIBILIDADE (art. 3º, § 2º). Quando o excesso sobre o limite
 * proporcional passa de 20%, a exclusão RETROAGE ao início das atividades: os números do Simples
 * para o ano deixam de valer, e por isso o resultado sai `elegivel: false` — o comparador tira o
 * regime da disputa em vez de coroá-lo vencedor. Até 20%, a empresa fica no regime neste ano e sai
 * no seguinte (§ 12): o cálculo do ano continua válido, e o que vai junto é o aviso.
 */
export function custoAnualSimples({
  anexoChave, rbt12, receitaAnual, folhaAnual = 0,
  aliquotaIss = null, // §9 — parâmetro; só entra na 6ª faixa, quando o ISS sai do DAS
  mesesDeAtividade = null, receitasMensais = null,
  mesesNoAnoDeInicio = null, sublimiteMensal,
}) {
  const anexo = ANEXOS[anexoChave];
  if (!anexo) return null;

  const serie = Array.isArray(receitasMensais) ? receitasMensais.map((v) => Number(v) || 0) : null;
  const receita = Number(receitaAnual) || 0;
  const mediaMensal = receita / 12;

  const inicio = mesesDeAtividade == null
    ? null
    : rbt12InicioAtividade({ mesesDeAtividade, receitasMensais: serie, receitaMensalMedia: mediaMensal });

  // ⚠ A guarda só vale DENTRO do ano-calendário de início. Do 13º mês em diante a empresa já está
  // no ano seguinte, onde vale o limite anual cheio.
  //
  // ⚠ NÃO COBERTO, DE PROPÓSITO: a CGSN 140/2018, art. 3º, § 3º, I manda usar o limite proporcional
  // também para a OPÇÃO de quem abriu no ano-calendário anterior — o que exigiria a receita daquele
  // ano como entrada própria, que a tela não tem. Assumir que os meses informados caem todos no ano
  // simulado erra para o lado ESTRITO (limite menor, aviso a mais), nunca para o lado que deixaria
  // passar um estouro.
  const guarda = (inicio && inicio.proporcionalizado)
    ? limiteProporcionalInicioAtividade({
      mesesNoAnoDeInicio: mesesNoAnoDeInicio ?? mesesDeAtividade,
      receitaNoAnoDeInicio: serie
        ? serie.slice(0, mesesNoAnoDeInicio ?? mesesDeAtividade).reduce((s, v) => s + v, 0)
        : mediaMensal * (mesesNoAnoDeInicio ?? mesesDeAtividade),
      sublimiteMensal,
    })
    : null;

  // Só a exclusão RETROATIVA invalida o ano simulado; a que só produz efeitos no ano seguinte, não.
  if (guarda?.efeitoExclusao === "retroativo_ao_inicio") {
    return {
      regime: "Simples Nacional",
      elegivel: false,
      elegibilidadeInicioAtividade: guarda,
      motivo: `Receita de ${brl(guarda.receita)} nos ${guarda.meses} meses de atividade ultrapassa em mais de 20% o limite proporcional de ${brl(guarda.limite)} `
        + `(${guarda.meses} × ${brl(LIMITE_PROPORCIONAL_INICIO.porMes)}). A exclusão retroage ao início das atividades — LC 123/2006, art. 3º, §§ 2º e 10.`,
    };
  }

  // Na fórmula entra o piso do art. 21, par. único; o que a tela mostra é o RBT12 de verdade.
  const rbtParaAliquota = inicio ? inicio.rbt12ParaAliquota : rbt12;
  const rbtExibido = inicio ? inicio.rbt12 : rbt12;

  const rep = repartirPorTributo(anexo, rbtParaAliquota);
  if (!rep) return { indisponivel: true, motivo: "Sem RBT12 não há alíquota efetiva — informe a receita dos 12 meses anteriores ou os meses de atividade, se a empresa estiver começando." };

  const das = rep.aliquotaEfetiva * receita;

  // A CPP por fora incide sobre a FOLHA, não sobre a receita.
  //
  // ⚠ FOLHA NÃO INFORMADA (`null`) NO ANEXO IV NÃO VIRA CPP ZERO. No Anexo IV a CPP está fora do
  // DAS, então zerá-la faria o regime aparecer 20% da folha mais barato do que é — exatamente o
  // erro que o alerta do documento de fontes descreve, só que causado por ausência de dado em vez
  // de esquecimento. Sem folha, a CPP sai da soma E vai para `naoConsiderado`, no corpo do card.
  const folhaInformada = folhaAnual != null && Number.isFinite(Number(folhaAnual));
  const cppPorFora = anexo.cppForaDoDas && folhaInformada ? Number(folhaAnual) * ENCARGOS_FOLHA.cppPatronal : 0;
  const cppNaoEstimada = Boolean(anexo.cppForaDoDas) && !folhaInformada;

  // ⚠⚠ ACIMA DO SUBLIMITE O DAS ENCOLHE SEM A EMPRESA PAGAR MENOS (art. 13-A). O que saiu do DAS
  // tem de voltar à conta — como VALOR quando temos a alíquota, e como RESSALVA quando não temos.
  // Ausência não é zero: um total sem o ISS é comparado, lado a lado, com um Presumido que o soma.
  const foraDoDas = rep.faixa === 6 ? tributosForaDoDasNaSextaFaixa(anexo) : [];
  const issForaDoDas = foraDoDas.includes("iss") && aliquotaIss != null
    ? receita * Number(aliquotaIss)
    : 0;

  return {
    regime: "Simples Nacional",
    anexo: anexo.nome,
    faixa: rep.faixa,
    aliquotaEfetiva: rep.aliquotaEfetiva,
    tetoIssAplicado: rep.tetoIssAplicado,
    das,
    cppPorFora,
    // O ISS que saiu do DAS e voltou pela alíquota informada — zero quando ela não foi informada
    // (e aí a ausência viaja em `naoConsiderado`, não em silêncio).
    issPorFora: issForaDoDas,
    acimaDoSublimite: rep.faixa === 6,
    total: das + cppPorFora + issForaDoDas,
    rbt12Utilizado: rbtExibido,
    // Presente só em início de atividade — é o que a tela usa para dizer que o RBT12 é premissa.
    inicioAtividade: inicio,
    // Presente só em início de atividade — traz a margem até o limite proporcional, e é o que o
    // card usa para avisar que a elegibilidade está por um fio ANTES de ela se perder.
    elegibilidadeInicioAtividade: guarda,
    // Carga sobre a receita, já com o que sai por fora — é o número comparável entre regimes.
    cargaEfetiva: receita > 0 ? (das + cppPorFora + issForaDoDas) / receita : null,
    porTributo: {
      ...Object.fromEntries(Object.entries(rep.porTributo).map(([t, pct]) => [t, pct * receita])),
      // Na 6ª faixa o ISS não vem da partilha (ele saiu dela) — vem da alíquota do município.
      ...(issForaDoDas > 0 ? { iss: issForaDoDas } : {}),
    },
    // ⚠⚠ A RESSALVA TEM O MESMO PESO DO NÚMERO QUE ELA QUALIFICA — é a regra do `CardRegime`, que
    // renderiza `naoConsiderado` no CORPO do card, em bloco de alerta. Sem esta lista, o Simples
    // acima do sublimite mostrava um total reduzido, sem uma linha dizendo o que faltava nele,
    // ao lado de um Presumido que soma o ISS e imprime o próprio "Fora desta conta".
    naoConsiderado: [
      foraDoDas.includes("iss") && aliquotaIss == null
        ? `ISS: acima do sublimite de ${brl(LIMITES_SIMPLES.sublimiteIcmsIss)} ele SAI do DAS e é recolhido por fora — informe a alíquota do município para que entre nesta conta`
        : null,
      foraDoDas.includes("icms")
        ? `ICMS: acima do sublimite de ${brl(LIMITES_SIMPLES.sublimiteIcmsIss)} ele SAI do DAS e passa a ser recolhido pelas regras do estado — não estimado aqui`
        : null,
      cppNaoEstimada
        ? "CPP (INSS patronal de 20%): no Anexo IV ela fica FORA do DAS, e a folha de 12 meses não foi informada — não estimada aqui, então este total está subestimado"
        : null,
    ].filter(Boolean),
    premissas: [
      `${anexo.nome} (${anexo.fonte})`,
      inicio?.proporcionalizado
        ? `RBT12 PROPORCIONALIZADO de ${brl(rbtExibido)} → ${rep.faixa}ª faixa — empresa no ${inicio.mesAtividade}º mês de atividade, sem 12 meses de histórico (LC 123/2006, art. 18, § 2º; Resolução CGSN 140/2018, ${inicio.regra})`
        : `RBT12 de ${brl(rbtExibido)} → ${rep.faixa}ª faixa`,
      guarda
        ? `Limite proporcional do ano de início: ${brl(guarda.limite)} (${guarda.meses} × ${brl(LIMITE_PROPORCIONAL_INICIO.porMes)}) — receita de ${brl(guarda.receita)} no período (LC 123/2006, art. 3º, § 2º)`
        : null,
      guarda?.efeitoExclusao === "ano_calendario_subsequente"
        ? "⚠ Limite proporcional ultrapassado em até 20%: a empresa permanece no Simples neste ano e é excluída a partir do ano-calendário seguinte (art. 3º, § 12)"
        : null,
      rep.faixa === 6
        ? `6ª faixa: com RBT12 acima do sublimite de ${brl(LIMITES_SIMPLES.sublimiteIcmsIss)}, ${foraDoDas.map((t) => t.toUpperCase()).join(" e ")} ${foraDoDas.length > 1 ? "saem" : "sai"} do DAS e ${foraDoDas.length > 1 ? "são recolhidos" : "é recolhido"} por fora (LC 123/2006, art. 13-A)`
        : null,
      issForaDoDas > 0
        ? `ISS de ${(Number(aliquotaIss) * 100).toFixed(2).replace(".", ",")}% somado POR FORA do DAS: ${brl(issForaDoDas)}`
        : null,
      rep.tetoIssAplicado ? "Teto de ISS de 5% aplicado, com redistribuição aos federais" : null,
      anexo.cppForaDoDas && folhaInformada
        ? `CPP de 20% somada POR FORA sobre folha de ${brl(folhaAnual)} — no Anexo IV ela não está no DAS`
        : null,
    ].filter(Boolean),
  };
}

/**
 * ⚠⚠ GUARDA DE ELEGIBILIDADE — LIMITE PROPORCIONAL NO ANO DE INÍCIO.
 * FONTES_FISCAIS §1.13 (LC 123/2006, art. 3º, §§ 2º e 10 a 13).
 *
 * Esta função não melhora número nenhum: ela impede um estrago. O cenário que ela existe para
 * barrar é o pior deste módulo — o simulador diz a uma empresa aberta em setembro que "o Simples
 * vence", ela opta, e a receita dos meses de atividade estoura um limite que ninguém verificou.
 * A consequência não é pagar um pouco mais: é EXCLUSÃO RETROATIVA AO INÍCIO DAS ATIVIDADES, com
 * todos os tributos do período refeitos pelas normas gerais (CGSN 140/2018, art. 3º, § 1º).
 *
 * O efeito MUDA COM O TAMANHO DO EXCESSO, e é por isso que não basta um booleano:
 *   • excesso ≤ 20% do limite proporcional → efeitos só no ano-calendário SEGUINTE (§ 12);
 *   • excesso  > 20%                       → efeitos RETROATIVOS ao início (§ 10).
 *
 * ⚠ "INCLUSIVE AS FRAÇÕES DE MESES" (art. 3º, § 2º): quem abriu em 20 de setembro tem SETEMBRO
 * inteiro na conta — 4 meses até dezembro, não 3,3. Arredondar para baixo daria um limite menor que
 * o legal e acusaria estouro onde não há.
 *
 * `mesesNoAnoDeInicio` é o número de meses de atividade DENTRO do ano-calendário de início — não é
 * o mesmo `mesesDeAtividade` do RBT12, que atravessa o ano-calendário (art. 22, § 4º). Para uma
 * empresa que abriu em novembro e apura em janeiro, são 2 meses ali e 3 meses de atividade aqui.
 */
export function limiteProporcionalInicioAtividade({
  mesesNoAnoDeInicio,
  receitaNoAnoDeInicio,
  sublimiteMensal = LIMITE_PROPORCIONAL_INICIO.sublimitePorMes,
}) {
  const meses = Math.ceil(Number(mesesNoAnoDeInicio)); // fração de mês conta como mês completo
  if (!Number.isFinite(meses) || meses < 1 || meses > 12) return null;

  const receita = Number(receitaNoAnoDeInicio) || 0;
  const limite = LIMITE_PROPORCIONAL_INICIO.porMes * meses;
  const sublimite = sublimiteMensal * meses;

  const excesso = Math.max(0, receita - limite);
  const excessoSublimite = Math.max(0, receita - sublimite);
  const tolerancia = LIMITE_PROPORCIONAL_INICIO.toleranciaSemRetroatividade;

  // Sobra até estourar, e quanto do limite já foi consumido — é o que alimenta o aviso "por um fio".
  const margem = limite - receita;
  const consumoDoLimite = limite > 0 ? receita / limite : null;

  return Object.freeze({
    meses,
    limite,
    sublimite,
    receita,
    margem,
    consumoDoLimite,
    excedeu: excesso > 0,
    excesso,
    // O degrau do § 12: acima de 20% do limite, a exclusão retroage ao início das atividades.
    efeitoExclusao: excesso <= 0
      ? null
      : (excesso > limite * tolerancia ? "retroativo_ao_inicio" : "ano_calendario_subsequente"),
    excedeuSublimite: excessoSublimite > 0,
    excessoSublimite,
    // Regra gêmea do art. 12, § 4º — mesmo degrau de 20%, mas o efeito é perder ICMS/ISS no DAS.
    efeitoSublimite: excessoSublimite <= 0
      ? null
      : (excessoSublimite > sublimite * tolerancia ? "retroativo_ao_inicio" : "ano_calendario_subsequente"),
    fonte: LIMITE_PROPORCIONAL_INICIO.fonte,
  });
}

/**
 * Pode optar pelo Simples por RECEITA? As demais vedações (art. 17) não são avaliadas aqui.
 *
 * ⚠ O segundo argumento liga a guarda de INÍCIO DE ATIVIDADE. Sem ele a função avalia o limite
 * anual cheio, que é o certo para empresa estabelecida e o ERRADO para quem abriu no meio do ano:
 * uma empresa aberta em outubro com R$ 1,5 mi de receita passa folgada no teto de R$ 4,8 mi e
 * estoura o limite proporcional de R$ 1,2 mi (3 meses × R$ 400 mil).
 */
export function podeOptarPorReceita(rbt12, { mesesNoAnoDeInicio = null, receitaNoAnoDeInicio = null, sublimiteMensal } = {}) {
  const v = Number(rbt12) || 0;

  const inicio = mesesNoAnoDeInicio == null
    ? null
    : limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio, receitaNoAnoDeInicio, sublimiteMensal });

  return {
    // No ano de início quem manda é o limite proporcional, não o anual (art. 3º, § 2º).
    pode: inicio ? !inicio.excedeu : v <= LIMITES_SIMPLES.epp,
    acimaDoSublimite: inicio ? inicio.excedeuSublimite : v > LIMITES_SIMPLES.sublimiteIcmsIss,
    // ⚠ Acima do sublimite ICMS e ISS SAEM do DAS e são recolhidos por fora, pelas regras
    // estaduais/municipais — que são parâmetro de entrada, não cálculo nosso.
    aviso: !inicio && v > LIMITES_SIMPLES.sublimiteIcmsIss && v <= LIMITES_SIMPLES.epp
      ? "Acima do sublimite de R$ 3,6 mi: ICMS e ISS saem do DAS e passam a ser recolhidos por fora."
      : null,
    inicioAtividade: inicio,
  };
}

function brl(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
