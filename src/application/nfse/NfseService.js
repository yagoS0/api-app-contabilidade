import https from "node:https";
import fs from "node:fs";
import axios from "axios";
import crypto from "node:crypto";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";
import { gzipSync } from "node:zlib";
import { prisma } from "../../infrastructure/db/prisma.js";
import { NfseRepository } from "../../infrastructure/db/NfseRepository.js";
import {
  NFSE_CERT_PFX_PATH,
  NFSE_CERT_PFX_PASSWORD,
  NFSE_BASE_URL,
  NFSE_ENV,
  NFSE_PATH,
  NFSE_COD_MUNICIPIO,
  log,
} from "../../config.js";

const REQUIRED_COMPANY_FIELDS = [
  "cnpj",
  "inscricaoMunicipal",
  "codigoServicoNacional",
  "codigoServicoMunicipal",
  "rpsSerie",
];

let cachedCertInfo = null;

function buildMissingFields(company) {
  const missing = [];
  for (const field of REQUIRED_COMPANY_FIELDS) {
    if (!company?.[field]) missing.push(field);
  }
  return missing;
}

function integrationReady() {
  return Boolean(NFSE_CERT_PFX_PATH && NFSE_CERT_PFX_PASSWORD && NFSE_BASE_URL);
}

function loadCertAndKey() {
  if (cachedCertInfo) return cachedCertInfo;
  const pfxBuffer = fs.readFileSync(NFSE_CERT_PFX_PATH);
  const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString("binary"));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, NFSE_CERT_PFX_PASSWORD);

  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })?.[forge.pki.oids.certBag]?.[0];
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })?.[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ]?.[0] ||
    p12.getBags({ bagType: forge.pki.oids.keyBag })?.[forge.pki.oids.keyBag]?.[0];

  if (!certBag?.cert || !keyBag?.key) {
    throw new Error("NFSe: certificado ou chave não encontrados no PFX");
  }

  const certPem = forge.pki.certificateToPem(certBag.cert);
  const keyPem = forge.pki.privateKeyToPem(keyBag.key);
  const certBase64 = certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");

  cachedCertInfo = { certPem, keyPem, certBase64 };
  return cachedCertInfo;
}

