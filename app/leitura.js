// Leitura dos arquivos (Excel, CSV, PDF e OFX) para uma lista única de lançamentos.
// Convenção de sinal em TODO o sistema: valor positivo = entrou dinheiro no banco, negativo = saiu.
//   Extrato:  crédito = entrada (+), débito = saída (−)
//   Razão da conta Banco (ativo): débito = entrada (+), crédito = saída (−)
(function () {
  "use strict";

  /* ---------- utilitários ---------- */
  const norm = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const p2 = n => String(n).padStart(2, "0");
  const ymd = (a, m, d) => `${a}${p2(m)}${p2(d)}`;
  const r2 = v => Math.round(v * 100) / 100;

  function dataValida(a, m, d) {
    a = +a; m = +m; d = +d;
    if (a < 1990 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return ymd(a, m, d);
  }

  // Aceita Date, número de série do Excel, "dd/mm/aaaa", "dd/mm/aa", "dd.mm.aaaa", "aaaa-mm-dd" e "dd/mm" (com ano padrão)
  function parseData(v, anoPadrao) {
    if (v == null || v === "") return null;
    if (v instanceof Date && !isNaN(v)) return dataValida(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === "number") {
      if (v < 20000 || v > 80000) return null;
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return dataValida(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return dataValida(m[1], m[2], m[3]);
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
    if (m) { let a = +m[3]; if (a < 100) a += 2000; return dataValida(a, m[2], m[1]); }
    m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m && anoPadrao) return dataValida(anoPadrao, m[2], m[1]);
    return null;
  }

  // Devolve { v, dc } — v sem considerar D/C (só o sinal "-" ou parênteses); dc = "D" | "C" | null
  function parseValor(x) {
    if (x == null || x === "") return null;
    if (typeof x === "number") return isFinite(x) ? { v: x, dc: null } : null;
    let s = String(x).trim().replace(/ /g, " ");
    if (!s) return null;
    let dc = null, neg = false;
    let m = s.match(/^(.*?)\s*\(?\s*([DC])\s*\)?$/i);
    if (m && /\d/.test(m[1])) { dc = m[2].toUpperCase(); s = m[1]; }
    s = s.replace(/R\$/gi, "").replace(/\s/g, "");
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/^-/.test(s)) { neg = true; s = s.slice(1); }
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    if (/^\+/.test(s)) s = s.slice(1);
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/\.\d{1,2}$/.test(s) && s.includes(",")) s = s.replace(/,/g, "");
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
    const v = parseFloat(s);
    if (!isFinite(v)) return null;
    return { v: neg ? -v : v, dc };
  }

  // Sinal a partir de D/C, conforme o lado. No extrato "D" = saída; no razão (conta Banco) "D" = entrada.
  function aplicarDC(p, lado) {
    if (!p) return null;
    if (!p.dc) return p.v;
    const abs = Math.abs(p.v);
    if (lado === "extrato") return p.dc === "C" ? abs : -abs;
    return p.dc === "D" ? abs : -abs;
  }

  /* ---------- classificação de cabeçalhos ---------- */
  const CLASSES = [
    ["dc", /^(d\/c|c\/d|dc|cd|d - c|natureza|nat\.?|tipo|sinal|deb\/cred|d\/c\s*\(.*\))$/],
    ["saldo", /saldo/],
    ["data", /^(data|dt|dia)\b|^data|\bdata\b/],
    ["debito", /debito|^deb\.?$/],
    ["credito", /credito|^cred\.?$/],
    ["saida", /saida|pagamento|despesa|retirada|^pago/],
    ["entrada", /entrada|recebimento|receita|deposito|^recebido/],
    ["valor", /valor|montante|quantia|^r\$$|importancia|^movimento$/],
    ["desc", /historico|descricao|complemento|lancamento|memo|detalhe|favorecido|observa|^nome|contrapartida|discrimina|^cliente|fornecedor|^conta$/],
    ["doc", /documento|^doc\.?$|^lote|^numero|^n[o°º.]|^nr|^num\.?$/],
  ];
  function classificar(cel) {
    const n = norm(cel);
    if (!n || n.length > 40) return null;
    for (const [c, re] of CLASSES) if (re.test(n)) return c;
    return null;
  }

  const IGNORAR = /saldo anterior|saldo inicial|saldo final|saldo do dia|saldo em |saldo atual|saldo disponivel|saldo bloqueado|^total|\btotal (do|da|de|geral)|totais|a transportar|^de transporte|^transporte|^sdo\b|^s a l d o/;
  const SALDO_INI = /saldo anterior|saldo inicial|^de transporte|^transporte/;

  // Converte as colunas de valor de uma linha em um valor com sinal
  function valorDaLinha(cel, cols, lado) {
    const get = c => cols[c] != null ? parseValor(cel(cols[c])) : null;
    const dcTxt = cols.dc != null ? norm(cel(cols.dc)) : "";
    let dc = null;
    if (/^(d|deb|debito|-|saida|s)$/.test(dcTxt)) dc = "D";
    else if (/^(c|cred|credito|\+|entrada|e)$/.test(dcTxt)) dc = "C";
    let total = null;
    const soma = v => { total = (total || 0) + v; };
    const deb = get("debito"), cre = get("credito"), sai = get("saida"), ent = get("entrada");
    if (deb && deb.v) soma(lado === "extrato" ? -Math.abs(deb.v) : Math.abs(deb.v));
    if (cre && cre.v) soma(lado === "extrato" ? Math.abs(cre.v) : -Math.abs(cre.v));
    if (sai && sai.v) soma(-Math.abs(sai.v));
    if (ent && ent.v) soma(Math.abs(ent.v));
    if (total == null) {
      const val = get("valor");
      if (val && val.v) {
        if (dc && !val.dc) val.dc = dc;
        total = aplicarDC(val, lado);
      }
    }
    return total;
  }

  /* ---------- Excel / CSV ---------- */
  function lerPlanilha(buf, nome, lado) {
    if (!window.XLSX) throw new Error("O leitor de Excel não carregou. Verifique se a pasta vendor está junto do programa.");
    const csv = /\.(csv|txt)$/i.test(nome);
    const wb = XLSX.read(buf, { type: "array", raw: csv, cellDates: false, codepage: 65001 });
    let melhor = null;
    for (const nomeAba of wb.SheetNames) {
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, raw: true, defval: "", blankrows: false });
      const r = lerTabela(linhas, lado);
      if (r && (!melhor || r.lancs.length > melhor.lancs.length)) { melhor = r; melhor.aba = nomeAba; }
    }
    if (!melhor) throw new Error("Não encontrei uma tabela com colunas de Data e Valor (ou Débito/Crédito) nesta planilha.");
    if (wb.SheetNames.length > 1) melhor.avisos.push(`Planilha com várias abas: usei a aba "${melhor.aba}".`);
    return melhor;
  }

  function lerTabela(linhas, lado) {
    let iCab = -1, cols = null;
    for (let i = 0; i < Math.min(linhas.length, 60); i++) {
      const c = {}; const descs = [];
      linhas[i].forEach((cel, j) => {
        const k = classificar(cel);
        if (!k) return;
        if (k === "desc") descs.push(j);
        else if (c[k] == null) c[k] = j;
      });
      if (c.data != null && (c.valor != null || c.debito != null || c.credito != null || c.entrada != null || c.saida != null)) {
        if (c.debito != null || c.credito != null || c.entrada != null || c.saida != null) delete c.valor;
        c.descs = descs; iCab = i; cols = c; break;
      }
    }
    if (!cols) return null;
    const lancs = [], avisos = [];
    let saldoInicial = null, saldoFinal = null, ultimo = null;
    for (let i = iCab + 1; i < linhas.length; i++) {
      const row = linhas[i];
      const cel = j => row[j];
      const desc = cols.descs.map(j => String(row[j] == null ? "" : row[j]).trim()).filter(Boolean).join(" - ");
      const data = parseData(cel(cols.data));
      const nd = norm(desc);
      const saldo = cols.saldo != null ? parseValor(cel(cols.saldo)) : null;
      const saldoV = saldo ? aplicarDC(saldo, lado) : null;
      if (IGNORAR.test(nd) || (!desc && IGNORAR.test(norm(row.join(" "))))) {
        const v = saldoV != null ? saldoV : valorDaLinha(cel, cols, lado);
        if (SALDO_INI.test(nd || norm(row.join(" "))) && v != null && saldoInicial == null && !lancs.length) saldoInicial = v;
        ultimo = null; continue;
      }
      if (!data) {
        // Linha de continuação do histórico
        if (ultimo && desc && valorDaLinha(cel, cols, lado) == null) ultimo.desc += " " + desc;
        else ultimo = null;
        continue;
      }
      const v = valorDaLinha(cel, cols, lado);
      if (v == null || Math.abs(v) < 0.005) { ultimo = null; continue; }
      ultimo = { data, desc: desc || "(sem histórico)", valor: r2(v), doc: cols.doc != null ? String(cel(cols.doc) || "").trim() : "" };
      if (saldoV != null) { ultimo.saldoApos = saldoV; saldoFinal = saldoV; }
      lancs.push(ultimo);
    }
    if (!lancs.length) return null;
    return { lancs, avisos, saldoInicial, saldoFinal, formato: "Planilha" };
  }

  /* ---------- PDF ---------- */
  async function linhasPdf(buf) {
    if (!window.pdfjsLib) throw new Error("O leitor de PDF não carregou. Verifique se a pasta vendor está junto do programa.");
    const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const itens = tc.items
        .filter(i => typeof i.str === "string" && i.str.trim() !== "")
        .map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 8 }));
      itens.sort((a, b) => b.y - a.y || a.x - b.x);
      const linhas = [];
      for (const it of itens) {
        let l = linhas.find(l => Math.abs(l.y - it.y) <= Math.max(2.5, it.h * 0.35));
        if (!l) { l = { y: it.y, its: [] }; linhas.push(l); }
        l.its.push(it);
      }
      linhas.sort((a, b) => b.y - a.y);
      for (const l of linhas) {
        l.its.sort((a, b) => a.x - b.x);
        let t = "", fim = null;
        for (const it of l.its) {
          if (fim !== null && it.x - fim > 1 && !t.endsWith(" ") && !it.s.startsWith(" ")) t += " ";
          t += it.s; fim = it.x + it.w;
        }
        out.push({ pagina: p, its: l.its, texto: t.replace(/\u0000/g, "").replace(/\s+/g, " ").trim() });
      }
    }
    return out;
  }

  // Quebra os trechos de texto em palavras com posição horizontal estimada
  function palavras(its) {
    const out = [];
    for (const it of its) {
      const s = it.s.replace(/\u0000/g, "");
      const re = /\S+/g; let m;
      while ((m = re.exec(s))) {
        const x0 = it.x + it.w * (m.index / s.length);
        const x1 = it.x + it.w * ((m.index + m[0].length) / s.length);
        out.push({ s: m[0], x0, x1, xc: (x0 + x1) / 2 });
      }
    }
    // "R$" separado do número e "D"/"C" depois do número viram parte do valor
    for (let i = 0; i < out.length - 1; i++) {
      if (/^-?R\$$/i.test(out[i].s) && /^[\d(]/.test(out[i + 1].s)) {
        out[i + 1].s = (out[i].s.startsWith("-") ? "-" : "") + out[i + 1].s; out[i + 1].x0 = out[i].x0; out.splice(i, 1);
      }
    }
    for (let i = 1; i < out.length; i++) {
      if (/^[DC]$/.test(out[i].s) && RE_VALOR.test(out[i - 1].s)) {
        out[i - 1].s += out[i].s; out[i - 1].x1 = out[i].x1; out.splice(i, 1); i--;
      }
    }
    for (const w of out) w.xc = (w.x0 + w.x1) / 2;
    return out;
  }
  const RE_VALOR = /^\(?[-+]?(R\$)?[-+]?\d{1,3}(?:\.\d{3})*,\d{2}\)?-?[DC]?\*?$/i;
  const RE_DATA = /^\d{1,2}[\/.]\d{1,2}([\/.]\d{2,4})?$/;

  function lerPdfGenerico(linhas, lado) {
    const textoTodo = linhas.map(l => l.texto).join("\n");
    const mAno = textoTodo.match(/\b\d{1,2}\/\d{1,2}\/(\d{4})\b/);
    const anoPadrao = mAno ? +mAno[1] : null;
    let cols = null; // [{ tipo, xc }]
    const lancs = [], avisos = [];
    let saldoInicial = null, saldoFinal = null, saldoAnt = null, ultimo = null, ultimaData = null, contCont = 0;

    for (const l of linhas) {
      const ws = palavras(l.its);
      if (!ws.length) continue;
      const nt = norm(l.texto);

      // Cabeçalho da tabela (pode se repetir em cada página)
      if (/\bdata\b|\bdt\b/.test(nt) && /debito|credito|valor|entrada|saida|saldo/.test(nt) && !ws.some(w => RE_VALOR.test(w.s))) {
        const c = [];
        for (const w of ws) {
          const k = classificar(w.s.replace(/[():]/g, ""));
          if (k && ["debito", "credito", "entrada", "saida", "valor", "saldo", "dc"].includes(k)) c.push({ tipo: k, xc: w.xc, x1: w.x1 });
        }
        if (c.some(k => k.tipo !== "valor") && c.some(k => k.tipo === "debito" || k.tipo === "credito" || k.tipo === "entrada" || k.tipo === "saida")) {
          cols = c.filter(k => k.tipo !== "valor");
        } else if (c.length) cols = c;
        ultimo = null; continue;
      }

      // Data no início da linha (nas três primeiras palavras)
      let data = null, iData = -1;
      for (let i = 0; i < Math.min(3, ws.length); i++) {
        if (RE_DATA.test(ws[i].s)) { data = parseData(ws[i].s, anoPadrao); if (data) { iData = i; break; } }
      }
      const valores = ws.map((w, i) => ({ w, i })).filter(o => o.i !== iData && RE_VALOR.test(o.w.s));
      const descr = ws.filter((w, i) => i !== iData && !RE_VALOR.test(w.s)).map(w => w.s).join(" ").trim().replace(/^(\d+\s+)+(?=\D)/, "");
      const nd = norm(descr);

      if (IGNORAR.test(nd)) {
        if (valores.length) {
          const pv = parseValor(valores[valores.length - 1].w.s.replace(/\*$/, ""));
          const v = aplicarDC(pv, lado);
          if (v != null) {
            if (SALDO_INI.test(nd) && saldoInicial == null && !lancs.length) saldoInicial = v;
            if (/saldo/.test(nd)) { saldoAnt = v; saldoFinal = v; }
          }
        }
        ultimo = null; continue;
      }

      if (!valores.length) {
        // Continuação do histórico do lançamento anterior
        if (ultimo && !data && descr && contCont < 3 && !/pagina|folha|emissao|emitido|cnpj|^conta\b|usuario|impresso|^empresa/.test(nd)) {
          ultimo.desc += " " + descr; contCont++;
        } else if (!data) ultimo = null;
        continue;
      }
      if (!data) {
        // Lançamentos do mesmo dia sem repetir a data
        if (!ultimaData || !descr || !lancs.length) continue;
        data = ultimaData;
      }

      // Atribuir cada valor a uma coluna
      let mov = null, saldo = null, temSinal = false;
      const pega = (o) => { const pv = parseValor(o.w.s.replace(/\*$/, "")); return pv; };
      if (cols && cols.length) {
        for (const o of valores) {
          let melhor = null, dist = Infinity;
          for (const c of cols) {
            const d = Math.min(Math.abs(c.xc - o.w.xc), Math.abs(c.x1 - o.w.x1));
            if (d < dist) { dist = d; melhor = c; }
          }
          const pv = pega(o); if (!pv) continue;
          const abs = Math.abs(pv.v);
          switch (melhor.tipo) {
            case "saldo": saldo = aplicarDC(pv, lado); break;
            case "debito": mov = (mov || 0) + (lado === "extrato" ? -abs : abs); temSinal = true; break;
            case "credito": mov = (mov || 0) + (lado === "extrato" ? abs : -abs); temSinal = true; break;
            case "saida": mov = (mov || 0) - abs; temSinal = true; break;
            case "entrada": mov = (mov || 0) + abs; temSinal = true; break;
            default: mov = (mov || 0) + aplicarDC(pv, lado); temSinal = pv.v < 0 || !!pv.dc;
          }
        }
      } else {
        const pv1 = pega(valores.length >= 2 ? valores[valores.length - 2] : valores[0]);
        if (valores.length >= 2) saldo = aplicarDC(pega(valores[valores.length - 1]), lado);
        if (pv1) { mov = aplicarDC(pv1, lado); temSinal = pv1.v < 0 || !!pv1.dc; }
      }
      if (mov == null || Math.abs(mov) < 0.005) { if (saldo != null) saldoAnt = saldo; continue; }
      // Sem sinal explícito: usa a variação do saldo
      if (!temSinal && saldo != null && saldoAnt != null) {
        const delta = r2(saldo - saldoAnt);
        if (Math.abs(Math.abs(delta) - Math.abs(mov)) < 0.011) mov = delta;
      }
      if (saldo != null) { saldoAnt = saldo; saldoFinal = saldo; }
      ultimo = { data, desc: descr || "(sem histórico)", valor: r2(mov) };
      if (saldo != null) ultimo.saldoApos = saldo;
      lancs.push(ultimo); ultimaData = data; contCont = 0;
    }
    if (!lancs.length) throw new Error("Não encontrei lançamentos neste PDF. Verifique se é um PDF com texto (não escaneado) e se as linhas começam com a data.");
    if (!cols) avisos.push("Não achei o cabeçalho das colunas (Débito/Crédito/Valor/Saldo) no PDF; os sinais foram deduzidos pelo saldo ou pelas letras D/C. Confira os lançamentos lidos.");
    return { lancs, avisos, saldoInicial, saldoFinal, formato: "PDF (leitura genérica)" };
  }

  async function lerPdf(buf, lado) {
    const linhas = await linhasPdf(buf);
    const texto = linhas.map(l => l.texto).join("\n");
    if (texto.replace(/\s/g, "").length < 50) throw new Error("Este PDF não tem texto legível (parece escaneado ou imagem). Baixe o arquivo de novo em PDF pelo sistema de origem.");
    if (lado === "extrato" && window.LeitoresBancos) {
      try {
        const r = LeitoresBancos.lerExtrato(texto);
        if (r.tx.length) {
          const conf = LeitoresBancos.conferir(r.info, r.tx);
          const avisos = [];
          if (conf.ok === false) avisos.push("Os saldos do próprio extrato não fecharam na leitura. Confira os lançamentos lidos.");
          return {
            lancs: r.tx.map(t => ({ data: t.data, desc: t.desc, valor: r2(t.valor), saldoApos: t.saldoApos })),
            avisos, saldoInicial: conf.saldoInicial, saldoFinal: conf.saldoFinal,
            formato: "Extrato " + r.info.banco, banco: r.info.banco, saldoConfere: conf.ok,
          };
        }
      } catch (e) {
        if (!/não reconhecido/i.test(e.message)) throw e;
      }
    }
    return lerPdfGenerico(linhas, lado);
  }

  /* ---------- OFX ---------- */
  function lerOfx(buf) {
    let texto = new TextDecoder("utf-8").decode(buf);
    if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf);
    const tag = (bloco, t) => { const m = bloco.match(new RegExp("<" + t + ">([^<\\r\\n]*)", "i")); return m ? m[1].trim() : ""; };
    const lancs = [];
    const re = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi; let m;
    while ((m = re.exec(texto))) {
      const b = m[1];
      const d = tag(b, "DTPOSTED").slice(0, 8);
      const v = parseFloat(tag(b, "TRNAMT").replace(",", "."));
      if (!/^\d{8}$/.test(d) || !isFinite(v) || !v) continue;
      const desc = [tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i).join(" - ");
      lancs.push({ data: d, desc: desc || "(sem histórico)", valor: r2(v), doc: tag(b, "CHECKNUM") });
    }
    if (!lancs.length) throw new Error("Nenhum lançamento encontrado no OFX.");
    const bal = texto.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([-\d.,]+)/i);
    lancs.sort((a, b) => a.data.localeCompare(b.data));
    const saldoFinal = bal ? parseFloat(bal[1].replace(",", ".")) : null;
    const soma = lancs.reduce((a, t) => a + t.valor, 0);
    return { lancs, avisos: [], saldoInicial: saldoFinal != null ? r2(saldoFinal - soma) : null, saldoFinal, formato: "OFX" };
  }

  /* ---------- entrada única ---------- */
  async function lerArquivo(nome, buf, lado) {
    const ext = (nome.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
    let r;
    if (ext === "pdf") r = await lerPdf(buf, lado);
    else if (["xlsx", "xls", "xlsm", "xlsb", "ods", "csv", "txt"].includes(ext)) r = lerPlanilha(buf, nome, lado);
    else if (ext === "ofx") r = lerOfx(buf);
    else throw new Error("Tipo de arquivo não aceito. Use PDF, Excel (.xlsx/.xls), CSV ou OFX.");
    r.lancs.sort((a, b) => a.data.localeCompare(b.data));
    r.lancs.forEach(t => { t.arquivo = nome; t.lado = lado; });
    return r;
  }

  window.Leitura = { lerArquivo, parseData, parseValor, norm };
})();
