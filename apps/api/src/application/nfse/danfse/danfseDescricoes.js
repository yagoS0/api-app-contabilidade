// DESCRIÇÕES DOS CÓDIGOS DO DANFSe — PREENCHIDO A PARTIR DO XSD OFICIAL (24/08/2026).
//
// Em doze campos a NT 008 manda "utilizar a descrição das opções previstas no leiaute"
// (`tpEmit`, `cStat`, `finNFSe`, `opSimpNac`, `regApTribSN`, `tribISSQN`, `tpRetISSQN`,
// `regEspTrib`, `tpImunidade`, `tpSusp`, `tpBM`, `tpRetPisCofins`).
//
// ⚠⚠ ESTE ARQUIVO ABRIA COM "DELIBERADAMENTE VAZIO — o leiaute não está no repositório. Não há um
// único `.xsd` na árvore". **Isso ficou FALSO** e ninguém tinha voltado aqui para corrigir: existem
// **20 XSD** em `docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/Schemas/` (versões 1.00 e
// 1.01), e o README daquela pasta já registrava que preencher este arquivo era "trabalho de código
// e NÃO foi feito nesta rodada". Um comentário que erra sobre o próprio estado é pior que
// comentário nenhum: ele fez o gerador imprimir código cru por semanas, com a pendência nomeada,
// enquanto a fonte estava no disco.
//
// **A fonte de cada linha abaixo é a `<xs:documentation>` do próprio tipo**, em
// `Schemas/1.01/tiposSimples_v1.01.xsd`. O texto é COPIADO, não parafraseado — inclusive onde o
// arquivo oficial tem erro de digitação ("Intermediario" sem acento em `TSTipoRetISSQN`), porque a
// NT manda "utilizar a descrição das opções previstas no leiaute" e o leiaute é este.
//
// ⚠⚠ **O DONO FORNECEU CINCO TRADUÇÕES E UMA DELAS ESTÁ CONTRADITA PELA FONTE.** Ele escreveu
// *"Situação 100 → Autorizada"*; o XSD diz **"NFS-e Gerada"**. Regra 4 do projeto (FONTE OFICIAL
// VENCE) decide, e o motivo é concreto: "autorizada" é vocabulário de NF-e, e é também o valor de
// `PortalInvoice.statusEfetivo` — a palavra NOSSA. Imprimi-la como se fosse a descrição do fisco
// misturaria os dois vocabulários num documento que circula para o tomador.
// As outras quatro (`tpRetISSQN`, `opSimpNac`, `tpEmit`, `tpAmb`) **confirmam** o XSD.
//
// ⚠ **`tpAmb` NÃO ENTRA AQUI**, embora o dono o tenha traduzido: ele não é um dos doze campos
// codificados, o leiaute não o marca `codificado`, e a célula dele tem `max: 1` — o DANFSe quer o
// DÍGITO ali. O que o `tpAmb=2` dispara é a expressão "NFS-e SEM VALIDADE JURÍDICA" no cabeçalho,
// que já existe e é travada por teste.
//
// ⚠ **TEXTO LONGO NÃO É PROBLEMA, e a NT autoriza o corte** (§2.1): *"a quantidade de caracteres
// para cada campo sugerida no item 2.4.5 **não tem caráter obrigatório**, podendo-se utilizar
// quantidade diversa, acrescido de reticências (...), quando o campo não suportar a totalidade"*.
// Por isso as descrições entram INTEIRAS e quem corta é o `truncaEm` do leiaute — não se escolhe
// uma forma curta por conta própria, que seria parafrasear o fisco.

/**
 * Mapa `tag do XML` → (`código` → `descrição oficial`).
 *
 * ⚠ Cada entrada vem com a fonte no comentário do grupo, no padrão de `dpsCodigos.js`.
 * Entrada sem fonte é o defeito que este arquivo existe para impedir.
 */
