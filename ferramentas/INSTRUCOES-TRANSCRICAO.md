# Instruções de transcrição de questões

Você vai transcrever questões de um caderno oficial de vestibular para JSON. Quem vai usar o resultado é um estudante pagante treinando para a prova. **Fidelidade total ao original é o requisito número um**: nenhuma palavra, número, sinal, unidade ou alternativa pode mudar.

## Material disponível (em `trabalho/<edicao>/`)

- `texto.md`: texto extraído de cada página, já na ordem de leitura (coluna esquerda e depois a direita). Cada bloco começa com `[x=.. y=..]`, a posição em pontos. **Este texto tem defeitos**: quebras de linha do PDF, hifenização no fim da linha, sobrescritos e subscritos achatados ("Li+" em vez de "Li⁺", "m/s2" em vez de "m/s²"), fórmulas quebradas e itálico/sublinhado perdidos. Use-o como ponto de partida e **confira tudo contra a imagem da página**.
- `paginas/pNN.png`: a página original. É a referência final.
- `anotadas/pNN.png`: a mesma página com uma grade azul (em pontos, linhas a cada 50) e as figuras candidatas em vermelho, com os ids (`p10-f2`).
- `figuras/pNN-fK.webp`: recorte de cada figura candidata.
- `mapa.json`: em que página aparece cada marcador de questão. É só uma pista e pode estar incompleto. Use `grep -n "QUESTÃO" texto.md` ou procure o número da questão.

Ferramenta para refazer um recorte (quando a figura automática cortou rótulos, legenda ou eixos, juntou duas figuras ou não existe):

```
python3 ferramentas/recortar.py <edicao> <pagina> <x0> <y0> <x1> <y1>
```

Para só ampliar um trecho e ler detalhes (expoentes, índices, tabela miúda), sem criar figura:

```
python3 ferramentas/recortar.py --conferir trabalho/<edicao>/tmp-<seu-lote> <edicao> <pagina> <x0> <y0> <x1> <y1>
```

As coordenadas são em pontos, pela grade da página anotada. A ferramenta imprime o novo id (`p10-c1`). **Abra o arquivo gerado e confira** se a figura saiu inteira, com todos os rótulos e sem pedaços de outra questão. Dê uma margem de uns 5 pontos.

## Formato de saída

Grave **um arquivo JSON** no caminho que a tarefa indicar, com esta estrutura:

```json
{
  "edicao": "fuvest-2025-1",
  "textos_base": {
    "t10-11": "Texto compartilhado pelas questões 10 e 11, em markdown (formato abaixo)."
  },
  "questoes": [
    {
      "numero": 10,
      "materia": "portugues",
      "materias_extra": [],
      "texto_base": "t10-11",
      "enunciado": "Segundo o texto, a cultura do “cancelamento”",
      "alternativas": {"A": "...", "B": "...", "C": "...", "D": "...", "E": "..."},
      "observacoes": ""
    }
  ]
}
```

- `numero`: o número da questão no caderno.
- `materia`: uma destas: `portugues`, `literatura`, `ingles`, `historia`, `geografia`, `filosofia`, `sociologia`, `biologia`, `quimica`, `fisica`, `matematica`, `artes`. Use `literatura` para questões sobre obras, autores, escolas e interpretação literária, e `portugues` para gramática, semântica e interpretação de textos não literários. Em questões interdisciplinares, ponha a principal em `materia` e as outras em `materias_extra`. Critério: a matéria principal é a do **conhecimento cobrado** para responder; uma matéria extra só entra se também é preciso saber o conteúdo dela. Um texto de apoio em inglês não torna a questão de inglês, a menos que entender o inglês seja necessário para responder (nesse caso, `ingles` vai em extra). Questão de interpretação de um texto filosófico ou sociológico que cobra o conteúdo da área vai para `filosofia`/`sociologia`; se cobra só leitura e linguagem, vai para `portugues`.
- `texto_base`: id de um texto em `textos_base` quando o caderno diz "Texto para as questões 10 e 11" (ou equivalente). Use ids `t<primeira>-<última>`. Inclua no texto base **tudo** que vem antes da primeira questão do grupo: título do texto, texto, figura, fonte e notas de rodapé. Não inclua a linha de instrução da banca ("TEXTO PARA AS QUESTÕES 10 E 11", "Texto comum às questões 13 e 14"); a plataforma mostra esse rótulo sozinha. A única exceção é a UNESP, quando a frase de abertura faz parte da apresentação do texto ("Para responder às questões de 01 a 07, leia o conto..."): aí mantenha. Se a questão não usa texto compartilhado, use `null` e coloque o texto de apoio no próprio `enunciado`.
- `enunciado`: o texto de apoio próprio da questão mais o comando, na ordem do original.
- `alternativas`: as letras como estão no caderno. A Unicamp usa 4 alternativas (A–D); FUVEST e UNESP usam 5 (A–E). Não inclua a letra nem os parênteses no texto ("(A) maior do que" vira `"A": "maior do que"`). Se as alternativas forem imagens, use a figura (`![Alternativa A](fig:p12-f3)`).
- **Não informe o gabarito.** Ele vem do gabarito oficial e é juntado depois por script.
- `observacoes`: deixe vazio. Use só para avisar o revisor de algo que você não conseguiu resolver, como um trecho ilegível ou uma figura que não deu para recortar bem.
- Questões discursivas (2ª fase): no lugar de `alternativas`, use `"itens": [{"rotulo": "a", "texto": "..."}, ...]`. Se a questão não tem itens, use `"itens": []` e deixe tudo no `enunciado`. Inclua o valor/pontuação só se estiver impresso.

