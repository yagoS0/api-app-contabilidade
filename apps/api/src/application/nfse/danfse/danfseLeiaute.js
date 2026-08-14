// LEIAUTE DO DANFSe — TRANSCRIÇÃO DA FONTE OFICIAL, NÃO DESENHO NOSSO.
//
// Fonte única: **NT SE/CGNFS-e nº 008, versão 1.02, de 14/07/2026** ("Especificações Técnicas do
// DANFSe"), versionada em `docs/leiaute-nfse/NT_008_SE_CGNFSe_DANFSe_v1.02_2026-07-14.pdf`
// (SHA-256 1265f403aedcdc5f08b3049dcc18a15c2bc155f51afccf3d12690fef2f4fb0ff), baixada de
// https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260714-v1-02.pdf
//
// Por que isto virou nosso: a própria NT (item 1) diz que ela "servirá de base para a geração do
// DANFSe por meios de softwares de emissão de NFS-e, ERPs e sistemas fiscais, **motivo pelo qual**
// a API de geração do DANFSe (adn.nfse.gov.br/danfse) será sobrestada (suspensa) na data de
// 03 de agosto de 2026".
//
// A regra que governa tudo (Res. CGNFS-e nº 3/2023, art. 13, repetida na NT §2.1):
//   "Não poderão ser impressas informações que não constem do arquivo da NFS-e."
//
// ⚠ NADA AQUI FOI DEDUZIDO POR ANALOGIA COM O DANFE DA NF-e. Cada linha da tabela `BLOCOS` é
// transcrição do item 2.4.5 da NT (coordenadas em centímetros, em relação à margem). O que a NT
// não diz, este módulo não afirma.

