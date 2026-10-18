# Auditoria técnica de guias e emissão pelo suporte WhatsApp

## Continuação supervisionada — 18/10/2026

Esta seção substitui as pendências de implementação descritas nos registros históricos abaixo. O usuário autorizou integrar na main e publicar este incremento somente após revisões e testes aprovados. Implementação, revisões independentes e gates locais concluídos. A integração continua condicionada aos checks obrigatórios do PR 232 no commit final, seguida de implantação e verificação produtiva.

A conciliação está disponível no suporte em **Conferir emissões**: o contador identifica a tentativa, informa motivo e pede consulta do resultado. O servidor valida permissão, empresa, conversa, tentativa e versão. Um controle compartilhado com a emissão, tokens de posse e gravações condicionais impedem concorrência e sobrescrita por execução antiga. O histórico conserva operador, motivo e provas. Somente prova da mesma emissão resolve o resultado; consulta inconclusiva, 404 ou legado sem vínculo conserva bloqueio e orientação de revisão. Não há reenvio fiscal, reserva de número nem mensagem automática nessa ação.

O timeout de onboarding era do teste de recarga: cache da biblioteca real Faker e espera injetável eliminam trabalho repetido, mantendo reimportações, assertions, persistência e o limite de 20 segundos. O caso passou em 640 ms e foi repetido independentemente em 743/716 ms. A espera padrão da demonstração permanece igual.

O controlador desta rodada (`2026-10-18T22-03-06-038Z-d8893f7b`) entregou apenas a parcela onboarding. O Principal interrompeu sua execução parcial e concluiu com autores/revisores nativos. Journal de interrupção preservado; não se atribui `ready_for_human` ao controlador. Revisões reprovaram guardas de consulta, fencing, indicador incerto após sucesso e dimensão visual do painel; correções voltaram aos autores e receberam revisão independente. Os 150 testes dirigidos passaram; o revisor repetiu 28 casos. PostgreSQL descartável confirmou exclusão, expiração da transação, CAS, recuperação e preservação de resultados tardios. Isso não equivale a suspender um processo pelo sistema operacional ou certificar o provedor fiscal real.

Revisão visual local com contatos sintéticos: desktop 1440 px e celulares 390/360 px, teclado, erro, processamento, legado, resultado inconclusivo, recarga e vazio. Painel recolhível e rolagem interna preservam conversa e compositor. Nenhuma rede externa, mensagem ou emissão fiscal foi usada.

Compatibilidade dos verificadores de dados: DRE e fluxo de caixa passam a aceitar também o sufixo `_governance_test`, mantendo host local, protocolo PostgreSQL, proibição de chamadas externas e todas as assertions. O gate permanece inalterado. Seis casos negativos bloquearam antes de importar Prisma; quatro controles positivos chegaram ao import interceptado. Gate real de dados aprovado, com sete cenários DRE e fluxo de caixa.

Impacto operacional: implementação dos contratos existentes R19/R20/R22, sem nova regra tributária ou autorização de reemissão. Fonte operacional canônica e snapshot continuam reconciliados. Piloto WhatsApp encerrado permanece desligado.

Publicação obrigatória em duas etapas: primeiro atualizar todos os executores API/workers com `NFSE_CONCILIACAO_SUPERVISIONADA_ENABLED=0` (ausência também desabilita); comprovar retirada das instâncias antigas; somente então habilitar `=1`. Rollback: desabilitar e drenar as instâncias habilitadas antes de restaurar versão antiga, preservando ações, tentativas e auditoria. Não testar com emissão fictícia em produção.

