// A LIGAÇÃO DAS REGRAS COM O BANCO — sugerir conta, aprender, suspender.
//
// ⚠ A REGRA não é reimplementada aqui: quem decide é `lib/motorDeSugestao.js` (o que sugerir) e
// `lib/aprendizado.js` (o que nasce e o que se freia). Este arquivo faz três coisas: buscar o que
// eles precisam, chamá-los, e gravar o que eles mandaram.
//
// ⚠⚠ NADA AQUI CONTABILIZA. Nenhuma função deste arquivo cria `AccountingEntry`. Quem leva ao razão
// continua sendo `aplicarTransicao`, no `DeclaradoService`, com o contador clicando.

import { prisma } from "../../infrastructure/db/prisma.js";
import { decidirAprendizado, MOTIVO_DA_SUSPENSAO } from "./lib/aprendizado.js";
import { chaveDaDescricao, sugerirConta } from "./lib/motorDeSugestao.js";
// ⚠⚠ REUSADA, não reescrita: quem responde "esta conta é caixa/banco?" decide pelo PREFIXO do
// `codigoCompleto`, e o cabeçalho daquele módulo PROÍBE a versão `!== NAO_DISPONIVEL` (com ela,
// `DISPONIVEL_NAO_CLASSIFICADO` e `INDETERMINADO` entrariam).
import { entraNoFluxoDeCaixa } from "../accounting/lib/disponibilidades.js";

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

/**
 * ⚠⚠ O PLANO DA EMPRESA, com a precedência de sempre: GLOBAL primeiro, a da EMPRESA sobrescreve.
 *
 * É o mesmo desenho de `formaDoLancamento`. Sem isso, o reduzido `557` de uma empresa poderia ser
 * traduzido pelo `codigoCompleto` de outra — e a despesa iria para a conta errada, em silêncio.
 */
async function planoDaEmpresa(portalClientId, client) {
  const contas = await client.chartOfAccount.findMany({
    where: { OR: [{ portalClientId: null }, { portalClientId }] },
    // ⚠⚠ `analitica` É LIDA — e tirá-la daqui faz o motor voltar a SUGERIR o que o servidor RECUSA.
    //
    // `lib/motorDeSugestao.js` não sugere conta SINTÉTICA (de agregação), nos dois caminhos (regra e
    // histórico), consultando `ehContaSintetica` (`accounting/lib/gateContaSintetica.js`). Isso
    // existe porque `formaDoLancamento.montarLancamento` a RECUSA: sem o filtro, a tela ofereceria a
    // conta e o clique seria negado.
    //
    // ⚠ Sem a coluna no `select`, o predicado recebe `undefined` e responde `false` para TODA
    // conta — o filtro fica ligado e cego. Quem amarra é
    // `declarados/lib/__tests__/motorDeSugestao.test.js`, não um teste deste arquivo.
    // ⚠⚠ TRI-ESTADO: comparar com `=== false`, nunca `!analitica`.
    select: { portalClientId: true, codigo: true, codigoCompleto: true, nome: true, analitica: true },
  });
  // ⚠ A da empresa vence a global quando o `codigo` colide — a global é o padrão, não a autoridade.
  const porCodigo = new Map();
  for (const c of contas) {
    const atual = porCodigo.get(String(c.codigo));
    if (!atual || (c.portalClientId && !atual.portalClientId)) porCodigo.set(String(c.codigo), c);
  }
  return [...porCodigo.values()];
}

/**
 * ⚠⚠ A MEMÓRIA É LIDA POR EMPRESA, IGNORANDO O USUÁRIO — e isso é decisão, não descuido.
 *
 * A chave de `AccountingHistorico` é `(createdByUserId, companyPortalClientId, text)`. A pergunta
 * que a fila faz é *"o que esta EMPRESA já lançou nesta descrição?"*, não *"o que este usuário
 * lançou"* — e `companyPortalClientId` já é o escopo multi-tenant, então ler sem filtrar o usuário
 * é seguro e é o que responde a pergunta certa. Medido: **1 usuário** em produção hoje.
 *
 * ⚠⚠ OS REGISTROS GLOBAIS (`companyPortalClientId: null`) FICAM DE FORA. São **40** com conta, e
 * eles guardam o **reduzido** — um reduzido só significa alguma coisa dentro de UM plano. Usar o
 * global de uma empresa para traduzir na outra é exatamente o erro que a tradução pelo plano existe
 * para impedir. (Medido: hoje nenhum reduzido é ambíguo entre empresas — mas isso é um fato de
 * hoje, não uma garantia.)
 */
