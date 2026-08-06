// ESPELHO DA DEFIS — a especificação dos campos, na ORDEM e com os RÓTULOS do portal.
//
// ⚠ FONTE (regra 4 — fonte oficial vence):
// Manual do PGDAS-D e DEFIS, Receita Federal, versão 17/06/2025, seções 9.2 a 9.4.3.4.
// https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/manual_pgdas-d_2018_v4.pdf
// Numeração conferida contra reproduções das telas do PGDAS-D/DEFIS. Entregue pelo dono do
// projeto — não foi inferida por nós.
//
// ⚠ POR QUE ISTO É UM ARQUIVO DE DADOS, E NÃO JSX ESPALHADO
// O espelho só tem valor se o contador transcrever DE CIMA PARA BAIXO sem procurar campo. Isso
// significa que rótulo, ordem e numeração são o produto — não detalhe de apresentação. Num
// formulário escrito à mão, um campo movido "para ficar melhor" destrói silenciosamente a única
// coisa que o espelho entrega. Aqui a ordem é dado, e a tela apenas percorre.
//
// ⚠ NADA DE OMITIR CAMPO "QUE NÃO SE APLICA". Empresa só de serviços tende a zerar vários campos
// do estabelecimento; eles continuam VISÍVEIS, na posição do portal. Esconder o que zera é
// justamente o que faz a ordem visual divergir da tela oficial.
//
// ⚠ NÃO VERIFICADO CONTRA O PORTAL AO VIVO (`verificadoNoPortal: false`, abaixo).
// O manual é de jun/2025 e o portal ganha campos em ano de reforma. Antes do primeiro uso real o
// contador confere lado a lado, rótulo por rótulo — e divergência encontrada ajusta O ESPELHO,
// nunca o preenchimento. A tela avisa isso em cima, não em nota de rodapé.

export const DEFIS_FONTE = Object.freeze({
  documento: "Manual do PGDAS-D e DEFIS — Receita Federal",
  versao: "17/06/2025",
  secoes: "9.2 a 9.4.3.4",
  url: "https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/manual_pgdas-d_2018_v4.pdf",
  /** Prazo de referência; situação especial tem prazo próprio (Res. CGSN 140/2018, art. 72, §2º). */
  prazo: "31 de março do ano seguinte",
  // ⚠ Vira `true` só depois de o contador conferir contra o portal ao vivo. Enquanto for false, a
  // tela mostra o aviso de conferência — mesma disciplina do `verificadoTrial` do PGDAS-D.
  verificadoNoPortal: false,
});

/** Os blocos, na ordem das telas do portal (seção 0 do manual). */
export const DEFIS_BLOCOS = Object.freeze([
  { chave: "ano", titulo: "Ano-calendário" },
  { chave: "tipo", titulo: "Tipo de declaração" },
  { chave: "inatividade", titulo: "Declaração de Inatividade" },
  { chave: "meEpp", titulo: "Informações econômicas e fiscais — de toda a ME/EPP" },
  { chave: "estabelecimentos", titulo: "Informações econômicas e fiscais — por estabelecimento" },
  { chave: "conferencia", titulo: "Conferência e transmissão" },
]);

/**
 * Tela "De toda a ME/EPP".
 * `n` é a numeração do portal e aparece na tela: é por ela que o contador acha o campo lá.
 */
