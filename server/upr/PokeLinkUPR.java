// Pont entre PokéLink et l'Universal Pokémon Randomizer ZX (GPL-3.0, https://github.com/Ajarmar/universal-pokemon-randomizer-zx).
// Ce fichier est sous la même licence (GPL-3.0). Aucun réglage n'est réinventé : on pilote la classe Settings d'UPR.
//
//   java -cp upr.jar PokeLinkUPR info <rom> [résultat.json]
//       → JSON : jeu, génération, possibilités du jeu, réglages par défaut, liste des Pokémon.
//   java -cp upr.jar PokeLinkUPR randomize <rom> <sortie> <réglages.txt> <graine> [résultat.json]
//       → écrit la ROM modifiée et <sortie>.log ; JSON : succès, graine, chaîne de réglages UPR.
// Le JSON sort sur la sortie standard, et aussi dans [résultat.json] si donné (navigateur : CheerpJ, Java 8).
//
// Fichier de réglages : une ligne « clé=valeur » par réglage, appliquée dans l'ordre :
//   settingsString=<chaîne UPR>   (optionnel, comme « Premade seed » dans UPR)
//   wildPokemonMod=RANDOM          (énumérations : nom de la valeur)
//   trainersLevelModified=true     (booléens) · trainersLevelModifier=50 (entiers) · customStarters=390,393,387
//   miscTweaks=128,524288          (bits des réglages divers, voir « info »)
import com.dabomstew.pkrandom.*;
import com.dabomstew.pkrandom.pokemon.ExpCurve;
import com.dabomstew.pkrandom.pokemon.Pokemon;
import com.dabomstew.pkrandom.romhandlers.*;

