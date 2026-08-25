// ⚠⚠ ESPELHO — ESTE ARQUIVO TEM UMA CÓPIA DELIBERADA NO PORTAL DO CLIENTE.
//
//   `apps/portal-cliente-web/src/features/emitir/lib/cargaTributaria.js`
//
// ⚠⚠ ESPELHO PARCIAL — só `lerPercentualCarga`. As outras 10 funções deste arquivo são do CADASTRO
// (código de serviço, série de RPS, benefício municipal, `faltasParaEmitir`), tela do contador, e
// NÃO devem viajar para lá.
//
// ⚠ Os dois frontends NÃO compartilham código; a obrigação de sincronizar é de quem edita, e a
// tabela "mudou lá, muda aqui" vive em `apps/portal-cliente-web/CLAUDE.md`. ⚠ Duas leituras da
// mesma regra divergem na primeira correção — e a divergência aparece como as duas telas afirmando
// coisas diferentes sobre a MESMA empresa, que é o defeito mais caro de achar.
//
// ⚠ Este aviso foi acrescentado em 24/08/2026: até então **12 dos 13 originais eram mudos** sobre
// ter cópia, e a tabela do `CLAUDE.md` só é consultada por quem já sabe que ela existe.

// A CONFIGURAÇÃO QUE A EMISSÃO DE NFS-e EXIGE — a regra de tela, num lugar só.
//
// ⚠ POR QUE ESTE MÓDULO EXISTE. `buildMissingFields` (`api/application/nfse/NfseService.js`) recusa
// a emissão quando faltar `cnpj`, `inscricaoMunicipal`, `codigoServicoNacional`,
// `codigoServicoMunicipal` ou `rpsSerie`. Os três últimos existiam na coluna e na API e **não
// tinham campo em tela nenhuma**: a emissão recusava por eles e não havia por onde preenchê-los.
// A porta é o formulário da empresa; este arquivo é a regra que o formulário e o assistente de
// emissão compartilham, para que os dois digam a MESMA coisa sobre a mesma empresa.
//
// ⚠ O QUE ESTE MÓDULO DELIBERADAMENTE NÃO FAZ: sugerir, derivar ou completar código de serviço.
//   • a lista de códigos do **município** não está neste repositório;
//   • o CNAE da empresa **não** determina nenhum dos dois códigos.
// Escrever a lista municipal de memória, ou deduzi-la do CNAE, é o que a regra 1 do projeto proíbe
// — e o erro sairia como nota emitida com o serviço errado, que é silencioso e caro. Por isso aqui
// só se valida **FORMA**, e apenas a forma que uma fonte já versionada no repositório prova. Nada é
// pré-preenchido: campo vazio é a verdade sobre uma empresa não configurada.
//
// ⚠ O CÓDIGO NACIONAL SAIU DAQUI (16/08/2026) e virou lista de escolhas. A razão do campo digitado
// era literal — *"a lista de serviços da LC 116 não está neste repositório"* — e deixou de valer: o
// Anexo B oficial do portal `gov.br/nfse` está versionado em `docs/lista-servico-nacional/` com
// hash, e a regra dele mora em `lib/servicosNacionais/servicoNacional.js`. `lerCodigoServicoNacional`
// continua aqui porque o valor gravado (o código que a DPS leva) ainda é lido como texto único.
//
// ⚠ Sem crase nem markdown nas strings: elas vão para a TELA, que não renderiza markdown.

// ── FAIXA DA SÉRIE ──────────────────────────────────────────────────────────────────────────
//
// **RN E0010** (Anexo I do Padrão Nacional): `00001–49999` é a faixa do emissor por **aplicativo
// próprio**, que é o que este sistema é. As outras faixas pertencem ao Emissor Móvel, ao Emissor
// Web e à transcrição — usar uma delas é rejeição, não detalhe cosmético.
//
// ⚠ A AUTORIDADE É `apps/api/src/application/nfse/nfseNumeracao.js` (`SERIE_MIN`/`SERIE_MAX`).
// Front e back não compartilham código, então os dois inteiros vivem nos dois lados; no backend há
// teste amarrando a duplicação (`routes/firm/__tests__/companyCamposNfse.test.js`). Mudou a faixa
// lá, muda aqui — senão a tela aceita o que o servidor recusa, ou o contrário.
export const SERIE_MIN = 1;
export const SERIE_MAX = 49999;

