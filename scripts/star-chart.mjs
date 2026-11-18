import { MOD, FORM_ITEM_ID, SPECIAL, RANGE_LABELS, path, loc } from './constants.mjs';
import {
    DATA, flagValues, hasFlag, spellcast, level, pay, chatCard, roll, resolveActor, hopeValue, escape
} from './util.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* -------------------------------------------- */
/*  State                                       */
/* -------------------------------------------- */

export function chartState(actor) {
    const s = actor.getFlag(MOD, 'stars') ?? {};
    return {
        marked: Array.isArray(s.marked) ? s.marked : [],
        name: s.name ?? '',
        extra: Number(s.extra ?? 0),
        binary: s.binary ?? null,
        cosmicHelp: Boolean(s.cosmicHelp)
    };
}

export function starBudget(actor) {
    const blessings = flagValues(actor, 'extraStars').reduce((a, b) => a + Number(b || 0), 0);
    const st = chartState(actor);
    return { level: level(actor), blessings, extra: st.extra, total: level(actor) + blessings + st.extra };
}

function adjacency() {
    const adj = {};
    for (const [a, b] of DATA.starChart.edges) {
        (adj[a] ??= new Set()).add(b);
        (adj[b] ??= new Set()).add(a);
    }
    return adj;
}

/** Stars that may be marked next (connected to the start or a marked star). */
export function availableStars(marked) {
    const adj = adjacency();
    const lit = new Set([DATA.starChart.start, ...marked]);
    const out = new Set();
    for (const id of lit) for (const n of adj[id] ?? []) if (!lit.has(n)) out.add(n);
    return out;
}

/** Whether every marked star stays connected to the start without `removed`. */
function staysConnected(marked, removed) {
    const adj = adjacency();
    const keep = new Set(marked.filter(m => m !== removed));
    const seen = new Set([DATA.starChart.start]);
    const queue = [DATA.starChart.start];
    while (queue.length) {
        const cur = queue.shift();
        for (const n of adj[cur] ?? []) {
            if (keep.has(n) && !seen.has(n)) {
                seen.add(n);
                queue.push(n);
            }
        }
    }
    return [...keep].every(k => seen.has(k));
}

/** Aggregate the bonuses granted by the marked stars. */
export function constellationStats(marked) {
    const nodes = Object.fromEntries(DATA.starChart.nodes.map(n => [n.id, n]));
    const count = t => marked.filter(m => nodes[m]?.type === t).length;
    const { range, die } = DATA.starChart.steps;
    const stats = {
        range: range[Math.min(count('rangeUp'), range.length - 1)],
        die: die[Math.min(count('dieUp'), die.length - 1)],
        damageBonus: 2 * count('dmg2'),
        evasion: count('evasion'),
        armor: count('armor'),
        hope: count('hope'),
        reliable: count('reliable') > 0,
        fly: count('fly') > 0,
        magicRes: count('magicRes') > 0,
        healAlly: count('healAlly') > 0,
        teleport: count('teleport') > 0,
        extraTarget: count('extraTarget') > 0,
        vulnerable: count('vulnerable') > 0
    };
    stats.rangeLabel = RANGE_LABELS[stats.range];
    stats.formula = `@prof${stats.die}${stats.damageBonus ? ` + ${stats.damageBonus}` : ''}`;
    stats.display = `${stats.die}${stats.damageBonus ? `+${stats.damageBonus}` : ''}`;
    return stats;
}

export const formItem = actor => actor?.items.get(FORM_ITEM_ID) ?? null;
export const inForm = actor => Boolean(formItem(actor));
export const astral = actor => formItem(actor)?.system.resource?.value ?? 0;

/* -------------------------------------------- */
/*  Mutations                                   */
/* -------------------------------------------- */

