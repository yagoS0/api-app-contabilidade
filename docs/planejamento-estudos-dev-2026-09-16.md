# Estudos adicionais do planejamento — desenvolvimento

Autorização: adicionar as pendências no mock/dev para revisão do usuário; produção somente após aprovação posterior. A interface nova usa `api.mode === "mock"`; não habilitar em API real ou fallback.

## Plano de implementação

1. Acrescentar memória parametrizada de ICMS, ST, DIFAL, IPI e benefícios por operação, com base final conferida, origem e tributo separados.
2. Projetar tributos mês a mês reutilizando o acompanhamento, incluindo receitas mistas, CPP do Anexo IV, monofásicos de revenda e início de atividade. Separar apropriação trimestral de IRPJ/CSLL de vencimentos; não distribuir automaticamente crédito fiscal entre tributos.
3. Simular IBS/CBS por operação e créditos identificados por fornecedor, com conferência explícita e sem inferir direito a crédito de uma despesa.
4. Exportar comparação de snapshots em documento conjunto, com premissas, cobertura e resultados imutáveis.
5. Conferir cálculos por casos independentes, integração, persistência, navegador, documento renderizado e build. Atualizar este registro ao concluir.

Os estudos detalhados têm resultados próprios: não substituir automaticamente os cards anuais de distribuição uniforme. Bases/alíquotas por NCM/UF e tratamentos especiais são parâmetros conferidos pelo contador; não prometer enquadramento automático nacional nem apuração oficial. Ausência não equivale a zero.

## Fontes consultadas em 16/09/2026

- [RFB — Anexo IV e atividades concomitantes](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/cobrancas-e-intimacoes/contribuicao-previdenciaria-anexo-iv-do-simples-nacional).
- [Manual do PGDAS-D](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf): início de atividade, Fator R e segregação.
- [RFB — benefícios fiscais, perguntas e respostas v3](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/beneficios-fiscais/perguntas-e-respostas-reducao-dos-incentivos-e-beneficios-tributarios-v3-final.pdf): limite trimestral e repartição por atividade da majoração no Presumido.
- [LC 87/1996](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp87.htm): bases da ST e disciplina de créditos; parâmetros estaduais não são presumidos.
- [LC 214/2025 consolidada](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm): regimes e créditos de IBS/CBS. Taxas futuras efetivas e reduções permanecem premissas identificadas.

Não houve publicação ou alteração de empresa real.

## Entregue no mock

- Seção **Estudos adicionais**, com três blocos recolhidos: operações/benefícios, tributos mensais/atividades mistas/início, reforma por operação/créditos por fornecedor. Visível apenas em `api.mode === "mock"`, também no modo livre com receita. API real e fallback não exibem nem calculam os estudos.
- `operacoesPlanejamento`: memória de ICMS, ICMS-ST, DIFAL de base única, IPI, PIS e Cofins. Base final, percentual, redução com fundamento, crédito e FCP separados. ST deduz ICMS próprio; DIFAL usa diferença entre percentuais informados. Crédito excedente não torna imposto negativo nem reduz FCP. Totais separados por regime, sem somar alternativas de regime.
- `tributosMensais`: aproveita o acompanhamento e permite edição por mês. Segregação inicial segue proporções das receitas anuais; campo mensal apagado permanece ausente. Edição da receita/folha modifica janelas subsequentes; não modifica o próprio Fator R. Receita da janela é compartilhada entre todas as atividades.
- Simples misto com Anexo IV: CPP de 20% sobre remuneração exclusiva mais compartilhada proporcional à receita IV do mês. Folha exclusiva continua devida mesmo sem receita IV. RAT/FAP devido é campo separado; terceiros não são presumidos. Início em 2026 usa receita do primeiro mês vezes 12 e depois média dos meses anteriores; Fator R usa as bases da janela própria. Sublimite e limite proporcional produzem revisão explícita.
- Revenda no Anexo I: monofásico retira parcelas de PIS/Cofins e ST retida retira ICMS do DAS; outros tributos ficam preservados. Indústria, combustíveis e transporte não recebem esse tratamento automaticamente. Nos regimes regulares, mercadorias exigem base de PIS/Cofins já segregada e líquida das exclusões legais, não simplesmente receita bruta.
- Presumido: PIS, Cofins, ISS, CPP e encargos mensais; IRPJ/adicional/CSLL no fechamento do trimestre. Majoração proporcional por atividade e noventena de CSLL em 2026; trimestre majorado exige revisão do ajuste anual. Presunção de serviços a 16% continua dependendo de confirmação e limite anual.
- Real trimestral: bases ajustadas independentes de IRPJ/CSLL, prejuízos trimestrais/saldos iniciais separados e compensação limitada a 30%. PIS/Cofins com créditos/saldos separados; lacuna impede inventar o saldo seguinte. Bases pela margem são projeção explícita; detalhe anual de custos não é dividido silenciosamente nos meses.
- Reforma: operações com base final, taxas efetivas do ano e redução fundamentada; crédito por fornecedor/documento, conferência e bloqueio de duplicata. Excedentes de IBS/CBS separados. Trocar ano revoga conferências. ICMS/ISS seguem redução do cronograma; não inventa taxa futura de CBS nem taxa geral de IBS a partir de 2029.
- Parâmetros em `ajustes.estudos` e resultado em `resultado.estudosAvancados`; salvar/reabrir preserva as edições. PDF próprio dos estudos e PDF conjunto de duas ou três fotos selecionadas. Exportação lê snapshots sem recálculo, inclui origens disponíveis, bases, taxas, cobertura, conclusão e revisão. `pdfkit` já instalado é carregado sob demanda, sem chamada fiscal nem nova dependência.

## Conferência

- 482 testes de planejamento web aprovados (33 suítes), sendo 27 novos. Cobrem isolamento mock/real/fallback, salvar e reabrir, exportar fotos selecionadas, ausência/zero, créditos separados, redução, ST/DIFAL/FCP, sazonalidade, CPP IV exclusiva/compartilhada, início de atividade, Fator R, monofásicos, prejuízo e limites.
- Build Vite aprovado; parser JSX/no-undef sem erros. Avisos de tamanho de bundle persistem; a biblioteca do PDF tem chunk próprio e não carrega até exportar.
- Navegador mock: receita já preenchida, edição de operação, DIFAL 60 + FCP 20 = 80, consumo 2029 com CBS 900 + IBS 200 + legado 450 = 1.550; conferência do layout e download real do PDF. Dados fictícios de QA não foram salvos como cenário da empresa.
- PDF conjunto fictício gerado pelo mesmo renderer, dez páginas A4 renderizadas e inspecionadas. Corrigidos rótulo de CPP (anual não presume fora do DAS), ausência de base e agrupamento de linhas mensais nas páginas.

## Limites da prévia e publicação

Os estudos não tornam os cards anuais um motor por operação. Permanecem explícitos: ajuste anual da majoração, efeitos de exclusão/sublimite, aberturas anteriores a 2026 pelo histórico, regras estaduais de base dupla/MVA/gross-up, importação e regimes especiais, retenções e obrigações oficiais. Benefícios e créditos exigem enquadramento confirmado. Valores por operação não são preenchidos pela simples existência de uma nota ou despesa.

Os novos PDFs são downloads locais do mock; integração dos estudos ao gerador de Documentos do servidor e endpoint agregado de carteira permanecem para a etapa de integração, após revisão. Não existe migração, nova rota, transmissão fiscal, deploy ou push neste lote. A autorização atual é somente desenvolvimento; para produção, obter a aprovação do usuário e preparar a integração real.
