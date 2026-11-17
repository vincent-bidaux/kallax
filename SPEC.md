# Kallax Designer — spécification

Web app (Vite + TypeScript + Three.js, aucun framework UI) pour composer des meubles à partir
d'étagères IKEA KALLAX, rendu "dessin technique". Hébergée sur Cloudflare Pages (`dist/`).
Langue de l'interface : **français**. Unités : **cm partout**.

## Exigences (cahier des charges utilisateur)

1. UI typique des apps Apple (macOS : barre d'outils unifiée, sidebars translucides `backdrop-filter`,
   police système `-apple-system, BlinkMacSystemFont, "SF Pro Text"`, segmented controls, switches iOS,
   popovers, coins arrondis 10–12 px, icônes fines type SF Symbols en SVG inline, animations douces).
2. Vue 3D **isométrique** ou **perspective cavalière** (option pour les deux).
3. Bibliothèque de types Kallax (1×1, 2×1, 1×3, 2×4, …) → **glisser-déposer** sur la grille.
   Aimantation aux cellules de la grille **et** aux autres Kallax (faces jointives).
4. **Dimensions exactes** (voir `src/core/kallax.ts` : pas 35 cm, hors-tout = 35·n + 6,5, profondeur 39,
   case 33,5, montant extérieur 4, séparation 1,5).
5. Rendu de base **clean, look vectoriel** (traits nets à épaisseur constante en px, faces pleines qui
   masquent les arêtes cachées).
6. Options de rendu : **ombres**, **transparence** (faces translucides + arêtes cachées en pointillés).
7. Thème "plan d'architecte" : **fond bleu**, dessin blanc ; épaisseurs de trait différenciées
   modèle (épais) / ouvertures (moyen) / cotes et infos (fin) / grille (très fin). Thème "papier" en option.
8. **Cotes automatiques** joliment dessinées : par bloc (L × P × H) et **globales** (hors-tout de la
   composition), lignes d'attache, terminaisons en tirets obliques d'architecte (ticks 45°), étiquettes
   en pastille. Interrupteurs on/off séparés.
9. Rotation **3D libre** (orbit), puis **retour d'un clic** à l'iso ou à la cavalière (transition animée).
10. **ViewCube** dans un coin : clic sur faces / arêtes / coins pour orienter la caméra.
11. Option **perspective / orthographique**.
12. Plusieurs **couches sur X, Y et Z** : empiler des Kallax à côté (X), derrière/devant (Y), dessus (Z).
    → aimantation sur toutes les faces, empilement sur le dessus, champs X/Y/Z dans l'inspecteur,
    boutons "dupliquer à droite / derrière / dessus". Plus des **calques** (layers) nommés, visibles/verrouillables.
13. **Origine** bien définie sur la grille comme dans un soft 3D (gizmo d'axes X rouge, Y vert, Z bleu à 0,0,0).
14. **Bloc libre** (rectangle) pour objets custom (radiateur…) : on saisit L × P × H en cm + un nom.

## Conventions

- Monde **Z-up** : X droite (largeur), Y vers le fond (profondeur), Z haut. `camera.up = (0,0,1)`.
- `item.position` = coin **min** (gauche, avant, bas) de la boîte englobante monde.
- Rotation autour de Z (0/90/180/270). À 0°, l'ouverture avant regarde −Y (vers l'utilisateur en vue de face).
- Kallax : ouvert devant **et** derrière (pas de fond).
- Grille au sol z = 0. Pas de grille par défaut 5 cm (mineur), majeur tous les 50 cm, 1 m accentué.
- Vue de face = caméra en −Y regardant +Y. Iso = depuis (+1, −1, +1) (avant-droite-haut).
- Cavalière = vue de face orthographique + cisaillement de la profondeur Y à `cavalierAngle` (45°)
  et `cavalierRatio` (1 = cavalière, 0,5 = cabinet), fuyantes vers le haut-droite.

## Modules / propriété (un agent par module)

| Fichier(s) | Rôle |
|---|---|
| `src/core/*` | types, dimensions, store (undo/redo, persistance localStorage), thème, contrats — **figés** |
| `src/render/lines.ts` | fat lines (LineSegments2) — **figé** |
| `src/render/viewport.ts` (+ `render/*` internes) | renderer, scène, caméras, transitions, grille, origine, meshes Kallax/blocs, modes de rendu, picking, ghost |
| `src/render/measurements.ts`, `src/render/viewcube.ts` | cotes + étiquettes, ViewCube |
| `src/ui/*`, `src/interaction/*`, `src/main.ts`, `index.html`, `src/styles.css` | shell Apple, bibliothèque, inspecteur, calques, réglages, drag & drop, snapping, raccourcis |

Interfaces : `src/core/contracts.ts`.
