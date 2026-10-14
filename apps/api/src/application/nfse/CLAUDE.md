# Emissão nacional — proteção contra regressões

## Conciliação de DPS ocupada — 13/10/2026, PR #163

`conciliacaoDps.js` apenas consulta e compara documentos. A decisão de persistir ou reservar outra numeração pertence a `NfseService`. Preservar as três saídas:

- `MESMA`: equivalência fiscal do XML enviado com a DPS oficial, identidade/ambiente consistentes e ausência de eventos explicitamente comprovada no ADN. Recuperar a nota existente, sem novo POST de emissão.
- `OUTRA`: XML oficial válido e divergência comprovada nos campos da operação reconhecidos pelo comparador. Somente depois da recusa explícita E0014 esta saída permite avançar a numeração.
- `INCONCLUSIVA`: manter bloqueado. Timeout, erro de TLS, 404 sem prova suficiente, XML inválido, identidade divergente ou diferença fiscal não resolvida nunca autorizam novo envio ou avanço.

Não simplificar a comparação para chave, valor ou CNPJ isolado. Conferir namespace, estrutura única, ID da DPS, prestador, ambiente, série/número, chave da NFS-e, número fiscal e `cStat`. A comparação canônica ignora apenas os campos técnicos previstos no código (`dhEmi` e `verAplic`); outros campos fiscais continuam significativos. Manter limites de tamanho/descompactação, rejeição de DTD/entidades e bloqueio de redirecionamentos.

O XML original pode continuar disponível após cancelamento. Por isso, uma candidata a `MESMA` exige `GET /NFSe/{ChaveAcesso}/Eventos` no ADN do mesmo ambiente, com mTLS da própria empresa. Não inventar o endpoint de todos os eventos na Sefin. O contrato conferido foi `https://adn.nfse.gov.br/contribuintes/swagger/v1/swagger.json`: aceitar ausência somente com ambiente correspondente, `StatusProcessamento=NENHUM_DOCUMENTO_LOCALIZADO`, propriedades `LoteDFe` e `Erros` presentes e explicitamente `null` ou `[]`, sem alertas. Evento existente ou resposta ambígua mantém `INCONCLUSIVA`; não tratar qualquer evento como cancelamento confirmado. Não remover essa consulta para contornar indisponibilidade.

## Numeração, persistência e concorrência

- `issue` faz no máximo **três tentativas totais**, não três adicionais. Só E0014 + `OUTRA` autoriza a próxima reserva transacional. Demais recusas/erros seguem seus tratamentos existentes.
- Persistir XML enviado e configuração fiscal antes do POST. Guardar a prova da conciliação e o encadeamento de tentativas; nunca associar a chave de outra operação como chave fiscal da tentativa recusada.
- Manter `reservarNumeracao`, unicidade, contador transacional e `claimRetry`. Não incrementar um contador manualmente, reutilizar número incerto ou substituir a tentativa anterior por uma nova silenciosamente.
- Atualizar o vínculo de lote/agendamento com `antesDeEnviar` antes de cada POST, inclusive após nova reserva. Falha ao persistir deve impedir o próximo envio.
- `conciliarTentativa` consulta uma tentativa já persistida; não chama `issue`, não reserva número e não envia DPS. Aceita apenas os estados e falhas previstos no código. `pending` não é autorização para recuperar automaticamente uma chamada possivelmente em andamento.
- Validar empresa/titularidade antes de certificado ou rede. Rotas do contador e cliente preservam autorização e resolução dos IDs; empresa do body não pode substituir a empresa autorizada da URL.
- Aplicar o resultado manual com compare-and-set de ID, empresa, status e `updatedAt`; mudança concorrente retorna conflito. Não sobrescrever resultado mais recente.
- O atalho de uma nota já `issued` com chave retorna o estado salvo. Não apresentá-lo como nova comprovação da situação fiscal atual no autorizador.

Os adaptadores HTTP ficam em `src/routes/nfseConciliacaoHttp.js`, `src/routes/nfse.js` e `src/routes/client/index.js`. Não transformar erro de autorização ou de consulta em autorização para emitir. Preservar o bloqueio de emissão de 2027 antes de reserva e chamadas ao autorizador.

## Verificação obrigatória quando esses caminhos mudarem

Executar os testes pertinentes com rede simulada: `__tests__/conciliacaoDps.test.js`, `__tests__/emissaoDps.test.js`, `src/routes/__tests__/portaoEmissaoNfse.test.js`, `src/routes/client/__tests__/emissaoNfseCliente.test.js` e `src/routes/__tests__/nfseLoteEmissaoRota.test.js`. Cobrir MESMA sem reenvio, OUTRA com limite, eventos encontrados/indisponíveis, envelope nullable, timeout/404/XML inválido, isolamento de empresa, CAS concorrente, retry bloqueado e 2027 sem chamadas fiscais.

Usar `--runTestsByPath` com caminhos explícitos. `--testPathPatterns=nfse` também combina com o nome absoluto do checkout e pode executar o repositório inteiro por engano. Em `apps/api`, exemplo: `node ../../node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/application/nfse/__tests__/conciliacaoDps.test.js src/application/nfse/__tests__/emissaoDps.test.js`.

No PR #163, passaram 1.319 testes da API em 60 suítes e o CI completo. Esse registro é evidência daquela versão, não substitui testes das próximas mudanças. Não usar emissão/cancelamento real ou consultas fiscais pagas como teste de regressão.


## Revisão de períodos apurados — 14/10/2026

`pendenciasDoPeriodo.js` é a regra local comum: circular + ApuracaoSnapshot; recibo/número da declaração prova transmissão, cálculo/simulação não. Alertas não afirmam retificação obrigatória sem comparar a receita declarada. Não consultar RFB/ADN nem recalcular/transmitir na leitura. Prévia do contador e GET de período do cliente usam vínculo autorizado; falha permanece explícita, sem fallback para mock/ABERTA. Na emissão, revalidar antes de reservar DPS. Preservar bloqueio de 2027 antes de qualquer envio.

PendenciaPosFechamento usa hash único de empresa/competência/identidade fiscal/evento. Emissão e captura vinculam a mesma pendência; cancelamento é outra ocorrência. Recaptura de nota já existente não cria alerta novo; resolução exige motivo, ator e data e não é apagada pelo upsert. Nota recebida pede revisão de despesas/retenções, não é receita de PGDAS. Sem competência explícita na NFS-e, não deduzir o mês do alerta pela data de emissão.

ServiceInvoice grava revisaoPeriodoPendente junto ao desfecho autorizado em produção; falha do aviso nunca muda issued para falha_envio. O worker local recupera somente o aviso, nunca repete chamada fiscal. Migration 20261014160000_avisos_periodos_apurados antes da API. Nenhum backfill em massa: fatos legados exigem comparação e revisão, sem transformar captura histórica em receita nova. Testes com provedores simulados e PostgreSQL isolado; não emitir nota real para validar.
