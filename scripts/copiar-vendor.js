// Copia as bibliotecas de leitura de PDF e Excel para app/vendor,
// para o app funcionar sem internet.
const fs = require("fs");
const path = require("path");

const raiz = path.join(__dirname, "..");
const destino = path.join(raiz, "app", "vendor");
fs.mkdirSync(destino, { recursive: true });

const arquivos = [
  ["node_modules/pdfjs-dist/build/pdf.min.js", "pdf.min.js"],
  ["node_modules/pdfjs-dist/build/pdf.worker.min.js", "pdf.worker.min.js"],
  ["node_modules/xlsx/dist/xlsx.full.min.js", "xlsx.full.min.js"],
];

for (const [origem, nome] of arquivos) {
  fs.copyFileSync(path.join(raiz, origem), path.join(destino, nome));
  console.log(`vendor/${nome} copiado`);
}
