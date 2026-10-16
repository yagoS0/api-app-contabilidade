import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const governanceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const start = '<!-- ALTAN-PRINCIPAL-ORCHESTRATOR:START -->';
const end = '<!-- ALTAN-PRINCIPAL-ORCHESTRATOR:END -->';
export function block(runtimeRoot) {
  const runner = runtimeRoot === '.' ? 'scripts/governance/orchestrate.mjs' : resolve(runtimeRoot,'scripts/governance/orchestrate.mjs').replaceAll('\\','/');
  return `${start}
## Orquestrador Principal — fluxo permanente autorizado

O usuário conversa exclusivamente com o agente principal. Para pedidos de desenvolvimento
do ALTAN, o agente principal assume automaticamente a função de Orquestrador Principal;
não pede ao usuário para selecionar especialistas, caminhos, testes ou coordenar etapas.
Esta instrução autoriza acionar subagentes para executar e julgar o trabalho.

Antes de alterações funcionais, o principal lê a referência operacional e inicia o
controlador executável: node "${runner}" --root "<checkout de trabalho>" --request-file "<arquivo com o pedido>".
O próprio principal prepara o arquivo do pedido e escolhe uma árvore de trabalho
adequada, preservando alterações existentes. Não é tarefa do usuário executar comandos.
Se o checkout já contém scripts/governance/orchestrate.mjs, prefira esse runtime local
versionado; o caminho canônico acima serve de fallback para árvores ainda não integradas.
O controlador descobre escopo, aciona executores/revisores, executa os gates e retorna
reprovações ao executor. Somente o principal explica resultados e decisões ao usuário.
O principal acompanha o processo/logs, responde dúvidas e trata falhas ou limites.

Esta inicialização aplica-se SOMENTE ao agente principal que recebe a solicitação.
Se você é subprocesso/delegado/revisor do controlador ou recebeu uma tarefa delimitada,
execute somente seu papel: não relance o controlador, não delegue e não peça ao usuário
que coordene etapas. Alterações da própria governança exigem fluxo separado com revisão
independente pelo principal; o executor não pode mudar os gates para aprovar a si mesmo.

ready_for_human significa validado tecnicamente na versão indicada; não autoriza merge,
deploy, dados reais, mensagens ou atos fiscais. Preserve autorizações já concedidas
para o escopo concreto. Em falha, não simule aprovação nem contorne permissões.
Instruções operacionais e decisões atuais do usuário continuam prevalecendo.
${end}`;
}

export function installBlock(file, runtimeRoot, backupRoot) {
  const before = existsSync(file) ? readFileSync(file,'utf8') : '';
  const first = before.indexOf(start), last = before.indexOf(end);
  if ((first < 0) !== (last < 0) || (first >= 0 && last < first)) throw Error(`Malformed managed block: ${file}`);
  const managed = block(resolve(dirname(file)) === resolve(runtimeRoot) ? '.' : runtimeRoot);
  const after = first >= 0 ? before.slice(0,first) + managed + before.slice(last+end.length) : before.replace(/\s*$/,'') + '\n\n' + managed + '\n';
  if (after === before) return {file,changed:false};
  const digest = createHash('sha256').update(before).digest('hex');
  mkdirSync(backupRoot,{recursive:true});
  const backup = resolve(backupRoot,createHash('sha256').update(file).digest('hex').slice(0,16)+'-'+digest+'.txt');
  if (!existsSync(backup)) writeFileSync(backup,before,'utf8');
  if ((existsSync(file) ? readFileSync(file,'utf8') : '') !== before) throw Error(`Concurrent edit: ${file}`);
  writeFileSync(file,after,'utf8');
  return {file,changed:true,backup,beforeSha256:digest,afterSha256:createHash('sha256').update(after).digest('hex')};
}

function main() {
  const args=process.argv.slice(2);
  if (args.length !== 2 || !['--inspect','--install'].includes(args[0])) throw Error('Usage: bootstrap.mjs --inspect|--install ALTAN_WORKSPACE');
  const workspace=realpathSync(args[1]);
  const listed=execFileSync('git',['worktree','list','--porcelain','-z'],{cwd:governanceRoot,encoding:'utf8'}).split('\0').filter(s=>s.startsWith('worktree ')).map(s=>s.slice(9));
  const targets=[...new Set([workspace,...listed.filter(p=>existsSync(p)).map(p=>realpathSync(p))])].map(p=>resolve(p,'AGENTS.md'));
  if(args[0]==='--inspect') { console.log(JSON.stringify({runtime:governanceRoot,targets},null,2)); return; }
  const backupRoot=resolve(governanceRoot,'.altan-governance/bootstrap-backups');
  const results=targets.map(file=>installBlock(file,governanceRoot,backupRoot));
  const excludePath=execFileSync('git',['rev-parse','--git-path','info/exclude'],{cwd:governanceRoot,encoding:'utf8'}).trim();
  const excludeFile=resolve(governanceRoot,excludePath);
  const excludeBefore=existsSync(excludeFile)?readFileSync(excludeFile,'utf8'):'';
  if(!excludeBefore.split(/\r?\n/).includes('.altan-governance/')) {
    writeFileSync(resolve(backupRoot,'git-info-exclude-before.txt'),excludeBefore);
    writeFileSync(excludeFile,excludeBefore+'\n# Local Altan orchestration journals\n.altan-governance/\n');
  }
  const manifest=resolve(backupRoot,'latest-install.json');
  writeFileSync(manifest,JSON.stringify({at:new Date().toISOString(),runtime:governanceRoot,results},null,2)+'\n');
  console.log(JSON.stringify({manifest,installed:results.filter(r=>r.changed).length,unchanged:results.filter(r=>!r.changed).length},null,2));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();
