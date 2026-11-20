# FS12 — migração versionada da identidade fiscal

Base: `c248135c71939bc0a4292bf1b2b17c3407e562b8`. Autorização: [coordenação do PR301](https://github.com/yagoS0/api-app-contabilidade/pull/301#issuecomment-6992482643) e pedido do proprietário neste incremento.

## Escopo e propriedade

A migração `20261118000000_add_fs12_comando_custodia` consolida o [DDL original e corretivo](fixtures/fs12-b33b1-ddl/) validados no PR301. As quatro relações pertencem a Fiscal: comando/tentativa, associação à reserva SERPRO existente, resposta observada cifrada e associação ao cálculo. Prisma representa seus campos, relações compostas e índices normais; checks, triggers e a unicidade parcial de simulação permanecem explicitamente no SQL.

Nenhum consumidor produtivo dessas relações é implementado. Apuração, Operações, lotes, scripts, Guias e Contabilidade mantêm seus contratos e escritores atuais. Não há impacto nas regras operacionais: guardas B3.2, seleção inconclusiva B3.3a, Fator R, payload e bloqueio de 2027 permanecem intactos. A presença de uma resposta observada não comprova transmissão fiscal nem autoriza associação automática ao cálculo.

## Aplicação e compatibilidade

O SQL é aditivo, sem backfill, exclusão ou alteração de evidências existentes, e usa uma transação explícita. Depende das migrações B3.1/B3.2 já versionadas e reutiliza a função de imutabilidade existente. A repetição é controlada por `_prisma_migrations`; não se deve executar o arquivo diretamente nem mascarar divergências com `IF NOT EXISTS`.

O novo índice composto em `apuracao_fs12_calculos` precisa ler a tabela e pode bloquear escritores enquanto é criado. Os demais índices recaem sobre tabelas novas. O ensaio sintético não estima duração em uma base real. Uma futura implantação exige janela, avaliação de volume, backup verificável e autorização própria. Não usar `db push` ou `migrate dev` para substituir os checks/triggers deste SQL.

## Privilégios e custódia

Nenhum papel, credencial ou grant produtivo é criado. As funções permanecem `SECURITY INVOKER`; owner/superuser não são contidos por essa fronteira. Não conceder `TRUNCATE`, `UPDATE` ou `DELETE` das quatro relações a consumidores futuros. Triggers de imutabilidade não substituem privilégio mínimo, autenticação ou autorização por empresa.

| Capacidade futura | Necessidade técnica | Limite / decisão pendente |
| --- | --- | --- |
| Proprietário de migração | DDL e dependências existentes | Separado do runtime; nenhuma concessão nesta entrega |
| T1/T2 — criação e reserva | INSERT comando/reserva; SELECT revisão, cadastro e ledger | Autorização vigente e coordenação de todos os escritores não implementadas |
| T3a — custódia | INSERT resposta; SELECT comando, associação de reserva, ledger e marcador | `SELECT *` dos triggers requer leitura de todas as colunas; capacidade interna ainda depende de aprovação |
| Bloqueio do marcador em T3a | `SELECT ... FOR SHARE` em `AppSetting` exige UPDATE em ao menos uma coluna | Ensaio concede somente UPDATE(updatedAt) a papel sintético; não é política aprovada para runtime. Risco de escrita dessa coluna em toda a tabela exige decisão antes do coordenador |
| T3b — associação ao cálculo | INSERT associação e SELECT cadeia/cálculo | Exige revalidação de revisão, autorização e identidade; não promover resposta automaticamente |
| Consulta de metadados | SELECT somente colunas necessárias | Sem corpo cifrado, capacidade ou envelope; autorização por empresa continua obrigatória |

O ensaio de privilégios demonstra que INSERT+SELECT é insuficiente para T3a e que o privilégio sintético permite o bloqueio, mantendo recusas para alteração de `value`, DELETE e TRUNCATE. Não troca o trigger por `SECURITY DEFINER` nem homologa o escritor real. Uma alternativa encapsulada ou concessão restrita deverá ser aprovada separadamente antes de qualquer escrita funcional.

SQL valida formato, base64 canônico, nonce de 12 bytes, tag de 16 bytes, algoritmo, versão de AAD e limite inclusivo de 16 MiB. Não autentica o conteúdo. Os testes AES-256-GCM usam somente chaves efêmeras sintéticas, verificam AAD, adulteração e recuperação em outra conexão. `keyId` é referência, nunca chave privada.

Continuam pendentes: provedor de chaves, separação de custódia, identidade da capacidade interna, política de acesso a ciphertext, rotação com recuperação das versões, retenção legal e operacional, tratamento acima de 16 MiB e recuperação fora da máquina original. A imutabilidade não inclui rotina de expurgo. Nenhuma chave produtiva, retenção automática ou permissão de custódia é criada.

## Conflito de serialização e efeitos externos

O ensaio com Prisma caracteriza `P2010` cujo `meta.code` é exatamente `40001`, além da forma `P2034`. Uma futura tradução deve estar na fronteira do adaptador transacional específico, preservando a causa e recusando outros `P2010`. Não usar teste genérico de mensagem nem retry global.

Uma repetição só poderá abranger transação local conhecida, após rollback integral, com limite e nova leitura de revisão/autorização/idempotência. Nunca envolver chamada externa no callback repetível. Reserva persistida, despacho possível, timeout ou resposta perdida exigem conciliação; não autorizam retransmissão. Esta entrega documenta o tratamento e não altera o retry produtivo de B3.1 ou qualquer fluxo SERPRO.

## Evidência e limites

O workflow focal usa PostgreSQL16 descartável e aplica a migração real pelo Prisma. O runner verifica upgrade do histórico anterior, preservação de evidências sintéticas B3.1/B3.2 e repetição sem reaplicar a migração. Os ensaios SQL cobrem a versão instalada, além das fixtures históricas para comparação; os ensaios Prisma usam o cliente gerado dos modelos integrados.

As suítes cobrem FKs, unicidades, isolamento por empresa/competência/revisão, replay, rollback, imutabilidade, cadeia de resposta, concorrência com duas conexões e criptografia sintética. Não comprovam um coordenador ainda inexistente, a ordem global dos locks legados, identidade real de serviço, autenticidade de resposta SERPRO ou custódia produtiva. Os resultados executados e pareceres são registrados no arquivo de governança desta entrega e no PR no SHA final.

O controlador encerrou em `escalated` após o planejador por inclusão de configuração de CI. O principal conduz a mudança expressamente autorizada com revisões independentes, preservando os gates. Não se declara `ready_for_human` pelo controlador.

## Rollback e aprovação

Antes da integração, basta revisar/reverter o incremento em branch, preservando as evidências. Após eventual aplicação futura, rollback de código deve manter tabelas, índices, registros e custódia. Não executar down migration destrutiva nem remover respostas. Falha durante a aplicação deve abortar a transação; qualquer reparação do histórico Prisma exige inspeção e autorização, sem marcar migração resolvida indiscriminadamente.

Critérios: migração real e repetição aprovadas em PG16, schema validado e cliente gerado, testes de integridade/concor­rência/criptografia aprovados, nenhuma nova violação arquitetural, revisões independentes sem bloqueantes e checks hospedados no SHA final. Mesmo aprovados, não autorizam produção, coordenador, despacho, merge ou deploy. A decisão humana de integração e as decisões de custódia/permissões precedem os incrementos funcionais seguintes.
