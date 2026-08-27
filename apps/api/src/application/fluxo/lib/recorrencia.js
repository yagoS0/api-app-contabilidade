// ESTA DESPESA (OU RECEITA) VOLTA? COM QUE VALOR? — o detector.
//
// > Dono, 25/08/2026: *"a Claude sempre aparece com valor de 120 a 140 reais, nesse caso colocamos
// > uma aproximação de 130 no fluxo futuro. O mesmo para receita: se eu tenho emitido nota para o
// > mesmo cliente há 3 meses, a chance de continuar com ele é grande."*
//
// ⚠⚠ ISTO SUGERE. NÃO MARCA, NÃO GRAVA, NÃO ENTRA NO FLUXO SOZINHO.
//
// O módulo é PURO — nenhum prisma, nenhum relógio, nenhuma escrita. Ele recebe observações e devolve
// uma leitura. Quem marca a série é o CONTADOR, e é a decisão dele que põe a linha no fluxo de
// caixa. O piso de 3 é baixo de propósito (foi o que o dono escolheu), e o que segura o desenho
// **não é o número, é a marcação**: um trimestre coincidente vira "recorrência" com 3 observações,
// e por isso a resposta deste arquivo é uma SUGESTÃO com a evidência ao lado, nunca um fato.
//
// ─── ⚠⚠ A CHAVE É A CONTRAPARTE, NÃO A CONTA ───────────────────────────────────────────────────
//
// É como o dono formulou os dois exemplos ("a Claude", "o mesmo cliente"). Um desenho anterior
// chaveava por CONTA e lia o `AccountingEntry` — porque era a única fonte com histórico, e era
// pobre (26 pares, 1 com 12 meses). Com o razão fora de escopo (decisão do dono, 25/08/2026), a
// fonte passou a ser a NOTA, e as duas pontas saem da mesma tabela com a mesma forma:
//
//   RECEITA  ← `PortalInvoice` `papel: "EMIT"`, chave `tomadorDoc`
//   DESPESA  ← `PortalInvoice` `papel: "DEST"`, chave `emitenteDoc`
//   DESPESA SEM NOTA ← débito de OFX (`LancamentoDeclarado`), chave = descrição CANONIZADA
//
// ⚠ Sem documento (os dois campos são anuláveis), a linha cai na âncora de descrição — e essa
// âncora depende do conserto da `chaveDaDescricao`, que hoje NÃO remove datas. Está nomeado no
// plano; este módulo não o resolve, ele só não finge que a âncora é boa.
//
// ─── ⚠⚠ A PERIODICIDADE EXISTE POR CAUSA DA TAXA ANUAL ────────────────────────────────────────
//
// > Dono: *"essa é a taxa anual que pago de Conselho."*
//
// Um desenho que conte MESES quebra nela: uma taxa anual nunca teria 3 meses consecutivos e sairia
// do fluxo na segunda ausência. Por isso a regra de saída conta **CICLOS PERDIDOS**, nunca meses —
// e o vocabulário é o que o projeto JÁ TEM (`PERIODICIDADES` de `obrigacoes/gerarOcorrencias.js`),
// não um segundo.

/**
 * ⚠ CÓPIA DECLARADA de `PERIODICIDADES` (`application/obrigacoes/gerarOcorrencias.js`).
 *
 * Não é import porque aquele módulo é do domínio de OBRIGAÇÕES e carrega a geração de ocorrências
 * junto; importar dele traria uma dependência que não tem nada a ver com fluxo de caixa. A lista é
 * de três itens e está amarrada por teste — muda lá, muda aqui.
 */
export const PERIODICIDADE = Object.freeze({
  MENSAL: "MENSAL",
  TRIMESTRAL: "TRIMESTRAL",
  ANUAL: "ANUAL",
});

/** Quantos MESES tem um ciclo de cada periodicidade. */
export const MESES_DO_CICLO = Object.freeze({
  [PERIODICIDADE.MENSAL]: 1,
  [PERIODICIDADE.TRIMESTRAL]: 3,
  [PERIODICIDADE.ANUAL]: 12,
});

