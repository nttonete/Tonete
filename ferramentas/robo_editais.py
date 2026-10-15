"""Robô de editais: confere os documentos oficiais das bancas e avisa o que mudou.

O que ele faz, a cada execução:
  1. Baixa os documentos oficiais monitorados (PDFs de guias, manuais e resoluções) e compara o texto
     com o da última conferência (impressão digital SHA-256 do texto extraído).
  2. Lê as páginas oficiais de cada vestibular e lista os documentos publicados nelas; um documento
     novo (por exemplo, uma retificação do edital) entra no relatório.
  3. Confere se cada data de prova de dados/provas/calendario.json ainda aparece no documento de onde
     ela foi tirada. Se não aparecer, a data pode ter mudado.
  4. Grava o relatório em trabalho/robo-editais/relatorio-AAAA-MM-DD.md e o estado em
     dados/provas/robo-estado.json.

Ele não altera o calendário sozinho: quem decide é uma pessoa (ou a sessão agendada, que prepara a
mudança numa branch separada para aprovação). Uso:

  python3 ferramentas/robo_editais.py            confere e grava relatório + estado
  python3 ferramentas/robo_editais.py --seco     só mostra, não grava nada
Saída: 0 sem novidade, 10 com novidade (mudança, documento novo ou data a conferir), 1 erro geral.
"""
import datetime
import hashlib
import html
import json
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ARQ_ESTADO = RAIZ / "dados/provas/robo-estado.json"
ARQ_CAL = RAIZ / "dados/provas/calendario.json"
PASTA_REL = RAIZ / "trabalho/robo-editais"
AGENTE = "Mozilla/5.0 (compatible; BancaAbertaRobo/1.0; conferencia de editais)"

# Documentos (PDF) e páginas acompanhados. "datas" liga cada fase do calendário ao texto que a confirma.
MONITORADOS = {
    "fuvest": {
        "documentos": [
            "https://www.fuvest.br/wp-content/uploads/fuvest2027-guia-jornada.pdf",
            "https://www.fuvest.br/wp-content/uploads/fuvest2027-guia-provas.pdf",
            "https://www.fuvest.br/wp-content/uploads/fuvest2027-resolucao-DOE.pdf",
        ],
        "paginas": ["https://www.fuvest.br/vestibular-da-usp/"],
        "datas": "https://www.fuvest.br/wp-content/uploads/fuvest2027-guia-jornada.pdf",
    },
    "unicamp": {
        "documentos": [
            "https://www.comvest.unicamp.br/wp-content/uploads/2026/07/VU2027-Manual-do-Ingresso.pdf",
        ],
        "paginas": ["https://www.comvest.unicamp.br/ingresso-2027/vestibular-2027/"],
        # a lista de obras fica no texto da página, não num PDF
        "trechos": [{"url": "https://www.comvest.unicamp.br/lista-de-obras/", "inicio": "Vestibular Unicamp 2027", "fim": "Vestibular Unicamp 2028", "nome": "lista de obras 2027"}],
        "datas": "https://www.comvest.unicamp.br/wp-content/uploads/2026/07/VU2027-Manual-do-Ingresso.pdf",
    },
    "unesp": {
        "documentos": [
            "https://vestibular.unesp.br/Home/noticias/2026/08/251/manualdocandidatovnsp25141.pdf",
        ],
        # o site da Vunesp recusa acesso automatizado; o portal da Unesp é montado no navegador
        "paginas": [],
        "datas": "https://vestibular.unesp.br/Home/noticias/2026/08/251/manualdocandidatovnsp25141.pdf",
    },
}
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
PALAVRAS_DOC = re.compile(r"edital|resolu|retifica|manual|guia|calend|obras|leitura|instru|comunicado|convoca|programa", re.I)


def baixar(url):
    req = urllib.request.Request(url, headers={"User-Agent": AGENTE})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def texto_pdf(dados):
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(dados)
        f.flush()
        r = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, check=True)
    return r.stdout.decode("utf-8", "ignore")


def normalizar(t):
    return " ".join(t.split())


def links_de_documentos(pagina_html, base):
    achados = set()
    for href, rotulo in re.findall(r'<a[^>]+href="([^"#]+)"[^>]*>(.*?)</a>', pagina_html, re.S):
        rot = normalizar(html.unescape(re.sub("<[^>]+>", " ", rotulo)))
        if href.startswith("/"):
            href = re.match(r"https?://[^/]+", base).group(0) + href
        if not href.startswith("http"):
            continue
        if href.lower().endswith(".pdf") or (PALAVRAS_DOC.search(rot) and "2027" in (rot + href)):
            achados.add(href)
    return sorted(achados)


def formas_da_data(iso):
    a, m, d = iso.split("-")
    dd, mm = int(d), int(m)
    return [f"{d}/{m}/{a}", f"{d}/{m}", f"{d}.{m}.{a}", f"{dd} de {MESES[mm - 1]}", f"{dd:02d} de {MESES[mm - 1]}", f"{dd}º de {MESES[mm - 1]}"]


