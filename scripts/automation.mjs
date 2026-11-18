/**
 * Automation for passive features and the follow-up of domain card actions.
 * Native system actions pay the costs and roll; these handlers apply what the card says happens next.
 */
import { MOD, SPECIAL, FORM_ITEM_ID, loc } from './constants.mjs';
import {
    hasFlag, flagValues, spellcast, gain, chatCard, roll, asOwner, escape, wonderTouchedActive, hopeValue, randomId
} from './util.mjs';
import * as Stars from './star-chart.mjs';
import * as Ench from './enchanting.mjs';

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const targetActors = config =>
    (config?.targets ?? []).map(t => fromUuidSync(t.actorId)).filter(a => a instanceof Actor);

/** Targets of the action, or the user's targeted tokens, or (optionally) the actor itself. */
function resolveTargets(action, config, { includeSelf = false, fallbackSelf = true } = {}) {
    let list = targetActors(config);
    if (!list.length) list = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
    if (includeSelf && !list.includes(action.actor)) list.unshift(action.actor);
    if (!list.length && fallbackSelf) list = [action.actor];
    return [...new Set(list)];
}

const succeeded = (config, difficulty) => {
    const r = config?.evaluated;
    if (!r) return true;
    if (r.isCritical) return true;
    if (difficulty) return r.total >= difficulty;
    if (config.roll?.success !== undefined) return Boolean(config.roll.success);
    return (config.targets ?? []).some(t => t.hitResult?.success);
};

const effectBase = (name, img, { changes = [], statuses = [], description = '', duration = 'temporary', flags = {} } = {}) => ({
    name,
    img,
    type: 'base',
    transfer: false,
    disabled: false,
    statuses,
    description,
    system: { changes, conditionals: [], duration: { description: '', type: duration } },
    flags: { [MOD]: flags }
});

const chg = (key, value, type = 'add') => ({ key, type, value, priority: null, phase: 'initial' });

/** Give a creature an effect that lasts until its next action roll. */
export async function grantNextRoll(target, { name, img, bonus = 0, changes = [], onHope = null, onFear = null, source = null }) {
    const all = [...changes];
    if (bonus) all.push(chg('system.bonuses.roll.bonus', bonus));
    const data = effectBase(name, img, {
        changes: all,
        description: `<p>${loc('Auto.NextRollHint')}</p>`,
        flags: { nextRoll: { onHope, onFear, source } }
    });
    await asOwner(target, 'create', { type: 'ActiveEffect', data: [data] });
}

/** After a duality roll: resolve and remove "until your next roll" effects on the roller. */
export async function consumeNextRoll(config) {
    const actor = config?.actor;
    if (!actor?.isOwner) return;
    if (config.actionType === 'reaction' || config.roll?.type === 'reaction') return;
    const effects = actor.effects.filter(e => e.getFlag(MOD, 'nextRoll'));
    if (!effects.length) return;
    const r = config.evaluated;
    for (const e of effects) {
        const nr = e.getFlag(MOD, 'nextRoll');
        const notes = [];
        if (r?.withHope || r?.isCritical) {
            if (nr.onHope === 'clearStress') {
                await gain(actor, { stress: 1 });
                notes.push(loc('Auto.DreamClarity', { name: escape(actor.name) }));
            }
        } else if (r?.withFear) {
            if (nr.onFear === 'gmFear') {
                await ui.resources?.updateFear?.((ui.resources.currentFear ?? 0) + 1);
                notes.push(loc('Auto.DreamDisturbing', { name: escape(actor.name) }));
            }
        }
        await e.delete();
        if (notes.length)
            await chatCard(actor, { title: e.name, img: e.img, body: notes.map(n => `<p>${n}</p>`).join('') });
    }
}

/* -------------------------------------------- */
/*  Wonder-Touched: mark Stress instead of Hope */
/* -------------------------------------------- */

export function wonderTouchedCosts(action, config) {
    const actor = action?.actor;
    if (!actor || actor.type !== 'character' || !wonderTouchedActive(actor)) return;
    const costs = config?.costs;
    if (!Array.isArray(costs)) return;
    let hope = hopeValue(actor);
    let swapped = 0;
    for (const c of costs) {
        if (c.key !== 'hope' || c.itemId) continue;
        const need = Number(c.total ?? c.value ?? 0);
        if (need <= hope) {
            hope -= need;
            continue;
        }
        const missing = need - hope;
        swapped += missing;
        c.value = hope;
        c.scale = 0;
        c.total = hope;
        hope = 0;
        const stress = actor.system.resources.stress;
        costs.push({
            key: 'stress', value: missing, total: missing, scale: 0, step: 1, enabled: true, scalable: false,
            max: (stress?.max ?? 0) - (stress?.value ?? 0), itemId: null, consumeOnSuccess: c.consumeOnSuccess
        });
    }
    if (swapped) ui.notifications.info(loc('Auto.WonderTouchedSwapped', { n: swapped }));
}

