"""Prepara um caderno de prova (PDF) para a transcrição das questões.

Gera em trabalho/<edicao>/:
  paginas/pNN.png      página inteira (para ler e conferir)
  anotadas/pNN.png     página com as figuras candidatas numeradas e uma grade em pontos
  figuras/pNN-fK.webp  recorte de cada figura candidata
  texto.md             texto de cada página na ordem de leitura (coluna esquerda, depois direita)
  figuras.json         posição de cada figura candidata
  mapa.json            em que página aparece cada marcador de questão

Uso: python3 ferramentas/preparar_prova.py <id-da-edicao>   (ids em dados/provas/edicoes.json)
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

RAIZ = Path(__file__).resolve().parent.parent
DPI_PAGINA = 130
ZOOM_FIGURA = 2.5  # 180 dpi


def carregar_edicao(ed_id):
    edicoes = json.loads((RAIZ / "dados/provas/edicoes.json").read_text())
    for e in edicoes:
        if e["id"] == ed_id:
            return e
    raise SystemExit(f"edição desconhecida: {ed_id}")


def blocos_ordenados(pagina):
    """Blocos de texto em ordem de leitura para páginas de duas colunas."""
    largura = pagina.rect.width
    meio = largura / 2
    blocos = [b for b in pagina.get_text("blocks") if b[6] == 0 and b[4].strip()]
    largos, esq, dir_ = [], [], []
    for b in blocos:
        x0, y0, x1, y1 = b[:4]
        if x0 < meio - 15 and x1 > meio + 15:
            largos.append(b)
        elif x0 < meio:
            esq.append(b)
        else:
            dir_.append(b)
    # Faixas separadas por blocos de largura total; dentro de cada faixa, esquerda e depois direita
    largos.sort(key=lambda b: b[1])
    ordem, topo = [], -1
    for corte in [b[1] for b in largos] + [pagina.rect.height + 1]:
        faixa = lambda lst: sorted([b for b in lst if topo <= b[1] < corte], key=lambda b: (b[1], b[0]))
        ordem += faixa(esq) + faixa(dir_)
        prox = [b for b in largos if b[1] == corte]
        ordem += prox
        topo = corte
    vistos, final = set(), []
    for b in ordem:
        if id(b) not in vistos:
            vistos.add(id(b))
            final.append(b)
    return final


def agrupar(retangulos, folga=10):
    """Une retângulos próximos ou sobrepostos."""
    grupos = [pymupdf.Rect(r) for r in retangulos]
    mudou = True
    while mudou:
        mudou = False
        novos = []
        while grupos:
            g = grupos.pop()
            for i, h in enumerate(novos):
                if (g + (-folga, -folga, folga, folga)).intersects(h):
                    novos[i] = h | g
                    mudou = True
                    break
            else:
                novos.append(g)
        grupos = novos
    return grupos


def figuras_da_pagina(pagina):
    area = pagina.rect
    candidatos = []
    for info in pagina.get_image_info():
        r = pymupdf.Rect(info["bbox"]) & area
        if r.width > 25 and r.height > 25:
            candidatos.append(r)
    for d in pagina.get_drawings():
        r = pymupdf.Rect(d["rect"]) & area
        if r.is_empty:
            continue
        # ignora molduras e réguas: linhas finas muito curtas ou que cortam a página
        if r.width < 3 or r.height < 3:
            if max(r.width, r.height) < 40 or r.width > area.width * 0.4 or r.height > area.height * 0.4:
                continue
        if r.width > area.width * 0.8 and r.height > area.height * 0.5:
            continue
        candidatos.append(r)
    grupos = agrupar(candidatos)
    figuras = []
    for g in grupos:
        if g.width < 40 or g.height < 25:
            continue
        if g.width > area.width * 0.92 and g.height > area.height * 0.85:
            continue  # moldura da página
        # caixas de título como "QUESTÃO 12": pouca altura e só texto dentro
        texto = pagina.get_textbox(g).strip()
        if g.height < 30 and re.fullmatch(r"(QUEST[ÃA]O\s*)?\d{1,2}", texto, re.I):
            continue
        figuras.append(g)
    figuras.sort(key=lambda r: (r.x0 > area.width / 2, r.y0))
    return figuras


MARCADOR = re.compile(r"^\s*(?:QUEST[ÃA]O\s+(\d{1,2})|([BFGHMQ]\d{2})|(\d{1,2}))\s*$", re.I)


def preparar(ed):
    pdf = pymupdf.open(RAIZ / ed["pdf"])
    copia = pymupdf.open(RAIZ / ed["pdf"])  # recebe as anotações; o texto é lido do original
    pasta = RAIZ / "trabalho" / ed["id"]
    for sub in ("paginas", "anotadas", "figuras"):
        (pasta / sub).mkdir(parents=True, exist_ok=True)
    texto, figuras_json, mapa = [], {}, {}
    for n, pagina in enumerate(pdf, start=1):
        nome = f"p{n:02d}"
        pagina.get_pixmap(dpi=DPI_PAGINA).save(pasta / "paginas" / f"{nome}.png")
        figs = figuras_da_pagina(pagina)
        lista = []
        for k, r in enumerate(figs, start=1):
            clip = (r + (-4, -4, 4, 4)) & pagina.rect
            pix = pagina.get_pixmap(matrix=pymupdf.Matrix(ZOOM_FIGURA, ZOOM_FIGURA), clip=clip)
            arq = f"{nome}-f{k}.webp"
            pix.pil_save(pasta / "figuras" / arq, format="WEBP", quality=82)
            lista.append({"id": f"{nome}-f{k}", "arquivo": arq, "bbox": [round(v, 1) for v in clip]})
        figuras_json[nome] = lista
        # página anotada: grade a cada 50 pontos e figuras numeradas
        anot = copia[n - 1]
        forma = anot.new_shape()
        for x in range(0, int(anot.rect.width), 50):
            forma.draw_line((x, 0), (x, anot.rect.height))
        for y in range(0, int(anot.rect.height), 50):
            forma.draw_line((0, y), (anot.rect.width, y))
        forma.finish(color=(0.6, 0.8, 1), width=0.3)
        for x in range(0, int(anot.rect.width), 100):
            forma.insert_text((x + 1, 7), str(x), fontsize=5, color=(0, 0.3, 0.9))
        for y in range(100, int(anot.rect.height), 100):
            forma.insert_text((1, y - 1), str(y), fontsize=5, color=(0, 0.3, 0.9))
        for f in lista:
            r = pymupdf.Rect(f["bbox"])
            forma.draw_rect(r)
            forma.finish(color=(1, 0, 0), width=1.2)
            forma.insert_text((r.x0 + 2, r.y0 + 9), f["id"], fontsize=8, color=(1, 0, 0))
        forma.commit()
        anot.get_pixmap(dpi=DPI_PAGINA).save(pasta / "anotadas" / f"{nome}.png")

        texto.append(f"\n\n======== PÁGINA {n} ({nome}) ========")
        if lista:
            texto.append("[figuras candidatas nesta página: " + ", ".join(f["id"] for f in lista) + "]")
        for b in blocos_ordenados(pagina):
            t = b[4].strip()
            texto.append(f"[x={b[0]:.0f} y={b[1]:.0f}] {t}")
            for linha in t.splitlines():
                m = MARCADOR.match(linha)
                if m:
                    chave = m.group(1) or m.group(2) or m.group(3)
                    mapa.setdefault(chave.upper().lstrip("0") or "0", []).append(n)
    (pasta / "texto.md").write_text("\n".join(texto))
    (pasta / "figuras.json").write_text(json.dumps(figuras_json, ensure_ascii=False, indent=1))
    (pasta / "mapa.json").write_text(json.dumps(mapa, ensure_ascii=False))
    print(f"{ed['id']}: {len(pdf)} páginas, {sum(len(v) for v in figuras_json.values())} figuras candidatas")


if __name__ == "__main__":
    for ed_id in sys.argv[1:]:
        preparar(carregar_edicao(ed_id))
