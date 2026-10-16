# Auditoria inicial — 16/10/2026

Base isolada: ef939e545e5bc12ff1564690fd7e94c781af47aa, referência origin/main local
no momento da criação. Nenhum fetch remoto usado; isso não certifica a ponta remota.
Branch: codex/governanca-multiagente-20261016, árvore altan-governanca-multiagente.

O diretório ALTAN contém vários repositórios/worktrees e evidências. O monorepo real
é api-app-contabilidade; seu checkout principal tinha 269 arquivos rastreados
modificados. Não foi reutilizado nem limpo. A raiz ALTAN já possui AGENTS.md apontando
para altan-regras-operacionais/REGRAS_OPERACIONAIS.md; foi lida integralmente e preservada.
Não criar cópia divergente do documento operacional em outra branch.

Estrutura: npm workspaces, Node 20, API Express/Prisma/PostgreSQL, portal do escritório
React/Vite, portal do cliente React/Vite e packages/shared. Jest por aplicativo.
AGENTS.md da base concentrava-se em interface/preservação; decisões detalhadas já
existem em CLAUDE.md. Não havia .codex/agents nem instruções Codex por domínio.

CI existente: validate (Prisma, auditoria SQL, geração, sintaxe e build),
usability-regression, whatsapp-regression, whatsapp-postgres, commercial-leads e
whatsapp-confirmacao-postgres. Há deploy manual DigitalOcean e releases por tags;
comentário do workflow informa deploy Railway via main. Nenhum deploy foi executado.
Estado remoto de rulesets, CODEOWNERS, ambientes e permissões não foi auditado.

Lacunas tratadas: instruções por escopo, perfis reutilizáveis, risco e encaminhamento,
mapa inicial, teste do gate e registro de impacto. Lacunas que permanecem: validação
da descoberta dos perfis na instalação do usuário, responsáveis humanos, proteção
remota de branches, referência operacional integrada na branch compartilhada e
homologação ponta a ponta. Sem mudança de código funcional, banco ou regra operacional.
