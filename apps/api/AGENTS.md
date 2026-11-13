# Governança do domínio

Aplique a [norma de arquitetura](../../docs/governance/ARQUITETURA.md) à rota, ao caso de uso e aos adaptadores envolvidos. Novas políticas de domínio devem ser puras. Consuma outros contextos pelo ponto público e declare quem escreve cada fato e quem coordena a transação.

Aplicam-se AGENTS.md da raiz e docs/governance/POLICY.md.
Leia também as decisões CLAUDE.md deste escopo antes de editar.

Backend: rastrear rota → serviço → persistência → projeções. Autorização e isolamento devem ser validados no servidor. Testes Jest do escopo sem rede; mudanças transacionais também exigem PostgreSQL descartável.

Registre impacto operacional ou ausência dele e evidências reais. Não alterar regras de negócio pendentes por conveniência técnica.

### Piloto de correção do valor de uma guia

Guias coordena a prévia e a confirmação. Contabilidade decide a elegibilidade da provisão, das linhas e da competência e responde por suas alterações. Na futura extração, preserve autorização por empresa, payloads e erros HTTP, compatibilidade da revisão e uma única transação Serializable para guia, provisão e auditoria.

Execute os cenários e o diagnóstico de imports conforme `.github/workflows/piloto-correcao.yml`. Nesta primeira etapa o relatório arquitetural quantifica dependências legadas e acréscimos; falhas do verificador e dos testes devem ser investigadas. Use exclusivamente o PostgreSQL descartável do piloto nos ensaios de escrita.
