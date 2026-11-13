# Governança do domínio

Aplique a [norma de arquitetura](../../docs/governance/ARQUITETURA.md) às features do portal. Consuma apenas os contratos públicos do cliente e teste o efeito de trocar a empresa ou a sessão sobre o estado exibido.

Aplicam-se AGENTS.md da raiz e docs/governance/POLICY.md.
Leia também as decisões CLAUDE.md deste escopo antes de editar.

Portal do cliente: API real sem fallback fictício, isolamento por vínculo e permissões do cliente. Não presumir privilégios do escritório. Mudanças de contrato exigem backend e UX; testar expiração de sessão, recarga e respostas tardias.

Registre impacto operacional ou ausência dele e evidências reais. Não alterar regras de negócio pendentes por conveniência técnica.
