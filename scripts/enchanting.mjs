import { MOD, SPECIAL, path, loc } from './constants.mjs';
import {
    DATA, hasFlag, flagValues, spellcast, tier, pay, chatCard, roll, resolveActor, asOwner, randomId,
    hopeValue, escape, availableItems
} from './util.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* -------------------------------------------- */
/*  Definitions & classification                */
/* -------------------------------------------- */

export const enchantmentDefs = () => DATA.enchantments.enchantments;
export const enchantmentDef = key => DATA.enchantments.enchantments.find(e => e.key === key);
const targetDef = key => DATA.enchantments.targets[key];

export function itemKinds(item) {
    if (!item) return new Set(['other']);
    const kinds = new Set([item.type]);
    if (item.type === 'weapon') {
        kinds.add(item.system.secondary ? 'secondary' : 'primary');
        const types = item.system.attack?.damage?.main?.type;
        if (types && [...types].includes('magical')) kinds.add('magicWeapon');
        if (item.system.secondary && (/shield/i.test(item.name) || item.system.itemFeatures?.protective)) kinds.add('shield');
    }
    return kinds;
}

export const itemHasFeature = item => Object.keys(item?.system?.itemFeatures ?? {}).length > 0;

export function enchantmentsOf(actor) {
    return foundry.utils.deepClone(actor.getFlag(MOD, 'enchantments') ?? []);
}

export function slots(actor) {
    return Math.max(1, ...flagValues(actor, 'enchantSlots').map(Number));
}

/** All enchantments currently on a given item (from any enchanter). */
function enchantedBy(item) {
    return item?.getFlag(MOD, 'enchantedBy') ?? null;
}

/**
 * Can `def` be placed on `item` by `enchanter`? Returns null if valid or a reason string.
 * `item` may be null for a free-form object.
 */
export function canEnchant(enchanter, def, item, { ignoreFeatures = false } = {}) {
    if (def.tier > tier(enchanter)) return loc('Ench.Reason.Tier', { tier: def.tier });
    const tdef = targetDef(def.target);
    // Free-form objects are trusted to match the requirement (the player describes the object)
    if (item && !tdef.kinds.some(k => itemKinds(item).has(k))) return loc('Ench.Reason.Kind', { kind: tdef.label });
    if (item && enchantedBy(item)) return loc('Ench.Reason.AlreadyEnchanted');
    if (item && !ignoreFeatures) {
        const overcharged = hasFlag(enchanter, 'overcharged');
        if (tdef.requiresFeature && !itemHasFeature(item)) return loc('Ench.Reason.NeedsFeature');
        if (tdef.noFeature && itemHasFeature(item) && !overcharged) return loc('Ench.Reason.HasFeature');
    }
    return null;
}

/* -------------------------------------------- */
/*  Applying                                    */
/* -------------------------------------------- */

function effectData(record, name, { img, description = '', changes = [], statuses = [], conditionals = [], transfer = true }) {
    const _id = randomId();
    record.effects.push(_id);
    return {
        _id,
        name,
        img: img ?? 'icons/magic/fire/dagger-rune-enchant-flame-strong-blue.webp',
        type: 'base',
        transfer,
        disabled: false,
        statuses,
        description,
        system: { changes, conditionals, duration: { description: '', type: 'scene' } },
        flags: { [MOD]: { enchantment: record.id } }
    };
}

const chg = (key, value, type = 'add') => ({ key, type, value, priority: null, phase: 'initial' });
const SAME_WEAPON_ATTACK = [
    { type: 'weaponRestriction', weaponType: 'sameWeapon' },
    { type: 'actionType', actionTypes: ['attack'], traits: [] }
];

function snapshotFeatures(item) {
    return Object.fromEntries(
        Object.entries(item.system.itemFeatures ?? {}).map(([k, f]) => [k, { value: f.value ?? k, config: f.config ?? {} }])
    );
}