// Quantos dígitos do código municipal entram no XML da DPS (`buildDpsXml` faz `.slice(-3)`).
export const DIGITOS_CTRIB_MUN_NA_DPS = 3;

export const TAMANHO_CTRIB_NAC = 6;

// ── O QUE CADA CAMPO É, em português, para quem preenche ─────────────────────────────────────

export const MOTIVO_CODIGO_SERVICO_NACIONAL =
  "É o código nacional do serviço (o campo “cTribNac” da DPS). Tem 6 dígitos numéricos.";

export const MOTIVO_CODIGO_SERVICO_MUNICIPAL =
  "É o código do serviço na lista do seu município (o campo “cTribMun” da DPS).";

// ⚠ O TEXTO MUDOU JUNTO COM O COMPORTAMENTO (16/08/2026). A série passou a ser LIDA da última nota
// emitida — inclusive das emitidas fora deste portal, que chegam pela captura do ADN. Este campo
// virou o PONTO DE PARTIDA, e dizer que ele "é a série" faria o contador achar que mudar aqui muda
// a numeração de uma empresa que já emite. Ver `apps/api/src/application/nfse/nfseNumeracao.js`.
export const MOTIVO_RPS_SERIE =
  "A série da nota é lida automaticamente da última NFS-e desta empresa, inclusive das emitidas "
  + "fora deste sistema. Este campo é o PONTO DE PARTIDA: vale na primeira emissão (quando ainda "
  + "não há nota de onde ler) e quando a última nota está numa faixa de outro tipo de emissor. A RN "
  + `E0010 reserva a faixa ${SERIE_MIN} a ${SERIE_MAX} para quem emite por aplicativo próprio, que é `
  + "o caso aqui.";

// Por que o código MUNICIPAL continua digitado, agora que o nacional virou lista. Fica junto do
// campo: quem preenche precisa saber que ninguém vai conferir isto depois por ele.
export const PORQUE_MUNICIPAL_DIGITADO =
  "Não existe lista nacional de códigos municipais — cada prefeitura publica a sua, e nenhuma está "
  + "neste sistema. Por isso este código é digitado por você e nada aqui confere o CONTEÚDO — só o "
  + "formato.";

export const PROBLEMA_CTRIB_NAC =
  `o código nacional do serviço tem exatamente ${TAMANHO_CTRIB_NAC} dígitos (ex.: 171201)`;

export const PROBLEMA_CTRIB_MUN =
  "o código municipal do serviço é numérico — informe só os dígitos";

export const PROBLEMA_RPS_SERIE =
  `a série da DPS é numérica e tem de estar entre ${SERIE_MIN} e ${SERIE_MAX} (RN E0010, emissor `
  + "por aplicativo próprio)";

// ── LEITURAS ────────────────────────────────────────────────────────────────────────────────
//
// Todas devolvem a mesma forma de `lerCodigoMunicipioIbge` (`lib/municipios/municipioIbge.js`):
// `{ preenchido, valor, problema }`. Vazio NÃO é problema — é ausência, e quem responde por ela é
// `faltasParaEmitir`. Confundir as duas coisas faria o formulário gritar em toda empresa que ainda
// não emite NFS-e, que é a maioria da carteira.

function vazio() {
  return { preenchido: false, valor: null, problema: null };
}

/**
 * `cTribNac` — 6 dígitos numéricos.
 *
 * Fonte, dentro do projeto: `docs/nfse-preenchimento.md` §5 ("cTribNac: código nacional (6 dígitos
 * numéricos). Ex.: 171201"), §11, e o exemplo do §12 — a única emissão que este projeto já produziu
 * com `status:"issued"`.
 */
export function lerCodigoServicoNacional(entrada) {
  const texto = String(entrada ?? "").trim();
  if (!texto) return vazio();
  const digitos = texto.replace(/\D+/g, "");
  if (digitos.length !== TAMANHO_CTRIB_NAC) {
    return { preenchido: true, valor: null, problema: PROBLEMA_CTRIB_NAC };
  }
  return { preenchido: true, valor: digitos, problema: null };
}

