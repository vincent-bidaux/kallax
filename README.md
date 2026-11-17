# Kallax Designer

Concepteur de meubles à base d'étagères IKEA **KALLAX**, rendu « plan d'architecte ».
→ **https://kallax.pages.dev**

## Fonctions

- Bibliothèque de Kallax (1×1 → 5×5, badge IKEA pour les formats vendus) à glisser sur la grille
- Aimantation à la grille (1 / 5 / 10 / 35 cm) et aux faces des autres meubles, empilement X / Y / Z
- Blocs libres (L × P × H en cm) pour simuler radiateur, plinthe, allège…
- Vues isométrique, cavalière (45°, rapport 1 ou 0,5 cabinet), rotation libre, retour d'un clic
- ViewCube cliquable (faces, arêtes, coins), perspective / orthographique
- Cotes automatiques par bloc et globales, on/off
- Rendus : vectoriel clean (lignes cachées masquées), ombres, transparence (arêtes cachées en pointillés)
- Thèmes « Plan d'architecte » (fond bleu) et « Papier »
- Calques, undo/redo, sauvegarde auto (navigateur), export/import JSON, export PNG

## Dimensions exactes utilisées

Hors-tout = 35 × n + 6,5 cm → 41,5 · 76,5 · 111,5 · 146,5 · 181,5. Profondeur 39 cm.
Case 33,5 cm, montant extérieur 4 cm, séparation 1,5 cm (voir `src/core/kallax.ts`).

## Dev

```bash
npm install && npm run dev
```

Build : `npm run build` → `dist/`. Déploiement : Cloudflare Pages (projet `kallax`), automatique à chaque push sur `main`.
