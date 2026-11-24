# P0.2 — Confirmação fiscal de cancelamento da NFS-e

Base: `07e24a2bf60d93d49960c170043b77478497ab0b`. Conferência: 22/11/2026.

## Atualização de contratos — 24/11/2026

Esta seção substitui o bloqueio documental descrito nos registros históricos abaixo. Incremento sobre09f8886e8581853d3afe8a3dc6b5552c72c85cc2, no mesmo PR315. [Contratos e proveniência](leiaute-nfse/contratos-eventos-20261124/README.md).

| Endpoint/retorno | Extração e validação | Resultado |
|---|---|---|
| SEFIN POST /nfse/{chave}/eventos,201 | Quatro campos obrigatórios, ambiente inteiro, eventoXmlGZipB64 canônico/GZip/UTF-8; XML assinado e origem oficial | Somente evento conclusivo válido confirma |
| SEFIN GET /nfse/{chave}/eventos/{tipo}/{sequência},200 | Mesmo envelope; tipo/sequência também conferidos com URL | Capacidade interna individual; não cria GET coletivo |
| ADN GET /NFSe/{chave}/Eventos,200 | DOCUMENTOS_LOCALIZADOS, ambiente textual, LoteDFe; cada EVENTO/ChaveAcesso/TipoEvento/ArquivoXml contra XML | Agregação determinística, não escolhe posição da lista |
| ADN404 E2240 | NENHUM_DOCUMENTO_LOCALIZADO; LoteDFe pode estar ausente | Ausência; não confirma nem retransmite |
| ADN404 E2241 | Mesmo status, restrição de vínculo explícita | Recusa de compartilhamento, nunca ausência comprovada |
| ADN400 | REJEICAO, sem documentos; erros contratuais | Não equivale a indeferimento fiscal |
| SEFIN erro, envelope vazio/desconhecido, status incompatível, XML cru | Sem prova conclusiva | Inconclusivo; reserva preservada |

Erros e Alertas ADN são opcionais/nulos conforme o contrato. Dados essenciais à comprovação não são inferidos de omissões. Metadados nunca substituem XML, assinatura, empresa, chave e ambiente. O contrato de GET /DFe/{NSU} permanece exclusivamente de distribuição, sem mudança nesta entrega.

Exemplos sintéticos: SEFIN201 com evento101101 válido confirma; ADN200 com solicitação101103 e deferimento105104 confirma; solicitação com105105 fica indeferida. Deferimento e indeferimento juntos, ou mesmo ID com hashes distintos, ficam inconclusivos. Duplicatas idênticas não duplicam prova; ordem não altera decisão. Coleção parcial ou XML alheio impede confirmação e o XML inválido não é custodiado como prova. Ausência posterior não promove prova de lote parcial. Nova evidência atual conclusiva permite recuperação quando não há conflito histórico.

Limites defensivos locais (não são regras tributárias): HTTP12MB, Base642.800.000 caracteres, XML2MB, até100 documentos e8MB descompactados por lote; UTF-8 inválido, Base64 não canônico, GZip truncado/excessivo recusados. Requests específicos pedem JSON e mantêm proxyfalse, maxRedirects0 e timeout15s. Nada muda no cliente Axios global.

Custódia individual e diagnóstico limitado usam AppSetting existente. Transação curta bloqueia a reserva e incrementa revisaoEvidencias; a projeção usa CAS. Uma nova observação entre leitura histórica e CAS invalida a projeção, sem apagar a custódia. Nenhuma transação fica aberta durante rede; nenhuma migração. Reservas existentes só consultam. Confirmação persistida não regride.

ProviderData é deduplicado e ordenado a partir dos eventos conclusivos utilizados, preservando eventoId/hash para uma identidade. Escritório, portal e assistente continuam usando a mesma decisão fiscal. NFS-e permanece dona; nenhum código de Apuração, Guias, Contabilidade, Operações, IBS/CBS ou sincronização geral ADN foi alterado.

