/*
 * clipguard - Detection Engine (pure logic, no DOM)
 *
 * Detection pipeline:
 *   1. Length gate    - reject trivially short text
 *   2. Stop words    - strip common noise before fingerprinting
 *   3. Entropy check - deprioritize predictable/common phrases
 *   4. SimHash       - locality-sensitive hash for fuzzy similarity
 *   5. Shingles      - n-word sliding window for fragment detection
 *   6. Density gate  - require significant cluster overlap, not stray hits
 *
 * Usage:
 *   init(config, stopwords)   - load config and stop words
 *   add(text)                 - fingerprint and vault copied text
 *   check(text)               - compare pasted text against vault
 *   config()                  - get current config (read-only copy)
 *   configure(key, value)     - update a single threshold at runtime
 *   count()                   - number of entries in vault
 *   clear()                   - flush the vault
 */

export interface DlpConfig {
	vaultTtl:	number;
	fuzzyThresh:	number;
	fragThresh:	number;
	shingleLen:	number;
	hashBits:	number;
	minChars:	number;
	minWords:	number;
	minEntropy:	number;
}

export interface InitConfig {
	vaultTtlMinutes?:	number;
	fuzzyThreshold?:	number;
	fragmentThreshold?:	number;
	shingleLength?:		number;
	hashBits?:		number;
	minChars?:		number;
	minWords?:		number;
	minEntropy?:		number;
}

export interface VaultEntry {
	norm:		string;
	signal:		string;
	hash:		number[];
	shingles:	Set<string>;
	entropy:	number;
	ts:		number;
}

export interface CheckResult {
	blocked:	boolean;
	fuzzy:		number;
	fragment:	number;
	entropy:	number;
	skipped:	string | null;
	reason:		string;
}

export type ShingleSet = Set<string>;

/* Defaults - overridden by init() */
const cfg: DlpConfig = {
	vaultTtl:	60 * 60 * 1000,
	fuzzyThresh:	0.70,
	fragThresh:	0.35,
	shingleLen:	5,
	hashBits:	64,
	minChars:	50,
	minWords:	8,
	minEntropy:	2.5
};

let vault: VaultEntry[] = [];
let stopWords: Set<string> = new Set();


function init(config?: InitConfig, stopwords?: string[]): void
{
	if (config) {
		if (config.vaultTtlMinutes !== undefined)
			cfg.vaultTtl = config.vaultTtlMinutes * 60 * 1000;
		if (config.fuzzyThreshold !== undefined)
			cfg.fuzzyThresh = config.fuzzyThreshold;
		if (config.fragmentThreshold !== undefined)
			cfg.fragThresh = config.fragmentThreshold;
		if (config.shingleLength !== undefined)
			cfg.shingleLen = config.shingleLength;
		if (config.hashBits !== undefined)
			cfg.hashBits = config.hashBits;
		if (config.minChars !== undefined)
			cfg.minChars = config.minChars;
		if (config.minWords !== undefined)
			cfg.minWords = config.minWords;
		if (config.minEntropy !== undefined)
			cfg.minEntropy = config.minEntropy;
	}

	stopWords = new Set(stopwords || []);
}


function configure(key: keyof DlpConfig, value: number): void
{
	cfg[key] = value;
}


function getConfig(): DlpConfig
{
	const copy: DlpConfig = { ...cfg };
	return copy;
}


