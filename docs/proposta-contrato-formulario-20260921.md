# Proposta comercial e contrato por formulário — 21/09/2026

O PDF apresenta sete seções: empresa, entregas, gestão, investimento, benefícios, limites/adicionais e condições/aceite. A marca usa a geometria existente do portal, tipografia hierárquica e investimento destacado. Corpo longo pagina sem perder conteúdo; rodapés não criam páginas vazias. Escopo específico da opção sempre acompanha a apresentação resumida.

## Origem dos dados

`calcularOpcoes` congela `apresentacao` do catálogo aprovado e `limitesPlano` junto aos preços. Os limites vêm da faixa e dos blocos de documentos já incluídos no cálculo, não da contagem declarada no perfil. Orçamento personalizado sem faixa não inventa franquia. Consultoria segue a regra existente do catálogo; a descrição gerencial só é incluída quando contratada ou coberta pela faixa. Avulso não herda benefícios mensais. Valores, cláusulas, minuta e catálogo reais continuam no banco privado, fora do Git.

`propostaParaCliente` projeta somente campos públicos. Piso, justificativa, fonte, IDs internos e evidências manuais ficam fora. Alterar a biblioteca não muda o snapshot de proposta existente. Propostas antigas preservam o escopo e não ganham benefícios retroativos nem uma exclusão de consultoria que não estivesse documentada. Para usar a nova apresentação completa em um rascunho anterior, gerar uma nova versão e conferir antes de aprovar.

## Contrato

`packages/shared/src/onboarding/contratoComercialCampos.js` contém apenas metadados públicos dos campos, normalização e sugestões. Dados institucionais aprovados, cadastro, padrões privados do modelo e edição do contador compõem o formulário. Honorários, escopo e condições da opção aceita são protegidos no servidor; CNPJ vem da ficha. Regime e franquias congelados também são protegidos; proposta legada sem franquia exige conferência manual, sem inventar limites.

O formulário permite preencher e visualizar modelos em rascunho, mas só modelo aprovado e compatível com modalidade/CNPJ gera contrato. A geração conserva o texto e a versão do modelo. A minuta padrão fornecida pelo escritório tem aviso de revisão; a versão com marcadores nomeados permanece rascunho até a conferência e aprovação normal na biblioteca. Não é aprovação jurídica nem assinatura. Campos específicos de cada empresa não devem ser salvos como padrões gerais. O catálogo não é contrato nem substitui revisão das condições.

Não há mudança de schema, integração DocuSign/Asaas, assinatura automática, alteração de proposta aceita ou envio ao cliente nesta implementação. O formulário não permite mudar o preço após aceite; ajustes comerciais são feitos em nova contratação conforme as guardas existentes.

## Validação

Testes usam dados sintéticos: sete seções, PDF de duas páginas sem rodapé extra, textos longos, orçamento avulso/mensal/comparação, limites com blocos extras, privacidade da projeção, preservação de legado e escopo específico, campos obrigatórios, edição de sugestões e preços protegidos. Fluxo real do serviço validado de gerar/aprovar/aceitar até contrato com dependências locais; CI também executa a jornada em PostgreSQL descartável. Revisão visual de PDF e formulário no navegador, sem IA, transporte WhatsApp ou consulta fiscal externa.