/**
 * Apply the mechanics of one enchantment. Mutates `record` with what must be undone later.
 * @returns {string[]} notes for the chat card
 */
async function applyMechanic(def, ctx) {
    const { enchanter, item, bearer, record } = ctx;
    const notes = [];
    const host = item ?? bearer; // document that will hold the effect
    const reminder = async (extra = {}) => {
        if (!host) return;
        const name = def.feature?.name ? `${def.feature.name} (${def.name})` : def.name;
        const description = `<p>${def.feature?.text ?? def.text}</p>`;
        const data = effectData(record, name, { img: def.img, description, transfer: Boolean(item), ...extra });
        record.effectHosts.push(host.uuid);
        await asOwner(host, 'create', { type: 'ActiveEffect', data: [data], options: { keepId: true } });
    };
    const weapon = item?.type === 'weapon' ? item : null;
    const n = spellcast(enchanter);

    switch (def.mechanic) {
        case 'disableFeatures': {
            if (!item) break;
            record.snapshot.itemFeatures ??= snapshotFeatures(item);
            await asOwner(item, 'unsetFeatures', { ids: Object.keys(item.system.itemFeatures ?? {}) });
            notes.push(loc('Ench.Note.FeaturesIgnored'));
            break;
        }
        case 'armorBonus':
            await reminder({
                changes: [{ type: 'armor', priority: 20, phase: 'initial', value: { current: 0, max: '1', damageThresholds: null, interaction: 'none' } }]
            });
            break;
        case 'nativeFeature': {
            if (!weapon) {
                await reminder();
                break;
            }
            record.nativeFeatures.push(def.nativeFeature);
            await asOwner(weapon, 'update', {
                data: { [`system.itemFeatures.${def.nativeFeature}`]: { value: def.nativeFeature, config: {} } }
            });
            break;
        }
        case 'thresholds':
            await reminder({
                changes: [chg('system.damageThresholds.major', n), chg('system.damageThresholds.severe', n)],
                description: `<p>${def.text}</p><p>+${n} to damage thresholds.</p>`
            });
            break;
        case 'channeling':
            await reminder({
                changes: [chg('system.bonuses.roll.bonus', 1)],
                conditionals: [{ type: 'weaponRestriction', weaponType: 'sameWeapon' }, { type: 'actionType', actionTypes: ['spellcast'], traits: [] }]
            });
            break;
        case 'evasionPenalty': {
            const adversary = bearer?.type === 'adversary';
            await reminder({ changes: [chg(adversary ? 'system.difficulty' : 'system.evasion', -2)] });
            break;
        }
        case 'ignoreVulnerable':
            await reminder({ changes: [chg('system.rules.conditionImmunities.vulnerable', 1, 'override')] });
            break;
        case 'restrained':
            await reminder({ statuses: ['restrained'] });
            break;
        case 'searing':
            await reminder();
            if (bearer) {
                await bearer.modifyResource([{ key: 'stress', value: 1, enabled: true }]);
                notes.push(loc('Ench.Note.Searing', { name: escape(bearer.name) }));
            }
            break;
        case 'growth':
        case 'shrinking': {
            if (!weapon) {
                await reminder();
                break;
            }
            const burden = weapon.system.burden;
            const grow = def.mechanic === 'growth';
            const transforms = grow ? !weapon.system.secondary && burden === 'oneHanded' : burden === 'twoHanded';
            if (!transforms) {
                record.snapshot.equipped = weapon.system.equipped;
                await asOwner(weapon, 'update', { data: { 'system.equipped': false } });
                notes.push(loc(grow ? 'Ench.Note.TooBig' : 'Ench.Note.TooSmall', { name: escape(weapon.name) }));
                await reminder();
                break;
            }
            const bonus = weapon.system.attack?.damage?.main?.value?.bonus ?? 0;
            record.snapshot.itemFeatures ??= snapshotFeatures(weapon);
            record.snapshot.burden = burden;
            await asOwner(weapon, 'unsetFeatures', { ids: Object.keys(weapon.system.itemFeatures ?? {}) });
            if (grow) {
                record.snapshot.damageBonus = bonus;
                record.nativeFeatures.push('powerful');
                await asOwner(weapon, 'update', {
                    data: {
                        'system.burden': 'twoHanded',
                        'system.attack.damage.main.value.bonus': (bonus || 0) + n,
                        'system.itemFeatures.powerful': { value: 'powerful', config: {} }
                    }
                });
                notes.push(loc('Ench.Note.Grown', { n }));
            } else {
                await asOwner(weapon, 'update', { data: { 'system.burden': 'oneHanded' } });
                const data = effectData(record, 'Unreliable (Shrinking Enchantment)', {
                    img: def.img,
                    description: '<p>−2 to attack and damage rolls.</p>',
                    changes: [chg('system.bonuses.roll.bonus', -2), chg('system.bonuses.damage.bonus', -2)],
                    conditionals: SAME_WEAPON_ATTACK
                });
                record.effectHosts.push(weapon.uuid);
                await asOwner(weapon, 'create', { type: 'ActiveEffect', data: [data], options: { keepId: true } });
                notes.push(loc('Ench.Note.Shrunk'));
            }
            break;
        }
        case 'exploding': {
            const state = { value: 8, enchantment: record.id, object: record.objectName };
            await enchanter.setFlag(MOD, 'explosion', state);
            notes.push(loc('Ench.Note.Explosion'));
            break;
        }
        default:
            await reminder();
    }
    return notes;
}