Fechamento local: API completa selecionou 613 suítes, com 612 aprovadas/10.773 testes e um teste PostgreSQL condicional; esse teste foi executado separadamente no banco descartável e passou (listagem de 1/100 fichas, 479 ms). Web: 498 suítes/5.567 testes aprovados, incluindo contratação/recargas em 2.280 ms. Portal: 99 suítes/1.580 testes do checkpoint preservado, com fontes portal/shared/package idênticas. Governança: 63 testes. Builds web/portal, lint direcionado, PostgreSQL e revisão visual final aprovados. A primeira execução API foi interrompida por EPERM ao renomear o manifesto depois de 375 suítes; não foi aprovada. A repetição integral passou sem modificar fontes ou gates. Único ajuste web durante sua bateria: captura estável de referência no cleanup, com 12 testes, lint e revisão renovados. Manifesto final dos arquivos de produto em bytes Git: SHA256 `c790d1819ae78ae92b95f437873bcb7e156c414b0f17c32117f87b173576429f`.

As seções seguintes são histórico de checkpoints anteriores. Pendências superadas e reprovações antigas ficam preservadas como evidência, não como estado atual.

## Histórico — checkpoint anterior de correções locais

As seções abaixo de **Histórico da auditoria inicial** preservam o diagnóstico anterior e não descrevem o estado atual. Base produtiva `d6e7daefb`; checkpoint de auditoria `bf6cd0a4c`. Nenhuma nota real emitida, guia reenviada ou configuração produtiva alterada neste incremento.

Controlador iniciado nas rodadas `2026-10-18T20-42-14-466Z-6af6a54f` e `2026-10-18T20-54-45-234Z-060fcc26`. Primeira interrompida após reprodução do defeito e ampliação de escopo; segunda escalou por capacidade do modelo. Journals preservados. Retomada pelo Principal com autores/revisores independentes nativos, sem alterar gates ou permissões. Não há `ready_for_human` emitido pelo controlador.

Impacto operacional: adequação a R01–R22/R25/R26, preservando tributos, valores, permissões e decisões pendentes. Documento canônico e snapshot mantêm o hash registrado abaixo. Nenhuma regra fiscal nova aprovada.

| Achado | Correção local e limite |
| --- | --- |
| Alessandro permanecia em Guias após envio | Projeção separa entrega de pendência financeira/contábil. Produção inspecionada: DAS e parcela enviados, leitura WhatsApp registrada, pagamento aberto. Não reenviar nem marcar pagamento para corrigir status |
| Recálculo perdia comprovante concorrente | CAS/releitura e recusa de callback antigo. Regressão PostgreSQL inicialmente falhou, depois passou preservando evidência |
| Configuração alterada após resumo | Fingerprint material na preparação e emissão; revalidação antes do POST; resumo legado/alterado precisa ser refeito |
| Resultado inconclusivo anunciado como recusa | Preserva tentativa e exige conferência; bloqueia nova preparação. HTTP200 vazio/inválido não comprova emissão |
| Interrupção após confirmação | Vínculo durável antes do POST e recuperação por prova local issued/chave/número com escopo e CAS. **Parcial:** tentativa pending sem prova continua bloqueada; falta ação operacional supervisionada de conciliação na tela |
| Sem e-mail/complemento restaurava memória | String vazia significa remoção; null/ausência permitem enriquecimento. Memória e consultas respeitam a remoção |
| Dois resumos/códigos na mesma rodada | Envia só última intenção vigente persistida; reconfere antes do transporte e impede prosa da IA repetir código anterior |
| Revogação durante última leitura fiscal | Revisão sistêmica reprovou janela residual; corrigida com guarda final após fingerprint, antes do POST, separada do vínculo |

Evidências dirigidas: tomador 24 testes; guias 57; assistente 64; confirmação/recuperação 58 iniciais e cenário complementar de guarda final. NFSE teve suítes dirigidas aprovadas; gate API inicial identificou três fixtures antigas sem XML autorizado, corrigidas mantendo assertions (73 testes). Testes PostgreSQL de guias e WhatsApp passaram; WhatsApp usa executor real e serviço fiscal sintético, cobre vínculo pré-envio, resultado incerto e recuperação sem reenvio. Ensaio R25/R26 passou em 16 cenários. Gates gerais finais serão registrados no registro de governança; resultados dirigidos não equivalem à aprovação do conjunto.

