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
    onde: "Editar cadastro → Emissão de NFS-e",
    motivo:
      "É o “cTribNac” da nota — o serviço que está sendo declarado. Sem ele o servidor recusa a "
      + "emissão inteira. Escolha na lista oficial (Anexo B do portal nacional da NFS-e); a empresa "
      + "pode ter mais de um código cadastrado.",
  },
  {
    campo: "codigoServicoMunicipal",
    rotulo: "Código municipal do serviço",
    onde: "Editar cadastro → Emissão de NFS-e",
    motivo:
      "É o “cTribMun” da nota — o mesmo serviço, na lista do seu município. Sem ele o servidor "
      + "recusa a emissão inteira, e o sistema não tem a lista do município para sugerir nada.",
  },
  {
    campo: "rpsSerie",
    rotulo: "Série da DPS",
    onde: "Editar cadastro → Emissão de NFS-e",
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
