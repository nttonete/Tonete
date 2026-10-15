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
    if (window.Nuvem) Nuvem.alterado(chave); // sobe para a conta quando o aluno estiver logado
  }
  function logado() { return !!(window.Nuvem && Nuvem.ativa() && Nuvem.usuario()); }
  // onde ficam os dados do aluno, para os textos da tela
  function ondeGuarda() { return logado() ? "na sua conta" : "neste aparelho"; }
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
        limite: cfg.limite || null, tarefa: cfg.tarefa || null,
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
    if (s.tarefa) marcarTarefa(s.tarefa, true);
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
    var aba = { historico: "nav-historico", plano: "nav-plano", erros: "nav-plano", guias: "nav-guias", redacao: "nav-guias", conta: "nav-conta" }[tela] || "nav-inicio";
    ["nav-inicio", "nav-plano", "nav-guias", "nav-historico", "nav-conta"].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.setAttribute("aria-current", id === aba ? "page" : "false");
    });
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
    else if (estado.tela === "plano") telaPlano();
    else if (estado.tela === "erros") telaErros();
    else if (estado.tela === "guias") telaGuias();
    else if (estado.tela === "redacao") telaRedacao();
    else if (estado.tela === "conta" && window.Nuvem && Nuvem.ativa()) telaConta();
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

    // próximas provas (o calendário carrega à parte; sem ele, a faixa não aparece)
    var faixaProvas = el("div", { class: "faixa-provas" });
    app.appendChild(faixaProvas);
    carregarExtras().then(function () {
      var provas = proximasProvas().filter(function (p) { return p.f.id === "f1"; });
      if (!provas.length || !faixaProvas.isConnected) return;
      faixaProvas.appendChild(el("span", { class: "rotulo-sec", text: "Próximas provas" }));
      provas.forEach(function (p) {
        faixaProvas.appendChild(el("span", { class: "fp-item" }, [el("strong", { text: p.dias === 0 ? "Hoje" : p.dias + (p.dias === 1 ? " dia" : " dias") }), " " + VESTIBULARES[p.v].nome + " · " + dataCurtaIso(p.f.data)]));
      });
      faixaProvas.appendChild(el("button", { type: "button", class: "botao pequeno", text: lerPlano() ? "Ver meu plano" : "Montar plano de estudos", onclick: function () { irPara("plano"); } }));
    });

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
      app.appendChild(el("p", { class: "vazio", text: "Você ainda não terminou nenhum simulado ou treino. Os resultados aparecem aqui, guardados " + ondeGuarda() + "." }));
      return;
    }
    var vests = Object.keys(VESTIBULARES).filter(function (v) { return hist.some(function (h) { return (h.questoes || []).some(function (q) { return q.v === v; }); }); });
    app.appendChild(el("div", { class: "filtros" }, [
      segmento("Período", PERIODOS, f.periodo, function (v) { f.periodo = v; desenhar(); }),
      segmento("Vestibular", [["todos", "Todos"]].concat(vests.map(function (v) { return [v, VESTIBULARES[v].nome]; })), f.vest, function (v) { f.vest = v; desenhar(); }),
    ]));
    var treinos = recorte(hist, f);
    var totalHist = hist.reduce(function (s, h) { return s + (h.total || 0); }, 0);
    cab.appendChild(el("p", { class: "sub", text: (logado() ? "Guardado na sua conta · " : "Guardado só neste aparelho · ") + plural(hist.length, "treino", "treinos") + " · " + plural(totalHist, "questão", "questões") + " no total. Os números são estimativas para estudo." }));
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

  // ---------- datas ----------
  var MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  var SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  var SEMANA_LONGA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function deIso(s) { var p = s.split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function hojeIso() { return iso(new Date()); }
  function somaDias(s, n) { var d = deIso(s); d.setDate(d.getDate() + n); return iso(d); }
  function diasEntre(a, b) { return Math.round((deIso(b) - deIso(a)) / DIA); }
  function dataExtensa(s) { var d = deIso(s); return SEMANA_LONGA[d.getDay()] + ", " + d.getDate() + " de " + MESES[d.getMonth()]; }
  function dataCurtaIso(s) { var d = deIso(s); return d.getDate() + " " + MESES[d.getMonth()]; }
  function horaTexto(h) { return h ? h.replace(/^0/, "").replace(":00", "h").replace(":", "h") : ""; }

  // ---------- dados extras (calendário, obras, temas de redação) ----------
  function carregarExtras() {
    if (estado.extras) return Promise.resolve(estado.extras);
    if (estado.carregandoExtras) return estado.carregandoExtras;
    function opcional(url) { return carregarJSON(url).catch(function () { return null; }); }
    estado.carregandoExtras = Promise.all([
      opcional("dados/provas/calendario.json"), opcional("dados/conteudo/obras.json"), opcional("dados/conteudo/redacao-temas.json"),
    ]).then(function (r) {
      estado.extras = { calendario: r[0], obras: r[1], temas: r[2] };
      return estado.extras;
    });
    return estado.carregandoExtras;
  }
  // Próximas provas (fase a fase) dos vestibulares pedidos, da mais próxima para a mais distante.
  function proximasProvas(vests, desde) {
    var cal = estado.extras && estado.extras.calendario;
    if (!cal) return [];
    var hoje = desde || hojeIso();
    var lista = [];
    (vests || Object.keys(cal.vestibulares)).forEach(function (v) {
      var c = cal.vestibulares[v];
      if (!c) return;
      c.fases.forEach(function (f) { if (f.data >= hoje) lista.push({ v: v, f: f, dias: diasEntre(hoje, f.data) }); });
    });
    return lista.sort(function (a, b) { return a.f.data < b.f.data ? -1 : a.f.data > b.f.data ? 1 : 0; });
  }
  function rotuloDias(n) { return n === 0 ? "hoje" : n === 1 ? "amanhã" : "em " + n + " dias"; }

  // ---------- caderno de erros (revisão espaçada) ----------
  // Cada questão que o aluno já errou volta para revisão: 1 dia depois do erro, e depois de 3, 7 e 21 dias
  // a cada acerto seguido. Três acertos seguidos depois do erro: a questão está dominada.
  var INTERVALOS = [1, 3, 7, 21];
  function cadernoDeErros(hist) {
    var tent = {};
    hist.forEach(function (h) {
      (h.questoes || []).forEach(function (q) {
        var t = tent[q.id] = tent[q.id] || { q: q, lista: [] };
        t.lista.push({ quando: h.quando, ok: q.ok });
      });
    });
    var agora = Date.now(), saida = [];
    Object.keys(tent).forEach(function (id) {
      var t = tent[id];
      var l = t.lista.sort(function (a, b) { return a.quando - b.quando; });
      if (!l.some(function (x) { return !x.ok; })) return;
      var seguidos = 0;
      for (var i = l.length - 1; i >= 0 && l[i].ok; i--) seguidos++;
      var ultima = l[l.length - 1].quando;
      var item = { id: id, ed: t.q.ed, n: t.q.n, v: t.q.v, m: t.q.m, a: t.q.a, tentativas: l.length, erros: l.filter(function (x) { return !x.ok; }).length, seguidos: seguidos, ultima: ultima };
      if (seguidos >= 3) { item.estado = "dominada"; item.proxima = null; }
      else {
        var alvo = new Date(ultima); alvo.setHours(0, 0, 0, 0); alvo.setDate(alvo.getDate() + INTERVALOS[seguidos]);
        item.proxima = alvo.getTime();
        item.estado = alvo.getTime() <= agora ? "vencida" : "agendada";
      }
      saida.push(item);
    });
    return saida;
  }
  function revisarErros(itens, titulo, tarefa) {
    var refs = itens.slice(0, 20).map(function (q) { return { ed: q.ed, n: q.n, materia: q.m, v: q.v }; });
    return iniciarSessao({ modo: "erros", refs: refs, titulo: titulo || "Revisão do caderno de erros · " + refs.length + " questões", filtro: { tipo: "objetiva" }, tarefa: tarefa });
  }

  // ---------- plano de estudos ----------
  var CHAVE_PLANO = "banca-aberta:plano";
  var MIN_POR_QUESTAO = 10 / 3; // 3min20, o ritmo das provas
  function lerPlano() { return ler(CHAVE_PLANO, null); }
  function gravarPlano(p) { gravar(CHAVE_PLANO, p); }

  // Peso de cada matéria no vestibular: a cota do edital (Unicamp) ou a proporção no banco de questões.
  function pesosMaterias(v) {
    var f = VESTIBULARES[v] && VESTIBULARES[v].formato, pesos = {};
    if (f && f.distribuicao) {
      Object.keys(f.distribuicao).forEach(function (k) {
        var ms = k.split("+");
        ms.forEach(function (m) { pesos[m] = (pesos[m] || 0) + f.distribuicao[k] / ms.length; });
      });
    } else {
      estado.indice.edicoes.forEach(function (e) {
        if (e.vestibular !== v || e.tipo !== "objetiva") return;
        Object.keys(e.materias).forEach(function (m) { pesos[m] = (pesos[m] || 0) + e.materias[m]; });
      });
    }
    var total = Object.keys(pesos).reduce(function (s, m) { return s + pesos[m]; }, 0) || 1;
    Object.keys(pesos).forEach(function (m) { pesos[m] /= total; });
    return pesos;
  }
  // Acerto por matéria e assuntos fracos, a partir do histórico.
  function retrato(hist, v) {
    var feitas = questoesDoRecorte(recorte(hist, { periodo: "tudo", vest: v }));
    var mat = {}, grupos = {};
    feitas.forEach(function (q) {
      var x = mat[q.m] = mat[q.m] || { certas: 0, total: 0 }; x.total++; if (q.ok) x.certas++;
      if (q.a) { var g = grupos[q.m + "|" + q.a] = grupos[q.m + "|" + q.a] || { m: q.m, a: q.a, certas: 0, total: 0 }; g.total++; if (q.ok) g.certas++; }
    });
    var fracos = Object.keys(grupos).map(function (k) { return grupos[k]; })
      .filter(function (g) { return g.total >= 3 && g.certas / g.total < 0.6; })
      .sort(function (a, b) { return a.certas / a.total - b.certas / b.total || b.total - a.total; });
    return { materias: mat, fracos: fracos };
  }

  // Gera as tarefas de cada dia de estudo, do início do plano até a última prova escolhida.
  // Os dias até hoje ficam guardados como foram gerados; os seguintes se ajustam ao desempenho atual.
  function gerarPlano(plano, hist) {
    var cfg = plano.config, cal = estado.extras.calendario;
    var provas = proximasProvas(cfg.vests, cfg.inicio).filter(function (p) { return cfg.segundaFase || p.f.id === "f1"; });
    if (!provas.length) return { dias: [], provas: [] };
    var fim = provas[provas.length - 1].f.data;
    var minutosDia = Math.round((cfg.horas * 60) / cfg.dias.length);
    var info = {};
    cfg.vests.forEach(function (v) { info[v] = { pesos: pesosMaterias(v), r: retrato(hist, v), dado: {}, fraco: 0 }; });
    var temErros = cadernoDeErros(hist).length > 0;
    var obras = estado.extras.obras, lidas = ler("banca-aberta:obras-lidas", {});
    var filaObras = [];
    cfg.vests.slice().sort(function (a, b) { return a === provas[0].v ? -1 : b === provas[0].v ? 1 : 0; }).forEach(function (v) {
      var lista = obras && obras.listas[v] ? obras.listas[v].obras : [];
      lista.forEach(function (id) { if (!lidas[id] && filaObras.indexOf(id) < 0) filaObras.push(id); });
    });
    var leituras = [];
    filaObras.forEach(function (id) { leituras.push({ id: id, parte: 1 }, { id: id, parte: 2 }); });
    var temas = estado.extras.temas ? estado.extras.temas.propostas.filter(function (p) { return cfg.vests.indexOf(p.vestibular) >= 0 && p.tema; }) : [];
    var dias = [], k = 0, semanaSimulado = {}, semanaRedacao = {}, nTema = 0;
    for (var d = cfg.inicio; d <= fim; d = somaDias(d, 1)) {
      var prova = provas.filter(function (p) { return p.f.data === d; });
      if (prova.length) { dias.push({ data: d, prova: prova, tarefas: [] }); continue; }
      var wd = deIso(d).getDay();
      if (cfg.dias.indexOf(wd) < 0) continue;
      var prox = provas.filter(function (p) { return p.f.data > d; })[0];
      var faltam = diasEntre(d, prox.f.data);
      var v = prox.v;
      var semana = Math.floor(diasEntre(cfg.inicio, d) / 7);
      var tarefas = [];
      if (faltam === 1) {
        tarefas.push({ tipo: "vespera", titulo: "Véspera da prova: confira o que levar e descanse", detalhe: VESTIBULARES[v].nome + " · " + prox.f.nome + " amanhã às " + horaTexto(prox.f.inicio) + ". Nada de maratona hoje.", min: 20, acao: { guia: "dia", v: v } });
        dias.push({ data: d, tarefas: tarefas, prox: prox });
        k++;
        continue;
      }
      var resta = minutosDia;
      var discursiva = prox.f.id !== "f1";
      // vestibular do dia: o mais próximo pesa mais, os outros entram em rodízio
      if (cfg.vests.length > 1 && faltam > 21 && k % 3 === 2) v = cfg.vests[(k / 3 | 0) % cfg.vests.length];
      var I = info[v];
      // 1) simulado no horário real, uma vez por semana, no último dia de estudo da semana
      var ultimoDiaSemana = cfg.dias.slice().sort(function (a, b) { return (a || 7) - (b || 7); }).pop();
      if (!discursiva && !semanaSimulado[semana] && wd === ultimoDiaSemana && resta >= 60) {
        semanaSimulado[semana] = true;
        var qtd = Math.min(VESTIBULARES[v].tamanho, Math.max(15, Math.floor(resta / MIN_POR_QUESTAO / 15) * 15));
        var cheio = qtd >= VESTIBULARES[v].tamanho;
        var fase = estado.extras.calendario.vestibulares[v].fases[0];
        tarefas.push({ tipo: "simulado", titulo: (cheio ? "Simulado completo " : "Simulado ") + VESTIBULARES[v].nome + " · " + qtd + " questões",
          detalhe: "Comece às " + horaTexto(fase.inicio) + ", como no dia da prova, com o cronômetro ligado.", min: Math.round(qtd * MIN_POR_QUESTAO), acao: { simulado: { v: v, qtd: qtd } } });
        resta -= Math.round(qtd * MIN_POR_QUESTAO);
      }
      // 2) revisão do caderno de erros, a cada 3 dias de estudo
      if (temErros && k % 3 === 0 && resta >= 25) {
        tarefas.push({ tipo: "erros", titulo: "Revisão do caderno de erros", detalhe: "Refaça as questões que venceram a data de revisão.", min: 25, acao: { erros: true } });
        resta -= 25;
      }
      // 3) assunto fraco, em dias alternados
      if (!discursiva && I.r.fracos.length && k % 2 === 1 && resta >= 35) {
        var g = I.r.fracos[I.fraco++ % I.r.fracos.length];
        tarefas.push({ tipo: "fraco", titulo: g.a + " (" + MATERIAS[g.m] + ")", detalhe: "Assunto em que você acertou " + pct(g.certas, g.total) + "% na " + VESTIBULARES[v].nome + ". 10 questões.", min: 35,
          acao: { treino: { v: v, materias: [g.m], assunto: g.a, qtd: 10 } } });
        resta -= 35;
      }
      // 4) leitura de obra obrigatória, em dias alternados
      if (leituras.length && k % 2 === 0 && resta >= 40) {
        var l = leituras.shift();
        var ob = obras.obras[l.id];
        tarefas.push({ tipo: "leitura", titulo: "Leitura: " + (ob ? ob.titulo : l.id) + " (" + l.parte + "/2)", detalhe: (ob ? ob.autor + ". " : "") + (l.parte === 1 ? "Leia a primeira metade e o guia da obra." : "Termine a leitura e responda às perguntas do guia."), min: 45, acao: { obra: l.id } });
        resta -= 45;
      }
      // 5) redação, uma por semana, se a 2ª fase está no plano
      if (cfg.segundaFase && temas.length && !semanaRedacao[semana] && resta >= 60 && (discursiva || k % 4 === 3)) {
        semanaRedacao[semana] = true;
        var t = temas[nTema++ % temas.length];
        tarefas.push({ tipo: "redacao", titulo: "Redação: " + VESTIBULARES[t.vestibular].nome + " " + t.ano, detalhe: t.tema, min: 60, acao: { redacao: { v: t.vestibular, ano: t.ano, proposta: t.proposta } } });
        resta -= 60;
      }
      // 6) discursivas na reta da 2ª fase
      if (discursiva && resta >= 40) {
        tarefas.push({ tipo: "discursiva", titulo: "Discursivas " + VESTIBULARES[v].nome, detalhe: "3 questões da 2ª fase, comparando com a resposta esperada pela banca.", min: 40, acao: { discursiva: { v: v, qtd: 3 } } });
        resta -= 40;
      }
      // 7) o resto do tempo: matérias na proporção do edital, puxando mais as de menor acerto
      var guarda = 0;
      while (resta >= 15 && guarda++ < 4) {
        var melhor = null, nota = -1;
        Object.keys(I.pesos).forEach(function (m) {
          var x = I.r.materias[m], acerto = x && x.total >= 5 ? x.certas / x.total : 0.5;
          var alvo = I.pesos[m] * (1.5 - acerto), feito = (I.dado[m] || 0) + 1;
          if (alvo / feito > nota) { nota = alvo / feito; melhor = m; }
        });
        if (!melhor) break;
        var q = resta >= 35 ? 10 : 5;
        I.dado[melhor] = (I.dado[melhor] || 0) + 1;
        tarefas.push({ tipo: "materia", titulo: MATERIAS[melhor] + " · " + q + " questões", detalhe: "Questões da " + VESTIBULARES[v].nome + ", de todos os anos.", min: Math.round(q * MIN_POR_QUESTAO),
          acao: { treino: { v: v, materias: [melhor], qtd: q } } });
        resta -= Math.round(q * MIN_POR_QUESTAO);
      }
      dias.push({ data: d, tarefas: tarefas, prox: prox });
      k++;
    }
    // ids estáveis por dia e posição
    dias.forEach(function (dia) { dia.tarefas.forEach(function (t, i) { t.id = dia.data + ":" + i + ":" + t.tipo; }); });
    // dias até hoje: usa o que já foi gerado
    var hoje = hojeIso(), mudou = false;
    plano.dias = plano.dias || {};
    dias.forEach(function (dia) {
      if (dia.data > hoje) return;
      if (plano.dias[dia.data]) dia.tarefas = plano.dias[dia.data];
      else { plano.dias[dia.data] = dia.tarefas; mudou = true; }
    });
    if (mudou) gravarPlano(plano);
    return { dias: dias, provas: provas };
  }
  function tarefaFeita(plano, id) { return !!(plano.feitas && plano.feitas[id]); }
  function marcarTarefa(id, feita) {
    var p = lerPlano();
    if (!p) return;
    p.feitas = p.feitas || {};
    if (feita) p.feitas[id] = Date.now(); else delete p.feitas[id];
    gravarPlano(p);
  }
  function executarTarefa(t) {
    var a = t.acao || {};
    if (a.treino) {
      return iniciarSessao({ modo: "materia", quantidade: a.treino.qtd, materias: a.treino.materias, assunto: a.treino.assunto, anoMin: 0,
        titulo: (a.treino.assunto ? "Treino · " + a.treino.assunto : "Treino · " + MATERIAS[a.treino.materias[0]]) + " · " + VESTIBULARES[a.treino.v].nome,
        filtro: { vestibulares: [a.treino.v], tipo: "objetiva" }, tarefa: t.id }).catch(erroGeral);
    }
    if (a.simulado) {
      var info = VESTIBULARES[a.simulado.v], qtd = a.simulado.qtd;
      return iniciarSessao({ modo: "simulado", titulo: "Simulado " + info.nome + " · " + qtd + " questões", quantidade: qtd,
        filtro: { vestibulares: [a.simulado.v], tipo: "objetiva" }, horas: qtd === info.tamanho ? info.horas : null,
        distribuicao: info.formato && info.formato.distribuicao, limite: Math.round((info.horas * 3600000 * qtd) / info.tamanho), tarefa: t.id }).catch(erroGeral);
    }
    if (a.discursiva) {
      return iniciarSessao({ modo: "materia", quantidade: a.discursiva.qtd, materias: [], anoMin: 0, titulo: "Discursivas · " + VESTIBULARES[a.discursiva.v].nome,
        filtro: { vestibulares: [a.discursiva.v], tipo: "discursiva" }, tarefa: t.id }).catch(erroGeral);
    }
    if (a.erros) {
      var venc = cadernoDeErros(ler(CHAVE_HIST, [])).filter(function (q) { return q.estado === "vencida"; });
      if (!venc.length) { marcarTarefa(t.id, true); desenhar(); return; }
      return revisarErros(embaralhar(venc), null, t.id).catch(erroGeral);
    }
    if (a.obra) { estado.guia = { aba: "obras", obra: a.obra }; return irPara("guias"); }
    if (a.redacao) { estado.redacao = { v: a.redacao.v, ano: a.redacao.ano, proposta: a.redacao.proposta, tarefa: t.id }; return irPara("redacao"); }
    if (a.guia) { estado.guia = { aba: "dia", v: a.guia.v }; return irPara("guias"); }
  }

  // Contagem regressiva das próximas provas (faixa de destaque).
  function faixaContagem(vests, titulo, semBotao) {
    var provas = proximasProvas(vests);
    if (!provas.length) return null;
    var p = provas[0];
    var outras = provas.slice(1).filter(function (x) { return x.f.id === "f1" || x.v === p.v; }).slice(0, 3);
    return el("section", { class: "banda contagem", "aria-label": "Contagem regressiva" }, [
      el("div", { class: "banda-topo" }, [
        el("div", { class: "heroi" }, [
          el("span", { class: "rotulo-sec", text: titulo || "Próxima prova" }),
          el("div", { class: "heroi-num" }, p.dias === 0 ? ["Hoje"] : [String(p.dias), el("small", { text: p.dias === 1 ? " dia" : " dias" })]),
          el("div", { class: "delta" }, [el("b", { text: VESTIBULARES[p.v].nome + " · " + p.f.nome }), " " + dataExtensa(p.f.data) + ", às " + horaTexto(p.f.inicio) + ". Portões abrem às " + horaTexto(p.f.abertura_portoes) + "."]),
        ]),
        el("div", { class: "proximas" }, [
          el("span", { class: "rotulo-sec", text: "Depois" }),
          el("ol", {}, outras.map(function (x) {
            return el("li", {}, [el("span", { class: "pr-dias", text: x.dias + (x.dias === 1 ? " dia" : " dias") }), el("span", { text: VESTIBULARES[x.v].nome + " · " + x.f.nome }), el("span", { class: "pr-data", text: dataCurtaIso(x.f.data) })]);
          })),
          semBotao ? null : el("button", { type: "button", class: "botao claro pequeno", text: "Ver o dia da prova", onclick: function () { estado.guia = { aba: "dia", v: p.v }; irPara("guias"); } }),
        ]),
      ]),
    ]);
  }

  function telaPlano() {
    app.appendChild(el("p", { class: "aviso-carregando", text: "Carregando o plano…" }));
    carregarExtras().then(function () {
      app.innerHTML = "";
      if (!estado.extras.calendario) { app.appendChild(el("p", { class: "erro-carga", text: "Não foi possível carregar o calendário das provas." })); return; }
      var plano = lerPlano();
      if (!plano || estado.editandoPlano) return formularioPlano(plano);
      mostrarPlano(plano);
    }).catch(erroGeral);
  }

  function formularioPlano(plano) {
    var cfg = (plano && plano.config) || { vests: [], horas: 10, dias: [1, 2, 3, 4, 6], segundaFase: true };
    app.appendChild(el("div", { class: "prova-cab" }, [el("h1", { text: plano ? "Ajustar o plano" : "Monte seu plano de estudos" }),
      el("p", { class: "sub", text: "Diga para qual vestibular, quanto tempo tem e em que dias estuda. O plano distribui as matérias pelo peso do edital, puxa os assuntos em que você mais erra e traz de volta as questões erradas para revisar." })]));
    var form = el("form", { class: "painel plano-form", id: "form-plano" });
    var vests = Object.keys(VESTIBULARES).map(function (v) {
      var prox = proximasProvas([v])[0];
      return { valor: v, rotulo: VESTIBULARES[v].nome + (prox ? " · " + rotuloDias(prox.dias) : "") };
    });
    form.appendChild(el("fieldset", {}, [el("legend", { text: "Vestibulares" }), chips("plano-vest", vests, cfg.vests.length ? cfg.vests : ["fuvest"])]));
    var selH = el("select", { id: "plano-horas" });
    [3, 5, 8, 10, 12, 15, 20, 25, 30].forEach(function (h) { selH.appendChild(el("option", { value: h, text: h + " horas por semana", selected: h === cfg.horas })); });
    form.appendChild(el("label", { class: "campo", for: "plano-horas" }, [el("span", { text: "Tempo de estudo na plataforma" }), selH]));
    form.appendChild(el("fieldset", {}, [el("legend", { text: "Dias de estudo" }), chips("plano-dia", [1, 2, 3, 4, 5, 6, 0].map(function (d) { return { valor: String(d), rotulo: SEMANA[d] }; }), cfg.dias.map(String))]));
    form.appendChild(el("label", { class: "marcar", for: "plano-2fase" }, [el("input", { type: "checkbox", id: "plano-2fase", checked: cfg.segundaFase }), el("span", { text: "Incluir a 2ª fase: redação e questões discursivas depois da 1ª fase" })]));
    form.appendChild(el("p", { class: "dica", text: "O plano fica guardado " + ondeGuarda() + ". Você pode mudar tudo depois." }));
    form.appendChild(el("div", { class: "acoes-form" }, [
      el("button", { class: "botao", type: "submit", text: plano ? "Salvar e refazer o plano" : "Criar meu plano" }),
      plano ? el("button", { class: "botao discreto", type: "button", text: "Cancelar", onclick: function () { estado.editandoPlano = false; desenhar(); } }) : null,
    ]));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var vs = marcados(form, "plano-vest"), ds = marcados(form, "plano-dia").map(Number);
      if (!vs.length) return mostrarErro(form, "Escolha pelo menos um vestibular.");
      if (!ds.length) return mostrarErro(form, "Escolha pelo menos um dia de estudo.");
      var novo = { config: { vests: vs, horas: Number(selH.value), dias: ds, segundaFase: document.getElementById("plano-2fase").checked, inicio: hojeIso() },
        criado: Date.now(), dias: {}, feitas: (plano && plano.feitas) || {} };
      // mantém os dias já vividos do plano anterior (com o que foi feito), refaz daqui para frente
      if (plano && plano.dias) Object.keys(plano.dias).forEach(function (d) { if (d < hojeIso()) novo.dias[d] = plano.dias[d]; });
      if (plano && plano.config.inicio < hojeIso()) novo.config.inicio = plano.config.inicio;
      gravarPlano(novo);
      estado.editandoPlano = false;
      desenhar();
    });
    app.appendChild(form);
  }

  function linhaTarefa(plano, t, opc) {
    var feita = tarefaFeita(plano, t.id);
    var icones = { simulado: "◎", erros: "↺", fraco: "▲", leitura: "❡", redacao: "✎", discursiva: "¶", materia: "●", vespera: "☾" };
    var manual = t.tipo === "leitura" || t.tipo === "vespera" || t.tipo === "redacao";
    return el("li", { class: "tarefa" + (feita ? " feita" : "") }, [
      el("label", { class: "tarefa-marca", title: feita ? "Desmarcar" : "Marcar como feita" }, [
        el("input", { type: "checkbox", checked: feita, "aria-label": "Marcar como feita: " + t.titulo, onchange: function (ev) { marcarTarefa(t.id, ev.target.checked); desenhar(); } }),
        el("span", { class: "tarefa-bolha", "aria-hidden": "true" }),
      ]),
      el("div", { class: "tarefa-corpo" }, [
        el("span", { class: "tarefa-tipo", text: (icones[t.tipo] || "●") + " " + ({ simulado: "Simulado", erros: "Revisão", fraco: "Ponto fraco", leitura: "Leitura", redacao: "Redação", discursiva: "2ª fase", materia: "Treino", vespera: "Véspera" }[t.tipo] || "") + " · " + t.min + " min" }),
        el("strong", { text: t.titulo }),
        t.detalhe ? el("span", { class: "tarefa-det", text: t.detalhe }) : null,
      ]),
      opc && opc.semBotao ? null : el("button", { type: "button", class: "botao " + (feita ? "discreto" : "") + " pequeno", text: feita ? "Fazer de novo" : (manual ? "Abrir" : "Começar"), onclick: function () { executarTarefa(t); } }),
    ]);
  }

  function mostrarPlano(plano) {
    var hist = ler(CHAVE_HIST, []);
    var g = gerarPlano(plano, hist);
    var hoje = hojeIso();
    var cab = el("div", { class: "prova-cab" }, [el("h1", { text: "Seu plano de estudos" }),
      el("button", { type: "button", class: "botao discreto pequeno", text: "Ajustar plano", onclick: function () { estado.editandoPlano = true; desenhar(); } }),
      el("p", { class: "sub", text: plano.config.vests.map(function (v) { return VESTIBULARES[v].nome; }).join(", ") + " · " + plano.config.horas + " h por semana · " + plano.config.dias.slice().sort(function (a, b) { return (a || 7) - (b || 7); }).map(function (d) { return SEMANA[d]; }).join(", ") })]);
    app.appendChild(cab);
    var faixa = faixaContagem(plano.config.vests, "Faltam");
    if (faixa) app.appendChild(faixa);
    if (!g.dias.length) {
      app.appendChild(el("div", { class: "painel", style: "margin-top:1rem" }, [el("p", { class: "vazio", text: "As provas escolhidas já passaram. Ajuste o plano para o próximo vestibular." })]));
      return;
    }
    // hoje e atrasadas
    var diaHoje = g.dias.filter(function (d) { return d.data === hoje; })[0];
    var atrasadas = [];
    g.dias.forEach(function (d) {
      if (d.data < hoje && diasEntre(d.data, hoje) <= 7) d.tarefas.forEach(function (t) { if (!tarefaFeita(plano, t.id) && !(plano.dispensadas || {})[t.id]) atrasadas.push({ t: t, data: d.data }); });
    });
    var proximo = g.dias.filter(function (d) { return d.data > hoje && d.tarefas.length; })[0];
    var colHoje = el("section", { class: "painel" }, [el("div", { class: "painel-cab" }, [el("h2", { text: "Hoje" }), el("p", { text: dataExtensa(hoje) })])]);
    if (diaHoje && diaHoje.prova) {
      colHoje.appendChild(el("p", { class: "dia-prova", text: "Dia de prova: " + diaHoje.prova.map(function (p) { return VESTIBULARES[p.v].nome + " · " + p.f.nome + " às " + horaTexto(p.f.inicio); }).join("; ") + ". Boa prova!" }));
    } else if (diaHoje && diaHoje.tarefas.length) {
      var feitasHoje = diaHoje.tarefas.filter(function (t) { return tarefaFeita(plano, t.id); }).length;
      colHoje.appendChild(el("div", { class: "progresso-dia" }, [
        el("span", { class: "medidor" }, [el("i", { style: "width:" + Math.round((feitasHoje / diaHoje.tarefas.length) * 100) + "%" })]),
        el("span", { text: feitasHoje + " de " + diaHoje.tarefas.length + " feitas · cerca de " + diaHoje.tarefas.reduce(function (s, t) { return s + t.min; }, 0) + " min" }),
      ]));
      colHoje.appendChild(el("ol", { class: "tarefas" }, diaHoje.tarefas.map(function (t) { return linhaTarefa(plano, t); })));
    } else {
      colHoje.appendChild(el("p", { class: "vazio", text: "Hoje não é dia de estudo no seu plano." + (proximo ? " Próximo: " + dataExtensa(proximo.data) + "." : "") }));
      if (proximo) colHoje.appendChild(el("ol", { class: "tarefas previa" }, proximo.tarefas.map(function (t) { return linhaTarefa(plano, t); })));
    }
    if (atrasadas.length) {
      colHoje.appendChild(el("details", { class: "atrasadas" }, [
        el("summary", { text: plural(atrasadas.length, "tarefa ficou para trás", "tarefas ficaram para trás") + " nos últimos 7 dias" }),
        el("ol", { class: "tarefas" }, atrasadas.map(function (x) { return linhaTarefa(plano, x.t); })),
        el("button", { type: "button", class: "botao discreto pequeno", text: "Dispensar as atrasadas", onclick: function () {
          var p = lerPlano(); p.dispensadas = p.dispensadas || {};
          atrasadas.forEach(function (x) { p.dispensadas[x.t.id] = Date.now(); }); gravarPlano(p); desenhar();
        } }),
      ]));
    }
    // semana: os próximos 7 dias
    var semana = el("ol", { class: "semana" });
    for (var i = 0; i < 7; i++) {
      var d = somaDias(hoje, i);
      var dia = g.dias.filter(function (x) { return x.data === d; })[0];
      var feitas = dia ? dia.tarefas.filter(function (t) { return tarefaFeita(plano, t.id); }).length : 0;
      semana.appendChild(el("li", { class: "dia" + (i === 0 ? " hoje" : "") + (dia && dia.prova ? " dia-de-prova" : "") + (!dia ? " folga" : "") }, [
        el("span", { class: "dia-nome", text: i === 0 ? "Hoje" : SEMANA[deIso(d).getDay()] + " " + deIso(d).getDate() }),
        dia && dia.prova ? el("span", { class: "dia-prova-tag", text: dia.prova.map(function (p) { return VESTIBULARES[p.v].nome; }).join(" · ") })
          : dia ? el("ul", {}, dia.tarefas.map(function (t) { return el("li", { class: tarefaFeita(plano, t.id) ? "ok" : "", text: t.titulo }); }))
          : el("span", { class: "dia-folga", text: "Folga" }),
        dia && !dia.prova ? el("span", { class: "dia-min", text: dia.tarefas.reduce(function (s, t) { return s + t.min; }, 0) + " min" + (feitas ? " · " + feitas + "/" + dia.tarefas.length : "") }) : null,
      ]));
    }
    app.appendChild(el("div", { class: "grade-painel duas" }, [colHoje,
      el("section", { class: "painel" }, [el("div", { class: "painel-cab" }, [el("h2", { text: "Próximos 7 dias" }), el("p", { text: "O plano se ajusta ao seu desempenho todos os dias." })]), semana]),
    ]));
    // calendário até a prova
    app.appendChild(calendarioPlano(g, plano));
    // caderno de erros (resumo)
    var cad = cadernoDeErros(hist);
    var venc = cad.filter(function (q) { return q.estado === "vencida"; }).length;
    app.appendChild(el("section", { class: "painel", style: "margin-top:1rem" }, [
      el("div", { class: "painel-cab" }, [el("h2", { text: "Caderno de erros" }), el("p", { text: "Cada questão errada volta para revisão em 1, 3, 7 e 21 dias." })]),
      cad.length ? el("div", { class: "refazer" }, [
        el("p", {}, [el("strong", { text: plural(venc, "questão para revisar hoje", "questões para revisar hoje") }), " · " + plural(cad.length, "questão no caderno", "questões no caderno")]),
        el("button", { class: "botao pequeno", type: "button", text: "Abrir o caderno", onclick: function () { irPara("erros"); } }),
      ]) : el("p", { class: "dica", text: "As questões que você errar entram aqui automaticamente." }),
    ]));
  }

  // Calendário mês a mês até a última prova: bolinhas por dia de estudo, provas marcadas.
  function calendarioPlano(g, plano) {
    var porData = {};
    g.dias.forEach(function (d) { porData[d.data] = d; });
    var hoje = hojeIso(), ini = deIso(hoje), fim = deIso(g.dias[g.dias.length - 1].data);
    var meses = el("div", { class: "meses" });
    for (var m = new Date(ini.getFullYear(), ini.getMonth(), 1); m <= fim; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      var grade = el("div", { class: "mes-grade" }, ["D", "S", "T", "Q", "Q", "S", "S"].map(function (l) { return el("span", { class: "mes-sem", text: l }); }));
      for (var b = 0; b < m.getDay(); b++) grade.appendChild(el("span"));
      var nDias = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      for (var dd = 1; dd <= nDias; dd++) {
        var s = iso(new Date(m.getFullYear(), m.getMonth(), dd));
        var info = porData[s];
        var cls = "mes-dia" + (s === hoje ? " d-hoje" : "") + (s < hoje ? " d-passado" : "");
        var titulo = dataExtensa(s);
        if (info && info.prova) { cls += " d-prova"; titulo += ": " + info.prova.map(function (p) { return VESTIBULARES[p.v].nome + " " + p.f.nome; }).join(", "); }
        else if (info && info.tarefas.length) {
          var feitas = info.tarefas.filter(function (t) { return tarefaFeita(plano, t.id); }).length;
          cls += feitas === info.tarefas.length ? " d-estudo d-completo" : feitas ? " d-estudo d-parcial" : " d-estudo";
          titulo += ": " + info.tarefas.map(function (t) { return t.titulo; }).join("; ");
        }
        grade.appendChild(el("span", { class: cls, title: titulo, "aria-label": titulo, text: String(dd) }));
      }
      meses.appendChild(el("div", { class: "mes" }, [el("strong", { text: m.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) }), grade]));
    }
    return el("section", { class: "painel", style: "margin-top:1rem" }, [
      el("div", { class: "painel-cab" }, [el("h2", { text: "Até a prova" }), el("ul", { class: "legenda" }, [
        el("li", {}, [el("span", { class: "k-cal estudo" }), "dia de estudo"]), el("li", {}, [el("span", { class: "k-cal completo" }), "concluído"]), el("li", {}, [el("span", { class: "k-cal prova" }), "prova"]),
      ])]),
      meses,
    ]);
  }

  // ---------- caderno de erros (tela) ----------
  function telaErros() {
    var hist = ler(CHAVE_HIST, []);
    var cad = cadernoDeErros(hist);
    app.appendChild(el("div", { class: "prova-cab" }, [el("h1", { text: "Caderno de erros" }),
      el("p", { class: "sub", text: "As questões que você errou voltam em 1, 3, 7 e 21 dias. Acertou três vezes seguidas depois do erro, a questão sai da revisão." })]));
    if (!cad.length) { app.appendChild(el("div", { class: "painel" }, [el("p", { class: "vazio", text: "Nenhuma questão errada ainda. Faça um simulado ou treino: os erros entram aqui sozinhos." })])); return; }
    var venc = cad.filter(function (q) { return q.estado === "vencida"; });
    var agend = cad.filter(function (q) { return q.estado === "agendada"; });
    var dom = cad.filter(function (q) { return q.estado === "dominada"; });
    app.appendChild(el("section", { class: "banda" }, [
      el("div", { class: "banda-topo" }, [
        el("div", { class: "heroi" }, [el("span", { class: "rotulo-sec", text: "Para revisar hoje" }), el("div", { class: "heroi-num", text: String(venc.length) }),
          el("div", { class: "delta", text: venc.length ? "Revise agora: refazer na hora certa é o que fixa o conteúdo." : "Tudo em dia. A próxima revisão aparece aqui quando vencer." })]),
        el("div", { class: "proximas" }, [
          el("span", { class: "rotulo-sec", text: "No caderno" }),
          el("ol", {}, [
            el("li", {}, [el("span", { class: "pr-dias", text: String(venc.length) }), el("span", { text: "vencidas" })]),
            el("li", {}, [el("span", { class: "pr-dias", text: String(agend.length) }), el("span", { text: "agendadas" })]),
            el("li", {}, [el("span", { class: "pr-dias", text: String(dom.length) }), el("span", { text: "dominadas" })]),
          ]),
          venc.length ? el("button", { type: "button", class: "botao claro pequeno", text: "Revisar " + Math.min(20, venc.length) + " questões", onclick: function () { revisarErros(embaralhar(venc)).catch(erroGeral); } }) : null,
        ]),
      ]),
    ]));
    // por matéria e assunto
    var grupos = {};
    cad.filter(function (q) { return q.estado !== "dominada"; }).forEach(function (q) {
      var k = q.m + "|" + (q.a || "Sem assunto");
      var g = grupos[k] = grupos[k] || { m: q.m, a: q.a || "Sem assunto", itens: [] };
      g.itens.push(q);
    });
    var lista = Object.keys(grupos).map(function (k) { return grupos[k]; }).sort(function (a, b) {
      return ORDEM_MATERIAS.indexOf(a.m) - ORDEM_MATERIAS.indexOf(b.m) || b.itens.length - a.itens.length;
    });
    var corpo = el("tbody");
    lista.forEach(function (g) {
      var v = g.itens.filter(function (q) { return q.estado === "vencida"; }).length;
      var prox = g.itens.map(function (q) { return q.proxima; }).sort()[0];
      corpo.appendChild(el("tr", {}, [
        el("td", {}, [el("strong", { text: g.a }), el("small", { text: " " + MATERIAS[g.m] })]),
        el("td", { class: "n", text: String(g.itens.length) }),
        el("td", { class: "n", text: v ? v + " hoje" : "em " + dataCurtaIso(iso(new Date(prox))) }),
        el("td", { class: "n" }, [el("button", { type: "button", class: "botao discreto pequeno", text: "Revisar", onclick: function () { revisarErros(g.itens, "Revisão · " + g.a).catch(erroGeral); } })]),
      ]));
    });
    app.appendChild(el("section", { class: "secao" }, [el("h2", { text: "Por assunto" }), el("div", { class: "painel tabela-caixa" }, [el("table", { class: "historico" }, [
      el("thead", {}, [el("tr", {}, [el("th", { text: "Assunto" }), el("th", { class: "n", text: "Questões" }), el("th", { class: "n", text: "Próxima revisão" }), el("th", { class: "n", text: "" })])]),
      corpo,
    ])])]));
  }

  // ---------- guias: dia da prova, obras, redação ----------
  var DICAS_EQUIPE = [
    "Na véspera, separe documento original, canetas e o que é permitido levar. Confira o endereço e o horário do portão.",
    "Durma cedo nos dois dias antes da prova. A última noite pesa menos que a semana inteira de sono.",
    "Planeje chegar quando o portão abre: o trânsito e a fila de identificação costumam atrasar.",
    "Faça uma refeição leve antes e leve água e algo leve para comer, se o edital permitir.",
    "Distribua o tempo: na 1ª fase, cerca de 3 minutos por questão deixa folga para passar o gabarito.",
    "Comece pelo que você domina e marque as difíceis para voltar depois. Uma questão travada não vale mais que as outras.",
    "Passe as respostas para o cartão aos poucos, não tudo nos últimos minutos.",
    "Na 2ª fase, leia o enunciado inteiro, responda exatamente ao que foi pedido e mostre o raciocínio nos cálculos.",
  ];
  function telaGuias() {
    app.appendChild(el("p", { class: "aviso-carregando", text: "Carregando…" }));
    carregarExtras().then(function () {
      app.innerHTML = "";
      var gs = estado.guia = estado.guia || { aba: "dia" };
      app.appendChild(el("div", { class: "prova-cab" }, [el("h1", { text: "Guias" }), el("p", { class: "sub", text: "O dia da prova de cada vestibular, as obras de leitura obrigatória e a redação." })]));
      app.appendChild(el("div", { class: "filtros" }, [segmento("Guia", [["dia", "Dia da prova"], ["obras", "Obras obrigatórias"], ["redacao", "Redação"]], gs.aba, function (a) { estado.guia = { aba: a }; desenhar(); })]));
      if (gs.aba === "obras") guiaObras(gs);
      else if (gs.aba === "redacao") guiaRedacao(gs);
      else guiaDiaProva(gs);
    }).catch(erroGeral);
  }
  function listaIcone(itens, classe) { return el("ul", { class: "lista-icone " + classe }, itens.map(function (t) { return el("li", { text: t }); })); }
  function guiaDiaProva(gs) {
    var cal = estado.extras.calendario;
    if (!cal) { app.appendChild(el("p", { class: "erro-carga", text: "Não foi possível carregar o calendário." })); return; }
    var plano = lerPlano();
    var v = gs.v || (plano && plano.config.vests[0]) || (proximasProvas()[0] || {}).v || "fuvest";
    app.appendChild(el("div", { class: "filtros" }, [segmento("Vestibular", Object.keys(cal.vestibulares).map(function (x) { return [x, VESTIBULARES[x].nome]; }), v, function (x) { estado.guia = { aba: "dia", v: x }; desenhar(); })]));
    var c = cal.vestibulares[v];
    var faixa = faixaContagem([v], VESTIBULARES[v].nome + " " + c.edicao, true);
    if (faixa) app.appendChild(faixa);
    var tabela = el("table", { class: "historico" }, [
      el("thead", {}, [el("tr", {}, [el("th", { text: "Fase" }), el("th", { text: "Data" }), el("th", { class: "n", text: "Portões" }), el("th", { class: "n", text: "Início" }), el("th", { class: "n", text: "Duração" }), el("th", { class: "n", text: "Saída a partir de" })])]),
      el("tbody", {}, c.fases.map(function (f) {
        return el("tr", {}, [el("td", {}, [el("strong", { text: f.nome }), el("small", { class: "bloco", text: f.prova })]), el("td", { class: "d", text: dataExtensa(f.data) }),
          el("td", { class: "n", text: horaTexto(f.abertura_portoes) + (f.fechamento_portoes ? " às " + horaTexto(f.fechamento_portoes) : "") }), el("td", { class: "n", text: horaTexto(f.inicio) }),
          el("td", { class: "n", text: f.duracao_horas + " h" }), el("td", { class: "n", text: horaTexto(f.saida_a_partir) })]);
      })),
    ]);
    app.appendChild(el("section", { class: "painel", style: "margin-top:1rem" }, [el("div", { class: "painel-cab" }, [el("h2", { text: "Datas e horários" }), el("p", { text: "Horário de Brasília." })]), el("div", { class: "tabela-caixa" }, [tabela])]));
    app.appendChild(el("div", { class: "grade-painel tres" }, [
      el("section", { class: "painel" }, [el("h2", { text: "Leve" }), listaIcone(c.levar, "sim")]),
      el("section", { class: "painel" }, [el("h2", { text: "Pode" }), listaIcone(c.permitido, "pode")]),
      el("section", { class: "painel" }, [el("h2", { text: "Não pode" }), listaIcone(c.proibido, "nao")]),
    ]));
    app.appendChild(el("section", { class: "painel", style: "margin-top:1rem" }, [el("h2", { text: "Atenção" }), listaIcone(c.avisos, "aviso"),
      el("p", { class: "fontes" }, ["Regras oficiais tiradas de: "].concat(c.fontes.map(function (f, i) {
        return el("span", {}, [i ? " · " : "", el("a", { href: f.url, target: "_blank", rel: "noopener noreferrer", text: f.titulo })]);
      })).concat([". Conferido em " + dataCurtaIso(cal.conferido_em) + " " + cal.conferido_em.slice(0, 4) + ". Na dúvida, vale o edital."])),
    ]));
    app.appendChild(el("section", { class: "painel", style: "margin-top:1rem" }, [el("div", { class: "painel-cab" }, [el("h2", { text: "Dicas da equipe" }), el("p", { text: "Recomendações gerais, não são regra da banca." })]), el("ol", { class: "dicas" }, DICAS_EQUIPE.map(function (t) { return el("li", { text: t }); }))]));
  }
  function guiaObras(gs) {
    var O = estado.extras.obras;
    if (!O) { app.appendChild(el("div", { class: "painel" }, [el("p", { class: "vazio", text: "Os guias das obras ainda estão sendo preparados." })])); return; }
    var lidas = ler("banca-aberta:obras-lidas", {});
    if (gs.obra && O.obras[gs.obra]) return detalheObra(gs.obra, O.obras[gs.obra], lidas);
    var v = gs.v || "fuvest";
    app.appendChild(el("div", { class: "filtros" }, [segmento("Lista", [["fuvest", "FUVEST 2027"], ["unicamp", "Unicamp 2027"], ["unesp", "UNESP"]], v, function (x) { estado.guia = { aba: "obras", v: x }; desenhar(); })]));
    var lista = O.listas[v];
    if (!lista || !lista.obras.length) { app.appendChild(el("div", { class: "painel" }, [el("p", { class: "vazio", text: (lista && lista.nota) || "Sem lista de leitura obrigatória." })])); return; }
    var nLidas = lista.obras.filter(function (id) { return lidas[id]; }).length;
    app.appendChild(el("p", { class: "dica", style: "margin-bottom:.8rem" }, ["Lista oficial: ", lista.fonte ? el("a", { href: lista.fonte.url, target: "_blank", rel: "noopener noreferrer", text: lista.fonte.titulo }) : "", ". Você marcou " + nLidas + " de " + lista.obras.length + " como lidas."]));
    app.appendChild(el("ul", { class: "obras" }, lista.obras.map(function (id) {
      var ob = O.obras[id];
      if (!ob) return null;
      return el("li", { class: lidas[id] ? "lida" : "" }, [el("button", { type: "button", onclick: function () { estado.guia = { aba: "obras", v: v, obra: id }; desenhar(); window.scrollTo(0, 0); } }, [
        el("span", { class: "obra-ano", text: ob.ano + " · " + ob.genero }),
        el("strong", { class: "obra-titulo", text: ob.titulo }),
        el("span", { class: "obra-autor", text: ob.autor }),
        el("span", { class: "obra-estado", text: lidas[id] ? "✓ lida" : "Ler o guia" }),
      ])]);
    })));
  }
  function detalheObra(id, ob, lidas) {
    var voltar = el("button", { type: "button", class: "botao discreto pequeno", text: "← Todas as obras", onclick: function () { estado.guia = { aba: "obras", v: estado.guia.v }; desenhar(); } });
    app.appendChild(el("p", {}, [voltar]));
    var lida = !!lidas[id];
    app.appendChild(el("article", { class: "painel obra-guia" }, [
      el("span", { class: "rotulo-sec", text: ob.genero + " · " + ob.ano + (ob.origem ? " · " + ob.origem : "") }),
      el("h2", { class: "obra-h", text: ob.titulo }),
      el("p", { class: "obra-autor", text: ob.autor }),
      Array.isArray(ob.recorte) ? el("section", {}, [el("h3", { text: "O que cai (recorte da banca)" }), el("p", { text: ob.recorte.join(" · ") })]) : null,
      el("div", { class: "obra-acoes" }, [
        el("label", { class: "marcar" }, [el("input", { type: "checkbox", id: "obra-lida", checked: lida, onchange: function (ev) { var l = ler("banca-aberta:obras-lidas", {}); if (ev.target.checked) l[id] = Date.now(); else delete l[id]; gravar("banca-aberta:obras-lidas", l); } }), el("span", { text: "Já li esta obra" })]),
        ob.dominio_publico ? el("a", { href: "http://www.dominiopublico.gov.br/pesquisa/PesquisaObraForm.jsp", target: "_blank", rel: "noopener noreferrer", text: "Leitura gratuita: obra em domínio público (Biblioteca Domínio Público, MEC)" }) : null,
      ]),
      secaoGuia("Sobre o autor", ob.sobre_autor), secaoGuia("Contexto", ob.contexto), secaoGuia("Do que trata", ob.enredo_ou_conteudo),
      ob.temas && ob.temas.length ? el("section", {}, [el("h3", { text: "Temas" }), el("div", { class: "chips-fixos" }, ob.temas.map(function (t) { return el("span", { text: t }); }))]) : null,
      secaoGuia("Como costuma cair", ob.como_cai),
      ob.perguntas_para_estudo ? el("section", {}, [el("h3", { text: "Para pensar depois de ler" }), el("ol", { class: "dicas" }, ob.perguntas_para_estudo.map(function (p) { return el("li", { text: p }); }))]) : null,
      el("p", { class: "nota-rodape", text: "Guia escrito pela equipe Banca Aberta para estudo. Ele não substitui a leitura da obra." }),
    ]));
    var qs = ob.questoes || [];
    var obj = qs.filter(function (q) { return q.tipo === "objetiva"; }), disc = qs.filter(function (q) { return q.tipo === "discursiva"; });
    var caixa = el("section", { class: "painel", style: "margin-top:1rem" }, [el("h2", { text: "Questões do banco sobre a obra" })]);
    function botao(lista, rotulo, tipo) {
      return el("button", { type: "button", class: "botao pequeno", text: rotulo, onclick: function () {
        var refs = lista.slice(0, 20).map(function (q) { return { ed: q.ed, n: q.n, materia: "literatura" }; });
        iniciarSessao({ modo: "erros", refs: refs, titulo: "Obra · " + ob.titulo, filtro: { tipo: tipo } }).catch(erroGeral);
      } });
    }
    if (!qs.length) caixa.appendChild(el("p", { class: "dica", text: "Ainda não há questões desta obra no banco. Obras que entraram há pouco na lista costumam aparecer nas provas a partir deste ano." }));
    else caixa.appendChild(el("div", { class: "refazer" }, [
      el("p", {}, [el("strong", { text: plural(qs.length, "questão", "questões") }), " de provas anteriores (" + qs.map(function (q) { return q.ano; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort().join(", ") + ") falam da obra."]),
      el("span", { class: "acoes-form" }, [obj.length ? botao(obj, "Treinar " + plural(obj.length, "objetiva", "objetivas"), "objetiva") : null, disc.length ? botao(disc, "Treinar " + plural(disc.length, "discursiva", "discursivas"), "discursiva") : null]),
    ]));
    app.appendChild(caixa);
  }
  function secaoGuia(titulo, texto) { return texto ? el("section", {}, [el("h3", { text: titulo }), el("p", { text: texto })]) : null; }

  var REDACAO_INFO = {
    fuvest: { formato: "No 1º dia da 2ª fase, junto com 10 questões de Português. Há mais de uma proposta (como em 2026) e o candidato escolhe uma; quem não indicar a escolha tem nota zero. Redação com nota zero elimina.", criterios: { titulo: "Guia de Provas FUVEST 2027", url: "https://www.fuvest.br/wp-content/uploads/fuvest2027-guia-provas.pdf" } },
    unicamp: { formato: "No 1º dia da 2ª fase. São duas propostas de gêneros diferentes (carta, artigo de opinião, discurso, entre outros) e o candidato escolhe uma. Respeitar o gênero e a situação de produção conta muito.", criterios: { titulo: "Diretrizes de avaliação da Redação (Comvest)", url: "https://www.comvest.unicamp.br/wp-content/uploads/2025/05/Diretrizes-de-Avaliacao-da-Redacao-site.pdf" } },
    unesp: { formato: "No 2º dia da 2ª fase, com 12 questões de Linguagens. Texto em gênero dissertativo.", criterios: { titulo: "Manual do Candidato Unesp 2027 (critérios da redação)", url: "https://vestibular.unesp.br/Home/noticias/2026/08/251/manualdocandidatovnsp25141.pdf" } },
  };
  var CHECKLIST_REDACAO = [
    "Respondi exatamente ao que a proposta pede (tema e recorte).",
    "Respeitei o gênero pedido e a situação de produção (quem escreve, para quem, onde).",
    "Tenho uma tese clara logo no começo.",
    "Cada parágrafo traz um argumento desenvolvido, não só afirmado.",
    "Usei a coletânea a meu favor, sem copiar trechos.",
    "A conclusão retoma a tese e fecha o texto sem ideia nova solta.",
    "Revisei ortografia, concordância e pontuação.",
    "Respeitei o limite de linhas e escrevi com letra legível.",
  ];
  function guiaRedacao(gs) {
    var v = gs.v || "fuvest";
    app.appendChild(el("div", { class: "filtros" }, [segmento("Vestibular", [["fuvest", "FUVEST"], ["unicamp", "Unicamp"], ["unesp", "UNESP"]], v, function (x) { estado.guia = { aba: "redacao", v: x }; desenhar(); })]));
    var info = REDACAO_INFO[v];
    app.appendChild(el("div", { class: "grade-painel duas" }, [
      el("section", { class: "painel" }, [el("h2", { text: "Como é a redação" }), el("p", { text: info.formato }),
        el("p", { class: "fontes" }, ["Critérios oficiais: ", el("a", { href: info.criterios.url, target: "_blank", rel: "noopener noreferrer", text: info.criterios.titulo }), "."])]),
      el("section", { class: "painel" }, [el("h2", { text: "Checklist antes de entregar" }), listaIcone(CHECKLIST_REDACAO, "sim")]),
    ]));
    var temas = estado.extras.temas ? estado.extras.temas.propostas.filter(function (p) { return p.vestibular === v && p.tema; }) : [];
    var rascunhos = ler("banca-aberta:redacoes", []);
    var sec = el("section", { class: "secao" }, [el("h2", { text: "Propostas de anos anteriores" })]);
    if (!temas.length) sec.appendChild(el("p", { class: "dica", text: "Ainda não temos as propostas deste vestibular." }));
    else sec.appendChild(el("ul", { class: "temas" }, temas.map(function (t) {
      var feito = rascunhos.filter(function (r) { return r.v === v && r.ano === t.ano && r.proposta === t.proposta; })[0];
      return el("li", {}, [
        el("span", { class: "tema-ano", text: t.ano + (temas.filter(function (x) { return x.ano === t.ano; }).length > 1 ? " · proposta " + t.proposta : "") + (t.genero ? " · " + t.genero : "") }),
        el("strong", { text: t.tema }),
        t.situacao ? el("span", { class: "tema-sit", text: t.situacao }) : null,
        el("button", { type: "button", class: "botao " + (feito ? "discreto" : "") + " pequeno", text: feito ? "Continuar texto" : "Escrever", onclick: function () { estado.redacao = { v: v, ano: t.ano, proposta: t.proposta }; irPara("redacao"); } }),
      ]);
    })));
    app.appendChild(sec);
  }
  // Editor de redação: texto guardado no aparelho, contagem de palavras e linhas, checklist.
  function telaRedacao() {
    carregarExtras().then(function () {
      app.innerHTML = "";
      var r = estado.redacao || {};
      var t = estado.extras.temas ? estado.extras.temas.propostas.filter(function (p) { return p.vestibular === r.v && p.ano === r.ano && p.proposta === r.proposta; })[0] : null;
      var lista = ler("banca-aberta:redacoes", []);
      var atual = lista.filter(function (x) { return x.v === r.v && x.ano === r.ano && x.proposta === r.proposta; })[0];
      if (!atual) { atual = { v: r.v, ano: r.ano, proposta: r.proposta, texto: "", checklist: {}, criado: Date.now() }; lista.push(atual); }
      function salvar() { atual.atualizado = Date.now(); gravar("banca-aberta:redacoes", lista); }
      app.appendChild(el("div", { class: "prova-cab" }, [el("h1", { text: "Redação · " + (VESTIBULARES[r.v] ? VESTIBULARES[r.v].nome : "") + " " + (r.ano || "") }),
        el("button", { type: "button", class: "botao discreto pequeno", text: "← Propostas", onclick: function () { estado.guia = { aba: "redacao", v: r.v }; irPara("guias"); } })]));
      if (t) app.appendChild(el("section", { class: "painel tema-atual" }, [el("span", { class: "rotulo-sec", text: (t.genero || "Proposta") + (t.fonte ? "" : "") }), el("p", { class: "tema-grande", text: t.tema }), t.situacao ? el("p", { class: "dica", text: t.situacao }) : null,
        el("p", { class: "nota-rodape", text: "Leia a proposta completa, com a coletânea, no caderno oficial da prova." })]));
      var contagem = el("span", { class: "contagem" });
      var ta = el("textarea", { id: "redacao-texto", class: "redacao-texto", "aria-label": "Sua redação", placeholder: "Escreva aqui. O texto fica guardado " + ondeGuarda() + "." });
      ta.value = atual.texto || "";
      function contar() { var p = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0; contagem.textContent = p + " palavras · cerca de " + Math.ceil(ta.value.length / 70) + " linhas de caderno"; }
      ta.addEventListener("input", function () { atual.texto = ta.value; contar(); salvar(); });
      contar();
      var check = el("ul", { class: "checklist" }, CHECKLIST_REDACAO.map(function (c, i) {
        return el("li", {}, [el("label", { class: "marcar" }, [el("input", { type: "checkbox", checked: !!atual.checklist[i], onchange: function (ev) { atual.checklist[i] = ev.target.checked; salvar(); } }), el("span", { text: c })])]);
      }));
      app.appendChild(el("div", { class: "grade-painel duas" }, [
        el("section", { class: "painel" }, [ta, contagem]),
        el("section", { class: "painel" }, [el("h2", { text: "Antes de dar por terminada" }), check,
          el("p", { class: "nota-rodape", text: "A correção automática da redação ainda não está disponível. Use o checklist e os critérios oficiais para se autoavaliar." }),
          r.tarefa ? el("button", { type: "button", class: "botao", text: "Concluir a tarefa do plano", onclick: function () { salvar(); marcarTarefa(r.tarefa, true); irPara("plano"); } }) : null]),
      ]));
    }).catch(erroGeral);
  }

  // ---------- conta: login, assinatura e direitos do titular ----------
  // Só aparece quando o backend está configurado (app/config.js). A lógica de rede fica em app/nuvem.js.
  var VERSAO_TERMOS = "2026-10-15-rascunho", VERSAO_PRIVACIDADE = "2026-10-15-rascunho";
  var SENHA_MINIMA = 8;
  var ESTADOS_ASSINATURA = { pendente: "Aguardando pagamento", ativa: "Ativa", cancelada: "Não concluída", reembolsada: "Valor devolvido", expirada: "Encerrada" };
  function idade(nascIso) {
    var n = deIso(nascIso), h = new Date();
    var a = h.getFullYear() - n.getFullYear();
    if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
    return a;
  }
  function reais(centavos) { return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function dataLonga(ts) { return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }); }
  function campoTexto(rotulo, attrs) {
    return el("label", { class: "campo", for: attrs.id }, [el("span", { text: rotulo }), el("input", attrs)]);
  }
  function valorDe(form, id) { var i = form.querySelector("#" + id); return i ? i.value.trim() : ""; }
  function mostrarAviso(form, msg) {
    var e = form.querySelector(".erro-form");
    if (e) e.remove();
    var p = form.querySelector(".aviso-ok");
    if (!p) { p = el("p", { class: "aviso-ok", role: "status" }); form.appendChild(p); }
    p.textContent = msg;
  }
  // Roda uma ação da conta com os botões travados e mostra o erro no próprio formulário.
  function executar(form, acao) {
    var botoes = form.querySelectorAll("button");
    Array.prototype.forEach.call(botoes, function (b) { b.disabled = true; });
    var e0 = form.querySelector(".erro-form"); if (e0) e0.remove();
    return Promise.resolve().then(acao).catch(function (e) { mostrarErro(form, e.message); })
      .then(function () { Array.prototype.forEach.call(botoes, function (b) { b.disabled = false; }); });
  }
  function textoSinc() {
    var s = Nuvem.situacao(), n = Nuvem.pendentes();
    if (s === "sincronizando") return "Sincronizando…";
    if (s === "erro") return "Não foi possível sincronizar agora. Seus dados continuam neste aparelho e sobem na próxima tentativa.";
    if (n) return plural(n, "item aguardando", "itens aguardando") + " envio. Tudo continua guardado neste aparelho e sobe quando houver internet.";
    return "Tudo guardado na sua conta.";
  }
  function blocoMensagem(m) {
    if (!m) return null;
    if (m.erro) return el("p", { class: "erro-carga", role: "alert", text: m.erro });
    if (m.pagamento) {
      var textos = {
        aprovado: "Pagamento aprovado. A liberação do acesso pode levar alguns instantes.",
        pendente: "Pagamento em análise pelo Mercado Pago. O acesso é liberado assim que ele for confirmado.",
        recusado: "O pagamento não foi aprovado. Você pode tentar de novo.",
      };
      return el("p", { class: m.pagamento === "recusado" ? "erro-carga" : "aviso-ok", role: "status", text: textos[m.pagamento] || textos.pendente });
    }
    return m.aviso ? el("p", { class: "aviso-ok", role: "status", text: m.aviso }) : null;
  }
  // Os links para os Termos e a Privacidade voltam para a conta, sem perder o que foi digitado.
  function linkPagina(nome, texto) {
    return el("button", { type: "button", class: "link", text: texto, onclick: function () { estado.voltarPara = "conta"; abrirPagina(nome); } });
  }

  function telaConta() {
    var msg = estado.contaMsg;
    estado.contaMsg = null;
    if (Nuvem.recuperando()) return formNovaSenha(msg);
    if (!Nuvem.usuario()) return telaEntrar(msg);
    painelConta(msg);
  }

  function telaEntrar(msg) {
    var modo = estado.contaModo || "entrar";
    app.appendChild(el("div", { class: "prova-cab" }, [el("h1", { text: modo === "criar" ? "Criar conta" : "Entrar" }),
      el("p", { class: "sub", text: "Com uma conta, seu desempenho, seu plano e suas redações ficam guardados e aparecem em qualquer aparelho. Sem conta, tudo continua funcionando, só que neste aparelho." })]));
    var m = blocoMensagem(msg);
    if (m) app.appendChild(m);
    app.appendChild(el("div", { class: "filtros" }, [segmento("Conta", [["entrar", "Entrar"], ["criar", "Criar conta"]], modo, function (x) { estado.contaModo = x; desenhar(); })]));
    app.appendChild(modo === "criar" ? formCadastro() : formEntrar());
  }

  function formEntrar() {
    var form = el("form", { class: "painel plano-form", id: "form-entrar", novalidate: true }, [
      campoTexto("E-mail", { id: "conta-email", type: "email", autocomplete: "email", required: true }),
      campoTexto("Senha", { id: "conta-senha", type: "password", autocomplete: "current-password" }),
      el("div", { class: "acoes-form" }, [
        el("button", { class: "botao", type: "submit", text: "Entrar" }),
        el("button", { class: "botao discreto", type: "button", id: "conta-link", text: "Receber link de acesso por e-mail" }),
      ]),
      el("p", { class: "dica" }, [el("button", { type: "button", class: "link", id: "conta-esqueci", text: "Esqueci a senha" })]),
    ]);
    function email() {
      var e = valorDe(form, "conta-email");
      if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error("Digite seu e-mail.");
      return e;
    }
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      executar(form, function () {
        var senha = form.querySelector("#conta-senha").value;
        if (!senha) throw new Error("Digite sua senha, ou peça um link de acesso por e-mail.");
        return Nuvem.entrar(email(), senha).then(function () { estado.contaMsg = { aviso: "Você entrou na sua conta." }; desenhar(); });
      });
    });
    form.querySelector("#conta-link").addEventListener("click", function () {
      executar(form, function () {
        var e = email();
        return Nuvem.enviarLink(e).then(function () { mostrarAviso(form, "Enviamos um link de acesso para " + e + ". Abra o e-mail neste aparelho e toque no link."); });
      });
    });
    form.querySelector("#conta-esqueci").addEventListener("click", function () {
      executar(form, function () {
        var e = email();
        return Nuvem.recuperarSenha(e).then(function () { mostrarAviso(form, "Se houver conta com " + e + ", enviamos um link para criar uma nova senha."); });
      });
    });
    return form;
  }

  function formCadastro() {
    var r = estado.rascunhoCadastro = estado.rascunhoCadastro || {};
    var hoje = hojeIso();
    var resp = el("fieldset", { id: "cad-resp", hidden: true }, [
      el("legend", { text: "Responsável (menores de 18 anos)" }),
      el("div", { class: "plano-form" }, [
        campoTexto("Nome do pai, mãe ou responsável", { id: "cad-resp-nome", type: "text", autocomplete: "off" }),
        campoTexto("E-mail do responsável", { id: "cad-resp-email", type: "email", autocomplete: "off" }),
        el("label", { class: "marcar", for: "cad-resp-ciente" }, [el("input", { type: "checkbox", id: "cad-resp-ciente" }), el("span", { text: "Meu responsável sabe que estou criando esta conta." })]),
      ]),
    ]);
    var form = el("form", { class: "painel plano-form", id: "form-cadastro", novalidate: true }, [
      campoTexto("Seu nome", { id: "cad-nome", type: "text", autocomplete: "name" }),
      campoTexto("E-mail", { id: "cad-email", type: "email", autocomplete: "email" }),
      campoTexto("Senha (pelo menos " + SENHA_MINIMA + " caracteres)", { id: "cad-senha", type: "password", autocomplete: "new-password", minlength: SENHA_MINIMA }),
      campoTexto("Data de nascimento", { id: "cad-nasc", type: "date", max: hoje, min: "1900-01-01" }),
      resp,
      el("label", { class: "marcar", for: "cad-aceite" }, [el("input", { type: "checkbox", id: "cad-aceite" }),
        el("span", {}, ["Li e aceito os ", linkPagina("termos", "Termos de Uso"), " e a ", linkPagina("privacidade", "Política de Privacidade"), "."])]),
      el("p", { class: "dica", text: "O que você já fez neste aparelho (desempenho, plano e redações) vai junto para a conta." }),
      el("div", { class: "acoes-form" }, [el("button", { class: "botao", type: "submit", text: "Criar conta" })]),
    ]);
    // devolve o que já foi digitado (menos a senha) e guarda a cada mudança
    ["cad-nome", "cad-email", "cad-nasc", "cad-resp-nome", "cad-resp-email"].forEach(function (id) {
      var i = form.querySelector("#" + id);
      if (r[id]) i.value = r[id];
      i.addEventListener("input", function () { r[id] = i.value; mostrarResp(); });
    });
    ["cad-resp-ciente", "cad-aceite"].forEach(function (id) {
      var i = form.querySelector("#" + id);
      i.checked = !!r[id];
      i.addEventListener("change", function () { r[id] = i.checked; });
    });
    function menor() { var n = valorDe(form, "cad-nasc"); return /^\d{4}-\d{2}-\d{2}$/.test(n) && idade(n) < 18; }
    function mostrarResp() { resp.hidden = !menor(); }
    mostrarResp();
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      executar(form, function () {
        var d = {
          nome: valorDe(form, "cad-nome"), email: valorDe(form, "cad-email"), senha: form.querySelector("#cad-senha").value,
          nascimento: valorDe(form, "cad-nasc"), termos_versao: VERSAO_TERMOS, privacidade_versao: VERSAO_PRIVACIDADE,
        };
        if (!d.nome) throw new Error("Digite seu nome.");
        if (!/^\S+@\S+\.\S+$/.test(d.email)) throw new Error("Digite um e-mail válido.");
        if (d.senha.length < SENHA_MINIMA) throw new Error("A senha precisa ter pelo menos " + SENHA_MINIMA + " caracteres.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.nascimento) || d.nascimento > hoje || d.nascimento < "1900-01-01") throw new Error("Informe sua data de nascimento.");
        var anos = idade(d.nascimento);
        if (anos < 12) throw new Error("Contas para menores de 12 anos precisam ser criadas pelo pai, mãe ou responsável legal, e a plataforma ainda não oferece esse cadastro.");
        if (anos < 18) {
          d.responsavel_nome = valorDe(form, "cad-resp-nome");
          d.responsavel_email = valorDe(form, "cad-resp-email");
          if (!d.responsavel_nome || !/^\S+@\S+\.\S+$/.test(d.responsavel_email)) throw new Error("Para menores de 18 anos, informe o nome e o e-mail do responsável.");
          if (!form.querySelector("#cad-resp-ciente").checked) throw new Error("Confirme que seu responsável sabe do cadastro.");
        }
        if (!form.querySelector("#cad-aceite").checked) throw new Error("Para criar a conta, é preciso aceitar os Termos de Uso e a Política de Privacidade.");
        return Nuvem.cadastrar(d).then(function (res) {
          estado.rascunhoCadastro = null;
          if (res.entrou) { estado.contaMsg = { aviso: "Conta criada. Seu progresso agora fica guardado na conta." }; desenhar(); return; }
          estado.contaModo = "entrar";
          estado.contaMsg = { aviso: "Quase lá: enviamos um e-mail para " + d.email + ". Abra o link da mensagem para confirmar a conta (veja também o spam)." };
          desenhar();
        });
      });
    });
    return form;
  }

  function formNovaSenha(msg) {
    app.appendChild(el("div", { class: "prova-cab" }, [el("h1", { text: "Criar uma nova senha" })]));
    var m = blocoMensagem(msg);
    if (m) app.appendChild(m);
    var form = el("form", { class: "painel plano-form", id: "form-nova-senha", novalidate: true }, [
      campoTexto("Nova senha (pelo menos " + SENHA_MINIMA + " caracteres)", { id: "nova-senha", type: "password", autocomplete: "new-password", minlength: SENHA_MINIMA }),
      el("div", { class: "acoes-form" }, [el("button", { class: "botao", type: "submit", text: "Salvar a nova senha" })]),
    ]);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      executar(form, function () {
        var s = form.querySelector("#nova-senha").value;
        if (s.length < SENHA_MINIMA) throw new Error("A senha precisa ter pelo menos " + SENHA_MINIMA + " caracteres.");
        return Nuvem.definirSenha(s).then(function () { estado.contaMsg = { aviso: "Senha alterada." }; desenhar(); });
      });
    });
    app.appendChild(form);
  }

  function painelConta(msg) {
    var u = Nuvem.usuario();
    app.appendChild(el("div", { class: "prova-cab" }, [el("h1", { text: "Sua conta" }), el("p", { class: "sub", text: u.email })]));
    var m = blocoMensagem(msg);
    if (m) app.appendChild(m);

    var sinc = el("section", { class: "painel" }, [el("h2", { text: "Seus dados de estudo" }),
      el("p", { id: "conta-sinc", class: "dica", role: "status", text: textoSinc() }),
      el("div", { class: "acoes-form" }, [el("button", { type: "button", class: "botao discreto pequeno", text: "Sincronizar agora", onclick: function () {
        Nuvem.sincronizar().catch(function (e) { var l = document.getElementById("conta-sinc"); if (l) l.textContent = e.message; });
      } })])]);
    var assinatura = el("section", { class: "painel", id: "conta-assinatura" }, [el("h2", { text: "Assinatura" }), el("p", { class: "aviso-carregando", text: "Carregando…" })]);
    var perfil = el("section", { class: "painel", id: "conta-perfil" }, [el("h2", { text: "Seu cadastro" }), el("p", { class: "aviso-carregando", text: "Carregando…" })]);
    app.appendChild(el("div", { class: "grade-painel duas conta-grade" }, [sinc, assinatura]));
    app.appendChild(el("div", { class: "grade-painel duas conta-grade" }, [perfil, painelPrivacidade()]));
    app.appendChild(el("div", { class: "acoes-form conta-sair" }, [el("button", { type: "button", class: "botao discreto", id: "conta-sair", text: "Sair da conta", onclick: function (ev) { sairDaConta(ev.target.parentNode, false); } })]));

    carregarAssinatura(assinatura, msg && msg.pagamento === "aprovado" ? 6 : 0);
    Nuvem.perfil().then(function (p) { preencherPerfil(perfil, p || {}); })
      .catch(function (e) { perfil.lastChild.replaceWith(el("p", { class: "erro-carga", text: e.message })); });
  }

  // Assinatura: situação atual, planos à venda (preço total e duração) e pagamentos anteriores.
  // Depois de um pagamento aprovado, consulta de novo algumas vezes até o aviso do Mercado Pago chegar.
  function carregarAssinatura(sec, novasTentativas) {
    Promise.all([Nuvem.assinaturas(), Nuvem.planos().catch(function () { return null; })]).then(function (r) {
      if (!sec.isConnected) return;
      var lista = r[0] || [], planos = r[1], agora = Date.now();
      var ativas = lista.filter(function (a) { return a.status === "ativa" && (!a.fim || Date.parse(a.fim) > agora); });
      var ate = ativas.reduce(function (m, a) { return a.fim ? Math.max(m, Date.parse(a.fim)) : m; }, 0);
      while (sec.childNodes.length > 1) sec.removeChild(sec.lastChild);
      sec.appendChild(ativas.length
        ? el("p", { class: "aviso-ok", text: "Acesso liberado" + (ate ? " até " + dataLonga(ate) : "") + "." })
        : el("p", { class: "dica", text: "Você ainda não tem uma assinatura ativa." }));
      if (lista.some(function (a) { return a.status === "pendente" && a.mp_pagamento_id; })) {
        sec.appendChild(el("p", { class: "dica", text: "Há um pagamento em análise pelo Mercado Pago." }));
      }
      if (planos === null) sec.appendChild(el("p", { class: "dica", text: "Não foi possível consultar os planos agora." }));
      else if (!planos.length) sec.appendChild(el("p", { class: "dica", text: "A venda de assinaturas ainda não está aberta." }));
      else {
        sec.appendChild(el("ul", { class: "planos" }, planos.map(function (p) {
          var li = el("li", {}, [
            el("strong", { text: p.nome }),
            el("span", { class: "plano-preco", text: reais(p.centavos) }),
            el("span", { class: "dica", text: "Preço total, pagamento único. Acesso por " + plural(p.dias, "dia", "dias") + ", sem renovação automática" + (ate ? ", contados a partir do fim do acesso atual" : "") + "." }),
            el("button", { type: "button", class: "botao", text: ativas.length ? "Comprar mais tempo" : "Assinar", onclick: function () {
              executar(li, function () { return Nuvem.comprar(p.id); });
            } }),
          ]);
          return li;
        })));
        sec.appendChild(el("p", { class: "nota-rodape", text: "O pagamento é feito no site do Mercado Pago; a Banca Aberta não recebe os dados do seu cartão. Você pode desistir da compra em até 7 dias e receber o valor de volta (veja os Termos de Uso)." }));
      }
      if (lista.length) {
        sec.appendChild(el("details", { class: "pagamentos" }, [el("summary", { text: "Pagamentos anteriores" }),
          el("ul", {}, lista.map(function (a) {
            return el("li", { text: dataCurta(Date.parse(a.criado_em)) + " · " + reais(a.valor_centavos) + " · " + (ESTADOS_ASSINATURA[a.status] || a.status) });
          }))]));
      }
      if (!ativas.length && novasTentativas > 0) setTimeout(function () { if (sec.isConnected) carregarAssinatura(sec, novasTentativas - 1); }, 3000);
    }).catch(function (e) {
      if (!sec.isConnected) return;
      while (sec.childNodes.length > 1) sec.removeChild(sec.lastChild);
      sec.appendChild(el("p", { class: "erro-carga", text: e.message }));
    });
  }

  // Correção do cadastro pelo próprio aluno (direito de retificação).
  function preencherPerfil(sec, p) {
    while (sec.childNodes.length > 1) sec.removeChild(sec.lastChild);
    var form = el("form", { class: "plano-form", id: "form-perfil", novalidate: true }, [
      campoTexto("Nome", { id: "perfil-nome", type: "text", autocomplete: "name" }),
      campoTexto("Data de nascimento", { id: "perfil-nasc", type: "date", max: hojeIso(), min: "1900-01-01" }),
      campoTexto("Nome do responsável (menores de 18)", { id: "perfil-resp-nome", type: "text", autocomplete: "off" }),
      campoTexto("E-mail do responsável (menores de 18)", { id: "perfil-resp-email", type: "email", autocomplete: "off" }),
      el("div", { class: "acoes-form" }, [el("button", { type: "submit", class: "botao pequeno", text: "Salvar alterações" })]),
    ]);
    form.querySelector("#perfil-nome").value = p.nome || "";
    form.querySelector("#perfil-nasc").value = p.nascimento || "";
    form.querySelector("#perfil-resp-nome").value = p.responsavel_nome || "";
    form.querySelector("#perfil-resp-email").value = p.responsavel_email || "";
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      executar(form, function () {
        var d = { nome: valorDe(form, "perfil-nome"), nascimento: valorDe(form, "perfil-nasc") || null,
          responsavel_nome: valorDe(form, "perfil-resp-nome") || null, responsavel_email: valorDe(form, "perfil-resp-email") || null };
        if (!d.nome) throw new Error("Digite seu nome.");
        if (d.nascimento && (d.nascimento > hojeIso() || d.nascimento < "1900-01-01")) throw new Error("Confira a data de nascimento.");
        if (d.nascimento && idade(d.nascimento) < 18 && (!d.responsavel_nome || !/^\S+@\S+\.\S+$/.test(d.responsavel_email || ""))) throw new Error("Para menores de 18 anos, informe o nome e o e-mail do responsável.");
        return Nuvem.salvarPerfil(d).then(function () { mostrarAviso(form, "Cadastro atualizado."); });
      });
    });
    sec.appendChild(form);
    sec.appendChild(el("p", { class: "nota-rodape", text: "Para trocar o e-mail da conta, fale com o contato indicado na Política de Privacidade." }));
  }

  // Baixar uma cópia dos dados e excluir a conta (direitos do titular, LGPD).
  function painelPrivacidade() {
    var sec = el("section", { class: "painel", id: "conta-privacidade" }, [el("h2", { text: "Privacidade" }),
      el("p", { class: "dica" }, ["Você pode baixar uma cópia de tudo o que guardamos sobre você ou excluir a conta. Detalhes na ", linkPagina("privacidade", "Política de Privacidade"), "."])]);
    var acoes = el("div", { class: "acoes-form" }, [
      el("button", { type: "button", class: "botao discreto pequeno", id: "conta-exportar", text: "Baixar meus dados", onclick: function () {
        executar(sec, function () {
          return Nuvem.exportar().then(function (dados) {
            var url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" }));
            var a = el("a", { href: url, download: "banca-aberta-meus-dados.json" });
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          });
        });
      } }),
      el("button", { type: "button", class: "botao discreto pequeno", id: "conta-excluir", text: "Excluir minha conta", onclick: function () { confirma.hidden = false; } }),
    ]);
    var digitado = el("input", { type: "text", id: "excluir-confirma", autocomplete: "off", "aria-label": "Digite EXCLUIR para confirmar" });
    var botaoExcluir = el("button", { type: "button", class: "botao pequeno perigo", text: "Excluir definitivamente", disabled: true, onclick: function () {
      executar(sec, function () {
        return Nuvem.excluirConta().then(function () { estado.contaMsg = { aviso: "Sua conta e seus dados foram excluídos." }; desenhar(); });
      });
    } });
    digitado.addEventListener("input", function () { botaoExcluir.disabled = digitado.value.trim().toUpperCase() !== "EXCLUIR"; });
    var confirma = el("div", { class: "confirma-exclusao", hidden: true }, [
      el("p", { text: "Isto apaga a conta, o cadastro, os dados de estudo e o registro das assinaturas, no servidor e neste aparelho. Uma assinatura ativa é perdida. Não dá para desfazer." }),
      el("label", { class: "campo", for: "excluir-confirma" }, [el("span", { text: "Digite EXCLUIR para confirmar" }), digitado]),
      el("div", { class: "acoes-form" }, [botaoExcluir, el("button", { type: "button", class: "botao discreto pequeno", text: "Cancelar", onclick: function () { confirma.hidden = true; digitado.value = ""; botaoExcluir.disabled = true; } })]),
    ]);
    sec.appendChild(acoes);
    sec.appendChild(confirma);
    return sec;
  }

  function sairDaConta(caixa, mesmoAssim) {
    executar(caixa, function () {
      return Nuvem.sair(mesmoAssim).then(function (r) {
        if (r.pendentes) {
          var aviso = el("div", { class: "confirma" }, [
            el("p", { text: plural(r.pendentes, "item ainda não subiu", "itens ainda não subiram") + " para a conta (sem internet?). Se sair agora, isso se perde. Saindo, os dados deste aparelho são apagados; o que já está na conta continua lá." }),
            el("div", { class: "acoes-form" }, [
              el("button", { type: "button", class: "botao", text: "Sair mesmo assim", onclick: function () { sairDaConta(caixa, true); } }),
              el("button", { type: "button", class: "botao discreto", text: "Ficar", onclick: function () { aviso.remove(); } }),
            ]),
          ]);
          caixa.appendChild(aviso);
          return;
        }
        estado.sessao = null;
        estado.contaMsg = { aviso: "Você saiu da conta. Os dados de estudo foram apagados deste aparelho e continuam guardados na conta." };
        desenhar();
      });
    });
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
      caixa.appendChild(el("p", {}, [el("button", { type: "button", class: "botao discreto", text: "Voltar", onclick: function () { var v = estado.voltarPara || "inicio"; estado.voltarPara = null; document.title = "Banca Aberta"; irPara(v); } })]));
    }).catch(function (e) { caixa.innerHTML = ""; caixa.appendChild(el("p", { class: "erro-carga", role: "alert", text: e.message })); });
  }
  function abrirPagina(nome) { estado.pagina = nome; document.title = PAGINAS[nome] + " · Banca Aberta"; irPara("pagina"); }
  Array.prototype.forEach.call(document.querySelectorAll("[data-pagina]"), function (b) {
    b.addEventListener("click", function () { estado.voltarPara = null; abrirPagina(b.getAttribute("data-pagina")); });
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
  document.getElementById("nav-plano").addEventListener("click", function () { estado.editandoPlano = false; irPara("plano"); });
  document.getElementById("nav-guias").addEventListener("click", function () { estado.guia = null; irPara("guias"); });

  // Conta (só com o backend configurado). Volta de links de e-mail e do Mercado Pago abre a tela da conta.
  function atualizarBotaoConta() {
    var b = document.getElementById("nav-conta");
    if (!b) return;
    var ativa = !!(window.Nuvem && Nuvem.ativa());
    b.hidden = !ativa;
    b.parentNode.classList.toggle("com-conta", ativa);
    b.querySelector(".rotulo-conta").textContent = logado() ? "Conta" : "Entrar";
  }
  if (window.Nuvem && Nuvem.ativa()) {
    var uidVisto = logado() ? Nuvem.usuario().id : null;
    var pagamento = new URLSearchParams(location.search).get("pagamento");
    // o Mercado Pago acrescenta vários parâmetros na volta; nenhum deles é usado aqui
    if (pagamento) history.replaceState(null, "", location.pathname + location.hash);
    document.getElementById("nav-conta").addEventListener("click", function () { irPara("conta"); });
    Nuvem.iniciar({
      // dados que chegaram de outro aparelho: redesenha, menos no meio de uma prova ou de um texto
      aoMudarDados: function () { if (["prova", "redacao", "conta"].indexOf(estado.tela) < 0) desenhar(); },
      aoMudarConta: function () {
        atualizarBotaoConta();
        var uid = logado() ? Nuvem.usuario().id : null;
        if (uid !== uidVisto) { uidVisto = uid; if (estado.tela === "conta") desenhar(); return; }
        var linha = document.getElementById("conta-sinc");
        if (linha) linha.textContent = textoSinc();
      },
    }).then(function (m) {
      if (pagamento) m = { pagamento: pagamento };
      if (m) { estado.contaMsg = m; irPara("conta"); }
    });
  }
  atualizarBotaoConta();

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
