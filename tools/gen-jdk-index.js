// tools/gen-jdk-index.js
// Generates data/jdk-members.json — the member table behind typed completion.
//
// The table comes from the running JDK's own `javap`, so signatures are exact
// and nothing is hand-maintained. The output is committed, which means building,
// testing and running the extension never needs a JDK installed.
//
// Every member carries a `since` version (Java 8 unless listed below) so the
// runtime can hide members that do not exist on the user's target JDK. The
// overrides below are the known post-8 API additions in the curated class list;
// `npm run gen:jdk-index` prints a report so a new JDK's additions can be
// reviewed instead of silently leaking into Java 8 suggestions.
//
// Usage: npm run gen:jdk-index [-- --jdk <path to javap>]

const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const { repositoryRoot } = require('./repo-root');

// ── Curated class list ────────────────────────────────────────────────────────
// Deliberately limited to types that can actually be the type of a report
// field, parameter or variable. Static utility classes (Math, Arrays, …) are
// covered by the static tables in completionProvider.js instead.

const CLASSES = [
    // java.lang
    'java.lang.Object',
    'java.lang.String',
    'java.lang.CharSequence',
    'java.lang.Number',
    'java.lang.Integer',
    'java.lang.Long',
    'java.lang.Double',
    'java.lang.Float',
    'java.lang.Short',
    'java.lang.Byte',
    'java.lang.Boolean',
    'java.lang.Character',
    'java.lang.Enum',
    'java.lang.Iterable',
    'java.lang.Comparable',
    'java.lang.StringBuilder',
    'java.lang.ClassLoader',
    // java.math
    'java.math.BigDecimal',
    'java.math.BigInteger',
    // java.util
    'java.util.Date',
    'java.util.Calendar',
    'java.util.Collection',
    'java.util.List',
    'java.util.ArrayList',
    'java.util.Set',
    'java.util.HashSet',
    'java.util.Map',
    'java.util.HashMap',
    'java.util.TreeMap',
    'java.util.Iterator',
    'java.util.Locale',
    'java.util.TimeZone',
    'java.util.UUID',
    'java.util.Optional',
    'java.util.stream.Stream',
    // java.time
    'java.time.LocalDate',
    'java.time.LocalDateTime',
    'java.time.LocalTime',
    'java.time.Instant',
    'java.time.Duration',
    'java.time.Period',
    'java.time.ZonedDateTime',
    'java.time.format.DateTimeFormatter',
    // java.sql (report parameters are often JDBC values)
    'java.sql.Date',
    'java.sql.Time',
    'java.sql.Timestamp',
    'java.sql.Connection',
    'java.sql.Statement',
    'java.sql.PreparedStatement',
    'java.sql.ResultSet',
    // java.net (built-in parameter types)
    'java.net.URLStreamHandlerFactory',
    'java.net.URLStreamHandler',
    // java.text
    'java.text.SimpleDateFormat',
    'java.text.DecimalFormat',
    'java.text.NumberFormat',
    'java.text.DateFormat',
];

