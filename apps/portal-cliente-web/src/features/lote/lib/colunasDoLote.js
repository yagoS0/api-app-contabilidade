// AS COLUNAS DA PLANILHA E OS CAMPOS DA REVISÃO — ESPELHO das listas fechadas do backend.
//
// ⚠⚠ **A AUTORIDADE É `apps/api/src/application/nfse/lote/colunasLote.js`**, e este arquivo é
// cópia. O espelho é **amarrado por teste**: `__tests__/colunasDoLote.test.js` importa as listas do
// backend e exige as MESMAS chaves, os MESMOS rótulos, na MESMA ordem. Sem esse amarre, "espelho" é
// intenção, não fato — e a divergência apareceria como *"ajustei o campo e o servidor recusou
// dizendo que ele não existe"*.
//
// ⚠ POR QUE HÁ CÓPIA, se o teste consegue importar o original: o **build** não consegue. O Docker
// deste portal tem Root Directory `apps/portal-cliente-web` (ver `Dockerfile` e `railway.toml`), e
// `apps/api` **não está no contexto de build** — um import cruzado no código de produção quebraria
// o deploy. No teste, que roda no monorepo inteiro, ele funciona; é exatamente a mesma solução do
// `codigoServicoDaNota.js`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ SÃO DUAS LISTAS, E CONFUNDI-LAS É O DEFEITO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// > Dono (20/08/2026): *"não precisamos de nada do tomador, apenas o CNPJ ou CPF. Em caso que
// > precise de mais informações, na hora da revisão nós avisamos e permitimos o preenchimento."*
//
//   `COLUNAS_DO_LOTE`   as QUATRO colunas da PLANILHA. É o que o cliente preenche no Excel.
//   `CAMPOS_DA_REVISAO` as ONZE células que o formulário de revisão pode corrigir — as quatro da
//                       planilha mais nome, e-mail e o bloco de endereço.
//
// Eram doze colunas até 20/08/2026. Nome, e-mail e endereço não sumiram do fluxo: saíram da
// planilha e passaram a chegar do **cadastro de tomador**, da **consulta à Receita** ou desta
// **revisão** — e é por isso que a segunda lista existe. Montar o formulário de ajuste a partir de
// `COLUNAS_DO_LOTE` deixaria a pessoa sem como corrigir exatamente o que a pendência pede.
//
// ⚠ **O que NÃO foi copiado, de propósito:** os `aliases` (só o leitor da planilha os usa) e o
// texto de `ajuda` das COLUNAS (ele descreve como preencher a planilha; na tela quem diz o que
// fazer é a pendência que o backend devolveu, com a frase daquele caso). A `ajuda` dos campos da
// REVISÃO ficou: ela é lida ao lado do campo, nesta tela.

/** Na ordem do modelo. `chave` é o vocabulário do domínio — o mesmo do XML e do validador. */
export const COLUNAS_DO_LOTE = Object.freeze([
  { chave: "documento", rotulo: "CNPJ/CPF do tomador", obrigatoria: true },
  { chave: "descricao", rotulo: "Descrição do serviço", obrigatoria: true },
  { chave: "valor", rotulo: "Valor do serviço (R$)", obrigatoria: true },
  { chave: "competencia", rotulo: "Data da competência (dd/mm/aaaa)", obrigatoria: true },
]);

/**
 * As células que o formulário de revisão desenha. ⚠ `naPlanilha` distingue as que vieram do arquivo
 * das que só existem aqui — a tela agrupa por isso, e diz de onde cada bloco veio.
 *
 * ⚠⚠ **`cMun` NÃO É UM CAMPO DE TEXTO NESTA TELA.** Ele é preenchido pelo `SeletorMunicipio`, o
 * MESMO da emissão avulsa: busca por nome, mostra município **e UF** em toda opção, não
 * autosseleciona nem com resultado único, e devolve o código junto da escolha. *"Código do IBGE é
 * abstração"* (dono) — ninguém digita sete dígitos, e ninguém converte nome em código: há cinco
 * "Bom Jesus" no país, e escolher um deles em silêncio emite a nota no município errado.
 */
