// AS COLUNAS DA PLANILHA DE EMISSÃO EM LOTE — lista FECHADA, derivada do validador.
//
// > Dono (19/08/2026): *"a planilha deve ser baixada por nós o modelo, o cliente preenche"* e
// > *"os dados necessários e mínimos"*.
//
// ⚠⚠ **NADA AQUI EMITE NOTA.** Este módulo descreve colunas de uma planilha. A emissão em lote é
// fase seguinte e não passa por aqui.
//
// ─── DE ONDE VEIO CADA COLUNA (medido, não escolhido) ───────────────────────────────────────────
//
// As cinco obrigatórias são exatamente o que `validateNfsePayload`
// (`application/validators/nfsePayload.js`) recusa quando falta:
//   documento   → `tomador_documento_invalido` / `tomador_cpf_digito_invalido`
//   nome        → `tomador_nome_obrigatorio`
//   descrição   → `servico_descricao_obrigatoria`
//   valor       → `servico_valor_invalido` (exige `> 0`)
//   competência → ⚠ o validador NÃO exige, e é por isso que ela está aqui. Ver abaixo.
//
// O bloco de endereço são os CINCO que `hasEnderecoTomador` (mesmo arquivo) exige juntos, mais o
// único opcional (`xCpl`). É o mesmo conjunto que `buildDpsXml` recusa com
// `MISSING_TOMADOR_ADDRESS` (`NfseService.js:718-732`).
//
// O e-mail é opcional e INDEPENDENTE do bloco de endereço.
//
// ─── O QUE **NÃO** ENTRA, E POR QUÊ ─────────────────────────────────────────────────────────────
//
// ⚠⚠ NÃO HÁ COLUNA PARA NADA QUE JÁ ESTEJA NO CADASTRO DA EMPRESA: município emissor
// (`Company.codigoMunicipioIbge`), código de serviço (`Company.codigosServicoNacional`), série
// (`Company.rpsSerie`), carga tributária do Presumido (`Company.pTotTrib*`) e alíquota efetiva do
// Simples. Uma coluna dessas seria uma porta para emitir CONTRADIZENDO o cadastro — e o cadastro é
// a autoridade, nunca o payload (é a regra que `escolherCodigoServicoNacional` já faz valer no
// pré-voo de `NfseService.issue`).
//
// ⚠ Também não há coluna de local da prestação (`cLocPrestacao`): ele é regra da LC 116/2003,
// art. 3º, e o próprio validador diz que não se deduz do endereço do tomador.
//
// ⚠ E não há coluna de consentimento para envio de e-mail. O dono disse *"futuramente vamos enviar
// as notas direto para o e-mail do tomador, **se o cliente permitir**"* — o "se o cliente permitir"
// é decisão dele e ainda não foi tomada. Capturamos o dado e paramos aí.
//
// ─── DUAS COLUNAS COM DECISÃO PRÓPRIA ───────────────────────────────────────────────────────────
//
// ⚠ **COMPETÊNCIA É OBRIGATÓRIA AQUI, E O VALIDADOR NÃO A EXIGE.** Ser mais rígido é deliberado:
// `formatDateOnly` (`NfseService.js:162-167`) devolve **a data de HOJE** quando a competência falta
// ou é ilegível. Numa nota só, quem emite vê a data na tela; num lote de 200 linhas ninguém vê, e a
// data do upload carimbaria silenciosamente todas as notas. Como a LEITURA NÃO EMITE NADA, exigir
// aqui não bloqueia ninguém — pede ajuste numa tela feita para isso. Decisão registrada em
// 19/08/2026.
//
// ⚠ **E-MAIL É OPCIONAL DE VERDADE.** Pedido do dono (19/08/2026): *"quero o e-mail junto sim, pois
// futuramente vamos enviar as notas direto para o e-mail do tomador, se o cliente permitir"* — é
// captura de dado para uma funcionalidade que vem, e pela planilha ele nunca seria capturado de
// outra forma (a Fase 1 só guarda o que a emissão teve). Linha sem e-mail é linha PRONTA: o
// validador não o exige e `MISSING_TOMADOR_ADDRESS` não tem equivalente para e-mail. Não repita
// aqui o tudo-ou-nada do endereço, que existe por outro motivo.

