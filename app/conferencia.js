// Conferência: para cada nota fiscal, procura no razão o lançamento correspondente.
// Regras, da mais forte para a mais fraca:
//   1. número da nota no histórico/documento (com "NF", "Nota", "Doc"... ou na coluna de documento) e mesmo valor
//   2. número da nota e soma de vários lançamentos = valor (parcelas)
//   3. número aparece solto no histórico e mesmo valor
//   4. número encontrado, mas valor diferente
//   5. sem número: mesmo valor, data próxima e nome/CNPJ do participante no histórico (provável)
(function () {
  "use strict";
  const { norm } = window.Leitura;
  const { semZeros, so } = window.Notas;
  const diaN = d => d ? Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 86400000 : null;
  const cent = v => Math.round(Math.abs(v) * 100);
  const VAZIAS = new Set(["ltda", "me", "epp", "eireli", "s/a", "sa", "cia", "comercio", "industria", "servicos", "de", "da", "do", "das", "dos", "e", "the", "com", "ind", "com.", "ltda.", "brasil", "nf", "nfe", "nota", "fiscal", "pagto", "pagamento", "ref", "valor"]);

  // Números citados num lançamento. "fortes": logo após NF/Nota/Doc/etc. ou na coluna de documento.
  const RE_FORTE = /\b(?:nfs-?e|nf-?e|nfc-?e|ct-?e|nf|nfs|n\.f\.?|nota(?: fiscal)?(?: n[ºo°.]*)?|doc(?:umento)?|dup(?:licata)?|fat(?:ura)?|titulo|tit|n[ºo°])[\s.:º°#-]*(\d[\d.\/-]*)/gi;
  function numerosDoLancamento(t) {
    const desc = String(t.desc || "").replace(/(\d)\.(?=\d{3}\b)/g, "$1");
    const fortes = new Set(), fracos = new Set();
    for (const p of String(t.doc || "").split(/[^\d]+/)) if (p) fortes.add(semZeros(p));
    let m;
    RE_FORTE.lastIndex = 0;
    while ((m = RE_FORTE.exec(desc))) {
      // "123/1" (nota/série ou parcela) e "123-1": o número é a primeira parte; "123, 124 e 125" também conta
      for (const p of m[1].split(/[\/-]/).slice(0, 1)) if (so(p)) fortes.add(semZeros(p));
      const resto = desc.slice(RE_FORTE.lastIndex).match(/^(\s*(?:,|e|\/)\s*\d+)+/);
      if (resto) for (const p of resto[0].split(/[^\d]+/)) if (p) fortes.add(semZeros(p));
    }
    for (const p of desc.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ").split(/[^\d]+/)) if (p && p.length <= 15) fracos.add(semZeros(p));
    fortes.forEach(n => fracos.delete(n));
    return { fortes, fracos };
  }

  // Números alternativos da nota: NFS-e de alguns municípios usa ano + sequência (202400000000123)
  function numerosDaNota(n) {
    const s = new Set([n.numero]);
    const m = n.numero.match(/^(20\d{2})0*(\d+)$/);
    if (m && n.numero.length >= 10) s.add(m[2]);
    return [...s].filter(Boolean);
  }

  function tokensNome(s) {
    return new Set(norm(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter(w => w.length >= 3 && !VAZIAS.has(w) && !/^\d+$/.test(w)));
  }
  function nomeNoHistorico(nome, desc) {
    const tn = tokensNome(nome); if (!tn.size) return 0;
    const td = tokensNome(desc); let i = 0;
    for (const w of tn) if (td.has(w)) i++;
    return i / Math.min(tn.size, 3);
  }

  // Subconjunto (até 8 itens) que soma exatamente o alvo, em centavos
  function somaExata(alvo, lista) {
    const l = lista.slice(0, 18); let achou = null, nos = 0;
    const esc = [];
    (function dfs(i, s) {
      if (achou || ++nos > 30000) return;
      if (s === alvo && esc.length >= 2) { achou = esc.slice(); return; }
      if (i >= l.length || esc.length >= 8 || s > alvo) return;
      for (let j = i; j < l.length && !achou; j++) { esc.push(l[j]); dfs(j + 1, s + l[j].c); esc.pop(); }
    })(0, 0);
    return achou;
  }

  function conferir(notasIn, razao, opcoes) {
    const tol = Math.round(((opcoes && opcoes.tolValor) || 0) * 100);
    const janela = (opcoes && opcoes.diasProvavel) || 60;
    const lancs = razao.map((t, i) => ({ ...t, id: i, c: cent(t.valor), n: diaN(t.data), ...numerosDoLancamento(t) }));
    const ini = lancs.length ? Math.min(...lancs.map(t => t.n)) : null;
    const fim = lancs.length ? Math.max(...lancs.map(t => t.n)) : null;

    // Índices por número
    const porForte = new Map(), porFraco = new Map();
    for (const t of lancs) {
      for (const k of t.fortes) { if (!porForte.has(k)) porForte.set(k, []); porForte.get(k).push(t); }
      for (const k of t.fracos) { if (!porFraco.has(k)) porFraco.set(k, []); porFraco.get(k).push(t); }
    }

    // CNPJ da própria empresa: o que mais aparece nas notas (como emitente ou destinatário)
    const conta = new Map();
    for (const n of notasIn) for (const c of new Set([n.emitCnpj, n.destCnpj].filter(Boolean))) conta.set(c, (conta.get(c) || 0) + 1);
    let empresa = "", maior = 0;
    for (const [c, q] of conta) if (q > maior) { maior = q; empresa = c; }
    if (maior < Math.max(2, notasIn.length * 0.5)) empresa = "";

    const usados = new Map(); // id do lançamento -> notas que o usaram
    const resultados = [];
    for (const nota of notasIn) {
      const tipo = !empresa ? "" : nota.destCnpj === empresa ? "Entrada" : nota.emitCnpj === empresa ? "Saída" : "";
      const part = tipo === "Saída" ? { cnpj: nota.destCnpj, nome: nota.destNome } : { cnpj: nota.emitCnpj, nome: nota.emitNome || nota.destNome };
      const valores = [nota.valor, ...(nota.valoresAlt || [])].filter(v => v).map(cent);
      const bate = c => valores.some(v => Math.abs(v - c) <= tol);
      const nums = numerosDaNota(nota);
      const fortes = [...new Set(nums.flatMap(k => porForte.get(k) || []))];
      const fracos = [...new Set(nums.flatMap(k => porFraco.get(k) || []))];
      // Com vários lançamentos do mesmo número, prefere os que citam o participante
      const ordenar = l => l.sort((a, b) => nomeNoHistorico(part.nome, b.desc) - nomeNoHistorico(part.nome, a.desc) || Math.abs(a.n - (diaN(nota.data) || a.n)) - Math.abs(b.n - (diaN(nota.data) || b.n)));
      let r = null;

      const fv = ordenar(fortes.filter(t => bate(t.c)));
      if (fv.length) {
        const somaFv = fv.reduce((a, t) => a + t.c, 0);
        const parcelas = fv.length > 1 && valores.some(v => Math.abs(v - somaFv) <= tol);
        r = { situacao: "lancada", lancs: fv, obs: !(fv.length > 1) ? "" : parcelas ? `Lançada em ${fv.length} parcelas que somam o valor da nota.` : `Número e valor aparecem em ${fv.length} lançamentos (ex.: compra e pagamento).` };
      }
      if (!r && fortes.length >= 2) {
        for (const v of valores) {
          const s = somaExata(v, fortes.slice().sort((a, b) => b.c - a.c));
          if (s) { r = { situacao: "lancada", lancs: s, obs: `Lançada em ${s.length} parcelas que somam o valor da nota.` }; break; }
        }
      }
      if (!r) {
        const wv = ordenar(fracos.filter(t => bate(t.c)));
        if (wv.length) r = { situacao: "lancada", lancs: wv.slice(0, 3), obs: "O número aparece no histórico sem \"NF\" antes; valor confere." };
      }
      if (!r && fortes.length) {
        const prox = ordenar(fortes.slice()).sort((a, b) => Math.abs(a.c - valores[0]) - Math.abs(b.c - valores[0]));
        const dif = (prox[0].c - valores[0]) / 100;
        const dc = Math.abs(prox[0].c - valores[0]);
        r = { situacao: "divergente", lancs: prox.slice(0, 3), dif, obs: `Número encontrado no razão, mas o valor lançado é diferente (diferença ${dif.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}).` +
          (dc % 9 === 0 ? " A diferença é múltipla de 9: possível inversão de dígitos na digitação." : " Pode ser lançamento líquido de retenções, desconto ou erro de digitação.") };
      }
      if (!r && nota.data) {
        const dn = diaN(nota.data);
        const cands = lancs.filter(t => bate(t.c) && t.n >= dn - 5 && t.n <= dn + janela).map(t => ({
          t, nome: nomeNoHistorico(part.nome, t.desc), cnpj: part.cnpj && so(t.desc).includes(part.cnpj.slice(0, 8)),
        })).filter(o => o.nome >= 0.5 || o.cnpj || (o.t.n === dn));
        cands.sort((a, b) => (b.nome + (b.cnpj ? 1 : 0)) - (a.nome + (a.cnpj ? 1 : 0)) || Math.abs(a.t.n - dn) - Math.abs(b.t.n - dn));
        if (cands.length) r = { situacao: "provavel", lancs: [cands[0].t], obs: cands[0].nome >= 0.5 || cands[0].cnpj ? "Valor e participante conferem, mas o número da nota não aparece no histórico." : "Mesmo valor e mesma data, sem número nem nome no histórico. Confirme." };
      }
      if (!r) r = { situacao: "nao", lancs: [], obs: "" };

      // Período do razão e notas canceladas
      const dn = diaN(nota.data);
      if (r.situacao === "nao" && dn != null && ini != null && (dn > fim || dn < ini - 31)) {
        r = { situacao: "fora", lancs: [], obs: "Nota emitida fora do período do razão." };
      }
      if (nota.cancelada) {
        r = r.lancs.length
          ? { situacao: "cancelada-lancada", lancs: r.lancs, obs: "Nota CANCELADA, mas há lançamento correspondente no razão. Estornar." }
          : { situacao: "cancelada", lancs: [], obs: "Nota cancelada e não lançada (correto)." };
      }
      if (r.situacao === "nao") r.obs = tipo === "Saída" ? "Não encontrada no razão. Lançar a venda/receita." : "Não encontrada no razão. Lançar a nota.";
      for (const t of r.lancs) { if (!usados.has(t.id)) usados.set(t.id, []); usados.get(t.id).push(nota); }
      resultados.push({ nota, tipo, part, ...r });
    }
    // Um mesmo lançamento usado por notas diferentes (mesmo número de fornecedores diferentes)
    for (const res of resultados) {
      const outras = res.lancs.flatMap(t => usados.get(t.id) || []).filter(n => n !== res.nota);
      if (outras.length && res.situacao !== "nao") res.obs = (res.obs ? res.obs + " " : "") + `Atenção: o mesmo lançamento também foi associado à nota ${outras[0].numero}${outras[0].emitNome ? " de " + outras[0].emitNome : ""}.`;
    }

    // Lançamentos que citam NF com número que não está entre os arquivos de notas
    const numerosNotas = new Set(notasIn.flatMap(numerosDaNota));
    const semArquivo = lancs.filter(t => /\b(nf|nfs|nfe|nf-e|nfs-e|nota|ct-?e)\b/i.test(t.desc) && t.fortes.size && ![...t.fortes].some(k => numerosNotas.has(k)) && !usados.has(t.id));

    const qtd = {};
    for (const r of resultados) qtd[r.situacao] = (qtd[r.situacao] || 0) + 1;
    return { resultados, semArquivo, empresa, qtd, periodo: ini != null ? [lancs.find(t => t.n === ini).data, lancs.find(t => t.n === fim).data] : null };
  }

  // Junta notas repetidas (mesma chave, ou mesmo número+CNPJ+valor) e aplica cancelamentos vindos de eventos
  function consolidar(notas, cancelamentos) {
    const mapa = new Map();
    for (const n of notas) {
      const k = n.chave && n.chave.length === 44 ? n.chave : `${n.modelo}|${n.emitCnpj}|${n.numero}|${n.serie}|${cent(n.valor || 0)}`;
      const ex = mapa.get(k);
      if (!ex) { mapa.set(k, { ...n }); continue; }
      // Prefere a versão XML (mais completa) à PDF/planilha
      if (ex.origem !== "XML" && n.origem === "XML") mapa.set(k, { ...n, cancelada: n.cancelada || ex.cancelada });
      else ex.cancelada = ex.cancelada || n.cancelada;
    }
    const out = [...mapa.values()];
    for (const n of out) if (n.chave && cancelamentos.has(n.chave)) n.cancelada = true;
    out.sort((a, b) => (a.data || "").localeCompare(b.data || "") || (+a.numero - +b.numero));
    return out;
  }

  window.Conferencia = { conferir, consolidar, numerosDoLancamento };
})();
