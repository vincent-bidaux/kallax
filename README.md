# Kallax Designer

Concepteur de meubles à base d'étagères IKEA **KALLAX**, rendu « plan d'architecte ».
→ **https://kallax.abpq.cc** (aussi https://kallax.pages.dev)

## Fonctions

- Bibliothèque de Kallax (1×1 → 5×5, badge IKEA pour les formats vendus) à glisser sur la grille
- Aimantation à la grille (1 / 5 / 10 / 35 cm) et aux faces des autres meubles, empilement X / Y / Z
- Blocs libres (L × P × H en cm) pour simuler radiateur, plinthe, allège…
- Objets en 3 groupes : Blocs (brique, poutres ronde / carrée), Maison (mur texturé, fenêtre, porte à poignée, plinthe, radiateur), Objets (lit 90 / 140 / 160 / 180, lampe 28 / 50 cm, plante 35 / 50 / 75 cm)
- Fenêtres et portes percent automatiquement les murs
- Habillage des cases : porte, 2 tiroirs, panier, séparation horizontale (outil + clic dans une case)
- ⌥ + glisser pour dupliquer, ⌥ + flèches pour un déplacement fin (0,5 cm)
- Rotation par pas de 90° sur X, Y, Z pour tous les objets (touches X, Y, R ; ⇧ pour −90°)
- Vues isométrique, cavalière (45°, rapport 1 ou 0,5 cabinet), rotation libre, retour d'un clic
- ViewCube cliquable (faces, arêtes, coins), perspective / orthographique
- Cotes automatiques par bloc et globales, on/off
- Rendus : vectoriel clean (lignes cachées masquées), ombrage des volumes (lumière liée à la caméra), transparence (arêtes cachées en pointillés discrets)
- Thèmes « Plan d'architecte » (fond bleu) et « Papier »
- Projets (enregistrer, ouvrir, nouveau, dupliquer), calques, undo/redo, export/import JSON, export PNG
- Option piètement IKEA sur les Kallax (2×2, 2×4, 4×3 couché, 4×4)
- Finitions (blanc, blanc brillant, brun noir, chêne blanchi, chêne, noyer, gris) : choix global + par étagère, rendu « Couleurs des finitions »
- Prix IKEA France (nov. 2026) : « dès … » dans la bibliothèque, liste de courses chiffrée, total de la composition

- FR / EN (langue du navigateur par défaut, choix dans le menu « … »)
- Objets accrochés en hauteur : glissés sur un mur, ils suivent le curseur ; déplacés, ils gardent leur hauteur
- Projets stockés uniquement dans le navigateur ; export JSON par projet ou « Tout exporter » (sauvegarde), réimportables

## Projet par défaut

Les nouveaux visiteurs démarrent sur `public/default-project.json` (export JSON d'un projet). Sans ce fichier, une petite démo est chargée.

## Dimensions exactes utilisées

Hors-tout = 35 × n + 6,5 cm → 41,5 · 76,5 · 111,5 · 146,5 · 181,5. Profondeur 39 cm.
Case 33,5 cm, montant extérieur 4 cm, séparation 1,5 cm (voir `src/core/kallax.ts`).
Piètement (« support ») : +17,5 cm réels (vendu 18 cm), pour les cadres de 2 ou 4 cases de large.

Formats IKEA (badge) : 5×5 ; 4×4, 4×3, 4×2, 4×1 ; jusqu'à 3, toutes les combinaisons sauf 3×1.

Références :
- [Série KALLAX — par nombre de cases](https://www.ikea.com/fr/fr/cat/kallax-serie-27534/)
- [Étagères KALLAX — par format](https://www.ikea.com/fr/fr/cat/etageres-kallax-58285/)

## Dev

```bash
npm install && npm run dev
```

Build : `npm run build` → `dist/`. Déploiement : Cloudflare Pages (projet `kallax`), automatique à chaque push sur `main`.
