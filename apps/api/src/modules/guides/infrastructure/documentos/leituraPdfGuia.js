import { exigirGuiaArrecadatoria } from '../../../../application/guides/lib/documentoNaoArrecadatorio.js';
import { GuideStorageService } from '../../../../application/guides/GuideStorageService.js';

export async function getGuidePdfBuffer(guide) {
  if (!guide) return null;
  exigirGuiaArrecadatoria(guide);
  const raw = guide.pdfBytes;
  if (raw != null && raw.length) {
    return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  }
  if (guide.storageKey) {
    const storage = GuideStorageService.create();
    return storage.downloadBuffer({ key: guide.storageKey });
  }
  return null;
}

