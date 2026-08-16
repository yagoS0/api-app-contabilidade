import https from "node:https";
import axios from "axios";
import { SignedXml } from "xml-crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { gzipSync } from "node:zlib";
import { prisma } from "../../infrastructure/db/prisma.js";
import { NfseRepository } from "../../infrastructure/db/NfseRepository.js";
import { parseDate } from "../../utils/date.js";
import { findFirstByLocalName, getTextByLocalNames } from "../../utils/xml.js";
import { resolverCertificadosDaEmpresa } from "./nfseCertificado.js";
import { resolverOpSimpNac, resolverTpRetIssqn, RESOLUCAO } from "./dpsCodigos.js";
import { normalizarSerie, reservarNumeracao } from "./nfseNumeracao.js";
import {
  classificarFalha,
  camposDeFalha,
  CAMPOS_DE_FALHA_LIMPOS,
  CAMADA,
  STATUS,
} from "./desfechoEmissao.js";
import {
  NFSE_BASE_URL,
  NFSE_ENV,
  NFSE_PATH,
  NFSE_CONSULT_PATH,
  NFSE_DPS_PATH,
  NFSE_NFSE_PATH,
  NFSE_EVENT_FIELD,
  NFSE_EVENT_FORMAT,
  log,
} from "../../config.js";

// ⚠ VERSÃO DO LEIAUTE — 1.00, E FICAR NELE É DECISÃO, NÃO INÉRCIA.
//
// A Documentação Atual do portal publica o **1.01** (XSD de 11/02/2026; o pacote oficial traz
// `Schemas/1.00` E `Schemas/1.01`). Há regra de expiração de versão (**E0001**/**E1260**), mas
// ⚠ **a data de corte NÃO está publicada** — então migrar é decisão de risco, não urgência
// conhecida. O que o 1.01 acrescenta é o grupo `IBSCBS` (reforma tributária), **facultativo** por
// ora, e o projeto **não tem o XSD versionado** (não há um único `.xsd` na árvore): subir a versão
// sem o schema para validar contra trocaria uma rejeição conhecida por uma desconhecida.
//
// Fica como CONSTANTE, num lugar só, para que a virada seja uma linha quando o dono decidir — e
// não uma caçada por literais `"1.00"` espalhados. Ver o relatório da Fase 1.
const DPS_VERSAO = "1.00";

const REQUIRED_COMPANY_FIELDS = [
  "cnpj",
  "inscricaoMunicipal",
  "codigoServicoNacional",
  "codigoServicoMunicipal",
  "rpsSerie",
];

function buildMissingFields(company) {
  const missing = [];
  for (const field of REQUIRED_COMPANY_FIELDS) {
    if (!company?.[field]) missing.push(field);
  }
  return missing;
}

// ⚠ O CERTIFICADO SAIU DAQUI. `integrationReady` exigia `NFSE_CERT_PFX_PATH` +
// `NFSE_CERT_PFX_PASSWORD` — um PFX GLOBAL, o mesmo arquivo assinando DPS de qualquer CNPJ da
// carteira. Hoje o certificado é resolvido POR EMPRESA (`nfseCertificado.js`, E0718), e a ausência
// dele é uma **recusa nomeada** (`NO_COMPANY_CERT`), não "integração não configurada": são coisas
// diferentes e tinham de deixar de ser a mesma resposta. O que ainda é configuração de ambiente é
// só o endpoint.
function integrationReady() {
  return Boolean(NFSE_BASE_URL);
}

function signDpsXml(xml, certificadoAssinatura) {
  const { keyPem, certBase64 } = certificadoAssinatura;

  const sig = new SignedXml();
  sig.addReference("//*[local-name()='infDPS']", [
    "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
    "http://www.w3.org/2001/10/xml-exc-c14n#",
  ]);
  sig.signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  sig.signingKey = keyPem;
  sig.keyInfoProvider = {
    getKeyInfo() {
      return `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;
    },
  };

  sig.computeSignature(xml, {
    prefix: "",
    location: { reference: "/*[local-name()='DPS']", action: "append" },
  });

  return sig.getSignedXml();
}

function buildAxiosClient(certificadoTransporte) {
  if (!integrationReady()) {
    const err = new Error(
      "NFSe: integração não configurada — falta NFSE_BASE_URL (endpoint do sistema nacional)."
    );
    err.code = "NFSE_NOT_CONFIGURED";
    throw err;
  }

  // Validação de base URL (precisa ter protocolo e não pode ser protocol-relative //)
  if (!/^https?:\/\//i.test(NFSE_BASE_URL)) {
    const err = new Error(
      `NFSe: NFSE_BASE_URL inválida (${NFSE_BASE_URL || "vazia"}). Informe URL absoluta com https://`
    );
    err.code = "NFSE_INVALID_BASE_URL";
    throw err;
  }

  // Sanidade de ambiente/baseURL para evitar enviar produção em host de homolog (ou vice-versa)
  const baseUrlTrimmed = NFSE_BASE_URL.replace(/\/+$/, "").toLowerCase();
  const isHomologHost = baseUrlTrimmed.includes("producaorestrita") || baseUrlTrimmed.includes("homolog");
  if (NFSE_ENV === "producao" && isHomologHost) {
    const err = new Error(
      `NFSe: NFSE_ENV=producao, mas NFSE_BASE_URL aponta para ambiente de homolog (${NFSE_BASE_URL}). Ajuste NFSE_BASE_URL para o host de produção.`
    );
    err.code = "NFSE_ENV_HOST_MISMATCH";
    throw err;
  }

  // ⚠ O PFX do mTLS é o **certificado de TRANSPORTE** que `nfseCertificado.js` resolveu para ESTA
  // empresa. Antes era `fs.readFileSync(NFSE_CERT_PFX_PATH)` — um arquivo global lido do disco a
  // cada chamada, sem ninguém conferir de quem ele era. Transporte e assinatura são campos
  // separados (E1200–E1209 × E0718) mesmo apontando hoje para o mesmo arquivo.
  if (!certificadoTransporte?.pfxBuffer) {
    const err = new Error(
      "NFSe: certificado de transporte (mTLS) não resolvido para esta empresa. O sistema nacional " +
        "exige conexão autenticada por certificado ICP-Brasil."
    );
    err.code = "NO_COMPANY_CERT";
    throw err;
  }
  const agent = new https.Agent({
    pfx: certificadoTransporte.pfxBuffer,
    passphrase: certificadoTransporte.password || undefined,
    rejectUnauthorized: NFSE_ENV !== "homolog",
  });

  const client = axios.create({
    baseURL: NFSE_BASE_URL.replace(/\/+$/, ""),
    httpsAgent: agent,
    timeout: 15000,
  });

  return client;
}

