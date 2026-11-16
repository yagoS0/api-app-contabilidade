# PGDAS-2026-A — FS12 declaratória e regime por competência

Caracterização em 16/11/2026. Base remota confirmada: `5192996343f3f1b8a64197df8d7ab2c17009399b` (PR289). Branch `codex/pgdas-2026-a-20261116`, worktree `ALTAN/worktrees/pgdas-2026-a-20261116`. Somente documentação/testes: nenhuma regra produtiva corrigida, nenhuma consulta fiscal executada. Este documento prepara B, não o autoriza.

## 1. Fontes e limites de verificação

| Fonte oficial consultada | Evidência e limite |
|---|---|
| [Notícia RFB, 13/11/2026](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/novembro/pgdas-d-e-atualizado-para-atender-a-reforma-tributaria-a-partir-de-novembro-de-2026) | Anuncia folha para todas as atividades nos PAs 11/12, competência em 2027 e utilização dos dados para alíquotas IBS/CBS. Não fornece novo algoritmo de cálculo. |
| [Manual PGDAS-D/DEFIS](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf), versão de 13/11/2026 | Download direto, 138 páginas, SHA256 `1786a9badcd6676567b8a2ce27c6f11466b3abaf1ea1330a27eef31ec013119f`. Capa limita 2018–2026 e anuncia novo manual 2027. §§8.2/8.2.2, páginas 74/77, limitam a adaptação a 11/12/2026. §8.2.1, página 75: janela anterior; mês de abertura usa folha/receita do PA, meses seguintes desde abertura até anterior. §5, página 14: competência obrigatória em 2027 não modifica opção de 2026. §8.3 contém aparente inconsistência editorial de datas 2025/2026; não fundamenta regra nova. |
| [Entrada TRANSDECLARACAO11](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/entregar_declaracao_mensal_entrada/) | v1.0; folhasSalario array de objetos com pa Number AAAAMM e valor Number; obrigatório pa>=202611. Simular/transmitir usam indicadorTransmissao. Não documenta aqui cardinalidade mínima, escala monetária ou aceite de []. |
| [Changelog PGDAS-D](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/changelog/) | Alteração obrigatória após10/2026, rodapé 03/11/2026. Cabeçalho ainda1.0.0/2022; não inventar versão2027. |
| [Mensagens SERPRO](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/mensagens/) | MSG071 exige folha desde11/2026; MSG029 descreve meses faltantes e aproveitamento já declarado; MSG045 ainda descreve rejeição sem atividade exigente; MSG047 período desnecessário; MSG030 alerta efeitos de alteração em períodos posteriores. MSG011/013/037 tratam incompatibilidade/opção/receitas de caixa. Convivência das mensagens não comprova que a exceção antiga prevalece sobre071. |
| [Opção anual](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/regime/servicos/efetuar_opcao/) e [consulta anual](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/regime/servicos/consultar_opcao/) | REGIMEAPURACAO/EFETUAROPCAOREGIME101 e CONSULTAROPCAOREGIME103, ano explícito; documentação rodapé 10/04/2026. Não prova manutenção da opção para2027 nem autoriza acioná-la. |

A busca retornou inicialmente PDF em cache de2025; o arquivo direto atualizado foi extraído e a página77 inspecionada visualmente. PDF público e imagens de conferência ficaram somente em artefatos locais ignorados, não PDFs de clientes. Não há homologação trial/produção nem payload realmente aceito pelo SERPRO nesta entrega. As categorias abaixo distinguem documentação, comportamento local e desconhecido.

## 2. Confronto e matriz por PA

| PA | Exigência declaratória documentada | Janela de12 meses usada hoje na Altan (empresa estabelecida) | Regime | Resultado atual / lacuna |
|---|---|---|---|---|
|10/2026|Legado condicionado à atividade Fator R|10/2025–09/2026|Preservar opção histórica|Filtro por Fator R e omissão de lista vazia, sem mudança autorizada.|
|11/2026|Todas as atividades|11/2025–10/2026|Não converter opção2026|Mesmo filtro antigo; folha informada pode ser descartada.|
|12/2026|Todas as atividades|12/2025–11/2026|Não converter opção2026|Mesma incompatibilidade.|
|01/2027|Entrada SERPRO diz>=202611; detalhamento fiscal2027 ainda pendente do novo manual|01/2026–12/2026 é comportamento local, não homologação2027|Competência obrigatória documentada|Sem corte temporal no builder; fechamento já bloqueia CAIXA em todos PAs.|

