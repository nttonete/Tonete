"""Monta a prévia publicada (Artifact) em trabalho/previa/.

A prévia aceita poucos arquivos por versão, então as figuras de cada prova vão
embutidas no próprio JSON da prova (campo "figuras", em data URI). A versão para
hospedagem própria (index.html + img/) continua usando os arquivos separados.
"""
import base64
import json
import shutil
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "trabalho/previa"

shutil.rmtree(SAIDA, ignore_errors=True)
(SAIDA / "dados/questoes").mkdir(parents=True)
(SAIDA / "app").mkdir()
(SAIDA / "img/tabela-periodica").mkdir(parents=True)

for js in ("app.js", "render.js"):
    shutil.copy(RAIZ / "app" / js, SAIDA / "app" / js)
shutil.copy(RAIZ / "dados/indice.json", SAIDA / "dados/indice.json")
for img in (RAIZ / "img/tabela-periodica").glob("*.webp"):
    shutil.copy(img, SAIDA / "img/tabela-periodica" / img.name)

total = 0
for arq in sorted((RAIZ / "dados/questoes").glob("*.json")):
    d = json.loads(arq.read_text())
    pasta = RAIZ / "img/questoes" / d["edicao"]["id"]
    d["figuras"] = {
        f.stem: "data:image/webp;base64," + base64.b64encode(f.read_bytes()).decode()
        for f in sorted(pasta.glob("*.webp"))
    }
    texto = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    (SAIDA / "dados/questoes" / arq.name).write_text(texto)
    total += len(texto.encode())
arquivos = [p for p in SAIDA.rglob("*") if p.is_file()]
print(f"prévia: {len(arquivos)} arquivos, {total / 1e6:.1f} MB de questões")