async function applyEnchanterBonuses(enchanter, weapon, record, { useSpellcast }) {
    if (!weapon || weapon.type !== 'weapon') return [];
    const notes = [];
    if (useSpellcast && hasFlag(enchanter, 'magicWeapons') && weapon.parent === enchanter) {
        record.snapshot.trait = weapon.system.attack?.roll?.trait ?? null;
        await asOwner(weapon, 'update', { data: { 'system.attack.roll.trait': 'spellcast' } });
        notes.push(loc('Ench.Note.MagicWeapons'));
    }
    if (hasFlag(enchanter, 'smallAppreciation')) {
        const n = enchanter.items.filter(
            i => i.type === 'domainCard' && !i.system.inVault && i.system.level === 1 && i.system.type === 'spell'
        ).length;
        if (n > 0) {
            const data = effectData(record, `Small Appreciation (+${n})`, {
                img: 'icons/commodities/gems/gem-fragments-blue.webp',
                changes: [chg('system.bonuses.damage.bonus', n)],
                conditionals: SAME_WEAPON_ATTACK
            });
            record.effectHosts.push(weapon.uuid);
            await asOwner(weapon, 'create', { type: 'ActiveEffect', data: [data], options: { keepId: true } });
            notes.push(loc('Ench.Note.SmallAppreciation', { n }));
        }
    }
    return notes;
}

/**
 * Place an enchantment.
 * @param {Actor} enchanter
 * @param {object} opts
 * @param {string} opts.key            enchantment key
 * @param {Item}   [opts.item]         embedded item to enchant
 * @param {string} [opts.objectName]   free-form object name when no item
 * @param {Actor}  [opts.bearer]       creature holding/wearing a free-form object
 * @param {boolean} [opts.surge]       pay with Ingenious Surge (3 Hope) instead of a Stress
 * @param {string[]} [opts.combine]    two keys for Combining Enchantment (in order)
 * @param {boolean} [opts.adversary]   object held by an adversary: Spellcast Roll required
 * @param {boolean} [opts.useSpellcast] Spellweaver: use Spellcast trait with this weapon
 */
