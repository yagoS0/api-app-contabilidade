// O arquivo contém configuração privada e deve permanecer fora do checkout e dos logs.
// Prévia: node scripts/import-commercial-resources.mjs --file /privado/config.json --actor-id ID
// Gravar rascunhos: acrescente --apply. Revise/aprove depois pela gestão do escritório.
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function argumentos(argv) {
  const out = { aplicar: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--apply" && !out.aplicar) out.aplicar = true;
    else if (["--file", "--actor-id"].includes(flag) && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      const campo = flag === "--file" ? "arquivo" : "atorId";
      if (out[campo]) throw Object.assign(new Error("Argumento repetido."), { code: "argumentos_invalidos" });
      out[campo] = argv[++i];
    } else throw Object.assign(new Error("Argumentos inválidos."), { code: "argumentos_invalidos" });
  }
  if (!out.arquivo || !out.atorId) throw Object.assign(new Error("Informe --file e --actor-id. Use --apply somente para gravar rascunhos."), { code: "argumentos_invalidos" });
  return out;
}

export async function importarArquivo(argv, { executar, ler = readFile, info = stat } = {}) {
  const args = argumentos(argv);
  const arquivo = resolve(args.arquivo);
  const metadados = await info(arquivo);
  if (!metadados.isFile() || metadados.size > 8 * 1024 * 1024) throw Object.assign(new Error("Arquivo inválido ou acima de 8 MiB."), { code: "arquivo_invalido" });
  let payload;
  try { payload = JSON.parse(await ler(arquivo, "utf8")); }
  catch { throw Object.assign(new Error("JSON privado inválido."), { code: "json_invalido" }); }
  return executar(payload, args.atorId, { aplicar: args.aplicar });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let prisma;
  try {
    // Valida opções antes de iniciar o runtime ou acessar o banco.
    argumentos(process.argv.slice(2));
    ({ prisma } = await import("../src/infrastructure/db/prisma.js"));
    const { criarRecursosComerciais } = await import("../src/application/onboarding/RecursosComerciaisService.js");
    const resultado = await importarArquivo(process.argv.slice(2), { executar: criarRecursosComerciais({ db: prisma }).importarRascunhos });
    process.stdout.write(JSON.stringify(resultado) + "\n");
  } catch (err) {
    // Erros Prisma podem conter os argumentos da query. Não imprimir mensagem nem stack.
    const code = /^[A-Za-z0-9_]{1,80}$/.test(err?.code || "") ? err.code : "importacao_falhou";
    process.stderr.write(`Importação não concluída. Código: ${code}. Nenhuma versão existente foi alterada.\n`);
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect().catch(() => {});
  }
}
