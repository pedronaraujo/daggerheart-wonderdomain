import { MOD, LOOT_TABLES, path, loc } from './constants.mjs';
import {
    flagValues, hasFlag, tier, pay, gain, chatCard, roll, resolveActor, escape, availableItems
} from './util.mjs';

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/* ============================================ */
/*  Creative Tinkering                           */
/* ============================================ */

async function lootOptions(max) {
    const out = [];
    for (const uuid of LOOT_TABLES) {
        const table = await fromUuid(uuid).catch(() => null);
        if (!table) continue;
        for (const r of table.results) {
            const n = r.range?.[0] ?? 0;
            if (n > max || !r.documentUuid) continue;
            out.push({ n, name: r.name || r.text, img: r.img, uuid: r.documentUuid, table: table.name });
        }
    }
    return out.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

export class TinkeringApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(actor, options = {}) {
        super({ id: `wonder-tinkering-${actor.id}`, ...options });
        this.actor = actor;
        this.handfuls = 1;
        this.result = null;
        this.options_ = [];
    }

    static DEFAULT_OPTIONS = {
        classes: ['wonder-app', 'wonder-tinkering'],
        window: { icon: 'fa-solid fa-gears', resizable: true },
        position: { width: 620, height: 640 },
        actions: { roll: TinkeringApp.#onRoll, craft: TinkeringApp.#onCraft, step: TinkeringApp.#onStep, reset: TinkeringApp.#onReset }
    };

    static PARTS = { main: { template: path('templates/tinkering.hbs'), scrollable: ['.wonder-loot'] } };

    get title() {
        return `${loc('Tinker.Title')} — ${this.actor.name}`;
    }

    async _prepareContext() {
        const t = tier(this.actor);
        this.handfuls = Math.min(Math.max(1, this.handfuls), t);
        const extra = flagValues(this.actor, 'tinkerExtraDie').reduce((a, b) => a + Number(b || 0), 0);
        return {
            tier: t,
            handfuls: this.handfuls,
            gold: this.actor.system.gold?.handfuls ?? 0,
            dice: this.handfuls + extra,
            extra,
            result: this.result,
            loot: this.options_,
            temps: this.actor.items.filter(i => i.getFlag(MOD, 'temporaryCopy')).map(i => ({ name: i.name, img: i.img }))
        };
    }

    static #onStep(_e, target) {
        this.handfuls += Number(target.dataset.delta);
        this.render();
    }

    static async #onRoll() {
        const gold = this.actor.system.gold?.handfuls ?? 0;
        if (gold < this.handfuls) return ui.notifications.warn(loc('Tinker.NoGold', { n: this.handfuls }));
        const extra = flagValues(this.actor, 'tinkerExtraDie').reduce((a, b) => a + Number(b || 0), 0);
        await this.actor.update({ 'system.gold.handfuls': gold - this.handfuls });
        const r = await roll(`${this.handfuls + extra}d8`);
        this.result = { total: r.total, dice: r.dice[0]?.results.map(x => x.result) ?? [] };
        this.options_ = await lootOptions(r.total);
        await chatCard(this.actor, {
            title: 'Creative Tinkering',
            img: 'icons/commodities/tech/cog-brass.webp',
            body: `<p>${loc('Tinker.Rolled', { gold: this.handfuls, total: r.total })}</p>`,
            rolls: [r]
        });
        this.render();
    }

    static async #onCraft(_e, target) {
        const source = await fromUuid(target.dataset.uuid);
        if (!source) return;
        const data = source.toObject();
        delete data._id;
        data.name = `${source.name} ✦`;
        data.system.description =
            `<p><em>${loc('Tinker.CopyNote')}</em></p>` + (data.system.description ?? '');
        foundry.utils.setProperty(data, `flags.${MOD}.temporaryCopy`, true);
        await this.actor.createEmbeddedDocuments('Item', [data]);
        await chatCard(this.actor, {
            title: loc('Tinker.Crafted'),
            img: source.img,
            body: `<p>${loc('Tinker.CraftedBody', { name: escape(source.name) })}</p>`
        });
        this.result = null;
        this.options_ = [];
        this.render();
    }

    static async #onReset() {
        const temps = this.actor.items.filter(i => i.getFlag(MOD, 'temporaryCopy')).map(i => i.id);
        if (temps.length) await this.actor.deleteEmbeddedDocuments('Item', temps);
        this.render();
    }
}

export function openTinkering(actor) {
    actor = resolveActor(actor);
    if (!actor) return ui.notifications.warn(loc('Notify.NoActor'));
    const app = foundry.applications.instances.get(`wonder-tinkering-${actor.id}`) ?? new TinkeringApp(actor);
    return app.render({ force: true });
}

