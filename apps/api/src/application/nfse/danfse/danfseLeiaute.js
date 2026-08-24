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

  // ⚠⚠ OS NÚMEROS DA NT SÃO PISOS, NÃO ALVOS — e isso está escrito, §2.1:
  // *"o DANFSe deverá ser impresso conforme o modelo permitido (…) utilizando-se os **tamanhos
  // mínimos de fonte** descritos no item 2.4 e seguintes"*. §2.4.2/§2.4.3 dizem "deverá ter tamanho
  // de seis (6) / sete (7) pontos"; quem os qualifica como mínimos é o §2.1.
  //
  // Subidos em 24/08/2026 a pedido do dono (o layout de 6/7pt é ilegível impresso). ⚠ **O TETO É
  // GEOMÉTRICO, NÃO NORMATIVO**, e foi MEDIDO: `escreverConteudo` desenha o conteúdo a **8 pt fixos
  // do topo da célula**, e a altura mais comum do §2.4.5 é **0,63–0,64 cm = 17,9–18,1 pt**.
  //
  //   conteúdo 8,0 pt → 8 + 8,0×1,15 = **17,2 pt** — cabe, com folga
  //   conteúdo 8,5 pt → 17,8 pt — no fio
  //   conteúdo 9,5 pt → **18,9 pt** — VAZA a borda inferior, invadindo a linha de baixo
  //
  // ⚠ E o vazamento NÃO aparece em teste de texto: `pdf-parse` extrai a string igual, e o
  // `ellipsis` não dispara (o estouro é vertical). Medido em 1 página e 0 reticências até 9,5 pt —
  // ou seja, **o teste que a equipe tem não pegaria a sobreposição**. Por isso o limite está aqui,
  // escrito, e não descoberto no papel.
  //
  // ⚠ Para passar de 8 pt é preciso CRESCER AS CÉLULAS (a NT permite: os tamanhos do §2.4.5 são
  // "sugestão"), o que desloca o `sup` de tudo que vem abaixo. É rework de geometria, não troca de
  // constante — e a disposição dos campos continua obrigatória pelo §2.2.4 (Anexo I).
  tituloBlocoPt: 7,                      // §2.4.1 — negrito, CAIXA ALTA (piso da NT)
  tituloCampoPt: 6.5,                    // §2.4.2 — piso 6; +0,5 pt cabe no orçamento acima
  tituloCampoIdentificacaoPt: 7,         // §2.4.2 — exceção: labels do bloco 2.1.2, CAIXA ALTA
  conteudoPt: 8,                         // §2.4.3 e §2.4.4 — piso 7; 8 é o teto desta geometria

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
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ `nome` NÃO É O QUE SE IMPRIME — QUEM SE IMPRIME É `rotulo`
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `nome` é a célula "NOME" da tabela do §2.4.5, transcrita como a NT a escreve: TUDO EM CAIXA
// ALTA. Mas o §2.4.2 diz como o rótulo vai para o papel, e são duas regras diferentes:
//
//   • títulos de campo: 6 pt, negrito, "com a primeira letra de cada palavra maiúscula e o
//     restante minúsculo";
//   • EXCEÇÃO — os campos do item 2.1.2 (Dados de Identificação da NFS-e): 7 pt, negrito,
//     "todos em caixa alta".
//
// Imprimir `nome` em toda parte (o que este gerador fazia) viola o §2.4.2 em nove dos onze
// blocos. `rotulo` é o §2.4.5 passado por essa regra, e a grafia mista de cada um vem da própria
// NT: os itens 2.1.3 a 2.1.13 listam os mesmos campos JÁ na forma impressa ("Indicador Municipal
// (Inscrição)", "Simples Nacional na Data de Competência", "Código de Tributação Nacional /
// Municipal"). Onde a NT diverge dela mesma, a nota fica no campo.
//
// ⚠ "NFS-e" É NOME PRÓPRIO E NÃO VIRA "NFS-E" NEM EM CAIXA ALTA. A NT escreve as duas formas para
// o MESMO campo (a tabela do §2.4.5 traz "SITUAÇÃO DA NFS-E" e "NÚMERO DA NFS-e"; o §2.1.2 e o
// §2.2.3 trazem "Situação da NFS-e" e "Emitente da NFS-e"); a lista de abreviaturas da própria NT
// fixa "NFS-e – Nota Fiscal de Serviço Eletrônica Nacional".
//
// `tituloImpresso: false` marca o bloco cuja linha "BLOCO" do §2.4.5 é a CAIXA DELIMITADORA e não
// uma célula de título: dá para saber pelas coordenadas — quando `esq`/`sup` do bloco coincidem
// com os de um campo (CABEÇALHO, DADOS DA NFS-e, CANHOTO), não há onde caber um título, e escrevê-lo
// ali imprime por cima do primeiro rótulo. Nos demais, a linha do bloco é a primeira célula
// (larg 5,09 em esq 0,30, com o primeiro campo em 5,41) e o título É impresso e sombreado (§2.2.3).
//
// `partes` é a quantidade de campos concatenados que a coluna "Outros Campos / Observações" do
// §2.4.5 declara (ex.: `nnnnnnn / nn.nnn-nnn` são dois). Serve à nota 12: campo composto sem dado
// leva UM TRAÇO POR COMPONENTE, não um traço só — senão "- / -" e "-" ficariam indistinguíveis.
export const BLOCOS = Object.freeze([
  {
    id: "cabecalho",
    titulo: "CABEÇALHO",
    alt: 1.16, larg: 20.4, esq: 0.3, sup: 0.3,
    sombreado: true,
    // A linha "CABEÇALHO" do §2.4.5 é a caixa delimitadora (0,30/0,30, 20,40 de largura, com os
    // três quadros dentro dela); a palavra "CABEÇALHO" não é conteúdo do documento.
    tituloImpresso: false,
    campos: [
      { id: "logomarca", nome: "LOGOMARCA DA NFSe", alt: 0.85, larg: 4.0, esq: 0.49, sup: 0.44,
        obs: "Logomarca oficial em https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/logos-da-nfs-e/ (§2.4.3). Não versionada no repo." },
      { id: "quadroDescricao", nome: 'QUADRO DA DESCRIÇÃO "DANFSe..."', alt: 1.16, larg: 10.19, esq: 5.41, sup: 0.3,
        obs: "Centralizar o texto no quadro." },
      { id: "quadroIdentMunicipio", nome: "QUADRO DA IDENT. MUNICÍPIO/AMBIENTE", alt: 1.16, larg: 5.09, esq: 15.62, sup: 0.3 },
      { id: "municipio", nome: "MUNICÍPIO", rotulo: "Município",
        caminho: "NFSe/infNFSe/ + NFSe/infNFSe/emit/enderNac/", tag: "xLocEmi + UF",
        alt: 0.64, larg: 5.09, esq: 15.62, sup: 0.3, max: 37, partes: 2,
        obs: 'Concatenar os dois campos. Informar "Município:  CCCC / CC". Não exibir quando o item do cód. de tributação nacional informado for 99.' },
      { id: "ambGer", nome: "AMBIENTE GERADOR", rotulo: "Ambiente Gerador",
        caminho: "NFSe/infNFSe/", tag: "ambGer",
        alt: 0.24, larg: 5.09, esq: 15.62, sup: 0.97, max: 1 },
      { id: "tpAmb", nome: "TIPO DE AMBIENTE", rotulo: "Tipo de Ambiente",
        caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "tpAmb",
        alt: 0.24, larg: 5.09, esq: 15.62, sup: 1.22, max: 1 },
    ],
  },

  {
    // §2.1.2 — ⚠ os labels DESTE bloco são 7 pt e CAIXA ALTA (§2.4.2), diferente de todos os outros.
    id: "identificacao",
    titulo: "DADOS DA NFS-e",
    alt: 2.84, larg: 20.4, esq: 0.3, sup: 1.48,
    labelsEmCaixaAlta7pt: true,
    // ⚠ A linha "DADOS DA NFS-e" do §2.4.5 é a CAIXA DELIMITADORA do bloco, não um título: ela
    // começa em 0,30/1,48, exatamente onde começa o campo CHAVE DE ACESSO. Escrever o texto ali
    // imprime por cima do rótulo da chave, e pintá-la de cinza 5% sombreia o bloco inteiro —
    // enquanto o §2.2.3 manda sombrear "os títulos de cada bloco", não os campos. Era daí que vinha
    // a necessidade da zona de silêncio branca em volta do QR Code.
    tituloImpresso: false,
    campos: [
      { id: "chaveAcesso", nome: "CHAVE DE ACESSO DA NFS-E", rotulo: "CHAVE DE ACESSO DA NFS-e",
        caminho: "NFSe/infNFSe/", tag: "id",
        alt: 0.77, larg: 15.3, esq: 0.3, sup: 1.48, max: 50,
        obs: 'Informar o id da NFS-e sem o prefixo "NFS". §2.1.1: impressa em único bloco contendo 50 dígitos.' },
      { id: "nNFSe", nome: "NÚMERO DA NFS-e", rotulo: "NÚMERO DA NFS-e",
        caminho: "NFSe/infNFSe/", tag: "nNFSe",
        alt: 0.67, larg: 5.09, esq: 0.3, sup: 2.27, max: 13 },
      { id: "dCompet", nome: "COMPETÊNCIA DA NFS-e", rotulo: "COMPETÊNCIA DA NFS-e",
        caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "dCompet",
        alt: 0.67, larg: 5.09, esq: 5.41, sup: 2.27, max: 10, formato: "DD/MM/AAAA" },
      { id: "dhProc", nome: "DATA E HORA DA EMISSÃO DA NFS-E", rotulo: "DATA E HORA DA EMISSÃO DA NFS-e",
        caminho: "NFSe/infNFSe/", tag: "dhProc",
        alt: 0.67, larg: 5.09, esq: 10.51, sup: 2.27, max: 19, formato: "DD/MM/AAAA hh:mm:ss" },
      { id: "nDPS", nome: "NÚMERO DA DPS", rotulo: "NÚMERO DA DPS",
        caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "nDPS",
        alt: 0.67, larg: 5.09, esq: 0.3, sup: 2.96, max: 15 },
      { id: "serie", nome: "SÉRIE DA DPS", rotulo: "SÉRIE DA DPS",
        caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "serie",
        alt: 0.67, larg: 5.09, esq: 5.41, sup: 2.96, max: 5 },
      { id: "dhEmi", nome: "DATA E HORA DA EMISSÃO DA DPS", rotulo: "DATA E HORA DA EMISSÃO DA DPS",
        caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "dhEmi",
        alt: 0.67, larg: 5.09, esq: 10.51, sup: 2.96, max: 19, formato: "DD/MM/AAAA hh:mm:ss" },
      { id: "tpEmit", nome: "EMITENTE DA NFS-E", rotulo: "EMITENTE DA NFS-e",
        caminho: "NFSe/infNFSe/DPS/infDPS/", tag: "tpEmit",
        alt: 0.67, larg: 5.09, esq: 0.3, sup: 3.65, max: 13, sombreado: true,
        codificado: true, obs: "Leiaute prevê 3 opções (1 a 3). Utilizar a descrição destas opções. Ex.: Prestador." },
      { id: "cStat", nome: "SITUAÇÃO DA NFS-E", rotulo: "SITUAÇÃO DA NFS-e",
        caminho: "NFSe/infNFSe/", tag: "cStat",
        alt: 0.67, larg: 5.09, esq: 5.41, sup: 3.65, max: 40,
        codificado: true, obs: "Utilizar a descrição das opções previstas no leiaute. Reticências acima de 37 caracteres." },
      { id: "finNFSe", nome: "FINALIDADE", rotulo: "FINALIDADE",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/", tag: "finNFSe",
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
      { id: "prestDoc", nome: "CNPJ / CPF / NIF", rotulo: "CNPJ / CPF / NIF",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/", tag: "CNPJ / CPF / NIF",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 4.34, max: "18 / 14 / 40",
        formato: "nn.nnn.nnn/nnnn-nn / nnn.nnn.nnn-nn / nnn" },
      { id: "prestIM", nome: "INDICADOR MUNICIPAL (INSCRIÇÃO)", rotulo: "Indicador Municipal (Inscrição)",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/", tag: "IM",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 4.34, max: 15 },
      { id: "prestFone", nome: "TELEFONE", rotulo: "Telefone",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/", tag: "fone",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 4.34, max: 20 },
      { id: "prestNome", nome: "NOME / NOME EMPRESARIAL", rotulo: "Nome / Nome Empresarial",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/", tag: "xNome",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 4.98, max: 80, truncaEm: 77 },
      { id: "prestMunicipio", nome: "MUNICÍPIO / SIGLA UF", rotulo: "Município / Sigla UF",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/end/endNac/ ou .../endExt/", tag: "cMun ou xCidade",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 4.98, max: 37, exigeTabelaIbge: true,
        obs: "Leiaute prevê o código do município com 7 dígitos da Tabela do IBGE. Utilizar a descrição destes códigos, concatenada com a UF." },
      { id: "prestIbgeCep", nome: "CÓDIGO IBGE / CEP", rotulo: "Código IBGE / CEP",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/end/endNac/ ou .../endExt/", tag: "cMun + CEP ou cEndPost",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 4.98, max: 21, partes: 2,
        formato: "nnnnnnn / nn.nnn-nnn ou nnnnnnn / nnnnnnnnnnn (ext)" },
      { id: "prestEndereco", nome: "ENDEREÇO", rotulo: "Endereço",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/end/", tag: "xLgr, nro, xCpl, xBairro",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 5.62, max: 80, truncaEm: 77, nota: 1 },
      // ⚠ A NT escreve "EMAIL" só neste bloco (§2.4.5 e §2.1.3) e "E-MAIL" nos três seguintes.
      // A transcrição preserva a divergência; o DANFSe oficial imprime "E-mail" em todos.
      { id: "prestEmail", nome: "EMAIL", rotulo: "Email",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/", tag: "email",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 5.62, max: 80, nota: 1 },
      { id: "opSimpNac", nome: "SIMPLES NACIONAL NA DATA DE COMPETÊNCIA",
        rotulo: "Simples Nacional na Data de Competência",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/regTrib/", tag: "opSimpNac",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 6.28, max: 40, codificado: true,
        obs: "Leiaute prevê 3 opções (1 a 3). Utilizar a descrição destas opções. Ex.: Não Optante." },
      { id: "regApTribSN", nome: "REGIME DE APURAÇÃO TRIBUTÁRIA PELO SN",
        rotulo: "Regime de Apuração Tributária pelo SN",
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
      { id: "tomaDoc", nome: "CNPJ / CPF / NIF", rotulo: "CNPJ / CPF / NIF",
        caminho: "NFSe/infNFSe/DPS/infDPS/toma/", tag: "CNPJ / CPF / NIF",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 6.92, max: "18 / 14 / 40",
        formato: "nn.nnn.nnn/nnnn-nn / nnn.nnn.nnn-nn / nnn" },
      { id: "tomaIM", nome: "INDICADOR MUNICIPAL (INSCRIÇÃO)", rotulo: "Indicador Municipal (Inscrição)",
        caminho: "NFSe/infNFSe/DPS/infDPS/toma/", tag: "IM",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 6.92, max: 15 },
      { id: "tomaFone", nome: "TELEFONE", rotulo: "Telefone",
        caminho: "NFSe/infNFSe/DPS/infDPS/toma/", tag: "fone",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 6.92, max: 20 },
      { id: "tomaNome", nome: "NOME / NOME EMPRESARIAL", rotulo: "Nome / Nome Empresarial",
        caminho: "NFSe/infNFSe/DPS/infDPS/toma/", tag: "xNome",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 7.56, max: 80, truncaEm: 77 },
      { id: "tomaMunicipio", nome: "MUNICÍPIO / SIGLA UF", rotulo: "Município / Sigla UF",
        caminho: "NFSe/infNFSe/DPS/infDPS/toma/end/endNac/ ou .../endExt/", tag: "cMun ou xCidade",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 7.56, max: 37, exigeTabelaIbge: true },
      { id: "tomaIbgeCep", nome: "CÓDIGO IBGE / CEP", rotulo: "Código IBGE / CEP",
        caminho: "NFSe/infNFSe/DPS/infDPS/toma/end/endNac/ ou .../endExt/", tag: "cMun + CEP ou cEndPost",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 7.56, max: 21, partes: 2,
        formato: "nnnnnnn / nn.nnn-nnn ou nnnnnnn / nnnnnnnnnnn (ext)" },
      { id: "tomaEndereco", nome: "ENDEREÇO", rotulo: "Endereço",
        caminho: "NFSe/infNFSe/DPS/infDPS/toma/end/", tag: "xLgr, nro, xCpl, xBairro",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 8.22, max: 80, truncaEm: 77, nota: 1 },
      { id: "tomaEmail", nome: "E-MAIL", rotulo: "E-mail",
        caminho: "NFSe/infNFSe/DPS/infDPS/toma/", tag: "email",
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
      { id: "destDoc", nome: "CNPJ / CPF / NIF", rotulo: "CNPJ / CPF / NIF",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/", tag: "CNPJ / CPF / NIF",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 8.86, max: "18 / 14 / 40",
        formato: "nn.nnn.nnn/nnnn-nn / nnn.nnn.nnn-nn / nnn" },
      { id: "destFone", nome: "TELEFONE", rotulo: "Telefone",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/", tag: "fone",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 8.86, max: 20 },
      { id: "destNome", nome: "NOME / NOME EMPRESARIAL", rotulo: "Nome / Nome Empresarial",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/", tag: "xNome",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 9.5, max: 80, truncaEm: 77 },
      { id: "destMunicipio", nome: "MUNICÍPIO / SIGLA UF", rotulo: "Município / Sigla UF",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/end/endNac/ ou .../endExt/", tag: "cMun ou xCidade",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 9.5, max: 37, exigeTabelaIbge: true },
      { id: "destIbgeCep", nome: "CÓDIGO IBGE / CEP", rotulo: "Código IBGE / CEP",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/end/endNac/ ou .../endExt/", tag: "cMun + CEP ou cEndPost",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 9.5, max: 21, partes: 2,
        formato: "nnnnnnn / nn.nnn-nnn ou nnnnnnn / nnnnnnnnnnn (ext)" },
      { id: "destEndereco", nome: "ENDEREÇO", rotulo: "Endereço",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/end/", tag: "xLgr, nro, xCpl, xBairro",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 10.16, max: 80, truncaEm: 77, nota: 1 },
      { id: "destEmail", nome: "E-MAIL", rotulo: "E-mail",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/", tag: "email",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 10.16, max: 80, nota: 1 },
    ],
  },

  {
    id: "intermediario",
    titulo: "INTERMEDIÁRIO DA OPERAÇÃO",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 10.8, nota: 2,
    supressao: { frase: "intermediarioNaoIdentificado", altMinima: 0.32, largMinima: 20.4 },
    campos: [
      { id: "intermDoc", nome: "CNPJ / CPF / NIF", rotulo: "CNPJ / CPF / NIF",
        caminho: "NFSe/infNFSe/DPS/infDPS/interm/", tag: "CNPJ / CPF / NIF",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 10.8, max: "18 / 14 / 40",
        formato: "nn.nnn.nnn/nnnn-nn / nnn.nnn.nnn-nn / nnn" },
      { id: "intermIM", nome: "INDICADOR MUNICIPAL (INSCRIÇÃO)", rotulo: "Indicador Municipal (Inscrição)",
        caminho: "NFSe/infNFSe/DPS/infDPS/interm/", tag: "IM",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 10.8, max: 15 },
      { id: "intermFone", nome: "TELEFONE", rotulo: "Telefone",
        caminho: "NFSe/infNFSe/DPS/infDPS/interm/", tag: "fone",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 10.8, max: 20 },
      { id: "intermNome", nome: "NOME / NOME EMPRESARIAL", rotulo: "Nome / Nome Empresarial",
        caminho: "NFSe/infNFSe/DPS/infDPS/interm/", tag: "xNome",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 11.44, max: 80, truncaEm: 77 },
      { id: "intermMunicipio", nome: "MUNICÍPIO / SIGLA UF", rotulo: "Município / Sigla UF",
        caminho: "NFSe/infNFSe/DPS/infDPS/interm/end/endNac/ ou .../endExt/", tag: "cMun ou xCidade",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 11.44, max: 37, exigeTabelaIbge: true },
      { id: "intermIbgeCep", nome: "CÓDIGO IBGE / CEP", rotulo: "Código IBGE / CEP",
        caminho: "NFSe/infNFSe/DPS/infDPS/interm/end/endNac/ ou .../endExt/", tag: "cMun + CEP ou cEndPost",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 11.44, max: 21, partes: 2,
        formato: "nnnnnnn / nn.nnn-nnn ou nnnnnnn / nnnnnnnnnnn (ext)" },
      { id: "intermEndereco", nome: "ENDEREÇO", rotulo: "Endereço",
        caminho: "NFSe/infNFSe/DPS/infDPS/interm/end/", tag: "xLgr, nro, xCpl, xBairro",
        alt: 0.63, larg: 10.19, esq: 0.3, sup: 12.09, max: 80, truncaEm: 77, nota: 1 },
      { id: "intermEmail", nome: "E-MAIL", rotulo: "E-mail",
        caminho: "NFSe/infNFSe/DPS/infDPS/interm/", tag: "email",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 12.09, max: 80, nota: 1 },
    ],
  },

  {
    id: "servico",
    titulo: "SERVIÇO PRESTADO",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 12.74,
    campos: [
      { id: "cTrib", nome: "CÓDIGO DE TRIBUTAÇÃO NACIONAL / MUNICIPAL",
        rotulo: "Código de Tributação Nacional / Municipal",
        caminho: "NFSe/infNFSe/DPS/infDPS/serv/cServ/ + NFSe/infNFSe/", tag: "cTribNac + cTribMun",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 12.74, max: 14, formato: "nn.nn.nn / nnn", partes: 2 },
      { id: "cNBS", nome: "CÓDIGO DA NBS", rotulo: "Código da NBS",
        caminho: "NFSe/infNFSe/DPS/infDPS/serv/cServ/", tag: "cNBS",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 12.74, max: 9, formato: "n.nnnn.nn.nn" },
      { id: "locPrest", nome: "LOCAL DA PRESTAÇÃO / SIGLA UF / PAÍS",
        rotulo: "Local da Prestação / Sigla UF / País",
        caminho: "NFSe/infNFSe/ + NFSe/infNFSe/DPS/infDPS/serv/locPrest/", tag: "xLocPrestacao + cPaisPrestacao",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 12.74, max: 42, partes: 2,
        obs: "Concatenar município, UF e País. País com código de 2 dígitos da Tabela ISO. Ex.: BR" },
      // ⚠ ESTA É A DESCRIÇÃO DO SERVIÇO QUE O DANFSe OFICIAL IMPRIME, e ela VEM DO XML
      // (`xTribMun`/`xTribNac`, dentro de `infNFSe`). Não é um dos doze campos codificados: aqui a
      // NFS-e devolvida já traz o texto pronto, então não falta tabela nenhuma para imprimi-lo, e o
      // art. 13 é respeitado por construção. Sai ACIMA do rótulo "Descrição do Serviço", sem rótulo
      // próprio — é assim no §2.4.5 (sup 13,39 contra 13,79) e é assim no exemplo oficial.
      { id: "xTrib", nome: "DESCRIÇÃO DO CÓDIGO DE TRIBUTAÇÃO NACIONAL / MUNICIPAL",
        rotulo: null,
        caminho: "NFSe/infNFSe/DPS/infDPS/serv/cServ/ + NFSe/infNFSe/", tag: "xTribNac + xTribMun",
        alt: 0.38, larg: 20.4, esq: 0.3, sup: 13.39, max: 170, truncaEm: 167, semLabel: true,
        obs: 'SE xTribMun <> "" ENTAO Descrição Municipal SENAO Descrição Nacional. Não há título (label) deste campo no DANFSe.' },
      { id: "xDescServ", nome: "DESCRIÇÃO DO SERVIÇO", rotulo: "Descrição do Serviço",
        caminho: "NFSe/infNFSe/DPS/infDPS/serv/cServ/", tag: "xDescServ",
        alt: 0.63, larg: 20.4, esq: 0.3, sup: 13.79, max: 1300, truncaEm: 1297, elastico: true },
    ],
  },

  {
    id: "issqn",
    titulo: "TRIBUTAÇÃO MUNICIPAL (ISSQN)",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 14.43, nota: 4,
    supressao: { frase: "semIssqn", altMinima: 0.32, largMinima: 20.4 },
    campos: [
      { id: "tribISSQN", nome: "TIPO DE TRIBUTAÇÃO DO ISSQN", rotulo: "Tipo de Tributação do ISSQN",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/", tag: "tribISSQN",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 14.43, max: 21, codificado: true,
        obs: "Leiaute prevê 4 opções (1 a 4). Ex.: Operação Tributável." },
      { id: "locIncid", nome: "MUNICÍPIO / SIGLA UF / PAÍS DA INCIDÊNCIA DO ISSQN",
        rotulo: "Município / Sigla UF / País de Incidência do ISSQN",
        caminho: "NFSe/infNFSe/ + NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/", tag: "xLocIncid + cPaisResult",
        alt: 0.63, larg: 10.19, esq: 5.41, sup: 14.43, max: 42, partes: 2 },
      { id: "regEspTrib", nome: "REGIME ESPECIAL DE TRIBUTAÇÃO DO ISSQN",
        rotulo: "Regime Especial de Tributação do ISSQN",
        caminho: "NFSe/infNFSe/DPS/infDPS/prest/regTrib/", tag: "regEspTrib",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 15.08, max: 27, codificado: true, nota: 5,
        obs: "Leiaute prevê 8 opções (0 a 6 e 9). Ex.: Estimativa." },
      { id: "tpImunidade", nome: "TIPO DE IMUNIDADE DO ISSQN", rotulo: "Tipo de Imunidade do ISSQN",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/", tag: "tpImunidade",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 15.08, max: 40, codificado: true, nota: 5,
        obs: "Leiaute prevê 5 opções (1 a 5)." },
      { id: "tpSusp", nome: "SUSPENSÃO DA EXIGIBILIDADE DO ISSQN", rotulo: "Suspensão da Exigibilidade do ISSQN",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/exigSusp/", tag: "tpSusp",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 15.08, max: 40, codificado: true, nota: 5,
        obs: "Descrições dadas pela NT: “Exigibilidade Suspensa por Decisão Judicial”; “Exigibilidade Suspensa por Processo Administrativo” — a NT não diz a qual número cada uma corresponde." },
      { id: "nProcesso", nome: "NÚMERO PROCESSO SUSPENSÃO", rotulo: "Número Processo Suspensão",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/exigSusp/", tag: "nProcesso",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 15.08, max: 30, nota: 5 },
      { id: "tpBM", nome: "BENEFÍCIO MUNICIPAL", rotulo: "Benefício Municipal",
        caminho: "NFSe/infNFSe/valores/", tag: "tpBM",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 15.73, max: 40, codificado: true, nota: 5,
        obs: "Leiaute prevê 4 opções (1 e 4). Ex.: Isenção." },
      { id: "vCalcBM", nome: "CÁLCULO DO BM", rotulo: "Cálculo do BM",
        caminho: "NFSe/infNFSe/valores/ ou NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/BM/", tag: "vCalcBM ou vRedBCBM",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 15.73, max: "1-15V2", nota: 5 },
      { id: "vDedRed", nome: "TOTAL DEDUÇÕES/REDUÇÕES", rotulo: "Total Deduções/Reduções",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/vDedRed/ ou NFSe/infNFSe/valores/ + NFSe/infNFSe/IBSCBS/valores/",
        tag: "vDR ou vCalcDR + vCalcReeRepRes",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 15.73, max: "1-15V2", nota: 5 },
      { id: "vDescIncondIssqn", nome: "DESCONTO INCONDICIONADO", rotulo: "Desconto Incondicionado",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/", tag: "vDescIncond",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 15.73, max: "1-15V2", nota: 5 },
      { id: "vBC", nome: "BC ISSQN", rotulo: "BC ISSQN",
        caminho: "NFSe/infNFSe/valores/", tag: "vBC",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 16.37, max: "1-15V2" },
      { id: "pAliqAplic", nome: "ALÍQUOTA APLICADA", rotulo: "Alíquota Aplicada",
        caminho: "NFSe/infNFSe/valores/", tag: "pAliqAplic",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 16.37, max: "1-2V2" },
      { id: "tpRetISSQN", nome: "RETENÇÃO DO ISSQN", rotulo: "Retenção do ISSQN",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/", tag: "tpRetISSQN",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 16.37, max: 25, codificado: true,
        obs: "Leiaute prevê 3 opções (1 a 3). Ex.: Não Retido." },
      { id: "vISSQN", nome: "ISSQN APURADO", rotulo: "ISSQN Apurado",
        caminho: "NFSe/infNFSe/valores/", tag: "vISSQN",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 16.37, max: "1-2V2" },
    ],
  },

  {
    id: "tribFederal",
    titulo: "TRIBUTAÇÃO FEDERAL (EXCETO CBS)",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 17.02,
    campos: [
      { id: "vRetIRRF", nome: "IRRF", rotulo: "IRRF",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/", tag: "vRetIRRF",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 17.02, max: "1-15V2" },
      { id: "vRetCP", nome: "CONTRIBUIÇÃO PREVIDENCIÁRIA - RETIDA", rotulo: "Contribuição Previdenciária - Retida",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/", tag: "vRetCP",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 17.02, max: "1-15V2" },
      { id: "contribSociaisRetidas", nome: "CONTRIBUIÇÕES SOCIAIS - RETIDAS",
        rotulo: "Contribuições Sociais - Retidas",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/ (+ .../piscofins/)", tag: "vRetCSLL ou vRetCSLL + vPis + vCofins",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 17.02, max: "1-15V2",
        // ⚠ v1.02 mudou exatamente isto (ver histórico de versões da NT).
        obs: "Quando tpRetPisCofins = 1 (PIS/COFINS Retido), este campo retorna o somatório de vRetCSLL, vPis e vCofins. Nos demais casos, retorna vRetCSLL." },
      { id: "vPis", nome: "PIS - DÉBITO APURAÇÃO PRÓPRIA", rotulo: "PIS - Débito Apuração Própria",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/", tag: "vPis",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 17.67, max: "1-15V2", nota: 6,
        obs: "Quando tpRetPisCofins = 1, este campo retorna 0,00 (zero). Nos demais casos, retorna vPis." },
      { id: "vCofins", nome: "COFINS - DÉBITO APURAÇÃO PRÓPRIA", rotulo: "COFINS - Débito Apuração Própria",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/", tag: "vCofins",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 17.67, max: "1-15V2", nota: 6,
        obs: "Quando tpRetPisCofins = 1, este campo retorna 0,00 (zero). Nos demais casos, retorna vCofins." },
      // ⚠ O DANFSe OFICIAL IMPRIME ESTE CAMPO COMO "<código> - <descrição>" e é o ÚNICO em que ele
      // faz isso (tpEmit, cStat, opSimpNac, tribISSQN e tpRetISSQN saem só com a descrição). A NT
      // manda a mesma coisa para os doze: "utilizar a descrição destas opções". Não replicamos a
      // forma composta — ela não está na NT e um único caso não faz regra.
      { id: "tpRetPisCofins", nome: "DESCRIÇÃO CONTRIB. SOCIAIS - RETIDAS", rotulo: "Descrição Contrib. Sociais - Retidas",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/", tag: "tpRetPisCofins",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 17.67, max: 35, codificado: true, nota: 6,
        obs: "Leiaute prevê 10 opções (1 a 9). Ex.: PIS/COFINS/CSLL Não Retido." },
    ],
  },

  {
    id: "ibsCbs",
    titulo: "TRIBUTAÇÃO IBS / CBS",
    alt: 0.63, larg: 5.09, esq: 0.3, sup: 18.32,
    campos: [
      // ⚠ "cClassTrib" não vira "CCLASSTRIB" no papel: a lista de abreviaturas da própria NT o
      // registra assim ("cClassTrib – Código de Classificação Tributária") e o §2.1.10 também.
      { id: "cstCClassTrib", nome: "CST / CCLASSTRIB", rotulo: "CST / cClassTrib",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/valores/trib/gIBSCBS/", tag: "CST + cClassTrib",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 18.32, max: 12, formato: "nnn / nnnnnn", partes: 2 },
      { id: "indOpIncid", nome: "INDICADOR DE OPERAÇÃO / CÓDIGO IBGE INCIDÊNCIA / MUNICÍPIO INCIDÊNCIA / SIGLA UF",
        rotulo: "Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF",
        caminho: "NFSe/infNFSe/DPS/infDPS/IBSCBS/ + NFSe/infNFSe/IBSCBS/", tag: "cIndOp + cLocalidadeIncid + xLocalidadeIncid",
        alt: 0.63, larg: 10.19, esq: 10.51, sup: 18.32, max: 56, formato: "nnnnnn / nnnnnnn / ccc / CC",
        // ⚠ TRÊS, não quatro: a quarta parte do formato é a SIGLA UF, que sai da Tabela do IBGE
        // aplicada a `cLocalidadeIncid` — tabela que não está no projeto. A NT declara três tags.
        partes: 3 },
      { id: "exclusoesReducoesBc", nome: "EXCLUSÕES E REDUÇÕES DA BASE DE CÁLCULO",
        rotulo: "Exclusões e Reduções da Base de Cálculo",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/ + NFSe/infNFSe/IBSCBS/valores/ + NFSe/infNFSe/valores/ + .../piscofins/",
        tag: "vDescIncond + vCalcReeRepRes + vISSQN + vPIS + vCOFINS",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 18.96, max: "1-15V2", obs: "Somatório de todos estes campos." },
      { id: "bcAposExclusoes", nome: "BASE DE CÁLCULO APÓS EXCLUSÕES E REDUÇÕES",
        rotulo: "Base de Cálculo Após Exclusões e Reduções",
        caminho: "NFSe/infNFSe/IBSCBS/valores/", tag: "vBC",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 18.96, max: "1-15V2" },
      { id: "redAliq", nome: "RED. ALÍQUOTA IBS / RED. ALÍQUOTA CBS",
        rotulo: "Red. Alíquota IBS / Red. Alíquota CBS",
        caminho: "NFSe/infNFSe/IBSCBS/valores/uf/ + .../mun/ + .../fed/", tag: "pRedAliqUF + pRedAliqMun + pRedAliqCBS",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 18.96, max: "1-2V2 / 1-2V2 / 1-2V2", formato: "% / % / %",
        partes: 3, percentual: true },
      { id: "aliqIbs", nome: "ALÍQUOTA - IBS UF / IBS MUN", rotulo: "Alíquota - IBS UF / IBS Mun",
        caminho: "NFSe/infNFSe/IBSCBS/valores/uf/ + .../mun/", tag: "pIBSUF + pIBSMun",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 18.96, max: "1-2V2 / 1-2V2", formato: "% / %",
        partes: 2, percentual: true },
      { id: "pAliqEfetMun", nome: "ALÍQ. EFETIVA MUNICIPAL - IBS", rotulo: "Alíq. Efetiva Municipal - IBS",
        caminho: "NFSe/infNFSe/IBSCBS/valores/mun/", tag: "pAliqEfetMun",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 19.61, max: "1-2V2" },
      { id: "vIBSMun", nome: "VALOR APURADO MUNICIPAL - IBS", rotulo: "Valor Apurado Municipal - IBS",
        caminho: "NFSe/infNFSe/IBSCBS/totCIBS/gIBS/gIBSMunTot/", tag: "vIBSMun",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 19.61, max: "1-15V2" },
      { id: "pAliqEfetUF", nome: "ALÍQ. EFETIVA ESTADUAL - IBS", rotulo: "Alíq. Efetiva Estadual - IBS",
        caminho: "NFSe/infNFSe/IBSCBS/valores/uf/", tag: "pAliqEfetUF",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 19.61, max: "1-2V2" },
      { id: "vIBSUF", nome: "VALOR APURADO ESTADUAL - IBS", rotulo: "Valor Apurado Estadual - IBS",
        caminho: "NFSe/infNFSe/IBSCBS/totCIBS/gIBS/gIBSUFTot/", tag: "vIBSUF",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 19.61, max: "1-15V2" },
      { id: "vIBSTot", nome: "VALOR TOTAL APURADO - IBS", rotulo: "Valor Total Apurado - IBS",
        caminho: "NFSe/infNFSe/IBSCBS/totCIBS/gIBS/", tag: "vIBSTot",
        alt: 0.63, larg: 5.09, esq: 0.3, sup: 20.26, max: "1-15V2" },
      { id: "pCBS", nome: "ALÍQUOTA - CBS", rotulo: "Alíquota - CBS",
        caminho: "NFSe/infNFSe/IBSCBS/valores/fed/", tag: "pCBS",
        alt: 0.63, larg: 5.09, esq: 5.41, sup: 20.26, max: "1-2V2" },
      { id: "pAliqEfetCBS", nome: "ALÍQUOTA EFETIVA - CBS", rotulo: "Alíquota Efetiva - CBS",
        caminho: "NFSe/infNFSe/IBSCBS/valores/fed/", tag: "pAliqEfetCBS",
        alt: 0.63, larg: 5.09, esq: 10.51, sup: 20.26, max: "1-2V2" },
      { id: "vCBS", nome: "VALOR TOTAL APURADO - CBS", rotulo: "Valor Total Apurado - CBS",
        caminho: "NFSe/infNFSe/IBSCBS/totCIBS/gCBS/", tag: "vCBS",
        alt: 0.63, larg: 5.09, esq: 15.62, sup: 20.26, max: "1-15V2" },
    ],
  },

  {
    id: "valorTotal",
    // §2.4.5 escreve "VALOR TOTAL DA NFS-E"; §2.2.3 e §2.1.11 escrevem "NFS-e". Ver a nota sobre o
    // nome próprio, no topo de BLOCOS.
    titulo: "VALOR TOTAL DA NFS-e",
    alt: 0.67, larg: 5.09, esq: 0.3, sup: 20.9,
    campos: [
      { id: "vServ", nome: "VALOR DA OPERAÇÃO / SERVIÇO", rotulo: "Valor da Operação / Serviço",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/vServPrest/", tag: "vServ",
        alt: 0.67, larg: 5.09, esq: 5.41, sup: 20.9, max: "1-15V2" },
      { id: "vDescIncond", nome: "DESCONTO INCONDICIONADO", rotulo: "Desconto Incondicionado",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/", tag: "vDescIncond",
        alt: 0.67, larg: 5.09, esq: 10.51, sup: 20.9, max: "1-15V2" },
      { id: "vDescCond", nome: "DESCONTO CONDICIONADO", rotulo: "Desconto Condicionado",
        caminho: "NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/", tag: "vDescCond",
        alt: 0.67, larg: 5.09, esq: 15.62, sup: 20.9, max: "1-15V2" },
      { id: "vTotalRet", nome: "TOTAL DAS RETENÇÕES (ISSQN / FEDERAIS)", rotulo: "Total das Retenções (ISSQN / Federais)",
        caminho: "NFSe/infNFSe/valores/", tag: "vTotalRet",
        alt: 0.67, larg: 5.09, esq: 0.3, sup: 21.59, max: "1-15V2" },
      { id: "vLiq", nome: "VALOR LÍQUIDO DA NFS-e", rotulo: "Valor Líquido da NFS-e",
        caminho: "NFSe/infNFSe/valores/", tag: "vLiq",
        alt: 0.67, larg: 5.09, esq: 5.41, sup: 21.59, max: "1-15V2" },
      { id: "totalIbsCbs", nome: "TOTAL DO IBS/CBS", rotulo: "Total do IBS/CBS",
        caminho: "NFSe/infNFSe/IBSCBS/totCIBS/gIBS/ + .../gCBS/", tag: "vIBSTot + vCBS",
        alt: 0.67, larg: 5.09, esq: 10.51, sup: 21.59, max: "1-15V2" },
      { id: "vTotNF", nome: "VALOR LÍQUIDO DA NFS-e + IBS/CBS", rotulo: "Valor Líquido da NFS-e + IBS/CBS",
        caminho: "NFSe/infNFSe/IBSCBS/totCIBS/", tag: "vTotNF",
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
      { id: "infoComplementares", nome: "INFORMAÇÕES COMPLEMENTARES", rotulo: null,
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
    // Mesma leitura do bloco DADOS DA NFS-e: a linha "CANHOTO" do §2.4.5 começa em 0,30/28,10,
    // onde já começa DATA CIENTIFICAÇÃO — é a caixa delimitadora, não um título a imprimir.
    tituloImpresso: false,
    campos: [
      { id: "dataCientificacao", nome: "DATA CIENTIFICAÇÃO", rotulo: "Data Cientificação",
        alt: 0.67, larg: 5.09, esq: 0.3, sup: 28.1,
        semFonteNoXml: true, obs: "Campo para preenchimento manual — não vem do XML." },
      { id: "identificacaoAssinatura", nome: "IDENTIFICAÇÃO E ASSINATURA", rotulo: "Identificação e Assinatura",
        alt: 0.67, larg: 5.09, esq: 5.41, sup: 28.1,
        semFonteNoXml: true, obs: "Campo para preenchimento manual — não vem do XML." },
      { id: "canhotoNumeroChave", nome: "Nº NFS-E / CHAVE NFS-E", rotulo: "Nº NFS-e / Chave NFS-e",
        caminho: "NFSe/infNFSe/", tag: "nNFSe + id",
        alt: 0.67, larg: 10.19, esq: 10.51, sup: 28.1, max: 66, partes: 2,
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

/**
 * Agrupa os campos de um bloco nas LINHAS do §2.4.5 — quem define a linha é a coordenada `sup`,
 * que é o próprio dado da tabela. É disto que a nota 5 fala ("caso não existam dados em todos os
 * campos da mesma linha"), e sem o agrupamento não há como aplicá-la.
 *
 * Devolve `[{ sup, campos, alturaAteAProxima }]`, em ordem de topo. `alturaAteAProxima` é o passo
 * vertical real entre esta linha e a seguinte (0,65 cm nos blocos de 0,63) — é o que se desconta
 * quando a linha é suprimida, para que as de baixo subam sem se sobrepor.
 */
export function linhasDoBloco(bloco) {
  const porSup = new Map();
  for (const campo of bloco.campos) {
    const chave = campo.sup.toFixed(2);
    if (!porSup.has(chave)) porSup.set(chave, []);
    porSup.get(chave).push(campo);
  }
  const linhas = [...porSup.entries()]
    .map(([sup, campos]) => ({ sup: Number(sup), campos }))
    .sort((a, b) => a.sup - b.sup);
  return linhas.map((linha, i) => ({
    ...linha,
    alturaAteAProxima: i + 1 < linhas.length
      ? linhas[i + 1].sup - linha.sup
      : Math.max(...linha.campos.map((c) => c.alt)),
  }));
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

/**
 * O título do bloco é uma CÉLULA DE TÍTULO ou a CAIXA DELIMITADORA do bloco?
 *
 * ⚠⚠ A NT USA A MESMA FORMA DE LINHA PARA AS DUAS COISAS, e só as coordenadas as separam. No §2.4.5
 * o bloco aparece como uma linha com `alt/larg/esq/sup` igual às dos campos, **recuada à esquerda**
 * (medido na p. 18: o título em `x0=64,3` e o campo em `x0=73,5`). Em quase todos os blocos essa
 * linha descreve a primeira célula da faixa e os campos seguem à direita (`esq: 5,41`); em alguns
 * ela descreve **onde o bloco começa** — e aí o `esq`/`sup` dela é o do PRIMEIRO CAMPO.
 *
 * ⚠⚠ ESCREVER O TÍTULO NO SEGUNDO CASO IMPRIME POR CIMA DO PRIMEIRO RÓTULO. Foi o defeito relatado
 * pelo dono num DANFSe real: *"TRIBUTAÇÃO MUNICIPAL (ISSQN) Tipo de Tributação do ISSQN está bugado
 * no pdf ficando um em cima do outro"*. Os dois textos saíam no MESMO `y` (409,0 pt), na MESMA
 * célula — o título a 7 pt e o rótulo a 6,5 pt, sobrepostos.
 *
 * ⚠ **A transcrição estava FIEL** — a NT dá ao bloco e ao campo exatamente `0,63 · 5,09 · 0,30 ·
 * 14,43`. O que faltava era a LEITURA da tabela, e ela já estava escrita neste projeto para
 * CABEÇALHO, DADOS DA NFS-e e CANHOTO (`tituloImpresso: false`). O `issqn` satisfaz o mesmo
 * critério e nunca foi classificado.
 *
 * ⚠ Por isso a regra é DERIVADA das coordenadas, e não uma quarta bandeira à mão: bloco novo cuja
 * caixa coincida com a do primeiro campo já nasce sem a sobreposição, sem ninguém lembrar disso.
 * A bandeira `tituloImpresso: false` continua valendo para o CABEÇALHO, cujo primeiro campo tem
 * coordenada própria (`0,49 / 0,44`) e portanto não é pego por coincidência.
 */
export function tituloEhCaixaDelimitadora(bloco) {
  const primeiro = bloco?.campos?.[0];
  if (!primeiro) return false;
  return bloco.esq === primeiro.esq && bloco.sup === primeiro.sup;
}