function signDpsXml(xml, infId) {
  const { keyPem, certBase64 } = loadCertAndKey();

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

function buildAxiosClient() {
  if (!integrationReady()) {
    throw new Error("NFSe: integração não configurada");
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

  const pfxBuffer = fs.readFileSync(NFSE_CERT_PFX_PATH);
  const agent = new https.Agent({
    pfx: pfxBuffer,
    passphrase: NFSE_CERT_PFX_PASSWORD,
    rejectUnauthorized: NFSE_ENV !== "homolog",
  });

  const client = axios.create({
    baseURL: NFSE_BASE_URL.replace(/\/+$/, ""),
    httpsAgent: agent,
    timeout: 15000,
  });

  return client;
}

function buildRpsPayload({ company, data }) {
  // Payload simplificado para o padrão nacional.
  // Ajustar campos conforme o provedor (REST) escolhido.
  return {
    ambiente: NFSE_ENV === "homolog" ? "homolog" : "producao",
    prestador: {
      cnpj: company.cnpj,
      inscricaoMunicipal: company.inscricaoMunicipal,
    },
    rps: {
      numero: company.rpsNumero || null,
      serie: company.rpsSerie || "UNICA",
      tipo: "RPS",
      dataEmissao: new Date().toISOString(),
    },
    servico: {
      codigoServicoNacional: company.codigoServicoNacional,
      codigoServicoMunicipal: company.codigoServicoMunicipal,
      discriminacao: data.servico.descricao,
      valorServicos: data.servico.valorServicos,
      aliquota: data.servico.aliquota,
      issRetido: data.servico.issRetido ?? false,
    },
    tomador: {
      documento: data.tomador.doc,
      razaoSocial: data.tomador.nome,
      email: data.tomador.email || undefined,
    },
    referencia: data.referencia || undefined,
  };
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

function buildDpsXml({ company, data }) {
  const competencia = formatDateOnly(data.competencia);
  const valorServicosNumber = Number(data.servico.valorServicos || 0);
  const valorServicos = valorServicosNumber.toFixed(2);
  // Alíquota: respeita o valor enviado no payload. Para opSimpNac=3 e tpRetISSQN=2/3, o provedor exige alíquota > 0 (mín 1,8%). Se ausente/<=0, dispara erro para evitar default silencioso.
  const rawAliq = data.servico.aliquota;
  const aliquota =
    rawAliq !== undefined && rawAliq !== null && rawAliq !== ""
      ? Number(rawAliq)
      : null;
  // ISS Retido (tomador): respeita o payload (booleano). 1 = retido, 2 = não retido.
  const issRetido = data.servico.issRetido === true ? "2" : "1";
  const codigoServico =
    company.codigoServicoMunicipal || company.codigoServicoNacional || "";

  // id de infDPS: DPS + cLocEmi(7) + tpInsc(1) + inscFed(14) + serie(5) + nDPS(15)
  const cLocEmi = (
    (company.codigoMunicipioIbge || "").replace(/\D+/g, "") ||
    (company.codigoMunicipio || "").replace(/\D+/g, "") ||
    (NFSE_COD_MUNICIPIO || "").replace(/\D+/g, "")
  )
    .padStart(7, "0")
    .slice(-7);
  const cnpj = (company.cnpj || "").replace(/\D+/g, "");
  const cpfCompany = (company.cpf || "").replace(/\D+/g, "");
  const isCnpj = cnpj.length === 14;
  const tpInsc = isCnpj ? "2" : "1"; // 2=CNPJ, 1=CPF
  const inscFed = (cnpj || cpfCompany).padStart(14, "0").slice(-14);
  const rawSerie = (company.rpsSerie || "1").toString();
  const serieDigitsOnly = rawSerie.replace(/\D+/g, "");
  const letterMatch = rawSerie.match(/[A-Za-z]/);
  const letterAsNumber = letterMatch
    ? String(letterMatch[0].toUpperCase().charCodeAt(0) - 64) // A=1, B=2...
    : "";
  const serieNumeric = serieDigitsOnly || letterAsNumber || "1";
  const serieVal = serieNumeric.padStart(5, "0").slice(-5); // para Id e XML
  // nDPS para XML (sem padding) e para Id (15 dígitos)
  const nDpsDigits = (company.rpsNumero || "1").toString().replace(/\D+/g, "");
  const nDpsRaw = nDpsDigits || "1"; // XML sem padding
  const nDpsVal = nDpsRaw.padStart(15, "0").slice(-15); // Id com padding 15
  // Id: DPS + cLocEmi(7) + tpInsc(1) + inscFed(14) + serie(5) + nDPS(15)
  const infId = `DPS${cLocEmi}${tpInsc}${inscFed}${serieVal}${nDpsVal}`;

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
  const cLocPrestacao = cLocEmi; // por enquanto assume igual ao município do prestador
  // TSOpSimpNac: 1=Não optante, 2=MEI, 3=Simples (ME/EPP). Empresa é Simples: use 3.
  const opSimpNac = "3";
  const regApTribSN = "1"; // padrão para Simples ME/EPP
  const shouldSendIM = company.inscricaoMunicipal && cLocEmi !== "3304557"; // RJ exige não enviar IM se não há CNC

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

  const issRetidoFlag = data.servico?.issRetido === true;
  const effectiveIssRetido = issRetidoFlag;

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
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
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
        <regApTribSN>${regApTribSN}</regApTribSN>
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
          <tpRetISSQN>${issRetido}</tpRetISSQN>
      ${(() => {
        // Envia pAliq somente quando tpRetISSQN=2 (retido pelo tomador).
        if (issRetido === "2") {
          if (aliquota === null || Number.isNaN(aliquota) || aliquota <= 0) {
            const err = new Error(
              "missing_aliquota: informe servico.aliquota (>0) quando ISS for retido"
            );
            err.code = "MISSING_ALIQUOTA";
            throw err;
          }
          const aliqValue = aliquota;
          return `<pAliq>${escapeXml(aliqValue.toFixed(2))}</pAliq>`;
        }
        return "";
      })()}
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
          const isSimples = opSimpNac === "3";
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
        <totTrib>
          <vTotTrib>
            <vTotTribFed>0.00</vTotTribFed>
            <vTotTribEst>0.00</vTotTribEst>
            <vTotTribMun>0.00</vTotTribMun>
          </vTotTrib>
        </totTrib>
      </trib>
    </valores>
  </infDPS>
</DPS>`;

  return { xml, infId };
}

function buildDpsPayload({ company, data }) {
  const { xml, infId } = buildDpsXml({ company, data });
  const signedXml = signDpsXml(xml, infId);
  const compressed = gzipSync(Buffer.from(signedXml, "utf-8")).toString("base64");
  return { dpsXmlGZipB64: compressed, rawXml: signedXml };
}

export class NfseService {
  /**
   * Prepara e registra o pedido de emissão de NFS-e.
   * Neste momento deixamos o status como "pending" até plugar o cliente oficial da prefeitura/Portal Nacional.
   */
  static async issue({ data, log }) {
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

    const record = await NfseRepository.createPending({
      companyId: data.companyId,
      clientId: data.clientId || null,
      tomadorDoc: data.tomador.doc,
      tomadorNome: data.tomador.nome,
      valorServicos: data.servico.valorServicos,
      aliquota: data.servico.aliquota,
      issRetido: data.servico.issRetido ?? false,
      competencia: data.competencia,
      rpsSerie: company.rpsSerie || null,
      rpsNumero: company.rpsNumero || null,
      status: "pending",
    });

    if (!integrationReady()) {
      return {
        status: "pending",
        message:
          "Pedido registrado, mas certificado/endpoint NFSe não configurado. Configure NFSE_CERT_PFX_PATH, NFSE_CERT_PFX_PASSWORD e NFSE_BASE_URL/NFSE_PATH.",
        nfse: record,
      };
    }

    let rawXml = null;
    let requestUrl = null;
    try {
      const client = buildAxiosClient();
      // Gera DPS (XML) e envia no padrão nacional (dpsXmlGZipB64).
      const { dpsXmlGZipB64, rawXml: builtXml } = buildDpsPayload({
        company,
        data,
      });
      rawXml = builtXml;
      requestUrl = `${client.defaults.baseURL}${NFSE_PATH}`;
      const { data: response } = await client.post(NFSE_PATH, {
        dpsXmlGZipB64,
      });

      const issued = await NfseRepository.markIssued(record.id, {
        status: response.status || "issued",
        numeroNfse: response.chaveAcesso || response.numeroNfse || null,
        codigoVerificacao: response.codigoVerificacao || response.codigo || null,
        xml: response.nfseXmlGZipB64 || rawXml || null,
        pdfUrl: response.pdfUrl || null,
        rpsNumero: company.rpsNumero || null,
      });

      // Incrementa rpsNumero simples se existir no cadastro
      if (company.rpsNumero) {
        const next = String(Number(company.rpsNumero) + 1);
        await prisma.company.update({
          where: { id: company.id },
          data: { rpsNumero: next },
        });
      }

      return {
        status: issued.status || "issued",
        message: "NFS-e emitida com sucesso (padrão nacional).",
        nfse: issued,
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
        "Falha ao emitir NFS-e";

      log.error(
        {
          err: reason,
          status: axiosErr?.status,
          data: providerData,
          baseUrl: NFSE_BASE_URL,
          url: requestUrl,
        },
        "Falha ao enviar NFS-e ao provedor nacional"
      );

      const rejected = await NfseRepository.markIssued(record.id, {
        status: "rejected",
        codigoVerificacao: null,
        numeroNfse: null,
        xml: rawXml || null,
        pdfUrl: null,
      });

      return {
        status: "rejected",
        message: reason,
        providerData,
        url: requestUrl,
        nfse: rejected,
      };
    }
  }
}