export async function placeEnchantment(enchanter, opts) {
    const def = enchantmentDef(opts.key);
    if (!def) return;
    const item = opts.item ?? null;
    const bearer = opts.bearer ?? (item?.parent instanceof Actor ? item.parent : null);
    const objectName = item?.name ?? (opts.objectName?.trim() || loc('Ench.SomeObject'));

    // Validate
    const reason = canEnchant(enchanter, def, item, { ignoreFeatures: def.mechanic === 'combining' });
    if (reason) return ui.notifications.warn(reason);
    if (def.mechanic === 'combining' && (opts.combine?.length !== 2 || opts.combine[0] === opts.combine[1]))
        return ui.notifications.warn(loc('Ench.Reason.CombineTwo'));

    // Pay
    const surge = Boolean(opts.surge);
    if (!(await pay(enchanter, surge ? { hope: 3 } : { stress: 1 }))) return;

    // Limits: placing a new (non-surge) enchantment ends the oldest when slots are full
    let records = enchantmentsOf(enchanter);
    const ended = [];
    if (!surge) {
        const counted = records.filter(r => !r.surge);
        while (counted.length >= slots(enchanter)) {
            const old = counted.shift();
            await endEnchantment(enchanter, old.id, { silent: true });
            ended.push(old.objectName);
        }
        records = enchantmentsOf(enchanter);
    }

    const record = {
        id: randomId(),
        key: def.key,
        name: def.name,
        tier: def.tier,
        img: def.img,
        combine: def.mechanic === 'combining' ? opts.combine : null,
        itemUuid: item?.uuid ?? null,
        bearerUuid: bearer?.uuid ?? null,
        objectName,
        surge,
        effects: [],
        effectHosts: [],
        snapshot: {},
        nativeFeatures: [],
        created: Date.now()
    };

    if (item) await asOwner(item, 'update', { data: { [`flags.${MOD}.enchantedBy`]: { actor: enchanter.uuid, id: record.id } } });

    const notes = [];
    const parts = def.mechanic === 'combining' ? opts.combine.map(enchantmentDef) : [def];
    for (const part of parts) {
        // Re-read the item between parts (Clearing first can make it eligible for Swift, etc.)
        const fresh = item ? await fromUuid(item.uuid) : null;
        notes.push(...(await applyMechanic(part, { enchanter, item: fresh, bearer, record })));
    }
    notes.push(...(await applyEnchanterBonuses(enchanter, item, record, { useSpellcast: opts.useSpellcast })));

    records.push(record);
    await enchanter.setFlag(MOD, 'enchantments', records);

    // Creative Flow: regain Spellweave
    if (hasFlag(enchanter, 'creativeFlow')) {
        const sw = enchanter.items.find(i => i.system.actions?.get?.(SPECIAL.spellweave) || i.system.actions?.[SPECIAL.spellweave]);
        if (sw) {
            await sw.update({ [`system.actions.${SPECIAL.spellweave}.uses.value`]: 0 });
            notes.push(loc('Ench.Note.CreativeFlow'));
        }
    }

    const partNames = parts.length > 1 ? ` (${parts.map(p => p.name).join(' → ')})` : '';
    await chatCard(enchanter, {
        title: `${def.name}${partNames}`,
        img: def.img,
        body: `<p>${loc('Ench.Placed', { object: escape(objectName) })}${bearer && bearer !== enchanter ? ` — <em>${escape(bearer.name)}</em>` : ''}</p>
               <p class="wonder-cost">${surge ? loc('Ench.PaidSurge') : loc('Ench.PaidStress')}</p>
               ${ended.length ? `<p>${loc('Ench.Ended', { list: ended.map(escape).join(', ') })}</p>` : ''}
               ${notes.map(n => `<p>✦ ${n}</p>`).join('')}
               <blockquote>${parts.map(p => p.text).join('<hr>')}</blockquote>`,
        flags: { enchantment: record.id }
    });

    if (opts.adversary) {
        const feature = enchanter.items.find(i => i.getFlag?.(MOD, 'enchantAdversary') || i.name === 'Magical Enchantments');
        const action = feature?.system.actions?.find?.(a => a.type === 'attack');
        if (action) await action.use(new Event('click'));
        else ui.notifications.info(loc('Ench.RollSpellcast'));
    }
    return record;
}

