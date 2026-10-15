/* Banca Aberta: simulados e treinos com questões reais de vestibular. */
(function () {
  "use strict";

  var VESTIBULARES = {
    fuvest: { nome: "FUVEST", sub: "USP", tamanho: 90, horas: 5 },
    unicamp: { nome: "Unicamp", sub: "Comvest", tamanho: 72, horas: 5 },
    unesp: { nome: "UNESP", sub: "VUNESP", tamanho: 90, horas: 5 },
  };
  var MATERIAS = {
    portugues: "Português", literatura: "Literatura", ingles: "Inglês", historia: "História",
    geografia: "Geografia", filosofia: "Filosofia", sociologia: "Sociologia", artes: "Artes",
    biologia: "Biologia", quimica: "Química", fisica: "Física", matematica: "Matemática",
  };
  var ORDEM_MATERIAS = Object.keys(MATERIAS);
  var CHAVE_SESSAO = "banca-aberta:sessao";
  var CHAVE_HIST = "banca-aberta:historico";
  var SEGUNDOS_POR_QUESTAO = 200; // ritmo do treino cronometrado: 5 h para 90 questões

  var app = document.getElementById("app");
  var estado = { indice: null, cache: {}, sessao: null, tela: "inicio", revendo: null, confirmando: false };
  var relogioTimer = null;

  // ---------- utilitários ----------
  function el(tag, attrs, filhos) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (filhos || []).forEach(function (f) {
      if (f === null || f === undefined || f === false) return;
      e.appendChild(typeof f === "string" ? document.createTextNode(f) : f);
    });
    return e;
  }
  function ler(chave, padrao) {
    try { var v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; }
  }
  function gravar(chave, valor) {
    try { if (valor === null) localStorage.removeItem(chave); else localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento: segue sem salvar */ }
  }
  function embaralhar(lista) {
    var a = lista.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function formatarTempo(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return (h ? h + "h " : "") + String(m).padStart(h ? 2 : 1, "0") + "min " + String(ss).padStart(2, "0") + "s";
  }
  function dataCurta(ts) {
    return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) +
      " às " + new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  function nomeEdicao(ed) {
    return VESTIBULARES[ed.vestibular].nome + " " + ed.ano + (ed.fase === 2 ? " · 2ª fase" : "") + (ed.caderno ? " · " + ed.caderno : "");
  }
  function plural(n, um, varios) { return n + " " + (n === 1 ? um : varios); }

  // ---------- dados ----------
  function carregarJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("Não foi possível abrir " + url + " (" + r.status + ")");
      return r.json();
    });
  }
  function carregarEdicoes(lista) {
    return Promise.all(lista.map(function (ed) {
      if (estado.cache[ed.id]) return estado.cache[ed.id];
      return carregarJSON(ed.arquivo).then(function (d) {
        // questões ocultas por moderação ou pendentes de revisão de direitos (ver dados/provas/moderacao.json)
        if (ed.ocultas && ed.ocultas.length) d.questoes = d.questoes.filter(function (q) { return ed.ocultas.indexOf(q.numero) < 0; });
        estado.cache[ed.id] = d;
        return d;
      });
    }));
  }
  function edicoesFiltradas(filtro) {
    return estado.indice.edicoes.filter(function (ed) {
      return (!filtro.tipo || ed.tipo === filtro.tipo) &&
        (!filtro.vestibulares || filtro.vestibulares.indexOf(ed.vestibular) >= 0) &&
        (!filtro.id || ed.id === filtro.id);
    });
  }
  function buscarQuestao(ref) {
    var d = estado.cache[ref.ed];
    if (!d) return null;
    for (var i = 0; i < d.questoes.length; i++) if (d.questoes[i].numero === ref.n) return { q: d.questoes[i], dados: d };
    return null;
  }
  function figuraDe(edId) {
    // a prévia publicada traz as figuras dentro do JSON da prova (limite de arquivos)
    var embutidas = (estado.cache[edId] || {}).figuras;
    return function (id) { return (embutidas && embutidas[id]) || "img/questoes/" + edId + "/" + id + ".webp"; };
  }
  function render(texto, edId) {
    try {
      return Render.renderizar(texto, { figura: figuraDe(edId) });
    } catch (e) {
      return '<p class="erro-carga">Não foi possível exibir este trecho. Avise o suporte informando a questão.</p>';
    }
  }
  function valida(q) {
    if (q.anulada) return false;
    if (q.gabarito) return true;
    return !!q.itens; // discursiva
  }

  // ---------- montagem das sessões ----------
  // Regra de conformidade: num simulado, no máximo uma fração (padrão 30%) das questões pode vir
  // de uma mesma prova original. Vem de dados/provas/formatos.json (_regras.limite_mesma_prova).
  function tetoMesmaProva(n) {
    var f = estado.indice && estado.indice.regras && estado.indice.regras.limite_mesma_prova;
    return f ? Math.max(1, Math.floor(f * n)) : Infinity;
  }
  function pegar(grupo, cota, contagem, teto) {
    var saida = [];
    embaralhar(grupo).forEach(function (r) {
      if (saida.length >= cota || (contagem[r.ed] || 0) >= teto) return;
      contagem[r.ed] = (contagem[r.ed] || 0) + 1;
      saida.push(r);
    });
    return saida;
  }
  // completa até n: primeiro respeitando o teto; se faltar prova de outras edições, relaxa o teto
  function completar(escolhidas, pool, n, contagem, teto) {
    var usadas = {};
    escolhidas.forEach(function (r) { usadas[r.ed + r.n] = true; });
    var resto = embaralhar(pool.filter(function (r) { return !usadas[r.ed + r.n]; }));
    for (var i = 0; i < resto.length && escolhidas.length < n; i++) {
      if ((contagem[resto[i].ed] || 0) >= teto) continue;
      contagem[resto[i].ed] = (contagem[resto[i].ed] || 0) + 1;
      escolhidas.push(resto[i]); resto[i] = null;
    }
    resto.forEach(function (r) { if (r && escolhidas.length < n) escolhidas.push(r); });
    return escolhidas;
  }
  // Sorteia n questões mantendo a proporção de matérias do conjunto.
  function sortearProporcional(pool, n) {
    var porMateria = {};
    pool.forEach(function (r) { (porMateria[r.materia] = porMateria[r.materia] || []).push(r); });
    var total = pool.length;
    var cotas = Object.keys(porMateria).map(function (m) {
      var exata = (porMateria[m].length / total) * n;
      return { m: m, base: Math.floor(exata), resto: exata - Math.floor(exata) };
    });
    var soma = cotas.reduce(function (s, c) { return s + c.base; }, 0);
    cotas.sort(function (a, b) { return b.resto - a.resto; });
    for (var i = 0; soma < n && i < cotas.length; i++, soma++) cotas[i].base++;
    var escolhidas = [], contagem = {}, teto = tetoMesmaProva(n);
    cotas.forEach(function (c) { escolhidas = escolhidas.concat(pegar(porMateria[c.m], c.base, contagem, teto)); });
    escolhidas = completar(escolhidas, pool, n, contagem, teto);
    escolhidas.sort(function (a, b) {
      return ORDEM_MATERIAS.indexOf(a.materia) - ORDEM_MATERIAS.indexOf(b.materia);
    });
    return escolhidas;
  }
  // Sorteia respeitando a distribuição oficial do edital ({"portugues+literatura": 12, ...}).
  function sortearComCotas(pool, distribuicao, n) {
    var total = Object.keys(distribuicao).reduce(function (s, k) { return s + distribuicao[k]; }, 0);
    var escolhidas = [], contagem = {}, teto = tetoMesmaProva(n);
    Object.keys(distribuicao).forEach(function (chave) {
      var materias = chave.split("+");
      var cota = Math.round((distribuicao[chave] / total) * n);
      var grupo = pool.filter(function (r) { return materias.indexOf(r.materia) >= 0; });
      escolhidas = escolhidas.concat(pegar(grupo, cota, contagem, teto));
    });
    // completa (ou corta) até n com as demais questões, se o arredondamento não fechar
    escolhidas = completar(escolhidas, pool, n, contagem, teto).slice(0, n);
    escolhidas.sort(function (a, b) { return ORDEM_MATERIAS.indexOf(a.materia) - ORDEM_MATERIAS.indexOf(b.materia); });
    return escolhidas;
  }
  function referencias(dadosLista, filtroQ) {
    var refs = [];
    dadosLista.forEach(function (d) {
      d.questoes.forEach(function (q) {
        if (valida(q) && (!filtroQ || filtroQ(q, d))) refs.push({ ed: d.edicao.id, n: q.numero, materia: q.materia, v: d.edicao.vestibular });
      });
    });
    return refs;
  }
  function iniciarSessao(cfg) {
    var eds = cfg.refs
      ? edicoesFiltradas({}).filter(function (e) { return cfg.refs.some(function (r) { return r.ed === e.id; }); })
      : edicoesFiltradas(cfg.filtro);
    if (!eds.length) return Promise.reject(new Error("Nenhuma prova disponível com esses filtros."));
    app.innerHTML = '<p class="aviso-carregando">Separando as questões…</p>';
    return carregarEdicoes(eds).then(function (dados) {
      var refs;
      if (cfg.modo === "prova") {
        refs = dados[0].questoes.map(function (q) { return { ed: dados[0].edicao.id, n: q.numero, materia: q.materia, v: dados[0].edicao.vestibular }; });
      } else if (cfg.modo === "simulado") {
        var dist = cfg.distribuicao;
        refs = dist ? sortearComCotas(referencias(dados), dist, cfg.quantidade) : sortearProporcional(referencias(dados), cfg.quantidade);
      } else if (cfg.modo === "erros") {
        refs = cfg.refs.filter(function (r) { return buscarQuestao(r); }); // some se foi ocultada depois
      } else {
        refs = embaralhar(referencias(dados, function (q, d) {
          var naMateria = !cfg.materias.length || cfg.materias.indexOf(q.materia) >= 0 ||
            (q.materias_extra || []).some(function (m) { return cfg.materias.indexOf(m) >= 0; });
          return naMateria && d.edicao.ano >= cfg.anoMin && (!cfg.assunto || q.assunto === cfg.assunto);
        })).slice(0, cfg.quantidade);
      }
      if (!refs.length) throw new Error("Não há questões com esses filtros. Tente outras matérias ou mais anos.");
      estado.sessao = {
        modo: cfg.modo, titulo: cfg.titulo, tipo: cfg.filtro.tipo, refs: refs,
        respostas: {}, escritas: {}, autoav: {}, atual: 0, inicio: Date.now(), fim: null,
        edicoes: eds.map(function (e) { return e.id; }), horas: cfg.horas || null,
        limite: cfg.limite || null,
      };
      salvarSessao();
      irPara("prova");
    });
  }
  function salvarSessao() { gravar(CHAVE_SESSAO, estado.sessao); }
  function idRef(r) { return r.ed + "-q" + r.n; }

  // ---------- resultado ----------
  function situacao(sessao, r) {
    var achado = buscarQuestao(r);
    if (!achado) return "branco";
    var q = achado.q;
    if (q.anulada) return "anulada";
    if (q.itens) {
      var a = sessao.autoav[idRef(r)];
      return a === "certo" ? "certa" : a === "errado" ? "errada" : a === "parcial" ? "parcial" : "branco";
    }
    var m = sessao.respostas[idRef(r)];
    if (!m) return "branco";
    return m === q.gabarito ? "certa" : "errada";
  }
  function resumo(sessao) {
    var r = { certas: 0, erradas: 0, branco: 0, parciais: 0, anuladas: 0, materias: {} };
    sessao.refs.forEach(function (ref) {
      var s = situacao(sessao, ref);
      var m = r.materias[ref.materia] = r.materias[ref.materia] || { certas: 0, total: 0 };
      if (s === "anulada") { r.anuladas++; return; }
      m.total++;
      if (s === "certa") { r.certas++; m.certas++; }
      else if (s === "errada") r.erradas++;
      else if (s === "parcial") { r.parciais++; m.certas += 0.5; }
      else r.branco++;
    });
    r.consideradas = sessao.refs.length - r.anuladas;
    r.nota = r.consideradas ? (r.certas + r.parciais * 0.5) / r.consideradas : 0;
    return r;
  }
  function finalizar() {
    var s = estado.sessao;
    s.fim = Date.now();
    s.atual = 0;
    salvarSessao();
    if (s.tipo !== "discursiva") registrarHistorico(s);
    estado.confirmando = false;
    irPara("resultado");
  }
  function registrarHistorico(s) {
    var r = resumo(s);
    var hist = ler(CHAVE_HIST, []);
    // resultado de cada questão: alimenta o mapa de assuntos, os pontos fracos e o "refazer erros"
    var questoes = [];
    s.refs.forEach(function (ref) {
      var st = situacao(s, ref);
      if (st === "anulada") return;
      var achado = buscarQuestao(ref);
      questoes.push({
        id: idRef(ref), ed: ref.ed, n: ref.n, v: ref.v || (achado && achado.dados.edicao.vestibular),
        m: ref.materia, a: achado && achado.q.assunto || null, ok: st === "certa",
      });
    });
    hist.unshift({
      titulo: s.titulo, quando: s.fim, duracao: s.fim - s.inicio, certas: r.certas, modo: s.modo,
      parciais: r.parciais, total: r.consideradas, tipo: s.tipo, materias: r.materias, questoes: questoes,
    });
    gravar(CHAVE_HIST, hist.slice(0, 100));
  }

  // ---------- navegação ----------
  function irPara(tela) {
    estado.tela = tela;
    estado.revendo = null;
    document.getElementById("nav-inicio").setAttribute("aria-current", tela === "historico" ? "false" : "page");
    document.getElementById("nav-historico").setAttribute("aria-current", tela === "historico" ? "page" : "false");
    desenhar();
    window.scrollTo(0, 0);
  }
  function desenhar() {
    clearInterval(relogioTimer);
    app.innerHTML = "";
    if (!estado.indice) return;
    if (estado.tela === "prova" && estado.sessao) telaProva();
    else if (estado.tela === "resultado" && estado.sessao) telaResultado();
    else if (estado.tela === "historico") telaHistorico();
    else if (estado.tela === "pagina") telaPagina();
    else telaInicio();
  }

  // ---------- tela inicial ----------
  function chips(nome, opcoes, marcadas, tipo) {
    return el("div", { class: "chips" }, opcoes.map(function (o) {
      return el("label", { class: "chip" }, [
        el("input", { type: tipo || "checkbox", name: nome, value: o.valor, checked: marcadas.indexOf(o.valor) >= 0 }),
        el("span", { text: o.rotulo }),
      ]);
    }));
  }
  function marcados(form, nome) {
    return Array.prototype.slice.call(form.querySelectorAll('input[name="' + nome + '"]:checked')).map(function (i) { return i.value; });
  }
  function opcoesVestibulares(tipo) {
    return Object.keys(VESTIBULARES).filter(function (v) {
      return estado.indice.edicoes.some(function (e) { return e.vestibular === v && e.tipo === tipo; });
    }).map(function (v) { return { valor: v, rotulo: VESTIBULARES[v].nome }; });
  }
  function materiasDisponiveis(tipo) {
    var tem = {};
    estado.indice.edicoes.forEach(function (e) {
      if (e.tipo === tipo) Object.keys(e.materias).forEach(function (m) { tem[m] = true; });
    });
    return ORDEM_MATERIAS.filter(function (m) { return tem[m]; }).map(function (m) { return { valor: m, rotulo: MATERIAS[m] }; });
  }
  function anosDisponiveis(tipo) {
    var anos = {};
    estado.indice.edicoes.forEach(function (e) { if (e.tipo === tipo) anos[e.ano] = true; });
    return Object.keys(anos).map(Number).sort();
  }
  function mostrarErro(form, msg) {
    var p = form.querySelector(".erro-form");
    if (!p) { p = el("p", { class: "erro-carga erro-form", role: "alert" }); form.appendChild(p); }
    p.textContent = msg;
  }

  function telaInicio() {
    var eds = estado.indice.edicoes;
    var objetivas = eds.filter(function (e) { return e.tipo === "objetiva"; });
    var discursivas = eds.filter(function (e) { return e.tipo === "discursiva"; });
    var totalObj = objetivas.reduce(function (s, e) { return s + e.validas; }, 0);
    var totalDisc = discursivas.reduce(function (s, e) { return s + e.validas; }, 0);
    var anos = anosDisponiveis("objetiva");

    var gabaritoDemo = ["C", "A", "E", "B", "D", "B", "A", "C", "E", "D"];
    var cartaoDemo = el("div", { class: "cartao-demo", "aria-hidden": "true" }, [
      el("div", { class: "cd-cab" }, [el("span", { text: "Cartão-resposta" }), el("span", { class: "cd-cod", text: "1ª fase" })]),
      el("ol", {}, gabaritoDemo.map(function (letra, i) {
        return el("li", { style: "--i:" + i }, [el("span", { class: "cd-n", text: String(i + 1).padStart(2, "0") })].concat(["A", "B", "C", "D", "E"].map(function (l) {
          return el("span", { class: "cd-b" + (l === letra ? " cheia" : ""), text: l });
        })));
      })),
      el("div", { class: "cd-marcas" }, Array.apply(null, Array(10)).map(function () { return el("i"); })),
    ]);
    app.appendChild(el("section", { class: "abertura" }, [
      el("div", { class: "abertura-texto" }, [
        el("h1", { text: "Treine com questões reais da FUVEST, Unicamp e UNESP." }),
        el("p", { text: "Ferramenta de estudo: faça simulados com questões sorteadas entre as provas dos últimos anos ou treine uma matéria. As respostas aparecem só quando você termina, junto com o gabarito oficial." }),
        el("ul", { class: "cifras" }, [
          el("li", {}, [el("strong", { text: totalObj.toLocaleString("pt-BR") }), "questões objetivas"]),
          totalDisc ? el("li", {}, [el("strong", { text: totalDisc.toLocaleString("pt-BR") }), "discursivas"]) : null,
          anos.length ? el("li", {}, [el("strong", { text: anos[0] + "–" + String(anos[anos.length - 1]).slice(2) }), "edições"]) : null,
          el("li", {}, [el("strong", { text: objetivas.length }), "provas completas"]),
        ]),
      ]),
      cartaoDemo,
    ]));

    var aberta = ler(CHAVE_SESSAO, null);
    if (aberta && !aberta.fim) {
      var feitas = Object.keys(aberta.respostas).length + Object.keys(aberta.escritas || {}).length;
      app.appendChild(el("div", { class: "continuar" }, [
        el("p", {}, [el("strong", { text: aberta.titulo }), " em andamento: " + plural(feitas, "resposta", "respostas") + " de " + aberta.refs.length + " questões."]),
        el("button", { class: "botao", type: "button", text: "Continuar", onclick: function () {
          estado.sessao = aberta;
          carregarEdicoes(edicoesFiltradas({}).filter(function (e) { return aberta.edicoes.indexOf(e.id) >= 0; }))
            .then(function () { irPara("prova"); }).catch(erroGeral);
        } }),
        el("button", { class: "botao discreto", type: "button", text: "Descartar", onclick: function () { gravar(CHAVE_SESSAO, null); desenhar(); } }),
      ]));
    }

    var modos = el("div", { class: "modos" });
    modos.appendChild(cartaoSimulado());
    modos.appendChild(cartaoMateria());
    if (discursivas.length) modos.appendChild(cartaoDiscursivas());
    app.appendChild(modos);
  }

  function cartaoSimulado() {
    var vests = opcoesVestibulares("objetiva");
    var form = el("form", { class: "modo", id: "form-simulado" });
    var selAno = el("select", { id: "sim-ano" });
    function atualizarAnos() {
      var v = marcados(form, "sim-vest")[0];
      selAno.innerHTML = "";
      selAno.appendChild(el("option", { value: "", text: "Sorteadas entre todos os anos" }));
      estado.indice.edicoes.filter(function (e) { return e.vestibular === v && e.tipo === "objetiva"; })
        .sort(function (a, b) { return b.ano - a.ano; })
        .forEach(function (e) {
          var fora = e.indisponiveis ? "; " + plural(e.indisponiveis.length, "fora por direito autoral", "fora por direito autoral") : "";
          selAno.appendChild(el("option", { value: e.id, text: "Prova completa de " + e.ano + " (" + e.total + " questões" + fora + ")" }));
        });
      selQtd.disabled = !!selAno.value;
    }
    var selQtd = el("select", { id: "sim-qtd" });
    var infoFormato = el("p", { class: "formato" });
    function atualizarFormato() {
      var v = marcados(form, "sim-vest")[0];
      var info = VESTIBULARES[v];
      var f = info.formato;
      var atual = selQtd.value;
      selQtd.innerHTML = "";
      [["cheio", "Tamanho do edital (" + info.tamanho + " questões, " + info.horas + " h)"], ["45", "45 questões"], ["30", "30 questões"], ["15", "15 questões"]].forEach(function (o) {
        selQtd.appendChild(el("option", { value: o[0], text: o[1], selected: o[0] === atual }));
      });
      infoFormato.innerHTML = "";
      if (f) {
        infoFormato.appendChild(el("strong", { text: info.nome + " " + f.edicao + ": " }));
        infoFormato.appendChild(document.createTextNode(f.resumo + (f.datas ? " " + f.datas + "." : "")));
      }
    }
    selAno.addEventListener("change", function () { selQtd.disabled = !!selAno.value; });
    form.appendChild(el("h2", { text: "Simulado da prova" }));
    form.appendChild(el("p", { text: "Monte uma prova com questões sorteadas entre as edições, na proporção de matérias do vestibular, ou refaça uma prova completa." }));
    var grupo = el("fieldset", {}, [el("legend", { text: "Vestibular" }), chips("sim-vest", vests, [vests[0] && vests[0].valor], "radio")]);
    grupo.addEventListener("change", atualizarAnos);
    form.appendChild(grupo);
    form.appendChild(el("label", { class: "campo", for: "sim-ano" }, [el("span", { text: "Questões" }), selAno]));
    form.appendChild(el("label", { class: "campo", for: "sim-qtd" }, [el("span", { text: "Tamanho" }), selQtd]));
    form.appendChild(el("label", { class: "marcar", for: "sim-tempo" }, [
      el("input", { type: "checkbox", id: "sim-tempo", checked: true }),
      el("span", { text: "Cronometrar com o tempo oficial (proporcional ao tamanho). Quando o tempo acaba, a prova é entregue." }),
    ]));
    form.appendChild(infoFormato);
    form.appendChild(el("button", { class: "botao", type: "submit", text: "Começar simulado" }));
    atualizarFormato();
    grupo.addEventListener("change", atualizarFormato);
    atualizarAnos();
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = marcados(form, "sim-vest")[0];
      var info = VESTIBULARES[v];
      var cronometrar = document.getElementById("sim-tempo").checked;
      if (selAno.value) {
        var ed = estado.indice.edicoes.filter(function (e) { return e.id === selAno.value; })[0];
        iniciarSessao({ modo: "prova", titulo: "Prova " + nomeEdicao(ed), filtro: { id: ed.id, tipo: "objetiva" }, horas: info.horas,
          limite: cronometrar ? info.horas * 3600000 : null })
          .catch(function (e) { desenhar(); mostrarErro(document.getElementById("form-simulado"), e.message); });
        return;
      }
      var qtd = selQtd.value === "cheio" ? info.tamanho : Number(selQtd.value);
      iniciarSessao({
        modo: "simulado", titulo: "Simulado " + info.nome + " · " + qtd + " questões", quantidade: qtd,
        filtro: { vestibulares: [v], tipo: "objetiva" }, horas: qtd === info.tamanho ? info.horas : null,
        distribuicao: info.formato && info.formato.distribuicao,
        limite: cronometrar ? Math.round((info.horas * 3600000 * qtd) / info.tamanho) : null,
      }).catch(function (e) { desenhar(); mostrarErro(document.getElementById("form-simulado"), e.message); });
    });
    return form;
  }

  function cartaoMateria() {
    var form = el("form", { class: "modo", id: "form-materia" });
    var anos = anosDisponiveis("objetiva");
    var selQtd = el("select", { id: "mat-qtd" });
    [10, 20, 30, 45].forEach(function (n) { selQtd.appendChild(el("option", { value: n, text: n + " questões", selected: n === 20 })); });
    var selAno = el("select", { id: "mat-ano" });
    anos.forEach(function (a) { selAno.appendChild(el("option", { value: a, text: a === anos[0] ? "Todas as edições (" + a + " em diante)" : "De " + a + " em diante" })); });
    form.appendChild(el("h2", { text: "Treino por matéria" }));
    form.appendChild(el("p", { text: "Escolha a matéria e quantas questões quer fazer. O gabarito sai no fim." }));
    form.appendChild(el("fieldset", {}, [el("legend", { text: "Matérias" }), chips("mat-materia", materiasDisponiveis("objetiva"), ["matematica"])]));
    form.appendChild(el("fieldset", {}, [el("legend", { text: "Vestibulares" }), chips("mat-vest", opcoesVestibulares("objetiva"), Object.keys(VESTIBULARES))]));
    form.appendChild(el("label", { class: "campo", for: "mat-qtd" }, [el("span", { text: "Quantidade" }), selQtd]));
    form.appendChild(el("label", { class: "campo", for: "mat-ano" }, [el("span", { text: "Edições" }), selAno]));
    form.appendChild(el("label", { class: "marcar", for: "mat-tempo" }, [
      el("input", { type: "checkbox", id: "mat-tempo" }),
      el("span", { text: "Cronometrar no ritmo da prova (3 min 20 s por questão)" }),
    ]));
    form.appendChild(el("button", { class: "botao", type: "submit", text: "Começar treino" }));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var materias = marcados(form, "mat-materia");
      var vests = marcados(form, "mat-vest");
      if (!materias.length) return mostrarErro(form, "Escolha pelo menos uma matéria.");
      if (!vests.length) return mostrarErro(form, "Escolha pelo menos um vestibular.");
      var nomes = materias.map(function (m) { return MATERIAS[m]; });
      iniciarSessao({
        modo: "materia", quantidade: Number(selQtd.value), materias: materias, anoMin: Number(selAno.value),
        limite: document.getElementById("mat-tempo").checked ? Number(selQtd.value) * SEGUNDOS_POR_QUESTAO * 1000 : null,
        titulo: "Treino de " + (nomes.length > 2 ? nomes.length + " matérias" : nomes.join(" e ")),
        filtro: { vestibulares: vests, tipo: "objetiva" },
      }).catch(function (e) { desenhar(); mostrarErro(document.getElementById("form-materia"), e.message); });
    });
    return form;
  }

  function cartaoDiscursivas() {
    var form = el("form", { class: "modo", id: "form-disc" });
    var anos = anosDisponiveis("discursiva");
    var selQtd = el("select", { id: "disc-qtd" });
    [3, 5, 10].forEach(function (n) { selQtd.appendChild(el("option", { value: n, text: n + " questões", selected: n === 5 })); });
    form.appendChild(el("h2", { text: "Questões discursivas" }));
    form.appendChild(el("p", { text: "Questões da 2ª fase. Escreva sua resposta e, no fim, compare com a resposta esperada pela banca." }));
    form.appendChild(el("fieldset", {}, [el("legend", { text: "Matérias" }), chips("disc-materia", materiasDisponiveis("discursiva"), [])]));
    form.appendChild(el("fieldset", {}, [el("legend", { text: "Vestibulares" }), chips("disc-vest", opcoesVestibulares("discursiva"), Object.keys(VESTIBULARES))]));
    form.appendChild(el("label", { class: "campo", for: "disc-qtd" }, [el("span", { text: "Quantidade" }), selQtd]));
    form.appendChild(el("p", { class: "dica", text: "Sem matéria marcada, valem todas." }));
    form.appendChild(el("p", { class: "dica", text: "Só entram questões com resposta esperada publicada pela banca. FUVEST: de 2023 a 2026 (nos anos anteriores a banca não divulgou as respostas). UNESP: ainda sem questões discursivas, porque não encontramos resposta oficial publicada pela banca." }));
    form.appendChild(el("button", { class: "botao", type: "submit", text: "Começar discursivas" }));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var vests = marcados(form, "disc-vest");
      if (!vests.length) return mostrarErro(form, "Escolha pelo menos um vestibular.");
      iniciarSessao({
        modo: "materia", quantidade: Number(selQtd.value), materias: marcados(form, "disc-materia"), anoMin: anos[0] || 0,
        titulo: "Discursivas · " + selQtd.value + " questões", filtro: { vestibulares: vests, tipo: "discursiva" },
      }).catch(function (e) { desenhar(); mostrarErro(document.getElementById("form-disc"), e.message); });
    });
    return form;
  }

  // ---------- tela da prova (e da revisão) ----------
  // Citação da fonte, sempre junto da questão, e a autoria de conteúdos de terceiros já conferidos.
  function fonteDaQuestao(ed, q) {
    var filhos = [
      "Fonte: ", ed.citacao || nomeEdicao(ed), ", questão " + (q.codigo || q.numero) + ". ",
      el("a", { href: ed.link_oficial, target: "_blank", rel: "noopener noreferrer", text: "Site oficial da banca" }),
    ];
    var caixa = el("p", { class: "fonte" }, filhos);
    if (q.terceiros && q.terceiros.length) {
      caixa.appendChild(el("span", { class: "terceiros", text: " · Conteúdo de terceiros: " + q.terceiros.map(function (t) {
        return [t.tipo, t.autor, t.obra].filter(Boolean).join(", ");
      }).join("; ") + "." }));
    }
    return caixa;
  }
  function blocoQuestao(ref, idx, total, revisao) {
    var achado = buscarQuestao(ref);
    var s = estado.sessao;
    var caixa = el("article", { class: "questao", "aria-labelledby": "q-titulo" });
    if (!achado) {
      caixa.appendChild(el("p", { class: "erro-carga", text: "Questão não encontrada. Volte ao início e comece de novo." }));
      return caixa;
    }
    var q = achado.q, d = achado.dados, ed = d.edicao;
    var materias = [q.materia].concat(q.materias_extra || []).map(function (m) { return MATERIAS[m] || m; }).join(" · ");
    caixa.appendChild(el("div", { class: "q-meta" }, [
      el("span", { class: "q-num", id: "q-titulo", text: String(idx + 1).padStart(2, "0") }),
      el("span", { text: "de " + total }),
      el("span", { class: "selo", text: materias }),
      el("span", { text: nomeEdicao(ed) + ", questão " + (q.codigo || q.numero) }),
      q.anulada ? el("span", { class: "selo anulada", text: "Anulada pela banca" }) : null,
    ]));
    if (q.texto_base && d.textos_base[q.texto_base]) {
      var faixa = q.texto_base.replace(/^t/, "").split("-");
      var rot = faixa.length === 2 && faixa[0] !== faixa[1] ? "Texto para as questões " + faixa[0] + " a " + faixa[1] + " da prova original" : "Texto de apoio";
      caixa.appendChild(el("details", { class: "texto-base", open: true }, [
        el("summary", { text: rot }),
        el("div", { class: "texto", html: render(d.textos_base[q.texto_base], ed.id) }),
      ]));
    }
    caixa.appendChild(el("div", { class: "texto enunciado", html: render(q.enunciado, ed.id) }));
    caixa.appendChild(fonteDaQuestao(ed, q));
    var usaQuimica = q.materia === "quimica" || (q.materias_extra || []).indexOf("quimica") >= 0;
    if (ed.tabela_periodica && usaQuimica) {
      caixa.appendChild(el("details", { class: "tabela-periodica" }, [
        el("summary", { text: "Tabela periódica desta prova" }),
        el("img", { src: ed.tabela_periodica, alt: "Classificação periódica impressa no caderno da prova", loading: "lazy" }),
      ]));
    }
    var chave = idRef(ref);

    if (q.itens) {
      var lista = el("div", { class: "itens" });
      var itens = q.itens.length ? q.itens : [{ rotulo: "", texto: "" }];
      itens.forEach(function (it) {
        var chaveItem = chave + ":" + it.rotulo;
        var bloco = el("section", { class: "item" }, [
          it.rotulo ? el("h3", { text: it.rotulo + ")" }) : null,
          it.texto ? el("div", { class: "texto", html: render(it.texto, ed.id) }) : null,
        ]);
        if (!revisao) {
          var ta = el("textarea", { id: "resp-" + chaveItem.replace(/[^\w-]/g, "_"), "aria-label": "Sua resposta" + (it.rotulo ? " do item " + it.rotulo : ""), placeholder: "Escreva sua resposta (opcional)" });
          ta.value = (s.escritas || {})[chaveItem] || "";
          ta.addEventListener("input", function () { s.escritas[chaveItem] = ta.value; salvarSessao(); });
          bloco.appendChild(ta);
        } else {
          var escrita = (s.escritas || {})[chaveItem];
          if (escrita) bloco.appendChild(el("div", { class: "sua" }, [el("h4", { text: "Sua resposta" }), el("p", { text: escrita })]));
          var oficial = it.resposta_oficial || (itens.length === 1 ? q.resposta_oficial : null);
          bloco.appendChild(oficial
            ? el("div", { class: "oficial" }, [el("h4", { text: "Resposta esperada pela banca" }), el("div", { class: "texto", html: render(oficial, ed.id) })])
            : el("div", { class: "oficial ausente" }, [el("h4", { text: "Resposta oficial indisponível" }), el("p", { text: "A banca não divulgou a resposta esperada para esta questão, ou ela ainda não foi incluída aqui." })]));
        }
        lista.appendChild(bloco);
      });
      if (q.itens.length && q.resposta_oficial && revisao) {
        lista.appendChild(el("div", { class: "oficial" }, [el("h4", { text: "Comentário da banca" }), el("div", { class: "texto", html: render(q.resposta_oficial, ed.id) })]));
      }
      caixa.appendChild(lista);
      if (revisao) {
        var atual = s.autoav[chave];
        var botoes = el("div", { class: "autoav", role: "group", "aria-label": "Como foi sua resposta?" }, [el("span", { class: "dica", text: "Como foi sua resposta?" })]);
        [["certo", "Acertei"], ["parcial", "Acertei em parte"], ["errado", "Errei"]].forEach(function (o) {
          botoes.appendChild(el("button", {
            type: "button", class: "botao " + (atual === o[0] ? "" : "discreto"), "aria-pressed": atual === o[0] ? "true" : "false", text: o[1],
            onclick: function () { s.autoav[chave] = o[0]; salvarSessao(); desenhar(); },
          }));
        });
        caixa.appendChild(botoes);
      }
      return caixa;
    }

    var marcada = s.respostas[chave];
    var ol = el("ol", { class: "alternativas", "aria-label": "Alternativas" });
    Object.keys(q.alternativas).sort().forEach(function (letra) {
      var classe = "alt";
      var nota = null;
      if (revisao) {
        if (letra === q.gabarito) { classe += " correta"; nota = marcada === letra ? "Sua resposta · correta" : "Resposta correta"; }
        else if (letra === marcada) { classe += " marcada-errada"; nota = "Sua resposta"; }
      }
      var botao = el("button", {
        type: "button", class: classe, "aria-pressed": !revisao && marcada === letra ? "true" : "false", disabled: revisao,
        onclick: function () {
          if (s.respostas[chave] === letra) delete s.respostas[chave]; else s.respostas[chave] = letra;
          salvarSessao(); desenhar();
        },
      }, [
        el("span", { class: "bolha", "aria-hidden": "true", text: letra }),
        el("span", {}, [
          el("span", { class: "texto", html: render(q.alternativas[letra], ed.id) }),
          nota ? el("div", { class: "alt-nota", text: nota }) : null,
        ]),
      ]);
      botao.setAttribute("aria-label", "Alternativa " + letra);
      ol.appendChild(el("li", {}, [botao]));
    });
    caixa.appendChild(ol);
    if (revisao && q.anulada) caixa.appendChild(el("p", { class: "dica", text: "Esta questão foi anulada pela banca e não conta no resultado." }));
    if (revisao && q.resolucao) {
      caixa.appendChild(el("details", { class: "resolucao", open: marcada !== q.gabarito }, [
        el("summary", { text: "Resolução comentada" + (q.assunto ? " · " + q.assunto : "") }),
        el("div", { class: "texto", html: render(q.resolucao, ed.id) }),
        el("p", { class: "dica", text: "Resolução escrita pela equipe da Banca Aberta. O gabarito é o oficial da banca." }),
      ]));
    }
    if (revisao && !q.anulada && !marcada) caixa.appendChild(el("p", { class: "dica", text: "Você deixou esta questão em branco." }));
    return caixa;
  }

  function cartaoResposta(revisao) {
    var s = estado.sessao;
    var grade = el("div", { class: "grade" });
    var respondidas = 0;
    s.refs.forEach(function (r, i) {
      var chave = idRef(r);
      var marca = s.respostas[chave] || "";
      var discursivaFeita = Object.keys(s.escritas || {}).some(function (k) { return k.indexOf(chave + ":") === 0 && s.escritas[k].trim(); });
      if (marca || discursivaFeita) respondidas++;
      var classe = [];
      var atualIdx = revisao ? estado.revendo : s.atual;
      if (i === atualIdx) classe.push("atual");
      if (revisao) {
        var st = situacao(s, r);
        if (st === "certa") classe.push("certa");
        else if (st === "errada") classe.push("errada");
      } else if (marca || discursivaFeita) classe.push("respondida");
      grade.appendChild(el("button", {
        type: "button", class: classe.join(" "), "aria-label": "Questão " + (i + 1) + (marca ? ", marcada " + marca : ""),
        onclick: function () {
          if (revisao) estado.revendo = i; else { s.atual = i; salvarSessao(); }
          desenhar();
        },
      }, [String(i + 1), el("small", { text: marca || (discursivaFeita ? "✓" : "") })]));
    });
    var caixa = el("aside", { class: "cartao", "aria-label": "Cartão-resposta" }, [
      el("h2", { text: revisao ? "Correção" : "Cartão-resposta" }),
      grade,
      el("p", { class: "contagem", text: revisao ? "Toque num número para rever a questão." : respondidas + " de " + s.refs.length + " respondidas" }),
    ]);
    if (!revisao) caixa.appendChild(el("button", { class: "botao", type: "button", text: "Terminar e ver respostas", onclick: function () { estado.confirmando = true; desenhar(); } }));
    else caixa.appendChild(el("button", { class: "botao secundario", type: "button", text: "Voltar ao resultado", onclick: function () { estado.revendo = null; desenhar(); window.scrollTo(0, 0); } }));
    return caixa;
  }

  function telaProva() {
    var s = estado.sessao;
    if (s.fim) return irPara("resultado");
    var total = s.refs.length;
    var relogio = el("span", { class: "relogio num", "aria-live": "off" });
    function tic() {
      var passado = Date.now() - s.inicio;
      if (s.limite) {
        var resta = s.limite - passado;
        if (resta <= 0) { s.tempoEsgotado = true; clearInterval(relogioTimer); finalizar(); return; }
        relogio.textContent = "Faltam " + formatarTempo(resta);
        relogio.classList.toggle("acabando", resta < Math.min(600000, s.limite * 0.1));
      } else {
        relogio.textContent = formatarTempo(passado) + (s.horas ? " de " + s.horas + "h" : "");
      }
    }
    tic();
    relogioTimer = setInterval(tic, 1000);
    app.appendChild(el("div", { class: "prova-cab" }, [el("h1", { text: s.titulo }), relogio]));
    var coluna = el("div", {});
    coluna.appendChild(blocoQuestao(s.refs[s.atual], s.atual, total, false));
    if (estado.confirmando) {
      var faltam = s.refs.filter(function (r) {
        var c = idRef(r);
        if (s.respostas[c]) return false;
        return !Object.keys(s.escritas || {}).some(function (k) { return k.indexOf(c + ":") === 0 && s.escritas[k].trim(); });
      }).length;
      coluna.appendChild(el("div", { class: "confirma", role: "alertdialog", "aria-labelledby": "conf-txt" }, [
        el("p", { id: "conf-txt" }, [
          el("strong", { text: "Terminar agora?" }), " ",
          faltam ? plural(faltam, "questão está", "questões estão") + " sem resposta e vão contar como erro. " : "Você respondeu todas as questões. ",
          "Depois de terminar, as respostas não podem mais ser mudadas.",
        ]),
        el("div", { class: "acoes" }, [
          el("button", { class: "botao", type: "button", text: "Terminar e ver respostas", onclick: finalizar }),
          el("button", { class: "botao discreto", type: "button", text: "Continuar respondendo", onclick: function () { estado.confirmando = false; desenhar(); } }),
        ]),
      ]));
    }
    coluna.appendChild(el("div", { class: "nav-q" }, [
      el("button", { class: "botao discreto", type: "button", text: "← Anterior", disabled: s.atual === 0, onclick: function () { s.atual--; salvarSessao(); desenhar(); window.scrollTo(0, 0); } }),
      el("span", { class: "espaco" }),
      s.atual < total - 1
        ? el("button", { class: "botao", type: "button", text: "Próxima →", onclick: function () { s.atual++; salvarSessao(); desenhar(); window.scrollTo(0, 0); } })
        : el("button", { class: "botao", type: "button", text: "Terminar", onclick: function () { estado.confirmando = true; desenhar(); } }),
    ]));
    app.appendChild(el("div", { class: "prova" }, [coluna, cartaoResposta(false)]));
  }

  // ---------- tela de resultado ----------
  function telaResultado() {
    var s = estado.sessao;
    if (estado.revendo !== null) {
      app.appendChild(el("div", { class: "prova-cab" }, [el("h1", { text: "Correção · " + s.titulo })]));
      var coluna = el("div", {}, [blocoQuestao(s.refs[estado.revendo], estado.revendo, s.refs.length, true)]);
      coluna.appendChild(el("div", { class: "nav-q" }, [
        el("button", { class: "botao discreto", type: "button", text: "← Anterior", disabled: estado.revendo === 0, onclick: function () { estado.revendo--; desenhar(); window.scrollTo(0, 0); } }),
        el("span", { class: "espaco" }),
        el("button", { class: "botao", type: "button", text: estado.revendo < s.refs.length - 1 ? "Próxima →" : "Voltar ao resultado", onclick: function () {
          if (estado.revendo < s.refs.length - 1) estado.revendo++; else estado.revendo = null;
          desenhar(); window.scrollTo(0, 0);
        } }),
      ]));
      app.appendChild(el("div", { class: "prova" }, [coluna, cartaoResposta(true)]));
      return;
    }
    var r = resumo(s);
    var discursiva = s.tipo === "discursiva";
    app.appendChild(el("div", { class: "prova-cab" }, [el("h1", { text: "Resultado · " + s.titulo })]));
    if (discursiva) {
      app.appendChild(el("p", { class: "dica", text: "Abra cada questão, compare sua resposta com a resposta esperada pela banca e marque como foi. O placar abaixo usa a sua avaliação." }));
    }
    var bolhas = s.refs.map(function (ref, i) {
      var st = situacao(s, ref);
      var nome = { certa: "certa", errada: "errada", branco: discursiva ? "sem avaliação" : "em branco", anulada: "anulada", parcial: "parcial" }[st];
      return el("button", { type: "button", class: "gab " + st, title: "Questão " + (i + 1) + ": " + nome, "aria-label": "Questão " + (i + 1) + ", " + nome + ". Ver correção",
        style: "--i:" + i, onclick: function () { estado.revendo = i; desenhar(); window.scrollTo(0, 0); } }, [String(i + 1)]);
    });
    app.appendChild(el("section", { class: "banda", "aria-label": "Placar" }, [
      el("div", { class: "banda-topo" }, [
        el("div", { class: "heroi" }, [
          el("span", { class: "rotulo-sec", text: discursiva ? "Sua avaliação" : "Aproveitamento" }),
          el("div", { class: "heroi-num" }, [String(Math.round(r.nota * 100)), el("small", { text: "%" })]),
          el("div", { class: "delta", text: "Estimativa para estudo, não é nota oficial." }),
        ]),
        el("div", { class: "cartela" }, [
          el("div", { class: "cartela-cab" }, [
            el("span", { class: "rotulo-sec", text: "Cartão-resposta" }),
            el("span", { class: "cartela-legenda" }, [el("i", { class: "ok" }), "certa", el("i", { class: "erro" }), "errada", el("i", { class: "branco" }), discursiva ? "sem avaliação" : "em branco"]),
          ]),
          el("div", { class: "gabarito-bolhas" }, bolhas),
          el("p", { class: "cartela-nota", text: "Toque numa bolha para ver a correção da questão." }),
        ]),
      ]),
      el("dl", { class: "placar" }, [
        el("div", {}, [el("dt", { text: "Acertos" }), el("dd", { text: (r.certas + (r.parciais ? " + " + r.parciais + "½" : "")) + " de " + r.consideradas })]),
        el("div", {}, [el("dt", { text: discursiva ? "Sem avaliação" : "Em branco" }), el("dd", { text: String(r.branco) })]),
        el("div", {}, [el("dt", { text: "Tempo" }), el("dd", { text: formatarTempo(s.fim - s.inicio) })]),
      ]),
    ]));
    if (s.tempoEsgotado) app.appendChild(el("p", { class: "aviso-tempo", role: "status", text: "O tempo acabou e a prova foi entregue automaticamente, como no vestibular." }));
    if (r.anuladas) app.appendChild(el("p", { class: "dica", text: plural(r.anuladas, "questão anulada pela banca não entrou", "questões anuladas pela banca não entraram") + " na conta." }));

    app.appendChild(el("section", { class: "painel" }, [
      el("div", { class: "painel-cab" }, [el("h2", { text: "Por matéria" }), el("p", { text: "Acerto em cada matéria deste treino." })]),
      barrasMaterias(r.materias, Math.round(r.nota * 100), 0),
    ]));

    // por assunto, dentro de cada matéria
    var porAssunto = {};
    s.refs.forEach(function (ref) {
      var achado = buscarQuestao(ref);
      var st = situacao(s, ref);
      if (!achado || !achado.q.assunto || st === "anulada") return;
      var k = ref.materia + "|" + achado.q.assunto;
      var a = porAssunto[k] = porAssunto[k] || { m: ref.materia, a: achado.q.assunto, certas: 0, total: 0 };
      a.total++;
      if (st === "certa") a.certas++;
    });
    var assuntos = Object.keys(porAssunto).map(function (k) { return porAssunto[k]; });
    if (assuntos.length) {
      assuntos.sort(function (x, y) { return ORDEM_MATERIAS.indexOf(x.m) - ORDEM_MATERIAS.indexOf(y.m) || x.certas / x.total - y.certas / y.total; });
      var tAss = el("table", { class: "por-materia" }, [el("thead", {}, [el("tr", {}, [el("th", { text: "Assunto" }), el("th", { text: "Matéria" }), el("th", { text: "Acertos", style: "text-align:right" })])])]);
      var cAss = el("tbody");
      assuntos.forEach(function (a) {
        cAss.appendChild(el("tr", { class: a.certas < a.total ? "com-erro" : "" }, [
          el("td", { text: a.a }), el("td", { class: "sec", text: MATERIAS[a.m] }), el("td", { class: "n", text: a.certas + "/" + a.total }),
        ]));
      });
      tAss.appendChild(cAss);
      app.appendChild(el("section", { class: "secao" }, [el("h2", { text: "Por assunto" }), el("div", { style: "overflow-x:auto" }, [tAss])]));
    }

    var soErros = estado.soErros;
    var lista = el("ol", { class: "lista-rev" });
    s.refs.forEach(function (ref, i) {
      var achado = buscarQuestao(ref);
      var st = situacao(s, ref);
      var rotulo = { certa: "Certa", errada: "Errada", branco: discursiva ? "Avaliar" : "Em branco", anulada: "Anulada", parcial: "Parcial" }[st];
      if (soErros && (st === "certa" || st === "anulada")) return;
      var texto = achado ? (achado.q.enunciado || "").replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\\(?:text|mathrm|mathbf|textbf)\{([^}]*)\}/g, "$1").replace(/\\[a-zA-Z]+/g, " ").replace(/[$*_<>[\]{}^\\]/g, " ")
        .replace(/\s+/g, " ").trim() : "";
      lista.appendChild(el("li", {}, [el("button", { type: "button", onclick: function () { estado.revendo = i; desenhar(); window.scrollTo(0, 0); } }, [
        el("span", { class: "num", text: String(i + 1).padStart(2, "0") }),
        el("span", { class: "resumo", text: (MATERIAS[ref.materia] || "") + " · " + (texto || "ver questão") }),
        el("span", { class: "estado " + (st === "parcial" ? "certa" : st), text: rotulo }),
      ])]));
    });
    app.appendChild(el("section", { class: "secao" }, [
      el("h2", { text: "Questões e gabarito" }),
      el("label", { class: "marcar", for: "so-erros" }, [
        el("input", { type: "checkbox", id: "so-erros", checked: !!soErros, onchange: function (ev) { estado.soErros = ev.target.checked; desenhar(); } }),
        el("span", { text: "Mostrar só as que errei ou deixei em branco" }),
      ]),
      lista,
      el("div", { class: "nav-q" }, [
        el("button", { class: "botao", type: "button", text: "Ver correção questão por questão", onclick: function () { estado.revendo = 0; desenhar(); window.scrollTo(0, 0); } }),
        el("button", { class: "botao discreto", type: "button", text: "Novo treino", onclick: function () { gravar(CHAVE_SESSAO, null); estado.sessao = null; irPara("inicio"); } }),
      ]),
    ]));
  }

  // ---------- desempenho ----------
  var SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, filhos) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    (filhos || []).forEach(function (f) { if (f) e.appendChild(f); });
    return e;
  }
  function pct(certas, total) { return total ? Math.round((certas / total) * 100) : 0; }
  function dataDia(ts) { return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", ""); }
  var PERIODOS = [["7", "7 dias"], ["30", "30 dias"], ["tudo", "Tudo"]];
  var DIA = 86400000;

  // Treinos do recorte (período e vestibular), do mais antigo ao mais recente. Cada treino traz
  // só as questões do vestibular escolhido; treinos antigos sem a lista de questões contam pelo total.
  function recorte(hist, filtro, ate) {
    var fim = ate || Date.now();
    var ini = filtro.periodo === "tudo" ? -Infinity : fim - Number(filtro.periodo) * DIA;
    var lista = [];
    hist.forEach(function (h) {
      if (!(h.quando > ini && h.quando <= fim) || !h.total) return;
      var qs = h.questoes ? h.questoes.filter(function (q) { return filtro.vest === "todos" || q.v === filtro.vest; }) : null;
      if (qs && !qs.length) return;
      if (!qs && filtro.vest !== "todos") return;
      var certas = qs ? qs.filter(function (q) { return q.ok; }).length : h.certas + (h.parciais || 0) * 0.5;
      var total = qs ? qs.length : h.total;
      lista.push({ h: h, qs: qs || [], certas: certas, total: total, quando: h.quando });
    });
    return lista.sort(function (a, b) { return a.quando - b.quando; });
  }
  function soma(treinos) {
    return treinos.reduce(function (s, t) { s.certas += t.certas; s.total += t.total; return s; }, { certas: 0, total: 0 });
  }
  // cada questão conta pela tentativa mais recente
  function questoesDoRecorte(treinos) {
    var vistas = {}, lista = [];
    treinos.slice().reverse().forEach(function (t) {
      t.qs.forEach(function (q) { if (!vistas[q.id]) { vistas[q.id] = true; lista.push(q); } });
    });
    return lista;
  }
  function diasSeguidos(hist) {
    var dias = {};
    hist.forEach(function (h) { dias[new Date(h.quando).toDateString()] = true; });
    var seq = 0, dia = new Date();
    if (!dias[dia.toDateString()]) dia.setDate(dia.getDate() - 1);
    while (dias[dia.toDateString()]) { seq++; dia.setDate(dia.getDate() - 1); }
    return seq;
  }

  // Gráfico de evolução: cada treino é um ponto cinza; a linha azul é a média dos últimos 5 treinos.
  function graficoEvolucao(treinos) {
    var caixa = el("div", { class: "grafico-caixa" });
    if (treinos.length < 2) {
      caixa.appendChild(el("p", { class: "dica", text: "O gráfico aparece a partir do segundo treino concluído neste recorte." }));
      return caixa;
    }
    var pontos = treinos.map(function (t, i) {
      var janela = treinos.slice(Math.max(0, i - 4), i + 1);
      var sj = soma(janela);
      return { t: t, pct: pct(t.certas, t.total), media: pct(sj.certas, sj.total) };
    });
    caixa.appendChild(el("ul", { class: "legenda" }, [
      el("li", {}, [el("span", { class: "k-ponto", "aria-hidden": "true" }), "Cada treino"]),
      el("li", {}, [el("span", { class: "k-linha", "aria-hidden": "true" }), "Média dos últimos 5 treinos"]),
    ]));
    var dica = el("div", { class: "dica-flutuante", hidden: true, role: "status" });
    caixa.appendChild(dica);

    function desenhar() {
      var antigo = caixa.querySelector("svg"); if (antigo) antigo.remove();
      var L = Math.max(300, caixa.clientWidth || 640), A = L < 520 ? 210 : 250;
      var me = 34, md = 40, mt = 14, mb = 28;
      var x = function (i) { return me + (i * (L - me - md)) / (pontos.length - 1); };
      var y = function (p) { return mt + ((100 - p) * (A - mt - mb)) / 100; };
      var g = svg("svg", { viewBox: "0 0 " + L + " " + A, width: L, height: A, class: "grafico", tabindex: "0", role: "img",
        "aria-label": "Aproveitamento em " + pontos.length + " treinos; média dos últimos 5: " + pontos[pontos.length - 1].media + "%. Use as setas para ver cada treino." });
      [0, 25, 50, 75, 100].forEach(function (p) {
        g.appendChild(svg("line", { x1: me, x2: L - md, y1: y(p), y2: y(p), class: p === 0 ? "base" : "grade-linha" }));
        var t = svg("text", { x: me - 8, y: y(p) + 4, "text-anchor": "end", class: "eixo" }); t.textContent = p + "%"; g.appendChild(t);
      });
      // datas: primeira, do meio e última
      var marcas = pontos.length > 4 ? [0, Math.round((pontos.length - 1) / 2), pontos.length - 1] : pontos.map(function (_, i) { return i; });
      marcas.forEach(function (i, k) {
        var t = svg("text", { x: x(i), y: A - 8, "text-anchor": k === 0 && marcas.length > 1 ? "start" : i === pontos.length - 1 ? "end" : "middle", class: "eixo" });
        t.textContent = dataDia(pontos[i].t.quando); g.appendChild(t);
      });
      var linha = pontos.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.media).toFixed(1); }).join(" ");
      g.appendChild(svg("path", { d: linha + " L" + x(pontos.length - 1).toFixed(1) + " " + y(0) + " L" + x(0) + " " + y(0) + " Z", class: "area" }));
      g.appendChild(svg("path", { d: linha, class: "linha" }));
      var mira = svg("line", { x1: 0, x2: 0, y1: mt, y2: y(0), class: "mira", visibility: "hidden" });
      g.appendChild(mira);
      var circulos = pontos.map(function (p, i) {
        var c = svg("circle", { cx: x(i), cy: y(p.pct), r: 4.5, class: "ponto" });
        g.appendChild(c);
        return c;
      });
      var ult = pontos[pontos.length - 1];
      g.appendChild(svg("circle", { cx: x(pontos.length - 1), cy: y(ult.media), r: 5, class: "fim" }));
      var rot = svg("text", { x: x(pontos.length - 1) + 9, y: y(ult.media) + 4.5, class: "rotulo" }); rot.textContent = ult.media + "%";
      g.appendChild(rot);
      caixa.insertBefore(g, dica);

      var ativo = -1;
      function mostrar(i) {
        if (ativo >= 0) circulos[ativo].classList.remove("ativo");
        ativo = i;
        if (i < 0) { mira.setAttribute("visibility", "hidden"); dica.hidden = true; return; }
        var p = pontos[i];
        circulos[i].classList.add("ativo");
        mira.setAttribute("x1", x(i)); mira.setAttribute("x2", x(i)); mira.setAttribute("visibility", "visible");
        dica.innerHTML = "";
        dica.appendChild(el("strong", { text: p.pct + "%" }));
        dica.appendChild(el("div", {}, [el("span", { class: "lp" }), (p.t.certas % 1 ? p.t.certas.toFixed(1) : p.t.certas) + " de " + p.t.total + " neste treino"]));
        dica.appendChild(el("div", {}, [el("span", { class: "lk" }), "média dos últimos 5: " + p.media + "%"]));
        dica.appendChild(el("div", { style: "margin-top:.35rem", text: p.t.h.titulo }));
        dica.appendChild(el("div", { text: dataCurta(p.t.quando) }));
        dica.hidden = false;
        var px = (x(i) / L) * g.getBoundingClientRect().width;
        var largura = dica.offsetWidth, cx = caixa.clientWidth;
        dica.style.left = Math.max(0, Math.min(cx - largura, px + (px > cx / 2 ? -largura - 14 : 14))) + "px";
        dica.style.top = "2.2rem";
      }
      g.addEventListener("pointermove", function (ev) {
        var r = g.getBoundingClientRect();
        var lx = ((ev.clientX - r.left) / r.width) * L;
        var i = Math.round(((lx - me) / (L - me - md)) * (pontos.length - 1));
        mostrar(Math.max(0, Math.min(pontos.length - 1, i)));
      });
      g.addEventListener("pointerleave", function () { mostrar(-1); });
      g.addEventListener("blur", function () { mostrar(-1); });
      g.addEventListener("keydown", function (ev) {
        if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
          ev.preventDefault(); ev.stopPropagation();
          var i = ativo < 0 ? pontos.length - 1 : ativo + (ev.key === "ArrowRight" ? 1 : -1);
          mostrar(Math.max(0, Math.min(pontos.length - 1, i)));
        } else if (ev.key === "Escape") mostrar(-1);
      });
    }
    caixa.desenhar = desenhar;
    return caixa;
  }

  // Barras horizontais por matéria, da melhor para a pior, com a média geral marcada.
  function barrasMaterias(materias, mediaGeral, minimo) {
    minimo = minimo === undefined ? 5 : minimo;
    var linhas = Object.keys(materias).filter(function (m) { return materias[m].total; }).map(function (m) {
      return { m: m, c: materias[m].certas, t: materias[m].total, p: pct(materias[m].certas, materias[m].total) };
    }).sort(function (a, b) { return b.p - a.p || b.t - a.t; });
    var temPouco = false;
    var lista = el("ul", { class: "barras" }, linhas.map(function (l) {
      var pouco = l.t < minimo;
      if (pouco) temPouco = true;
      var certas = l.c % 1 ? l.c.toFixed(1) : l.c;
      return el("li", { class: pouco ? "pouco" : "", title: (MATERIAS[l.m] || l.m) + ": " + certas + " de " + l.t + " certas (" + l.p + "%)" }, [
        el("span", { class: "nome", text: MATERIAS[l.m] || l.m }),
        el("span", { class: "trilho", role: "img", "aria-label": l.p + "% de acerto" }, [
          el("i", { style: "width:" + l.p + "%" }),
          mediaGeral !== null ? el("span", { class: "media", style: "left:" + mediaGeral + "%", "aria-hidden": "true" }) : null,
        ]),
        el("span", { class: "val" }, [l.p + "%", el("small", { text: certas + "/" + l.t })]),
      ]);
    }));
    var notas = [];
    if (mediaGeral !== null) notas.push("O traço vertical é a sua média geral (" + mediaGeral + "%).");
    if (temPouco) notas.push("Barras mais claras: menos de " + minimo + " questões, ainda pouco para tirar conclusão.");
    return el("div", {}, [lista, notas.length ? el("p", { class: "nota-rodape", text: notas.join(" ") }) : null]);
  }

  function anelMedalha(fracao, feita) {
    var r = 15, C = 2 * Math.PI * r;
    var g = svg("svg", { viewBox: "0 0 40 40", class: "medalha-icone", "aria-hidden": "true" });
    if (feita) {
      g.appendChild(svg("circle", { cx: 20, cy: 20, r: 17, class: "cheio" }));
      g.appendChild(svg("path", { d: "M13 20.5l4.5 4.5 9-10", class: "check" }));
    } else {
      g.appendChild(svg("circle", { cx: 20, cy: 20, r: r, class: "trilha" }));
      if (fracao > 0) g.appendChild(svg("circle", { cx: 20, cy: 20, r: r, class: "prog", transform: "rotate(-90 20 20)",
        "stroke-dasharray": (C * Math.min(1, fracao)).toFixed(1) + " " + C.toFixed(1) }));
    }
    return g;
  }
  function medalhas(hist) {
    var todas = [];
    hist.forEach(function (h) { (h.questoes || []).forEach(function (q) { todas.push(q); }); });
    var lista = [];
    var nTreinos = hist.length;
    lista.push({ nome: "Primeiro treino", meta: "Concluir 1 treino", feito: nTreinos >= 1, f: Math.min(nTreinos, 1), prog: Math.min(nTreinos, 1) + "/1" });
    var provas = hist.filter(function (h) { return h.modo === "prova" || h.modo === "simulado"; }).length;
    lista.push({ nome: "Dia de prova", meta: "Fazer 1 simulado ou prova completa", feito: provas >= 1, f: Math.min(provas, 1), prog: Math.min(provas, 1) + "/1" });
    lista.push({ nome: "Maratonista", meta: "Resolver 500 questões", feito: todas.length >= 500, f: todas.length / 500, prog: Math.min(todas.length, 500) + "/500" });
    var seq = diasSeguidos(hist);
    lista.push({ nome: "Constância", meta: "Treinar 7 dias seguidos", feito: seq >= 7, f: seq / 7, prog: Math.min(seq, 7) + "/7 dias" });
    // "Mestre": 50 questões de uma matéria num vestibular
    var conta = {};
    todas.forEach(function (q) { if (q.v && q.m) { var k = q.v + "|" + q.m; conta[k] = (conta[k] || 0) + 1; } });
    var melhor = Object.keys(conta).sort(function (a, b) { return conta[b] - conta[a]; });
    melhor.forEach(function (k) {
      var p = k.split("|");
      if (conta[k] >= 50) lista.push({ nome: "Mestre da " + VESTIBULARES[p[0]].nome + " em " + MATERIAS[p[1]], meta: "50 questões de " + MATERIAS[p[1]] + " da " + VESTIBULARES[p[0]].nome, feito: true, f: 1, prog: "50/50" });
    });
    if (melhor.length && conta[melhor[0]] < 50) {
      var p0 = melhor[0].split("|");
      lista.push({ nome: "Mestre da " + VESTIBULARES[p0[0]].nome + " em " + MATERIAS[p0[1]], meta: "50 questões de " + MATERIAS[p0[1]] + " da " + VESTIBULARES[p0[0]].nome, feito: false, f: conta[melhor[0]] / 50, prog: conta[melhor[0]] + "/50" });
    }
    return lista;
  }

  function segmento(rotulo, opcoes, atual, aoEscolher) {
    return el("div", { class: "filtro", role: "group", "aria-label": rotulo }, [
      el("span", { text: rotulo }),
      el("div", { class: "seg" }, opcoes.map(function (o) {
        return el("button", { type: "button", "aria-pressed": o[0] === atual ? "true" : "false", text: o[1], onclick: function () { aoEscolher(o[0]); } });
      })),
    ]);
  }

  // O histórico desenhado como um cartão-resposta: cada linha é um treino, cada bolha uma questão.
  function cartelaHistorico(treinos) {
    var ultimos = treinos.slice(-12).reverse();
    var linhas = ultimos.map(function (t, i) {
      var marcas = t.qs.length ? t.qs.map(function (q) { return q.ok; })
        : Array.apply(null, Array(t.total)).map(function (_, k) { return k < Math.round(t.certas); });
      var p = pct(t.certas, t.total);
      var desc = t.h.titulo + ", " + dataCurta(t.quando) + ": " + (t.certas % 1 ? t.certas.toFixed(1) : t.certas) + " de " + t.total + " certas (" + p + "%)";
      return el("li", { class: "cartela-linha", style: "--i:" + i, title: desc, "aria-label": desc }, [
        el("span", { class: "cartela-data", text: new Date(t.quando).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) }),
        el("span", { class: "cartela-bolhas", "aria-hidden": "true" }, marcas.map(function (ok) { return el("i", { class: ok ? "ok" : "erro" }); })),
        el("span", { class: "cartela-pct", text: p + "%" }),
      ]);
    });
    return el("div", { class: "cartela" }, [
      el("div", { class: "cartela-cab" }, [
        el("span", { class: "rotulo-sec", text: treinos.length > 12 ? "Seus últimos 12 treinos" : "Seus treinos" }),
        el("span", { class: "cartela-legenda" }, [el("i", { class: "ok" }), "certa", el("i", { class: "erro" }), "errada ou em branco"]),
      ]),
      el("ol", { class: "cartela-lista" }, linhas),
    ]);
  }

  function telaHistorico() {
    var hist = ler(CHAVE_HIST, []);
    var f = estado.filtroDesempenho = estado.filtroDesempenho || { periodo: "tudo", vest: "todos" };
    var cab = el("div", { class: "prova-cab" }, [el("h1", { text: "Seu desempenho" })]);
    app.appendChild(cab);
    if (!hist.length) {
      app.appendChild(el("p", { class: "vazio", text: "Você ainda não terminou nenhum simulado ou treino. Os resultados aparecem aqui, guardados neste aparelho." }));
      return;
    }
    var vests = Object.keys(VESTIBULARES).filter(function (v) { return hist.some(function (h) { return (h.questoes || []).some(function (q) { return q.v === v; }); }); });
    app.appendChild(el("div", { class: "filtros" }, [
      segmento("Período", PERIODOS, f.periodo, function (v) { f.periodo = v; desenhar(); }),
      segmento("Vestibular", [["todos", "Todos"]].concat(vests.map(function (v) { return [v, VESTIBULARES[v].nome]; })), f.vest, function (v) { f.vest = v; desenhar(); }),
    ]));
    var treinos = recorte(hist, f);
    var totalHist = hist.reduce(function (s, h) { return s + (h.total || 0); }, 0);
    cab.appendChild(el("p", { class: "sub", text: "Guardado só neste aparelho · " + plural(hist.length, "treino", "treinos") + " · " + plural(totalHist, "questão", "questões") + " no total. Os números são estimativas para estudo." }));
    if (!treinos.length) {
      app.appendChild(el("div", { class: "painel" }, [el("p", { class: "vazio", text: "Nenhum treino neste recorte. Escolha um período maior ou outro vestibular." })]));
      return;
    }
    var tot = soma(treinos);
    var aprov = pct(tot.certas, tot.total);
    var feitas = questoesDoRecorte(treinos);

    // comparação: período anterior (7 ou 30 dias) ou primeiros x últimos 5 treinos
    var delta = null;
    if (f.periodo !== "tudo") {
      var antes = soma(recorte(hist, f, Date.now() - Number(f.periodo) * DIA));
      if (antes.total) delta = { v: aprov - pct(antes.certas, antes.total), texto: "em relação aos " + f.periodo + " dias anteriores" };
    } else if (treinos.length >= 6) {
      var ini = soma(treinos.slice(0, 5)), fimT = soma(treinos.slice(-5));
      delta = { v: pct(fimT.certas, fimT.total) - pct(ini.certas, ini.total), texto: "dos 5 primeiros para os 5 últimos treinos" };
    }
    var duracao = treinos.reduce(function (s, t) { return s + (t.h.duracao || 0); }, 0);
    var questoesTempo = treinos.reduce(function (s, t) { return s + t.h.total; }, 0);
    var porQuestao = questoesTempo ? Math.round(duracao / questoesTempo / 1000) : 0;
    var seq = diasSeguidos(hist);

    var heroi = el("div", { class: "heroi" }, [
      el("span", { class: "rotulo-sec", text: "Aproveitamento" }),
      el("div", { class: "heroi-num" }, [String(aprov), el("small", { text: "%" })]),
      delta ? el("div", { class: "delta " + (delta.v > 0 ? "sobe" : delta.v < 0 ? "desce" : "") }, [
        el("b", { text: (delta.v > 0 ? "▲ +" : delta.v < 0 ? "▼ " : "= ") + delta.v + " p.p." }), " " + delta.texto,
      ]) : el("div", { class: "delta", text: plural(tot.total, "questão respondida", "questões respondidas") + " neste recorte" }),
    ]);
    var kpis = el("div", { class: "kpis" }, [
      el("div", { class: "kpi" }, [el("span", { class: "rotulo-sec", text: "Questões" }), el("span", { class: "v", text: tot.total.toLocaleString("pt-BR") }), el("span", { class: "s", text: (tot.certas % 1 ? tot.certas.toFixed(1) : tot.certas) + " certas" })]),
      el("div", { class: "kpi" }, [el("span", { class: "rotulo-sec", text: "Treinos" }), el("span", { class: "v", text: String(treinos.length) }), el("span", { class: "s", text: "desde " + dataDia(treinos[0].quando) })]),
      el("div", { class: "kpi" }, [el("span", { class: "rotulo-sec", text: "Ritmo" }), el("span", { class: "v" }, [Math.floor(porQuestao / 60) + ":" + String(porQuestao % 60).padStart(2, "0"), el("small", { text: " min" })]), el("span", { class: "s", text: "por questão · meta 3:20" })]),
      el("div", { class: "kpi" }, [el("span", { class: "rotulo-sec", text: "Sequência" }), el("span", { class: "v" }, [String(seq), el("small", { text: seq === 1 ? " dia" : " dias" })]), el("span", { class: "s", text: "seguidos treinando" })]),
    ]);
    var grafico = graficoEvolucao(treinos);
    app.appendChild(el("section", { class: "banda", "aria-label": "Visão geral" }, [
      el("div", { class: "banda-topo" }, [heroi, cartelaHistorico(treinos)]),
      kpis,
    ]));
    app.appendChild(el("section", { class: "painel", style: "margin-top:1rem" }, [
      el("div", { class: "painel-cab" }, [el("h2", { text: "Evolução" }), el("p", { text: "Passe o dedo ou o mouse sobre o gráfico para ver cada treino." })]),
      grafico,
    ]));
    if (grafico.desenhar) grafico.desenhar();

    // por matéria (todas as questões do recorte) e onde focar
    var materias = {};
    treinos.forEach(function (t) {
      if (t.qs.length) t.qs.forEach(function (q) { var x = materias[q.m] = materias[q.m] || { certas: 0, total: 0 }; x.total++; if (q.ok) x.certas++; });
      else Object.keys(t.h.materias || {}).forEach(function (m) { var x = materias[m] = materias[m] || { certas: 0, total: 0 }; x.certas += t.h.materias[m].certas; x.total += t.h.materias[m].total; });
    });
    var grupos = {};
    feitas.forEach(function (q) {
      if (!q.a || !q.v) return;
      var k = q.v + "|" + q.m + "|" + q.a;
      var g = grupos[k] = grupos[k] || { v: q.v, m: q.m, a: q.a, certas: 0, total: 0 };
      g.total++;
      if (q.ok) g.certas++;
    });
    var fracos = Object.keys(grupos).map(function (k) { return grupos[k]; })
      .filter(function (g) { return g.total >= 3 && g.certas < g.total; })
      .sort(function (a, b) { return a.certas / a.total - b.certas / b.total || b.total - a.total; }).slice(0, 5);
    var erradas = questoesDoRecorte(recorte(hist, { periodo: "tudo", vest: f.vest })).filter(function (q) { return !q.ok; });

    var foco = el("section", { class: "painel" }, [el("div", { class: "painel-cab" }, [el("h2", { text: "Onde focar" }), el("p", { text: "Assuntos com 3 ou mais questões e o menor acerto." })])]);
    if (erradas.length) {
      foco.appendChild(el("div", { class: "refazer" }, [
        el("p", {}, [el("strong", { text: plural(erradas.length, "questão errada", "questões erradas") }), " na última tentativa de cada uma."]),
        el("button", { class: "botao pequeno", type: "button", text: "Refazer questões que errei", onclick: function () {
          var refs = embaralhar(erradas).slice(0, 30).map(function (q) { return { ed: q.ed, n: q.n, materia: q.m, v: q.v }; });
          iniciarSessao({ modo: "erros", refs: refs, titulo: "Revisão dos meus erros · " + refs.length + " questões", filtro: { tipo: "objetiva" } }).catch(erroGeral);
        } }),
      ]));
    }
    if (fracos.length) {
      foco.appendChild(el("ol", { class: "foco" }, fracos.map(function (g) {
        var p = pct(g.certas, g.total);
        return el("li", {}, [
          el("span", { class: "a", text: g.a }),
          el("span", { class: "m", text: MATERIAS[g.m] + " · " + VESTIBULARES[g.v].nome }),
          el("span", { class: "medidor", role: "img", "aria-label": p + "% de acerto" }, [el("i", { style: "width:" + Math.max(p, 2) + "%" })]),
          el("span", { class: "lado" }, [
            el("span", { class: "pct", text: p + "% · " + g.certas + "/" + g.total }),
            el("button", { class: "botao discreto pequeno", type: "button", text: "Treinar", "aria-label": "Treinar " + g.a + " da " + VESTIBULARES[g.v].nome, onclick: function () {
              iniciarSessao({ modo: "materia", quantidade: 10, materias: [g.m], assunto: g.a, anoMin: 0, titulo: "Treino · " + g.a,
                filtro: { vestibulares: [g.v], tipo: "objetiva" } }).catch(erroGeral);
            } }),
          ]),
        ]);
      })));
    } else {
      foco.appendChild(el("p", { class: "dica", text: "Ainda não há assunto com 3 ou mais questões erradas neste recorte. Continue treinando que as sugestões aparecem aqui." }));
    }
    app.appendChild(el("div", { class: "grade-painel duas" }, [
      el("section", { class: "painel" }, [
        el("div", { class: "painel-cab" }, [el("h2", { text: "Por matéria" }), el("p", { text: "Acerto em todas as questões do recorte." })]),
        barrasMaterias(materias, aprov),
      ]),
      foco,
    ]));

    // mapa de assuntos: matérias com bolhas por vestibular; abre para ver os assuntos
    var colunas = f.vest === "todos" ? vests : [f.vest];
    var porMateria = {};
    feitas.forEach(function (q) {
      if (!q.m) return;
      var pm = porMateria[q.m] = porMateria[q.m] || { c: {}, assuntos: {} };
      var c = pm.c[q.v] = pm.c[q.v] || { certas: 0, total: 0 };
      c.total++; if (q.ok) c.certas++;
      if (q.a) {
        var a = pm.assuntos[q.a] = pm.assuntos[q.a] || {};
        var ca = a[q.v] = a[q.v] || { certas: 0, total: 0 };
        ca.total++; if (q.ok) ca.certas++;
      }
    });
    function bolha(c, rotulo) {
      if (!c) return el("span", { class: "bolha-dado vazia", "aria-label": rotulo + ": sem questões", title: rotulo + ": sem questões", text: "–" });
      var p = pct(c.certas, c.total);
      var nivel = p >= 80 ? 4 : p >= 60 ? 3 : p >= 40 ? 2 : p >= 20 ? 1 : 0;
      var dica = rotulo + ": " + c.certas + " de " + c.total + " certas (" + p + "%)";
      return el("span", { class: "bolha-dado nivel-" + nivel + (c.total < 3 ? " fraca" : ""), title: dica, "aria-label": dica, text: p + "%" });
    }
    var abertas = estado.mapaAberto = estado.mapaAberto || {};
    var corpo = el("tbody");
    ORDEM_MATERIAS.forEach(function (m) {
      var pm = porMateria[m];
      if (!pm) return;
      var nAss = Object.keys(pm.assuntos).length;
      var totalM = colunas.reduce(function (s, v) { return s + (pm.c[v] ? pm.c[v].total : 0); }, 0);
      if (!totalM) return;
      corpo.appendChild(el("tr", { class: "materia" }, [
        el("td", {}, [el("button", { type: "button", class: "abre", "aria-expanded": abertas[m] ? "true" : "false", onclick: function () { abertas[m] = !abertas[m]; desenhar(); } }, [
          MATERIAS[m], el("small", { text: plural(nAss, "assunto", "assuntos") }),
        ])]),
      ].concat(colunas.map(function (v) { return el("td", {}, [bolha(pm.c[v], MATERIAS[m] + " na " + VESTIBULARES[v].nome)]); }))));
      if (!abertas[m]) return;
      Object.keys(pm.assuntos).map(function (a) {
        var x = pm.assuntos[a], c = 0, t = 0;
        colunas.forEach(function (v) { if (x[v]) { c += x[v].certas; t += x[v].total; } });
        return { a: a, x: x, p: t ? c / t : 2, t: t };
      }).filter(function (r) { return r.t; }).sort(function (a, b) { return a.p - b.p; }).forEach(function (r) {
        corpo.appendChild(el("tr", { class: "assunto" }, [el("td", { text: r.a })].concat(colunas.map(function (v) {
          return el("td", {}, [bolha(r.x[v], r.a + " na " + VESTIBULARES[v].nome)]);
        }))));
      });
    });
    var escala = el("div", { class: "escala" }, [
      el("span", { text: "Acerto:" }),
      el("ol", {}, [["0", "0–19%"], ["1", "20–39"], ["2", "40–59"], ["3", "60–79"], ["4", "80–100"]].map(function (n) {
        return el("li", {}, [el("span", { class: "bolha-dado nivel-" + n[0], "aria-hidden": "true" }), n[1]]);
      })),
      el("span", { text: "Bolha mais clara: menos de 3 questões." }),
    ]);
    app.appendChild(el("section", { class: "painel", style: "margin-top:1rem" }, [
      el("div", { class: "painel-cab" }, [el("h2", { text: "Mapa de assuntos" }), el("p", { text: "Toque numa matéria para ver os assuntos, do mais fraco para o mais forte." })]),
      el("div", { class: "mapa-caixa" }, [el("table", { class: "mapa" }, [
        el("thead", {}, [el("tr", {}, [el("th", { text: "Matéria" })].concat(colunas.map(function (v) { return el("th", { text: VESTIBULARES[v].nome }); })))]),
        corpo,
      ])]),
      escala,
    ]));

    // medalhas (todo o histórico)
    app.appendChild(el("section", { class: "secao" }, [
      el("h2", { text: "Medalhas" }),
      el("ul", { class: "medalhas" }, medalhas(hist).map(function (m) {
        return el("li", { class: m.feito ? "feita" : "" }, [
          anelMedalha(m.f, m.feito),
          el("span", {}, [el("strong", { text: m.nome }), el("small", { text: m.meta + " · " + m.prog })]),
        ]);
      })),
    ]));

    // treinos do recorte (também é a tabela do gráfico)
    var linhas = treinos.slice().reverse().map(function (t) {
      var p = pct(t.certas, t.total);
      return el("tr", {}, [
        el("td", { class: "d", text: dataCurta(t.quando) }),
        el("td", { text: t.h.titulo }),
        el("td", { class: "n", text: (t.certas % 1 ? t.certas.toFixed(1) : t.certas) + "/" + t.total }),
        el("td", { class: "n" }, [el("span", { class: "mini", "aria-hidden": "true" }, [el("i", { style: "width:" + p + "%" })]), p + "%"]),
        el("td", { class: "n", text: formatarTempo(t.h.duracao || 0) }),
      ]);
    });
    app.appendChild(el("section", { class: "secao" }, [
      el("h2", { text: "Treinos" }),
      el("div", { class: "painel tabela-caixa" }, [el("table", { class: "historico" }, [
        el("thead", {}, [el("tr", {}, [el("th", { text: "Data" }), el("th", { text: "Treino" }), el("th", { class: "n", text: "Acertos" }), el("th", { class: "n", text: "Aproveitamento" }), el("th", { class: "n", text: "Tempo" })])]),
        el("tbody", {}, linhas),
      ])]),
    ]));
  }

  // ---------- páginas legais ----------
  // Textos em dados/juridico/*.md (markdown simples: #, ##, listas com "- " e **negrito**).
  var PAGINAS = { direitos: "Direitos autorais e remoção de conteúdo", termos: "Termos de Uso", privacidade: "Política de Privacidade" };
  function inlineMd(texto) {
    var partes = texto.split(/(\*\*[^*]+\*\*)/);
    return partes.map(function (p) {
      return /^\*\*[^*]+\*\*$/.test(p) ? el("strong", { text: p.slice(2, -2) }) : p;
    });
  }
  function blocosMd(md) {
    var saida = [], lista = null, par = [];
    function fechaPar() { if (par.length) { saida.push(el("p", {}, inlineMd(par.join(" ")))); par = []; } }
    function fechaLista() { if (lista) { saida.push(lista); lista = null; } }
    md.split("\n").forEach(function (linha) {
      var m;
      if ((m = /^(#{1,2}) (.*)$/.exec(linha))) { fechaPar(); fechaLista(); saida.push(el(m[1].length === 1 ? "h1" : "h2", {}, inlineMd(m[2]))); }
      else if ((m = /^- (.*)$/.exec(linha))) { fechaPar(); lista = lista || el("ul"); lista.appendChild(el("li", {}, inlineMd(m[1]))); }
      else if (!linha.trim()) { fechaPar(); fechaLista(); }
      else { fechaLista(); par.push(linha.trim()); }
    });
    fechaPar(); fechaLista();
    return saida;
  }
  function telaPagina() {
    var nome = estado.pagina;
    var caixa = el("article", { class: "pagina-legal" }, [el("p", { class: "aviso-carregando", text: "Carregando…" })]);
    app.appendChild(caixa);
    fetch("dados/juridico/" + nome + ".md").then(function (r) {
      if (!r.ok) throw new Error("Não foi possível abrir esta página (" + r.status + ").");
      return r.text();
    }).then(function (md) {
      caixa.innerHTML = "";
      caixa.appendChild(el("p", { class: "faixa-rascunho", role: "note", text: "RASCUNHO PARA REVISÃO JURÍDICA: este texto ainda não foi revisado por advogado e não vale como documento final." }));
      blocosMd(md).forEach(function (b) { caixa.appendChild(b); });
      caixa.appendChild(el("p", {}, [el("button", { type: "button", class: "botao discreto", text: "Voltar", onclick: function () { irPara("inicio"); } })]));
    }).catch(function (e) { caixa.innerHTML = ""; caixa.appendChild(el("p", { class: "erro-carga", role: "alert", text: e.message })); });
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-pagina]"), function (b) {
    b.addEventListener("click", function () { estado.pagina = b.getAttribute("data-pagina"); document.title = PAGINAS[estado.pagina] + " · Banca Aberta"; irPara("pagina"); });
  });

  // ---------- teclado ----------
  document.addEventListener("keydown", function (ev) {
    if (estado.tela !== "prova" || !estado.sessao || ev.target.tagName === "TEXTAREA" || ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT") return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var s = estado.sessao;
    var k = ev.key.toUpperCase();
    var achado = buscarQuestao(s.refs[s.atual]);
    if (achado && achado.q.alternativas && achado.q.alternativas[k]) {
      s.respostas[idRef(s.refs[s.atual])] = k; salvarSessao(); desenhar();
    } else if (ev.key === "ArrowRight" && s.atual < s.refs.length - 1) { s.atual++; salvarSessao(); desenhar(); }
    else if (ev.key === "ArrowLeft" && s.atual > 0) { s.atual--; salvarSessao(); desenhar(); }
  });

  // ---------- início ----------
  function erroGeral(e) {
    app.innerHTML = "";
    app.appendChild(el("p", { class: "erro-carga", role: "alert", text: e.message || String(e) }));
  }
  document.getElementById("ir-inicio").addEventListener("click", function () { irPara("inicio"); });
  document.getElementById("nav-inicio").addEventListener("click", function () { irPara(estado.sessao && !estado.sessao.fim ? "prova" : "inicio"); });
  document.getElementById("nav-historico").addEventListener("click", function () { irPara("historico"); });

  carregarJSON("dados/indice.json").then(function (indice) {
    estado.indice = indice;
    if (!indice.edicoes.length) throw new Error("O banco de questões ainda está vazio.");
    Object.keys(indice.formatos || {}).forEach(function (v) {
      var f = indice.formatos[v];
      if (VESTIBULARES[v]) {
        VESTIBULARES[v].tamanho = f.questoes;
        VESTIBULARES[v].horas = f.horas;
        VESTIBULARES[v].formato = f;
      }
    });
    desenhar();
  }).catch(erroGeral);

  var redimensionar = null;
  window.addEventListener("resize", function () {
    clearTimeout(redimensionar);
    redimensionar = setTimeout(function () {
      var g = document.querySelector(".grafico-caixa");
      if (g && g.desenhar) g.desenhar();
    }, 150);
  });

  window.BancaAberta = { estado: estado, irPara: irPara };
})();
