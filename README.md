# Conciliador Razão × Extrato

Compara o **razão contábil da conta Banco** com o **extrato bancário** (ou relatório financeiro) e mostra onde estão as diferenças. O extrato é sempre considerado o correto.

Tudo roda no próprio computador: nenhum arquivo é enviado para a internet.

## Como baixar e instalar

1. Abra a página **Releases** do repositório `Conciliador-Razao-Extrato`.
2. Baixe o arquivo do seu sistema:
   - **Windows:** `Conciliador-Bancario-x.y.z-win-x64.exe` (instalador) ou `...-portatil.exe` (roda sem instalar)
   - **Mac:** `.dmg`
   - **Linux:** `.AppImage`
3. Abra e use. O atalho na área de trabalho se chama **Conciliador Razão x Extrato**.

O programa não tem assinatura digital paga. No Windows pode aparecer "O Windows protegeu o computador": clique em **Mais informações → Executar assim mesmo**. No Mac, na primeira vez, clique com o botão direito no app → **Abrir**.

**Sem instalar:** dê dois cliques em `Abrir Conciliador.bat` (abre `app/index.html` no navegador) ou use a versão web, publicada no GitHub Pages a cada envio para a `main`.

### Atualização automática

Igual ao Conversor OFX: ao abrir, o programa procura versão nova por até 8 segundos. Se houver, baixa, instala e reinicia (instalador do Windows e AppImage). A versão portátil e o Mac só avisam e abrem a página de download. O repositório precisa ser **público**.

Registro de diagnóstico: `%APPDATA%\Conciliador Bancario\registro.log` no Windows.

## Como usar

1. Abra o programa.
2. Arraste o extrato para o quadro **1** e o razão para o quadro **2**. Pode soltar vários arquivos (ex.: um extrato por mês).
3. O resultado aparece na hora. Use os filtros para ver cada tipo de diferença.
4. Clique em **Baixar relatório em Excel** ou **Imprimir / salvar em PDF**.

Para experimentar, use os arquivos da pasta `exemplos`.

## Arquivos aceitos

| Lado | Formatos |
|---|---|
| Extrato / relatório financeiro | PDF, Excel (.xlsx/.xls), CSV, OFX |
| Razão | PDF, Excel (.xlsx/.xls), CSV |

- **Extratos em PDF** dos bancos do Conversor OFX (BB, Banrisul, Caixa, Inter, Nubank, Sicoob, Sicredi, Stone, Unicred, XP) são lidos pelo leitor próprio de cada banco. Outros bancos e relatórios usam a leitura genérica.
- **Leitura genérica (Excel, CSV e PDF):** o programa procura a linha de cabeçalho com **Data** e **Valor** (ou **Débito/Crédito**, **Entrada/Saída**) e, se tiver, **Histórico** e **Saldo**. Linhas de saldo anterior, totais e "a transportar" são ignoradas.
- PDFs escaneados (imagem) não têm texto e não podem ser lidos.

Em cada arquivo carregado, clique em **Ver lançamentos lidos** para conferir a leitura.

## O que o programa encontra

| Situação | Significado | O que fazer |
|---|---|---|
| Falta no razão | Está no extrato e não foi contabilizado | Lançar no razão |
| Não está no extrato | Está no razão e não aparece no banco (avisa quando parece duplicidade) | Verificar / estornar |
| Valor diferente | Mesmo lançamento, valor errado (avisa possível inversão de dígitos) | Corrigir o valor |
| D/C invertido | Entrada lançada como saída, ou o contrário | Inverter débito/crédito |
| Data diferente | Mesmo valor com data próxima (até a tolerância escolhida) | Só conferência |
| Agrupado | Um lançamento de um lado = soma de vários do outro, ou o total do dia bate | Só conferência |
| Fora do período | Lançamento do razão fora das datas do extrato | Não entra na comparação |

Também compara **saldo inicial, movimento e saldo final** e explica se parte da diferença vem de períodos anteriores.

### Sinais

No razão da conta Banco, débito = entrada e crédito = saída. Se o razão vier com os sinais ao contrário, o programa percebe e inverte sozinho (e avisa). A caixa **Inverter débito/crédito do razão** permite trocar manualmente.

## Publicar uma nova versão

1. Atualize o campo `version` no `package.json` (ex.: `1.1.0`).
2. Crie a tag e envie:
   ```
   git tag v1.1.0
   git push origin v1.1.0
   ```
3. A aba **Actions** gera os instaladores de Windows, Mac e Linux, abre o programa para testar e cria a Release.

A versão da tag precisa ser igual à do `package.json`.

## Rodar no próprio computador (desenvolvimento)

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```
npm install
npm start          # abre o app
npm run dist       # gera o instalador em dist/
python scripts/gerar-icones.py   # refaz os ícones
```

## Estrutura

```
main.js                   App desktop (janela, atualização automática, salvar relatório)
preload.js                Ponte segura entre a interface e o app
Abrir Conciliador.bat     Abre a tela no navegador, sem instalar
app/index.html            Tela e relatório
app/atualizacao.html      Janela "Procurando atualizações" ao abrir
app/leitura.js            Leitura de Excel, CSV, PDF e OFX
app/leitores-bancos.js    Leitores de extrato por banco (vindos do Conversor OFX)
app/conciliacao.js        Regras de comparação
app/vendor/               Bibliotecas de PDF e Excel (gerada por `npm run vendor`)
scripts/                  Cópia das bibliotecas, teste automático e geração dos ícones
.github/workflows/        Instaladores, teste automático e versão web
exemplos/                 Extrato e razão fictícios para teste
```

`app/leitores-bancos.js` é uma cópia dos leitores do Conversor OFX. Quando um banco for incluído ou corrigido lá, copie o trecho para cá também.

Nunca coloque extratos ou razões de clientes no repositório. O `.gitignore` já bloqueia `.pdf`, `.xlsx`, `.csv` e `.ofx` (menos os da pasta `exemplos`).