export async function endEnchantment(enchanter, id, { silent = false } = {}) {
    const records = enchantmentsOf(enchanter);
    const record = records.find(r => r.id === id);
    if (!record) return;

    // Remove effects
    const byHost = {};
    record.effects.forEach((eid, i) => {
        const host = record.effectHosts[i];
        if (host) (byHost[host] ??= []).push(eid);
    });
    for (const [hostUuid, ids] of Object.entries(byHost)) {
        const host = await fromUuid(hostUuid);
        if (!host) continue;
        const existing = ids.filter(e => host.effects.has(e));
        if (existing.length) await asOwner(host, 'delete', { type: 'ActiveEffect', ids: existing });
    }

    const item = record.itemUuid ? await fromUuid(record.itemUuid) : null;
    if (item) {
        if (record.nativeFeatures.length) await asOwner(item, 'unsetFeatures', { ids: record.nativeFeatures });
        const snap = record.snapshot ?? {};
        const update = { [`flags.${MOD}.enchantedBy`]: null };
        if (snap.burden) update['system.burden'] = snap.burden;
        if ('damageBonus' in snap) update['system.attack.damage.main.value.bonus'] = snap.damageBonus;
        if ('equipped' in snap) update['system.equipped'] = snap.equipped;
        if ('trait' in snap) update['system.attack.roll.trait'] = snap.trait;
        if (snap.itemFeatures)
            for (const [k, f] of Object.entries(snap.itemFeatures)) update[`system.itemFeatures.${k}`] = f;
        await asOwner(item, 'update', { data: update });
    }

    if (record.key === 'exploding' || record.combine?.includes('exploding')) await enchanter.unsetFlag(MOD, 'explosion');
    const explosion = enchanter.getFlag(MOD, 'explosion');
    if (explosion?.enchantment === record.id) await enchanter.unsetFlag(MOD, 'explosion');

    await enchanter.setFlag(MOD, 'enchantments', records.filter(r => r.id !== id));
    if (!silent)
        await chatCard(enchanter, {
            title: loc('Ench.EndTitle', { name: record.name }),
            img: record.img,
            body: `<p>${loc('Ench.EndBody', { object: escape(record.objectName) })}</p>`
        });
}

export async function endAll(enchanter) {
    for (const r of enchantmentsOf(enchanter)) await endEnchantment(enchanter, r.id, { silent: true });
    await chatCard(enchanter, {
        title: loc('Ench.EndAllTitle'),
        img: 'icons/magic/symbols/ring-circle-smoke-blue.webp',
        body: `<p>${loc('Ench.EndAllBody')}</p>`
    });
}

/* -------------------------------------------- */
/*  Explosion countdown                         */
/* -------------------------------------------- */

export async function changeExplosion(enchanter, delta, { hope = false } = {}) {
    const state = enchanter.getFlag(MOD, 'explosion');
    if (!state) return;
    if (hope && !(await pay(enchanter, { hope: 1 }))) return;
    const value = state.value + delta;
    if (value <= 0) return detonate(enchanter, state);
    await enchanter.setFlag(MOD, 'explosion', { ...state, value: Math.min(8, value) });
}

async function detonate(enchanter, state) {
    await enchanter.unsetFlag(MOD, 'explosion');
    const r = await roll('3d10+6');
    await chatCard(enchanter, {
        title: loc('Ench.BoomTitle'),
        img: 'icons/magic/fire/explosion-fireball-large-red-orange.webp',
        body: `<p>${loc('Ench.BoomBody', { object: escape(state.object), total: r.total, half: Math.floor(r.total / 2) })}</p>`,
        rolls: [r]
    });
    if (state.enchantment) await endEnchantment(enchanter, state.enchantment, { silent: true });
}

