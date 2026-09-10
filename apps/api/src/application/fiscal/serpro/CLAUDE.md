# Guarda SERPRO — 2026-09-08

O ledger `SerproChamada` registra tentativas internas, não comprova cobrança. Não afirmar que o total de 2.555 relatado pelo usuário foi conciliado: faltam período, origem e extrato do provedor.

`autorizarChamada` reserva antes de autenticar/enviar. Transação PostgreSQL ReadCommitted com `pg_advisory_xact_lock(73517001)` serializa a checagem dos tetos e criação da reserva globalmente neste banco. Não manter a transação aberta durante HTTP. O modelo atual não tem firmId: o teto mensal é da instalação/contrato, não um isolamento multi-escritório.

Estados que ocupam orçamento: `reservada`, `ok`, `erro`, `incerta`. Auth/certificado que falha antes do envio vira `abortada_auth` e libera o orçamento. Falta de resposta após tentativa vira `incerta`; falha ao finalizar mantém reserva e produz erro visível. Medição/registro indisponível nunca deve retornar consumo zero nem autorizar HTTP. Não expirar automaticamente reservas: ausência de resposta não prova ausência de processamento.

Assinatura igual em `reservada`/`incerta` bloqueia indefinidamente, inclusive com guarda desligada ou forçar. Após resultado conhecido, cooldown configurado aplica a sucesso/rejeição; HTTP 429/5xx usa mínimo entre 30s e configurado, 202/304 conhecido libera polling. Cooldown não é fila: consumidores precisam respeitar o erro antes de reagendar.

Override libera apenas teto, requer contexto forcar=true e userId; as rotas continuam responsáveis por validar ADMIN usando `podeForcarSerpro`. A reserva registra `forcado`, `userId`, `origem`. Não libera medição indisponível, chamada pendente ou cooldown. Não há endpoint de resolução manual de incertas: precisa ser implementado com conciliação e trilha de auditoria antes de liberar uma reserva.

Datas de orçamento: mês/dia civil de São Paulo, pelo createdAt da reserva; pendências de meses anteriores continuam bloqueando sua assinatura, mas não entram no número do mês atual. HTTP 200 não implica sucesso fiscal nem faturamento confirmado. Hash usa JSON canônico e rota (atualização de 09/09); também verifica a assinatura legada. Não substitui idempotência de negócio dos serviços.

Workers PGDAS-D, DCTFWeb e confirmação de pagamento atribuem origem explícita e preservam contexto existente. Novos consumidores devem usar SerproHttpClient e propagar contexto; integrações fora dele não são contabilizadas aqui.

Testes locais sem DB/HTTP: serproCallGuard, serproReserva e serproHttpReserva (28 testes). Concorrência usa transaction mock serializado, não é teste de integração PostgreSQL. Validar a semântica do lock em banco isolado antes do rollout, sem gerar chamadas pagas. Diagnóstico `scripts/diag-consumo-serpro.mjs` é somente leitura e separa reservas/incertas/auth abortada; não foi executado contra dados reais nesta revisão.

Ensaio de integração: `scripts/verify-serpro-reservations-postgres.js` usa exclusivamente o banco descartável `whatsapp_delivery_check` em 127.0.0.1:55439, usuário whatsapp_check, com migrations e ledger inicialmente vazio. Aceita `--url` ou DATABASE_URL validado antes de importar o guard. Faz 12 reservas paralelas reais, disputa diária/mensal, auth abortada, timeout e override auditado; não envia HTTP. Limpa apenas registros com origem UUID da execução. Rodar sequencialmente no CI para evitar interferência no teto global. A criação do script e validação sintática não equivalem à aprovação do ensaio: exigir resultado PASS no PostgreSQL.

## Redução de chamadas repetidas — 2026-09-09 (alteração local)

A assinatura agora usa JSON canônico (inclusive `pedidoDados.dados`); a guarda também procura a assinatura legada para preservar bloqueios existentes. `competencia` e `acaoId` permitem agrupar tentativas; o ID acompanha contextos aninhados. Não são valores faturados.

Captura normal reutiliza guia SERPRO PROCESSED com PDF local, mesma empresa/competência/tipo e sem parcelamento. Recálculo explícito (`atualizar`, `existingGuideId` ou data de consolidação) busca uma versão nova, mantendo tetos e bloqueios. Extrato completo salvo é reutilizado; o botão Atualizar na Receita solicita atualização. Ausência de declaração sem DAS é reaproveitada por uma hora. Ler a circular ANTES de marcar RUNNING.

`SerproRespostaCache` conserva respostas HTTP 200 dos serviços documentais explicitamente permitidos por uma hora, antes do processamento local. Não inclui transmissão, índice de declarações, pagamentos nem SITFIS. Não guarda cabeçalhos ou tokens. Consumidores continuam validando o resultado fiscal. Expirados são ignorados e removidos nas próximas gravações. Falha de leitura impede HTTP; falha de persistência após resposta mantém reserva aberta. Exige migration e Prisma Client novo antes de subir a API.

Após transmissão, somente a consulta CONSDECLARACAO13 pode dispensar cooldown no contexto interno `reconsultarAposTransmissao`; reservas pendentes e tetos continuam bloqueando. O fechamento reutiliza o índice prévio quando já havia declaração e não captura DAS novamente quando a sincronização já o devolveu. Falha de atualização do PDF não libera guia antiga para reenvio como retificada.

Ajuste automático de períodos: máximo três tentativas por ação. SITFIS: máximo três consultas de relatório por execução, preservando protocolo/espera. Token de autenticação compartilhado por credenciais/certificado dentro do processo, com proteção contra autenticações concorrentes. Lote da interface para ao atingir teto mensal ou indisponibilidade/resultado indeterminado da medição.

Validação: 425 testes de backend e build aprovados; todas as migrations e oito verificações reais de reservas/cache passaram em PostgreSQL descartável local, sem HTTP fiscal. Usuário autorizou publicação em 09/09; acompanhar regressão da interface no CI antes do merge.
