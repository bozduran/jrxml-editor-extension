// typeCompletion.js
// Turns a member list (jdkMemberIndex.getMembers) into completion candidates.
//
// Kept free of `vscode` on purpose: this is where the sorting rules, the
// snippet placeholders and the explanatory text live, so all of it is unit
// tested without an Extension Host. The provider only wraps the descriptors in
// CompletionItems.

/** Members worth ranking above the alphabetical default, per declaring type. */
const POPULAR = {
    'java.lang.String': ['length', 'substring', 'toUpperCase', 'toLowerCase', 'trim', 'indexOf', 'replace', 'startsWith', 'endsWith', 'contains', 'equals', 'equalsIgnoreCase', 'charAt', 'split', 'isEmpty', 'lastIndexOf', 'concat'],
    'java.lang.Integer': ['intValue', 'longValue', 'doubleValue', 'toString', 'compareTo', 'equals'],
    'java.lang.Long': ['longValue', 'intValue', 'doubleValue', 'toString', 'compareTo', 'equals'],
    'java.lang.Double': ['doubleValue', 'intValue', 'longValue', 'toString', 'compareTo', 'equals'],
    'java.lang.Float': ['floatValue', 'doubleValue', 'intValue', 'toString', 'compareTo'],
    'java.lang.Short': ['shortValue', 'intValue', 'toString', 'compareTo'],
    'java.lang.Byte': ['byteValue', 'intValue', 'toString', 'compareTo'],
    'java.lang.Boolean': ['booleanValue', 'toString', 'equals', 'compareTo'],
    'java.lang.Character': ['charValue', 'toString', 'equals', 'compareTo'],
    'java.math.BigDecimal': ['add', 'subtract', 'multiply', 'divide', 'compareTo', 'setScale', 'doubleValue', 'intValue', 'longValue', 'negate', 'abs', 'remainder', 'toPlainString'],
    'java.math.BigInteger': ['add', 'subtract', 'multiply', 'divide', 'compareTo', 'intValue', 'longValue', 'toString', 'mod', 'pow'],
    'java.util.Date': ['getTime', 'before', 'after', 'compareTo', 'toInstant', 'toString'],
    'java.sql.Date': ['toLocalDate', 'getTime', 'before', 'after', 'compareTo', 'toString'],
    'java.sql.Timestamp': ['toLocalDateTime', 'toInstant', 'getTime', 'before', 'after', 'compareTo', 'toString'],
    'java.time.LocalDate': ['format', 'plusDays', 'plusMonths', 'plusYears', 'minusDays', 'getYear', 'getMonthValue', 'getDayOfMonth', 'isBefore', 'isAfter', 'toString'],
    'java.time.LocalDateTime': ['format', 'plusDays', 'plusMonths', 'plusHours', 'minusDays', 'toLocalDate', 'toLocalTime', 'isBefore', 'isAfter', 'toString'],
    'java.time.Instant': ['toEpochMilli', 'atZone', 'plusSeconds', 'minusSeconds', 'isBefore', 'isAfter', 'toString'],
    'java.time.Duration': ['toDays', 'toHours', 'toMinutes', 'toMillis', 'getSeconds', 'plus', 'minus'],
    'java.time.format.DateTimeFormatter': ['format', 'parse', 'withZone', 'withLocale'],
    'java.util.Collection': ['size', 'isEmpty', 'contains', 'iterator', 'stream', 'toArray', 'forEach', 'add', 'remove', 'clear'],
    'java.util.List': ['size', 'isEmpty', 'get', 'contains', 'indexOf', 'stream', 'toArray', 'forEach', 'subList', 'sort', 'add', 'remove', 'clear', 'iterator'],
    'java.util.Set': ['size', 'isEmpty', 'contains', 'stream', 'forEach', 'toArray', 'add', 'remove', 'iterator'],
    'java.util.Map': ['get', 'containsKey', 'getOrDefault', 'keySet', 'values', 'entrySet', 'size', 'isEmpty', 'forEach', 'put', 'remove'],
    'java.util.Optional': ['get', 'isPresent', 'orElse', 'orElseGet', 'map', 'filter', 'ifPresent'],
    'java.util.Iterator': ['hasNext', 'next', 'remove', 'forEachRemaining'],
    'java.lang.StringBuilder': ['append', 'toString', 'length', 'charAt', 'insert', 'delete', 'reverse', 'setLength', 'indexOf', 'substring'],
    'java.lang.Enum': ['name', 'ordinal', 'toString', 'compareTo', 'equals'],
    'java.lang.Object': ['toString', 'equals', 'hashCode', 'getClass'],
    'net.sf.jasperreports.engine.JRDataSource': ['next', 'getFieldValue'],
    'net.sf.jasperreports.engine.JRRewindableDataSource': ['moveBeforeFirst', 'next', 'getFieldValue'],
};

