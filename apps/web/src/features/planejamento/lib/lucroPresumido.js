// MOTOR DO LUCRO PRESUMIDO — para SIMULAÇÃO comparativa.
//
// Constantes em `tabelasFiscais.js`, cada uma citando o documento FONTES FISCAIS.

import {
  PRESUNCAO_IRPJ, PRESUNCAO_CSLL, MAJORACAO_LC224, IRPJ, CSLL_ALIQUOTA,
  PIS_COFINS_CUMULATIVO, LIMITE_LUCRO_PRESUMIDO, LIMITE_SERVICOS_16_PCT, ENCARGOS_FOLHA,
} from "./tabelasFiscais";

/**
 * As atividades que o simulador oferece, com as duas presunções (§2.2 e §2.3).
 *
 * ⚠⚠ AS DUAS PRESUNÇÕES SÃO INDEPENDENTES, E O TRANSPORTE É ONDE ISSO APARECE. As tabelas de IRPJ
 * (art. 15) e de CSLL (art. 20) não são a mesma lista com outro número: o art. 20 remete APENAS aos
 * incisos III e IV do § 1º do art. 15 e joga todo o resto em 12%. Transporte está no inciso II —
 * logo, CSLL de 12% para passageiros E para cargas. A ÚNICA diferença entre os dois é o IRPJ: 16%
 * (inciso II, "a") contra 8% (caput). Copiar a linha de serviços para passageiros porque "transporte
 * de passageiros é serviço" foi o defeito corrigido em 15/08/2026 — ver `PRESUNCAO_CSLL`.
 */
export const ATIVIDADES_PRESUMIDO = Object.freeze({
  comercio: { rotulo: "Comércio / Indústria", irpj: PRESUNCAO_IRPJ.comercioIndustria, csll: PRESUNCAO_CSLL.demaisReceitas },
  servicos: { rotulo: "Serviços em geral", irpj: PRESUNCAO_IRPJ.servicosGeral, csll: PRESUNCAO_CSLL.servicosGeral },
  transporteCargas: { rotulo: "Transporte de cargas", irpj: PRESUNCAO_IRPJ.comercioIndustria, csll: PRESUNCAO_CSLL.demaisReceitas },
  transportePassageiros: { rotulo: "Transporte de passageiros", irpj: PRESUNCAO_IRPJ.transportePassageiros, csll: PRESUNCAO_CSLL.demaisReceitas },
  combustiveis: { rotulo: "Revenda de combustíveis", irpj: PRESUNCAO_IRPJ.combustiveis, csll: PRESUNCAO_CSLL.demaisReceitas },
});

/**
 * MAJORAÇÃO DA LC 224/2025 — FONTES_FISCAIS §2.4.
 *
 * ⚠ ESTA É A ARMADILHA DA REGRA, e ela custa dinheiro real: **os limites de IRPJ e CSLL são
 * DIFERENTES em 2026**. O IRPJ vale desde 01/01/2026, com o limite anual cheio de R$ 5 mi. A CSLL
 * só entrou em 01/04/2026 pela noventena, então o limite dela no ano é ¾ disso — R$ 3,75 mi. Usar
 * o mesmo número para os dois majoraria a CSLL sobre R$ 1,25 mi de receita que a lei ainda não
 * alcançava naquele ano.
 *
 * ⚠ A majoração é MULTIPLICATIVA (×1,10), não aditiva: 32% vira 35,2%, não 42%.
 *
 * ⚠ Só o EXCEDENTE é majorado. Até o limite, a presunção é a normal — por isso a base sai em duas
 * parcelas, não uma alíquota média.
 */
export function baseComMajoracao({ receitaAnual, presuncao, limite }) {
  const receita = Number(receitaAnual) || 0;
  const ate = Math.min(receita, limite);
  const excedente = Math.max(0, receita - limite);
  return {
    baseNormal: ate * presuncao,
    baseMajorada: excedente * presuncao * MAJORACAO_LC224.fator,
    base: ate * presuncao + excedente * presuncao * MAJORACAO_LC224.fator,
    excedente,
    houveMajoracao: excedente > 0,
  };
}

