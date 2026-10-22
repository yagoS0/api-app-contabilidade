# Reclassificação administrativa de documento

Candidato local com validação e revisões independentes finais favoráveis, conforme evidências abaixo. Sem publicação nem alteração de registros reais. Implementa o requisito já aprovado na seção 28 das regras operacionais: documento de folha cadastrado como guia precisa de correção auditada, conservando PDF e envios. Impacto em R02/R08/R10/R11/R19/R20; nenhuma nova regra fiscal, de pagamento ou de comunicação.

## Operação preparada

O mecanismo administrativo exige sessão autenticada do escritório, acesso ativo de contador/administrador à empresa e confirmação explícita. Não há execução por GET nem detecção automática de folha por nome do arquivo.

1. Consultar `GET /firm/companies/:companyId/guides/:guideId/reclassificacao/previa` no prefixo efetivo da API. A prévia retorna a revisão, hash, impedimentos, efeitos e resumo dos envios preservados.
2. Conferir o documento e todos os impedimentos. Este caminho aceita somente OUTRA processada, com PDF armazenado no banco e hash íntegro; vínculos fiscais, contábeis, pagamento, parcelamento, tarefas ou resultados de envio incertos exigem conciliação própria.
3. Enviar `POST` ao mesmo caminho sem `/previa`, com `confirmado:true`, `revisao`, `idempotencyKey` única, `motivo` e `categoria` (`FOLHA`, `PRO_LABORE` ou `DOCUMENTO_NAO_ARRECADATORIO`). Não reutilizar uma chave com conteúdo diferente.
4. Conferir o documento em Documentos da empresa e sua auditoria. Nenhum envio ao cliente é iniciado por essa operação.

A transação serializável cria o CompanyDocument referenciando os mesmos bytes, grava a auditoria no AppSetting e marca o Guide como documento não arrecadatório. Mantém arquivo/hash, recebimentos, mensagens e tentativas. O documento fica bloqueado para envio como guia, recálculo, baixa, provisão, vínculo a parcelamento e reimportação como guia. Download por Documentos verifica vínculo e hash. Remoção do documento preservado é recusada.

Reservas de envio e escritores contábeis compartilham a trava da guia; atualizações documentais e de pagamento usam revisão e status no CAS. Falha de auditoria desfaz toda a operação. Concorrência ou prévia obsoleta deve resultar em nova conferência, nunca nova tentativa externa automática. Não há migração de schema, UI nova ou script direto de banco para aplicação produtiva.

## Evidências e limites

O controlador foi executado e escalou: primeira execução sem alteração por escopo insuficiente; segunda interrompida pelo timeout do executor. O Principal retomou o patch com executor delimitado. Isso não equivale a `ready_for_human`.

PostgreSQL descartável: sete cenários aprovados (preservação, ACL/bloqueios, rollback, revisão/replay e corridas reais com reserva WhatsApp, e-mail e pagamento). Ensaio fora da descoberta unitária em `apps/api/scripts/verify-reclassificacao-documento.postgres.js`, executado explicitamente por Jest com `--testMatch '**/scripts/verify-reclassificacao-documento.postgres.js'` e `ALTAN_GOVERNANCE_TEST_DATABASE_URL` loopback com nome terminado em `_governance_test`. Não contém skip ou alternativa de produção.

Regressão focal inicial:73/112 aprovados; ampliação:178/215; segunda rodada agrupada:359/362. As três falhas remanescentes eram expectativas de ausência de UPDATE em `guiaAvulsaParcelamento.test.js`, incompatíveis com a trava sem alteração material. O candidato isolado foi aprovado na revisão independente e passou nos 11 testes da suíte. Após o usuário autorizar expressamente “Aplicar candidato e revalidar”, foi aplicado somente o patch SHA256 `328E7A9B77031E6BC6493EB7BDC36037F632D0A306B24016EE57916342BEDFA6`, preservando imports relativos, recusa e provas de ausência de alterações materiais.

Revalidação focal autorizada: **13 suítes, 362 testes aprovados**, exit0 em `.altan-governance/reclassificacao-focused-autorizado.log`. Logs anteriores preservados. A exceção não autoriza outras correções, publicação ou ativação. Naquela etapa, regressão integral e pareceres finais ainda estavam sob conferência; o fechamento posterior está registrado abaixo.

Na regressão integral posterior, a API encontrou 21 falhas em `atendimentoResponsavelWhatsapp.test.js`: o banco simulado devolve o próprio cliente raiz ao abrir uma transação, causando recursão no novo wrapper de reserva. O lote teve 710 testes aprovados. A correção desse outro arquivo não estava coberta pela exceção anterior; candidatos isolados foram preparados e revisados antes da nova decisão registrada abaixo. A regressão web atingiu o limite global após 300 suítes aprovadas; a repetição serial encontrou timeout de 5 segundos em um teste do assistente de parcelamento. A suíte desse assistente passou isoladamente em 21 testes, sem alteração de código ou timeout. Esses resultados não equivalem à aprovação dos gates integrais.

A regressão API seguinte aprovou 325 suítes antes de identificar, no lote14, uma expectativa desatualizada de `guiaDoAvisoCliente.test.js`. O diagnóstico separado dos lotes15–26 aprovou 288 suítes, sem outra falha; isso não substitui o gate integral. O candidato mínimo foi revisado e, após autorização expressa do usuário, aplicado exatamente pelo SHA256 `1D125CD32B9757E62F93934EE486B41563B6AD79AA000711E89DE39A569AAD1D`. Acrescenta somente o filtro documental à expectativa, preservando empresa, guia, liberação, paginação e acesso.

