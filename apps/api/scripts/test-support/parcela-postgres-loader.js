// Only this local PostgreSQL integration harness may replace the paid transport.
// The production service, parser and Prisma remain the real modules.
const database = new URL(process.env.DATABASE_URL || "invalid:");
if (process.env.NODE_ENV !== "test" || database.protocol !== "postgresql:"
    || database.hostname !== "127.0.0.1" || database.port !== "55447"
    || database.pathname !== "/consulta_pagamento_check" || database.username !== "consulta_test") {
  throw Error("Loader de parcelas exclusivo do ensaio PostgreSQL local.");
}
const directory = new URL("../../src/application/fiscal/serpro/", import.meta.url);
const service = new URL("SerproParcelaPagamentoService.js", directory).href;
const replacements = new Map([
  [new URL("SerproRuntimeSettings.js", directory).href, `
    export async function getResolvedSerproCredentials() {
      return { certificate: { document: "11111111000191" } };
    }
  `],
  [new URL("SerproParcelamentoService.js", directory).href, `
    export class SerproParcelamentoService {
      consultarPagamentoParcela(input) {
        const fixture = globalThis[Symbol.for("altan.parcela-postgres-fixture")];
        if (!fixture) throw new Error("Fixture local ausente; transporte proibido.");
        return fixture(input);
      }
    }
  `],
]);
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (context.parentURL === service && replacements.has(resolved.url)) {
    return { url: `data:text/javascript,${encodeURIComponent(replacements.get(resolved.url))}`, shortCircuit: true };
  }
  return resolved;
}