/** ⚠ Decisão do dono: 3 observações. Vale para receita e para despesa, igual. */
export const PISO_DE_OBSERVACOES = 3;

/** ⚠ Duas AUSÊNCIAS consecutivas — um ciclo faltando é pagamento que escorregou. */
export const CICLOS_PARA_SAIR = 2;

/** ⚠ Vocabulário FECHADO. Cada resposta pede uma coisa diferente da tela. */
export const LEITURA = Object.freeze({
  /** Observações demais de menos: não há o que sugerir. */
  POUCAS_OBSERVACOES: "poucas_observacoes",
  /** ⚠⚠ Há padrão. O detector SUGERE — quem marca é o contador. */
  SUGERE_ENTRADA: "sugere_entrada",
  /** ⚠ Já marcada e ainda acontecendo. */
  CONTINUA: "continua",
  /** ⚠⚠ Já marcada e sumiu por 2 ciclos. SUGERE a saída — nunca desmarca sozinha. */
  SUGERE_SAIDA: "sugere_saida",
  /**
   * ⚠⚠ JÁ MARCADA E SEM UMA ÚNICA OBSERVAÇÃO — e este é o caso que o plano nomeia:
   * *"declarado R$ 1.000/mês; não localizado nos últimos 3 meses"*.
   *
   * Ele existe porque `CONTINUA` é uma **afirmação** ("está acontecendo") e aqui não há nada que a
   * sustente. Achado por agente de verificação em 27/08/2026: sem esta resposta, a série marcada
   * cujas notas foram todas canceladas dizia `CONTINUA` **para sempre** — e nunca podia sugerir
   * saída, porque `ciclosDesdeAUltima` é `null` sem última observação, e `null >= 2` é falso. A
   * linha ficava viva no fluxo de caixa sem uma única prova atrás dela, em silêncio.
   *
   * ⚠ Ela NÃO desmarca, pela mesma razão de todas as outras: quem decide é o contador. O que ela
   * faz é a tela poder CONFRONTAR a declaração em vez de confiar nela para sempre.
   */
  SEM_OBSERVACAO: "sem_observacao",
});

/**
 * ⚠⚠ `Number(null)` É `0`, E `0` É FINITO. Esta guarda existe por causa disso.
 *
 * `Number.isFinite(Number(v))` sozinho aprova `null`, `""`, `[]`, `false` e `" "` — e neste módulo
 * cada um deles vira um CICLO COM VALOR ZERO, que puxa a mediana para baixo e a faixa para fora. É
 * a mesma armadilha que já custou um "0%" na tela do cliente (`folhaAusenteNaoEZero`) e a alíquota
 * efetiva declarada como zero numa nota fiscal.
 *
 * ⚠⚠ A GUARDA É POR **TIPO**, e a primeira versão dela era por VALOR (`v == null || v === ""`).
 * Essa lista de exceções é infinita e a primeira versão já saía incompleta: agente de verificação
 * mediu, em 27/08/2026, que `[]`, `false` e `" "` **passavam e fabricavam um ciclo de valor 0** —
 * e que o comentário logo acima afirmava cobrir `[]` sem cobrir. Enumerar o que se recusa é sempre
 * perder um; nomear o que se ACEITA é fechado por construção.
 *
 * ⚠ O que se aceita: `number` finito e `string` com conteúdo numérico. `Decimal` do Prisma entra
 * pelo `toString`, que é como ele já viaja em todo o resto do projeto.
 */
const numero = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // ⚠ O `Decimal` do Prisma é objeto; ele — e só ele — entra pelo `toString`.
  const texto = typeof v === "string" ? v : (isDecimalDoPrisma(v) ? v.toString() : null);
  if (texto == null || texto.trim() === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
};

/**
 * ⚠ `Decimal` do Prisma, sem importar o Prisma (este módulo é PURO e assim continua).
 *
 * A prova é estrutural: objeto com `toString` PRÓPRIO (não o herdado de `Object.prototype`, que
 * devolveria `"[object Object]"`). Array não passa — `[5].toString()` é `"5"`, e aceitá-lo faria
 * um `.map` que devolve lista de um elemento entrar como se fosse um valor.
 */