export async function toggleStar(actor, id) {
    const st = chartState(actor);
    if (id === DATA.starChart.start) return;
    if (st.marked.includes(id)) {
        if (!staysConnected(st.marked, id)) {
            ui.notifications.warn(loc('Stars.WouldDisconnect'));
            return;
        }
        st.marked = st.marked.filter(m => m !== id);
    } else {
        if (!availableStars(st.marked).has(id)) {
            ui.notifications.warn(loc('Stars.NotConnected'));
            return;
        }
        const budget = starBudget(actor);
        if (st.marked.length >= budget.total && !game.user.isGM) {
            ui.notifications.warn(loc('Stars.NoBudget', { n: budget.total }));
            return;
        }
        st.marked = [...st.marked, id];
    }
    await actor.setFlag(MOD, 'stars', st);
    if (inForm(actor)) await refreshForm(actor);
}

export async function setChartField(actor, key, value) {
    const st = chartState(actor);
    st[key] = value;
    await actor.setFlag(MOD, 'stars', st);
    if (key === 'name' && inForm(actor)) await refreshForm(actor);
}

function buildFormItem(actor, astralValue) {
    const st = chartState(actor);
    const stats = constellationStats(st.marked);
    const name = st.name?.trim() || loc('Stars.DefaultName');
    const img = 'icons/magic/light/explosion-star-glow-blue-purple.webp';
    const vulnId = 'wndFormVulnerab1';

    const changes = [
        {
            type: 'standardAttack',
            priority: 0,
            phase: 'initial',
            value: {
                name: `${name} — ${loc('Stars.StandardAttack')}`,
                img: 'icons/magic/light/projectiles-star-purple.webp',
                trait: 'spellcast',
                damageTypes: ['magical'],
                attackRange: stats.range,
                damageFormula: stats.formula
            }
        }
    ];
    const add = (key, value, type = 'add') => changes.push({ key, type, value, priority: 30, phase: 'initial' });
    if (stats.evasion) add('system.evasion', stats.evasion);
    if (stats.hope) add('system.resources.hope.max', stats.hope);
    if (stats.magicRes) add('system.resistance.magical.resistance', 1, 'override');
    if (stats.reliable) add('system.attack.roll.bonus', 1, 'override');
    if (stats.armor)
        changes.push({
            type: 'armor',
            priority: 20,
            phase: 'initial',
            value: { current: 0, max: String(stats.armor), damageThresholds: null, interaction: 'none' }
        });

    const effect = {
        _id: 'wndFormEffect001',
        name: loc('Stars.FormEffect', { name }),
        img,
        type: 'base',
        transfer: true,
        disabled: false,
        statuses: stats.fly ? ['fly'] : [],
        description: `<p>${loc('Stars.FormEffectHint')}</p>`,
        system: { changes, duration: { description: '', type: '' }, conditionals: [] },
        flags: { [MOD]: { constellation: true } }
    };
    const vulnEffect = {
        _id: vulnId,
        name: 'Vulnerable (Starbreak)',
        img: 'icons/magic/light/explosion-star-small-teal.webp',
        type: 'base',
        transfer: false,
        statuses: ['vulnerable'],
        system: { changes: [], duration: { description: '', type: 'temporary' }, conditionals: [] }
    };

    const baseAction = (id, name, type, extra = {}) => ({
        _id: id,
        type,
        name,
        systemPath: 'actions',
        description: '',
        chatDisplay: true,
        actionType: 'action',
        cost: [],
        uses: { value: null, max: '', recovery: null, consumeOnSuccess: false },
        img: 'icons/magic/symbols/star-yellow.webp',
        range: '',
        target: { type: 'self', amount: null },
        effects: [],
        triggers: [],
        areas: [],
        baseAction: false,
        originItem: { type: 'itemCollection' },
        ...extra
    });
    const astralCost = n => [{ key: 'resource', itemId: FORM_ITEM_ID, value: n, scalable: false, step: null, consumeOnSuccess: false }];
    const actions = {};
    actions[SPECIAL.empyrean] = baseAction(SPECIAL.empyrean, 'Empyrean Call', 'effect', {
        img: 'icons/magic/light/explosion-star-large-blue-yellow.webp',
        description: '<p>Spend 3 Hope to gain 1d4 Astral tokens.</p>'
    });
    actions[SPECIAL.starChart] = baseAction(SPECIAL.starChart, loc('Stars.OpenChart'), 'effect', {
        img: 'icons/magic/symbols/runes-star-pentagon-blue.webp',
        chatDisplay: false
    });
    actions[SPECIAL.constellation] = baseAction(SPECIAL.constellation, loc('Stars.Leave'), 'effect', {
        img: 'icons/magic/light/explosion-star-small-blue-yellow.webp',
        chatDisplay: false
    });
    if (stats.healAlly)
        actions.wndFormAstrlMend = baseAction('wndFormAstrlMend', 'Astral Mend', 'healing', {
            img: 'icons/magic/life/heart-hand-gold-green-light.webp',
            description: `<p>${DATA.starChart.types.healAlly.text}</p>`,
            cost: astralCost(2),
            range: 'veryClose',
            target: { type: 'friendly', amount: 1 },
            roll: { type: null, trait: null, difficulty: null, bonus: null, advState: 'neutral', diceRolling: { multiplier: 'prof', flatMultiplier: 1, dice: 'd6', compare: null, treshold: null }, useDefault: false },
            damage: {
                main: null,
                resources: {
                    hitPoints: {
                        value: { custom: { enabled: true, formula: '1' }, multiplier: 'flat', flatMultiplier: 1, dice: 'd6', bonus: null },
                        applyTo: 'hitPoints', base: false, resultBased: false, valueAlt: null, fullRestore: false, itemId: null
                    }
                }
            }
        });
    if (stats.teleport)
        actions.wndFormStarStep1 = baseAction('wndFormStarStep1', 'Star Step', 'effect', {
            img: 'icons/magic/control/buff-flight-wings-runes-blue-white.webp',
            description: `<p>${DATA.starChart.types.teleport.text}</p>`,
            cost: astralCost(1),
            range: 'far'
        });
    if (stats.extraTarget)
        actions.wndFormTwinStrik = baseAction('wndFormTwinStrik', 'Twin Strike', 'effect', {
            img: 'icons/magic/light/projectiles-trio-pink.webp',
            description: `<p>${DATA.starChart.types.extraTarget.text}</p>`,
            cost: astralCost(1),
            target: { type: 'hostile', amount: 1 }
        });
    if (stats.vulnerable)
        actions.wndFormStarbreak = baseAction('wndFormStarbreak', 'Starbreak', 'effect', {
            img: 'icons/magic/light/explosion-star-small-teal.webp',
            description: `<p>${DATA.starChart.types.vulnerable.text}</p>`,
            cost: astralCost(1),
            target: { type: 'hostile', amount: 1 },
            effects: [{ _id: vulnId, onSave: false }]
        });

    const features = st.marked
        .map(id => DATA.starChart.nodes.find(n => n.id === id))
        .filter(Boolean)
        .map(n => `<li>${DATA.starChart.types[n.type].text}</li>`)
        .join('');

    return {
        _id: FORM_ITEM_ID,
        name: `✦ ${name}`,
        type: 'feature',
        img,
        system: {
            description:
                `<p><strong>${loc('Stars.StandardAttack')}:</strong> ${stats.rangeLabel} · Spellcast · ${stats.display} magic (Proficiency)` +
                `${stats.reliable ? ' · Reliable' : ''}</p><ul>${features}</ul>` +
                `<p><em>${loc('Stars.AstralHint')}</em></p>`,
            featureForm: 'action',
            resource: {
                type: 'simple',
                value: Math.max(0, Math.min(6, astralValue)),
                max: '6',
                icon: 'fa-solid fa-star',
                recovery: null,
                progression: 'increasing',
                diceStates: {},
                dieFaces: 'd4'
            },
            actions,
            attribution: { source: 'Wonder Domain' },
            granter: null,
            actorResources: []
        },
        effects: [effect, vulnEffect],
        flags: { [MOD]: { constellationForm: true } }
    };
}