/**
 * `cTribMun` — só dígitos, **sem exigência de comprimento**.
 *
 * ⚠ O QUE A FONTE PROVA E O QUE ELA NÃO PROVA. `docs/nfse-preenchimento.md` §5 diz "cTribMun:
 * código municipal (últimos 3 dígitos). Ex.: 001", e `buildDpsXml` faz literalmente
 * `.replace(/\D+/g,"").slice(-3)`. Isso descreve **o que vai no XML**, não o comprimento do código
 * que a prefeitura publica. Exigir exatamente 3 aqui seria inventar uma máscara e recusar um código
 * municipal legítimo mais longo — então não se exige. O que a tela FAZ é mostrar quais dígitos vão
 * para a DPS (ver `digitosQueVaoParaDps`), para que o corte não seja descoberto na rejeição.
 */
export function lerCodigoServicoMunicipal(entrada) {
  const texto = String(entrada ?? "").trim();
  if (!texto) return vazio();
  const digitos = texto.replace(/\D+/g, "");
  if (!digitos) return { preenchido: true, valor: null, problema: PROBLEMA_CTRIB_MUN };
  return { preenchido: true, valor: digitos, problema: null };
}

/**
 * Os dígitos do código municipal que **de fato** entram na DPS.
 *
 * ⚠ Isto não é uma regra nova: é o espelho do `.slice(-3)` que o backend já faz. Um corte que a
 * tela não anuncia vira "informei 10203 e a nota saiu com 203", descoberto depois da emissão.
 */
export function digitosQueVaoParaDps(entrada) {
  const leitura = lerCodigoServicoMunicipal(entrada);
  if (!leitura.valor) return null;
  return leitura.valor.slice(-DIGITOS_CTRIB_MUN_NA_DPS);
}

/**
 * Série da DPS — numérica, na faixa da RN E0010.
 *
 * ⚠ MESMA NORMALIZAÇÃO DO BACKEND (`normalizarSerie`): o valor gravado tem 5 dígitos com zeros à
 * esquerda, porque é essa a forma que entra no XML e no `Id` da DPS. "1" e "00001" são a MESMA
 * série; guardar as duas escritas faria a empresa parecer ter duas.
 *
 * ⚠ A conversão "letra vira número" (`UNICA` → 21, pelo `U`) foi abandonada no backend de
 * propósito: série é identificação fiscal e não se traduz sozinha. Aqui vale o mesmo — texto é
 * recusa, nunca conversão.
 */
export function lerRpsSerie(entrada) {
  const texto = String(entrada ?? "").trim();
  if (!texto) return vazio();
  if (!/^\d+$/.test(texto)) return { preenchido: true, valor: null, problema: PROBLEMA_RPS_SERIE };
  const n = Number(texto);
  if (!Number.isInteger(n) || n < SERIE_MIN || n > SERIE_MAX) {
    return { preenchido: true, valor: null, problema: PROBLEMA_RPS_SERIE };
  }
  return { preenchido: true, valor: String(n).padStart(5, "0"), problema: null };
}

// ── CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012) — só da empresa NÃO OPTANTE ────────────────
//
// Pedido do dono (18/08/2026): *"precisamos emitir para simples nacional também, as alíquotas
// efetivas do presumido não precisam ser calculadas a não ser o ISS que varia de município, mas
// deve ser configurado do lado do contador, no portal do contador."*
//
// ⚠ NADA É CALCULADO AQUI, e não é limitação de tela: não existe de-para CNAE→presunção neste
// repositório (está escrito em `features/companies/CLAUDE.md`), e errar entre 8% e 32% inverteria
// a comparação. O contador digita; o sistema guarda e usa.
//
// ⚠ E ESTE NÚMERO VAI IMPRESSO AO TOMADOR. É a Lei da Transparência: o DANFSe imprime "Totais
// Aproximados de Tributos" na linha fixa de Informações Complementares. Não é preenchimento
// técnico — é uma afirmação sobre quanto de tributo há no preço.