async function memoriaDaEmpresa(portalClientId, client) {
  return client.accountingHistorico.findMany({
    where: { companyPortalClientId: portalClientId },
    // ⚠ `contaCredito` entrou em 02/09/2026: o motor passou a sugerir o crédito da memória quando
    // ele é único. Coluna fora do `select` volta `undefined` sem erro — e o crédito ficaria mudo.
    select: { text: true, contaDebito: true, contaCredito: true, usageCount: true },
  });
}

async function regrasVivas(portalClientId, client) {
  return client.regraContabilizacao.findMany({
    where: { portalClientId, ativa: true, suspensaEm: null, revogadaEm: null },
  });
}

/**
 * A conta sugerida para um declarado. **SÓ LEITURA.**
 *
 * ⚠ Devolve a procedência junto, sempre. A tela precisa dizer *de onde* veio a sugestão — "uma
 * regra do fornecedor" e "você já lançou assim antes" pedem conferências diferentes.
 */
export async function sugerirContaPara({ portalClientId, declarado, client = prisma }) {
  const [regras, historico, plano] = await Promise.all([
    regrasVivas(portalClientId, client),
    memoriaDaEmpresa(portalClientId, client),
    planoDaEmpresa(portalClientId, client),
  ]);
  return sugerirConta(declarado, { regras, historico, plano });
}

/**
 * As sugestões para uma FILA inteira, com UMA busca de cada coisa.
 *
 * ⚠ Sem isto, uma fila de 229 linhas faria 229×3 consultas. O motor é puro, então a mesma leitura
 * serve a todas as linhas.
 */
export async function sugerirContaParaLote({ portalClientId, declarados = [], client = prisma }) {
  const [regras, historico, plano] = await Promise.all([
    regrasVivas(portalClientId, client),
    memoriaDaEmpresa(portalClientId, client),
    planoDaEmpresa(portalClientId, client),
  ]);
  return declarados.map((d) => ({ id: d?.id, ...sugerirConta(d, { regras, historico, plano }) }));
}

/**
 * Reavalia o aprendizado de UM fornecedor, depois de o contador confirmar (ou desfazer) algo.
 *
 * ⚠⚠ ELA NÃO CONTABILIZA E NÃO MEXE EM DECLARADO NENHUM. Ela só cria ou suspende regra.
 *
 * ⚠ Chamada **depois** da transição, nunca dentro da transação dela: o aprendizado é consequência,
 * e uma falha aqui não pode desfazer o lançamento que o contador acabou de confirmar. Por isso ela
 * **não lança** — devolve o que fez.
 */
