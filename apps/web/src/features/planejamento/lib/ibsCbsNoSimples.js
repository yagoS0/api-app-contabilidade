// IBS E CBS NO SIMPLES NACIONAL — "por dentro" × "por fora", e o que a tela pode afirmar.
//
// ⚠⚠ TODO NÚMERO AQUI SAI DA LEI OU DE UM CAMPO DIGITADO. Nada é estimado por este módulo.
// A fonte é `docs/reforma-consumo/` (LC 214/2025 e LC 227/2026, textos compilados do Planalto, com
// SHA-256), e o resumo verificado está em `docs/fontes-fiscais.md` §6.1. **Ler o §6.1 antes de
// mexer**: a pesquisa que o escreveu derrubou quatro afirmações de um plano redigido sem a lei.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// AS TRÊS COISAS QUE ESTE MÓDULO EXISTE PARA NÃO DEIXAR A TELA ERRAR
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// 1 · ⚠⚠ EM 2026, PARA O OPTANTE, IBS E CBS SÃO **ZERO** — e é literal.
//     LC 214/2025, art. 348, III, "c": as alíquotas de teste dos arts. 343 (IBS 0,1%) e 346
//     (CBS 0,9%) *"não serão aplicadas em relação às operações dos contribuintes optantes pelo
//     Simples Nacional"*. Qualquer outro número numa competência de 2026 é INVENÇÃO.
//     ⚠ E os Anexos com coluna de CBS/IBS **também não valem em 2026**: o art. 519 da LC 214 (que
//     os reescreve) só produz efeitos em 1º/01/2027 (art. 544, III, redação da LC 227/2026).
//
// 2 · ⚠⚠ PARA 2027-2028, O IBS É CONHECIDO POR LEI E SÓ A CBS É DESCONHECIDA.
//     O IBS é 0,05% estadual + 0,05% municipal (art. 344) — **está na lei, não se digita**.
//     A alíquota de referência do IBS só é fixada *"para os anos de 2029 a 2033"* (art. 349, II).
//     A da CBS para 2027 será fixada pelo **Senado** até **15/12/2026** (art. 349, § 1º, II, com a
//     prorrogação de 45 dias do art. 353, § 2º) — ou seja, **hoje ela não existe**, e o contador
//     digita a estimativa dele. O PDF imprime que ela não está em lei.
//     ⚠ Os números que circulam (27,91% · 18,7% · 26,5%) **não estão nesta lei** e não entram aqui.
//
// 3 · ⚠⚠ NA 6ª FAIXA NÃO HÁ IBS DENTRO DO DAS — e isso muda o crédito.
//     Medido nos cinco anexos: a 6ª faixa tem duas colunas a menos, caem o ICMS/ISS **e o IBS**
//     (sublimite, LC 123 art. 13-A). Quem está nela transfere crédito calculado **só sobre a CBS**.
//     O dado gerado grava essas colunas como `null` — e `null` aqui NÃO é zero.

import { ANEXOS_SIMPLES_2027, VIGENCIA_ANEXOS_2027 } from "./anexosSimples2027.data";
// ⚠ A tabela VIGENTE (2026). Ela entra aqui para que "o DAS muda?" seja MEDIDO contra ela, e não
// afirmado por um literal — ver `mudancaDaNominal`.
import { ANEXOS } from "./tabelasFiscais";

/** `18.9` → `"18,90%"`. Duas casas porque é como a lei imprime a alíquota. */
const fmtPct = (n) => `${Number(n).toFixed(2).replace(".", ",")}%`;

/** Os dois cenários que a tela sabe responder. Lista FECHADA. */
export const CENARIO = Object.freeze({
  EM_2026: "2026",
  DE_2027_A_2028: "2027-2028",
});

/**
 * ⚠ O IBS de 2027-2028 está NA LEI, em duas parcelas. Some as duas para ter o total da operação.
 * LC 214/2025, art. 344.
 */
export const IBS_2027_2028 = Object.freeze({
  estadual: 0.05,
  municipal: 0.05,
  total: 0.1,
  fundamento: "LC 214/2025, art. 344",
});