def main():
    seco = "--seco" in sys.argv
    estado = json.loads(ARQ_ESTADO.read_text()) if ARQ_ESTADO.exists() else {"documentos": {}, "paginas": {}}
    cal = json.loads(ARQ_CAL.read_text())
    agora = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    hoje = agora[:10]
    linhas, novidades, falhas = [], 0, []
    textos = {}
    for v, mon in MONITORADOS.items():
        linhas.append(f"\n## {v.upper()}\n")
        for url in mon["documentos"]:
            try:
                t = normalizar(texto_pdf(baixar(url)))
            except Exception as e:  # noqa: BLE001
                falhas.append(f"{url}: {e}")
                linhas.append(f"- Não foi possível ler {url} ({e}).")
                continue
            textos[url] = t
            h = hashlib.sha256(t.encode()).hexdigest()
            ant = estado["documentos"].get(url)
            if not ant:
                linhas.append(f"- Primeira conferência de {url}.")
            elif ant["hash"] != h:
                novidades += 1
                linhas.append(f"- **MUDOU**: {url} (antes conferido em {ant['conferido'][:10]}).")
            else:
                linhas.append(f"- Sem mudança: {url}.")
            estado["documentos"][url] = {"hash": h, "conferido": agora, "mudou": (ant["mudou"] if ant and ant["hash"] == h else agora)}
        for url in mon["paginas"]:
            try:
                links = links_de_documentos(baixar(url).decode("utf-8", "ignore"), url)
            except Exception as e:  # noqa: BLE001
                falhas.append(f"{url}: {e}")
                linhas.append(f"- Não foi possível abrir {url} ({e}).")
                continue
            ant = set(estado["paginas"].get(url, {}).get("links", []))
            novos = [x for x in links if x not in ant] if ant else []
            if novos:
                novidades += 1
                linhas.append(f"- **Documentos novos** em {url}:")
                linhas += [f"  - {x}" for x in novos]
            else:
                linhas.append(f"- Nenhum documento novo em {url} ({len(links)} acompanhados).")
            estado["paginas"][url] = {"links": links, "conferido": agora}
        for tr in mon.get("trechos", []):
            try:
                pag = baixar(tr["url"]).decode("utf-8", "ignore")
                pag = normalizar(html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>|<style.*?</style>", " ", pag, flags=re.S))))
                i = pag.find(tr["inicio"] + " Gênero")
                i = i if i >= 0 else pag.find(tr["inicio"])
                j = pag.find(tr["fim"], i + 1)
                if i < 0 or j < 0:
                    raise ValueError("trecho não encontrado na página")
                t = pag[i:j]
            except Exception as e:  # noqa: BLE001
                falhas.append(f"{tr['url']}: {e}")
                linhas.append(f"- Não foi possível conferir a {tr['nome']} em {tr['url']} ({e}).")
                continue
            h = hashlib.sha256(t.encode()).hexdigest()
            chave = tr["url"] + "#" + tr["nome"]
            ant = estado["documentos"].get(chave)
            if ant and ant["hash"] != h:
                novidades += 1
                linhas.append(f"- **MUDOU** a {tr['nome']} em {tr['url']}.")
            else:
                linhas.append(f"- {'Primeira conferência' if not ant else 'Sem mudança'}: {tr['nome']}.")
            estado["documentos"][chave] = {"hash": h, "conferido": agora, "mudou": (ant["mudou"] if ant and ant["hash"] == h else agora)}
        # as datas do calendário ainda aparecem na fonte?
        fonte = textos.get(mon["datas"])
        c = cal["vestibulares"].get(v)
        if fonte and c:
            for f in c["fases"]:
                if not any(x in fonte for x in formas_da_data(f["data"])):
                    novidades += 1
                    linhas.append(f"- **Conferir data**: {f['nome']} ({f['data']}) não aparece mais em {mon['datas']}.")
            linhas.append(f"- Datas do calendário conferidas contra {mon['datas']}.")
        if not mon["paginas"] and v == "unesp":
            linhas.append("- O site da Vunesp recusa acesso automatizado: novos comunicados da UNESP precisam ser conferidos à mão.")
    cab = [f"# Robô de editais · {hoje}", "", f"{novidades} novidade(s). {len(falhas)} falha(s) de acesso."]
    rel = "\n".join(cab + linhas) + "\n"
    print(rel)
    if not seco:
        estado["ultima_execucao"] = agora
        ARQ_ESTADO.write_text(json.dumps(estado, ensure_ascii=False, indent=1))
        PASTA_REL.mkdir(parents=True, exist_ok=True)
        (PASTA_REL / f"relatorio-{hoje}.md").write_text(rel)
    sys.exit(10 if novidades else 0)


if __name__ == "__main__":
    main()