export async function reavaliarAprendizado({
  portalClientId,
  cnpjFornecedor,
  usuarioId = null,
  agora,
  client = prisma,
}) {
  const cnpj = soDigitos(cnpjFornecedor);
  if (!cnpj) return { acao: "NADA", motivo: "sem_cnpj" };

  try {
    // ⚠ Todos os declarados DESTE fornecedor nesta empresa — é o histórico que sustenta (ou
    // derruba) a regra. `contaAplicada` é o que o contador de fato usou.
    const declarados = await client.lancamentoDeclarado.findMany({
      where: { portalClientId, cnpjFornecedor: cnpj },
      select: { id: true, estado: true, contaAplicada: true, valor: true, valorAjustado: true, regraId: true },
    });

    // ⚠ A regra existente inclui as SUSPENSAS e as inativas de propósito: sem elas, `decidirAprendizado`
    // acharia que não existe regra e proporia CRIAR uma segunda para o mesmo fornecedor.
    const regraExistente = await client.regraContabilizacao.findFirst({
      where: { portalClientId, cnpjFornecedor: cnpj, revogadaEm: null },
      orderBy: { criadaEm: "desc" },
    });

    const decisao = decidirAprendizado({ cnpjFornecedor: cnpj, declarados, regraExistente });

    if (decisao.acao === "CRIAR") {
      const regra = await client.regraContabilizacao.create({
        data: {
          portalClientId,
          cnpjFornecedor: decisao.proposta.cnpjFornecedor,
          padraoDescricao: null,
          valorMin: decisao.proposta.valorMin,
          valorMax: decisao.proposta.valorMax,
          contaDestino: decisao.proposta.contaDestino,
          tipo: "SAIDA",
          origemRegra: "APRENDIDA",
          ativa: true,
          criadaPor: usuarioId || "aprendizado",
          confirmacoesBase: decisao.proposta.confirmacoesBase,
          criadaEm: agora,
        },
      });
      return { acao: "CRIAR", regraId: regra.id, proposta: decisao.proposta };
    }

    if (decisao.acao === "SUSPENDER") {
      await client.regraContabilizacao.update({
        where: { id: regraExistente.id },
        data: { suspensaEm: agora, motivoSuspensao: decisao.motivo },
      });
      return { acao: "SUSPENDER", regraId: regraExistente.id, motivo: decisao.motivo, frase: decisao.frase };
    }

    return { acao: "NADA" };
  } catch (e) {
    // ⚠⚠ O APRENDIZADO NUNCA DERRUBA O TRABALHO DO CONTADOR. Se a tabela não existir (a migration
    // não foi aplicada — P2021) ou qualquer outra coisa falhar, a confirmação que acabou de
    // acontecer continua válida. Isto é a mesma disciplina de `listarTomadoresEmitidos`, que não
    // pode derrubar a tela de emissão.
    return { acao: "NADA", motivo: "falhou", erro: e?.code || e?.message || "erro" };
  }
}

/** As regras de uma empresa, para a tela. **SÓ LEITURA.** */
export async function listarRegras({ portalClientId, client = prisma }) {
  const regras = await client.regraContabilizacao.findMany({
    where: { portalClientId, revogadaEm: null },
    orderBy: [{ ativa: "desc" }, { criadaEm: "desc" }],
  });
  return regras.map((r) => ({
    id: r.id,
    cnpjFornecedor: r.cnpjFornecedor,
    padraoDescricao: r.padraoDescricao,
    contaDestino: r.contaDestino,
    valorMin: r.valorMin != null ? String(r.valorMin) : null,
    valorMax: r.valorMax != null ? String(r.valorMax) : null,
    origemRegra: r.origemRegra,
    ativa: r.ativa,
    suspensaEm: r.suspensaEm,
    motivoSuspensao: r.motivoSuspensao,
    // ⚠⚠ A TRILHA VIAJA. Aprendizado invisível é o que impede o contador de desligar a regra no dia
    // em que algo entrar errado — ele precisa poder ver QUAIS lançamentos a geraram.
    confirmacoesBase: r.confirmacoesBase || [],
    aplicacoes: r.aplicacoes ?? 0,
    criadaEm: r.criadaEm,
    criadaPor: r.criadaPor,
  }));
}

/**
 * O contador desliga (ou religa) uma regra, à mão.
 *
 * ⚠ Desligar à mão grava `ativa: false` — **não** `suspensaEm`. As duas colunas respondem coisas
 * diferentes: `suspensaEm` é *"o sistema se freou sozinho, e por quê"*; `ativa` é *"o contador
 * decidiu"*. Colapsá-las faria a tela não distinguir uma suspensão automática de uma escolha.
 */
