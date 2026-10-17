import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.DESIGN_BASE_URL||'http://127.0.0.1:5197';
assert.equal(new URL(base).hostname,'127.0.0.1');
const dir=fileURLToPath(new URL('../../../test-evidence/calendario-unificado/',import.meta.url));
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});
const results=[],errors=[]; let page;
try {
 page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultTimeout(45000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const capture = async (name) => {
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000});
   const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,controlsOutside:[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left< -1||r.right>innerWidth+1);}).map(el=>el.outerHTML.slice(0,120))}));
   await page.screenshot({path:`${dir}/${name}-${width}.png`,fullPage:true});
   results.push({name,width,...metrics});console.log(JSON.stringify(results.at(-1)));
  }
  await page.setViewportSize({width:1440,height:1000});
 }
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.getByLabel('E-mail ou usuário').fill('design@example.test');
 await page.getByLabel('Senha',{exact:true}).fill('somente-mock');
 await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await page.waitForURL('**/companies');
 await page.getByRole('button',{name:'+ Nova tarefa',exact:true}).waitFor();
 await capture('mes-inicial');
 await page.getByRole('button',{name:'+ Nova tarefa',exact:true}).click();
 await page.getByLabel('Título',{exact:true}).fill('Apuração lucro presumido QA');
 await page.getByLabel('Descrição',{exact:true}).fill('Apurar todas as empresas do lucro presumido.');
 await capture('modal-compacto');
 await page.getByRole('button',{name:'Data e repetição',exact:true}).click();
 await page.locator('.tce-month-nav select').selectOption('10');
 await page.locator('.tce-month-nav input').fill('2026');
 await page.locator('[data-dia="2026-10-15"]').click();
 assert.equal(await page.locator('.tce-days button[aria-pressed=true]').count(),1);
 await page.locator('[data-dia="2026-10-18"]').click();
 assert.equal(await page.locator('.tce-days button[aria-pressed=true]').count(),4);
 assert.equal(await page.getByRole('dialog').count(),1);
 await page.getByRole('combobox',{name:/^Horário/}).selectOption('ATE');
 await page.getByLabel('Hora',{exact:true}).fill('18:00');
 await page.getByRole('combobox',{name:/^Repetição/}).selectOption('MENSAL');
 await page.getByRole('combobox',{name:/^Vencimento mensal/}).selectOption('31');
 await capture('data-intervalo-mensal31');
 await page.getByRole('button',{name:/^Empresas \d/}).click();
 const regimes=await page.getByRole('combobox',{name:/^Regime tributário/}).locator('option').evaluateAll(options=>options.map(o=>({value:o.value,label:o.textContent})));
 const presumido=regimes.find(o=>/presumido/i.test(o.label));assert.ok(presumido,'regime lucro presumido disponível');
 await page.getByRole('combobox',{name:/^Regime tributário/}).selectOption(presumido.value);
 await page.getByRole('button',{name:/^Todas do filtro/}).click();
 await capture('empresas-filtradas');
 await page.getByRole('button',{name:/^Subtarefas \d/}).click();
 await page.getByRole('button',{name:'+ Adicionar subtarefa',exact:true}).click();
 await page.getByLabel('Subtarefa 1',{exact:true}).fill('MIT');
 await page.getByRole('button',{name:'+ Adicionar subtarefa',exact:true}).click();
 await page.getByLabel('Subtarefa 2',{exact:true}).fill('EFD contribuição');
 await capture('subtarefas');
 await page.getByRole('button',{name:'Criar tarefa',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Apuração lucro presumido QA',exact:true}).first().waitFor();
 await capture('mes-com-tarefa');
 await page.getByRole('button',{name:'Apuração lucro presumido QA',exact:true}).first().click();
 const company=page.locator('.agenda-task-company').first();
 await company.getByRole('checkbox',{name:'MIT',exact:true}).check();
 await company.getByRole('checkbox',{name:'EFD contribuição',exact:true}).check();
 await page.waitForFunction(()=>document.querySelector('.agenda-task-company.is-complete'));
 await capture('painel-empresa-concluida');
 await page.getByRole('button',{name:'Editar tarefa',exact:true}).click();
 await page.getByRole('dialog',{name:'Editar tarefa',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Título',{exact:true}).inputValue(),'Apuração lucro presumido QA');
 await capture('editar-mesmo-modal');
 await page.getByRole('button',{name:'Fechar',exact:true}).click();
 for(let n=0;n<4;n++)await page.getByRole('button',{name:'Próximo período',exact:true}).click();
 await page.getByRole('button',{name:'Apuração lucro presumido QA',exact:true}).first().waitFor();
 await capture('fevereiro31-ajustado');
 const dueCards=page.locator('.agenda-event.is-urgent');
 assert.ok(await dueCards.count()>=2,'véspera e vencimento presentes');
 await dueCards.last().getByRole('button').click();
 assert.match(await page.locator('.agenda-task-deadline').textContent(),/28\/02\/2027/);
 await capture('fevereiro-vencimento28');
 await page.getByRole('button',{name:'Fechar',exact:true}).click();
 for(const [view,name] of [['semana','semana'],['dia','dia'],['lista','lista']]) {
  await page.locator('.agenda-toolbar-actions select').selectOption(view);
  await capture(name);
 }
 await writeFile(`${dir}/results.json`,JSON.stringify({results,errors},null,2));
 assert.deepEqual(errors,[]);
 assert.ok(results.every(r=>!r.overflow&&!r.controlsOutside.length),'Confira capturas e results.json');
} catch(e) { if(page) { await page.screenshot({path:`${dir}/failure.png`,fullPage:true}); await writeFile(`${dir}/failure.html`,await page.content()); } await writeFile(`${dir}/results.json`,JSON.stringify({results,errors,failure:e.message},null,2));throw e;}
finally {await browser.close();}


