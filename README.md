# Daggerheart: Wonder Domain

Módulo para **Foundry VTT v14** e o sistema **Daggerheart (Foundryborne) 2.12+** que adiciona o domínio **Wonder**, as classes **Enchanter** e **Stargazer**, suas quatro subclasses e todas as mecânicas especiais — com interfaces visuais próprias.

*Module for Foundry VTT v14 and the Foundryborne Daggerheart system (2.12+). Adds the Wonder domain, the Enchanter and Stargazer classes, their subclasses and every special mechanic, with dedicated visual interfaces.*

## Instalação

No Foundry, em **Add-on Modules → Install Module**, cole o manifesto:

```
https://github.com/pedronaraujo/daggerheart-wonderdomain/releases/latest/download/module.json
```

Ative o módulo no mundo de Daggerheart.

### Arte das cartas

A arte das cartas, subclasses e classes **não vem no módulo**: ela é extraída da sua própria cópia dos PDFs e fica só no seu servidor, na pasta `wonder-domain-art/` dos dados do Foundry.

1. Gere as imagens (ou use o pacote `wonder-domain-art.zip` já gerado):
   `python3 tools/build_art.py Wonder_Domain.pdf Enchanter_Class.pdf Stargazer_Class.pdf saida/`
2. No Foundry, como GM, abra o compêndio **Wonder Macros** e execute **Install Wonder Card Art**; selecione todos os arquivos extraídos. Eles são enviados para `wonder-domain-art/`.

## O que vem no módulo

| Compêndio | Conteúdo |
|---|---|
| **Wonder Domain Cards** | As 21 cartas do domínio Wonder (níveis 1–10), com ações nativas do sistema: Spellcast Rolls, dano, custos de Hope/Stress, condições (*Restrained*, *Vulnerable*, *Inscribed*, *Dazzled*) e contadores nas cartas (Lunar tokens do Moon Shield, valor da Masterpiece, recarga do Craftsmanship). |
| **Wonder Classes** | Enchanter (Wonder & Codex) e Stargazer (Wonder & Splendor) com features, Hope features, itens de classe, perguntas de background/conexões e equipamento sugerido. |
| **Wonder Subclasses** | Appraiser, Spellweaver, Astrologer e Clairvoyant, com todas as features de Foundation, Specialization e Mastery. |
| **Magical Enchantments** | Os 24 encantamentos (Tiers 1–4) como itens de referência. |
| **Wonder Domain Guide** | Journal com o guia de uso e as regras de referência. |
| **Wonder Macros** | Atalhos para a Carta Estelar, Forma de Constelação, Oficina, Bancada e Glimpse dice. |

O domínio *Wonder* é registrado no sistema com cor e ícone próprios, então aparece normalmente na criação de personagem, no level up, no navegador de compêndios e nas cartas.

## Interfaces

Fichas com uma classe ou cartas Wonder ganham um botão **✦ Wonder** no cabeçalho, que abre a **Central Wonder** com tudo do personagem.

### Stargazer — Carta Estelar
- A constelação do livro em um céu interativo: estrelas disponíveis brilham, clique para marcar (só estrelas conectadas), botão direito desmarca (sem quebrar a ligação com o início).
- Orçamento de estrelas automático: nível + Celestial/Radiant/Stellar Blessing (+ ajuste do GM).
- **Embody Constellation**: marca 1 Stress, coloca Astral tokens = Spellcast (mín. 1, máx. 6) e aplica a forma: ataque padrão (alcance, dado, bônus, Reliable, traço Spellcast, dano mágico), Evasão, slots extras de Armor e Hope, voo, resistência mágica.
- As habilidades das estrelas (Astral Mend, Star Step, Twin Strike, Starbreak) viram ações nativas que gastam Astral tokens.
- Cada action roll na forma gasta uma Astral token automaticamente (com botão de desfazer no chat — útil com Binary Stars). A forma termina sem tokens ou ao marcar o último Hit Point. Against the Odds devolve a token em falha com Hope.
- Empyrean Call (3 Hope → 1d4 tokens, 2 Hope com Cosmic Help) e escolha da Binary Star.