export async function alternarRegra({ portalClientId, regraId, ativa, client = prisma }) {
  const regra = await client.regraContabilizacao.findFirst({ where: { id: regraId, portalClientId } });
  if (!regra) return null;
  return client.regraContabilizacao.update({
    where: { id: regra.id },
    data: {
      ativa: Boolean(ativa),
      // ⚠ Religar à mão LIMPA a suspensão automática: o contador está dizendo que conferiu. Sem
      // isso a regra ficaria `ativa: true` e `suspensaEm` preenchido — e o motor, que exige as
      // duas, continuaria a ignorá-la. O botão pareceria não fazer nada.
      ...(ativa ? { suspensaEm: null, motivoSuspensao: null } : {}),
    },
  });
}

export { MOTIVO_DA_SUSPENSAO, chaveDaDescricao };

/**
 * ⚠⚠ A REGRA MANUAL — a porta que faltava (29/08/2026).
 *
 * > Dono: *"a Lente tem todo mês um pagamento a Alessandro Nigro, CNPJ, que vai se tornar uma
 * > recorrência no fluxo deles. O contador deve poder colocar o código de débito e crédito nessa
 * > despesa, e todo mês que essa nota aparecer ela já é lançada em despesa."*
 *
 * ⚠⚠ **`RegraContabilizacao` JÁ GUARDAVA TUDO — e só nascia `APRENDIDA`.** `reavaliarAprendizado` é
 * o único escritor, e não havia `POST` nenhum: a regra que o contador quisesse escrever à mão não
 * tinha porta. É essa lacuna que esta função fecha; nada do modelo mudou, exceto o crédito.
 *
 * ⚠⚠ **O CRÉDITO É RECUSADO SE NÃO FOR DISPONIBILIDADE** — resposta do dono: *"continua sendo
 * disponibilidade (caixa/banco)"*. Quem responde isso é `entraNoFluxoDeCaixa`
 * (`accounting/lib/disponibilidades.js`), que decide pelo **PREFIXO do `codigoCompleto`**, nunca
 * pelo nome. ⚠ **NÃO reescreva como `!== NAO_DISPONIVEL`**: o cabeçalho daquele módulo já proíbe, e
 * assim `DISPONIVEL_NAO_CLASSIFICADO` e `INDETERMINADO` entrariam.
 *
 * ⚠ Débito e crédito passam pelas travas que já existem: fora do plano · sintética. Uma conta
 * SINTÉTICA no lançamento é recusada pelo PVA da ECD meses depois (registro I250, `IND_CTA = "A"`),
 * e é por isso que a recusa acontece aqui e não lá.
 *
 * ⚠⚠ **ELA NÃO LANÇA NADA.** Criar a regra não gera `AccountingEntry`; ela só passa a existir para
 * o motor consultar. O que lança tem outra trava (a flag), e ela nasce DESLIGADA.
 */
export const RECUSA_DA_REGRA = Object.freeze({
  SEM_ANCORA: "regra_sem_ancora",
  CONTA_FORA_DO_PLANO: "conta_fora_do_plano",
  CONTA_SINTETICA: "conta_sintetica",
  CREDITO_NAO_E_DISPONIBILIDADE: "credito_nao_e_disponibilidade",
  FAIXA_INVALIDA: "faixa_invalida",
  INDISPONIVEL: "regras_indisponiveis",
  /**
   * ⚠⚠ AS DUAS RECUSAS DO LANÇAMENTO AUTOMÁTICO (29/08/2026), e as duas existem porque
   * `podeLancarSozinho` exige as mesmas coisas. Aceitar aqui o que o motor recusa depois criaria a
   * pior forma de defeito desta tela: uma regra marcada como "lança sozinha" que nunca lança, com o
   * contador achando que a despesa dele está entrando.
   */
  SEM_DIA_DO_LANCAMENTO: "regra_sem_dia_de_lancamento",
  AUTOMATICO_SEM_CNPJ: "automatico_sem_cnpj",
  NAO_ENCONTRADA: "regra_nao_encontrada",
});