const DEFAULT_RANK = 500;

/** Placeholder names for the snippet arguments, by parameter type. */
const PARAMETER_NAMES = {
    'int': 'n',
    'long': 'n',
    'short': 'n',
    'byte': 'n',
    'double': 'value',
    'float': 'value',
    'boolean': 'flag',
    'char': 'ch',
    'java.lang.String': 'str',
    'java.lang.CharSequence': 'text',
    'java.lang.Object': 'value',
    'java.lang.Number': 'value',
    'java.math.BigDecimal': 'value',
    'java.math.BigInteger': 'value',
    'java.util.Date': 'date',
    'java.util.Locale': 'locale',
    'java.util.Collection': 'values',
    'java.util.List': 'values',
    'java.util.Map': 'map',
    'java.util.Comparator': 'comparator',
    'java.util.function.Function': 'mapper',
    'java.util.function.Predicate': 'filter',
};

/** `java.lang.String` → `String`, `java.util.Map$Entry` → `Map.Entry`. */
function shortType(type) {
    const text = String(type ?? '').trim();
    if (!text) return '';
    if (text.endsWith('[]')) return `${shortType(text.slice(0, -2))}[]`;
    if (text === '?') return '?';
    // Generic arguments are dropped: they add noise to a completion label and
    // the index already erases them (`List`, not `List<String>`).
    const plain = text.replace(/<.*$/, '').trim();
    const parts = plain.split('.');
    return parts[parts.length - 1].replace(/\$/g, '.');
}

/** A readable, identifier-safe placeholder for the nth parameter. */
function parameterName(type, index, used) {
    const short = shortType(type);
    const base = PARAMETER_NAMES[type]
        || (short.endsWith('[]') ? `${shortType(short.slice(0, -2)).toLowerCase()}s` : null)
        || short.replace(/[^A-Za-z0-9_]/g, '').toLowerCase()
        || `arg${index + 1}`;

    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}${suffix++}`;
    used.add(name);
    return name;
}

/** Snippet body: `substring(${1:n}, ${2:n2})`. */
function snippetFor(member) {
    const used = new Set();
    const args = (member.params || []).map((type, index) => `\${${index + 1}:${parameterName(type, index, used)}}`);
    return `${member.name}(${args.join(', ')})`;
}

/** Human-readable signature: `substring(int, int)`. */
function signatureOf(member) {
    if (member.isField) return `${member.name} : ${shortType(member.type)}`;
    return `${member.name}(${(member.params || []).map(shortType).join(', ')})`;
}

function rankOf(typeKey, name, table) {
    const popular = table[typeKey];
    if (!popular) return DEFAULT_RANK;
    const index = popular.indexOf(name);
    return index === -1 ? DEFAULT_RANK : index;
}

/**
 * Build the completion candidates for a resolved type.
 *
 * @param {{ typeKey: string, kind?: string, methods: object[], fields: object[] }} members
 * @param {{ popularity?: object, limit?: number }} [options]
 * @returns {object[]} candidates, already ordered
 */
function buildMemberCandidates(members, options = {}) {
    if (!members || !members.resolved) return [];

    const popularity = options.popularity || POPULAR;
    const limit = options.limit || 300;
    const typeKey = members.typeKey;

    const candidates = [];

    for (const method of members.methods || []) {
        const tier = tierOf(method, typeKey);
        candidates.push({
            name: method.name,
            label: method.name,
            labelDetail: `(${(method.params || []).map(shortType).join(', ')})`,
            labelDescription: shortType(method.returns),
            filterText: method.name,
            kind: 'method',
            arity: (method.params || []).length,
            insertText: snippetFor(method),
            signature: signatureOf(method),
            detail: `${signatureOf(method)} : ${shortType(method.returns)}`,
            declaringType: method.declaringType || typeKey,
            returns: method.returns,
            deprecated: !!method.deprecated,
            tier,
            rank: rankOf(typeKey, method.name, popularity),
        });
    }

    for (const field of members.fields || []) {
        const tier = tierOf(field, typeKey);
        candidates.push({
            name: field.name,
            label: field.name,
            labelDetail: '',
            labelDescription: shortType(field.type),
            filterText: field.name,
            kind: 'field',
            arity: 0,
            insertText: field.name,
            signature: `${field.name} : ${shortType(field.type)}`,
            detail: `${field.name} : ${shortType(field.type)}`,
            declaringType: field.declaringType || typeKey,
            returns: field.type,
            deprecated: !!field.deprecated,
            tier,
            rank: rankOf(typeKey, field.name, popularity),
        });
    }

    // Explicit comparison rather than locale collation: overloads must come out
    // in arity order, and `(int)`/`(int, int)` only differ by punctuation.
    const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    candidates.sort((a, b) =>
        a.tier - b.tier
        || a.rank - b.rank
        || compareText(a.name, b.name)
        || a.arity - b.arity
        || compareText(a.labelDetail, b.labelDetail));

    return candidates.slice(0, limit);
}

/** Sort tier: own members first, then inherited, then Object. */
function tierOf(member, typeKey) {
    const declaring = member.declaringType || typeKey;
    if (declaring === typeKey) return 0;
    if (declaring === 'java.lang.Object') return 2;
    return 1;
}

/** Markdown documentation for one candidate. */
function documentationFor(candidate, typeLabel) {
    const lines = [`\`\`\`java`, `${candidate.signature}`, '```'];
    lines.push(`Declared by \`${candidate.declaringType}\``);
    if (candidate.declaringType !== typeLabel && typeLabel) {
        lines.push(`Inherited for \`${typeLabel}\``);
    }
    if (candidate.deprecated) {
        lines.push('');
        lines.push('⚠️ **Deprecated** — prefer an alternative from the same type.');
    }
    return lines.join('\n');
}