export const DESCRICOES = Object.freeze({
  // `TSEmitenteDPS` — tiposSimples_v1.01.xsd
  tpEmit: Object.freeze({
    1: "Prestador",
    2: "Tomador",
    3: "Intermediário",
  }),

  // `TStat` — tiposSimples_v1.01.xsd
  // ⚠⚠ O `101` NÃO ESTÁ NO 1.01 — ele foi REMOVIDO da enumeração entre as versões. Mas
  // `Schemas/1.00/tiposSimples_v1.00.xsd` o traz ("NFS-e de Substituição Gerada") **e existe nota
  // real com ele**: `docs/leiaute-nfse/nfse-nacional-substituicao.xml` tem `<cStat>101</cStat>`.
  // Deixá-lo de fora imprimiria código cru exatamente na nota substituída — o caso que o DANFSe
  // mais precisa explicar. A procedência dele é o 1.00, e está dita aqui.
  cStat: Object.freeze({
    100: "NFS-e Gerada",
    101: "NFS-e de Substituição Gerada", // ⚠ fonte: XSD 1.00; removido da enumeração no 1.01
    102: "NFS-e de Decisão Judicial",
    103: "NFS-e Avulsa",
    107: "NFS-e MEI",
  }),

  // `TSRTCFinNFSe` — tiposSimples_v1.01.xsd. ⚠ A enumeração oficial tem UM valor só.
  finNFSe: Object.freeze({
    0: "NFS-e regular",
  }),

  // `TSOpSimpNac` — tiposSimples_v1.01.xsd
  opSimpNac: Object.freeze({
    1: "Não Optante",
    2: "Optante - Microempreendedor Individual (MEI)",
    3: "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
  }),

  // `TSRegimeApuracaoSimpNac` — tiposSimples_v1.01.xsd. Só se aplica a `opSimpNac = 3`.
  regApTribSN: Object.freeze({
    1: "Regime de apuração dos tributos federais e municipal pelo SN",
    2: "Regime de apuração dos tributos federais pelo SN e ISSQN por fora do SN conforme respectiva legislação municipal do tributo",
    3: "Regime de apuração dos tributos federais e municipal por fora do SN conforme respectivas legislações federal e municipal de cada tributo",
  }),

  // `TSTribISSQN` — tiposSimples_v1.01.xsd
  tribISSQN: Object.freeze({
    1: "Operação tributável",
    2: "Imunidade",
    3: "Exportação de serviço",
    4: "Não Incidência",
  }),

  // `TSTipoRetISSQN` — tiposSimples_v1.01.xsd
  // ⚠ "Intermediario" sem acento é como o arquivo OFICIAL escreve. Não se corrige o fisco.
  tpRetISSQN: Object.freeze({
    1: "Não Retido",
    2: "Retido pelo Tomador",
    3: "Retido pelo Intermediario",
  }),

  // `TSRegEspTrib` — tiposSimples_v1.01.xsd. ⚠ Vai de 0 a 6 e salta para 9.
  regEspTrib: Object.freeze({
    0: "Nenhum",
    1: "Ato Cooperado (Cooperativa)",
    2: "Estimativa",
    3: "Microempresa Municipal",
    4: "Notário ou Registrador",
    5: "Profissional Autônomo",
    6: "Sociedade de Profissionais",
    9: "Outros",
  }),

  // `TSTipoImunidadeISSQN` — tiposSimples_v1.01.xsd. ⚠ O `0` existe e significa "não informado na
  // nota de origem" — que NÃO é o mesmo que ausência do campo (nota 12 / traço).
  tpImunidade: Object.freeze({
    0: "Imunidade (tipo não informado na nota de origem)",
    1: "Patrimônio, renda ou serviços, uns dos outros (CF88, Art 150, VI, a)",
    2: "Templos de qualquer culto (CF88, Art 150, VI, b)",
    3: "Patrimônio, renda ou serviços dos partidos políticos, inclusive suas fundações, das entidades sindicais dos trabalhadores, das instituições de educação e de assistência social, sem fins lucrativos, atendidos os requisitos da lei (CF88, Art 150, VI, c)",
    4: "Livros, jornais, periódicos e o papel destinado a sua impressão (CF88, Art 150, VI, d)",
    5: "Fonogramas e videofonogramas musicais produzidos no Brasil contendo obras musicais ou literomusicais de autores brasileiros e/ou obras em geral interpretadas por artistas brasileiros bem como os suportes materiais ou arquivos digitais que os contenham, salvo na etapa de replicação industrial de mídias ópticas de leitura a laser (CF88, Art 150, VI, e)",
  }),

  // `TSOpExigSuspensa` — tiposSimples_v1.01.xsd.
  // ⚠ A NT §2.4.5 escreve as DUAS frases sem dizer qual é 1 e qual é 2; o XSD amarra. É a única
  // das doze em que a NT dava o texto e faltava exatamente o de-para.
  tpSusp: Object.freeze({
    1: "Exigibilidade Suspensa por Decisão Judicial",
    2: "Exigibilidade Suspensa por Processo Administrativo",
  }),

  // `TBMISSQN` — tiposSimples_v1.01.xsd. ⚠ O arquivo oficial usa `1)` em vez de `1 -` aqui, e as
  // descrições citam OUTRAS tags (`ppBM`, `vInfoBM`, `aliqDifBM`) — copiadas como estão.
  tpBM: Object.freeze({
    1: "Isenção",
    2: "Redução da BC em 'ppBM' %",
    3: "Redução da BC em R$ 'vInfoBM'",
    4: "Alíquota Diferenciada de 'aliqDifBM' %",
  }),

  // `TSTipoRetPISCofins` — tiposSimples_v1.01.xsd. ⚠ Começa em 0, e o 0 é um valor DECLARADO
  // ("Não Retidos"), não ausência.
  tpRetPisCofins: Object.freeze({
    0: "PIS/COFINS/CSLL Não Retidos",
    1: "PIS/COFINS Retidos",
    2: "PIS/COFINS Não Retidos",
    3: "PIS/COFINS/CSLL Retidos",
    4: "PIS/COFINS Retidos, CSLL Não Retido",
    5: "PIS Retido, COFINS/CSLL Não Retido",
    6: "COFINS Retido, PIS/CSLL Não Retido",
    7: "PIS Não Retido, COFINS/CSLL Retidos",
    8: "PIS/COFINS Não Retidos, CSLL Retido",
    9: "COFINS Não Retido, PIS/CSLL Retidos",
  }),
});

