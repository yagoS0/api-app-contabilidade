# Tracking complementar de guias — 18/10/2026

## Objetivo e escopo

Base de diagnóstico: `9f06abb98`. Executor delegado, um escritor neste checkout. Aplicação de R01, R10–R12, R16–R22 e R25 já aprovadas; nenhuma regra fiscal nova. V02/V03/V05–V08 permanecem pendentes. Não foram alterados guards de token de recálculo, interface, fluxoCarteira, permissões, governança, configurações, gates ou migrations.

Risco alto: correlação de documentos, revisão, confirmação e comunicação. Escritas em comunicação/guias; consumidores em API, operações, contabilidade, portal e web. Comercial usa a infraestrutura compartilhada de saída, mas seus caminhos sem documento de guia permanecem com o contrato anterior. O Principal deverá concluir o mapa transitivo e as revisões independentes.

## Diagnóstico e implementação

- Consulta determinística e ferramenta da IA agora passam identidade/revisão do PDF para a saída comum. O retorno de recálculo passa a revisão atualizada pelo mesmo adaptador do menu. As guardas existentes de acesso, identidade, consentimento, canal, janela e atendimento continuam antes do transporte.
- `EnvioDocumentoGuiaWhatsappService` verifica entrada recebida da conversa, empresa, liberação, processamento, revisão documental e SHA-256 dos bytes. Reserva em AppSetting uma intenção por entrada/conversa/empresa/destino/guia, sem revisão na chave: replay da mesma entrada não reenvia nem após alteração do documento. Uma entrada nova permite nova intenção, exclusivamente para o telefone daquela conversa. O `reenviar` só é usado depois dessa reserva explícita; o lote inicial não foi alterado. Envio anterior em andamento/indeterminado continua bloqueado.
- Antes da rede, materializa o legado de e-mail SENT, reserva EnvioGuiaTentativa e preserva PDF/snapshot pelo storage existente. Saída e reconciliador usam o mesmo ID de mensagem por tentativa, evitando balão duplicado após falha de gravação. PDF sob demanda não inventa template aprovado. Aceite correlaciona wamid/tentativa antes da escrita final da mensagem. Timeout permanece incerto e exige conciliação, sem retry automático.
- Snapshot novo registra revisão incluindo tipo, competência, vínculo de parcela, composição/valores, hash e vencimento. Conferência de entrega rejeita revisão distinta mesmo com PDF igual. Recibos anteriores sem revisão integral permanecem consultáveis no histórico, mas não autorizam um novo lembrete: a prova insuficiente gera pendência de conferência, sem backfill, revisão inventada ou reenvio automático. A projeção geral legada de EnvioGuia continua distinguindo aceite/entrega pelos estados existentes; este incremento não converte históricos ou redefine contadores.
- Consulta de documento histórico pago não altera pagamento, baixa ou confirmação e não oferece ação de cobrança. Recálculo conserva as guardas próprias e o encaminhamento ao contador para tipos sem automação. Nenhuma confirmação ou baixa é inferida da entrega.
- `AvisoPagamentoService` carrega a relação real da parcela e contrato também quando recebe somente guideId. Pagamento confirmado/baixado, débito automático e contrato excluído impedem lembrete; divergência/erro/documento ou vínculo incompleto ficam pendentes. Os mesmos dados são relidos imediatamente antes da saída. Divergência entre empresa/guia/parcela/contrato bloqueia. Débito automático é avaliado antes da falta de PDF e não vira pendência documental.

## Evidências da tentativa original do executor

- Estado inicial de `git status --short`: limpo.
- Inspeção estática: consultas/menu → ferramentas/IA → SaidaWhatsapp → nova tentativa/snapshot; ProcessarEventoWhatsapp → EnvioGuiaService → EntregaGuiaWhatsapp → AvisoPagamento. Confirmado o relacionamento Guide.parcela/parcelamento e Parcela.guia/parcelamento no schema existente.
- `node scripts/governance/check.mjs plan --base 9f06abb98`: não executou; Node falhou em `lstat C:\Users\yagoa`, EPERM do sandbox.
- Tentativa de Jest abaixo: não chegou ao runner; mesmo EPERM do Node. Nenhum teste funcional está declarado aprovado nesta rodada. Python não disponível neste ambiente; as edições foram realizadas por PowerShell.
- `git diff --check`: executado, sem erros de whitespace (avisos locais de normalização LF/CRLF).
- Nenhum PostgreSQL, credencial, serviço externo, WhatsApp, SERPRO, IA externa ou produção foi acessado. Sem commit, merge, publicação, migração ou envio real. Nenhum parecer independente foi produzido pelo executor.