Validação local final:328/328 em9 suítes (inclui24 PostgreSQL16, com duas conexões, conflito, rollback, custódia, isolamento, recuperação e idempotência); regressão ADN87/87 em12 suítes. Segurança executou independentemente98/98 testes; Arquitetura5/5. Diagnose5020/5020, zero novas violações. Uma execução intermediária teve179 aprovados e duas expectativas de opções HTTP antigas falhando; foram atualizadas para exigir Accept/maxContentLength e a execução final passou.

Revisões independentes Fiscal, Segurança e Arquitetura favoráveis ao diff corrigido, condicionadas à CI final. Achados corrigidos: opcionais/404 ADN, GZip obrigatório, promoção indevida de evidência parcial histórica, concorrência de custódia e projeção, projeção pública canônica. Controlador2026-11-24T19-05-51-276Z-1bad8bcb concluiu executor; subprocesso não executou Jest por EPERM no Windows. Principal interrompeu nos gates, corrigiu achados e executou validação alternativa. Sem ready_for_human e sem alteração dos gates. A CI do SHA publicado deve ser conferida no PR.

Limitações: nenhuma homologação externa ou fiscal real; procedência SEFIN é texto fornecido, não arquivo de exportação rastreável. Assinatura embutida prova integridade, não cadeia ICP-Brasil independente; origem depende do transporte oficial autenticado. AppSetting não tem imutabilidade imposta no banco. Reservas NAO_ENVIADO não são reabertas automaticamente. Rollback seguro preserva evidências/reservas e suspende o ato sob autorização; reverter à versão que promovia HTTP a cancelamento reintroduz o defeito.

## Fechamento delimitado PR315 — rodada 0

Base deste fechamento: `daf6079c6a94ec7a67f728707d765f9fca9739e7`.
**NO-GO funcional: contrato JSON de retorno ainda não verificável.** Conforme a pesquisa oficial informada no pedido, o transporte utiliza JSON, mas seus campos não estão comprovados. Não foram inferidos campos, envelopes ou regras de extração. A aceitação de XML bruto em testes não demonstra compatibilidade com o retorno real. Este fechamento não homologa cancelamento nem consulta fiscal e não declara `ready_for_human`.

Correção restrita à origem da evidência: POST e GET do cancelamento passam `proxy: false` por requisição, impedindo herança de proxy do Axios nessa operação. Defaults compartilhados, TLS com `rejectUnauthorized: true`, mTLS, timeout e bloqueio de redirects permanecem. As demais operações não recebem essa opção por consequência.

O verificador XML agora retorna `integridadeVerificada: true` e `origemVerificada: false` quando a assinatura embutida é válida. Certificado sintético/autossinado não comprova procedência. O adaptador HTTP interno encapsula o corpo recebido em recibo opaco registrado em WeakMap privado; a composição verifica esse recibo antes de promover a origem. Texto XML, objetos com `origemVerificada`, cópia ou serialização do recibo não substituem a passagem pelo adaptador. Esse mecanismo delimita a procedência interna do transporte configurado; não cria PKI, confiança na cadeia do certificado embutido ou proteção contra código interno malicioso. Testes positivos simulam explicitamente o adaptador e não representam validação remota.

Complemento após revisão de segurança: o recibo inclui snapshot imutável de empresa, CNPJ, chave e ambiente da coleta, além da operação e URL de destino. Antes de interpretar o XML, o verificador compara esses dados com o contexto consumidor. Hosts, HTTPS e caminhos oficiais específicos são validados por ambiente; query, fragmento, credenciais na URL, portas alternativas e chave divergente são recusados. As requisições usam a URL absoluta validada, `proxy: false`, `maxRedirects: 0` e timeout de 15 segundos. O cliente compartilhado e o wrapper usado por outras consultas permanecem inalterados.

