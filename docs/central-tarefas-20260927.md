# Central de tarefas — implementação em desenvolvimento

Pedido: operações demoradas devem continuar durante a navegação, com uma lista compacta no topo do portal, acima das tabelas. A central não é uma agenda e não dispara rotinas fiscais por conta própria.

## Experiência e cobertura

O botão **Tarefas (N)** permanece nas páginas autenticadas. Abre andamento, empresa/competência, contagem real quando disponível, resultados recentes, falhas por item e download de arquivos. Fechar a lista não cancela a execução. Falha de conexão conserva a última lista e orienta conferir o resultado antes de repetir.

Integrados: downloads ZIP de notas e situações fiscais; captura de notas; envio de guias por seleção e em lote; importação NF-e/NFS-e; consultas manuais de DAS, INSS, DARF, parcelamento, pagamento e situação fiscal; busca de pagamento e recálculo por guia; classificação/conferência de notas; cálculo local e simulação, transmissão, retificação e conferência de apuração; relatório de faturamento; consulta de extrato da circular; gravação das importações OFX e Excel após a revisão do contador.

Prévia de importação, preenchimento, confirmação de competência/retificação, gravações simples e transferência direta de um arquivo já pronto continuam com seus contratos próprios. O painel não transforma abrir uma página em nova consulta nem aprova dados em nome do usuário. Upload do navegador precisa terminar antes de poder fechar a aba: os lotes já aceitos seguem no servidor, os arquivos ainda não enviados não são recuperados automaticamente. O mock mantém tarefas durante navegação interna, somente em memória; recarregar o mock limpa seu histórico.

## Contrato e proteção contra repetição

- `Prefer: respond-async` e `Idempotency-Key` optam pelo aceite 202 com `taskId`. Clientes sem esses cabeçalhos conservam o contrato síncrono.
- `ManualTask` persiste dono, empresas, competência, progresso e resultado HTTP original. O contexto de execução é copiado antes de encerrar a requisição, preservando parâmetros e identidade.
- A chave de requisição impede replay. A chave ativa impede a mesma operação concorrente entre abas/usuários. Serviços mantêm as travas de transporte e transmissão existentes.
- O executor realiza somente a ação explicitamente aceita. Não drena trabalhos antigos ao iniciar o servidor e não repete falhas ou resultados incertos. Apuração em lote é conduzida pelo servidor; o modal apenas lê o andamento.
- GET de tarefas lê registros e marca execuções sem sinal de vida como interrompidas. Nunca consulta SERPRO/ADN/SEFAZ nem envia mensagens. Horários, dias e habilitações salvos das rotinas permanecem intactos.
- As tarefas manuais são visíveis ao solicitante e exigem acesso a todas as empresas envolvidas. Jobs antigos de carteira mantêm autorização por empresa. Resultados de outros usuários não são expostos por um identificador conhecido.
- Tarefas ativas são consultadas separadamente do histórico limitado de sete dias: muitas conclusões recentes não escondem uma tarefa ainda em execução.
- Reinício do servidor não retoma chamadas pagas/transmissões. Tarefas manuais sem sinal de vida por dois minutos ficam interrompidas; jobs antigos usam dez minutos. A captura envia sinal local de vida durante consultas longas. Resultado incerto exige conferência manual.

## Implantação futura

Não publicado nesta etapa. Aplicar a migration aditiva `20260925180000_manual_tasks`, gerar Prisma e publicar a API antes do novo portal. Os dois cabeçalhos novos estão permitidos no CORS. Não executar testes contra provedores reais nem habilitar rotinas como parte da implantação. Não copiar bancos descartáveis, uploads, credenciais ou dependências locais ao Git.

## Evidências

- Testes do executor: persistência antes da execução, replay, concorrência, interrupção sem retomada, resposta HTTP e contexto após aceite.
- PostgreSQL descartável em localhost: oito verificações, incluindo 16 solicitações simultâneas executadas uma única vez, reconexão e progresso parcial preservado. Zero chamadas externas.
- Testes de rota: autorização da carteira/dono, indisponibilidade sem lista vazia fictícia, confirmação de transmissão e dupla confirmação de retificação preservadas, contrato OFX mantido.
- Testes de interface: histórico, navegação, falha de acompanhamento, troca de sessão, importação em lotes, resultado ausente sem falso sucesso, minimizar importação, seleções e envio de guias.
- Mock no navegador: download iniciado da tabela aparece em Tarefas; resultado e download continuam acessíveis ao navegar para Planejamento. Layout conferido em janela de 900 px. Build do portal conferido.

Os testes de transporte usam dublês. Não houve envio a cliente, transmissão fiscal ou consulta paga para validar esta implementação.
