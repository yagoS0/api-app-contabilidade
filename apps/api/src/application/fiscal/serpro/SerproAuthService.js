import fs from "node:fs";
import https from "node:https";
import { Buffer } from "node:buffer";
import axios from "axios";
import forge from "node-forge";
import { resolveCertificatePath } from "../../../infrastructure/storage/CertStorage.js";
import { getSerproConfig } from "./SerproConfig.js";
import { mapSerproError } from "./SerproErrorMapper.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";

function extractTlsMaterialFromPfx(certBuffer, certPassword) {
  const p12Asn1 = forge.asn1.fromDer(certBuffer.toString("binary"));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certPassword);
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })?.[forge.pki.oids.certBag] || [];
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })?.[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ||
    p12.getBags({ bagType: forge.pki.oids.keyBag })?.[forge.pki.oids.keyBag]?.[0];

  if (!certBags.length || !keyBag?.key) {
    const err = new Error("serpro_certificate_not_configured");
    err.code = "SERPRO_CERTIFICATE_NOT_CONFIGURED";
    throw err;
  }

  return {
    cert: certBags.map((bag) => forge.pki.certificateToPem(bag.cert)).join("\n"),
    key: forge.pki.privateKeyToPem(keyBag.key),
  };
}

export class SerproAuthService {
  constructor(options = {}) {
    this.config = options.config || getSerproConfig();
    this.cachedToken = null;
    this.cachedTokenExpiresAt = 0;
    this.cachedJwtToken = null;
  }

  async loadCertificateMaterial() {
    const runtime = await getResolvedSerproCredentials();
    if (!runtime.certificate?.hasCertificate || !runtime.certificate?.storageKey) {
      const err = new Error("serpro_certificate_not_configured");
      err.code = "SERPRO_CERTIFICATE_NOT_CONFIGURED";
      throw err;
    }

    if (runtime.certificate?.pfxBase64) {
      if (!runtime.certificate.passwordConfigured) {
        const err = new Error("serpro_cert_password_not_found");
        err.code = "SERPRO_CERT_PASSWORD_NOT_FOUND";
        throw err;
      }

      return {
        certPath: null,
        certBuffer: Buffer.from(runtime.certificate.pfxBase64, "base64"),
        certPassword: runtime.certificate.password,
      };
    }

    const certPath = resolveCertificatePath(runtime.certificate.storageKey);
    if (!certPath) {
      const err = new Error("serpro_cert_file_not_found");
      err.code = "SERPRO_CERT_FILE_NOT_FOUND";
      throw err;
    }

    if (!runtime.certificate.passwordConfigured) {
      const err = new Error("serpro_cert_password_not_found");
      err.code = "SERPRO_CERT_PASSWORD_NOT_FOUND";
      throw err;
    }

    return {
      certPath,
      certBuffer: fs.readFileSync(certPath),
      certPassword: runtime.certificate.password,
    };
  }

  async buildHttpsAgent() {
    const certificate = await this.loadCertificateMaterial();
    const tlsMaterial = extractTlsMaterialFromPfx(certificate.certBuffer, certificate.certPassword);

    return new https.Agent({
      cert: tlsMaterial.cert,
      key: tlsMaterial.key,
      rejectUnauthorized: true,
    });
  }

  isTokenValid() {
    return Boolean(this.cachedToken && this.cachedTokenExpiresAt && Date.now() < this.cachedTokenExpiresAt - 30000);
  }

  async authenticate() {
    const runtime = await getResolvedSerproCredentials();

    if (this.isTokenValid()) {
      return {
        accessToken: this.cachedToken,
        jwtToken: this.cachedJwtToken,
        expiresAt: this.cachedTokenExpiresAt,
      };
    }

    const httpsAgent = await this.buildHttpsAgent();
    const payload = new URLSearchParams();
    payload.set("grant_type", "client_credentials");
    if (runtime.scope) payload.set("scope", runtime.scope);

    try {
      const response = await axios.post(runtime.authUrl, payload.toString(), {
        timeout: runtime.timeoutMs,
        httpsAgent,
        headers: {
          Authorization: `Basic ${Buffer.from(`${runtime.consumerKey}:${runtime.consumerSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Role-Type": "TERCEIROS",
        },
      });

      const accessToken = String(response.data?.access_token || "").trim();
      const jwtToken = String(response.data?.jwt_token || "").trim();
      const expiresIn = Math.max(60, Number(response.data?.expires_in || 300));
      if (!accessToken) {
        const err = new Error("serpro_access_token_missing");
        err.code = "SERPRO_ACCESS_TOKEN_MISSING";
        throw err;
      }
      if (!jwtToken) {
        const err = new Error("serpro_jwt_token_missing");
        err.code = "SERPRO_JWT_TOKEN_MISSING";
        throw err;
      }

      this.cachedToken = accessToken;
      this.cachedJwtToken = jwtToken;
      this.cachedTokenExpiresAt = Date.now() + expiresIn * 1000;

      return {
        accessToken: this.cachedToken,
        jwtToken: this.cachedJwtToken,
        expiresAt: this.cachedTokenExpiresAt,
      };
    } catch (error) {
      throw mapSerproError(error, "SERPRO_AUTH_ERROR");
    }
  }
}
