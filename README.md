# Brasil FX

Estúdio de **efeitos visuais fictícios** sobre um mapa 3D do Brasil. Você escolhe um ponto no mapa, escolhe um efeito e roda uma "tomada" cinematográfica com contagem regressiva, clarão, onda de choque, partículas, fumaça, luzes dinâmicas e som sincronizado.

> Experiência fictícia: tamanhos, cores, tempos e sons são escolhas artísticas. O site não calcula alcance, energia ou danos de nada real.

## Como abrir

- **Direto no navegador:** dê dois cliques em `index.html`. Funciona sem servidor, mas precisa de internet (o three.js e as fontes vêm de CDN).
- **Com servidor local** (opcional):

  ```bash
  python -m http.server 5510
  ```

  e abra `http://localhost:5510`.
- **Publicar:** é um site estático. Basta enviar a pasta inteira (sem `.claude/`) para qualquer hospedagem estática (Hostinger, Vercel, Netlify, GitHub Pages).

## Controles

| Ação | Mouse / teclado | Toque |
| --- | --- | --- |
| Girar o mapa | arrastar | um dedo |
| Aproximar | rolar | pinça |
| Mover | botão direito | dois dedos |
| Marcar ponto | clique | toque |
| Iniciar | `Enter` | botão **Iniciar simulação** |
| Pausar / continuar | `Espaço` | botão ⏸ |
| Repetir a mesma tomada | `R` | botão ↺ |
| Limpar (o ponto e a tomada; as crateras ficam) | `Backspace` | botão 🗑 |
| Resetar mapa (apaga crateras, montanhas e fendas salvas; pede um segundo clique) | `T` | botão ao lado do 🗑 |
| Silenciar | `M` | botão de som |
| Trocar efeito | `1` a `9` | cartões do painel |

**Ajustes:** "Reduzir efeitos visuais" diminui partículas, desliga bloom, tremores e clarões fortes (vem ligado para quem usa *reduzir movimento* no sistema). "Câmera cinematográfica" aproxima e gira devagar durante a tomada.

## Efeitos

| Código | Nome | O que mostra |
| --- | --- | --- |
| FX-01 | Bola de fogo | Clarão, labaredas, faíscas, fumaça escura e anel no chão |
| FX-02 | Meteoro | Bólido cruzando o céu, detritos e parede de poeira |
| FX-03 | Pulso de plasma | Carga elétrica, esfera de energia, arcos e anéis neon |
| FX-04 | Supernova | Núcleo estelar, nebulosa colorida, anéis e feixes de pulsar |
| FX-05 | Fogos de artifício | Rojões coloridos com final triplo |
| FX-06 | Coluna solar | Clarão longo, coluna de fogo que sobe e se abre em nuvem, anel de condensação |
| FX-07 | Onda fantasma | Pulso verde quase silencioso, esfera translúcida e anéis, sem fogo |
| FX-08 | Tapete de chamas | Linhas de fogo que correm pelo chão, brasas e fumaça baixa |
| FX-09 | Chuva de faíscas | Doze estouros pequenos em sequência ao redor do ponto |
| FX-10 | Nuvem de ignição | Névoa que se espalha pelo chão e acende toda de uma vez |
| FX-11 | Apagão | Pulso azul com raios; o mapa apaga e as luzes voltam piscando |

| FX-12 | Nuclear | Visual de filme: clarão branco, bola de fogo, cogumelo, anel de condensação e onda de choque. Sem escala real |
| FX-13 | Bomba Ridícula | Potência ×1000 de mentira: clarão gigante, coluna de luz até o céu, chuva de cubos em brasa e cratera enorme |
| FX-14 | Explosão de pixels | A bola de fogo inteira é feita de cubos brilhantes, com anel de pixels ciano |
| FX-15 | Buraco negro | Núcleo escuro com disco de luz que suga poeira e blocos do chão e colapsa num estouro violeta |
| FX-16 | Tornado (evento) | Nuvem de tempestade com raios e um funil de vento que anda pelo chão sugando os blocos |
| FX-17 | Tsunami (evento) | Uma parede de água vem do mar, quebra sobre o ponto, alaga a área e arrasta blocos |
| FX-18 | Vulcão (evento) | O chão sobe numa montanha que entra em erupção: lava, bombas em cubos, cinza e raios |
| FX-19 | Terremoto (evento) | Tremor forte, ondas sísmicas e fendas que se abrem em linhas |
| FX-20 | Ataque alienígena (evento) | Nave-mãe com raio trator que puxa blocos; naves menores atiram lasers |

As teclas `1` a `9` escolhem os nove primeiros efeitos; os outros ficam nos cartões.

## Criar meu efeito

O botão **Criar meu efeito** abre um editor com nome, três cores (núcleo, chamas, fumaça), controles de tamanho, fogo, fumaça, faíscas, onda de choque, clarão, tremor e altura, e quatro tipos de som. **Testar no ponto** roda o rascunho no ponto marcado; **Salvar** cria um cartão `MEU-01`, `MEU-02`... (até 12). Os efeitos ficam guardados só neste navegador (localStorage). Selecione um efeito seu e use **Editar** para mudar ou apagar.

## Mapa em blocos e crateras

