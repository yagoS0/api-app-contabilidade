# Implementação em desenvolvimento — 16/10/2026

Registro histórico da primeira fatia. A entrega posterior de todas as áreas revisadas, resultados consolidados e limites vigentes estão em [ENTREGA_DEV.md](ENTREGA_DEV.md). A legenda auxiliar de Guias descrita abaixo foi removida por pedido posterior do usuário; não deve ser restaurada.

Base: origin/main local ef939e54. Branch: codex/revisao-carteira-operacoes-20261016.
Os quatro documentos enviados pelo usuário estão preservados na raiz: LEIA_ME_PRIMEIRO.md, PLANO_MESTRE_CODEX.md, DESIGN_SYSTEM.md e UX_RULES.md. AGENTS.md os inclui na direção obrigatória. O pedido explícito de executar em dev autoriza o trabalho incremental; não será repetido o gate genérico de aprovação de wireframe. Decisões fiscais pendentes não foram inferidas.

## Diagnóstico e divergências da primeira fatia

| Requisito | Comportamento encontrado | Causa | Proposta implementada em dev |
| --- | --- | --- | --- |
| Progresso documental | Presumido mostra quantidade de tags | GuiasResumidas usa tags.length | Resumo comum com disponível, faltante, enviada e falha |
| Unidade correta | Compliance contém nós por tributo, não expectativas de PDF | Consolidação não representada por identidade esperada | Unidade explícita: obrigações com guia; sem inventar denominador por PDF |
| Separar falta de guia e envio | Central reúne missing e gerada em pendencias | Agrupamento local | Filas faltantes/envios/revisões com o mesmo conjunto do cartão |
| Detalhe contextual | Cartão abre modal de lista e depois detalhe | Estado selection controla ambos | Fila na página e modal somente do item/ação |
| Empresa zerada | Ordenação ignora guias pelo cadastro global | Guarda empresaSemObrigacoes | Não esconder falha/pendência real por cadastro zerada |
| INSS manual | Projeção complementar altera pendências | useManualInss | Reagrupar após incorporar controle mensal |
| Notas para revisão | Consulta todas as competências, sem unidade temporal no cartão | Contrato existente de alertas | Explicitar todas as competências; não inventar dados de notas processadas |

## Arquitetura e compatibilidade

API da carteira → guideCompliance → getComplianceTags → resumirGuias / projetarOperacoesEmpresas → tabela e filas.
Projeção INSS manual continua complementar, com suas permissões e estado de leitura.
Apuração e contabilidade continuam em fluxoDaEmpresa. Nenhum cálculo fiscal, schema, migration, envio ou serviço externo foi alterado.
As expectativas continuam sendo as do backend existente. A matriz fiscal e a contagem por PDF consolidado permanecem limitações explícitas.

## Wireframe da fatia

Empresas: identificação | status | apuração | cobertura disponível/esperada + envio | contabilidade | situação fiscal | acesso.
Cobertura expande no próprio contexto e preserva os chips e ações existentes.
Operações: competência → indicadores com unidade → fila selecionada → automações → acompanhamento/calendário.
Detalhe de item conserva empresa, período, evidência, confirmação e links.

## Validação

Testes de projeção, ligação da UI, INSS manual e regressão de operações executados em 26 suítes. Build Vite concluído. A configuração atual de lint não executa: importa eslint/config, indisponível no ESLint 8 instalado no workspace web; isso não foi apresentado como aprovação de lint.

O roteiro apps/web/scripts/verify-revisao-produto.mjs gerou 22 capturas em 1440 e 390 pixels, além de quatro capturas da base para comparação. Verificou ausência de erro de JavaScript e de transbordamento horizontal da página, expansão da cobertura, fila e detalhe, estados vazio/erro/carregando, mudança de 3/4 para 4/4, atualização da fila e retentativa simulada. As capturas de layout normal, detalhe, fila, vazio e erro foram inspecionadas visualmente; a expansão foi ajustada para ocupar uma linha completa da tabela. Evidências locais: test-evidence/revisao-produto.

