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
    spellweave: 'wndSpellweave000'
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

export const path = p => `modules/${MOD}/${p}`;
export const loc = (key, data) =>
    data ? game.i18n.format(`WONDER.${key}`, data) : game.i18n.localize(`WONDER.${key}`);
