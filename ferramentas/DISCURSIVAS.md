# Discursivas (2ª fase): o que temos e o que falta

Levantamento de 15/10/2026, depois da liberação de fuvest.br e comvest.unicamp.br na rede do ambiente. Os PDFs ficam em `fontes-oficiais/<fuvest|unicamp>/<ano>/` (fora do git, 189 arquivos, 310 MB). O catálogo de cada arquivo, com o endereço de origem, está em `dados/provas/fontes-2fase.json`.

| Vestibular | Cadernos da 2ª fase | Respostas oficiais |
|---|---|---|
| FUVEST 2017–2018 | 3 dias (Português + redação; núcleo comum; específicas) | **não publicadas** pela FUVEST |
| FUVEST 2019–2022 | 2 dias (Português + redação; 36 questões de 6 matérias) | **não publicadas** pela FUVEST |
| FUVEST 2023–2026 | 2 dias | "Abordagens esperadas" / "Guia de respostas" (2026: um PDF por matéria) |
| Unicamp 2017–2026 | 3 cadernos (até 2019) ou 4 (2020 em diante) | "Respostas esperadas" e prova comentada oficial, todos os anos |
| UNESP | sem acesso | sem acesso: vunesp.com.br recusa a conexão (o próprio servidor) e vestibular.unesp.br está bloqueado na rede |

Observações:
- As respostas esperadas da Unicamp de 2020 a 2022 e a de Física de 2017 têm o texto embaralhado no PDF; precisam ser lidas pela imagem da página.
- A redação não entra como questão: não tem resposta certa. A proposta pode ser mostrada como leitura, com a expectativa da banca (Unicamp publica).

Regra do projeto: discursiva só entra com a resposta publicada pela banca (`dados/provas/respostas/<edicao>.json`). Por isso a ordem de trabalho é:
1. Unicamp 2017–2026 e FUVEST 2023–2026 (têm resposta oficial).
2. FUVEST 2017–2022 e UNESP: dependem de decisão (publicar o enunciado sem resposta ou deixar de fora).
