# B3.3b.1 — validação isolada da persistência FS12

Base remota confirmada `86b386dbe66287a68913ffdb1bb7bae232a7c44b`. Autorização: [coordenação do PR300](https://github.com/yagoS0/api-app-contabilidade/pull/300#issuecomment-6987432274). Complementa o [desenho integrado](pgdas-2026-b33b1-persistencia.md); não implementa B3.3b.2. Nenhuma alteração em código produtivo, schema principal, migrations principais, payload, guardas B32, Fator R ou regras operacionais. Fiscal conserva comando/interpretação/vínculo; infraestrutura conserva reserva/ledger e custódia. Apuração, Operações, lotes, scripts, Guias e Contabilidade mantêm contratos e efeitos existentes.

## Ambiente e alcance da prova

PostgreSQL **16.15**, cluster novo exclusivo `.altan-governance/pgdata-ddl`, loopback `127.0.0.1:55491`, usuário sintético `altan_ddl_test`. Foram aplicadas as **215 migrations já integradas** em `altan_ddl_governance_test` e, separadamente, `altan_piloto_governance_test` para regressões. Nenhum banco anterior foi iniciado ou utilizado. Dados, identidades e chaves são sintéticos. Logs privados permanecem em `.altan-governance`; não publicar conteúdo bruto de ambiente.

O ensaio original e o corretivo usam transação com rollback. Na execução final dos constraints, cada variante usa schema UUID transitório, `search_path` próprio e índice adicional B32 de nome UUID, com as mesmas colunas; evita colisão com o candidato já aplicado no namespace público do banco de ensaio de concorrência. O SQL original exato foi aplicado antes dessa adaptação de isolamento. O candidato aplicado ao banco de concorrência é **original.sql seguido de candidato-corrigido.sql**, numa transação única. O segundo arquivo é complemento, não migration autossuficiente.

O harness recusa destino omitido, host/porta/usuário/banco diferentes, parâmetros extras e PostgreSQL fora da versão16. Não usa `DATABASE_URL` como fallback. A conexão de regressão existente mantém suas próprias guardas. A instalação de `pg@8.16.3` foi isolada em `.altan-governance/tools`, sem alteração em package.json/lockfile produtivos.

## Inventário conferido

| Relação/função | Contrato real e ensaio |
| --- | --- |
| `User`, `Company`, `PortalClient`, `CompanyFirmAccess`, `regime_historico` | Identidades existentes. ACL da confirmação real B31 exercitada; fotografia CNPJ conferida na inserção do comando. |
| `apuracao_fs12_revisoes` | FK composta portal/company/PA/revisão, hashes/contexto e trigger imutável existentes, sem desativação. |
| `apuracao_fs12_calculos` | Identidade de cálculo imutável B32; índice composto adicional candidato permite FK escopada. Trigger existente confere envelope e proíbe número declaratório no cálculo congelado. |
| `impedir_mutacao_fs12_calculo()` | Existe e foi reutilizada nas quatro relações. UPDATE/DELETE recusados; não é defesa contra owner/superuser/TRUNCATE. |
| `serpro_chamadas` | PK textual, status mutável e CAS; não possui coluna de versão. `acaoId` não é único. Trigger de associação valida reserva antes do despacho, não torna ledger inteiro imutável. |
| `AppSetting` | PK key, JSON nullable. Marcador real usa `companyId` para **PortalClientId**, reservaId e authorizedAt. FK não congela JSON; fotografia fica na resposta. |
| Quatro relações propostas | Comando/tentativa 1:1; comando/reserva 0..1; observações 0..N; associação ao cálculo 0..1 por comando. Simulação nunca comprova transmissão. |

## Achados e correções propostas

Não houve erro sintático ou incompatibilidade de nomes no DDL original. As permissividades abaixo foram reproduzidas, não inferidas de aprovação da CI.

| ID / severidade | Original observado | Correção na fixture / limite |
| --- | --- | --- |
| D01 alta | `{}`, formato inválido e cifra acima de16MiB aceitos como JSON objeto | CHECK estrutural com sete campos, versão/algoritmo, nonce12B, tag16B, Base64 canônico e limite antes/depois da decodificação. SQL não autentica GCM. |
| D02 alta | `marcadorObservado` divergente e marcador associado a outro portal aceitos | Trigger de resposta confere fotografia, reserva/portal, assinatura, ação, serviço e rota atuais. SHARE no marcador durante inserção. Capacidade interna continua obrigatória; SQL não autentica provedor. |
| D03 alta | Alterar assinatura do ledger após associação permite anexar resposta à cadeia alterada | Revalidação da cadeia em T3a recusa. Atualização técnica de status continua permitida; não adicionar trigger genérica ao ledger legado. |
| D04 alta | Resposta ligada a reserva `abortada_auth` aceita | T3a aceita apenas reservada/ok/erro/incerta. Auth abortada comprovadamente antes da rede não pode produzir resposta oficial. |
| D05 média | FKs sem índices dedicados de marcador/autores/resposta | Quatro índices propostos, sem duplicar PKs/unique que já atendem outros acessos. Plano/custo em escala ainda não medido. |
| C01 alta para integração | SQL bruto `40001` surge como Prisma `P2010/meta.code=40001`, fora do retry atual B31 | Teste preserva a falha e faz repetição local explícita. Futuro adaptador deve traduzir conflito conhecido; não retentar rede nem todo P2010 indiscriminadamente. Produto não foi corrigido neste incremento. |

`MATCH SIMPLE` da FK opcional não permite origem nula em TRANSMITIR/RETIFICAR: CHECK de intenção e NOT NULL dos demais componentes barram. SIMULAR exige origem nula. Outro cálculo da mesma revisão não substitui o vínculo declaratório de entrada; trigger específico rejeita mesmo quando a FK de escopo passa.

Permissões testadas com papel sintético não-owner **leitor de metadados**: metadados separados do corpo, ausência de UPDATE/DELETE/TRUNCATE. Não foram homologados grants do escritor T3a; triggers invoker exigem leituras apropriadas das relações consultadas. Isso não provisiona papéis reais nem protege de administrador. Não conceder credenciais de runtime de proprietário das tabelas na futura implantação.

## Concorrência e autorização

Ensaios usam conexões independentes, barreiras explícitas e observação de `pg_stat_activity.wait_event_type='Lock'`; polling com deadline apenas observa o bloqueio, não usa atraso como prova. Não existe transporte HTTP nesses ensaios.

| Cenário | Evidência e limite |
| --- | --- |
| Advisory isolado sob Serializable | Transação que esperou pode continuar com snapshot anterior; reproduzido. Não usar espera como prova de revisão vigente. |
| Contador compartilhado existente/ausente | Escrita concorrente em `fs12_coord` recusa snapshot antigo com SQLSTATE40001. Forma inválida/overflow recusados sem zerar valor. |
| Confirmação FS12 vence autorização | Caso de uso e persistência B31 **reais**, envolvidos por wrapper de teste que adiciona lock/contador, confirmam revisão2; autorização experimental obsoleta aborta. |
| Autorização vence confirmação | Marca local sintética sobre revisão1 é preservada; B31 envolvido recebe P2010/40001. Repetição local explícita confirma revisão2; marca antiga não muda. Não é despacho SERPRO. |
| T3a divergente vence T3b | Conexão antiga aborta; releitura encontra duas observações, sem associação automática. |
| T3b vence resposta divergente tardia | Associação original permanece e segunda observação é preservada. Não desfaz cálculo nem concede novo ato. Projeção/bloqueio transversal futuros não estão implementados. |
| Rollback de promoção | Associação desaparece, resposta comprometida antes permanece. |
| CAS reserva / replay | Só uma atualização condicional vence; conexão independente relê marcador e incerta; replay de resposta não duplica. |
| Marca persistida sem resposta | Nova conexão encontra reserva e marcador comprometidos, sem resposta. Representa a condição persistida de interrupção, não queda física do processo ou recuperação do servidor. |
| Usuário revogado | B31 real recusa confirmação. Custódia é capacidade separada vinculada à tentativa, não autorização humana para novo despacho. |

Ordem proposta continua global73517001 → ciclo73517002 → company_automation → ACL/cadastro → ciclo/FS12 → snapshot/comando/reserva/marcador. Código atual diverge entre reserva e despacho (empresa/ciclo invertidos); ambos possuem global antes, portanto a mera inversão não prova deadlock. Esta entrega prova o trecho empresarial/contador e conexões descritas, **não certifica ausência de deadlocks em todos os escritores legados**. Inventário/adaptação de todos os pontos que obtêm locks e ensaio integrado com CallGuard, pausas, ACL e remapeamento continuam gates da implementação futura. Não manter SQL aberto durante autenticação/HTTP.

## Cifra, capacidade, retenção e recuperação

AES-256-GCM foi ensaiado com chaves32B aleatórias apenas em memória, nonce12B e tag16B. AAD identifica portal, Company, PA, comando, tentativa, reserva e tipo de evidência, além da versão, keyId e hash. Alteração de qualquer campo, tag, corpo, nonce, chave ou hash recusa decifração; nenhum plaintext parcial é devolvido antes de `final()` válido. Limite16MiB exato é aceito; excesso é recusado, nunca truncado. AAD de outra empresa ou envelope/resposta não é intercambiável.

Capacidade HMAC sintética prova somente o modelo testável de binding e segregação: reserva, assinatura, envelope e marcador/instante exatos, ação limitada à custódia e nenhuma permissão de rede. Não é identidade de serviço implantada. Replay autêntico continua dependendo da unicidade SQL. Revogar usuário não transforma a capacidade em nova autorização fiscal. Recuperação/rotação usam mapa efêmero de chaves; não comprovam restauração fora da máquina, provedor real ou custódia corporativa.

Permanecem decisões humanas: provedor de chave independente da base e dos certificados, emissão/revogação de capacidades internas, acesso excepcional ao histórico remapeado, retenção fiscal/jurídica e restauração corporativa. Não há TTL, descarte automático ou crypto-erasure. Resposta acima do limite exige custódia alternativa aprovada; sem corpo recuperável permanece resultado incerto. Não guardar headers/tokens/certificados. SQL valida estrutura e cadeia, não prova aceite fiscal nem autenticidade da Receita.

## Competência prospectiva

Fixture restrita a PGDASD/TRANSDECLARACAO11 normaliza `pa` inteiro/string AAAAMM e aliases explícitos concordantes. Recusa ausência, booleano, fração, mês00/13, JSON inválido e aliases divergentes. Não preenche ledger histórico e não altera envelope/assinatura. Aceitar sintaticamente PA2027 não o homologa. B33a continua `mesesPropostos:null` e `autorizaEfeitoFiscal:false`; guardas B32 continuam bloqueando PA11/12/2026 e2027. Os testes existentes de transporte real com doubles continuam parte da regressão.

## Execução reproduzível e evidências

Executar somente após criar cluster descartável novo e aplicar as migrations integradas. Não apontar os comandos para banco existente. Instalar ferramenta `pg@8.16.3` em diretório privado de ferramentas; definir `ALTAN_FS12_DDL_PG_MODULE` para seu módulo e `ALTAN_FS12_DDL_DATABASE_URL` para o destino permitido. Testes de constraints criam namespace transitório e fazem rollback; concorrência/custódia requerem candidato aplicado no namespace público do **banco descartável**. Nunca executar essas fixtures pelo pipeline de migrations produtivo.

```powershell
node --test apps/api/scripts/fs12-b33b1-ddl/constraints.postgres.test.mjs
# Somente no descartável novo: psql --single-transaction -v ON_ERROR_STOP=1
#   -f docs/modules/fixtures/fs12-b33b1-ddl/original.sql
#   -f docs/modules/fixtures/fs12-b33b1-ddl/candidato-corrigido.sql
node --test apps/api/scripts/fs12-b33b1-ddl/concorrencia.postgres.test.mjs
node --test apps/api/scripts/fs12-b33b1-ddl/custodia.postgres.test.mjs
node --test apps/api/scripts/fs12-b33b1-ddl/criptografia.test.mjs apps/api/scripts/fs12-b33b1-ddl/pa-prospectivo.test.mjs
node docs/modules/fixtures/fs12-b33b1-ddl/ensaio-prisma.mjs
```

Prisma5.22 validou cópia privada composta do schema integrado com o fragmento candidato. O schema principal permaneceu com SHA256 `7cd1a627e05d0d80568ea3640a6b4599c9faa42f9e59d06bdc8f92c6b3e8cc09`. Checks, triggers e índice parcial não são representados integralmente por Prisma; `validate` não substitui provas SQL nem aprova migration.

Resultados locais consolidados e pareceres são registrados em `docs/governance/changes/2026-11-18-pgdas-b33b1-ddl.json`; CI no SHA final fica no PR. Regressões: **561/36 suítes, incluindo62 PostgreSQL16**, zero falhas/ignorados finais. Governança40+48; diagnose5023→5023, zero novas violações. Nenhum teste do candidato está automaticamente incluído nos workflows existentes; evidência local do DDL é explicitamente separada da CI geral, sem alteração de gates.

Falhas de preparação preservadas: leitura inicial da lista de regressão com caminho incorreto (execução interrompida e repetida com35 caminhos verificados); invocação de glob de arquitetura no Windows corrigida para arquivos explícitos; paths dos harnesses; colisão de namespace resolvida por schema transitório; execução do complemento sem original corrigida pela aplicação atômica dos dois; regex Base64 com16MiB corrigida para validação canônica sem regex recursiva. O conflito Prisma40001 é achado técnico substantivo, não ocultado como simples erro de teste.

Controlador `2026-11-18T19-41-57-608Z-62f6e639`: planejamento concluído, nenhuma execução pelo executor; **escalated**, motivo `Governance/configuration changes require separate human-reviewed integration`. Principal executou o escopo autorizado e obteve revisões independentes sem modificar controlador/gates. **Sem ready_for_human.** UI/UX não se aplica, pois não há mudança visual.

## Critérios para próxima decisão

1. Revisar o SQL corretivo e mapeamento Prisma, privilégios mínimos, limites e custos. Aprovar migration futura separadamente; esta fixture não pode ser promovida automaticamente.
2. Aprovar tradução restrita de P2010/40001 e protocolo compartilhado de todos os escritores; ensaiar integração completa e limites de retry local antes de conectar transporte.
3. Definir custódia/chaves/capacidade/retenção, recuperação e tratamento de excesso de tamanho antes de dados reais.
4. Homologação dos meses SERPRO continua independente. Nenhum resultado deste ensaio libera guardas ou B3.3b.2.

Rollback desta entrega: reverter somente fixtures/testes/documento/registro, sem estado produtivo. Preservar arquivos e cluster de ensaio; não descartar evidências como rollback. Futuro rollback de binário deve preservar tabelas/custódia e impedir repetição incerta. Integração humana do PR não equivale a autorização de produção.

Fontes técnicas: [PostgreSQL16 — isolamento](https://www.postgresql.org/docs/16/transaction-iso.html), [constraints](https://www.postgresql.org/docs/16/ddl-constraints.html) e [Node20 — crypto](https://nodejs.org/docs/latest-v20.x/api/crypto.html). As conclusões acima se limitam aos ensaios executados; fontes não substituem homologação fiscal.
