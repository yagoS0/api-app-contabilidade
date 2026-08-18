// AS ABAS DE REGIME DA PÁGINA PRINCIPAL — qual empresa ocupa qual aba, e quantas há em cada uma.
//
// POR QUE EXISTE (pedido do dono, 18/08/2026)
//   *"ter duas tabelas na página principal, uma para presumido e outra simples nacional, deve ficar
//   indicado em cima da tabela, como uma aba de navegador. dessa forma exclua o filtro de regime,
//   pois já estarão separados"*
//
// ⚠ DUAS ABAS FIXAS SERIAM UMA ARMADILHA, E É POR ISSO QUE EXISTE A TERCEIRA.
// Medido em produção (18/08/2026): 33 empresas — 22 `SIMPLES`, 11 `LUCRO_PRESUMIDO`, ZERO fora dos
// dois. Mas o cadastro aceita `LUCRO_REAL`, `MEI` e `OUTRO` (o enum de `companySchemas.js`), e
// empresa nova pode nascer **sem regime nenhum**. Com só duas abas, essa empresa desapareceria da
// página principal sem nada dizendo que ela existe — a classe de defeito que este projeto mais
// combate ("ausência nunca é resposta"). Daí `OUTROS`: ela **só é renderizada quando há empresa
// nela**, com a contagem. Hoje ninguém a vê; no dia em que aparecer, ninguém some.
//
// ⚠ A ABA NÃO É FILTRO — É NAVEGAÇÃO. Por isso ela não vira chip removível e não entra na contagem
// do botão "Filtros": aquele critério ("nenhum filtro ativo sem chip removível visível") existe
// contra o filtro FANTASMA, o que age escondido. Uma aba desenhada em cima da tabela, com o nome do
// regime e a contagem, é o oposto de escondida. O que ela precisa fazer, e faz, é aparecer no
// CABEÇALHO IMPRESSO — folha com 11 empresas que não diz "Lucro Presumido" mente por omissão.

import { rotuloRegime } from "../../../../lib/vocabulario";

/**
 * O REGIME DA EMPRESA, lido de um lugar só.
 *
 * ⚠ Mora em `legacyCompany` — `selectedCompany.regimeTributario` do topo do payload NÃO existe
 * (`buildFirmCompanyPayload` só devolve o regime lá dentro). O fallback para o topo cobre as
 * telas/mocks que montam a linha na outra forma.
 *
 * ⚠ ESTA FUNÇÃO NASCEU EM `acoesDaSelecao.js` e veio para cá — não foi copiada. Aquele arquivo a
 * IMPORTA daqui. Duas cópias fariam a empresa cair numa aba e ser recusada pela ação em lote da
 * mesma tela, com a tela discordando de si mesma sobre qual é o regime dela. Ela veio para o
 * módulo do regime (e não o contrário) porque `acoesDaSelecao` importa `renderCompanyCard`, e o
 * card lê o regime: com a função lá, o card fecharia um ciclo de imports com ele.
 */
export function regimeDe(company) {
  return String(company?.legacyCompany?.regimeTributario || company?.regimeTributario || "").trim().toUpperCase();
}

export const ABA_SIMPLES = "SIMPLES";
export const ABA_PRESUMIDO = "LUCRO_PRESUMIDO";
export const ABA_OUTROS = "OUTROS";

/** A aba que abre quando não há escolha salva (ou quando a salva não vale mais). */
export const ABA_PADRAO = ABA_SIMPLES;

/** As duas fixas, na ordem em que aparecem. `OUTROS` entra depois delas, e só quando tem gente. */
export const ORDEM_ABAS = [ABA_SIMPLES, ABA_PRESUMIDO, ABA_OUTROS];

const ROTULOS = {
  [ABA_SIMPLES]: "Simples Nacional",
  [ABA_PRESUMIDO]: "Lucro Presumido",
  [ABA_OUTROS]: "Outros",
};

/**
 * ⚠ COR DE REGIME É COR DE CATEGORIA (`--accent-*`), NUNCA DE ESTADO (`--state-*`).
 * Regime não é pendência nem conclusão: pintá-lo com token de estado é o que faz "quase tudo
 * vermelho" e apaga a exceção. Estas são as MESMAS cores que o card e a linha da tabela já usam —
 * ciano para Simples, laranja para Presumido, roxo para Real.
 */
export function corRegime(regime) {
  const k = String(regime || "").trim().toUpperCase();
  if (k === "SIMPLES") return "var(--accent-cyan)";
  if (k === "LUCRO_PRESUMIDO") return "var(--accent-orange)";
  if (k === "LUCRO_REAL") return "var(--accent-purple)";
  return "var(--text-faint)";
}

