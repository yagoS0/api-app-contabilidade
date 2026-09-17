# Abertura até a ficha da empresa — 16/09/2026

O teste `apps/api/scripts/verify-opening-company-postgres.js` percorre abertura com contabilidade recorrente até a empresa cadastrada, com PostgreSQL real e storage local. WhatsApp, assinatura, pagamento e registro/CNPJ são sintéticos. A rede HTTP externa é bloqueada; não há chamadas a modelos de IA, Receita, Meta, bancos ou assinatura eletrônica.

## Caminho validado

1. Mensagem de abertura inicia atendimento e coleta dados na mesma ficha de onboarding.
2. Link público complementa a coleta; envio final encerra o link e cria as etapas internas.
3. Contador registra a análise de viabilidade/escopo e envia a devolutiva por transporte simulado, mantendo o histórico real no banco.
4. Catálogo sintético aprovado calcula abertura e mensalidade. Proposta PDF é gerada, aprovada e enviada; aceite público fixa versão e opção recorrente.
5. Modelo gera o contrato preenchido. O PDF recebido não assina automaticamente: há conferência humana da assinatura e do pagamento do contrato exato.
6. Viabilidade, DBE/Junta e CNPJ definitivo são marcos externos, apenas declarados como simulados neste teste. Nenhum registro público é realizado.
7. A revisão do cadastro reaproveita sócios, capital e contato; a resposta pública simulada completa CNAEs, endereço, natureza, porte e data. Regime efetivo exige escolha do contador.
8. Conversão cria empresa, responsável, vínculos, contato de comunicação e documentos na mesma transação. Abre a aba Cadastro da nova empresa. Os documentos ficam no acesso Documentos da empresa.

## Defeitos reproduzidos e corrigidos

- A conversão anterior criava a empresa sem transferir os PDFs do onboarding. O teste original falhou ao procurar os quatro anexos no cadastro final.
- A revisão descartava sócios, capital, CNAEs secundários e dados cadastrais da consulta. Agora envia esses campos após revisão explícita.
- A criação e o vínculo do onboarding eram transações separadas. Agora a falha na finalização reverte a empresa e seus vínculos.
- A navegação permanecia no onboarding e o callback ignorava a aba solicitada. Agora termina em `/companies/:id/cadastro` e os atalhos de documentos/certificado respeitam seu destino.
- Valores numéricos decimais eram normalizados como texto brasileiro, removendo o ponto decimal. Capital e participação numéricos agora conservam seu valor.

## Arquivos e integridade

`ArquivoConversaoService` lê os PDFs cifrados e confere SHA-256; prepara os objetos no `GuideStorageService` já usado pelos documentos da empresa. Arquiva os anexos originais, a projeção pública da proposta aceita e a minuta emitida do contrato. A minuta não é apresentada como documento assinado: o PDF assinado continua sendo o arquivo recebido e conferido.

As linhas de `CompanyDocument` são criadas junto da empresa e do vínculo do onboarding. Download, e-mail e WhatsApp continuam usando o armazenamento padrão, sem um segundo tipo de referência. Os originais cifrados permanecem no onboarding. Objetos preparados antes de um rollback podem ficar sem referência no storage; têm chaves por conteúdo, não ficam visíveis ao cliente e uma nova tentativa pode reaproveitá-los.

Upload e fechamento reservam a mesma linha do onboarding. O fechamento compara novamente as fontes; se chegou um novo anexo durante a preparação, recusa e pede nova tentativa. Fichas encerradas recebem novos arquivos somente em Documentos da empresa. O atendimento é encerrado e a etapa CONVERSAO é marcada concluída; certificado e obrigações externas não são declarados prontos automaticamente.

Só fichas sem proposta comercial seguem a compatibilidade antiga. Havendo proposta, exige a última versão aceita, não revogada, contrato recorrente com assinatura conferida e pagamento conferido para esse contrato. A recuperação de uma conversão antiga exige escopo e CNPJ coincidente, sem sobrescrever o cadastro da empresa existente.

O contato conserva e-mail e telefone normalizado. Autorização para WhatsApp só é registrada quando explicitamente conferida no formulário. Permissões do assistente não são concedidas automaticamente.

## Reproduzir

Somente banco local descartável, usuário `lead_test`, porta `55440`, banco `lead_flow_check`. Aplicar as migrations antes. Não apontar a produção.

```sh
node apps/api/scripts/verify-opening-company-postgres.js postgresql://lead_test:ci_test_only@127.0.0.1:55440/lead_flow_check
```

`OPENING_TEST_OUTPUT` pode definir uma pasta absoluta para os PDFs, ficha final, revisão e relatório JSON. Por padrão, cria uma pasta temporária. Os registros sintéticos identificados pela execução são removidos ao terminar; os artefatos locais ficam para revisão. O workflow Commercial leads repete o cenário após a regressão comercial existente.

Cobertura adicional: documento corrompido, storage indisponível, anexo concorrente, falha no fechamento com rollback, pagamento ausente, upload após encerramento, conversão concorrente/repetida, sócios com percentuais decimais e navegação apenas após sucesso. Os testes não validam a interpretação de linguagem por um modelo real nem a aprovação de registros pelos órgãos públicos.
