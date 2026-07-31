import crypto from "crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { REFRESH_TOKEN_EXPIRES_IN } from "../../config.js";

// Sessão revogável por dispositivo para o portal do cliente (app mobile).
// O refresh é um token OPACO (aleatório), enviado ao app e guardado aqui só como hash.
// Rotaciona a cada refresh; logout revoga a sessão; troca de senha revoga todas do usuário.

function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

function newRawToken() {
  return crypto.randomBytes(48).toString("hex");
}

function refreshTtlMs() {
  const raw = String(REFRESH_TOKEN_EXPIRES_IN || "7d").trim();
  const num = parseInt(raw, 10);
  if (Number.isNaN(num)) return 7 * 24 * 60 * 60 * 1000;
  if (raw.endsWith("ms")) return num;
  if (raw.endsWith("s")) return num * 1000;
  if (raw.endsWith("m")) return num * 60 * 1000;
  if (raw.endsWith("h")) return num * 60 * 60 * 1000;
  if (raw.endsWith("d")) return num * 24 * 60 * 60 * 1000;
  // valor "puro" (segundos, como o jsonwebtoken interpreta números)
  return num * 1000;
}

export class ClientSessionService {
  // Cria uma sessão nova e devolve o refresh opaco (uma única vez) para o app guardar.
  static async createSession(userId, { deviceLabel } = {}) {
    const rawRefresh = newRawToken();
    const expiresAt = new Date(Date.now() + refreshTtlMs());
    await prisma.clientSession.create({
      data: {
        userId: String(userId),
        refreshTokenHash: hashToken(rawRefresh),
        deviceLabel: deviceLabel ? String(deviceLabel).slice(0, 120) : null,
        expiresAt,
      },
    });
    return { refreshToken: rawRefresh, expiresAt };
  }

  // Valida um refresh opaco e ROTACIONA (revoga o antigo emitindo um novo hash na mesma linha).
  // Retorna { userId, refreshToken } ou null se inválido/revogado/expirado.
  static async rotate(rawRefresh) {
    if (!rawRefresh) return null;
    const session = await prisma.clientSession.findUnique({
      where: { refreshTokenHash: hashToken(rawRefresh) },
    });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;

    const nextRaw = newRawToken();
    const expiresAt = new Date(Date.now() + refreshTtlMs());
    await prisma.clientSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashToken(nextRaw),
        lastUsedAt: new Date(),
        expiresAt,
      },
    });
    return { userId: session.userId, refreshToken: nextRaw };
  }

  // Revoga a sessão associada a um refresh opaco (logout do dispositivo).
  // Se userId for passado, só revoga se a sessão pertencer a ele.
  static async revokeByRefresh(rawRefresh, userId) {
    if (!rawRefresh) return false;
    const session = await prisma.clientSession.findUnique({
      where: { refreshTokenHash: hashToken(rawRefresh) },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!session) return false;
    if (userId && String(session.userId) !== String(userId)) return false;
    if (session.revokedAt) return true;
    await prisma.clientSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return true;
  }

  // Revoga TODAS as sessões ativas do usuário (troca de senha, "sair de todos os dispositivos").
  static async revokeAllForUser(userId) {
    const result = await prisma.clientSession.updateMany({
      where: { userId: String(userId), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  // Um refresh opaco não tem pontos; um JWT tem duas separações por ponto.
  static looksOpaque(token) {
    return typeof token === "string" && !token.includes(".");
  }
}