// Members whose `since` is not Java 8. Keys are `<fqn>#<member>` (all overloads),
// `<fqn>#<member>/<arity>` (one overload by arity) or
// `<fqn>#<member>|<param,param>` (one overload by parameter types) — the last
// form is the only safe one when an old overload shares a name and arity with a
// newer one, as `toArray(T[])` / `toArray(IntFunction)` does.
const SINCE_OVERRIDES = Object.assign(Object.create(null), {
    // java.lang.String / CharSequence
    'java.lang.String#isBlank': 11,
    'java.lang.String#lines': 11,
    'java.lang.String#repeat': 11,
    'java.lang.String#strip': 11,
    'java.lang.String#stripLeading': 11,
    'java.lang.String#stripTrailing': 11,
    'java.lang.String#indent': 12,
    'java.lang.String#transform': 12,
    'java.lang.String#translateEscapes': 15,
    'java.lang.String#formatted': 15,
    'java.lang.CharSequence#compare': 11,
    'java.lang.CharSequence#isEmpty': 15,
    // New in the JDK this table was generated from; hidden from every older
    // baseline. Regenerating with a newer JDK: review the git diff for members
    // this table does not know about yet.
    'java.lang.CharSequence#getChars': 27,
    'java.lang.StringBuilder#compareTo': 11,
    'java.lang.StringBuilder#isEmpty': 15,
    'java.lang.StringBuilder#repeat': 21,
    // java.lang wrappers
    'java.lang.Integer#compress': 19,
    'java.lang.Integer#expand': 19,
    'java.lang.Long#compress': 19,
    'java.lang.Long#expand': 19,
    'java.lang.ClassLoader#resources': 9,
    // java.util
    'java.util.List#of': 9,
    'java.util.List#copyOf': 10,
    'java.util.List#getFirst': 21,
    'java.util.List#getLast': 21,
    'java.util.List#reversed': 21,
    'java.util.Set#of': 9,
    'java.util.Set#copyOf': 10,
    'java.util.Map#of': 9,
    'java.util.Map#ofEntries': 9,
    'java.util.Map#entry': 9,
    'java.util.Map#copyOf': 10,
    'java.util.HashMap#newHashMap': 19,
    'java.util.Optional#or': 9,
    'java.util.Optional#stream': 9,
    'java.util.Optional#ifPresentOrElse': 9,
    'java.util.Optional#orElseThrow/0': 10,
    'java.util.Optional#isEmpty': 11,
    'java.util.stream.Stream#takeWhile': 9,
    'java.util.stream.Stream#dropWhile': 9,
    'java.util.stream.Stream#ofNullable': 9,
    'java.util.stream.Stream#iterate/3': 9,
    'java.util.stream.Stream#toList': 16,
    'java.util.stream.Stream#mapMulti': 16,
    'java.util.stream.Stream#mapMultiToInt': 16,
    'java.util.stream.Stream#mapMultiToLong': 16,
    'java.util.stream.Stream#mapMultiToDouble': 16,
    'java.util.stream.Stream#gather': 24,
    'java.util.Locale#of': 19,
    // java.time
    'java.time.LocalDate#datesUntil': 9,
    'java.time.LocalDate#toEpochSecond': 9,
    'java.time.LocalDateTime#toEpochSecond': 9,
    'java.time.Duration#toDaysPart': 9,
    'java.time.Duration#toHoursPart': 9,
    'java.time.Duration#toMinutesPart': 9,
    'java.time.Duration#toSecondsPart': 9,
    'java.time.Duration#toMillisPart': 9,
    'java.time.Duration#toNanosPart': 9,
    'java.time.format.DateTimeFormatter#localizedBy': 10,
    // java.sql — JDBC 4.3 additions (Java 9)
    'java.sql.Connection#beginRequest': 9,
    'java.sql.Connection#endRequest': 9,
    'java.sql.Connection#setShardingKey': 9,
    'java.sql.Connection#setShardingKeyIfValid': 9,
    'java.sql.Connection#enquoteLiteral': 9,
    'java.sql.Connection#enquoteIdentifier': 9,
    'java.sql.Connection#enquoteNCharLiteral': 9,
    'java.sql.Connection#isSimpleIdentifier': 9,
    'java.sql.Statement#enquoteLiteral': 9,
    'java.sql.Statement#enquoteIdentifier': 9,
    'java.sql.Statement#enquoteNCharLiteral': 9,
    'java.sql.Statement#isSimpleIdentifier': 9,
    // java.text
    'java.text.NumberFormat#getCompactNumberInstance': 12,
    'java.text.NumberFormat#of': 12,
});

// Members whose name alone dates them: the constant-descriptor pair only exists
// on classes that implement Constable/ConstantDesc (Java 12+). Null-prototype so
// a member named `toString` or `constructor` cannot resolve to Object.prototype.
const SINCE_BY_NAME = Object.assign(Object.create(null), {
    describeConstable: 12,
    resolveConstantDesc: 12,
});

// Overloads that share a name and arity with an older method, so only the exact
// parameter types can identify them.
const SINCE_BY_SIGNATURE = Object.assign(Object.create(null), {
    'java.util.Collection#toArray|java.util.function.IntFunction': 11,
    'java.util.List#toArray|java.util.function.IntFunction': 11,
    'java.util.Set#toArray|java.util.function.IntFunction': 11,
});