export const FRASE_DA_RECUSA_DA_REGRA = Object.freeze({
  [RECUSA_DA_REGRA.SEM_ANCORA]:
    "A regra precisa de um CNPJ de fornecedor ou de um padrão de descrição — sem âncora ela casaria com qualquer despesa.",
  [RECUSA_DA_REGRA.CONTA_FORA_DO_PLANO]:
    "Esta conta não existe no plano desta empresa.",
  [RECUSA_DA_REGRA.CONTA_SINTETICA]:
    "Esta conta é sintética (de agregação). O lançamento tem de ir numa conta analítica — a ECD recusa o arquivo com conta sintética, meses depois.",
  [RECUSA_DA_REGRA.CREDITO_NAO_E_DISPONIBILIDADE]:
    "O crédito precisa ser uma conta de disponibilidade (caixa, banco ou aplicação). O lançamento afirma de onde o dinheiro saiu.",
  [RECUSA_DA_REGRA.FAIXA_INVALIDA]:
    "A faixa de valor precisa ter mínimo e máximo maiores que zero, com o mínimo menor ou igual ao máximo.",
  [RECUSA_DA_REGRA.INDISPONIVEL]:
    "A tabela de regras ainda não existe neste banco. A migration não foi aplicada.",
  [RECUSA_DA_REGRA.SEM_DIA_DO_LANCAMENTO]:
    "Para lançar sozinha, a regra precisa dizer em que dia do mês (1 a 31). A data não se arbitra.",
  [RECUSA_DA_REGRA.AUTOMATICO_SEM_CNPJ]:
    "Só uma regra ancorada no CNPJ do fornecedor pode lançar sozinha. A descrição se PARECE, não identifica — e aqui o lançamento acontece sem ninguém conferir.",
  [RECUSA_DA_REGRA.NAO_ENCONTRADA]:
    "Regra não encontrada nesta empresa.",
});

export class RegraRecusada extends Error {
  constructor(codigo, frase) {
    super(codigo);
    this.name = "RegraRecusada";
    this.codigo = codigo;
    this.frase = frase || FRASE_DA_RECUSA_DA_REGRA[codigo] || "";
  }
}

const recusarRegra = (codigo) => { throw new RegraRecusada(codigo, FRASE_DA_RECUSA_DA_REGRA[codigo]); };

// ⚠ `soDigitos` já existe no topo deste arquivo — reusada, não redeclarada.
const txt = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * ⚠⚠ AS EXIGÊNCIAS DO LANÇAMENTO AUTOMÁTICO, num lugar só — porque são DUAS portas (29/08/2026).
 *
 * Criar a regra e ligar a automação numa regra que já existe são caminhos diferentes, e duas
 * cópias desta conferência divergiriam na primeira correção. Aqui o custo da divergência é uma
 * regra que lança sozinha sem dia (a data arbitrada) ou sem CNPJ (a âncora que só *se parece*).
 *
 * ⚠ Devolve o DIA quando o automático está ligado, e `null` quando não está — porque com
 * `lancaSozinha: false` o dia deixa de ter significado, e guardá-lo daria a impressão de que
 * existe uma data configurada esperando ser ligada.
 */
function automaticoOuNulo(lancaSozinha, diaDoLancamento, cnpj) {
  if (lancaSozinha !== true) return null;
  // ⚠⚠ SEM CNPJ NÃO LANÇA — a mesma âncora que `podeLancarSozinho` exige. O motor de SUGESTÃO usa
  // descrição também, porque lá o contador confere; aqui não há clique nenhum.
  if (!cnpj) recusarRegra(RECUSA_DA_REGRA.AUTOMATICO_SEM_CNPJ);
  const dia = Number(diaDoLancamento);
  // ⚠ Por TIPO: `Number(null)` é 0 e 0 é finito. Um dia 0 viraria "a data não se arbitra" tarde
  // demais, dentro do motor, com a regra já marcada.
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) recusarRegra(RECUSA_DA_REGRA.SEM_DIA_DO_LANCAMENTO);
  return dia;
}

