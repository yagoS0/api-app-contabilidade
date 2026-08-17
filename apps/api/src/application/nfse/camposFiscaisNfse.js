// OS CAMPOS QUE A AUDITORIA PRECISA E QUE SÓ VIVEM DENTRO DO XML.
//
// ─── O PEDIDO DO DONO (17/08/2026) ──────────────────────────────────────────────────────────
//
// > *"para resolver a série precisamos ler o XML? precisamos trazer os XMLs das notas, percebi que
// > isso resolve muitas coisas, e nos ajuda em uma auditoria pré-apuração para entender se a nota
// > está correta ou não, baseado na atividade e baseado na data de emissão."*
//
// ⚠ **NÃO HÁ NADA A "TRAZER".** Medido em produção (17/08/2026, só leitura,
// `scripts/diag-cobertura-xml-notas.mjs`): EMIT 14.946 notas com **100%** de `xmlRaw`; DEST 1.846
// com 98% (40 sem). O XML já está todo lá. O que falta é **extrair para coluna consultável** o que
// hoje só existe dentro do texto — e é isso, e só isso, que este módulo faz.
//
// ─── ⚠ LEITURA POR CAMINHO, NUNCA POR NOME DE TAG ───────────────────────────────────────────
//
// `utils/xml.js` tem `getTextByLocalNames`, que devolve o **primeiro** elemento com aquele nome no
// **documento inteiro**. O XML da NFS-e tem `CNPJ` em quatro grupos (`emit`, `prest`, `toma`,
// `interm`), `xNome` em quatro, `cMun` em cinco e **`vBC` em dois** (`infNFSe/valores` e
// `IBSCBS/valores`). Num metadado isso é um campo torto; aqui seria a auditoria acusando a nota
// errada — dizer que a alíquota do ISS está errada porque se leu a base de cálculo do IBS/CBS.
//
// ⚠ E ISSO NÃO É HIPÓTESE NESTE PROJETO: `AdnXmlMetadata.parseXmlMetadata` extrai `codigoServico`
// exatamente assim (`getTextByLocalNames(servicoNode|infNfse|doc, ["cTribNac", …])`) e é dele que
// sai `NotaItem.codigoServico`. Este módulo **não substitui aquele caminho e não o toca** — ele lê
// por caminho, para a coluna nova, e o script de backfill **compara os dois** e relata a
// divergência em vez de escolher um vencedor em silêncio.
//
// ─── DE ONDE SAI CADA CAMPO ─────────────────────────────────────────────────────────────────
//
// A fonte dos caminhos é `danfse/danfseLeiaute.js`, que é a **transcrição da NT SE/CGNFS-e nº 008
// v1.02 §2.4.5** (campo a campo, com o caminho no XML de cada um). Nada aqui foi deduzido por
// analogia, e nenhum caminho foi redescoberto: a constante `CAMPOS` abaixo aponta, em
// `leiauteCampoId`, a linha do leiaute de onde ele veio, e o teste
// `__tests__/camposFiscaisNfse.test.js` confere os dois com `campoPorId()`.
//
// A série e o número da DPS **não são relidos aqui**: quem os lê é `nfseUltimaNota.js`
// (`lerSerieENumeroDaDps`), escrito hoje para a numeração automática. Uma segunda leitura dos
// mesmos dois campos divergiria da primeira na primeira correção de leiaute — e a numeração da
// emissão passaria a discordar da coluna que a auditoria lê.
//
// ─── ⚠ LEIAUTE 1.01 × 2.0 ───────────────────────────────────────────────────────────────────
//
// A NT 008 descreve o DANFSe **v2.0**, multitributário, e boa parte dela sai dos grupos `IBSCBS`,
// que **não existem no leiaute 1.01** — que é o das notas que este projeto captura
// (`danfseLeiaute.CAMPOS_SEM_FONTE_NO_LEIAUTE_1_01`). Nenhum dos campos extraídos aqui vem de
// `IBSCBS`, de propósito. Campo ausente sai **`null`** — não zero, não string vazia.
//
// ─── ⚠ NF-e NÃO PASSA POR AQUI ──────────────────────────────────────────────────────────────
//
// O XML da NF-e é outro documento (`nfeProc/NFe/infNFe`, lido por `notas/dfe/DfeParser.js`): não
// tem `infNFSe`, não tem `cTribNac`, não tem DPS e o ISSQN não é o imposto dele. Aplicar este
// leiaute a uma NF-e devolveria tudo nulo — indistinguível de "NFS-e cujo XML não deu para ler".
// Por isso a ausência de `infNFSe` **recusa com motivo nomeado** (`NAO_E_NFSE`) em vez de devolver
// um resultado vazio que parece sucesso.

import { DOMParser } from "@xmldom/xmldom";
import { lerSerieENumeroDaDps } from "./nfseUltimaNota.js";

