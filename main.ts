/*
 * clipguard - UI layer
 *
 * All DOM manipulation, event wiring, modal logic, config panel.
 */

import './style.css';
import { init, add, check, count, clear, config, configure, CheckResult, DlpConfig, InitConfig } from './dlp.ts';


interface CfgField {
	id:	string;
	key:	keyof DlpConfig;
	parse:	(v: string) => number;
}

interface CachedElements {
	source:		HTMLTextAreaElement;
	target:		HTMLTextAreaElement;
	decision:	HTMLElement;
	fuzzyScore:	HTMLElement;
	fragScore:	HTMLElement;
	fuzzyBar:	HTMLElement;
	fragBar:	HTMLElement;
	entropy:	HTMLElement;
	vaultCount:	HTMLElement;
	reason:		HTMLElement;
	modalHow:	HTMLElement;
	modalWhy:	HTMLElement;
	modalCfg:	HTMLElement;
	btnHow:		HTMLElement;
	btnWhy:		HTMLElement;
	btnCfg:		HTMLElement;
	cfgForm:	HTMLFormElement;
}


/* ---- Bootstrap: load config + stopwords, then init engine ---- */

Promise.all([
	fetch('config.json').then(function(r: Response) { return r.json() as Promise<InitConfig>; }),
	fetch('stopwords.json').then(function(r: Response) { return r.json() as Promise<string[]>; })
]).then(function(data: [InitConfig, string[]]) {
	init(data[0], data[1]);
	syncConfigUi();
});


/* ---- Cached elements ---- */

const el: CachedElements = {
	source:		document.getElementById('source') as HTMLTextAreaElement,
	target:		document.getElementById('target') as HTMLTextAreaElement,
	decision:	document.getElementById('decision') as HTMLElement,
	fuzzyScore:	document.getElementById('fuzzy-score') as HTMLElement,
	fragScore:	document.getElementById('fragment-score') as HTMLElement,
	fuzzyBar:	document.getElementById('fuzzy-bar') as HTMLElement,
	fragBar:	document.getElementById('fragment-bar') as HTMLElement,
	entropy:	document.getElementById('entropy-score') as HTMLElement,
	vaultCount:	document.getElementById('vault-count') as HTMLElement,
	reason:		document.getElementById('verdict-reason') as HTMLElement,
	modalHow:	document.getElementById('modal-how') as HTMLElement,
	modalWhy:	document.getElementById('modal-why') as HTMLElement,
	modalCfg:	document.getElementById('modal-cfg') as HTMLElement,
	btnHow:		document.getElementById('btn-how') as HTMLElement,
	btnWhy:		document.getElementById('btn-why') as HTMLElement,
	btnCfg:		document.getElementById('btn-cfg') as HTMLElement,
	cfgForm:	document.getElementById('cfg-form') as HTMLFormElement
};


/* ---- Config field map (form id -> DLP config key) ---- */

const CFG_FIELDS: CfgField[] = [
	{ id: 'cfg-vault-ttl',		key: 'vaultTtl',	parse: function(v: string) { return parseFloat(v) * 60 * 1000; } },
	{ id: 'cfg-fuzzy-thresh',	key: 'fuzzyThresh',	parse: parseFloat },
	{ id: 'cfg-frag-thresh',	key: 'fragThresh',	parse: parseFloat },
	{ id: 'cfg-shingle-len',	key: 'shingleLen',	parse: parseInt },
	{ id: 'cfg-hash-bits',		key: 'hashBits',	parse: parseInt },
	{ id: 'cfg-min-chars',		key: 'minChars',	parse: parseInt },
	{ id: 'cfg-min-words',		key: 'minWords',	parse: parseInt },
	{ id: 'cfg-min-entropy',	key: 'minEntropy',	parse: parseFloat }
];


function syncConfigUi(): void
{
	const c = config();

	for (let i = 0; i < CFG_FIELDS.length; i++) {
		const field = CFG_FIELDS[i];
		const input = document.getElementById(field.id) as HTMLInputElement | null;
		if (!input)
			continue;

		if (field.key === 'vaultTtl')
			input.value = String(c[field.key] / 60000);
		else
			input.value = String(c[field.key]);
	}
}


