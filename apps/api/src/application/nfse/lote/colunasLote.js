// AS COLUNAS DA PLANILHA DE EMISSÃO EM LOTE — lista FECHADA, e agora são QUATRO.
//
// > Dono (19/08/2026): *"a planilha deve ser baixada por nós o modelo, o cliente preenche"* e
// > *"os dados necessários e mínimos"*.
//
// ⚠⚠ **NADA AQUI EMITE NOTA.** Este módulo descreve colunas de uma planilha e os campos que a tela
// de revisão pode preencher. A emissão em lote é outro módulo (`emissaoLote.js`).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ ERAM DOZE ATÉ 20/08/2026. O DONO CORTOU SETE, E A RAZÃO É DE QUEM PREENCHE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// > Dono (20/08/2026): *"não precisamos de nada do tomador, apenas o CNPJ ou CPF. Em caso que
// > precise de mais informações, na hora da revisão nós avisamos e permitimos o preenchimento.
// > (…) código do IBGE é abstração."*
//
// **O critério é de quem vai preencher: quanto menos colunas, mais gente consegue usar.** Saíram
// `nome`, `email` e o bloco inteiro de endereço (`cMun`, `cep`, `xLgr`, `nro`, `xBairro`, `xCpl`).
//
// ⚠⚠ **ELAS NÃO SUMIRAM DO FLUXO — MUDARAM DE LUGAR.** Continuam existindo como CAMPOS, em
// `CAMPOS_DA_REVISAO`, e o classificador continua lendo cada um deles. O que mudou é **por onde
// entram**: não mais por uma coluna que o cliente teria de preencher 200 vezes, e sim
//   1. do **cadastro de tomador** (`tomadorEmitido.js`), quando a empresa já emitiu para o documento;
//   2. da **consulta à Receita**, quando é CNPJ;
//   3. da **tela de revisão**, quando as duas primeiras não respondem.
//
// ⚠⚠ **E O CPF SEMPRE CAI NA REVISÃO NA PRIMEIRA VEZ. ISSO É O ESPERADO, NÃO DEFEITO.** CPF não se
// consulta (decisão do dono, registrada em `utils/cpf.js` e em `consultaTomador.js`): a base pública
// é de CNPJ, a consulta é paga e o tomador é terceiro (LGPD). Então, para um CPF que nunca recebeu
// nota desta empresa, **não existe origem** para o nome nem para o endereço — a revisão pergunta.
//
// ⚠ **CONSEQUÊNCIA ACEITA E DESEJADA: MAIS LINHAS NASCEM EM `CONFERIR`/`PENDENTE`.** `PRONTA`
// continua exigindo tudo resolvido. Uma planilha de quatro colunas com tomadores novos produz muita
// pendência de revisão — é o desenho, e a tela já mostra quantas estão prontas e quantas não.
//
// ─── DE ONDE VEIO CADA COLUNA QUE FICOU (medido, não escolhido) ─────────────────────────────────
//
// As quatro são exatamente o que `validateNfsePayload`
// (`application/validators/nfsePayload.js`) recusa quando falta E que **só a linha da planilha
// sabe** — ou seja, o que não tem como vir de cadastro nenhum:
//   documento   → `tomador_documento_invalido` / `tomador_cpf_digito_invalido`
//   descrição   → `servico_descricao_obrigatoria`
//   valor       → `servico_valor_invalido` (exige `> 0`)
//   competência → ⚠ o validador NÃO exige, e é por isso que ela está aqui. Ver abaixo.
//
// ⚠ **O NOME É OBRIGATÓRIO NO VALIDADOR (`tomador_nome_obrigatorio`) E MESMO ASSIM SAIU DA
// PLANILHA.** Ele não deixou de ser exigido: ele passou a ter três fontes (memória, consulta,
// revisão), e a linha sem nenhuma delas é PENDENTE com o motivo. Ver `classificarLinhaLote.js`.
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
// ⚠ **NÃO HÁ COLUNA DE ATIVIDADE / CÓDIGO DE SERVIÇO, e o dono pediu explicitamente que não
// houvesse**: *"retire o campo de atividade — o cliente não sabe escolher isso"*. Nunca houve, e
// continua não havendo. O código que a nota leva sai do cadastro da empresa, por
// `escolherCodigoServicoNacional`.
//
// ⚠ Também não há coluna de local da prestação (`cLocPrestacao`): ele é regra da LC 116/2003,
// art. 3º, e o próprio validador diz que não se deduz do endereço do tomador.
//
// ⚠ E não há coluna de consentimento para envio de e-mail. O dono disse *"futuramente vamos enviar
// as notas direto para o e-mail do tomador, **se o cliente permitir**"* — o "se o cliente permitir"
// é decisão dele e ainda não foi tomada.
//
// ─── A COLUNA COM DECISÃO PRÓPRIA ───────────────────────────────────────────────────────────────
//
// ⚠ **COMPETÊNCIA É OBRIGATÓRIA AQUI, E O VALIDADOR NÃO A EXIGE.** Ser mais rígido é deliberado:
// `formatDateOnly` (`NfseService.js:162-167`) devolve **a data de HOJE** quando a competência falta
// ou é ilegível. Numa nota só, quem emite vê a data na tela; num lote de 200 linhas ninguém vê, e a
// data do upload carimbaria silenciosamente todas as notas. Como a LEITURA NÃO EMITE NADA, exigir
// aqui não bloqueia ninguém — pede ajuste numa tela feita para isso. Decisão de 19/08/2026.

