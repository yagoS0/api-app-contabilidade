# Apuração assistida — execução integral

Escopo: continuação do plano original de apuração assistida CBS/IBS. As etapas 0/1 foram publicadas pela PR 143. O restante está sendo implementado no checkout isolado `altan-apuracao-release`, preservando o checkout principal. Esta documentação não comprova implantação ou habilitação de APIs.

## Critérios do produto

- Separar estimativa interna, arquivo retornado pelo Fisco, inspeção local, conferência humana, guia registrada e pagamento declarado. Nenhum desses estados equivale automaticamente a confirmação oficial.
- CBS e IBS mantêm contextos separados por contribuinte, ambiente e competência. O agrupamento dos estabelecimentos é explícito; permissão na matriz não concede permissão nas filiais.
- Leituras de painel usam somente dados locais. Consultas externas exigem ação explícita ou agenda fiscal salva conforme `CLAUDE.md`; não há consulta por abertura de tela, retry, startup ou recuperação de horário perdido.
- Uma intenção não pode gerar duas operações. Resultado incerto permanece visível e não autoriza nova chamada automática.
- Dinheiro é representado em centavos decimais exatos. Arquivos originais ficam cifrados, íntegros e imutáveis. Atualizações incrementais não são somadas como novas operações sem identidade/revisão homologadas.
- Guia emitida não é pagamento. Pagamento declarado não é extinção oficial. Alocações parciais devem respeitar saldos e impedir duplicação.
- Serviços sem contrato oficial suficiente ou sem homologação permanecem indisponíveis, com motivo específico. Datas previstas de liberação não ativam código.

## Frentes e critérios de conclusão

| Frente | Entrega verificável | Dependência externa |
| --- | --- | --- |
| Fundação | Cadastro histórico, grupo, credencial referenciada, ambientes, permissões e revisões | Publicada nas etapas 0/1 |
| CBS | Reserva idempotente, transporte, situação, download seguro, cifra e evidências | OAuth/hosts/webhook e vínculo de credencial homologados antes de ativar |
| Reprocessamento CBS | Leitura local do arquivo com integridade, valores exatos, versão do parser e limites | Identidade, exclusões e cobertura oficiais para consolidar deltas |
| IBS | Contrato oficial verificado, transporte isolado quando especificado, múltiplos arquivos e recuperação explicitamente limitados | Ambiente, autenticação e fixtures homologados |
| Conferência | Revisões mensais, cobertura documentada, pendências e bloqueios, conferência local auditada | Comparação automática oficial exige normalização/cobertura comprovadas |
| Guias | Registro manual com referência/evidência, histórico e estado distinto de pagamento | Emissão eletrônica exige API publicada e homologada |
| Pagamentos | Registros parciais, alocação e prevenção de duplicação | Retorno oficial para afirmar confirmação/extinção pelo Fisco |
| Exceções | Aplicabilidade explícita e bloqueios identificados | Regras e validação fiscal específicas; não presumir DeRE ou regime especial |

## Validação e publicação

Testes unitários e de rotas sem serviços fiscais, verificações reais em PostgreSQL descartável, validação do schema/migrações, build e inspeção visual em desktop/celular. A aprovação desses testes valida o comportamento implementado, não a exatidão de uma apuração fiscal de cliente ou disponibilidade de serviço oficial.

Uma implantação posterior deve identificar exatamente o commit e as migrações, confirmar backup e compatibilidade de rollback de código, aplicar migrações aditivas antes da interface e verificar serviços sem consultas fiscais de teste. Não apagar evidências no rollback. A autorização anterior de publicação das etapas 0/1 não é usada como comprovação de publicação desta continuação.

## Implementado nesta continuação

