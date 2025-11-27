import fs from "node:fs";
import path from "node:path";
import { getDrive } from "../google/GoogleClients.js";
import { TARGET_MONTH, log } from "../../config.js";

export class DriveService {
  constructor(drive) {
    this.drive = drive;
  }

  static async create() {
    const drive = await getDrive();
    return new DriveService(drive);
  }

  async listChildren(folderId) {
    const out = [];
    let pageToken = undefined;
    do {
      const res = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields:
          "nextPageToken, files(id, name, mimeType, parents, createdTime, modifiedTime, appProperties)",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageToken,
      });
      out.push(...(res.data.files || []));
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    return out;
  }

  async listPdfsInFolder(folderId) {
    const { data } = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id,name,mimeType,parents,appProperties)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return data.files || [];
  }

  async listPdfs(folderId) {
    const all = await this.listChildren(folderId);
    return all.filter((f) => {
      const name = (f.name || "").toLowerCase();
      return f.mimeType === "application/pdf" || name.endsWith(".pdf");
    });
  }

  isDriveProcessed(file) {
    const flag = file?.appProperties?.belgen_processed;
    return flag === "1" || flag === "true";
  }

  async markDriveProcessed(file) {
    const current = (file && file.appProperties) || {};
    const appProperties = { ...current, belgen_processed: "1" };
    await this.drive.files.update({
      fileId: file.id,
      requestBody: { appProperties },
      supportsAllDrives: true,
    });
  }

  async findClientFolder(clientesRootId, clienteName) {
    const name = (clienteName || "").trim();
    const res = await this.drive.files.list({
      q: [
        `'${clientesRootId}' in parents`,
        "trashed = false",
        "mimeType = 'application/vnd.google-apps.folder'",
        `name = '${name.replace(/'/g, "\\'")}'`,
      ].join(" and "),
      fields: "files(id, name)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    if (res.data.files?.length) return res.data.files[0];
    const all = await this.listChildren(clientesRootId);
    const folder = all.find(
      (f) =>
        f.mimeType === "application/vnd.google-apps.folder" &&
        (f.name || "").trim().toLowerCase() === name.toLowerCase()
    );
    return folder || null;
  }

  async pickMonthFolder(clientFolderId) {
    const children = await this.listChildren(clientFolderId);
    const onlyFolders = children.filter(
      (c) => c.mimeType === "application/vnd.google-apps.folder"
    );
    if (TARGET_MONTH) {
      const exact = onlyFolders.find(
        (f) => (f.name || "").trim() === TARGET_MONTH.trim()
      );
      if (exact) return exact;
      log.warn(
        { target: TARGET_MONTH },
        "TARGET_MONTH informado, mas não encontrado; vou escolher o mais recente"
      );
    }
    const rx = /^(\d{2})-(\d{4})$/;
    const candidates = onlyFolders
      .map((f) => ({ f, m: (f.name || "").trim().match(rx) }))
      .filter((x) => !!x.m)
      .map((x) => {
        const mm = Number(x.m[1]);
        const yyyy = Number(x.m[2]);
        return {
          ...x,
          key: `${yyyy.toString().padStart(4, "0")}-${mm
            .toString()
            .padStart(2, "0")}`,
        };
      })
      .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    return candidates.length ? candidates[0].f : null;
  }

  async downloadPdfTo(fileId, destPath) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const res = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(destPath);
      res.data.on("error", reject).pipe(ws).on("error", reject).on("finish", resolve);
    });
    return destPath;
  }

  async createFolder(parentId, name) {
    const res = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      },
      fields: "id, name, parents",
      supportsAllDrives: true,
    });
    return res.data;
  }

  async findOrCreateSubfolder(parentId, name) {
    const res = await this.drive.files.list({
      q: [
        `'${parentId}' in parents`,
        "trashed = false",
        "mimeType = 'application/vnd.google-apps.folder'",
        `name = '${(name || "").replace(/'/g, "\\'")}'`,
      ].join(" and "),
      fields: "files(id, name, parents)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    if (res.data.files?.length) return res.data.files[0];
    return await this.createFolder(parentId, name);
  }

  async moveFileToFolder(fileId, destinationFolderId, removeParentId) {
    let removeParents = removeParentId;
    if (!removeParents) {
      const meta = await this.drive.files.get({
        fileId,
        fields: "parents",
        supportsAllDrives: true,
      });
      removeParents = (meta.data.parents || []).join(",");
    }
    const res = await this.drive.files.update({
      fileId,
      addParents: destinationFolderId,
      removeParents,
      fields: "id, parents",
      supportsAllDrives: true,
    });
    return res.data;
  }

  async findExactSubfolderByName(parentId, folderName) {
    const kids = await this.listChildren(parentId);
    const wanted = (folderName || "").trim().toLowerCase();
    const hit = kids.find(
      (f) =>
        f.mimeType === "application/vnd.google-apps.folder" &&
        (f.name || "").trim().toLowerCase() === wanted
    );
    return hit || null;
  }
}


