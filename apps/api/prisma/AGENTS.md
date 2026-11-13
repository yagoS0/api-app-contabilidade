# Governança do domínio

Consulte a [norma de arquitetura](../../../docs/governance/ARQUITETURA.md). Para cada modelo ou campo compartilhado, identifique o dono da escrita, os leitores e a invariante transacional antes de alterar a persistência.

Aplicam-se AGENTS.md da raiz e docs/governance/POLICY.md.
Leia também as decisões CLAUDE.md deste escopo antes de editar.

Dados: revisão de dados e sistêmica. Preservar histórico, compatibilidade e isolamento. Rodar validate, auditoria de SQL e migrações em banco descartável. Migração destrutiva ou execução em produção exige decisão explícita; não usar reset em bases reais.

Registre impacto operacional ou ausência dele e evidências reais. Não alterar regras de negócio pendentes por conveniência técnica.
