import crypto from "node:crypto";
import { prisma } from "../../../infrastructure/db/prisma.js";

function buildLogKey() {
  return `serpro_pgdasd_log:${Date.now()}:${crypto.randomUUID()}`;
}

export async function createSerproExecutionLog(entry) {
  const payload = entry && typeof entry === "object" ? entry : {};
  const key = buildLogKey();
  await prisma.appSetting.create({
    data: {
      key,
      value: payload,
    },
  });
  return { key, ...payload };
}
