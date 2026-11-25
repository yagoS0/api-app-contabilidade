# T3a FS12: candidato de custódia Prisma, NÃO EXECUTADO

Escopo: somente artefatos ignorados preparados para próximo controlador. Não incorporado, não testado, não aprovado; não modifica gates, privilégios ou DDL. Nenhum PostgreSQL foi acessado. Impacto R01/R02/R05/R06/R20 e seção38: preservação da prova original, sem nova regra fiscal ou estado. Referência SHA256 99a27e4a2191f8243cffa662e18074ea92216bb4cad4ec0b08caa42d650cb745.

Dono Fiscal; adaptador infraestrutura Prisma recebe db, cifra, custodianteId e capacidadeId pela composição interna. Nenhum export HTTP ou cliente Prisma global. Consumidores futuros: stage local e coordenador T3a. T1/T2/T3b não implementados. Custódia não confirma transmissão, não cria associação de cálculo e não toca pagamentos/guias/contabilidade.

## Contrato de origem

T1 FUTURO deve persistir ANTES do despacho em Fs12Comando.esperado.custodia o objeto exato {respostaId,custodianteId,capacidadeId}. respostaId é prealocado estável; stageId = SHA256 UTF8 respostaId. Não obter esses campos do navegador. Ausência da convenção recusa recuperação, sem backfill presumido.

resolveOrigin({stageId,respostaId,comandoId,tentativaId,reservaId}) recebe somente pistas. Reconstrói os 14 campos do stage corrigido a partir de comando original, reserva, ledger e marcador. Não precisa saber corpoHash/httpStatus/recebidoEm antes da resposta. Estes são observação autenticada pelo AAD. Releitura usa revisão ORIGINAL imutável, mesmo se houver confirmação posterior; não confere revisão atual para custódia nem promove resultado antigo.

Marcador: chave serpro_dispatch:<reservaId>; hash SHA256 de JSON UTF8 com chaves de objetos recursivamente ordenadas e ordem de arrays preservada, sem coerção de tipos. T2 FUTURO precisa compartilhar essa convenção. envelopeHash vem da reserva imutável e é confrontado ao AAD; este adaptador não autentica/decifra o envelope de envio (capacidade própria de T2, contrato diferente da cifra da resposta).

## Importação e receipt

importDurably({id,contexto,corpo,envelope,contextHash}) valida identidade/hash e decifra por cifra injetada, comparando bytes. Faz cópia dos bytes/envelope antes dos awaits. A origem é novamente reconstruída na transação; ledger e marcador recebem FOR SHARE. Comando/reserva já têm proteção DDL imutável. Só Fs12ComandoResposta é inserida.

Replay compara todos os campos semânticos observados, incluindo recebidoEm e marcador; autentica o envelope armazenado e compara bytes. Nonce/ciphertext diferentes são permitidos se preservam semântica. Colisão por id ou UNIQUE(comandoId,corpoHash,httpStatus) com outra observação é conflito explícito, não deduplicação silenciosa. Apenas corrida P2002 recebe uma nova transação para releitura e comparação. Nenhum HTTP ou reenvio nesse retry; nenhum retry na transação abortada. Chaves históricas devem ser resolvidas por capacidade local pré-carregada neste trecho (não introduzir rede dentro da transação).

Receipt {durable:true,id,corpoHash,contextHash,custodiaId} retorna apenas depois que $transaction resolve o COMMIT. A fábrica é interna: receipt não é aceito do cliente. Falha do banco não remove stage. Recebimento antigo/incompatível pode ser custodiado; T3b deve decidir promoção separadamente.

## Ensaios preparados

Comando FUTURO após incorporação e janela autorizada:
node --test --test-concurrency=1 apps/api/scripts/fs12-custody-prisma/custody.postgres.test.mjs

Exige NODE_ENV=test, ALTAN_FS12_CUSTODY_TEST_URL explícita de banco NOVO EXCLUSIVO loopback127.0.0.1 com sufixo _governance_test, PostgreSQL16, migrations atuais e Prisma gerado. Não iniciar/usar banco de outro chat. O ensaio não provisiona/migra nem altera privilégios.

Reutiliza fixtures SQL sintéticas do DDL existente, sem remover validações. Não desabilita triggers nem apaga fatos imutáveis: linhas ficam no banco exclusivo até descarte pelo provisionador após coleta de evidências. Não apontar ao banco descartável compartilhado de outra rodada. Chaves aleatórias só memória/IPC; sem chave produtiva/env/log/arquivo. Corpos e envelopes fiscais são sintéticos. Provedor HTTP bloqueado nos processos.

Casos: replay com novo nonce; revisão2 não reatribui resposta da revisão1; observação diferente; AAD/cifra adulterada; rollback SQL após INSERT; colisão da chave secundária; cadeia/marker alterados; dois processos Prisma concorrentes; processo encerra após COMMIT e novo processo recupera sem segunda custódia. Não prova falha de energia/SO, transporte oficial, preservação integral do volume, nem interoperabilidade completa stage→Prisma (combinar posteriormente as suítes). A barreira dos filhos precede a operação, não garante colisão exata de INSERT: gate deve analisar cobertura do ramo P2002 separadamente.

## Pendências de incorporação/revisão

- Compatibilizar com stage/cifra finais e conferir hashes; nenhum resultado de execução existe.
- T1 persistir convenção e T2 congelar marcador/identidade original; não aceitar autorização proveniente do arquivo.
- Runtime deve fornecer role mínima de custódia, keyring histórico e volume autorizado; este candidato não concede privilégios.
- Resolver robustez de timeout/process cleanup dos ensaios na plataforma após execução pelo controlador.
- Teste integrado stage com falha DB real e recuperação após reinício, além da prova isolada T3a aqui preparada.
- Reversão conserva evidências e stage; não excluir registros ou migrar dados para esconder conflito.