/** As alíquotas de TESTE de 2026 — que existem, e que **não alcançam o optante**. */
export const TESTE_2026 = Object.freeze({
  ibs: 0.1,
  cbs: 0.9,
  fundamentoIbs: "LC 214/2025, art. 343",
  fundamentoCbs: "LC 214/2025, art. 346",
  fundamentoDaExclusao: 'LC 214/2025, art. 348, III, "c"',
});

/**
 * A JANELA DA OPÇÃO "POR FORA".
 *
 * ⚠⚠ A REDAÇÃO ORIGINAL DA LC 214 DIZIA "setembro e ABRIL", com outra numeração de parágrafos.
 * Foi a LC 227/2026 que mudou para **março** e renumerou (§ 9º e § 10 do art. 13 da LC 123). As
 * duas versões estão impressas lado a lado no arquivo do Planalto, e ler a errada anuncia a data
 * errada ao contador.
 *
 * ⚠⚠ E ELA DEPENDE DE ATO DO CGSN — o § 10 diz *"na forma regulamentada pelo CGSN"*, e **não há
 * prova neste repositório de que essa regulamentação exista**. A tela pode dizer qual é a JANELA
 * LEGAL; ela **não pode** afirmar que o procedimento está disponível.
 */
export const OPCAO_POR_FORA = Object.freeze({
  meses: ["setembro", "março"],
  semestres: ["janeiro", "julho"],
  irretratavel: true,
  fundamento: "LC 123/2006, art. 13, §§ 9º e 10 (redação da LC 227/2026); LC 214/2025, art. 41, § 3º",
  dependeDeRegulamentacao: true,
  // ⚠ "corrente ou ANTERIOR" é o texto do art. 41, § 5º, e ele fala de quando o ressarcimento foi
  // RECEBIDO — não de quanto tempo a trava dura. Parafrasear isso como "no ano seguinte" muda o
  // que a frase afirma.
  travaDeSaida:
    "Quem recebeu ressarcimento de créditos de IBS/CBS no ano-calendário corrente ou anterior "
    + "não pode sair do regime regular (LC 214/2025, art. 41, § 5º).",
});

/** `"III"` → a linha da faixa naquele anexo, ou `null`. Sem inventar faixa nenhuma. */
function faixaDoAnexo(anexo, faixa) {
  const a = ANEXOS_SIMPLES_2027[String(anexo || "").toUpperCase()];
  if (!a) return null;
  return a.faixas.find((f) => f.faixa === Number(faixa)) || null;
}

/**
 * O CRÉDITO QUE A EMPRESA DO SIMPLES TRANSFERE AO ADQUIRENTE — **"por dentro"**, o padrão.
 *
 * ⚠⚠ ESTA CONTA É EXATA, NÃO É ESTIMATIVA, e a lei diz a fórmula:
 *
 * > LC 123/2006, art. 23, § 1º-A: o adquirente não optante tem crédito *"em montante equivalente
 * > ao cobrado por meio desse regime único"*.
 * > § 2º: a alíquota do crédito *"corresponderá aos percentuais de ICMS, IBS e CBS previstos nos
 * > Anexos I a V (…) para a faixa de receita bruta a que a (…) empresa estiver sujeita no mês de
 * > operação"*.
 *
 *     crédito = alíquota efetiva do Simples × (%CBS + %IBS do Anexo, na faixa)
 *
 * ⚠ `null` na 6ª faixa NÃO entra como zero — ele sai NOMEADO em `semIbsNoDas`, porque a diferença
 * entre "a partilha do IBS é zero" e "o IBS não está no DAS" é o que explica o número ao contador.
 *
 * @param {{anexo: string, faixa: number, aliquotaEfetivaPct: number}} entrada
 * @returns {object|null} `null` quando falta insumo — nunca um número por omissão.
 */