export async function criarRegraManual({
  portalClientId,
  cnpjFornecedor = null,
  padraoDescricao = null,
  valorMin,
  valorMax,
  contaDestino,
  contaCredito = null,
  /**
   * ⚠⚠ A SEGUNDA DAS DUAS CHAVES DO LANÇAMENTO AUTOMÁTICO — fornecedor a fornecedor (29/08/2026).
   *
   * ⚠ Ela nasce **`false`** aqui também, e não por acaso: `false` é o default da coluna, e um
   * default `true` nesta assinatura ligaria a automação em toda regra escrita a partir de agora,
   * em silêncio. A outra chave é a flag do ambiente, e as DUAS precisam estar ligadas.
   */
  lancaSozinha = false,
  diaDoLancamento = null,
  usuarioId,
  /**
   * ⚠⚠ SEM DEFAULT — é a regra deste arquivo, e há teste varrendo a fonte contra `new Date()`.
   *
   * O relógio vem de QUEM CHAMA. `criadaEm` é a data em que o contador escreveu a regra, e um
   * `new Date()` aqui a tornaria impossível de fixar num teste — e, pior, faria a data do SERVIDOR
   * substituir a de quem decidiu, calada, no dia em que os dois discordarem.
   * ⚠ `undefined` cai no `@default(now())` da coluna, que é o comportamento de `reavaliarAprendizado`.
   */
  agora,
  client = prisma,
}) {
  const cnpj = soDigitos(cnpjFornecedor);
  const padrao = txt(padraoDescricao);
  // ⚠⚠ SEM ÂNCORA a regra casaria com QUALQUER despesa da empresa — e ela lança sozinha.
  if (!cnpj && !padrao) recusarRegra(RECUSA_DA_REGRA.SEM_ANCORA);

  const min = Number(valorMin);
  const max = Number(valorMax);
  // ⚠ `> 0` por TIPO: `Number(null)` é 0 e 0 é finito. A faixa é o portão do lançamento automático,
  // e uma faixa que começa em zero casa com toda nota.
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0 || min > max) {
    recusarRegra(RECUSA_DA_REGRA.FAIXA_INVALIDA);
  }

  // ⚠⚠ AS DUAS EXIGÊNCIAS DO AUTOMÁTICO, conferidas ANTES de qualquer ida ao banco. Elas são as
  // MESMAS de `podeLancarSozinho` — aceitar aqui o que o motor recusa depois produziria uma regra
  // marcada como "lança sozinha" que nunca lança nada.
  const dia = automaticoOuNulo(lancaSozinha, diaDoLancamento, cnpj);

  const plano = await planoDaEmpresa(portalClientId, client).catch((e) => {
    if (e?.code === "P2021") recusarRegra(RECUSA_DA_REGRA.INDISPONIVEL);
    throw e;
  });
  const porCompleto = new Map(
    plano.filter((c) => txt(c.codigoCompleto)).map((c) => [txt(c.codigoCompleto), c]),
  );

  const conferirConta = (codigo, ehCredito) => {
    const c = porCompleto.get(txt(codigo));
    if (!c) recusarRegra(RECUSA_DA_REGRA.CONTA_FORA_DO_PLANO);
    // ⚠ TRI-ESTADO: `analitica === false` é sintética; `null` (plano não reimportado) NÃO é.
    if (c.analitica === false) recusarRegra(RECUSA_DA_REGRA.CONTA_SINTETICA);
    // ⚠⚠ Só o CRÉDITO precisa ser disponibilidade — o débito é a despesa, e ela nunca é caixa.
    if (ehCredito && !entraNoFluxoDeCaixa(c)) recusarRegra(RECUSA_DA_REGRA.CREDITO_NAO_E_DISPONIBILIDADE);
    return c;
  };

  conferirConta(contaDestino, false);
  const credito = txt(contaCredito);
  // ⚠ `null` continua valendo: é "esta regra não escolheu crédito", e o caminho de hoje (o caixa
  // cravado) segue. A ausência não é recusada — o que é recusado é a escolha ERRADA.
  if (credito) conferirConta(credito, true);

  try {
    return await client.regraContabilizacao.create({
      data: {
        portalClientId: String(portalClientId),
        cnpjFornecedor: cnpj || null,
        padraoDescricao: padrao || null,
        valorMin: min,
        valorMax: max,
        contaDestino: txt(contaDestino),
        contaCredito: credito || null,
        // ⚠⚠ `lancaSozinha === true` é EXATO, nunca `Boolean(...)`: uma string `"false"` vinda de
        // formulário é verdadeira em JS, e ligaria a automação por um campo mal tipado.
        lancaSozinha: lancaSozinha === true,
        diaDoLancamento: dia,
        tipo: "SAIDA",
        // ⚠⚠ MANUAL — e a distinção importa: a APRENDIDA se suspende sozinha quando a unanimidade
        // que a gerou se quebra; a MANUAL nunca, porque foi decisão explícita de quem a escreveu.
        origemRegra: "MANUAL",
        ativa: true,
        criadaPor: txt(usuarioId) || "manual",
        // ⚠ `confirmacoesBase` fica NULO: não há aprendizado atrás dela. Preenchê-la com a nota que
        // o contador estava olhando faria uma decisão dele parecer uma observação do sistema.
        confirmacoesBase: null,
        criadaEm: agora,
      },
    });
  } catch (e) {
    if (e?.code === "P2021") recusarRegra(RECUSA_DA_REGRA.INDISPONIVEL);
    throw e;
  }
}

