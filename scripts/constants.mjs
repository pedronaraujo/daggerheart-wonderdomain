export const MOD = 'daggerheart-wonderdomain';
export const DOMAIN_ID = 'wonder';
export const DOMAIN_COLOR = '#1d6b74';
export const FORM_ITEM_ID = 'wonderConstForm1';

/** Action ids that open module interfaces instead of running a system action. Keep in sync with tools/build_data.py */
export const SPECIAL = {
    starChart: 'wndStarChartOpen',
    constellation: 'wndConstellation',
    empyrean: 'wndEmpyreanCall0',
    workshop: 'wndWorkshopOpen0',
    surge: 'wndIngeniousSrg0',
    tinkering: 'wndTinkeringBnch',
    glimpse: 'wndGlimpseDice00',
    moonReduce: 'wndMoonShieldRed',
    masterpiece: 'wndMasterpieceWk',
    appraisal: 'wndAppraisal0000',
    spellweave: 'wndSpellweave000',
    dreamSignal: 'wndDreamSignal00',
    twinnedMinds: 'wndTwinnedMinds0',
    cosmicInspire: 'wndCosmicInspir0',
    archive: 'wndArchiveOpen00',
    moonEnd: 'wndMoonShieldEnd',
    craftDevice: 'wndCraftDevice00',
    useDevice: 'wndUseDevice0000',
    paradox: 'wndParadoxFlux00',
    imaginarium: 'wndImaginarium00',
    breakthrough: 'wndBreakthrough0',
    sharedDreams: 'wndSharedDreams0',
    gemology: 'wndGemology00000'
};

export const RANGE_LABELS = {
    self: 'Self',
    melee: 'Melee',
    veryClose: 'Very Close',
    close: 'Close',
    far: 'Far',
    veryFar: 'Very Far'
};

export const LOOT_TABLES = [
    'Compendium.daggerheart.rolltables.RollTable.S61Shlt2I5CbLRjz',
    'Compendium.daggerheart.rolltables.RollTable.tF04P02yVN1YDVel'
];

/** Folder (in the Foundry user data) that holds the card art extracted from your own copy of the PDFs. */
export const ART = 'wonder-domain-art';

/** Base URL of the module files (overridable for development builds). */
export const BASE = { url: `modules/${MOD}` };
export const path = p => `${BASE.url}/${p}`;
export const art = file => `${ART}/${file}`;
export const loc = (key, data) =>
    data ? game.i18n.format(`WONDER.${key}`, data) : game.i18n.localize(`WONDER.${key}`);