/** As três colunas que guardam DÍGITOS e que o Excel estraga sozinho — ver `modeloPlanilhaLote.js`. */
export const COLUNAS_DE_TEXTO = Object.freeze(["documento", "cMun", "cep"]);

/**
 * A lista fechada, na ordem em que aparece no modelo.
 *
 * ⚠ `chave` é o vocabulário do DOMÍNIO (`cMun`, `xLgr`…), não um nome "amigável": é o mesmo do
 * validador, do `buildDpsXml` e da tabela `tomadores_emitidos`. Traduzir criaria mais um de-para
 * para alguém errar. `rotulo` é o que a pessoa lê na planilha.
 *
 * ⚠ `aliases` existe para a planilha que voltou editada — alguém renomeia cabeçalho, o Excel
 * acrescenta espaço, o acento se perde no CSV. A comparação é normalizada (sem acento, sem
 * pontuação, minúscula). Nenhum alias adivinha COLUNA NOVA: eles são grafias do mesmo rótulo.
 */
export const COLUNAS_LOTE = Object.freeze([
  {
    chave: "documento",
    rotulo: "CNPJ/CPF do tomador",
    obrigatoria: true,
    aliases: ["cnpj cpf do tomador", "cnpj cpf", "cpf cnpj", "documento do tomador", "documento", "cnpj", "cpf"],
    ajuda: "Só números ou com máscara. 11 dígitos (CPF) ou 14 (CNPJ).",
  },
  {
    chave: "nome",
    rotulo: "Nome / razão social do tomador",
    obrigatoria: true,
    aliases: ["nome razao social do tomador", "nome razao social", "razao social", "nome do tomador", "nome", "tomador"],
    ajuda: "Como deve sair na nota.",
  },
  {
    chave: "descricao",
    rotulo: "Descrição do serviço",
    obrigatoria: true,
    aliases: ["descricao do servico", "descricao", "servico", "discriminacao", "discriminacao do servico"],
    ajuda: "O que está sendo prestado. Sai impresso no DANFSe.",
  },
  {
    chave: "valor",
    rotulo: "Valor do serviço (R$)",
    obrigatoria: true,
    aliases: ["valor do servico r", "valor do servico", "valor", "valor total", "total", "vlr"],
    ajuda: "Maior que zero. Use vírgula para os centavos: 1500,00",
  },
  {
    chave: "competencia",
    rotulo: "Data da competência (dd/mm/aaaa)",
    obrigatoria: true,
    aliases: ["data da competencia dd mm aaaa", "data da competencia", "competencia", "data"],
    ajuda: "Obrigatória: em branco, a nota sairia com a data de hoje sem ninguém ver.",
  },
  {
    chave: "email",
    rotulo: "E-mail do tomador",
    obrigatoria: false,
    aliases: ["e mail do tomador", "email do tomador", "e mail", "email"],
    ajuda: "Opcional. Em branco não impede nada.",
  },
  {
    chave: "cMun",
    rotulo: "Código IBGE do município do tomador",
    obrigatoria: false,
    aliases: ["codigo ibge do municipio do tomador", "codigo ibge do municipio", "codigo ibge", "codigo do municipio", "cmun", "municipio ibge"],
    ajuda: "7 dígitos. ⚠ O NOME do município não serve: há cinco “Bom Jesus” no país.",
  },
  {
    chave: "cep",
    rotulo: "CEP do tomador",
    obrigatoria: false,
    aliases: ["cep do tomador", "cep"],
    ajuda: "8 dígitos.",
  },
  {
    chave: "xLgr",
    rotulo: "Logradouro do tomador",
    obrigatoria: false,
    aliases: ["logradouro do tomador", "logradouro", "endereco", "rua"],
    ajuda: "A rua inteira, ex.: “Rua da Assembleia”.",
  },
  {
    chave: "nro",
    rotulo: "Número",
    obrigatoria: false,
    aliases: ["numero", "nro", "num", "numero do endereco"],
    ajuda: "",
  },
  {
    chave: "xBairro",
    rotulo: "Bairro",
    obrigatoria: false,
    aliases: ["bairro"],
    ajuda: "",
  },
  {
    chave: "xCpl",
    rotulo: "Complemento",
    obrigatoria: false,
    aliases: ["complemento", "compl"],
    ajuda: "O único campo do endereço que pode ficar em branco com o resto preenchido.",
  },
]);