/** Wonder-Touched: once per long rest, marking your last Stress clears Stress equal to your Spellcast trait instead. */
export async function wonderTouchedLastStress(actor, changes) {
    const value = foundry.utils.getProperty(changes, 'system.resources.stress.value');
    if (value === undefined || actor.type !== 'character' || !actor.isOwner) return;
    const max = actor.system.resources.stress.max;
    if (value < max || !wonderTouchedActive(actor)) return;
    const card = actor.items.find(i => i.getFlag(MOD, 'wonderTouched') && !i.system.inVault);
    const action = card?.system.actions?.find(a => a.type === 'healing');
    if (!action) return;
    const used = Number(action.uses?.value ?? 0);
    const maxUses = Number(action.uses?.max || 1);
    if (used >= maxUses) return;
    const n = Math.max(1, spellcast(actor));
    await action.update({ 'uses.value': used + 1 });
    // the last Stress is not marked, and Stress equal to the Spellcast trait is cleared
    await actor.update({ 'system.resources.stress.value': Math.max(0, max - 1 - n) });
    await chatCard(actor, {
        title: 'Wonder-Touched',
        img: card.img,
        body: `<p>${loc('Auto.WonderTouchedRecover', { n })}</p>`
    });
}

/* -------------------------------------------- */
/*  After a native action resolves              */
/* -------------------------------------------- */

const POST = {
    async [SPECIAL.dreamSignal](action, config) {
        const caster = action.actor;
        const bonus = spellcast(caster);
        for (const t of resolveTargets(action, config, { fallbackSelf: false })) {
            await grantNextRoll(t, {
                name: `Dream Signal (+${bonus})`,
                img: action.item.img,
                bonus,
                onHope: 'clearStress',
                onFear: 'gmFear',
                source: caster.uuid
            });
        }
    },

    async [SPECIAL.twinnedMinds](action, config) {
        const caster = action.actor;
        const allies = resolveTargets(action, config, { fallbackSelf: false }).filter(a => a !== caster);
        const ally = allies[0];
        if (!ally) return ui.notifications.warn(loc('Auto.NeedAllyTarget'));
        await ally.modifyResource([{ key: 'stress', value: 1, enabled: true }]);
        const description = `<p>${loc('Auto.TwinnedHint', { a: escape(caster.name), b: escape(ally.name) })}</p>`;
        for (const a of [caster, ally]) {
            const other = a === caster ? ally : caster;
            await asOwner(a, 'create', {
                type: 'ActiveEffect',
                data: [effectBase(`Twinned Minds — ${other.name}`, action.item.img, { description, duration: 'scene', flags: { twinned: other.uuid } })]
            });
        }
        await chatCard(caster, {
            title: 'Twinned Minds',
            img: action.item.img,
            body: `<p>${loc('Auto.TwinnedBody', { a: escape(caster.name), b: escape(ally.name) })}</p>`
        });
    },

    async [SPECIAL.cosmicInspire](action, config) {
        for (const t of resolveTargets(action, config, { fallbackSelf: false })) {
            await grantNextRoll(t, {
                name: 'Cosmic Inspiration (d20 Hope Die)',
                img: action.item.img,
                changes: [chg('system.rules.dualityRoll.defaultHopeDice', 20, 'override')]
            });
            await chatCard(action.actor, {
                title: 'Cosmic Inspiration',
                img: action.item.img,
                body: `<p>${loc('Auto.CosmicBody', { name: escape(t.name) })}</p>`
            });
        }
    },

    async [SPECIAL.sharedDreams](action, config) {
        const dreamers = resolveTargets(action, config, { includeSelf: true });
        const names = dreamers.map(d => d.name);
        for (const d of dreamers) {
            await asOwner(d, 'create', {
                type: 'ActiveEffect',
                data: [
                    effectBase('Shared Dream', action.item.img, {
                        duration: 'longRest',
                        description: `<p>${loc('Auto.SharedDreamHint', { names: names.filter(n => n !== d.name).map(escape).join(', ') })}</p>`,
                        flags: { sharedDream: dreamers.map(x => x.uuid) }
                    })
                ]
            });
        }
    },

    async [SPECIAL.archive](action) {
        const card = action.item;
        await card.update({ 'system.inVault': true });
        await chatCard(action.actor, {
            title: 'Archive of Possibilities',
            img: card.img,
            body: `<p>${loc('Auto.ArchiveBody')}</p>`
        });
    },

    async [SPECIAL.breakthrough](action, config) {
        if (!succeeded(config, 16)) return;
        await action.item.update({ 'system.inVault': true });
        await chatCard(action.actor, {
            title: 'Breakthrough',
            img: action.item.img,
            body: `<p>${loc('Auto.BreakthroughBody')}</p>`
        });
    },

    async [SPECIAL.useDevice](action, config) {
        const carrier = resolveTargets(action, config)[0];
        await grantNextRoll(carrier, { name: 'Crafted Device (+2)', img: action.item.img, bonus: 2 });
        await chatCard(action.actor, {
            title: 'Craftsmanship',
            img: action.item.img,
            body: `<p>${loc('Auto.DeviceUsed', { name: escape(carrier.name) })}</p>`
        });
    },

    async [SPECIAL.moonCreate](action) {
        await addCardTokens(action.item, 2);
    },

    async [SPECIAL.moonAdd](action) {
        await addCardTokens(action.item, 2);
    },

    async [SPECIAL.craftDevice](action) {
        await action.item.update({ 'system.resource.value': 1 });
        await chatCard(action.actor, { title: 'Craftsmanship', img: action.item.img, body: `<p>${loc('Auto.DeviceCrafted')}</p>` });
    },

    async [SPECIAL.rechargeDevice](action) {
        await action.item.update({ 'system.resource.value': 1 });
    },

    async [SPECIAL.moonEnd](action) {
        const card = action.item;
        await card.update({ 'system.resource.value': 0 });
        const field = action.actor.effects.filter(e => e.name === 'Moon Shield Field').map(e => e.id);
        if (field.length) await action.actor.deleteEmbeddedDocuments('ActiveEffect', field);
    },

    async [SPECIAL.gemology](action, config) {
        await chatCard(action.actor, {
            title: 'Gemology',
            img: action.item.img,
            body: `<p>${loc('Auto.GemologyBody', { names: resolveTargets(action, config).map(a => escape(a.name)).join(', ') })}</p>`
        });
    }
};