export const CAMPOS_CARGA_TRIBUTARIA = [
  { campo: "pTotTribFed", rotulo: "Federal", curto: "federal" },
  { campo: "pTotTribEst", rotulo: "Estadual", curto: "estadual" },
  { campo: "pTotTribMun", rotulo: "Municipal (ISS)", curto: "municipal" },
];

export const MOTIVO_CARGA_TRIBUTARIA =
  "São os percentuais de tributos aproximados que a nota declara ao tomador (Lei 12.741/2012, a Lei "
  + "da Transparência) — o grupo “totTrib/pTotTrib” da DPS. Valem para a empresa que NÃO é optante "
  + "do Simples Nacional: a optante declara a alíquota efetiva do PGDAS-D na hora de emitir, e não "
  + "usa estes campos.";

// Por que o sistema não calcula. Fica junto do campo, porque quem preenche precisa saber que
// ninguém vai conferir isto depois por ele.
export const PORQUE_CARGA_DIGITADA =
  "Este sistema não calcula nenhum destes percentuais e não os deduz do CNAE nem do regime. Eles "
  + "são seus, e vão impressos na nota que o seu cliente entrega ao tomador.";

// ⚠ O QUE A TELA PRECISA DIZER SOBRE O ZERO, e é o coração do conserto de 18/08/2026.
export const PORQUE_OS_TRES =
  "Os três são obrigatórios juntos, inclusive quando algum é 0,00 — e 0,00 é comum (serviço não tem "
  + "ICMS, então o estadual costuma ser zero). Preencher só um faria a nota AFIRMAR carga zero nos "
  + "outros dois, e o sistema não escreve esse zero por você: sem os três, a emissão é recusada.";

export const PROBLEMA_PERCENTUAL_CARGA =
  "informe um percentual entre 0 e 100, com até duas casas (ex.: 11,33)";

/**
 * Um percentual da carga aproximada — 0 a 100, até duas casas.
 *
 * ⚠ Vírgula E ponto são aceitos como separador DECIMAL. Percentual de 0 a 100 não tem separador de
 * milhar, então não há a ambiguidade que obriga o normalizador de moeda do backend
 * (`asNumberOrNull`) a tratar ponto como milhar — e é por isso que ele NÃO é reusado aqui: ele
 * transformaria "11.33" em 1133.
 *
 * ⚠ Vazio NÃO é problema — é ausência, e quem responde por ela é `faltasDaCargaTributaria`.
 * Pintar de vermelho toda empresa que ainda não configurou (a maioria da carteira) faria o aviso
 * virar ruído.
 */
export function lerPercentualCarga(entrada) {
  const texto = String(entrada ?? "").trim();
  if (!texto) return vazio();
  const normalizado = texto.replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalizado)) {
    return { preenchido: true, valor: null, problema: PROBLEMA_PERCENTUAL_CARGA };
  }
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { preenchido: true, valor: null, problema: PROBLEMA_PERCENTUAL_CARGA };
  }
  // ⚠ Devolve NÚMERO, e `0` é um valor legítimo — quem consumir isto não pode usar `||`.
  return { preenchido: true, valor: n, problema: null };
}

// ONDE SE PREENCHE — UMA constante, porque o caminho já mudou duas vezes em dois dias.
//
// ⚠ 19/08/2026: era "Editar cadastro → Emissão de NFS-e" (um bloco dentro do formulário). O bloco
// virou tela própria e, no mesmo dia, o dono trocou a ENTRADA dela: *"deve ser uma engrenagem de
// configuração na aba Notas Fiscais"*. Estas frases dizem ao contador ONDE resolver — apontar para
// "Editar cadastro" hoje é mandá-lo a uma tela onde os campos não estão mais. Por isso todas as
// ocorrências passaram a sair daqui: espalhadas, sobreviveriam à próxima mudança de lugar.
export const ONDE_CONFIGURA_EMISSAO = "Notas Fiscais → ⚙ Configuração de emissão";
// ⚠ A `correcao` que o SERVIDOR manda ainda diz "Editar cadastro → Emissão de NFS-e → Carga
// tributária aproximada" (`apps/api`), e ela VENCE este texto quando chega. Está reportado: o
// caminho do servidor precisa da mesma troca. Enquanto isso, o texto local diz a verdade da tela
// de hoje — e o do servidor, quando chega, leva a um lugar que ainda existe (o cadastro), só que
// sem os campos. Menos errado que duas telas inventadas.
export const ONDE_CARGA_TRIBUTARIA = `${ONDE_CONFIGURA_EMISSAO} → Carga tributária aproximada`;