export async function enterForm(actor) {
    if (inForm(actor)) return;
    if (!(await pay(actor, { stress: 1 }))) return;
    const tokens = Math.max(1, spellcast(actor));
    await actor.createEmbeddedDocuments('Item', [buildFormItem(actor, tokens)], { keepId: true });
    const st = chartState(actor);
    const stats = constellationStats(st.marked);
    await chatCard(actor, {
        title: loc('Stars.EnterTitle', { name: escape(st.name || loc('Stars.DefaultName')) }),
        img: 'icons/magic/light/explosion-star-glow-blue-purple.webp',
        body: `<p>${loc('Stars.EnterBody', { n: tokens })}</p>
               <p class="wonder-chip-row"><span class="wonder-chip">${stats.rangeLabel}</span>
               <span class="wonder-chip">${stats.display}</span>
               ${stats.evasion ? `<span class="wonder-chip">+${stats.evasion} Evasion</span>` : ''}
               ${stats.fly ? '<span class="wonder-chip">Flight</span>' : ''}
               ${stats.magicRes ? '<span class="wonder-chip">Magic Resistance</span>' : ''}</p>`
    });
    if (hasFlag(actor, 'binaryStars')) await chooseBinaryStar(actor);
}

export async function leaveForm(actor, reason = '') {
    const item = formItem(actor);
    if (!item) return;
    await item.delete();
    // Hope slots granted by the Star Chart are lost with the form
    const hope = actor.system.resources?.hope;
    if (hope && hope.value > hope.max) await actor.update({ 'system.resources.hope.value': hope.max });
    await chatCard(actor, {
        title: loc('Stars.LeaveTitle'),
        img: 'icons/magic/light/explosion-star-small-blue-yellow.webp',
        body: `<p>${reason || loc('Stars.LeaveBody')}</p>`
    });
}

