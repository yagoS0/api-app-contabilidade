// A CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012), DO PONTO DE VISTA DE QUEM EMITE PELO PORTAL DO
// CLIENTE — a leitura, pura.
//
// ⚠ ORIGEM: `apps/web/src/lib/nfse/cadastroEmissaoNfse.js` (portal do escritório) —
// `lerPercentualCarga`, `CAMPOS_CARGA_TRIBUTARIA` e `faltasDaCargaTributaria`. MESMA leitura, apps
// separados e sem código compartilhado (é a mesma convenção de `valorDaNota.js`, `consultaTomador.js`
// e `reaproveitarNota.js` deste diretório). ⚠ Mudou lá, muda aqui — duas leituras da mesma coluna
// divergem na primeira correção, e aí as duas telas afirmam coisas diferentes sobre a MESMA empresa.
//
// ⚠⚠ **AQUI É SÓ LEITURA, E ISSO É O PEDIDO INTEIRO** (dono, 19/08/2026: *"o portal do cliente deve
// enxergar sim, no caso do presumido"*). Estes três percentuais são CONFIGURAÇÃO FISCAL DO
// ESCRITÓRIO: quem digita é o contador, no portal dele. Este arquivo não valida entrada de
// formulário, não normaliza para gravar e não existe campo editável do outro lado — ele responde
// uma pergunta só: *"o que o cadastro desta empresa diz, e o que falta?"*.
//
// ⚠ E ELES NÃO VÃO NO PAYLOAD DA EMISSÃO. `NfseService` resolve CADA campo sozinho, payload →
// cadastro: se esta tela passasse a enviá-los, o payload VENCERIA o cadastro, e um valor velho preso
// no formulário sobrescreveria em silêncio a correção que o contador acabou de fazer. A tela MOSTRA;
// ela não MANDA. Ver `montarPayload`, em `EmitirNotaPage.jsx`.
//
// ⚠ NADA É CALCULADO NEM DEDUZIDO. Não há de-para CNAE→presunção neste repositório, e o número vai
// IMPRESSO ao tomador — errar entre 8% e 32% inverteria a comparação. O que não está gravado aparece
// como FALTA, nunca como zero.

/**
 * Os três percentuais, na ORDEM em que a DPS os leva
 * (`totTrib > pTotTrib > pTotTribFed, pTotTribEst, pTotTribMun`).
 *
 * ⚠ Espelho de `CAMPOS_CARGA_TRIBUTARIA` do portal do escritório, com os mesmos rótulos.
 * ⚠ `pTotTribMun` **NÃO é a alíquota de ISS**: na NFS-e real versionada do projeto o ISS aplicado é
 * 5,00% e o `pTotTribMun` é 0,00%, no mesmo documento. Podem coincidir e não são o mesmo dado.
 */
export const CAMPOS_CARGA_TRIBUTARIA = Object.freeze([
  Object.freeze({ campo: "pTotTribFed", rotulo: "Federal", curto: "federal" }),
  Object.freeze({ campo: "pTotTribEst", rotulo: "Estadual", curto: "estadual" }),
  Object.freeze({ campo: "pTotTribMun", rotulo: "Municipal (ISS)", curto: "municipal" }),
]);

/**
 * ⚠⚠ TRÊS ESTADOS, E O TERCEIRO NÃO É "FALTA". A mesma disciplina de `lerPortaoEmissao`
 * (`emissaoNfseLiberada` ausente ≠ `false`) e de `obrigatoriedadeDefis`.
 *
 *   • `NAO_RECEBIDA` — a resposta não trouxe as chaves. Isto é um fato sobre a RESPOSTA, não sobre o
 *     cadastro: um portal falando com uma API que ainda não as devolve cai aqui. Dizer "falta
 *     configurar" nesse caso mandaria o cliente ligar para o escritório atrás de algo já feito.
 *   • `COMPLETA` — os três estão gravados e legíveis. A nota sai.
 *   • `PENDENTE` — chegaram, e algum não está gravado (ou está ilegível). A nota é recusada, e a tela
 *     diz QUAIS.
 *
 * ⚠ `null` gravado é DIFERENTE de chave ausente, e é essa diferença que separa `PENDENTE` de
 * `NAO_RECEBIDA`. O `select` do backend devolve `pTotTribFed: null` para coluna não configurada; uma
 * API que não seleciona a coluna simplesmente não traz a chave (JSON não carrega `undefined`).
 */
export const ESTADO_CARGA = Object.freeze({
  NAO_RECEBIDA: "NAO_RECEBIDA",
  COMPLETA: "COMPLETA",
  PENDENTE: "PENDENTE",
});