// java.util.SequencedCollection / SequencedMap (Java 21) members. Every subtype
// — List, ArrayList, TreeMap, … — redeclares these, so the rule is applied by
// inheritance rather than by listing each class here.
const SEQUENCED_OWNERS = ['java.util.SequencedCollection', 'java.util.SequencedMap'];
const SEQUENCED_MEMBERS = new Set([
    'addFirst', 'addLast', 'getFirst', 'getLast', 'removeFirst', 'removeLast',
    'reversed', 'putFirst', 'putLast', 'sequencedKeySet', 'sequencedValues',
    'sequencedEntrySet',
]);
const SEQUENCED_SINCE = 21;

// `javap -public` prints no deprecation attribute (and has no `-deprecated`
// option anymore), so the members that matter in report expressions are listed
// here. Anything missing is a documentation gap, never a wrong signature.
const DEPRECATED = new Set([
    'java.util.Date#getYear', 'java.util.Date#setYear', 'java.util.Date#getMonth',
    'java.util.Date#setMonth', 'java.util.Date#getDay', 'java.util.Date#getHours',
    'java.util.Date#setHours', 'java.util.Date#getMinutes', 'java.util.Date#setMinutes',
    'java.util.Date#getSeconds', 'java.util.Date#setSeconds', 'java.util.Date#getTimezoneOffset',
    'java.util.Date#toGMTString', 'java.util.Date#toLocaleString',
    'java.util.Date#parse', 'java.util.Date#UTC',
    'java.sql.Date#getHours', 'java.sql.Date#getMinutes', 'java.sql.Date#getSeconds',
    'java.sql.Date#setHours', 'java.sql.Date#setMinutes', 'java.sql.Date#setSeconds',
    'java.sql.Time#getDate', 'java.sql.Time#getDay', 'java.sql.Time#getMonth',
    'java.sql.Time#getYear', 'java.sql.Time#setDate', 'java.sql.Time#setMonth',
    'java.sql.Time#setYear',
    'java.sql.Timestamp#getDate', 'java.sql.Timestamp#getDay', 'java.sql.Timestamp#getMonth',
    'java.sql.Timestamp#getYear', 'java.sql.Timestamp#setDate', 'java.sql.Timestamp#setMonth',
    'java.sql.Timestamp#setYear',
    'java.lang.Character#isJavaLetter', 'java.lang.Character#isJavaLetterOrDigit',
    'java.lang.Character#isSpace',
]);

const BASELINE = 8;
const MODIFIERS = new Set([
    'public', 'protected', 'private', 'static', 'final', 'abstract', 'default',
    'synchronized', 'native', 'strictfp', 'transient', 'volatile', 'sealed',
    'non-sealed',
]);

// ── javap output parsing ──────────────────────────────────────────────────────

/** Split on `sep` at angle/paren/bracket depth 0 (generic arguments contain commas). */
function splitTopLevel(text, sep) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
        if (ch === '<' || ch === '(' || ch === '[') depth++;
        else if (ch === '>' || ch === ')' || ch === ']') depth--;
        if (ch === sep && depth === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts.map(p => p.trim()).filter(Boolean);
}

/** Remove every `<...>` group: `java.util.List<java.lang.String>` → `java.util.List`. */
function stripGenerics(text) {
    let out = '';
    let depth = 0;
    for (const ch of text) {
        if (ch === '<') depth++;
        else if (ch === '>') depth = Math.max(0, depth - 1);
        else if (depth === 0) out += ch;
    }
    return out.trim();
}

/** Drop a leading generic method header: `<T> T requireNonNull(T)` → `T requireNonNull(T)`. */
function stripMethodTypeParams(text) {
    if (!text.startsWith('<')) return text;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '<') depth++;
        else if (text[i] === '>') {
            depth--;
            if (depth === 0) return text.slice(i + 1).trim();
        }
    }
    return text;
}