Pendências para não declarar pleno funcionamento:

- Conciliação supervisionada de tentativa pending sem prova; vínculo rastreável não resolve sozinho esse estado.
- Validação externa integral de emissão pelo suporte, certificado, provedor, DANFSe e entrega. Nenhuma nota fictícia real foi autorizada ou emitida.
- Menu/IA em produção ainda restritos a uma empresa e um telefone piloto; não houve liberação universal. Teste isolado segue encerrado, flags desligadas.
- Calendário de acompanhamento inspecionado tem avisos antes/depois, mas não no próprio vencimento; cadência não alterada neste incremento.
- Exigibilidade INSS/folha e matriz de regimes possuem decisões de negócio pendentes; não inventar dispensas.
- Sem nova idempotência universal para pedidos independentes do portal; reserva protege a confirmação WhatsApp.
- Sem nova validação visual local ou publicação das correções; inspeção visual produtiva refere-se à base anterior.

Rollback: reverter apenas o incremento revisado, preservando ações, tentativas e evidências. Não apagar registros fiscais/contábeis nem usar backfill de envios. Sem migração ou alteração produtiva.

**Fechamento técnico deste incremento local:** 411 testes dos 14 arquivos modificados passaram nas fontes finais. API ampla: 10.743 aprovados, um condicional preexistente pendente; portal: 1.580 aprovados; governança: 63 aprovados; ambos os builds passaram. Ajustes finais de recálculo/nfseId posteriores ao início da API foram cobertos pela repetição dirigida, não por alegação de snapshot integral inalterado. PostgreSQL guias final passou em seis grupos, incluindo campos nulos e concorrência de valor com timestamp idêntico. Pareceres independentes aprovaram os deltas corrigidos, não publicação nem completude da cadeia.

**Gate web não aprovado:** timeout de 20s em `funilMock.test.js`, contratação após recarga. Falha repetida isoladamente e no checkout limpo anterior `54cd81f0`, com fontes web/shared/dependências equivalentes à base produtiva: 8 passaram/1 timeout. Não alterados timeout/assertions. O incremento permanece parcial e não pronto para integração; pendências acima continuam válidas.

## Histórico da auditoria inicial

Data: 18/10/2026. Executor delegado, rodada 0. Base inspecionada: `d6e7daefbaf94b2be94595bb750438130408636c` (HEAD local). Sem modificação funcional, commit, merge, publicação, acesso produtivo, envio, modelo pago ou ato fiscal. Este relatório não declara aprovação independente nem certificação da cadeia completa.

## Resultado desta rodada

**Há uma falha reproduzida de concorrência no registro do recálculo (A01). Não é possível afirmar que a cadeia completa está validada.** Foram preparados dois testes de integração entre serviços e dois ensaios PostgreSQL. Os quatro arquivos passaram na verificação de sintaxe; Jest e PostgreSQL não foram executados por este subprocesso. A reprodução de A01 foi executada separadamente, em memória, com os módulos reais.

Referência operacional conferida: `../altan-regras-operacionais/REGRAS_OPERACIONAIS.md`, SHA256 `c1f80393382c5cc2d6ef1cbfe6b5841e0def479d57d4721dc3c99f83ab73bc94`. Aplicam-se R01–R22, R25, R26 e R29. Não há alteração operacional aprovada neste incremento. V02/V03/V05–V08 continuam pendentes; não foram inferidas matrizes, alíquotas, dispensas ou confirmações oficiais. R25 prevalece sobre instruções históricas que impediam baixa pela confirmação autenticada do cliente.

## A01 — perda de comprovante concorrente no registro de recálculo

Severidade proposta: alta, a avaliar pelo Principal/revisores. Fonte: `apps/api/src/application/guides/RegistroRecalculoGuia.js`, função `registrarRecalculoGuia` (linhas 17–35 na base).

