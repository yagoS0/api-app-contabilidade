# Aceitação do controlador — 16/10/2026

Ensaio final: dois domínios (ledger e presentation), oito sessões Codex reais e
independentes, duas rodadas. Uma falha deliberada no fixture converteu informação
ausente em zero: testes falharam, ambos os revisores reprovaram, o executor corrigiu,
testes passaram e os revisores dos dois domínios e o juiz sistêmico aprovaram.
Os testes de contrato permaneceram intactos. Registro final criado automaticamente.
Falha injetada somente em projeto sintético isolado: não é bug atribuído ao produto.
31 testes automatizados de governança aprovados. Revisão independente do runtime
aprovada após correções. Na etapa anterior, 50 suítes/725 testes contábeis passaram;
não foram repetidos agora, pois não houve alteração funcional do aplicativo.
CI remoto, builds completos e PostgreSQL real não foram executados nesta entrega.
O gate de banco foi testado para rejeitar ausência de URL e destinos não descartáveis.

CODEX E MECANISMOS ADICIONAIS
Verificados CLI 0.162.0-alpha.17.2, login ChatGPT, execução não interativa, JSON,
schema e sandbox. Subagentes nativos participaram da implementação/auditoria.
O controlador usa sessões CLI reais para tornar o ciclo repetível. O ALTAN fornece
máquina de estados, roteamento, gates, evidências e rejeição/correção obrigatória.
No sandbox Windows, Node pode falhar com EPERM; testes rodam pelo controlador local
autorizado e revisores leem seus logs. Não foi usado bypass do sandbox.
Não há daemon nem bloqueio global de todos os chats do aplicativo. AGENTS fornece
a entrada persistente e o runtime executa o ciclo a cada pedido no projeto ALTAN.

O QUE DEPENDE DE DECISÃO HUMANA / INTEGRAÇÃO
1. Identidade de autoria Git (nome/e-mail) para commit. Não inventamos identidade.
2. Integração da branch e definição de responsáveis humanos no GitHub.
3. Ativação de revisão/checks obrigatórios, invalidação de aprovação antiga e proteção
   de workflows/produção. A obrigatoriedade remota ainda não está ativada.
4. Conciliação do documento operacional canônico para distribuição a novos clones.
   V01–V08 continuam pendentes; a arquitetura não aprovou mudanças de negócio.
Não houve commit, push, PR, merge ou deploy. A instalação local está operacional;
não remova a árvore canônica enquanto os outros checkouts dependerem dela.


Run final: `2026-10-16T17-56-41-379Z-813aa200`. Evidências locais: `C:\Users\yagoa\Documents\Codex\2026-10-16\referenced-chatgpt-conversation-this-is-an-3\work\acceptance-live-final\.altan-governance\runs\2026-10-16T17-56-41-379Z-813aa200`.

A revisão independente identificou alvos previamente alterados, omissão de arquivos novos no diff e ausência de registro final; corrigidos e cobertos por testes. O ensaio preliminar rejeitou um plano que incluía arquivos de referência como alvos; o contrato do planejador foi esclarecido antes dos ensaios aprovados.