Comando tentado:

```text
npm test --workspace @contabilidade/api -- --runInBand --runTestsByPath src/application/whatsapp/__tests__/envioDocumentoGuiaWhatsapp.test.js src/application/whatsapp/__tests__/saidaWhatsappService.test.js src/application/guides/__tests__/avisoPagamento.test.js src/application/guides/__tests__/entregaGuiaWhatsapp.test.js
```

O controlador deve executar também: `historicoArquivoWhatsapp.test.js`, `menuWhatsappService.test.js`, `assistenteService.test.js`, `ferramentas.test.js`, `envioGuia.test.js`, `recalcularGuiaTrackingWhatsapp.test.js`, o teste existente `recalcularGuiaWhatsapp.test.js`, `solicitarPagamentosWhatsapp.test.js` e `processarEventoWhatsapp.test.js`. Os testes novos do menu/IA validam o repasse ao adaptador com dublê; a reserva/replay/revisão são exercitadas separadamente no serviço. Não são prova integrada de banco ou transporte.

## Recuperação delimitada e reprovação independente

O runtime encerrou a execução original por timeout do executor, com estado `escalated`; esse journal permanece inalterado, sem gates ou pareceres fabricados. O Principal autorizou uma recuperação delimitada aos mesmos caminhos. Não houve edição simultânea durante o ensaio inicial.

- O Principal executou dez suítes direcionadas sobre o delta inicial: 259 testes aprovados. Isso não substituiu a prova integrada.
- A revisão independente em PostgreSQL descartável, com transporte/storage sintéticos e rede externa bloqueada, confirmou correlação mensagem/tentativa, callback `delivered`, revisão atual, replay, concorrência, timeout e consulta de documento pago. Porém **reprovou** três cenários: débito automático e contrato excluído alcançados somente por `Parcela.parcelamento`, e divergência entre contratos da guia/parcela. Cada um enviou indevidamente um lembrete; o resultado global foi falha, preservado no relatório local.
- A recuperação passou a carregar `parcela.include.parcelamento` nos dois caminhos e confrontar as identidades dos contratos, além do escopo empresarial. Assim a ausência de `Guide.parcelamentoId` não apaga o contrato real da parcela. Divergência fica pendente; débito automático e contrato excluído impedem cobrança. A releitura antes do transporte conserva essas verificações.
- O histórico agora persiste também a coluna `EnvioGuiaTentativa.canalId`, necessária à validação do callback quando o wamid ainda não foi vinculado à mensagem. Repreparação não pode trocar revisão, canal, vigência do número ou formato mantendo os mesmos bytes; recusa sem alterar o snapshot original.
- A guarda de entrega passou a recusar também snapshots legados sem revisão integral, conforme R01/R02/R20. O contador vê pendência de entrega da versão atual; não se apaga a evidência histórica nem se dispara nova mensagem. Os testes conservam um recibo anterior imutável: a leitura não o reconstrói a partir da guia atual para fazer a verificação passar.
- Após as correções de relações/histórico, duas suítes locais afetadas passaram **61/61 testes**. Acrescentada a recusa de prova legada insuficiente, a rodada final das três suítes passou **79/79 testes**: `avisoPagamento.test.js`, `entregaGuiaWhatsapp.test.js` e `historicoArquivoWhatsapp.test.js`. `git diff --check` também passou. O ensaio PostgreSQL corrigido, os gates completos e os pareceres independentes finais ainda precisam ser concluídos pelo Principal.

Impacto operacional: correção das guardas R17–R20, origem/revisão/canal R01/R10/R11; sem regra nova, backfill, alteração de permissões, envio real, migration ou publicação. Os mocks acrescentados verificam os negativos locais; não substituem a repetição dos três cenários reprovados em banco real descartável.

