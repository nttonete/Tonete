/* Banca Aberta: conta do aluno e sincronização com o backend (Supabase).
   O aparelho continua sendo a fonte do dia a dia: tudo é gravado primeiro no localStorage e sobe
   para a conta quando há internet. Sem configuração (app/config.js) este módulo fica desligado e não
   faz nenhum pedido à rede. Conversa com o Supabase direto pela API, sem bibliotecas de fora. */
(function () {
  "use strict";

  var cfg = window.BancaConfig || {};
  var URL_BASE = (cfg.supabaseUrl || "").replace(/\/+$/, "");
  var CHAVE_API = cfg.supabaseChave || "";
  var PREFIXO = "banca-aberta:";
  var CHAVE_CONTA = PREFIXO + "conta"; // tokens do login
  var CHAVE_META = PREFIXO + "nuvem"; // de quem são os dados do aparelho e o que falta enviar
  // O que sobe para a conta (as mesmas chaves de app.js, sem o prefixo).
  var SINCRONIZADAS = ["historico", "sessao", "plano", "obras-lidas", "redacoes"];
  var ESPERA_ENVIO = 3000;

  var avisos = { dados: function () {}, conta: function () {} };
  var geracao = {}; // conta as alterações locais de cada chave, para não perder uma feita durante o envio
  var timerEnvio = null;
  var emCurso = null, deNovo = false;
  var situacao = "desligada"; // desligada | fora | sincronizando | ok | pendente | erro
  var recuperando = false; // voltou do e-mail de "esqueci a senha"

  // ---------- armazenamento local ----------
  function lerLocal(chave, padrao) {
    try { var v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; }
  }
  function gravarLocal(chave, valor) {
    try { if (valor === null || valor === undefined) localStorage.removeItem(chave); else localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento */ }
  }
  function lerConta() { return lerLocal(CHAVE_CONTA, null); }
  function lerMeta() {
    var m = lerLocal(CHAVE_META, null);
    return m && m.chaves ? m : { usuario: null, chaves: {} };
  }
  function gravarMeta(m) { gravarLocal(CHAVE_META, m); }
  function limparDadosLocais() {
    SINCRONIZADAS.forEach(function (k) { gravarLocal(PREFIXO + k, null); });
    gravarMeta({ usuario: null, chaves: {} });
  }
  function mudarSituacao(s) { if (s !== situacao) { situacao = s; avisos.conta(); } }

  // ---------- pedidos ao servidor ----------
  var MENSAGENS = {
    invalid_credentials: "E-mail ou senha incorretos.",
    email_not_confirmed: "Confirme seu e-mail antes de entrar: procure a mensagem que enviamos (veja também o spam).",
    weak_password: "Senha fraca: use pelo menos 8 caracteres, misturando letras e números.",
    same_password: "A nova senha precisa ser diferente da anterior.",
    email_address_invalid: "Este e-mail não parece válido.",
    otp_disabled: "Não encontramos conta com este e-mail. Crie sua conta.",
    signup_disabled: "Os cadastros estão fechados no momento.",
    over_email_send_rate_limit: "Muitos e-mails em pouco tempo. Espere alguns minutos e tente de novo.",
    over_request_rate_limit: "Muitas tentativas seguidas. Espere um pouco e tente de novo.",
    validation_failed: "Confira os dados preenchidos.",
  };
  function Erro(mensagem, status, codigo) {
    var e = new Error(mensagem);
    e.status = status; e.codigo = codigo;
    return e;
  }
  function pedir(caminho, opcoes, token) {
    opcoes = opcoes || {};
    var cab = { apikey: CHAVE_API, Authorization: "Bearer " + (token || CHAVE_API) };
    if (opcoes.corpo !== undefined) cab["Content-Type"] = "application/json";
    Object.keys(opcoes.cabecalhos || {}).forEach(function (k) { cab[k] = opcoes.cabecalhos[k]; });
    return fetch(URL_BASE + caminho, {
      method: opcoes.metodo || "GET",
      headers: cab,
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
    }).catch(function () {
      throw Erro("Sem conexão com o servidor. Confira a internet e tente de novo.", 0, "sem_rede");
    }).then(function (r) {
      return r.text().then(function (t) {
        var dados = null;
        try { dados = t ? JSON.parse(t) : null; } catch (e) { dados = t; }
        if (!r.ok) {
          var d = dados || {};
          var codigo = d.error_code || d.code || d.error;
          // d.erro vem das nossas funções, já em português; o resto é traduzido aqui
          throw Erro(d.erro || MENSAGENS[codigo] || "Não foi possível concluir agora (erro " + r.status + "). Tente de novo.", r.status, codigo);
        }
        return dados;
      });
    });
  }

  // ---------- sessão de login ----------
  // "renovacao": a sessão é a mesma (só trocou o token), então o usuário continua o mesmo.
  function guardarSessao(s, renovacao) {
    var conta = {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_at: Number(s.expires_at) || Math.floor(Date.now() / 1000) + (Number(s.expires_in) || 3600),
      usuario: s.user ? { id: s.user.id, email: s.user.email } : renovacao ? (lerConta() || {}).usuario : null,
    };
    gravarLocal(CHAVE_CONTA, conta);
    return conta;
  }
  function sessaoExpirou() {
    // o login venceu de vez (ex.: senha trocada em outro aparelho): os dados ficam no aparelho até entrar de novo
    gravarLocal(CHAVE_CONTA, null);
    mudarSituacao("fora");
    avisos.conta();
  }
  // Devolve um token válido, renovando quando falta menos de 1 minuto para vencer.
  function token() {
    var c = lerConta();
    if (!c || !c.refresh_token) return Promise.reject(Erro("Entre na sua conta para continuar.", 401, "sem_login"));
    if (c.expires_at * 1000 - 60000 > Date.now()) return Promise.resolve(c.access_token);
    return pedir("/auth/v1/token?grant_type=refresh_token", { metodo: "POST", corpo: { refresh_token: c.refresh_token } })
      .then(function (s) { return guardarSessao(s, true).access_token; })
      .catch(function (e) {
        if (e.status >= 400 && e.status < 500) {
          var atual = lerConta(); // outra aba pode ter renovado nesse meio-tempo
          if (atual && atual.refresh_token !== c.refresh_token) return atual.access_token;
          sessaoExpirou();
        }
        throw e;
      });
  }
  // Pedido em nome do aluno logado; se o token for recusado, renova uma vez e tenta de novo.
  function pedirLogado(caminho, opcoes) {
    return token().then(function (t) {
      return pedir(caminho, opcoes, t).catch(function (e) {
        if (e.status !== 401) throw e;
        var c = lerConta();
        if (c) { c.expires_at = 0; gravarLocal(CHAVE_CONTA, c); }
        return token().then(function (t2) { return pedir(caminho, opcoes, t2); });
      });
    });
  }
  function usuario() { var c = lerConta(); return c && c.usuario ? c.usuario : null; }
  function voltarPara() { return location.origin + location.pathname; }

  // Ao entrar: os dados do aparelho passam a ser desta conta.
  function aoEntrar(conta) {
    var meta = lerMeta();
    if (meta.usuario && meta.usuario !== conta.usuario.id) {
      // dados de outra pessoa que não saiu da conta: não se misturam
      limparDadosLocais();
      meta = lerMeta();
    }
    if (!meta.usuario) {
      // o que foi feito neste aparelho sem conta vai junto para a conta
      meta = { usuario: conta.usuario.id, chaves: {} };
      SINCRONIZADAS.forEach(function (k) { if (lerLocal(PREFIXO + k, null) !== null) meta.chaves[k] = { pendente: true }; });
      gravarMeta(meta);
    }
    recuperando = false;
    avisos.conta();
    return sincronizar().catch(function () { /* fica pendente; tenta de novo depois */ }).then(function () { return conta.usuario; });
  }
  function entrarComSessao(s) {
    var conta = guardarSessao(s);
    if (conta.usuario) return aoEntrar(conta);
    return pedir("/auth/v1/user", {}, conta.access_token).then(function (u) {
      conta.usuario = { id: u.id, email: u.email };
      gravarLocal(CHAVE_CONTA, conta);
      return aoEntrar(conta);
    });
  }

  // Volta dos links de e-mail (confirmação de cadastro, link de acesso, nova senha):
  // o Supabase devolve a sessão no fragmento do endereço (#access_token=...).
  function lerRetornoDoEmail() {
    if (!/access_token=|error=/.test(location.hash)) return null;
    var p = {};
    location.hash.slice(1).split("&").forEach(function (par) {
      var i = par.indexOf("=");
      if (i > 0) p[decodeURIComponent(par.slice(0, i))] = decodeURIComponent(par.slice(i + 1).replace(/\+/g, " "));
    });
    history.replaceState(null, "", location.pathname + location.search);
    return p;
  }

  // ---------- junção de dados de dois aparelhos ----------
  function igual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  var JUNTAR = {
    // tentativas de simulado: junta as dos dois lados (cada uma é única pelo horário de término)
    historico: function (a, b) {
      var vistos = {}, lista = [];
      (a || []).concat(b || []).forEach(function (t) {
        var id = t.quando + "|" + t.titulo;
        if (!vistos[id]) { vistos[id] = true; lista.push(t); }
      });
      lista.sort(function (x, y) { return y.quando - x.quando; });
      return lista.slice(0, 100);
    },
    "obras-lidas": function (a, b) {
      var r = {};
      [a || {}, b || {}].forEach(function (o) { Object.keys(o).forEach(function (id) { r[id] = Math.max(r[id] || 0, o[id]); }); });
      return r;
    },
    // um rascunho por proposta: fica o editado por último
    redacoes: function (a, b) {
      var porId = {};
      (b || []).concat(a || []).forEach(function (r) {
        var id = r.v + "|" + r.ano + "|" + r.proposta;
        var atual = porId[id];
        if (!atual || (r.atualizado || r.criado || 0) >= (atual.atualizado || atual.criado || 0)) porId[id] = r;
      });
      return Object.keys(porId).map(function (id) { return porId[id]; });
    },
    // vale o plano criado por último; as tarefas marcadas como feitas somam as dos dois lados
    plano: function (a, b) {
      if (!a || !b) return a || b;
      var base = (b.criado || 0) > (a.criado || 0) ? b : a;
      var r = JSON.parse(JSON.stringify(base));
      r.feitas = {};
      [a.feitas || {}, b.feitas || {}].forEach(function (f) { Object.keys(f).forEach(function (id) { r.feitas[id] = Math.max(r.feitas[id] || 0, f[id]); }); });
      return r;
    },
    // prova em andamento: fica a começada por último; se foi descartada aqui, vale a do outro aparelho
    sessao: function (local, remoto) {
      if (!local || !remoto) return local || remoto;
      return (remoto.inicio || 0) > (local.inicio || 0) ? remoto : local;
    },
  };

  // ---------- sincronização ----------
  // Para cada chave: se só a conta mudou, o aparelho recebe; se só o aparelho mudou, a conta recebe;
  // se os dois mudaram, junta (JUNTAR) e grava o resultado nos dois lados. O envio só vale se a
  // conta não mudou desde a leitura (atualizado_em igual ao visto); se mudou, lê e junta de novo.
  function rodada(uid) {
    return pedirLogado("/rest/v1/dados_aluno?select=chave,valor,atualizado_em").then(function (linhas) {
      var remoto = {};
      (linhas || []).forEach(function (l) { remoto[l.chave] = l; });
      var meta = lerMeta(), mudouLocal = [], envios = [];
      SINCRONIZADAS.forEach(function (k) {
        var m = meta.chaves[k] || {}, r = remoto[k] || null;
        var vistoAgora = r ? r.atualizado_em : null;
        var contaMudou = vistoAgora !== (m.visto === undefined ? null : m.visto) || (m.visto === undefined && r);
        var local = lerLocal(PREFIXO + k, null);
        if (!m.pendente) {
          if (contaMudou) {
            var valor = r ? r.valor : null;
            if (!igual(valor, local)) { gravarLocal(PREFIXO + k, valor); mudouLocal.push(k); }
            meta.chaves[k] = { visto: vistoAgora };
          }
          return;
        }
        var final = local;
        if (contaMudou && r) {
          final = JUNTAR[k](local, r.valor);
          if (!igual(final, local)) { gravarLocal(PREFIXO + k, final); mudouLocal.push(k); }
        }
        envios.push({ chave: k, valor: final, visto: vistoAgora, geracao: geracao[k] || 0, igualConta: r ? igual(final, r.valor) : final === null });
      });
      gravarMeta(meta);
      if (mudouLocal.length) avisos.dados(mudouLocal);
      var conflito = false;
      return envios.reduce(function (p, e) {
        return p.then(function () {
          return enviar(uid, e).then(function (visto) {
            var mt = lerMeta();
            if (visto === false) { conflito = true; return; }
            // se o aluno mexeu de novo durante o envio, continua pendente
            mt.chaves[e.chave] = { visto: visto, pendente: (geracao[e.chave] || 0) !== e.geracao };
            gravarMeta(mt);
          });
        });
      }, Promise.resolve()).then(function () { return conflito; });
    });
  }
  // Grava uma chave na conta. Devolve o novo atualizado_em, null se a chave ficou vazia,
  // ou false se a conta mudou nesse meio-tempo (conflito).
  function enviar(uid, e) {
    if (e.igualConta) return Promise.resolve(e.visto);
    var filtro = "?user_id=eq." + uid + "&chave=eq." + encodeURIComponent(e.chave) +
      (e.visto ? "&atualizado_em=eq." + encodeURIComponent(e.visto) : "");
    var volta = { Prefer: "return=representation" };
    if (e.valor === null) {
      return pedirLogado("/rest/v1/dados_aluno" + filtro, { metodo: "DELETE", cabecalhos: volta })
        .then(function (l) { return l && l.length ? null : false; });
    }
    if (e.visto) {
      return pedirLogado("/rest/v1/dados_aluno" + filtro, { metodo: "PATCH", corpo: { valor: e.valor }, cabecalhos: volta })
        .then(function (l) { return l && l.length ? l[0].atualizado_em : false; });
    }
    return pedirLogado("/rest/v1/dados_aluno", { metodo: "POST", corpo: { user_id: uid, chave: e.chave, valor: e.valor }, cabecalhos: volta })
      .then(function (l) { return l[0].atualizado_em; })
      .catch(function (err) { if (err.status === 409) return false; throw err; });
  }
  function sincronizar() {
    if (!ativa() || !usuario()) return Promise.resolve();
    if (emCurso) { deNovo = true; return emCurso; }
    clearTimeout(timerEnvio);
    mudarSituacao("sincronizando");
    var uid = usuario().id, tentativas = 0;
    function tentar() {
      return rodada(uid).then(function (conflito) {
        if (conflito && ++tentativas < 3) return tentar();
      });
    }
    emCurso = tentar().then(function () {
      emCurso = null;
      mudarSituacao(pendentes() ? "pendente" : "ok");
      if (deNovo) { deNovo = false; return sincronizar(); }
    }, function (e) {
      emCurso = null; deNovo = false;
      if (usuario()) mudarSituacao(e.codigo === "sem_rede" ? "pendente" : "erro");
      throw e;
    });
    return emCurso;
  }
  function pendentes() {
    var m = lerMeta();
    return Object.keys(m.chaves).filter(function (k) { return m.chaves[k].pendente; }).length;
  }
  // Chamado por app.js a cada gravação no aparelho.
  function alterado(chaveCompleta) {
    if (!ativa() || chaveCompleta.indexOf(PREFIXO) !== 0) return;
    var k = chaveCompleta.slice(PREFIXO.length);
    if (SINCRONIZADAS.indexOf(k) < 0) return;
    var meta = lerMeta();
    if (!meta.usuario) return; // sem conta: fica só no aparelho (sobe quando entrar)
    geracao[k] = (geracao[k] || 0) + 1;
    meta.chaves[k] = meta.chaves[k] || {};
    meta.chaves[k].pendente = true;
    gravarMeta(meta);
    if (!usuario()) return;
    if (situacao === "ok") mudarSituacao("pendente");
    clearTimeout(timerEnvio);
    timerEnvio = setTimeout(function () { sincronizar().catch(function () {}); }, ESPERA_ENVIO);
  }

  // ---------- ações da conta ----------
  function ativa() { return !!(URL_BASE && CHAVE_API); }

  function cadastrar(d) {
    return pedir("/auth/v1/signup?redirect_to=" + encodeURIComponent(voltarPara()), {
      metodo: "POST",
      corpo: {
        email: d.email, password: d.senha,
        data: {
          nome: d.nome, nascimento: d.nascimento,
          responsavel_nome: d.responsavel_nome || null, responsavel_email: d.responsavel_email || null,
          termos_versao: d.termos_versao, privacidade_versao: d.privacidade_versao,
        },
      },
    }).then(function (r) {
      if (r && r.access_token) return entrarComSessao(r).then(function () { return { entrou: true }; });
      return { confirmar: true }; // o Supabase manda um e-mail de confirmação
    });
  }
  function entrar(email, senha) {
    return pedir("/auth/v1/token?grant_type=password", { metodo: "POST", corpo: { email: email, password: senha } })
      .then(entrarComSessao);
  }
  function enviarLink(email) {
    return pedir("/auth/v1/otp?redirect_to=" + encodeURIComponent(voltarPara()), { metodo: "POST", corpo: { email: email, create_user: false } });
  }
  function recuperarSenha(email) {
    return pedir("/auth/v1/recover?redirect_to=" + encodeURIComponent(voltarPara()), { metodo: "POST", corpo: { email: email } });
  }
  function definirSenha(senha) {
    return pedirLogado("/auth/v1/user", { metodo: "PUT", corpo: { password: senha } }).then(function () {
      recuperando = false;
      avisos.conta();
    });
  }
  // Sai da conta e apaga deste aparelho os dados que estão na conta.
  // Se houver algo que não subiu e "mesmoAssim" não vier, devolve {pendentes: n} sem sair.
  function sair(mesmoAssim) {
    return sincronizar().catch(function () {}).then(function () {
      var n = pendentes();
      if (n && !mesmoAssim) return { pendentes: n };
      var c = lerConta();
      var fim = c ? pedir("/auth/v1/logout?scope=local", { metodo: "POST" }, c.access_token).catch(function () {}) : Promise.resolve();
      return fim.then(function () {
        gravarLocal(CHAVE_CONTA, null);
        limparDadosLocais();
        mudarSituacao("fora");
        avisos.conta();
        avisos.dados(SINCRONIZADAS.slice());
        return { saiu: true };
      });
    });
  }
  function perfil() {
    return pedirLogado("/rest/v1/perfis?select=*&id=eq." + usuario().id).then(function (l) { return l[0] || null; });
  }
  function salvarPerfil(campos) {
    return pedirLogado("/rest/v1/perfis?id=eq." + usuario().id, { metodo: "PATCH", corpo: campos, cabecalhos: { Prefer: "return=representation" } })
      .then(function (l) { return l[0] || null; });
  }
  function assinaturas() {
    return pedirLogado("/rest/v1/assinaturas?select=plano,status,valor_centavos,dias,inicio,fim,criado_em,mp_pagamento_id&order=criado_em.desc");
  }
  function temAcesso() {
    return pedirLogado("/rest/v1/rpc/tem_acesso", { metodo: "POST", corpo: {} }).then(function (r) { return r === true; });
  }
  function planos() {
    return pedirLogado("/functions/v1/mp-checkout").then(function (r) { return r.planos || []; });
  }
  // Abre o pagamento no Mercado Pago (o aluno sai do site e volta com ?pagamento=...).
  function comprar(plano) {
    return pedirLogado("/functions/v1/mp-checkout", { metodo: "POST", corpo: { plano: plano } }).then(function (r) {
      if (!r || !r.endereco) throw Erro("O pagamento não abriu. Tente de novo.", 0);
      location.assign(r.endereco);
    });
  }
  // Cópia de tudo o que a plataforma guarda sobre o aluno (direito de acesso e portabilidade).
  function exportar() {
    return sincronizar().catch(function () {}).then(function () {
      return Promise.all([
        perfil(),
        pedirLogado("/rest/v1/dados_aluno?select=chave,valor,atualizado_em"),
        pedirLogado("/rest/v1/assinaturas?select=*"),
      ]);
    }).then(function (r) {
      return { gerado_em: new Date().toISOString(), conta: usuario(), perfil: r[0], dados_de_estudo: r[1], assinaturas: r[2] };
    });
  }
  function excluirConta() {
    return pedirLogado("/functions/v1/excluir-conta", { metodo: "POST", corpo: { confirmacao: "EXCLUIR" } }).then(function () {
      gravarLocal(CHAVE_CONTA, null);
      limparDadosLocais();
      mudarSituacao("fora");
      avisos.conta();
      avisos.dados(SINCRONIZADAS.slice());
    });
  }

  // ---------- início ----------
  // Devolve uma mensagem para mostrar ao aluno quando ele volta de um link de e-mail.
  function iniciar(opcoes) {
    avisos.dados = opcoes.aoMudarDados || avisos.dados;
    avisos.conta = opcoes.aoMudarConta || avisos.conta;
    if (!ativa()) return Promise.resolve(null);
    situacao = usuario() ? "pendente" : "fora";
    window.addEventListener("online", function () { sincronizar().catch(function () {}); });
    document.addEventListener("visibilitychange", function () { sincronizar().catch(function () {}); });
    window.addEventListener("storage", function (ev) { if (ev.key === CHAVE_CONTA) avisos.conta(); });

    var retorno = lerRetornoDoEmail();
    if (retorno && retorno.error) {
      return Promise.resolve({ erro: retorno.error_code === "otp_expired" ? "O link do e-mail venceu ou já foi usado. Peça outro." : "Não foi possível entrar pelo link: " + (retorno.error_description || retorno.error) });
    }
    if (retorno && retorno.access_token) {
      return entrarComSessao(retorno).then(function () {
        if (retorno.type === "recovery") { recuperando = true; avisos.conta(); return { recuperacao: true }; }
        return { aviso: retorno.type === "signup" ? "E-mail confirmado. Sua conta está pronta." : "Você entrou na sua conta." };
      }, function (e) { return { erro: e.message }; });
    }
    if (usuario()) sincronizar().catch(function () {});
    return Promise.resolve(null);
  }

  window.Nuvem = {
    ativa: ativa, iniciar: iniciar, usuario: usuario, situacao: function () { return situacao; },
    recuperando: function () { return recuperando; }, pendentes: pendentes,
    alterado: alterado, sincronizar: sincronizar,
    cadastrar: cadastrar, entrar: entrar, enviarLink: enviarLink, recuperarSenha: recuperarSenha,
    definirSenha: definirSenha, sair: sair,
    perfil: perfil, salvarPerfil: salvarPerfil, assinaturas: assinaturas, temAcesso: temAcesso,
    planos: planos, comprar: comprar, exportar: exportar, excluirConta: excluirConta,
    _juntar: JUNTAR,
  };
})();
