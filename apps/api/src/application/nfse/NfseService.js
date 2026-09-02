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
// As listas fechadas de `cMotivo` (uma por evento) e o tamanho de `xMotivo`, lidos do XSD
// oficial versionado. Ver o cabeçalho daquele arquivo para a fonte e para a varredura do ANEXO_I.
import { motivoValido, motivosDoEvento, validarJustificativa } from "./motivosDeEvento.js";

import { escolherCodigoServicoNacional } from "./codigoServicoDaNota.js";
import { resolverPerfilDeEmissao } from "./perfilEmissao/resolverPerfilDeEmissao.js";
import { ibscbsDaDps, nbsDaDps } from "./ibscbsDaDps.js";
import { pAliqDaDps } from "./pAliqDaDps.js";
import { registrarTomadorEmitido } from "./tomadorEmitido.js";
import {
  classificarFalha,
  CORRECAO_TRANSPORTE_EVENTO,
  camposDeFalha,
  CAMPOS_DE_FALHA_LIMPOS,
  CAMADA,
  STATUS,
} from "./desfechoEmissao.js";
import {
  INTEGRACAO_PERFIL_EMISSAO_NFSE,
  INTEGRACAO_NFSE_IBSCBS,
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

// ⚠⚠ VERSÃO DO LEIAUTE — SUBIU PARA 1.01 EM 01/09/2026, COM A INÉRCIA MEDIDA.
//
// ⚠⚠ **ESTE BLOCO DIZIA "1.00, E FICAR NELE É DECISÃO, NÃO INÉRCIA" ATÉ 01/09/2026.** A decisão de
// migrar é do dono e foi tomada junto com a de construir o IBS/CBS ("migrar para 1.01 e construir
// IBS/CBS junto"). O que este comentário registra é a EVIDÊNCIA que autorizou a troca, porque uma
// linha é fácil de subir e o efeito dela é um documento fiscal declarando outra versão.
//
// A Documentação Atual do portal publica o **1.01** (XSD de 11/02/2026; o pacote oficial traz
// `Schemas/1.00` E `Schemas/1.01`). Há regra de expiração de versão (**E0001**/**E1260**), e
// ⚠ **a data de corte NÃO está publicada**. O que o 1.01 acrescenta é o grupo `IBSCBS` (reforma
// tributária), **facultativo** — ele NÃO é montado por este gerador; ver `INTEGRACAO_NFSE_IBSCBS`.
//
// ⚠⚠ **A PROVA DE INÉRCIA: o MESMO XML que emitimos cabe nos DOIS esquemas.**
// `__tests__/dpsContraXsd.test.js` › *"o MESMO XML emitido cabe nas DUAS versões do esquema"* roda a
// checagem inteira (existência, ordem do `xs:sequence`, obrigatórios, `xs:choice`, facetas) contra
// 1.00 **e** 1.01, em três cenários. Não é "gerar duas vezes e comparar": é o documento que sai
// hoje cabendo nas duas.
//
// ⚠⚠ **DOZE TIPOS COMPLEXOS MUDARAM entre as versões, e CINCO deles o gerador escreve** — a leitura
// anterior deste projeto dizia que só o `TCTribMunicipal` havia mudado, e estava errada:
//
//   TCInfDPS         +IBSCBS? no fim                → inerte (opcional, não escrevemos)
//   TCServ           −lsadppu? −explRod?            → inerte (não escrevemos nenhum dos dois)
//   TCInfoCompl      +xPed? +gItemPed? no meio      → inerte (opcionais; o que escrevemos continua
//                                                     sendo subsequência válida)
//   TCLocPrest       o grupo casava com o VAZIO e   → inerte SÓ porque `buildDpsXml` SEMPRE escreve
//                    passou a exigir UMA opção        `<cLocPrestacao>` (ausente, cai para `cLocEmi`)
//   TCEndereco       idem, com outra codificação    → inerte SÓ porque SEMPRE escrevemos `<endNac>`
//
// ⚠⚠ OS DOIS ÚLTIMOS SÃO "INERTE POR ACIDENTE FELIZ", NÃO POR CONSTRUÇÃO. Quem tornar o
// `cLocPrestacao` ou o `endNac` condicional **precisa escrever o irmão** (`cPaisPrestacao` /
// `endExt`): deixar os dois de fora é DPS **recusada no 1.01 e ACEITA no 1.00** — ou seja, o defeito
// não apareceria antes da troca de versão.
//
// ⚠⚠ **ESTA CONSTANTE É O ORÁCULO.** `__tests__/dpsContraXsd.test.js` carrega o esquema
// `Schemas/${DPS_VERSAO}` a partir DELA, e um teste falha se o diretório não existir. Antes de
// 01/09/2026 o teste fixava `1.01` enquanto o gerador emitia `1.00`: **ele validava o documento
// contra o esquema errado**. Isso importa daqui para a frente porque `TCTribMunicipal`
// **reordenou os filhos** entre as versões — no instante em que o `tribMun` crescer (`pAliq`, `BM`,
// `exigSusp`), um oráculo desalinhado aprovaria a ordem de uma versão num documento que declara a
// outra. É a classe exata do E1235 que já custou três notas.
// **Trocar esta linha muda o esquema conferido junto, por construção.**
//
// ⚠ O ANÚNCIO da troca é `emissaoDps.test.js` › *"versão do leiaute sai da constante única"*, que
// fixa o literal DE PROPÓSITO — sem ele, a versão do documento fiscal mudaria sem nada ficar
// vermelho. Ele é a única coisa entre uma troca de versão e a produção.
//
// ⚠ **A primeira emissão real em 1.01 precisa ser acompanhada.** Nenhum teste substitui isso: o
// oráculo não confere as Regras de Negócio (`E####`) do Anexo I, e a expiração de versão é uma delas.
export const DPS_VERSAO = "1.01";

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
  // ⚠⚠ AS DUAS LISTAS DE `cMotivo` SÃO DIFERENTES, e nenhuma delas é normalizada aqui.
  //
  //   `e101101` (cancelamento)  → `TSCodJustCanc`  = "1" "2" "9"     — UM caractere
  //   `e105102` (substituição)  → `TSCodJustSubst` = "01"…"05" "99"  — DOIS caracteres
  //
  // Fonte e varredura em `application/nfse/motivosDeEvento.js`, que é quem VALIDA (em `sendEvent`,
  // antes de assinar). Aqui o valor entra como veio, de propósito: um `padStart` neste ponto
  // "consertaria" `"1"` para `"01"` num cancelamento e mandaria ao sistema nacional um código de
  // outra lista, que volta como erro de schema sem dizer qual foi a confusão.
  //
  // ⚠⚠ O `|| "1"` DO RAMO DO CANCELAMENTO FOI REMOVIDO EM 19/08/2026, E ERA UM DEFEITO REAL: sem
  // `cMotivo`, este código declarava ao sistema nacional **"1 — Erro na emissão"** por conta
  // própria. Quem cancelasse por "Serviço não prestado" declarava outra coisa. O ramo irmão já
  // recusava a ausência; este arbitrava — e o comentário que estava aqui dizia, desde sempre, que
  // "o código é uma justificativa FISCAL e não se arbitra uma". A regra existia; o ramo não a seguia.
  const eventoXml =
    String(tipoEvento).toLowerCase() === "e105102"
      ? `<e105102>
      <xDesc>Cancelamento de NFS-e por Substituição</xDesc>
      <cMotivo>${escapeXml(String(cMotivo))}</cMotivo>
      <xMotivo>${escapeXml(motivoTexto)}</xMotivo>
      <chSubstituta>${escapeXml(normalizeDigits(chaveSubstituta).slice(-50).padStart(50, "0"))}</chSubstituta>
    </e105102>`
      : `<e101101>
      <xDesc>Cancelamento de NFS-e</xDesc>
      <cMotivo>${escapeXml(String(cMotivo))}</cMotivo>
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
/**
 * ⚠⚠ `perfil` É A CAMADA DE CIMA, E `null` É O CAMINHO DE HOJE.
 *
 * Ele só chega preenchido com `INTEGRACAO_PERFIL_EMISSAO_NFSE` ligada. `null` faz cada leitura
 * abaixo cair exatamente no que ela era antes — e é isso que o teste de INÉRCIA prova, byte a byte.
 *
 * ⚠ A PRECEDÊNCIA É **POR CAMPO**, e o perfil vence o payload nos seis. O motivo está escrito no
 * `pTotTrib`: *"um valor velho preso no formulário sobrescreveria em silêncio a correção do
 * contador"*. Estes seis são configuração do CONTADOR — o cliente não os envia mais.
 * ⚠ Perfil com campo NULO não apaga nada: cai para o cadastro. `{...cadastro, ...perfil}` seria o
 * defeito, não a solução.
 */
function buildDpsXml({ company, data, numeracao, regime, perfil = null }) {
  // ⚠⚠ DOIS CAMPOS DEIXAM DE SER CONSTANTE AQUI, e é o que a fase 2 destrava:
  //
  //   `regApTribSN` .. estava cravado em "1" para TODO optante, e `CadastroFiscal.sublimiteICMSISS`
  //                    é literalmente o cadastro do caso 2 — empresa do Simples acima do sublimite
  //                    declarava o regime de apuração ERRADO;
  //   `tribISSQN` .... estava cravado em "1" — era por isso que exportação de serviço (valor 3) era
  //                    impossível de declarar, havendo empresa na carteira que presta para o
  //                    exterior.
  //
  // ⚠ Sem perfil, os dois continuam "1". A mudança é de FONTE, não de valor padrão.
  //
  // ⚠⚠ NUNCA escreva comentário XML (`<!-- -->`) dentro deste template: ele iria PARA DENTRO do
  // documento fiscal assinado. A primeira versão desta mudança fez isso — e o backtick de dentro
  // do comentário fechou o template literal antes da hora, o que derrubou seis suítes e foi o que
  // denunciou o erro maior. Explicação de código fica em comentário de código, aqui em cima.
  /** O valor do perfil, se ele respondeu este campo. Vazio conta como não respondido. */
  const doPerfil = (campo) => {
    const v = perfil?.[campo];
    if (v === null || v === undefined) return null;
    const t = String(v).trim();
    return t === "" ? null : t;
  };
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
  // ⚠ O CÓDIGO DESTA NOTA VEM DA ESCOLHA DA EMISSÃO — quando houve escolha. Até 18/08/2026 esta
  // linha lia `company.codigoServicoNacional` e mais nada, e por isso a empresa com N códigos
  // cadastrados emitia sempre sob o mesmo. **O valor que chega aqui já passou pela trava**
  // (`escolherCodigoServicoNacional`, no pré-voo de `issue`): ele é, obrigatoriamente, um dos
  // códigos do CADASTRO. Sem escolha, `data.servico.codigoServicoNacional` é nulo e o caminho é o
  // de sempre. ⚠ Nunca leia o payload cru aqui — a autoridade é o cadastro, e quem a aplica é o
  // pré-voo.
  const cTribNacRaw = (
    data.servico?.codigoServicoNacional ||
    company.codigoServicoNacional ||
    codigoServico ||
    ""
  ).replace(/\D+/g, "");
  const cTribNac = cTribNacRaw ? cTribNacRaw.padStart(6, "0").slice(-6) : "";
  // ⚠ O PERFIL VENCE O CADASTRO — e o `.slice(-3)` continua, porque ele descreve o XML, não o
  // código que a prefeitura publica. A rota do perfil já grava só `[0-9]{3}`, então aqui o corte é
  // no-op para valor vindo do perfil; ele segue existindo para o valor legado da `Company`, que
  // nunca teve comprimento provado.
  const cTribMunRaw = (doPerfil("codigoServicoMunicipal") || company.codigoServicoMunicipal || codigoServico || "")
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
  // ⚠ O perfil entra como fonte do LOCAL, antes da queda para o emissor. Ele não desfaz a regra
  // geral do `caput`: ausente no perfil E no payload, a queda e o `localPrestacaoAssumido`
  // continuam exatamente como eram.
  const cLocPrestacaoInformado = String(
    doPerfil("cLocPrestacao") || data.servico?.cLocPrestacao || ""
  ).replace(/\D+/g, "");
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
  // ⚠⚠ A ESTRUTURA ESTÁ CONFIRMADA CONTRA A NFS-e REAL VERSIONADA, e ela decide o desenho.
  // `docs/leiaute-nfse/nfse-nacional-substituicao.xml` (`opSimpNac=1`, não optante) traz, dentro
  // de `infDPS/valores/trib`, exatamente:
  //
  //     <totTrib><pTotTrib>
  //       <pTotTribFed>11.33</pTotTribFed>
  //       <pTotTribEst>0.00</pTotTribEst>
  //       <pTotTribMun>0.00</pTotTribMun>
  //     </pTotTrib></totTrib>
  //
  // — os TRÊS filhos presentes, nesta ordem, `pTotTrib` filho único de `totTrib`, sem irmãos.
  //
  // ⚠⚠ E É ELA QUE PROVA O DEFEITO QUE ESTE BLOCO ACABA DE CONSERTAR. O gate anterior usava
  // `.some()`: **UM** percentual presente liberava a emissão, e o XML escrevia `?? 0` nos outros
  // dois. Ou seja, o contador configurava só o municipal e a nota saía AFIRMANDO ao tomador carga
  // federal 0,00% e estadual 0,00%. Zero fabricado por omissão — e aqui ele vai IMPRESSO, por
  // força da Lei 12.741/2012.
  //
  // A amostra mostra `0.00` LEGÍTIMO em dois dos três campos (serviço não tem ICMS). Logo zero
  // **declarado** existe e é normal — e por isso mesmo zero **por descuido** não pode produzir o
  // mesmo XML. A diferença tem de estar NO DADO, não no acaso: exigem-se os TRÊS, e a recusa
  // NOMEIA quais faltam. Omitir filho não é alternativa: a nota real os traz todos.
  //
  // ⚠ A FONTE É O CADASTRO DA EMPRESA — pedido do dono (18/08/2026): *"as alíquotas efetivas do
  // presumido não precisam ser calculadas (…) mas deve ser configurado do lado do contador, no
  // portal do contador."* O payload da emissão continua podendo informá-los (é assim que o
  // escritório emite uma nota com carga diferente da cadastrada), e quando informa, VENCE — mas a
  // ausência dele cai no cadastro, não em zero. ⚠ NADA É CALCULADO: não há de-para
  // CNAE→presunção neste repositório, e errar entre 8% e 32% inverteria a comparação.
  //
  // ⚠ Cada campo resolve SOZINHO (payload → cadastro). Exigir o grupo inteiro de uma fonte só
  // faria a nota que corrige apenas o federal perder o municipal já cadastrado.
  const totTribInformado = data.totTrib || {};
  const informado = (v) => v !== undefined && v !== null && v !== "";
  const CAMPOS_TOT_TRIB = [
    ["pTotTribFed", "federal"],
    ["pTotTribEst", "estadual"],
    ["pTotTribMun", "municipal"],
  ];
  const totTribNaoSimples = {};
  const totTribFaltando = [];
  // ⚠ SÓ O NÃO OPTANTE PASSA POR AQUI. Para o Simples este grupo não vai ao XML (ele declara
  // `pTotTribSN`), então recusar a nota por um valor torto nestas colunas seria bloquear uma
  // emissão legítima por causa de um campo que ela não usa.
  for (const [campo, rotulo] of isSimples ? [] : CAMPOS_TOT_TRIB) {
    const doPayload = totTribInformado[campo];
    const doCadastro = company?.[campo];
    // `Number(Decimal)` funciona: o Prisma devolve `Decimal` (decimal.js), cujo `valueOf` é a
    // representação numérica. O cadastro guarda NULL quando não configurado — nunca 0 por default.
    const bruto = informado(doPayload) ? doPayload : informado(doCadastro) ? doCadastro : null;
    if (bruto === null) {
      totTribFaltando.push({ campo, rotulo });
      continue;
    }
    const n = Number(bruto);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      const err = new Error(
        `A carga tributária aproximada ${rotulo} (${campo}) não é um percentual válido: ${bruto}.`
      );
      err.code = "INVALID_TOT_TRIB_NAO_SIMPLES";
      err.correcao =
        `Informe ${campo} como percentual entre 0 e 100 no cadastro da empresa ` +
        "(Editar cadastro → Emissão de NFS-e → Carga tributária aproximada).";
      throw err;
    }
    totTribNaoSimples[campo] = n;
  }
  if (!isSimples && totTribFaltando.length) {
    const listados = totTribFaltando.map((f) => `${f.campo} (${f.rotulo})`).join(", ");
    const err = new Error(
      "Empresa não optante do Simples: a carga tributária aproximada (Lei 12.741/2012) não está " +
        `completa — falta ${listados}. O código emitia 0,00 nos campos ausentes, ` +
        "que AFIRMA carga zero ao tomador."
    );
    err.code = "MISSING_TOT_TRIB_NAO_SIMPLES";
    // ⚠ A LISTA VIAJA NOMEADA, no molde de `company_missing_fields`: a tela precisa dizer QUAL
    // percentual falta. "Falta a carga tributária" manda o contador conferir os três.
    err.faltando = totTribFaltando.map((f) => f.campo);
    err.correcao =
      "Cadastre os TRÊS percentuais em Editar cadastro → Emissão de NFS-e → Carga tributária " +
      "aproximada. ⚠ Os três são exigidos mesmo quando algum é 0,00: zero DECLARADO é legítimo " +
      "(a NFS-e real de referência declara 0,00 no estadual), mas zero por omissão afirmaria ao " +
      "tomador uma carga que ninguém conferiu. Estes percentuais são do contador — o sistema não " +
      "os calcula.";
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
  // ⚠⚠ A ALÍQUOTA PODE VIR DO PERFIL, e desde 02/09/2026 ela VEM de lá no Simples. A caixa "ISS
  // retido" passou a existir na tela do cliente também no Simples (decisão do dono, 01/09/2026),
  // e nesse regime o campo do NÚMERO **não** aparece para ele — quem declara a alíquota é o
  // contador, no perfil. Lendo só o payload, esta guarda recusaria toda nota do Simples com ISS
  // retido, e o conserto ficaria fora do alcance de quem recebeu a recusa.
  const aliquotaEfetiva = doPerfil("pAliq") ?? aliquota;
  if (retencao.exigeAliquota && !(Number(aliquotaEfetiva) > 0)) {
    const err = new Error(
      "ISS retido exige alíquota do ISSQN maior que zero, e nenhuma foi informada."
    );
    err.code = "NFSE_ISS_RETIDO_SEM_ALIQUOTA";
    err.correcao =
      "No Simples Nacional, quem declara a alíquota de ISS é o contador, no perfil de emissão da "
      + "empresa. Fora do Simples, informe a alíquota no assistente de emissão.";
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

  // ── NBS E IBS/CBS (02/09/2026) ─────────────────────────────────────────────────────────────
  //
  // ⚠⚠ AS MESMAS FUNÇÕES PURAS SÃO CHAMADAS NO PRÉ-VOO DE `issue`, e é lá que a recusa acontece —
  // ANTES de reservar numeração, porque não existe inutilização na NFS-e. Aqui elas são chamadas de
  // novo com as MESMAS entradas: mesma função + mesmas entradas não divergem, que é o motivo de a
  // decisão não ser passada por parâmetro.
  //
  // ⚠ Se mesmo assim chegar aqui recusado, LANÇA. É caminho que não deveria existir; falhar alto
  // é melhor que emitir documento fiscal sem a tag que a regra exige.
  // ⚠⚠ UMA VARIÁVEL SÓ para o `regApTribSN`: ela vai ao XML **e** decide o `pAliq`. Recalcular a
  // expressão nos dois lugares é como as duas respostas divergem — e aqui a divergência sairia
  // como nota rejeitada por E0621 (alíquota obrigatória e ausente) ou E0625 (proibida e presente).
  const regApTribSN = doPerfil("regApTribSN") || "1";

  // ⚠⚠ A ALÍQUOTA DO ISSQN: **o perfil vence o payload**. Decisão do dono — *"o contador declara a
  // alíquota de ISS para reter, mas o cliente na tela dele deve poder selecionar se é retido ou
  // não"*. A caixa é do cliente (depende do TOMADOR daquela nota); o número é do contador (depende
  // da EMPRESA). Sem perfil, o caminho é o de hoje: o valor do payload.
  const pAliqDaNota = pAliqDaDps({
    opSimpNac,
    regApTribSN: isSimples ? regApTribSN : null,
    tpRetISSQN,
    aliquota: aliquotaEfetiva,
  });
  if (!pAliqDaNota.ok) {
    const err = new Error(pAliqDaNota.message);
    err.code = pAliqDaNota.codigo;
    err.correcao = pAliqDaNota.correcao;
    throw err;
  }

  const nbsDaNota = nbsDaDps(perfil);
  if (!nbsDaNota.ok) {
    const err = new Error(nbsDaNota.message);
    err.code = nbsDaNota.codigo;
    err.correcao = nbsDaNota.correcao;
    throw err;
  }
  const ibsCbs = ibscbsDaDps({
    cTribNac,
    perfil,
    ligado: INTEGRACAO_NFSE_IBSCBS,
    cNBS: nbsDaNota.cNBS,
  });
  if (!ibsCbs.ok) {
    const err = new Error(ibsCbs.message);
    err.code = ibsCbs.codigo;
    err.correcao = ibsCbs.correcao;
    throw err;
  }
  // ⚠ A ORDEM DOS FILHOS É A DO `xs:sequence` de `TCRTCInfoIBSCBS` e de `TCRTCInfoTributosSitClas`
  // (XSD 1.01). O oráculo `dpsContraXsd.test.js` confere isso contra o arquivo — e confere contra a
  // versão que a constante `DPS_VERSAO` declara, que é o conserto de 01/09/2026.
  const blocoIbsCbs = ibsCbs.informar
    ? `<IBSCBS>
      <finNFSe>${escapeXml(ibsCbs.bloco.finNFSe)}</finNFSe>
      <cIndOp>${escapeXml(ibsCbs.bloco.cIndOp)}</cIndOp>
      <indDest>${escapeXml(ibsCbs.bloco.indDest)}</indDest>
      <valores>
        <trib>
          <gIBSCBS>
            <CST>${escapeXml(ibsCbs.bloco.cst)}</CST>
            <cClassTrib>${escapeXml(ibsCbs.bloco.cClassTrib)}</cClassTrib>
          </gIBSCBS>
        </trib>
      </valores>
    </IBSCBS>`
    : "";

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
          // ⚠⚠ ELE ESTAVA CRAVADO EM "1" PARA TODO OPTANTE, e `CadastroFiscal.sublimiteICMSISS` é
          // literalmente o cadastro do caso **2** — empresa do Simples acima do sublimite declarava
          // o regime de apuração ERRADO. Sem perfil, o "1" continua (o comportamento de hoje).
          isSimples ? `<regApTribSN>${escapeXml(regApTribSN)}</regApTribSN>` : ""
        }
        <regEspTrib>${escapeXml(doPerfil("regEspTrib") || company.regimeEspecialTributacao || "0")}</regEspTrib>
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
        ${nbsDaNota.informar ? `<cNBS>${escapeXml(nbsDaNota.cNBS)}</cNBS>` : ""}
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
          <tribISSQN>${escapeXml(doPerfil("tribISSQN") || "1")}</tribISSQN>
          <tpRetISSQN>${tpRetISSQN}</tpRetISSQN>
          ${
            // ⚠ NO 1.01 O `pAliq` É O ÚLTIMO FILHO de `TCTribMunicipal`; no 1.00 ele vinha ANTES do
            // `tpRetISSQN`. Foi por isso que a subida de versão teve de vir primeiro — escrever a
            // ordem de uma versão num documento que declara a outra é a classe do E1235.
            pAliqDaNota.informar ? `<pAliq>${escapeXml(pAliqDaNota.pAliq)}</pAliq>` : ""
          }
        </tribMun>
        ${(() => {
          // ── PIS/COFINS (grupo `trib/tribFed/piscofins`) ──────────────────────────────────────
          //
          // ⚠⚠ ESTE BLOCO RECUSOU TRÊS NOTAS FISCAIS REAIS EM PRODUÇÃO (21/08/2026, ambiente 1):
          //
          //     E1235 - Falha no esquema XML do DF-e.
          //     The element 'piscofins' in namespace 'http://www.sped.fazenda.gov.br/nfse'
          //     has invalid child element 'vBcRetPisCofins' in namespace '...'
          //
          // Ele escrevia DOIS elementos que NÃO EXISTEM no leiaute — `vBcRetPisCofins` e
          // `vRetPisCofins` —, nos DOIS caminhos (com e sem retenção). Conferido nas duas fontes
          // oficiais versionadas neste repositório; `grep -rin` nos dois nomes dentro de
          // `docs/leiaute-nfse/` devolve **zero**:
          //
          //   · XSD     `…/esquemas-xsd/Schemas/1.01/tiposComplexos_v1.01.xsd:2020`
          //             (`TCTribOutrosPisCofins`; a 1.00 é idêntica neste ponto)
          //   · Anexo I `…/anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx`,
          //             aba "LEIAUTE DPS_NFS-e ", coluna `#` 313 a 320
          //
          // ⚠⚠ COMO CITAR ESTA PLANILHA — errar isto já aconteceu nesta mesma correção. Cada linha
          // tem TRÊS numerações que NÃO coincidem: a coluna `#` (dado da planilha), o número da
          // linha do Excel (`<row r="…">`) e o índice do array de quem lê por script. Na aba de
          // LEIAUTE a coluna `#` casa com o índice do array; **na aba de RN, não** (lá `#` = linha
          // do Excel − 3). Por isso toda Regra de Negócio abaixo é citada pelo **código do erro +
          // campo**, que são únicos e não dependem de numeração nenhuma.
          //
          // ⚠ E NÃO SE LÊ ESTA PLANILHA POR `sharedStrings.xml`: aquele arquivo é um POOL de
          // strings sem linha; strings vizinhas nele não são vizinhas na planilha, e parear código
          // com texto por adjacência produz um deslocamento de uma linha — que aqui significa
          // atribuir a regra de um campo ao campo ao lado. As colunas são `[2]` CAMPO, `[3]`
          // REGRAS DE NEGÓCIO, `[7]` CÓD. ERRO, `[8]` MSG. ERRO, na MESMA linha.
          //
          // `TCTribOutrosPisCofins` tem EXATAMENTE SETE filhos, NESTA ORDEM. Só `CST` é
          // obrigatório (`1-1`); os outros seis são `minOccurs="0"` (`0-1`):
          //
          //     CST · vBCPisCofins · pAliqPis · pAliqCofins · vPis · vCofins · tpRetPisCofins
          //
          // ⚠ POR QUE SÓ QUEBROU AGORA — e não é coincidência de data. Enquanto `opSimpNac` era
          // cravado em `"3"` (`066bd510^`: `const opSimpNac = "3"; const isSimples = …"3"`),
          // `isSimples` era SEMPRE verdadeiro, e como `data.tribFed` **não tem produtor nenhum**
          // no repositório (`validateNfsePayload` não monta o campo), `hasExplicitPisCofins` era
          // SEMPRE falso: o `return ""` engolia o grupo em toda emissão. O commit `11187501`
          // ligou a emissão do Lucro Presumido — `isSimples` passou a vir do regime REAL e a
          // guarda deixou de valer para o não optante. Código que nunca havia sido exercido virou
          // XML no primeiro lote de produção. Não é bug novo: é bug antigo que ficou alcançável.
          //
          // ⚠⚠ E O GRUPO NÃO VOLTA COM ZEROS — a evidência é uma nota REAL, não uma opinião.
          // A NFS-e de empresa NÃO OPTANTE versionada aqui
          // (`docs/leiaute-nfse/nfse-nacional-substituicao.xml`, `opSimpNac=1`) traz o `<trib>`
          // com **`tribMun` e `totTrib`, e mais nada**: `tribFed` está AUSENTE. O grupo é
          // `minOccurs="0"` no XSD, `0-1` no Anexo I (linha 312), e nenhuma RN o exige.
          // Escrever `CST 01` ("Operação Tributável com Alíquota Básica") com base, alíquotas e
          // valores `0.00` não é preenchimento técnico — é AFIRMAR que a empresa não deve
          // PIS/COFINS, exatamente o defeito do `vTotTrib 0.00` e do `?? 0` da carga tributária
          // já consertados neste arquivo. **Ausência não é afirmação.**
          const piscofins = data.tribFed?.piscofins || {};
          const infPC = (v) => v !== undefined && v !== null && v !== "";

          // ⚠ HOJE NADA CHEGA AQUI COM DADO. `application/validators/nfsePayload.js` não monta
          // `tribFed`, e não há outro produtor no repositório — logo este `return ""` é o caminho
          // de 100% das emissões, para Simples E para não optante. O que vem abaixo é a porta
          // para quando alguém passar a informar PIS/COFINS: ela nasce montando o que o leiaute
          // comporta e RECUSANDO NOMEADAMENTE o que ele não comporta.
          if (!Object.values(piscofins).some(infPC)) return "";

          // ⚠⚠ OS DOIS NOMES INVENTADOS NÃO VOLTAM POR OUTRA PORTA — e não são descartados em
          // silêncio. Descartar um valor de retenção sem dizer nada é o pior desfecho possível
          // aqui: a nota sai afirmando menos imposto do que o contador declarou.
          for (const inexistente of ["vBcRetPisCofins", "vRetPisCofins"]) {
            if (infPC(piscofins[inexistente])) {
              const err = new Error(
                `O campo '${inexistente}' NÃO EXISTE no leiaute da NFS-e — nem no XSD ` +
                  "(`TCTribOutrosPisCofins`), nem no Anexo I. Foi exatamente ele que produziu o " +
                  "E1235 em produção. Nada foi enviado."
              );
              err.code = "NFSE_PIS_COFINS_CAMPO_INEXISTENTE";
              err.correcao =
                "O grupo `piscofins` comporta só sete campos: CST, vBCPisCofins, pAliqPis, " +
                "pAliqCofins, vPis, vCofins e tpRetPisCofins. Não há campo de BASE DE RETENÇÃO " +
                "de PIS/COFINS no leiaute. O VALOR retido viaja em vPis/vCofins (e o da CSLL em " +
                "tribFed/vRetCSLL), com tpRetPisCofins dizendo quais contribuições foram retidas.";
              throw err;
            }
          }

          // `CST` é o único filho obrigatório do grupo. Sem ele o grupo não pode existir — e o
          // default `"01"` que havia aqui era uma escolha fiscal feita pelo código.
          if (!infPC(piscofins.CST)) {
            const err = new Error(
              "O grupo PIS/COFINS foi informado sem `CST`, que é o único filho obrigatório de " +
                "`TCTribOutrosPisCofins` (XSD `1-1`)."
            );
            err.code = "NFSE_PIS_COFINS_SEM_CST";
            err.correcao =
              "Informe o CST do PIS/COFINS (tabela no XSD `TSTipoCST` / Anexo I, aba LEIAUTE, " +
              "coluna # 314). O " +
              "código NÃO arbitra um: '01' é 'Operação Tributável com Alíquota Básica', que é " +
              "uma afirmação sobre a incidência, não um preenchimento técnico.";
            throw err;
          }

          // ⚠ `tpRetPisCofins` aceita **0 a 9**, não só 1/2 — o código antigo só conhecia esses
          // dois e cravava `2` em todo o resto. Fonte: `TSTipoRetPISCofins`
          // (`tiposSimples_v1.01.xsd:1231`) e Anexo I, aba LEIAUTE, coluna `#` 320.
          const TP_RET_PIS_COFINS = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
          const tpRet = infPC(piscofins.tpRetPisCofins)
            ? String(piscofins.tpRetPisCofins).trim()
            : null;
          if (tpRet !== null && !TP_RET_PIS_COFINS.has(tpRet)) {
            const err = new Error(
              `tpRetPisCofins inválido: '${tpRet}'. O leiaute aceita 0 a 9 (TSTipoRetPISCofins).`
            );
            err.code = "NFSE_PIS_COFINS_TP_RET_INVALIDO";
            err.correcao =
              "Valores válidos: 0 PIS/COFINS/CSLL Não Retidos · 1 PIS/COFINS Retidos · 2 " +
              "PIS/COFINS Não Retidos · 3 PIS/COFINS/CSLL Retidos · 4 PIS/COFINS Retidos, CSLL " +
              "Não Retido · 5 PIS Retido, COFINS/CSLL Não Retido · 6 COFINS Retido, PIS/CSLL Não " +
              "Retido · 7 PIS Não Retido, COFINS/CSLL Retidos · 8 PIS/COFINS Não Retidos, CSLL " +
              "Retido · 9 COFINS Não Retido, PIS/CSLL Retidos.";
            throw err;
          }

          // ⚠⚠ ONDE O LEIAUTE COMPORTA A RETENÇÃO — medido, não suposto:
          //
          //   · a OBSERVAÇÃO do próprio `tpRetPisCofins` (aba "LEIAUTE DPS_NFS-e ", coluna `#`
          //     320, coluna OBSERVAÇÕES): *"Indica quais contribuições retidas na fonte compoem o
          //     campo vRetCSLL."*
          //   · RN **E0720** (aba "RN DPS_NFS-e", campo `vRetCSLL`): se `tpRetPisCofins = 0`, é
          //     PROIBIDO informar `vRetCSLL`.
          //   · RN **E0724** (mesma aba, mesmo campo): se `tpRetPisCofins` for DIFERENTE de `0` e
          //     de `2`, é OBRIGATÓRIO informar `vRetCSLL`.
          //   · NT 008 §2.4.5 (transcrita em `danfse/danfseLeiaute.js`): no DANFSe, com
          //     `tpRetPisCofins = 1`, "Contribuições Sociais - Retidas" = `vRetCSLL + vPis +
          //     vCofins`, e `vPis`/`vCofins` são impressos como `0,00`.
          //
          // Ou seja: **não existe campo de base de retenção**, e o valor retido não tem um campo
          // próprio — ele mora em `vPis`/`vCofins` (PIS/COFINS) e em `tribFed/vRetCSLL` (CSLL),
          // com `tpRetPisCofins` dizendo como lê-los.
          //
          // ⚠ `vRetCSLL` NÃO É MONTADO POR ESTE GERADOR. Enquanto não for, declarar retenção
          // seria emitir uma DPS que a RN E0724 rejeita — ou, pior, que passa sem o valor. Por
          // isso RECUSA NOMEADA, e a decisão de construir `vRetCSLL` (com o rateio PIS × COFINS ×
          // CSLL, que é ato do contador) fica com o dono.
          if (tpRet !== null && tpRet !== "0" && tpRet !== "2") {
            const err = new Error(
              `Retenção de PIS/COFINS/CSLL declarada (tpRetPisCofins=${tpRet}), e este gerador ` +
                "ainda não monta `tribFed/vRetCSLL` — que a RN E0724 torna OBRIGATÓRIO para todo " +
                "tpRetPisCofins diferente de 0 e de 2. Nada foi enviado."
            );
            err.code = "NFSE_PIS_COFINS_RETENCAO_NAO_SUPORTADA";
            err.correcao =
              "Enquanto `vRetCSLL` não for construído, emita esta nota pelo Emissor Web. ⚠ NÃO " +
              "contorne mandando tpRetPisCofins=0 ou 2: isso declararia ao fisco e ao tomador que " +
              "NÃO houve retenção. O leiaute não tem campo de base de retenção; o valor retido " +
              "vai em vPis/vCofins e em tribFed/vRetCSLL (RN E0720 e E0724, campo vRetCSLL).";
            throw err;
          }

          // ── Os SETE, na ordem do XSD ────────────────────────────────────────────────────────
          // ⚠ A ordem não é alfabética nem a de digitação: `xs:sequence` a torna parte do
          // contrato, e foi um filho fora de lugar/inexistente que gerou o E1235. Só entra o que
          // foi INFORMADO — os seis opcionais ausentes não viram `0.00`.
          const linhas = [`<CST>${escapeXml(String(piscofins.CST).trim())}</CST>`];
          const monetario = (campo) => {
            if (!infPC(piscofins[campo])) return;
            const n = Number(piscofins[campo]);
            if (!Number.isFinite(n) || n < 0) {
              const err = new Error(`PIS/COFINS: '${campo}' não é um valor válido: ${piscofins[campo]}.`);
              err.code = "NFSE_PIS_COFINS_VALOR_INVALIDO";
              err.correcao = `Informe '${campo}' como número maior ou igual a zero.`;
              throw err;
            }
            // ── Pré-checagem local da RN E0677 ────────────────────────────────────────────────
            //
            // ⚠ É PRÉ-CHECAGEM NOSSA DE UMA REGRA DELES: quem recusa de verdade é o sistema
            // nacional; isto só evita o round-trip. Não é regra de esquema (o XSD aceita
            // `vBCPisCofins` maior que `vServ`).
            //
            // **RN E0677**, conferida na CÉLULA — Anexo I, aba "RN DPS_NFS-e", linha em que
            // CAMPO(coluna 2) = `vBCPisCofins` e CÓD. ERRO(coluna 7) = `E0677`; REGRA(coluna 3),
            // literal: *"O valor da BC para Pis/Cofins deve ser menor ou igual ao valor do serviço
            // informado na DPS."* É `<=`, e o campo é o que EXISTE.
            //
            // ⚠⚠ NÃO CONFUNDIR com as RN vizinhas — as quatro seguem a este campo na planilha e
            // são de OUTROS campos, o que torna fácil deslocar uma linha e citar a errada:
            //     E0686 `pAliqPis`    — alíquota do PIS entre 0 e 100%
            //     E0692 `pAliqCofins` — alíquota da COFINS entre 0 e 100%
            //     E0694 `vPis`        — vPis = vBCPisCofins × pAliqPis
            //     E0696 `vCofins`     — vCofins = vBCPisCofins × pAliqCofins
            //
            // ⚠⚠ E A REGRA ANTIGA CITAVA UM ERRO QUE NÃO EXISTE. A validação removida
            // (`INVALID_PIS_COFINS_RET_BASE`) exigia `>0 e < valorServicos` sobre
            // `vBcRetPisCofins` — campo inexistente —, e o comentário dela invocava **`E0680`**,
            // que **não aparece na coluna CÓD. ERRO de aba nenhuma do Anexo I** (varrido). A
            // faixa `>0 e <` é a do `vRetCP`/`vRetIRRF` (E0699/E0700), transplantada para uma
            // base. Ou seja: campo inventado E número de regra inventado, no mesmo bloco.
            if (campo === "vBCPisCofins" && n > valorServicosNumber) {
              const err = new Error(
                `A base de cálculo do PIS/COFINS (${n}) é maior que o valor do serviço ` +
                  `(${valorServicosNumber}). RN E0677 exige menor ou igual.`
              );
              err.code = "INVALID_PIS_COFINS_BC";
              err.correcao =
                "Informe vBCPisCofins menor ou igual ao valor do serviço da nota (RN E0677).";
              throw err;
            }
            linhas.push(`<${campo}>${n.toFixed(2)}</${campo}>`);
          };
          // ⚠ AS RN **E0694** e **E0696** NÃO SÃO CONFERIDAS AQUI, e a escolha é deliberada.
          // Elas são reais (aba "RN DPS_NFS-e", campos `vPis` e `vCofins`) e dizem que
          // `vPis` = `vBCPisCofins` × `pAliqPis` e `vCofins` = `vBCPisCofins` × `pAliqCofins`.
          // O critério para guardar uma regra localmente, aqui, é ela ser **exata**:
          //
          //   · E0677 é uma comparação (`<=`) — não há convenção a escolher, então entra;
          //   · E0694/E0696 são uma MULTIPLICAÇÃO, e o leiaute **não declara a regra de
          //     arredondamento** (nem casas, nem sentido do desempate). Escrever uma seria
          //     inventar convenção fiscal, e a versão errada RECUSA nota legítima por um centavo.
          //
          // Some-se a isso que este grupo hoje **nunca é emitido** (não há produtor de
          // `data.tribFed`): construir validação para caminho morto acrescenta superfície de erro
          // sem evitar erro nenhum. Quem responde por elas é o sistema nacional, que tem a
          // convenção. ⚠ Se o grupo passar a ser emitido de verdade, esta decisão merece ser
          // revista **com a convenção em mãos** — não por analogia.
          monetario("vBCPisCofins");
          monetario("pAliqPis");
          monetario("pAliqCofins");
          monetario("vPis");
          monetario("vCofins");
          if (tpRet !== null) linhas.push(`<tpRetPisCofins>${tpRet}</tpRetPisCofins>`);

          return `<tribFed>
          <piscofins>
            ${linhas.join("\n            ")}
          </piscofins>
        </tribFed>`;
        })()}
        ${
          isSimples
            ? `<totTrib>
          <pTotTribSN>${pTotTribSN.toFixed(2)}</pTotTribSN>
        </totTrib>`
            : // ⚠ Não optante: PERCENTUAIS resolvidos acima (payload → cadastro da empresa), não
              // zeros cravados. A forma (`pTotTrib` com os três filhos, nesta ordem) é a da NFS-e
              // real versionada em `docs/leiaute-nfse/nfse-nacional-substituicao.xml`. O código
              // original emitia `vTotTrib` com `0.00` — outro grupo, e afirmando carga zero.
              //
              // ⚠⚠ O `?? 0` SAIU DAQUI, e ele era o defeito. Com o gate antigo (`.some()`), UM
              // percentual liberava a emissão e estes `?? 0` escreviam `0.00` nos outros dois —
              // uma AFIRMAÇÃO de carga zero ao tomador (Lei 12.741/2012) montada por omissão.
              // Hoje os três chegam aqui resolvidos ou a emissão já foi recusada por
              // `MISSING_TOT_TRIB_NAO_SIMPLES`, então não há default a aplicar. Não reintroduza
              // o `??`: ele voltaria a fabricar o zero sem que nenhum teste do XML acusasse.
              `<totTrib>
          <pTotTrib>
            <pTotTribFed>${totTribNaoSimples.pTotTribFed.toFixed(2)}</pTotTribFed>
            <pTotTribEst>${totTribNaoSimples.pTotTribEst.toFixed(2)}</pTotTribEst>
            <pTotTribMun>${totTribNaoSimples.pTotTribMun.toFixed(2)}</pTotTribMun>
          </pTotTrib>
        </totTrib>`
        }
      </trib>
    </valores>
    ${blocoIbsCbs}
  </infDPS>