/**
 * Quais dos três percentuais faltam.
 *
 * ⚠ ESPELHO do portão de `buildDpsXml` (`MISSING_TOT_TRIB_NAO_SIMPLES`), que exige os TRÊS. Mudou
 * lá, muda aqui — senão a tela promete um desfecho e o servidor entrega outro.
 *
 * ⚠ Campo com valor INVÁLIDO não conta como faltando: ele é recusado ao salvar, com o motivo, e
 * não chega gravado. Mesma disciplina de `faltasParaEmitir`.
 *
 * ⚠ Cada falta viaja com `onde` e `motivoCurto`, na MESMA forma de `faltasParaEmitir`: o
 * assistente de emissão mostra as duas listas lado a lado no passo 1, e uma delas dizendo só o
 * nome do campo mandaria o contador procurar onde a outra já diz.
 */
export function faltasDaCargaTributaria(valores) {
  const dados = valores || {};
  return CAMPOS_CARGA_TRIBUTARIA
    .filter((c) => !lerPercentualCarga(dados[c.campo]).preenchido)
    .map((c) => ({
      ...c,
      onde: ONDE_CARGA_TRIBUTARIA,
      motivoCurto: `cadastre a parcela ${c.curto} da carga tributária aproximada (${ONDE_CARGA_TRIBUTARIA})`,
    }));
}

// ── O QUE FALTA PARA A EMPRESA EMITIR ───────────────────────────────────────────────────────

/**
 * ⚠ ESPELHO EXATO de `REQUIRED_COMPANY_FIELDS` (`api/application/nfse/NfseService.js`), na MESMA
 * ordem. A recusa do servidor devolve `{ error: "company_missing_fields", missing: [...] }` com
 * estes nomes; a tela existe para que ninguém precise ler esse JSON.
 *
 * ⚠ Mudou lá, muda aqui — senão a tela promete um desfecho e o servidor entrega outro.
 *
 * `codigoMunicipioIbge` NÃO está nesta lista de propósito: ele não é exigido por
 * `buildMissingFields`, e sim por `resolverCLocEmi`, com recusa própria
 * (`NFSE_MUNICIPIO_NAO_CONFIGURADO`). Ele tem regra própria em `lib/municipios/municipioIbge.js`.
 */
export const CAMPOS_EXIGIDOS_PARA_EMITIR = [
  {
    campo: "cnpj",
    rotulo: "CNPJ da empresa",
    onde: "Editar cadastro → Identificação",
    motivo:
      "O CNPJ do prestador vai no identificador da DPS. Sem ele o servidor recusa a emissão inteira.",
  },
  {
    campo: "inscricaoMunicipal",
    rotulo: "Inscrição municipal",
    onde: "Editar cadastro → Inscrições",
    motivo:
      "A inscrição municipal do prestador é exigida pelo emissor antes de montar a nota. Sem ela o "
      + "servidor recusa a emissão inteira.",
  },
  {
    campo: "codigoServicoNacional",
    rotulo: "Código nacional do serviço",
    onde: ONDE_CONFIGURA_EMISSAO,
    motivo:
      "É o “cTribNac” da nota — o serviço que está sendo declarado. Sem ele o servidor recusa a "
      + "emissão inteira. Escolha na lista oficial (Anexo B do portal nacional da NFS-e); a empresa "
      + "pode ter mais de um código cadastrado.",
  },
  {
    campo: "codigoServicoMunicipal",
    rotulo: "Código municipal do serviço",
    onde: ONDE_CONFIGURA_EMISSAO,
    motivo:
      "É o “cTribMun” da nota — o mesmo serviço, na lista do seu município. Sem ele o servidor "
      + "recusa a emissão inteira, e o sistema não tem a lista do município para sugerir nada.",
  },
  {
    campo: "rpsSerie",
    rotulo: "Série da DPS",
    onde: ONDE_CONFIGURA_EMISSAO,
    motivo:
      "É o ponto de partida da numeração. A série é lida da última nota emitida, mas na PRIMEIRA "
      + "emissão não há nota de onde ler — e aí vale esta, na faixa "
      + `${SERIE_MIN}–${SERIE_MAX} da RN E0010. Ela é escolha sua e não tem valor padrão: uma série `
      + "chutada muda o identificador de toda nota emitida.",
  },
];

