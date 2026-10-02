# Tonete

Páginas da NT Advocacia (Nayara Tonete, advogada, OAB/SP 479.459).

- `escola-pcd/index.html`: landing page sobre a dedução integral, no Imposto de Renda, das despesas escolares de pessoa com deficiência (Tema 324 da TNU), com link para o WhatsApp do escritório.
- `whatsapp-bot/`: atendimento automático (triagem) num número de WhatsApp próprio para a campanha de golpe do Pix; ao fim, avisa a advogada e encaminha o cliente ao WhatsApp do escritório. O roteiro de cada cliente fica num perfil (`whatsapp-bot/src/perfis/`), então o mesmo robô pode atender outros escritórios. Veja o README da pasta para colocar no ar.
- `img/nayara-tonete.jpg`: foto da advogada usada na seção "Quem atende" (560×700, otimizada para web).

## Publicação

O site é publicado no GitHub Pages pelo workflow `.github/workflows/pages.yml` a cada push no `main` (em Settings > Pages, a origem deve ser "GitHub Actions"). A página da PcD fica em `/escola-pcd/`. O arquivo `.nojekyll` faz o Pages servir os arquivos como estão.
