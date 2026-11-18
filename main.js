// Processo principal do app desktop (Electron).
// Ao iniciar, procura uma versão nova por alguns segundos; se houver, baixa, instala e reinicia.
// Depois abre a interface (app/index.html): conciliação razão × extrato e conferência de notas × razão.
//
// Regra importante: sempre abrir a janela principal ANTES de fechar a janela de atualização.
// Se as duas ficarem fechadas ao mesmo tempo, o Windows encerra o programa.
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");

const URL_RELEASES = "https://github.com/Azzulin/Conciliador-Razao-Extrato/releases/latest";
const TEMPO_BUSCA_MS = 8000; // tempo máximo procurando atualização ao abrir
const PRELOAD = path.join(__dirname, "preload.js");
// Teste automático do GitHub Actions: caminho do arquivo onde gravar o resultado.
const SMOKE = process.env.CONCILIADOR_SMOKE || "";

const arquivosSalvos = new Set();
let janelaPrincipal = null;
let telaAtualizacao = null;
let instalando = false;
let saindo = false;

/* ---------- registro de diagnóstico ---------- */
// Grava em <dados do app>/registro.log (no Windows: %APPDATA%\Conciliador Bancario\registro.log).

const memoria = [];
let arquivoRegistro = null;

function texto(p) {
  if (p instanceof Error) return p.stack || p.message;
  if (typeof p === "string") return p;
  try { return JSON.stringify(p); } catch { return String(p); }
}

function registrar(nivel, ...partes) {
  const linha = `${new Date().toISOString()} [${nivel}] ${partes.map(texto).join(" ")}`;
  memoria.push(linha);
  if (memoria.length > 300) memoria.shift();
  try {
    if (!arquivoRegistro) arquivoRegistro = path.join(app.getPath("userData"), "registro.log");
    try {
      if (fsSync.statSync(arquivoRegistro).size > 1000000) fsSync.renameSync(arquivoRegistro, arquivoRegistro + ".1");
    } catch { /* arquivo ainda não existe */ }
    fsSync.appendFileSync(arquivoRegistro, linha + "\n");
  } catch { /* sem permissão de escrita: segue sem registro em disco */ }
}

autoUpdater.logger = {
  info: (m) => registrar("info", "atualizador:", m),
  warn: (m) => registrar("aviso", "atualizador:", m),
  error: (m) => registrar("erro", "atualizador:", m),
  debug: () => {},
};
autoUpdater.on("error", (e) => registrar("erro", "atualizador:", e));

process.on("uncaughtException", (e) => { registrar("erro", "exceção:", e); garantirJanela(); });
process.on("unhandledRejection", (e) => registrar("erro", "promessa rejeitada:", e));

/* ---------- janelas ---------- */

function fechar(w) {
  if (w && !w.isDestroyed()) w.destroy(); // destroy não dispara o evento "close"
}

