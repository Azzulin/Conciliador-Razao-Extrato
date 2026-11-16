// Ponte segura entre a interface e o app desktop.
// Expõe só: salvar o relatório, abrir o relatório salvo, versão do app e o andamento da atualização.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  salvarArquivo: (nome, bytes) => ipcRenderer.invoke("salvar-arquivo", nome, bytes),
  abrirArquivo: (caminho) => ipcRenderer.invoke("abrir-arquivo", caminho),
  versao: () => ipcRenderer.invoke("versao"),
  atualizacao: {
    aoMudar: (cb) => ipcRenderer.on("atualizacao-status", (_evt, dados) => cb(dados)),
    continuarSemEsperar: () => ipcRenderer.send("atualizacao-continuar"),
  },
});