/**
 * ADICIONAL DE IRPJ — 10% sobre o que exceder R$ 20.000/mês.
 *
 * ⚠ A APURAÇÃO DO PRESUMIDO É TRIMESTRAL (Lei 9.430/1996), então o limite prático é R$ 60.000 POR
 * TRIMESTRE. Aplicar o limite anual de R$ 240.000 de uma vez dá o mesmo número só quando a base é
 * uniforme nos quatro trimestres; com sazonalidade, subestima — o trimestre forte estoura o limite
 * e o fraco não devolve. Aqui o cálculo é por trimestre, com a base anual dividida em quatro; a
 * distribuição real por trimestre é dado que o simulador não tem.
 */
export function adicionalIrpjAnual(baseAnual) {
  const porTrimestre = (Number(baseAnual) || 0) / 4;
  const excedenteTrimestre = Math.max(0, porTrimestre - IRPJ.limiteAdicionalTrimestral);
  return excedenteTrimestre * IRPJ.adicional * 4;
}

/**
 * Custo anual no Lucro Presumido.
 *
 * ⚠ ISS/ICMS NÃO ENTRAM AQUI. Eles são PARÂMETRO DE ENTRADA (§9): a alíquota varia por município e
 * por serviço, e por estado/NCM/operação. Quem informa é o cadastro da empresa. Somar um valor
 * "típico" seria inventar o número que decide a comparação.
 */
