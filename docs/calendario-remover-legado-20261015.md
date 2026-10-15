# Retirada definitiva do calendário legado — 15/10/2026

Decisão explícita do usuário: excluir o calendário antigo e todas as obrigações e tarefas antigas. Esta decisão substitui a compatibilidade oferecida na primeira implantação do calendário unificado.

A interface não oferece mais “Tarefas anteriores” e os componentes dessa tela foram removidos. O calendário unificado permanece nas visões mês, semana, dia e lista; semana/dia conservam a grade de horários com o acabamento do mês.

A migration `20261015220000_remove_legacy_calendar` apaga obrigações, ocorrências, regras, exceções, tarefas pessoais antigas, ocultações e snapshots operacionais. Também apaga cópias importadas com prefixo `legado:`. Tarefas criadas diretamente no modelo novo e seus checklists permanecem. As tabelas antigas ficam vazias por compatibilidade de schema; triggers recusam novas escritas de processos antigos durante a publicação. Rotas legadas retornam 410 e o cadastro de empresa deixa de propagar obrigações.

Não há relação de exclusão em cascata dessas entidades para guias, documentos ou pagamentos. O ensaio PostgreSQL verifica rollback da limpeza, preservação integral da nova tarefa e do checklist, ausência dos registros antigos e recusa de recriação, além da preservação de guia/PDF/pagamento.

Backup nativo Railway antes da limpeza: `calendario-remover-legado-20261015`, criado em 2026-10-15T22:20:55.150Z, ID `9aa5438f-1435-4dd2-89fa-422a9ec2bb8e`. Sem acesso a históricos antigos pela aplicação. Evidências de contagens e navegador em `test-evidence/calendario-remover-legado/` (ignoradas pelo Git).
