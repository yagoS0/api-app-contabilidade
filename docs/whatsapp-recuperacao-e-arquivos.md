# WhatsApp: entrega, recuperação e arquivos

## Publicação na Railway

A API aplica as migrations no entrypoint antes de iniciar. A migration
`20260907130000_whatsapp_durable_delivery` é transacional. Ela preserva tentativas
históricas com identificador Meta e recusa identificadores duplicados para revisão.
Execute primeiro `apps/api/scripts/preview-whatsapp-history.sql` em modo somente
leitura. Não remova registros nem marque uma migration como aplicada para contornar
uma inconsistência.

O Parser-PDF usa a raiz do monorepo como Root Directory e
`/apps/pdf-reader/railway.toml` como Railway Config File. Seu endpoint é `/health`;
a API verifica banco e parser em `/readyz`. O disparo automático antigo para
DigitalOcean foi removido; produção utiliza Railway.

## Entrega e tentativas

E-mails de guias usam somente contatos ativos da Configuração de envio da própria
empresa. Endereço de login, cadastro geral e destinatário de outro cliente não
autorizam envio. A lista é conferida no servidor; o envio em lote também valida
os destinatários recebidos e os confere novamente após carregar os anexos.
Sem e-mail cadastrado, o canal é ignorado com motivo explícito, sem apagar o
histórico anterior. A coluna Envio mostra registros históricos por canal com suas
datas; um registro antigo não confirma um novo reenvio.

Um identificador `wamid` confirma aceitação da Meta. A prova de entrega vem do
webhook `delivered` ou `read`. Cada tentativa tem identificador próprio; callbacks
antigos não alteram uma nova tentativa. Reenvio seletivo tenta somente destinatários
que falharam. Trocar telefone exige consentimento para o novo número.

Eventos são gravados antes do HTTP 200. Inbox e IA possuem workers separados,
reservas e recuperação após reinício. Falha de banco no recebimento devolve erro
para que o provedor repita o evento. Eventos órfãos são tentados durante até 24h;
falhas esgotadas permanecem registradas para diagnóstico.

Se uma chamada externa tiver resultado desconhecido, o estado fica
`indeterminado` (ou a reserva permanece `enviando` se nem o banco respondeu).
Não reenvie cegamente. Com `wamid`, correlacione callback e tentativa; se faltar,
consulte o evento de log `whatsapp.aceite.pendente_registro` ou o log da saída.
Ausência de comprovante de entrega não comprova falha. Não existe botão para
forçar desbloqueio de uma tentativa indeterminada: a decisão exige revisão
assistida das evidências e do risco de duplicação.

## Conversas e IA

Novas conversas são segmentadas por empresa e destinatário. Histórico legado
mantém a empresa que estava gravada e recebe aviso de escopo não verificado;
não entra no contexto da IA. Vincular abre um segmento novo e não transfere
mensagens antigas. A fila sem empresa exclui histórico de empresas removidas.

IA exige `INTEGRACAO_WHATSAPP_IA`, empresa em `IA_EMPRESAS_PILOTO` e uma chave
Anthropic válida. Configure o segredo diretamente na Railway, nunca no Git.
`IA_RESERVA_CHAMADA_CENTAVOS` reserva orçamento estimado por execução (padrão:
100 centavos de dólar). Uso parcial também é registrado; uma reserva com consumo
desconhecido continua contando. Valores são estimativas, não faturas do provedor.
O modelo não substitui as guardas e confirmações das ações fiscais.

## Arquivos em Lançamentos > A lançar

O worker baixa originais da Meta, valida conteúdo e limita cada arquivo a 15 MB.
PDF, OFX/QFX, PNG e JPEG ficam no PostgreSQL (BYTEA), persistente na Railway,
com metadados por empresa. Arquivos sem empresa aguardam identificação explícita;
vincular um arquivo não transfere a conversa. Cada mensagem gera no máximo um
registro de arquivo.

O prazo é de 90 dias a partir do recebimento. O download é bloqueado na expiração
e o worker remove os bytes. Metadados, recibos e lançamentos já importados
permanecem. Desligar o worker interrompe a limpeza física; a guarda de acesso
continua bloqueando o original expirado.

Abrir um OFX não cria lançamentos: o operador abre, pré-visualiza e confirma.
O caminho F6 envia `arquivoWhatsappId`; recibo, lançamentos e marca de importação
são gravados na mesma transação. Repetir a requisição retorna o recibo anterior.
Uma linha inválida desfaz a importação inteira deste arquivo. O importador OFX
geral, sem esse identificador, mantém o comportamento anterior.

## Correção de valor de guia

A ação de revisão atende guias OUTRA processadas com divergência de valor na
linha digitável. A prévia relê o mesmo PDF; aplicação exige sua revisão exata.
Pagamento, competência fechada, composição ou lançamento confirmado/exportado
impedem a alteração. Uma provisão simples em rascunho pode ser corrigida em
transação com a guia. PDF, identidade, valor original e histórico de envio são
preservados; a correção fica auditada e não envia mensagem.

## Verificação

O CI executa regressões WhatsApp/IA, build, validação Prisma, auditoria SQL e
testes de concorrência/importação em PostgreSQL descartável. Os scripts
`verify-whatsapp-delivery-postgres.js` e `verify-whatsapp-ofx-postgres.js` recusam
URLs de produção. Testes com dublês e PostgreSQL não comprovam entrega Meta nem
comportamento de um modelo real: a validação externa deve usar destinatário,
conteúdo e piloto autorizados e acompanhar o webhook final.