Reexecução complementar autorizada: **3 suítes e 112 testes aprovados**, cobrindo política/assinatura/procedência, fachada de cancelamento e configuração anterior aos efeitos. Inclui troca de contexto A→B/CNPJ/chave/ambiente, mutação posterior do objeto original, destinos incompatíveis e JSON forjado. Nenhum teste consulta provedor real. O executor do controlador estava concluído; o principal encerrou o controlador em testing antes desta complementação para impedir conflito de escritores, preservando o histórico sem declarar ready_for_human.

Contexto dono: Fiscal/NFS-e; composição API e fachada `NfseService.sendEvent` conectam o transporte ao caso de uso existente. Escritório/web, portal e comunicação continuam recebendo inconclusivo sem prova suficiente. Consumidores indiretos de Contabilidade, Guias, Operações e Comercial conservam contratos, permissões e persistência; nenhuma alteração nesses módulos, em schema, eventos, rotas, configuração ou governança. Regras preservadas: R02, R19, R20 e seções 30/31 (resultado fiscal comprovado, identidade, autorização e ausência de repetição incerta). Risco alto por determinar admissibilidade de evidência fiscal.

Validação desta rodada:

- Adicionados cenários focais para `proxy: false` no POST/GET pela fachada, integridade sem origem, certificado sintético não confiável, transporte falso sem origem em reserva nova/antiga, recibo não copiável e JSON desconhecido mesmo vindo do adaptador. Casos positivos identificam a simulação de procedência.
- Tentado em `apps/api`: `node ../../node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/application/nfse/__tests__/confirmacaoFiscalCancelamento.test.js src/application/nfse/__tests__/cancelamentoEvento.test.js`. Não executou testes: Node v20.20.2 encerrou com código 1, `EPERM: operation not permitted, lstat 'C:\Users\yagoa'`.
- Tentado `node scripts/governance/check.mjs plan --base daf6079c6a94ec7a67f728707d765f9fca9739e7`: mesma restrição antes de executar o plano. Nenhuma permissão foi alterada.
- `git diff --check` passou. SHA-256 da fonte operacional canônica conferido: `4edbbc7134008570aa1152d34019c467afabd3aa6768dc89c80830ac166f6113`.

Conclusão do principal: 170 testes em seis suítes aprovados (incluem os 112 acima); 16 testes PostgreSQL 16 de cancelamento explicitamente habilitados e três testes Guru/HTTP aprovados. Cinco testes arquiteturais passaram; diagnose 5020/5020, zero novas violações. A primeira execução PostgreSQL deixou os 16 desabilitados por flag e foi repetida corretamente; não foi contada como aprovação.

Segurança independente: GO restrito à origem, 54 testes aprovados e quatro ensaios com adaptador real/Axios sob proxy sintético, POST/GET em produção/homologação, interceptados antes de qualquer conexão. Fiscal independente: NO-GO funcional. Integridade com certificado embutido não comprova autoridade, cadeia ICP-Brasil, validade ou revogação; a âncora de procedência é o transporte oficial autenticado, sem aceitar XML avulso.

| Formato recebido | Resultado | Limite |
|---|---|---|
| XML textual individual válido, com recibo do adaptador | Interpretável conforme tipo existente | Teste sintético não homologa envelope produtivo |
| XML avulso ou objeto com origem alegada | Não confirma | Certificado embutido não basta |
| Objeto JSON, JSON textual ou lista de eventos | Inconclusivo | Incompatibilidade com o envelope documentado; bloqueio funcional |
| Vazio, malformado ou HTTP 200 sem evento | Inconclusivo | Não altera situação fiscal |
| Contexto de empresa/ambiente/chave/CNPJ divergente | Rejeitado | Não transfere procedência |

O Manual API §1.5 (página 5 do PDF) define comunicação JSON e XML fiscal assinado; o Manual ADN §1.1.1 (página 3) informa retorno de todos os eventos. Os campos exatos não puderam ser comprovados no Swagger oficial acessível. Não foram importados contratos de NFS-e Via ou APIs municipais. Um ato aceito pelo provedor pode permanecer inconclusivo localmente e conservar a reserva: a limitação impede integração funcional, não é simples homologação opcional.

