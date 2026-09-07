import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";

export async function adquirirLease(id, { client = prisma, agora = new Date(), ttlMs = 90000 } = {}) {
  const token = randomUUID();
  const data = { token, expiraEm: new Date(agora.getTime() + ttlMs) };
  try { await client.whatsappLease.create({ data: { id, ...data } }); }
  catch (e) {
    if (e?.code !== "P2002") throw e;
    const r = await client.whatsappLease.updateMany({ where: { id, expiraEm: { lte: agora } }, data });
    if (!r.count) return null;
  }
  return { id, token };
}
export async function renovarLease(lease, { client = prisma, agora = new Date(), ttlMs = 90000 } = {}) {
  if (!lease) return false;
  const r = await client.whatsappLease.updateMany({ where: { id: lease.id, token: lease.token, expiraEm: { gt: agora } }, data: { expiraEm: new Date(agora.getTime() + ttlMs) } });
  return r.count === 1;
}
export async function liberarLease(lease, { client = prisma } = {}) {
  if (lease) await client.whatsappLease.deleteMany({ where: { id: lease.id, token: lease.token } });
}
