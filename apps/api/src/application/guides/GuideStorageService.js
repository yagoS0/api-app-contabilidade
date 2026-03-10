import fs from "node:fs";
import path from "node:path";
import {
  GUIDE_LOCAL_STORAGE_DIR,
  GUIDE_STORAGE_ACCESS_KEY_ID,
  GUIDE_STORAGE_BUCKET,
  GUIDE_STORAGE_ENDPOINT,
  GUIDE_STORAGE_FORCE_PATH_STYLE,
  GUIDE_STORAGE_PROVIDER,
  GUIDE_STORAGE_REGION,
  GUIDE_STORAGE_SECRET_ACCESS_KEY,
} from "../../config.js";

function ensureBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const err = new Error("file_buffer_required");
    err.code = "GUIDE_STORAGE_BUFFER_REQUIRED";
    throw err;
  }
}

function normalizeProvider(provider = GUIDE_STORAGE_PROVIDER) {
  const p = String(provider || "LOCAL").toUpperCase();
  if (p === "S3" || p === "R2") return p;
  return "LOCAL";
}

function buildS3PublicUrl({ endpoint, bucket, key, region }) {
  if (endpoint) {
    return `${endpoint.replace(/\/+$/, "")}/${bucket}/${key}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export class GuideStorageService {
  constructor(provider = GUIDE_STORAGE_PROVIDER) {
    this.provider = normalizeProvider(provider);
    this.s3 = null;
  }

  static create() {
    return new GuideStorageService();
  }

  async ensureS3() {
    if (this.s3) return this.s3;
    if (!GUIDE_STORAGE_BUCKET) {
      const err = new Error("guide_storage_bucket_required");
      err.code = "GUIDE_STORAGE_BUCKET_REQUIRED";
      throw err;
    }
    if (!GUIDE_STORAGE_ACCESS_KEY_ID || !GUIDE_STORAGE_SECRET_ACCESS_KEY) {
      const err = new Error("guide_storage_credentials_required");
      err.code = "GUIDE_STORAGE_CREDENTIALS_REQUIRED";
      throw err;
    }
    const mod = await import("aws-sdk");
    const AWS = mod.default || mod;
    this.s3 = new AWS.S3({
      region: GUIDE_STORAGE_REGION,
      endpoint: GUIDE_STORAGE_ENDPOINT || undefined,
      accessKeyId: GUIDE_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: GUIDE_STORAGE_SECRET_ACCESS_KEY,
      s3ForcePathStyle: GUIDE_STORAGE_FORCE_PATH_STYLE,
      signatureVersion: "v4",
    });
    return this.s3;
  }

  async upload({ key, buffer, contentType = "application/pdf" }) {
    ensureBuffer(buffer);
    if (!key) {
      const err = new Error("guide_storage_key_required");
      err.code = "GUIDE_STORAGE_KEY_REQUIRED";
      throw err;
    }
    if (this.provider === "LOCAL") {
      const fullPath = path.resolve(GUIDE_LOCAL_STORAGE_DIR, key);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, buffer);
      return {
        provider: "LOCAL",
        key,
        url: `file://${fullPath}`,
      };
    }

    const s3 = await this.ensureS3();
    await s3
      .putObject({
        Bucket: GUIDE_STORAGE_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
      .promise();
    return {
      provider: this.provider,
      key,
      url: buildS3PublicUrl({
        endpoint: GUIDE_STORAGE_ENDPOINT,
        bucket: GUIDE_STORAGE_BUCKET,
        key,
        region: GUIDE_STORAGE_REGION,
      }),
    };
  }

  async createDownloadUrl({ key, expiresInSeconds = 900 }) {
    if (!key) return null;
    if (this.provider === "LOCAL") {
      const fullPath = path.resolve(GUIDE_LOCAL_STORAGE_DIR, key);
      return `file://${fullPath}`;
    }
    const s3 = await this.ensureS3();
    return s3.getSignedUrl("getObject", {
      Bucket: GUIDE_STORAGE_BUCKET,
      Key: key,
      Expires: expiresInSeconds,
    });
  }

  async downloadBuffer({ key }) {
    if (!key) {
      const err = new Error("guide_storage_key_required");
      err.code = "GUIDE_STORAGE_KEY_REQUIRED";
      throw err;
    }
    if (this.provider === "LOCAL") {
      const fullPath = path.resolve(GUIDE_LOCAL_STORAGE_DIR, key);
      return fs.readFileSync(fullPath);
    }
    const s3 = await this.ensureS3();
    const response = await s3
      .getObject({
        Bucket: GUIDE_STORAGE_BUCKET,
        Key: key,
      })
      .promise();
    return Buffer.isBuffer(response.Body) ? response.Body : Buffer.from(response.Body || "");
  }
}