Escritório, portal e assistente convergem em NfseService.sendEvent e na mesma política fiscal; não foi identificado caminho alternativo que promova HTTP 200 a cancelamento. Nenhuma regra de outro domínio foi alterada.

Controlador desta revisão: 2026-11-22T19-57-52-815Z-08ccc40d, executor concluído, 88 testes de governança aprovados. Gate API registrou 1554 aprovados, um falho e duas suítes não iniciadas por falta de URL de banco descartável. Principal interrompeu os gates e concluiu a proteção contextual com executor e revisores independentes; logs preservados, sem ready_for_human. Os resultados de CI do novo SHA ficam registrados no PR; 7/7 do SHA anterior não substitui a nova execução.

Pendência: obter o contrato oficial verificável dos envelopes e caracterizá-lo antes da adaptação. Não inferir campos nem liberar retransmissão. Sem merge, deploy, produção, mensagens ou chamadas fiscais reais.

Rollback: suspender o ato e corrigir prospectivamente preservando reservas/evidências. Reverter esta separação restauraria a promoção indevida de assinatura a origem; não é uma recuperação funcional segura. O fechamento não modifica dados existentes.

Regressão adicional de portal e portão fiscal: 68/68 testes aprovados. O PostgreSQL descartável foi encerrado após os testes, com seus arquivos preservados.

## Causa e impacto

A base devolvia accepted para qualquer HTTP 200. Escritório, cliente e assistente promoviam esse aceite a cancelled sem interpretar evento fiscal. A reprodução anterior à correção passou 28 testes; a expectativa insegura foi substituída por inconclusivo. Não há evidência de ocorrência produtiva investigada nesta entrega.

NFS-e é dona da decisão, reserva, identidade, custódia e projeção. Nenhuma regra de Apuração, Guias, Contabilidade, calendário IBS/CBS ou sincronização ADN é modificada. Impacto autorizado: apenas comprovação fiscal válida pode anunciar cancelamento; pendência, indeferimento e incerteza preservam o estado anterior.

## Contrato oficial

- [Manual Integrado API nacional v1.2/out2025](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf), §1.5.
- [Manual ADN v1.0, 12/02/2026](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf), §1.1.1: retorno de todos os eventos.
- [Anexo II eventos v1.01-20260122](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_ii-sefin_adn-pedregevt_evt-snnfse-v1-01-20260122.xlsx/@@download/file): evento/pedido e tabela de eventos únicos. nSeqEvento=001 para os quatro tipos abaixo.
- XSD tiposEventos_v1.01.xsd já versionado: descrições, motivos e campos condicionais.

| Resultado | Base | Candidata |
|---|---|---|
| HTTP 200 sem evento verificável | Aceite tratado como cancelamento | INCONCLUSIVO; não altera nota |
| 101101 válido | Sem distinção fiscal | CONFIRMADO; CAS local |
| 101103 solicitação | Aceite tratado como cancelamento | PENDENTE; não altera nota |
| 105104 deferimento válido | Sem distinção fiscal | CONFIRMADO por consulta/recuperação |
| 105105 indeferimento válido | Sem distinção fiscal | INDEFERIDO; não altera nota |
| Timeout, vazio, malformado ou HTTP sem prova | Classificação pelo transporte | INCONCLUSIVO; reserva impede retransmissão |
| Identidade/empresa/ambiente divergente | Não conferido no aceite | Não confirma nem custodia XML alheio |
| Resposta antiga após confirmação | Sem coordenação comum | Não rebaixa confirmação persistida |

tpAmb é ambiente; ambGer é gerador. Autor municipal não é confundido com CNPJ da prestadora. A chave deve coincidir com a nota e IDs EVT/PRE. Assinatura externa referencia o único infEvento, sem IDs duplicados, DTD, entidades ou transformações arbitrárias. Campos obrigatórios, motivos e descrições específicas são conferidos. Certificado embutido comprova integridade criptográfica, não toda a cadeia ICP-Brasil; procedência depende do transporte oficial mTLS/TLS interno, nunca de atributo do navegador.

