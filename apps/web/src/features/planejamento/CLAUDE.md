# Planejamento — continuidade do cenário (08/09/2026)

Pesquisa de mercado — 15/09/2026: ver `docs/planejamento-analise-mercado-2026-09-15.md` na raiz. Comparação com páginas oficiais da Econet, IOB e Sittax. Backlog proposto, ainda não implementado: impedir recomendação definitiva com cobertura parcial; separar folha agregada de pró-labore por sócio; realizado versus plano com projeção mensal; receitas mistas; aprofundar Real e reforma. Não confundir série de início de atividade com projeção mensal completa nem diferença para a segunda opção com economia versus regime atual. O usuário solicitou pesquisa, não execução dessas mudanças.

Revisão — 15/09/2026: os cards expandem a composição por imposto com alíquota, base e valor anual (`memoriaPorTributo` dos motores). IRPJ/CSLL mostram alíquota sobre base presumida/lucro, separada do percentual sobre receita; Simples mostra repartição efetiva do DAS. CPP do Anexo IV e ISS fora do DAS entram no detalhamento e fecham o total. Receita anual, total anual e média mensal têm rótulos explícitos.

ISS não incide sobre receita exclusivamente de mercadorias nas categorias `comercio` e `combustiveis`, tanto no Presumido quanto no Real. O campo é preservado para voltar a serviços; ausência de ISS em serviços continua “não estimado”. ICMS/ST e demais exclusões permanecem indicados. Não ampliar esta regra a transporte ou receitas mistas sem dados suficientes. Fonte: LC 116, art. 1º, documentada em docs/fontes-fiscais.md.

Lente: reprodução dos 17,88% com receita anual R$ 1.017.686,09, folha R$ 36.000 e ISS 5%; o total R$ 181.954,09 inclui adicional de IRPJ e CPP. É carga total, não uma alíquota única. Relato livre de R$ 6 mil/ano não foi reproduzido: R$ 1,2 milhão com padrões produz Simples R$ 156.360 e Presumido R$ 210.360 (folha ausente). Não forçar fórmulas para reproduzir um relato sem premissas. Ver docs/fiscal-incidente-e-perfil-2026-09-15.md na raiz.

## Revisão fiscal — 14/09/2026

Premissas usam rótulos acima dos campos; origem detalhada, confiança e exceções do CNAE ficam em “Origem dos dados e premissas”. Na grade aparece apenas “CNAE sugerido”. Descrições acessíveis continuam ligadas aos campos e erros de entrada continuam visíveis.

Por pedido explícito do usuário, ISS começa em 5% quando não há alíquota cadastrada. Valor cadastrado e cenário salvo têm precedência; apagar o campo mantém ausência, sem inventar zero. É premissa de simulação, não alteração na apuração ou alíquota geral de município.

Anexo é sempre editável para comparar cenários. Em atividade de Fator R, “Automático pelo Fator R” mantém a regra; escolher anexo explicitamente ativa `anexoManual` e passa `sujeitoAoFatorR: false` apenas às entradas daquela simulação. A característica da empresa no formulário permanece intacta. `formularioCenario.anexoManual` deve ser salvo/restaurado com ISS e demais premissas. Teste `guardarSimulacao.ligacao` cobre default 5, escolha IV, ISS 4 e reabertura sem gravação de cadastro.

Complemento: a abertura na empresa recupera o cenário salvo mais recente após o prefill. Não sobrescrever edições iniciadas durante a busca, nem aplicar resposta de outra empresa. O histórico só expande ao clicar Abrir cenário. Salvar cenário continua sendo explícito; não anunciar salvamento automático de campos. IBS/CBS mostra explicações dos modelos e diferencia imposto próprio de crédito transferido. Comunicado RFB atualizado em 02/09/2026 confirma o procedimento para 2027 e cancelamento até 30/11/2026; substitui a antiga ausência de prova da regulamentação. Consulta documentada em docs/fontes-fiscais.md.

Premissas ficam antes da comparação. Dentro da empresa, o conteúdo usa a moldura do pai; modo livre mantém sua própria largura. Editar cenário não altera cadastro fiscal.

Salvar cenário e Guardar em Documentos reutilizam `salvarSimulacaoPlanejamento`. O JSON de entradas contém `formularioCenario`, com textos dos campos, confirmações, meses, série mensal e cenário IBS/CBS. Não remover esse bloco: entradas numéricas do motor não preservam todas as escolhas de edição. Abrir cenário usa `listarSimulacoesPlanejamento`, sempre por empresa; cenários legados restauram as premissas disponíveis e avisam o que precisa ser reconferido. A comparação reaberta usa as tabelas atuais; o snapshot/PDF original não é sobrescrito. Procedências salvas são preservadas enquanto o cenário reaberto não é alterado.

Ao trocar empresa, limpar lista/estado salvo; descartar respostas de listagem antigas. Salvar cenário não gera PDF. A geração de PDF pode falhar depois de gravar o cenário e deve dizer exatamente isso.

Regressões: `pages/__tests__/guardarSimulacao.ligacao.test.jsx`, `hierarquiaEAcessibilidade.test.jsx` e testes existentes de troca de empresa, moeda e prefill.

Etapa 2: atalhos Premissas → Comparação → Detalhes movem foco/rolagem sem criar entrada no histórico. Respeitam altura dos cabeçalhos fixos. Grades permitem encolher, tabelas rolam localmente; no celular o cabeçalho da empresa não fica sobre o formulário. Ajuda de origem é legível e bloqueios permanecem visíveis. Falha de transporte do PDF após salvar informa sucesso parcial; resposta do PDF de empresa anterior não aparece na empresa atual.
