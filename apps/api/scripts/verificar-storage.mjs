// Diz ONDE os PDFs estão sendo gravados e se esse lugar SOBREVIVE a um deploy.
//
// Existe porque a perda dos PDFs foi silenciosa: o default é relativo ao CWD, o processo roda em
// /app/apps/api (npm workspace) e não /app, então `./storage/guides` caía FORA do volume montado
// em /app/storage — e cada deploy apagava tudo, sem nenhum sinal.
//
//   node scripts/verificar-storage.mjs           → diagnóstico
//   node scripts/verificar-storage.mjs --marcar   → grava um arquivo-carimbo com a data
//
// COMO COMPROVAR A PERSISTÊNCIA (o único jeito honesto):
//   1) rode com --marcar hoje;
//   2) faça um deploy;
//   3) rode sem argumentos: se o carimbo continuar lá, o volume está pegando.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { GUIDE_STORAGE_PROVIDER, GUIDE_LOCAL_STORAGE_DIR, GUIDE_LOCAL_STORAGE_DIR_ABS } from "../src/config.js";

const CARIMBO = "_persistencia.txt";

function contarPdfs(dir) {
  let total = 0;
  const andar = (d) => {
    let itens = [];
    try { itens = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const full = path.join(d, it.name);
      if (it.isDirectory()) andar(full);
      else if (it.name.toLowerCase().endsWith(".pdf")) total += 1;
    }
  };
  andar(dir);
  return total;
}

console.log(`Provider .......: ${GUIDE_STORAGE_PROVIDER}`);
if (GUIDE_STORAGE_PROVIDER !== "LOCAL") {
  console.log("Armazenamento externo (S3/R2) — persistência não depende do filesystem do container.");
  process.exit(0);
}

console.log(`Configurado ....: ${GUIDE_LOCAL_STORAGE_DIR}`);
console.log(`Caminho real ...: ${GUIDE_LOCAL_STORAGE_DIR_ABS}`);
console.log(`CWD do processo : ${process.cwd()}`);

const dentroDeVolume = GUIDE_LOCAL_STORAGE_DIR_ABS.startsWith("/app/storage");
const noContainer = fs.existsSync("/app");
const volumeExiste = fs.existsSync("/app/storage");

console.log(`\n/app existe ....: ${noContainer ? "sim (container)" : "não (máquina local)"}`);
console.log(`/app/storage ...: ${volumeExiste ? "existe" : "NÃO existe"}`);

// Escrita de verdade: diretório existente porém read-only não serve de nada.
let gravavel = false;
try {
  fs.mkdirSync(GUIDE_LOCAL_STORAGE_DIR_ABS, { recursive: true });
  const teste = path.join(GUIDE_LOCAL_STORAGE_DIR_ABS, ".escrita-teste");
  fs.writeFileSync(teste, "ok");
  fs.unlinkSync(teste);
  gravavel = true;
} catch (err) {
  console.log(`\n✗ NÃO consigo escrever: ${err?.message}`);
}
if (gravavel) console.log("Escrita ........: ok");

console.log(`PDFs guardados .: ${contarPdfs(GUIDE_LOCAL_STORAGE_DIR_ABS)}`);

const carimbo = path.join(GUIDE_LOCAL_STORAGE_DIR_ABS, CARIMBO);
if (process.argv.includes("--marcar")) {
  const agora = new Date().toISOString();
  fs.appendFileSync(carimbo, `${agora}\n`);
  console.log(`\n✓ Carimbo gravado (${agora}).`);
  console.log("Faça um deploy e rode este script de novo: se o carimbo sobreviver, está persistente.");
} else if (fs.existsSync(carimbo)) {
  const linhas = fs.readFileSync(carimbo, "utf8").trim().split("\n").filter(Boolean);
  console.log(`\nCarimbo ........: ${linhas.length} marca(s) — 1ª em ${linhas[0]}`);
  console.log("Se alguma marca é ANTERIOR ao último deploy, a persistência está comprovada.");
} else {
  console.log("\nCarimbo ........: nenhum (rode com --marcar para iniciar o teste)");
}

if (noContainer && !dentroDeVolume) {
  console.log(`\n⚠ ARMAZENAMENTO EFÊMERO — os PDFs somem no próximo deploy.`);
  console.log("   Corrija de uma destas formas:");
  console.log("   • Volume montado em /app/storage (o código detecta sozinho); ou");
  console.log("   • GUIDE_LOCAL_STORAGE_DIR=/app/storage/guides (absoluto, à prova de CWD).");
  process.exitCode = 1;
} else if (dentroDeVolume) {
  console.log("\n✓ Gravando dentro do volume persistente.");
}
