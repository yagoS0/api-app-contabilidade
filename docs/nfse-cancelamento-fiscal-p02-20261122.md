# P0.2 — Confirmação fiscal de cancelamento da NFS-e

Base: `07e24a2bf60d93d49960c170043b77478497ab0b`. Conferência: 22/11/2026.

## Causa e impacto

A base devolvia accepted para qualquer HTTP 200. Escritório, cliente e assistente promoviam esse aceite a cancelled sem interpretar evento fiscal. A reprodução anterior à correção passou 28 testes; a expectativa insegura foi substituída por inconclusivo. Não há evidência de ocorrência produtiva investigada nesta entrega.

NFS-e é dona da decisão, reserva, identidade, custódia e projeção. Nenhuma regra de Apuração, Guias, Contabilidade, calendário IBS/CBS ou sincronização ADN é modificada. Impacto autorizado: apenas comprovação fiscal válida pode anunciar cancelamento; pendência, indeferimento e incerteza preservam o estado anterior.

## Contrato oficial

- [Manual Integrado API nacional v1.2/out2025](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfse-v1-2-out2025.pdf), §1.5.
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