/**
 * Resolve a descrição de um código.
 *
 * @returns {{resolvido: boolean, texto: string|null, motivo?: string}}
 *   `resolvido: false` NÃO é erro — é a resposta honesta enquanto o leiaute não estiver no repo.
 *   `texto` devolve o código cru para que o campo não fique vazio (nota 12 pede traço só para
 *   campo SEM informação; aqui a informação existe, o que falta é a tradução dela).
 */
export function descreverCodigo(tag, codigo) {
  const valor = codigo == null ? "" : String(codigo).trim();
  if (!valor) return { resolvido: false, texto: null, motivo: "campo ausente no XML" };

  const tabela = DESCRICOES[tag];
  if (!tabela) {
    return { resolvido: true, texto: valor };
  }

  const descricao = tabela[valor];
  if (descricao) return { resolvido: true, texto: descricao };

  // ⚠ O MOTIVO MUDOU DE SIGNIFICADO EM 24/08/2026, e a frase antiga ficaria FALSA: ela dizia que o
  // leiaute "não está versionado neste repositório". Está. Hoje chegar aqui quer dizer outra coisa
  // — o código do XML **não existe na enumeração oficial**, o que é sinal de nota fora do padrão
  // ou de versão de leiaute que o projeto ainda não leu. A resposta continua a mesma (código cru,
  // art. 13 respeitado), mas quem lê o relatório precisa procurar no lugar certo.
  return {
    resolvido: false,
    texto: valor,
    motivo:
      `O código "${valor}" não consta da enumeração oficial de "${tag}" ` +
      `(docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/). Imprimindo o código cru — ` +
      `traduzi-lo por aproximação seria fabricar tabela de código fiscal.`,
  };
}

/** Tags que a NT manda descrever — usada pelo gerador para montar o relatório de conformidade. */
export const TAGS_CODIFICADAS = Object.freeze(Object.keys(DESCRICOES));