async function addCardTokens(item, n) {
    const value = (item.system.resource?.value ?? 0) + n;
    await item.update({ 'system.resource.value': value });
    await chatCard(item.actor, { title: item.name, img: item.img, body: `<p>${loc('Auto.TokensOnCard', { n, total: value })}</p>` });
}

const isWonderItem = item =>
    Boolean(item) && (item._stats?.compendiumSource?.includes(MOD) || item.system?.domain === 'wonder' || Object.keys(item.flags?.[MOD] ?? {}).length > 0);

/** Self-targeted effects of Wonder items are applied right away (same origin the system uses, so no duplicates). */
async function applySelfEffects(action) {
    const actor = action.actor;
    const item = action.item;
    if (!actor || !isWonderItem(item) || action.target?.type !== 'self') return;
    const ids = (action.effects ?? []).map(e => e._id);
    const toCreate = [];
    for (const id of ids) {
        const effect = item.effects.get(id);
        if (!effect || actor.effects.some(e => e.origin === effect.uuid)) continue;
        const data = effect.toObject();
        delete data._id;
        Object.assign(data, { origin: effect.uuid, transfer: false, disabled: false });
        toCreate.push(data);
    }
    if (toCreate.length) await actor.createEmbeddedDocuments('ActiveEffect', toCreate);
}

/** Fidgety Bolt leaps: read the Hope and Fear dice of the cast. */
async function fidgetyLeaps(action, config) {
    const r = config.evaluated;
    if (!r || !succeeded(config)) return;
    const hope = r.dHope?.total ?? 0;
    const fear = r.dFear?.total ?? 0;
    const leaps = [];
    if (hope >= 8) leaps.push(loc('Auto.FidgetyHope', { n: hope }));
    if (fear >= 8) leaps.push(loc('Auto.FidgetyFear', { n: fear }));
    if (!leaps.length) return;
    const prof = action.actor.system.proficiency ?? 1;
    const dmg = await roll(`${prof}d8 + 8`);
    const half = Math.floor(dmg.total / 2);
    await chatCard(action.actor, {
        title: 'Fidgety Bolt — Leap',
        img: action.item.img,
        body: `${leaps.map(l => `<p>⚡ ${l}</p>`).join('')}<p class="wonder-big">${half}</p><p>${loc('Auto.FidgetyHalf', { total: dmg.total, half })}</p>`,
        rolls: [dmg]
    });
}