## Formato do texto (markdown simplificado)

- **Parágrafos:** separe com uma linha em branco. Dentro de um parágrafo de prosa, junte as linhas do PDF numa linha só e desfaça a hifenização de fim de linha ("aborre-\ncido" vira "aborrecido"). Mantenha hífens de verdade ("aparecer-lhe", "pró-Palestina"). Na tipografia brasileira, a palavra hifenizada que quebra no hífen repete o hífen na linha seguinte ("tem-\n-se", "guerres-\n-en-ukraine"): junte com um hífen só ("tem-se"). Espaços duplos do caderno viram simples.
- **Quebra de linha simples** (`\n`) só onde o original quebra de propósito: versos de poema, diálogos em linhas, listas, endereços e itens.
- **Numeração na margem:** há dois casos.
  - *Numeração de linhas ou versos* (as questões citam "linha 12", "verso 5"): mantenha as quebras de linha do original e marque o número no começo da linha correspondente com `[[5]]`.
  - *Numeração de parágrafos* (comum na UNESP: os números da margem contam parágrafos e as questões citam "8º parágrafo"): junte cada parágrafo numa linha só, como prosa normal, e ponha `[[n]]` no começo dos parágrafos que têm número na margem.
- **Ênfase:** `*itálico*` e `**negrito**`. Para sublinhado, `<u>texto</u>`. Negrito e itálico juntos: `**<em>texto</em>**`. Reproduza o destaque do original: palavras sublinhadas que a questão cita, títulos de obras em itálico, termos estrangeiros em itálico.
- **Fórmulas, símbolos, unidades:** use LaTeX entre `$...$` (ou `$$...$$` para equação em destaque). Exemplos: `$U_{\text{painel}} = 42\ \text{V}$`, `$9{,}8\ \text{m/s}^2$`, `$\sqrt{x}$`, `$\frac{a}{b}$`, `$\text{Li}^+$`, `$\text{H}_2\text{SO}_4$`, `$1s^2\,2s^1$`. Na vírgula decimal dentro do LaTeX, use `{,}`. Texto comum (palavras) fica fora do LaTeX. Se uma expressão é simples e não tem índice ou expoente (por exemplo "R\$ 86,00", "20%", "x = 3"), pode ficar como texto. **Atenção ao cifrão**: todo `$` que é cifrão de verdade (R\$, US\$, "\$’000") deve ser escrito `\$`, senão abre uma fórmula por engano.
- **Asterisco literal** (chamada de nota de rodapé, como "magno*"): escreva `\*`, para não virar itálico.
- **Índices de nota e ordinais** (¹ ² ³, 1º, 2ª): use os caracteres prontos, sem `<sup>`.
- **Figuras:** `![descrição curta e objetiva](fig:p10-f2)` no ponto do texto em que a figura aparece. A descrição ajuda quem usa leitor de tela: "gráfico da velocidade do navio em função do tempo", "charge de Laerte". Não descreva a resposta nem interprete a figura.
  - Tudo o que é parte do desenho (título do gráfico, eixos, legenda de cores, rótulos, "Figura 1", balões de fala) entra **no recorte** e não se repete no texto.
  - A fonte/crédito impresso abaixo da figura (site, autor, data) fica como texto, em parágrafo próprio, se estiver fora do desenho.
  - Se a legenda impressa já identifica a obra (autor, título), a descrição pode repeti-la, pois o aluno a vê na imagem.