O serviço lê `extracted`, acrescenta `recalculoGuia` e escreve o JSON inteiro com `guide.update({ where: { id } })`. Não há comparação de `updatedAt` nem transação envolvendo essa leitura. Outro escritor pode salvar um comprovante após a leitura e antes da escrita. O registro de recálculo então repõe o JSON anterior. Em contraste, `atualizarGuiaComEvidencia.js` usa comparação de revisão e releitura limitada.

Intercalamento reproduzido:

1. Guia possui `extracted.comprovante.total = 100`.
2. O registro de recálculo lê uma cópia dessa guia.
3. `atualizarGuiaComEvidencia` grava comprovante com `total = 99` e `evento = concorrente`; leitura confirma a gravação.
4. `registrarRecalculoGuia` escreve sua cópia antiga acrescida do registro.
5. O comprovante volta a `total = 100`; `evento` desaparece.

Execução real: Node 20.20.2 por stdin, importando o conteúdo inalterado dos dois módulos como módulos `data:`. Persistência simulada, sem imports externos, banco ou rede. Exit code 0 da **caracterização do defeito** e saída:

```text
A01 REPRODUZIDO: comprovante concorrente total=99 removido; voltou total=100. Modulos reais sem rede/banco, importados por data URL.
```

Isso comprova o intercalamento no algoritmo, não a frequência nem ocorrência em produção. O ensaio PostgreSQL novo repete o intercalamento com escrita/leitura reais e termina exigindo preservação da evidência: **deve falhar em A01 enquanto o defeito existir**. Não retirar essa asserção para obter aprovação. O teste Jest identifica explicitamente a caracterização do comportamento defeituoso; seu eventual verde não é aceite da regra R19/R20.

Consumidores encontrados por busca: `routes/firm/index.js` (recálculo DAS/LP e INSS) e `routes/client/index.js`. Possível consequência: perda de evidência em `extracted` apesar de os campos escalares de pagamento permanecerem. Não foi demonstrada alteração de lançamentos ou baixa duplicada neste cenário. Correção proposta para avaliação: gravação do registro com CAS/releitura preservando a evidência concorrente, acompanhada de regressão de persistência. Nenhuma correção funcional foi aplicada.

## Mapa rastreável e limites de cobertura

Os caminhos abaixo são relativos a `apps/api/src`. “Inventário” identifica pontos/testes existentes; não significa que seus cenários passaram nesta execução.