/**
 * O que impede esta empresa de emitir, na ordem do servidor.
 *
 * Recebe o objeto da empresa (o `legacyCompany`, onde estas colunas vivem) e devolve a lista do que
 * falta — vazia quando está tudo lá. Presença é medida como o servidor mede: `!company[campo]`,
 * nada mais. Um campo com valor inválido **não** é "faltando": ele foi recusado no cadastro, na
 * hora de salvar, com o motivo — não chega gravado até aqui.
 */
export function faltasParaEmitir(company) {
  const dados = company || {};
  return CAMPOS_EXIGIDOS_PARA_EMITIR
    .filter((c) => !dados[c.campo])
    .map((c) => ({
      ...c,
      // Versão curta, para a lista de pendências do assistente — o parágrafo inteiro repetido em
      // dois lugares na mesma tela faz o olho pular os dois.
      motivoCurto: `cadastre ${c.rotulo.toLowerCase()} da empresa (${c.onde})`,
    }));
}

// ── BENEFÍCIO MUNICIPAL DO ISSQN (grupo `BM` da DPS) — dono, 20/08/2026 ─────────────────────
//
// > *"do lado do contador ainda, o seletor de benefício, caso o cliente tenha algum benefício
// > fiscal."*
//
// ⚠⚠ BENEFÍCIO FISCAL REDUZ IMPOSTO, e é isso que faz este bloco ser mais duro que os de cima.
// Três consequências, todas escritas na tela:
//   1. o número do benefício é do MUNICÍPIO — cada prefeitura concede o seu, e o identificador é
//      gerado pelo Sistema Nacional quando ela o cadastra. Não existe lista neste repositório, não
//      se deduz do CNAE e não se sugere valor. **Valida-se a FORMA, nunca o conteúdo** — a mesma
//      regra do `cTribMun`, e a tela DIZ que não confere o conteúdo;
//   2. as duas reduções (valor monetário × percentual) são EXCLUDENTES e a escolha não é nossa;
//   3. ⚠⚠ **nada disto chega ao XML hoje** — e a tela diz isso também, porque um contador que
//      configura um benefício e não é avisado passa a acreditar que a nota sai com redução.
//
// FONTE (versionada com hash em `docs/leiaute-nfse/documentacao-tecnica/`):
//   • `tiposComplexos_v1.01.xsd:1931` — `TCBeneficioMunicipal`: `nBM` (1-1) + `xs:choice` entre
//     `vRedBCBM` e `pRedBCBM`, **os dois `minOccurs="0"`**;
//   • `tiposSimples_v1.01.xsd:957` — `TSNumBeneficioMunicipal`: `<xs:pattern value="[0-9]{14}"/>`,
//     com a regra de formação (7 IBGE + 2 tipo de parametrização + 5 sequencial) na documentação
//     do próprio tipo;
//   • ANEXO_I, aba `RN DPS_NFS-e`: `E0541` (o número não existe para o município de incidência),
//     `E0565`/`E0577` (cada redução só vale para o TIPO correspondente do benefício), `E0533` (o
//     grupo `BM` só é permitido em operação tributável).

export const TAMANHO_NBM = 14;

/**
 * Os três tipos, e por que o tipo é DECLARADO em vez de deduzido do campo preenchido.
 *
 * `E0565` e `E0577` dizem que cada campo de redução só é permitido quando o `nBM` for de um
 * benefício **daquele tipo** — atributo da concessão do município, que este sistema não tem. E
 * `SEM_REDUCAO` existe porque benefício que não reduz base é legítimo (o `xs:choice` tem os dois
 * filhos opcionais; o `E0612` cita "Isenção" e "Alíquota Diferenciada"). Sem esta opção, "ainda não
 * preenchi" e "este benefício não reduz base" ficariam indistinguíveis.
 */
