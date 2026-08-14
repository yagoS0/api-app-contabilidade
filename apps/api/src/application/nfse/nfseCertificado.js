// O CERTIFICADO DA EMISSÃO É O DA EMPRESA — E SÃO DOIS CERTIFICADOS, NÃO UM.
//
// ─── O QUE HAVIA ────────────────────────────────────────────────────────────────────────────
//
// `NfseService.loadCertAndKey()` lia um PFX GLOBAL de `NFSE_CERT_PFX_PATH` e o usava para ASSINAR
// e para o mTLS, nos três caminhos (emissão, consulta, evento), **sem conferir de quem ele é**.
// Numa carteira multi-empresa isso quer dizer: um único arquivo — na prática o A1 do escritório —
// assinando DPS de 33 CNPJs diferentes.
//
// ─── POR QUE ISSO NÃO PODE FICAR ────────────────────────────────────────────────────────────
//
//   • **E0718** (Anexo I, RN DPS_NFS-e): *"A assinatura deve ser feita com o certificado digital
//     do emitente da DPS."*
//   • **Res. CGNFS-e nº 3, art. 2º, §1º, I**: o certificado tem de pertencer ao CNPJ do
//     contribuinte.
//   • E a regra do dono, que já vale para a CAPTURA e está no `apps/api/CLAUDE.md`: *"O A1 do
//     escritório nunca deve consultar notas, e um A1 de outro CNPJ nunca deve ser usado em outra
//     empresa."* Emitir é mais grave que consultar — consultar traz nota alheia para dentro;
//     assinar cria documento fiscal em nome alheio.
//
// ─── ⚠ DOIS CERTIFICADOS, DOIS CAMPOS — E ESTA SEPARAÇÃO É O PONTO ──────────────────────────
//
// | papel | quem valida | regra |
// |---|---|---|
// | **assinatura** do XML da DPS | o sistema nacional, ao processar o documento | **E0718** — tem de ser do EMITENTE |
// | **transporte** (mTLS da conexão) | o bloco **E1200–E1209** | não há, nas RNs, exigência de que seja o MESMO |
//
// Hoje os dois apontam para o mesmo arquivo (o A1 da empresa), e é isso que se quer. Mas eles são
// **campos separados** no desenho de propósito: colapsá-los num só é o que impediria, depois, a
// figura da PROCURAÇÃO — o caso em que o escritório transporta e a empresa assina. Colapsar agora
// custaria uma refatoração no meio de um fluxo fiscal; mantê-los separados custa duas chaves num
// objeto.
//
// ⚠ NÃO EXISTE SEGUNDA RESOLUÇÃO DE CERTIFICADO AQUI. Quem resolve o A1 por empresa continua
// sendo `CertResolver.resolveCertForCompany`, que já confere o CNPJ do subject via
// `security/inspectPfx.js`. Escrever uma segunda resolução foi como a captura divergiu no
// passado (ver "REGRA DO DONO: notas só com o A1 da PRÓPRIA empresa" no `apps/api/CLAUDE.md`);
// este módulo só TRADUZ o resultado dela para os dois papéis e extrai o PEM para o xml-crypto.

import forge from "node-forge";
import { prisma } from "../../infrastructure/db/prisma.js";
import { resolveCertForCompany, SERVICOS } from "../notas/CertResolver.js";

export class NfseCertError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * A emissão fala em **Company legada** (`NfseService.issue` faz `company.findUnique`), e o
 * `CertResolver` fala em **PortalClient**. A ponte é `PortalClient.companyId`, que é `@unique` —
 * 1:1, sem ambiguidade. É a mesma travessia que `resolveLegacyCompanyId` faz na direção oposta.
 */
async function findPortalClientIdByLegacyCompanyId(companyId) {
  const portal = await prisma.portalClient.findUnique({
    where: { companyId: String(companyId) },
    select: { id: true },
  });
  return portal?.id || null;
}

/** Extrai cert/chave em PEM do PFX. Mesma leitura que o `loadCertAndKey` global fazia — só que
 *  sobre o buffer da EMPRESA, e sem cache de módulo (o cache global era o que fazia um único
 *  certificado servir a carteira inteira: o primeiro que carregasse ficava para todos). */