function applyConfig(): void
{
	for (let i = 0; i < CFG_FIELDS.length; i++) {
		const field = CFG_FIELDS[i];
		const input = document.getElementById(field.id) as HTMLInputElement | null;
		if (!input)
			continue;

		const val = field.parse(input.value);
		if (!isNaN(val))
			configure(field.key, val);
	}
}


/* ---- Helpers ---- */

function barColor(val: number, thresh: number): string
{
	if (val >= thresh)
		return 'red';
	if (val >= thresh * 0.6)
		return 'yellow';
	return 'green';
}

function updateCount(): void
{
	el.vaultCount.textContent = String(count());
}

function showResult(r: CheckResult): void
{
	const c = config();
	const fuzzyPct = (r.fuzzy * 100).toFixed(1);
	const fragPct = (r.fragment * 100).toFixed(1);

	el.fuzzyScore.textContent = fuzzyPct + '%';
	el.fragScore.textContent = fragPct + '%';
	el.reason.textContent = r.reason;

	el.entropy.textContent = r.entropy ? r.entropy.toFixed(2) + ' bits' : '--';

	el.fuzzyBar.style.width = fuzzyPct + '%';
	el.fuzzyBar.className = 'bar-fill ' + barColor(r.fuzzy, c.fuzzyThresh);

	el.fragBar.style.width = fragPct + '%';
	el.fragBar.className = 'bar-fill ' + barColor(r.fragment, c.fragThresh);

	if (r.blocked) {
		el.decision.className = 'decision blocked';
		el.decision.textContent = 'BLOCKED - This looks like work data. Paste denied.';
	} else if (r.skipped) {
		el.decision.className = 'decision allowed';
		el.decision.textContent = 'ALLOWED - ' + r.reason;
	} else {
		el.decision.className = 'decision allowed';
		el.decision.textContent = 'ALLOWED - Content does not match vault.';
	}
}


/* ---- Copy / Paste events ---- */

el.source.addEventListener('copy', function() {
	const sel = window.getSelection()?.toString();

	if (sel && add(sel))
		updateCount();
});

el.target.addEventListener('paste', function(e: ClipboardEvent) {
	const text = e.clipboardData?.getData('text/plain');

	if (!text)
		return;

	if (!count()) {
		showResult({
			blocked: false, fuzzy: 0, fragment: 0, entropy: 0,
			skipped: 'empty',
			reason: 'Vault is empty - copy from Workspace A first'
		});
		return;
	}

	const result = check(text);
	showResult(result);

	if (result.blocked)
		e.preventDefault();
});


/* ---- Modals ---- */

const modals: HTMLElement[] = [el.modalHow, el.modalWhy, el.modalCfg];

function closeAll(): void
{
	for (let i = 0; i < modals.length; i++)
		modals[i].classList.remove('open');
}

function openModal(m: HTMLElement): void
{
	closeAll();
	m.classList.add('open');
}

el.btnHow.addEventListener('click', function() { openModal(el.modalHow); });
el.btnWhy.addEventListener('click', function() { openModal(el.modalWhy); });
el.btnCfg.addEventListener('click', function() {
	syncConfigUi();
	openModal(el.modalCfg);
});

/* Close buttons */
document.addEventListener('click', function(e: MouseEvent) {
	const target = e.target as HTMLElement;

	if (target.classList.contains('btn-close')) {
		const id = target.getAttribute('data-close');
		if (id)
			document.getElementById(id)?.classList.remove('open');
	}
});

/* Overlay click */
document.addEventListener('click', function(e: MouseEvent) {
	for (let i = 0; i < modals.length; i++) {
		if (e.target === modals[i])
			modals[i].classList.remove('open');
	}
});

/* Escape */
document.addEventListener('keydown', function(e: KeyboardEvent) {
	if (e.key === 'Escape')
		closeAll();
});


/* ---- Config form ---- */

el.cfgForm.addEventListener('submit', function(e: Event) {
	e.preventDefault();
	applyConfig();
	clear();
	updateCount();
	closeAll();
});

(document.getElementById('cfg-reset') as HTMLElement).addEventListener('click', function() {
	fetch('config.json').then(function(r: Response) { return r.json() as Promise<InitConfig>; }).then(function(data: InitConfig) {
		init(data);
		syncConfigUi();
	});
});