export const CAMPOS_DA_REVISAO = Object.freeze([
  {
    chave: "documento",
    rotulo: "CNPJ/CPF do tomador",
    naPlanilha: true,
    // ⚠ "É a única coisa que pedimos do tomador" saiu: era a 3ª de quatro repetições da mesma
    // ideia na mesma tela, e o cabeçalho logo acima já diz quantas colunas são.
    ajuda: "Só números ou com máscara. 11 dígitos (CPF) ou 14 (CNPJ).",
  },
  { chave: "descricao", rotulo: "Descrição do serviço", naPlanilha: true, ajuda: "O que está sendo prestado. Sai impresso no DANFSe." },
  { chave: "valor", rotulo: "Valor do serviço (R$)", naPlanilha: true, ajuda: "Maior que zero. Use vírgula para os centavos: 1500,00" },
  {
    chave: "competencia",
    rotulo: "Data da competência (dd/mm/aaaa)",
    naPlanilha: true,
    ajuda: "Obrigatória: em branco, a nota sairia com a data de hoje sem ninguém ver.",
  },
  {
    chave: "nome",
    rotulo: "Nome / razão social do tomador",
    naPlanilha: false,
    // ⚠ 4ª repetição — e o parágrafo imediatamente acima deste formulário já diz exatamente isso.
    ajuda: "Como deve sair na nota.",
  },
  { chave: "email", rotulo: "E-mail do tomador", naPlanilha: false, ajuda: "Opcional. Em branco não impede nada." },
  {
    chave: "cMun",
    rotulo: "Município do tomador",
    naPlanilha: false,
    // ⚠ Descrevia o que o seletor faz à vista (a lista já é a oficial, e o código aparece junto da
    // escolha) e nomeava o IBGE. A regra que importa — a escolha é de quem lê, nada é deduzido do
    // nome — está no comportamento do `SeletorMunicipio`, não numa frase.
    ajuda: "Escolha o município na lista.",
  },
  { chave: "cep", rotulo: "CEP do tomador", naPlanilha: false, ajuda: "8 dígitos." },
  { chave: "xLgr", rotulo: "Logradouro do tomador", naPlanilha: false, ajuda: "A rua inteira, ex.: “Rua da Assembleia”." },
  { chave: "nro", rotulo: "Número", naPlanilha: false, ajuda: "" },
  { chave: "xBairro", rotulo: "Bairro", naPlanilha: false, ajuda: "" },
  {
    chave: "xCpl",
    rotulo: "Complemento",
    naPlanilha: false,
    ajuda: "O único campo do endereço que pode ficar em branco com o resto preenchido.",
  },
]);

/**
 * O bloco de endereço, que a emissão exige INTEIRO (só `xCpl` é opcional).
 *
 * ⚠ Ele fica junto no formulário de ajuste porque é TUDO OU NADA: `buildDpsXml` recusa a emissão
 * (`MISSING_TOMADOR_ADDRESS`) faltando qualquer um dos cinco. Espalhar esses campos entre os
 * outros faria a pessoa preencher quatro e achar que adiantou.
 */
export const CAMPOS_DE_ENDERECO = Object.freeze(["cMun", "cep", "xLgr", "nro", "xBairro", "xCpl"]);

export const CHAVES_DO_LOTE = Object.freeze(COLUNAS_DO_LOTE.map((c) => c.chave));

export function rotuloDaColuna(chave) {
  return CAMPOS_DA_REVISAO.find((c) => c.chave === chave)?.rotulo || String(chave || "");
}

/**
 * O nome do arquivo que a pessoa salva ao baixar o modelo.
 *
 * ⚠ ESPELHO de `NOME_DO_ARQUIVO` (`modeloPlanilhaLote.js`), e composto AQUI porque o
 * `Content-Disposition` **não é legível por JavaScript entre origens** (não está na lista segura do
 * CORS, e o portal roda em outra porta que a API). Ler aquele cabeçalho produziria um download
 * chamado `undefined.xlsx` — é a mesma razão já registrada em `notas/lib/loteDanfse.js`.
 */
export const NOME_DO_ARQUIVO_MODELO = "modelo-emissao-em-lote.xlsx";
