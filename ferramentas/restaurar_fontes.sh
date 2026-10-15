#!/bin/sh
# Recria o que fica fora do git depois que o contêiner é reciclado:
# os PDFs oficiais (fontes-pdf), a cópia do KaTeX para o validador e as páginas renderizadas.
set -e
cd "$(dirname "$0")/.."
DESTINO="${FONTES:-$PWD/../provas-vestibulares}"
if [ ! -d "$DESTINO/USP" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/diogopelaes/provas-vestibulares.git "$DESTINO"
  git -C "$DESTINO" sparse-checkout init --no-cone
  printf '%s\n' '/UNESP/1ª Fase/*' '/UNICAMP/1ª Fase/*' '/USP/1ª Fase/*' > "$DESTINO/.git/info/sparse-checkout"
  git -C "$DESTINO" checkout
fi
ln -sfn "$DESTINO" fontes-pdf
pip install -q pymupdf
[ -d ferramentas/node/node_modules/katex ] || (cd ferramentas/node && npm install --silent)
# páginas, texto e figuras automáticas de cada edição (os recortes manuais -c estão no git)
for ed in $(python3 -c "import json; print(' '.join(e['id'] for e in json.load(open('dados/provas/edicoes.json'))))"); do
  [ -f "trabalho/$ed/texto.md" ] || python3 ferramentas/preparar_prova.py "$ed"
done
echo "fontes restauradas"