/**
 * As colunas que guardam DÍGITOS e que o Excel estraga sozinho — ver `modeloPlanilhaLote.js`.
 *
 * ⚠ ERAM TRÊS (`documento`, `cMun`, `cep`). Sobrou uma: as outras duas deixaram de ser colunas.
 * O zero à esquerda do CPF continua sendo o caso, e continua tratado nas duas metades (o modelo
 * nasce formatado como texto; a leitura trata mesmo assim).
 */
export const COLUNAS_DE_TEXTO = Object.freeze(["documento"]);

/**
 * A lista fechada da PLANILHA, na ordem em que aparece no modelo.
 *
 * ⚠ `chave` é o vocabulário do DOMÍNIO (`cMun`, `xLgr`…), não um nome "amigável": é o mesmo do
 * validador, do `buildDpsXml` e da tabela `tomadores_emitidos`. Traduzir criaria mais um de-para
 * para alguém errar. `rotulo` é o que a pessoa lê na planilha.
 *
 * ⚠ `aliases` existe para a planilha que voltou editada — alguém renomeia cabeçalho, o Excel
 * acrescenta espaço, o acento se perde no CSV. A comparação é normalizada (sem acento, sem
 * pontuação, minúscula). Nenhum alias adivinha COLUNA NOVA: eles são grafias do mesmo rótulo.
 *
 * ⚠⚠ **AS SETE COLUNAS QUE SAÍRAM NÃO GANHARAM ALIAS DE COMPATIBILIDADE, DE PROPÓSITO.** Uma
 * planilha do modelo antigo, com "Nome / razão social do tomador" e o bloco de endereço, continua
 * sendo LIDA — as quatro colunas que importam são reconhecidas —, e as outras sete voltam nomeadas
 * em `colunasIgnoradas`, que a tela mostra. Aceitá-las em silêncio seria manter viva uma segunda
 * porta de entrada para o endereço, com a metade do fluxo (memória → consulta → revisão) sendo
 * pulada sem que ninguém visse.
 */