export async function toggleConstellation(actor) {
    actor = resolveActor(actor);
    if (!actor) return;
    return inForm(actor) ? leaveForm(actor) : enterForm(actor);
}

export async function refreshForm(actor) {
    const item = formItem(actor);
    if (!item) return;
    const value = item.system.resource?.value ?? 0;
    await item.delete({ render: false });
    await actor.createEmbeddedDocuments('Item', [buildFormItem(actor, value)], { keepId: true });
}

export async function adjustAstral(actor, delta, { silent = false } = {}) {
    const item = formItem(actor);
    if (!item) return 0;
    const value = Math.max(0, Math.min(6, (item.system.resource?.value ?? 0) + delta));
    await item.update({ 'system.resource.value': value });
    return value;
}

export async function empyreanCall(actor) {
    actor = resolveActor(actor);
    if (!inForm(actor)) {
        ui.notifications.warn(loc('Stars.NeedForm'));
        return;
    }
    const st = chartState(actor);
    const cost = st.cosmicHelp ? 2 : 3;
    if (!(await pay(actor, { hope: cost }))) return;
    const r = await roll('1d4');
    const before = astral(actor);
    const after = await adjustAstral(actor, r.total);
    if (st.cosmicHelp) await setChartField(actor, 'cosmicHelp', false);
    await chatCard(actor, {
        title: 'Empyrean Call',
        img: 'icons/magic/light/explosion-star-large-blue-yellow.webp',
        body: `<p>${loc('Stars.EmpyreanBody', { cost, roll: r.total, before, after })}</p>`,
        rolls: [r]
    });
}

async function chooseBinaryStar(actor) {
    const candidates = game.actors.filter(a => a.type === 'character' && a.id !== actor.id && a.hasPlayerOwner);
    if (!candidates.length) return;
    const st = chartState(actor);
    const options = candidates
        .map(a => `<option value="${a.uuid}" ${st.binary === a.uuid ? 'selected' : ''}>${escape(a.name)}</option>`)
        .join('');
    const uuidChosen = await foundry.applications.api.DialogV2.prompt({
        window: { title: loc('Stars.BinaryTitle') },
        content: `<p>${loc('Stars.BinaryHint')}</p><select name="binary"><option value="">—</option>${options}</select>`,
        ok: { callback: (_e, button) => button.form.elements.binary.value }
    }).catch(() => null);
    if (uuidChosen === null || uuidChosen === undefined) return;
    await setChartField(actor, 'binary', uuidChosen || null);
}

/* -------------------------------------------- */
/*  Automation                                  */
/* -------------------------------------------- */