Para11/12, a janela anterior é a definição do manual atual. Não deslocar FS12 por analogia com mudanças em receitas/IBS/CBS. Para2027, separar obrigação anunciada de competência da homologação da janela, início de atividade, protocolo e retorno. Não usar esta tabela como liberação de emissãoNFS-e2027.

### Cenários cruzados

Cada linha deve ser verificada nos quatro PAs acima; a exigência temporal vem da tabela, não do flag FatorR.

| Situação | Comportamento observado | Condição para B |
|---|---|---|
|Atividade sujeita ao Fator R, folha completa|Série é selecionada; períodos aceitos podem podá-la|Separar série evidenciada da parcela enviada; preservar cálculoIII/V.|
|Não sujeita ao Fator R|Fechamento descarta série; grade escondida|11/12 precisam capacidade declaratória independente;10 não muda incidentalmente.|
|Receita zero|Exige intenção sem movimento e ausência de faturamento; com lista de atividades vazia descarta folha|Sem receita não comprova folha zero nem dispensa de informar; manter trava anti-zero.|
|Folha zero comprovada|Number0 serializa0; resolvedor atual prioriza0|Prova/empresa/mês precisam ser conhecidas; UI vazia não é prova.|
|Folha ausente|Builder omite []; modal pode gerar12 zeros|Apresentar pendência, nunca preencher automaticamente.|
|Dados incompletos|Série parcial passa pelo builder; conferência contábil informa disponibilidade parcial|Distinguir cobertura, ausência, zero e meses já declarados; aceite remoto de parcial depende do histórico.|
|Início de atividade|Helper/UI sempre12 anteriores; builder não recebe abertura|Exigir revisão fiscal do conjunto admissível; não fabricar meses anteriores à abertura nem distribuir agregado.|
|FS12 anterior disponível|Resolvedor retorna sugestão e motor local pode consumi-la|Não promover agregado anterior a evidência atual; preservar histórico, revisão explícita.|
|Resultado incerto / cálculo confirmado|Guardas e vínculo impedem substituição livre|Não reabrir, retificar, retransmitir ou completar série automaticamente.|

## 3. Mapa de produtores, consumidores e efeitos

Caminhos abaixo são relativos à raiz; funções e nomes permitem localizar a responsabilidade. Nenhum é movido nesta entrega.