## Composição e persistência

NfseService.sendEvent preserva a fachada e precedência de motivo/justificativa. O caso de uso em modules/nfse/application/cancelamentoFiscal.js depende de operações específicas. Política pura reside em domain, XML/criptografia no adaptador HTTP, reserva/CAS no adaptador Prisma. Os três consumidores não escrevem cancelled independentemente.

Sem schema ou migração. AppSetting guarda reserva por hash empresa+ambiente+chave e evidência por hash do XML. Custódia é confirmada antes da transação curta de projeção, sobrevivendo a rollback/conflito. ServiceInvoice é consultada por empresa+chave; ambiguidade impede execução. Escrita exige ID, empresa, chave, status e updatedAt originais. PortalInvoice continua sob captura ADN. Revisão do período e capacidade existente de aviso são preservadas.

Nenhuma transação permanece aberta durante rede. Reserva existente permite somente consulta; não expira para novo POST. Reservas WhatsApp antigas são conservadoras: ACEITO não comprova cancelamento. Autorização canônica, sessão, vínculo e portão fiscal são relidos após certificado/assinatura; nota, empresa e ambiente são reconferidos antes do despacho.

## Limitações e riscos

1. Envelope JSON de eventos não foi homologado a partir de Swagger oficial acessível. XML oficial verificável é aceito; JSON desconhecido permanece inconclusivo. Recuperação com XML sintético válido é testada; não se declara consulta produtiva homologada para envelope desconhecido. Nenhum campo JSON foi inventado.
2. HTTP 4xx sem evento comprovável permanece desconhecido. Transporte não prova situação fiscal nem indeferimento.
3. Reserva NAO_ENVIADO não autoriza retransmissão automática. Falha anterior ao POST requer procedimento supervisionado posterior; este PR não desbloqueia reservas.
4. Nota legada sem ambiente explícito, identidade ambígua ou revisão concorrente bloqueia despacho. Não se presume ambiente pela configuração.
5. Envio manual e105102 já era vedado pela decisão operacional documentada no serviço. Agora falha fechado antes da rede; não implementa substituição nem permite contorno da comprovação.
6. Nenhum saneamento de estados antigos, backfill ou chamada fiscal real.
7. Controlador original interrompido após caracterização por orientação equivocada sobre modelo inexistente. ServiceInvoiceEvent não existe e não é requisito do usuário. Principal autorizou continuação com AppSetting existente. Não foi declarado ready_for_human; registro de governança preserva resultados reais e revisões.

## Evidências e rollback

Política/aplicação e assinatura com chaves sintéticas efêmeras: 32 aprovados; 27 testes de ambiente aprovados. HTTP/portão/cliente/assistente: 115 aprovados, mais dois testes posteriores de revogação no cancelamento WhatsApp aprovados. Caracterização legada e contenção de substituição manual: 29 aprovados. PostgreSQL 16: 16 aprovados, duas conexões, reserva, replay, CAS, custódia tardia, rollback e isolamento. Regressão ampliada: 184 suítes, 3439 testes aprovados; duas expectativas/fixtures antigas e quatro suítes sem URL PostgreSQL falharam. Reexecuções afetadas aprovadas: contratos do assistente 31/31, ambiente/política 59/59 e Guru PostgreSQL 5/5. Não se declara repetição integral após esses ajustes. CI final registrada no PR. Testes não equivalem à homologação fiscal produtiva.

Rollback não apaga AppSetting nem evidências. Reverter à versão que tratava aceite como cancelamento reintroduziria o defeito; em incidente, suspender o ato de cancelamento e corrigir prospectivamente sob autorização, preservando documentos e reservas. Nenhum merge, deploy ou exclusão de dados nesta execução.
