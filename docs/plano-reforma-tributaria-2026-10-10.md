# Implementação da reforma tributária no ALTAN

A primeira entrega reúne cadastro com histórico, painel da carteira e conferência local de NFS-e. As próximas entregas devem ligar essa base ao planejamento, à apuração e às obrigações efetivamente aplicáveis à carteira. A prioridade é reconhecer informação incompleta e divergências antes de automatizar decisões fiscais.

Referência do planejamento: 10/10/2026. Desenvolvimento local; implantação em produção é uma etapa separada.

## Primeira entrega

| Área | Comportamento implementado |
| --- | --- |
| Perfil fiscal | Períodos com início e fim, regime, forma de IBS/CBS, situação em estudo/solicitada/confirmada, referência do comprovante e preparação do emissor. Revisões registram autor, data e motivo. |
| Carteira | Painel expansível por competência, busca, filtro de pendências, enquadramento no primeiro dia do mês, emissor, última verificação e links para cadastro/notas. |
| NFS-e | Verificação explícita dos XMLs armazenados de emitidas e recebidas, resultado por documento, acesso ao detalhe, resumo e indicação de análise desatualizada. |
| Persistência | Revisões anexadas sem sobrescrever as anteriores, versão única contra concorrência e identificador de intenção para repetir uma gravação sem duplicá-la. Relatórios conservam versão do cadastro e das regras. |
| Acesso | Autenticação FIRM e acesso à empresa nas rotas. Somente ACCOUNTANT/FIRM_ADMIN alteram cadastro. Carteira respeita vínculos ativos; administrador mantém o acesso global previsto no aplicativo. |

O cadastro começa sem vigências presumidas. A opção oficial não é feita por esta tela. Evidência é uma referência textual ao protocolo ou arquivo já guardado nos Documentos da empresa, e não um comprovante obtido automaticamente do Fisco. A preparação do emissor representa uma conferência do escritório e não é promovida a validada pelo resultado automático das notas.

O histórico alimenta este painel e o verificador. Os motores atuais de emissão, PGDAS e apuração continuam usando seus contratos existentes; a integração de vigência nesses motores exige os critérios da próxima etapa. Não alterar o regime atual desses motores como efeito colateral do registro de uma escolha futura.

### Cobertura do verificador

- Documento nacional completo no contrato 1.01, leitura XML por caminho, limite de 2 MB por documento, recusa de DTD/entidades e XML malformado. Versão ou namespace fora do contrato resultam em revisão.
- Competência do XML e confronto com o mês da base, papel da empresa, emitente e situação armazenada.
- Regime declarado no XML confrontado com o período confirmado, somente em notas emitidas pela própria empresa. Regime do tomador nunca é usado para avaliar o regime do fornecedor.
- Reutilização de `obrigacaoIbscbs`, `nbsDaDps` e `ibscbsDaDps`, incluindo códigos oficiais, compatibilidade CST/classificação e vigência publicada nas tabelas existentes.
- Categoria da operação reaproveitada somente do snapshot da própria emissão, quando a identidade da nota resolve uma emissão única da empresa. Não aplicar o perfil atual retroativamente a documentos recebidos ou importados.
- Falta de dados, leiaute municipal não coberto e obrigação indeterminada ficam como revisão necessária. Canceladas/substituídas/rejeitadas ficam explicitamente fora da conferência de ativas.
- Notas sem competência são incluídas como pendência transversal, além das notas do mês. NF-e fica fora deste verificador.

O resultado “sem achados nas regras cobertas” não certifica assinatura, autorização fiscal atual, cálculos integrais de IBS/CBS/ISS, benefício ou direito a crédito. O lote é limitado a 1.000 documentos, com aviso de cobertura parcial acima disso. A análise não captura documentos, não consulta o Fisco, não corrige XML e não altera situação fiscal, guias ou apuração.

