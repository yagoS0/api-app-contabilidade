# P0 — isolamento ADN por empresa

Base: `b4cf79ef4c0252300950d7f7d9efe94c4efae914`. Data: 22/11/2026.
Branch: `codex/nfse-adn-isolamento-p0-20261122`.

## Causa e comprovação

Em `AdnRepository.listNotas`, a expansão do objeto do cursor substituía o `OR` de prestador/tomador em `direcao=todas`. A autorização da rota era executada, mas o predicado da consulta perdia o pertencimento. O DTO inclui XML, portanto o impacto potencial é de confidencialidade fiscal. Não há evidência de ocorrência em produção.

Antes da correção, o principal executou o teste automatizado contra o código original: **2 falhas e 4 controles aprovados**. A fixture intercalava documentos de duas empresas; a página seguinte incluía o documento alheio. Evidência local: `.altan-governance/adn-reproducao-base.log`.

## Matriz antes/depois

| Cenário | Antes | Depois / prova |
| --- | --- | --- |
| Todas + cursor | OR empresarial substituído | OR empresarial AND OR do cursor; páginas só da empresa |
| Emitidas/recebidas | Predicados individuais | Preservados; testes nas três direções |
| Cursor inválido | Ignorado | Preservado; não amplia empresa |
| Cursor de outra empresa | Podia vazar na direção todas | Cursor só limita posição, nunca identidade |
| Documento alheio no legado | Sem guarda antes do upsert | Recusa explícita; sem documento/escrita de cursor |
| Identidade ausente | Moderno permitia persistir | Resultado inconclusivo; sem gravação ou conclusão silenciosa |
| PortalClient divergente | Confiava no CNPJ recebido | Confere CNPJ do destino pelo mesmo tx |
| NSU já existente | Atualização global por NSU | Revalida vínculo e identidade; divergência bloqueia |
| Corrida de criação | Unicidade global | Vencedor revalidado; outra empresa não sobrescreve |
| Corrida de atualização | Sem condição de revisão | Condição por updatedAt e identidade; conflito explícito |
| Evento com tomador ausente | Atualização por chave global | Chave + empresa + participantes conhecidos; ausência não apaga tomador |
| HTTP negado | ACL existente | ACL real preservada; sem consulta documental, escrita ou transporte |
| Ambiente prod/hom | Sem dimensão nas tabelas/cursor legados | **Limitação preservada e não homologada por este P0** |

## Arquitetura e contratos

NFS-e é o contexto proprietário. O novo recorte está em `modules/nfse`: domínio puro decide vínculo; aplicação reutiliza a normalização compartilhada; `public.js` expõe somente a validação; adaptador Prisma lê a identidade do destino. `composition/nfseAdn.js` é uma ponte transitória para a ingestão legada, não um modelo para novos casos de uso, que devem receber portas por injeção.

Consumidores diretos: GET `/api/notas`, `AdnSyncService`, captura moderna `AdnNotasService` e importação manual de XML. Consumidores indiretos de PortalInvoice permanecem sem edição. Não foram criadas dependências de NFS-e para Apuração, Guias ou Contabilidade. Não se alteraram schema, migrações, transportes, calendário IBS/CBS, contratos NT009, emissão ou interpretação de cancelamento.

Preservados: HTTP/DTO, XML retornado, formato base64/JSON do cursor, ordenação updatedAt/id descendente, limites, filtros, cursor inválido ignorado, normalização documental, regras de consulta e cursor legado `maxNSU + 1`. As escritas internas passam a exigir o contexto CNPJ; o único chamador produtivo foi atualizado. Erros de vínculo/identidade/conflito são explícitos e mantêm a resposta de falha existente da rota, sem criar sucesso vazio.

Referência operacional: `4edbbc7134008570aa1152d34019c467afabd3aa6768dc89c80830ac166f6113`. Aplicam-se identidade integral e segregação da seção 35. Impacto: documentos sem vínculo comprovável deixam de ser gravados; nenhuma regra tributária muda.

## Validação

