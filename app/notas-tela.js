// Aba "Notas × Razão": arquivos, conferência, tabela e relatório. Também controla a troca de abas.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const { fmtData, fmtValor } = Conciliacao;
  const estado = { razao: [], notas: [], resultado: null, filtro: "nao", busca: "" };

  const SIT = {
    nao: { rot: "Não lançada", cls: "b-bad" },
    divergente: { rot: "Valor diferente", cls: "b-warn" },
    "cancelada-lancada": { rot: "Cancelada e lançada", cls: "b-bad" },
    provavel: { rot: "Provável", cls: "b-info" },
    lancada: { rot: "Lançada", cls: "b-ok" },
    cancelada: { rot: "Cancelada", cls: "b-info" },
    fora: { rot: "Fora do período", cls: "b-info" },
  };
  const CONFERIR = ["divergente", "provavel", "cancelada-lancada"];

  function el(tag, attrs, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v);
    }
    for (const f of filhos.flat()) if (f != null && f !== false) e.append(f.nodeType ? f : String(f));
    return e;
  }
  const valorEl = v => el("span", { class: "mono" }, fmtValor(v));
  const fmtCnpj = c => c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c.length === 11 ? c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : c;
  const nomeNota = n => `${n.modelo} ${n.numero}${n.serie ? "/" + n.serie : ""}`;

  /* ---------- abas ---------- */
  function abrirAba(qual) {
    for (const k of ["extrato", "notas"]) {
      $("#aba-" + k).setAttribute("aria-selected", String(k === qual));
      $("#modo-" + k).hidden = k !== qual;
    }
    $("h1").textContent = qual === "notas" ? "Conferência de Notas × Razão" : "Conciliador Razão × Extrato";
    try { localStorage.setItem("aba", qual); } catch { /* sem armazenamento */ }
  }
  $("#aba-extrato").addEventListener("click", () => abrirAba("extrato"));
  $("#aba-notas").addEventListener("click", () => abrirAba("notas"));
  try { if (localStorage.getItem("aba") === "notas") abrirAba("notas"); } catch { /* sem armazenamento */ }

  /* ---------- arquivos ---------- */
  function montarLado(lado) {
    const box = $("#n-lado-" + lado), drop = box.querySelector(".drop"), input = box.querySelector("input");
    drop.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", () => { adicionar(lado, [...input.files]); input.value = ""; });
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); adicionar(lado, [...e.dataTransfer.files]); });
  }

  async function adicionar(lado, files) {
    // Muitos XMLs soltos viram um só item na lista
    const grupo = lado === "notas" && files.length > 3 ? { nome: `${files.length} arquivos`, carregando: true, notas: [], cancelamentos: new Set(), erros: [], qtdArquivos: 0 } : null;
    if (grupo) { estado.notas.push(grupo); render(lado); }
    for (const f of files) {
      const item = grupo || { nome: f.name, carregando: true };
      if (!grupo) { estado[lado].push(item); render(lado); }
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        if (lado === "razao") Object.assign(item, await Leitura.lerArquivo(f.name, buf, "razao"));
        else {
          const r = await Notas.lerArquivoNotas(f.name, buf);
          if (grupo) { grupo.notas.push(...r.notas); r.cancelamentos.forEach(c => grupo.cancelamentos.add(c)); grupo.erros.push(...r.erros); grupo.qtdArquivos += r.qtdArquivos; }
          else Object.assign(item, r);
        }
      } catch (e) {
        console.error(e);
        if (grupo) { grupo.erros.push({ arquivo: f.name, erro: e.message || String(e) }); grupo.qtdArquivos++; }
        else item.erro = e.message || String(e);
      }
      if (!grupo) { item.carregando = false; render(lado); }
    }
    if (grupo) { grupo.carregando = false; render(lado); }
    conferir();
  }

  function render(lado) {
    const box = $("#n-lado-" + lado + " .arquivos");
    box.replaceChildren(...estado[lado].map((a, i) => {
      const linhas = [];
      if (a.carregando) linhas.push(el("div", { class: "meta" }, "Lendo…"));
      else if (a.erro) linhas.push(el("div", { class: "erro" }, a.erro));
      else if (lado === "razao") {
        const d = a.lancs.map(t => t.data);
        linhas.push(el("div", { class: "meta" }, `${a.formato} · ${a.lancs.length} lançamentos · ${fmtData(d[0])} a ${fmtData(d[d.length - 1])}`));
        for (const av of a.avisos || []) linhas.push(el("div", { class: "alerta" }, av));
        linhas.push(tabelaMini(["Data", "Doc", "Histórico", "Valor"], a.lancs.map(t => [fmtData(t.data), t.doc || "", t.desc, valorEl(t.valor)])));
      } else {
        const tipos = {};
        for (const n of a.notas) tipos[n.modelo] = (tipos[n.modelo] || 0) + 1;
        linhas.push(el("div", { class: "meta" }, `${a.notas.length} nota(s) · ` + Object.entries(tipos).map(([k, q]) => `${q} ${k}`).join(", ") + (a.qtdArquivos > 1 ? ` · ${a.qtdArquivos} arquivos` : "")));
        if (a.notas.some(n => n.aproximada)) linhas.push(el("div", { class: "alerta" }, "Notas lidas de PDF: leitura aproximada. Confira número, data e valor (o XML é mais preciso)."));
        if (a.erros && a.erros.length) linhas.push(el("details", {}, el("summary", { class: "alerta" }, `${a.erros.length} arquivo(s) não lidos`), el("div", { class: "tab-mini" }, a.erros.map(e => el("div", { class: "meta" }, `${e.arquivo}: ${e.erro}`)))));
        linhas.push(tabelaMini(["Nota", "Emissão", "Emitente", "Valor"], a.notas.map(n => [nomeNota(n) + (n.cancelada ? " (cancelada)" : ""), fmtData(n.data), n.emitNome || fmtCnpj(n.emitCnpj), valorEl(n.valor)]), "Ver notas lidas"));
      }
      return el("div", { class: "arq" },
        el("div", { class: "arq-l1" }, el("span", { class: "nome" }, a.nome),
          el("button", { class: "x", title: "Remover", "aria-label": "Remover " + a.nome, onclick: () => { estado[lado].splice(i, 1); render(lado); conferir(); } }, "×")),
        linhas);
    }));
  }
  function tabelaMini(cab, linhas, rotulo) {
    return el("details", {}, el("summary", {}, rotulo || "Ver lançamentos lidos"),
      el("div", { class: "tab-mini" }, el("table", {},
        el("thead", {}, el("tr", {}, cab.map((c, i) => el("th", { class: i === cab.length - 1 ? "num" : "" }, c)))),
        el("tbody", {}, linhas.slice(0, 2000).map(l => el("tr", {}, l.map((c, i) => el("td", { class: i === l.length - 1 ? "num" : "" }, c))))))));
  }

  /* ---------- conferência ---------- */
  const lancsRazao = () => estado.razao.filter(a => a.lancs).flatMap(a => a.lancs);
  function notasLidas() {
    const todas = estado.notas.filter(a => a.notas).flatMap(a => a.notas);
    const canc = new Set(); estado.notas.forEach(a => a.cancelamentos && a.cancelamentos.forEach(c => canc.add(c)));
    return Conferencia.consolidar(todas, canc);
  }

  function conferir() {
    const raz = lancsRazao(), notas = notasLidas();
    $("#n-avisos").replaceChildren();
    if (!raz.length || !notas.length) { $("#n-resultado").hidden = true; estado.resultado = null; return; }
    estado.resultado = Conferencia.conferir(notas, raz, { tolValor: +$("#n-tol").value, diasProvavel: +$("#n-dias").value });
    renderResultado();
  }

  function renderResultado() {
    const r = estado.resultado, sec = $("#n-resultado");
    sec.hidden = false;
    const soma = sits => r.resultados.filter(x => sits.includes(x.situacao)).reduce((a, x) => a + (x.nota.valor || 0), 0);
    const qtd = sits => sits.reduce((a, k) => a + (r.qtd[k] || 0), 0);
    const validas = r.resultados.filter(x => !x.nota.cancelada).length;
    const card = (cls, rot, q, v, sub) => el("div", { class: "card " + cls }, el("span", { class: "rot" }, rot), el("span", { class: "val" }, String(q)), el("span", { class: "sub" }, `R$ ${fmtValor(v)}` + (sub ? " · " + sub : "")));
    const nao = qtd(["nao"]), conf = qtd(CONFERIR);
    const cards = el("div", { class: "cards" },
      card("", "Notas conferidas", r.resultados.length, soma(Object.keys(SIT)), r.empresa ? "empresa " + fmtCnpj(r.empresa) : ""),
      card(qtd(["lancada"]) === validas ? "ok" : "", "Lançadas", qtd(["lancada"]), soma(["lancada"])),
      card(nao ? "bad" : "ok", "Não lançadas", nao, soma(["nao"])),
      card(conf ? "bad" : "ok", "A conferir", conf, soma(CONFERIR), "valor diferente, prováveis e canceladas lançadas"));

    const FILTROS = [["nao", "Não lançadas"], ["lancada", "Lançadas"], ["divergente", "Valor diferente"], ["provavel", "Prováveis"], ["cancelada-lancada", "Canceladas e lançadas"], ["cancelada", "Canceladas"], ["fora", "Fora do período"], ["semnota", "No razão sem nota"], ["todas", "Todas"]];
    const contagem = k => k === "todas" ? r.resultados.length : k === "semnota" ? r.semArquivo.length : (r.qtd[k] || 0);
    const filtros = el("div", { class: "filtros" },
      FILTROS.filter(([k]) => ["nao", "lancada", "todas"].includes(k) || contagem(k)).map(([k, rot]) =>
        el("button", { class: "chip" + (estado.filtro === k ? " ativo" : ""), onclick: () => { estado.filtro = k; renderResultado(); } }, rot, el("b", {}, String(contagem(k))))),
      el("input", { class: "busca", type: "search", placeholder: "Buscar nº, nome, CNPJ ou valor…", value: estado.busca, oninput: e => { estado.busca = e.target.value; renderTabela(); } }));
    const acoes = el("div", { class: "acoes" },
      el("button", { class: "primario", onclick: exportar }, "Baixar relatório em Excel"),
      el("button", { onclick: () => window.print() }, "Imprimir / salvar em PDF"));
    const titulo = el("div", { class: "filtros" }, el("h2", {}, nao || conf ? "Resultado da conferência" : "✔ Todas as notas estão lançadas"), el("span", { style: "flex:1" }), acoes);
    const per = r.periodo ? el("p", { class: "lead", style: "font-size:13px" }, `Período do razão: ${fmtData(r.periodo[0])} a ${fmtData(r.periodo[1])}. Notas emitidas depois do fim do razão aparecem como "Fora do período".`) : null;
    sec.replaceChildren(el("div", { class: "wrap", style: "gap:16px" }, titulo, cards, per, filtros, el("div", { class: "tabela-wrap", id: "n-tabela" })));
    renderTabela();
  }

  function filtrados() {
    const r = estado.resultado, f = estado.filtro;
    if (f === "semnota") return r.semArquivo;
    let l = f === "todas" ? r.resultados : r.resultados.filter(x => x.situacao === f);
    const b = Leitura.norm(estado.busca).trim();
    if (b) l = l.filter(x => [x.nota.numero, x.part.nome, x.part.cnpj, fmtCnpj(x.part.cnpj || ""), fmtValor(x.nota.valor), fmtData(x.nota.data), ...x.lancs.map(t => t.desc)].some(s => Leitura.norm(s).includes(b)));
    return l;
  }

  function renderTabela() {
    const l = filtrados();
    const tab = $("#n-tabela");
    if (estado.filtro === "semnota") {
      tab.replaceChildren(el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "Data"), el("th", {}, "Histórico no razão"), el("th", { class: "num" }, "Valor"), el("th", {}, "Arquivo"), el("th", {}, "O que fazer"))),
        el("tbody", {}, l.length ? l.map(t => el("tr", {}, el("td", { class: "mono" }, fmtData(t.data)), el("td", {}, t.desc), el("td", { class: "num" }, valorEl(t.valor)), el("td", {}, t.arquivo), el("td", { class: "fazer" }, "O razão cita uma nota que não está entre os arquivos enviados. Conferir se a nota existe."))) : el("tr", {}, el("td", { colspan: 5, class: "vazio" }, "Nada aqui.")))));
      return;
    }
    const lancsEl = ls => ls.length ? ls.map(t => el("div", { class: "item" }, el("span", { class: "d" }, fmtData(t.data).slice(0, 5)), el("span", { class: "t" }, (t.doc ? t.doc + " · " : "") + t.desc), el("span", { class: "v" }, fmtValor(t.valor)))) : el("span", { class: "vazio" }, "—");
    const LIM = 1500;
    tab.replaceChildren(el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, "Situação"), el("th", {}, "Nota"), el("th", {}, "Emissão"), el("th", {}, "Participante"), el("th", { class: "num" }, "Valor"), el("th", {}, "Lançamento no razão"), el("th", {}, "Observação"))),
      el("tbody", {}, l.length ? l.slice(0, LIM).map(x => el("tr", {},
        el("td", {}, el("span", { class: "badge " + SIT[x.situacao].cls }, SIT[x.situacao].rot)),
        el("td", { class: "mono" }, nomeNota(x.nota), x.nota.origem === "PDF" ? el("div", { class: "sub" }, "PDF") : null),
        el("td", { class: "mono" }, fmtData(x.nota.data)),
        el("td", {}, x.part.nome || "—", el("div", { class: "item d" }, [fmtCnpj(x.part.cnpj || ""), x.tipo].filter(Boolean).join(" · "))),
        el("td", { class: "num" }, valorEl(x.nota.valor)),
        el("td", {}, lancsEl(x.lancs)),
        el("td", { class: "fazer" }, x.obs))) : el("tr", {}, el("td", { colspan: 7, class: "vazio" }, "Nada aqui."))),
      l.length > LIM ? el("tfoot", {}, el("tr", {}, el("td", { colspan: 7, class: "vazio" }, `Mostrando ${LIM} de ${l.length}. O relatório em Excel traz todas.`))) : null));
  }

  /* ---------- relatório ---------- */
  function exportar() {
    const r = estado.resultado;
    const dt = d => d ? new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), 12)) : "";
    const cab = ["Situação", "Modelo", "Número", "Série", "Emissão", "Participante", "CNPJ/CPF", "Tipo", "Valor da nota", "Data lançamento", "Histórico no razão", "Valor lançado", "Arquivo do razão", "Observação", "Chave / arquivo da nota"];
    const linhas = lista => {
      const out = [cab];
      for (const x of lista) {
        const n = Math.max(1, x.lancs.length);
        for (let i = 0; i < n; i++) {
          const t = x.lancs[i];
          out.push(i ? ["", "", "", "", "", "", "", "", "", t ? dt(t.data) : "", t ? (t.doc ? t.doc + " · " : "") + t.desc : "", t ? t.valor : "", t ? t.arquivo : "", "", ""]
            : [SIT[x.situacao].rot, x.nota.modelo, x.nota.numero, x.nota.serie, dt(x.nota.data), x.part.nome, fmtCnpj(x.part.cnpj || ""), x.tipo, x.nota.valor, t ? dt(t.data) : "", t ? (t.doc ? t.doc + " · " : "") + t.desc : "", t ? t.valor : "", t ? t.arquivo : "", x.obs, x.nota.chave || x.nota.arquivo]);
        }
      }
      return out;
    };
    const por = sits => r.resultados.filter(x => sits.includes(x.situacao));
    const wb = XLSX.utils.book_new();
    const add = (nome, aoa, larg) => {
      const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
      for (const k of Object.keys(ws)) { const c = ws[k]; if (k[0] === "!" || !c) continue; if (c.t === "n") c.z = "#,##0.00;[Red]-#,##0.00"; if (c.t === "d") c.z = "dd/mm/yyyy"; }
      ws["!cols"] = larg.map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, nome);
    };
    const W = [18, 8, 10, 6, 11, 34, 19, 9, 14, 11, 50, 14, 24, 60, 46];
    const somaV = l => Math.round(l.reduce((a, x) => a + (x.nota.valor || 0), 0) * 100) / 100;
    add("Resumo", [
      ["Conferência de Notas × Razão"], ["Gerado em", new Date().toLocaleString("pt-BR")],
      ["Período do razão", r.periodo ? `${fmtData(r.periodo[0])} a ${fmtData(r.periodo[1])}` : ""],
      ["Arquivos do razão", estado.razao.map(a => a.nome).join(", ")],
      ["CNPJ da empresa (detectado)", r.empresa ? fmtCnpj(r.empresa) : "não identificado"], [],
      ["Situação", "Quantidade", "Valor"],
      ...Object.keys(SIT).map(k => [SIT[k].rot, r.qtd[k] || 0, somaV(por([k]))]),
      ["Total", r.resultados.length, somaV(r.resultados)], [],
      ["Lançamentos do razão que citam nota sem arquivo", r.semArquivo.length],
    ], [40, 12, 16]);
    add("Não lançadas", linhas(por(["nao"])), W);
    add("Lançadas", linhas(por(["lancada"])), W);
    add("A conferir", linhas(por(CONFERIR)), W);
    if ((r.qtd.cancelada || 0) + (r.qtd.fora || 0)) add("Canceladas e fora", linhas(por(["cancelada", "fora"])), W);
    if (r.semArquivo.length) add("No razão sem nota", [["Data", "Doc", "Histórico", "Valor", "Arquivo"], ...r.semArquivo.map(t => [dt(t.data), t.doc || "", t.desc, t.valor, t.arquivo])], [11, 10, 60, 14, 30]);
    add("Razão lido", [["Data", "Doc", "Histórico", "Valor", "Arquivo"], ...lancsRazao().map(t => [dt(t.data), t.doc || "", t.desc, t.valor, t.arquivo])], [11, 10, 60, 14, 30]);
    const nome = `Conferencia_Notas_${new Date().toISOString().slice(0, 10)}.xlsx`;
    if (window.desktop && window.desktop.salvarArquivo) {
      const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      window.desktop.salvarArquivo(nome, new Uint8Array(bytes)).then(res => { if (res && res.caminho) window.desktop.abrirArquivo(res.caminho); })
        .catch(e => alert("Não foi possível salvar o relatório: " + (e.message || e)));
      return;
    }
    XLSX.writeFile(wb, nome);
  }

  /* ---------- início ---------- */
  montarLado("razao"); montarLado("notas");
  $("#n-tol").addEventListener("change", conferir);
  $("#n-dias").addEventListener("change", conferir);
  $("#n-limpar").addEventListener("click", () => { estado.razao = []; estado.notas = []; render("razao"); render("notas"); conferir(); });
  window.__notas = { estado, adicionar, conferir, abrirAba };
})();