/** Normalise a javap type into a lookup key, or null when it cannot be resolved. */
function typeKey(raw) {
    if (!raw) return null;
    let text = raw.trim().replace(/\.\.\.$/, '[]');
    text = stripGenerics(text);
    if (text === '?' || /^[A-Z](\[\])*$/.test(text)) return null; // type variable
    return text || null;
}

/** `java.util.List<java.lang.String>` → `java.util.List`, keeping the raw form for display. */
function memberType(raw) {
    const key = typeKey(raw);
    return { key, raw: raw.trim(), text: stripGenerics(raw).replace(/\.\.\.$/, '[]') };
}

/** Parse one javap body line into a method, a field, or null. */
function parseMember(line, simpleClassName) {
    const text = line.trim().replace(/;$/, '');
    if (!text || text === '}' || text === '{') return null;

    let rest = text;
    const modifiers = [];
    for (;;) {
        const match = /^([A-Za-z-]+)\s+/.exec(rest);
        if (!match || !MODIFIERS.has(match[1])) break;
        modifiers.push(match[1]);
        rest = rest.slice(match[0].length);
    }
    rest = stripMethodTypeParams(rest);

    const parenIndex = firstTopLevelParen(rest);
    if (parenIndex === -1) {
        // Field: `<type> <name>`
        const nameMatch = /([A-Za-z_$][\w$]*)$/.exec(rest);
        if (!nameMatch) return null;
        const name = nameMatch[1];
        const type = memberType(rest.slice(0, nameMatch.index));
        return { kind: 'field', name, type, modifiers };
    }

    const declaration = rest.slice(0, parenIndex);
    const nameMatch = /([A-Za-z_$][\w$]*)$/.exec(declaration);
    if (!nameMatch) return null;
    const name = nameMatch[1];
    if (name === simpleClassName) return null; // constructor — not offered as a member

    const returns = memberType(declaration.slice(0, nameMatch.index));

    const closeIndex = matchingParen(rest, parenIndex);
    if (closeIndex === -1) return null;
    const params = splitTopLevel(rest.slice(parenIndex + 1, closeIndex), ',').map(memberType);

    return { kind: 'method', name, returns, params, modifiers };
}

/** Index of the first `(` outside generic arguments, or -1. */
function firstTopLevelParen(text) {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '<') depth++;
        else if (ch === '>') depth = Math.max(0, depth - 1);
        else if (ch === '(' && depth === 0) return i;
    }
    return -1;
}