import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class PokeLinkUPR {
    static final RomHandler.Factory[] FACTORIES = {
        new Gen1RomHandler.Factory(), new Gen2RomHandler.Factory(), new Gen3RomHandler.Factory(),
        new Gen4RomHandler.Factory(), new Gen5RomHandler.Factory()
    };
    static final ResourceBundle BUNDLE = ResourceBundle.getBundle("com/dabomstew/pkrandom/newgui/Bundle");

    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        System.setOut(new PrintStream(new OutputStream() { public void write(int b) {} }));   // UPR écrit parfois sur stdout : seul notre JSON sort
        String json, file = null;
        int code = 0;
        try {
            if (args.length >= 2 && args[0].equals("info")) { json = info(args[1]); if (args.length >= 3) file = args[2]; }
            else if (args.length >= 5 && args[0].equals("randomize")) { json = randomize(args[1], args[2], args[3], Long.parseLong(args[4])); if (args.length >= 6) file = args[5]; }
            else { json = "{\"ok\":false,\"error\":\"usage\"}"; code = 2; }
        } catch (Throwable e) {
            json = "{\"ok\":false,\"error\":" + q(e.getClass().getSimpleName() + ": " + e.getMessage()) + "}";
            code = 1;
            if (args.length >= 3 && args[0].equals("info")) file = args[2];
            if (args.length >= 6 && args[0].equals("randomize")) file = args[5];
        }
        out.println(json);
        if (file != null) Files.write(Paths.get(file), json.getBytes(StandardCharsets.UTF_8));
        if (code != 0) System.exit(code);
    }

    static RomHandler load(String rom) throws Exception {
        String abs = new File(rom).getAbsolutePath();
        for (RomHandler.Factory f : FACTORIES) {
            if (f.isLoadable(abs)) {
                RomHandler h = f.create(RandomSource.instance());
                if (!h.loadRom(abs)) throw new IOException("ROM illisible");
                return h;
            }
        }
        throw new IOException("Jeu non reconnu (Gen 1 à 5 attendues)");
    }

    static String info(String rom) throws Exception {
        RomHandler h = load(rom);
        Settings s = fresh();
        s.tweakForRom(h);
        StringBuilder b = new StringBuilder("{\"ok\":true");
        b.append(",\"name\":").append(q(h.getROMName())).append(",\"code\":").append(q(h.getROMCode()))
         .append(",\"gen\":").append(h.generationOfPokemon()).append(",\"support\":").append(q(h.getSupportLevel()))
         .append(",\"ext\":").append(q(h.getDefaultExtension())).append(",\"valid\":").append(h.isRomValid())
         .append(",\"version\":").append(q(Version.VERSION_STRING));
        b.append(",\"caps\":{");
        String[] caps = { "hasStarterAltFormes", "starterCount", "supportsStarterHeldItems", "abilitiesPerPokemon", "hasTimeBasedEncounters",
            "hasWildAltFormes", "hasRivalFinalBattle", "hasPhysicalSpecialSplit", "supportsFourStartingMoves", "canChangeStaticPokemon",
            "hasStaticAltFormes", "hasMainGameLegendaries", "hasStaticMusicFix", "getTMCount", "getHMCount", "hasMoveTutors",
            "canChangeTrainerText", "hasShopRandomization", "hasDVs", "isYellow", "miscTweaksAvailable", "hasFunctionalFormes" };
        for (int i = 0; i < caps.length; i++) {
            Object v;
            try { v = RomHandler.class.getMethod(caps[i]).invoke(h); } catch (Exception e) { v = null; }
            b.append(i > 0 ? "," : "").append(q(caps[i])).append(":").append(v == null ? "null" : v.toString());
        }
        b.append("},\"tweaks\":[");
        boolean first = true;
        for (MiscTweak t : MiscTweak.allTweaks) {
            if ((h.miscTweaksAvailable() & t.getValue()) == 0) continue;
            b.append(first ? "" : ",").append("{\"bit\":").append(t.getValue()).append(",\"name\":").append(q(t.getTweakName())).append("}");
            first = false;
        }
        b.append("],\"defaults\":").append(dump(s));
        b.append(",\"pokemon\":[");
        List<Pokemon> list = h.getPokemon();
        first = true;
        for (Pokemon p : list) {
            if (p == null) continue;
            b.append(first ? "" : ",").append("[").append(p.number).append(",").append(q(p.name)).append("]");
            first = false;
        }
        b.append("],\"enums\":").append(enums());
        return b.append("}").toString();
    }

    static String randomize(String rom, String outPath, String settingsFile, long seed) throws Exception {
        RomHandler h = load(rom);
        Settings s = fresh();
        List<String> warnings = new ArrayList<>();
        for (String line : Files.readAllLines(Paths.get(settingsFile), StandardCharsets.UTF_8)) {
            line = line.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            int eq = line.indexOf('=');
            if (eq < 0) continue;
            String k = line.substring(0, eq).trim(), v = line.substring(eq + 1).trim();
            try { apply(s, k, v); } catch (Exception e) { warnings.add(k + ": " + e.getMessage()); }
        }
        s.setCustomNames(FileFunctions.getCustomNames());
        s.setRomName(h.getROMName());
        Settings.TweakForROMFeedback fb = s.tweakForRom(h);
        if (fb.isChangedStarter()) warnings.add("starters: un starter choisi n'existe pas dans ce jeu, remplacé");
        if (fb.isRemovedCodeTweaks()) warnings.add("miscTweaks: certains réglages divers ne s'appliquent pas à ce jeu");

        ByteArrayOutputStream logBytes = new ByteArrayOutputStream();
        PrintStream log = new PrintStream(logBytes, false, "UTF-8");
        Randomizer r = new Randomizer(s, h, BUNDLE, false);
        int check = r.randomize(new File(outPath).getAbsolutePath(), log, seed);
        log.close();
        Files.write(Paths.get(outPath + ".log"), logBytes.toByteArray());
        StringBuilder b = new StringBuilder("{\"ok\":true,\"seed\":").append(seed)
            .append(",\"check\":").append(check)
            .append(",\"settingsString\":").append(q(Version.VERSION + s.toString()))
            .append(",\"game\":").append(q(h.getROMName())).append(",\"warnings\":[");
        for (int i = 0; i < warnings.size(); i++) b.append(i > 0 ? "," : "").append(q(warnings.get(i)));
        return b.append("]}").toString();
    }

    /** Réglages de départ identiques à ceux de l'interface d'UPR à l'ouverture. */
    static Settings fresh() {
        Settings s = new Settings();
        s.setSelectedEXPCurve(ExpCurve.MEDIUM_FAST);
        return s;
    }

    // ------------------------------------------------------------------ réglages par réflexion
    static void apply(Settings s, String key, String value) throws Exception {
        if (key.equals("settingsString")) {
            String str = value;
            int ver = Integer.parseInt(str.substring(0, 3));
            if (ver != Version.VERSION) str = new SettingsUpdater().update(ver, str.substring(3));
            else str = str.substring(3);
            Settings imported = Settings.fromString(str);
            for (Field f : Settings.class.getDeclaredFields()) {
                if (Modifier.isStatic(f.getModifiers())) continue;
                f.setAccessible(true);
                f.set(s, f.get(imported));
            }
            return;
        }
        if (key.equals("miscTweaks")) {
            int bits = 0;                                            // valeurs (bits) des réglages divers d'UPR, séparées par des virgules
            for (String id : value.split(",")) if (!id.trim().isEmpty()) bits |= Integer.parseInt(id.trim());
            s.setCurrentMiscTweaks(bits);
            return;
        }
        String name = "set" + Character.toUpperCase(key.charAt(0)) + key.substring(1);
        Method best = null;
        for (Method m : Settings.class.getDeclaredMethods()) {
            if (!m.getName().equals(name) || m.getParameterCount() != 1) continue;
            Class<?> t = m.getParameterTypes()[0];
            if (t == boolean[].class) continue;                      // forme « boolean... » : on préfère l'énumération
            best = m;
        }
        if (best == null) throw new IllegalArgumentException("réglage inconnu");
        best.setAccessible(true);
        Class<?> t = best.getParameterTypes()[0];
        Object arg;
        if (t == boolean.class) arg = Boolean.parseBoolean(value);
        else if (t == int.class) arg = Integer.parseInt(value);
        else if (t == String.class) arg = value;
        else if (t == int[].class) arg = Arrays.stream(value.split(",")).map(String::trim).filter(x -> !x.isEmpty()).mapToInt(Integer::parseInt).toArray();
        else if (t.isEnum()) arg = enumValue(t, value);
        else throw new IllegalArgumentException("type non géré " + t.getSimpleName());
        best.invoke(s, arg);
    }

    @SuppressWarnings({ "unchecked", "rawtypes" })
    static Object enumValue(Class<?> t, String v) { return Enum.valueOf((Class<? extends Enum>) t, v); }

    static String dump(Settings s) throws Exception {
        StringBuilder b = new StringBuilder("{");
        boolean first = true;
        for (Method m : Settings.class.getMethods()) {
            if (m.getParameterCount() != 0 || m.getDeclaringClass() != Settings.class) continue;
            String n = m.getName(), key;
            if (n.startsWith("get") && n.length() > 3) key = n.substring(3);
            else if (n.startsWith("is") && n.length() > 2) key = n.substring(2);
            else continue;
            key = Character.toLowerCase(key.charAt(0)) + key.substring(1);
            Class<?> r = m.getReturnType();
            String v;
            if (r == boolean.class || r == int.class) v = String.valueOf(m.invoke(s));
            else if (r.isEnum()) { Object e = m.invoke(s); v = e == null ? "null" : q(((Enum<?>) e).name()); }
            else if (r == int[].class) { int[] a = (int[]) m.invoke(s); v = a == null ? "null" : Arrays.toString(a); }
            else continue;
            b.append(first ? "" : ",").append(q(key)).append(":").append(v);
            first = false;
        }
        b.append(",\"miscTweaks\":").append(s.getCurrentMiscTweaks());
        return b.append("}").toString();
    }

    static String enums() {
        StringBuilder b = new StringBuilder("{");
        boolean first = true;
        for (Class<?> c : Settings.class.getDeclaredClasses()) {
            if (!c.isEnum()) continue;
            b.append(first ? "" : ",").append(q(c.getSimpleName())).append(":[");
            Object[] vals = c.getEnumConstants();
            for (int i = 0; i < vals.length; i++) b.append(i > 0 ? "," : "").append(q(((Enum<?>) vals[i]).name()));
            b.append("]");
            first = false;
        }
        b.append(",\"ExpCurve\":[");
        ExpCurve[] ec = ExpCurve.values();
        for (int i = 0; i < ec.length; i++) b.append(i > 0 ? "," : "").append(q(ec[i].name()));
        return b.append("]}").toString();
    }

    static String q(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }
}