export async function afterAction(action, config) {
    await applySelfEffects(action);
    const id = action?.id ?? action?._id;
    const handler = POST[id];
    if (handler) return handler(action, config);
    if (action?.item?.getFlag?.(MOD, 'fidgety') && action.type === 'attack' && action.roll?.type === 'spellcast')
        return fidgetyLeaps(action, config);
}

/* -------------------------------------------- */
/*  Range helpers                               */
/* -------------------------------------------- */

const DEFAULT_RANGES = { melee: 5, veryClose: 15, close: 30, far: 60, veryFar: 300 };

export function tokenOf(actor) {
    if (!canvas?.ready || !actor) return null;
    return actor.getActiveTokens?.(true)?.[0] ?? null;
}

/** True/false if both have tokens on the scene; null when it cannot be measured. */
export function withinRange(a, b, range) {
    if (a === b) return true;
    const ta = tokenOf(a), tb = tokenOf(b);
    if (!ta || !tb) return null;
    const settings = canvas.scene?.rangeSettings ?? {};
    const limit = settings[range] ?? DEFAULT_RANGES[range] ?? DEFAULT_RANGES.close;
    // Measure from the documents (placeables may still be animating after a move)
    // _source holds the final position; the live document interpolates while the token animates
    const center = t => {
        const d = t.document._source ?? t.document;
        return { x: d.x + (d.width * canvas.grid.size) / 2, y: d.y + (d.height * canvas.grid.size) / 2 };
    };
    const ca = center(ta), cb = center(tb);
    const raw = canvas.grid.measurePath([ca, cb]).distance;
    // edge-to-edge for larger tokens
    const pad = ((Math.max(ta.document.width, ta.document.height) - 1) + (Math.max(tb.document.width, tb.document.height) - 1)) * canvas.grid.distance / 2;
    return Math.max(0, raw - pad) <= limit;
}

/* -------------------------------------------- */
/*  Binary Stars / Out of Orbit / Gravity Pull  */
/* -------------------------------------------- */

const BINARY_EFFECT = 'wndBinaryStarEvs';

export const binaryRange = stargazer => (hasFlag(stargazer, 'outOfOrbit') ? 'far' : 'close');

export function binaryOf(stargazer) {
    const uuid = Stars.chartState(stargazer).binary;
    const a = uuid ? fromUuidSync(uuid) : null;
    return a instanceof Actor ? a : null;
}

export function binaryInRange(stargazer) {
    const binary = binaryOf(stargazer);
    if (!binary || !hasFlag(stargazer, 'binaryStars') || !Stars.inForm(stargazer)) return false;
    const inRange = withinRange(stargazer, binary, binaryRange(stargazer));
    return inRange !== false; // unknown positions count as in range
}

/** Create, update or remove the +1 Evasion effect on the Binary Star. */
export async function syncBinaryStar(stargazer) {
    if (!stargazer || stargazer.type !== 'character') return;
    const binary = binaryOf(stargazer);
    const active = Boolean(binary) && hasFlag(stargazer, 'binaryStars') && Stars.inForm(stargazer);
    // Remove stale effects on other actors
    for (const a of game.actors.filter(x => x.type === 'character' && x !== binary)) {
        const stale = a.effects.filter(e => e.getFlag(MOD, 'binaryOf') === stargazer.uuid).map(e => e.id);
        if (stale.length) await asOwner(a, 'delete', { type: 'ActiveEffect', ids: stale });
    }
    if (!binary) return;
    const existing = binary.effects.find(e => e.getFlag(MOD, 'binaryOf') === stargazer.uuid);
    if (!active) {
        if (existing) await asOwner(binary, 'delete', { type: 'ActiveEffect', ids: [existing.id] });
        return;
    }
    const inRange = binaryInRange(stargazer);
    if (!existing) {
        const data = effectBase(`Binary Star — ${stargazer.name}`, 'icons/magic/light/projectiles-star-purple.webp', {
            changes: [chg('system.evasion', 1)],
            description: `<p>${loc('Auto.BinaryHint', { name: escape(stargazer.name), range: binaryRange(stargazer) === 'far' ? 'Far' : 'Close' })}</p>`,
            duration: '',
            flags: { binaryOf: stargazer.uuid }
        });
        data.disabled = !inRange;
        await asOwner(binary, 'create', { type: 'ActiveEffect', data: [data] });
    } else if (existing.disabled === inRange) {
        await asOwner(existing, 'update', { data: { disabled: !inRange } });
    }
}

