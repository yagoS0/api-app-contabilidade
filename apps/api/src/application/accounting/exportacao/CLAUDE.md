# Exportação individual e lote — 08/09/2026

## Seleção individual — 23/09/2026

POST `entries/export/preflight` e `entries/export/csv` recebem uma competência (`competenciaInicio = competenciaFim`) e `entryIds` de 1 a 5000 IDs únicos. Corpo JSON evita limite de URL. Servidor delimita empresa autorizada, competência e tipos exportáveis; IDs ausentes/inválidos recusam o lote. Prévia usa as mesmas regras contábeis, inclusive equilíbrio de grupos, e gera hash de dados/erros/alertas. Download exige esse hash e aceite dos alertas. Confirmação com IDs exige a mesma prévia e valida/marca em transação Serializable; conflitos recusam, sem repetir automaticamente. Rotas GET e exportação por período ficam compatíveis. Não alterar o formato CSV nem importações.

`exportacaoIndividual.js` foi extraído da rota antiga sem mudar CSV/preflight: cinco colunas SEM cabeçalho, data civil, BOM UTF-8, ponto e vírgula e valor decimal brasileiro. A rota individual e o lote usam a mesma função; não criar outro formato ERP.

`exportacaoLote.js` aceita 1–100 ids e intervalo de até 12 meses. Cada id passa pelo MESMO requireFirmCompanyAccess da exportação individual. Bloqueios, alertas e dados são apurados por competência. A geração usa os próprios objetos já conferidos, sem segunda leitura dos lançamentos. Lote não aplica filtros ocultos de tipo/status; exclui PARCELA como o individual.

POST `/firm/entries/export/batch/preflight` responde resumo JSON; POST `/firm/entries/export/batch/zip` refaz a conferência e exige `confirmarAlertas:true` quando necessário. ZIP contém CSV por CNPJ/período e manifesto.json com resultado de cada empresa, inclusive falhas e ausência de movimento. Falha parcial nunca é resumida como sucesso de todas.

Preparar/baixar ZIP não marca status EXPORTADO nem confirma importação no ERP. Essa confirmação exige ato explícito futuro; arquivo baixado não prova importação. Máximo de 50 mil lançamentos por empresa para geração; reduzir intervalo acima disso.

Cada empresa da prévia retorna `preflightHash` (SHA-256 de identidade, período, contagem, erros e alertas ordenados). Download exige `preflightHashes` por id. Mudança invalida só aquela empresa (`PREVIA_ALTERADA`, motivo reconferir no manifesto); demais arquivos seguem. `confirmarAlertas:true` não dispensa o hash nem confirma alertas novos. Hash não autoriza acesso: middleware continua obrigatório.
