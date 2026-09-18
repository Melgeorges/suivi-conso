# Suivi Conso

Journal personnel de suivi des comportements et émotions, inspiré de la TCC (Thérapie Cognitive et Comportementale).

## Ce que ça fait

L'app permet de loguer au quotidien :

- **Comportements suivis** : cigarettes, verres d'alcool, shorts/reels (heures)
- **Comportement libre** : n'importe quel autre comportement à noter
- **Émotions** : sélection parmi une liste de pills (20 options)
- **Situation, pensées automatiques** : champs texte libres
- **Comportement dérivatif** : une suggestion de coping tirée au sort
- **Victoires** : enregistrer un moment positif avec les 4 champs TCC (situation, émotion, pensées, comportement)

Les données s'affichent en graphes hebdomadaires et dans un calendrier mensuel.

## Architecture

```
Node.js + Express  ←→  SQLite (mode WAL)
      ↓
  HTML/CSS/JS (vanilla, Tailwind CDN)
```

## Lancement en local

```bash
cd suivi-conso
npm install
APP_PASSWORD=monmotdepasse node server.js
```

Ouvrir http://localhost:3001

## Déploiement (Fly.io)

```bash
fly deploy
```

L'app tourne sur un volume persistant pour la base SQLite. Le mot de passe est défini via `fly secrets set APP_PASSWORD=...`.

## Export

Un bouton d'export CSV est disponible en bas de page pour récupérer toutes les données.
