import { prisma } from "../../infrastructure/db/prisma.js";
import {
  GUIDE_DRIVE_INBOX_ID,
  GUIDE_DRIVE_OUTPUT_ROOT_ID,
  GUIDE_SCHEDULE_CRON,
  PDF_READER_URL,
} from "../../config.js";

const KEY = "guides.runtime.settings";

export async function getGuideRuntimeSettings() {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const value = row?.value && typeof row.value === "object" ? row.value : {};
  return {
    guideDriveInboxId: String(value.guideDriveInboxId || GUIDE_DRIVE_INBOX_ID || "").trim(),
    guideDriveOutputRootId: String(
      value.guideDriveOutputRootId || GUIDE_DRIVE_OUTPUT_ROOT_ID || ""
    ).trim(),
    /** URL do serviço FastAPI pdf-reader — somente variável de ambiente `PDF_READER_URL` na API. */
    pdfReaderUrl: String(PDF_READER_URL || "").trim(),
    guideScheduleCron: String(value.guideScheduleCron || GUIDE_SCHEDULE_CRON || "").trim(),
  };
}

export async function updateGuideRuntimeSettings(input = {}) {
  const currentRow = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const current =
    currentRow?.value && typeof currentRow.value === "object" ? currentRow.value : {};
  const payload = {
    guideDriveInboxId:
      input.guideDriveInboxId !== undefined
        ? String(input.guideDriveInboxId || "").trim() || null
        : current.guideDriveInboxId || null,
    guideDriveOutputRootId:
      input.guideDriveOutputRootId !== undefined
        ? String(input.guideDriveOutputRootId || "").trim() || null
        : current.guideDriveOutputRootId || null,
    guideScheduleCron:
      input.guideScheduleCron !== undefined
        ? String(input.guideScheduleCron || "").trim() || null
        : current.guideScheduleCron || null,
  };

  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: payload },
    update: { value: payload },
  });
  return getGuideRuntimeSettings();
}