export function creditoPorDentro({ anexo, faixa, aliquotaEfetivaPct }) {
  const linha = faixaDoAnexo(anexo, faixa);
  if (!linha) return null;
  if (!Number.isFinite(Number(aliquotaEfetivaPct)) || Number(aliquotaEfetivaPct) <= 0) return null;

  const pctCbs = linha.partilha.CBS;
  const pctIbs = linha.partilha.IBS;
  // ⚠ A CBS tem de existir em toda faixa — se não existir, a fonte não é a de 2027 e não se calcula.
  if (!Number.isFinite(Number(pctCbs))) return null;

  const semIbsNoDas = pctIbs == null;
  const somaPct = Number(pctCbs) + (semIbsNoDas ? 0 : Number(pctIbs));
  const efetiva = Number(aliquotaEfetivaPct);

  return {
    anexo: String(anexo).toUpperCase(),
    faixa: Number(faixa),
    aliquotaEfetivaPct: efetiva,
    percentualCbs: Number(pctCbs),
    percentualIbs: semIbsNoDas ? null : Number(pctIbs),
    somaPercentual: Number(somaPct.toFixed(4)),
    /** O quanto da operação vira crédito para o adquirente. Em pontos percentuais da operação. */
    creditoPct: Number(((efetiva * somaPct) / 100).toFixed(6)),
    // ⚠⚠ Na 6ª faixa o IBS não está no DAS (sublimite, art. 13-A): não há parcela a transferir, e
    // o crédito sai SÓ da CBS. Sem esta marca o número pareceria menor por engano de cálculo.
    semIbsNoDas,
    vigencia: VIGENCIA_ANEXOS_2027,
    fundamento: "LC 123/2006, art. 23, §§ 1º-A e 2º (redação da LC 214/2025, ajustada pela LC 227/2026)",
  };
}

/**
 * O QUE A OPÇÃO **"POR FORA"** MUDA PARA O ADQUIRENTE.
 *
 * Fora do regime único, o IBS e a CBS são destacados cheios e o adquirente se credita do valor
 * integral — não mais da fatia do Anexo. Para 2027-2028:
 *
 *     transferido = CBS estimada (digitada) + IBS 0,1% (da lei)
 *
 * ⚠⚠ A CBS É A ÚNICA INCÓGNITA, e ela vem DIGITADA. Sem o número, esta função devolve `null` —
 * ela **não estima**, não usa "os 26,5% que circulam" e não repete número de notícia.
 *
 * ⚠ O que esta função NÃO afirma, e a tela também não pode: **como o DAS é recomposto** quando as
 * parcelas de IBS/CBS saem dele. O § 9º do art. 13 diz apenas que elas *"não serão cobradas pelo
 * regime único"*; a forma é remetida à regulamentação, e não há prova dela neste repositório.
 */
export function transferidoPorFora({ cbsEstimadaPct }) {
  const cbs = Number(cbsEstimadaPct);
  if (!Number.isFinite(cbs) || cbs <= 0) return null;
  return {
    cbsPct: cbs,
    ibsPct: IBS_2027_2028.total,
    totalPct: Number((cbs + IBS_2027_2028.total).toFixed(6)),
    cbsEhEstimativa: true,
    fundamentoIbs: IBS_2027_2028.fundamento,
    // ⚠ Esta frase vai IMPRESSA no PDF. Um percentual sem ela é lido como se fosse lei.
    avisoDaCbs:
      "A alíquota da CBS foi INFORMADA nesta simulação e não está em lei: ela será fixada por "
      + "resolução do Senado Federal até 15/12/2026 (LC 214/2025, art. 349, § 1º, II, com a "
      + "prorrogação do art. 353, § 2º).",
  };
}

