import { MOD, DOMAIN_ID, path, loc } from './constants.mjs';

/* -------------------------------------------- */
/*  Static data                                 */
/* -------------------------------------------- */

export const DATA = { starChart: null, enchantments: null };

export async function loadData() {
    const [chart, ench] = await Promise.all([
        fetch(path('data/star-chart.json')).then(r => r.json()),
        fetch(path('data/enchantments.json')).then(r => r.json())
    ]);
    DATA.starChart = chart;
    DATA.enchantments = ench;
}

/* -------------------------------------------- */
/*  Actor helpers                               */
/* -------------------------------------------- */

export function resolveActor(actor) {
    if (actor instanceof Actor) return actor;
    if (typeof actor === 'string') return fromUuidSync(actor) ?? game.actors.get(actor);
    return canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;
}

/** Feature items (and other items) the character can currently use. */
export function availableItems(actor) {
    if (!actor) return [];
    return actor.items.filter(i => {
        if (i.type === 'domainCard' && i.system.inVault) return false;
        return actor.system.isItemAvailable ? actor.system.isItemAvailable(i) : true;
    });
}

export function flagValues(actor, key) {
    return availableItems(actor)
        .map(i => i.getFlag(MOD, key))
        .filter(v => v !== undefined && v !== null);
}

export const hasFlag = (actor, key) => flagValues(actor, key).length > 0;

export function wonderClasses(actor) {
    const out = new Set();
    if (!actor) return out;
    for (const it of actor.items) {
        const flag = it.getFlag(MOD, 'wonderClass');
        if (flag) out.add(flag);
        else if (it.type === 'class' && ['Enchanter', 'Stargazer'].includes(it.name)) out.add(it.name.toLowerCase());
    }
    return out;
}

export function hasWonder(actor) {
    if (!actor || actor.type !== 'character') return false;
    return (
        wonderClasses(actor).size > 0 ||
        actor.items.some(i => i.type === 'domainCard' && i.system.domain === DOMAIN_ID)
    );
}

export const spellcast = actor => actor?.system?.spellcastModifier ?? 0;
export const tier = actor => actor?.system?.tier ?? 1;
export const level = actor => actor?.system?.levelData?.level?.current ?? 1;
export const hopeValue = actor => actor?.system?.resources?.hope?.value ?? 0;

export function subclassName(actor) {
    return actor?.system?.class?.subclass?.name ?? actor?.system?.multiclass?.subclass?.name ?? null;
}

export function wonderLoadout(actor) {
    return actor.items.filter(i => i.type === 'domainCard' && i.system.domain === DOMAIN_ID && !i.system.inVault);
}

export function wonderTouchedActive(actor) {
    const cards = wonderLoadout(actor);
    return cards.length >= 4 && cards.some(c => c.getFlag(MOD, 'wonderTouched'));
}

/* -------------------------------------------- */
/*  Resources                                   */
/* -------------------------------------------- */

/**
 * Pay Hope and/or Stress. Returns false if the cost could not be paid.
 * With Wonder-Touched active, missing Hope can be paid with Stress.
 */
export async function pay(actor, { hope = 0, stress = 0, label = '' } = {}) {
    const current = hopeValue(actor);
    if (hope > current) {
        const missing = hope - current;
        if (!wonderTouchedActive(actor)) {
            ui.notifications.warn(loc('Notify.NotEnoughHope', { need: hope, have: current }));
            return false;
        }
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: 'Wonder-Touched' },
            content: `<p>${loc('Notify.WonderTouchedSwap', { n: missing })}</p>`
        });
        if (!ok) return false;
        hope = current;
        stress += missing;
    }
    const updates = [];
    if (hope) updates.push({ key: 'hope', value: -hope, total: hope, enabled: true });
    if (stress) updates.push({ key: 'stress', value: stress, total: -stress, enabled: true });
    if (updates.length) await actor.modifyResource(updates);
    return true;
}

export async function gain(actor, { hope = 0, stress = 0, hitPoints = 0 } = {}) {
    const updates = [];
    if (hope) updates.push({ key: 'hope', value: hope, enabled: true });
    if (stress) updates.push({ key: 'stress', value: -stress, enabled: true });
    if (hitPoints) updates.push({ key: 'hitPoints', value: -hitPoints, enabled: true });
    if (updates.length) await actor.modifyResource(updates);
}

/* -------------------------------------------- */
/*  Chat                                        */
/* -------------------------------------------- */

export async function chatCard(actor, { title, img, body = '', rolls = [], flags = {}, footer = '' }) {
    const content = `
    <div class="wonder-chat">
      <header class="wonder-chat-header">
        ${img ? `<img src="${img}" alt="">` : ''}
        <h3>${title}</h3>
      </header>
      <div class="wonder-chat-body">${body}</div>
      ${footer ? `<footer class="wonder-chat-footer">${footer}</footer>` : ''}
    </div>`;
    return ChatMessage.implementation.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content,
        rolls,
        flags: { [MOD]: flags }
    });
}

export async function roll(formula, data = {}) {
    const r = new Roll(formula, data);
    await r.evaluate();
    if (game.dice3d) await game.dice3d.showForRoll(r, game.user, true);
    return r;
}

/* -------------------------------------------- */
/*  GM proxy (for documents the user does not own)
/* -------------------------------------------- */

const SOCKET = `module.${MOD}`;

export function registerSocket() {
    game.socket.on(SOCKET, async msg => {
        if (!game.user.isActiveGM) return;
        await runOp(msg);
    });
}

async function runOp({ op, uuid, data, type, ids, options }) {
    const doc = await fromUuid(uuid);
    if (!doc) return;
    switch (op) {
        case 'update':
            return doc.update(data, options);
        case 'create':
            return doc.createEmbeddedDocuments(type, data, options);
        case 'delete':
            return doc.deleteEmbeddedDocuments(type, ids, options);
        case 'resources':
            return doc.modifyResource(data);
        case 'unsetFeatures': {
            const keys = ids ?? [];
            if (!keys.length) return;
            return doc.update(Object.fromEntries(keys.map(k => [`system.itemFeatures.${k}`, _del])));
        }
    }
}

export async function asOwner(doc, op, args) {
    if (doc.isOwner) return runOp({ op, uuid: doc.uuid, ...args });
    if (!game.users.activeGM) {
        ui.notifications.warn(loc('Notify.NeedGM'));
        return null;
    }
    game.socket.emit(SOCKET, { op, uuid: doc.uuid, ...args });
    return true;
}

export function randomId() {
    return foundry.utils.randomID(16);
}

export function escape(str) {
    return foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(str ?? '')) : String(str ?? '');
}
