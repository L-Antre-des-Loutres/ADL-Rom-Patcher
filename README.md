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

L’API actuelle ne fournit pas de recherche de membres ni l’identifiant PocketBase du membre connecté dans `/auth/site/me`.
L’ajout nécessite donc l’identifiant d’enregistrement `discord_users` du destinataire (1 à 64 caractères alphanumériques), fourni par ce membre ou l’administration OAPI : un pseudo ou un identifiant Discord ne le remplace pas.
Les demandes reçues peuvent être acceptées ou refusées, les demandes envoyées annulées et les amis retirés après confirmation.
Les listes sont chargées à l’ouverture et après une action, ou manuellement avec « Actualiser » ; aucun polling automatique.
Une réponse `429` désactive temporairement les appels ; le délai `Retry-After` est respecté, avec 60 secondes par défaut si l’en-tête n’est pas lisible via CORS.

Les documents de liaison ROM décrivent un autre flux. Cette page ne génère pas de codes et ne gère pas les appareils liés.

## Vérification

```sh
npm test
npm run build
```

Les tests vérifient le contrat HTTP avec des réponses OAPI simulées. La connexion Discord réelle nécessite une instance OAPI configurée et un compte Discord ; elle ne fait pas partie de ces tests automatisés.
