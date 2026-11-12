# Governança do domínio

Aplique a [norma de arquitetura](../../docs/governance/ARQUITETURA.md) à rota, ao caso de uso e aos adaptadores envolvidos. Novas políticas de domínio devem ser puras. Consuma outros contextos pelo ponto público e declare quem escreve cada fato e quem coordena a transação.

Aplicam-se AGENTS.md da raiz e docs/governance/POLICY.md.
Leia também as decisões CLAUDE.md deste escopo antes de editar.

Backend: rastrear rota → serviço → persistência → projeções. Autorização e isolamento devem ser validados no servidor. Testes Jest do escopo sem rede; mudanças transacionais também exigem PostgreSQL descartável.

Registre impacto operacional ou ausência dele e evidências reais. Não alterar regras de negócio pendentes por conveniência técnica.