- Segurança CBS: OAuth com cache, emissão compartilhada por instância e reserva durável por credencial; máximo local de duas reservas em janela móvel de uma hora, incluindo falhas. Download HTTPS com DNS público fixado, TLS, sem Bearer no armazenamento, sem redirecionamento e com limites. Rotação de cifra lê chaves históricas sem reescrever arquivos imutáveis.
- Inspeção CBS: ação explícita sobre bytes cifrados já preservados, verificação de hash/AAD, parser que conserva números antes de qualquer conversão, rejeita chaves JSON repetidas e valida campos monetários conhecidos. Retorna amostra de até 100 itens e contagem completa; jamais soma deltas nem afirma cobertura. Inteiros de centavos de até 18 dígitos permanecem exatos.
- Livro mensal CBS/IBS: base e cobertura declaradas, evidências referenciadas, pendências resolvidas com justificativa, classificação de tratamento, conferência humana local e histórico versionado. Cadastro/configuração/estabelecimentos são revalidados; mudança posterior invalida a conferência derivada. Registrar base exige o `contextoHash` da leitura original e recusa formulário cujo cadastro/configuração mudou mesmo sem nova versão mensal. Tratamento específico/DeRE e regimes incompatíveis bloqueiam a conferência.
- Guias e pagamentos manuais: referência e hash declarados, registro separado da confirmação oficial, alocações parciais limitadas aos dois saldos, estorno/cancelamento justificado e histórico imutável. Referência repetida no mesmo grupo/tributo/ambiente é impedida inclusive entre competências; intencionalidade e versão protegem concorrência. Isso não identifica automaticamente comprovantes diferentes da mesma operação financeira.
- Interface: preparação, coleta/inspeção CBS e livro mensal por contexto. Atualizar tela só consulta o banco; mock não produz resultado fiscal nem gravação fictícia. Capacidades IBS são acompanhadas de limitações do MOC1.10.
- Três migrações aditivas posteriores à versão publicada: `20261011223000_apuracao_cbs_coleta`, `20261012010000_apuracao_consumo_mensal_local`, `20261012013000_apuracao_cbs_token_reserva`.

As rotas mensais são GET `/firm/companies/:companyId/apuracao-consumo/mensal`, GET `/mensal/historico` e POST `/mensal/acoes`. A inspeção CBS é POST `/cbs/coletas/:coletaId/reprocessar`. Todas revalidam autorização do grupo. A inspeção não precisa de token remoto, mas exige chave local de leitura.

## Pendências reais — plano operacional ainda não concluído

1. **Ativação CBS:** composição do runtime com credencial habilitada, chave/cofre, hosts aprovados e homologação do contribuinte. O callback técnico não abre rota; persistência/correlação e autenticação operacional do webhook ainda precisam ser concluídas. Não há coleta automática nem agenda criada por inferência.
2. **Consolidação automática:** a documentação não resolve identidade/revisão/exclusão dos itens nem comprova cobertura incremental. A inspeção não substitui normalização homologada, reconciliação automática com documentos fiscais ou saldo oficial. Dados declarados no livro mensal não são promovidos a retornos oficiais.
3. **IBS:** faltam base HTTP e rota de download publicadas, entre outras lacunas do contrato. Não foi implementado transporte fictício. Ingestão diferencial de múltiplos arquivos e recuperação oficial seguem dependentes desse contrato e de fixtures homologadas. Ver [contrato IBS](apuracao-ibs-contrato-2026-10-12.md).
4. **Guias/pagamentos oficiais:** registro manual funciona; transmissão, PDF remoto, saldo oficial, confirmação/extinção e split payment integrados não estão implementados sem seus contratos. Evidências manuais são referências e hashes declarados; o arquivo não é armazenado por esse fluxo.
5. **Reservas interrompidas:** não existe botão administrativo que apague a incerteza ou repita abertura. Conservar registro e investigar tíquete/evidência externa; consulta de tíquete conhecido só ocorre por ação explícita quando não há reserva em curso. Sem prova segura, o bloqueio permanece. Recuperação administrativa auditada é pendência anterior à ativação real.
6. **Exceções:** classificação e bloqueio estão implementados; apuração de tratamentos específicos e DeRE exige escopo/regras e validação fiscal próprios.

Essas dependências não se resolvem habilitando uma flag ou apenas publicando a branch. Não foi feita consulta fiscal, emissão, pagamento ou alteração de produção nesta continuação.

## Evidências locais

- API: 27 suítes, 461 testes aprovados; `test-evidence/apuracao-integral-api.json`.
- Interface: 32 suítes, 406 testes aprovados; `test-evidence/apuracao-consumo-completa-web.json`. Build aprovado com avisos preexistentes de chunks/importações mistas. Fluxo visual com fixtures explícitas: guia de R$ 100, pagamento de R$ 40 e alocação de R$ 25 resultam em saldo de guia R$ 75 e disponível no pagamento R$ 15. Capturas desktop/celular em `test-evidence/consumo-mensal`; sem consultas fiscais e com preview encerrado.
- PostgreSQL descartável: 198 migrações aplicadas; 12 grupos de verificações CBS/OAuth/replay e quatro grupos mensais aprovados; `test-evidence/coleta-cbs-postgres-1791806647513`. Cluster encerrado após o ensaio.
- Auditor de migrações e YAML da CI aprovados. A CI inclui testes unitários e os dois verificadores PostgreSQL; execução remota depende de publicação futura.
- Preservação: 14.282 hashes conferidos, zero alterações/ausências e status Git original idêntico; `test-evidence/apuracao-integral-preservation.json`.