const ELEMENT_NODE = 1;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Navegação por caminho (namespace-agnóstica: compara sempre `localName`)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ Sim, é a mesma navegação de `danfseDados.js` e de `nfseUltimaNota.js`, e continua duplicada de
// propósito. `danfseDados` devolve valor **formatado para o papel** (`198,00`, `31.01.04 / 001`,
// traço no lugar do vazio) — o que é certo para o PDF e errado para uma coluna, onde o traço viraria
// dado. Extrair um "utilXml" comum agora seria acoplar o gerador do DANFSe, a numeração da DPS e a
// auditoria ao mesmo helper: três consumidores com três exigências, e a regra do projeto é que três
// linhas duplicadas são melhores que uma abstração prematura.

function filhosPorNome(node, nome) {
  if (!node || !node.childNodes) return [];
  const alvo = String(nome).toLowerCase();
  const achados = [];
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const filho = node.childNodes[i];
    if (filho.nodeType !== ELEMENT_NODE) continue;
    const local = filho.localName || filho.nodeName;
    if (String(local).toLowerCase() === alvo) achados.push(filho);
  }
  return achados;
}

/** Desce por `a/b/c` a partir de `raiz`, sempre pelo PRIMEIRO filho de cada nível. */
function descer(raiz, caminho) {
  const partes = String(caminho || "").split("/").map((p) => p.trim()).filter(Boolean);
  let atual = raiz;
  for (const parte of partes) {
    if (!atual) return null;
    atual = filhosPorNome(atual, parte)[0] || null;
  }
  return atual;
}

