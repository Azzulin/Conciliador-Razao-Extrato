// Plano de contas, relatório de tipos de despesa e sugestão de lançamentos para notas não lançadas.
// Regra contábil das notas de entrada: D conta de despesa (pelo tipo de despesa) / C conta do fornecedor.
// Com retenções: o crédito se divide entre o fornecedor (valor líquido) e os impostos a recolher.
// Notas de saída: D conta do cliente / C conta de receita.
(function () {
  "use strict";
  const { parseValor, norm } = window.Leitura;
  const so = s => String(s == null ? "" : s).replace(/\D/g, "");
  const r2 = v => Math.round(v * 100) / 100;
  const RE_CLASSIF = /^\d+(?:[.\-]\d+)+$/;
  const VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em", "com", "para", "ltda", "me", "epp", "eireli", "sa", "s/a", "cia", "conta", "contas", "outras", "outros", "diversas", "diversos", "geral", "gerais"]);

  // Palavras com "radical" de 5 letras (servico/servicos, material/materiais)
  function radicais(s) {
    return new Set(norm(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter(w => w.length >= 2 && !VAZIAS.has(w)).map(w => w.length > 5 ? w.slice(0, 5) : w));
  }
  function parecido(a, b) {
    const ta = a instanceof Set ? a : radicais(a), tb = b instanceof Set ? b : radicais(b);
    if (!ta.size || !tb.size) return 0;
    let i = 0; for (const w of ta) if (tb.has(w)) i++;
    return i / Math.min(ta.size, tb.size);
  }

  /* ---------- plano de contas ---------- */
  function montarPlano(contas) {
    // contas: [{ classif, reduzido, nome, tipo: "A"|"S"|"" }]
    const lista = contas.filter(c => c.nome && (c.classif || c.reduzido));
    const porClassif = new Map(lista.filter(c => c.classif).map(c => [c.classif, c]));
    for (const c of lista) {
      // ancestrais: classificações que são prefixo desta
      const partes = c.classif ? c.classif.split(".") : [];
      c.ancestrais = [];
      for (let i = 1; i < partes.length; i++) { const p = porClassif.get(partes.slice(0, i).join(".")); if (p) c.ancestrais.push(p.nome); }
      if (!c.tipo) c.tipo = c.classif && lista.some(o => o !== c && o.classif && o.classif.startsWith(c.classif + ".")) ? "S" : "A";
      c.contexto = norm([...c.ancestrais, c.nome].join(" "));
      c.rad = radicais(c.nome);
      c.radCtx = radicais(c.ancestrais.join(" "));
      c.id = c.reduzido || c.classif;
      c.rotulo = [c.reduzido, c.classif, c.nome].filter(Boolean).join(" · ");
    }
    const analiticas = lista.filter(c => c.tipo === "A");
    return { contas: lista, analiticas, porId: new Map(lista.map(c => [c.id, c])) };
  }

  const COLS_PLANO = [
    ["reduzido", /reduzid|^red\.?$|^c[oó]d\.? ?red|^cod\.? reduz/],
    ["tipo", /^(tipo|t|s\/a|a\/s|sint|anal|grau)/],
    ["classif", /classifica|^c[oó]digo|^conta$|^estrutura|^mascara|^cod\.?$/],
    ["nome", /descri|^nome|t[ií]tulo|denomina|^conta cont|hist/],
  ];
  function lerPlanoPlanilha(buf, nomeArq) {
    const wb = XLSX.read(buf, { type: "array", raw: /\.(csv|txt)$/i.test(nomeArq), codepage: 65001 });
    let melhor = [];
    for (const aba of wb.SheetNames) {
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: false, defval: "", blankrows: false });
      let cols = null, ini = 0;
      for (let i = 0; i < Math.min(40, linhas.length) && !cols; i++) {
        const c = {};
        linhas[i].forEach((cel, j) => { const n = norm(cel); if (!n || n.length > 40) return; for (const [k, re] of COLS_PLANO) if (re.test(n)) { if (c[k] == null) c[k] = j; break; } });
        if (c.nome != null && (c.classif != null || c.reduzido != null)) { cols = c; ini = i + 1; }
      }
      const contas = [];
      if (cols) {
        for (const row of linhas.slice(ini)) {
          const classif = String(row[cols.classif] ?? "").trim().replace(/-/g, ".");
          const reduzido = cols.reduzido != null ? so(row[cols.reduzido]) : "";
          const nome = String(row[cols.nome] ?? "").trim();
          const t = cols.tipo != null ? norm(row[cols.tipo]) : "";
          if (!nome || (!RE_CLASSIF.test(classif) && !/^\d+$/.test(classif) && !reduzido)) continue;
          contas.push({ classif: RE_CLASSIF.test(classif) || /^\d+$/.test(classif) ? classif : "", reduzido, nome, tipo: /^a/.test(t) ? "A" : /^s/.test(t) ? "S" : "" });
        }
      } else {
        // Sem cabeçalho: procura em cada linha uma classificação (1.1.01.001) e o nome ao lado
        for (const row of linhas) {
          const cel = row.map(c => String(c ?? "").trim());
          const iC = cel.findIndex(c => RE_CLASSIF.test(c));
          if (iC < 0) continue;
          const nome = cel.slice(iC + 1).find(c => c && /[a-z]/i.test(c)) || cel.slice(0, iC).find(c => /[a-z]/i.test(c));
          const red = cel.find((c, j) => j !== iC && /^\d{1,7}$/.test(c)) || "";
          if (nome) contas.push({ classif: cel[iC], reduzido: red, nome, tipo: "" });
        }
      }
      if (contas.length > melhor.length) melhor = contas;
    }
    return melhor;
  }
  async function lerPlanoPdf(buf) {
    const linhas = await window.Leitura.linhasPdf(buf);
    const contas = [];
    for (const l of linhas) {
      const ws = l.texto.split(" ");
      const iC = ws.findIndex(w => RE_CLASSIF.test(w));
      if (iC < 0 || iC > 2) continue;
      const antes = ws.slice(0, iC), depois = ws.slice(iC + 1);
      let reduzido = antes.find(w => /^\d{1,7}$/.test(w)) || "";
      if (!reduzido && /^\d{1,7}$/.test(depois[0] || "")) reduzido = depois.shift();
      let tipo = "";
      if (/^[SA]$/.test(depois[depois.length - 1] || "")) tipo = depois.pop();
      // natureza D/C no fim também é comum
      if (/^[DC]$/.test(depois[depois.length - 1] || "")) depois.pop();
      if (!tipo && /^[SA]$/.test(depois[depois.length - 1] || "")) tipo = depois.pop();
      const nome = depois.join(" ").trim();
      if (nome && /[a-z]/i.test(nome)) contas.push({ classif: ws[iC].replace(/-/g, "."), reduzido, nome, tipo });
    }
    return contas;
  }
  async function lerPlano(nome, buf) {
    const ext = (nome.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
    const contas = ext === "pdf" ? await lerPlanoPdf(buf) : lerPlanoPlanilha(buf, nome);
    if (contas.length < 3) throw new Error("Não reconheci um plano de contas neste arquivo. Ele precisa ter a classificação (ex.: 4.1.1.01.001) ou o código reduzido e a descrição da conta.");
    return montarPlano(contas);
  }

  /* ---------- relatório de tipos de despesa ---------- */
  const COLS_REL = [
    ["cnpj", /cnpj|cpf/],
    ["numero", /^(n[uú]mero|nota|nf|n[ºo°.]|documento|doc\.?$|num\.?$)/],
    ["conta", /conta cont|^conta$|c[oó]d.*conta|reduzid|classifica[cç][aã]o cont/],
    ["tipo", /tipo|categoria|natureza|classifica|despesa|centro de custo|grupo|plano/],
    ["nome", /fornecedor|raz[aã]o|^nome|emitente|favorecido|prestador|participante|credor|empresa/],
    ["valor", /^valor|total/],
  ];
  function lerRelatorio(nome, buf) {
    const wb = XLSX.read(buf, { type: "array", raw: /\.(csv|txt)$/i.test(nome), codepage: 65001 });
    let melhor = [];
    for (const aba of wb.SheetNames) {
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: false, defval: "", blankrows: false });
      for (let i = 0; i < Math.min(40, linhas.length); i++) {
        const c = {};
        linhas[i].forEach((cel, j) => { const n = norm(cel); if (!n || n.length > 50) return; for (const [k, re] of COLS_REL) if (re.test(n)) { if (c[k] == null) c[k] = j; break; } });
        if ((c.nome == null && c.cnpj == null && c.numero == null) || (c.tipo == null && c.conta == null)) continue;
        const itens = [];
        for (const row of linhas.slice(i + 1)) {
          const it = {
            nome: c.nome != null ? String(row[c.nome] || "").trim() : "", cnpj: c.cnpj != null ? so(row[c.cnpj]) : "",
            numero: c.numero != null ? so(row[c.numero]).replace(/^0+(?=\d)/, "") : "",
            tipo: c.tipo != null ? String(row[c.tipo] || "").trim() : "", conta: c.conta != null ? String(row[c.conta] || "").trim() : "",
            valor: c.valor != null ? (parseValor(row[c.valor]) || {}).v : null,
          };
          if ((it.nome || it.cnpj || it.numero) && (it.tipo || it.conta)) itens.push(it);
        }
        if (itens.length > melhor.length) melhor = itens;
        break;
      }
    }
    if (!melhor.length) throw new Error("Não encontrei no relatório as colunas de Fornecedor (nome, CNPJ ou nº da nota) e de Tipo de despesa (ou Conta).");
    return melhor;
  }

  /* ---------- escolha de contas ---------- */
  function contaPorCodigo(plano, txt) {
    const t = String(txt || "").trim();
    if (!t) return null;
    const cod = t.match(/^\s*(\d+(?:[.\-]\d+)*)/);
    if (!cod) return null;
    const c = cod[1].replace(/-/g, ".");
    return plano.contas.find(x => x.reduzido === c || x.classif === c) || null;
  }
  // Melhor conta analítica para um texto, com filtro opcional pelo grupo (ex.: /despesa|custo/)
  function melhorConta(plano, texto, filtro, minimo) {
    const rt = radicais(texto);
    let melhor = null, ms = 0;
    for (const c of plano.analiticas) {
      if (filtro && !filtro.test(c.contexto)) continue;
      const s = parecido(rt, c.rad) + 0.25 * parecido(rt, c.radCtx);
      if (s > ms) { ms = s; melhor = c; }
    }
    return ms >= (minimo || 0.5) ? melhor : null;
  }
  const GRUPO_DESPESA = /despesa|custo|gasto|dispendio/;
  const GRUPO_FORNEC = /fornecedor/;
  const GRUPO_CLIENTE = /cliente|duplicatas a receber|contas a receber/;
  const GRUPO_RECEITA = /receita|faturamento|venda/;
  const GRUPO_PASSIVO_IMP = /recolher|retid|obriga|tribut|impostos|encargos/;
  const IMPOSTO_RE = { IRRF: /irrf|imposto de renda|\bir\b/, PIS: /\bpis\b|csrf|pis\/cofins|contribuicoes retidas|4\.?65/, COFINS: /cofins|csrf|contribuicoes retidas|4\.?65/, CSLL: /csll|csrf|contribuicoes retidas|4\.?65/, INSS: /inss|previd/, ISS: /\biss\b|issqn/ };

  function contaParticipante(plano, part, grupo) {
    const nomeRad = radicais(part.nome || "");
    const doGrupo = c => grupo.test(c.contexto) && !/adiantamento/.test(c.contexto);
    let melhor = null, ms = 0;
    for (const c of plano.analiticas) {
      if (!doGrupo(c)) continue;
      if (part.cnpj && so(c.nome).includes(part.cnpj.slice(0, 8))) return { conta: c, origem: "CNPJ na conta" };
      const s = parecido(nomeRad, c.rad);
      if (s > ms) { ms = s; melhor = c; }
    }
    if (melhor && ms >= 0.6) return { conta: melhor, origem: "nome do participante" };
    // conta genérica do grupo (ex.: "Fornecedores diversos", "Fornecedores nacionais")
    const generica = plano.analiticas.find(c => doGrupo(c) && /divers|naciona|geral|a pagar|fornecedores?$|clientes?$/.test(norm(c.nome)))
      || plano.analiticas.find(c => doGrupo(c) && grupo.test(norm(c.nome)));
    return generica ? { conta: generica, origem: "conta genérica" } : { conta: null, origem: "definir" };
  }

  function contaImposto(plano, imposto) {
    const re = IMPOSTO_RE[imposto];
    const cands = plano.analiticas.filter(c => re.test(norm(c.nome)) && GRUPO_PASSIVO_IMP.test(c.contexto) && !GRUPO_DESPESA.test(c.contexto));
    // prefere as que falam em "retido"
    cands.sort((a, b) => (/retid/.test(norm(b.nome)) - /retid/.test(norm(a.nome))));
    return cands[0] || null;
  }

  // Tipo de despesa da nota pelo relatório: nº da nota + fornecedor > CNPJ > nome
  function tipoPeloRelatorio(relatorio, nota, part) {
    if (!relatorio || !relatorio.length) return null;
    const mesmoPart = it => (it.cnpj && part.cnpj && it.cnpj === part.cnpj) || (it.nome && part.nome && parecido(it.nome, part.nome) >= 0.6);
    return relatorio.find(it => it.numero && it.numero === nota.numero && (mesmoPart(it) || (!it.cnpj && !it.nome)))
      || relatorio.find(it => !it.numero && it.cnpj && it.cnpj === part.cnpj)
      || relatorio.find(it => it.cnpj && it.cnpj === part.cnpj)
      || relatorio.find(it => it.nome && part.nome && parecido(it.nome, part.nome) >= 0.6)
      || null;
  }

  // Palavras-chave quando não há relatório: CT-e = frete, NFS-e = serviços
  function tipoPadrao(nota) {
    if (/CT-?e/i.test(nota.modelo)) return "fretes e carretos";
    if (/NFS/i.test(nota.modelo)) return "servicos prestados por terceiros";
    return "";
  }

  /* ---------- sugestão ---------- */
  // Devolve { partidas: [{ papel, debito, credito, valor, historico }], avisos, origemDebito }
  function sugerir(plano, relatorio, x, histPrincipal, histRetencao) {
    const nota = x.nota, part = x.part;
    const saida = x.tipo === "Saída";
    const avisos = [];
    const bruto = r2(nota.valor || 0);
    if (saida) {
      const cli = contaParticipante(plano, part, GRUPO_CLIENTE);
      const rec = melhorConta(plano, /NFS/i.test(nota.modelo) ? "receita de servicos prestados" : "receita de vendas de mercadorias", GRUPO_RECEITA, 0.3);
      if (!cli.conta) avisos.push("Conta do cliente não encontrada no plano.");
      if (!rec) avisos.push("Conta de receita não encontrada no plano.");
      return { partidas: [{ papel: "principal", debito: cli.conta, credito: rec, valor: bruto, historico: histPrincipal }], avisos, origemDebito: cli.origem, origemCredito: rec ? "descrição da conta" : "definir" };
    }
    // Débito: despesa
    let debito = null, origemDebito = "definir";
    const rel = tipoPeloRelatorio(relatorio, nota, part);
    if (rel) {
      debito = contaPorCodigo(plano, rel.conta) || contaPorCodigo(plano, rel.tipo);
      if (debito) origemDebito = "conta indicada no relatório";
      else {
        debito = melhorConta(plano, rel.tipo, GRUPO_DESPESA, 0.5) || melhorConta(plano, rel.tipo, null, 0.6);
        if (debito) origemDebito = `relatório: "${rel.tipo}"`;
        else avisos.push(`O tipo "${rel.tipo}" do relatório não corresponde a nenhuma conta do plano.`);
      }
    } else if (relatorio && relatorio.length) avisos.push("Fornecedor não encontrado no relatório de tipos de despesa.");
    if (!debito && tipoPadrao(nota)) {
      debito = melhorConta(plano, tipoPadrao(nota), GRUPO_DESPESA, 0.5);
      if (debito) origemDebito = "sugestão pelo tipo de nota (confira)";
    }
    // Crédito: fornecedor + retenções
    const forn = contaParticipante(plano, part, GRUPO_FORNEC);
    if (!forn.conta) avisos.push("Conta de fornecedores não encontrada no plano.");
    const ret = nota.cancelada ? {} : (nota.ret || {});
    const partidas = [];
    let liquido = bruto;
    for (const [imp, v] of Object.entries(ret)) {
      if (!v) continue;
      const conta = contaImposto(plano, imp);
      if (!conta) avisos.push(`Conta de ${imp} retido a recolher não encontrada no plano.`);
      partidas.push({ papel: imp, debito, credito: conta, valor: r2(v), historico: histRetencao(imp) });
      liquido = r2(liquido - v);
    }
    partidas.unshift({ papel: "principal", debito, credito: forn.conta, valor: liquido, historico: histPrincipal });
    if (!debito) avisos.push("Defina a conta de despesa.");
    return { partidas, avisos, origemDebito, origemCredito: forn.origem };
  }

  window.Plano = { lerPlano, lerRelatorio, sugerir, montarPlano };
})();
