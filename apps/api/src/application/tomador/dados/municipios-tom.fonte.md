# Relação oficial TOM / IBGE

Fonte: [Receita Federal — Tabela de municípios](https://www.gov.br/receitafederal/dados/municipios.csv/view).
Download: https://www.gov.br/receitafederal/dados/municipios.csv/@@download/file

Publicação atualizada em 08/03/2023; snapshot obtido em 13/10/2026.
SHA-256 do CSV original: `60da8e582c1021c4be21cc9b45c4bf791f98f75a40df242b4b2ff4a4121da89b`.
Codificação Latin-1; separador ponto e vírgula; cinco colunas: TOM, IBGE, nome TOM, nome IBGE e UF.

Execute `node scripts/gerar-municipios-tom.mjs` na raiz para reproduzir o módulo de dados.
São 5.569 relações completas. As linhas EXTERIOR (TOM 9707, IBGE 0) e CORONEL SAPUCAIA (TOM 9997, sem nome IBGE no arquivo) são excluídas deliberadamente.
O gerador valida formato, unicidade e hash antes de escrever. A aplicação não baixa tabelas durante consultas.

Esta publicação não comprova cobertura de alterações municipais posteriores a 2023. Cada conversão exige código TOM conhecido, nome e UF compatíveis com a relação oficial e confirmação na lista IBGE carregada pelo serviço. Municípios novos, renomeados ou divergentes permanecem parciais, para conferência manual. Não há busca aproximada nem inferência de código pelo nome. Atualizações exigem revisão da fonte, do hash e dos testes.
