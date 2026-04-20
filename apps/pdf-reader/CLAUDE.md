# CLAUDE.md — PDF Reader / Parser (apps/pdf-reader)

Serviço Python 3.12 + FastAPI para parsing de guias PDF.

## Propósito

Recebe arquivos PDF de guias fiscais (DARF, GPS, FGTS, ISS, etc.), extrai os dados estruturados e retorna JSON para a API principal.

## Estrutura

```
app/
  main.py            - Entry point FastAPI, registra routers
  config.py          - Configurações (env vars, settings)
  routers/           - Endpoints HTTP
  services/          - Lógica de parsing e orquestração
  extractors/        - Extratores específicos por tipo de guia
  __init__.py
Dockerfile
requirements.txt
```

## Padrões

### Endpoints

- Todos os endpoints em `app/routers/`
- Retornar sempre JSON estruturado com campos consistentes
- Em caso de erro de parsing, retornar erro com mensagem clara (não 500 genérico)

```python
# Padrão de resposta de sucesso
{
  "tipo": "DARF",
  "vencimento": "2026-04-30",
  "valor": 1234.56,
  "cnpj": "00.000.000/0001-00",
  "competencia": "03/2026",
  ...
}

# Padrão de resposta de erro
{
  "erro": "Tipo de guia não reconhecido",
  "detalhe": "..."
}
```

### Extractors

- Cada tipo de guia tem seu próprio extrator em `app/extractors/`
- Extratores recebem texto extraído pelo pdfplumber e retornam dict
- Não misturar lógica de extração de diferentes tipos no mesmo arquivo
- Usar regex com nomes de grupo para clareza: `(?P<valor>\d+,\d+)`

### Services

- `app/services/` orquestra: recebe o PDF, chama pdfplumber, identifica tipo, delega ao extrator correto
- Um service central de roteamento (`parser_service.py` ou similar) decide qual extrator usar

## Integração com a API

- A API Node.js chama este serviço via HTTP (URL configurada em `PDF_READER_URL`)
- Autenticação entre serviços: verificar se há token interno configurado
- O serviço deve estar rodando na porta **8000** por padrão

## Variáveis de Ambiente

```
PORT      (default 8000)
```

## Regras

- Não usar OCR — depender apenas do pdfplumber (texto nativo do PDF)
- Adicionar novo tipo de guia = novo arquivo em `extractors/` + registro no service
- Manter `requirements.txt` atualizado após instalar dependências
- Não subir arquivos PDF de teste com dados reais de clientes no repositório
- Logs de erro devem incluir o nome do arquivo e tipo de guia tentado