export function custoAnualPresumido({
  receitaAnual, atividade = "servicos", folhaAnual = 0,
  aliquotaIss = null, // §9 — parâmetro; null = não considerado, e a tela DIZ isso
  anoBase = 2026,
  // ⚠⚠ TRÊS ESTADOS, e o `null` é o que preserva o comportamento de hoje.
  //   null  = não perguntado  ⇒ 32%, como sempre foi. A tela OFERECE.
  //   true  = o contador confirmou o enquadramento do art. 15, § 4º ⇒ IRPJ 16% (CSLL segue 32%)
  //   false = o contador disse que NÃO se enquadra ⇒ 32%
  // Ligar sozinho seria o portal afirmando que a empresa não é hospitalar, não é de transporte e
  // não é de profissão regulamentada — três fatos que ele não tem.
  servicosAte120kConfirmado = null,
}) {
  const receita = Number(receitaAnual) || 0;
  const at = ATIVIDADES_PRESUMIDO[atividade];
  if (!at) return null;

  // Em 2026 a CSLL tem limite próprio (noventena). Em anos seguintes os dois convergem para o
  // limite cheio — daí o `anoBase` explícito, em vez de assumir para sempre o caso de 2026.
  const limiteCsll = anoBase === 2026 ? MAJORACAO_LC224.limiteCsll2026 : MAJORACAO_LC224.limiteIrpj;

  // ⚠ A redução só vale DENTRO do limite. Acima dele o § 5º manda o contrário: 32% retroativo ao
  // ano inteiro, com recolhimento da diferença — então uma confirmação antiga não pode "colar" numa
  // receita que cresceu.
  const oferta = ofertaServicos16({ receitaAnual: receita, atividade });
  const usa16 = servicosAte120kConfirmado === true && Boolean(oferta?.cabe);
  const presuncaoIrpj = usa16 ? PRESUNCAO_IRPJ.servicosAte120k : at.irpj;

  const bIrpj = baseComMajoracao({ receitaAnual: receita, presuncao: presuncaoIrpj, limite: MAJORACAO_LC224.limiteIrpj });
  const bCsll = baseComMajoracao({ receitaAnual: receita, presuncao: at.csll, limite: limiteCsll });

  const irpj = bIrpj.base * IRPJ.aliquota;
  const adicional = adicionalIrpjAnual(bIrpj.base);
  const csll = bCsll.base * CSLL_ALIQUOTA;
  const pis = receita * PIS_COFINS_CUMULATIVO.pis;
  const cofins = receita * PIS_COFINS_CUMULATIVO.cofins;
  // §2.7 e §5 — no Presumido a CPP é SEMPRE por fora, sobre a folha.
  //
  // ⚠ FOLHA `null` = NÃO INFORMADA, e aqui isso pesa mais que no Simples: no Presumido a CPP entra
  // em TODA empresa. Zerá-la por ausência de dado barateia o regime em 20% da folha e pode inverter
  // a comparação sozinha. Sem folha, a parcela sai da soma e a falta vai declarada em
  // `naoConsiderado`, ao lado do número — a mesma regra do ISS.
  const folhaInformada = folhaAnual != null && Number.isFinite(Number(folhaAnual));
  const cpp = folhaInformada ? Number(folhaAnual) * ENCARGOS_FOLHA.cppPatronal : 0;
  const iss = aliquotaIss == null ? 0 : receita * Number(aliquotaIss);

  const total = irpj + adicional + csll + pis + cofins + cpp + iss;

  return {
    regime: "Lucro Presumido",
    atividade: at.rotulo,
    // A oferta viaja para a tela poder PERGUNTAR, e o que foi usado viaja para o PDF poder DIZER.
    servicosAte120k: oferta ? { ...oferta, aplicado: usa16, confirmado: servicosAte120kConfirmado } : null,
    elegivel: receita <= LIMITE_LUCRO_PRESUMIDO,
    porTributo: { irpj, adicionalIrpj: adicional, csll, pis, cofins, ...(folhaInformada ? { cpp } : {}), ...(aliquotaIss == null ? {} : { iss }) },
    total,
    cargaEfetiva: receita > 0 ? total / receita : null,
    // ⚠ A tela PRECISA dizer o que ficou de fora, senão o número parece completo e não é.
    naoConsiderado: [
      aliquotaIss == null ? "ISS (informe a alíquota do município no cadastro)" : null,
      // ⚠⚠ OFERTA NÃO RESPONDIDA APARECE, senão o total fica MAIOR do que precisa e ninguém sabe
      // por quê. Ausência de resposta não é resposta — mesma disciplina da folha.
      oferta?.cabe && servicosAte120kConfirmado == null
        ? `presunção de IRPJ de 16% (art. 15, § 4º): a receita cabe no limite de ${brl(LIMITE_SERVICOS_16_PCT)}, `
          + "mas o enquadramento não foi confirmado — este total usa 32% e pode estar SUPERESTIMADO"
        : null,
      folhaInformada
        ? null
        : "CPP (INSS patronal de 20% sobre a folha): a folha de 12 meses não foi informada — não estimada aqui, então este total está subestimado",
      "ICMS e substituição tributária, quando houver",
      "RAT/FAP e contribuições a terceiros sobre a folha",
    ].filter(Boolean),
    premissas: [
      `Presunção de IRPJ ${(presuncaoIrpj * 100).toFixed(1).replace(".", ",")}% e de CSLL ${(at.csll * 100).toFixed(1).replace(".", ",")}% (FONTES_FISCAIS §2.2 e §2.3)`,
      // ⚠ O QUE FOI CONFIRMADO SAI IMPRESSO. O PDF circula sozinho, e dois PDFs da mesma empresa
      // com IRPJ diferente precisam se distinguir NO PAPEL — é a mesma regra da procedência dos
      // campos. Sem esta linha, o 16% pareceria erro de cálculo.
      usa16
        ? `IRPJ presumido a 16% POR CONFIRMAÇÃO DO CONTADOR: receita até ${brl(LIMITE_SERVICOS_16_PCT)} `
          + "(Lei 9.249/1995, art. 15, § 4º). A CSLL continua em 32%. ⚠ Passando do limite no ano, a "
          + "presunção vira 32% RETROATIVA e a diferença é recolhida (§ 5º)."
        : null,
      bIrpj.houveMajoracao
        ? `LC 224/2025: presunção majorada em 10% sobre ${brl(bIrpj.excedente)} de receita acima de ${brl(MAJORACAO_LC224.limiteIrpj)} (IRPJ)`
        : null,
      bCsll.houveMajoracao
        ? `LC 224/2025: na CSLL o limite de ${anoBase} é ${brl(limiteCsll)} — menor que o do IRPJ pela noventena`
        : null,
      "PIS/COFINS no regime cumulativo, 3,65% sobre a receita, sem créditos (§2.6)",
      "Adicional de IRPJ calculado por TRIMESTRE (R$ 60.000 por trimestre), como manda a apuração trimestral",
      folhaInformada ? "CPP de 20% sobre a folha, recolhida por fora (§5)" : null,
    ].filter(Boolean),
    majoracaoLc224: {
      aplicada: bIrpj.houveMajoracao || bCsll.houveMajoracao,
      // O documento registra judicialização em curso. O motor aplica a regra vigente; a tela avisa.
      controvertida: MAJORACAO_LC224.controvertida,
    },
  };
}