Prévia: http://127.0.0.1:5276/revisao-dev.html. Usa os componentes reais com fixtures, bloqueia execução fora de DEV/mock e não envia mensagens nem consulta sistemas fiscais. Persistência demonstrada é somente no navegador. Integração com banco e serviços reais ainda não foi validada nesta etapa.

## Limites de integração a resolver

- O INSS manual continua com projeção complementar na central; a carteira lê guideCompliance. A unificação completa depende de reconciliar essa projeção com o contrato de cobertura e testar as exceções mensais. Não considerar equivalência integral entre as duas fontes já homologada.
- O contrato atual pode considerar uma guia enviada quando um canal confirma sucesso. Não inferir falha ativa de outro canal a partir de um erro histórico; evolução por canal exige evidência temporal confiável.
- Alertas de notas cobrem todas as competências e a API limita os itens recentes. O modal explicita quando a lista é apenas um recorte do total.
- A cobertura expressa obrigações com guia, não quantidade física de PDFs. Consolidação continua pendente de decisão e contrato.

## Registro de impacto operacional

Mudança de apresentação e agrupamento sobre evidências existentes: disponibilidade, envio e revisão são exibidos separadamente. Cadastro de empresa zerada não oculta pendência documental conhecida. Nenhuma nova matriz tributária, dispensa automática, comprovação de pagamento, transmissão ou retificação automática foi aprovada. As decisões V01–V08 da fonte operacional permanecem com seu estado original.

## Escopo ainda não concluído

### Ajuste solicitado da coluna Guias — 16/10/2026

O usuário apontou que a apresentação não seguia o padrão do projeto. O resumo em texto solto foi substituído pelo padrão existente `carteira-tag`, com tipografia 500, borda e superfície neutras e seta de expansão. Contagens auxiliares mantêm peso 400; falha de envio possui texto e cor de erro. Rótulos longos ficam completos no nome acessível e no detalhe; a célula apresenta “A conferir” ou “Não exigível”. Alvos de 32px no desktop e 44px no celular, com foco visível e expansão por teclado.

Impacto: somente apresentação, conforme R22; preservados R02, R09 e R10–R12. Não altera exigibilidade, contadores, persistência, consultas, envios ou pagamento, nem aprova V01–V08. Referência operacional desta árvore e documento central comparados sem divergências. Capturas antes/depois em `test-evidence/guias-ajuste-design`; roteiro de navegador executado com 22 capturas, sem erro JS/overflow e com interações simuladas preservadas.

Esta fatia não implementa matriz tributária nova, revisão completa das demais abas, notas processadas sem fonte confiável, política de cobrança, vínculo de PDFs consolidados ou migração de pagamentos legados. Não marca o plano mestre inteiro como concluído.

### Estados visuais do detalhe de guias — 16/10/2026

Novo pedido do usuário: indicar os estados imediatamente pelas cores do projeto também na expansão. Documento e envio usam `carteira-tag` com texto e símbolo: disponível/enviada em verde, falta/revisão/pendência em âmbar, falha/conflito em vermelho e ausência de comunicação em neutro. O resumo fechado também distingue falha, revisão e disponibilidade. Verde documental não implica envio ou pagamento; falha de envio mantém documento disponível. Controles individuais usam a variante compacta existente, preservando canais, popover e ações. No celular, os rótulos Documento/Envio acompanham cada obrigação.

Impacto operacional: nenhum; apresentação conforme R22, preservando os eixos R01 e R10–R12, os contadores e as confirmações. Não altera regras ou decisões V01–V08. Revisão visual desktop/celular executada, com 22 capturas e roteiro de interação local sem erro JavaScript ou overflow. Evidências em `test-evidence/revisao-produto/empresas-detalhe-1440.png` e `empresas-detalhe-390.png`.
