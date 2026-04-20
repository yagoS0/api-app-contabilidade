#!/usr/bin/env python3
"""
Gera wireframes Pencil Project (.ep) para o módulo de Lançamentos Contábeis.
Saída: /home/yago/lancamentos.ep

Uso: python3 generate_wireframes.py
"""

import zipfile
import io
import uuid

OUTPUT = "/home/yago/lancamentos.ep"

# ────────────────────────────────────────────
# Cores
# ────────────────────────────────────────────
C = {
    "bg":          "#f8fafc",
    "white":       "#ffffff",
    "border":      "#e2e8f0",
    "border_soft": "#f1f5f9",
    "sidebar_bg":  "#1e293b",
    "sidebar_hd":  "#0f172a",
    "sidebar_act": "#334155",
    "text_dark":   "#0f172a",
    "text_main":   "#374151",
    "text_muted":  "#64748b",
    "text_faint":  "#94a3b8",
    "primary":     "#2563eb",
    "primary_lt":  "#eff6ff",
    "danger":      "#dc2626",
    "danger_lt":   "#fee2e2",
    "success":     "#047857",
    "success_lt":  "#ecfdf5",
    "warning":     "#92400e",
    "warning_lt":  "#fef3c7",
    "amber_lt":    "#fffbeb",
    "amber_bd":    "#fcd34d",
    "orange_lt":   "#fff7ed",
    "orange_bd":   "#fed7aa",
    "info_lt":     "#eff6ff",
    "info":        "#1d4ed8",
    "green_dk":    "#065f46",
}

# ────────────────────────────────────────────
# Utilidades SVG
# ────────────────────────────────────────────

def esc(s: str) -> str:
    return (str(s)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))


def g(*children, gid=None, transform=None):
    attrs = f' id="{gid}"' if gid else ""
    attrs += f' transform="{transform}"' if transform else ""
    inner = "\n".join(str(c) for c in children if c)
    return f"<g{attrs}>\n{inner}\n</g>"


def rect(x, y, w, h, fill=C["white"], stroke=C["border"], rx=0, sw=1, opacity=None):
    op = f' opacity="{opacity}"' if opacity is not None else ""
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}" rx="{rx}"{op}/>')


def txt(x, y, content, size=12, fill=C["text_main"], weight="normal", anchor="start",
        italic=False):
    style = f"font-style:italic;" if italic else ""
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" '
            f'font-weight="{weight}" font-family="Arial,sans-serif" '
            f'text-anchor="{anchor}" style="{style}">{esc(content)}</text>')


def ln(x1, y1, x2, y2, color=C["border"], w=1, dash=""):
    da = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{color}" stroke-width="{w}"{da}/>')