/** Called for every new chat message on the responsible client: tick the Explosion die on action rolls. */
export async function onChatRoll(message) {
    if (!['dualityRoll', 'adversaryRoll'].includes(message.type)) return;
    // Ability messages without a roll share these types: only real d20/duality action rolls count
    const D20 = game.system.api?.dice?.D20Roll;
    const roll = message.rolls?.find(r => (D20 ? r instanceof D20 : /d20|d12/.test(r.formula)) && r.dice?.length);
    if (!roll) return;
    const opts = roll.options ?? {};
    if (opts.roll?.type === 'reaction' || opts.actionType === 'reaction' || message.system?.roll?.options?.roll?.type === 'reaction') return;
    const holders = game.actors.filter(a => a.getFlag(MOD, 'explosion'));
    for (const actor of holders) {
        const responsible = game.users.activeGM ?? game.users.find(u => u.active && actor.testUserPermission(u, 'OWNER'));
        if (responsible?.id !== game.user.id) continue;
        await changeExplosion(actor, -1);
    }
}

/* -------------------------------------------- */
/*  Fearless automation                         */
/* -------------------------------------------- */

export async function onFearlessAttack(config) {
    const item = config?.action?.item;
    if (!item || item.type !== 'weapon') return;
    const enchanted = item.effects.some(e => e.name?.startsWith('Fearless'));
    if (!enchanted) return;
    const r = config.evaluated ?? config.roll;
    if (!r?.withFear || config.roll?.success === false) return;
    const d6 = await roll('1d6');
    await chatCard(config.actor, {
        title: 'Fearless',
        img: 'icons/magic/fire/flame-burning-eye.webp',
        body: `<p>${d6.total === 6 ? loc('Ench.FearlessYes') : loc('Ench.FearlessNo')}</p>`,
        rolls: [d6]
    });
}

/* -------------------------------------------- */
/*  Workshop application                        */
/* -------------------------------------------- */

