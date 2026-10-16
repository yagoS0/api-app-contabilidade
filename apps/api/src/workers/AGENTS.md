# Governança do domínio

Aplicam-se AGENTS.md da raiz e docs/governance/POLICY.md.
Leia também as decisões CLAUDE.md deste escopo antes de editar.

Workers: agenda explicitamente salva, reserva por execução, idempotência, concorrência e conciliação de resultado incerto. Não fazer chamadas externas nos testes nem executar worker real para validar código.

Registre impacto operacional ou ausência dele e evidências reais. Não alterar regras de negócio pendentes por conveniência técnica.
