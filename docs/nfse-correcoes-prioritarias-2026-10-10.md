# NFS-e — primeira entrega das correções prioritárias

Primeira entrega implementada e validada localmente em 10/10/2026, sobre HEAD `7061b2f`, preservando alterações de outros trabalhos. Referência: `plano-conformidade-emissao-nfse-2026-10-06.md`. Não houve publicação, migração de produção, transmissão de NFS-e ou consultas fiscais pagas.

## Implementado

- `resolverContextoFiscalDaNota.js`: núcleo puro reutilizado na preparação fiscal e no pré-voo/gerador da NFS-e. Aproveita os resolvedores existentes de NBS, IBS/CBS e tributação municipal.
- `obrigacaoIbscbs.js`: decisão versionada por competência, regime e categoria no escopo de serviços da LC 116. Se obrigatória, integração desligada ou campos vazios recusam a emissão. Enquadramento indeterminado não vira dispensa. Não modifica código tributário nem escolhe benefício.
- `localDaPrestacao.js`: local explicitamente informado na operação prevalece sobre o perfil. Um local explícito inválido não é substituído silenciosamente. O fallback anterior para município emissor permanece identificado como suposição; ainda não representa conferência de todas as exceções de incidência.
- Portal do cliente: município da prestação permanece editável com perfil configurado; a seleção chega ao payload. Texto corrigido para não equiparar local da prestação e incidência do ISS. Em branco, continua usando a resolução do backend.
- Benefício municipal cadastrado gera pendência de conferência antes de reservar número: o sistema ainda não envia `BM`. Cadastro legado não é interpretado como prova de concessão aplicável, e a orientação não manda apagar dados para emitir.
- Editor de perfis: categoria para prazo de IBS/CBS, avisos de integrações desativadas e exportação não suportada. Valores legados continuam editáveis. Texto do benefício atualizado para refletir o bloqueio.
- `snapshotFiscal`: registra categoria, versão/decisão do prazo e origem/local efetivo quando há emissão. Mantém lista explícita de dados, sem certificados ou senhas.
- Códigos novos classificados como falha local, com número intacto e correção específica. Lote e recorrência delegam ao mesmo `NfseService.issue`, assim como as rotas de escritório e cliente.

## Matriz de regras desta entrega

Fonte principal: [Ato Conjunto RFB/CGIBS nº 4/2026](https://www.cgibs.gov.br/upload/arquivos/202607/31091735-20260730-16h30-ato-conjunto-rfb-cgibs-na-c2-ba-4-260731-090909.pdf), art. 1º, III e §1º, e [orientação do CGNFS-e](https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-orienta-sobre-os-prazos-para%20destaque-de-ibs-cbs-nas-notas-fiscais-de-servico), consultada novamente em 10/10/2026. A aceitação técnica sem IBS/CBS durante a transição não prova dispensa legal.

| Cenário coberto | Decisão |
| --- | --- |
| Não optante, serviço ISS fora das hipóteses especiais, categoria confirmada `SERVICO_ISS` | Prazo de 01/10/2026. |
| Serviços dos subitens 1.03, 1.05, 1.09 e 16.01 | Prazo de 01/12/2026. |
| Hipótese legal de plataforma, confirmada pelo contador como `PLATAFORMA_DIGITAL` | Prazo de 01/12/2026; não inferida de CNAE ou uso da internet. |
| Serviço geral sem categoria em outubro/novembro | Indeterminado: depende da distinção entre hipótese geral e plataforma; exige classificação. |
| Categorias cobertas a partir de dezembro | Obrigatório para não optante; não há omissão por campo vazio. |
| Simples em 2026 | Prazo ainda não iniciado no Ato 4/2026; preenchimento segue validações técnicas se declarado. |
| Simples a partir de 2027 | Indeterminado nesta versão: opção/enquadramento adicional ainda não implementado. Não liberar automaticamente com regras de 2026. |
| Regime/competência desconhecidos ou fornecimento fora do escopo da lista LC 116 | Conferência necessária. Sem enquadramento automático. |

O código usa o regime fornecido pelos cadastros atuais, como o restante do emissor. Esta entrega não cria histórico de regimes nem comprova que o regime atual serve para toda competência retroativa. Esse limite continua na etapa 3 do plano. A categoria descreve operações recorrentes do perfil; empresas com contextos diferentes devem usar perfis correspondentes, conferidos pelo escritório.

O contrato XML permanece `nfse-nacional-dps-1.01-20260727`; não se adotou a hierarquia da NT 009 apenas por publicação. Referências: [documentação de produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual), [RTC](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc) e [atualizações de implantação](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/atualizacoes-e-implantacoes).

## Migração e compatibilidade

Migração aditiva `20261010120000_categoria_obrigacao_ibscbs`: coluna nullable `categoriaObrigacaoIbscbs` em `perfis_emissao_nfse`, com CHECK de domínio. Sem backfill de enquadramento e sem modificação de notas antigas. POST/PATCH do perfil validam valores; ausência no PATCH preserva, nulo limpa. Campo de contexto separado da lista de tags do XML.

Sequência de implantação: aplicar migração e gerar cliente Prisma; publicar backend compatível e interface; conferir flags reais de perfis/IBS-CBS e classificar os perfis que precisarem antes de habilitar o fluxo para empresas afetadas. Não desligar flags para contornar obrigação. Se a produção ainda não consegue representar uma operação obrigatória, manter bloqueio e usar o canal oficial adequado.

Pontos de atenção: migração precisa chegar antes do novo cliente Prisma; cadastros com benefício passam a exigir conferência; não optantes sem classificação podem ser bloqueados em competências a partir de outubro. A implantação requer diagnóstico da carteira real, ainda não acessada nesta entrega.

## Verificação e limites

Testes incluem prazos na fronteira de datas, Simples, categorias desconhecidas, ausência de dados, flags desligadas, cenário obrigatório corretamente preenchido, local divergente, persistência da categoria, classificação da falha e recusa antes de transação/numeração.

Resultados locais:

- API: 46 suítes e 916 testes aprovados na regressão de NFS-e, NBS e rotas de perfis. Inclui as suítes existentes do gerador e contrato XSD. Teste prioritário executado também isoladamente: 19 aprovados.
- Escritório: editor e aba de emissão, 21 testes aprovados; benefício municipal, 15 aprovados após corrigir o aviso legado do assistente. A execução adicional do editor também passou.
- Portal: 2 suítes e 37 testes aprovados, incluindo seleção de município com perfil e envio no payload.
- Builds do escritório e portal aprovados, com avisos de tamanho de bundle/importações existentes.
- `prisma validate` e `prisma generate` aprovados usando URL fictícia local, sem conexão a banco. Migração SQL preparada, ainda não executada nem validada em PostgreSQL real.
- `git diff --check` sem erros nos arquivos alterados.

Ainda pendentes do plano: diagnóstico completo da carteira e preview de conformidade por operação; revisão de cadastro entre prévia e confirmação; histórico de regime; mapa de exceções do ISS e parâmetros municipais; revisão integral das retenções; aplicação efetiva de benefício no XML; exportação/intermediário; novas finalidades/contratos da NT 009; homologação externa e publicação. Não confundir bloqueios preventivos desta entrega com implementação dessas capacidades.