export function extrairPemDoPfx(pfxBuffer, password) {
  const p12Asn1 = forge.asn1.fromDer(Buffer.from(pfxBuffer).toString("binary"));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password || "");

  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })?.[forge.pki.oids.certBag]?.[0];
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })?.[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ]?.[0] || p12.getBags({ bagType: forge.pki.oids.keyBag })?.[forge.pki.oids.keyBag]?.[0];

  if (!certBag?.cert || !keyBag?.key) {
    throw new NfseCertError(
      "NFSE_CERT_PFX_ILEGIVEL",
      "O certificado A1 desta empresa não pôde ser lido (certificado ou chave privada ausentes no PFX)."
    );
  }

  const certPem = forge.pki.certificateToPem(certBag.cert);
  const keyPem = forge.pki.privateKeyToPem(keyBag.key);
  const certBase64 = certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  return { certPem, keyPem, certBase64 };
}

/**
 * Resolve os DOIS certificados da emissão para uma Company legada.
 *
 * @returns {Promise<{assinatura: {pfxBuffer: Buffer, password: string|null, certPem: string, keyPem: string, certBase64: string}, transporte: {pfxBuffer: Buffer, password: string|null}, origem: string}>}
 * @throws {NfseCertError} `NO_COMPANY_CERT` quando não há A1 da própria empresa.
 */
export async function resolverCertificadosDaEmpresa(companyId) {
  const portalClientId = await findPortalClientIdByLegacyCompanyId(companyId);
  if (!portalClientId) {
    throw new NfseCertError(
      "NO_COMPANY_CERT",
      "Esta empresa não está ligada a um cadastro do portal, então não há como localizar o " +
        "certificado A1 dela. A DPS tem de ser assinada pelo certificado do próprio emitente " +
        "(E0718) — o do escritório não serve."
    );
  }

  // ⚠ NÃO ENGULA O ERRO. Mesma lição do `AdnNotasService.resolveCertWithFallback`: este `.catch`
  // já devolveu "não tem certificado" para empresa que TEM — só que de outro CNPJ, ou com senha
  // que não abre. Cada causa tem conserto diferente (trocar o arquivo × redigitar a senha ×
  // cadastrar o primeiro), e a mensagem genérica mandava o contador girar.
  const r = await resolveCertForCompany({ portalClientId, servico: SERVICOS.NFSE }).catch((err) => {
    if (err?.code === "CERT_CNPJ_MISMATCH" || err?.code === "CERT_PASSWORD_DECRYPT_FAILED") {
      throw new NfseCertError(err.code, err.message);
    }
    return { source: "none" };
  });

  // ⚠ `procuracao_escritorio` NÃO é aceito, pelo mesmo motivo que a captura não aceita: a
  // procuração e-CAC autoriza o escritório a AGIR no e-CAC; ela não transforma o certificado dele
  // no certificado do cliente perante o sistema nacional da NFS-e. E0718 fala do emitente da DPS.
  if (r.source !== "company_a1" || !r.pfxBuffer) {
    throw new NfseCertError(
      "NO_COMPANY_CERT",
      "Esta empresa não tem certificado A1 próprio cadastrado. A DPS tem de ser ASSINADA pelo " +
        "certificado digital do emitente (E0718; Res. CGNFS-e nº 3, art. 2º, §1º, I) — assinar " +
        "com o A1 do escritório emitiria documento fiscal em nome de outro CNPJ. Vá em Editar " +
        "Cadastro → Certificado A1 e faça upload do PFX desta empresa.",
      { origemResolvida: r.source || "none" }
    );
  }

  const pem = extrairPemDoPfx(r.pfxBuffer, r.password);

  return {
    // E0718: o certificado que ASSINA é o do emitente.
    assinatura: {
      pfxBuffer: r.pfxBuffer,
      password: r.password ?? null,
      certPem: pem.certPem,
      keyPem: pem.keyPem,
      certBase64: pem.certBase64,
    },
    // E1200–E1209 validam o certificado de TRANSPORTE por outro conjunto de regras. Hoje é o
    // mesmo arquivo; o campo é separado para que deixar de ser não seja uma refatoração.
    transporte: {
      pfxBuffer: r.pfxBuffer,
      password: r.password ?? null,
    },
    origem: "company_a1",
    certExpiresAt: r.certExpiresAt ?? null,
  };
}
