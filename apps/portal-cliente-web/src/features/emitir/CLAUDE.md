# Emissor do cliente — regressões a preservar

## Resultado de emissão e E0014 — 13/10/2026, PR #163

Usar `ConsultaResultadoNfse` de `@contabilidade/shared/nfse-conciliacao` no desfecho bloqueado com tentativa persistida. A API `conciliarNfse` consulta exclusivamente essa tentativa na empresa autorizada. Não invocar emissão, gerar novo payload ou alterar numeração no handler de consulta.

`MESMA` apresenta a nota autorizada recuperada, distinguindo recuperação de nova emissão. `OUTRA`, `INCONCLUSIVA` e falha técnica não liberam reenvio por conta própria. A recuperação automática de E0014 ocorre no backend sob as regras de `apps/api/src/application/nfse/CLAUDE.md`; não duplicar essa decisão no navegador. Manter bloqueio de submit duplo e descarte de respostas após troca de empresa/tentativa ou desmontagem.

CEP e endereço mantêm as regras já existentes: preservar zeros iniciais e edições manuais, descartar respostas antigas, limpar campos postais da consulta anterior ao trocar o CEP e não inventar número/complemento. Endereço nacional exige município, CEP, logradouro, número e bairro, ou bloco vazio. As regras de reaproveitamento do modelo continuam em `lib/CLAUDE.md`; número do imóvel nunca vem do número da nota.

Testes de referência em `__tests__/duplicidadeDps.test.jsx`, `__tests__/consultaResultadoNfse.test.jsx` e `__tests__/consultaCepNaTela.ligacao.test.jsx`. Cobrir duplo clique, troca de contexto, recuperação, outra operação, incerteza e erro sem reenvio. Ao mudar esse fluxo, executar a regressão de emissão do cliente e verificar o consumidor do contador. Preservar bloqueio de 2027; testes não emitem, cancelam ou transmitem documentos reais.