### Clairvoyant — Glimpse dice
- Rola 2d4 (d6 com Written in the Stars, +1 dado com Twist of Fate), mostra os dados e gasta com um clique (+ ou −) anunciando no chat. Reroll para Tag Team e descarte no fim da sessão.

### Enchanter — Oficina de Encantamentos
- Encantamentos em cartas por Tier (Tiers acima do seu ficam bloqueados).
- Lista os itens do personagem (e dos tokens marcados como alvo) e explica por que cada um é ou não elegível; também aceita “outro objeto” descrito livremente.
- Paga 1 Stress ou 3 Hope (**Ingenious Surge**, fora do limite), controla o limite de encantamentos ativos (2 com **Expanded Stock**) e um encantamento por objeto.
- Aplica a mecânica no item: Protective, Reliable, Quick, Powerful, Unreliable, Channeling, limiares + Spellcast, −2 Evasão/Difficulty, imunidade a Vulnerable, Restrained, features ignoradas (Clearing), mudança de empunhadura (Growth/Shrinking), Combining em ordem, e o **dado de Explosão** d8 que desce sozinho a cada action roll.
- Spellweaver: Magic Weapons (ataque com Spellcast), Overcharged, Small Appreciation (+dano) e Creative Flow (recupera o Spellweave).
- Encerrar desfaz tudo e restaura o item original.

### Appraiser — Bancada de Engenhocas
- Escolha os punhados de ouro (até o Tier), role os d8 (+1 com Resourceful Craft) e escolha o loot das tabelas oficiais com número ≤ total; cria uma cópia temporária marcada.

## Automação

As ações usam o fluxo nativo do sistema (custos de Hope/Stress, usos por descanso, rolagens, dano, botões de aplicar no chat). Por cima disso o módulo aplica o que cada carta diz que acontece depois:

- **Passivas:** Binary Stars (+1 Evasão na Binary Star dentro de Close/Far, ataque padrão sem gastar Astral token no alcance), Gravity Pull (cartão no chat quando a Binary Star marca HP), Out of Orbit, Wonder-Touched (Stress no lugar da Hope que faltar), Harmonious Magic (liga sozinho perto de um objeto encantado), Small Appreciation (Recall Cost −1 nas cartas de nível 1), Against the Odds, bênçãos da Carta Estelar.
- **Cartas:** Dream Signal (+Spellcast na próxima rolagem do aliado; com Hope limpa Stress, com Fear o GM ganha Fear), Cosmic Inspiration (próxima rolagem com d20 de Hope), Twinned Minds (Stress dos dois + efeito), Shared Dreams, Fidgety Bolt (saltos pelos dados de Hope/Fear ≥ 8), Moon Shield (field + Lunar tokens + redução), Masterpiece, Craftsmanship (+2 na próxima rolagem), Archive/Breakthrough (vão para o cofre), Gemology, Paradox Flux.
- Efeitos com alvo *self* são aplicados na hora; efeitos em outros alvos usam o botão **Apply Effects** do sistema (ou a automação do próprio sistema, se ligada).

## Configurações
- Gastar Astral tokens automaticamente
- Reduzir o dado de Explosão automaticamente
- Botão Wonder nas fichas

## Desenvolvimento

```
npm install
npm run build   # gera src/packs/*.json e lang/*.json e compila os packs LevelDB
```

Os dados vêm de `tools/build_data.py`, `data/enchantments.json` e `data/star-chart.json`.

## Créditos e licença

Conteúdo do Wonder Domain, Enchanter e Stargazer: design de **Reno Reizakki**, revisão de Martin Groene e Jere Lahtonen. Este produto inclui materiais do Daggerheart System Reference Document 1.0, © Critical Role, LLC., sob os termos da Darrington Press Community Gaming (DPCGL) License. Mais informações em https://www.daggerheart.com.

Módulo para Foundry por Pedro Tostes. Código sob licença MIT. Ícones e arte do módulo são originais; os demais ícones são os do próprio Foundry VTT.
