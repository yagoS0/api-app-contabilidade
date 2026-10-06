# Pesquisa e contratos da NFS-e Nacional — 05/10/2026

Os arquivos do manifesto `fontes.json` foram consultados nas fontes oficiais e possuem SHA-256. O snapshot da SVRS foi salvo como HTML UTF-8 compactado; o gerador extrai somente o JSON da tabela, sem executar scripts remotos.

## Evidência e decisão

| Tema | Evidência oficial | Decisão no projeto |
|---|---|---|
| Integração | Usuário confirmou NFS-e Nacional em toda a carteira | Um contrato nacional; sem adaptadores por prefeitura |
| Anexo VIII | Portal RTC informa caráter inicial/orientativo e ausência de regras de negócio baseadas nele | Sugestão de preenchimento; não bloquear pela ausência de correlação |
| Indicador da operação | Anexo C v1.01 publicado na documentação de produção | Conferir os 26 códigos, preservando zeros iniciais |
| CST/cClassTrib | Tabela SVRS publicada para documentos fiscais eletrônicos | Validar existência, relação explícita, indNfse e vigência; não inferir benefício |
| CNPJ alfanumérico | Comunicado de julho aponta homologação em 27/07 e produção em 10/08; XSD de 27/07 contém CNPJ alfanumérico | Próxima prioridade; o emissor ainda tem normalizadores numéricos a substituir em todo o percurso |
| NT 009 v1.01 | Portal lista publicação em 01/10; documento remete implantação a cronograma específico | Não trocar posições XML somente porque a NT foi publicada |
| NT 010 | Portal atualizado em 02/10: NFS-e Via e manifestação do adquirente | Fora do emissor de serviços comum desta entrega; reavaliar se o escopo incluir esses documentos/eventos |
| Regime e obrigações | Uso do emissor nacional não define o regime tributário | Não atribuir a toda a carteira a mesma data, alíquota ou benefício |

O ZIP ainda ligado à página de documentação de produção foi conferido e não continha o novo padrão alfanumérico. O comunicado de implantação aponta o pacote de julho na página de produção restrita. Por isso o pacote foi registrado por nome, URL e hash; o número `versao="1.01"` sozinho não identifica o conteúdo do esquema.

## Matriz de implementação

| Campo/grupo | Origem | Contrato/condição | Validação e situação |
|---|---|---|---|
| cIndOp | Perfil fiscal confirmado pelo contador | DPS 1.01, bloco IBS/CBS informado | Anexo C; implementado no perfil e pré-voo |
| CST/cClassTrib | Perfil fiscal | DPS 1.01, bloco informado | Domínio SVRS, relação explícita, indNfse e datas publicadas; implementado |
| cNBS | Perfil fiscal | Obrigatório com IBS/CBS, E0322 | Validação terminal existente preservada |
| CNPJ / ID da DPS | Empresa, tomador, destinatário e certificado | Pacote XSD 27/07/2026 | Implementado no percurso de NFS-e e validado localmente; homologação externa pendente |
| finNFSe / indDest / dest | Operação | NT 009 reposiciona em infDPS | Pendente de adaptador e confirmação de implantação; não mover no contrato atual |
| CST / cClassTrib / gIBSCBS | Perfil e operação | NT 009 altera hierarquia e condicionalidade | Pendente de adaptador e testes do novo esquema |
| gIBSCBSAjuste / vAjusteBC | Operação de ajuste | NT 009, conforme finalidade e regras específicas | Pendente de persistência, tela e testes; não confundir com cancelamento |
| regApIBSCBSSN / cAtvSN / gTribSN | Regime por competência e atividade | NT 009, conforme enquadramento | Pendente; não deduzir apenas de CNAE |
| gPgtoVinc | Pagamentos vinculados | NT 009, conforme operação | Pendente de conciliação e validação; não equivale ao split payment completo |
| verCalcIBSCBS e totais | XML autorizado | Retorno do contrato efetivo | Versão disponível nos metadados do DANFSe; conciliação/exportação dos novos fluxos ainda pendentes |

## Reprodução das tabelas

Na raiz do repositório, após `npm ci`:

```text
node apps/api/scripts/gerar-tabelas-rtc.mjs
```

O gerador verifica o hash de cada entrada usada e falha se o formato, as chaves ou relações estiverem inconsistentes. Não consulta a internet durante a emissão. Para atualizar fontes, baixar uma nova versão, registrar procedência, revisar diferenças e executar os testes antes de ativar. O Anexo VII da NT 009 foi preservado para comparação futura; não substitui automaticamente o Anexo C do contrato atual.

## Referências

- [Portal RTC e orientação sobre Anexo VIII](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc).
- [Comunicado de implantação de julho e agosto](https://www.gov.br/nfse/pt-br/noticias/plataforma-nfs-e-disponibiliza-novas-evolucoes-em-producao-restrita-e-divulga-cronograma-de-implantacao).
- [Tabela CST e classificação da SVRS](https://dfe-portal.svrs.rs.gov.br/DFE/TabelaClassificacaoTributaria).
- Links diretos dos demais documentos no manifesto.