export const CAMPOS_ME_EPP = Object.freeze([
  { n: "1", campo: "ganhosCapital", rotulo: "Ganhos de capital (R$)", tipo: "moeda",
    ajuda: "Ganho na alienação de bens/direitos da empresa." },
  { n: "2", campo: "empregadosInicio", tipo: "inteiro",
    rotulo: "Quantidade de empregados no início do período abrangido pela declaração" },
  { n: "3", campo: "empregadosFim", tipo: "inteiro",
    rotulo: "Quantidade de empregados no final do período abrangido pela declaração" },
  { n: "4", campo: "lucroContabil", tipo: "moeda",
    rotulo: "Lucro contábil apurado no período abrangido por essa declaração (R$)",
    ajuda: "Só preencher se mantém escrituração contábil e o lucro superou o limite de isenção (Res. CGSN 140/2018, art. 145). É o campo que sustenta distribuição de lucros acima da presunção." },
  { n: "5", campo: "receitaExportacaoDireta", tipo: "moeda",
    rotulo: "Receita proveniente de exportação direta (R$)",
    ajuda: "Deve conversar com o que foi informado no PGDAS-D no ano." },
  { n: "6", campo: "exportadoras", tipo: "lista",
    rotulo: "Receita proveniente de exportação por meio de comercial exportadora",
    colunas: [{ campo: "cnpj", rotulo: "CNPJ", tipo: "texto" }, { campo: "valor", rotulo: "R$", tipo: "moeda" }] },
  { n: "7", campo: "socios", tipo: "socios",
    rotulo: "Identificação e rendimentos dos sócios",
    // Os sub-rótulos saem do manual com a mesma numeração (7.1 a 7.4).
    subcampos: [
      { n: "7.1", campo: "rendIsentos", tipo: "moeda",
        rotulo: "Rendimentos isentos pagos ao sócio pela empresa (R$)",
        ajuda: "Distribuição de lucros. NÃO inclui pró-labore, aluguéis ou serviços." },
      { n: "7.2", campo: "rendTributaveis", tipo: "moeda",
        rotulo: "Rendimentos tributáveis pagos ao sócio pela empresa (R$)",
        ajuda: "Pró-labore, aluguéis e serviços prestados." },
      { n: "7.3", campo: "percentual", tipo: "percentual",
        rotulo: "Percentual de participação do sócio no capital social da empresa no último dia do período (%)" },
      { n: "7.4", campo: "irrf", tipo: "moeda",
        rotulo: "Imposto de renda retido na fonte sobre os rendimentos pagos ao sócio pela ME/EPP (R$)" },
    ] },
  { n: "8", campo: "ganhosRendaVariavel", tipo: "moeda",
    rotulo: "Total de ganhos líquidos auferidos em operações de renda variável (R$)",
    ajuda: "Aplicações financeiras de renda fixa/variável." },
  { n: "9", campo: "doacoesEleitorais", tipo: "lista",
    rotulo: "Doações à campanha eleitoral",
    colunas: [
      { campo: "tipoBeneficiario", rotulo: "Tipo do beneficiário", tipo: "texto" },
      { campo: "formaDoacao", rotulo: "Forma de doação", tipo: "texto" },
      { campo: "valor", rotulo: "R$", tipo: "moeda" },
    ] },
]);