export const COLUNAS_LOTE = Object.freeze([
  {
    chave: "documento",
    rotulo: "CNPJ/CPF do tomador",
    obrigatoria: true,
    aliases: ["cnpj cpf do tomador", "cnpj cpf", "cpf cnpj", "documento do tomador", "documento", "cnpj", "cpf"],
    ajuda: "Só números ou com máscara. 11 dígitos (CPF) ou 14 (CNPJ). É a única coisa que pedimos do tomador.",
    tipo: "texto",
    formato: "@",
    // ⚠⚠ ESTA VALIDAÇÃO CONFERE **COMPRIMENTO**, E SÓ. Ela não confere dígito verificador, não
    // confere que são dígitos e não distingue CPF de CNPJ — quem faz isso é
    // `lerDocumentoDaPlanilha`, depois do envio. O que ela pega, e é muito, é o CPF que perdeu o
    // zero da frente: `01234567890` virado em número fica com 10 caracteres e bate na trava.
    // ⚠ 18 é o teto porque o CNPJ com máscara (`00.000.000/0000-00`) tem 18 caracteres.
    validacao: {
      tipo: "textLength",
      operador: "between",
      formula1: "11",
      formula2: "18",
      tituloDoErro: "CNPJ/CPF fora de forma",
      erro:
        "Digite 11 dígitos (CPF) ou 14 (CNPJ) — com ou sem máscara. "
        + "Se o CPF começa com zero, ele precisa continuar com os 11 dígitos.",
    },
  },
  {
    chave: "descricao",
    rotulo: "Descrição do serviço",
    obrigatoria: true,
    aliases: ["descricao do servico", "descricao", "servico", "discriminacao", "discriminacao do servico"],
    ajuda: "O que está sendo prestado. Sai impresso no DANFSe.",
    tipo: "texto",
    formato: "@",
    // ⚠⚠ SEM VALIDAÇÃO, DE PROPÓSITO. `validateNfsePayload` só exige que a descrição não seja vazia
    // (`servico_descricao_obrigatoria`) — **não há limite de tamanho em lugar nenhum do fluxo**
    // (medido no validador). Um `textLength` inventado aqui recusaria, na planilha, um texto que a
    // emissão aceita — e a divergência apareceria como uma linha barrada sem explicação possível.
    // A coluna ganha só o formato de texto e a caixa de ajuda.
    validacao: null,
  },
  {
    chave: "valor",
    rotulo: "Valor do serviço (R$)",
    obrigatoria: true,
    aliases: ["valor do servico r", "valor do servico", "valor", "valor total", "total", "vlr"],
    ajuda: "Maior que zero. Use vírgula para os centavos: 1500,00",
    tipo: "valor",
    formato: "#,##0.00",
    // ⚠ `> 0` é EXATAMENTE a regra que `validateNfsePayload` já aplica (`servico_valor_invalido`).
    // Nada foi inventado: a planilha passou a cobrar na entrada o que a emissão cobra na saída.
    validacao: {
      tipo: "decimal",
      operador: "greaterThan",
      formula1: "0",
      tituloDoErro: "Valor inválido",
      erro: "O valor do serviço precisa ser um número maior que zero. Use vírgula nos centavos: 1500,00",
    },
  },
  {
    chave: "competencia",
    rotulo: "Data da competência (dd/mm/aaaa)",
    obrigatoria: true,
    aliases: ["data da competencia dd mm aaaa", "data da competencia", "competencia", "data"],
    ajuda: "Obrigatória: em branco, a nota sairia com a data de hoje sem ninguém ver.",
    tipo: "data",
    formato: "dd/mm/yyyy",
    // ⚠⚠ A VALIDAÇÃO EXIGE QUE **SEJA UMA DATA**, E NADA ALÉM DISSO. Os limites são a faixa inteira
    // do Excel (serial 1 = 01/01/1900, serial 2958465 = 31/12/9999) — a mesma que
    // `lerCompetenciaDaPlanilha` já aceita.
    // ⚠ **Não há janela fiscal aqui porque não existe uma em lugar nenhum deste fluxo** (medido: nem
    // o validador nem o classificador limitam a competência). Estreitar a faixa seria inventar
    // regra fiscal na planilha, e é decisão do dono, não desta camada. Ver o relatório.
    validacao: {
      tipo: "date",
      operador: "between",
      formula1: "1",
      formula2: "2958465",
      tituloDoErro: "Data inválida",
      erro: "Digite uma data no formato dd/mm/aaaa — por exemplo 31/07/2026.",
    },
  },
]);

/**
 * ⚠⚠ OS CAMPOS QUE A TELA DE REVISÃO PODE PREENCHER — a lista fechada de CÉLULAS de uma linha.
 *
 * É o superconjunto de `COLUNAS_LOTE`: as quatro que vieram da planilha (marcadas `naPlanilha`)
 * mais as sete do tomador, que só existem aqui. É contra ESTA lista que `ajustesLote.js` valida —
 * e é dela que a tela de revisão monta o formulário.
 *
 * ⚠ **POR QUE DUAS LISTAS E NÃO UMA COM FLAG NO LUGAR DE `COLUNAS_LOTE`.** Elas respondem perguntas
 * diferentes, e confundi-las é o defeito: `COLUNAS_LOTE` responde *"o que o cabeçalho da planilha
 * pode conter?"* (e é o que `chaveDaColuna`, `lerPlanilhaLote` e o modelo consomem);
 * `CAMPOS_DA_REVISAO` responde *"que célula de uma linha uma pessoa pode corrigir?"*. Se fossem a
 * mesma, aceitar um ajuste de endereço obrigaria a aceitar uma COLUNA de endereço — que é
 * exatamente o que o dono cortou.
 *
 * ⚠ **`cMun` CONTINUA SENDO CÓDIGO IBGE AQUI, E NINGUÉM O DIGITA.** *"Código do IBGE é abstração"*
 * (dono) — por isso a revisão não oferece um campo de sete dígitos: ela usa o **seletor que já
 * existe** (`portal-cliente-web/src/features/emitir/SeletorMunicipio.jsx`), que busca por NOME,
 * mostra município **e UF** em cada opção e devolve o código junto da escolha.
 *
 * ⚠⚠ **NÃO EXISTE, EM LUGAR NENHUM DESTE FLUXO, CONVERSÃO DE NOME EM CÓDIGO.** Há cinco "Bom Jesus"
 * e cinco "São Domingos" no país (medido na lista oficial: 240 nomes cobrem 521 municípios), e
 * derivar o código pelo nome erra em homônimo — o erro aparece só como **nota emitida no município
 * errado**, que não se corrige, se cancela. O código nasce de uma ESCOLHA explícita de quem lê, com
 * a UF à vista. É a mesma disciplina de `SeletorMunicipio` e de `consultaTomador.js`.
 */