- 35 testes focais aprovados em 6 suítes, incluindo 11 PostgreSQL 16: keyset, cursores, HTTP/ACL, vínculo, ausência de escrita, replay, colisão NSU, evento parcial e concorrência em duas conexões.
- 6 testes de `adnSyncIsolamento`: provedor falso, empresa divergente antes do certificado, documento alheio/inconclusivo, lote fora de ordem, vazio e falha após item válido.
- Sem variável explícita de banco: 11 testes PostgreSQL ignorados sem conectar. Com banco, identidade real, versão 16, usuário, nome e loopback são verificados antes das escritas.
- 88 testes de governança e 5 do verificador aprovados. Diagnose: base 5019, candidata 5019, zero novas violações.
- Workflow dedicado usa PostgreSQL 16 descartável, ligado somente ao loopback do runner, sem credenciais produtivas ou transporte externo.
- Regressão ampliada: 2646 aprovados e 2 expectativas antigas de gravação sem identidade rejeitadas. Os dois testes foram atualizados para exigir recusa e zero escrita; a suíte afetada passou 15/15 na reexecução. Os demais 141 arquivos passaram. CI hospedada deve conferir o SHA final; não se declara reexecução integral local após ajuste apenas dos testes.

Evidências locais: `.altan-governance/adn-testes-seguranca.json`, `adn-sync-isolamento.log`, `adn-pg-sem-env.json`, `arquitetura-testes.log` e logs do controlador. Não versionar logs brutos.

## Revisões e governança

O controlador `2026-11-22T17-02-03-608Z-959b6d2e` iniciou planejamento, executor e testes. O executor encontrou EPERM para Node no seu ambiente e entregou uma candidata preliminar. O principal interrompeu o controlador após essa entrega para concluir achados de segurança/arquitetura e corrigir as fixtures, com registro local `principal-handoff.json`. **Não foi declarado ready_for_human**.

Revisores independentes apontaram e foram tratados: import profundo, nova consulta Prisma fora do adaptador, colisões de NSU e evento com tomador ausente. A autoria dos testes ficou separada de sua revisão final. Pareceres independentes de arquitetura, Fiscal/ADN e segurança foram favoráveis ao recorte por empresa, com as ressalvas abaixo. O autor dos testes não emitiu aprovação de sua própria autoria. CI final será registrada no PR. Integração e publicação exigem autorização humana própria.

## Limitações e riscos residuais

1. `AdnDocument` tem NSU global e não tem ambiente; `AdnSyncState` identifica CNPJ e `PortalSyncState` identifica cliente, também sem ambiente. Não certificamos coexistência prod/hom nem fazemos migração implícita. Essa segregação exige incremento próprio de identidade e compatibilidade antes de usar ambientes mistos.
2. O lote legado não é atômico: itens válidos anteriores podem ficar persistidos quando um posterior falha; o cursor final não avança nessa falha. Replay fica protegido por identidade, sem repetir transporte automaticamente.
3. O parser legado pode interpretar CNPJAutor como prestador. Eventos sem evidência suficiente passam a falhar explicitamente, em vez de persistir por presunção; não se redesenhou o parser ou o fluxo de eventos.
4. A leitura do destino usa a transação do chamador; não cria nova coordenação para mudança concorrente do CNPJ cadastral. Não se declara cobertura desse remapeamento.
5. `listByPeriodo` e a rota unificada conservam comportamentos legados de backfill/sincronização; a garantia de GET sem escrita aqui é específica de `/api/notas`.
6. Testes HTTP exercitam handlers e ACL reais com sessão sintética, não login/JWT completo nem certificados reais. Nenhuma evidência foi obtida em produção.

## Rollback

Não há migração nem transformação de dados a reverter. Reverter apenas os commits deste PR restaura o código anterior, mas **reabre o defeito de isolamento**; não é rollback produtivo seguro por si só. Em publicação futura, preferir correção pontual ou suspensão supervisionada da consulta vulnerável, mediante autorização. Nunca apagar documentos ou retroceder cursor automaticamente. Este PR não autoriza publicação, restauração ou reparação fiscal.