/* ============================================ */
/*  Glimpse Beyond                               */
/* ============================================ */

export const glimpseItem = actor => availableItems(actor).find(i => i.getFlag(MOD, 'glimpse'));

export function glimpseConfig(actor) {
    const faces = flagValues(actor, 'glimpseFaces')[0] ?? 'd4';
    const count = 2 + flagValues(actor, 'glimpseExtra').reduce((a, b) => a + Number(b || 0), 0);
    return { faces, count };
}

export function glimpseDice(actor) {
    const item = glimpseItem(actor);
    const states = item?.system.resource?.diceStates ?? {};
    return Object.entries(states).map(([k, s]) => ({ key: k, value: s.value, used: s.used }));
}

export async function rollGlimpse(actor) {
    const item = glimpseItem(actor);
    if (!item) return ui.notifications.warn(loc('Glimpse.NoFeature'));
    const { faces, count } = glimpseConfig(actor);
    const r = await roll(`${count}${faces}`);
    const values = r.dice[0].results.map(x => x.result);
    await item.update({
        'system.resource.max': String(count),
        'system.resource.dieFaces': faces,
        'system.resource.diceStates': _replace(Object.fromEntries(values.map((v, i) => [String(i), { value: v, used: false }])))
    });
    await chatCard(actor, {
        title: 'Glimpse Beyond',
        img: 'icons/magic/perception/orb-crystal-ball-scrying-blue.webp',
        body: `<p>${loc('Glimpse.Rolled', { dice: values.join(', ') })}</p>`,
        rolls: [r]
    });
}

export async function rerollGlimpse(actor) {
    const item = glimpseItem(actor);
    if (!item) return;
    const { faces } = glimpseConfig(actor);
    const remaining = glimpseDice(actor).filter(d => !d.used);
    if (!remaining.length) return;
    const r = await roll(`${remaining.length}${faces}`);
    const values = r.dice[0].results.map(x => x.result);
    const update = {};
    remaining.forEach((d, i) => (update[`system.resource.diceStates.${d.key}.value`] = values[i]));
    await item.update(update);
    await chatCard(actor, {
        title: 'Written in the Stars',
        img: 'icons/magic/symbols/runes-star-orange-purple.webp',
        body: `<p>${loc('Glimpse.Rerolled', { dice: values.join(', ') })}</p>`,
        rolls: [r]
    });
}

export async function spendGlimpse(actor, key, sign) {
    const item = glimpseItem(actor);
    const die = glimpseDice(actor).find(d => d.key === key);
    if (!item || !die || die.used) return;
    await item.update({ [`system.resource.diceStates.${key}.used`]: true });
    const target = [...(game.user.targets ?? [])][0]?.name;
    await chatCard(actor, {
        title: 'Glimpse Beyond',
        img: 'icons/magic/perception/orb-crystal-ball-scrying-blue.webp',
        body: `<p class="wonder-big">${sign > 0 ? '+' : '−'}${die.value}</p>
               <p>${loc(sign > 0 ? 'Glimpse.Raised' : 'Glimpse.Lowered', { n: die.value, target: escape(target ?? loc('Glimpse.TheRoll')) })}</p>`
    });
}

export async function discardGlimpse(actor) {
    const item = glimpseItem(actor);
    if (!item) return;
    await item.update({ 'system.resource.diceStates': _replace({}) });
}

export class GlimpseApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(actor, options = {}) {
        super({ id: `wonder-glimpse-${actor.id}`, ...options });
        this.actor = actor;
    }

    static DEFAULT_OPTIONS = {
        classes: ['wonder-app', 'wonder-glimpse'],
        window: { icon: 'fa-solid fa-eye', resizable: false },
        position: { width: 420, height: 'auto' },
        actions: {
            roll: GlimpseApp.#onRoll,
            spend: GlimpseApp.#onSpend,
            reroll: GlimpseApp.#onReroll,
            discard: GlimpseApp.#onDiscard
        }
    };

    static PARTS = { main: { template: path('templates/glimpse.hbs') } };

    get title() {
        return `Glimpse Beyond — ${this.actor.name}`;
    }

    async _prepareContext() {
        const cfg = glimpseConfig(this.actor);
        return {
            ...cfg,
            dice: glimpseDice(this.actor),
            hasFeature: Boolean(glimpseItem(this.actor)),
            canReroll: hasFlag(this.actor, 'glimpseFaces'),
            target: [...(game.user.targets ?? [])][0]?.name ?? null
        };
    }

    static async #onRoll() {
        await rollGlimpse(this.actor);
    }
    static async #onSpend(_e, target) {
        await spendGlimpse(this.actor, target.dataset.key, Number(target.dataset.sign));
    }
    static async #onReroll() {
        await rerollGlimpse(this.actor);
    }
    static async #onDiscard() {
        await discardGlimpse(this.actor);
    }
}