function textoDe(node) {
  if (!node) return null;
  const texto = String(node.textContent ?? "").trim();
  return texto || null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A TABELA DE CAMPOS — cada linha diz o caminho E de onde o caminho veio
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `caminhos` é uma LISTA em ordem de preferência, e ela só tem mais de um item onde a própria NT
// declara o campo em dois lugares (campo composto: `cTrib` = `cTribNac + cTribMun`, cujos dois
// componentes moram em grupos diferentes). `origem` no resultado registra QUAL deles respondeu —
// sem isso, "leu de outro lugar" seria invisível.
//
// `leiauteCampoId` é o `id` da linha correspondente em `danfseLeiaute.BLOCOS`. O teste amarra os
// dois: se a NT for corrigida e o caminho mudar lá, o teste cai aqui.
const DPS = "DPS/infDPS";

export const CAMPOS = Object.freeze([
  {
    id: "cTribNac",
    leiauteCampoId: "cTrib",
    caminhos: [`${DPS}/serv/cServ/cTribNac`],
    tipo: "texto",
    nota:
      "O CÓDIGO DE SERVIÇO — é ele que responde 'a nota foi emitida na atividade certa?'. " +
      "⚠ NÃO é o item da LC 116: é item(2) + subitem(2) + desdobro nacional(2), 6 dígitos " +
      "(ver `docs/lista-servico-nacional/` e a seção 'N CÓDIGOS DE SERVIÇO' de `apps/api/CLAUDE.md`).",
  },
  {
    id: "cTribMun",
    leiauteCampoId: "cTrib",
    // A NT escreve o campo composto como `NFSe/infNFSe/DPS/infDPS/serv/cServ/ + NFSe/infNFSe/`,
    // tag `cTribNac + cTribMun` — ou seja, o municipal em `infNFSe`. Na amostra versionada
    // (`docs/leiaute-nfse/nfse-nacional-substituicao.xml`) ele vem em `serv/cServ`. `danfseDados.js`
    // já lê os dois lugares, nesta ordem; aqui é a MESMA ordem, e a origem fica registrada.
    caminhos: ["cTribMun", `${DPS}/serv/cServ/cTribMun`],
    tipo: "texto",
  },
  {
    id: "xTribNac",
    leiauteCampoId: "xTrib",
    // Idem: a NT declara `serv/cServ/ + NFSe/infNFSe/` para `xTribNac + xTribMun`, e na amostra os
    // DOIS vêm em `infNFSe`. `danfseDados.js` lê ambos de `infNFSe`.
    caminhos: ["xTribNac", `${DPS}/serv/cServ/xTribNac`],
    tipo: "texto",
  },
  {
    id: "xTribMun",
    leiauteCampoId: "xTrib",
    caminhos: ["xTribMun", `${DPS}/serv/cServ/xTribMun`],
    tipo: "texto",
  },
  {
    id: "xDescServ",
    leiauteCampoId: "xDescServ",
    caminhos: [`${DPS}/serv/cServ/xDescServ`],
    tipo: "texto",
  },
  {
    id: "cLocPrestacao",
    leiauteCampoId: "locPrest",
    // ⚠ A NT §2.4.5 nomeia o GRUPO (`.../serv/locPrest/`) e, dentro dele, a tag `cPaisPrestacao`;
    // o `cLocPrestacao` ela não nomeia, porque o DANFSe imprime o NOME do município
    // (`infNFSe/xLocPrestacao`), não o código. O código não está sendo inventado: ele está
    // (a) na amostra versionada, em `serv/locPrest/cLocPrestacao`; (b) escrito nesse mesmo caminho
    // por `NfseService.buildDpsXml`; e (c) documentado em `docs/nfse-preenchimento.md` §2
    // ("cLocPrestacao: IBGE do local da prestação").
    caminhos: [`${DPS}/serv/locPrest/cLocPrestacao`],
    tipo: "texto",
    nota:
      "Decide para qual município o ISSQN é devido (LC 116/2003, art. 3º) — e por isso é campo de " +
      "auditoria: nota com o local errado é ISS recolhido para a prefeitura errada.",
  },
  {
    id: "issqnBaseCalculo",
    leiauteCampoId: "vBC",
    // ⚠ ESTE É O CAMPO DA ARMADILHA. `vBC` existe em `infNFSe/valores` (ISSQN) **e** em
    // `IBSCBS/valores` (base após exclusões, campo `bcAposExclusoes` do leiaute). Por nome de tag
    // saem os dois; por caminho, só o do ISS.
    caminhos: ["valores/vBC"],
    tipo: "decimal",
  },
  {
    id: "issqnAliquota",
    leiauteCampoId: "pAliqAplic",
    caminhos: ["valores/pAliqAplic"],
    tipo: "decimal",
  },
  {
    id: "issqnValor",
    leiauteCampoId: "vISSQN",
    caminhos: ["valores/vISSQN"],
    tipo: "decimal",
  },
]);

/** Os dois campos que NÃO são lidos aqui — vêm de `nfseUltimaNota.lerSerieENumeroDaDps`. */
export const CAMPOS_DELEGADOS = Object.freeze([
  { id: "dpsSerie", leiauteCampoId: "serie", lidoPor: "nfseUltimaNota.lerSerieENumeroDaDps" },
  { id: "dpsNumero", leiauteCampoId: "nDPS", lidoPor: "nfseUltimaNota.lerSerieENumeroDaDps" },
]);

/** Todos os ids de campo que este módulo devolve, na ordem em que a coluna existe. */
export const IDS_DOS_CAMPOS = Object.freeze([
  ...CAMPOS.map((c) => c.id),
  ...CAMPOS_DELEGADOS.map((c) => c.id),
]);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MOTIVOS — vocabulário fechado. "Não deu" tem nome; nunca vira valor provável.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const MOTIVO = Object.freeze({
  /** `xmlRaw` nulo ou vazio. Medido em produção: 40 notas (todas DEST). */
  XML_AUSENTE: "XML_AUSENTE",
  /** O parser não devolveu documento — XML truncado ou corrompido. */
  XML_ILEGIVEL: "XML_ILEGIVEL",
  /** Sem `infNFSe`: é uma DPS crua, um evento, uma NF-e ou outro provedor. */
  NAO_E_NFSE: "NAO_E_NFSE",
  /** Achou `infNFSe` e NENHUM dos campos rendeu valor — sinal de leiaute diferente, não de nota vazia. */
  NENHUM_CAMPO: "NENHUM_CAMPO",
  /** Prefixo: valor presente mas fora da forma declarada. Sufixado com o id do campo. */
  CAMPO_ILEGIVEL: "CAMPO_ILEGIVEL",
  /** `cTribNac` presente com comprimento diferente de 6 — o valor é gravado como está. */
  CTRIBNAC_FORA_DA_FORMA: "CTRIBNAC_FORA_DA_FORMA",
});

/**
 * Valor decimal como o XML o escreve (`198.00`, `5.00`).
 *
 * ⚠ Devolve **string**, não Number: `Number("0.1")+Number("0.2")` é o motivo pelo qual dinheiro não
 * anda de ponto flutuante neste projeto (as colunas monetárias são `Decimal`, e o Prisma aceita a
 * string). O que não casar com a forma numérica vira `null` + motivo — nunca `0`.
 */
function decimalOuNulo(bruto) {
  if (bruto == null) return { valor: null, ilegivel: false };
  const s = String(bruto).trim().replace(",", ".");
  if (!s) return { valor: null, ilegivel: false };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { valor: null, ilegivel: true };
  return { valor: s, ilegivel: false };
}

/**
 * Extrai de UM XML de NFS-e os campos fiscais que hoje só existem dentro do texto.
 *
 * PURA: não toca banco, não toca rede, não formata para tela. Chamável a qualquer momento com o
 * mesmo XML e o mesmo resultado — é o que torna o backfill idempotente.
 *
 * @param {string} xmlPlain XML da NFS-e (o documento que VOLTA do sistema nacional).
 * @returns {{
 *   ok: boolean,
 *   motivo: string|null,
 *   campos: Record<string, string|null>,
 *   origem: Record<string, string>,
 *   avisos: string[]
 * }}
 *   `campos` traz **todos** os ids, sempre — ausente é `null`, e `null` é resposta.
 *   `motivo` é `null` quando a leitura correu; senão, os códigos separados por `;`.
 */
export function extrairCamposFiscaisNfse(xmlPlain) {
  const vazio = Object.fromEntries(IDS_DOS_CAMPOS.map((id) => [id, null]));

  if (!xmlPlain || !String(xmlPlain).trim()) {
    return { ok: false, motivo: MOTIVO.XML_AUSENTE, campos: vazio, origem: {}, avisos: [] };
  }

  let doc = null;
  try {
    doc = new DOMParser().parseFromString(String(xmlPlain), "text/xml");
  } catch {
    doc = null;
  }
  if (!doc || !doc.documentElement) {
    return { ok: false, motivo: MOTIVO.XML_ILEGIVEL, campos: vazio, origem: {}, avisos: [] };
  }

  // ⚠ Ancora em `infNFSe`, como `danfseDados.lerNfse`: o DANFSe e a auditoria representam a
  // **NFS-e** (o que volta, com chave, número e `dhProc`), não a DPS (o que se envia).
  const raiz = doc.documentElement;
  const infNFSe =
    filhosPorNome(raiz, "infNFSe")[0] ||
    (String(raiz.localName || raiz.nodeName) === "infNFSe" ? raiz : null);

  if (!infNFSe) {
    return { ok: false, motivo: MOTIVO.NAO_E_NFSE, campos: vazio, origem: {}, avisos: [] };
  }

  const campos = { ...vazio };
  const origem = {};
  const avisos = [];
  const motivos = [];

  for (const campo of CAMPOS) {
    let bruto = null;
    for (const caminho of campo.caminhos) {
      const lido = textoDe(descer(infNFSe, caminho));
      if (lido != null) {
        bruto = lido;
        origem[campo.id] = caminho;
        break;
      }
    }
    if (bruto == null) continue;

    if (campo.tipo === "decimal") {
      const { valor, ilegivel } = decimalOuNulo(bruto);
      if (ilegivel) {
        // ⚠ Presente e ilegível NÃO vira zero. A coluna fica nula e o motivo é nomeado — um zero
        // aqui diria "ISS apurado: R$ 0,00", que é uma afirmação fiscal.
        motivos.push(`${MOTIVO.CAMPO_ILEGIVEL}:${campo.id}`);
        delete origem[campo.id];
        continue;
      }
      campos[campo.id] = valor;
      continue;
    }

    campos[campo.id] = bruto;
  }

  // A série e o número da DPS: MESMA função da numeração automática, não uma segunda leitura.
  const { serie, numero } = lerSerieENumeroDaDps(xmlPlain);
  campos.dpsSerie = serie;                                   // já normalizada em 5 dígitos
  campos.dpsNumero = numero == null ? null : String(numero); // dígitos, sem zero à esquerda
  if (serie != null) origem.dpsSerie = `${DPS}/serie`;
  if (numero != null) origem.dpsNumero = `${DPS}/nDPS`;

  // ⚠ SINAL DE AUDITORIA, NÃO CORREÇÃO. `cTribNac` tem 6 dígitos (item+subitem+desdobro). Fora
  // disso, o valor vai para a coluna **como está** e o desvio é marcado: dar `padStart(6)` seria
  // adivinhar o que o emitente quis dizer — e é exatamente a armadilha `010101` × `10101` já
  // registrada no gerador da lista de serviço nacional.
  if (campos.cTribNac != null && !/^\d{6}$/.test(String(campos.cTribNac))) {
    motivos.push(MOTIVO.CTRIBNAC_FORA_DA_FORMA);
    avisos.push(`cTribNac="${campos.cTribNac}" não tem os 6 dígitos previstos — gravado como está.`);
  }

  const rendeuAlgo = IDS_DOS_CAMPOS.some((id) => campos[id] != null);
  if (!rendeuAlgo) {
    // Achou `infNFSe` e não leu NADA: é sinal de leiaute diferente do transcrito, não de nota
    // incompleta. Registrado com nome próprio para aparecer na medição.
    return { ok: false, motivo: MOTIVO.NENHUM_CAMPO, campos, origem, avisos };
  }

  return {
    ok: true,
    motivo: motivos.length ? motivos.join(";") : null,
    campos,
    origem,
    avisos,
  };
}

export const _internos = { descer, filhosPorNome, textoDe, decimalOuNulo };
