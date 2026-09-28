# IIB — Back-office (console plateforme)

App d'administration séparée, réservée aux super-admins (`platform_admins`).
Se connecte au MÊME projet Supabase que l'app cliente. Gère les organisations
et l'activation des modules (Rénovation / Location).

## Déploiement (Cloudflare Pages, repo séparé)
1. Crée un nouveau dépôt GitHub (ex. `iib-backoffice`) et pousse ce dossier.
2. Cloudflare Pages → Create project → connecte ce dépôt.
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Variables d'environnement (Settings → Environment variables) :
   - `VITE_SUPABASE_URL`      = https://afxywediryofkijvdsus.supabase.co
   - `VITE_SUPABASE_ANON_KEY` = (même clé anon que l'app cliente)
4. Déploie. Tu obtiens une URL dédiée, ex. `iib-backoffice.pages.dev`.

## Prérequis base de données
Le script `supabase/multitenant.sql` (de l'app cliente) doit être exécuté :
il crée `organizations`, `memberships`, `platform_admins`, la colonne
`modules`, la vue `org_overview`, et les policies RLS.

Déclare-toi super-admin :
```sql
insert into public.platform_admins (user_id)
  select id from auth.users where email = 'TON.EMAIL@exemple.com'
  on conflict do nothing;
```

## Sécurité
Même si quelqu'un ouvre l'URL, il ne voit rien sans être dans `platform_admins`
(RLS + garde `is_platform_admin()`). L'app affiche « Accès réservé » sinon.