- **Texto dentro de quadro** (manchete de jornal, post de rede social, verbete): se é texto de verdade no PDF, transcreva como texto. Tirinhas, charges e cartuns ficam como figura, e a descrição da figura traz as falas dos balões, entre aspas, para quem usa leitor de tela.
- **Graus e unidades:** `$25\ ^\circ\text{C}$`, `$90^\circ$`; ou "25 °C" como texto, quando não houver outra fórmula por perto.
- **Texto que é só de uma questão do grupo** (por exemplo, o "Texto 2" que aparece depois da questão 18 e serve só à 19): vai no `enunciado` dessa questão, junto com a instrução que o acompanha.
- **Dados que estão em outro lugar do caderno** (tabela periódica no fim da prova, "Use g = 10 m/s²" impresso uma vez para várias questões): repita a instrução impressa no fim do enunciado de cada questão que precisa dela. Se for um dado que você tirou de outra página e que não está escrito na questão (por exemplo, massas atômicas da tabela periódica), escreva-o como nota nossa, nunca como texto da banca: `*(Nota da plataforma: dados da Classificação Periódica que acompanha a prova: Na = 23,0; F = 19,0.)*`.
- **Cores que carregam informação** (letras ou números coloridos que a questão usa): recorte o trecho como figura, porque o texto não reproduz cores.
- **Tabelas:** transcreva como tabela markdown (`| a | b |` com linha `|---|---|`) quando for uma tabela simples de texto e números. Se tiver células mescladas, cores ou desenhos, use a figura recortada.
- **Quadros como "Note e adote"**: transcreva como texto (um parágrafo começando com `**Note e adote:**`), não como figura. Se no caderno o quadro vem depois das alternativas, coloque-o no fim do `enunciado`.
- **Variáveis e grandezas** em itálico ($h$, $x$, $\theta_L$) sempre em LaTeX, mesmo em cabeçalho de tabela. `*itálico*` é só para palavras.
- **Quebras de página e de coluna** podem cortar um parágrafo ou uma alternativa ao meio, com cabeçalho/rodapé de página no meio do texto extraído. Junte as partes e descarte o cabeçalho.
- **Fontes e referências** (autor, obra, site, data de acesso): mantenha como parágrafo próprio, logo depois do texto, como no original.
- **Notas de rodapé** de glossário: mantenha, cada uma em sua linha, depois da fonte (`¹ cacimbo: estação com...`).
- Não inclua cabeçalho e rodapé de página, "Confidencial até o momento da aplicação", número de página, área de rascunho nem instruções do caderno.
- Aspas, travessões e acentos exatamente como no original ("“ ”", "—").

## Como trabalhar

0. Use para arquivos temporários (ampliações, scripts) **só** a pasta `trabalho/<edicao>/tmp-<seu-lote>/` (por exemplo `tmp-031-060`). Outros agentes trabalham ao mesmo tempo em outros lotes; nunca use `/tmp` nem a pasta de outro lote.
1. Localize as páginas das suas questões: `mapa.json` e `grep -nE "QUEST[ÃA]O\s+31" texto.md` (os espaços entre "QUESTÃO" e o número variam). Na FUVEST o número aparece sozinho numa linha; procure também pela posição na sequência.
2. Se o seu lote começa no meio de um grupo de questões com texto compartilhado (por exemplo, o lote começa na 31 e o texto é "para as questões 29 a 32"), transcreva o texto base também, com o mesmo id (`t29-32`), **idêntico caractere por caractere** ao que o outro lote vai gravar: copie fielmente, sem retoques próprios. O script de montagem recusa versões diferentes do mesmo texto.
3. Para cada página, **abra a imagem** (`paginas/pNN.png`) e leia junto com o texto extraído. Em fórmulas pequenas, abra a figura recortada ou faça um recorte de conferência com a ferramenta.
4. Monte cada questão e confira palavra por palavra as alternativas, os números e as unidades.
5. Confira as figuras: cada `fig:` precisa existir em `figuras/` e estar completo. Se a figura automática não presta, recorte de novo.
6. Ao final, rode `python3 ferramentas/validar.py --rascunho <seu-arquivo.json>` e corrija o que ele apontar.
7. Responda só com um resumo curto: quantas questões gravou, quais recortes refez e qualquer dúvida que ficou (as mesmas das `observacoes`).

Não invente nada. Se um trecho estiver ilegível no PDF, transcreva o que dá para ler e explique em `observacoes`.