/**
 * ⚠⚠⚠ QUANTO A EMPRESA VAI PAGAR — a pergunta que decide, e que faltava.
 *
 * > Dono, 01/09/2026: *"o que não ficou claro no CBS e IBS é quanto meu cliente vai pagar de
 * > imposto; no caso ela só diz quanto de crédito ele vai gerar."*
 *
 * Ele está certo: o crédito transferido responde *"quanto o cliente DO meu cliente ganha"*. Quem
 * decide ficar ou sair precisa da outra metade.
 *
 * ─── POR DENTRO (o padrão) ────────────────────────────────────────────────────────────────────
 * ⚠⚠ **O DAS NÃO MUDA**, e isso é medição, não opinião: as **alíquotas nominais e as parcelas a
 * deduzir dos Anexos I a V são as MESMAS** na redação de 2027-2028 e na de hoje (conferido no
 * gerador, `nominaisAnexoI`). Alíquota efetiva igual ⇒ DAS igual. O que muda é só a REPARTIÇÃO
 * interna: onde havia COFINS + PIS, passa a haver CBS + uma fatia de IBS.
 * Isto é o mais valioso a dizer ao contador: **ficar como está não aumenta o imposto dela**.
 *
 * ─── POR FORA (a opção) ───────────────────────────────────────────────────────────────────────
 * Duas coisas mudam, e só uma é calculável:
 *
 * 1. ✅ **A parcela de IBS/CBS SAI do DAS** — LC 123/2006, art. 13, § 9º: *"as parcelas a eles
 *    relativas **não serão cobradas pelo regime único**"*. Quanto sai é exato:
 *    `DAS × (%CBS + %IBS do Anexo, na faixa)`.
 * 2. ⚠⚠ **ENTRA IBS/CBS NO REGIME REGULAR — e o valor LÍQUIDO não é calculável aqui.** O débito
 *    sobre a receita é `receita × (CBS estimada + IBS 0,1%)`, mas o que se paga é isso **menos os
 *    créditos das próprias compras**, e esta tela não sabe o que a empresa compra. Serviço
 *    intensivo em mão de obra quase não tem crédito de entrada (**folha não gera crédito**);
 *    comércio pode ter muito.
 *
 * ⚠⚠ E O QUE A LEI **NÃO** DIZ, e por isso este módulo também não: **como o DAS é recomposto**
 * quando as parcelas saem. Varrido o texto: o § 9º diz apenas que elas não serão cobradas; não há
 * fórmula de recomposição em lugar nenhum. O que se afirma é a PARCELA QUE SAI — não que o DAS
 * final seja exatamente a diferença.
 *
 * @returns {object|null} `null` sem os insumos — nunca um número por omissão.
 */
/**
 * ⚠⚠ A 6ª FAIXA MUDA DE ALÍQUOTA EM 2027-2028, E ISSO QUASE VIROU UMA MENTIRA NO PDF.
 *
 * Esta função existia como a constante `mudaEmRelacaoAHoje: false`, cravada, com a frase *"as
 * alíquotas nominais e as parcelas a deduzir dos Anexos são as mesmas de hoje"*. **Ela é falsa na
 * 6ª faixa dos CINCO anexos**, e o erro nasceu de uma frase, não de um número: o gerador leu a
 * fonte certo (`18,90` está no literal dele desde sempre) e o comentário ao lado dizia "as nominais
 * NÃO mudaram" — essa frase se propagou para o dado, a doc, a lib, a tela e o teste.
 *
 * Medido na fonte versionada (`docs/reforma-consumo/lcp214.htm`, os Anexos do art. 519), a 6ª faixa
 * cai **0,10 ponto percentual** em 2027-2028 e **volta ao valor de hoje em 2029** — a lei já traz
 * as duas tabelas, com as vigências escritas:
 *
 *     anexo   2026      1º/1/2027 a 31/12/2028    a partir de 1º/1/2029
 *     I       19,00%    18,90%                    19,00%
 *     II      30,00%    29,90%                    30,00%
 *     III     33,00%    32,90%                    33,00%
 *     IV      33,00%    32,90%                    33,00%
 *     V       30,50%    30,40%                    30,50%
 *
 * ⚠⚠ AS FAIXAS 1 A 5 NÃO MUDAM — nem alíquota nem parcela a deduzir. Ou seja, a afirmação valiosa
 * ("ficar como está não aumenta o imposto") continua verdadeira para a esmagadora maioria da
 * carteira; o que não se podia é dizê-la para TODO MUNDO.
 *
 * ⚠ A comparação é MEDIDA a cada chamada, contra as duas tabelas. Um literal aqui seria a mesma
 * frase cravada de novo, com outra roupa.
 */