/**
 * Um percentual gravado — 0 a 100, até duas casas.
 *
 * ⚠ CÓPIA de `lerPercentualCarga` do portal do escritório, inclusive o motivo de ela não reusar o
 * normalizador de moeda: percentual de 0 a 100 não tem separador de milhar, então vírgula E ponto
 * são decimais aqui — e o normalizador de moeda transformaria `11.33` em `1133`.
 *
 * ⚠ O valor chega do backend como STRING (`Decimal(5,2)` do Prisma serializa como `"11.33"`) ou como
 * número. Os dois são aceitos, e nenhum é reformatado: o que se devolve é o NÚMERO.
 *
 * ⚠ `0` é valor legítimo — quem consumir isto não pode usar `||`. Zero DECLARADO existe (serviço não
 * tem ICMS, então o estadual costuma ser zero); o que não pode existir é zero por omissão.
 *
 * @returns {{preenchido: boolean, valor: number|null, problema: boolean}}
 */
export function lerPercentualCarga(entrada) {
  if (entrada === null || entrada === undefined) {
    return { preenchido: false, valor: null, problema: false };
  }
  const texto = String(entrada).trim();
  if (!texto) return { preenchido: false, valor: null, problema: false };
  const normalizado = texto.replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalizado)) {
    return { preenchido: true, valor: null, problema: true };
  }
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { preenchido: true, valor: null, problema: true };
  }
  return { preenchido: true, valor: n, problema: false };
}

/**
 * A resposta trouxe as três chaves?
 *
 * ⚠ `hasOwnProperty`, não `!= null`: é a única forma de separar "a coluna está NULL" (o contador não
 * configurou) de "a resposta não tem este campo" (a tela não recebeu o estado). Exigem-se as TRÊS —
 * a rota as seleciona juntas, então chegar pela metade é resposta de outra origem, e sobre ela esta
 * tela não afirma nada.
 */
function recebeuAsTres(legacy) {
  if (!legacy || typeof legacy !== "object") return false;
  return CAMPOS_CARGA_TRIBUTARIA.every((c) => Object.prototype.hasOwnProperty.call(legacy, c.campo));
}

/**
 * O que o cadastro desta empresa diz sobre a carga tributária aproximada.
 *
 * ⚠ **ESTA FUNÇÃO NÃO OLHA O REGIME, DE PROPÓSITO.** Quem decide se a pergunta se aplica é a tela,
 * com a MESMA leitura de regime que ela já usa para o ISS (`lerRegime`, três estados) — e esse guarda
 * vale nos DOIS sentidos: a empresa do Simples não vê nada disto (ela declara `pTotTribSN`, que é
 * outra coisa e já está no formulário), e o REGIME INDEFINIDO também não (ali não se sabe qual grupo
 * a nota leva, e afirmar "não optante" seria o default silencioso que este projeto proíbe). Duplicar
 * a leitura de regime aqui criaria a segunda régua que acabaria discordando da primeira.
 *
 * @param {object|null} legacy o `legacyCompany` de `GET /client/companies`
 * @returns {{
 *   estado: string,
 *   itens: Array<{campo: string, rotulo: string, curto: string, valor: number|null, ilegivel: boolean}>,
 *   faltando: Array<{campo: string, rotulo: string, curto: string}>,
 *   ilegiveis: Array<{campo: string, rotulo: string, curto: string}>
 * }}
 */
export function lerCargaTributaria(legacy) {
  if (!recebeuAsTres(legacy)) {
    return { estado: ESTADO_CARGA.NAO_RECEBIDA, itens: [], faltando: [], ilegiveis: [] };
  }

  const itens = CAMPOS_CARGA_TRIBUTARIA.map((c) => {
    const leitura = lerPercentualCarga(legacy[c.campo]);
    return { ...c, valor: leitura.valor, ilegivel: leitura.problema };
  });

  const faltando = itens
    .filter((i) => i.valor === null && !i.ilegivel)
    .map(({ campo, rotulo, curto }) => ({ campo, rotulo, curto }));
  // ⚠ ILEGÍVEL NÃO É O MESMO QUE FALTANDO, e nem por isso vira "completa". O banco tem CHECK de
  // 0–100 nas três colunas, então isto deveria ser inalcançável — mas prometer "a nota sai" com base
  // num valor que esta tela não conseguiu ler seria afirmar um desfecho que não se mediu. O servidor
  // recusaria com `INVALID_TOT_TRIB_NAO_SIMPLES`, e o conserto é o mesmo: falar com o contador.
  const ilegiveis = itens
    .filter((i) => i.ilegivel)
    .map(({ campo, rotulo, curto }) => ({ campo, rotulo, curto }));

  return {
    estado: faltando.length || ilegiveis.length ? ESTADO_CARGA.PENDENTE : ESTADO_CARGA.COMPLETA,
    itens,
    faltando,
    ilegiveis,
  };
}

