// Leitura das notas fiscais: XML (NF-e, NFC-e, CT-e, NFS-e nacional/ABRASF/São Paulo), ZIP de XMLs,
// PDF (DANFE e NFS-e, leitura aproximada) e planilhas com a lista de notas.
// Cada nota: { chave, modelo, numero, serie, data: "AAAAMMDD", emitCnpj, emitNome, destCnpj, destNome,
//              valor, valoresAlt: [], cancelada, arquivo, origem }
(function () {
  "use strict";
  const { parseData, parseValor, norm } = window.Leitura;
  const so = s => String(s || "").replace(/\D/g, "");
  const semZeros = s => so(s).replace(/^0+(?=\d)/, "");
  const r2 = v => Math.round(v * 100) / 100;
  const MODELOS = { "55": "NF-e", "65": "NFC-e", "57": "CT-e", "67": "CT-e OS", "59": "CF-e SAT" };

  /* ---------- XML ---------- */
  function achar(el, nomes) {
    if (!el) return null;
    const set = nomes.map(n => n.toLowerCase());
    const todos = el.getElementsByTagName("*");
    for (let i = 0; i < todos.length; i++) if (set.includes(todos[i].localName.toLowerCase())) return todos[i];
    return null;
  }
  const todosDe = (el, nome) => [...el.getElementsByTagName("*")].filter(e => e.localName.toLowerCase() === nome.toLowerCase());
  const txt = (el, ...nomes) => { const e = achar(el, nomes); return e ? e.textContent.trim() : ""; };
  const dataXml = s => { const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[1] + m[2] + m[3] : (parseData(s) || null); };
  const num = s => { const v = parseFloat(String(s || "").replace(",", ".")); return isFinite(v) ? v : null; };
  // Primeiro elemento cujo nome casa com a expressão (ex.: /prestador/), para achar CNPJ e nome dentro dele
  function bloco(el, re) {
    const todos = el.getElementsByTagName("*");
    for (let i = 0; i < todos.length; i++) if (re.test(todos[i].localName)) return todos[i];
    return null;
  }
  function pessoa(b) {
    if (!b) return { cnpj: "", nome: "" };
    return { cnpj: so(txt(b, "CNPJ", "Cnpj", "CPF", "Cpf")), nome: txt(b, "xNome", "RazaoSocial", "RazaoSocialPrestador", "RazaoSocialTomador", "Nome", "NomeRazaoSocial") };
  }

  /* ---------- retenções ---------- */
  // Federais: IRRF, PIS, COFINS, CSLL, INSS. Municipal: ISS retido.
  const IMPOSTOS_FED = ["IRRF", "PIS", "COFINS", "CSLL", "INSS"];
  function aplicarRetencoes(nota, ret) {
    const limpo = {};
    for (const [k, v] of Object.entries(ret)) if (v && v > 0.004) limpo[k] = Math.round(v * 100) / 100;
    nota.ret = limpo;
    nota.retFederal = r2(IMPOSTOS_FED.reduce((a, k) => a + (limpo[k] || 0), 0));
    nota.retMunicipal = limpo.ISS || 0;
    nota.liquido = nota.valor != null ? r2(nota.valor - nota.retFederal - nota.retMunicipal) : null;
    if ((nota.retFederal || nota.retMunicipal) && nota.liquido > 0 && !nota.valoresAlt.some(v => Math.abs(v - nota.liquido) < 0.005)) nota.valoresAlt.push(nota.liquido);
    return nota;
  }
  const valorDe = (el, ...nomes) => num(txt(el, ...nomes)) || 0;

  function retencoesNFe(inf) {
    const rt = achar(inf, ["retTrib"]), iss = achar(inf, ["ISSQNtot"]);
    return {
      IRRF: rt ? valorDe(rt, "vIRRF") : 0, PIS: rt ? valorDe(rt, "vRetPIS") : 0, COFINS: rt ? valorDe(rt, "vRetCOFINS") : 0,
      CSLL: rt ? valorDe(rt, "vRetCSLL") : 0, INSS: rt ? valorDe(rt, "vRetPrev") : 0, ISS: iss ? valorDe(iss, "vISSRet") : 0,
    };
  }

  function retencoesNFSe(inf) {
    // Padrão nacional
    if (achar(inf, ["nNFSe"])) {
      const pc = achar(inf, ["piscofins"]);
      const pcRetido = pc && txt(pc, "tpRetPisCofins") === "1";
      const tpIss = txt(inf, "tpRetISSQN");
      return {
        IRRF: valorDe(inf, "vRetIRRF"), CSLL: valorDe(inf, "vRetCSLL"), INSS: valorDe(inf, "vRetCP"),
        PIS: pcRetido ? valorDe(pc, "vPis") : 0, COFINS: pcRetido ? valorDe(pc, "vCofins") : 0,
        ISS: tpIss === "2" || tpIss === "3" ? valorDe(inf, "vISSQN") : 0,
      };
    }
    // ABRASF (IssRetido 1 = sim) e São Paulo (ISSRetido true)
    const issRet = /^(1|true|s|sim)$/i.test(txt(inf, "IssRetido", "ISSRetido"));
    return {
      IRRF: valorDe(inf, "ValorIr", "ValorIRRF"), PIS: valorDe(inf, "ValorPis"), COFINS: valorDe(inf, "ValorCofins"),
      CSLL: valorDe(inf, "ValorCsll"), INSS: valorDe(inf, "ValorInss"),
      ISS: valorDe(inf, "ValorIssRetido") || (issRet ? valorDe(inf, "ValorIss") : 0),
    };
  }

  function lerNFe(inf, cancelVia) {
    const ide = achar(inf, ["ide"]);
    const mod = txt(ide, "mod");
    const emit = achar(inf, ["emit"]), dest = achar(inf, ["dest"]);
    const dups = todosDe(inf, "vDup").map(e => num(e.textContent)).filter(v => v);
    const chave = so(inf.getAttribute("Id"));
    return aplicarRetencoes({
      chave, modelo: MODELOS[mod] || "NF-e", numero: semZeros(txt(ide, "nNF")), serie: semZeros(txt(ide, "serie")),
      data: dataXml(txt(ide, "dhEmi", "dEmi")),
      emitCnpj: so(txt(emit, "CNPJ", "CPF")), emitNome: txt(emit, "xNome"),
      destCnpj: so(txt(dest, "CNPJ", "CPF")), destNome: txt(dest, "xNome"),
      valor: num(txt(achar(inf, ["ICMSTot"]) || inf, "vNF")), valoresAlt: dups.length > 1 ? dups : [], cancelada: cancelVia,
    }, retencoesNFe(inf));
  }

  function lerCTe(inf, cancelVia) {
    const ide = achar(inf, ["ide"]);
    const emit = achar(inf, ["emit"]);
    // tomador: rem, dest, exped, receb ou toma4, conforme <toma>
    const toma = txt(ide, "toma");
    const blocoToma = achar(inf, ["toma4"]) || achar(inf, [["rem", "exped", "receb", "dest"][+toma] || "dest"]);
    const t = pessoa(blocoToma);
    const nota = {
      chave: so(inf.getAttribute("Id")), modelo: MODELOS[txt(ide, "mod")] || "CT-e", numero: semZeros(txt(ide, "nCT")), serie: semZeros(txt(ide, "serie")),
      data: dataXml(txt(ide, "dhEmi")), emitCnpj: so(txt(emit, "CNPJ", "CPF")), emitNome: txt(emit, "xNome"),
      destCnpj: t.cnpj, destNome: t.nome, valor: num(txt(achar(inf, ["vPrest"]) || inf, "vTPrest")),
      valoresAlt: [num(txt(achar(inf, ["vPrest"]) || inf, "vRec"))].filter(v => v), cancelada: cancelVia,
    };
    return aplicarRetencoes(nota, {});
  }

  // NFS-e: padrão nacional (infNFSe), ABRASF (InfNfse) e outros que seguem nomes parecidos
  function lerNFSe(inf, cancelada) {
    const nacional = !!achar(inf, ["nNFSe"]);
    const numero = semZeros(txt(inf, "nNFSe", "Numero", "NumeroNFe", "NumeroNfse", "NumeroNota"));
    const data = dataXml(txt(inf, "dhEmi", "DataEmissao", "DataEmissaoNFe", "DataEmissaoNfse", "dhProc", "Competencia", "dCompet"));
    const prest = pessoa(bloco(inf, /^(prest|prestador|prestadorservico|identificacaoprestador|emit|cpfcnpjprestador)$/i));
    const toma = pessoa(bloco(inf, /^(toma|tomador|tomadorservico|identificacaotomador|cpfcnpjtomador)$/i));
    // São Paulo: CNPJ e nome do prestador vêm em tags próprias
    if (!prest.cnpj) prest.cnpj = so(txt(achar(inf, ["CPFCNPJPrestador"]) || inf, "CNPJ", "CPF"));
    if (!prest.nome) prest.nome = txt(inf, "RazaoSocialPrestador");
    if (!toma.cnpj) toma.cnpj = so(txt(achar(inf, ["CPFCNPJTomador"]) || inf, "CNPJ", "CPF"));
    if (!toma.nome) toma.nome = txt(inf, "RazaoSocialTomador");
    const bruto = num(txt(inf, "vServ", "ValorServicos", "ValorTotal", "ValorTotalServicos"));
    const liquido = num(txt(inf, "vLiq", "ValorLiquidoNfse", "ValorLiquido"));
    const valor = bruto || liquido;
    let chave = "";
    if (nacional) chave = so(inf.getAttribute("Id"));
    if (!chave) chave = so(txt(inf, "ChaveNFe", "CodigoVerificacao"));
    return aplicarRetencoes({
      chave: chave ? "NFSE" + prest.cnpj + "-" + numero : "", modelo: "NFS-e", numero, serie: "",
      data, emitCnpj: prest.cnpj, emitNome: prest.nome, destCnpj: toma.cnpj, destNome: toma.nome,
      valor, valoresAlt: liquido && liquido !== valor ? [liquido] : [], cancelada,
    }, retencoesNFSe(inf));
  }

  // Devolve { notas, cancelamentos: Set(chave) }
  function lerXml(texto) {
    const doc = new DOMParser().parseFromString(texto.replace(/^﻿/, ""), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("XML inválido ou corrompido.");
    const notas = [], cancelamentos = new Set();
    const raiz = doc.documentElement;

    // Eventos de cancelamento (NF-e/CT-e: 110111; NFS-e nacional: 101101)
    for (const ev of todosDe(raiz, "infEvento")) {
      const tp = txt(ev, "tpEvento");
      if (["110111", "110112", "101101", "105102"].includes(tp)) {
        const ch = so(txt(ev, "chNFe", "chCTe", "chNFSe"));
        if (ch) cancelamentos.add(ch);
      }
    }
    // Situação no protocolo: 101/151/135/155 = cancelada; 110/301/302 = denegada
    const situacao = el => {
      const prot = achar(el.ownerDocument.documentElement, ["infProt"]);
      const st = prot ? txt(prot, "cStat") : "";
      return ["101", "151", "135", "155", "110", "301", "302", "303"].includes(st);
    };

    for (const inf of todosDe(raiz, "infNFe")) notas.push(lerNFe(inf, situacao(inf)));
    for (const inf of todosDe(raiz, "infCte")) notas.push(lerCTe(inf, situacao(inf)));
    const nfse = todosDe(raiz, "infNFSe").concat(todosDe(raiz, "InfNfse").filter(e => e.localName !== "infNFSe"));
    const vistos = new Set();
    for (const inf of nfse) {
      if (vistos.has(inf)) continue; vistos.add(inf);
      // ABRASF: o cancelamento fica junto da nota, em <CompNfse><NfseCancelamento>
      let canc = false, p = inf.parentNode;
      while (p && p.nodeType === 1) {
        if (/compnfse|nfse$/i.test(p.localName) && achar(p, ["NfseCancelamento", "CancelamentoNfse", "Cancelamento"])) { canc = true; break; }
        p = p.parentNode;
      }
      if (/cancel/i.test(txt(inf, "Situacao", "SituacaoNfse"))) canc = true;
      notas.push(lerNFSe(inf, canc));
    }
    // São Paulo e outros sem "infNFSe": cada <NFe> com <NumeroNFe>
    if (!notas.length) {
      for (const n of todosDe(raiz, "NFe").filter(e => achar(e, ["NumeroNFe"]))) {
        const nota = lerNFSe(n, /^c$/i.test(txt(n, "StatusNFe")));
        notas.push(nota);
      }
    }
    if (!notas.length && !cancelamentos.size) throw new Error("XML não reconhecido como NF-e, NFC-e, CT-e ou NFS-e.");
    return { notas, cancelamentos };
  }

  /* ---------- PDF ---------- */
  const RE_CHAVE = /\b(\d{4}[\s.]?){10}\d{4}\b/;
  const RE_VAL = /\d{1,3}(?:\.\d{3})*,\d{2}/;
  function valorApos(texto, rotulos) {
    for (const r of rotulos) {
      const i = texto.search(r);
      if (i < 0) continue;
      const m = texto.slice(i, i + 400).match(RE_VAL);
      if (m) return parseValor(m[0]).v;
    }
    return null;
  }
  function dataApos(texto, rotulos) {
    for (const r of rotulos) {
      const i = texto.search(r);
      if (i < 0) continue;
      const m = texto.slice(i, i + 200).match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
      if (m) return parseData(m[0]);
    }
    const m = texto.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    return m ? parseData(m[0]) : null;
  }
  function decodificarChave(ch) {
    return { cnpj: ch.slice(6, 20), modelo: MODELOS[ch.slice(20, 22)] || "NF-e", serie: semZeros(ch.slice(22, 25)), numero: semZeros(ch.slice(25, 34)) };
  }

  function lerPaginaPdf(texto) {
    const t = texto.replace(/\s+/g, " ");
    const nt = norm(t);
    const mCh = t.match(RE_CHAVE);
    if (mCh && /danfe|documento auxiliar|chave de acesso/i.test(nt)) {
      const chave = so(mCh[0]);
      const d = decodificarChave(chave);
      const valor = valorApos(t, [/VALOR TOTAL DA NOTA/i, /VALOR TOTAL DO SERVI[CÇ]O/i, /V(ALOR)?\.? TOTAL/i]);
      const mEmit = t.match(/IDENTIFICA[CÇ][AÃ]O DO EMITENTE\s+(.{3,80}?)\s{1,}(?:RUA|AV|AVENIDA|ROD|R\.|ESTRADA|AL\.|PRA[CÇ]A|\d)/i);
      const mDest = t.match(/(?:NOME\s*\/\s*RAZ[AÃ]O SOCIAL)\s+(.{3,80}?)\s+(?:CNPJ|CPF|\d{2}\.\d{3}\.\d{3})/i);
      const iDest = t.search(/DESTINAT[AÁ]RIO/i);
      const mDestCnpj = iDest >= 0 ? t.slice(iDest, iDest + 600).match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/) : null;
      return {
        chave, modelo: d.modelo, numero: d.numero, serie: d.serie, data: dataApos(t, [/DATA D[AE] EMISS[AÃ]O/i, /EMISS[AÃ]O/i]),
        emitCnpj: d.cnpj, emitNome: mEmit ? mEmit[1].trim() : "", destCnpj: mDestCnpj ? so(mDestCnpj[0]) : "", destNome: mDest ? mDest[1].trim() : "",
        valor, valoresAlt: [], cancelada: /\bCANCELAD[AO]\b/.test(t), aproximada: true,
      };
    }
    if (/nfs-?e|nota fiscal (eletr[oô]nica )?de servi[cç]o|prefeitura/i.test(nt)) {
      const mNum = t.match(/N[UÚ]MERO D[AO] (?:NFS-?E|NOTA)[^\d]{0,30}([\d.\/-]+)/i) || t.match(/NFS-?e\s*N[ºo°.]*\s*:?\s*([\d.]+)/i) || t.match(/N[ºo°]\s*:?\s*([\d.]{1,20})/);
      const cnpjs = [...t.matchAll(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g)].map(m => so(m[0]));
      const bruto = valorApos(t, [/VALOR TOTAL DO SERVI[CÇ]O/i, /VALOR DOS SERVI[CÇ]OS/i, /VALOR DO SERVI[CÇ]O/i, /VALOR TOTAL DA NOTA/i, /VALOR TOTAL/i]);
      const liquido = valorApos(t, [/VALOR L[IÍ]QUIDO/i]);
      if (!mNum && !bruto) return null;
      return {
        chave: "", modelo: "NFS-e", numero: mNum ? semZeros(mNum[1].split(/[\/-]/)[0]) : "", serie: "",
        data: dataApos(t, [/DATA (?:E HORA )?D[AE] EMISS[AÃ]O/i, /EMISS[AÃ]O/i, /COMPET[EÊ]NCIA/i]),
        emitCnpj: cnpjs[0] || "", emitNome: "", destCnpj: cnpjs[1] || "", destNome: "",
        valor: bruto || liquido, valoresAlt: liquido && bruto && liquido !== bruto ? [liquido] : [], cancelada: /\bCANCELAD[AO]\b/.test(t), aproximada: true,
      };
    }
    return null;
  }

  async function lerPdf(buf) {
    const linhas = await window.Leitura.linhasPdf(buf);
    const texto = linhas.map(l => l.texto).join("\n");
    if (texto.replace(/\s/g, "").length < 50) throw new Error("Este PDF não tem texto legível (parece escaneado ou imagem). Use o XML da nota.");
    const paginas = new Map();
    for (const l of linhas) { if (!paginas.has(l.pagina)) paginas.set(l.pagina, []); paginas.get(l.pagina).push(l.texto); }
    const notas = [];
    for (const ls of paginas.values()) {
      const n = lerPaginaPdf(ls.join("\n"));
      if (n && !(n.chave && notas.some(o => o.chave === n.chave))) notas.push(n);
    }
    if (!notas.length) throw new Error("Não reconheci uma DANFE ou NFS-e neste PDF. Se tiver, use o XML da nota.");
    return notas;
  }

  /* ---------- planilha com lista de notas ---------- */
  const COLS = [
    ["chave", /chave/],
    ["cnpj", /cnpj|cpf/],
    ["serie", /^s[eé]rie/],
    ["modelo", /^(modelo|mod\.?|esp[eé]cie|tipo doc)/],
    ["valor", /valor total|vl\.? total|valor da nota|valor contabil|valor contábil|valor nf|valor do documento|^total|^valor|vl\.? contabil|vl\.? documento/],
    ["data", /emiss|^data|^dt/],
    ["numero", /^(n[uú]mero|numero|n[ºo°.]|nf\b|nf-?e|nota|nota fiscal|num\.?|doc(umento)?\b|nr)/],
    ["nome", /emitente|fornecedor|cliente|participante|raz[aã]o social|^nome|prestador|tomador|destinat/],
    ["situacao", /situa[cç][aã]o|status/],
  ];
  const COLS_RET = [["IRRF", /^(irrf|ir retido|ir$|vl\.? ir$)/], ["PIS", /^(pis|pis retido)/], ["COFINS", /^(cofins)/], ["CSLL", /^(csll)/], ["INSS", /^(inss)/], ["ISS", /^(iss retido|iss ret|issqn retido)/]];
  function lerPlanilhaNotas(buf, nomeArq) {
    const csv = /\.(csv|txt)$/i.test(nomeArq);
    const wb = XLSX.read(buf, { type: "array", raw: csv, cellDates: false, codepage: 65001 });
    let melhor = [];
    for (const aba of wb.SheetNames) {
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: "", blankrows: false });
      for (let i = 0; i < Math.min(linhas.length, 40); i++) {
        const c = {};
        linhas[i].forEach((cel, j) => {
          const n = norm(cel); if (!n || n.length > 40) return;
          for (const [k, re] of COLS) if (re.test(n)) { if (c[k] == null) c[k] = j; break; }
        });
        if ((c.numero == null && c.chave == null) || c.valor == null) continue;
        const cr = {};
        linhas[i].forEach((cel, j) => { const n = norm(cel); for (const [k, re] of COLS_RET) if (re.test(n) && cr[k] == null) cr[k] = j; });
        const notas = [];
        for (const row of linhas.slice(i + 1)) {
          const chave = c.chave != null ? so(row[c.chave]) : "";
          const d = chave.length === 44 ? decodificarChave(chave) : null;
          const numero = c.numero != null ? semZeros(String(row[c.numero]).split(/[\/-]/)[0]) : (d ? d.numero : "");
          const pv = parseValor(row[c.valor]);
          if (!numero || !pv || !pv.v) continue;
          notas.push({
            chave: chave.length === 44 ? chave : "", modelo: d ? d.modelo : (c.modelo != null ? String(row[c.modelo]).trim() || "Nota" : "Nota"),
            numero, serie: c.serie != null ? semZeros(row[c.serie]) : (d ? d.serie : ""),
            data: c.data != null ? parseData(row[c.data]) : null,
            emitCnpj: c.cnpj != null ? so(row[c.cnpj]) : (d ? d.cnpj : ""), emitNome: c.nome != null ? String(row[c.nome]).trim() : "",
            destCnpj: "", destNome: "", valor: Math.abs(pv.v), valoresAlt: [],
            cancelada: c.situacao != null && /cancel|denegad|inutiliz/i.test(String(row[c.situacao])), lista: true,
          });
          const ret = {};
          for (const k of Object.keys(cr)) { const pv2 = parseValor(row[cr[k]]); if (pv2) ret[k] = Math.abs(pv2.v); }
          aplicarRetencoes(notas[notas.length - 1], ret);
        }
        if (notas.length > melhor.length) melhor = notas;
        break;
      }
    }
    if (!melhor.length) throw new Error("Não encontrei na planilha as colunas de Número (ou Chave) e Valor das notas.");
    return melhor;
  }

  /* ---------- entrada única ---------- */
  function decodificar(buf) {
    let t = new TextDecoder("utf-8").decode(buf);
    if (t.includes("�")) t = new TextDecoder("windows-1252").decode(buf);
    return t;
  }

  // Devolve { notas, cancelamentos, erros: [{arquivo, erro}], qtdArquivos }
  async function lerArquivoNotas(nome, buf) {
    const ext = (nome.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
    const out = { notas: [], cancelamentos: new Set(), erros: [], qtdArquivos: 0 };
    const add = (lista, arq, origem) => lista.forEach(n => { n.arquivo = arq; n.origem = origem; out.notas.push(n); });
    if (ext === "zip") {
      if (!window.JSZip) throw new Error("O leitor de ZIP não carregou.");
      const zip = await JSZip.loadAsync(buf);
      const itens = Object.values(zip.files).filter(f => !f.dir && /\.(xml|pdf)$/i.test(f.name));
      if (!itens.length) throw new Error("O ZIP não tem arquivos XML ou PDF de notas.");
      for (const f of itens) {
        out.qtdArquivos++;
        const nomeInterno = f.name.split("/").pop();
        try {
          if (/\.xml$/i.test(f.name)) {
            const r = lerXml(decodificar(await f.async("uint8array")));
            add(r.notas, nomeInterno, "XML"); r.cancelamentos.forEach(c => out.cancelamentos.add(c));
          } else add(await lerPdf(await f.async("uint8array")), nomeInterno, "PDF");
        } catch (e) { out.erros.push({ arquivo: nomeInterno, erro: e.message }); }
      }
      return out;
    }
    out.qtdArquivos = 1;
    if (ext === "xml") {
      const r = lerXml(decodificar(buf));
      add(r.notas, nome, "XML"); r.cancelamentos.forEach(c => out.cancelamentos.add(c));
    } else if (ext === "pdf") add(await lerPdf(buf), nome, "PDF");
    else if (["xlsx", "xls", "xlsm", "ods", "csv", "txt"].includes(ext)) add(lerPlanilhaNotas(buf, nome), nome, "Planilha");
    else throw new Error("Tipo de arquivo não aceito. Use XML, ZIP, PDF ou Excel.");
    return out;
  }

  window.Notas = { lerArquivoNotas, lerXml, semZeros, so, IMPOSTOS_FED };
})();