def pill(x, y, label, bg=C["border_soft"], fg=C["text_muted"], fs=10):
    w = max(len(label) * 6 + 16, 40)
    return g(
        rect(x, y, w, 20, fill=bg, stroke=bg, rx=10),
        txt(x + w // 2, y + 14, label, size=fs, fill=fg, anchor="middle"),
    )


def btn(x, y, w, h, label, primary=False, danger=False, sm=False):
    bg = C["primary"] if primary else (C["danger_lt"] if danger else C["white"])
    fg = C["white"] if primary else (C["danger"] if danger else C["text_main"])
    bd = C["primary"] if primary else (C["danger"] if danger else "#d1d5db")
    fs = 11 if sm else 13
    return g(
        rect(x, y, w, h, fill=bg, stroke=bd, rx=4),
        txt(x + w // 2, y + h // 2 + fs // 3, label, size=fs, fill=fg, anchor="middle"),
    )


def inp(x, y, w, h=32, placeholder="", value=""):
    label = value if value else placeholder
    fg = C["text_faint"] if not value else C["text_main"]
    return g(
        rect(x, y, w, h, fill=C["white"], stroke="#cbd5e1", rx=4),
        txt(x + 8, y + h // 2 + 4, label, size=12, fill=fg),
    )


def sel(x, y, w, h=32, label="Todos"):
    return g(
        rect(x, y, w, h, fill=C["white"], stroke="#cbd5e1", rx=4),
        txt(x + 8, y + h // 2 + 4, label, size=12, fill=C["text_main"]),
        txt(x + w - 14, y + h // 2 + 4, "▾", size=10, fill=C["text_faint"]),
    )


# ────────────────────────────────────────────
# Componentes reutilizáveis
# ────────────────────────────────────────────

def sidebar(active="lancamentos"):
    nav_items = [
        ("lancamentos", "Lançamentos"),
        ("empresas",    "Empresas"),
        ("guias",       "Guias"),
        ("config",      "Configurações"),
    ]
    parts = [
        rect(0, 0, 250, 900, fill=C["sidebar_bg"], stroke="none"),
        rect(0, 0, 250, 64, fill=C["sidebar_hd"], stroke="none"),
        txt(20, 42, "ContaFirm", size=16, fill=C["bg"], weight="bold"),
        # separador
        ln(0, 64, 250, 64, color="#1e293b"),
    ]
    for i, (key, label) in enumerate(nav_items):
        ny = 76 + i * 44
        is_active = key == active
        if is_active:
            parts.append(rect(0, ny, 250, 36, fill=C["sidebar_act"], stroke="none"))
            parts.append(rect(0, ny, 3, 36, fill=C["primary"], stroke="none"))
        parts.append(txt(24, ny + 23, label, size=13,
                          fill=C["bg"] if is_active else C["text_faint"]))
    return g(*parts)


def main_header(title, sx=250):
    return g(
        rect(sx, 0, 1366 - sx, 64, fill=C["white"], stroke=C["border"]),
        txt(sx + 24, 39, title, size=18, fill=C["text_dark"], weight="bold"),
    )


def toolbar_buttons(sx, y, buttons):
    parts = []
    x = sx + 24
    for label in buttons:
        w = len(label) * 7 + 22
        parts.append(btn(x, y, w, 30, label, sm=True))
        x += w + 8
    return g(*parts)


def filter_panel(sx, y):
    fw = 1366 - sx - 48
    fx = sx + 24
    return g(
        rect(fx, y, fw, 76, fill=C["border_soft"], stroke=C["border"], rx=6),
        # labels
        txt(fx + 16, y + 14, "Competência", size=10, fill=C["text_muted"]),
        txt(fx + 160, y + 14, "Tipo", size=10, fill=C["text_muted"]),
        txt(fx + 284, y + 14, "Status", size=10, fill=C["text_muted"]),
        txt(fx + 408, y + 14, "Origem", size=10, fill=C["text_muted"]),
        # inputs
        inp(fx + 16, y + 24, 130, value="2026-04"),
        sel(fx + 160, y + 24, 110),
        sel(fx + 284, y + 24, 110),
        sel(fx + 408, y + 24, 110),
        btn(fx + 530, y + 24, 68, 32, "Filtrar", primary=True, sm=True),
        # totais
        txt(fx + 620, y + 46, "Despesa: R$ 4.200,00", size=12, fill=C["danger"]),
        txt(fx + 790, y + 46, "Receita: R$ 12.500,00", size=12, fill=C["success"]),
    )


def quick_entry_form(sx, y):
    fx = sx + 24
    fw = 1366 - sx - 48
    return g(
        rect(fx, y, fw, 52, fill=C["amber_lt"], stroke=C["amber_bd"], rx=6),
        inp(fx + 16, y + 10, 46, value="15"),
        inp(fx + 70, y + 10, 270, placeholder="Histórico do lançamento..."),
        txt(fx + 352, y + 30, "D", size=12, fill=C["info"], weight="bold"),
        inp(fx + 364, y + 10, 68, placeholder="D"),
        txt(fx + 444, y + 30, "C", size=12, fill=C["green_dk"], weight="bold"),
        inp(fx + 456, y + 10, 68, placeholder="C"),
        txt(fx + 536, y + 30, "R$", size=12, fill=C["text_muted"]),
        inp(fx + 556, y + 10, 100, placeholder="0,00"),
        btn(fx + 665, y + 10, 80, 32, "+ Salvar", primary=True, sm=True),
        txt(fx + 756, y + 30, "+ linhas", size=12, fill=C["primary"]),
    )


def entries_table(sx, y, rows):
    fx = sx + 24
    COL_W = [82, 290, 120, 120, 108, 82, 100, 122]
    COLS  = ["Data", "Histórico", "Débito", "Crédito", "Valor (R$)", "Tipo", "Status", "Ações"]
    TW = sum(COL_W)
    TH = 36
    ROW_H = 44
    parts = []

    # cabeçalho
    parts.append(rect(fx, y, TW, TH, fill=C["border_soft"], stroke=C["border"]))
    cx = fx
    for i, (c, w) in enumerate(zip(COLS, COL_W)):
        parts.append(txt(cx + 8, y + 24, c, size=11, fill=C["text_muted"], weight="bold"))
        if i < len(COLS) - 1:
            parts.append(ln(cx + w, y, cx + w, y + TH, C["border"]))
        cx += w

    # linhas
    for ri, row in enumerate(rows):
        ry = y + TH + ri * ROW_H
        bg = C["white"] if ri % 2 == 0 else "#fafafa"
        parts.append(rect(fx, ry, TW, ROW_H, fill=bg, stroke=C["border"]))
        cx = fx
        for ci, (val, cw) in enumerate(zip(row["vals"], COL_W[:-1])):
            if ci == 6:  # Status
                parts.append(pill(cx + 6, ry + 12, val,
                                   bg=row.get("badge_bg", C["border_soft"]),
                                   fg=row.get("badge_fg", C["text_muted"])))
            else:
                color = C["text_main"]
                if ci == 5:  # Tipo
                    color = row.get("tipo_color", C["text_muted"])
                parts.append(txt(cx + 8, ry + 27, val, size=12, fill=color))
            parts.append(ln(cx + cw, ry, cx + cw, ry + ROW_H, C["border"]))
            cx += cw
        # Ações
        parts.append(btn(cx + 4, ry + 9, 50, 26, "Editar", sm=True))
        parts.append(btn(cx + 58, ry + 9, 52, 26, "Excluir", sm=True))

    # rodapé
    ftr_y = y + TH + len(rows) * ROW_H + 14
    parts.append(txt(fx, ftr_y, f"{len(rows)} lançamento(s) no total",
                     size=12, fill=C["text_muted"]))
    return g(*parts)


# ────────────────────────────────────────────
# PAGE 1 — Tela Principal
# ────────────────────────────────────────────

def build_page1():
    sx = 250
    rows = [
        {"vals": ["10/04/2026", "Pagamento fornecedor XYZ",
                  "1.200,00", "—", "1.200,00", "DESPESA", "CONFIRMADO"],
         "badge_bg": C["success_lt"], "badge_fg": C["success"],
         "tipo_color": C["text_muted"]},
        {"vals": ["05/04/2026", "Receita de serviços prestados",
                  "—", "3.500,00", "3.500,00", "RECEITA", "EXPORTADO"],
         "badge_bg": C["info_lt"], "badge_fg": C["info"],
         "tipo_color": C["success"]},
        {"vals": ["01/04/2026", "Provisão DAS ref. 03/2026",
                  "—", "850,00", "850,00", "PROVISÃO", "RASCUNHO"],
         "badge_bg": C["border_soft"], "badge_fg": C["text_muted"],
         "tipo_color": C["warning"]},
        {"vals": ["28/03/2026", "Folha de pagamento mar/2026",
                  "6.400,00", "—", "6.400,00", "FOLHA", "CONFIRMADO"],
         "badge_bg": C["success_lt"], "badge_fg": C["success"],
         "tipo_color": C["text_muted"]},
        {"vals": ["15/03/2026", "Receita de consultoria",
                  "—", "5.000,00", "5.000,00", "RECEITA", "CONFIRMADO"],
         "badge_bg": C["success_lt"], "badge_fg": C["success"],
         "tipo_color": C["success"]},
    ]
    return g(
        rect(0, 0, 1366, 900, fill=C["bg"], stroke="none"),
        sidebar(),
        main_header("Lançamentos Contábeis"),
        toolbar_buttons(sx, 82, ["Históricos", "Plano de Contas", "Importar OFX",
                                  "Exportar CSV", "Atualizar"]),
        filter_panel(sx, 125),
        quick_entry_form(sx, 215),
        entries_table(sx, 280, rows),
    )


# ────────────────────────────────────────────
# PAGE 2 — Modo Completo (Editor D/C)
# ────────────────────────────────────────────

def build_page2():
    sx = 250
    fx = sx + 24

    dc_lines = [
        ("D", "1101", "Caixa Geral",      "1.200,00"),
        ("C", "3101", "Receita Serviços",  "1.200,00"),
    ]

    line_tbl_y = 268
    LH = 38
    LCW = [54, 80, 260, 110, 40]
    LHEADS = ["D/C", "Conta", "Nome", "Valor (R$)", ""]
    LTW = sum(LCW)

    parts = [
        rect(0, 0, 1366, 900, fill=C["bg"], stroke="none"),
        sidebar(),
        main_header("Lançamentos Contábeis"),
        toolbar_buttons(sx, 82, ["Históricos", "Plano de Contas", "Importar OFX",
                                  "Exportar CSV", "Atualizar"]),
        filter_panel(sx, 125),

        # Form expanded
        rect(fx, 215, 1366 - sx - 48, 200, fill=C["amber_lt"], stroke=C["amber_bd"], rx=6),
        # Top row
        inp(fx + 16, 225, 46, value="15"),
        inp(fx + 70, 225, 360, placeholder="Histórico do lançamento...",
            value="Receita de serviços – contrato #42"),
        inp(fx + 444, 225, 100, placeholder="0,00"),
        btn(fx + 554, 225, 86, 32, "+ Salvar", primary=True, sm=True),
        txt(fx + 650, 241, "simplificar", size=12, fill=C["primary"]),

        # Badge tipo detectado
        rect(fx + 16, 265, 180, 24, fill=C["success_lt"], stroke=C["success_lt"], rx=4),
        txt(fx + 24, 281, "Tipo detectado: Receita", size=11, fill=C["success"]),
    ]

    # Tabela D/C linhas
    parts.append(rect(fx, line_tbl_y + 30, LTW, LH, fill=C["border_soft"],
                      stroke=C["border"]))
    cx = fx
    for hi, (h, w) in enumerate(zip(LHEADS, LCW)):
        parts.append(txt(cx + 6, line_tbl_y + 30 + 24, h, size=11,
                         fill=C["text_muted"], weight="bold"))
        if hi < len(LHEADS) - 1:
            parts.append(ln(cx + w, line_tbl_y + 30, cx + w,
                            line_tbl_y + 30 + LH, C["border"]))
        cx += w

    for li, (dc, code, name, val) in enumerate(dc_lines):
        ry = line_tbl_y + 30 + LH + li * LH
        parts.append(rect(fx, ry, LTW, LH, fill=C["white"], stroke=C["border"]))
        dc_col = C["info"] if dc == "D" else C["green_dk"]
        parts.append(rect(fx, ry, LCW[0], LH, fill=C["primary_lt"] if dc=="D"
                          else C["success_lt"], stroke=C["border"]))
        parts.append(txt(fx + LCW[0]//2, ry + 24, dc, size=13, fill=dc_col,
                         weight="bold", anchor="middle"))
        cx = fx + LCW[0]
        parts.append(txt(cx + 6, ry + 24, code, size=12, fill=C["text_main"]))
        cx += LCW[1]
        parts.append(txt(cx + 6, ry + 24, name, size=12, fill=C["success"]))
        cx += LCW[2]
        parts.append(txt(cx + 6, ry + 24, val, size=12, fill=C["text_main"]))
        cx += LCW[3]
        parts.append(txt(cx + 6, ry + 24, "✕", size=12, fill=C["danger"]))

    # Botões add + balance
    bty = line_tbl_y + 30 + LH + len(dc_lines) * LH
    parts.append(rect(fx, bty, LTW, 36, fill=C["white"], stroke=C["border"]))
    parts.append(btn(fx + 8, bty + 4, 80, 28, "+ Débito", sm=True))
    parts.append(btn(fx + 96, bty + 4, 80, 28, "+ Crédito", sm=True))
    parts.append(txt(fx + LTW - 220, bty + 14, "Débitos: R$ 1.200,00 |", size=11,
                     fill=C["text_muted"]))
    parts.append(txt(fx + LTW - 100, bty + 14, "Balanceado ✓", size=11,
                     fill=C["success"], weight="bold"))

    # Tabela lançamentos resumida
    rows = [
        {"vals": ["10/04/2026", "Pagamento fornecedor XYZ",
                  "1.200,00", "—", "1.200,00", "DESPESA", "CONFIRMADO"],
         "badge_bg": C["success_lt"], "badge_fg": C["success"],
         "tipo_color": C["text_muted"]},
        {"vals": ["05/04/2026", "Receita de serviços prestados",
                  "—", "3.500,00", "3.500,00", "RECEITA", "EXPORTADO"],
         "badge_bg": C["info_lt"], "badge_fg": C["info"],
         "tipo_color": C["success"]},
    ]
    parts.append(entries_table(sx, 450, rows))

    return g(*parts)


# ────────────────────────────────────────────
# PAGE 3 — Modal: Plano de Contas
# ────────────────────────────────────────────

def build_page3():
    sx = 250
    # Overlay
    MX, MY, MW, MH = 283, 60, 800, 780

    accounts = [
        # (tipo_header, [(codigo, nome, tipo, natureza, pendente)])
        ("ATIVO", [
            ("1101", "Caixa Geral",   "ATIVO", "DEVEDORA", False),
            ("1102", "Banco Conta Corrente", "ATIVO", "DEVEDORA", False),
        ]),
        ("PASSIVO", [
            ("2101", "Fornecedores a Pagar", "PASSIVO", "CREDORA", False),
            ("2201", "Simples Nacional a Recolher", "PASSIVO", "CREDORA", True),
        ]),
        ("RECEITA", [
            ("3101", "Receita de Serviços", "RECEITA", "CREDORA", False),
        ]),
        ("DESPESA", [
            ("4101", "Despesas Operacionais", "DESPESA", "DEVEDORA", False),
            ("4201", "Folha de Pagamento",     "DESPESA", "DEVEDORA", True),
        ]),
    ]

    COL_W = [90, 260, 90, 90, 200]
    COLS  = ["Código", "Nome", "Tipo", "Natureza", "Ações"]
    TW    = sum(COL_W)

    parts = [
        rect(0, 0, 1366, 900, fill=C["bg"], stroke="none"),
        sidebar(),
        # Overlay
        rect(sx, 0, 1366 - sx, 900, fill="#000000", stroke="none", opacity=0.4),
        # Modal
        rect(MX, MY, MW, MH, fill=C["white"], stroke=C["border"], rx=8),
        # Modal header
        rect(MX, MY, MW, 56, fill=C["white"], stroke=C["border"], rx=8),
        rect(MX, MY + 40, MW, 16, fill=C["white"], stroke="none"),  # fix radius bottom
        txt(MX + 20, MY + 36, "Plano de Contas", size=16, fill=C["text_dark"], weight="bold"),
        btn(MX + MW - 80, MY + 12, 64, 30, "Fechar", sm=True),
        ln(MX, MY + 56, MX + MW, MY + 56, C["border"]),

        # Notificação pendente
        rect(MX + 16, MY + 66, MW - 32, 28, fill=C["warning_lt"], stroke=C["amber_bd"], rx=4),
        txt(MX + 28, MY + 85, "2 conta(s) pendente(s) de confirmação no ERP.",
            size=11, fill=C["warning"]),

        # Importar
        txt(MX + 20, MY + 112, "Importar plano de contas:", size=12,
            fill=C["text_muted"]),
        btn(MX + 20, MY + 122, 110, 30, "Importar...", sm=True),
        txt(MX + 138, MY + 142, "CSV / PDF", size=11, fill=C["text_muted"],
            italic=True),
        txt(MX + 20, MY + 162, "CSV: código;nome;tipo;natureza  — ou envie o PDF do plano de contas do ERP.",
            size=10, fill=C["text_faint"]),

        ln(MX + 16, MY + 178, MX + MW - 16, MY + 178, C["border"]),

        # Adicionar conta
        txt(MX + 20, MY + 196, "Adicionar conta", size=13,
            fill=C["text_dark"], weight="bold"),
    ]

    # Form add conta
    fy = MY + 208
    parts += [
        txt(MX + 20, fy + 12, "Código", size=10, fill=C["text_muted"]),
        inp(MX + 20, fy + 22, 80, placeholder="ex: 464"),
        txt(MX + 112, fy + 12, "Nome", size=10, fill=C["text_muted"]),
        inp(MX + 112, fy + 22, 280, placeholder="Nome da conta"),
        txt(MX + 404, fy + 12, "Tipo", size=10, fill=C["text_muted"]),
        sel(MX + 404, fy + 22, 100, label="DESPESA"),
        txt(MX + 516, fy + 12, "Natureza", size=10, fill=C["text_muted"]),
        sel(MX + 516, fy + 22, 100, label="DEVEDORA"),
        btn(MX + 628, fy + 22, 80, 32, "Adicionar", primary=True, sm=True),
        txt(MX + 20, fy + 62, "Contas adicionadas ficam como Pendente ERP até criação no ERP.",
            size=10, fill=C["text_faint"]),
    ]

    ln_y = MY + 290
    parts.append(ln(MX + 16, ln_y, MX + MW - 16, ln_y, C["border"]))

    # Tabela de contas (agrupada)
    ty = ln_y + 10
    for tipo, rows in accounts:
        parts.append(txt(MX + 20, ty + 16, tipo, size=11,
                         fill=C["text_muted"], weight="bold"))
        ty += 24
        # header
        parts.append(rect(MX + 16, ty, TW, 28, fill=C["border_soft"], stroke=C["border"]))
        cx = MX + 16
        for ci, (c, cw) in enumerate(zip(COLS, COL_W)):
            parts.append(txt(cx + 6, ty + 19, c, size=10,
                              fill=C["text_muted"], weight="bold"))
            if ci < len(COLS) - 1:
                parts.append(ln(cx + cw, ty, cx + cw, ty + 28, C["border"]))
            cx += cw
        ty += 28
        for (cod, nome, tipo_v, nat, pend) in rows:
            rb = C["warning_lt"] if pend else C["white"]
            parts.append(rect(MX + 16, ty, TW, 32, fill=rb, stroke=C["border"]))
            cx = MX + 16
            # Código
            parts.append(rect(cx + 4, ty + 6, len(cod)*8+10, 20,
                               fill=C["border_soft"], stroke=C["border"], rx=3))
            parts.append(txt(cx + 8, ty + 20, cod, size=11, fill=C["text_main"]))
            if pend:
                parts.append(pill(cx + len(cod)*8+20, ty + 6, "Pendente ERP",
                                   bg=C["warning_lt"], fg=C["warning"]))
            cx += COL_W[0]
            parts.append(txt(cx + 6, ty + 21, nome, size=12, fill=C["text_main"]))
            cx += COL_W[1]
            parts.append(txt(cx + 6, ty + 21, tipo_v, size=11, fill=C["text_muted"]))
            cx += COL_W[2]
            parts.append(txt(cx + 6, ty + 21, nat, size=11, fill=C["text_muted"]))
            cx += COL_W[3]
            if pend:
                parts.append(btn(cx + 4, ty + 4, 90, 24, "Confirmar ERP", sm=True))
            parts.append(btn(cx + (98 if pend else 4), ty + 4, 52, 24, "Excluir",
                              danger=True, sm=True))
            ty += 32
        ty += 8

    return g(*parts)


# ────────────────────────────────────────────
# PAGE 4 — Modal: Dar Baixa
# ────────────────────────────────────────────

def build_page4():
    sx = 250
    MX, MY, MW, MH = 403, 120, 560, 520

    dc_lines = [
        ("D", "2101", "Simples Nacional a Recolher", "850,00"),
        ("C", "1102", "Banco Conta Corrente",         "850,00"),
    ]
    LCW = [54, 80, 220, 100, 40]
    LH = 36
    LTW = sum(LCW)

    parts = [
        rect(0, 0, 1366, 900, fill=C["bg"], stroke="none"),
        sidebar(),
        rect(sx, 0, 1366 - sx, 900, fill="#000000", stroke="none", opacity=0.4),
        # Modal
        rect(MX, MY, MW, MH, fill=C["white"], stroke=C["border"], rx=8),
        # Header
        rect(MX, MY, MW, 56, fill=C["white"], stroke=C["border"], rx=8),
        rect(MX, MY + 40, MW, 16, fill=C["white"], stroke="none"),
        txt(MX + 20, MY + 36, "Dar Baixa — DAS / Simples Nacional",
            size=15, fill=C["text_dark"], weight="bold"),
        btn(MX + MW - 80, MY + 12, 64, 30, "Fechar", sm=True),
        ln(MX, MY + 56, MX + MW, MY + 56, C["border"]),

        # Info box laranja
        rect(MX + 20, MY + 70, MW - 40, 74, fill=C["orange_lt"],
             stroke=C["orange_bd"], rx=6),
        txt(MX + 36, MY + 90, "Competência:", size=11, fill=C["text_muted"]),
        txt(MX + 180, MY + 90, "2026-03", size=11, fill=C["text_dark"], weight="bold"),
        txt(MX + 36, MY + 108, "Histórico:", size=11, fill=C["text_muted"]),
        txt(MX + 180, MY + 108, "Provisão DAS ref. 03/2026",
            size=11, fill=C["text_dark"]),
        txt(MX + 36, MY + 126, "Valor provisionado:", size=11, fill=C["text_muted"]),
        txt(MX + 180, MY + 126, "R$ 850,00", size=11,
            fill=C["text_dark"], weight="bold"),

        # Form fields
        txt(MX + 20, MY + 162, "Data do pagamento", size=11, fill=C["text_muted"]),
        inp(MX + 20, MY + 176, 180, value="15/04/2026"),
        txt(MX + 214, MY + 162, "Histórico", size=11, fill=C["text_muted"]),
        inp(MX + 214, MY + 176, MW - 234, value="Pagamento DAS / Simples Nacional ref. 2026-03"),

        # Partidas
        txt(MX + 20, MY + 228, "Partidas (contrapartida da provisão)",
            size=12, fill=C["text_dark"], weight="bold"),
    ]

    # Tabela D/C
    tt_y = MY + 248
    LHEADS = ["D/C", "Conta", "Nome", "Valor (R$)", ""]
    parts.append(rect(MX + 20, tt_y, LTW, LH, fill=C["border_soft"], stroke=C["border"]))
    cx = MX + 20
    for hi, (h, w) in enumerate(zip(LHEADS, LCW)):
        parts.append(txt(cx + 6, tt_y + 24, h, size=11, fill=C["text_muted"], weight="bold"))
        if hi < len(LHEADS) - 1:
            parts.append(ln(cx + w, tt_y, cx + w, tt_y + LH, C["border"]))
        cx += w

    for li, (dc, code, name, val) in enumerate(dc_lines):
        ry = tt_y + LH + li * LH
        parts.append(rect(MX + 20, ry, LTW, LH, fill=C["white"], stroke=C["border"]))
        dc_col = C["info"] if dc == "D" else C["green_dk"]
        dc_bg  = C["primary_lt"] if dc == "D" else C["success_lt"]
        parts.append(rect(MX + 20, ry, LCW[0], LH, fill=dc_bg, stroke=C["border"]))
        parts.append(txt(MX + 20 + LCW[0]//2, ry + 24, dc, size=13,
                         fill=dc_col, weight="bold", anchor="middle"))
        cx = MX + 20 + LCW[0]
        parts.append(txt(cx + 6, ry + 24, code, size=12, fill=C["text_main"]))
        cx += LCW[1]
        parts.append(txt(cx + 6, ry + 24, name, size=11, fill=C["text_muted"]))
        cx += LCW[2]
        parts.append(txt(cx + 6, ry + 24, val, size=12, fill=C["text_main"]))
        cx += LCW[3]
        parts.append(txt(cx + 10, ry + 24, "✕", size=12, fill=C["danger"]))

    # Balance footer
    bty = tt_y + LH + len(dc_lines) * LH
    parts.append(rect(MX + 20, bty, LTW, 32, fill=C["white"], stroke=C["border"]))
    parts.append(txt(MX + 20 + LTW - 180, bty + 12, "Débitos: R$ 850,00 |",
                     size=11, fill=C["text_muted"]))
    parts.append(txt(MX + 20 + LTW - 80, bty + 12, "Balanceado ✓",
                     size=11, fill=C["success"], weight="bold"))

    # Botões
    btn_y = MY + MH - 56
    parts += [
        ln(MX, btn_y, MX + MW, btn_y, C["border"]),
        btn(MX + MW - 230, btn_y + 12, 130, 36, "Confirmar Baixa", primary=True),
        btn(MX + MW - 90,  btn_y + 12, 76,  36, "Cancelar"),
    ]

    return g(*parts)


# ────────────────────────────────────────────
# Montar o content.xml do Pencil
# ────────────────────────────────────────────

PAGES = [
    ("page1", "1 – Tela Principal",          build_page1),
    ("page2", "2 – Editor Linhas D/C",        build_page2),
    ("page3", "3 – Modal Plano de Contas",    build_page3),
    ("page4", "4 – Modal Dar Baixa",          build_page4),
]


def build_xml():
    pages_xml = []
    for pid, pname, builder in PAGES:
        content_svg = builder()
        pages_xml.append(f"""
    <p:Page id="{pid}" p:name="{esc(pname)}">
      <p:Properties>
        <p:Property name="width">1366</p:Property>
        <p:Property name="height">900</p:Property>
        <p:Property name="backgroundColor">rgba(248,250,252,1)</p:Property>
        <p:Property name="note"></p:Property>
        <p:Property name="pageZoom">1</p:Property>
        <p:Property name="pageWidth">1366</p:Property>
        <p:Property name="pageHeight">900</p:Property>
        <p:Property name="scrollTop">0</p:Property>
        <p:Property name="scrollLeft">0</p:Property>
      </p:Properties>
      <p:Content>
        {content_svg}
      </p:Content>
    </p:Page>""")

    return f"""<?xml version="1.0" ?>
<p:Document xmlns:p="http://www.evolus.vn/Namespace/Pencil"
            xmlns="http://www.w3.org/2000/svg"
            xmlns:xlink="http://www.w3.org/1999/xlink"
            p:version="3.0.4">
  <p:Properties>
    <p:Property name="activeCanvas">page1</p:Property>
    <p:Property name="canvasConfig"></p:Property>
  </p:Properties>
  <p:Pages>
    {"".join(pages_xml)}
  </p:Pages>
</p:Document>"""


def main():
    xml = build_xml()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("content.xml", xml.encode("utf-8"))
    data = buf.getvalue()
    with open(OUTPUT, "wb") as f:
        f.write(data)
    print(f"Arquivo gerado: {OUTPUT}  ({len(data):,} bytes)")
    print(f"Páginas: {len(PAGES)}")
    for pid, pname, _ in PAGES:
        print(f"  • {pid}: {pname}")


if __name__ == "__main__":
    main()
