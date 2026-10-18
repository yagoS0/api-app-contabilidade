# WhatsApp: sessão isolada para validar automação e IA

Implementa R29/T39–T42/T46. Nenhuma regra fiscal, financeira ou comercial real muda.
O número pode continuar vinculado à empresa e com atendimento humano pausado.
Não é necessário devolver essa pessoa ao automático. Sem migração nem backfill.

## Preparação e uso pelo Orquestrador

O administrador autenticado cria a sessão por `POST /firm/whatsapp/teste-ia`.
Flags `WHATSAPP_TESTE_IA_ENABLED` e `WHATSAPP_TESTE_IA_SEND_ENABLED` são desligadas
por padrão. A segunda é necessária somente para transporte real. Esta entrega não
ativa flags, cria sessão produtiva, chama modelo nem envia mensagens reais.
Publicação/ativação/envio dependem da autorização concreta do proprietário.

Corpo administrativo: `telefone` E.164 sem `+`, `canalId` cadastrado,
`duracaoMinutos` (1–60, padrão15), `limiteTurnos` (1–20, padrão10),
`limiteCustoCentavos` (centavos de USD **estimados**, até2000, padrão500),
`envioReal` booleano. Confirmar `TESTE_ISOLADO_SEM_ENVIO` para consulta administrativa
ou `TESTE_ISOLADO_COM_ENVIO_AO_NUMERO_INTERNO` para respostas ao número autorizado.
O servidor resolve canal/WABA/credencial; IDs de provedores ou credenciais enviados
pelo navegador não configuram transporte. Não há destinatário alternativo por turno.

A resposta informa ID, marcador `/teste-ia <UUID>`, validade, modelo e reserva
conservadora estimada por turno. Cada mensagem do destinatário deve começar pelo
marcador, por exemplo `/teste-ia <UUID> Olá`. A resposta leva **TESTE ALTAN — SEM EFEITO REAL**
e lembra o marcador. Mensagem comum sem marcador segue o atendimento real existente.
Responder citando uma saída de teste sem marcador fica em quarentena isolada, inclusive
após expiração/encerramento/flags OFF; o Orquestrador orienta reenviar com marcador
em sessão válida. Não envia lembrete automático fora da sessão.

Se uma resposta citada chega antes do ACK e de qualquer callback, o wamid ainda
não pode ser reconhecido. Havendo saída de teste reservada/incerta sem wamid no
mesmo número/canal/WABA, somente essa citação desconhecida é colocada em quarentena.
Mensagens comuns sem citação continuam normais. A quarentena permanece no replay,
mesmo após conciliação/encerramento. Se a saída ficar incerta, outras citações
desconhecidas nesse contexto também exigem conferência; não atribuí-las ao fluxo
real até conciliar o transporte. Uma vez conhecido o wamid, citações de mensagens
reais diferentes voltam ao caminho normal. Isso não altera vínculo ou pausa reais.
O fallback também consulta o wamid no evento da sessão: uma falha entre persistir
o callback e gravar seu índice não pode liberar a resposta citada no fluxo real.
Antes de considerar uma citação ambígua, o classificador confere somente metadados
de saída operacional (wamid/destinatário/canal/WABA, sem corpo, empresa ou documento).
Uma saída comprovadamente operacional no mesmo contexto segue normalmente, mesmo
havendo teste incerto. Essa prova booleana nunca entra no contexto do modelo.
Quarentenas conservam texto e referência, disponíveis em `quarentenas` no GET da
sessão pelo criador; não são descartadas como erro genérico. Não há reprocessamento
automático no atendimento real: o Orquestrador confere o original e orienta nova
mensagem explicitamente de teste ou operacional. Até100 registros recentes são
exibidos por consulta; recibos mais antigos continuam persistidos para auditoria.

`GET /firm/whatsapp/teste-ia/:id` consulta histórico, fila, origem automática/IA,
campos fictícios, pausa local, custo reservado e recibos. Somente o administrador
criador consulta/encerra. `POST /firm/whatsapp/teste-ia/:id/encerrar` revoga novas
respostas. Não há endpoint que reenvie saída incerta ou retome o atendimento real.
O worker confirma também que o autor continua administrador ativo antes da IA,
depois da inferência e imediatamente antes do transporte.

## Roteiro de validação

