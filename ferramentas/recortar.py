"""Recorta uma região de uma página do PDF da prova como figura.

Use quando a figura candidata gerada automaticamente cortou parte do desenho
(legendas, eixos, rótulos) ou quando a figura não foi detectada.

Uso:
  python3 ferramentas/recortar.py <edicao> <pagina> <x0> <y0> <x1> <y1>
  python3 ferramentas/recortar.py --conferir <pasta> <edicao> <pagina> <x0> <y0> <x1> <y1>

Com --conferir, só gera uma ampliação (300 dpi) em <pasta>/ para ler detalhes,
sem criar figura nova.

As coordenadas são em pontos do PDF, as mesmas da grade azul das páginas em
trabalho/<edicao>/anotadas/ (origem no canto superior esquerdo, linhas a cada 50).
Gera trabalho/<edicao>/figuras/pNN-cK.webp e imprime o id (pNN-cK) para usar
na transcrição. Confira sempre o recorte abrindo o arquivo gerado.
"""
import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from preparar_prova import RAIZ, ZOOM_FIGURA, carregar_edicao  # noqa: E402


def main():
    args = sys.argv[1:]
    conferir = None
    if args and args[0] == "--conferir":
        conferir = Path(args[1])
        args = args[2:]
    ed_id, pagina = args[0], int(args[1])
    x0, y0, x1, y1 = map(float, args[2:6])
    ed = carregar_edicao(ed_id)
    pasta = RAIZ / "trabalho" / ed_id / "figuras"
    pdf = pymupdf.open(RAIZ / ed["pdf"])
    pag = pdf[pagina - 1]
    clip = pymupdf.Rect(x0, y0, x1, y1) & pag.rect
    if clip.is_empty:
        raise SystemExit("região vazia: confira as coordenadas")
    if conferir:
        conferir.mkdir(parents=True, exist_ok=True)
        saida = conferir / f"zoom-p{pagina:02d}-{int(x0)}-{int(y0)}.png"
        pag.get_pixmap(dpi=300, clip=clip).save(saida)
        print(saida)
        return
    # reserva o nome de forma atômica (vários agentes podem recortar ao mesmo tempo)
    k = 1
    while True:
        fig_id = f"p{pagina:02d}-c{k}"
        try:
            with open(pasta / f"{fig_id}.webp", "x"):
                break
        except FileExistsError:
            k += 1
    pix = pag.get_pixmap(matrix=pymupdf.Matrix(ZOOM_FIGURA, ZOOM_FIGURA), clip=clip)
    pix.pil_save(pasta / f"{fig_id}.webp", format="WEBP", quality=82)
    print(fig_id, "→", pasta / f"{fig_id}.webp")


if __name__ == "__main__":
    main()