/**
 * ⚠⚠ LIGAR (E DESLIGAR) O LANÇAMENTO AUTOMÁTICO DE **UMA** REGRA — a segunda chave (29/08/2026).
 *
 * > Dono: *"todo mês que essa nota aparecer ela já é lançada em despesa."*
 *
 * ⚠⚠ **ELA EXISTE PORQUE AS REGRAS QUE JÁ ESTÃO NO BANCO NASCERAM `APRENDIDA`**, e o `POST` da
 * regra manual só alcança as novas. Sem esta porta, ligar a automação no fornecedor que o dono
 * citou (a Lente/Alessandro Nigro) exigiria apagar a regra existente e reescrevê-la à mão — o que
 * jogaria fora as `aplicacoes`, que são a evidência de que aquela regra acerta.
 *
 * ⚠⚠ **FORNECEDOR A FORNECEDOR, NUNCA A CARTEIRA INTEIRA.** Ela recebe UM `regraId` e não aceita
 * lote, de propósito: o primeiro mês roda com um fornecedor e o dono confere no extrato. Um
 * `updateMany` aqui é o que transformaria uma decisão em vinte.
 *
 * ⚠ As exigências são as MESMAS de `criarRegraManual` — as duas chamam `automaticoOuNulo`.
 * ⚠ Desligar SEMPRE passa: nada a conferir para parar de lançar, e uma recusa aqui prenderia o
 * contador numa automação que ele quer desligar. O dia é limpo junto.
 */
export async function definirLancamentoAutomatico({
  portalClientId, regraId, lancaSozinha, diaDoLancamento = null, client = prisma,
}) {
  let regra;
  try {
    regra = await client.regraContabilizacao.findFirst({
      where: { id: String(regraId), portalClientId: String(portalClientId) },
    });
  } catch (e) {
    if (e?.code === "P2021") recusarRegra(RECUSA_DA_REGRA.INDISPONIVEL);
    throw e;
  }
  if (!regra) recusarRegra(RECUSA_DA_REGRA.NAO_ENCONTRADA);

  // ⚠⚠ O CNPJ VEM DA REGRA GRAVADA, nunca do corpo do pedido: a âncora é a que o motor vai
  // consultar. Aceitá-lo de fora deixaria alguém ligar o automático numa regra de descrição
  // mandando um CNPJ qualquer junto.
  const dia = automaticoOuNulo(lancaSozinha, diaDoLancamento, soDigitos(regra.cnpjFornecedor));

  return client.regraContabilizacao.update({
    where: { id: regra.id },
    data: { lancaSozinha: lancaSozinha === true, diaDoLancamento: dia },
  });
}
