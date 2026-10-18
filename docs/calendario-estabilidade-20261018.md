# Calendário: atualização contínua e ações — 18/10/2026

## Comportamento entregue em desenvolvimento

O calendário conserva sua grade e rolagem durante gravações e releituras. O aviso de atualização ocupa um espaço fixo: no baseline Chrome, concluir uma tarefa deslocava a grade em 50 px (322 → 372 → 322); após a correção, permaneceu em 350 px, com o mesmo nó e scrollTop 600. A resposta persistida atualiza o item, e a releitura confirma o conjunto. Uma leitura invalidada ou de outro período não sobrescreve a confirmação.

O menu de três pontos está disponível em mês, semana, dia e lista para a ocorrência principal. Projeções de véspera/vencimento continuam ligadas à mesma ocorrência e sem ações independentes. O menu abre fora do recorte dos cartões, permanece dentro da viewport, suporta setas, Escape e retorno de foco. Excluir remove somente a ocorrência após confirmação, preservando a série e o histórico; Excluir série continua separado na lista.

Duplicar ocorrência cria imediatamente uma tarefa avulsa pendente, identificada por “(cópia)”, com o conteúdo, período, prazo e empresas da ocorrência efetiva. Subtarefas recebem novos IDs. Não copia estados, conclusão ou evidências. A série original permanece intacta. Esta escolha conservadora está registrada na regra R30; não há duplicação implícita da série inteira.

## Segurança da persistência

A interface guarda o UUID de intenção em sessionStorage, por tarefa/ciclo, antes do envio. Resposta perdida conserva a intenção inclusive após remontagem/recarga da mesma aba. O serviço deriva o ID da cópia de usuário + tarefa de origem + ciclo + intenção, valida acesso e executa sob o lock transacional da origem. Tentativas concorrentes ou repetidas recuperam o mesmo resultado. Cópia excluída não é recriada. A interface não envia duplicação se não puder guardar a tentativa; falha ao limpar conserva a recuperação idempotente. Não há schema novo. A recusa definitiva `CALENDAR_COPY_DELETED` oferece “Iniciar nova duplicação”: somente essa ação consciente gera uma intenção nova, mantendo a cópia anterior excluída. A ação se vincula à tarefa/ciclo e ao contexto da tela original; some ao navegar. Timeout e outros erros, inclusive 409 genérico, não liberam essa recuperação nem iniciam envio automático.

A sessão da aba é o limite da recuperação automática da intenção. Fechar a aba, limpar seus dados ou usar outra aba perde essa intenção local; nessas situações, conferir a cópia existente antes de iniciar nova duplicação. O servidor continua deduplicando qualquer repetição com a intenção original. Ação explícita seguinte, após resposta confirmada, recebe uma nova intenção.

Durante gravação, outras ações de mutação são bloqueadas; chamada recusada por ocupação não retorna sucesso silencioso. Exclusão falha mantém a confirmação. Respostas vazias de gravação/listagem são recusadas e não representam sucesso nem calendário vazio. Gravação do editor tem trava de duplo envio.

## Regras e impacto

Aplica R19/R20/R22/R24/R30 e cenários T43–T45 da referência operacional canônica e sua cópia reconciliada. Sem mudança fiscal, financeira, de guias, contratos ou atendimento. Sem migração, backfill, dados reais, chamadas fiscais ou mensagens externas. As decisões de negócio pendentes permanecem pendentes.

## Evidências locais

- Jest web: 139 testes em 21 suites na rodada dirigida; após a revisão independente da recuperação, os 11 testes da suite afetada passaram novamente; inclui teclado/menu, cópia independente, exclusão/cancelamento, gravação lenta, leitura fora de ordem, recuperação da mesma intenção após resposta perdida e remontagem, storage indisponível e GET antigo após gravação pelo painel/editor.
- Jest API: 29 testes em três suites de tarefas unificadas.
- PostgreSQL real descartável: `apps/api/scripts/verify-calendar-duplicate-postgres.js`, 11 blocos aprovados. Inclui quatro duplicações concorrentes → uma cópia, conclusões concorrentes por empresa, histórico preservado, recusa de escopo parcial/tarefa privada, recuperação após editar e exclusão sem recriação. Fixtures removidos no finally; banco local com sufixo `_governance_test`, provedores proibidos.
- Chrome local temporário, apenas mock e rede fora de localhost bloqueada: 24 capturas em 1440/390, mês/semana/dia/lista, menu em cartão curto, validação de horário, foco/Escape, duplicação/exclusão, movimento/redimensionamento por teclado e movimento com ponteiro. Sem overflow de página ou pageerror. Inspeção visual direta de mês móvel, menus desktop/móvel, cartão curto e mensagem de erro móvel.
- Fingerprint dos seis arquivos de interface capturados: `2f8da888253024ee28411aaf255dad64bf1efb7a57c262ce04e44a7bb72a01b1`, igual antes/depois do QA final.
- Artefatos locais ignorados: `.altan-governance/calendar-qa-baseline`, `calendar-qa-final-reviewed`, `calendar-jest-directed-final.log`, `calendar-api-recovery.log`, `calendar-postgres-recovery.log`; harness `.altan-governance/calendar-qa.mjs`.

O primeiro ensaio PostgreSQL teve uma expectativa de teste incorreta sobre o título-base: edição de ocorrência grava em `estados[].alteracoes`. A expectativa foi corrigida para verificar essa evidência, mantendo a implementação e o contrato. Primeiras rodadas visuais falharam em seletores ambíguos após a criação da cópia e na espera de aviso customizado para um campo barrado pela validação nativa; os seletores e o cenário foram corrigidos, sem alterar timeouts ou gates. A rodada web inicialmente selecionou todos os testes porque “calendario” aparece no nome do worktree; foi interrompida e substituída pela seleção explícita de arquivos.

A revisão independente reprovou a ausência de saída para uma intenção cuja cópia havia sido excluída. A correção foi validada em Jest (resposta perdida, exclusão, remontagem, recusa tipada, nova ação explícita; 409 genérico preservado) e em Chrome local com injeção declarada somente no mock. Quatro capturas adicionais, `calendar-qa-recovery`, mostram resultado incerto e recuperação em1440/390; zero overflow/erros. O registro confirma três envios: duas tentativas com o mesmo UUID e uma terceira com UUID novo somente após clique explícito. A rodada completa de24 capturas foi renovada no fingerprint final. Lint dos arquivos afetados e diffcheck aprovados.

## Integração e reversão

Entrega local sujeita à revisão independente e gates gerais pelo Principal; este documento não aprova sua própria integração. Não publicado. Produção autenticada e dispositivos móveis reais não foram usados neste QA. Antes de integrar, validar o commit final e CI. A reversão pode retirar a interface/ação nova sem apagar as tarefas já criadas; preservar cópias, históricos, tombstones e controles de acesso.