/** When a Binary Star marks Hit Points, offer Gravity Pull to its Stargazer. */
export async function onDamageTaken(actor, updates) {
    const hp = (updates ?? []).filter(u => u.key === 'hitPoints').reduce((a, u) => a + Number(u.value ?? 0), 0);
    if (hp <= 0) return;
    const stargazers = game.actors.filter(
        s => s.type === 'character' && s !== actor && Stars.chartState(s).binary === actor.uuid &&
            hasFlag(s, 'gravityPull') && Stars.astral(s) >= 2
    );
    for (const s of stargazers) {
        await chatCard(s, {
            title: 'Gravity Pull',
            img: 'icons/magic/sonic/projectile-sound-rings-wave.webp',
            body: `<p>${loc('Auto.GravityOffer', { name: escape(actor.name), n: hp })}</p>`,
            footer: `<button type="button" data-wonder-action="gravityPull" data-actor="${s.uuid}" data-target="${actor.uuid}">
                       <i class="fa-solid fa-magnet"></i> ${loc('Auto.GravityButton')}</button>`
        });
    }
}

export async function gravityPull(stargazer, target) {
    if (Stars.astral(stargazer) < 2) return ui.notifications.warn(loc('Auto.GravityNoTokens'));
    await Stars.adjustAstral(stargazer, -2);
    await target.modifyResource([{ key: 'hitPoints', value: -1, enabled: true }]);
    const ts = tokenOf(stargazer), tt = tokenOf(target);
    if (ts && tt && (ts.isOwner || game.user.isGM) && tt.document.isOwner) {
        // pull the Binary Star next to the Stargazer
        const dx = Math.sign(tt.document.x - ts.document.x) * canvas.grid.size;
        const dy = Math.sign(tt.document.y - ts.document.y) * canvas.grid.size;
        await tt.document.update({ x: ts.document.x + dx, y: ts.document.y + dy });
    }
    await chatCard(stargazer, {
        title: 'Gravity Pull',
        img: 'icons/magic/sonic/projectile-sound-rings-wave.webp',
        body: `<p>${loc('Auto.GravityDone', { name: escape(target.name) })}</p>`
    });
}

/* -------------------------------------------- */
/*  Harmonious Magic                            */
/* -------------------------------------------- */

export async function syncHarmonious(enchanter) {
    const feature = enchanter?.items?.find(i => i.getFlag(MOD, 'harmonious'));
    const effect = feature?.effects?.contents?.[0];
    if (!feature || !effect || !enchanter.isOwner) return;
    if (!(enchanter.system.isItemAvailable?.(feature) ?? true)) return;
    const records = Ench.enchantmentsOf(enchanter);
    let near = false;
    for (const r of records) {
        const bearer = r.bearerUuid ? fromUuidSync(r.bearerUuid) : null;
        if (!bearer) continue;
        if (bearer === enchanter || withinRange(enchanter, bearer, 'close') !== false) {
            near = true;
            break;
        }
    }
    if (effect.disabled === near) await effect.update({ disabled: !near });
}

/* -------------------------------------------- */
/*  Small Appreciation: level 1 Recall Cost -1  */
/* -------------------------------------------- */

export async function syncRecall(actor) {
    if (!actor?.isOwner || actor.type !== 'character') return;
    const active = hasFlag(actor, 'smallAppreciation');
    const updates = [];
    for (const card of actor.items.filter(i => i.type === 'domainCard' && i.system.level === 1)) {
        const original = card.getFlag(MOD, 'baseRecall');
        if (active && original === undefined) {
            updates.push({ _id: card.id, 'system.recallCost': Math.max(0, card.system.recallCost - 1), [`flags.${MOD}.baseRecall`]: card.system.recallCost });
        } else if (!active && original !== undefined) {
            updates.push({ _id: card.id, 'system.recallCost': original, [`flags.${MOD}.-=baseRecall`]: null });
        }
    }
    if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
}

/* -------------------------------------------- */
/*  Standard attack and Binary Stars            */
/* -------------------------------------------- */

export function skipAstralForBinary(stargazer, config) {
    const isStandard = config?.action?.id === (CONFIG.DH?.ACTOR?.standardAttackId ?? '000BASEATTACK000');
    return isStandard && binaryInRange(stargazer);
}

export { FORM_ITEM_ID, randomId, flagValues };