As regras existentes mantêm a obrigação do Simples em 2027 como indeterminada enquanto o contrato fiscal específico da operação não estiver implementado. Cadastrar uma opção confirmada não remove essa proteção. O mesmo se aplica às operações de outubro/novembro de 2026 cuja categoria não possa ser comprovada pelo snapshot da emissão.

### Instalação e validação

Migração aditiva: `20261010160000_reforma_fiscal_historico`, criando `ReformaFiscalRevisao` e `ReformaNfseVerificacao`. Não há backfill que presuma escolhas das empresas. Antes de publicar a interface, aplicar a migração e gerar o cliente Prisma na API, conforme o processo existente de implantação. A falha de leitura não deve ser apresentada como carteira regular ou sem pendências.

Testes reproduzíveis:

```text
npm test -w @contabilidade/api -- --runInBand reformaCadastro verificarNfse reformaFiscal
npm test -w @contabilidade/web -- --runInBand src/features/reforma
npm run build -w @contabilidade/web
node scripts/run-reforma-postgres.mjs <diretório dos binários PostgreSQL Windows>
```

O runner PostgreSQL cria e encerra um cluster descartável, aplica o histórico de migrations e gera um cliente isolado. O teste cobre gravação concorrente, idempotência com JSONB, preservação de revisões, acesso à carteira, relatórios persistidos e detecção de alteração de notas. Não usa dados de clientes, chamadas fiscais, IA ou mensagens externas.

Prévia local: `apps/web/reforma-dev.html`, disponível somente no servidor de desenvolvimento com `VITE_API_MODE=mock`. A conferência visual automatizada está em `apps/web/scripts/verify-reforma-layout.mjs`; usa `PLAYWRIGHT_MODULE` quando o pacote está fora do repositório e `PLAYWRIGHT_CHANNEL` quando necessário. As capturas ficam em `test-evidence/reforma-layout`, fora do Git.

Validação em 10/10/2026: 69 testes de backend e regras fiscais, 287 testes de interface/regressão, schema Prisma válido, migrations e quatro cenários integrados em PostgreSQL descartável, build web e inspeção visual em 1440 e 390 px. O lint padrão do repositório falhou por incompatibilidade preexistente entre ESLint 8 e o import `eslint/config`; a análise estática isolada dos arquivos novos passou para identificadores indefinidos, código inalcançável e chaves duplicadas. Os avisos de tamanho de bundle/imports mistos do build permanecem.

## Ordem das próximas entregas

| Etapa | Escopo | Dependência | Critério de conclusão |
| --- | --- | --- | --- |
| 2. Regras e vigência nos fluxos fiscais | Resolver o enquadramento histórico na prévia, emissão e planejamento. Ampliar NFS-e para bases, valores e totalizadores; identificar tratamentos não suportados. | Leiautes oficiais aplicáveis, regras por operação e fixtures verificadas. | Competência antiga mantém sua regra; opção futura não muda nota presente; mesma operação tem resposta coerente na prévia, emissão e auditoria. |
| 3. Simulação do Simples e preços | Comparar IBS/CBS no DAS versus regime regular, clientes empresariais/consumidores, compras, créditos admitidos, margem, custo operacional e fluxo de caixa. | Etapa 2 e tabelas/partilhas oficiais por vigência. | Cenários salvam premissas e fontes; percentual hipotético aparece como hipótese; decisão não confirma opção fiscal. |
| 4. Créditos e conciliação CBS | Ligar documento a débito, crédito, pagamento e estorno; comparar base local com apuração assistida; explicar divergências. | Contrato/API oficial, autorização, ambiente e acesso testados para o contribuinte. | Crédito potencial fica separado do apropriável e apropriado; reprocessamento não duplica; divergência tem documento e motivo. |
| 5. IBS, recolhimentos e caixa | Integrar a apuração IBS e conciliar guias, recolhimento pelo adquirente e split payment conforme a disponibilidade operacional. | Interfaces e ambientes oficiais comprovados, mais etapa 4. | Separar cada tributo, competência, extinção e pagamento; evitar cobrar novamente valor já recolhido; conciliar com financeiro. |
| 6. NF-e e demais documentos da carteira | Estender captura/conferência a produtos, NCM, CST/classificação, destino, devolução e tratamentos diferenciados; CT-e e outros modelos conforme demanda. | Cadastro de produtos e notas técnicas específicas por modelo. | Mesma classificação versionada no cadastro, emissão e auditoria; regras de NFS-e não são aplicadas por analogia à NF-e. |
| 7. Obrigações e DeRE | Matriz de obrigatoriedade; preparação, validação, assinatura/transmissão, processamento, recibos, rejeições e correções. | Empresas efetivamente abrangidas, eventos aplicáveis e integração homologada. | Transmitido, em processamento, aceito e rejeitado são estados distintos; timeout não autoriza retransmissão cega; recibo e payload ficam preservados. |