## PostgreSQL descartável complementar — critérios de revalidação

Usar somente loopback e banco terminado em `_governance_test`, schema existente, fixtures sintéticas, storage em memória e rede externa bloqueada. Preparação/execução pelo Principal/controlador; não usar dados reais nem mudar gates neste incremento.

1. DAS sob demanda e DARF LP reemitida: reservar intenção, snapshot e mensagem; receber `sent`, `delivered`, `read`, duplicatas e eventos fora de ordem. Apenas entregue/lido da revisão atual habilitam aviso. Conferir FK, unicidade do wamid e exatamente um balão/tentativa.
2. Replay concorrente da mesma entrada, nova entrada do mesmo cliente, outro destino/empresa, troca de revisão durante preparo, pagamento/recusa/handoff entre preparo e transporte. Zero saída nas recusas; somente uma reserva vence a concorrência. Nova intenção não destrava envio anterior incerto.
3. Falha após aceite antes da gravação da mensagem: preservar wamid/tentativa, reconciliar sem rede, sem balão duplicado. Falha sem wamid: manter incerto, sem retry. Callback antigo deve preservar histórico e não habilitar lembrete para PDF/revisão nova.
4. Fluxo `callback entregue → tracking → SolicitarPagamentos(guideId) → AvisoPagamento`: confirmar parcela, baixar por cliente/contador, registrar divergência/erro, débito automático ou excluir contrato mantendo Guide OPEN e entrega antiga. Repetir alterações imediatamente antes da saída; nenhum lembrete deve sair. PDF ausente com débito automático permanece ignorado, não pendência de guia.
5. DAS automático e DARF LP passam a revisão recalculada ao tracking; INSS/parcelamento encaminham ao contador sem chamada fiscal. Confirmação autenticada do cliente preserva R25/baixa e suspende lembretes. Consulta de guia paga não gera cobrança ou nova baixa. Executar também regressões existentes de confirmação cliente/contador sem alterar a política.

## Reprovação da jornada multiempresa e origem resolvida

A regressão completa encontrou uma fixture de atendimento que não fornecia `guideId`/revisão como o executor real. Corrigido esse contrato, 18 jornadas reproduziram uma falha real: a mensagem recebida permanece na conversa neutra, enquanto o recibo autorizado resolve a empresa e o segmento de atendimento. Exigir que a mensagem original já estivesse no segmento recusava entregas legítimas. A reprodução ficou preservada em `tracking-resolved-origin-repro.json`, no diretório local de governança.

Após confirmação independente, o serviço passou a usar `carregarMensagemResolvida`, exigindo entrada recebida e recibo `RESOLVIDA` da mesma empresa, conversa e atendimento. Sem atendimento, a conversa original continua obrigatoriamente igual. O guard de contexto vigente continua sendo executado antes da reserva e do transporte; a mensagem original não é movida nem reescrita. Recibo ausente, recusado, de outra empresa/atendimento/segmento, contexto expirado, versão alterada ou acesso revogado impedem envio.

As duas suítes afetadas passaram **109/109 testes**, incluindo a jornada real de seleção, persistência de tentativa/snapshot/mensagem, replay e revogação após preparo do PDF. A fixture usa o tracking real com persistência sintética e PDF válido; somente storage/transporte são substituídos nesta jornada. Evidência local: `tracking-resolved-origin-final.json`. Isso não substitui PostgreSQL nem prova de transporte real. O ensaio PostgreSQL de 21 blocos aprovado anteriormente corresponde à versão anterior a esta correção; o Principal coordena a revalidação e os gates completos. Sem alteração de regra operacional: preservados isolamento empresarial, origem verificável e histórico imutável.

## Integração e rollback

Conciliação com a outra árvore: neste serviço de recálculo apenas import e argumento do ponto de envio foram alterados. Manter o patch paralelo de token.versaoPagamento; não substituí-lo por esta versão do arquivo inteiro. Integração e revisão final pertencem ao Principal.

Rollback de código por diff do incremento, sem apagar AppSettings, PDFs, mensagens ou tentativas. Reservas existentes continuam sem replay automático. Falha interrompida requer conciliação do estado persistido antes de nova intenção. Não há migração destrutiva ou backfill.