/** Index of the `)` matching the `(` at `open`, or -1. */
function matchingParen(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Parse the `public final class a.b.C<T> extends X implements Y, Z {` header. */
function parseHeader(line) {
    // Flatten generic arguments first: a type-parameter bound
    // (`BaseStream<T, S extends BaseStream<T, S>>`) contains the word `extends`
    // and would otherwise be mistaken for the supertype clause.
    const flat = stripGenerics(line.replace(/\{\s*$/, ''));

    const nameMatch = /\b(?:class|interface|enum)\s+([\w.$]+)/.exec(flat);
    if (!nameMatch) return null;
    const fqn = nameMatch[1];
    const simpleClassName = fqn.split('.').pop();

    const supertypes = [];
    for (const keyword of ['extends', 'implements']) {
        const match = new RegExp(`\\b${keyword}\\s+(.+?)(?=\\bimplements\\b|$)`).exec(flat);
        if (!match) continue;
        for (const part of splitTopLevel(match[1], ',')) {
            const key = typeKey(part);
            if (key) supertypes.push(key);
        }
    }

    const kind = /\binterface\b/.test(flat) ? 'interface'
        : supertypes.includes('java.lang.Enum') ? 'enum'
        : 'class';

    return { fqn, simpleClassName, supertypes, kind };
}

const javapCache = new Map();

/** javap output for one class, memoised so edges and members share a call. */
function javapOutput(fqn, javapBin) {
    if (!javapCache.has(fqn)) {
        javapCache.set(fqn, execFileSync(javapBin, ['-public', fqn], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        }));
    }
    return javapCache.get(fqn);
}

const javapVerboseCache = new Map();

/** `javap -v -public` output for one class, memoised (used for member flags). */
function javapVerbose(fqn, javapBin) {
    if (!javapVerboseCache.has(fqn)) {
        javapVerboseCache.set(fqn, execFileSync(javapBin, ['-v', '-public', fqn], {
            encoding: 'utf8',
            maxBuffer: 128 * 1024 * 1024,
        }));
    }
    return javapVerboseCache.get(fqn);
}

/**
 * Declarations javap marks ACC_BRIDGE or ACC_SYNTHETIC. These are compiler
 * artefacts — the erased `compareTo(Object)` next to `compareTo(String)` — and
 * must never be suggested. Reading the real flags beats guessing from
 * signatures: `String.valueOf(Object)` looks like a bridge but is a method
 * users legitimately call.
 */
function bridgeDeclarations(verboseOutput) {
    const skipped = new Set();
    let pending = null;

    for (const line of verboseOutput.split(/\r?\n/)) {
        const declaration = /^ {2}(\S.*;)$/.exec(line);
        if (declaration) {
            pending = declaration[1].trim();
            continue;
        }
        const flags = /^ {4}flags: \((0x[0-9a-f]+)\)(.*)$/.exec(line);
        if (flags) {
            if (pending && (flags[2].includes('ACC_BRIDGE') || flags[2].includes('ACC_SYNTHETIC'))) {
                skipped.add(pending);
            }
            pending = null;
            continue;
        }
        if (/^ {2}\S/.test(line) || /^\S/.test(line)) pending = null;
    }

    return skipped;
}

/** The `class … extends A implements B` header line of a javap report, or null. */
function headerOf(fqn, javapBin) {
    const line = javapOutput(fqn, javapBin).split(/\r?\n/)
        .find(l => /\b(?:class|interface|enum)\s/.test(l) && l.includes('{'));
    return line ? parseHeader(line) : null;
}

/**
 * Supertype edges for every class reachable from the curated list — including
 * classes we do not index. `java.util.List` extends `SequencedCollection` on
 * JDK 21 and `ArrayList` extends `AbstractList`; without these edges the
 * inherited-member walk would stop before reaching `Collection`.
 */
function collectSuperEdges(rootClasses, javapBin) {
    const edges = Object.create(null);
    const failures = [];
    const queue = [...rootClasses];

    while (queue.length) {
        const fqn = queue.shift();
        if (edges[fqn]) continue;
        try {
            const header = headerOf(fqn, javapBin);
            if (!header) throw new Error('no type header');
            // javap omits `extends java.lang.Object` for direct subclasses, but
            // every reference type really does have Object's members — including
            // interfaces, where toString/getClass/wait are all callable.
            edges[fqn] = header.supertypes.includes('java.lang.Object') || fqn === 'java.lang.Object'
                ? header.supertypes
                : [...header.supertypes, 'java.lang.Object'];
        } catch (err) {
            edges[fqn] = [];
            failures.push(`${fqn}: ${err.message.split('\n')[0]}`);
        }
        for (const parent of edges[fqn]) {
            if (!edges[parent]) queue.push(parent);
        }
    }
    return { edges, failures };
}

/** Run javap and turn its output into a raw entry (bridges still included). */
function extractType(fqn, javapBin) {
    const output = javapOutput(fqn, javapBin);

    const lines = output.split(/\r?\n/);
    const headerLine = lines.find(line => /\b(?:class|interface|enum)\s/.test(line) && line.includes('{'));
    if (!headerLine) throw new Error(`no type header in javap output for ${fqn}`);
    const header = parseHeader(headerLine);

    const synthetic = bridgeDeclarations(javapVerbose(fqn, javapBin));

    const methods = [];
    const fields = [];

    for (const line of lines) {
        if (!line.trim().endsWith(';')) continue;
        const member = parseMember(line, header.simpleClassName);
        if (!member) continue;
        const isBridge = synthetic.has(line.trim());

        if (member.kind === 'field') {
            // Synthetic fields ($assertionsDisabled, this$0) are not report API.
            if (isBridge) continue;
            fields.push({
                name: member.name,
                type: member.type.text,
                static: member.modifiers.includes('static'),
            });
            continue;
        }

        const params = member.params.map(p => p.text);
        methods.push({
            name: member.name,
            params,
            returns: member.returns.text,
            static: member.modifiers.includes('static'),
            // `...` is lost when the parameter type is normalised to `[]`;
            // keep it so overload resolution can accept a variable argument count.
            varargs: member.params.length > 0 && /\.\.\.$/.test(member.params[member.params.length - 1].raw),
            // Kept for now: some bridges are the only public declaration of a
            // callable method (StringBuilder.charAt), so removal is decided
            // later, against the members the user can actually reach.
            bridge: isBridge,
        });
    }

    return { kind: header.kind, methods, fields };
}

const PRIMITIVES = new Set(['boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double', 'void']);

function isReferenceType(type) {
    return !!type && !PRIMITIVES.has(type);
}

/**
 * True when `bridge` only re-exposes `other`: same name and arity, with the
 * bridge's `java.lang.Object` parameters standing in for `other`'s concrete
 * ones (the erased form the compiler generates for generics and covariant
 * returns).
 */
function isRedundantBridge(bridge, other) {
    if (!bridge.bridge || other.bridge) return false;
    if (bridge.name !== other.name) return false;
    if (bridge.params.length !== other.params.length) return false;

    for (let i = 0; i < bridge.params.length; i++) {
        const a = bridge.params[i];
        const b = other.params[i];
        if (a === b) continue;
        if (a === 'java.lang.Object' && isReferenceType(b)) continue;
        return false;
    }
    return true;
}

/** Collapse identical signatures, preferring the declared member over a bridge. */
function normalizeMethods(methods) {
    const bySignature = new Map();
    for (const member of methods) {
        const key = `${member.name}(${member.params.join(',')})`;
        const existing = bySignature.get(key);
        if (!existing) {
            bySignature.set(key, member);
            continue;
        }
        const existingWins =
            (existing.bridge && !member.bridge)
            || (existing.returns === 'java.lang.Object' && member.returns !== 'java.lang.Object');
        if (existingWins) bySignature.set(key, member);
    }
    return [...bySignature.values()];
}

/**
 * Turn raw extractions into the shipped table: drop bridges that duplicate a
 * member reachable from the type itself or from an indexed supertype, then
 * attach `since`/`deprecated` and sort.
 */
function finalizeTypes(raw, edges) {
    const ancestors = new Map();
    const types = {};

    const inheritedMethods = (fqn) => {
        const out = [];
        for (const ancestor of ancestorSet(fqn, edges, ancestors)) {
            if (!raw[ancestor]) continue;
            for (const m of raw[ancestor].methods) if (!m.bridge) out.push(m);
        }
        return out;
    };

    for (const [fqn, type] of Object.entries(raw)) {
        const reachable = [...type.methods.filter(m => !m.bridge), ...inheritedMethods(fqn)];
        const keptMethods = normalizeMethods(
            type.methods.filter(m => !reachable.some(other => isRedundantBridge(m, other)))
        ).map(({ bridge: _bridge, ...member }) => member);

        const supers = ancestorSet(fqn, edges, ancestors);
        const options = { sequenced: SEQUENCED_OWNERS.some(owner => supers.has(owner)) };

        for (const member of keptMethods) {
            member.since = sinceFor(fqn, member, options);
            if (DEPRECATED.has(`${fqn}#${member.name}`)) member.deprecated = true;
        }
        for (const field of type.fields) {
            field.since = sinceFor(fqn, { name: field.name }, options);
            if (DEPRECATED.has(`${fqn}#${field.name}`)) field.deprecated = true;
        }

        types[fqn] = {
            kind: type.kind,
            methods: keptMethods.sort(byNameThenArity),
            fields: type.fields.sort((a, b) => a.name.localeCompare(b.name)),
        };
    }
    return types;
}

function byNameThenArity(a, b) {
    return a.name.localeCompare(b.name)
        || a.params.length - b.params.length
        || a.params.join(',').localeCompare(b.params.join(','));
}

function sinceFor(fqn, member, options = {}) {
    if (options.sequenced && SEQUENCED_MEMBERS.has(member.name)) return SEQUENCED_SINCE;

    const arity = member.params ? member.params.length : undefined;
    if (arity !== undefined) {
        const bySignature = SINCE_BY_SIGNATURE[`${fqn}#${member.name}|${member.params.join(',')}`];
        if (bySignature !== undefined) return bySignature;

        const byArity = SINCE_OVERRIDES[`${fqn}#${member.name}/${arity}`];
        if (byArity !== undefined) return byArity;
    }
    const byName = SINCE_OVERRIDES[`${fqn}#${member.name}`];
    if (byName !== undefined) return byName;
    return SINCE_BY_NAME[member.name] ?? BASELINE;
}

/** Every transitive supertype of `fqn`, from the generator's edge map. */
function ancestorSet(fqn, edges, memo = new Map()) {
    if (memo.has(fqn)) return memo.get(fqn);
    const result = new Set();
    memo.set(fqn, result); // cycle guard for `Enum<E extends Enum<E>>`-style graphs
    for (const parent of edges[fqn] || []) {
        result.add(parent);
        for (const ancestor of ancestorSet(parent, edges, memo)) result.add(ancestor);
    }
    return result;
}

// ── Entry point ───────────────────────────────────────────────────────────────

function main() {
    const argv = process.argv.slice(2);
    const jdkIndex = argv.indexOf('--jdk');
    const javapBin = jdkIndex === -1 ? 'javap' : argv[jdkIndex + 1];

    const version = execFileSync(javapBin, ['-version'], { encoding: 'utf8' }).trim();

    // Edges first: `since` tagging needs to know whether a type inherits from a
    // SequencedCollection/SequencedMap.
    const { edges, failures: edgeFailures } = collectSuperEdges(CLASSES, javapBin);
    const failures = [...edgeFailures];

    const raw = {};
    for (const fqn of CLASSES) {
        try {
            raw[fqn] = extractType(fqn, javapBin);
        } catch (err) {
            failures.push(`${fqn}: ${err.message.split('\n')[0]}`);
        }
    }

    const types = finalizeTypes(raw, edges);

    // Report anything newer than the baseline so the override table above can
    // be reviewed instead of drifting silently.
    const newerThanBaseline = [];
    for (const [fqn, type] of Object.entries(types)) {
        for (const member of [...type.methods, ...type.fields]) {
            if (member.since <= BASELINE) continue;
            const arity = member.params ? `/${member.params.length}` : '';
            newerThanBaseline.push(`${fqn}#${member.name}${arity} → ${member.since}`);
        }
    }

    const index = {
        schemaVersion: 1,
        generator: 'tools/gen-jdk-index.js',
        generatedWith: version,
        baseline: BASELINE,
        note: 'Generated from javap. `since` is the Java version that introduced the member; the runtime hides members newer than jrxml.typeCompletion.jdkBaseline. `edges` carries supertype links for unindexed classes so inherited members can still be walked.',
        edges,
        types,
    };

    const outFile = path.join(repositoryRoot(), 'data', 'jdk-members.json');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(index, null, 1) + '\n');

    const memberCount = Object.values(types).reduce((n, t) => n + t.methods.length + t.fields.length, 0);
    console.log(`${Object.keys(types).length} types, ${memberCount} members → ${path.relative(process.cwd(), outFile)}`);
    console.log(`javap: ${version}`);
    if (newerThanBaseline.length) {
        console.log(`\n${newerThanBaseline.length} members newer than Java ${BASELINE} (tagged, hidden by default):`);
        for (const entry of newerThanBaseline) console.log(`  ${entry}`);
    }
    if (failures.length) {
        console.error(`\n${failures.length} classes failed:`);
        for (const failure of failures) console.error(`  ${failure}`);
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = {
    ancestorSet,
    bridgeDeclarations,
    splitTopLevel,
    stripGenerics,
    typeKey,
    parseMember,
    parseHeader,
    normalizeMethods,
    isRedundantBridge,
    finalizeTypes,
    sinceFor,
    SINCE_OVERRIDES,
    CLASSES,
};