| Etapa | Fontes e testes existentes identificados | Evidência desta rodada / pendência |
| --- | --- | --- |
| Obtenção DAS | `application/fiscal/serpro/CaptureSerproGuidesService.js`, `capturePgdasGuideForCompany` | Inventário; obtenção fiscal externa não executada |
| Recálculo LP/INSS/DAS | `routes/firm/index.js`, `routes/client/index.js`, `application/guides/RecalcularGuiaWhatsappService.js`, `application/assistente/AcoesPendentesService.js` | Chamadores rastreados; provar seleção e preservação dos demais documentos em cada adaptador ainda pendente |
| Validação e PDF | `application/guides/__tests__/linhaDigitavelNaGravacao.test.js`, `lerLinhaDigitavelDoPdf.test.js`, `uploadMesFechado.test.js` | Inventário; não provar PDF válido apenas com `PROCESSED` sintético |
| Atualização documental | `application/guides/atualizarGuiaComEvidencia.js`, `RegistroRecalculoGuia.js` | A01 reproduzido; novo cenário de recaptura/registro/projeção preparado |
| Envio e revisão | `application/whatsapp/EnvioDocumentoGuiaWhatsappService.js`, `application/guides/EnvioGuiaService.js` | Revisão documental inspecionada; transporte e worker não exercitados |
| Recibos e acompanhamento | `application/guides/EntregaGuiaWhatsappService.js`, `AvisoPagamentoService.js`, `__tests__/entregaGuiaWhatsapp.test.js` | Guarda exige tentativa entregue/lida, hash, revisão, destinatário e identidade compatíveis; ensaio novo prepara rejeição do recibo anterior após recaptura |
| Pagamento e baixa | `application/guides/ConfirmacaoPagamentoClienteService.js`, `GuidePaymentStatusService.js` | Inventário e leitura dos contratos; ensaio existente `apps/api/scripts/verify-pagamento-cliente-correcao-contabil-postgres.mjs` não executado nesta rodada |
| Mês fechado | `application/accounting/CorrecaoMesContabilService.js` e ensaio R25/R26 acima | Pendente validar transação, auditoria, concorrência e recarga no ambiente descartável |
| Projeção contábil | `application/guides/RegistroRecalculoGuia.js`, `sinalizarRecalculosNosLancamentos` | Novo teste verifica valor documental informativo e ausência de modificação do razão/guia vizinha; execução Jest pendente |
| Configuração/autorização NFS-e | `application/nfse/autorizacaoEmissaoDoCliente.js`, `emissaoClienteAutorizacao.js`, `application/assistente/AcoesPendentesService.js` | Inspeção das guardas reais; testes novos combinam permissão do contato, titularidade, vínculo ativo, papel e liberação da empresa |
| Preparação fiscal do suporte | `application/assistente/ferramentas/index.js:528`, `__tests__/emissaoComDadosDoPortal.test.js` | Preparar cria confirmação, não emite; serviços leem perfil/configuração e vigência. Suíte existente não executada |
| Confirmação e emissão | `application/assistente/AcoesPendentesService.js:165`, `application/nfse/NfseService.js` | Reserva e reconferência inspecionadas. Ensaio novo usa executor sintético: não certifica emissão, DPS, XML ou certificado |
| Conciliação/incerteza NFS-e | `application/nfse/CLAUDE.md`, suítes `conciliacaoDps.test.js` e `emissaoDps.test.js` | Contratos consultados; comportamento e integrações externas pendentes de execução local e homologação aplicável |
| Empresas/Operações/portal/web | Consumidores do domínio guias indicados no mapa de governança | Sem alteração visual; concordância entre telas e recarga não verificadas nesta rodada |

O suporte fiscal e a sessão comercial de teste são fluxos diferentes. Nenhuma sessão comercial foi retomada/ativada. A sessão isolada deliberadamente não possui ferramentas fiscais; não é evidência de emissão pelo suporte. Os testes novos não criam essa sessão.

## Artefatos novos e execução

| Arquivo | Escopo exato | Estado |
| --- | --- | --- |
| `apps/api/src/application/guides/__tests__/auditoriaCapturaRecalculoIntegracao.test.js` | Atualização → registro → projeção; pagamento/vizinha preservados; caracterização A01 | Sintaxe OK; Jest pendente |
| `apps/api/src/application/assistente/__tests__/auditoriaEmissaoConfiguracaoIntegracao.test.js` | Duas guardas reais com DB simulado; permissão, papel, vínculo, titularidade, revogação e erro de leitura | Sintaxe OK; Jest pendente |
| `apps/api/scripts/verify-auditoria-guias-ciclo-postgres.mjs` | Recaptura, revisão do recibo, projeção seletiva e reprodução persistida A01 | Sintaxe OK; PostgreSQL pendente; falha A01 esperada |
| `apps/api/scripts/verify-auditoria-emissao-whatsapp-postgres.mjs` | Pendência persistida, escopo, reserva concorrente, replay e revogação; executor substituto | Sintaxe OK; PostgreSQL pendente |

Os scripts exigem URL PostgreSQL loopback com nome terminado em `_governance_test`, rejeitam parâmetros alternativos, fixam loopback IPv4, apontam dotenv para caminho aleatório inexistente e desligam flags de integração apenas no processo de teste. Bloqueiam fetch/HTTP/HTTPS/TLS/sockets JavaScript. O engine nativo Prisma acessa a URL validada; esses bloqueios não são uma barreira de rede do sistema operacional. Fixtures são sintéticas e permanecem somente no banco descartável, para inspeção. Não usar banco compartilhado, túnel ou proxy produtivo. O Principal prepara dependências/schema/banco; os scripts não executam migrações nem apagam dados existentes.