export const TIPOS_REDUCAO_BM = [
  {
    valor: "SEM_REDUCAO",
    rotulo: "Não reduz a base de cálculo",
    ajuda:
      "É o caso de benefício de isenção ou de alíquota diferenciada, por exemplo — o benefício "
      + "existe e é declarado, mas não entra redução de base na nota.",
  },
  {
    valor: "VALOR",
    rotulo: "Reduz por VALOR (R$)",
    ajuda:
      "O valor da redução é de cada nota (ele depende da base daquela nota), então não se cadastra "
      + "aqui: o que fica registrado é que o benefício é deste tipo.",
  },
  {
    valor: "PERCENTUAL",
    rotulo: "Reduz por PERCENTUAL (%)",
    ajuda: "O percentual vale para qualquer nota, então é ele que se cadastra aqui.",
  },
];

export const MOTIVO_BENEFICIO_MUNICIPAL =
  "Se o município concedeu algum benefício de ISSQN a esta empresa, é aqui que o número dele fica "
  + "guardado — é o grupo “BM” da DPS.";

// Fica junto do campo: quem preenche precisa saber que ninguém vai conferir isto depois por ele.
export const PORQUE_BENEFICIO_DIGITADO =
  "O número é do MUNICÍPIO: cada prefeitura concede o seu, e o identificador é gerado pelo Sistema "
  + "Nacional quando ela cadastra o benefício. Não existe lista nacional neste sistema — este campo "
  + "é digitado por você, nada aqui confere o CONTEÚDO (só o formato), e quem recusa um número "
  + "inexistente é o fisco, na hora de emitir.";

// ⚠⚠ A FRASE QUE IMPEDE A CRENÇA FALSA. Sem ela, configurar o benefício e ver a nota sair com o
// imposto cheio é uma descoberta que só acontece depois da emissão.
export const BENEFICIO_NAO_VAI_NO_XML =
  "⚠ Este cadastro ainda NÃO chega à nota: o XML da DPS que este sistema monta não leva o grupo "
  + "“BM”, então a nota continua saindo com o ISS cheio, sem a redução. O que você preencher aqui "
  + "fica guardado para quando o envio existir.";

export const PROBLEMA_NBM =
  `o número do benefício municipal tem exatamente ${TAMANHO_NBM} dígitos (7 do município + 2 do `
  + "tipo + 5 sequenciais)";

export const PROBLEMA_P_RED_BC =
  "informe um percentual entre 0 e 100, com até duas casas (ex.: 40,00)";

/**
 * `nBM` — 14 dígitos.
 *
 * ⚠ A máscara do ofício da prefeitura não é recusada: só os DÍGITOS contam, como no `cTribMun` e no
 * `cTribNac`. Vazio NÃO é problema — é ausência (a maioria das empresas não tem benefício nenhum),
 * e pintar de vermelho quem não tem faria o aviso virar paisagem.
 */
export function lerNumeroBeneficioMunicipal(entrada) {
  const texto = String(entrada ?? "").trim();
  if (!texto) return vazio();
  const digitos = texto.replace(/\D+/g, "");
  if (digitos.length !== TAMANHO_NBM) {
    return { preenchido: true, valor: null, problema: PROBLEMA_NBM };
  }
  return { preenchido: true, valor: digitos, problema: null };
}

/**
 * `pRedBCBM` — percentual de 0 a 100, até duas casas.
 *
 * ⚠ Vírgula E ponto como separador DECIMAL, pelo mesmo motivo de `lerPercentualCarga`: percentual
 * não tem separador de milhar, então não existe a ambiguidade que obriga o campo de VALOR da nota
 * a ter máscara de centavos. ⚠ Devolve NÚMERO, e `0` é legítimo — não usar `||` com isto.
 */
export function lerPercentualReducaoBM(entrada) {
  const texto = String(entrada ?? "").trim();
  if (!texto) return vazio();
  const normalizado = texto.replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalizado)) {
    return { preenchido: true, valor: null, problema: PROBLEMA_P_RED_BC };
  }
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { preenchido: true, valor: null, problema: PROBLEMA_P_RED_BC };
  }
  return { preenchido: true, valor: n, problema: null };
}

