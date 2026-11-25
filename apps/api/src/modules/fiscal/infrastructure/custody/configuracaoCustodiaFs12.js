import path from 'node:path';
import * as fs from 'node:fs/promises';
import { sincronizarDiretorioFs12 } from './stageRespostaFs12.js';

const textId = value => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
const fail = code => { throw Object.assign(new Error(code), { code }); };

// Receives only central configuration. Never logs values or reads environment.
// Historical keys remain addressable: missing IDs never fall back to the active key.
export function prepararChavesCustodiaFs12({ keyringJson, keyIdAtivo }) {
  if (!textId(keyIdAtivo)) fail('FS12_CHAVE_ATIVA_NAO_CONFIGURADA');
  if (typeof keyringJson !== 'string' || keyringJson.length > 65536) fail('FS12_CHAVEIRO_INVALIDO');
  let entries;
  try { entries = JSON.parse(keyringJson); } catch { fail('FS12_CHAVEIRO_INVALIDO'); }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 100) fail('FS12_CHAVEIRO_INVALIDO');
  const keys = new Map();
  try {
    for (const entry of entries) {
      if (!entry || Object.getPrototypeOf(entry) !== Object.prototype
        || Object.keys(entry).sort().join(',') !== 'id,keyBase64'
        || !textId(entry.id) || keys.has(entry.id)
        || typeof entry.keyBase64 !== 'string' || entry.keyBase64.length !== 44) fail('FS12_CHAVEIRO_INVALIDO');
      const key = Buffer.from(entry.keyBase64, 'base64');
      if (key.length !== 32 || key.toString('base64') !== entry.keyBase64) {
        key.fill(0); fail('FS12_CHAVEIRO_INVALIDO');
      }
      keys.set(entry.id, key);
    }
    if (!keys.has(keyIdAtivo)) fail('FS12_CHAVE_ATIVA_AUSENTE');
  } catch (error) {
    for (const key of keys.values()) key.fill(0);
    throw error;
  }
  return Object.freeze({
    keyIdAtivo,
    resolveKey(id) {
      if (!textId(id) || !keys.has(id)) fail('FS12_CHAVE_HISTORICA_INDISPONIVEL');
      return keys.get(id); // Borrowed; cipher adapters copy before wiping.
    },
    destruir() { for (const key of keys.values()) key.fill(0); keys.clear(); },
  });
}

// Strict by default. The Windows test mode actually attempts directory sync and
// reports its limitation; it is not a no-op replacing the storage boundary.
export function criarSincronizacaoDiretorioFs12({ modo = 'DIRECTORY_SYNC_REQUIRED', ambiente, plataforma = process.platform } = {}) {
  if (!['DIRECTORY_SYNC_REQUIRED', 'PROCESS_RESTART_ONLY'].includes(modo)
    || (modo === 'PROCESS_RESTART_ONLY' && ambiente !== 'test')) fail('FS12_DURABILIDADE_CONFIG_INVALIDA');
  return async directory => {
    try { return await sincronizarDiretorioFs12(directory); }
    catch (error) {
      if (modo === 'PROCESS_RESTART_ONLY' && plataforma === 'win32'
        && ['EPERM', 'EACCES', 'EISDIR', 'ENOTSUP', 'EINVAL'].includes(error.code)) return false;
      throw error;
    }
  };
}

export async function conferirDiretorioCustodiaFs12({ root, syncDirectory }) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('FS12_DIRETORIO_NAO_CONFIGURADO');
  const resolved = path.resolve(root);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || path.relative(resolved, await fs.realpath(resolved)) !== '') fail('FS12_DIRETORIO_INVALIDO');
  // Provisioning and Windows ACLs are deployment responsibilities, not chmod claims.
  await fs.access(resolved, fs.constants.R_OK | fs.constants.W_OK);
  return Object.freeze({ root: resolved, directorySynced: await syncDirectory(resolved) === true });
}
