// Leitores de extratos em PDF por banco (copiados do Conversor de Extratos OFX).
// Cada leitor devolve { info, tx } com tx = [{ data: "AAAAMMDD", desc, valor, saldoApos? }].
(function () {
  "use strict";
  /* ---------- utilitários ---------- */
  const MESES = { janeiro: 1, fevereiro: 2, marco: 3, "março": 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
  const ABREV = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
  const valor = t => parseFloat(t.replace(/\./g, "").replace(",", "."));
  const sinal = (neg, v) => (neg ? -1 : 1) * valor(v);
  const ymd = (a, m, d) => `${a}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  const r2 = v => Math.round(v * 100) / 100;
  const linhasDe = t => t.split("\n").map(l => l.trim()).filter(Boolean);
  const novoInfo = (banco, bankid) => ({ banco, bankid, agencia: "", conta: "", inicio: null, fim: null, saldo: null, saldoInicial: null });
  const marcarSaldo = (tx, v) => { if (tx.length) tx[tx.length - 1].saldoApos = v; };
  function periodoBr(info, texto, re) {
    const m = texto.match(re);
    if (m) { info.inicio = ymd(m[3], m[2], m[1]); info.fim = ymd(m[6], m[5], m[4]); }
  }

  /* ---------- Banco Inter ---------- */
  function lerInter(texto) {
    const info = novoInfo("Banco Inter", "077");
    let m = texto.match(/Ag[eê]ncia:\s*([\d-]+),\s*Conta:\s*([\d-]+)/i);
    if (m) { info.agencia = m[1]; info.conta = m[2]; }
    periodoBr(info, texto, /Per[ií]odo:\s*(\d{2})\/(\d{2})\/(\d{4})\s*a\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    m = texto.match(/^(-?)R\$\s?([\d.]+,\d{2})\s+R\$/m);
    if (m) info.saldo = sinal(m[1], m[2]);
    const tx = [];
    let data = null;
    for (const linha of linhasDe(texto)) {
      const md = linha.match(/^(\d{1,2}) de (\S+) de (\d{4})\s+Saldo do dia/i);
      if (md) { const mes = MESES[md[2].toLowerCase()]; if (mes) data = ymd(md[3], mes, md[1]); continue; }
      if (!data) continue;
      const mt = linha.match(/^(.+?)\s+(-?)R\$\s?([\d.]+,\d{2})\s+(-?)R\$\s?([\d.]+,\d{2})\s*$/);
      if (mt) tx.push({ data, desc: mt[1].trim(), valor: sinal(mt[2], mt[3]), saldoApos: sinal(mt[4], mt[5]) });
    }
    if (tx.length) info.saldoInicial = r2(tx[0].saldoApos - tx[0].valor);
    return { info, tx };
  }

  /* ---------- Nubank ---------- */
  function lerNubank(texto) {
    const info = novoInfo("Nubank", "0260");
    const linhas = linhasDe(texto);
    for (let i = 0; i < linhas.length && !info.agencia; i++) {
      const m = linhas[i].match(/Ag[eê]ncia\s+(\d+)\s+Conta\s*(\S*)/);
      if (m) { info.agencia = m[1]; info.conta = m[2] || linhas[i + 1] || ""; }
    }
    let m = texto.match(/(\d{2}) DE (\S+) DE (\d{4}) a (\d{2}) DE (\S+) DE (\d{4})/i);
    if (m) {
      const m1 = MESES[m[2].toLowerCase()], m2 = MESES[m[5].toLowerCase()];
      if (m1) info.inicio = ymd(m[3], m1, m[1]);
      if (m2) info.fim = ymd(m[6], m2, m[4]);
    }
    m = texto.match(/Saldo inicial\s+(-?)([\d.]+,\d{2})/);
    if (m) info.saldoInicial = sinal(m[1], m[2]);
    m = texto.match(/Saldo final do per[ií]odo\s+(-?)([\d.]+,\d{2})/);
    if (m) info.saldo = sinal(m[1], m[2]);
    const tx = [];
    let dentro = false, data = null, sn = 1;
    for (const l of linhas) {
      if (!dentro) { dentro = /^movimenta/i.test(l); continue; }
      const md = l.match(/^(\d{2}) (JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ) (\d{4})\b/);
      if (md) data = ymd(md[3], ABREV[md[2]], md[1]);
      if (/Total de entradas/.test(l)) { sn = 1; continue; }
      if (/Total de sa[ií]das/.test(l)) { sn = -1; continue; }
      const ms = l.match(/^Saldo do dia\s+(-?)([\d.]+,\d{2})/);
      if (ms) { marcarSaldo(tx, sinal(ms[1], ms[2])); continue; }
      if (md || !data || /^(Saldo|Rendimento)/.test(l)) continue;
      const mv = l.match(/^(.+?)\s+([+-]?\s?\d{1,3}(?:\.\d{3})*,\d{2})$/);
      if (mv) tx.push({ data, desc: mv[1].trim(), valor: sn * valor(mv[2].replace(/^[+\-\s]+/, "")) });
    }
    return { info, tx };
  }

  /* ---------- Banco do Brasil ---------- */
  function lerBB(texto) {
    const info = novoInfo("Banco do Brasil", "001");
    let m = texto.match(/Ag[eê]ncia:?\s*([\d-]+X?)/i); if (m) info.agencia = m[1];
    m = texto.match(/Conta(?: corrente)?:?\s*([\d.]+-[\dX])/i); if (m) info.conta = m[1];
    const tx = [];
    let ultimo = null;
    for (const l of linhasDe(texto)) {
      const mt = l.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{4}) (.+?) ([\d.]+,\d{2}) ([CD])$/);
      if (mt) {
        const v = sinal(mt[7] === "D", mt[6]);
        const desc = mt[5].trim();
        if (/^Saldo Anterior/i.test(desc)) { info.saldoInicial = v; ultimo = null; continue; }
        if (/^Saldo do dia|^S A L D O/i.test(desc)) { marcarSaldo(tx, v); ultimo = null; continue; }
        ultimo = { data: ymd(mt[3], mt[2], mt[1]), desc: desc.replace(/(\s+\d+){1,2}$/, ""), valor: v };
        tx.push(ultimo);
        continue;
      }
      if (ultimo && !/^(Conta corrente \+|bb\.com\.br|Data Origem|Extrato de Conta|Cliente$|Nome Posi|Movimenta)/i.test(l)) {
        ultimo.desc += " - " + l;
      }
      ultimo = null;
    }
    return { info, tx };
  }

  /* ---------- Banrisul ---------- */
  function lerBanrisul(texto) {
    const info = novoInfo("Banrisul", "041");
    let m = texto.match(/AGENCIA:\s*(\d+)/); if (m) info.agencia = m[1];
    m = texto.match(/CONTA\.*:\s*([\d.\-]+)/); if (m) info.conta = m[1];
    const tx = [];
    let dentro = false, mes = null, ano = null, dia = null, ultimo = null;
    for (const l of linhasDe(texto)) {
      if (!dentro) { dentro = /MOVIMENTOS DA CONTA CORRENTE/.test(l); continue; }
      if (/EXTRATO EMITIDO/.test(l)) break;
      if ((m = l.match(/^SALDO ANT EM (\d{2})\/(\d{2})\/(\d{4})\s+([\d.]+,\d{2})(-?)/))) { info.saldoInicial = sinal(m[5], m[4]); continue; }
      if ((m = l.match(/^\+\+ MOVIMENTOS ([A-Z]{3})\/(\d{4})/))) { mes = ABREV[m[1]]; ano = m[2]; continue; }
      if ((m = l.match(/^SALDO NA DATA\s+([\d.]+,\d{2})(-?)/))) { marcarSaldo(tx, sinal(m[2], m[1])); ultimo = null; continue; }
      if (!mes) continue;
      if ((m = l.match(/^(?:(\d{2}) )?(.+?) (\d{6}) ([\d.]+,\d{2})(-?)$/))) {
        if (m[1]) dia = m[1];
        if (!dia) continue;
        ultimo = { data: ymd(ano, mes, dia), desc: m[2].trim(), valor: sinal(m[5], m[4]) };
        tx.push(ultimo);
        continue;
      }
      if (ultimo && !/^[-+]/.test(l)) ultimo.desc += " - " + l;
    }
    return { info, tx };
  }

  /* ---------- Caixa ---------- */
  function lerCaixa(texto) {
    const info = novoInfo("Caixa", "104");
    let m = texto.match(/Conta:\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([\d-]+)/);
    if (m) { info.agencia = m[1]; info.conta = m[3]; }
    const tx = [];
    for (const l of linhasDe(texto)) {
      const mt = l.match(/^(?:(\d{2})\/(\d{2})\/(\d{4}) )?(\d{6}) (.+?) ([\d.]+,\d{2}) ([CD]) ([\d.]+,\d{2}) ([CD])$/);
      if (!mt) continue;
      const desc = mt[5].trim(), saldo = sinal(mt[9] === "D", mt[8]);
      if (/^SALDO ANTERIOR/.test(desc)) { info.saldoInicial = saldo; continue; }
      if (/^SALDO DIA/.test(desc)) { marcarSaldo(tx, saldo); continue; }
      if (!mt[1]) continue;
      tx.push({ data: ymd(mt[3], mt[2], mt[1]), desc: `${desc} (doc ${mt[4]})`, valor: sinal(mt[7] === "D", mt[6]), saldoApos: saldo });
    }
    return { info, tx };
  }

  /* ---------- Sicoob ---------- */
  function lerSicoob(texto) {
    const info = novoInfo("Sicoob", "756");
    let m = texto.match(/Cooperativa:\s*([\d-]+)/); if (m) info.agencia = m[1];
    m = texto.match(/Conta:\s*([\d.\-]+)/); if (m) info.conta = m[1];
    periodoBr(info, texto, /Periodo:\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    const anoIni = info.inicio ? +info.inicio.slice(0, 4) : new Date().getFullYear();
    const mesIni = info.inicio ? +info.inicio.slice(4, 6) : 1;
    const tx = [];
    let dentro = false, ultimo = null;
    for (const l of linhasDe(texto)) {
      if (!dentro) { dentro = /HIST.RICO DE MOVIMENTA/i.test(l); continue; }
      if (/^RESUMO$/.test(l)) break;
      const mt = l.match(/^(\d{2})\/(\d{2})\s+(.*?)\s*R\$\s?([\d.]+,\d{2})([CD*])$/);
      if (mt) {
        const desc = mt[3].trim(), v = sinal(mt[5] === "D", mt[4]);
        ultimo = null;
        if (mt[5] === "*" || /^SALDO BLOQUEADO/.test(desc)) continue;
        if (/^SALDO ANTERIOR/.test(desc)) { info.saldoInicial = v; continue; }
        if (/^SALDO DO DIA/.test(desc)) { marcarSaldo(tx, v); continue; }
        const mes = +mt[2], ano = mes < mesIni ? anoIni + 1 : anoIni;
        ultimo = { data: ymd(ano, mes, mt[1]), desc, valor: v };
        tx.push(ultimo);
        continue;
      }
      if (/^https?:|Internet Banking|^Data Documento/.test(l)) continue;
      if (ultimo) ultimo.desc += " - " + l;
    }
    return { info, tx };
  }

  /* ---------- Sicredi ---------- */
  function lerSicredi(texto) {
    const info = novoInfo("Sicredi", "748");
    let m = texto.match(/Cooperativa:\s*(\d+)/); if (m) info.agencia = m[1];
    m = texto.match(/Conta:\s*([\d-]+)/); if (m) info.conta = m[1];
    periodoBr(info, texto, /Per[ií]odo de (\d{2})\/(\d{2})\/(\d{4}) a (\d{2})\/(\d{2})\/(\d{4})/);
    m = texto.match(/SALDO ANTERIOR\s+(-?[\d.]+,\d{2})/);
    if (m) info.saldoInicial = valor(m[1].replace("-", "")) * (m[1].startsWith("-") ? -1 : 1);
    const N = "-?\\d{1,3}(?:\\.\\d{3})*,\\d{2}";
    const re = new RegExp(`^(\\d{2})\\/(\\d{2})\\/(\\d{4}) (.+?) (${N}) (${N})$`);
    const tx = [];
    for (const l of linhasDe(texto)) {
      if (/^Lan[çc]amentos Futuros/i.test(l)) break;
      const mt = l.match(re);
      if (!mt) continue;
      const num = s => sinal(s.startsWith("-"), s.replace("-", ""));
      tx.push({ data: ymd(mt[3], mt[2], mt[1]), desc: mt[4].trim(), valor: num(mt[5]), saldoApos: num(mt[6]) });
    }
    return { info, tx };
  }

  /* ---------- Stone ---------- */
  function lerStone(texto) {
    const info = novoInfo("Stone", "197");
    let m = texto.match(/Stone Institui[^\n]*?\s(\d{4})\s+(\d+)\s*$/m);
    if (m) { info.agencia = m[1]; info.conta = m[2]; }
    periodoBr(info, texto, /Per[ií]odo: de (\d{2})\/(\d{2})\/(\d{4}) a (\d{2})\/(\d{2})\/(\d{4})/);
    const L = linhasDe(texto);
    const re = /^(\d{2})\/(\d{2})\/(\d{2}) (Entrada|Sa[ií]da)\s+(-\s?)?R\$\s?([\d.]+,\d{2})\s+(-\s?)?R\$\s?([\d.]+,\d{2})\s*(.*)$/;
    const ruido = /^(Extrato de conta corrente|Emitido em|Per[ií]odo:|DATA TIPO|Dados da conta|Informa[çc][õo]es do Comprovante)/;
    const tx = [];
    L.forEach((l, i) => {
      const mt = l.match(re);
      if (!mt) return;
      const antes = i > 0 && !re.test(L[i - 1]) && !ruido.test(L[i - 1]) ? L[i - 1] : "";
      const depois = i + 1 < L.length && !re.test(L[i + 1]) && !ruido.test(L[i + 1]) ? L[i + 1] : "";
      const desc = [antes, depois, mt[9]].filter(Boolean).join(" - ") || mt[4];
      const saida = /^Sa/.test(mt[4]) || !!mt[5];
      tx.push({ data: ymd("20" + mt[3], mt[2], mt[1]), desc, valor: sinal(saida, mt[6]), saldoApos: sinal(mt[7], mt[8]) });
    });
    tx.reverse();
    return { info, tx };
  }

  /* ---------- Unicred ---------- */
  function lerUnicred(texto) {
    const info = novoInfo("Unicred", "136");
    let m = texto.match(/Coop:\s*(\d+)\s*-\s*AG:\s*(\d+)\s*-\s*Conta:\s*(\d+)/);
    if (m) { info.agencia = m[2]; info.conta = m[3]; }
    periodoBr(info, texto, /Per[ií]odo de (\d{2})\/(\d{2})\/(\d{4}) a (\d{2})\/(\d{2})\/(\d{4})/);
    m = texto.match(/Saldo em \d{2}\/\d{2}\/\d{4}:\s*(-\s?)?R\$\s?([\d.]+,\d{2})/);
    if (m) info.saldoInicial = sinal(m[1], m[2]);
    m = texto.match(/Saldo no final do per[ií]odo\s*(-\s?)?R\$\s?([\d.]+,\d{2})/);
    if (m) info.saldo = sinal(m[1], m[2]);
    const re = /^(\d{2})\/(\d{2})\/(\d{4})\s*(.*?)\s*(-\s?)?R\$\s?([\d.]+,\d{2})\s+(-\s?)?R\$\s?([\d.]+,\d{2})$/;
    const bal = s => (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
    const tx = [];
    let dentro = false, pend = [], atual = null;
    for (const l of linhasDe(texto)) {
      if (!dentro) { dentro = /^Data Lan[çc]amentos/.test(l); continue; }
      if (/^Saldo no final do per/i.test(l)) break;
      if (/^(CENTRAL DE RELACIONAMENTO|0800 200|Data Lan[çc]amentos)/.test(l)) continue;
      const mt = l.match(re);
      if (mt) {
        atual = { data: ymd(mt[3], mt[2], mt[1]), desc: [...pend, mt[4]].filter(Boolean).join(" "), valor: sinal(mt[5], mt[6]), saldoApos: sinal(mt[7], mt[8]) };
        tx.push(atual); pend = [];
        continue;
      }
      if (atual && bal(atual.desc) > 0) atual.desc += " " + l;
      else { pend.push(l); atual = null; }
    }
    tx.forEach(t => { t.desc = t.desc.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")"); });
    return { info, tx };
  }

  /* ---------- XP ---------- */
  function lerXP(texto) {
    const info = novoInfo("XP Investimentos", "102");
    let m = texto.match(/Conta:\s*(\d+)/); if (m) info.conta = m[1];
    periodoBr(info, texto, /De:\s*(\d{2})\/(\d{2})\/(\d{4})\s*At[ée]:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const L = linhasDe(texto);
    const ini = L.findIndex(l => /^Liq Mov Hist/.test(l));
    let fim = L.findIndex(l => /^Lan[çc]amentos futuros/i.test(l));
    if (fim < 0) fim = L.length;
    const re = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2})\/(\d{2})\/(\d{4})\s*(.*?)\s*(-?)R\$\s?([\d.]+,\d{2})\s+(-?)R\$\s?([\d.]+,\d{2})$/;
    const usado = new Set(), tx = [];
    for (let i = ini + 1; ini >= 0 && i < fim; i++) {
      const mt = L[i].match(re);
      if (!mt) continue;
      let desc = mt[7].trim();
      if (!desc) {
        const partes = [];
        if (i - 1 > ini && !re.test(L[i - 1]) && !usado.has(i - 1)) { partes.push(L[i - 1]); usado.add(i - 1); }
        if (i + 1 < fim && !re.test(L[i + 1])) { partes.push(L[i + 1]); usado.add(i + 1); }
        desc = partes.join(" ");
      }
      tx.push({ data: ymd(mt[3], mt[2], mt[1]), desc, valor: sinal(mt[8], mt[9]), saldoApos: sinal(mt[10], mt[11]) });
    }
    tx.reverse();
    return { info, tx };
  }

  /* ---------- identificação do banco ---------- */
  const LEITORES = [
    { nome: "Stone", teste: (c, t) => /Stone Institui/.test(c), ler: lerStone },
    { nome: "Sicoob", teste: (c, t) => /Sicoob \| Internet Banking|DO SICOOB - SISBR/.test(c), ler: lerSicoob },
    { nome: "Sicredi", teste: (c, t) => /^Associado:/m.test(c) && /^Cooperativa:/m.test(c), ler: lerSicredi },
    { nome: "Unicred", teste: (c, t) => /Coop:\s*\d+\s*-\s*AG:/.test(c), ler: lerUnicred },
    { nome: "Caixa", teste: (c, t) => /C:AIXA|gerenciador\.caixa/.test(c), ler: lerCaixa },
    { nome: "Banrisul", teste: (c, t) => /B A N R I S U L/.test(c), ler: lerBanrisul },
    { nome: "XP", teste: (c, t) => /XP INVESTIMENTOS/.test(c), ler: lerXP },
    { nome: "Banco Inter", teste: (c, t) => /Institui[çc][ãa]o: Banco Inter/.test(c), ler: lerInter },
    { nome: "Banco do Brasil", teste: (c, t) => /^Extrato de Conta Corrente$/m.test(c) && /bb\.com\.br|Central de Atendimento BB/.test(t), ler: lerBB },
    { nome: "Nubank", teste: (c, t) => /Nu Pagamentos S\.A\.|nubank\.com\.br/.test(t), ler: lerNubank },
  ];

  function lerExtrato(texto) {
    if (texto.replace(/\s/g, "").length < 50) throw new Error("Este PDF não tem texto legível. Parece ser uma imagem (escaneado, foto ou impressão em imagem). Baixe o extrato de novo pelo internet banking em PDF.");
    const cabecalho = texto.split("\n").slice(0, 12).join("\n");
    const leitor = LEITORES.find(l => l.teste(cabecalho, texto));
    if (!leitor) throw new Error("Formato de extrato não reconhecido. Bancos aceitos: " + LEITORES.map(l => l.nome).join(", ") + ".");
    const r = leitor.ler(texto);
    if (r.tx.length > 1 && r.tx[0].data > r.tx[r.tx.length - 1].data) r.tx.reverse();
    return r;
  }

  /* ---------- conferência de saldos ---------- */
  function conferir(info, tx) {
    let si = info.saldoInicial, acc = 0;
    if (si == null) {
      for (const t of tx) { acc += t.valor; if (t.saldoApos != null) { si = r2(t.saldoApos - acc); break; } }
    }
    let corrente = si, checagens = 0, falhas = 0;
    for (const t of tx) {
      if (corrente != null) corrente = r2(corrente + t.valor);
      if (t.saldoApos != null) {
        if (corrente != null) { checagens++; if (Math.abs(corrente - t.saldoApos) > 0.005) falhas++; }
        corrente = t.saldoApos;
      }
    }
    if (info.saldo != null && corrente != null) {
      checagens++; if (Math.abs(corrente - info.saldo) > 0.005) falhas++;
    }
    const saldoFinal = info.saldo != null ? info.saldo : corrente;
    const soma = tx.reduce((a, t) => a + t.valor, 0);
    const diferenca = si != null && saldoFinal != null ? r2(saldoFinal - (si + soma)) : null;
    return { saldoInicial: si, saldoFinal, checagens, falhas, diferenca, ok: checagens ? falhas === 0 : null };
  }

  window.LeitoresBancos = { lerExtrato, conferir, LEITORES };
})();