/** Spend an Astral token for each action roll made in Constellation form. */
export async function onDualityRoll(config) {
    const actor = config?.actor;
    if (!actor?.isOwner || !inForm(actor)) return;
    if (config.actionType === 'reaction' || config.roll?.type === 'reaction') return;

    const roll = config.evaluated ?? config.roll;
    const failed = config.roll?.success === false;
    const withHope = Boolean(roll?.withHope);
    const againstOdds = failed && withHope && hasFlag(actor, 'againstTheOdds');
    const isStandardAttack = config.action?.id === '000BASEATTACK000' || config.action?.systemPath === 'attack' && config.action?.item === actor;

    if (againstOdds) {
        await chatCard(actor, {
            title: 'Against the Odds',
            img: 'icons/magic/symbols/question-stone-yellow.webp',
            body: `<p>${loc('Stars.AgainstOdds')}</p>`
        });
        return;
    }
    const left = await adjustAstral(actor, -1);
    const binary = chartState(actor).binary;
    const footer =
        isStandardAttack && binary
            ? `<button type="button" data-wonder-action="refundAstral" data-actor="${actor.uuid}">
                 <i class="fa-solid fa-rotate-left"></i> ${loc('Stars.BinaryRefund')}</button>`
            : `<button type="button" data-wonder-action="refundAstral" data-actor="${actor.uuid}">
                 <i class="fa-solid fa-rotate-left"></i> ${loc('Stars.Refund')}</button>`;
    if (left > 0 || inForm(actor))
        await chatCard(actor, {
            title: loc('Stars.TokenSpentTitle'),
            img: 'icons/magic/symbols/star-yellow.webp',
            body: `<p>${loc('Stars.TokenSpent', { n: left })}</p>`,
            footer
        });
}

/** Leave the form when the Astral tokens run out (however they were spent). */
export async function onItemUpdate(item, changes) {
    if (item.id !== FORM_ITEM_ID || !(item.parent instanceof Actor)) return;
    const value = foundry.utils.getProperty(changes, 'system.resource.value');
    if (value !== 0 || game.user !== firstOwner(item.parent)) return;
    await leaveForm(item.parent, loc('Stars.OutOfTokens'));
}

/** Drop out of the form when the last Hit Point is marked. */
export async function onActorUpdate(actor, changes) {
    if (!inForm(actor) || game.user !== firstOwner(actor)) return;
    const hp = foundry.utils.getProperty(changes, 'system.resources.hitPoints.value');
    if (hp === undefined) return;
    const max = actor.system.resources?.hitPoints?.max;
    if (max && hp >= max) await leaveForm(actor, loc('Stars.LastHitPoint'));
}

export function firstOwner(actor) {
    const active = game.users.filter(u => u.active && !u.isGM && actor.testUserPermission(u, 'OWNER'));
    return active[0] ?? game.users.activeGM ?? game.user;
}

/* -------------------------------------------- */
/*  Application                                 */
/* -------------------------------------------- */