function normalize(text: string): string
{
	return text.toLowerCase()
		.replace(/[^\w\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}


function stripStops(text: string): string
{
	const words = text.split(' ');
	const out: string[] = [];

	for (let i = 0; i < words.length; i++) {
		if (!stopWords.has(words[i]))
			out.push(words[i]);
	}

	return out.join(' ');
}


function entropy(text: string): number
{
	const freq: Record<string, number> = {};
	const len = text.length;
	let h = 0;

	if (!len)
		return 0;

	for (let i = 0; i < len; i++) {
		if (freq[text[i]])
			freq[text[i]]++;
		else
			freq[text[i]] = 1;
	}

	for (const i in freq) {
		const p = freq[i] / len;
		h -= p * Math.log2(p);
	}

	return h;
}


function longEnough(text: string): boolean
{
	if (text.length < cfg.minChars)
		return false;
	if (text.split(' ').length < cfg.minWords)
		return false;
	return true;
}


function makeShingles(text: string): ShingleSet
{
	const words = text.split(' ');
	const set: ShingleSet = new Set();

	if (words.length < cfg.shingleLen)
		return set;

	for (let i = 0; i <= words.length - cfg.shingleLen; i++)
		set.add(words.slice(i, i + cfg.shingleLen).join(' '));

	return set;
}


function hashStr(str: string): number
{
	let h = 0;

	for (let i = 0; i < str.length; i++)
		h = ((h << 5) - h + str.charCodeAt(i)) | 0;

	return h;
}


function simhash(text: string): number[]
{
	const words = text.split(' ');
	const bits = cfg.hashBits;
	const v = new Array<number>(bits).fill(0);

	for (let i = 0; i < words.length; i++) {
		if (!words[i])
			continue;
		const h = hashStr(words[i]);
		for (let j = 0; j < bits; j++)
			v[j] += (h >> (j % 32)) & 1 ? 1 : -1;
	}

	for (let i = 0; i < bits; i++)
		v[i] = v[i] >= 0 ? 1 : 0;

	return v;
}


function simhashCompare(a: number[], b: number[]): number
{
	let same = 0;
	const bits = cfg.hashBits;

	for (let i = 0; i < bits; i++) {
		if (a[i] === b[i])
			same++;
	}

	return same / bits;
}


function shingleCompare(a: ShingleSet, b: ShingleSet): number
{
	const smaller = Math.min(a.size, b.size);
	let hits = 0;

	if (!smaller)
		return 0;

	a.forEach(function(s: string) {
		if (b.has(s))
			hits++;
	});

	return hits / smaller;
}


function vaultPrune(): void
{
	const now = Date.now();

	for (let i = vault.length - 1; i >= 0; i--) {
		if (now - vault[i].ts > cfg.vaultTtl)
			vault.splice(i, 1);
	}
}


function vaultAdd(raw: string): boolean
{
	vaultPrune();

	const norm = normalize(raw);
	if (!longEnough(norm))
		return false;

	const signal = stripStops(norm);
	if (signal.length < 10)
		return false;

	vault.push({
		norm:		norm,
		signal:		signal,
		hash:		simhash(signal),
		shingles:	makeShingles(signal),
		entropy:	entropy(norm),
		ts:		Date.now()
	});

	return true;
}


function vaultCheck(raw: string): CheckResult
{
	vaultPrune();

	const norm = normalize(raw);

	if (!longEnough(norm))
		return { blocked: false, fuzzy: 0, fragment: 0, entropy: 0,
			 skipped: 'length',
			 reason: 'Too short (' + norm.split(' ').length + ' words) - allowed' };

	const signal = stripStops(norm);
	if (signal.length < 10)
		return { blocked: false, fuzzy: 0, fragment: 0, entropy: 0,
			 skipped: 'stopwords',
			 reason: 'Only common words - no signal to match' };

	const pasteEnt = entropy(norm);

	let fuzzyT = cfg.fuzzyThresh;
	let fragT = cfg.fragThresh;
	if (pasteEnt < cfg.minEntropy) {
		fuzzyT = 0.90;
		fragT = 0.70;
	}

	const pasteHash = simhash(signal);
	const pasteShingles = makeShingles(signal);

	let bestFuzzy = 0;
	let bestFrag = 0;

	for (let i = 0; i < vault.length; i++) {
		const entry = vault[i];
		const f = simhashCompare(pasteHash, entry.hash);
		const s = shingleCompare(pasteShingles, entry.shingles);

		if (f > bestFuzzy)
			bestFuzzy = f;
		if (s > bestFrag)
			bestFrag = s;
	}

	const result: CheckResult = {
		blocked:	false,
		fuzzy:		bestFuzzy,
		fragment:	bestFrag,
		entropy:	pasteEnt,
		skipped:	null,
		reason:		''
	};

	if (bestFuzzy >= fuzzyT && bestFrag >= fragT) {
		result.blocked = true;
		result.reason = 'High similarity + fragment cluster match';
	} else if (bestFrag >= fragT) {
		result.blocked = true;
		result.reason = 'Fragment cluster match - partial work content';
	} else if (bestFuzzy >= fuzzyT) {
		result.blocked = true;
		result.reason = 'High fuzzy similarity - resembles work data';
	} else {
		result.blocked = false;
		result.reason = 'No significant match found';
	}

	return result;
}


function vaultCount(): number
{
	return vault.length;
}


function vaultClear(): void
{
	vault = [];
}


/* Public API */
export {
	init,
	vaultAdd as add,
	vaultCheck as check,
	vaultCount as count,
	vaultClear as clear,
	getConfig as config,
	configure
};
