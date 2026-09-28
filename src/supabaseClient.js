import { createClient } from "@supabase/supabase-js";

// URL et clé ANON (publiques — sûres côté navigateur).
// Remplace COLLE_TA_CLE_ANON_ICI par ta clé anon/Publishable (la même que l'app IIB-Pilot).
const url = import.meta.env.VITE_SUPABASE_URL || "https://afxywediryofkijvdsus.supabase.co";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_zsz6eW1NfppRgbgwMVcKWA_AKC1Mx5Z";

export const supabase = createClient(url, key);
