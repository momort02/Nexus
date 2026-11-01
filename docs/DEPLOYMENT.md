# Déploiement de Nexus sur une VM Ubuntu

Cette procédure sert l'accueil et le dashboard à la même origine HTTPS :

- `https://nexus.momort02.com/` : accueil et documentation.
- `https://nexus.momort02.com/dashboard/` : application Nexus.
- `https://nexus.momort02.com/api/` : API privée derrière Caddy.

Docker Compose démarre l'API, le bot, le site statique, PostgreSQL et Caddy.
PostgreSQL reste sur un réseau Docker interne et aucun port de base de données
ou de bot n'est publié. Redis n'est pas démarré : le code actuel ne l'utilise
pas. Caddy obtient et renouvelle automatiquement le certificat TLS.

## 1. Préparer le DNS et les ports

Dans Namecheap, ouvrez **Domain List → Manage → Advanced DNS** et ajoutez un
enregistrement **A Record** :

- Host : `nexus`
- Value : l'IPv4 publique de la VM
- TTL : `Automatic`

Le nom `nexus.momort02.com` doit résoudre vers cette VM avant le démarrage de
Caddy. N'ajoutez pas d'enregistrement AAAA tant qu'une IPv6 publique stable
n'est pas configurée et routée jusqu'à la VM. Si le domaine utilise d'autres
serveurs DNS que ceux de Namecheap, faites le changement dans le fournisseur DNS
effectif.

Dans le pare-feu du fournisseur VM et dans UFW, autorisez TCP 80 et 443.
Conservez également l'accès SSH (généralement TCP 22) avant d'activer UFW.
Le port 80 est nécessaire à la validation ACME et à la redirection vers HTTPS.
N'ouvrez pas les ports 3000, 3001, 5432 ou 6379 sur Internet.

## 2. Installer Docker Engine et Compose

Sur la VM Ubuntu, installez Docker Engine et le plugin Compose depuis le dépôt
officiel Docker :

```sh
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo docker run --rm hello-world
```

Utilisez `sudo docker compose` si l'utilisateur SSH n'a pas été ajouté au groupe
`docker`. L'accès au socket Docker équivaut à des privilèges root ; n'ajoutez
pas de comptes non fiables à ce groupe.

## 3. Récupérer le dépôt et configurer les secrets

Clonez la branche publiée et placez-vous à sa racine :

```sh
git clone https://github.com/momort02/Nexus.git
cd Nexus
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

Renseignez le token bot et les identifiants de l'application Discord. Les URL
doivent correspondre exactement à l'origine choisie :

```text
DOMAIN=nexus.momort02.com
APP_ORIGIN=https://nexus.momort02.com
DISCORD_REDIRECT_URI=https://nexus.momort02.com/api/v1/auth/discord/callback
```

Générez un secret distinct pour chacune des valeurs `POSTGRES_PASSWORD`,
`OAUTH_ENCRYPTION_KEY`, `BOT_API_SECRET` et `BOT_ANALYTICS_KEY` :

```sh
openssl rand -hex 32
```

Remplacez les valeurs d'exemple dans `.env.production` ; ne réutilisez pas une
même valeur pour plusieurs clés et ne copiez jamais ces secrets dans Git ou
dans un message. Le mot de passe PostgreSQL doit rester composé de caractères
hexadécimaux afin de pouvoir être utilisé sans ambiguïté dans `DATABASE_URL`.

Dans le portail développeur Discord, ajoutez exactement la valeur de
`DISCORD_REDIRECT_URI` dans **OAuth2 → Redirects**. Le bot doit être créé pour
la même application Discord que `DISCORD_CLIENT_ID`. Activez **Server Members
Intent** dans les intents privilégiés du bot. Aucun intent **Message Content**
n'est nécessaire.

Les pages `terms.html` et `privacy.html` contiennent encore des champs à
compléter. Remplacez-les et faites vérifier les textes avant de publier le
service et d'enregistrer leurs URL définitives dans Discord.

## 4. Démarrer Nexus

Depuis la racine du dépôt, après avoir confirmé que le DNS pointe déjà vers la
VM et que les ports sont joignables :

```sh
sudo docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  up -d --build
```

Le service `migrate` applique les migrations Prisma avant le démarrage de l'API.
La base persiste dans le volume Docker `postgres-data`. Caddy stocke ses données
et certificats dans `caddy-data` et `caddy-config`.

Vérifiez l'état et les journaux :

```sh
sudo docker compose --env-file .env.production -f docker-compose.prod.yml ps
sudo docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100
curl -I https://nexus.momort02.com/
curl -I https://nexus.momort02.com/dashboard/
curl https://nexus.momort02.com/health
```

L'émission du premier certificat peut prendre quelques instants. En cas d'échec,
vérifiez d'abord le DNS, le pare-feu fournisseur, UFW et les journaux du service
Caddy.

## 5. Après le premier déploiement

1. Vérifiez que la connexion Discord revient sur
   `https://nexus.momort02.com/dashboard/`.
2. Dans les paramètres de l'application Discord, renseignez les URL de
   Conditions d'utilisation et de Politique de confidentialité avec les pages
   HTTPS publiées, une fois leur contenu complété.
3. Invitez le bot depuis l'accueil, créez l'espace Nexus depuis le dashboard,
   puis lancez `/nexus-sync` pour synchroniser les membres déjà présents.
4. Configurez et testez une sauvegarde PostgreSQL hors de la VM. Exemple de
   dump manuel (le fichier obtenu contient des données privées ; protégez-le et
   stockez une copie chiffrée hors machine) :

   ```sh
   sudo docker compose --env-file .env.production \
     -f docker-compose.prod.yml exec -T postgres \
     sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > nexus-backup.sql
   chmod 600 nexus-backup.sql
   ```

## Mises à jour

Avant une mise à jour, créez et vérifiez une sauvegarde. Puis :

```sh
git pull --ff-only
sudo docker compose --env-file .env.production \
  -f docker-compose.prod.yml up -d --build
sudo docker compose --env-file .env.production \
  -f docker-compose.prod.yml ps
```

Les migrations déployées sont conçues pour appliquer les changements vers
l'avant ; une restauration de sauvegarde peut être nécessaire pour revenir
après une migration incompatible. N'exécutez pas `docker compose down -v` :
cette commande supprimerait les volumes persistants, dont la base.
