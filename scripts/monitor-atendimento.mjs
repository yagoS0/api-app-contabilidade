import { pathToFileURL } from 'node:url';

export const alvos = [
  { nome: 'API e banco', url: 'https://api-app-contabilidade-production.up.railway.app/readyz', json: true },
  { nome: 'Portal do contador', url: 'https://app.altan.company/comercial/conversas', html: true },
];

export async function verificarAtendimento({ fetchImpl = fetch, esperar = ms => new Promise(resolve => setTimeout(resolve, ms)), tentativas = 3 } = {}) {
  return Promise.all(alvos.map(async alvo => {
    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
      try {
        const r = await fetchImpl(alvo.url, { signal: AbortSignal.timeout(15000), cache: 'no-store', redirect: 'error' });
        if (!r.ok) throw new Error('HTTP');
        if (alvo.json) {
          const body = await r.json();
          if (body.ok !== true) throw new Error('READY');
        }
        if (alvo.html && !(await r.text()).includes('id="root"')) throw new Error('PORTAL');
        return { nome: alvo.nome, ok: true };
      } catch {
        if (tentativa < tentativas) await esperar(5000);
      }
    }
    return { nome: alvo.nome, ok: false };
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const resultados = await verificarAtendimento();
  for (const r of resultados) console.log(`${r.ok ? 'OK' : 'FALHA'}: ${r.nome}`);
  if (resultados.some(r => !r.ok)) process.exitCode = 1;
}