export function mudancaDaNominal(anexo, faixa) {
  const hoje = ANEXOS[anexo]?.faixas?.[Number(faixa) - 1];
  const dep = ANEXOS_SIMPLES_2027[anexo]?.faixas?.[Number(faixa) - 1];
  if (!hoje || !dep) return null;

  // ⚠ Unidades DIFERENTES nas duas tabelas: a de hoje guarda FRAÇÃO (`0.1900`) e a de 2027 guarda
  // PONTOS PERCENTUAIS (`18.9`). Comparar cru daria "mudou" em todas as faixas — e o arredondamento
  // é a 2 casas porque é assim que a lei imprime.
  const nominalHoje = Number((hoje.aliquota * 100).toFixed(2));
  const nominal2027 = Number(Number(dep.aliquota).toFixed(2));
  const deduzirHoje = Number(hoje.pd);
  const deduzir2027 = Number(dep.deduzir);

  return {
    nominalHoje,
    nominal2027,
    deduzirHoje,
    deduzir2027,
    mudou: nominalHoje !== nominal2027 || deduzirHoje !== deduzir2027,
  };
}

export function impostoDaEmpresa({
  anexo, faixa, aliquotaEfetivaPct, dasAnual, receitaAnual, cbsEstimadaPct,
}) {
  const credito = creditoPorDentro({ anexo, faixa, aliquotaEfetivaPct });
  if (!credito) return null;
  const das = Number(dasAnual);
  if (!Number.isFinite(das) || das <= 0) return null;

  // ⚠ A parcela que sai é sobre o DAS, não sobre a receita: ela é a fatia do próprio DAS que os
  // Anexos destinam a CBS e IBS.
  const parcelaQueSaiDoDas = Number(((das * credito.somaPercentual) / 100).toFixed(2));

  const receita = Number(receitaAnual);
  const porFora = transferidoPorFora({ cbsEstimadaPct });
  const debitoPorFora = porFora && Number.isFinite(receita) && receita > 0
    ? Number(((receita * porFora.totalPct) / 100).toFixed(2))
    : null;

  // ⚠⚠ MEDIDO, nunca cravado — ver `mudancaDaNominal`.
  const mudanca = mudancaDaNominal(anexo, faixa);
  const muda = mudanca ? mudanca.mudou : false;

  return {
    porDentro: {
      dasAnual: das,
      /**
       * ⚠⚠ A afirmação que o contador precisa ouvir — e ela NÃO vale para todo mundo.
       *
       * Nas faixas 1 a 5 o DAS realmente não muda. Na **6ª faixa** a alíquota nominal cai 0,10 pp
       * em 2027-2028 (e volta em 2029), então o DAS muda — para MENOS. Dizer "não muda" ali seria
       * afirmar um número errado num papel que vai ao cliente.
       */
      mudaEmRelacaoAHoje: muda,
      /**
       * ⚠⚠ O NOVO DAS **NÃO É CALCULADO AQUI**, e a ausência é deliberada: a alíquota EFETIVA sai de
       * `(RBT12 × nominal − parcela a deduzir) / RBT12`, e esta função não recebe o RBT12 — recebe a
       * efetiva já pronta. Recompor o RBT12 a partir da receita anual seria supor que os dois são o
       * mesmo número, o que é falso em início de atividade (o RBT12 é proporcionalizado). O que a
       * tela afirma é a MUDANÇA e o sentido dela; o número novo exigiria um dado que ela não tem.
       */
      novoDasNaoCalculado: muda,
      mudanca,
      explicacao: muda
        ? "O DAS muda, e para MENOS: nesta faixa a alíquota nominal do Anexo cai de "
          + `${fmtPct(mudanca.nominalHoje)} para ${fmtPct(mudanca.nominal2027)} em 2027-2028 `
          + `(e volta a ${fmtPct(mudanca.nominalHoje)} a partir de 2029). A parcela a deduzir não `
          + "muda. O valor novo não é calculado aqui porque depende do RBT12, que esta simulação "
          + "não recebe."
        : "O DAS não muda: nesta faixa a alíquota nominal e a parcela a deduzir do Anexo são as "
          + "mesmas de hoje. O que muda é a repartição interna — onde havia COFINS e PIS, passa a "
          + "haver CBS e uma fatia de IBS.",
      cbsDentroDoDas: Number(((das * credito.percentualCbs) / 100).toFixed(2)),
      ibsDentroDoDas: credito.percentualIbs == null
        ? null
        : Number(((das * credito.percentualIbs) / 100).toFixed(2)),
      semIbsNoDas: credito.semIbsNoDas,
    },
    porFora: porFora
      ? {
        parcelaQueSaiDoDas,
        fundamentoDaSaida: "LC 123/2006, art. 13, § 9º (incluído pela LC 227/2026)",
        /** O DÉBITO sobre a receita, no regime regular. ⚠ BRUTO — antes dos créditos de compra. */
        debitoSobreAReceita: debitoPorFora,
        /**
         * ⚠⚠ A CONTA NÃO FECHA AQUI, E DIZER ISSO É O PRODUTO. Faltam (a) os créditos das compras
         * da empresa, que esta tela não conhece, e (b) a forma de recomposição do DAS, que a lei
         * remete à regulamentação. Um "total por fora" cravado seria número inventado.
         */
        liquidoNaoCalculavel: true,
        porQueNaoFecha: [
          "Os créditos das compras da empresa não entram nesta conta — esta tela não sabe o que ela "
          + "compra. Serviço intensivo em mão de obra quase não tem crédito de entrada, porque folha "
          + "não gera crédito.",
          "A lei diz que as parcelas de IBS/CBS não são cobradas pelo regime único, mas não traz a "
          + "fórmula de recomposição do DAS. O que está afirmado aqui é a parcela que SAI.",
        ],
      }
      : null,
  };
}

