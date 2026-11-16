// Conciliação: compara os lançamentos do extrato (considerado correto) com os do razão.
// Cada lançamento: { data: "AAAAMMDD", desc, valor (+ entrada / − saída), arquivo }
(function () {
  "use strict";
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const r2 = v => Math.round(v * 100) / 100;
  const diaN = d => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 86400000;
  const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "para", "com", "em", "ref", "pgto", "pag", "pagto", "valor", "conf", "doc", "nf", "the"]);

  function tokens(s) {
    return new Set(norm(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter(w => w.length >= 3 && !PALAVRAS_VAZIAS.has(w) && !/^\d+$/.test(w)));
  }
  function similaridade(a, b) {
    const ta = a._tk || (a._tk = tokens(a.desc)), tb = b._tk || (b._tk = tokens(b.desc));
    if (!ta.size || !tb.size) return 0;
    let i = 0; for (const w of ta) if (tb.has(w)) i++;
    return i / Math.min(ta.size, tb.size);
  }

  // Procura um subconjunto de `cands` cuja soma (em centavos) seja `alvo`. Todos com o mesmo sinal.
  function subconjunto(alvo, cands, maxK) {
    const lista = cands.slice().sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 22);
    const absAlvo = Math.abs(alvo);
    let nos = 0, achou = null;
    const escolhidos = [];
    // soma restante para poda
    const resto = []; let acc = 0;
    for (let i = lista.length - 1; i >= 0; i--) { acc += Math.abs(lista[i].c); resto[i] = acc; }
    function dfs(i, soma) {
      if (achou || ++nos > 40000) return;
      if (soma === absAlvo && escolhidos.length >= 2) { achou = escolhidos.slice(); return; }
      if (escolhidos.length >= maxK || i >= lista.length || soma + resto[i] < absAlvo) return;
      for (let j = i; j < lista.length && !achou; j++) {
        const v = Math.abs(lista[j].c);
        if (soma + v > absAlvo) continue;
        escolhidos.push(lista[j]); dfs(j + 1, soma + v); escolhidos.pop();
      }
    }
    dfs(0, 0);
    return achou;
  }

  function conciliar(extratoIn, razaoIn, opcoes) {
    const tol = opcoes && opcoes.tolDias != null ? opcoes.tolDias : 3;
    const inverter = opcoes && opcoes.inverterRazao;
    const ext = extratoIn.map((t, i) => ({ ...t, id: "e" + i, c: Math.round(t.valor * 100), n: diaN(t.data), usado: false }));
    let razTodos = razaoIn.map((t, i) => ({ ...t, id: "r" + i, c: Math.round(t.valor * 100) * (inverter ? -1 : 1), n: diaN(t.data), usado: false }));
    razTodos.forEach(t => { t.valor = t.c / 100; });

    // Período do extrato: lançamentos do razão fora dele não entram na comparação
    const ini = ext.length ? Math.min(...ext.map(t => t.n)) : -Infinity;
    const fim = ext.length ? Math.max(...ext.map(t => t.n)) : Infinity;
    const fora = razTodos.filter(t => t.n < ini - tol || t.n > fim + tol);
    const raz = razTodos.filter(t => !(t.n < ini - tol || t.n > fim + tol));

    const grupos = [];
    const novo = (tipo, e, r, nota) => {
      e.forEach(t => t.usado = true); r.forEach(t => t.usado = true);
      const se = e.reduce((a, t) => a + t.c, 0), sr = r.reduce((a, t) => a + t.c, 0);
      grupos.push({ tipo, ext: e, raz: r, dif: (se - sr) / 100, nota: nota || "" });
    };
    const livresR = () => raz.filter(t => !t.usado);
    const livresE = () => ext.filter(t => !t.usado);
    const melhorPor = (base, cands) => {
      let m = null, ms = -Infinity;
      for (const c of cands) {
        const s = -Math.abs(c.n - base.n) * 2 + similaridade(base, c);
        if (s > ms) { ms = s; m = c; }
      }
      return m;
    };
    // índice por valor
    const porValor = new Map();
    for (const t of raz) { if (!porValor.has(t.c)) porValor.set(t.c, []); porValor.get(t.c).push(t); }

    // 1) mesmo valor e mesma data
    for (const e of ext) {
      const cands = (porValor.get(e.c) || []).filter(r => !r.usado && r.n === e.n);
      if (cands.length) novo("ok", [e], [melhorPor(e, cands)]);
    }
    // 2) mesmo valor, data próxima
    for (const e of livresE()) {
      const cands = (porValor.get(e.c) || []).filter(r => !r.usado && Math.abs(r.n - e.n) <= tol);
      if (cands.length) {
        const r = melhorPor(e, cands);
        novo("data", [e], [r], `Data no razão ${fmtData(r.data)}; no extrato ${fmtData(e.data)} (${Math.abs(r.n - e.n)} dia(s) de diferença).`);
      }
    }
    // 3) um lançamento do extrato = vários do razão (e vice-versa)
    for (const e of livresE()) {
      const cands = livresR().filter(r => Math.sign(r.c) === Math.sign(e.c) && Math.abs(r.c) < Math.abs(e.c) && Math.abs(r.n - e.n) <= tol);
      if (cands.length < 2) continue;
      const s = subconjunto(e.c, cands, 6);
      if (s) novo("agrupado", [e], s, `1 lançamento no extrato corresponde a ${s.length} lançamentos no razão.`);
    }
    for (const r of livresR()) {
      const cands = livresE().filter(e => Math.sign(r.c) === Math.sign(e.c) && Math.abs(e.c) < Math.abs(r.c) && Math.abs(r.n - e.n) <= tol);
      if (cands.length < 2) continue;
      const s = subconjunto(r.c, cands, 8);
      if (s) novo("agrupado", s, [r], `${s.length} lançamentos do extrato foram contabilizados juntos em 1 lançamento no razão.`);
    }
    // 3b) totais do dia que batem (vários × vários)
    const dias = [...new Set(livresE().map(e => e.n))];
    for (const n of dias) {
      for (const sinal of [1, -1]) {
        const es = livresE().filter(e => e.n === n && Math.sign(e.c) === sinal);
        const rs = livresR().filter(r => r.n === n && Math.sign(r.c) === sinal);
        if (!es.length || !rs.length || (es.length === 1 && rs.length === 1)) continue;
        if (es.reduce((a, t) => a + t.c, 0) === rs.reduce((a, t) => a + t.c, 0))
          novo("agrupado", es, rs, `O total do dia bate (${es.length} no extrato × ${rs.length} no razão), mas os lançamentos foram separados de forma diferente.`);
      }
    }
    // 4) sinal trocado (débito/crédito invertido no razão)
    for (const e of livresE()) {
      const cands = (porValor.get(-e.c) || []).filter(r => !r.usado && Math.abs(r.n - e.n) <= tol);
      if (cands.length) {
        const r = melhorPor(e, cands);
        novo("sinal", [e], [r], `No extrato é ${e.c > 0 ? "entrada" : "saída"}, mas no razão foi lançado como ${r.c > 0 ? "entrada (débito)" : "saída (crédito)"}. Inverter débito/crédito.`);
      }
    }
    // 5) valor diferente (mesmo lançamento com valor errado)
    const pares = [];
    for (const e of livresE()) {
      for (const r of livresR()) {
        if (Math.sign(r.c) !== Math.sign(e.c) || Math.abs(r.n - e.n) > tol) continue;
        const sim = similaridade(e, r);
        const rel = Math.abs(e.c - r.c) / Math.max(Math.abs(e.c), Math.abs(r.c));
        const d = Math.abs(e.c - r.c);
        const transp = d % 9 === 0 && d < Math.abs(e.c);
        const prox = rel <= 0.02 || (transp && rel <= 0.9);
        if (sim >= 0.5 || (sim >= 0.25 && rel <= 0.5) || prox) {
          pares.push({ e, r, score: sim * 2 - rel - Math.abs(r.n - e.n) * 0.1 + (r.n === e.n ? 0.3 : 0) + (prox ? 0.5 : 0) });
        }
      }
    }
    pares.sort((a, b) => b.score - a.score);
    for (const p of pares) {
      if (p.e.usado || p.r.usado) continue;
      const d = Math.abs(p.e.c - p.r.c);
      let nota = `Corrigir o valor no razão de ${fmtValor(Math.abs(p.r.c) / 100)} para ${fmtValor(Math.abs(p.e.c) / 100)}.`;
      if (d % 9 === 0) nota += " A diferença é múltipla de 9: possível inversão de dígitos na digitação.";
      novo("valor", [p.e], [p.r], nota);
    }
    // 6) o que sobrou
    for (const e of livresE()) novo("falta", [e], [], `Lançar no razão em ${fmtData(e.data)}: ${e.c > 0 ? "entrada (débito no Banco)" : "saída (crédito no Banco)"} de ${fmtValor(Math.abs(e.c) / 100)}.`);
    const conciliadosR = raz.filter(r => r.usado);
    // Sem par e fora do período exato do extrato: vai para "fora do período", não é pendência
    for (const r of livresR()) {
      if (r.n < ini || r.n > fim) { r.usado = true; fora.push(r); raz.splice(raz.indexOf(r), 1); }
    }
    fora.sort((a, b) => a.n - b.n);
    for (const r of livresR()) {
      const dup = conciliadosR.some(o => o.c === r.c && Math.abs(o.n - r.n) <= tol) || raz.some(o => o !== r && !o.usado && o.c === r.c && o.n === r.n && o.id < r.id);
      novo("sobra", [], [r], dup
        ? "Possível lançamento em DUPLICIDADE: já existe outro lançamento igual no razão. Estornar."
        : "Não aparece no extrato. Verificar se foi lançado na conta errada, se é de outro período ou se deve ser estornado.");
    }

    // ordem por data
    const dataGrupo = g => Math.min(...g.ext.concat(g.raz).map(t => t.n));
    grupos.sort((a, b) => dataGrupo(a) - dataGrupo(b));

    const soma = (lista) => r2(lista.reduce((a, t) => a + t.c, 0) / 100);
    const entradas = l => r2(l.filter(t => t.c > 0).reduce((a, t) => a + t.c, 0) / 100);
    const saidas = l => r2(l.filter(t => t.c < 0).reduce((a, t) => a + t.c, 0) / 100);
    const porTipo = {};
    for (const g of grupos) {
      const k = porTipo[g.tipo] || (porTipo[g.tipo] = { qtd: 0, dif: 0 });
      k.qtd++; k.dif = r2(k.dif + g.dif);
    }
    return {
      grupos, fora, porTipo, tol, inverter,
      extrato: { qtd: ext.length, entradas: entradas(ext), saidas: saidas(ext), liquido: soma(ext), inicio: ext.length ? ext.map(t => t.data).sort()[0] : null, fim: ext.length ? ext.map(t => t.data).sort().pop() : null },
      razao: { qtd: raz.length, entradas: entradas(raz), saidas: saidas(raz), liquido: soma(raz) },
      diferenca: r2(soma(ext) - soma(raz)),
    };
  }

  // Detecta se o razão está com sinais invertidos (ex.: conta de passivo ou exportação ao contrário)
  function sugerirInversao(extrato, razao) {
    const chave = (t, s) => t.data + "|" + Math.round(t.valor * 100) * s;
    const ex = new Map();
    for (const t of extrato) ex.set(chave(t, 1), (ex.get(chave(t, 1)) || 0) + 1);
    const conta = s => razao.reduce((a, t) => a + (ex.get(chave(t, s)) ? 1 : 0), 0);
    const normal = conta(1), invertido = conta(-1);
    return invertido > 3 && invertido > normal * 1.5;
  }

  function fmtData(d) { return d ? `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}` : ""; }
  const FMT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmtValor(v) { return v == null ? "" : FMT.format(v); }

  window.Conciliacao = { conciliar, sugerirInversao, fmtData, fmtValor };
})();