O Brasil é montado com cerca de 38 mil blocos no computador (16 mil no celular), com relevo leve. As divisas e o litoral aparecem nas bordas dos próprios blocos. Com **Cratera em blocos** ligada (Ajustes), cada explosão arranca os blocos do centro (os do meio saem em brasa e esfriam no ar) e afunda o terreno numa cratera em degraus.

**As crateras ficam salvas no navegador**: continuam lá ao recarregar a página. Explodir de novo no mesmo lugar **cava mais fundo**, inclusive abaixo do nível do mar, até um fundo máximo. Ao fim de cada tomada aparece quantos blocos de fundo a cratera tem. **Limpar** só tira o ponto; para apagar as crateras use o botão **Resetar mapa** (ao lado da lixeira, ou tecla `T`). A profundidade é **só visual**, proporcional à intensidade artística do efeito, e não representa nenhuma força real.

## Eventos

Os efeitos marcados como **evento** mexem no terreno de um jeito próprio, sempre só visual:

- **Tornado:** deixa um rastro por onde o funil passa, com os blocos sugados em espiral para cima.
- **Tsunami:** a frente da onda arrasta os blocos para a frente.
- **Vulcão:** levanta uma montanha de blocos com cratera no topo.
- **Terremoto:** abre fendas fundas em linhas, com degraus.
- **Ataque alienígena:** abre um buraco com o raio trator e crateras onde os lasers acertam.

Tudo isso funciona no mapa e no globo e fica salvo como as crateras.

## Potência e luz

No editor (**Criar meu efeito**), o controle **Potência** vai de Normal a **Ridícula** (×1 a ×1000, um número de brincadeira). Ele aumenta o tamanho, a luz, o tremor, a duração e a cratera, e a partir de certo ponto acrescenta cubos em brasa, anel de choque e uma coluna de luz até o céu. Nos Ajustes, **Intensidade da luz** (50% a 250%) deixa as luzes dos efeitos, o clarão e o brilho mais fortes ou mais suaves.

## Chegar como míssil

A opção **Chegar como míssil** (abaixo da lista de efeitos) vale para qualquer efeito: durante a contagem, um projétil fictício sobe em arco, com rastro de fumaça e som de aproximação, e chega ao ponto no momento da detonação. Dá para marcar pontos no Brasil ou no mar perto dele.

## Globo em blocos (qualquer lugar do planeta)

O botão **Globo** (ou a tecla `G`) mostra a Terra inteira feita de blocos, bem maior que o globo antigo: cerca de 113 mil colunas no computador e 32 mil no celular, com os países do mundo e os estados do Brasil. O mar também é quadriculado. Passe o mouse para ver o nome do país ou do oceano.

Clique ou toque em **qualquer lugar**, terra ou mar. O planeta gira até o ponto ficar à sua frente e a câmera desce até ele. Aí é só escolher o efeito (inclusive o nuclear e os seus) e iniciar, com ou sem **Chegar como míssil**. Na terra, os blocos voam e fica uma cratera que se acumula com as próximas e fica salva. No mar, sobem cubos de água e não há cratera. Clique em **Globo** de novo para afastar e ver o planeta inteiro. **Aleatório** sorteia um ponto em terra firme.

O mapa do Brasil e o planeta têm crateras separadas. Tudo continua **só visual**, sem cálculo de força, alcance ou danos.

"Repetir" reproduz a mesma tomada quadro a quadro (mesma semente aleatória). "Nova simulação" gera uma variação.

## Estrutura

```
index.html          interface e carregamento do three.js (importmap + CDN jsDelivr)
css/style.css       visual (tema escuro único, vidro, molas, gaveta no celular)
js/brasil-geo.js    malha das UFs (IBGE), simplificada e com rótulos
js/util.js          aleatoriedade com semente, curvas, molas, formatação
js/audio.js         motor de som procedural (Web Audio, sem arquivos de áudio)
js/textures.js      texturas procedurais (fumaça, brilho, faísca, ruído)
js/particles.js     partículas na GPU com movimento analítico no shader
js/parts.js         clarões, domo de choque, anéis, raios, feixes, reflexos de lente
js/map.js           mapa 3D, oceano com graticulado, luzes e ondas do "palco"
js/planet.js        planeta em blocos (esfera-cubo), crateras e destroços em qualquer ponto
js/mundo-geo.js     países do mundo (Natural Earth 1:110m)
js/effects.js       os efeitos FX-01 a FX-12 e o construtor do editor (com potência)
js/effects-extra.js Bomba Ridícula, Explosão de pixels e Buraco negro
js/effects-weather.js eventos: tornado, tsunami, vulcão, terremoto e ataque alienígena
js/app.js           renderização, câmera, interface, tomadas e qualidade adaptativa
```

**Desempenho:** a resolução se ajusta sozinha quando o quadro fica lento; no celular o site usa menos partículas, bloom em meia resolução e sem MSAA. Os shaders são compilados na abertura para não travar no momento da explosão.

**Depuração:** no console, `BRASIL_FX` expõe o estado (`phase`, `take`, `quality`) e atalhos de teste (`manual()`, `seek(t)`, `step(n)`).

## Créditos

- Malha territorial: IBGE, API de malhas v3 (qualidade mínima).
- Países do mundo: Natural Earth 1:110m via world-atlas (domínio público).
- Motor 3D: [three.js](https://threejs.org) r180 (licença MIT).
- Fontes: Big Shoulders Display, Instrument Sans e JetBrains Mono (Google Fonts, licença OFL).