function escapeXml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDateOnly(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function formatDateTimeWithOffset(value) {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 19) + "Z";
  const pad = (n) => String(Math.abs(n)).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const minute = pad(d.getMinutes());
  const second = pad(d.getSeconds());
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offsetH = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetM = pad(Math.abs(offsetMinutes) % 60);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${offsetH}:${offsetM}`;
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

// ⚠ O BLOCO `e105102` SEGUE O LEIAUTE OFICIAL, CAMPO POR CAMPO.
//
// Fonte aberta e conferida em 12/08/2026 (o XSD NÃO está versionado neste repositório — não há
// um único `.xsd` na árvore; `docs/leiaute-nfse/` só tem a amostra de DPS com `<subst>`):
//
//   ANEXO_II-SEFIN_ADN-PEDREGEVT_EVT-SNNFSe v1.01, baixado do portal oficial em
//   gov.br/nfse → Documentação Técnica → Documentação Atual, arquivo
//   `anexo_ii-sefin_adn-pedregevt_evt-snnfse-v1-01-20260122.xlsx`
//
// As quatro linhas que este bloco tem de obedecer (planilha "Leiaute", linhas 26–29):
//
//   evento/pedRegEvento/infPedReg/e105102/xDesc ......... C 1-1  5-60   "Descrição do evento:
//                                                                        Cancelamento de NFS-e
//                                                                        por Substituição"
//   evento/pedRegEvento/infPedReg/e105102/cMotivo ....... N 1-1  2      código de justificativa
//   evento/pedRegEvento/infPedReg/e105102/xMotivo ....... C 0-1  15-255 descrição do motivo
//   evento/pedRegEvento/infPedReg/e105102/chSubstituta .. N 1-1  50     "Chave de Acesso da
//                                                                        NFS-e substituta."
//
// ⚠ ERA `<chNFSeSubst>`, QUE NÃO EXISTE. A busca por `chNFSeSubst` no arquivo oficial devolve
// ZERO ocorrências — o nome do padrão é `chSubstituta`, e é ele que aparece nos 6 eventos
// e105102 reais que capturamos do ADN (ver `AdnXmlMetadata.parseNfseEvento`, que já lia o nome
// certo: nós ESCREVÍAMOS um nome e LÍAMOS outro).
//
// ⚠ `<nNFSeSubst>` (o antigo fallback "se não tenho a chave, mando o número") TAMBÉM NÃO EXISTE
// no leiaute — era campo inventado, e `chSubstituta` é obrigatório (ocorrência 1-1). Sem a chave
// da substituta não há evento válido a montar, então a recusa acontece ANTES, em `sendEvent`.
// Montar XML com campo inventado só troca uma rejeição clara por uma rejeição confusa do ADN.
function buildEventoXml({
  tipoEvento,
  justificativa,
  cnpjAutor,
  chaveAcesso,
  cMotivo,
  chaveSubstituta,
}) {
  const tpAmb = NFSE_ENV === "homolog" ? "2" : "1";
  const chaveDigits = normalizeDigits(chaveAcesso).slice(-50).padStart(50, "0");
  const tipoEventoNum = normalizeDigits(tipoEvento).padStart(6, "0").slice(-6);
  const eventoId = `PRE${chaveDigits}${tipoEventoNum}`;
  const dhEvento = formatDateTimeWithOffset(new Date());
  const motivoTexto = justificativa || "Cancelamento de NFS-e";
  const eventoXml =
    String(tipoEvento).toLowerCase() === "e105102"
      ? // ⚠ `cMotivo` do e105102 tem TAMANHO 2 (01, 02, 03, 04, 05, 99), diferente do e101101,
        // que tem tamanho 1. O padStart não escolhe motivo nenhum — só formata o que o chamador
        // mandou; quem não manda cMotivo é recusado em `sendEvent`, porque o código é uma
        // justificativa FISCAL e não se arbitra uma (regra 1).
        `<e105102>
      <xDesc>Cancelamento de NFS-e por Substituição</xDesc>
      <cMotivo>${escapeXml(normalizeDigits(cMotivo).padStart(2, "0").slice(-2))}</cMotivo>
      <xMotivo>${escapeXml(motivoTexto)}</xMotivo>
      <chSubstituta>${escapeXml(normalizeDigits(chaveSubstituta).slice(-50).padStart(50, "0"))}</chSubstituta>
    </e105102>`
      : `<e101101>
      <xDesc>Cancelamento de NFS-e</xDesc>
      <cMotivo>${escapeXml(cMotivo || "1")}</cMotivo>
      <xMotivo>${escapeXml(motivoTexto)}</xMotivo>
    </e101101>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infPedReg Id="${escapeXml(eventoId)}">
    <tpAmb>${tpAmb}</tpAmb>
    <verAplic>API</verAplic>
    <dhEvento>${dhEvento}</dhEvento>
    <CNPJAutor>${escapeXml(normalizeDigits(cnpjAutor))}</CNPJAutor>
    <chNFSe>${escapeXml(chaveDigits)}</chNFSe>
    ${eventoXml}
  </infPedReg>
</pedRegEvento>`;
}

function signEventoXml(xml, certificadoAssinatura) {
  const { keyPem, certBase64 } = certificadoAssinatura;

  const sig = new SignedXml();
  sig.addReference("//*[local-name()='infPedReg']", [
    "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
    "http://www.w3.org/2001/10/xml-exc-c14n#",
  ]);
  sig.signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  sig.signingKey = keyPem;
  sig.keyInfoProvider = {
    getKeyInfo() {
      return `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;
    },
  };

  sig.computeSignature(xml, {
    prefix: "",
    location: { reference: "/*[local-name()='pedRegEvento']", action: "append" },
  });

  return sig.getSignedXml();
}

// ⚠ O MUNICÍPIO SAÍA ZERADO, E ISSO SOZINHO DERRUBA TODA A EMISSÃO.
//
// A expressão original lia `company.codigoMunicipioIbge` **e** `company.codigoMunicipio` —
// **nenhum dos dois existia no model `Company`**. Os dois eram `undefined`, a cadeia caía no env
// `NFSE_COD_MUNICIPIO` (não definido no Railway) e o `padStart(7, "0")` transformava a string
// vazia em `"0000000"`. Ou seja: o `cLocEmi` era fabricado pelo próprio formatador, e o `Id` da DPS
// saía com sete zeros no lugar do município emissor.
//
// Agora o campo existe (migration `20260814120000_add_nfse_emissao_fase1`) e **nasce vazio**: o
// código IBGE não existe em lugar nenhum do projeto — o município da empresa vive como TEXTO em
// `PortalClient.municipio`/`uf`. Vazio ⇒ **recusa nomeada**, nunca `"0000000"`.
function resolverCLocEmi(company) {
  const bruto = String(company?.codigoMunicipioIbge || "").replace(/\D+/g, "");
  if (bruto.length !== 7) {
    const err = new Error(
      "Esta empresa não tem o código IBGE do município emissor cadastrado. Ele é o `cLocEmi` da " +
        "DPS e entra também no Id do documento — sem ele a emissão inteira é rejeitada."
    );
    err.code = "NFSE_MUNICIPIO_NAO_CONFIGURADO";
    err.correcao =
      "Cadastre o código IBGE de 7 dígitos do município da empresa. ⚠ O sistema guarda hoje apenas " +
      "o NOME do município (PortalClient.municipio), e converter nome→IBGE por conta própria erra " +
      "em homônimo — o código tem de ser informado, não deduzido.";
    throw err;
  }
  return bruto;
}

// Id de infDPS: DPS + cLocEmi(7) + tpInsc(1) + inscFed(14) + serie(5) + nDPS(15).
//
// ⚠ ESTA MONTAGEM ESTAVA DUPLICADA — `buildDpsId` e `buildDpsXml` tinham as ~20 linhas idênticas,
// cada uma com a sua cópia da resolução de município, de série e de número. Duas cópias de uma
// chave de identidade fiscal é como elas divergem: o `Id` gravado na linha e o `Id` assinado no XML
// poderiam deixar de ser o mesmo sem que nada reclamasse.
function montarIdDps({ cLocEmi, company, serieVal, nDpsVal }) {
  const cnpj = (company.cnpj || "").replace(/\D+/g, "");
  const cpfCompany = (company.cpf || "").replace(/\D+/g, "");
  const isCnpj = cnpj.length === 14;
  const tpInsc = isCnpj ? "2" : "1"; // 2=CNPJ, 1=CPF
  const inscFed = (cnpj || cpfCompany).padStart(14, "0").slice(-14);
  return `DPS${cLocEmi}${tpInsc}${inscFed}${serieVal}${String(nDpsVal).padStart(15, "0").slice(-15)}`;
}

/**
 * Id da DPS a partir da numeração JÁ RESERVADA.
 *
 * ⚠ `rpsSerie`/`rpsNumero` são ARGUMENTOS agora, não mais lidos de `company` na hora. Ler o
 * contador do cadastro aqui era metade do defeito de numeração: `buildDpsId(company)` e o
 * `update` que incrementava rodavam em momentos diferentes, fora de transação, e nada garantia
 * que o número montado no Id fosse o mesmo que ficou reservado.
 */
function buildDpsId(company, { rpsSerie, rpsNumero }) {
  return montarIdDps({
    cLocEmi: resolverCLocEmi(company),
    company,
    serieVal: normalizarSerie(rpsSerie),
    nDpsVal: String(rpsNumero).replace(/\D+/g, ""),
  });
}

