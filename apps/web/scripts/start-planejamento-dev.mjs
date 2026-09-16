import { createServer, build } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
process.env.VITE_API_MODE='mock';
// O node_modules pode ser junction de outro checkout. Resolver o shared local sem tocar na junction.
const shared=new URL('../../../packages/shared/',import.meta.url);
const pkg=JSON.parse(await readFile(new URL('package.json',shared),'utf8'));
const alias=Object.entries(pkg.exports).map(([key,target])=>({find:key==='.'?'@contabilidade/shared':`@contabilidade/shared/${key.slice(2)}`,replacement:fileURLToPath(new URL(target,shared))})).sort((a,b)=>b.find.length-a.find.length);
// Opcional para worktree com dependências externas: somente a ferramenta de validação usa este caminho.
if(process.env.DEV_FAKER_PATH) alias.push({find:'@faker-js/faker',replacement:process.env.DEV_FAKER_PATH});
const config={configFile:false,root,plugins:[react()],resolve:{alias},cacheDir:fileURLToPath(new URL('../../../../.cache-planejamento-vite/',import.meta.url)),server:{host:'127.0.0.1',port:5186,strictPort:true}};
if(process.argv.includes('--build')) {
  await build({...config,build:{outDir:fileURLToPath(new URL('../../../../planejamento-build-check/',import.meta.url)),emptyOutDir:false}});
} else {
  const server=await createServer(config);
  await server.listen();
  server.printUrls();
}
