/*
 * Converte o texto das questões (markdown simplificado + LaTeX) em HTML.
 * O mesmo arquivo roda no navegador e no Node (ferramentas/checar_render.js),
 * para que o validador teste exatamente o que o aluno vai ver.
 *
 * Formato:
 *   linha em branco      -> novo parágrafo
 *   quebra simples       -> <br>
 *   **negrito** *itálico* <u>sublinhado</u> <sup>/<sub>
 *   $...$ e $$...$$      -> fórmula (KaTeX); \$ é um cifrão literal
 *   ![descrição](fig:id) -> figura da questão
 *   [[5]]                -> número de linha na margem
 *   | a | b |            -> tabela
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica;
  else raiz.Render = fabrica(raiz.katex);
})(typeof self !== "undefined" ? self : this, function (katex) {
  "use strict";

  var TAGS_PERMITIDAS = /&lt;(\/?)(u|sup|sub|br|em|strong)&gt;/g;

  function escapar(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Separa o texto em pedaços de texto comum e de fórmula.
  function separarFormulas(s) {
    var partes = [];
    var buf = "";
    var i = 0;
    while (i < s.length) {
      var c = s[i];
      if (c === "\\" && s[i + 1] === "$") {
        buf += "$";
        i += 2;
        continue;
      }
      if (c === "$") {
        var bloco = s[i + 1] === "$";
        var abre = bloco ? 2 : 1;
        var fim = s.indexOf(bloco ? "$$" : "$", i + abre);
        if (fim === -1) throw new Error("Fórmula sem fechamento: " + s.slice(i, i + 40));
        if (buf) partes.push({ tipo: "texto", valor: buf });
        buf = "";
        partes.push({ tipo: "formula", valor: s.slice(i + abre, fim), bloco: bloco });
        i = fim + abre;
        continue;
      }
      buf += c;
      i++;
    }
    if (buf) partes.push({ tipo: "texto", valor: buf });
    return partes;
  }

  function formula(expr, bloco) {
    if (!katex) return '<span class="tex">' + escapar(expr) + "</span>";
    return katex.renderToString(expr, {
      displayMode: bloco,
      throwOnError: true,
      strict: "ignore",
      output: "mathml",
    });
  }

  function textoInline(s, opc) {
    var h = escapar(s);
    h = h.replace(TAGS_PERMITIDAS, "<$1$2>");
    h = h.replace(/\\\*/g, "&#42;"); // \* é um asterisco literal (nota de rodapé)
    h = h.replace(/\[\[(\d{1,3})\]\]/g, '<span class="ln" aria-hidden="true">$1</span>');
    h = h.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, "$1<em>$2</em>");
    return h;
  }

  // A descrição da figura vira texto puro: fórmulas e marcações dentro dela
  // não podem ser interpretadas, senão a imagem se perde.
  function textoAlt(alt) {
    return alt
      .replace(/\\\$/g, "\u0000")
      .replace(/\$+([^$]*)\$+/g, function (_, f) {
        return f
          .replace(/\\circ/g, "°").replace(/\\cdot/g, "·").replace(/\\times/g, "×")
          .replace(/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g, "$1")
          .replace(/\\[,;! ]/g, " ").replace(/[{}^_]/g, "").replace(/\\/g, "");
      })
      .replace(/\u0000/g, "$")
      .replace(/\\\*/g, "\u0001").replace(/\*/g, "").replace(/\u0001/g, "*");
  }

  function figura(alt, id, opc) {
    var src = opc.figura ? opc.figura(id) : id;
    if (opc.figurasUsadas) opc.figurasUsadas.push(id);
    return '<img class="fig" src="' + escapar(src) + '" alt="' + escapar(textoAlt(alt)) + '" loading="lazy">';
  }

  function inline(s, opc) {
    // a descrição pode ter colchetes, um nível só ("[+ claro]")
    var re = /!\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(fig:([A-Za-z0-9_-]+)\)/g;
    var h = "", ultimo = 0, m;
    var trecho = function (t) {
      return separarFormulas(t)
        .map(function (p) {
          return p.tipo === "formula" ? formula(p.valor, p.bloco) : textoInline(p.valor, opc);
        })
        .join("");
    };
    while ((m = re.exec(s))) {
      h += trecho(s.slice(ultimo, m.index)) + figura(m[1], m[2], opc);
      ultimo = re.lastIndex;
    }
    return h + trecho(s.slice(ultimo));
  }

  function tabela(linhas, opc) {
    var celulas = function (l) {
      return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) {
        return c.trim();
      });
    };
    var cab = celulas(linhas[0]);
    var corpo = linhas.slice(2).map(celulas);
    var h = '<div class="tabela"><table><thead><tr>';
    cab.forEach(function (c) {
      h += "<th>" + inline(c, opc) + "</th>";
    });
    h += "</tr></thead><tbody>";
    corpo.forEach(function (lin) {
      h += "<tr>";
      lin.forEach(function (c) {
        h += "<td>" + inline(c, opc) + "</td>";
      });
      h += "</tr>";
    });
    return h + "</tbody></table></div>";
  }

  function renderizar(texto, opc) {
    opc = opc || {};
    if (!texto) return "";
    var blocos = String(texto).replace(/\r/g, "").split(/\n\s*\n/);
    // texto com linhas numeradas: todos os parágrafos ganham a margem, para alinhar
    var temNumeracao = /\[\[\d+\]\]/.test(texto);
    return blocos
      .map(function (b) {
        b = b.replace(/^\n+|\n+$/g, "");
        if (!b.trim()) return "";
        var linhas = b.split("\n");
        if (linhas.length >= 2 && /^\s*\|/.test(linhas[0]) && /^\s*\|?\s*:?-{2,}/.test(linhas[1])) {
          return tabela(linhas, opc);
        }
        var html = linhas
          .map(function (l) {
            return inline(l, opc);
          })
          .join("<br>");
        if (/^\s*!\[(?:[^\[\]]|\[[^\[\]]*\])*\]\(fig:[^)]+\)\s*$/.test(b)) return '<figure>' + html + "</figure>";
        return temNumeracao ? '<p class="numerado">' + html + "</p>" : "<p>" + html + "</p>";
      })
      .join("");
  }

  return { renderizar: renderizar, separarFormulas: separarFormulas };
});
