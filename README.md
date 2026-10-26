# ADL ROM Patcher

Site Astro statique : patch de ROM dans le navigateur et gestion des amis via une session Discord OAPI.

## Démarrage

Node.js 24 ou supérieur est requis pour exécuter les tests TypeScript natifs.

```sh
npm install
npm run dev
```

La page `/amis` utilise `http://localhost:3000/api` en développement par défaut.
En production, elle utilise `https://oapi.antredesloutres.fr/api`, la même instance [OAPI](https://github.com/matheo-1712/OAPI) qu’Astroloutre.
Pour changer cette adresse, copier `.env.example` vers `.env`, puis renseigner `PUBLIC_OAPI_URL` avec l’URL publique du serveur OAPI, préfixe `/api` inclus, avant de compiler le site.
Cette variable est publique et ne doit contenir aucun secret.

## Docker Compose

Avec Docker et le plugin Compose installés, lancer depuis la racine du projet :

```sh
docker compose up -d --build
```

Le site est accessible sur `http://localhost:8092` (ou `http://<adresse-du-serveur>:8092`).
L’image compile le site avec Node.js, puis sert les fichiers statiques avec Nginx.
Les routes `/amis`, `/pokemon-heartgold` et `/mario-kart-ds` restent directement accessibles.

Pour changer l’adresse d’OAPI, modifier `PUBLIC_OAPI_URL` dans `.env` (voir `.env.example`), puis relancer la commande avec `--build` : cette valeur est intégrée au site pendant la compilation.
L’URL doit être accessible depuis le navigateur du visiteur, pas uniquement depuis le réseau Docker.
Le fichier `.env` n’est pas copié dans l’image ; Compose transmet uniquement l’adresse publique au build.

Pour la connexion Discord en production, placer le site derrière un reverse proxy HTTPS et autoriser son origine publique dans OAPI (`site_auth.url` ou `site_auth.extra_urls`).
Le domaine de production du patcher est `https://rom-patcher.antredesloutres.fr`. Installer un certificat HTTPS couvrant exactement ce nom sur le reverse proxy et ajouter cette origine à `site_auth.extra_urls` dans la configuration de production OAPI, puis redémarrer OAPI. Le patcher transmet automatiquement son origine courante à la connexion et à la déconnexion ; l’URL de l’API reste `https://oapi.antredesloutres.fr/api`.

```yaml
site_auth:
  url: "https://antredesloutres.fr"
  extra_urls:
    - "https://rom-patcher.antredesloutres.fr"
```

Conserver les autres origines déjà présentes dans `extra_urls`. Le patcher et OAPI partagent ainsi le domaine `antredesloutres.fr`, ce qui évite de dépendre des cookies tiers.
Nginx conserve les redirections relatives (`absolute_redirect off`) afin qu’un accès à `/amis` reste en HTTPS lors de la redirection vers `/amis/`, même si le reverse proxy communique avec le conteneur en HTTP. Une redirection vers HTTP change l’origine et bloque les appels OAPI depuis le navigateur.
En local avec OAPI sur `http://localhost:3000`, autoriser `http://localhost:8092`.

```sh
docker compose down
```

## Connexion Discord et amis

La page appelle `/auth/site/me`, puis `/friends/me`, avec le cookie OAPI (`credentials: include`).
Les boutons de connexion et déconnexion passent par `/auth/site/login` et `/auth/site/logout`, avec l’origine courante et un retour sur `/amis`.
Les actions d’amitié sont des `POST` sans corps ni en-tête personnalisé. Aucune clé de service ni aucun token ROM n’est utilisé ou enregistré par le site.

Dans OAPI, déclarer l’origine du site dans `site_auth.url` ou `site_auth.extra_urls` ; en production, utiliser HTTPS.
Pour un test local, lancer OAPI sur `http://localhost:3000`, autoriser `http://localhost:4321`, et ouvrir le site avec ce même nom d’hôte.
Si le navigateur bloque les cookies tiers, héberger OAPI sous un sous-domaine du même domaine que le site.

L’ajout se fait exclusivement par le nom d’utilisateur Discord exact du destinataire, par exemple `rerebleue` ou `@rerebleue`, via la route existante `POST /friends/me/rerebleue/request` (sans corps). Son paramètre destinataire désigne un tag Discord et n’accepte plus les identifiants PocketBase.
OAPI normalise les espaces de bord, le `@` initial et les majuscules, puis retrouve le compte à partir du champ `discord_tag`. Le membre doit déjà être connu d’OAPI ; le nom d’affichage Discord ne remplace pas le nom d’utilisateur.
Cette fonctionnalité nécessite de déployer également l’évolution OAPI de la route existante. Les autres actions continuent à utiliser les identifiants internes fournis dans les listes d’amis.
Les demandes reçues peuvent être acceptées ou refusées, les demandes envoyées annulées et les amis retirés après confirmation.
Les listes sont chargées à l’ouverture et après une action, ou manuellement avec « Actualiser » ; aucun polling automatique.
Une réponse `429` désactive temporairement les appels ; le délai `Retry-After` est respecté, avec 60 secondes par défaut si l’en-tête n’est pas lisible via CORS.

## Lier un jeu à son compte Discord

La page `/connexion/`, accessible par « Lier mon jeu », utilise la session Discord OAPI pour générer un code à saisir dans le jeu.
Le code est créé uniquement après une action explicite sur « Générer un code » (`POST /auth/rom/code?label=…`, sans corps). Le nom de l’appareil est facultatif.
La page affiche les six chiffres, l’échéance fournie par OAPI, le temps restant et un bouton de copie. Le code est à usage unique et expire après 15 minutes ; un nouveau code remplace le précédent code en attente.
Il reste uniquement en mémoire et est effacé de la page à l’expiration, à la déconnexion ou lorsqu’on quitte la page. Aucun code ni token n’est enregistré dans le stockage du navigateur.

Les appareils déjà liés sont listés via `GET /auth/rom/devices`, avec leur nom, date de liaison, état et un bouton de révocation avec confirmation (`POST /auth/rom/devices/{id}/revoke`). Après saisie du code dans le jeu, « Actualiser » permet de voir le nouvel appareil ; aucun polling automatique n’est effectué.
Le site n’appelle jamais `/auth/rom/token` : l’échange du code contre un token est réservé au jeu. Les routes ROM doivent être déployées dans OAPI et la collection PocketBase `discord_identity_token` configurée conformément à sa documentation.

## Lier une sauvegarde Mario Kart DS

La page `/sauvegarde/`, accessible par « Ma sauvegarde », envoie une sauvegarde Mario Kart DS brute (`.sav` EUR de 262 144 octets commençant par `MKDSSV10`) à `POST /saves/mkds/link` d’OAPI, en `multipart/form-data` avec un seul champ `save` et le cookie de session. Le compte vient uniquement de la session Discord : aucun identifiant n’est envoyé par le navigateur.
OAPI crée au besoin le compte `discord_users` et le joueur DS Games, enregistre l’appareil dans `adln_devices` et renvoie une copie liée. Le site la propose au téléchargement via une URL `blob:` en mémoire, révoquée en quittant la page ou en changeant de fichier ; rien n’est stocké dans le navigateur.
Le site vérifie la taille et l’en-tête avant l’envoi, OAPI revalide tout. La page rappelle de fermer l’émulateur, de garder la sauvegarde d’origine et de ne pas partager la copie liée. La connexion du jeu avec cet identifiant dépend d’une future version de la ROM.
Le contrat complet (format, chiffrement, reprise, codes d’erreur) est décrit dans `docs/save_link.md` d’OAPI. La route nécessite `ADLN_DEVICE_WRAPPING_KEY` côté OAPI.

## Vérification

```sh
npm test
npm run build
```

Les tests vérifient le contrat HTTP avec des réponses OAPI simulées. La connexion Discord réelle nécessite une instance OAPI configurée et un compte Discord ; elle ne fait pas partie de ces tests automatisés.