function isDecimalDoPrisma(v) {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return false;
  return typeof v.toString === "function" && v.toString !== Object.prototype.toString;
}

/** "AAAA-MM" → número de meses desde o ano 0. ⚠ Aritmética de string, nunca `Date`: às 22h de
 * Brasília um `toISOString` devolveria o mês seguinte. */
export function mesesDaCompetencia(competencia) {
  // ⚠ SÓ STRING. `String(["2026-05"])` é `"2026-05"`, e um `.map` que devolvesse lista de um
  // elemento entraria como competência boa — medido em 27/08/2026.
  if (typeof competencia !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(competencia.trim());
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return ano * 12 + (mes - 1);
}

/**
 * ⚠⚠ A MEDIANA, NUNCA A MÉDIA.
 *
 * Para 120–140 dá quase o mesmo. Mas um mês com cobrança anual embutida puxaria a MÉDIA e a
 * projeção mentiria para cima **todo mês** dali em diante. A mediana ignora o extremo.
 */
export function mediana(valores) {
  const vs = (valores || []).map(numero).filter((v) => v != null).sort((a, b) => a - b);
  if (!vs.length) return null;
  const meio = Math.floor(vs.length / 2);
  // ⚠ Par: a média dos dois centrais. Ímpar: o central.
  return vs.length % 2 ? vs[meio] : (vs[meio - 1] + vs[meio]) / 2;
}

/**
 * O coeficiente de variação — o quanto a série oscila em relação ao próprio tamanho.
 *
 * ⚠ Ele NÃO decide nada aqui: entra na evidência, para a tela poder dizer o quanto a série é
 * estável. Um limiar automático seria um número inventado (regra 1), e a decisão é do contador.
 * ⚠ Média ZERO devolve `null`, não `Infinity`: sem base não há proporção a calcular.
 */
export function coeficienteDeVariacao(valores) {
  const vs = (valores || []).map(numero).filter((v) => v != null);
  if (vs.length < 2) return null;
  const media = vs.reduce((a, b) => a + b, 0) / vs.length;
  if (!media) return null;
  const variancia = vs.reduce((a, b) => a + (b - media) ** 2, 0) / vs.length;
  return Math.sqrt(variancia) / Math.abs(media);
}

/**
 * Normaliza as observações: uma por CICLO, somando o que caiu no mesmo ciclo.
 *
 * ⚠⚠ SOMAR DENTRO DO CICLO É A DECISÃO CERTA, e não é óbvia. Duas notas do mesmo fornecedor no
 * mesmo mês são UMA despesa mensal de valor somado — contá-las como duas observações inflaria o N
 * (uma série de 3 meses com duas notas cada pareceria ter 6 observações) e a mediana passaria a
 * falar de "valor por nota", não de "valor por mês", que é o que entra no fluxo.
 *
 * @param {Array<{competencia: string, valor: number|string}>} observacoes
 * @param {string} periodicidade
 * @returns {Array<{ciclo: number, valor: number, competencias: string[]}>} ordenado por ciclo
 */
export function porCiclo(observacoes, periodicidade = PERIODICIDADE.MENSAL) {
  // ⚠ Mesma recusa de `lerSerie` — e ela precisa estar aqui também porque esta função é EXPORTADA
  // e o serviço a alcança direto. Uma periodicidade desconhecida caindo em MENSAL agruparia a série
  // pelo passo errado sem nada dizer.
  const passo = MESES_DO_CICLO[periodicidade];
  if (!passo) {
    throw new Error(`recorrencia: periodicidade desconhecida "${periodicidade}" — use ${Object.values(PERIODICIDADE).join(", ")}.`);
  }
  const mapa = new Map();
  for (const o of observacoes || []) {
    const meses = mesesDaCompetencia(o?.competencia);
    const valor = numero(o?.valor);
    // ⚠ Observação sem competência ou sem valor NÃO vira ciclo com zero — ela não existe para a
    // série. Zero fabricado puxaria a mediana para baixo e a faixa para fora.
    if (meses == null || valor == null) continue;
    const ciclo = Math.floor(meses / passo);
    if (!mapa.has(ciclo)) mapa.set(ciclo, { ciclo, valor: 0, competencias: [] });
    const alvo = mapa.get(ciclo);
    alvo.valor += valor;
    alvo.competencias.push(String(o.competencia));
  }
  return [...mapa.values()].sort((a, b) => a.ciclo - b.ciclo);
}

/**
 * ⚠⚠ QUANTOS CICLOS CONSECUTIVOS, CONTADOS DO FIM PARA TRÁS.
 *
 * É o "consecutivas" do piso. Uma série com 3 observações salteadas (jan, mar, mai) NÃO é uma
 * recorrência mensal — é o mesmo fornecedor aparecendo de vez em quando, e projetar a mediana dela
 * como se fosse todo mês poria dinheiro no fluxo que não sai.
 */
export function ciclosConsecutivosNoFim(ciclos) {
  // ⚠ DEDUPLICA antes de contar. `porCiclo` já entrega um ciclo por número (agrupa por `Map`), mas
  // esta função é EXPORTADA e o próximo consumidor pode montar a lista de outra forma. Sem o
  // `Set`, `[5, 6, 6]` devolvia **1** — o par repetido no fim quebrava a corrida na diferença 0.
  const lista = [...new Set((ciclos || []).map((c) => c.ciclo))].sort((a, b) => a - b);
  if (!lista.length) return 0;
  let n = 1;
  for (let i = lista.length - 1; i > 0; i -= 1) {
    if (lista[i] - lista[i - 1] !== 1) break;
    n += 1;
  }
  return n;
}

/**
 * A LEITURA DA SÉRIE — o que o detector responde.
 *
 * @param {object} entrada
 * @param {Array<{competencia: string, valor: number|string}>} entrada.observacoes
 * @param {string} entrada.periodicidade
 * @param {string} entrada.cicloAtual competência "AAAA-MM" do "agora" — ⚠ INJETADA, nunca `new Date()`
 * @param {boolean} entrada.jaMarcada se o contador já marcou esta série
 * @returns {{leitura: string, valorProjetado: number|null, base: object}}
 */
export function lerSerie({ observacoes, periodicidade = PERIODICIDADE.MENSAL, cicloAtual, jaMarcada = false } = {}) {
  // ⚠⚠ PERIODICIDADE FORA DA LISTA FECHADA **RECUSA**, e não cai em MENSAL.
  //
  // Era `MESES_DO_CICLO[periodicidade] || 1`. Medido por agente de verificação em 27/08/2026: com
  // `"SEMESTRAL"` a conta rodava com passo 1 (MENSAL), devolvia `sugere_entrada`, e `base` ecoava
  // `periodicidade: "SEMESTRAL"` — ou seja, a EVIDÊNCIA gravada em `baseDaObservacao` afirmaria uma
  // periodicidade que não foi a usada. Evidência que mente é pior que evidência ausente, porque é
  // ela que responde "por que esta linha está no fluxo?" daqui a seis meses.
  const passo = MESES_DO_CICLO[periodicidade];
  if (!passo) {
    throw new Error(`recorrencia: periodicidade desconhecida "${periodicidade}" — use ${Object.values(PERIODICIDADE).join(", ")}.`);
  }
  const ciclos = porCiclo(observacoes, periodicidade);
  const valores = ciclos.map((c) => c.valor);
  const mesesAgora = mesesDaCompetencia(cicloAtual);
  const cicloDeAgora = mesesAgora == null ? null : Math.floor(mesesAgora / passo);
  const ultimo = ciclos.length ? ciclos[ciclos.length - 1].ciclo : null;

  // ⚠⚠ A EVIDÊNCIA VIAJA SEMPRE, inclusive na recusa. Sem ela, "por que esta linha está no fluxo?"
  // não tem resposta em seis meses — e é a pergunta que o contador vai fazer.
  const base = {
    n: ciclos.length,
    consecutivos: ciclosConsecutivosNoFim(ciclos),
    periodicidade,
    mediana: mediana(valores),
    min: valores.length ? Math.min(...valores) : null,
    max: valores.length ? Math.max(...valores) : null,
    cv: coeficienteDeVariacao(valores),
    // ⚠ A JANELA é o que a tela precisa para dizer "baseado em 3 observações, de jan a mar".
    janela: ciclos.length
      ? { deCiclo: ciclos[0].ciclo, ateCiclo: ultimo, competencias: ciclos.flatMap((c) => c.competencias) }
      : null,
    // ⚠ `null` quando não se sabe o "agora" — nunca 0, que seria "aconteceu neste ciclo".
    ciclosDesdeAUltima: cicloDeAgora != null && ultimo != null ? cicloDeAgora - ultimo : null,
  };

  // ── A SAÍDA vem antes da entrada: uma série JÁ MARCADA que sumiu não deve ser reavaliada como
  //    candidata — ela tem uma decisão do contador em cima, e o que se pergunta é se ela continua.
  if (jaMarcada) {
    // ⚠⚠ ZERO OBSERVAÇÕES NÃO É "CONTINUA". Sem nenhuma, `ultimo` é `null`, `ciclosDesdeAUltima` é
    // `null`, e a comparação da saída abaixo NUNCA morde — a série responderia "continua" para
    // sempre. Ausência virando afirmação, com a linha viva no fluxo.
    if (!ciclos.length) {
      return { leitura: LEITURA.SEM_OBSERVACAO, valorProjetado: null, base };
    }
    if (base.ciclosDesdeAUltima != null && base.ciclosDesdeAUltima >= CICLOS_PARA_SAIR) {
      // ⚠⚠ SUGERE a saída. NÃO desmarca — pela mesma razão que a entrada não se marca sozinha.
      return { leitura: LEITURA.SUGERE_SAIDA, valorProjetado: base.mediana, base };
    }
    return { leitura: LEITURA.CONTINUA, valorProjetado: base.mediana, base };
  }

  // ⚠⚠ O PISO É SOBRE OS CONSECUTIVOS, não sobre o total. Três observações salteadas não são uma
  // recorrência — são o mesmo fornecedor aparecendo de vez em quando.
  if (base.consecutivos < PISO_DE_OBSERVACOES) {
    return { leitura: LEITURA.POUCAS_OBSERVACOES, valorProjetado: null, base };
  }

  // ⚠ Padrão antigo não vira sugestão: uma série que parou há 2 ciclos não deve ser oferecida para
  // entrar no fluxo — é o mesmo critério da saída, aplicado a quem nunca entrou.
  if (base.ciclosDesdeAUltima != null && base.ciclosDesdeAUltima >= CICLOS_PARA_SAIR) {
    return { leitura: LEITURA.POUCAS_OBSERVACOES, valorProjetado: null, base };
  }

  return { leitura: LEITURA.SUGERE_ENTRADA, valorProjetado: base.mediana, base };
}

/**
 * ⚠⚠ A FRASE DA EVIDÊNCIA — e ela NUNCA sai sem a faixa.
 *
 * > Plano: *"A faixa viaja junto e vai à tela: «≈ R$ 130, entre 120 e 140» — nunca o ponto sozinho."*
 *
 * O ponto sozinho se lê como uma previsão precisa. A faixa é o que diz ao contador quanto de folga
 * a série tem, e é observada — não calculada por fórmula nenhuma (uma faixa que "abre com a
 * distância" exigiria uma fórmula, e qualquer fórmula aqui seria inventada).
 */
export function fraseDaBase(base) {
  if (!base || !base.n) return null;
  const partes = [`baseado em ${base.n} ${base.n === 1 ? "observação" : "observações"}`];
  if (base.min != null && base.max != null && base.min !== base.max) {
    partes.push(`entre ${base.min} e ${base.max}`);
  }
  return partes.join(", ");
}
