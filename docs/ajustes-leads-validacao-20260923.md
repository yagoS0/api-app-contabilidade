# Correção e validação dos percursos comerciais

O atendimento deve distinguir dúvida de decisão, preservar o histórico e cumprir a política comercial privada. O pedido de 23/09 autoriza corrigir as falhas da simulação e repetir os percursos de abertura, transferência e empresa parada. Documentos, catálogo, contratos reais e evidências identificáveis ficam fora do repositório público.

## Plano e critérios de conclusão

1. **Conversa:** perguntas, hipóteses, negações e pausas não escolhem modalidade nem encerramento e não viram atividade. Respostas de processo esclarecem a primeira dúvida; casos fiscais seguem ao contador. Texto livre e botões válidos continuam funcionando, sem IA.
2. **Preços:** cálculo, aprovação e aceite respeitam o mínimo do perfil e do serviço. Regularização não contorna seu piso por outro campo. Congelar a política na proposta; preservar contratos e propostas aceitas. Rascunhos antigos sem garantias precisam de revisão explícita.
3. **Roteiro:** dados e conferências ficam visíveis com realizado, não aplicável ou pendente e suas evidências. A indisponibilidade externa não impede um escopo limitado fundamentado. Devolutiva separa o que está correto, os pontos de atenção e as ações. Regularização anterior à mensalidade tem decisão registrada.
4. **Contratos:** modalidade, origem e identificação PF/PJ determinam compatibilidade. Formulário completa dados institucionais e do interessado, conserva preço e condições aceitos e não duplica regularização nos totais. Modelos e documentos privados são preparados para revisão, sem remover a guarda de aprovação.
5. **Experiência:** indicar precisamente se falta modelo aprovado, modelo compatível ou dados do contratante. A geração contratual não deve ser confundida com aceite, assinatura, pagamento ou execução externa.
6. **Validação:** repetir as falhas originais e frases próximas, testar retomadas/cliente conhecido, matriz comercial, APIs/DOM, PostgreSQL isolado e interface no navegador. Os três percursos percorrem diagnóstico, proposta, contrato, evidências de assinatura/pagamento e conclusão aplicável com dados fictícios.

## Distribuição

- Agente de diálogo: interpretador, coleta, perguntas e testes de conversa.
- Agente de preços: catálogo, guardas da proposta, formulário de valores e testes.
- Agente de jornada: roteiro compartilhado, diagnóstico, painel e testes.
- Agente principal: contratos/modelos privados, integração, revisão independente, contexto e validação final.

Sem tokens Anthropic, mensagens reais, consultas pagas, assinatura ou cobrança externa. Testar um contrato com aprovação fictícia local não autoriza aprovar a minuta real. Comparar explicitamente os recursos usados no teste com os disponíveis em produção.

## Referências de estrutura contratual

O contrato deve refletir os termos da proposta aceita e as particularidades do serviço. A formalização escrita após aceite é descrita nas orientações do [CRCSP](https://www.crcsp.org.br/portal/fiscalizacao/contrate.htm) e do [CRCMG](https://crcmg.org.br/fiscalizacao/contrato-de-prestacao-de-servicos-contabeis). A minuta privada mantém a identificação de revisão e requer a aprovação normal do escritório; não há aprovação jurídica automática.

## Implementação e reteste

- Diálogo: dúvidas/negações/pausas preservam campos; explicações antes da coleta e encaminhamento; baixa coerente na coleta e no orçamento manual.
- Política comercial: pisos, adicionais, regularização e objetivo congelados; validação de rascunho/aprovação/link/PDF/aceite; aceitas preservadas.
- Diagnóstico: três blocos, roteiro e evidências, limitação explícita sem consulta; perfil da mesma ficha e rascunho preservado na revisão.
- Contrato: formulário e biblioteca com compatibilidade de modalidade, origem e PF/PJ; endereço pessoal próprio; valores aceitos e total sem duplicação.

Reteste local final: 620 testes API, 232 de interface, 30 verificações de conversa em PostgreSQL, 41 comerciais, 11 de abertura até a ficha, sete do caminho manual e seis jornadas com cópias dos documentos privados. A matriz privada passou em 360 combinações e 1.091 verificações. Banco, armazenamento e PDFs locais reais; transporte, órgãos externos, assinatura e pagamento simulados. Zero Anthropic/rede externa nos cenários. Build web aprovado. A navegação manual no ambiente demonstrativo confirmou preenchimento, preservação do texto ao corrigir perfil, avanço e apresentação por outro meio; também identificou e corrigiu a falta de versão em fichas antigas do mock.

A revisão independente identificou a possibilidade de mensalidade em baixa manual e a perda de rascunho ao invalidar diagnóstico; ambas foram corrigidas e cobertas. O PostgreSQL detectou duplicação de diagnóstico por ordem de chaves JSONB, corrigida por comparação canônica sem relaxar a prova de concorrência.

Recursos reais: dados institucionais do cartão CNPJ/CRC, catálogo com apresentação ampliada e quatro modelos preparados permanecem privados. Aprovação de cópia sintética de contrato é restrita ao teste; as minutas reais precisam da revisão normal antes de uso. A minuta de abertura com mensalidade prevê formalização PJ após o registro, que permanece uma providência contratual humana. Não confundir conversão técnica da ficha com cumprimento desse ato.