Comandos preparados (a partir de `apps/api`, com ambiente descartável fornecido pelo Principal):

```powershell
node ../../node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/application/guides/__tests__/auditoriaCapturaRecalculoIntegracao.test.js src/application/assistente/__tests__/auditoriaEmissaoConfiguracaoIntegracao.test.js
node scripts/verify-auditoria-guias-ciclo-postgres.mjs
node scripts/verify-auditoria-emissao-whatsapp-postgres.mjs
```

Evidência de limitação: `node scripts/governance/check.mjs plan --base d6e7daefb` falhou antes de carregar o script com `EPERM: operation not permitted, lstat 'C:\Users\yagoa'`. Não houve ampliação de permissões. A verificação de sintaxe por stdin (`Get-Content -Raw <arquivo> | node --input-type=module --check`) funcionou nos quatro arquivos. O ensaio em memória por stdin também funcionou. Esses resultados não substituem o gate de impacto, Jest ou PostgreSQL.

Classificação dos caminhos pelo mapa existente: scripts em API; testes em guides/communication; relatório em documentation. Impacto transitivo a revisar: accounting, operations, commercial, web e portal. Sem modificação do mapa, gates, configurações ou registro de governança; esses registros pertencem ao Principal neste escopo delimitado.

## O que ainda não está certificado

- **Prova automatizada executada:** sintaxe dos quatro arquivos e reprodução isolada A01. Não há resultado de execução das duas suítes Jest nem dos dois ensaios PostgreSQL novos.
- **Inspeção estática:** contratos e caminhos descritos acima. Testes anteriores e relatos históricos de deploy não provam a versão atual.
- **Verificações produtivas somente leitura:** nenhuma realizada; acesso produtivo está fora da autorização deste subprocesso.
- **Integrações externas:** nenhuma certificada. Recebimento/entrega Meta, modelos aprovados por WABA, e-mail, extração real, provedores fiscais, composição/encargos reais, certificado, assinatura, DPS/E0014 e emissão/cancelamento não foram testados externamente.
- **Cadeia ponta a ponta:** ainda falta ligar aquisição/validação/envio/webhook/acompanhamento/confirmação/baixa seletiva com persistência real e projeções/UI, incluindo falha parcial, resultado incerto, concorrência e troca de empresa/revisão. Os testes novos são incrementos delimitados, não substitutos dessa cadeia.

Próxima decisão do Principal: avaliar A01, executar os ensaios em ambiente preparado, incorporar os pareceres independentes e autorizar eventual correção funcional incremental. A constatação não autoriza alterar comportamento fiscal/contábil por este executor. Rollback desta entrega documental/de testes: remover somente os cinco arquivos novos atribuídos, preservando alterações concorrentes; nenhuma migração ou dado operacional precisa de reversão.

## Incremento delegado — timeout do funil, 18/10/2026

Entrega **parcial** do pedido de conciliação supervisionada e correção do gate. Nesta rodada foram alterados somente `apps/web/src/api/mock/mockApi.js`, `apps/web/src/features/onboarding/lib/__tests__/funilMock.test.js` e este relatório. Nenhuma implementação nova de conciliação fiscal, rota ou interface foi entregue. O checkpoint funcional anterior permanece preservado. Não há aprovação independente nem prontidão de publicação nesta evidência.

### Causa e correção do teste

O teste de contratação reavalia o módulo seis vezes para conferir persistência após recarga. `jest.resetModules()` também descartava a biblioteca Faker inteira, incluindo seus locales. Além desse custo, chamadas reais do mock aguardavam 120/180 ms. O comentário antigo que atribuía o custo a montagem de telas estava incorreto: este arquivo testa serviços.

