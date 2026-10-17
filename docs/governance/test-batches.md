# Regressão Jest em processos limitados

17/10/2026 — mudança de governança separada da entrega funcional. O gate API em
processo único esgotou o heap na máquina de desenvolvimento. O runner descobre
todas as suítes pelo mesmo Jest/configuração/cwd e executa lotes sequenciais de
até 25 arquivos, com `runInBand` e `silent`. Não altera seleção, skips, ambiente,
critérios, versões ou o prazo total de 20 minutos do gate. O prazo interno de
19min50s reserva dez segundos para encerrar filhos antes do limite externo.

Discovery vazia, inválida, duplicada, fora do projeto (inclusive symlinks), saída
não zero, timeout, resultado ausente/inválido ou divergência entre os arquivos
descobertos e relatados bloqueiam o gate. Não há retry, lista manual, `forceExit`
ou `passWithNoTests`. O manifesto só recebe `passed` depois da cobertura completa.
Skips e todos são preservados e contados separadamente, sem alegar execução.

Evidências por corrida ficam em `.altan-governance/test-batches/`: manifesto,
discovery, stdout/stderr por processo e JSON original de cada lote. A pasta é
ignorada pelo Git. Não publicar logs brutos. Interrupção abrupta pode deixar
manifesto `running`, nunca aprovado; nesse caso a evidência é incompleta.
Timeout e sinais tratados encerram a subárvore Windows ou o grupo Linux. SIGKILL
direto no runner não pode ser tratado; o operador deve conferir filhos órfãos.

Limites: o isolamento entre processos muda cache e ordem global. As configurações
atuais não possuem projetos múltiplos, globalSetup/globalTeardown ou thresholds
de coverage. O runner verifica `showConfig` e bloqueia essas opções, inclusive
coleta de coverage, até revisão explícita da estratégia;
este runner verifica cobertura de arquivos de teste, não cobertura de linhas.
Não aumenta o timeout: se o custo de inicialização exceder o prazo, reprova.

Impacto operacional: nenhum; regras fiscais, mensagens, permissões e decisões
pendentes permanecem intactas. Risco de governança alto; exige revisão sistêmica
independente e decisão humana aplicável antes da integração. O autor não aprova
a própria alteração. Rollback: restaurar os três comandos Jest anteriores em
gates.json e retirar runner/teste do catálogo; não envolve dados ou migrações.
