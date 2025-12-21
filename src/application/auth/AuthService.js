import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AUTH_USERS, JWT_SECRET, JWT_EXPIRES_IN } from "../../config.js";
import { UserRepository } from "../../infrastructure/db/UserRepository.js";

function normalizeExpiresIn() {
  const raw = JWT_EXPIRES_IN || "1h";
  if (!raw) return "1h";
  return raw;
}

function sanitizeUser(user, overrides = {}) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    role: user.role || "user",
    status: user.status || "active",
    source: user.source || "db",
    ...overrides,
  };
}

export class AuthService {
  static isEnabled() {
    return Boolean(JWT_SECRET);
  }

  static async authenticate(identifier, password) {
    if (!this.isEnabled()) {
      return { ok: false, error: "auth_not_configured" };
    }
    if (!identifier || !password) {
      return { ok: false, error: "missing_credentials" };
    }

    const normalized = String(identifier).trim().toLowerCase();
    let user = await UserRepository.findByEmail(normalized);
    if (user) {
      const ok = await bcrypt.compare(String(password), user.passwordHash);
      if (!ok) {
        return { ok: false, error: "invalid_credentials" };
      }
      if (user.status !== "active") {
        return { ok: false, error: "user_not_active", status: user.status };
      }
      return {
        ok: true,
        user: sanitizeUser(user, { source: "db" }),
      };
    }

    const fallback = AUTH_USERS.find(
      (item) =>
        item.username &&
        item.username.toLowerCase() === normalized.toLowerCase()
    );
    if (fallback) {
      const candidatePassword = String(password);
      if (fallback.passwordHash) {
        const ok = await bcrypt.compare(candidatePassword, fallback.passwordHash);
        if (!ok) return { ok: false, error: "invalid_credentials" };
      } else if (fallback.password) {
        if (fallback.password !== candidatePassword) {
          return { ok: false, error: "invalid_credentials" };
        }
      } else {
        return { ok: false, error: "invalid_credentials" };
      }
      return {
        ok: true,
        user: sanitizeUser({
          id: fallback.username,
          email: fallback.username,
          name: fallback.username,
          role: fallback.role || "user",
          status: "active",
          source: "env",
        }),
      };
    }

    return { ok: false, error: "invalid_credentials" };
  }

  static generateToken(user) {
    if (!this.isEnabled()) {
      throw new Error("AuthService: autenticação não configurada");
    }
    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name || null,
      role: user.role,
      source: user.source || "db",
    };
    const expiresIn = normalizeExpiresIn();
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
  }

  static verifyToken(token) {
    if (!this.isEnabled()) {
      throw new Error("AuthService: autenticação não configurada");
    }
    return jwt.verify(token, JWT_SECRET);
  }

  static getExpiresInMs() {
    const span = normalizeExpiresIn();
    const num = parseInt(span, 10);
    if (Number.isNaN(num)) return null;
    if (span.endsWith("ms")) return num;
    if (span.endsWith("s")) return num * 1000;
    if (span.endsWith("m")) return num * 60 * 1000;
    if (span.endsWith("h")) return num * 60 * 60 * 1000;
    if (span.endsWith("d")) return num * 24 * 60 * 60 * 1000;
    return num * 1000;
  }

  static async resolveUserFromPayload(payload) {
    if (!payload) return null;
    if (payload.source === "env") {
      return sanitizeUser({
        id: payload.sub,
        email: payload.email || payload.sub,
        name: payload.name || payload.email || payload.sub,
        role: payload.role || "user",
        status: "active",
        source: "env",
      });
    }
    if (!payload.sub) return null;
    const user = await UserRepository.findById(payload.sub);
    if (!user || user.status !== "active") return null;
    return sanitizeUser(user, { source: "db" });
  }
}