export class WorkshopApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(actor, options = {}) {
        super({ id: `wonder-workshop-${actor.id}`, ...options });
        this.actor = actor;
        this.selected = options.selected ?? null;
        this.targetUuid = null;
        this.surge = Boolean(options.surge);
        this.tierTab = null;
        this.combine = ['', ''];
        this.objectName = '';
        this.adversary = false;
        this.useSpellcast = true;
    }

    static DEFAULT_OPTIONS = {
        classes: ['wonder-app', 'wonder-workshop'],
        window: { icon: 'fa-solid fa-wand-sparkles', resizable: true },
        position: { width: 1040, height: 720 },
        actions: {
            select: WorkshopApp.#onSelect,
            tierTab: WorkshopApp.#onTab,
            target: WorkshopApp.#onTarget,
            surge: WorkshopApp.#onSurge,
            enchant: WorkshopApp.#onEnchant,
            end: WorkshopApp.#onEnd,
            endAll: WorkshopApp.#onEndAll,
            boom: WorkshopApp.#onBoom
        }
    };

    static PARTS = { main: { template: path('templates/workshop.hbs'), scrollable: ['.wonder-cards', '.wonder-targets'] } };

    get title() {
        return `${loc('Ench.Title')} — ${this.actor.name}`;
    }

    _candidateItems() {
        const own = this.actor.items.filter(i => ['weapon', 'armor', 'loot', 'consumable'].includes(i.type));
        const targeted = [...(game.user.targets ?? [])]
            .map(t => t.actor)
            .filter(a => a && a !== this.actor);
        const others = targeted.flatMap(a => a.items.filter(i => ['weapon', 'armor', 'loot', 'consumable'].includes(i.type)));
        return [...own, ...others];
    }

    async _prepareContext() {
        const actor = this.actor;
        const t = tier(actor);
        this.tierTab ??= t;
        const def = this.selected ? enchantmentDef(this.selected) : null;
        const records = enchantmentsOf(actor);
        const used = records.filter(r => !r.surge).length;
        const maxSlots = slots(actor);

        const cards = enchantmentDefs()
            .filter(e => e.tier === this.tierTab)
            .map(e => ({
                ...e,
                locked: e.tier > t,
                selected: e.key === this.selected,
                targetLabel: targetDef(e.target).label,
                featureName: e.feature?.name
            }));

        const tabs = [1, 2, 3, 4].map(n => ({ n, active: n === this.tierTab, locked: n > t }));

        const targets = def
            ? this._candidateItems().map(item => {
                  const reason = canEnchant(actor, def, item, {
                      ignoreFeatures: def.mechanic === 'combining'
                  });
                  return {
                      uuid: item.uuid,
                      name: item.name,
                      img: item.img,
                      owner: item.parent?.name,
                      own: item.parent === actor,
                      type: game.i18n.localize(`TYPES.Item.${item.type}`),
                      features: Object.keys(item.system.itemFeatures ?? {}).join(', '),
                      equipped: item.system.equipped,
                      reason,
                      valid: !reason,
                      selected: item.uuid === this.targetUuid
                  };
              })
            : [];
        targets.sort((a, b) => Number(b.valid) - Number(a.valid));
        const freeAllowed = def ? !canEnchant(actor, def, null) : false;
        const bearerToken = [...(game.user.targets ?? [])][0];

        const combineOptions = enchantmentDefs()
            .filter(e => e.tier <= Math.min(3, t) && e.key !== 'combining')
            .map(e => ({ key: e.key, name: `T${e.tier} · ${e.name}` }));

        const explosion = actor.getFlag(MOD, 'explosion');
        const selectedTarget = this.targetUuid ? fromUuidSync(this.targetUuid) : null;

        return {
            actor,
            tier: t,
            spellcast: spellcast(actor),
            hope: hopeValue(actor),
            stress: actor.system.resources?.stress,
            slotsPips: Array.from({ length: maxSlots }, (_, i) => ({ on: i < used })),
            used,
            maxSlots,
            records: records.map(r => ({ ...r, combineNames: r.combine?.map(k => enchantmentDef(k)?.name).join(' → ') })),
            tabs,
            cards,
            def,
            defTargetLabel: def ? targetDef(def.target).label : '',
            isCombining: def?.mechanic === 'combining',
            combineOptions,
            combine: this.combine,
            targets,
            freeAllowed,
            objectName: this.objectName,
            freeSelected: this.targetUuid === 'free',
            bearerName: bearerToken?.actor?.name ?? null,
            adversary: this.adversary,
            surge: this.surge,
            canSurge: hopeValue(actor) >= 3,
            hasMagicWeapons: hasFlag(actor, 'magicWeapons') && selectedTarget?.type === 'weapon' && selectedTarget.parent === actor,
            useSpellcast: this.useSpellcast,
            canEnchant: Boolean(def && this.targetUuid && (this.targetUuid !== 'free' || freeAllowed)),
            explosion,
            explosionFaces: explosion ? Array.from({ length: 8 }, (_, i) => ({ n: i + 1, on: i + 1 <= explosion.value })) : [],
            expanded: maxSlots > 1
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        const el = this.element;
        el.querySelector('input[name="objectName"]')?.addEventListener('input', ev => (this.objectName = ev.target.value));
        el.querySelector('input[name="adversary"]')?.addEventListener('change', ev => (this.adversary = ev.target.checked));
        el.querySelector('input[name="useSpellcast"]')?.addEventListener('change', ev => (this.useSpellcast = ev.target.checked));
        el.querySelectorAll('select[name^="combine"]').forEach(sel =>
            sel.addEventListener('change', ev => {
                this.combine[Number(ev.target.dataset.index)] = ev.target.value;
            })
        );
    }

    static #onSelect(_e, target) {
        this.selected = target.dataset.key;
        this.targetUuid = null;
        this.render();
    }

    static #onTab(_e, target) {
        this.tierTab = Number(target.dataset.tier);
        this.render();
    }

    static #onTarget(_e, target) {
        this.targetUuid = target.dataset.uuid;
        this.render();
    }

    static #onSurge(_e, target) {
        this.surge = target.dataset.value === 'true';
        this.render();
    }

    static async #onEnchant() {
        if (!this.selected || !this.targetUuid) return;
        const item = this.targetUuid === 'free' ? null : await fromUuid(this.targetUuid);
        const bearer = item ? null : [...(game.user.targets ?? [])][0]?.actor ?? null;
        const done = await placeEnchantment(this.actor, {
            key: this.selected,
            item,
            bearer,
            objectName: this.objectName,
            surge: this.surge,
            combine: this.combine.filter(Boolean),
            adversary: this.adversary || bearer?.type === 'adversary',
            useSpellcast: this.useSpellcast
        });
        if (done) {
            this.targetUuid = null;
            this.surge = false;
            this.render();
        }
    }

    static async #onEnd(_e, target) {
        await endEnchantment(this.actor, target.dataset.id);
    }

    static async #onEndAll() {
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: loc('Ench.EndAllTitle') },
            content: `<p>${loc('Ench.EndAllConfirm')}</p>`
        });
        if (ok) await endAll(this.actor);
    }

    static async #onBoom(_e, target) {
        await changeExplosion(this.actor, Number(target.dataset.delta), { hope: target.dataset.hope === 'true' });
    }
}