// ── O QUE A TELA DIZ ────────────────────────────────────────────────────────────────────────────
//
// ⚠ Sem crase nem markdown: estas strings vão para a TELA, que não renderiza markdown.
// ⚠ Quem lê é o CLIENTE, não o contador. Fica o texto que (a) muda uma decisão de quem emite,
// (b) avisa de consequência fiscal, ou (c) diz o que fazer quando algo falta — o critério que
// encolheu as legendas desta tela em 19/08/2026.

/**
 * ⚠ A FRASE QUE FALTAVA, E ELA É O PEDIDO. Antes de 19/08/2026 o cliente do Presumido não via este
 * número em lugar nenhum antes de emitir — e ele sai IMPRESSO na nota que o tomador recebe.
 */
// ⚠⚠ TENTEI CORTAR A NORMA DAQUI E O TESTE RECUSOU, com razão. `cargaTributariaNaTela` afirma
// `/Lei 12\.741\/2012/` — não é foto do texto atual, é trava: este número SAI IMPRESSO na nota do
// tomador, e a norma é o que o distingue de um percentual qualquer que a empresa teria escolhido.
// Não confundir com o corte da LC 116 art. 3º (19/08): aquela citação explicava a NOSSA dedução de
// onde o ISS é devido; esta nomeia o que a nota declara a terceiro.
export const O_QUE_E_A_CARGA =
  "Esta nota declara ao tomador quanto do preço é tributo aproximado (Lei 12.741/2012). Os "
  + "percentuais vêm do cadastro da sua empresa e saem impressos na nota.";

/** ⚠ SÓ LEITURA — e a tela precisa dizer de quem é a caneta, senão o cliente procura o campo. */
// ⚠ "Aqui eles são só conferidos" descrevia o visível — não há campo editável nesta tela.
export const QUEM_CONFIGURA = "Quem configura estes percentuais é o seu contador.";

/**
 * O estado que esta tela NÃO sabe. ⚠ É o texto antigo, e ele continua verdadeiro exatamente aqui:
 * enquanto não se recebe o cadastro, as duas saídas são possíveis e nenhuma pode ser prometida.
 */
// ⚠⚠ ESTE PARÁGRAFO PARECE O CANDIDATO ÓBVIO AO CORTE E NÃO É — eu tentei, e o teste
// `"volta a descrever as DUAS saídas — é o único caso em que isso continua verdade"` derrubou.
// O nome dele é o argumento: nos outros ramos a tela SABE o estado do cadastro e descrever duas
// saídas seria enrolação; aqui ela NÃO recebeu o cadastro, e as duas são mesmo possíveis. Encurtar
// para "se faltar algum, é recusada" afirmaria que falta — que é justamente o que não se sabe.
export const CARGA_NAO_RECEBIDA =
  "A nota precisa declarar a carga tributária aproximada — três percentuais que o seu contador "
  + "configura no cadastro da empresa. Esta tela não recebeu esse cadastro: se ele estiver completo, "
  + "a nota sai normalmente; se faltar algum, ela é recusada antes de sair daqui, sem consumir "
  + "numeração.";

/**
 * A lista do que falta, em português, para a frase da tela.
 *
 * ⚠ Os TRÊS são exigidos juntos, inclusive quando algum é 0,00 — e 0,00 é comum (serviço não tem
 * ICMS). Preencher só um faria a nota AFIRMAR carga zero nos outros dois, e é justamente isso que a
 * recusa `MISSING_TOT_TRIB_NAO_SIMPLES` existe para impedir.
 */
export function frasePendencia(carga) {
  const nomes = [...(carga?.faltando || []), ...(carga?.ilegiveis || [])].map((f) => f.curto);
  if (!nomes.length) return "";
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
  const plural = nomes.length > 1;
  // ⚠ "sem consumir numeração" tem teste próprio ("diz que nada sai e nenhum número se perde") e
  // fica: é o que separa esta recusa — segura, dá para corrigir e reenviar — da recusa de
  // TRANSPORTE, onde reenviar duplica a nota. A garantia é a informação, não o enfeite.
  return `Falta configurar ${plural ? "as parcelas" : "a parcela"} ${lista} da carga tributária `
    + `aproximada desta empresa. Sem ${plural ? "elas" : "ela"} a nota é recusada antes de sair `
    + "daqui, sem consumir numeração.";
}
