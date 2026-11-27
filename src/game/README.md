# Easter egg (dev)

Dans la Visite, la touche **T** (non documentée dans l'interface) lance un mode jeu caché : rendu réaliste, poings / fusil à pompe (T), meubles destructibles, barre de destruction, écran WIN.

- Module isolé chargé à la demande (chunk séparé) ; il lit une copie du document et ne modifie rien.
- Sons CC0 dans `public/game-audio/` (voir `LICENSES.md`).
- Pour le retirer : supprimer `src/game/`, `public/game-audio/` et le bloc « game easter egg » de `src/interaction/walk/walk-mode.ts`.