export class StarChartApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(actor, options = {}) {
        super({ id: `wonder-starchart-${actor.id}`, ...options });
        this.actor = actor;
    }

    static DEFAULT_OPTIONS = {
        classes: ['wonder-app', 'wonder-starchart'],
        window: { icon: 'fa-solid fa-star', resizable: true },
        position: { width: 860, height: 'auto' },
        actions: {
            star: StarChartApp.#onStar,
            form: StarChartApp.#onForm,
            empyrean: StarChartApp.#onEmpyrean,
            astral: StarChartApp.#onAstral,
            attack: StarChartApp.#onAttack,
            binary: StarChartApp.#onBinary,
            cosmic: StarChartApp.#onCosmic,
            extra: StarChartApp.#onExtra
        }
    };

    static PARTS = { main: { template: path('templates/star-chart.hbs') } };

    get title() {
        return `${loc('Stars.Title')} — ${this.actor.name}`;
    }

    async _prepareContext() {
        const actor = this.actor;
        const st = chartState(actor);
        const avail = availableStars(st.marked);
        const lit = new Set([DATA.starChart.start, ...st.marked]);
        const nodes = DATA.starChart.nodes.map(n => {
            const type = DATA.starChart.types[n.type];
            const state = n.id === DATA.starChart.start ? 'start' : lit.has(n.id) ? 'marked' : avail.has(n.id) ? 'available' : 'locked';
            const labelLeft = n.x > 260;
            return {
                ...n,
                state,
                icon: type.icon,
                short: type.short,
                text: type.text,
                lx: labelLeft ? n.x - 14 : n.x + 14,
                anchor: labelLeft ? 'end' : 'start'
            };
        });
        const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
        const edges = DATA.starChart.edges.map(([a, b]) => {
            const A = byId[a], B = byId[b];
            const state = lit.has(a) && lit.has(b) ? 'lit' : lit.has(a) || lit.has(b) ? 'reach' : 'dim';
            return { x1: A.x, y1: A.y, x2: B.x, y2: B.y, state };
        });
        const stats = constellationStats(st.marked);
        const budget = starBudget(actor);
        const form = formItem(actor);
        const tokens = form?.system.resource?.value ?? 0;
        const binaryActor = st.binary ? fromUuidSync(st.binary) : null;
        return {
            actor,
            editable: actor.isOwner,
            isGM: game.user.isGM,
            nodes,
            edges,
            st,
            stats,
            budget,
            used: st.marked.length,
            remaining: Math.max(0, budget.total - st.marked.length),
            over: st.marked.length > budget.total,
            inForm: Boolean(form),
            pips: Array.from({ length: 6 }, (_, i) => ({ i, on: i < tokens })),
            tokens,
            hope: hopeValue(actor),
            spellcast: spellcast(actor),
            startTokens: Math.max(1, spellcast(actor)),
            hasBinary: hasFlag(actor, 'binaryStars'),
            binaryName: binaryActor?.name ?? null,
            hasCosmicHelp: hasFlag(actor, 'cosmicHelp'),
            empyreanCost: st.cosmicHelp ? 2 : 3,
            abilities: [
                stats.healAlly && { id: 'healAlly', ...DATA.starChart.types.healAlly, cost: 2 },
                stats.teleport && { id: 'teleport', ...DATA.starChart.types.teleport, cost: 1 },
                stats.extraTarget && { id: 'extraTarget', ...DATA.starChart.types.extraTarget, cost: 1 },
                stats.vulnerable && { id: 'vulnerable', ...DATA.starChart.types.vulnerable, cost: 1 }
            ].filter(Boolean)
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        const html = this.element;
        html.querySelectorAll('[data-action="star"]').forEach(el =>
            el.addEventListener('contextmenu', ev => {
                ev.preventDefault();
                if (!this.actor.isOwner) return;
                const id = el.dataset.id;
                if (chartState(this.actor).marked.includes(id)) toggleStar(this.actor, id);
            })
        );
        html.querySelector('input[name="constellationName"]')?.addEventListener('change', ev =>
            setChartField(this.actor, 'name', ev.target.value)
        );
    }

    static async #onStar(_event, target) {
        if (!this.actor.isOwner) return;
        const id = target.dataset.id;
        if (chartState(this.actor).marked.includes(id)) return; // right-click to unmark
        await toggleStar(this.actor, id);
    }

    static async #onForm() {
        await toggleConstellation(this.actor);
    }

    static async #onEmpyrean() {
        await empyreanCall(this.actor);
    }

    static async #onAstral(_event, target) {
        await adjustAstral(this.actor, Number(target.dataset.delta));
    }

    static async #onAttack(event) {
        const attack = this.actor.system.attack;
        if (!attack) return;
        await attack.use(event);
    }

    static async #onBinary() {
        await chooseBinaryStar(this.actor);
    }

    static async #onCosmic() {
        await setChartField(this.actor, 'cosmicHelp', !chartState(this.actor).cosmicHelp);
    }

    static async #onExtra(_event, target) {
        if (!game.user.isGM) return;
        const st = chartState(this.actor);
        await setChartField(this.actor, 'extra', st.extra + Number(target.dataset.delta));
    }
}

export function openStarChart(actor) {
    actor = resolveActor(actor);
    if (!actor) return ui.notifications.warn(loc('Notify.NoActor'));
    const app = foundry.applications.instances.get(`wonder-starchart-${actor.id}`) ?? new StarChartApp(actor);
    return app.render({ force: true });
}