function buildConsultaPeriodoXml({ company, filters }) {
  const tpAmb = NFSE_ENV === "homolog" ? "2" : "1";
  const dataInicial = filters.from;
  const dataFinal = filters.to;
  const cnpjPrestador = filters.cnpjPrestador || company.cnpj;
  const cnpjTomador = filters.cnpjTomador;
  const situacao = filters.situacao;

  const prestadorXml = cnpjPrestador
    ? `<Prestador><Cnpj>${escapeXml(cnpjPrestador)}</Cnpj></Prestador>`
    : "";
  const tomadorXml = cnpjTomador
    ? `<Tomador><Cnpj>${escapeXml(cnpjTomador)}</Cnpj></Tomador>`
    : "";
  const situacaoXml = situacao ? `<SituacaoNfse>${escapeXml(situacao)}</SituacaoNfse>` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarNfseEnvio xmlns="http://www.sped.fazenda.gov.br/nfse">
  <IdentificacaoAmbiente>
    <TipoAmbiente>${tpAmb}</TipoAmbiente>
  </IdentificacaoAmbiente>
  <Pedido>
    <ConsultaNfse>
      <PeriodoEmissao>
        <DataInicial>${escapeXml(dataInicial)}</DataInicial>
        <DataFinal>${escapeXml(dataFinal)}</DataFinal>
      </PeriodoEmissao>
      ${prestadorXml}
      ${tomadorXml}
      ${situacaoXml}
    </ConsultaNfse>
  </Pedido>
</ConsultarNfseEnvio>`;
}

function parseConsultaPeriodoXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const serializer = new XMLSerializer();
  const items = [];
  const compNodes = [];

  const allNodes = doc.getElementsByTagName("*");
  for (let i = 0; i < allNodes.length; i += 1) {
    const node = allNodes[i];
    if (node.localName === "CompNfse" || node.localName === "Nfse") {
      compNodes.push(node);
    }
  }

  for (const node of compNodes) {
    const inf = findFirstByLocalName(node, "InfNfse") || node;
    const idAttr = inf?.getAttribute?.("Id") || null;
    const numeroNfse = getTextByLocalNames(inf, ["nNFSe", "Numero", "numero"]);
    const competencia = getTextByLocalNames(inf, ["Competencia", "dCompet"]);
    const dataEmissao = getTextByLocalNames(inf, ["DataEmissao", "dhEmi", "DataEmissaoNfse"]);
    const valorServicos = getTextByLocalNames(inf, ["vServ", "ValorServicos", "valorServicos"]);
    const situacao = getTextByLocalNames(inf, ["SituacaoNfse", "Situacao", "xSit"]);

    const tomadorNode = findFirstByLocalName(inf, "Tomador") || findFirstByLocalName(inf, "Toma");
    const tomadorDoc =
      getTextByLocalNames(tomadorNode, ["CNPJ", "CPF", "Cnpj", "Cpf"]) ||
      getTextByLocalNames(inf, ["CNPJ", "CPF"]);
    const tomadorNome =
      getTextByLocalNames(tomadorNode, ["RazaoSocial", "xNome", "Nome"]) ||
      getTextByLocalNames(inf, ["RazaoSocial", "xNome", "Nome"]);

    const xml = serializer.serializeToString(node);

    const valorServicosNumber =
      valorServicos !== null && valorServicos !== undefined ? Number(valorServicos) : null;
    items.push({
      idDps: null,
      chaveAcesso: idAttr,
      numeroNfse,
      competencia: parseDate(competencia || dataEmissao),
      valorServicos:
        valorServicosNumber !== null && !Number.isNaN(valorServicosNumber)
          ? valorServicosNumber
          : null,
      tomadorDoc: tomadorDoc ? String(tomadorDoc).replace(/\D+/g, "") : null,
      tomadorNome: tomadorNome ? String(tomadorNome) : null,
      status: normalizeProviderStatus(situacao),
      xml,
    });
  }

  return items;
}

function normalizeProviderStatus(value) {
  if (!value) return null;
  const raw = String(value).toLowerCase();
  if (raw.includes("emit") || raw.includes("issued") || raw.includes("aprov")) return "issued";
  if (raw.includes("reject") || raw.includes("rejeit") || raw.includes("error")) return "rejected";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("pend")) return "pending";
  return raw;
}

function mapProviderItem(item) {
  const tomador = item?.tomador || {};
  const rps = item?.rps || {};
  const idDps = item?.idDps || item?.idDPS || item?.identificacaoDps || item?.dpsId || null;
  const chaveAcesso =
    item?.chaveAcesso ||
    item?.chave ||
    item?.idNfse ||
    item?.idNFSe ||
    item?.id ||
    null;
  const numeroNfse =
    item?.numeroNfse || item?.nfseNumero || item?.numero || null;
  const codigoVerificacao = item?.codigoVerificacao || item?.codigo || item?.codVerificacao || null;
  const xml = item?.nfseXmlGZipB64 || item?.xml || item?.xmlGZipB64 || item?.xmlBase64 || null;
  const pdfUrl = item?.pdfUrl || item?.urlPdf || item?.linkPdf || null;
  const valorServicos =
    item?.valorServicos ??
    item?.valor ??
    item?.vServ ??
    item?.servico?.valorServicos ??
    null;
  const aliquota =
    item?.aliquota ?? item?.pAliq ?? item?.servico?.aliquota ?? item?.servico?.pAliq ?? null;
  const tomadorDoc =
    tomador?.doc || tomador?.cpfCnpj || item?.tomadorDoc || item?.cpfCnpjTomador || null;
  const tomadorNome =
    tomador?.nome || tomador?.razaoSocial || item?.tomadorNome || item?.tomadorRazaoSocial || null;
  const competencia =
    item?.competencia || item?.dCompet || item?.dataCompetencia || item?.dataEmissao || null;
  const rpsNumero = item?.rpsNumero || rps?.numero || item?.numeroRps || null;
  const rpsSerie = item?.rpsSerie || rps?.serie || item?.serieRps || null;
  const status = normalizeProviderStatus(item?.status || item?.situacao || item?.statusNfse);
  const valorServicosNumber =
    valorServicos !== null && valorServicos !== undefined ? Number(valorServicos) : null;
  const aliquotaNumber = aliquota !== null && aliquota !== undefined ? Number(aliquota) : null;

  return {
    idDps: idDps ? String(idDps) : null,
    chaveAcesso: chaveAcesso ? String(chaveAcesso) : null,
    numeroNfse: numeroNfse ? String(numeroNfse) : null,
    codigoVerificacao: codigoVerificacao ? String(codigoVerificacao) : null,
    xml,
    pdfUrl,
    valorServicos:
      valorServicosNumber !== null && !Number.isNaN(valorServicosNumber)
        ? valorServicosNumber
        : null,
    aliquota:
      aliquotaNumber !== null && !Number.isNaN(aliquotaNumber) ? aliquotaNumber : null,
    tomadorDoc: tomadorDoc ? String(tomadorDoc) : null,
    tomadorNome: tomadorNome ? String(tomadorNome) : null,
    competencia: parseDate(competencia),
    rpsNumero: rpsNumero ? String(rpsNumero) : null,
    rpsSerie: rpsSerie ? String(rpsSerie) : null,
    status: status || null,
  };
}

/**
 * Monta o XML da DPS.
 *
 * @param {object} p.numeracao `{ rpsSerie, rpsNumero }` **já reservados** transacionalmente.
 * @param {string|null} p.regime regime tributário real da empresa (`CadastroFiscal.regime`, com
 *   `Company.regimeTributario` como segunda fonte). ⚠ NÃO tem default: ausente ⇒ recusa.
 */
function buildDpsXml({ company, data, numeracao, regime }) {
  const competencia = formatDateOnly(data.competencia);
  const valorServicosNumber = Number(data.servico.valorServicos || 0);
  const valorServicos = valorServicosNumber.toFixed(2);
  const rawAliq = data.servico.aliquota;
  const aliquota =
    rawAliq !== undefined && rawAliq !== null && rawAliq !== ""
      ? Number(rawAliq)
      : null;
  const codigoServico =
    company.codigoServicoMunicipal || company.codigoServicoNacional || "";

  const cLocEmi = resolverCLocEmi(company);
  const cnpj = (company.cnpj || "").replace(/\D+/g, "");
  const serieVal = normalizarSerie(numeracao.rpsSerie); // 5 dígitos, faixa E0010 conferida
  const nDpsRaw = String(numeracao.rpsNumero).replace(/\D+/g, ""); // XML sem padding
  const infId = montarIdDps({ cLocEmi, company, serieVal, nDpsVal: nDpsRaw });

  // Dados tomador
  const tomadorDoc = (data.tomador.doc || "").replace(/\D+/g, "");
  const docTag = tomadorDoc.length === 11 ? "CPF" : "CNPJ";
  const tomadorEmail = data.tomador.email;

  // Ambiente: 1=producao, 2=homolog
  const tpAmb = NFSE_ENV === "homolog" ? "2" : "1";
  const dhEmi = formatDateTimeWithOffset(new Date());
  const verAplic = "SefinNacional_1.5.0";

  const serieTag = serieVal; // XML padded (ex.: 00001)
  const cTribNacRaw = (company.codigoServicoNacional || codigoServico || "").replace(
    /\D+/g,
    ""
  );
  const cTribNac = cTribNacRaw ? cTribNacRaw.padStart(6, "0").slice(-6) : "";
  const cTribMunRaw = (company.codigoServicoMunicipal || codigoServico || "")
    .replace(/\D+/g, "")
    .slice(-3); // padrão municipal usa sufixo de 3 dígitos
  const cTribMun = cTribMunRaw || "";

  // ── LOCAL DA PRESTAÇÃO ───────────────────────────────────────────────────────────────────
  //
  // ⚠ ANTES ERA `const cLocPrestacao = cLocEmi;` com o comentário *"por enquanto assume igual ao
  // município do prestador"*. O "por enquanto" não tinha data e não tinha alternativa: **não havia
  // como informar um local diferente**, nem sinal de que ele havia sido assumido.
  //
  // O QUE ACONTECE QUANDO SÃO DIFERENTES: `cLocPrestacao` é o que determina o **município
  // competente para o ISSQN**. Diferente do emissor, o imposto é devido no local da prestação — o
  // que muda a alíquota aplicável e pode tornar a retenção obrigatória para o tomador. Uma DPS que
  // declara o município errado recolhe imposto para a cidade errada; é erro fiscal com dinheiro
  // envolvido, não um campo cosmético.
  //
  // ⚠ E O VALOR CERTO **NÃO SE DEDUZ DO ENDEREÇO DO TOMADOR**. A regra é a LC 116/2003, art. 3º: o
  // serviço considera-se prestado no estabelecimento do prestador (o `caput`), **salvo** numa lista
  // fechada de exceções por tipo de serviço (os incisos), em que passa a ser o local da execução.
  // Implementar essa lista exige o de-para item-da-lista → regra, que este projeto não tem;
  // adivinhar por "onde mora o tomador" produziria o município errado com aparência de acerto.
  //
  // Por isso: o local da prestação é **informado**, e a ausência dele cai no emissor (o `caput` da
  // lei, que é a regra geral) — mas de forma EXPLÍCITA, com a suposição registrada no retorno em
  // vez de escondida numa atribuição.
  const cLocPrestacaoInformado = String(data.servico?.cLocPrestacao || "").replace(/\D+/g, "");
  const cLocPrestacao = cLocPrestacaoInformado.length === 7 ? cLocPrestacaoInformado : cLocEmi;
  const localPrestacaoAssumido = cLocPrestacao === cLocEmi && cLocPrestacaoInformado.length !== 7;

  // ── REGIME TRIBUTÁRIO ────────────────────────────────────────────────────────────────────
  //
  // ⚠ `opSimpNac` ESTAVA CRAVADO EM `"3"`: **toda** empresa era declarada Simples ME/EPP no
  // documento fiscal, inclusive as 11 do Lucro Presumido da carteira. Agora vem do regime REAL, e
  // regime que não se sabe **recusa** — não vira "3" por omissão. Ver `dpsCodigos.js` para a
  // evidência de cada linha da tabela e para o porquê de MEI ficar de fora.
  const regTrib = resolverOpSimpNac(regime);
  if (regTrib.resolucao !== RESOLUCAO.RESOLVIDO) {
    const err = new Error(regTrib.motivo);
    err.code = "NFSE_REGIME_INDEFINIDO";
    err.correcao =
      "Cadastre/confirme o regime tributário da empresa na aba Fiscal → Cadastro. O regime é " +
      "declarado na própria DPS (opSimpNac) — emitir com o regime errado é declaração falsa.";
    throw err;
  }
  const opSimpNac = regTrib.opSimpNac;
  const isSimples = regTrib.exigeRegApTribSN;

  const shouldSendIM = company.inscricaoMunicipal && cLocEmi !== "3304557"; // RJ exige não enviar IM se não há CNC
  const pTotTribSNRaw = data.totTrib?.pTotTribSN;
  const pTotTribSN =
    pTotTribSNRaw !== undefined && pTotTribSNRaw !== null && pTotTribSNRaw !== ""
      ? Number(pTotTribSNRaw)
      : null;
  if (isSimples && (pTotTribSN === null || Number.isNaN(pTotTribSN) || pTotTribSN < 0)) {
    const err = new Error(
      "A alíquota efetiva do Simples Nacional (pTotTribSN) é exigida quando opSimpNac=3 e não foi informada."
    );
    err.code = "MISSING_P_TOT_TRIB_SN";
    err.correcao =
      "Informe o percentual total de tributos do Simples (pTotTribSN) no assistente de emissão. " +
      "Ele é a alíquota efetiva da empresa na competência — sai do extrato do PGDAS-D.";
    throw err;
  }

  // ⚠ QUEM NÃO É DO SIMPLES TAMBÉM PRECISA DECLARAR A CARGA TRIBUTÁRIA, E ESTE CAMINHO NUNCA FOI
  // EXERCIDO. Enquanto `opSimpNac` era cravado em 3, o ramo do `else` abaixo era inalcançável — e
  // ele emite `<vTotTribFed>0.00</vTotTribFed>` e irmãos, ou seja, **declara carga tributária
  // ZERO**. Isso é uma afirmação (Lei 12.741/2012, a Lei da Transparência), não um preenchimento
  // técnico: zero é o valor de quem não paga nada.
  //
  // A NFS-e real que temos versionada (`docs/leiaute-nfse/nfse-nacional-substituicao.xml`, de
  // empresa não optante) declara `<pTotTrib><pTotTribFed>11.33</pTotTribFed>…` — percentuais
  // reais, não zeros. Ou seja, o formato que o código emite não é o que a nota real usa, **e** o
  // valor que ele emite é falso. Como a estrutura correta não pode ser confirmada sem o XSD (que
  // não está versionado), o caminho **recusa** em vez de declarar zero.
  const totTribNaoSimples = data.totTrib || {};
  const temTotTribNaoSimples =
    [totTribNaoSimples.pTotTribFed, totTribNaoSimples.pTotTribEst, totTribNaoSimples.pTotTribMun].some(
      (v) => v !== undefined && v !== null && v !== ""
    );
  if (!isSimples && !temTotTribNaoSimples) {
    const err = new Error(
      "Empresa não optante do Simples: a carga tributária aproximada (pTotTribFed/Est/Mun) não foi " +
        "informada, e o código emitia 0,00 — que afirma carga zero."
    );
    err.code = "MISSING_TOT_TRIB_NAO_SIMPLES";
    err.correcao =
      "Informe os percentuais de tributos aproximados (Lei 12.741/2012). ⚠ Este caminho nunca foi " +
      "exercido: enquanto opSimpNac era cravado em 3, nenhuma empresa do Lucro Presumido chegava " +
      "aqui. Confirmar a estrutura do grupo totTrib com o dono antes de ligar.";
    throw err;
  }

  // Endereço do tomador: agora sempre incluímos no XML (se vier completo); se vier incompleto, acusamos erro para evitar RNG6110.
  const tomadorEndereco = data.tomador?.endereco || {};
  const hasTomadorAddress =
    tomadorEndereco.cMun &&
    tomadorEndereco.CEP &&
    tomadorEndereco.xLgr &&
    tomadorEndereco.nro &&
    tomadorEndereco.xBairro;
  if (!hasTomadorAddress) {
    const err = new Error(
      "missing_tomador_address: informe endereco do tomador (cMun, CEP, xLgr, nro, xBairro; opcional xCpl)"
    );
    err.code = "MISSING_TOMADOR_ADDRESS";
    throw err;
  }

  // ── RETENÇÃO DO ISSQN ────────────────────────────────────────────────────────────────────
  //
  // ⚠ A RETENÇÃO ERA CALCULADA E JOGADA FORA. Havia TRÊS variáveis mortas — `issRetido` (a partir
  // de `data.servico.issRetido`), `issRetidoFlag` e `effectiveIssRetido` — e **nenhuma entrava no
  // XML**: o `tpRetISSQN` era o literal `1`. Toda nota com ISS retido pelo tomador era emitida
  // declarando que NÃO havia retenção, o que joga o recolhimento para o lado errado.
  //
  // ⚠ O caminho NÃO retido continua emitindo exatamente o `1` de hoje — o mesmo valor da emissão
  // homolog aceita. Só o caminho retido muda, e ele hoje está comprovadamente errado.
  const retencao = resolverTpRetIssqn(data.servico?.issRetido === true);
  const tpRetISSQN = retencao.tpRetISSQN;

  // Com retenção, o provedor exige alíquota > 0 — a observação que já estava no código (o erro
  // E0625). Recusar aqui é melhor que emitir retenção sem base: a rejeição do sistema nacional
  // viria de qualquer jeito, só que sem dizer o que corrigir.
  if (retencao.exigeAliquota && !(aliquota > 0)) {
    const err = new Error(
      "ISS retido exige alíquota do ISSQN maior que zero, e nenhuma foi informada."
    );
    err.code = "NFSE_ISS_RETIDO_SEM_ALIQUOTA";
    err.correcao = "Informe a alíquota de ISS da empresa no assistente de emissão.";
    throw err;
  }

  const tomadorEnderecoXml = `<end>
      <endNac>
        <cMun>${escapeXml(tomadorEndereco.cMun)}</cMun>
        <CEP>${escapeXml(tomadorEndereco.CEP)}</CEP>
      </endNac>
      <xLgr>${escapeXml(tomadorEndereco.xLgr)}</xLgr>
      <nro>${escapeXml(tomadorEndereco.nro)}</nro>
      ${tomadorEndereco.xCpl ? `<xCpl>${escapeXml(tomadorEndereco.xCpl)}</xCpl>` : ""}
      <xBairro>${escapeXml(tomadorEndereco.xBairro)}</xBairro>
    </end>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="${DPS_VERSAO}">
  <infDPS Id="${infId}">
    <tpAmb>${tpAmb}</tpAmb>
    <dhEmi>${escapeXml(dhEmi)}</dhEmi>
    <verAplic>${escapeXml(verAplic)}</verAplic>

    <serie>${escapeXml(serieTag)}</serie>
    <nDPS>${escapeXml(nDpsRaw)}</nDPS>
    <dCompet>${escapeXml(competencia)}</dCompet>
    <tpEmit>1</tpEmit>
    <cLocEmi>${escapeXml(cLocEmi)}</cLocEmi>

    <prest>
      <CNPJ>${escapeXml(cnpj)}</CNPJ>
      ${shouldSendIM ? `<IM>${escapeXml(company.inscricaoMunicipal)}</IM>` : ""}
      <regTrib>
        <opSimpNac>${opSimpNac}</opSimpNac>
        ${
          // ⚠ `regApTribSN` só existe para quem É do Simples. Antes era emitido SEMPRE (cravado
          // em "1"), o que fazia sentido enquanto `opSimpNac` também era cravado em 3. A NFS-e
          // real de empresa não optante que temos versionada
          // (`docs/leiaute-nfse/nfse-nacional-substituicao.xml`) traz `<opSimpNac>1</opSimpNac>`
          // e `<regEspTrib>` **sem `regApTribSN` no meio** — é essa a forma do grupo.
          isSimples ? `<regApTribSN>1</regApTribSN>` : ""
        }
        <regEspTrib>${escapeXml(company.regimeEspecialTributacao || "0")}</regEspTrib>
      </regTrib>
    </prest>

    <toma>
      <${docTag}>${escapeXml(tomadorDoc)}</${docTag}>
      <xNome>${escapeXml(data.tomador.nome)}</xNome>
    ${tomadorEnderecoXml}
    ${tomadorEmail ? `<email>${escapeXml(tomadorEmail)}</email>` : ""}
    </toma>

    <serv>
      <locPrest>
        <cLocPrestacao>${escapeXml(cLocPrestacao)}</cLocPrestacao>
      </locPrest>
      <cServ>
        <cTribNac>${escapeXml(cTribNac)}</cTribNac>
        <cTribMun>${escapeXml(cTribMun)}</cTribMun>
        <xDescServ>${escapeXml(data.servico.descricao)}</xDescServ>
      </cServ>
    </serv>

    <valores>
      <vServPrest>
        <vServ>${valorServicos}</vServ>
      </vServPrest>
      ${
        data.valores && ((data.valores.vDescIncond ?? 0) > 0 || (data.valores.vDescCond ?? 0) > 0)
          ? (() => {
              const descIncond = Math.max(0, data.valores.vDescIncond ?? 0);
              const descCond = Math.max(0, data.valores.vDescCond ?? 0);
              const hasDescCond = descCond > 0;
              const descCondXml = hasDescCond ? `<vDescCond>${descCond.toFixed(2)}</vDescCond>` : "";
              const descIncondXml = descIncond > 0 ? `<vDescIncond>${descIncond.toFixed(2)}</vDescIncond>` : "";
              return `<vDescCondIncond>
        ${descIncondXml}
        ${descCondXml}
      </vDescCondIncond>`;
            })()
          : ""
      }
      ${
        data.valores?.pDR !== undefined || data.valores?.vDR !== undefined
          ? `<vDedRed>
        ${
          data.valores?.pDR !== undefined
            ? `<pDR>${(data.valores.pDR ?? 0).toFixed(2)}</pDR>`
            : ""
        }
        ${
          data.valores?.vDR !== undefined
            ? `<vDR>${(data.valores.vDR ?? 0).toFixed(2)}</vDR>`
            : ""
        }
      </vDedRed>`
          : ""
      }
      <trib>
        <tribMun>
          <tribISSQN>1</tribISSQN>
          <tpRetISSQN>${tpRetISSQN}</tpRetISSQN>
        </tribMun>
        ${(() => {
          const piscofins = data.tribFed?.piscofins || {};
          const defaultPiscofins = {
            CST: "01",
            vBCPisCofins: 0,
            pAliqPis: 0,
            pAliqCofins: 0,
            vPis: 0,
            vCofins: 0,
            tpRetPisCofins: undefined,
            vBcRetPisCofins: undefined,
            vRetPisCofins: undefined,
          };
          const merged = {
            CST: piscofins.CST ?? defaultPiscofins.CST,
            vBCPisCofins: piscofins.vBCPisCofins ?? defaultPiscofins.vBCPisCofins,
            pAliqPis: piscofins.pAliqPis ?? defaultPiscofins.pAliqPis,
            pAliqCofins: piscofins.pAliqCofins ?? defaultPiscofins.pAliqCofins,
            vPis: piscofins.vPis ?? defaultPiscofins.vPis,
            vCofins: piscofins.vCofins ?? defaultPiscofins.vCofins,
            tpRetPisCofins: piscofins.tpRetPisCofins ?? defaultPiscofins.tpRetPisCofins,
            vBcRetPisCofins: piscofins.vBcRetPisCofins ?? defaultPiscofins.vBcRetPisCofins,
            vRetPisCofins: piscofins.vRetPisCofins ?? defaultPiscofins.vRetPisCofins,
          };

          const valorServico = Number(data.servico?.valorServicos ?? 0);

          // Se empresa é Simples (opSimpNac=3) e não há dados explícitos de PIS/COFINS, não enviar tribFed.
          const hasExplicitPisCofins = Object.values(piscofins || {}).some(
            (v) => v !== undefined && v !== null && v !== ""
          );
          if (isSimples && !hasExplicitPisCofins) {
            return "";
          }

          // Controle de retenção PIS/COFINS
          const tpRetRaw = merged.tpRetPisCofins;
          const hasTpRet =
            tpRetRaw !== undefined && tpRetRaw !== null && tpRetRaw !== "";
          const isRetencao = String(tpRetRaw) === "1";

          let retFieldsXml = "";
          if (isRetencao) {
            const baseRet =
              Number(merged.vBcRetPisCofins ?? merged.vBCPisCofins ?? 0) || 0;
            const vRet = Number(merged.vRetPisCofins ?? 0);
            if (!(baseRet > 0 && baseRet < valorServico)) {
              const err = new Error(
                `invalid_pis_cofins_ret_base: base ${baseRet} deve ser >0 e < valorServ (${valorServico})`
              );
              err.code = "INVALID_PIS_COFINS_RET_BASE";
              throw err;
            }
            retFieldsXml = `<tpRetPisCofins>1</tpRetPisCofins>
            <vBcRetPisCofins>${baseRet.toFixed(2)}</vBcRetPisCofins>
            <vRetPisCofins>${vRet.toFixed(2)}</vRetPisCofins>`;
          } else {
            // Sem retenção: tpRetPisCofins=2 e base/valor de retenção zerados.
            retFieldsXml = `<tpRetPisCofins>2</tpRetPisCofins>
            <vBcRetPisCofins>0.00</vBcRetPisCofins>
            <vRetPisCofins>0.00</vRetPisCofins>`;
          }

          return `<tribFed>
          <piscofins>
            <CST>${escapeXml(merged.CST)}</CST>
            <vBCPisCofins>${Number(merged.vBCPisCofins).toFixed(2)}</vBCPisCofins>
            <pAliqPis>${Number(merged.pAliqPis).toFixed(2)}</pAliqPis>
            <pAliqCofins>${Number(merged.pAliqCofins).toFixed(2)}</pAliqCofins>
            <vPis>${Number(merged.vPis).toFixed(2)}</vPis>
            <vCofins>${Number(merged.vCofins).toFixed(2)}</vCofins>
            ${retFieldsXml}
          </piscofins>
        </tribFed>`;
        })()}
        ${
          isSimples
            ? `<totTrib>
          <pTotTribSN>${pTotTribSN.toFixed(2)}</pTotTribSN>
        </totTrib>`
            : // ⚠ Não optante: PERCENTUAIS informados, não zeros cravados. A forma
              // (`pTotTrib` com os três filhos) é a da NFS-e real versionada em
              // `docs/leiaute-nfse/nfse-nacional-substituicao.xml`. O código anterior emitia
              // `vTotTrib` com `0.00` — outro grupo, e afirmando carga tributária zero. Chegar
              // aqui sem os percentuais já foi recusado acima (`MISSING_TOT_TRIB_NAO_SIMPLES`).
              `<totTrib>
          <pTotTrib>
            <pTotTribFed>${Number(totTribNaoSimples.pTotTribFed ?? 0).toFixed(2)}</pTotTribFed>
            <pTotTribEst>${Number(totTribNaoSimples.pTotTribEst ?? 0).toFixed(2)}</pTotTribEst>
            <pTotTribMun>${Number(totTribNaoSimples.pTotTribMun ?? 0).toFixed(2)}</pTotTribMun>
          </pTotTrib>
        </totTrib>`
        }
      </trib>
    </valores>
  </infDPS>
</DPS>`;

  return { xml, infId, localPrestacaoAssumido, cLocEmi, cLocPrestacao, opSimpNac, tpRetISSQN };
}

function buildDpsPayload({ company, data, numeracao, regime, certificadoAssinatura }) {
  const construido = buildDpsXml({ company, data, numeracao, regime });
  // E0718: quem assina é o certificado do EMITENTE da DPS — resolvido por empresa, nunca o PFX
  // global que ficava em `NFSE_CERT_PFX_PATH`.
  const signedXml = signDpsXml(construido.xml, certificadoAssinatura);
  const compressed = gzipSync(Buffer.from(signedXml, "utf-8")).toString("base64");
  return { ...construido, dpsXmlGZipB64: compressed, rawXml: signedXml };
}

function buildEventoPayload({ tipoEvento, justificativa, chaveSubstituta, numeroSubstituta }) {
  return {
    ambiente: NFSE_ENV === "homolog" ? "homolog" : "producao",
    tipoEvento,
    justificativa,
    // ⚠ `codigoMunicipio: NFSE_COD_MUNICIPIO` saiu daqui junto com a variável de ambiente. Ela
    // nunca foi definida em produção e este objeto só alimenta o `log.info` — o corpo que sai de
    // verdade é `{ [eventField]: <xml assinado> }`. Um município global também não faria sentido
    // numa carteira multi-empresa: o emissor é da EMPRESA (`Company.codigoMunicipioIbge`).
    ...(chaveSubstituta ? { chaveSubstituta } : {}),
    ...(numeroSubstituta ? { numeroSubstituta } : {}),
    dataEvento: formatDateTimeWithOffset(new Date()),
  };
}

/**
 * Regime tributário real da empresa, para o `opSimpNac` da DPS.
 *
 * ⚠ A AUTORIDADE É O `CadastroFiscal`, não a `Company`. É a mesma hierarquia que a apuração usa
 * ("o cadastro é AUTORIDADE"), e é ela que o contador mantém na aba Fiscal → Cadastro.
 * `Company.regimeTributario` entra como segunda leitura porque é o que existe nas empresas
 * anteriores ao módulo fiscal.
 *
 * ⚠ **Não há default.** Devolver `null` é a resposta certa quando nenhuma das duas fontes sabe —
 * `resolverOpSimpNac(null)` recusa a emissão. Um default aqui seria o defeito de novo, só que
 * escondido uma camada mais fundo.
 */
async function carregarRegimeDaEmpresa(company) {
  const portal = await prisma.portalClient.findUnique({
    where: { companyId: company.id },
    select: { id: true },
  });
  if (portal?.id) {
    const cadastro = await prisma.cadastroFiscal.findUnique({
      where: { portalClientId: portal.id },
      select: { regime: true },
    });
    if (cadastro?.regime) return cadastro.regime;
  }
  return company.regimeTributario || null;
}

function maskSensitive(value) {
  if (!value) return value;
  const str = String(value);
  if (str.length <= 6) return "***";
  return `${str.slice(0, 3)}***${str.slice(-3)}`;
}

export class NfseService {
  static async sendEvent({
    chaveAcesso,
    tipoEvento,
    justificativa,
    chaveSubstituta,
    numeroSubstituta,
    cMotivo,
    cnpjAutor,
    log,
  }) {
    if (!integrationReady()) {
      const err = new Error("NFSe: integração não configurada");
      err.code = "NFSE_NOT_CONFIGURED";
      throw err;
    }
    if (!chaveAcesso) {
      const err = new Error("chave_required");
      err.code = "NFSE_CHAVE_REQUIRED";
      throw err;
    }
    if (!tipoEvento) {
      const err = new Error("tipo_evento_required");
      err.code = "NFSE_TIPO_EVENTO_REQUIRED";
      throw err;
    }
    if (!justificativa) {
      const err = new Error("justificativa_required");
      err.code = "NFSE_JUSTIFICATIVA_REQUIRED";
      throw err;
    }
    // ⚠⚠ ESTE CAMINHO ESTÁ ERRADO PARA A SUBSTITUIÇÃO — MARCADO, NÃO CONSERTADO (Fase 4).
    //
    // **Substituir uma NFS-e NÃO é enviar o evento `e105102`.** Pelo Manual dos Contribuintes
    // §1.3.2.a, a substituição é feita com um `POST /nfse` — uma DPS NOVA, com o grupo `<subst>`
    // preenchido (`chSubstda` + `cMotivo` + `xMotivo`; há exemplo real versionado em
    // `docs/leiaute-nfse/nfse-nacional-substituicao.xml`) — e **o sistema nacional gera o evento
    // e105102 sozinho**, como consequência. Ou seja: o e105102 é o que se LÊ depois, não o que se
    // ENVIA.
    //
    // Mandar o evento à mão, como este caminho faz, é pedir ao ADN que registre um cancelamento
    // por substituição sem que exista a nota substituta — a nota "substituída" ficaria cancelada e
    // a substituta nunca teria sido emitida.
    //
    // ⚠ NÃO CONSERTAR AGORA, POR INSTRUÇÃO: o fluxo de cancelamento/substituição é Fase 4. Fica o
    // registro para que ninguém "complete" este caminho achando que ele só está incompleto — ele
    // está invertido. Note que `buildDpsXml` ainda **não monta o grupo `<subst>`**, então o
    // caminho certo também não existe ainda.
    //
    // ── Os dois campos abaixo são OBRIGATÓRIOS (1-1) no e105102 pelo ANEXO_II v1.01 — ver o
    // comentário de `buildEventoXml`. Recusar aqui é o que substituiu o fallback inventado
    // `<nNFSeSubst>`: sem a chave da substituta não existe evento de substituição, e o código do
    // motivo é justificativa fiscal de lista fechada (01…05, 99) que ninguém pode arbitrar.
    if (String(tipoEvento).toLowerCase() === "e105102") {
      if (normalizeDigits(chaveSubstituta).length !== 50) {
        const err = new Error("chave_substituta_required");
        err.code = "NFSE_CHAVE_SUBSTITUTA_REQUIRED";
        throw err;
      }
      if (!normalizeDigits(cMotivo)) {
        const err = new Error("c_motivo_required");
        err.code = "NFSE_CMOTIVO_REQUIRED";
        throw err;
      }
    }

    // ⚠ A EMPRESA É RESOLVIDA ANTES DO CLIENTE HTTP, porque é dela que sai o certificado — tanto o
    // que ASSINA o evento (E0718 vale para o autor do pedido de registro) quanto o do mTLS. Antes,
    // `buildAxiosClient()` e `signEventoXml()` usavam o PFX GLOBAL, e o CNPJ do autor era só um
    // campo de texto no XML: nada impedia declarar um CNPJ e assinar com o certificado de outro.
    const invoice = await NfseRepository.findByChaveAcesso(chaveAcesso);
    if (!invoice?.companyId) {
      const err = new Error("nfse_not_found");
      err.code = "NFSE_NOT_FOUND";
      throw err;
    }
    const companyDoEvento = await prisma.company.findUnique({ where: { id: invoice.companyId } });
    const autor = cnpjAutor || companyDoEvento?.cnpj || null;
    if (!autor) {
      const err = new Error("cnpj_autor_required");
      err.code = "NFSE_CNPJ_AUTOR_REQUIRED";
      throw err;
    }

    const certificados = await resolverCertificadosDaEmpresa(invoice.companyId);
    const client = buildAxiosClient(certificados.transporte);
    const nfsePath = NFSE_NFSE_PATH.replace(/\/+$/, "");
    const requestUrl = `${client.defaults.baseURL}${nfsePath}/${encodeURIComponent(
      chaveAcesso
    )}/eventos`;

    try {
      const payload = buildEventoPayload({
        tipoEvento,
        justificativa,
        chaveSubstituta,
        numeroSubstituta,
      });
      const eventoXml = buildEventoXml({
        tipoEvento,
        justificativa,
        cnpjAutor: autor,
        chaveAcesso,
        cMotivo,
        chaveSubstituta,
      });
      const signedEventoXml = signEventoXml(eventoXml, certificados.assinatura);
      const eventFormat = NFSE_EVENT_FORMAT === "gzipB64" ? "gzipB64" : "xml";
      const eventField = NFSE_EVENT_FIELD || "pedidoRegistroEventoXmlGZipB64";
      const eventPayloadValue =
        eventFormat === "gzipB64"
          ? gzipSync(Buffer.from(signedEventoXml, "utf-8")).toString("base64")
          : signedEventoXml;
      const requestBody = { [eventField]: eventPayloadValue };
      log.info(
        {
          url: requestUrl,
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          payload: {
            tipoEvento: payload.tipoEvento,
            justificativa: maskSensitive(payload.justificativa),
            chaveSubstituta: payload.chaveSubstituta
              ? maskSensitive(payload.chaveSubstituta)
              : undefined,
            numeroSubstituta: payload.numeroSubstituta || undefined,
            ambiente: payload.ambiente,
            eventField,
            eventFormat,
          },
        },
        "NFSe: enviando evento ao provedor nacional"
      );
      const { data: response } = await client.post(
        `${nfsePath}/${encodeURIComponent(chaveAcesso)}/eventos`,
        requestBody
      );
      return {
        status: "accepted",
        message: "Evento registrado com sucesso.",
        providerData: response,
      };
    } catch (err) {
      const axiosErr = err?.response;
      const providerData = axiosErr?.data;
      const providerDetail =
        providerData && typeof providerData === "object"
          ? JSON.stringify(providerData)
          : providerData;
      const reason =
        axiosErr?.data?.message ||
        axiosErr?.data?.error ||
        axiosErr?.data?.detail ||
        providerDetail ||
        err.message ||
        "Falha ao registrar evento";

      log.error(
        {
          err: reason,
          status: axiosErr?.status,
          data: providerData,
          baseUrl: NFSE_BASE_URL,
          url: requestUrl,
        },
        "Falha ao enviar evento NFS-e ao provedor nacional"
      );
      const error = new Error(reason);
      error.code = "NFSE_EVENT_FAILED";
      error.providerData = providerData;
      throw error;
    }
  }
  static async syncFromProvider({ companyId, filters = {}, log }) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) {
      const err = new Error("company_not_found");
      err.code = "COMPANY_NOT_FOUND";
      throw err;
    }

    if (!integrationReady()) {
      const err = new Error("NFSe: integração não configurada");
      err.code = "NFSE_NOT_CONFIGURED";
      throw err;
    }

    // ⚠ A CONSULTA TAMBÉM É PELO CERTIFICADO DA EMPRESA. É a mesma regra do ADN, já registrada no
    // `apps/api/CLAUDE.md`: *"o A1 do escritório nunca deve consultar notas"* — o escritório É
    // cadastrado no gov.br/nfse, então consultar com o certificado dele traz as notas DELE,
    // gravadas debaixo da empresa cliente. Aqui isso valia para os três caminhos, porque
    // `buildAxiosClient()` lia o PFX global.
    const certificados = await resolverCertificadosDaEmpresa(companyId);
    const client = buildAxiosClient(certificados.transporte);
    const idDps = filters.idDps;
    const chaveAcesso = filters.chaveAcesso || filters.numeroNfse;
    const hasPeriodo = Boolean(filters.from && filters.to);

    if (!idDps && !chaveAcesso && !hasPeriodo) {
      const err = new Error("nfse_sync_requires_id");
      err.code = "NFSE_SYNC_REQUIRES_ID";
      throw err;
    }

    const dpsPath = NFSE_DPS_PATH.replace(/\/+$/, "");
    const nfsePath = NFSE_NFSE_PATH.replace(/\/+$/, "");

    const items = [];

    if (hasPeriodo) {
      const consultaXml = buildConsultaPeriodoXml({ company, filters });
      const { data: response } = await client.post(NFSE_CONSULT_PATH, consultaXml, {
        headers: { "content-type": "application/xml" },
      });
      const responseText = Buffer.isBuffer(response)
        ? response.toString("utf-8")
        : typeof response === "string"
          ? response
          : response?.data || "";
      const parsedItems = parseConsultaPeriodoXml(responseText);
      items.push(...parsedItems);
    } else if (idDps) {
      const { data: dpsResponse } = await client.get(
        `${dpsPath}/${encodeURIComponent(idDps)}`
      );
      items.push(dpsResponse);
      const mappedDps = mapProviderItem(dpsResponse);
      const resolvedChaveAcesso = mappedDps.chaveAcesso || chaveAcesso;
      if (resolvedChaveAcesso) {
        const { data: nfseResponse } = await client.get(
          `${nfsePath}/${encodeURIComponent(resolvedChaveAcesso)}`
        );
        items.push(nfseResponse);
      }
    } else if (chaveAcesso) {
      const { data: nfseResponse } = await client.get(
        `${nfsePath}/${encodeURIComponent(chaveAcesso)}`
      );
      items.push(nfseResponse);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of items) {
      const mapped = mapProviderItem(item);
      if (!mapped.chaveAcesso && !mapped.idDps && !mapped.numeroNfse && !(mapped.rpsNumero && mapped.rpsSerie)) {
        skipped += 1;
        continue;
      }
      const result = await NfseRepository.upsertFromProvider({
        companyId,
        data: mapped,
      });
      if (result.action === "created") created += 1;
      else if (result.action === "updated") updated += 1;
      else skipped += 1;
    }

    log.info(
      {
        companyId,
        total: items.length,
        created,
        updated,
        skipped,
      },
      "NFSe: sincronizacao concluida"
    );

    return { total: items.length, created, updated, skipped };
  }

  /**
   * Emite a NFS-e pelo padrão nacional.
   *
   * ⚠ A ORDEM DAS ETAPAS É A CORREÇÃO, não um detalhe de arrumação:
   *
   *   1. **certificado da empresa** — antes de qualquer escrita. Sem A1 próprio não há emissão
   *      possível (E0718), e descobrir isso DEPOIS de reservar número queimaria numeração à toa;
   *   2. **reserva transacional de série + número** — o número sai do contador e entra na linha
   *      no MESMO commit;
   *   3. montagem/assinatura/envio;
   *   4. desfecho em CAMADAS (nosso × transporte × Receita).
   *
   * ⚠ **TENTATIVA REPETIDA REUSA A LINHA E O NÚMERO.** Como não existe inutilização na NFS-e,
   * número pulado é buraco permanente. `retryInvoiceId` reaproveita a `ServiceInvoice` de uma
   * tentativa anterior — e só é aceito quando a falha daquela linha LIBEROU o número (camadas
   * `NOSSA` e `RECEITA`). Falha de `TRANSPORTE` não libera: ali o desfecho é desconhecido.
   */
  static async issue({ data, log, retryInvoiceId = null }) {
    const company = await prisma.company.findUnique({
      where: { id: data.companyId },
    });
    if (!company) {
      const err = new Error("company_not_found");
      err.code = "COMPANY_NOT_FOUND";
      throw err;
    }

    const missing = buildMissingFields(company);
    if (missing.length) {
      const err = new Error("company_missing_fields");
      err.code = "COMPANY_MISSING_FIELDS";
      err.missing = missing;
      throw err;
    }

    if (!integrationReady()) {
      const err = new Error(
        "NFSe: integração não configurada — falta NFSE_BASE_URL (endpoint do sistema nacional)."
      );
      err.code = "NFSE_NOT_CONFIGURED";
      throw err;
    }

    // ── 1. CERTIFICADO DA PRÓPRIA EMPRESA (E0718) ────────────────────────────────────────
    //
    // ⚠ ANTES DE ESCREVER QUALQUER COISA. Falha aqui não deixa rastro de numeração: nada foi
    // reservado ainda. E a recusa é NOMEADA — `NO_COMPANY_CERT`, no molde da captura —, nunca uma
    // queda para o A1 do escritório.
    // Recusa de PRÉ-VOO: nada foi escrito ainda, então nem linha nem numeração existem para
    // gravar o motivo. A resposta em camadas é a mesma, com `nfse: null`.
    const recusaAntesDeEscrever = (err, contexto) => {
      const desfecho = classificarFalha(err);
      log.error(
        { companyId: company.id, code: err?.code, camada: desfecho.camada },
        `NFS-e: emissão recusada antes de reservar numeração (${contexto})`
      );
      return {
        status: desfecho.status,
        camada: desfecho.camada,
        codigo: desfecho.codigo,
        message: desfecho.mensagem,
        correcao: desfecho.correcao,
        numeroReutilizavel: desfecho.numeroReutilizavel,
        nfse: null,
      };
    };

    let certificados;
    try {
      certificados = await resolverCertificadosDaEmpresa(company.id);
    } catch (err) {
      return recusaAntesDeEscrever(err, "certificado da própria empresa");
    }

    // O regime é REGRA FISCAL declarada na DPS: a autoridade é o `CadastroFiscal` (a mesma fonte
    // que a apuração usa), com `Company.regimeTributario` como segunda leitura. Nenhuma das duas
    // tem default.
    const regime = await carregarRegimeDaEmpresa(company);

    // ── 1.b PRÉ-VOO DO CADASTRO ───────────────────────────────────────────────────────────
    //
    // ⚠ TUDO O QUE DÁ PARA SABER SEM O CONTADOR É CONFERIDO ANTES DE ENCOSTAR NELE. Município
    // emissor, série e regime são defeitos de CADASTRO: eles não dependem do número, e descobri-los
    // depois da reserva significaria mover o contador por causa de um campo em branco. A reserva é
    // transacional, então o número voltaria — mas o desfecho sairia como exceção não classificada
    // (a rota responderia 500), em vez da recusa nomeada com correção que o contador precisa ler.
    try {
      resolverCLocEmi(company);
      normalizarSerie(company.rpsSerie);
      const regTrib = resolverOpSimpNac(regime);
      if (regTrib.resolucao !== RESOLUCAO.RESOLVIDO) {
        const err = new Error(regTrib.motivo);
        err.code = "NFSE_REGIME_INDEFINIDO";
        err.correcao =
          "Cadastre/confirme o regime tributário da empresa na aba Fiscal → Cadastro. O regime é " +
          "declarado na própria DPS (opSimpNac) — emitir com o regime errado é declaração falsa.";
        throw err;
      }
    } catch (err) {
      return recusaAntesDeEscrever(err, "cadastro da empresa");
    }

    // ── 2. NUMERAÇÃO: RESERVA TRANSACIONAL ───────────────────────────────────────────────
    let record;
    let numeracao;
    if (retryInvoiceId) {
      const anterior = await prisma.serviceInvoice.findUnique({ where: { id: retryInvoiceId } });
      if (!anterior || anterior.companyId !== company.id) {
        const err = new Error("invoice_not_found");
        err.code = "NFSE_RETRY_INVOICE_NOT_FOUND";
        throw err;
      }
      if (anterior.falhaCamada === CAMADA.TRANSPORTE) {
        const err = new Error(
          "A tentativa anterior falhou no TRANSPORTE: não se sabe se a DPS foi processada. " +
            "Consulte o Id da DPS no sistema nacional antes de reemitir com este número."
        );
        err.code = "NFSE_NUMERO_EM_ESTADO_INDETERMINADO";
        throw err;
      }
      numeracao = { rpsSerie: anterior.rpsSerie, rpsNumero: anterior.rpsNumero };
      record = await NfseRepository.markIssued(anterior.id, {
        status: STATUS.PENDING,
        ...CAMPOS_DE_FALHA_LIMPOS,
      });
    } else {
      const reserva = await reservarNumeracao({
        companyId: company.id,
        rpsSerie: company.rpsSerie,
        criarLinha: (tx, { rpsSerie, rpsNumero }) =>
          tx.serviceInvoice.create({
            data: {
              companyId: data.companyId,
              clientId: data.clientId || null,
              tomadorDoc: data.tomador.doc,
              tomadorNome: data.tomador.nome,
              valorServicos: data.servico.valorServicos,
              aliquota: data.servico.aliquota,
              issRetido: data.servico.issRetido ?? false,
              competencia: data.competencia ? parseDate(data.competencia) : null,
              // ⚠ O `idDps` é montado a partir do número JÁ RESERVADO, dentro da mesma transação.
              // Antes ele saía de `buildDpsId(company)`, que relia o contador do cadastro — e o
              // incremento acontecia num `update` separado, depois do envio.
              idDps: buildDpsId(company, { rpsSerie, rpsNumero }),
              rpsSerie,
              rpsNumero,
              status: STATUS.PENDING,
            },
          }),
      });
      numeracao = { rpsSerie: reserva.rpsSerie, rpsNumero: reserva.rpsNumero };
      record = reserva.linha;
    }

    // ── 3. MONTAGEM, ASSINATURA E ENVIO ──────────────────────────────────────────────────
    let rawXml = null;
    let requestUrl = null;
    try {
      const client = buildAxiosClient(certificados.transporte);
      const construido = buildDpsPayload({
        company,
        data,
        numeracao,
        regime,
        certificadoAssinatura: certificados.assinatura,
      });
      rawXml = construido.rawXml;

      if (construido.localPrestacaoAssumido) {
        // Ver o bloco sobre a LC 116/2003, art. 3º em `buildDpsXml`. A suposição fica no log em
        // vez de invisível numa atribuição.
        log.info(
          { companyId: company.id, cLocEmi: construido.cLocEmi },
          "NFS-e: local da prestação não informado — assumido o município do emissor (regra geral da LC 116/2003, art. 3º, caput)"
        );
      }

      requestUrl = `${client.defaults.baseURL}${NFSE_PATH}`;
      const { data: response } = await client.post(NFSE_PATH, {
        dpsXmlGZipB64: construido.dpsXmlGZipB64,
      });

      const issued = await NfseRepository.markIssued(record.id, {
        status: response.status || STATUS.ISSUED,
        idDps: construido.infId,
        chaveAcesso: response.chaveAcesso || response.numeroNfse || null,
        numeroNfse: response.numeroNfse || null,
        codigoVerificacao: response.codigoVerificacao || response.codigo || null,
        xml: response.nfseXmlGZipB64 || rawXml || null,
        pdfUrl: response.pdfUrl || null,
        ...CAMPOS_DE_FALHA_LIMPOS,
      });

      // ⚠ NÃO HÁ MAIS INCREMENTO AQUI. O contador foi movido na RESERVA (etapa 2), dentro da
      // transação. O `update` que existia neste ponto — `String(Number(company.rpsNumero) + 1)` —
      // era o read-modify-write que gerava número repetido, e o `if (company.rpsNumero)` que o
      // guardava fazia toda empresa de contador nulo emitir "1" para sempre.

      return {
        status: issued.status || STATUS.ISSUED,
        message: "NFS-e emitida com sucesso (padrão nacional).",
        nfse: issued,
      };
    } catch (err) {
      // ── 4. DESFECHO EM CAMADAS ─────────────────────────────────────────────────────────
      //
      // ⚠ Timeout, DNS, 500 do provedor e recusa da Receita eram TODOS `status:"rejected"`, sem
      // coluna de motivo — e as validações NOSSAS, lançadas de dentro deste mesmo `try`, caíam no
      // mesmo balde: uma nota que nunca saiu da máquina ficava gravada como recusada pela Receita.
      const desfecho = classificarFalha(err);

      log.error(
        {
          camada: desfecho.camada,
          codigo: desfecho.codigo,
          err: desfecho.mensagem,
          status: err?.response?.status,
          data: desfecho.providerData,
          baseUrl: NFSE_BASE_URL,
          url: requestUrl,
          rpsSerie: numeracao.rpsSerie,
          rpsNumero: numeracao.rpsNumero,
          numeroReutilizavel: desfecho.numeroReutilizavel,
        },
        "Falha ao enviar NFS-e ao sistema nacional"
      );

      const gravado = await NfseRepository.markIssued(record.id, {
        ...camposDeFalha(desfecho),
        xml: rawXml || null,
      });

      return {
        status: desfecho.status,
        camada: desfecho.camada,
        codigo: desfecho.codigo,
        message: desfecho.mensagem,
        correcao: desfecho.correcao,
        numeroReutilizavel: desfecho.numeroReutilizavel,
        providerData: desfecho.providerData,
        url: requestUrl,
        nfse: gravado,
      };
    }
  }
}