export const CAMPOS_DA_REVISAO = Object.freeze([
  ...COLUNAS_LOTE.map((c) => Object.freeze({ chave: c.chave, rotulo: c.rotulo, naPlanilha: true, ajuda: c.ajuda })),
  {
    chave: "nome",
    rotulo: "Nome / razão social do tomador",
    naPlanilha: false,
    ajuda: "Como deve sair na nota. Só é pedido quando não conseguimos saber por conta própria.",
  },
  {
    chave: "email",
    rotulo: "E-mail do tomador",
    naPlanilha: false,
    ajuda: "Opcional. Em branco não impede nada.",
  },
  {
    chave: "cMun",
    rotulo: "Município do tomador",
    naPlanilha: false,
    ajuda: "Escolha na lista oficial — o código do IBGE vem junto da escolha.",
  },
  { chave: "cep", rotulo: "CEP do tomador", naPlanilha: false, ajuda: "8 dígitos." },
  {
    chave: "xLgr",
    rotulo: "Logradouro do tomador",
    naPlanilha: false,
    ajuda: "A rua inteira, ex.: “Rua da Assembleia”.",
  },
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
 * A LINHA DE EXEMPLO do modelo — dado, não código, e por isso mora aqui junto das colunas.
 *
 * ⚠⚠ **ELA É RECONHECIDA E DESCARTADA NA LEITURA** (`lerPlanilhaLote`), quando volta intacta. Sem
 * isso, o cliente que esquecesse de apagá-la mandaria uma nota para o CPF do exemplo — completa,
 * bem formada e **emitida**. Uma linha de exemplo que vira nota fiscal é o pior desfecho possível de
 * um modelo. O descarte exige igualdade EXATA em todas as células: editou qualquer campo, é dado de
 * verdade e é lido como tal.
 *
 * ⚠ O CPF do exemplo **começa com zero e tem DV válido** de propósito — é a armadilha do Excel
 * exibida no próprio modelo, e é literalmente o número do enunciado do problema (`01234567890` vira
 * `1234567890` em coluna numérica). Ele fecha no módulo 11, conferível à mão pela regra de
 * `utils/cpf.js`.
 *
 * ⚠ Ela encolheu junto com as colunas. O `TOMADOR EXEMPLO LTDA`, o e-mail e o endereço do Rio saíram
 * porque não há mais onde escrevê-los — e não porque a armadilha tenha deixado de existir.
 */
export const LINHA_DE_EXEMPLO = Object.freeze({
  documento: "01234567890",
  descricao: "Serviços de consultoria contábil prestados em julho",
  valor: "1500,00",
  competencia: "31/07/2026",
});

/**
 * As CINCO do endereço que a emissão exige juntas. `xCpl` fica de fora — é o único opcional.
 *
 * ⚠ TUDO-OU-NADA, e não por gosto: `buildDpsXml` recusa a emissão com `MISSING_TOMADOR_ADDRESS`
 * faltando qualquer um dos cinco. Meio endereço é PENDÊNCIA, nunca "quase pronta" — é
 * a mesma disciplina do `xLgr` do portal, onde a palavra "RUA" sozinha passava por logradouro
 * preenchido e o endereço inteiro entrava com "Rua" no lugar da rua.
 *
 * ⚠ Os rótulos são os que a pessoa lê na frase da pendência, e o do município deixou de dizer
 * "código IBGE": ela não digita código nenhum, ela escolhe o município.
 */
export const ENDERECO_EXIGIDO = Object.freeze([
  ["cMun", "o município"],
  ["cep", "o CEP"],
  ["xLgr", "o logradouro"],
  ["nro", "o número"],
  ["xBairro", "o bairro"],
]);

/** Todos os campos de endereço, inclusive o opcional. */
export const CAMPOS_ENDERECO = Object.freeze([...ENDERECO_EXIGIDO.map(([c]) => c), "xCpl"]);

export const COLUNAS_OBRIGATORIAS = Object.freeze(COLUNAS_LOTE.filter((c) => c.obrigatoria).map((c) => c.chave));

/** As chaves de célula que uma linha pode ter. É o que o ajuste aceita. */
export const CHAVES_DA_REVISAO = Object.freeze(CAMPOS_DA_REVISAO.map((c) => c.chave));

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
 * Aqui a coluna 1 confundida com a 2 emitiria a nota com a descrição no lugar do CNPJ. Cabeçalho que
 * não se reconhece é planilha recusada, com o nome do que não bateu.
 */
export function chaveDaColuna(celula) {
  return POR_TEXTO.get(normalizarCabecalho(celula)) ?? null;
}