/**
 * A RESPOSTA DA TELA, por cenário.
 *
 * ⚠⚠ O CENÁRIO 2026 NÃO É "SEM DADO" — É ZERO, COM FUNDAMENTO. Devolver `null` ali faria a tela
 * dizer "não foi possível calcular" sobre um fato que a lei afirma com todas as letras.
 */
export function ibsCbsDoSimples({
  cenario, anexo, faixa, aliquotaEfetivaPct, cbsEstimadaPct, dasAnual, receitaAnual,
}) {
  if (cenario === CENARIO.EM_2026) {
    return {
      cenario,
      zeroPorLei: true,
      creditoPct: 0,
      titulo: "Em 2026, o Simples Nacional não recolhe IBS nem CBS",
      explicacao:
        "As alíquotas de teste de 2026 — IBS 0,1% e CBS 0,9% — não alcançam quem é optante pelo "
        + "Simples Nacional. Nada muda no DAS desta empresa neste ano, e nenhum crédito de IBS/CBS "
        + "é transferido a quem compra dela.",
      fundamento: TESTE_2026.fundamentoDaExclusao,
      // ⚠ A decisão que EXISTE em 2026 é a da janela de setembro, e ela vale para 2027 —
      // é por isso que o cenário de 2027 fica ao lado, e não escondido.
      proximoPasso: CENARIO.DE_2027_A_2028,
    };
  }

  if (cenario === CENARIO.DE_2027_A_2028) {
    const porDentro = creditoPorDentro({ anexo, faixa, aliquotaEfetivaPct });
    const porFora = transferidoPorFora({ cbsEstimadaPct });
    return {
      cenario,
      zeroPorLei: false,
      porDentro,
      porFora,
      // ⚠⚠ QUANTO A EMPRESA PAGA — é a pergunta que decide, e ela vem PRIMEIRO na tela. O crédito
      // transferido responde "quanto o cliente DO meu cliente ganha"; sozinho, ele não ajuda quem
      // precisa escolher entre ficar e sair.
      imposto: impostoDaEmpresa({
        anexo, faixa, aliquotaEfetivaPct, dasAnual, receitaAnual, cbsEstimadaPct,
      }),
      // ⚠ A diferença só existe quando os DOIS lados existem. Sem a CBS digitada não se compara —
      // e a tela diz o que falta, em vez de mostrar meia comparação.
      diferencaPct:
        porDentro && porFora
          ? Number((porFora.totalPct - porDentro.creditoPct).toFixed(6))
          : null,
      janela: OPCAO_POR_FORA,
      vigencia: VIGENCIA_ANEXOS_2027,
    };
  }

  // ⚠ Cenário desconhecido não vira o de 2026 nem o de 2027 — vira recusa nomeada. Cair num deles
  // faria uma competência futura ser respondida com a regra do ano errado.
  return { cenario: null, zeroPorLei: false, motivo: "cenario_desconhecido" };
}