export function corDaAba(aba) {
  // `OUTROS` é heterogênea por definição — pintá-la com a cor de um dos regimes que ela contém
  // afirmaria algo sobre o conjunto que não é verdade.
  return aba === ABA_OUTROS ? "var(--text-faint)" : corRegime(aba);
}

/**
 * Em que aba esta empresa aparece.
 *
 * ⚠ A LEITURA É `regimeDe`, a MESMA que `acoesDaSelecao` importa daqui. E o critério é IGUAL ao da
 * ação "apurar" daquele arquivo: só `SIMPLES` exato é Simples. Se a aba fosse tolerante
 * (aceitando, digamos, `SIMPLES_NACIONAL`) a empresa cairia na aba do Simples e a barra de seleção
 * da MESMA tela a recusaria dizendo "Lucro Presumido/Real" — a tela discordando de si mesma.
 * Valor fora dos dois vai para `OUTROS`, onde a linha DIZ qual é o regime.
 */
export function abaDaEmpresa(company) {
  const regime = regimeDe(company);
  if (regime === ABA_SIMPLES) return ABA_SIMPLES;
  if (regime === ABA_PRESUMIDO) return ABA_PRESUMIDO;
  return ABA_OUTROS;
}

/**
 * O que a linha da aba "Outros" precisa dizer sobre a empresa.
 *
 * ⚠ AUSÊNCIA NUNCA É RESPOSTA: "sem regime cadastrado" é uma frase, não um espaço em branco.
 * Sem ela, a empresa aparece numa aba chamada "Outros" e o contador não tem como saber por quê.
 */
export function descricaoDoRegime(company) {
  const regime = regimeDe(company);
  if (!regime) return "Sem regime cadastrado";
  return rotuloRegime(regime) || regime;
}

/**
 * Quantas empresas em cada aba.
 *
 * ⚠ RECEBE A LISTA JÁ FILTRADA pelos demais filtros (busca, certificado, situação fiscal…).
 * Contar sobre a carteira inteira faria a aba prometer 22 e a tabela mostrar 7 — dois números para
 * a mesma pergunta, que é o defeito que este projeto passa o dia matando.
 */
export function contarPorAba(companies = []) {
  const out = { [ABA_SIMPLES]: 0, [ABA_PRESUMIDO]: 0, [ABA_OUTROS]: 0 };
  for (const c of companies || []) out[abaDaEmpresa(c)] += 1;
  return out;
}

export function empresasDaAba(companies = [], aba = ABA_PADRAO) {
  return (companies || []).filter((c) => abaDaEmpresa(c) === aba);
}

export function rotuloAba(aba) {
  return ROTULOS[aba] || ROTULOS[ABA_PADRAO];
}

/**
 * As abas a desenhar, com a contagem no rótulo.
 *
 * ⚠ A contagem vai no TEXTO, não no `badge` do componente `Tabs`: aquele badge é vermelho
 * (`--state-danger`), a cor de "precisa de ação agora". "Simples Nacional 22" com o 22 em vermelho
 * diria que há 22 problemas.
 *
 * ⚠ As duas fixas aparecem MESMO COM ZERO — aba que some quando o filtro esvazia faria o contador
 * achar que a carteira não tem empresa daquele regime. `OUTROS` é o contrário: ela só existe quando
 * há alguém, porque é a aba que denuncia o inesperado.
 */
export function abasVisiveis(contagens = {}) {
  return ORDEM_ABAS
    .filter((aba) => aba !== ABA_OUTROS || (contagens[ABA_OUTROS] || 0) > 0)
    .map((aba) => ({
      key: aba,
      rotulo: rotuloAba(aba),
      contagem: contagens[aba] || 0,
      cor: corDaAba(aba),
      title: aba === ABA_OUTROS
        ? "Empresas cujo regime não é Simples Nacional nem Lucro Presumido — inclusive as sem regime cadastrado"
        : undefined,
    }));
}

/**
 * A aba que vale AGORA, dada a escolha guardada e as contagens desta lista.
 *
 * ⚠ Isto não é preciosismo: `OUTROS` pode deixar de existir a qualquer momento (o filtro mudou, a
 * única empresa sem regime foi cadastrada). Sem esta normalização, a escolha salva apontaria para
 * uma aba que não está desenhada — a tabela ficaria vazia e nenhum botão apareceria selecionado.
 */
export function normalizarAba(aba, contagens = {}) {
  if (aba === ABA_SIMPLES || aba === ABA_PRESUMIDO) return aba;
  if (aba === ABA_OUTROS && (contagens[ABA_OUTROS] || 0) > 0) return ABA_OUTROS;
  return ABA_PADRAO;
}