/**
 * ⚠⚠ A REGRA DOS R$ 120.000 — IRPJ de 16%, CSLL de 32%. Lei 9.249/1995, art. 15, § 4º.
 *
 * Trazida pelo dono em 25/08/2026: *"o presumido é generalizado, como por exemplo, receita de
 * prestação de serviços até 120 mil, IRPJ de 16% e CSLL 32, é baseado nisso que veremos qual
 * atividade se encaixa, dividindo as atividades pelas categorias."*
 *
 * ⚠ ELA REDUZ SÓ O IRPJ. A CSLL continua em 32% — o art. 20 remete ao inciso III do § 1º do
 * art. 15, e o § 4º não o alcança. É a mesma assimetria que o transporte de passageiros já expõe
 * neste arquivo, e errar aqui é errar metade da conta.
 *
 * ⚠⚠ `PRESUNCAO_IRPJ.servicosAte120k = 0.16` EXISTIA COMO CONSTANTE E NUNCA ENTRAVA EM CONTA
 * NENHUMA — o único consumidor era um aviso de proximidade do limite, e
 * `ATIVIDADES_PRESUMIDO.servicos` usava 32% sempre. Medido em produção em 25/08/2026: **10 das 18
 * empresas com dado apurado têm receita abaixo de R$ 120 mil**, ou seja o simulador presumia o
 * DOBRO do IRPJ na maioria da carteira.
 *
 * ⚠⚠ E ELA NÃO SE LIGA SOZINHA, porque o § 4º EXCLUI três casos que o sistema não tem como
 * saber: serviços **hospitalares**, de **transporte**, e de **profissões legalmente
 * regulamentadas** — e exige que a pessoa jurídica seja EXCLUSIVAMENTE prestadora de serviços em
 * geral. Na carteira há caso concreto: uma empresa de terapia ocupacional (profissão
 * regulamentada) **não** teria direito, e o CNAE dela não diz isso. Por isso esta função OFERECE,
 * e quem decide é o contador.
 *
 * ⚠ E o § 5º torna a decisão cara nos dois sentidos: estourando os R$ 120.000 no ano, a presunção
 * vira 32% RETROATIVAMENTE e a empresa recolhe a diferença.
 *
 * @returns {null | {cabe, presuncaoIrpj, pergunta, excecoes, aviso}} `null` quando a pergunta não
 *   se aplica (outra categoria de atividade).
 */
export function ofertaServicos16({ receitaAnual, atividade = "servicos" }) {
  if (atividade !== "servicos") return null;
  const r = Number(receitaAnual) || 0;
  const cabe = r > 0 && r <= LIMITE_SERVICOS_16_PCT;

  return {
    cabe,
    presuncaoIrpj: PRESUNCAO_IRPJ.servicosAte120k,
    pergunta: cabe
      ? `Receita de ${brl(r)} está dentro do limite de ${brl(LIMITE_SERVICOS_16_PCT)}: a presunção de `
        + "IRPJ pode ser de 16% em vez de 32% (Lei 9.249/1995, art. 15, § 4º). A CSLL continua em "
        + "32%. Confirme que a empresa se enquadra — o portal não aplica isto sozinho."
      : null,
    // ⚠ NOMEADAS NA TELA. Sem elas o contador confirmaria sem saber o que está afirmando.
    excecoes: [
      "não vale para serviços hospitalares",
      "não vale para serviços de transporte",
      "não vale para sociedades de profissão legalmente regulamentada",
      "a empresa tem de ser EXCLUSIVAMENTE prestadora de serviços em geral",
    ],
    aviso: avisoTravaServicos16(r),
  };
}

/**
 * A trava dos 16% (§2.2): serviços com receita anual até R$ 120.000 presumem 16%; passando disso,
 * a empresa vai para 32% RETROATIVAMENTE e recolhe a diferença.
 *
 * Devolve o aviso quando a receita simulada está perto do limite — é armadilha clássica de quem
 * projeta crescimento e não conta com a virada retroativa.
 */
export function avisoTravaServicos16(receitaAnual) {
  const r = Number(receitaAnual) || 0;
  if (r > LIMITE_SERVICOS_16_PCT) return null;
  if (r < LIMITE_SERVICOS_16_PCT * 0.8) return null;
  return `A ${(LIMITE_SERVICOS_16_PCT / 1000).toFixed(0)} mil de receita a presunção de serviços salta de 16% para 32%, e a mudança é RETROATIVA ao ano inteiro — faltam ${brl(LIMITE_SERVICOS_16_PCT - r)}.`;
}

function brl(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