export function openGlimpse(actor) {
    actor = resolveActor(actor);
    if (!actor) return ui.notifications.warn(loc('Notify.NoActor'));
    const app = foundry.applications.instances.get(`wonder-glimpse-${actor.id}`) ?? new GlimpseApp(actor);
    return app.render({ force: true });
}

/* ============================================ */
/*  Domain card helpers                          */
/* ============================================ */

export async function moonShieldReduce(actor, item) {
    const tokens = item.system.resource?.value ?? 0;
    if (!tokens) return ui.notifications.warn(loc('Moon.NoTokens'));
    const n = await DialogV2.prompt({
        window: { title: loc('Moon.Title') },
        content: `<p>${loc('Moon.Prompt', { n: tokens })}</p>
                  <input type="number" name="n" min="1" max="${tokens}" value="1" autofocus>`,
        ok: { callback: (_e, button) => Number(button.form.elements.n.value) }
    }).catch(() => null);
    if (!n) return;
    const spend = Math.max(1, Math.min(tokens, n));
    await item.update({ 'system.resource.value': tokens - spend });
    const r = await roll(`${spend}d6`);
    await chatCard(actor, {
        title: 'Moon Shield',
        img: 'icons/creatures/birds/raptor-owl-flying-moon.webp',
        body: `<p class="wonder-big">−${r.total}</p><p>${loc('Moon.Reduced', { n: spend, total: r.total })}</p>`,
        rolls: [r]
    });
}

export async function workOnMasterpiece(actor, item) {
    const r = await roll('1d10');
    const before = item.system.resource?.value ?? 0;
    const after = before + r.total;
    await item.update({ 'system.resource.value': Math.min(after, 100) });
    await gain(actor, { hope: 1 });
    const done = after >= 100;
    await chatCard(actor, {
        title: 'Masterpiece',
        img: 'icons/commodities/treasure/crown-gold-satin-gems-red.webp',
        body: `<p>${loc('Masterpiece.Progress', { roll: r.total, value: Math.min(after, 100) })}</p>${done ? `<p><strong>${loc('Masterpiece.Done')}</strong></p>` : ''}`,
        rolls: [r]
    });
    if (!done) return;
    const traits = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'];
    const options = traits.map(t => `<option value="${t}">${t.capitalize()}</option>`).join('');
    const trait = await DialogV2.prompt({
        window: { title: 'Masterpiece' },
        content: `<p>${loc('Masterpiece.ChooseTrait')}</p><select name="trait">${options}</select>`,
        ok: { callback: (_e, button) => button.form.elements.trait.value }
    }).catch(() => null);
    if (!trait) return;
    await item.createEmbeddedDocuments('ActiveEffect', [
        {
            name: `Masterpiece (+1 ${trait.capitalize()})`,
            img: 'icons/commodities/treasure/crown-gold-satin-gems-red.webp',
            type: 'base',
            transfer: true,
            system: { changes: [{ key: `system.traits.${trait}.value`, type: 'add', value: 1, priority: null, phase: 'initial' }] },
            flags: { [MOD]: { masterpiece: true } }
        }
    ]);
    // The card is placed in the vault permanently but its bonus stays active
    await item.update({ 'system.inVault': true, 'system.vaultActive': true });
}

/* ============================================ */
/*  Hub                                          */
/* ============================================ */

export class HubApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(actor, options = {}) {
        super({ id: `wonder-hub-${actor.id}`, ...options });
        this.actor = actor;
    }

    static DEFAULT_OPTIONS = {
        classes: ['wonder-app', 'wonder-hub'],
        window: { icon: 'fa-solid fa-wand-magic-sparkles', resizable: false },
        position: { width: 480, height: 'auto' },
        actions: { open: HubApp.#onOpen }
    };

    static PARTS = { main: { template: path('templates/hub.hbs') } };

    get title() {
        return `${loc('Hub.Title')} — ${this.actor.name}`;
    }

    async _prepareContext() {
        const api = game.modules.get(MOD).api;
        return api.hubContext(this.actor);
    }

    static #onOpen(_e, target) {
        const api = game.modules.get(MOD).api;
        api[target.dataset.fn]?.(this.actor);
    }
}

export function openHub(actor) {
    actor = resolveActor(actor);
    if (!actor) return ui.notifications.warn(loc('Notify.NoActor'));
    const app = foundry.applications.instances.get(`wonder-hub-${actor.id}`) ?? new HubApp(actor);
    return app.render({ force: true });
}
