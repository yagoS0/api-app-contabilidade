// Child for process-restart tests only. No production configuration or key files.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { criarCifraFs12 } from '../../src/modules/fiscal/infrastructure/custody/cifraRespostaFs12.js';
import { criarStageRespostaFs12 } from '../../src/modules/fiscal/infrastructure/custody/stageRespostaFs12.js';
import { corpo, contexto, resolverOrigemPersistida, receipt, syncProcessOnly } from './fixture.mjs';
let httpCalls = 0;
const forbidden = () => { httpCalls++; throw new Error('HTTP_FORBIDDEN_IN_FIXTURE'); };
http.request = http.get = https.request = https.get = globalThis.fetch = forbidden;
const send = data => new Promise(resolve=>process.send(data, resolve));
let release;
const barrier = new Promise(resolve=>{ release=resolve; });
process.on('message', message => {
  if (message.type === 'go') release();
  if (message.type === 'start') run(message).catch(async error => {
    await send({ type:'failure', code:error.code || error.message, httpCalls });
    process.exitCode = 1; process.disconnect();
  });
});
async function run({ role, root, sink, originFile, id, keyBase64, pause }) {
  const key = Buffer.from(keyBase64, 'base64');
  const cifra = criarCifraFs12({ resolveKey:async keyId=>keyId==='historical' ? key : null });
  const io = role === 'writeTemp' ? { ...fs, rename:async()=>{
    await send({ type:'tempFlushed', httpCalls });
    process.exit(24); // File fsync completed; publication rename has not happened.
  } } : fs;
  const adapter = criarStageRespostaFs12({ root, cifra, io, syncDirectory:syncProcessOnly });
  if (role === 'write' || role === 'writeTemp') {
    const output = await adapter.guardar({ corpo, contexto:contexto(), keyId:'historical' });
    await send({ type:'result', ...output, httpCalls });
    key.fill(0); process.disconnect(); return;
  }
  const output = await adapter.recuperar({
    id, resolveOrigin:resolverOrigemPersistida(originFile),
    importDurably:async input => {
      assert.deepEqual(input.corpo, corpo);
      if (pause) { await send({ type:'ready', pid:process.pid }); await barrier; }
      // Synthetic durable idempotent sink, NOT Prisma/PostgreSQL nor T3a proof.
      const bytes = Buffer.from(JSON.stringify({ id:input.id, contextHash:input.contextHash,
        contexto:input.contexto, envelope:input.envelope }));
      const temp = path.join(sink, randomUUID()+'.tmp');
      const h = await fs.open(temp, 'wx', 0o600);
      try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
      const final = path.join(sink, input.id+'.json');
      try { await fs.link(temp, final); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      finally { await fs.unlink(temp); }
      assert.deepEqual(await fs.readFile(final), bytes, 'same ID must resolve to identical custody');
      if (role === 'commitExit') {
        await send({ type:'committedBeforeExit', httpCalls });
        process.exit(23); // Deliberately stop before receipt/removal.
      }
      return receipt(input);
    },
  });
  await send({ type:'result', ...output, httpCalls, pid:process.pid });
  key.fill(0); process.disconnect();
}
