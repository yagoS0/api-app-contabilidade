import * as fs from 'node:fs/promises';
import path from 'node:path';
import { contextoCustodia, erroCustodia, hashBytes, hashContexto } from './cifraRespostaFs12.js';

const MAX_FILE = 22369624 + 65536;
const camposOrigem = ['respostaId','comandoId','tentativaId','reservaId','portalClientId','companyId',
  'custodianteId','capacidadeId','envelopeHash','marcadorHash','cnpj','competencia','revisaoFs12','intencao'];
// Returned by a trusted reader of the ORIGINAL pre-dispatch chain, not the stage.
function conferirOrigem(ctx, expected) {
  if (!expected || Object.keys(expected).length !== camposOrigem.length
    || camposOrigem.some(k => !Object.hasOwn(expected,k) || expected[k] !== ctx[k])) throw erroCustodia('FS12_STAGE_CONTEXTO_DIVERGENTE');
}
const token = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export async function sincronizarDiretorioFs12(directory) {
  const h = await fs.open(directory, 'r');
  try { await h.sync(); return true; } finally { await h.close(); }
}
// Only composition may provide root/cipher/I/O. Root must be a preprovisioned,
// private local directory; mode bits do not provision Windows ACLs.
// An injected syncDirectory returning false explicitly limits durability to
// process restart. Default fails closed if directory fsync is unsupported.
export function criarStageRespostaFs12({ root, cifra, io = fs, syncDirectory = sincronizarDiretorioFs12 }) {
  if (!path.isAbsolute(root || '') || !cifra || typeof syncDirectory !== 'function') throw erroCustodia('FS12_STAGE_CONFIG_INVALIDA');
  const base = path.resolve(root);
  async function directory(p) {
    const s = await io.lstat(p);
    if (!s.isDirectory() || s.isSymbolicLink() || path.relative(p, await io.realpath(p)) !== '') throw erroCustodia('FS12_STAGE_PATH_INVALIDO');
  }
  async function location(id) {
    if (!token(id)) throw erroCustodia('FS12_STAGE_ID_INVALIDO');
    await directory(base);
    const dir = path.join(base, id);
    await directory(dir);
    return dir;
  }
  async function read(dir, name = 'record.json') {
    const file = path.join(dir, name);
    const s = await io.lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.size > MAX_FILE) throw erroCustodia('FS12_STAGE_ARQUIVO_INVALIDO');
    const h = await io.open(file, name === 'record.tmp' ? 'r+' : 'r');
    try {
      const stat = await h.stat();
      if (!stat.isFile() || stat.size !== s.size || stat.ino !== s.ino || stat.dev !== s.dev) throw erroCustodia('FS12_STAGE_ARQUIVO_INVALIDO');
      // Bounded read even if a foreign writer grows a file after stat.
      const data = Buffer.alloc(MAX_FILE + 1);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await h.read(data, offset, data.length - offset, null);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > MAX_FILE) throw erroCustodia('FS12_STAGE_ARQUIVO_INVALIDO');
      let record;
      try { record = JSON.parse(data.subarray(0, offset).toString('utf8')); }
      catch (cause) { throw erroCustodia('FS12_STAGE_CORROMPIDO', cause); }
      if (!record || Object.keys(record).sort().join(',') !== 'contexto,envelope,id,v' || record.v !== 1 || !token(record.id)) throw erroCustodia('FS12_STAGE_CORROMPIDO');
      if (name === 'record.tmp') await h.sync(); // Complete candidate survives producer restart before rename.
      return record;
    } finally { await h.close(); }
  }
  async function verify(record, expected, id, fullContext = false) {
    const ctx = contextoCustodia(record.contexto);
    if (record.id !== id || hashBytes(Buffer.from(ctx.respostaId)) !== id) throw erroCustodia('FS12_STAGE_CONTEXTO_DIVERGENTE');
    if (fullContext) {
      if (hashContexto(expected) !== hashContexto(ctx)) throw erroCustodia('FS12_STAGE_CONTEXTO_DIVERGENTE');
    } else conferirOrigem(ctx, expected);
    // Observation hash/status/time come from the authenticated stage, not a DB
    // response record that may not exist yet. Source authority is the trusted producer.
    const corpo = await cifra.decifrar({ envelope: record.envelope, contexto: ctx });
    return { contexto: ctx, corpo };
  }
  async function syncBoth(dir) {
    const parent = await syncDirectory(base);
    const child = await syncDirectory(dir);
    return parent === true && child === true;
  }
  return {
    async guardar({ corpo, contexto, keyId }) {
      const ctx = contextoCustodia(contexto);
      const id = hashBytes(Buffer.from(ctx.respostaId));
      await directory(base);
      const dir = path.join(base, id);
      // Prepare cipher before owning a directory; key failures create no stage.
      const envelope = await cifra.cifrar({ corpo, contexto: ctx, keyId });
      try { await io.mkdir(dir, { mode: 0o700 }); }
      catch (cause) {
        if (cause.code !== 'EEXIST') throw erroCustodia('FS12_STAGE_ESCRITA_FALHOU', cause);
        await directory(dir);
        let record;
        try { record = await read(dir); }
        catch (error) {
          if (error.code === 'ENOENT') throw erroCustodia('FS12_STAGE_PENDENTE', error);
          throw error;
        }
        const prior = await verify(record, ctx, id, true);
        try {
          if (!prior.corpo.equals(corpo)) throw erroCustodia('FS12_STAGE_CONFLITO');
          return { id, replay: true, directorySynced: await syncBoth(dir) };
        } finally { prior.corpo.fill(0); }
      }
      const bytes = Buffer.from(JSON.stringify({ v: 1, id, contexto: ctx, envelope }));
      if (bytes.length > MAX_FILE) throw erroCustodia('FS12_STAGE_ARQUIVO_INVALIDO');
      const tmp = path.join(dir, 'record.tmp');
      let h;
      try {
        const parentSynced = await syncDirectory(base);
        h = await io.open(tmp, 'wx', 0o600);
        await h.writeFile(bytes);
        await h.sync();
        await h.close(); h = null;
        await io.rename(tmp, path.join(dir, 'record.json'));
        const directorySynced = await syncBoth(dir);
        return { id, replay: false, directorySynced: parentSynced === true && directorySynced === true };
      } catch (cause) {
        // Preserve both partial temps and completed records: no deletion by age.
        throw erroCustodia('FS12_STAGE_ESCRITA_FALHOU', cause);
      } finally { if (h) await h.close(); }
    },
    async inspecionar() {
      await directory(base);
      const entries = await io.readdir(base, { withFileTypes: true });
      const output = [];
      for (const entry of entries) {
        if (!token(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
          output.push({ id: null, situacao: 'ENTRADA_NAO_RECONHECIDA' }); continue;
        }
        const dir = await location(entry.name);
        const files = await io.readdir(dir);
        output.push({ id: entry.name, situacao: files.includes('record.json') ? 'A_VALIDAR'
          : files.includes('record.tmp') ? 'TEMPORARIO_PENDENTE' : 'SEM_REGISTRO_PENDENTE' });
      }
      return output;
    },
    // resolveOrigin receives untrusted lookup hints, then loads ORIGINAL immutable
    // command/reservation/marker/capability. It must not echo the hints as authority.
    // No response hash/status/timestamp is required in the pre-dispatch chain.
    async recuperar({ id, resolveOrigin, importDurably }) {
      if (typeof resolveOrigin !== 'function' || typeof importDurably !== 'function') throw erroCustodia('FS12_STAGE_PORTA_INVALIDA');
      const dir = await location(id);
      let record, name = 'record.json';
      try { record = await read(dir); }
      catch (cause) {
        if (cause.code !== 'ENOENT') throw cause;
        name = 'record.tmp';
        try { record = await read(dir,name); }
        catch (error) {
          if (error.code === 'ENOENT') throw erroCustodia('FS12_STAGE_PENDENTE',error);
          throw error; // Truncated/invalid temp preserved, never treated as absence.
        }
      }
      const staged = contextoCustodia(record.contexto);
      const hints = Object.freeze({ stageId:id, respostaId:staged.respostaId, comandoId:staged.comandoId,
        tentativaId:staged.tentativaId, reservaId:staged.reservaId });
      const expected = await resolveOrigin(hints);
      const { contexto, corpo } = await verify(record, expected, id);
      try {
        await syncBoth(dir);
        const contextHash = hashContexto(contexto);
        const receipt = await importDurably({ id, contexto, corpo, envelope: record.envelope, contextHash });
        if (receipt?.durable !== true || receipt.id !== id || receipt.corpoHash !== contexto.corpoHash
          || receipt.contextHash !== contextHash || typeof receipt.custodiaId !== 'string' || !receipt.custodiaId.trim()) throw erroCustodia('FS12_IMPORTACAO_NAO_CONFIRMADA');
        // Other recoverers may already have removed this same immutable record.
        await io.unlink(path.join(dir, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        const directorySynced = await syncBoth(dir);
        // Directory deliberately remains: no overwrite/republication after consumption.
        // An empty directory is NOT evidence of a committed import.
        return { id, custodiaId: receipt.custodiaId, directorySynced: directorySynced === true };
      } finally { corpo.fill(0); }
    },
  };
}
