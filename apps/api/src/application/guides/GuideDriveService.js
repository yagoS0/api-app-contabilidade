import { getDrive } from "../../infrastructure/google/GoogleClients.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const EMAIL_SENT_PROP = "guide_email_sent";
const EMAIL_SENT_AT_PROP = "guide_email_sent_at";

function esc(value) {
  return String(value || "").replace(/'/g, "\\'");
}

export class GuideDriveService {
  constructor(drive) {
    this.drive = drive;
  }

  static async create() {
    const drive = await getDrive();
    return new GuideDriveService(drive);
  }

  async listInboxPdfs(folderId) {
    const out = [];
    let pageToken;
    do {
      const { data } = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields:
          "nextPageToken,files(id,name,mimeType,parents,createdTime,modifiedTime,size,appProperties)",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageToken,
      });
      out.push(
        ...(data.files || []).filter(
          (f) =>
            f.mimeType === "application/pdf" ||
            String(f.name || "")
              .toLowerCase()
              .endsWith(".pdf")
        )
      );
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
    return out;
  }

  async getFile(fileId) {
    const { data } = await this.drive.files.get({
      fileId,
      fields: "id,name,mimeType,parents,createdTime,modifiedTime,size,appProperties",
      supportsAllDrives: true,
    });
    return data;
  }

  async listChildren(folderId) {
    const out = [];
    let pageToken;
    do {
      const { data } = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields:
          "nextPageToken,files(id,name,mimeType,parents,createdTime,modifiedTime,size,appProperties)",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageToken,
      });
      out.push(...(data.files || []));
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
    return out;
  }

  async downloadFileBuffer(fileId) {
    const { data } = await this.drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    return Buffer.from(data);
  }

  async ensureFolder(parentId, name) {
    const query = [
      `'${parentId}' in parents`,
      "trashed=false",
      `mimeType='${FOLDER_MIME}'`,
      `name='${esc(name)}'`,
    ].join(" and ");
    const { data } = await this.drive.files.list({
      q: query,
      fields: "files(id,name,parents)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 1,
    });
    if (data.files?.length) return data.files[0].id;
    const created = await this.drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
      fields: "id,name",
      supportsAllDrives: true,
    });
    return created.data.id;
  }

  async ensureNestedFolders(rootFolderId, names = []) {
    let parent = rootFolderId;
    for (const name of names) {
      parent = await this.ensureFolder(parent, name);
    }
    return parent;
  }

  async findExactSubfolderByName(parentId, folderName) {
    const wanted = String(folderName || "").trim().toLowerCase();
    if (!wanted) return null;
    const items = await this.listChildren(parentId);
    return (
      items.find(
        (item) =>
          item.mimeType === FOLDER_MIME &&
          String(item.name || "")
            .trim()
            .toLowerCase() === wanted
      ) || null
    );
  }

  async listPdfsInFolder(folderId) {
    const items = await this.listChildren(folderId);
    return items.filter(
      (item) =>
        item.mimeType === "application/pdf" ||
        String(item.name || "")
          .toLowerCase()
          .endsWith(".pdf")
    );
  }

  isGuideEmailSent(file) {
    const flag = file?.appProperties?.[EMAIL_SENT_PROP];
    return flag === "1" || flag === "true";
  }

  async markGuideEmailSent(fileOrId) {
    const fileId = typeof fileOrId === "string" ? fileOrId : fileOrId?.id;
    if (!fileId) return;
    const current =
      typeof fileOrId === "object" && fileOrId?.appProperties
        ? fileOrId.appProperties
        : (await this.getFile(fileId))?.appProperties || {};
    const appProperties = {
      ...current,
      [EMAIL_SENT_PROP]: "1",
      [EMAIL_SENT_AT_PROP]: new Date().toISOString(),
    };
    await this.drive.files.update({
      fileId,
      requestBody: { appProperties },
      fields: "id,appProperties",
      supportsAllDrives: true,
    });
  }

  /** Cria/garante subpastas fixas sob a pasta de saída e retorna seus IDs. */
  async ensureGuideOutputFolders(outputRootId) {
    if (!outputRootId) return null;
    const [guiasRootId, duplicatesId] = await Promise.all([
      this.ensureFolder(outputRootId, "Guias"),
      this.ensureFolder(outputRootId, "Duplicadas"),
    ]);
    return { guiasRootId, duplicatesId };
  }

  async renameFile(fileId, newName) {
    await this.drive.files.update({
      fileId,
      requestBody: { name: newName },
      fields: "id,name",
      supportsAllDrives: true,
    });
  }

  async moveFile(fileId, destinationFolderId) {
    const meta = await this.getFile(fileId);
    const removeParents = (meta.parents || []).join(",");
    await this.drive.files.update({
      fileId,
      addParents: destinationFolderId,
      removeParents,
      fields: "id,parents",
      supportsAllDrives: true,
    });
  }
}