/**
 * Os tipos de parametrização, na letra da documentação do `TSNumBeneficioMunicipal`.
 *
 * ⚠ ESTA LISTA NÃO DECIDE NADA — ela só TRADUZ os dois dígitos do meio do número para o contador
 * conferir o que digitou, do mesmo jeito que a tela mostra quais 3 dígitos do `cTribMun` vão para a
 * DPS. Um código fora dela não é recusado: a forma oficial é `[0-9]{14}` e mais nada.
 */
const TIPOS_PARAMETRIZACAO_NBM = {
  "01": "legislação",
  "02": "regimes especiais",
  "03": "retenções",
  "04": "outros benefícios",
};

/**
 * Quebra o `nBM` nas três partes que a fonte descreve, para CONFERÊNCIA.
 *
 * @returns {null|{municipioIbge: string, tipo: string, tipoRotulo: string|null, sequencial: string}}
 */
export function decomporNumeroBeneficioMunicipal(entrada) {
  const leitura = lerNumeroBeneficioMunicipal(entrada);
  if (!leitura.valor) return null;
  const tipo = leitura.valor.slice(7, 9);
  return {
    municipioIbge: leitura.valor.slice(0, 7),
    tipo,
    tipoRotulo: TIPOS_PARAMETRIZACAO_NBM[tipo] || null,
    sequencial: leitura.valor.slice(9),
  };
}

/**
 * O que está incoerente no benefício — ESPELHO das recusas de `normalizeCamposEmissaoNfse`.
 *
 * ⚠ Mudou lá, muda aqui: senão a tela promete um desfecho e o servidor entrega outro. Cada linha
 * carrega o código de erro que o backend devolve, para que os dois lados sejam conferíveis.
 *
 * ⚠ Campo com FORMA inválida não entra aqui — quem fala dele é a leitura, no próprio campo.
 */
export function problemasDoBeneficioMunicipal({ numero, tipoReducao, pRedBC } = {}) {
  const nBM = lerNumeroBeneficioMunicipal(numero);
  const perc = lerPercentualReducaoBM(pRedBC);
  const tipo = String(tipoReducao ?? "").trim();
  const problemas = [];

  // `nBM` é `1-1` DENTRO do grupo `BM`: tipo ou percentual sozinho descreveria uma redução de
  // imposto que não aponta para concessão nenhuma.
  if ((tipo || perc.preenchido) && !nBM.preenchido) {
    problemas.push({
      erro: "company_beneficio_municipal_sem_numero",
      texto:
        "Informe o número do benefício municipal — sem ele não há benefício a declarar, e o "
        + "servidor recusa o cadastro.",
    });
  }
  // `E0577`: o percentual só é permitido quando o benefício é do tipo redução por percentual.
  if (perc.preenchido && tipo && tipo !== "PERCENTUAL") {
    problemas.push({
      erro: "company_beneficio_municipal_percentual_fora_do_tipo",
      texto:
        "O percentual de redução só vale para benefício do tipo “Reduz por PERCENTUAL”. Qual dos "
        + "dois campos se preenche depende de como o município cadastrou o benefício (regras E0565 "
        + "e E0577) — eles não são intercambiáveis.",
    });
  }
  if (tipo === "PERCENTUAL" && !perc.preenchido) {
    problemas.push({
      erro: "company_beneficio_municipal_percentual_ausente",
      texto:
        "Informe o percentual de redução da base de cálculo — declarar que o benefício reduz por "
        + "percentual e não dizer quanto deixa o cadastro pela metade.",
    });
  }
  // ⚠ Número SEM tipo: pendência, não recusa. O servidor grava (o tipo é opcional na coluna), mas
  // o cadastro fica sem dizer o que o benefício faz — e é o que decide se a redução entra na nota.
  if (nBM.preenchido && !tipo) {
    problemas.push({
      erro: null,
      texto:
        "Escolha o que este benefício faz com a base de cálculo. Não dá para deduzir isso do "
        + "número: é atributo da concessão do município.",
    });
  }
  return problemas;
}