1. `Olá`: menu automático, sem modelo.
2. `Quero abrir uma empresa de consultoria`: intenção e pergunta automática usando
   funções puras de pré-atendimento utilizadas pelo produto.
3. Dúvida livre: mesmo `IA_MODELO` configurado no atendimento, prompt comercial
   compartilhado e ferramenta `registrar_atendimento` exclusiva do sandbox.
4. Declarar/corrigir campos fictícios: descritores e validação compartilhados de
   onboarding; gravação somente no JSON da sessão. Nunca cria ficha operacional.
5. `Falar com o contador`: pausa local e contador fictício; não grava demanda,
   push, atendente nem pausa real. Turnos seguintes ficam `pausa_local`.
6. Encerrar; repetir evento, responder citando saída ou usar marcador expirado:
   nenhuma entrada/saída operacional nem reenvio automático.

## Limites de equivalência

Valida linguagem/comportamento comercial com modelo configurado e alternância
automática/IA/handoff. A ferramenta usa campos `set/unset` e `chamarContador`, mas
não é o executor operacional: consultas públicas/privadas, biblioteca privada,
guias/documentos, assinatura, pagamento, conversão e provisões são indisponíveis.
Não certifica toda a jornada real nem os efeitos desses provedores. Interações
de teste são texto; áudio/anexo/clique reservado não entra na operação real.

IA limitada a duas iterações de512tokens, entrada de até60kbytes, histórico até12k
caracteres. Reserva por turno deriva de140k tokens de entrada (limite conservador
dos dois requests, incluindo ferramenta),1024 de saída e maior preço de entrada/cache
na tabela existente. Modelo sem preço conhecido falha fechado. Reserva não é fatura,
e não é liberada em timeout. O limite inclui turnos automáticos conservadoramente;
limite/expiração podem encerrar a progressão antes do número máximo de mensagens.
Mudança de modelo exige nova sessão, sem reaproveitar orçamento antigo.

## Persistência, recuperação e implantação

AppSetting usa namespaces exclusivos: `whatsapp:teste-ia:v1:` (sessão),
`:entrada:` (classificação por canal/WABA/wamid) e `:saida:` (índice wamid).
Não limpar recibos para recuperar sessão: são a barreira contra replay tardio.
Retenção/remoção precisam preservar tombstones de classificação/correlação.

Ingestão só classifica e enfileira. Worker independente do inbox serializa por
sessão usando advisory lock transacional PostgreSQL e lease120s. Duas mensagens
concorrentes permanecem duráveis. Crash de IA/transporte torna tentativa incerta;
não reexecuta aquela tentativa. Próximos turnos válidos continuam. Saída pronta,
ainda não reservada, pode continuar após reinício. Encerradas/expiradas não são
reescritas a cada tick; busca SQL limitada a20 candidatas ativas com trabalho,
ordenadas por atualização para permitir progresso das demais sessões.

Transporte exclusivo usa canal já configurado, somente texto e correlação
`biz_opaque_callback_data`. Reserva precede rede. Confirmação Meta perdida não
autoriza reenvio: callback válido reconcilia wamid/evidência na sessão, inclusive
antes do retornoHTTP. Recibos posteriores não reabrem sessão encerrada.
Credencial/canal/autor/flags/validade são reconferidos antes do envio.

Rollback seguro: desligar as duas flags e preservar código/índices que interceptam
entradas e callbacks antigos. Reverter integralmente o interceptor faria marcadores
ou respostas citadas antigas voltarem à operação; exige primeiro drenar/encerrar
sessões e manter a barreira de tombstones. Nenhum estado real é restaurado por rollback.

## Evidências locais reproduzíveis

Jest cobre isolamento, autorização, origens inválidas, orçamento, concorrência,
revogação, lease, callback precoce, timeout, transporte e alternância pura.
`apps/api/scripts/verify-whatsapp-test-isolation-postgres.mjs` recusa banco fora
de loopback/nome terminado em `_governance_test`, bloqueia rede, cria empresa e
contato sintéticos vinculados com conversa assumida, executa fila e webhook,
e compara contagem/hash de183 tabelas operacionais antes/depois. Usa repositório
PostgreSQL real; modelo e Meta são dublês explícitos. O script remove seus fixtures.
Executar pelo runner isolado preparado pelo Orquestrador; nunca com DATABASE_URL produtiva.