function criarJanela() {
  const win = new BrowserWindow({
    width: 1240,
    height: 880,
    minWidth: 420,
    minHeight: 500,
    show: false,
    title: "Conciliador Razão × Extrato",
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  win.loadFile(path.join(__dirname, "app", "index.html"));

  // Links externos abrem no navegador; a janela do app nunca sai da interface.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.on("render-process-gone", (_e, d) => registrar("erro", "interface encerrada:", d));
  return win;
}

// Abre (ou traz para frente) a janela principal e só então fecha a janela de atualização.
function abrirPrincipal() {
  if (janelaPrincipal && !janelaPrincipal.isDestroyed()) {
    janelaPrincipal.show();
    fechar(telaAtualizacao);
    return janelaPrincipal;
  }
  const win = criarJanela();
  janelaPrincipal = win;
  win.on("closed", () => { if (janelaPrincipal === win) janelaPrincipal = null; });

  let mostrada = false;
  const mostrar = () => {
    if (mostrada || win.isDestroyed()) return;
    mostrada = true;
    win.show();
    fechar(telaAtualizacao);
    registrar("info", "janela principal aberta");
    if (SMOKE) verificarSmoke(win);
  };
  win.once("ready-to-show", mostrar);
  setTimeout(mostrar, 6000); // garantia caso o evento não chegue
  return win;
}

function garantirJanela() {
  if (instalando || !app.isReady()) return;
  if (!janelaPrincipal || janelaPrincipal.isDestroyed()) abrirPrincipal();
}

function criarJanelaAtualizacao(aoFecharPeloUsuario) {
  const w = new BrowserWindow({
    width: 440,
    height: 230,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    show: false,
    center: true,
    title: "Conciliador Razão × Extrato",
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.loadFile(path.join(__dirname, "app", "atualizacao.html"));
  w.once("ready-to-show", () => { if (!w.isDestroyed()) w.show(); });
  // Alt+F4 na janela de atualização = continuar sem esperar.
  // Ao instalar uma versão nova ou ao sair (ex.: Windows desligando), o fechamento é liberado.
  w.on("close", (e) => {
    if (saindo || instalando) return;
    e.preventDefault();
    aoFecharPeloUsuario();
  });
  return w;
}

function enviarStatus(dados) {
  const w = telaAtualizacao;
  if (w && !w.isDestroyed()) w.webContents.send("atualizacao-status", dados);
}

/* ---------- atualização automática ---------- */

function versaoMaior(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// Só o instalador do Windows e o AppImage do Linux conseguem se atualizar sozinhos.
// A versão portátil e o Mac (sem assinatura da Apple) apenas avisam e abrem a página de download.
function instalaSozinho() {
  if (process.platform === "win32") return !process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === "linux") return !!process.env.APPIMAGE;
  return false;
}

async function avisarVersaoNova(win, versao) {
  if (!win || win.isDestroyed()) return;
  const r = await dialog.showMessageBox(win, {
    type: "info",
    buttons: ["Baixar agora", "Depois"],
    defaultId: 0,
    cancelId: 1,
    title: "Nova versão disponível",
    message: `A versão ${versao} do Conciliador Razão × Extrato está disponível.`,
    detail: "Ela pode trazer formatos novos de arquivo e correções. Baixe e instale para atualizar.",
  });
  if (r.response === 0) shell.openExternal(URL_RELEASES);
}

async function procurarVersaoNova() {
  try {
    const r = await Promise.race([
      autoUpdater.checkForUpdates(),
      new Promise((res) => setTimeout(() => res("tempo"), TEMPO_BUSCA_MS)),
    ]);
    if (r === "tempo") { registrar("aviso", "busca de atualização passou do tempo limite"); return null; }
    const info = r && r.updateInfo;
    if (!info) { registrar("info", "atualizador inativo nesta instalação"); return null; }
    const nova = versaoMaior(info.version, app.getVersion());
    registrar("info", `versão publicada: ${info.version}; instalada: ${app.getVersion()}; atualizar: ${nova}`);
    return nova ? info : null;
  } catch (e) {
    registrar("aviso", "não foi possível procurar atualização:", e); // sem internet, GitHub fora etc.
    return null;
  }
}

function instalar(versao) {
  instalando = true;
  enviarStatus({ fase: "instalando", versao });
  registrar("info", `instalando a versão ${versao} e reiniciando`);
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (e) {
      instalando = false;
      registrar("erro", "falha ao instalar:", e);
      abrirPrincipal();
    }
  }, 900);
}

async function iniciar() {
  registrar("info", `iniciando versão ${app.getVersion()} (${process.platform}${process.env.PORTABLE_EXECUTABLE_DIR ? ", portátil" : ""})`);
  if (!app.isPackaged) { abrirPrincipal(); return; } // em desenvolvimento não atualiza

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = !SMOKE;

  let continuou = false;
  const continuar = () => {
    if (continuou) return;
    continuou = true;
    registrar("info", "usuário continuou sem esperar");
    abrirPrincipal();
  };
  ipcMain.removeAllListeners("atualizacao-continuar");
  ipcMain.on("atualizacao-continuar", continuar);

  telaAtualizacao = criarJanelaAtualizacao(continuar);
  enviarStatus({ fase: "procurando" });

  const info = await procurarVersaoNova();
  if (!info) { abrirPrincipal(); return; }

  if (SMOKE || !instalaSozinho()) {
    const win = abrirPrincipal();
    if (!SMOKE) win.webContents.once("did-finish-load", () => avisarVersaoNova(win, info.version));
    return;
  }

  autoUpdater.on("download-progress", (p) => {
    enviarStatus({ fase: "baixando", versao: info.version, pct: Math.round(p.percent || 0) });
  });
  enviarStatus({ fase: "baixando", versao: info.version, pct: 0 });

  try {
    await autoUpdater.downloadUpdate();
  } catch (e) {
    registrar("erro", "falha ao baixar a atualização:", e);
    abrirPrincipal();
    return;
  }
  registrar("info", `versão ${info.version} baixada`);

  if (!continuou) { instalar(info.version); return; }

  // Quem escolheu continuar sem esperar decide quando reiniciar.
  const win = janelaPrincipal;
  if (!win || win.isDestroyed()) return; // será instalada ao fechar o programa
  const r = await dialog.showMessageBox(win, {
    type: "info",
    buttons: ["Reiniciar agora", "Depois"],
    defaultId: 0,
    cancelId: 1,
    title: "Atualização pronta",
    message: `A versão ${info.version} foi baixada.`,
    detail: "Se escolher Depois, ela será instalada quando você fechar o programa.",
  });
  if (r.response === 0) instalar(info.version);
}

/* ---------- teste automático (GitHub Actions) ---------- */

function terminarSmoke(ok, detalhes) {
  registrar(ok ? "info" : "erro", "teste automático:", ok ? "OK" : "FALHOU", detalhes);
  try {
    fsSync.writeFileSync(SMOKE, JSON.stringify({ ok, versao: app.getVersion(), detalhes, registro: memoria }, null, 2));
  } catch { /* o teste falha por falta do arquivo */ }
  app.exit(ok ? 0 : 1);
}

async function verificarSmoke(win) {
  try {
    await new Promise((r) => setTimeout(r, 3000)); // o defeito antigo fechava o programa logo depois de abrir
    const visivel = !win.isDestroyed() && win.isVisible();
    const estado = win.isDestroyed() ? null : await win.webContents.executeJavaScript(
      "({ pdf: !!window.pdfjsLib, excel: !!window.XLSX, zip: !!window.JSZip, libsLocais: !!window.__libsLocais, conciliador: !!window.__conciliador, notas: !!window.__notas," +
      " desktop: !!(window.desktop && window.desktop.salvarArquivo), titulo: document.title })"
    );
    const ok = !!(visivel && estado && estado.pdf && estado.excel && estado.zip && estado.libsLocais && estado.conciliador && estado.notas && estado.desktop);
    terminarSmoke(ok, { visivel, estado });
  } catch (e) {
    terminarSmoke(false, { erro: texto(e) });
  }
}

/* ---------- gravação do relatório ---------- */

ipcMain.handle("salvar-arquivo", async (evt, nome, bytes) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const limpo = path.basename(String(nome || "Conciliacao.xlsx")).replace(/[<>:"/\|?*\x00-\x1f]/g, "_");
  if (!/\.xlsx$/i.test(limpo) || !bytes) return { cancelado: true };
  const r = await dialog.showSaveDialog(win, {
    title: "Salvar relatório da conciliação",
    defaultPath: path.join(app.getPath("downloads"), limpo),
    buttonLabel: "Salvar",
    filters: [{ name: "Planilha do Excel", extensions: ["xlsx"] }],
  });
  if (r.canceled || !r.filePath) return { cancelado: true };
  await fs.writeFile(r.filePath, Buffer.from(bytes));
  arquivosSalvos.add(r.filePath);
  registrar("info", "relatório salvo");
  return { caminho: r.filePath };
});

ipcMain.handle("abrir-arquivo", async (_evt, caminho) => {
  // Só abre arquivos que o próprio app acabou de salvar.
  if (arquivosSalvos.has(caminho)) await shell.openPath(caminho);
});

ipcMain.handle("versao", () => app.getVersion());

/* ---------- ciclo de vida ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = janelaPrincipal && !janelaPrincipal.isDestroyed() ? janelaPrincipal : BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    if (SMOKE) setTimeout(() => terminarSmoke(false, { erro: "tempo esgotado sem abrir a janela principal" }), 60000);
    iniciar().catch((e) => { registrar("erro", "falha ao iniciar:", e); garantirJanela(); });
    app.on("activate", () => garantirJanela());
  });
  app.on("before-quit", () => { saindo = true; });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !instalando) app.quit();
  });
}