Validação do arquivo real: **5/5 testes aprovados**, exit0 em `.altan-governance/guiaDoAvisoCliente-autorizado.log`. Nenhum produto, gate ou timeout alterado. As regressões integrais foram executadas sequencialmente pelo Principal, com conclusão registrada abaixo; a autorização não permite publicação ou ativação.

## Fechamento da validação

- API: gate concluído com exit0, manifest `api-vGcTAS`, log `reclassificacao-api-ultimo-autorizado.log`. Foram descobertas638suítes/11234testes:637suítes/11233testes aprovados e um teste ignorado de `coerenciaComercialP0`, que exige sua variável própria. O gate não teve zero skips.
- Complemento explícito: o teste de `coerenciaComercialP0` passou com `ALTAN_P0_DATABASE_URL` apontando para PostgreSQL descartável loopback, exit0 em `reclassificacao-comercial-pg-complementar.log`. Entre as duas execuções, todo o catálogo de638suítes/11234testes foi exercitado com sucesso, preservando a distinção entre os logs.
- Web: regressão integral exit0, manifest `web-s8BULY`,518suítes/5899testes aprovados, zero skips.
- Permanecem válidos engine72, portal1580, buildsweb/portal e os sete cenários PostgreSQL anteriores; nenhuma mudança posterior de produto invalidou essas evidências.

Revisor de domínio/backend/consumidores emitiu parecer final favorável, conferindo o fingerprint dos25JS de produto e as evidências API11234 incluindo complemento,web5899 ePG7. Check de impacto aprovado com unknown[] e riscohigh. Parecer sistêmico final também favorável, conferindo o mesmo fingerprint, a resolução de Calendário/Fluxo e os logs, sem bloqueador de produto remanescente. O executor não declara `ready_for_human` do controlador escalado. Nenhum commit/publicação, dado real, mensagem ou ativação foi realizado por este incremento. Os resultados históricos abaixo não substituem nem alteram esta conclusão das execuções finais.

## Pendências operacionais separadas

Os candidatos restritos a `atendimentoResponsavelWhatsapp.test.js` e `envioTentativas.test.js` passaram isoladamente em 92 e 7 testes e receberam revisão independente favorável. Após autorização expressa “Aplicar os dois candidatos e revalidar, sem publicar/ativar”, foram aplicados exatamente os patches de hashes SHA256 `24A1E2D936B679C4EC2F20DF526F93129E6D1D25D67D6C0F3EFF8B887FF3B674` e `C4A036B554E2B674AA098E8F0B804685F3820B2B8665D44FB43EF4A8C1ECD3E3`, preservando imports relativos, rollback, correlação, callbacks e todas as verificações anteriores.

Revalidação consolidada nos arquivos reais: **18 suítes, 532 testes aprovados**, exit0 em `.altan-governance/compatibilidade-reservas-autorizado.log`. Abrange os 99 testes dos dois arquivos e os 440 do lote anterior, executando os sete sobrepostos somente uma vez. Nenhuma alteração adicional de produto, gates ou timeouts. Naquela etapa, os gates integrais ainda estavam pendentes; o fechamento posterior está registrado acima. A decisão não autoriza publicação nem ativação.

O candidato isolado e seu diff permanecem em `.altan-governance/candidato-guiaAvulsaParcelamento.*` para auditoria da aplicação autorizada. O Principal também confirmou engine72, portal1580 e builds web/portal aprovados. Essas evidências anteriores foram complementadas pelos gates integrais e pareceres finais registrados acima.

- PR240 já publicado na main `ad8763202b33d2c7260a224b26e5b382fd539ba1`; este candidato ainda é local.
- Por decisão expressa, 30 guias antigas de 16 empresas permanecem bloqueadas para lembretes; somente novos envios com prova válida poderão ser acompanhados. Não reconstruir evidência com dados atuais, reenviar ou baixar para desbloquear.
- Sintropia está fora desta operação e da ativação proposta.
- Meta aprovou `guia_pagamento_no_vencimento_v1` como MARKETING. O contrato exige UTILITY e o validador o recusa. Não alterar a categoria aceita nem registrar aprovação local incompatível. O usuário segue sem acesso ao Meta para revisão dessa categoria.
- Agenda de lembretes permanece desligada; nenhuma empresa foi selecionada. Horário solicitado é 8h Brasília e os marcos seguem o calendário útil existente. Consultas fiscais permanecem independentes. Ativação exige decisão posterior, após resolver bloqueios.

## Autorização de integração — 22/10/2026

O usuário autorizou abrir PR, integrar na main e publicar após CI e revisões aprovados, com conferência posterior no app. A condição final do pedido mantém os lembretes desligados e a Sintropia excluída. A área existente em Configurações da empresa → Automação foi revisada e permite selecionar/desativar, conferir e salvar independentemente da agenda global; nenhuma alteração adicional de produto foi necessária. Não autoriza executar reclassificações reais ou enviar mensagens. Sem nova regra operacional.

## Reversão

Antes de aplicação produtiva, reverter o commit não requer migração. Depois de qualquer reclassificação real, não reverter para código que desconheça o marcador: conservar bloqueios e referências até conciliação auditada. Não apagar AppSetting, Guide ou CompanyDocument para simular rollback, nem devolver automaticamente o documento à cobrança. Preservar dados e agenda desligada enquanto se prepara correção compatível.
