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

// A lease is owned by its last expiry value. Compare-and-swap prevents an expired
// execution from releasing a newer execution's lock, without changing legacy callers.
export async function acquireGuideLease(lockId, ttlMs = 30 * 60000) {
  const id = String(lockId);
  let expiry = new Date(Date.now() + ttlMs);
  try {
    await prisma.guideIngestionLock.create({ data: { id, lockedUntil: expiry } });
  } catch (err) {
    if (err?.code !== "P2002") throw err;
    const changed = await prisma.guideIngestionLock.updateMany({
      where: { id, OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }] },
      data: { lockedUntil: expiry },
    });
    if (!changed.count) return null;
  }
  let active = true;
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.then(async () => {
      if (!active || expiry <= new Date()) { active = false; return; }
      const next = new Date(Date.now() + ttlMs);
      const changed = await prisma.guideIngestionLock.updateMany({
        where: { id, lockedUntil: expiry }, data: { lockedUntil: next },
      });
      if (!changed.count) active = false;
      else expiry = next;
    }).catch(() => { active = false; });
  }, Math.min(60000, Math.floor(ttlMs / 3)));
  timer.unref?.();
  return {
    assertActive() {
      if (!active || expiry <= new Date()) throw Object.assign(new Error("Reserva da execução perdida."), { code: "GUIDE_LEASE_LOST" });
    },
    async release() {
      clearInterval(timer);
      await pending;
      active = false;
      await prisma.guideIngestionLock.updateMany({ where: { id, lockedUntil: expiry }, data: { lockedUntil: null } });
    },
  };
}

