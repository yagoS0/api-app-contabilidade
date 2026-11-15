'use strict';
// Dados sintéticos de apresentação. Não reutilizar como política fiscal/autorização.
const alternative = new URLSearchParams(location.search).get('alternativa') === 'B' ? 'B' : 'A';
document.body.dataset.alternative = alternative;
document.querySelector('#alt' + alternative).setAttribute('aria-current', 'page');
const $ = s => document.querySelector(s);
const stages = {calcular:'A calcular',conferir:'A conferir',confirmadas:'Confirmadas',transmitidas:'Transmitidas'};
const companies = [
 {id:'aurora',name:'Aurora Serviços',stage:['calcular'],status:'Base preparada',origin:'Notas locais · 31/10 · revisão 3',reason:'Preparação manual disponível no cenário.',eligible:true},
 {id:'cedro',name:'Cedro Consultoria',stage:['calcular'],status:'Sem procuração',origin:'Cadastro · vigência encerrada',reason:'Procuração SERPRO encerrada em 30/09. Consulta oficial impedida.',issue:'procuracao'},
 {id:'ipe',name:'Ipê Tecnologia',stage:['calcular'],status:'Execução recusada',origin:'Cliente · recusa registrada em 03/11',reason:'A recusa impede execução; a obrigação fiscal continua.',issue:'recusa'},
 {id:'pausa',name:'Pausa Comércio',stage:['calcular'],status:'Empresa pausada',origin:'Operações · pausa em 02/11',reason:'Pausa da rotina não equivale a dispensa fiscal.',issue:'pausa'},
 {id:'horizonte',name:'Horizonte Engenharia',stage:['conferir'],status:'Folha incompleta',origin:'Cálculo salvo · revisão 7',reason:'FS12 não informada. Fator R não comprovado.',issue:'folha'},
 {id:'brisa',name:'Brisa Serviços',stage:['conferir'],status:'Sem movimento',origin:'Base local conferida · receita R$ 0,00',reason:'Conferir obrigações; zero não significa dispensa.',eligible:true},
 {id:'mare',name:'Maré Consultoria',stage:['conferir'],status:'A conferir',origin:'Cálculo salvo · revisão 4',reason:'Conferência humana da revisão ainda pendente.',eligible:true},
 {id:'lagoa',name:'Lagoa Comércio',stage:['confirmadas','transmitidas'],status:'Transmitida',origin:'Recibo oficial salvo · versão 2',reason:'Confirmação e transmissão comprovadas neste exemplo.'},
 {id:'serra',name:'Serra Serviços',stage:['confirmadas','transmitidas'],status:'Transmitida',origin:'Recibo oficial salvo · versão 1',reason:'Consulta posterior com resultado incerto; não repetir.',issue:'incerto'},
 {id:'orla',name:'Orla Design',stage:[],status:'Apuração externa',origin:'Declaração do contador · 04/11',reason:'Entrega informada sem recibo oficial. Não é transmissão comprovada.',issue:'externa'},
 {id:'ponte',name:'Ponte Participações',stage:[],regime:'Lucro Presumido',status:'Fora da automação PGDAS',origin:'Histórico de regime · outubro',reason:'Não aplicável ao PGDAS; conferir obrigações próprias.',issue:'presumido'},
 {id:'nova',name:'Nova Consultoria',stage:[],regime:'A verificar',status:'Regime não comprovado',origin:'Histórico incompleto',reason:'Falta vigência para outubro; não inferir Simples.',issue:'regime'}
];
const issues = {
 procuracao:['block','Bloqueio · procuração sem vigência','O cadastro informa fim em 30/09/2026.','Consulta oficial de outubro indisponível. Nenhuma chamada realizada.','Responsável fiscal','Verificar os poderes e cadastrar a vigência comprovada no cadastro da empresa.','Conferir procuração'],
 recusa:['block','Bloqueio · execução recusada pelo cliente','Recusa registrada para a empresa e o período.','Execução impedida, sem inferir dispensa da obrigação.','Responsável pela carteira','Rever a recusa com o cliente e registrar eventual autorização pelo fluxo próprio.','Ver registro da recusa'],
 pausa:['info','Aviso · empresa pausada','Pausa operacional registrada em 02/11.','Agenda não executa; a pendência fiscal continua visível.','Gestor de Operações','Conferir motivo e alcance da pausa. Retomada exige ação própria.','Conferir pausa'],
 folha:['block','Bloqueio · falta comprovar a folha','FS12 ausente no cálculo salvo. Não equivale a zero.','Fator R e resultado interno não estão disponíveis para esta revisão.','Responsável fiscal / DP','Completar a base comprovada, recalcular pelo fluxo autorizado e conferir a nova revisão.','Ver base de folha'],
 incerto:['block','Erro · resultado de consulta não confirmado','A conexão terminou sem resposta conclusiva. A causa remota é desconhecida.','Tentativa permanece incerta; o recibo anterior não prova o resultado desta tentativa.','Responsável fiscal / suporte','Conferir a tentativa e as evidências salvas. Não repetir automaticamente nem liberar a reserva.','Ver tentativa e evidências'],
 externa:['info','Aviso · entrega externa sem comprovação oficial','Declaração manual do contador registrada; recibo não anexado.','Não contar como transmitida, paga ou contabilizada.','Contador responsável','Reunir declaração, recibo e DAS do período; conferir identidade e revisão.','Ver evidências externas'],
 presumido:['info','Informação · Lucro Presumido','Histórico comprova Lucro Presumido em outubro.','Empresa fora da automação PGDAS; demais obrigações permanecem.','Responsável fiscal','Usar o fluxo fiscal próprio, sem converter o regime para incluí-la no lote.','Conferir regime e obrigações'],
 regime:['block','Bloqueio · regime não comprovado','Histórico sem cobertura da competência selecionada.','Elegibilidade desconhecida; não incluir na automação Simples.','Responsável pelo cadastro fiscal','Conferir documentação e cadastrar apenas a vigência comprovada.','Ver histórico de regime'],
 nota:['','Divergência · nota posterior à revisão','Nota N-104 foi capturada após a revisão salva, na mesma competência.','A base precisa de conferência. Não recalcular ou retificar automaticamente.','Responsável fiscal','Comparar a nota com a revisão e verificar se já foi considerada.','Comparar nota e revisão']
};
let stage = null, selected = new Set(), query = '', trigger = null, view = 'list', origin = 'manual', savedScroll = 0, savedFocus = null;
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count = key => companies.filter(c=>c.stage.includes(key)).length;
function progress(label,value,total,key){
 return '<button class="operacoes-progress" '+(key?'data-stage="'+key+'" aria-pressed="false"':'data-preserved="'+label+'"')+'><span class="operacoes-progress-label">'+label+'</span><strong>'+value+(key?'':'/'+total)+'</strong><span class="operacoes-track" aria-hidden="true"><span style="width:'+(value/total*100)+'%"></span></span></button>';
}
$('#indicators').innerHTML=Object.entries(stages).map(([k,l])=>progress(l,count(k),10,k)).join('');
$('#guide-indicators').innerHTML=[['Disponível',6,8],['Enviado',4,6],['Pago',2,8]].map(x=>progress(...x)).join('');
$('#accounting-indicators').innerHTML=[['Receitas',7,10],['Provisões',6,10],['Folha/Pró-labore',5,10],['Despesas',6,10],['Pagamentos',2,8]].map(x=>progress(...x)).join('');
$('#distributions').innerHTML=[['Parcelamento','Com parcelamento','Sem parcelamento',3,9],['Situação fiscal','Com pendência','Sem pendência',2,10],['Certificado','Sem certificado válido','Com certificado válido',2,10],['Procuração','Sem procuração vigente','Com procuração vigente',1,11]].map(([title,a,b,n,m])=>'<section class="distribution"><h3>'+title+'</h3><div class="distribution-body"><span class="ring" aria-hidden="true" style="background:conic-gradient(var(--state-neutral) 0 '+(n/(n+m)*100)+'%,var(--border) '+(n/(n+m)*100)+'%)"></span><dl><div><dt>'+a+'</dt><dd>'+n+'</dd></div><div><dt>'+b+'</dt><dd>'+m+'</dd></div></dl></div></section>').join('');
function setWork(title){
 $('#workspace').hidden=false;document.body.classList.add('working');$('#workspace-title').textContent=title;
 $('#workspace-title').focus({preventScroll:true});$('#workspace').scrollIntoView({block:'start'});
}
function source(){
 if(stages[stage])return companies.filter(c=>c.stage.includes(stage));
 if(stage==='externas')return companies.filter(c=>c.id==='orla');
 if(stage==='impedidas')return companies.filter(c=>['cedro','ipe','pausa','horizonte','nova'].includes(c.id));
 if(stage==='presumido')return companies.filter(c=>c.id==='ponte');
 return [];
}
function checkbox(c){return '<label class="check-label"><input type="checkbox" data-select="'+c.id+'" aria-label="Selecionar '+c.name+'" '+(selected.has(c.id)?'checked':'')+'></label>'}
function rowsMarkup(rows){
 return '<div class="table-scroll stage-table"><table><thead><tr><th class="selection-col">Seleção</th><th>Empresa / regime</th><th>Situação e origem</th><th>Pendência / próximo passo</th><th>Ação</th></tr></thead><tbody>'+rows.map(c=>'<tr><td class="selection-col">'+checkbox(c)+'</td><td class="company">'+c.name+'<small>'+ (c.regime||'Simples Nacional')+' · 10/2026</small></td><td>'+c.status+'<small>'+c.origin+'</small></td><td>'+c.reason+'</td><td><button class="btn" data-detail="'+c.id+'">Conferir</button></td></tr>').join('')+'</tbody></table></div><div class="mobile-rows">'+rows.map(c=>'<article class="mobile-row"><header>'+checkbox(c)+'<div class="company">'+c.name+'<small>'+(c.regime||'Simples Nacional')+' · 10/2026</small></div></header><p>'+c.status+'<small>'+c.origin+'</small></p><p>'+c.reason+'</p><div class="row-footer"><span class="state">'+(c.eligible?'Prévia disponível':'Conferir condições')+'</span><button class="btn" data-detail="'+c.id+'">Conferir</button></div></article>').join('')+'</div>';
}
function renderRows(){
 const rows=source().filter(c=>c.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
 $('#table-area').innerHTML=rowsMarkup(rows);
 $('#row-count').textContent=rows.length+' de '+source().length+' empresas';
 if(!rows.length)$('#table-area').innerHTML='<p role="status">Nenhuma empresa corresponde à busca. Limpe o filtro para voltar à lista.</p>';
 updateSelection();
}
function updateSelection(){
 const visible=source().filter(c=>c.name.toLowerCase().includes(query.toLowerCase()));
 $('#selection-count').textContent=selected.size+' selecionadas · '+[...selected].filter(id=>!visible.some(c=>c.id===id)).length+' fora da busca';
 $('#prepare').disabled=!selected.size;
}
function renderList(){
 view='list';$('#workspace-title').textContent=stages[stage]||({impedidas:'Impedidas / a revisar',externas:'Apuração externa',presumido:'Lucro Presumido · fora da automação PGDAS'}[stage]);
 $('#work-content').innerHTML='<div class="filters"><label>Buscar empresa<input id="search" type="search" value="'+esc(query)+'" placeholder="Nome da empresa"></label><button class="btn" id="all-visible">Selecionar visíveis</button><span id="row-count" class="small"></span></div><p class="inline-note">Empresa e competência preservadas. Seleção não concede autorização nem remove impedimentos.</p><div id="table-area"></div><div class="selection-bar"><span id="selection-count" aria-live="polite"></span><button class="btn" id="clear-selection">Limpar seleção</button><button class="btn primary" id="prepare">Preparar lote</button></div>'+(stage==='impedidas'?'<button class="text-button" data-open="presumido">Ver também 1 empresa de Lucro Presumido fora da automação PGDAS</button>':'');
 renderRows();
 $('#search').addEventListener('input',e=>{query=e.target.value;renderRows()});
 $('#all-visible').onclick=()=>{source().filter(c=>c.name.toLowerCase().includes(query.toLowerCase())).forEach(c=>selected.add(c.id));renderRows()};
 $('#clear-selection').onclick=()=>{selected.clear();renderRows()};
 $('#prepare').onclick=()=>{savedScroll=scrollY;savedFocus='prepare';renderBatch()};
}
function issueMarkup(key){
 const [type,title,cause,impact,owner,next,action]=issues[key];
 return '<section class="issue '+type+'"><h3>'+title+'</h3><dl><dt>Situação encontrada</dt><dd>'+cause+'</dd><dt>Impacto</dt><dd>'+impact+'</dd><dt>Responsável</dt><dd>'+owner+'</dd><dt>Próximo passo</dt><dd>'+next+'</dd></dl><button class="btn" data-guidance="'+key+'">'+action+'</button></section>';
}
function backList(){
 renderList();requestAnimationFrame(()=>{const el=savedFocus==='prepare'?$('#prepare'):document.querySelector('[data-detail="'+savedFocus+'"]');
 const visible=el&&el.getClientRects().length?el:[...document.querySelectorAll('[data-detail="'+savedFocus+'"]')].find(x=>x.getClientRects().length);
 visible?.focus({preventScroll:true});window.scrollTo(0,savedScroll);});
}
function detail(c){
 savedScroll=scrollY;savedFocus=c.id;view='detail';setWork('Conferência · '+c.name);
 const full=c.id==='horizonte';
 $('#work-content').innerHTML='<div class="back-row"><button class="btn" id="back-list">← Voltar à lista</button><span class="small">Etapa, busca e seleção preservadas</span></div><div class="detail-header"><div><h3>'+c.name+'</h3><small>'+(c.regime||'Simples Nacional')+' · Outubro de 2026 · '+c.origin+'</small></div><span class="badge">'+c.status+'</span></div>'+(c.issue?issueMarkup(c.issue):'<p class="inline-note">'+c.reason+'</p>')+
 (full?'<nav class="detail-nav" aria-label="Seções da conferência"><a href="#f1-notas">Notas e classificação</a><a href="#f1-folha">Fator R e folha</a><a href="#f1-oficial">Evidências oficiais</a><a href="#f1-historico">Histórico</a></nav><section class="section-line"><h3>Base e resultado da revisão</h3><div class="facts"><div>Receita do período<strong>R$ 20.000,00</strong><small>Notas locais · competência</small></div><div>RBT12<strong>R$ 240.000,00</strong><small>12 meses · base do exemplo</small></div><div>Folha / FS12<strong>Não informada</strong><small>Não presumir zero</small></div><div>DAS interno<strong>Indisponível</strong><small>Fator R não comprovado</small></div><div>Retorno oficial<strong>Não consultado</strong><small>Nenhuma chamada neste fluxo</small></div></div></section><section id="f1-notas" class="section-line"><div class="detail-header"><h3>Notas e classificação</h3><button class="btn" data-guidance="folha">Ver pendência de classificação</button></div><p class="scroll-hint">Deslize a tabela para ver todas as colunas.</p><div class="table-scroll" tabindex="0" aria-label="Notas da revisão"><table class="detail-table"><thead><tr><th>Nota / fonte</th><th>Atividade / classificação</th><th class="money">Receita</th><th>Situação</th></tr></thead><tbody><tr><td>N-101 · local</td><td>Serviço de engenharia · anexo a conferir</td><td class="money">R$ 12.000,00</td><td>Fator R pendente</td></tr><tr><td>N-102 · local</td><td>Serviço de engenharia · anexo a conferir</td><td class="money">R$ 8.000,00</td><td>Fator R pendente</td></tr></tbody></table></div><p class="inline-note">Duas notas compõem R$ 20.000,00. Nenhuma regra tributária é derivada neste protótipo.</p></section><section id="f1-folha" class="section-line split"><div><h3>Fator R e folha</h3><p>Fator R indisponível: falta comprovar a FS12.</p><p>O cadastro atual não substitui a base histórica. Solicitar os documentos ao responsável por DP antes de nova conferência.</p></div><div><h3>Comparação de resultados</h3><p>Sem base comparável. Resultado interno indisponível e retorno oficial não consultado.</p><p class="inline-note">Sem diferença calculada ou alíquota presumida.</p></div></section><section id="f1-oficial" class="section-line"><h3>Declaração, recibo e DAS</h3><ul class="list-lines"><li><span>Declaração oficial</span><span>Não consultada</span></li><li><span>Recibo de transmissão</span><span>Não comprovado</span></li><li><span>DAS / revisão documental</span><span>Não disponível nesta revisão</span></li></ul><p class="inline-note">Consulta oficial exige comando, autorização e avaliação de custo próprios. Abrir a conferência não consulta o SERPRO.</p></section><section id="f1-historico" class="section-line"><h3>Histórico da revisão</h3><ul class="list-lines"><li><span>31/10 · notas locais reunidas</span><span>Revisão 6</span></li><li><span>03/11 · base de receita revisada</span><span>Revisão 7</span></li><li><span>Aprovação humana da revisão 7</span><span>Pendente</span></li></ul></section><div class="selection-bar"><span>Confirmação indisponível: falta comprovar a folha.</span><button class="btn" disabled>Confirmar revisão</button></div>':
 '<section class="section-line"><h3>Evidências da empresa e competência</h3><ul class="list-lines"><li><span>Origem</span><span>'+c.origin+'</span></li><li><span>Resultado</span><span>'+c.status+'</span></li><li><span>Revisão e documentos</span><span>'+(['lagoa','serra'].includes(c.id)?'Recibo salvo no exemplo':'A conferir no fluxo existente')+'</span></li></ul><p>'+c.reason+'</p><p class="inline-note">Detalhe específico de navegação. A conferência completa de valores está demonstrada em Horizonte Engenharia, em A conferir.</p></section>')+'<div class="back-row"><button class="btn" id="back-end">Voltar à lista com a seleção</button></div><p id="guidance" role="status"></p>';
 $('#back-list').onclick=backList;$('#back-end').onclick=backList;
}
function renderBatch(result=false){
 view='batch';setWork(result?'Resultado ilustrativo por empresa':'Preparar lote · '+selected.size+' selecionadas');
 const rows=companies.filter(c=>selected.has(c.id)),valid=rows.filter(c=>c.eligible),blocked=rows.filter(c=>!c.eligible);
 $('#work-content').innerHTML='<div class="back-row"><button class="btn" id="back-list">← Voltar à seleção</button></div><p><strong>'+rows.length+' selecionadas · '+valid.length+' elegíveis no cenário · '+blocked.length+' impedidas / a conferir</strong></p><p class="inline-note">Elegibilidade ilustrativa para preparar a revisão. O servidor terá de revalidar empresa, competência, revisão e permissão. Nenhuma empresa fora da seleção será incluída.</p><div class="tabs" aria-label="Origem da preparação"><button data-origin="manual" aria-pressed="'+(origin==='manual')+'">Execução manual</button><button data-origin="automatica" aria-pressed="'+(origin==='automatica')+'">Rotina automática</button></div><p>'+(origin==='manual'?'Iniciada pelo contador. Não ignora recusa, pausa, ausência de dados ou reserva incerta.':'Iniciada pela agenda autorizada. Mesmas capacidades e guardas; desligamento geral e da empresa prevalecem.')+'</p><section class="issue info"><h3>Sem transmissão nesta preparação</h3><p>Preparar revisão, simular no SERPRO e transmitir são operações distintas. Configuração salva não ativa a rotina.</p></section><p class="scroll-hint">Deslize a tabela para ver todas as colunas.</p><div class="table-scroll" tabindex="0" aria-label="Resultado individual da preparação"><table><thead><tr><th>Empresa</th><th>'+ (result?'Resultado ilustrativo':'Prévia')+'</th><th>Motivo / ação segura</th></tr></thead><tbody>'+rows.map(c=>'<tr><td>'+c.name+'</td><td>'+ (c.eligible?(result?'Preparação concluída · exemplo':'Elegível para prévia'):'Não executar')+'</td><td>'+c.reason+'</td></tr>').join('')+'</tbody></table></div><div class="selection-bar"><span>'+(result?'Nenhuma execução ocorreu. Exemplo de retorno, não sucesso real.':'Impedidas permanecem na lista e não são liberadas por seleção.')+'</span>'+(!result?'<button id="show-result" class="btn primary">Ver exemplo de resultado</button>':'')+'</div>';
 $('#back-list').onclick=backList;document.querySelectorAll('[data-origin]').forEach(b=>b.onclick=()=>{origin=b.dataset.origin;renderBatch(result)});
 if(!result)$('#show-result').onclick=()=>renderBatch(true);
}
function routines(){
 view='routine';setWork('Rotinas · capacidades e origens');
 $('#work-content').innerHTML='<p>Mesmas condições por empresa e competência, com origem manual ou programada.</p><p class="scroll-hint">Deslize a tabela para ver todas as colunas.</p><div class="table-scroll" tabindex="0" aria-label="Capacidades das rotinas"><table class="routine-table"><thead><tr><th>Capacidade</th><th>Manual</th><th>Automática</th><th>Condição</th></tr></thead><tbody><tr><td>Preparar base local</td><td>Prévia da seleção</td><td>Agenda autorizada</td><td>Regime, dados, pausa e recusa verificados</td></tr><tr><td>Simular no SERPRO</td><td>Confirmação própria</td><td>Política específica pendente</td><td>Procuração, custo e reserva</td></tr><tr><td>Conferir revisão</td><td>Responsável fiscal</td><td>Não substitui conferência humana</td><td>Revisão vigente e evidências</td></tr><tr><td>Transmitir</td><td>Não habilitado nesta proposta</td><td>Não habilitado nesta proposta</td><td>Autorização e entrega próprias</td></tr></tbody></table></div><section class="section-line"><h3>Agenda e alcance</h3><ul class="list-lines"><li><span>Configuração salva</span><span>Não ativa produção</span></li><li><span>Desligamento geral / empresa</span><span>Prevalece sobre a agenda</span></li><li><span>Empresas pausadas ou que recusaram</span><span>Não executar</span></li><li><span>Tentativa incerta</span><span>Não repetir automaticamente</span></li></ul></section>'+issueMarkup('incerto')+'<div class="selection-bar"><span>Exemplo de preparação manual com empresas a calcular.</span><button class="btn primary" data-open="calcular">Selecionar empresas</button></div><p id="guidance" role="status"></p>';
}
function warnings(){
 view='warning';setWork('Notas posteriores · todas as competências');
 $('#work-content').innerHTML='<p>2 ocorrências no escopo do operador. Este aviso não usa o filtro mensal do resumo.</p><div class="table-scroll"><table><thead><tr><th>Empresa / competência</th><th>Ocorrência</th><th>Próximo passo</th></tr></thead><tbody><tr><td>Horizonte Engenharia · 10/2026</td><td>N-104 · nota posterior à revisão</td><td>Comparar com a revisão salva</td></tr><tr><td>Serra Serviços · 09/2026</td><td>N-090 · cancelamento posterior</td><td>Revisar o período correto; não alterar outubro</td></tr></tbody></table></div>'+issueMarkup('nota')+'<p id="guidance" role="status"></p>';
}
function openStage(key,button){
 trigger=button;stage=key;selected=new Set();query='';origin='manual';
 document.querySelectorAll('[data-stage]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.stage===key)));
 if(key==='rotinas')return routines();if(key==='avisos')return warnings();
 setWork(stages[key]||'Empresas');renderList();
}
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.stage||b.dataset.open)return openStage(b.dataset.stage||b.dataset.open,b);
 if(b.dataset.detail)return detail(companies.find(c=>c.id===b.dataset.detail));
 if(b.dataset.preserved){$('#notice').textContent='Fluxo existente de '+b.dataset.preserved+' preservado. Esta F1 altera somente a proposta de Apuração.';$('#notice').scrollIntoView({block:'nearest'});}
 if(b.dataset.guidance){$('#guidance').textContent=issues[b.dataset.guidance][5]+' Caminho proposto: cadastro ou evidência da empresa, com retorno à competência. Este protótipo não abre nem altera cadastro real.';$('#guidance').scrollIntoView({block:'nearest'});}
});
document.addEventListener('change',e=>{if(e.target.dataset.select){const id=e.target.dataset.select;e.target.checked?selected.add(id):selected.delete(id);document.querySelectorAll('[data-select="'+id+'"]').forEach(x=>x.checked=selected.has(id));updateSelection();}});
$('#close-work').onclick=()=>{const old=trigger;$('#workspace').hidden=true;document.body.classList.remove('working');document.querySelectorAll('[data-stage]').forEach(b=>b.setAttribute('aria-pressed','false'));old?.focus({preventScroll:true});old?.scrollIntoView({block:'center'});};
// Nenhum fetch, armazenamento, transporte ou chamada de negócio.