/** Tela "Por estabelecimento" — repetida por CNPJ (matriz e cada filial). */
export const CAMPOS_ESTABELECIMENTO = Object.freeze([
  { n: "1", campo: "estoqueInicial", tipo: "moeda",
    rotulo: "Estoque inicial do período abrangido pela declaração",
    ajuda: "Livro Registro de Inventário. Empresa em atividade o ano todo: posição de 31/12 do ano anterior." },
  { n: "2", campo: "estoqueFinal", tipo: "moeda",
    rotulo: "Estoque final do período abrangido pela declaração",
    ajuda: "Posição de 31/12 do ano-calendário." },
  // ⚠ Os dois saldos ACEITAM NEGATIVO. Um campo que recusa "-" aqui obriga a transcrever errado.
  { n: "3", campo: "saldoInicial", tipo: "moeda", aceitaNegativo: true,
    rotulo: "Saldo em caixa/banco no início do período abrangido pela declaração" },
  { n: "4", campo: "saldoFinal", tipo: "moeda", aceitaNegativo: true,
    rotulo: "Saldo em caixa/banco no final do período abrangido pela declaração" },
  { n: "5", campo: "aquisicoes", tipo: "moeda",
    rotulo: "Total de aquisições de mercadorias para comercialização ou industrialização no período",
    subcampos: [
      { n: "5.1", campo: "aquisicoesInterno", tipo: "moeda", rotulo: "Aquisições no mercado interno" },
      { n: "5.2", campo: "aquisicoesImportacao", tipo: "moeda", rotulo: "Importações" },
    ] },
  { n: "6", campo: "entradasTransferencia", tipo: "moeda",
    rotulo: "Total de entradas de mercadorias por transferência",
    ajuda: "Só operações entre estabelecimentos da MESMA empresa — espelha o campo 7 do outro estabelecimento." },
  { n: "7", campo: "saidasTransferencia", tipo: "moeda",
    rotulo: "Total de saídas de mercadorias por transferência",
    ajuda: "Lado da saída da mesma operação do campo 6 do outro estabelecimento." },
  { n: "8", campo: "devolucoesVendas", tipo: "moeda",
    rotulo: "Total de devoluções de vendas de mercadorias" },
  { n: "9", campo: "totalEntradas", tipo: "moeda",
    rotulo: "Total de entradas (incluídos os itens 5, 6 e 8) no período",
    ajuda: "Inclui uso e consumo, ativo imobilizado, remessas para industrialização e conserto, fretes interestaduais." },
  { n: "10", campo: "devolucoesCompras", tipo: "moeda",
    rotulo: "Total de devoluções de compras de mercadorias" },
  { n: "11", campo: "totalDespesas", tipo: "moeda",
    rotulo: "Total de despesas no período abrangido pela declaração",
    ajuda: "Desembolsos do curso das atividades: custos, salários, despesas operacionais e não operacionais." },
  { n: "12", campo: "entradasInterestaduais", tipo: "lista",
    rotulo: "Total de entradas interestaduais, por UF",
    ajuda: "Totalidade das entradas interestaduais, não só as para revenda. Linha com valor zero deve ser removida (desmarcar a UF no portal).",
    colunas: [{ campo: "uf", rotulo: "UF", tipo: "texto" }, { campo: "valor", rotulo: "R$", tipo: "moeda" }] },
  { n: "13", campo: "saidasInterestaduais", tipo: "lista",
    rotulo: "Total de saídas interestaduais, por UF",
    colunas: [{ campo: "uf", rotulo: "UF", tipo: "texto" }, { campo: "valor", rotulo: "R$", tipo: "moeda" }] },
  { n: "14", campo: "issRetido", tipo: "lista",
    rotulo: "Valor do ISS retido na fonte no ano-calendário, por Município",
    ajuda: "Na condição de PRESTADOR que sofreu retenção.",
    colunas: [
      { campo: "uf", rotulo: "UF", tipo: "texto" },
      { campo: "municipio", rotulo: "Município", tipo: "texto" },
      { campo: "valor", rotulo: "R$", tipo: "moeda" },
    ] },
  { n: "15", campo: "servicosComunicacao", tipo: "lista",
    rotulo: "Prestação de serviços de comunicação",
    ajuda: "Discriminar por UF/Município onde prestados.",
    colunas: [
      { campo: "uf", rotulo: "UF", tipo: "texto" },
      { campo: "municipio", rotulo: "Município", tipo: "texto" },
      { campo: "valor", rotulo: "R$", tipo: "moeda" },
    ] },
]);

/**
 * "Dados referentes ao Município" — perguntas Sim/Não ao final da ficha do estabelecimento.
 *
 * ⚠ O MANUAL diz que são hipóteses PRÉ-DEFINIDAS PELO SISTEMA, e não traz a lista fechada. Então
 * aqui não há lista: inventar as perguntas seria pior que não tê-las — o contador leria no espelho
 * uma pergunta que o portal não faz. A tela reserva o lugar, na posição certa, e manda ler no
 * portal. Quando o dono trouxer as perguntas reais, elas entram aqui.
 */
export const PERGUNTAS_MUNICIPIO = Object.freeze([]);

/** Um estabelecimento vazio, com todas as listas prontas. */
export function estabelecimentoVazio(cnpj = "", nome = "") {
  return {
    cnpj, nome,
    estoqueInicial: "", estoqueFinal: "", saldoInicial: "", saldoFinal: "",
    aquisicoes: "", aquisicoesInterno: "", aquisicoesImportacao: "",
    entradasTransferencia: "", saidasTransferencia: "", devolucoesVendas: "",
    totalEntradas: "", devolucoesCompras: "", totalDespesas: "",
    entradasInterestaduais: [], saidasInterestaduais: [], issRetido: [], servicosComunicacao: [],
  };
}

/** O espelho em branco de um ano-calendário. */
export function espelhoVazio(anoCalendario) {
  return {
    anoCalendario,
    tipoDeclaracao: "ORIGINAL",
    situacaoEspecial: null,
    inativa: false,
    meEpp: {
      ganhosCapital: "", empregadosInicio: "", empregadosFim: "", lucroContabil: "",
      receitaExportacaoDireta: "", exportadoras: [],
      socios: [], ganhosRendaVariavel: "", doacoesEleitorais: [],
    },
    estabelecimentos: [],
    transmitida: null,
  };
}
