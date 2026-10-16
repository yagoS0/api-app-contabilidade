# Mapa inicial de dependências

`domains.json` é o mapa executável por prefixos cumulativos. `consumers` aponta de
um produtor para consumidores que precisam ser revisados. Fechamento transitivo e
ciclos são suportados; relações são conservadoras, não um grafo completo de imports.
Prefixo terminado em `/` cobre diretório, `*` final cobre famílias de nomes;
sem esses sufixos o caminho é exato. Registros JSON de evidência não elevam risco.
Não é autorização para editar todos os domínios encontrados. Revisor de domínio pode
cobrir vários domínios, mas deve emitir evidência separada para cada um.

| Produtor | Consumidores/efeito | Evidência inicial |
| --- | --- | --- |
| Shared | API e dois portais | workspaces e dependência @contabilidade/shared |
| Contabilidade | Guias, carteira, relatórios | routes/firm/accountingEntries.js importa serviços de guias e apuração |
| Apuração | Guias e contabilidade | guideCompliance.js e accountingEntries.js importam FechamentoService |
| Guias/parcelas | Carteira e operações | company/FluxoCarteiraService.js importa guideCompliance.js; este importa parcelamento |
| Dados | Serviços, workers e portais | schema.prisma, migrações e contratos HTTP |
| Comunicação | Guias e comercial | serviços de WhatsApp, assistente e testes CI correspondentes |

Exemplo solicitado: alteração em `apps/web/src/features/accounting/` ativa web e
accounting; seguem revisão de Guias, Operações, Comunicação, Comercial e portal pelo
grafo conservador. UI/UX avaliam ação/recarga; backend rastreia rota e autorização;
dados participa se persistência for alterada; sistêmico julga os efeitos transversais.
O orquestrador deve justificar falsos positivos e aprofundar dependências novas.

Para adicionar uma área: localizar fontes e consumidores reais, adicionar prefixos
específicos e relações, atualizar AGENTS.md aplicável e testes do planejador. O gate
rejeita domínio inexistente e caminho desconhecido. Arestas semânticas ainda exigem
manutenção humana; não afirmar que este mapa descobre automaticamente toda dependência.
