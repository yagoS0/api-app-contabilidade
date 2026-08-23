# -*- coding: utf-8 -*-
"""
A PORTA da leitura POSICIONAL do relatório SITFIS.

⚠ Este router NÃO substitui `/extract`. Ele existe porque o SITFIS não é uma GUIA: não tem valor,
vencimento nem código de receita únicos — é um relatório de várias TABELAS, e o que a API precisa
de volta são as tabelas, não os campos de um documento de arrecadação. Por isso a resposta traz
`relatorio` em vez de `fields`, e por isso ele mora num caminho próprio.

⚠ A validação do corpo é a MESMA do `/extract` (`decode_base64_pdf`): base64 válido, tamanho
máximo e magic `%PDF`. Duas validações diferentes para o mesmo insumo divergiriam com o tempo.

⚠ O QUE ESTE ENDPOINT NÃO FAZ: não chama o SERPRO, não grava nada, não decide nada de produto.
Ele lê os bytes que a API mandou e devolve o que a geometria do PDF diz. Bloco que não fecha nas
provas do extrator volta com `colunas: []`, `registros: []`, as linhas cruas em `naoInterpretado`
e o motivo em `aviso` — ausência declarada, nunca tabela torta.

Ver `apps/pdf-reader/CLAUDE.md`, seção "SITFIS — leitura POSICIONAL", para a medição que sustenta
o desenho (24 relatórios reais, 31 tabelas idênticas ao parser de texto, 0 com coluna trocada).
"""

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.extractors.sitfis_posicional import extrair_sitfis_posicional
from app.services.extraction_service import decode_base64_pdf

router = APIRouter(tags=["sitfis"])


class SitfisBody(BaseModel):
    content_base64: str = Field(..., min_length=1)
    filename: str | None = None


def _error_body(code: str, message: str) -> dict[str, Any]:
    return {
        "success": False,
        "relatorio": None,
        "warnings": [],
        "errors": [{"code": code, "message": message}],
    }


@router.post("/sitfis/posicional")
def sitfis_posicional(body: SitfisBody):
    raw, err = decode_base64_pdf(body.content_base64)
    if err == "invalid_base64":
        return JSONResponse(
            status_code=400,
            content=_error_body("INVALID_BASE64", "content_base64 is not valid Base64"),
        )
    if err == "payload_too_large":
        return JSONResponse(
            status_code=413,
            content=_error_body("PAYLOAD_TOO_LARGE", "Decoded PDF exceeds MAX_UPLOAD_BYTES"),
        )
    if err == "invalid_pdf_magic":
        return JSONResponse(
            status_code=400,
            content=_error_body("INVALID_PDF", "Content is not a PDF (missing %PDF magic)"),
        )
    assert raw is not None

    try:
        relatorio = extrair_sitfis_posicional(raw)
    except Exception as exc:  # noqa: BLE001 — qualquer falha aqui é "não li", nunca "leia assim"
        # ⚠ 422, não 500: a API trata isto como "a leitura posicional não fechou" e CAI PARA O
        # PARSER DE TEXTO. Um 500 genérico faria a API tratar como serviço fora do ar — mesmo
        # efeito prático, mas a causa deixaria de ser nomeada no log do contador.
        return JSONResponse(
            status_code=422,
            content=_error_body("SITFIS_POSICIONAL_FAILED", str(exc) or "positional read failed"),
        )

    # ⚠ Relatório sem diagnóstico nenhum NÃO é sucesso: ou o PDF não é um SITFIS, ou os marcos dos
    # dois órgãos mudaram. Devolver `{diagnosticos: []}` com `success: true` faria a tela do
    # contador mostrar "nada consta" para uma empresa que pode dever — o erro caro.
    if not relatorio.get("diagnosticos"):
        return JSONResponse(
            status_code=422,
            content=_error_body(
                "SITFIS_NO_DIAGNOSTICO",
                "PDF has no SITFIS diagnostic section (RFB/PGFN markers not found)",
            ),
        )

    return {"success": True, "relatorio": relatorio, "warnings": [], "errors": []}