A biblioteca **real** Faker agora é carregada uma vez por arquivo de teste. Sua implementação não foi substituída; cada reavaliação de `mockApi` continua aplicando `faker.seed`, recriando Maps e restaurando o snapshot de `sessionStorage`. Todas as reimportações, a limpeza por caso, os nove casos e os asserts foram mantidos. `createMockApi` aceita uma função de espera opcional; o teste injeta uma Promise imediata. Sem argumento, a aplicação conserva exatamente sua espera simulada anterior. Nenhuma regra R27/R28, assinatura, pagamento, isolamento ou conversão foi alterada. O teto continua 20 s.

Evidência executada em `apps/web`, sem rede/backend:

```text
node --preserve-symlinks --preserve-symlinks-main ../../node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/features/onboarding/lib/__tests__/funilMock.test.js --json
```

- Apenas injeção da espera, antes do cache de Faker: 9/9 passaram; suíte 56,572 s e 38,635 s em duas execuções. Esses tempos não são uma medição nova do baseline original.
- Com a correção completa: 9/9 passaram; suíte 10,387 s; caso de contratação/recargas **640 ms**, conforme `assertionResults.duration`. O primeiro caso, incluindo inicialização, marcou 2.790 ms; os demais ficaram entre 77 e 160 ms. Tempos locais não são garantia de desempenho de CI.
- O comando normal de Node inicialmente falhou com `EPERM` ao resolver o caminho do perfil. As opções `--preserve-symlinks --preserve-symlinks-main` permitiram executar o mesmo Jest e o plano sem alterar permissões, configuração ou gates.
- Plano real: `node --preserve-symlinks --preserve-symlinks-main scripts/governance/check.mjs plan --base d6e7daefb`, exit 0; risco agregado high e nenhum caminho desconhecido. O plano inclui o checkpoint anterior, não apenas este diff.
- `git diff --check`: exit 0 antes deste registro; repetir na entrega final. Gates completos, build e revisões independentes seguem pendentes. Sem alteração visual nesta parcela, portanto não há nova validação desktop/mobile a declarar.

### Conciliação supervisionada ainda pendente

Inspeção confirmou que `antesDeEnviar` persiste o vínculo da ação com a tentativa antes do POST. `conciliarTentativa` atualmente rejeita `pending`, aceita as falhas previstas e aplica o resultado com CAS de empresa/status/updatedAt. A recuperação local da ação só conclui a partir de tentativa `issued`; não faz consulta nem emissão. Esses comportamentos foram preservados nesta rodada.

O lease atual do WhatsApp expira em 90 s. Expiração não prova término de um executor que parou de renovar durante transporte; usá-la isoladamente para liberar conciliação de `pending` não satisfaz o pedido. Permanecem necessários: exclusão entre executor e conciliação em todos os processos, proteção contra escritor tardio, auditoria vinculada a ação/tentativa/operador/versão, histórico das provas, encaminhamento auditado do legado sem vínculo, endpoint autorizado e interface no chat/suporte. Nenhum timeout/404 foi convertido em recusa ou autorização de retry.

Proposta para o Principal reconciliar no contrato canônico antes de concluir o incremento: a supervisão é comando explícito do contador sobre empresa/ação/tentativa e versão; consulta exclusivamente a DPS/XML persistidos; falha de exclusão mantém bloqueio; resposta inconclusiva preserva evidências e não resolve a ação; somente prova MESMA resolve o resultado emitido; nenhuma saída desta ação reserva número, chama `issue` ou habilita repetição por tempo decorrido. A forma de comprovar exclusão do executor e a cobertura de crash/perda de conexão ainda exigem implementação e teste PostgreSQL descartável. Esta proposta não foi adicionada a arquivos protegidos nem tratada como aprovação.

Rollback desta parcela: reverter somente os trechos de injeção de latência/cache no mock/teste e este registro, preservando os commits anteriores. Sem migration, dados reais, envio, emissão, publicação ou alteração de permissões.
