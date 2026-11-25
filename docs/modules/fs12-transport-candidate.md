# Integração candidata transporte/B31 FS12 — não executada

Este overlay substitui somente seus arquivos homônimos sobre prepared/source. Não editar a árvore versionada nem os candidatos de runtime de outro autor. Canônica e cópia99a27e4a2191f8243cffa662e18074ea92216bb4cad4ec0b08caa42d650cb745. Impacto técnico R01/R02/R05/R06/R19/R20/seção38; nenhuma regra tributária nova, alteração de certificado/config/grants, HTTP real ou ativação produtiva.

## Ligação concreta

SerproHttpClient chama prepararTransporteComandoFs12. Sem contexto opaco, guarda existente continua recusando11/12 e2027. Com contexto interno registrado, somente TRANSDECLARACAO11, POST /Declarar, PA11/12, CNPJ e bytes EXATOS são elegíveis aos próximos gates; não é autorização antecipada de envio. Uma capacidade só entra uma vez, não pode ser objeto/booleano/header do navegador. Outras APIs conservam caminho/cache anterior. Novo contexto não habilita PA2027.

O wrapper do envelope deve ter a serialização exata usada por SerproPgdasdService; depois da conferência, Axios envia esse Buffer congelado. Sem params alterando endpoint. Captura arraybuffer preserva bytes da entidade HTTP observada pelo Axios, antes da transformação JSON (não promete bytes brutos de compressão no fio). Limite16MiB explícito; excesso sem resposta completa permanece incerto.

SerproCallGuard: identificação PGDAS agora reconhece pa/_periodoApuracao, evitando competência null nas reservas. Identificação de outros serviços permanece igual. Na reserva, acaoId/comando e autor vêm do contexto interno e T1 persistido; criação de ledger e associação FS12 são a MESMA TX. Falha reverte reserva. T2 mantém locks global/empresa/política, adquire coordenação FS12, relê ACL/cadastro/FS12/preparo/cálculo e somente depois grava marcador. Retorno do marcador à capacidade ocorre depois do COMMIT. Política/revisão recusada antes do marcador gera abortada_politica; sem HTTP. Não existe HTTP dentro de TX ou retry.

Snapshot transmitindo próprio: somente T2, com comandoId exato em _portalTransmissao e idempotencyKey igual ao calculoId congelado. erro_transmissao permanece bloqueado; outro comando/PA/revisão não ganha exceção. A composição de Fechamento de outro candidato deverá persistir essa identidade antes do guard.

HTTP sucesso e error.response são capturados antes de interpretar/mapear erro/finalizar ledger: observarResposta recebe {comando,reservaId,marcador,corpo:Buffer,httpStatus,recebidoEm}. A composição deve executar stage cifrado → T3a e retornar {respostaId,custodiaId,stageId,corpoHash}; hashes/identidade são verificados pelo contexto. Não há leitura DB obrigatória entre recepção e primeira escrita do stage: marcador veio de T2. Se stage/custódia falha, ledger não é finalizado; reserva impede repetição. Timeout sem resposta é incerta no ledger e não inventa custódia. JSON inválido é custodiado antes de erro; segue sem conclusão fiscal. Cache legado é ignorado nesse caminho e não vira resposta oficial nova.

resultadoComandoFs12(capacidade) expõe somente comando/tentativa/reserva/resposta/custodia/stage/hash, para o coordenador T3b. Mesmo após saída/falha pode devolver metadado já custodiado. Sem novo envio por replay: recuperação local deve ler respostaId/cadeia persistida e chamar T3b diretamente, não abrir outra capacidade/HTTP.

## Contrato público interno e arquitetura

publicComandosFs12.js é fachada explícita do contexto Fiscal. AsyncLocalStorage/WeakMap estão em infrastructure/context/comandoFs12Context.js; domínio permanece puro. Aplicação coordenarComandoFs12 depende de portas e do domínio. O legado de transporte importa apenas o ponto público; infraestrutura de contexto chama os casos de uso transacionais pelas portas da composição. Não há service locator geral, env ou Prisma global novo nesse contexto. Não expor fábrica/funções em rotas.

criarContextoComandoFs12({comando,envelopeBytes,persistencia,observarResposta}) devolve objeto opaco sem campos serializáveis; comComandoFs12(cap,fn) delimita vida útil; cópias de comando/bytes impedem alteração posterior do chamador. O conteúdo persisted esperado é comparado ao comando real dentro da TX antes dos hooks. Contexto fechado não pode ser reaproveitado, inclusive por tarefa async que conserve ALS.

exigirDespachoComandoFs12({competencia}) é a guarda interna disponível ao candidato PgdasSimulacaoService; ela não substitui conferência dos bytes nem T2. A configuração produtiva/runtime continua responsabilidade da composição protegida, não de flag/header arbitrário.

B31 agora coordena dentro da TX no início de autorizar, ANTES de locks/leituras ACL/contexto/revisão. Uma TX só admite um escopo. Retry bounded de serialização reinicia a TX inteira; tradução P2010 só para meta.code40001. Ponte de T1/T2 declara coordenacaoExterna já adquirida e não reabre transação ou retry em TX abortada. B31 legado mantém contrato público de transacionar. Leituras sem escrita não incrementam coordenação.

T1 grava esperado.preparacao=provaPreparacao exata, autenticada por preparoHash; T2 entrega preparacaoOriginal/comandoId ao preparador servidor e compara hash. Isso permite T3b após reinício sem refazer seletor/reconstruir dados novos. Não há B32 fictício. Mensagens distinguem revisão alterada, vínculo ausente, preparo indisponível, replay conflitante e tentativa pendente.

## Evidências preparadas e limites

- serproFs12Custody.test.js: caminho real de SerproHttpClient/ALS com guard e HTTP dublados; sucesso/error.response, ordem custódia-finalização, cache, timeout, falha local, malformed JSON e capacidade/envelope indevidos. Não prova PostgreSQL/T2.
- fs12CoordenacaoB31.test.js: ordem coordenação/ACL, retry40001 e não-retry23514.
- transport.postgres.test.mjs: modelos reais B31/T1/reserva/T2, rollback de associação, ACL/revisão alterada, e alteração da porta sintética de receita/preparo. Nenhuma chamada HTTP. Receita desse ensaio é fixture AppSetting: não alegar cobertura da ingestão NFS-e real.
- command.unit.test.mjs ajustado à preparação congelada.
- Harness de dois processos do candidato anterior continua prova preparada de coordenação técnica. Concorrência completa T2 versus confirmação B31 em processos independentes, ponta a ponta de captura/stage/T3a/T3b/Fechamento e navegador ainda exigem ensaio integrado; não alegar que este overlay prova esses cenários.

Nenhum Node, teste, build, PG, CUA ou controlador executado nesta preparação. Nenhuma aprovação técnica, publicação ou E2 completa.

Limitações de integração: composição deve fornecer cifra de envelope com chave já resolvida/local para não efetuar KMS/HTTP dentro de TX; preservar a fonte original de preparo e resolver tentativas causalmente. Volume/keyring e adaptador real de plataforma permanecem preparação protegida do Principal. Não substituir fsync por no-op em E2E. Pausas, política fiscal, ACL, cache de demais serviços, R25/R26 e2027 permanecem protegidos. Logs brutos não devem conter bytes/headers/chaves.