export function openWorkshop(actor, options = {}) {
    actor = resolveActor(actor);
    if (!actor) return ui.notifications.warn(loc('Notify.NoActor'));
    const id = `wonder-workshop-${actor.id}`;
    let app = foundry.applications.instances.get(id);
    if (!app) app = new WorkshopApp(actor, options);
    else if (options.surge) app.surge = true;
    return app.render({ force: true });
}

/* -------------------------------------------- */
/*  Mystic Appraisal                            */
/* -------------------------------------------- */

export async function appraise(actor) {
    actor = resolveActor(actor);
    const targets = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
    if (!targets.length) return ui.notifications.info(loc('Ench.AppraiseHint'));
    for (const target of targets) {
        const magical = target.items.filter(
            i =>
                i.getFlag(MOD, 'enchantedBy') ||
                (i.type === 'weapon' && [...(i.system.attack?.damage?.main?.type ?? [])].includes('magical')) ||
                Object.keys(i.system.itemFeatures ?? {}).length ||
                i.effects.size
        );
        const creature = target.type === 'adversary' || target.type === 'environment'
            ? target.items.filter(i => i.type === 'feature').map(i => `<li><em>${escape(i.name)}</em></li>`).join('')
            : '';
        const magicAttack = [...(target.system.attack?.damage?.main?.type ?? [])].includes('magical');
        const list = magical
            .map(i => {
                const feats = Object.keys(i.system.itemFeatures ?? {}).join(', ');
                const ench = i.getFlag(MOD, 'enchantedBy') ? ` <span class="wonder-chip">${loc('Ench.Enchanted')}</span>` : '';
                return `<li><strong>${escape(i.name)}</strong>${feats ? ` — ${escape(feats)}` : ''}${ench}</li>`;
            })
            .join('');
        await chatCard(actor, {
            title: `Mystic Appraisal — ${escape(target.name)}`,
            img: 'icons/magic/perception/eye-ringed-glow-angry-small-teal.webp',
            body: (list ? `<ul>${list}</ul>` : `<p>${loc('Ench.NothingMagical')}</p>`) +
                (magicAttack ? `<p>✦ ${loc('Ench.MagicAttack')}</p>` : '') +
                (creature ? `<p>${loc('Ench.CreatureFeatures')}</p><ul>${creature}</ul>` : '')
        });
    }
}