| Arquivo / operação | Origem → consumidores / efeitos |
|---|---|
|apps/web/src/features/apuracao/components/FechamentoModal.jsx, pasAnteriores/load/handleCalcular|Grade12 anteriores; memória porpa; célula ausente vira Number(folha[pa]&#124;&#124;0). Grade somente temFatorR. Envia formulário ao fechamento; não é evidência fiscal.|
|apps/api/src/routes/firm/apuracaoV2.js|GET/POST fechamento porempresa/competência, calcular/salvar/transmitir/retificar; requireFirmCompanyAccess ACCOUNTANT. Transmissão exige confirmCompetencia. PUTcadastro não grava regimeApuracao.|
|apps/api/src/application/notas/apuracao/v2/FechamentoService.js, getDadosFechamento|Cadastro/memória/receitas/snapshot/conferência de folha → DTO do modal; separa cálculo recuperável e histórico.|
|Mesmo arquivo, folhasSalarioSeAplicavel:579|folhaMensal12 + flags das atividades; se nenhum flag definido consulta AtividadePgdasd. Qualquer flag definido suprime esse fallback; exige algum true. Não recebe PA.|
|Mesmo arquivo, calcularFechamento:713|Lease, regime, snapshot, receita, CNPJs/contexto/RBT; seleciona/poda folha; simula externamente; valida resultado/contexto; grava snapshot e memória. Não é leitura pura.|
|Mesmo arquivo, salvar/transmitir:953/1077|Confirma revisão e identidade; reserva condicional; reutiliza folhas aceitas no vínculo. Pós-sucesso pode atualizar circular/guia/contabilidade. Doubles devem isolar também pós-efeitos.|
|apps/api/src/application/notas/apuracao/v2/ApuracaoConfigMemoryService.js|Último formulário por empresa, incluindo série e regime; sugestão, não histórico anual nem prova de folha.|
|apps/api/src/application/notas/apuracao/v2/CalculoConfirmado.js e RecuperacaoCalculo.js|SHA256 liga empresa,PA,formulário,séries/contexto. Recuperação compara cadastro/fatos; mudança permite consulta histórica, não nova transmissão automática.|
|apps/api/src/application/notas/apuracao/v2/RbtExtratoService.js e PeriodosRecusadosService.js|Memória de períodos aceitos e recusados modifica subconjunto enviado; não origina valor de folha. Lista vazia após poda não comprova dispensa nova.|
|apps/api/src/application/notas/apuracao/v2/FatorRService.js|CompanyMonthlyCircular.fs12Manual atual ou anterior → resolverFolha12m; decidirFatorR; escrita LogDecisaoFatorR por empresa/PA. Agregado não reconstrói12 parcelas.|
|apps/api/src/application/notas/apuracao/v2/MotorApuracaoService.js:225|Consome agregado explícito/resolvido, inclusive sugestão anterior; decide anexo quando aplicável. Fluxo distinto do payload mensal oficial.|
|apps/api/src/application/notas/apuracao/CalculoFiscal.js:74/207|Caminho legado usa0 quando não há agregado; pode persistir fs12Manual0. Não legitimar esse default como prova.|
|apps/api/src/application/notas/apuracao/v2/FolhaDerivadaService.js|Consulta AccountingEntry tipoFOLHA e contas resolvidas; débitos de despesa, exclui pagamentos identificados; compara com digitado. disponivel exige lançamentos; não substitui folha fiscal, encargos pagos ou fonteDP.|
|apps/api/src/application/notas/apuracao/v2/PreparacaoAutomaticaSimples.js, CicloSimplesService.js; apps/api/src/application/operacoes/OperationsCalculationService.js|Preparação/formulário automático usam série vazia e regimeCOMPETENCIA; reservas/agenda/capacidades existentes permanecem.|
|apps/api/src/application/fiscal/serpro/PgdasSimulacaoService.js|buildDeclaracaoPayload transforma série/receitas; simular e transmitir diferem pela intenção. Número/decimal viaNumber+toFixed2; sem validação de janela/completude.|
|apps/api/src/application/fiscal/serpro/SerproPgdasdService.js e SerproHttpClient.js|Envelope TRANSDECLARACAO11 v1.0 em /Declarar, autenticação/guarda/reserva; efeitos pagos e potencial ato fiscal. Nenhum acionado.|
|apps/api/prisma/schema.prisma|Circular.fs12Manual/fs12Origem; Snapshot.folhaMensal12/simulacaoSerpro; ConfigMemory; LogDecisaoFatorR. CadastroFiscal.regimeApuracao único. RegimeHistorico é regime tributário, não opçãoCAIXA/COMPETENCIA.|
|Planejamento, relatório de faturamento, carteira e Operações|Consomem agregado/anexo/snapshot/qualidade. Comparação hipotética não é declaração; ausência não deve virar sucesso. Guias/Contabilidade conservam fatos e escritas.|

Não foi encontrada fonte automática eSocial/Drive nesse caminho. Não se leu folha real. Escritores contábeis são apenas origem indireta de conferência; nenhum lançamento pode ser alterado para satisfazer FS12.

## 4. Matriz de payloads

“Aceito local” significa apenas transformação pela função ou passagem ao double, nunca aceite da Receita.

| Entrada | Comportamento local caracterizado | Contrato externo / classificação |
|---|---|---|
|folhasSalario ausente ou[]|Builder omite campo em todos os quatro PAs|Após10/2026 conflita com obrigatório/MSG071; não presumir aceite.|
|null|Builder direto lançaTypeError; fachada normaliza para[]|Formato não é array; aceite não demonstrado.|
|[{pa:202610,valor:0}]|Mantémzero e PA numérico|Forma documental compatível; suficiência depende janela/histórico/prova.|
|Série de 12 meses numéricos|Converte/arredonda, mantém ordem|Forma compatível, sem homologação de conteúdo ou obrigatoriedade de reenviar todos.|
|Sérieparcial/duplicada/futura|Não verifica completude/duplicidade/janela|Parcial pode depender de meses já declarados; duplicada/futura não homologada. Não recomendar.|
|valor nulo/ausente/vazio|Converte0|Erro de qualidade local; não equivale a zero confirmado.|
|string decimal|ConverteNumber e arredonda2casas|Saída numérica; escala/remoto desconhecidos. Preservar caracterização monetária.|
|negativo/não numérico|Negativo passa; inválido viraNaN e JSONnull|Não homologados; precisam validação explícita futura.|
|Receitazero|Omite atividades; builder conserva folha se fornecida|Omitir atividades e declarar folha são decisões distintas.|
|CAIXA|Builder duplica totais nos pares caixa/competência, sem campoenum regime|Fechamento real recusa antes do transporte; builder não demonstra suporteCAIXA.|
|COMPETENCIA|Camposcaixa null|Forma atual;2027 exige confirmação completa do contrato, não só desse campo.|
|Reenvio de folha anteriormente declarada|Poda e memória podem alterar subconjunto|MSG029/030 exigem cuidado com substituição e efeito posterior; não executar ensaio real.|

Teste de erro/double não é prova de recusa real; mensagens são referências documentais. São desconhecidos: aceite de[]/omissão pós11/26 com histórico completo, subconjunto exato exigido em início de atividade, novo manual2027 e escala monetária aceita. Confirmar documentalmente ou em homologação separadamente autorizada, sem usar clientes reais.

## 5. Separação arquitetural e regime versionado

Proposta, não implementação: Fiscal possui duas políticas independentes: exigência declaratóriaFS12 por PA/versão e aplicabilidade/decisãoFatorR por atividade. Recebem fatos; nenhuma depende de Prisma, Express, SDK ou armazenamento. Fonte de folha fornece valores mensais, cobertura, origem e revisão; agregado sozinho não permite inventar parcelas. Contabilidade só fornece conferência; DP não é integrado nesta entrega.

AplicaçãoFiscal valida contexto/qualidade antes de pedir simulação ao adaptadorSERPRO. Adaptador traduz forma e falhas, não decide exigibilidade. Operações apresenta bloqueios/capacidades sem criar obrigação. UI preserva desconhecido, zero explícito e motivo; não decide anexo.

Estratégia por PA:
1. Preservar regra e opção histórica até10/2026; não converter empresasCAIXA.
2. **11/12/2026:** selecionar política declaratória atualizada, independenteFatorR, após revisão de fontes e subconjuntoSERPRO.
3. **2027:** regimeCOMPETENCIA normativamente confirmado; contrato detalhado/homologação permanece gate próprio. Não usar ausência de novo manual como autorização de defaults.
4. Metadados de política/revisão devem acompanhar novo vínculo de cálculo, sem migrar/reescrever snapshots antigos. Definir compatibilidade no incrementoB; mudança exige conferência explícita, não refaz cálculo silenciosamente.
5. Fonte anual da opção histórica precisa ser definida; CadastroFiscal único e RegimeHistorico não bastam. ServiçosREGIMEAPURACAO existem oficialmente, mas não ativá-los nem fazer opções automaticamente. Não criar schema nesta caracterização.

## 6. Riscos e plano PGDAS-2026-B

| Incremento proposto | Aceite e revisão | Rollback / limite |
|---|---|---|
|B1: contrato de evidência mensal e política temporal pura|Fiscal aprova janela/cobertura/abertura/zero e distinçãoFatorR; fixtures4PAs; nenhuma fonte inventada|Reverter política não publicada; nenhum dado a transformar.|
|B2: apresentação/validação de FS12 declaratória|Meses ausentes não viram0; nãoFatorR11/12 tem preenchimento; empresa/PA/revisão; UI e backend coerentes|Repor interface anterior com orientação segura; não ocultar exigência vigente nem liberar transmissão incompatível.|
|B3: preparação manual/operacional e adapter|Paridade10/26, esquema11/12, períodoaceito/podado, estadoincerto; novo cálculo somente explícito; zero escritacontábil incidental|Suspender capacidade nova sem alterar recibos/reservas; reverter código não desfaz atos fiscais.|
|B4: regime/histórico e2027|Fonte anual definida, sem alterar opções2026; revisão fiscal do manual2027 e contrato do provedor|Não migrar cadastros em massa; bloquear operação incompatível, conservar consulta histórica.|
|B5: integração/homologação controlada|HTTP/ACL, PostgreSQL16 descartável, concorrência/rollback/fechamento, calculoId, revisão independente e CI final|Publicação/transmissão dependem autorização própria; sem retry de resultadoincerto.|

Riscos que não são correções autorizadas: fórmula local FatorR comRBT12zero devolve0/V; início de atividade não especializado na janela; FS12anterior consumida no motor; defaults0legados; flagparcialFatorR impede catálogo; CAIXAbloqueado no fechamento; últimoformulário não é histórico. Tratar por incrementos delimitados, nunca alterar III/V como consequência da obrigação declaratória.

Repetição atual: ajuste de períodos tem limite3 por padrão; retomada de simulação pode usar min(25,receitas+folhas+1), ou1 quando tentativa única; automático usa1. Transmissão reutiliza vínculo aceito. Não mudar limites, assinatura, reservas ou mensagens neste A. Não presumir falha pré-aceite após timeout. Nova política não autoriza retificação, reapuração de mês fechado ou substituição de folha declarada.

Decisões humanas: aprovar recorte B1/B2 para11/12; confirmar fonte/prova de folha e critérios de início de atividade; resolver evidência de meses já declarados/lista vazia junto à documentação; definir fonte anual do regime; manter2027 condicionado a revisão própria; autorizar eventual homologação externa separadamente. Nenhuma definição fiscal adicional é necessária para preparar este PR; a integração depende de autorização humana específica.

## 7. Testes, governança e limites

Novos testes: pgdas2026Caracterizacao (builder e fachada com provedor injetado), pgdas2026FolhaRegime (janela/resolvedor/token/fórmula), casos em declaracaoZerada (fechamento real com doubles), pgdas2026FolhaCaracterizacao (modal real/API em memória). Asserções observam o legado; não são fixtures de aceite remoto.

Referência antes da edição:443 testes API aprovados/27 suítes;9 ignorados em2suítesPostgreSQL. Candidata:487 testes API aprovados/29 suítes, mesmos9 ignorados (conferenciaAdn7,cicloSimples2), sem URL descartável local. Persistência/transações não foram modificadas; esses skips não contam como aprovação. Workflows hospedados serão registrados no PR com SHA e resultados; seus bancos não substituem silenciosamente casos não executados.

Uma fixture inicial de token omitiu campos do snapshot e foi corrigida; seletor inicial do botãoUI não correspondia ao nome acessível e foi corrigido. Nenhum ajuste produtivo para passar testes. Resultado web final, governança, diagnose e pareceres ficam no registro de impacto/PR.

Controlador não executado: não há mudança funcional; principal executa os testes e solicita revisões independentes reais. Não declarar ready_for_human nem herdar execução de outro PR. Referência operacional canônica/fallback SHA256 e50fa30d9c205d4f09fb7638429509bb49bfb49016107e9e27d759faa649639f; node_modules local por junção com lockfile idêntico, sem reinstalar dependências antigas.

Rollback deste A: reverter somente documentos/testes adicionados. Sem alteração de schema, produção, banco, dados fiscais, Drive, PDFs privados, workers, Railway ou políticas. Parar após PR em rascunho para revisão; não iniciar B.


Resultados finais locais: 43 testes web em cinco suítes, 40 de governança e cinco do analisador aprovados. Diagnose: 5.023 → 5.023, zero acréscimos. Revisões independentes Fiscal, arquitetura/backend e sistêmica favoráveis; ajustes editoriais aplicados. Os revisores inspecionaram código, fontes e relatórios, sem reexecutar as suítes. Não há alteração de layout que demande homologação visual nova; o teste usa o modal existente. CI hospedada será registrada no PR no SHA definitivo.