/**
 * A LINHA DE EXEMPLO do modelo — dado, não código, e por isso mora aqui junto das colunas.
 *
 * ⚠⚠ **ELA É RECONHECIDA E DESCARTADA NA LEITURA** (`lerPlanilhaLote`), quando volta intacta. Sem
 * isso, o cliente que esquecesse de apagá-la mandaria uma nota para "TOMADOR EXEMPLO LTDA" —
 * completa, bem formada e, na fase seguinte, **emitida**. Uma linha de exemplo que vira nota fiscal
 * é o pior desfecho possível de um modelo. O descarte exige igualdade EXATA em todas as células:
 * editou qualquer campo, é dado de verdade e é lido como tal.
 *
 * ⚠ O CPF do exemplo **começa com zero e tem DV válido** de propósito — é a armadilha do Excel
 * exibida no próprio modelo, e é literalmente o número do enunciado do problema (`01234567890` vira
 * `1234567890` em coluna numérica). Ele fecha no módulo 11, conferível à mão pela regra de
 * `utils/cpf.js`.
 *
 * ⚠ O código de município é o **3304557 (Rio de Janeiro)**, o mesmo exemplo de
 * `docs/nfse-preenchimento.md` §2/§5. Nada aqui é derivado de cadastro nenhum.
 */
export const LINHA_DE_EXEMPLO = Object.freeze({
  documento: "01234567890",
  nome: "TOMADOR EXEMPLO LTDA",
  descricao: "Serviços de consultoria contábil prestados em julho",
  valor: "1500,00",
  competencia: "31/07/2026",
  email: "financeiro@exemplo.com.br",
  cMun: "3304557",
  cep: "20031005",
  xLgr: "Avenida Rio Branco",
  nro: "100",
  xBairro: "Centro",
  xCpl: "Sala 1201",
});

/**
 * As CINCO do endereço que a emissão exige juntas. `xCpl` fica de fora — é o único opcional.
 *
 * ⚠ TUDO-OU-NADA, e não por gosto: `buildDpsXml` recusa a emissão com `MISSING_TOMADOR_ADDRESS`
 * faltando qualquer um dos cinco. Meio endereço na planilha é PENDÊNCIA, nunca "quase pronta" — é
 * a mesma disciplina do `xLgr` do portal, onde a palavra "RUA" sozinha passava por logradouro
 * preenchido e o endereço inteiro entrava com "Rua" no lugar da rua.
 */
export const ENDERECO_EXIGIDO = Object.freeze([
  ["cMun", "o código IBGE do município"],
  ["cep", "o CEP"],
  ["xLgr", "o logradouro"],
  ["nro", "o número"],
  ["xBairro", "o bairro"],
]);

/** Todos os campos de endereço, inclusive o opcional. */
export const CAMPOS_ENDERECO = Object.freeze([...ENDERECO_EXIGIDO.map(([c]) => c), "xCpl"]);

export const COLUNAS_OBRIGATORIAS = Object.freeze(COLUNAS_LOTE.filter((c) => c.obrigatoria).map((c) => c.chave));

/** "Descrição do serviço " e "descricao do servico" precisam casar. Mesma normalização do import contábil. */
export function normalizarCabecalho(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const POR_TEXTO = new Map();
for (const coluna of COLUNAS_LOTE) {
  POR_TEXTO.set(normalizarCabecalho(coluna.rotulo), coluna.chave);
  for (const alias of coluna.aliases) POR_TEXTO.set(normalizarCabecalho(alias), coluna.chave);
}

/**
 * Uma célula de cabeçalho vira a chave da coluna, ou `null`.
 *
 * ⚠ **NÃO HÁ CASAMENTO POR POSIÇÃO.** `excelImport.js` tem um fallback "posição 0,1,2" para o
 * extrato bancário, e ali isso é aceitável — o pior caso é um lançamento contábil para conferir.
 * Aqui a coluna 1 confundida com a 2 emitiria a nota com o nome no lugar do CNPJ. Cabeçalho que
 * não se reconhece é planilha recusada, com o nome do que não bateu.
 */
export function chaveDaColuna(celula) {
  return POR_TEXTO.get(normalizarCabecalho(celula)) ?? null;
}
