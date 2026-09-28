# DANFSe — apresentação

## Modelo solicitado em 28/09/2026

O usuário forneceu um DANFSe como referência visual. O arquivo e seus dados reais
não devem ser versionados. As amostras e os testes usam apenas o XML sintético
de `docs/leiaute-nfse/nfse-nacional-substituicao.xml`.

- Campos sem grade: moldura externa A4 e linhas horizontais entre seções.
- Cabeçalho cinza, logo oficial ampliada, QR de 1,52 cm preservado.
- Títulos em 7 pt; rótulos em 6 pt; conteúdo em 7 pt; identificação em 7 pt.
- Título do ISSQN na primeira coluna; tipo na segunda; incidência nas duas últimas.
- Moeda/percentual e telefone formatados apenas na apresentação. Traços continuam
  sendo ausência; não inferir impostos nem preencher campos com zero.
- `danfseLeiaute.js` preserva as coordenadas transcritas da NT. Ajustes visuais
  ficam em `danfseApresentacao.js` e no gerador. Não remover o título ISSQN com
  base na antiga sobreposição: sua coluna agora está reservada.
- Sem atribuição ao fornecedor do PDF de referência. Continuam as marcas de
  homologação, cancelamento e substituição, descrição elástica e canhoto opcional.
- Todos os fluxos que usam `gerarDanfse` recebem a mesma apresentação (contador,
  cliente e lote). Não há chamada a provedor nem alteração da emissão nesta mudança.

Validar com as suítes `danfse` e renderizar amostras curta, longa e cancelada com
canhoto. Conferir página única, títulos sem sobreposição e QR decodificável.
As fontes proprietárias continuam opcionais; Helvetica é o fallback já existente,
com o aviso correspondente no relatório de conformidade.