A etapa 7 deve ser antecipada se a classificação da carteira identificar contribuinte obrigado à DeRE antes das demais entregas. NF-e também pode ser antecipada se o volume de comércio/indústria justificar. Essa decisão depende da composição real da carteira, não apenas do regime de IRPJ/CSLL.

## Tarefas transversais

1. **Catálogo de regras e fontes:** guardar versão, vigência, URL, data de obtenção e hash das tabelas. Uma atualização deve informar empresas/documentos afetados e permitir reconferência explícita.
2. **Agenda de preparação:** aproveitar o calendário existente para responsáveis, prazos, evidências e conclusão. Cadastrar a opção não deve criar uma rotina paga automática. Prazos excepcionais precisam de vigência e fonte própria.
3. **Fila de correções:** associar achado, documento, responsável e providência. Correção da origem requer nova verificação; encerramento humano de um aviso não altera o XML nem produz regularidade fiscal.
4. **Cobertura e escala:** processamento em segundo plano para lotes maiores, usando a Central de tarefas existente, filtros por estabelecimento/período, paginação no servidor e exportação do relatório.
5. **Comprovantes e histórico:** evoluir a referência textual para vínculo validado a Documentos; paginação do histórico completo; revisão de retenção de relatórios e trilha de acesso.
6. **Imposto Seletivo e regimes diferenciados:** habilitar tratamento conforme produtos/atividades presentes na carteira, com regras específicas comprovadas. Não aplicar uma alíquota geral a todas as operações.

## Fontes que orientam as próximas etapas

- [Receita Federal, opções do Simples para 2027](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/setembro/simples-nacional-2027-entenda-os-novos-prazos-e-faca-sua-escolha-com-consciencia-e-tranquilidade/): distingue ingresso no Simples da opção pelo regime regular de IBS/CBS. O prazo excepcional desta última, para janeiro a junho de 2027, é 30/10/2026. Os prazos de setembro registrados nos estudos internos anteriores precisam ser revistos antes de virar agenda operacional.
- [Orientações da Reforma Tributária do Consumo](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-da-reforma-tributaria): cronogramas e regras de documentos devem ser conferidos por espécie e operação.
- [APIs de apuração da CBS](https://docs.receitafederal.gov.br/apuracao-cbs/): contratos de consulta de débitos, créditos, pagamentos e recolhimentos; disponibilidade de documentação não comprova acesso operacional do app.
- [DeRE, documentação 1.3.0 publicada em 07/10/2026](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/outubro/receita-federal-publica-versao-1-3-0-da-documentacao-tecnica-da-dere/): escopo divulgado de serviços financeiros, planos de assistência à saúde e concursos de prognósticos. Não habilitar obrigação geral para toda empresa do Lucro Presumido.
- Artefatos já versionados em `docs/reforma-consumo` e `docs/leiaute-nfse/documentacao-tecnica/rtc-2026-10-05`, e limites operacionais de `docs/nfse-correcoes-prioritarias-2026-10-10.md`.