export const FONTE = Object.freeze({
  documento: "NT SE/CGNFS-e nº 008",
  versao: "1.02",
  data: "2026-07-14",
  url: "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260714-v1-02.pdf",
  arquivoNoRepo: "docs/leiaute-nfse/NT_008_SE_CGNFSe_DANFSe_v1.02_2026-07-14.pdf",
  sha256: "1265f403aedcdc5f08b3049dcc18a15c2bc155f51afccf3d12690fef2f4fb0ff",
  instituicao: "Res. CGNFS-e nº 3/2023, art. 13",
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2.2 Formulário · §2.2.1 a §2.2.3
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const FORMULARIO = Object.freeze({
  orientacao: "retrato",                 // §2.2.1
  paginaUnica: true,                     // §2.2 "obrigatoriamente, em uma única página"
  viaUnica: true,                        // §2 "em uma única via, salvo disposição expressa"
  papelMinimo: Object.freeze({ nome: "A4", larguraMm: 210, alturaMm: 297 }), // §2.2.1
  papelVedado: "papel jornal",           // §2 e §2.2
  margemMinimaCm: 0.15,                  // §2.2.2 (inclusive superior e inferior)
  margemMaximaCm: 0.2,                   // §2.2.2
  espessuraLinhaDivisoriaPt: 0.5,        // §2.2.3
  espessuraBordaPaginaPt: 1,             // §2.2.3
  densidadeSombreamento: 0.05,           // §2.2.3 — cinza claro, 5% de densidade
});

// §2.2.3 — os únicos elementos sombreados. Todo o resto fica em branco (0%).
export const SOMBREADOS = Object.freeze([
  "CABEÇALHO",
  "TITULOS_DE_BLOCO",
  "EMITENTE DA NFS-E",
  "VALOR LÍQUIDO DA NFS-e + IBS/CBS",
]);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2.4 Padrões de caracteres
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ "Arial para os títulos/labels e Microsoft Sans Serif para os conteúdos, em preto sólido (K100)
// e espaçamento normal" (§2.4). As duas são fontes de sistema e **não estão embutidas no projeto**
// — ver `TIPOGRAFIA.observacaoFontes`.
export const TIPOGRAFIA = Object.freeze({
  fonteTitulos: "Arial",                 // §2.4
  fonteConteudo: "Microsoft Sans Serif", // §2.4
  cor: "#000000",                        // K100

  tituloBlocoPt: 7,                      // §2.4.1 — negrito, CAIXA ALTA
  tituloCampoPt: 6,                      // §2.4.2 — negrito, Primeira Letra De Cada Palavra
  tituloCampoIdentificacaoPt: 7,         // §2.4.2 — exceção: labels do bloco 2.1.2, CAIXA ALTA
  conteudoPt: 7,                         // §2.4.3 e §2.4.4

  cabecalhoTituloPt: 9,                  // §2.4.3 — "DANFSe v2.0" e "Documento Auxiliar da NFS-e"
  cabecalhoMunicipioPt: 8,               // §2.4.3
  cabecalhoAmbientePt: 6,                // §2.4.3 — ambiente gerador e tipo de ambiente
  complementoQrCodePt: 6,                // §2.4.3

  semValidadeJuridicaPt: 9,              // §2.4.3 — negrito, Arial
  semValidadeJuridicaCor: "#FF0000",     // §2.4.3 — vermelho sólido (M100/Y100)

  marcaDaguaPtMinimo: 50,                // §2.5.1 / §2.5.2 — Arial, diagonal
  marcaDaguaCor: "#A6A6A6",              // K35

  // ⚠ NÃO SUBSTITUÍMOS AS FONTES POR "PARECIDAS" EM SILÊNCIO. pdfkit só traz as 14 fontes padrão
  // do PDF (Helvetica, Times, Courier). Arial e Microsoft Sans Serif têm de ser carregadas de
  // arquivo .ttf; sem elas o gerador usa Helvetica e **registra a substituição** em
  // `conformidade.avisos`, porque §2.4 nomeia as duas famílias.
  observacaoFontes:
    "Arial e Microsoft Sans Serif não estão embutidas no repositório. Sem os .ttf o render cai " +
    "em Helvetica e a não conformidade com a NT §2.4 é reportada, nunca silenciada.",
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2.4.3 — QR Code
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const QR_CODE = Object.freeze({
  // "indicando o endereço: https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=, adicionando,
  // após o sinal de igual (=), a Chave de Acesso da respectiva NFS-e"
  urlBase: "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=",
  ladoMinimoCm: 1.52,
  xCm: 17.48,
  yCm: 1.67,
  // "disposta em 3 (três) linhas, com tamanho de seis (6) pontos"
  textoComplementar:
    "A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta " +
    "da chave de acesso no portal nacional da NFS-e",
  linhasDoComplemento: 3,
});

/** §2.4.3 — monta o conteúdo do QR Code. É a chave crua, sem máscara. */
export function urlDeConsulta(chaveAcesso) {
  const digitos = String(chaveAcesso || "").replace(/\D+/g, "");
  if (!digitos) return null;
  return QR_CODE.urlBase + digitos;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2, §2.4.3, §2.5.1, §2.5.2 — textos fixos que a NT manda imprimir literalmente
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const TEXTOS = Object.freeze({
  tituloCabecalho: "DANFSe v2.0",
  subtituloCabecalho: "Documento Auxiliar da NFS-e",
  semValidadeJuridica: "NFS-e SEM VALIDADE JURÍDICA",   // §2 — obrigatório quando tpAmb = 2
  marcaDaguaCancelada: "CANCELADA",                     // §2.5.1
  marcaDaguaSubstituida: "SUBSTITUÍDA",                 // §2.5.2

  // §2.3 e notas 2/3/4 — as frases exatas dos blocos suprimidos.
  tomadorNaoIdentificado: "TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e",
  destinatarioNaoIdentificado: "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e",
  intermediarioNaoIdentificado: "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e",
  destinatarioEhOTomador: "O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO",
  semIssqn: "TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN",

  // Nota 10 — obrigatório, e a NT dá a forma exata.
  prefixoTotaisAproximados: "Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012:",
});

// Nota 12 do §2.4.5 — "Os campos sem informações no XML devem ser preenchidos com um traço (-)".
//
// ⚠ ISTO NÃO CONFLITA COM O ART. 13. O traço marca AUSÊNCIA; ele não afirma conteúdo. Suprimir a
// linha inteira só é permitido nos casos nomeados (notas 1 e 5, e as supressões do §2.3) — fora
// deles, campo vazio aparece com traço, e é assim que quem lê distingue "não foi informado" de
// "o sistema esqueceu de imprimir".
export const TRACO_DE_AUSENCIA = "-";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2.4.5, notas 1 a 12 — transcritas na íntegra porque são elas que autorizam suprimir linha
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const NOTAS = Object.freeze({
  1: "Esta linha poderá ser suprimida, ainda que existam dados dos respectivos campos no arquivo XML.",
  2: "Caso não sejam informados dados de tomador/adquirente, destinatário e/ou intermediário da operação, informar, nos respectivos blocos, apenas a frase de não identificação. A altura mínima do bloco é de 0,32cm e a largura mínima é de 20,40cm.",
  3: "Caso o destinatário da operação seja o próprio tomador/adquirente, informar, no bloco do destinatário, apenas: “O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO”. Altura mínima 0,32cm, largura mínima 20,40cm.",
  4: "Para as operações às quais não haja a incidência do ISSQN, informar, no bloco “Tributação Municipal (ISSQN)”, apenas: “TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN”. Altura mínima 0,32cm, largura mínima 20,40cm.",
  5: "Esta linha poderá ser suprimida caso não existam dados em todos os campos da mesma linha no arquivo XML.",
  6: "Esta linha será impressa para as NFS-e emitidas com data de competência até o final do ano-calendário de 2026.",
  7: "Em caso de substituição da NFS-e, informar em informações complementares a chave da NFS-e substituída (campo chSubstda), na forma: “NFS-e Subst.: ” + chave.",
  8: "Nos casos de obrigatoriedade do grupo Obra/Imóvel, informar em informações complementares “Cod. Obra: ” e “Insc. Imob.: ” (campos cObra e inscImobFisc).",
  9: "Nos casos de obrigatoriedade do grupo Evento, informar em informações complementares “Cod. Evt.: ” (campo idAtvEvt).",
  10: "Deve-se constar, obrigatoriamente, a informação de totais aproximados de tributos, em valores monetários OU percentuais, na forma: \"Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: R$ ou % ; Estaduais: R$ ou % ; Municipais: R$ ou %\".",
  11: "Bloco opcional.",
  12: "Os campos sem informações no XML devem ser preenchidos com um traço (-).",
});

// §2.4.5 — ordem e rótulos das informações complementares, com os separadores que a NT exige.
// "As informações devem ser separadas por pipes ( | )."
export const ORDEM_INFO_COMPLEMENTARES = Object.freeze([
  { rotulo: "Inf. Cont.:", tag: "xInfComp" },
  { rotulo: "NFS-e Subst.:", tag: "chSubstda", nota: 7 },
  { rotulo: "Doc. Ref.:", tag: "docRef" },
  { rotulo: "Cod. Obra:", tag: "cObra", nota: 8 },
  { rotulo: "Insc. Imob.:", tag: "inscImobFisc", nota: 8 },
  { rotulo: "Cod. Evt.:", tag: "idAtvEvt", nota: 9 },
  { rotulo: "Doc. Tec.:", tag: "idDocTec" },
  { rotulo: "Núm. Ped.:", tag: "xPed" },
  { rotulo: "Item Ped.:", tag: "xItemPed" },
  { rotulo: "Inf. A. T. Mun.:", tag: "xOutInf" },
]);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2.4.5 — TABELA DE CAMPOS. Medidas em CENTÍMETROS, posição em relação à margem.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Colunas da NT, preservadas: `alt`/`larg` = tamanhos mínimos; `esq`/`sup` = posição com relação à
// margem; `max` = quantidade de caracteres sugerida ("Tam. do Campo"). Onde a NT escreve `1-15V2`
// (valor com até 15 inteiros e 2 decimais) guardamos a string literal, sem traduzir.
//
// ⚠ `alt`, `larg` e `max` são SUGESTÃO (§2.1: "não são obrigatórios"). O que é obrigatório é a
// DISPOSIÇÃO dos campos conforme o Anexo I (§2.2.4) e os tamanhos mínimos de fonte (§2.4). Por isso
// as posições são seguidas à risca e as alturas servem de piso, não de teto.
//
// `caminho` é o caminho no XML tal como a NT o escreve. `NFSe/infNFSe/DPS/infDPS` é abreviado como
// `DPS` no leitor (`danfseDados.js`), nunca aqui.
export const BLOCOS = Object.freeze([
  {
    id: "cabecalho",
    titulo: "CABEÇALHO",
    alt: 1.16, larg: 20.4, esq: 0.3, sup: 0.3,
    sombreado: true,
    campos: [
      { id: "logomarca", nome: "LOGOMARCA DA NFSe", alt: 0.85, larg: 4.0, esq: 0.49, sup: 0.44,
        obs: "Logomarca oficial em https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/logos-da-nfs-e/ (§2.4.3). Não versionada no repo." },
      { id: "quadroDescricao", nome: 'QUADRO DA DESCRIÇÃO "DANFSe..."', alt: 1.16, larg: 10.19, esq: 5.41, sup: 0.3,
        obs: "Centralizar o texto no quadro." },
      { id: "quadroIdentMunicipio", nome: "QUADRO DA IDENT. MUNICÍPIO/AMBIENTE", alt: 1.16, larg: 5.09, esq: 15.62, sup: 0.3 },
      { id: "municipio", nome: "MUNICÍPIO",
        caminho: "NFSe/infNFSe/ + NFSe/infNFSe/emit/enderNac/", tag: "xLocEmi + UF",
        alt: 0.64, larg: 5.09, esq: 15.62, sup: 0.3, max: 37,
        obs: 'Concatenar os dois campos. Informar "Município:  CCCC / CC". Não exibir quando o item do cód. de tributação nacional informado for 99.' },
      { id: "ambGer", nome: "AMBIENTE GERADOR", caminho: "NFSe/infNFSe/", tag: "ambGer",
        alt: 0.24, larg: 5.09, esq: 15.62, sup: 0.97, max: 1 },
      { id: "tpAmb", nome: "TIPO DE AMBIENTE", caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "tpAmb",
        alt: 0.24, larg: 5.09, esq: 15.62, sup: 1.22, max: 1 },
    ],
  },

  {
    // §2.1.2 — ⚠ os labels DESTE bloco são 7 pt e CAIXA ALTA (§2.4.2), diferente de todos os outros.
    id: "identificacao",
    titulo: "DADOS DA NFS-e",
    alt: 2.84, larg: 20.4, esq: 0.3, sup: 1.48,
    labelsEmCaixaAlta7pt: true,
    campos: [
      { id: "chaveAcesso", nome: "CHAVE DE ACESSO DA NFS-E", caminho: "NFSe/infNFSe/", tag: "id",
        alt: 0.77, larg: 15.3, esq: 0.3, sup: 1.48, max: 50,
        obs: 'Informar o id da NFS-e sem o prefixo "NFS". §2.1.1: impressa em único bloco contendo 50 dígitos.' },
      { id: "nNFSe", nome: "NÚMERO DA NFS-e", caminho: "NFSe/infNFSe/", tag: "nNFSe",
        alt: 0.67, larg: 5.09, esq: 0.3, sup: 2.27, max: 13 },
      { id: "dCompet", nome: "COMPETÊNCIA DA NFS-e", caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "dCompet",
        alt: 0.67, larg: 5.09, esq: 5.41, sup: 2.27, max: 10, formato: "DD/MM/AAAA" },
      { id: "dhProc", nome: "DATA E HORA DA EMISSÃO DA NFS-E", caminho: "NFSe/infNFSe/", tag: "dhProc",
        alt: 0.67, larg: 5.09, esq: 10.51, sup: 2.27, max: 19, formato: "DD/MM/AAAA hh:mm:ss" },
      { id: "nDPS", nome: "NÚMERO DA DPS", caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "nDPS",
        alt: 0.67, larg: 5.09, esq: 0.3, sup: 2.96, max: 15 },
      { id: "serie", nome: "SÉRIE DA DPS", caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "serie",
        alt: 0.67, larg: 5.09, esq: 5.41, sup: 2.96, max: 5 },
      { id: "dhEmi", nome: "DATA E HORA DA EMISSÃO DA DPS", caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "dhEmi",
        alt: 0.67, larg: 5.09, esq: 10.51, sup: 2.96, max: 19, formato: "DD/MM/AAAA hh:mm:ss" },
      { id: "tpEmit", nome: "EMITENTE DA NFS-E", caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "tpEmit",
        alt: 0.67, larg: 5.09, esq: 0.3, sup: 3.65, max: 13, sombreado: true,
        codificado: true, obs: "Leiaute prevê 3 opções (1 a 3). Utilizar a descrição destas opções. Ex.: Prestador." },
      { id: "cStat", nome: "SITUAÇÃO DA NFS-E", caminho: "NFSe/infNFSe/", tag: "cStat",
        alt: 0.67, larg: 5.09, esq: 5.41, sup: 3.65, max: 40,
        codificado: true, obs: "Utilizar a descrição das opções previstas no leiaute. Reticências acima de 37 caracteres." },
      { id: "finNFSe", nome: "FINALIDADE", caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/", tag: "finNFSe",
        alt: 0.67, larg: 5.09, esq: 10.51, sup: 3.65, max: 40,
        codificado: true, obs: "Utilizar a descrição das opções previstas no leiaute. Ex.: NFS-e regular." },
      { id: "quadroQrCode", nome: "QUADRO DO QR CODE", alt: 1.52, larg: 1.52, esq: 17.48, sup: 1.67 },
      { id: "quadroComplementoQrCode", nome: "QUADRO COMPLEMENTO QR CODE", alt: 0.68, larg: 4.72, esq: 15.8, sup: 3.36 },
    ],
  },

  {
    id: "prestador",
    titulo: "PRESTADOR / FORNECEDOR",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 4.34,
    campos: [
      { id: "prestDoc", nome: "CNPJ / CPF / NIF", caminho: "NFSe/infNFSe/DPS/infDPS/prest/", tag: "CNPJ / CPF / NIF",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 4.34, max: "18 / 14 / 40",
        formato: "nn.nnn.nnn/nnnn-nn / nnn.nnn.nnn-nn / nnn" },
      { id: "prestIM", nome: "INDICADOR MUNICIPAL (INSCRIÇÃO)", caminho: "NFSe/infNFSe/DPS/infDPS/prest/", tag: "IM",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 4.34, max: 15 },
      { id: "prestFone", nome: "TELEFONE", caminho: "NFSe/infNFSe/DPS/infDPS/prest/", tag: "fone",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 4.34, max: 20 },
      { id: "prestNome", nome: "NOME / NOME EMPRESARIAL", caminho: "NFSe/infNFSe/DPS/infDPS/prest/", tag: "xNome",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 4.98, max: 80, truncaEm: 77 },
      { id: "prestMunicipio", nome: "MUNICÍPIO / SIGLA UF",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/end/endNac/ ou .../endExt/", tag: "cMun ou xCidade",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 4.98, max: 37, exigeTabelaIbge: true,
        obs: "Leiaute prevê o código do município com 7 dígitos da Tabela do IBGE. Utilizar a descrição destes códigos, concatenada com a UF." },
      { id: "prestIbgeCep", nome: "CÓDIGO IBGE / CEP",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/end/endNac/ ou .../endExt/", tag: "cMun + CEP ou cEndPost",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 4.98, max: 21 },
      { id: "prestEndereco", nome: "ENDEREÇO", caminho: "NFSe/infNFSe/DPS/infDPS/prest/end/", tag: "xLgr, nro, xCpl, xBairro",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 5.62, max: 80, truncaEm: 77, nota: 1 },
      { id: "prestEmail", nome: "EMAIL", caminho: "NFSe/infNFSe/DPS/infDPS/prest/", tag: "email",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 5.62, max: 80, nota: 1 },
      { id: "opSimpNac", nome: "SIMPLES NACIONAL NA DATA DE COMPETÊNCIA",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/regTrib/", tag: "opSimpNac",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 6.28, max: 40, codificado: true,
        obs: "Leiaute prevê 3 opções (1 a 3). Utilizar a descrição destas opções. Ex.: Não Optante." },
      { id: "regApTribSN", nome: "REGIME DE APURAÇÃO TRIBUTÁRIA PELO SN",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/regTrib/", tag: "regApTribSN",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 6.28, max: 80, codificado: true,
        obs: "Leiaute prevê 3 opções (1 a 3). Utilizar a descrição destas opções." },
    ],
  },

  {
    id: "tomador",
    titulo: "TOMADOR / ADQUIRENTE",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 6.92, nota: 2,
    supressao: { frase: "tomadorNaoIdentificado", altMinima: 0.32, largMinima: 20.4 },
    campos: [
      { id: "tomaDoc", nome: "CNPJ / CPF / NIF", caminho: "NFSe/infNFSe/DPS/infDPS/toma/", tag: "CNPJ / CPF / NIF",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 6.92, max: "18 / 14 / 40",
        formato: "nn.nnn.nnn/nnnn-nn / nnn.nnn.nnn-nn / nnn" },
      { id: "tomaIM", nome: "INDICADOR MUNICIPAL (INSCRIÇÃO)", caminho: "NFSe/infNFSe/DPS/infDPS/toma/", tag: "IM",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 6.92, max: 15 },
      { id: "tomaFone", nome: "TELEFONE", caminho: "NFSe/infNFSe/DPS/infDPS/toma/", tag: "fone",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 6.92, max: 20 },
      { id: "tomaNome", nome: "NOME / NOME EMPRESARIAL", caminho: "NFSe/infNFSe/DPS/infDPS/toma/", tag: "xNome",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 7.56, max: 80, truncaEm: 77 },
      { id: "tomaMunicipio", nome: "MUNICÍPIO / SIGLA UF",
        caminho: "NFSe/infNFSe/DPS/infDPS/toma/end/endNac/ ou .../endExt/", tag: "cMun ou xCidade",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 7.56, max: 37, exigeTabelaIbge: true },
      { id: "tomaIbgeCep", nome: "CÓDIGO IBGE / CEP",
        caminho: "NFSe/infNFSe/DPS/infDPS/toma/end/endNac/ ou .../endExt/", tag: "cMun + CEP ou cEndPost",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 7.56, max: 21 },
      { id: "tomaEndereco", nome: "ENDEREÇO", caminho: "NFSe/infNFSe/DPS/infDPS/toma/end/", tag: "xLgr, nro, xCpl, xBairro",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 8.22, max: 80, truncaEm: 77, nota: 1 },
      { id: "tomaEmail", nome: "E-MAIL", caminho: "NFSe/infNFSe/DPS/infDPS/toma/", tag: "email",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 8.22, max: 80, nota: 1 },
    ],
  },

  {
    id: "destinatario",
    titulo: "DESTINATÁRIO DA OPERAÇÃO",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 8.86, nota: "2 e 3",
    supressao: { frase: "destinatarioNaoIdentificado", altMinima: 0.32, largMinima: 20.4 },
    supressaoQuandoIgualAoTomador: { frase: "destinatarioEhOTomador", altMinima: 0.32, largMinima: 20.4 },
    campos: [
      { id: "destDoc", nome: "CNPJ / CPF / NIF", caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/", tag: "CNPJ / CPF / NIF",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 8.86, max: "18 / 14 / 40" },
      { id: "destFone", nome: "TELEFONE", caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/", tag: "fone",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 8.86, max: 20 },
      { id: "destNome", nome: "NOME / NOME EMPRESARIAL", caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/", tag: "xNome",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 9.5, max: 80, truncaEm: 77 },
      { id: "destMunicipio", nome: "MUNICÍPIO / SIGLA UF",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/end/endNac/ ou .../endExt/", tag: "cMun ou xCidade",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 9.5, max: 37, exigeTabelaIbge: true },
      { id: "destIbgeCep", nome: "CÓDIGO IBGE / CEP",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/end/endNac/ ou .../endExt/", tag: "cMun + CEP ou cEndPost",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 9.5, max: 21 },
      { id: "destEndereco", nome: "ENDEREÇO", caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/end/", tag: "xLgr, nro, xCpl, xBairro",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 10.16, max: 80, truncaEm: 77, nota: 1 },
      { id: "destEmail", nome: "E-MAIL", caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/", tag: "email",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 10.16, max: 80, nota: 1 },
    ],
  },

  {
    id: "intermediario",
    titulo: "INTERMEDIÁRIO DA OPERAÇÃO",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 10.8, nota: 2,
    supressao: { frase: "intermediarioNaoIdentificado", altMinima: 0.32, largMinima: 20.4 },
    campos: [
      { id: "intermDoc", nome: "CNPJ / CPF / NIF", caminho: "NFSe/infNFSe/DPS/infDPS/interm/", tag: "CNPJ / CPF / NIF",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 10.8, max: "18 / 14 / 40" },
      { id: "intermIM", nome: "INDICADOR MUNICIPAL (INSCRIÇÃO)", caminho: "NFSe/infNFSe/DPS/infDPS/interm/", tag: "IM",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 10.8, max: 15 },
      { id: "intermFone", nome: "TELEFONE", caminho: "NFSe/infNFSe/DPS/infDPS/interm/", tag: "fone",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 10.8, max: 20 },
      { id: "intermNome", nome: "NOME / NOME EMPRESARIAL", caminho: "NFSe/infNFSe/DPS/infDPS/interm/", tag: "xNome",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 11.44, max: 80, truncaEm: 77 },
      { id: "intermMunicipio", nome: "MUNICÍPIO / SIGLA UF",
        caminho: "NFSe/infNFSe/DPS/infDPS/interm/end/endNac/ ou .../endExt/", tag: "cMun ou xCidade",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 11.44, max: 37, exigeTabelaIbge: true },
      { id: "intermIbgeCep", nome: "CÓDIGO IBGE / CEP",
        caminho: "NFSe/infNFSe/DPS/infDPS/interm/end/endNac/ ou .../endExt/", tag: "cMun + CEP ou cEndPost",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 11.44, max: 21 },
      { id: "intermEndereco", nome: "ENDEREÇO", caminho: "NFSe/infNFSe/DPS/infDPS/interm/end/", tag: "xLgr, nro, xCpl, xBairro",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 12.09, max: 80, truncaEm: 77, nota: 1 },
      { id: "intermEmail", nome: "E-MAIL", caminho: "NFSe/infNFSe/DPS/infDPS/interm/", tag: "email",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 12.09, max: 80, nota: 1 },
    ],
  },

  {
    id: "servico",
    titulo: "SERVIÇO PRESTADO",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 12.74,
    campos: [
      { id: "cTrib", nome: "CÓDIGO DE TRIBUTAÇÃO NACIONAL / MUNICIPAL",
        caminho: "NFSe/infNFSe/DPS/infDPS/serv/cServ/ + NFSe/infNFSe/", tag: "cTribNac + cTribMun",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 12.74, max: 14, formato: "nn.nn.nn / nnn" },
      { id: "cNBS", nome: "CÓDIGO DA NBS", caminho: "NFSe/infNFSe/DPS/infDPS/serv/cServ/", tag: "cNBS",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 12.74, max: 9, formato: "n.nnnn.nn.nn" },
      { id: "locPrest", nome: "LOCAL DA PRESTAÇÃO / SIGLA UF / PAÍS",
        caminho: "NFSe/infNFSe/ + NFSe/infNFSe/DPS/infDPS/serv/locPrest/", tag: "xLocPrestacao + cPaisPrestacao",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 12.74, max: 42,
        obs: "Concatenar município, UF e País. País com código de 2 dígitos da Tabela ISO. Ex.: BR" },
      { id: "xTrib", nome: "DESCRIÇÃO DO CÓDIGO DE TRIBUTAÇÃO NACIONAL / MUNICIPAL",
        caminho: "NFSe/infNFSe/DPS/infDPS/serv/cServ/ + NFSe/infNFSe/", tag: "xTribNac + xTribMun",
        alt: 0.38, larg: 20.4, esq: 0.3, sup: 13.39, max: 170, truncaEm: 167, semLabel: true,
        obs: 'SE xTribMun <> "" ENTAO Descrição Municipal SENAO Descrição Nacional. Não há título (label) deste campo no DANFSe.' },
      { id: "xDescServ", nome: "DESCRIÇÃO DO SERVIÇO", caminho: "NFSe/infNFSe/DPS/infDPS/serv/cServ/", tag: "xDescServ",
        alt: 0.63, larg: 20.4, esq: 0.3, sup: 13.79, max: 1300, truncaEm: 1297, elastico: true },
    ],
  },

  {
    id: "issqn",
    titulo: "TRIBUTAÇÃO MUNICIPAL (ISSQN)",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 14.43, nota: 4,
    supressao: { frase: "semIssqn", altMinima: 0.32, largMinima: 20.4 },
    campos: [
      { id: "tribISSQN", nome: "TIPO DE TRIBUTAÇÃO DO ISSQN", caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/", tag: "tribISSQN",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 14.43, max: 21, codificado: true,
        obs: "Leiaute prevê 4 opções (1 a 4). Ex.: Operação Tributável." },
      { id: "locIncid", nome: "MUNICÍPIO / SIGLA UF / PAÍS DA INCIDÊNCIA DO ISSQN",
        caminho: "NFSe/infNFSe/ + NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/", tag: "xLocIncid + cPaisResult",
        alt: 0.63, larg: 10.19, esq: 5.41, sup: 14.43, max: 42 },
      { id: "regEspTrib", nome: "REGIME ESPECIAL DE TRIBUTAÇÃO DO ISSQN", caminho: "NFSe/infNFSe/DPS/infDPS/prest/regTrib/", tag: "regEspTrib",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 15.08, max: 27, codificado: true, nota: 5,
        obs: "Leiaute prevê 8 opções (0 a 6 e 9). Ex.: Estimativa." },
      { id: "tpImunidade", nome: "TIPO DE IMUNIDADE DO ISSQN", caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/", tag: "tpImunidade",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 15.08, max: 40, codificado: true, nota: 5,
        obs: "Leiaute prevê 5 opções (1 a 5)." },
      { id: "tpSusp", nome: "SUSPENSÃO DA EXIGIBILIDADE DO ISSQN", caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/exigSusp/", tag: "tpSusp",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 15.08, max: 40, codificado: true, nota: 5,
        obs: "Descrições dadas pela NT: “Exigibilidade Suspensa por Decisão Judicial”; “Exigibilidade Suspensa por Processo Administrativo” — a NT não diz a qual número cada uma corresponde." },
      { id: "nProcesso", nome: "NÚMERO PROCESSO SUSPENSÃO", caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/exigSusp/", tag: "nProcesso",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 15.08, max: 30, nota: 5 },
      { id: "tpBM", nome: "BENEFÍCIO MUNICIPAL", caminho: "NFSe/infNFSe/valores/", tag: "tpBM",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 15.73, max: 40, codificado: true, nota: 5,
        obs: "Leiaute prevê 4 opções (1 e 4). Ex.: Isenção." },
      { id: "vCalcBM", nome: "CÁLCULO DO BM",
        caminho: "NFSe/infNFSe/valores/ ou NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/BM/", tag: "vCalcBM ou vRedBCBM",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 15.73, max: "1-15V2", nota: 5 },
      { id: "vDedRed", nome: "TOTAL DEDUÇÕES/REDUÇÕES",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/vDedRed/ ou NFSe/infNFSe/valores/ + NFSe/infNFSe/IBSCBS/valores/",
        tag: "vDR ou vCalcDR + vCalcReeRepRes",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 15.73, max: "1-15V2", nota: 5 },
      { id: "vDescIncondIssqn", nome: "DESCONTO INCONDICIONADO", caminho: "NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/", tag: "vDescIncond",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 15.73, max: "1-15V2", nota: 5 },
      { id: "vBC", nome: "BC ISSQN", caminho: "NFSe/infNFSe/valores/", tag: "vBC",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 16.37, max: "1-15V2" },
      { id: "pAliqAplic", nome: "ALÍQUOTA APLICADA", caminho: "NFSe/infNFSe/valores/", tag: "pAliqAplic",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 16.37, max: "1-2V2" },
      { id: "tpRetISSQN", nome: "RETENÇÃO DO ISSQN", caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/", tag: "tpRetISSQN",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 16.37, max: 25, codificado: true,
        obs: "Leiaute prevê 3 opções (1 a 3). Ex.: Não Retido." },
      { id: "vISSQN", nome: "ISSQN APURADO", caminho: "NFSe/infNFSe/valores/", tag: "vISSQN",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 16.37, max: "1-2V2" },
    ],
  },

  {
    id: "tribFederal",
    titulo: "TRIBUTAÇÃO FEDERAL (EXCETO CBS)",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 17.02,
    campos: [
      { id: "vRetIRRF", nome: "IRRF", caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/", tag: "vRetIRRF",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 17.02, max: "1-15V2" },
      { id: "vRetCP", nome: "CONTRIBUIÇÃO PREVIDENCIÁRIA - RETIDA", caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/", tag: "vRetCP",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 17.02, max: "1-15V2" },
      { id: "contribSociaisRetidas", nome: "CONTRIBUIÇÕES SOCIAIS - RETIDAS",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/ (+ .../piscofins/)", tag: "vRetCSLL ou vRetCSLL + vPis + vCofins",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 17.02, max: "1-15V2",
        // ⚠ v1.02 mudou exatamente isto (ver histórico de versões da NT).
        obs: "Quando tpRetPisCofins = 1 (PIS/COFINS Retido), este campo retorna o somatório de vRetCSLL, vPis e vCofins. Nos demais casos, retorna vRetCSLL." },
      { id: "vPis", nome: "PIS - DÉBITO APURAÇÃO PRÓPRIA", caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/", tag: "vPis",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 17.67, max: "1-15V2", nota: 6,
        obs: "Quando tpRetPisCofins = 1, este campo retorna 0,00 (zero). Nos demais casos, retorna vPis." },
      { id: "vCofins", nome: "COFINS - DÉBITO APURAÇÃO PRÓPRIA", caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/", tag: "vCofins",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 17.67, max: "1-15V2", nota: 6,
        obs: "Quando tpRetPisCofins = 1, este campo retorna 0,00 (zero). Nos demais casos, retorna vCofins." },
      { id: "tpRetPisCofins", nome: "DESCRIÇÃO CONTRIB. SOCIAIS - RETIDAS", caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/", tag: "tpRetPisCofins",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 17.67, max: 35, codificado: true, nota: 6,
        obs: "Leiaute prevê 10 opções (1 a 9). Ex.: PIS/COFINS/CSLL Não Retido." },
    ],
  },

  {
    id: "ibsCbs",
    titulo: "TRIBUTAÇÃO IBS / CBS",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 18.32,
    campos: [
      { id: "cstCClassTrib", nome: "CST / CCLASSTRIB", caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/valores/trib/gIBSCBS/", tag: "CST + cClassTrib",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 18.32, max: 12, formato: "nnn / nnnnnn" },
      { id: "indOpIncid", nome: "INDICADOR DE OPERAÇÃO / CÓDIGO IBGE INCIDÊNCIA / MUNICÍPIO INCIDÊNCIA / SIGLA UF",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/ + NFSe/infNFSe/IBSCBS/", tag: "cIndOp + cLocalidadeIncid + xLocalidadeIncid",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 18.32, max: 56, formato: "nnnnnn / nnnnnnn / ccc / CC" },
      { id: "exclusoesReducoesBc", nome: "EXCLUSÕES E REDUÇÕES DA BASE DE CÁLCULO",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/ + NFSe/infNFSe/IBSCBS/valores/ + NFSe/infNFSe/valores/ + .../piscofins/",
        tag: "vDescIncond + vCalcReeRepRes + vISSQN + vPIS + vCOFINS",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 18.96, max: "1-15V2", obs: "Somatório de todos estes campos." },
      { id: "bcAposExclusoes", nome: "BASE DE CÁLCULO APÓS EXCLUSÕES E REDUÇÕES", caminho: "NFSe/infNFSe/IBSCBS/valores/", tag: "vBC",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 18.96, max: "1-15V2" },
      { id: "redAliq", nome: "RED. ALÍQUOTA IBS / RED. ALÍQUOTA CBS",
        caminho: "NFSe/infNFSe/IBSCBS/valores/uf/ + .../mun/ + .../fed/", tag: "pRedAliqUF + pRedAliqMun + pRedAliqCBS",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 18.96, max: "1-2V2 / 1-2V2 / 1-2V2", formato: "% / % / %" },
      { id: "aliqIbs", nome: "ALÍQUOTA - IBS UF / IBS MUN", caminho: "NFSe/infNFSe/IBSCBS/valores/uf/ + .../mun/", tag: "pIBSUF + pIBSMun",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 18.96, max: "1-2V2 / 1-2V2", formato: "% / %" },
      { id: "pAliqEfetMun", nome: "ALÍQ. EFETIVA MUNICIPAL - IBS", caminho: "NFSe/infNFSe/IBSCBS/valores/mun/", tag: "pAliqEfetMun",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 19.61, max: "1-2V2" },
      { id: "vIBSMun", nome: "VALOR APURADO MUNICIPAL - IBS", caminho: "NFSe/infNFSe/IBSCBS/totCIBS/gIBS/gIBSMunTot/", tag: "vIBSMun",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 19.61, max: "1-15V2" },
      { id: "pAliqEfetUF", nome: "ALÍQ. EFETIVA ESTADUAL - IBS", caminho: "NFSe/infNFSe/IBSCBS/valores/uf/", tag: "pAliqEfetUF",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 19.61, max: "1-2V2" },
      { id: "vIBSUF", nome: "VALOR APURADO ESTADUAL - IBS", caminho: "NFSe/infNFSe/IBSCBS/totCIBS/gIBS/gIBSUFTot/", tag: "vIBSUF",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 19.61, max: "1-15V2" },
      { id: "vIBSTot", nome: "VALOR TOTAL APURADO - IBS", caminho: "NFSe/infNFSe/IBSCBS/totCIBS/gIBS/", tag: "vIBSTot",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 20.26, max: "1-15V2" },
      { id: "pCBS", nome: "ALÍQUOTA - CBS", caminho: "NFSe/infNFSe/IBSCBS/valores/fed/", tag: "pCBS",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 20.26, max: "1-2V2" },
      { id: "pAliqEfetCBS", nome: "ALÍQUOTA EFETIVA - CBS", caminho: "NFSe/infNFSe/IBSCBS/valores/fed/", tag: "pAliqEfetCBS",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 20.26, max: "1-2V2" },
      { id: "vCBS", nome: "VALOR TOTAL APURADO - CBS", caminho: "NFSe/infNFSe/IBSCBS/totCIBS/gCBS/", tag: "vCBS",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 20.26, max: "1-15V2" },
    ],
  },

  {
    id: "valorTotal",
    titulo: "VALOR TOTAL DA NFS-E",
    alt: 0.67, larg: 5.09, esq: 0.3, sup: 20.9,
    campos: [
      { id: "vServ", nome: "VALOR DA OPERAÇÃO / SERVIÇO", caminho: "NFSe/infNFSe/DPS/infDPS/valores/vServPrest/", tag: "vServ",
        alt: 0.67, larg: 5.09, esq: 5.41, sup: 20.9, max: "1-15V2" },
      { id: "vDescIncond", nome: "DESCONTO INCONDICIONADO", caminho: "NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/", tag: "vDescIncond",
        alt: 0.67, larg: 5.09, esq: 10.51, sup: 20.9, max: "1-15V2" },
      { id: "vDescCond", nome: "DESCONTO CONDICIONADO", caminho: "NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/", tag: "vDescCond",
        alt: 0.67, larg: 5.09, esq: 15.62, sup: 20.9, max: "1-15V2" },
      { id: "vTotalRet", nome: "TOTAL DAS RETENÇÕES (ISSQN / FEDERAIS)", caminho: "NFSe/infNFSe/valores/", tag: "vTotalRet",
        alt: 0.67, larg: 5.09, esq: 0.3, sup: 21.59, max: "1-15V2" },
      { id: "vLiq", nome: "VALOR LÍQUIDO DA NFS-e", caminho: "NFSe/infNFSe/valores/", tag: "vLiq",
        alt: 0.67, larg: 5.09, esq: 5.41, sup: 21.59, max: "1-15V2" },
      { id: "totalIbsCbs", nome: "TOTAL DO IBS/CBS", caminho: "NFSe/infNFSe/IBSCBS/totCIBS/gIBS/ + .../gCBS/", tag: "vIBSTot + vCBS",
        alt: 0.67, larg: 5.09, esq: 10.51, sup: 21.59, max: "1-15V2" },
      { id: "vTotNF", nome: "VALOR LÍQUIDO DA NFS-e + IBS/CBS", caminho: "NFSe/infNFSe/IBSCBS/totCIBS/", tag: "vTotNF",
        alt: 0.67, larg: 5.09, esq: 15.62, sup: 21.59, max: "1-15V2", sombreado: true },
    ],
  },

  {
    // ⚠ ESTE É O BLOCO ELÁSTICO. Ele começa em 22,68 e o canhoto só em 28,10 — a folga de ~5 cm é
    // dele, e é para cá que o §2.3 manda transferir a altura de qualquer bloco suprimido, e o
    // §2.5.3 manda tirar altura quando a impressora exigir margem maior.
    id: "infoComplementares",
    titulo: "INFORMAÇÕES COMPLEMENTARES",
    alt: 0.39, larg: 20.4, esq: 0.3, sup: 22.27,
    campos: [
      { id: "infoComplementares", nome: "INFORMAÇÕES COMPLEMENTARES",
        caminho: "união dos grupos infoCompl, subst, obra, imovel, atvEvento, gItemPed e totTrib",
        tag: "xInfComp + chSubstda + docRef + cObra + inscImobFisc + idAtvEvt + idDocTec + xPed + xItemPed + xOutInf + totais aproximados",
        alt: 0.39, larg: 20.4, esq: 0.3, sup: 22.68, max: 2000, truncaEm: 1997, elastico: true, semLabel: true,
        obs: 'Separar por pipes ( | ). Obrigatoriamente deve constar a linha de Totais Aproximados dos Tributos (nota 10), que é FIXA e não entra no truncamento.' },
    ],
  },

  {
    id: "canhoto",
    titulo: "CANHOTO",
    alt: 0.67, larg: 20.4, esq: 0.3, sup: 28.1, nota: 11, opcional: true,
    campos: [
      { id: "dataCientificacao", nome: "DATA CIENTIFICAÇÃO", alt: 0.67, larg: 5.09, esq: 0.3, sup: 28.1,
        semFonteNoXml: true, obs: "Campo para preenchimento manual — não vem do XML." },
      { id: "identificacaoAssinatura", nome: "IDENTIFICAÇÃO E ASSINATURA", alt: 0.67, larg: 5.09, esq: 5.41, sup: 28.1,
        semFonteNoXml: true, obs: "Campo para preenchimento manual — não vem do XML." },
      { id: "canhotoNumeroChave", nome: "Nº NFS-E / CHAVE NFS-E", caminho: "NFSe/infNFSe/", tag: "nNFSe + id",
        alt: 0.67, larg: 10.19, esq: 10.51, sup: 28.1, max: 66,
        obs: 'Informar o id da NFS-e sem o prefixo "NFS". Ex.: nnn / nnn' },
    ],
  },
]);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ O DANFSe É v2.0 (MULTITRIBUTÁRIO) E O NOSSO XML É 1.01
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// A NT foi escrita para o leiaute da reforma tributária: um bloco inteiro (TRIBUTAÇÃO IBS / CBS),
// mais `finNFSe`, o bloco DESTINATÁRIO e três campos de total saem dos grupos `IBSCBS`, que **não
// existem no leiaute 1.01** — nem na amostra versionada em
// `docs/leiaute-nfse/nfse-nacional-substituicao.xml`, nem nas notas que a captura do ADN traz hoje.
//
// Isto NÃO é defeito do gerador nem licença para preencher por conta própria: pela nota 12 esses
// campos saem com traço, e o gerador os devolve nomeados em `conformidade.camposSemFonte` para que
// a ausência seja visível em vez de parecer bug. Quando o XML de origem passar a trazer `IBSCBS`,
// nada aqui muda — os caminhos já estão escritos.
export const CAMPOS_SEM_FONTE_NO_LEIAUTE_1_01 = Object.freeze([
  "finNFSe",
  "destDoc", "destFone", "destNome", "destMunicipio", "destIbgeCep", "destEndereco", "destEmail",
  "cstCClassTrib", "indOpIncid", "exclusoesReducoesBc", "bcAposExclusoes", "redAliq", "aliqIbs",
  "pAliqEfetMun", "vIBSMun", "pAliqEfetUF", "vIBSUF", "vIBSTot", "pCBS", "pAliqEfetCBS", "vCBS",
  "totalIbsCbs", "vTotNF",
]);

/** Índice campo→bloco, para o leitor e os testes não reimplementarem a varredura. */
export function todosOsCampos() {
  return BLOCOS.flatMap((bloco) =>
    bloco.campos.map((campo) => ({ ...campo, blocoId: bloco.id, blocoTitulo: bloco.titulo }))
  );
}

export function campoPorId(id) {
  return todosOsCampos().find((c) => c.id === id) || null;
}

/** §2.1 — truncamento com reticências. É ISTO que a NT manda fazer quando o texto não cabe. */
export function truncarComReticencias(texto, limite) {
  const s = String(texto ?? "");
  if (!limite || s.length <= limite) return s;
  return s.slice(0, limite) + "...";
}

const CM_POR_POLEGADA = 2.54;
const PONTOS_POR_POLEGADA = 72;

/** Converte centímetro (unidade da NT) em ponto PostScript (unidade do pdfkit). */
export function cm(valor) {
  return (Number(valor) / CM_POR_POLEGADA) * PONTOS_POR_POLEGADA;
}