/**
 * The explanation shown when a receiver cannot be typed, or null when the
 * reason should stay silent (the caller then keeps its normal completion).
 */
function buildTypeHint(resolution) {
    if (!resolution || resolution.resolved) return null;

    const reference = resolution.reference || (resolution.sigil ? `$${resolution.sigil}{${resolution.name}}` : '');
    const hint = {
        kind: 'info',
        insertText: '$0', // accepting the item inserts nothing
        filterText: null,
    };

    if (resolution.reason === 'no-class') {
        hint.label = `Type of ${reference} is not declared — add class="..." for member completion`;
        hint.detail = 'JRXML typed completion';
        hint.documentation = [
            `\`${reference}\` has no \`class\` attribute, so JasperReports infers its type from the data source.`,
            '',
            'Declare it to get member completion:',
            '',
            '```xml',
            `<field name="${resolution.name}" class="java.lang.String"/>`,
            '```',
        ].join('\n');
        return hint;
    }

    if (resolution.reason === 'unknown-type') {
        const declared = resolution.declaredType || resolution.typeKey || 'the declared class';
        hint.label = `Type ${declared} is not in the type index — member completion unavailable`;
        hint.detail = 'JRXML typed completion';
        hint.documentation = [
            `Member completion currently covers JDK types and a few JasperReports engine types.`,
            '',
            `\`${declared}\` comes from the project classpath, which is not indexed yet.`,
        ].join('\n');
        return hint;
    }

    if (resolution.reason === 'ambiguous') {
        const candidates = (resolution.ambiguity && resolution.ambiguity.candidates) || [];
        hint.label = `${resolution.name} matches ${candidates.join(' and ')} — use the full class name`;
        hint.detail = 'JRXML typed completion';
        hint.documentation = [
            `\`${resolution.name}\` is a short name for more than one indexed type:`,
            '',
            ...candidates.map(candidate => `- \`${candidate}\``),
            '',
            'Write the full class name in `class="..."` to choose one.',
        ].join('\n');
        return hint;
    }

    return null;
}

module.exports = {
    buildMemberCandidates,
    buildTypeHint,
    documentationFor,
    signatureOf,
    snippetFor,
    parameterName,
    shortType,
    POPULAR,
};
