import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  AUTH_USERS,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN,
} from "../../config.js";
import { UserRepository } from "../../infrastructure/db/UserRepository.js";
import { ClientRepository } from "../../infrastructure/db/ClientRepository.js";

function normalizeExpiresIn() {
  const raw = JWT_EXPIRES_IN || "1h";
  if (!raw) return "1h";
  return raw;
}

function normalizeRefreshExpiresIn() {
  const raw = REFRESH_TOKEN_EXPIRES_IN || "7d";
  if (!raw) return "7d";
  return raw;
}

function sanitizeUser(user, overrides = {}) {
  if (!user) return null;
  const role = user.role || "user";
  const inferredAccountType =
    role === "admin" || role === "contador" ? "FIRM" : "CLIENT";
  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    role,
    status: user.status || "active",
    accountType: user.accountType || inferredAccountType,
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

  static async authenticateClient(login, password) {
    if (!this.isEnabled()) {
      return { ok: false, error: "auth_not_configured" };
    }
    if (!login || !password) {
      return { ok: false, error: "missing_credentials" };
    }
    const normalized = String(login).trim().toLowerCase();
    const client = await ClientRepository.findByLogin(normalized);
    if (!client) return { ok: false, error: "invalid_credentials" };
    const ok = await bcrypt.compare(String(password), client.passwordHash);
    if (!ok) return { ok: false, error: "invalid_credentials" };
    return {
      ok: true,
      client: {
        id: client.id,
        login: client.login,
        email: client.email,
        name: client.name,
        role: "client",
        accountType: "CLIENT",
        source: "client",
      },
    };
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
      accountType: user.accountType || "CLIENT",
      source: user.source || "db",
    };
    const expiresIn = normalizeExpiresIn();
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
  }

  static generateClientToken(client) {
    if (!this.isEnabled()) {
      throw new Error("AuthService: autenticação não configurada");
    }
    const payload = {
      sub: client.id,
      login: client.login,
      email: client.email,
      name: client.name || null,
      role: client.role || "client",
      accountType: client.accountType || "CLIENT",
      source: client.source || "client",
      type: "client",
    };
    const expiresIn = normalizeExpiresIn();
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
  }

  static generateClientRefreshToken(client) {
    if (!this.isEnabled()) {
      throw new Error("AuthService: autenticação não configurada");
    }
    const payload = {
      sub: client.id,
      login: client.login,
      email: client.email,
      name: client.name || null,
      role: client.role || "client",
      accountType: client.accountType || "CLIENT",
      source: client.source || "client",
      type: "client",
      tokenType: "refresh",
    };
    const expiresIn = normalizeRefreshExpiresIn();
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
  }

  static generateClientTokens(client) {
    const accessToken = this.generateClientToken(client);
    const refreshToken = this.generateClientRefreshToken(client);
    return { accessToken, refreshToken };
  }

  static generateRefreshToken(user) {
    if (!this.isEnabled()) {
      throw new Error("AuthService: autenticação não configurada");
    }
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      accountType: user.accountType || "CLIENT",
      source: user.source || "db",
      tokenType: "refresh",
    };
    const expiresIn = normalizeRefreshExpiresIn();
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
  }

  static generateTokens(user) {
    const accessToken = this.generateToken(user);
    const refreshToken = this.generateRefreshToken(user);
    return { accessToken, refreshToken };
  }

  static verifyToken(token) {
    if (!this.isEnabled()) {
      throw new Error("AuthService: autenticação não configurada");
    }
    return jwt.verify(token, JWT_SECRET);
  }

  static verifyRefreshToken(token) {
    const payload = this.verifyToken(token);
    if (payload?.tokenType !== "refresh") {
      const err = new Error("invalid_refresh_token");
      err.code = "INVALID_REFRESH_TOKEN";
      throw err;
    }
    return payload;
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
    if (payload.type === "client") {
      if (!payload.sub) return null;
      const client = await ClientRepository.getClientById(payload.sub);
      if (!client) return null;
      return {
        id: client.id,
        login: client.login,
        email: client.email,
        name: client.name,
        role: "client",
        status: "active",
        accountType: "CLIENT",
        source: "client",
      };
    }
    if (payload.source === "env") {
      return sanitizeUser({
        id: payload.sub,
        email: payload.email || payload.sub,
        name: payload.name || payload.email || payload.sub,
        role: payload.role || "user",
        status: "active",
        accountType:
          payload.accountType ||
          (payload.role === "admin" || payload.role === "contador"
            ? "FIRM"
            : "CLIENT"),
        source: "env",
      });
    }
    if (!payload.sub) return null;
    const user = await UserRepository.findById(payload.sub);
    if (!user || user.status !== "active") return null;
    return sanitizeUser(user, { source: "db" });
  }
}

