import { prisma } from "../../infrastructure/db/prisma.js";

export async function tryAcquireGuideLock(lockId, ttlMs) {
  const id = String(lockId || "").trim();
  if (!id) return false;
  const now = new Date();
  const until = new Date(Date.now() + Math.max(1000, Number(ttlMs) || 60000));
  try {
    await prisma.guideIngestionLock.create({
      data: {
        id,
        lockedUntil: until,
      },
    });
    return true;
  } catch (err) {
    if (err?.code !== "P2002") throw err;
  }
  const updated = await prisma.guideIngestionLock.updateMany({
    where: {
      id,
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
    data: { lockedUntil: until },
  });
  return updated.count > 0;
}

export async function releaseGuideLock(lockId) {
  await prisma.guideIngestionLock
    .update({
      where: { id: String(lockId) },
      data: { lockedUntil: null },
    })
    .catch(() => {});
}

