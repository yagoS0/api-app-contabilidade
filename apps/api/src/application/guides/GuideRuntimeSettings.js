import { prisma } from "../../infrastructure/db/prisma.js";
import { GUIDE_SCHEDULE_CRON, PDF_READER_URL } from "../../config.js";

const KEY = "guides.runtime.settings";

export async function getGuideRuntimeSettings() {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const value = row?.value && typeof row.value === "object" ? row.value : {};
  return {
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
