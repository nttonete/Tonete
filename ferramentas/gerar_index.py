"""Gera index.html (documento completo, para hospedagem própria) a partir de pagina.html.

pagina.html é a fonte: o mesmo arquivo é publicado como prévia (Artifact), que já
acrescenta doctype, <head> e <body>. Rode depois de editar pagina.html.
"""
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
corpo = (RAIZ / "pagina.html").read_text()
cabeca, _, resto = corpo.partition("</style>")
html = f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
{cabeca}</style>
</head>
<body>
{resto.strip()}
</body>
</html>
"""
(RAIZ / "index.html").write_text(html)
print("index.html gerado")