</DPS>`;

  return { xml, infId, localPrestacaoAssumido, cLocEmi, cLocPrestacao, opSimpNac, tpRetISSQN };
}

function buildDpsPayload({ company, data, numeracao, regime, certificadoAssinatura, perfil = null }) {
  const construido = buildDpsXml({ company, data, numeracao, regime, perfil });
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

/**
 * O perfil de emissão que manda nesta nota — ou `null`.
 *
 * ⚠⚠ `null` É O CAMINHO DE HOJE, E É O DEFAULT. Com `INTEGRACAO_PERFIL_EMISSAO_NFSE` desligada esta
 * função devolve `null` sem tocar no banco, e `buildDpsXml` monta o XML exatamente como sempre
 * montou. A prova disso é um teste de INÉRCIA: perfil derivado do cadastro + flag ligada tem de
 * produzir XML **byte-idêntico** ao da flag desligada.
 *
 * ⚠ Ela NUNCA lança. Tabela ainda não criada (a migration nasce não aplicada), banco indisponível,
 * empresa sem `PortalClient` — em todos, o desfecho é `null`, que é o comportamento de hoje. Uma
 * configuração que não pôde ser lida não pode transformar uma emissão legítima em erro.
 *
 * ⚠⚠ COM 2+ PERFIS ATIVOS E NENHUM ESCOLHIDO, O RESOLVEDOR JÁ DEVOLVE `temPerfil: false` e nada do
 * perfil entra — cair no `padrao` faria o padrão virar a resposta de quem não respondeu. Quem
 * RECUSA a emissão nesse caso é a rota do cliente, com código próprio; aqui o efeito é cair no
 * cadastro, que é o comportamento anterior e nunca é pior que ele.
 */
async function carregarPerfilDeEmissao(company, perfilId) {
  if (!INTEGRACAO_PERFIL_EMISSAO_NFSE) return null;
  try {
    const portal = await prisma.portalClient.findUnique({
      where: { companyId: company.id },
      select: { id: true },
    });
    if (!portal?.id) return null;
    const r = await resolverPerfilDeEmissao({ portalClientId: portal.id, perfilId: perfilId || null });
    return r.temPerfil ? r.perfil : null;
  } catch {
    return null;
  }
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
    // ⚠ A EMPRESA PELO CHAMADOR, quando ele já a resolveu e já a autorizou.
    //
    // Sem isto, a empresa sai de `findByChaveAcesso`, que procura em `ServiceInvoice` — a nossa
    // tabela de EMISSÕES. Uma nota capturada do ADN (emitida no Emissor Web, em outro ERP, pela
    // prefeitura) não tem linha lá, e o cancelamento dela morria em `NFSE_NOT_FOUND` mesmo sendo
    // uma nota legítima da empresa. E a lista que o cliente vê é justamente a projeção do ADN.
    //
    // ⚠ Passar isto NÃO é autorizar nada: quem autoriza é a porta, ANTES. É o mesmo desenho de
    // `resolveLegacyCompanyId` na emissão — resolver e autorizar acontecem fora do serviço, e o id
    // já conferido desce por parâmetro. Ausente, o comportamento é exatamente o de antes.
    companyId = null,
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

    // ⚠⚠ AS DUAS TRAVAS DE LEIAUTE, E ELAS RODAM **ANTES DE ASSINAR** — este é o ponto delas.
    //
    // O que vem depois daqui é montar o XML, ASSINAR com o certificado A1 da empresa e transmitir
    // ao sistema nacional. Uma justificativa de quatro letras, ou um `cMotivo` de outra lista,
    // atravessava tudo isso e voltava como erro de SCHEMA — que não diz "faltam 11 caracteres" nem
    // "esse código é da substituição". Um round-trip ao sistema nacional para descobrir uma regra
    // que está no XSD guardado no nosso disco.
    //
    // ⚠ E ELAS VALEM PARA O CANCELAMENTO TAMBÉM, que é a novidade: até 19/08/2026 só o `e105102`
    // exigia `cMotivo`, e o `e101101` arbitrava `"1"` lá embaixo, em `buildEventoXml`.
    //
    // Listas, larguras e fonte (XSD oficial versionado): `application/nfse/motivosDeEvento.js`.
    if (!motivoValido(tipoEvento, cMotivo)) {
      const lista = (motivosDoEvento(tipoEvento) || []).map((m) => `${m.codigo} (${m.rotulo})`);
      const err = new Error(
        lista.length
          ? `O motivo do evento é de lista fechada. Valores aceitos: ${lista.join(", ")}.`
          : "Tipo de evento sem lista de motivos conhecida."
      );
      // Ausência e valor fora da lista são o MESMO desfecho para quem chama — em ambos não há
      // motivo fiscal declarável —, mas o código distingue para o log e para a tela.
      err.code = String(cMotivo ?? "").trim() ? "NFSE_CMOTIVO_INVALIDO" : "NFSE_CMOTIVO_REQUIRED";
      err.motivosAceitos = motivosDoEvento(tipoEvento) || [];
      throw err;
    }

    const conferencia = validarJustificativa(justificativa);
    if (!conferencia.ok) {
      const err = new Error(conferencia.mensagem);
      err.code = conferencia.codigo;
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
    // ⚠⚠ NÃO SERÁ CONSTRUÍDO — DECISÃO DO DONO, 19/08/2026: *"esqueça substituir então, deixe
    // apenas o cancelar."* Isto NÃO é mais "Fase 4 pendente": é escopo fechado. Quem for
    // "completar" este caminho está reabrindo uma decisão, não terminando um trabalho.
    //
    // A decisão foi tomada COM a fonte oficial na mão, e é aí que ela fica interessante — o
    // impedimento técnico tinha acabado de cair. O `ANEXO_I`/XSD versionados em
    // `docs/leiaute-nfse/documentacao-tecnica/` dão a estrutura inteira do grupo (`subst` 0-1 entre
    // `cLocEmi` e `prest`; `chSubstda` 1-1 de 50 dígitos; `cMotivo` 1-1 com a lista oficial
    // `TSCodJustSubst` = 01,02,03,04,05,99; `xMotivo` 0-1). Dava para construir.
    //
    // O que decidiu foi a REGRA DE NEGÓCIO, não a estrutura: **E0060/E0061** proíbem a substituta
    // de alterar competência/serviço/local (não optante) e tomador/competência/valor (Simples) —
    // ou seja, exatamente o que o dono queria poder corrigir (*"podendo alterar data ou qualquer
    // outro tipo de dado"*). Para o uso dele, substituição não serve: o caminho é **cancelar e
    // emitir uma nota nova**, dois atos deliberados, que é o que o portal do cliente oferece.
    //
    // ⚠ E o caminho abaixo continua INVERTIDO — este parágrafo não o conserta nem o autoriza.
    // `buildDpsXml` não monta `<subst>` e não vai montar. Se um dia a decisão mudar, o que se
    // constrói é o `POST /nfse` com o grupo, NUNCA o envio manual do e105102.
    //
    // ── Os dois campos abaixo são OBRIGATÓRIOS (1-1) no e105102 pelo ANEXO_II v1.01 — ver o
    // comentário de `buildEventoXml`. Recusar aqui é o que substituiu o fallback inventado
    // `<nNFSeSubst>`: sem a chave da substituta não existe evento de substituição, e o código do
    // motivo é justificativa fiscal de lista fechada (01…05, 99) que ninguém pode arbitrar.
    // ⚠ A CHECAGEM DE `cMotivo` QUE MORAVA AQUI SUBIU, e agora vale para os DOIS eventos
    // (`motivoValido`, lá em cima). Ela era condicional ao `e105102`, e era essa condição que
    // deixava o cancelamento sem lista fechada. O que sobra aqui é o que é MESMO só da
    // substituição: a chave da substituta.
    if (String(tipoEvento).toLowerCase() === "e105102") {
      if (normalizeDigits(chaveSubstituta).length !== 50) {
        const err = new Error("chave_substituta_required");
        err.code = "NFSE_CHAVE_SUBSTITUTA_REQUIRED";
        throw err;
      }
    }

    // ⚠ A EMPRESA É RESOLVIDA ANTES DO CLIENTE HTTP, porque é dela que sai o certificado — tanto o
    // que ASSINA o evento (E0718 vale para o autor do pedido de registro) quanto o do mTLS. Antes,
    // `buildAxiosClient()` e `signEventoXml()` usavam o PFX GLOBAL, e o CNPJ do autor era só um
    // campo de texto no XML: nada impedia declarar um CNPJ e assinar com o certificado de outro.
    // ⚠ O `companyId` DO CHAMADOR VENCE — ver a nota na assinatura. `findByChaveAcesso` só é
    // consultada quando ele não veio, e nesse caso o comportamento é o de sempre.
    let empresaDoEvento = String(companyId || "").trim() || null;
    if (!empresaDoEvento) {
      const invoice = await NfseRepository.findByChaveAcesso(chaveAcesso);
      if (!invoice?.companyId) {
        const err = new Error("nfse_not_found");
        err.code = "NFSE_NOT_FOUND";
        throw err;
      }
      empresaDoEvento = invoice.companyId;
    }
    const companyDoEvento = await prisma.company.findUnique({ where: { id: empresaDoEvento } });
    if (!companyDoEvento) {
      const err = new Error("company_not_found");
      err.code = "COMPANY_NOT_FOUND";
      throw err;
    }
    const autor = cnpjAutor || companyDoEvento?.cnpj || null;
    if (!autor) {
      const err = new Error("cnpj_autor_required");
      err.code = "NFSE_CNPJ_AUTOR_REQUIRED";
      throw err;
    }

    const certificados = await resolverCertificadosDaEmpresa(empresaDoEvento);
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
      // ⚠⚠ AS TRÊS CAMADAS, PELA MESMA FUNÇÃO DA EMISSÃO — `classificarFalha`. Até 19/08/2026
      // toda falha daqui saía como um `NFSE_EVENT_FAILED` plano, e a rota a traduzia em 422: um
      // timeout de rede e uma recusa fiscal do sistema nacional chegavam à tela com o MESMO rosto.
      // É o defeito que a emissão já pagou e consertou — e ele importa mais no cancelamento, porque
      // aqui o desfecho desconhecido não é "o número ficou retido", é "a nota pode estar cancelada".
      //
      // ⚠ NÃO É UM SEGUNDO MAPA: a leitura de 4xx × 5xx × rede é a mesma, importada.
      const desfecho = classificarFalha(err);
      const error = new Error(desfecho.mensagem || reason);
      error.code = "NFSE_EVENT_FAILED";
      error.camada = desfecho.camada;
      error.codigo = desfecho.codigo;
      // ⚠ A `correcao` da emissão fala de NUMERAÇÃO ("não reemita com número novo") e não serve
      // aqui: cancelar não consome número. O texto do cancelamento mora em `nfseCancelamentoHttp.js`,
      // junto do mapa HTTP, e é ele que diz para NÃO reenviar.
      error.correcao =
        desfecho.camada === CAMADA.TRANSPORTE ? CORRECAO_TRANSPORTE_EVENTO : desfecho.correcao;
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

    // ⚠⚠ O PERFIL DE EMISSÃO — `null` com a flag desligada, que é o caminho de hoje. Carregado
    // ANTES da trava do código de serviço porque é ele quem pode fornecer o `cTribNac`, e essa
    // trava é a autoridade que confere o valor CONTRA O CADASTRO, venha ele de onde vier.
    const perfilDeEmissao = await carregarPerfilDeEmissao(company, data.perfilId);

    // ── 1.b PRÉ-VOO DO CADASTRO ───────────────────────────────────────────────────────────
    //
    // ⚠ TUDO O QUE DÁ PARA SABER SEM O CONTADOR É CONFERIDO ANTES DE ENCOSTAR NELE. Município
    // emissor, série e regime são defeitos de CADASTRO: eles não dependem do número, e descobri-los
    // depois da reserva significaria mover o contador por causa de um campo em branco. A reserva é
    // transacional, então o número voltaria — mas o desfecho sairia como exceção não classificada
    // (a rota responderia 500), em vez da recusa nomeada com correção que o contador precisa ler.
    // ⚠ A TRAVA DO CÓDIGO DE SERVIÇO — o cadastro é a autoridade, nunca o payload.
    //
    // Ela mora AQUI, no pré-voo, e não em `buildDpsXml`, por dois motivos: (1) a recusa acontece
    // ANTES de reservar numeração — e como não existe inutilização na NFS-e, número gasto à toa é
    // buraco permanente; (2) `buildDpsXml` **não é alcançado**, então não há caminho em que um
    // código não cadastrado chegue a virar `<cTribNac>`. Há teste sobre as duas coisas.
    let codigoServicoDaNota = null;
    try {
      resolverCLocEmi(company);
      normalizarSerie(company.rpsSerie);
      const escolha = escolherCodigoServicoNacional({
        // ⚠ O perfil vence o payload, e mesmo assim PASSA PELA TRAVA: o cadastro continua sendo a
        // autoridade. Um perfil com código fora da lista habilitada é recusado aqui, ANTES de
        // reservar numeração — não existe inutilização na NFS-e.
        escolhido: perfilDeEmissao?.codigoServicoNacional || data.servico?.codigoServicoNacional,
        lista: company.codigosServicoNacional,
        singular: company.codigoServicoNacional,
      });
      if (!escolha.ok) {
        const err = new Error(escolha.message);
        err.code = escolha.codigo;
        err.correcao = escolha.correcao;
        throw err;
      }
      codigoServicoDaNota = escolha.codigo;
      const regTrib = resolverOpSimpNac(regime);
      if (regTrib.resolucao !== RESOLUCAO.RESOLVIDO) {
        const err = new Error(regTrib.motivo);
        err.code = "NFSE_REGIME_INDEFINIDO";
        err.correcao =
          "Cadastre/confirme o regime tributário da empresa na aba Fiscal → Cadastro. O regime é " +
          "declarado na própria DPS (opSimpNac) — emitir com o regime errado é declaração falsa.";
        throw err;
      }

      // ── NBS E IBS/CBS — A RECUSA ACONTECE AQUI, ANTES DA NUMERAÇÃO ──────────────────────
      //
      // ⚠⚠ É o mesmo motivo de a trava do código de serviço morar no pré-voo: **não existe
      // inutilização na NFS-e**. Um número reservado para uma nota que a Receita vai recusar é
      // buraco permanente na série. Recusar aqui custa zero.
      //
      // ⚠ As MESMAS funções puras são chamadas de novo dentro de `buildDpsXml`, com as mesmas
      // entradas — e é por isso que o resultado não pode divergir. Não passe a decisão por
      // parâmetro: seriam duas fontes para a mesma resposta.
      const nbsPreVoo = nbsDaDps(perfilDeEmissao);
      if (!nbsPreVoo.ok) {
        const err = new Error(nbsPreVoo.message);
        err.code = nbsPreVoo.codigo;
        err.correcao = nbsPreVoo.correcao;
        throw err;
      }
      // ⚠⚠ E0322: declarar IBS/CBS OBRIGA o `cNBS`. É a regra que está no nosso disco, e recusá-la
      // aqui evita um round-trip ao sistema nacional para descobrir algo que já sabíamos.
      const ibsCbsPreVoo = ibscbsDaDps({
        cTribNac: codigoServicoDaNota,
        perfil: perfilDeEmissao,
        ligado: INTEGRACAO_NFSE_IBSCBS,
        cNBS: nbsPreVoo.cNBS,
      });
      if (!ibsCbsPreVoo.ok) {
        const err = new Error(ibsCbsPreVoo.message);
        err.code = ibsCbsPreVoo.codigo;
        err.correcao = ibsCbsPreVoo.correcao;
        throw err;
      }

      // ⚠⚠ A ALÍQUOTA DO ISSQN, pelo mesmo motivo: recusar aqui custa zero; recusar depois queima
      // um número da série, e não existe inutilização na NFS-e.
      //
      // ⚠ As entradas são derivadas pelas MESMAS funções que o gerador usa (`resolverOpSimpNac`,
      // `resolverTpRetIssqn`), com os mesmos dados — por isso as duas decisões não divergem.
      const retencaoPreVoo = resolverTpRetIssqn(data.servico?.issRetido === true);
      const pAliqPreVoo = pAliqDaDps({
        opSimpNac: regTrib.opSimpNac,
        regApTribSN:
          regTrib.opSimpNac === "3" ? (perfilDeEmissao?.regApTribSN || "1") : null,
        tpRetISSQN: retencaoPreVoo.tpRetISSQN,
        aliquota: perfilDeEmissao?.pAliq ?? data.servico?.aliquota,
      });
      if (!pAliqPreVoo.ok) {
        const err = new Error(pAliqPreVoo.message);
        err.code = pAliqPreVoo.codigo;
        err.correcao = pAliqPreVoo.correcao;
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
        // O código já conferido contra o cadastro desce junto do resto do serviço. `null` = não
        // houve escolha (ou o singular não tem a forma), e `buildDpsXml` cai no cadastro como
        // sempre caiu.
        data: {
          ...data,
          servico: { ...(data.servico || {}), codigoServicoNacional: codigoServicoDaNota },
        },
        numeracao,
        regime,
        certificadoAssinatura: certificados.assinatura,
        // ⚠ `null` com a flag desligada — o caminho de hoje, byte a byte.
        perfil: perfilDeEmissao,
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

      // ── A MEMÓRIA DO TOMADOR ────────────────────────────────────────────────────────────
      //
      // > Dono, 19/08/2026: *"ao emitir a nota para um tomador vamos salvar as informações; na hora
      // > de emitir o cliente pode escolher o tomador ao qual ele já emitiu."*
      //
      // ⚠ AQUI, E NÃO ANTES: depois do POST ter voltado e de `markIssued` ter gravado. Gravar antes
      // registraria como "já emitimos para este tomador" uma nota que a Receita ainda podia
      // recusar.
      //
      // ⚠ FORA DE TRANSAÇÃO, DE PROPÓSITO. A única transação de `issue` é a reserva de numeração
      // (etapa 2), que já fechou. Abrir uma nova envolvendo `markIssued` faria uma falha ao gravar
      // a memória dar ROLLBACK na linha que diz que a nota foi emitida — e a nota existe no sistema
      // nacional (não há inutilização na NFS-e). O raciocínio inteiro está em `tomadorEmitido.js`.
      //
      // ⚠⚠ O `try/catch` AQUI É CINTO E SUSPENSÓRIO, e não é redundância à toa:
      // `registrarTomadorEmitido` já não lança, mas este ponto está DENTRO do `try` cujo `catch` é
      // o CLASSIFICADOR DE FALHA da emissão. Qualquer exceção que escapasse viraria `falha_envio`
      // numa nota AUTORIZADA — mascarar ato fiscal consumado é o pior desfecho possível deste
      // caminho, e ele não pode depender de um módulo continuar se comportando.
      try {
        await registrarTomadorEmitido({
          prisma,
          companyId: company.id,
          tomador: data.tomador,
          log,
        });
      } catch (errTomador) {
        // ⚠ `log?.warn?.` e não `log.warn`: `log` é PARÂMETRO de `issue` (linha 1333) e pode não
        // vir. Um `TypeError` aqui dentro do `catch` de segurança escaparia para o classificador de
        // falha — exatamente o que estas linhas existem para impedir.
        log?.warn?.(
          { companyId: company.id, err: errTomador?.message },
          "NFS-e: nota emitida; a memória do tomador não foi gravada (a emissão não é afetada)"
        );
      }

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
