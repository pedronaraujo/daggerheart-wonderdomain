/**
 * Wonder Domain for Daggerheart (Foundryborne system).
 * Registers the Wonder domain and provides the interfaces and automation for the Enchanter and Stargazer classes.
 */
import { MOD, DOMAIN_ID, DOMAIN_COLOR, SPECIAL, FORM_ITEM_ID, BASE, path, art, loc } from './constants.mjs';
import { DATA, loadData, registerSocket, hasWonder, wonderClasses, wonderLoadout, wonderTouchedActive, resolveActor, hasFlag, spellcast, tier } from './util.mjs';
import * as Stars from './star-chart.mjs';
import * as Ench from './enchanting.mjs';
import * as Misc from './misc.mjs';
import * as Auto from './automation.mjs';

/* -------------------------------------------- */
/*  Setup                                       */
/* -------------------------------------------- */

const registered = [];
function on(hook, fn) {
    registered.push([hook, Hooks.on(hook, fn)]);
}

function registerDomain() {
    const domains = CONFIG.DH?.DOMAIN?.domains;
    if (!domains) return console.error(`${MOD} | CONFIG.DH.DOMAIN not found — is the Daggerheart system active?`);
    domains[DOMAIN_ID] = {
        id: DOMAIN_ID,
        label: 'WONDER.Domain.label',
        src: art('wonder-emblem.png'),
        description: 'WONDER.Domain.description',
        color: DOMAIN_COLOR
    };
}

function registerSettings() {
    const reg = (key, data) => {
        if (game.settings.settings.has(`${MOD}.${key}`)) return;
        game.settings.register(MOD, key, data);
    };
    reg('autoAstral', { name: 'WONDER.Settings.autoAstral.name', hint: 'WONDER.Settings.autoAstral.hint', scope: 'world', config: true, type: Boolean, default: true });
    reg('autoExplosion', { name: 'WONDER.Settings.autoExplosion.name', hint: 'WONDER.Settings.autoExplosion.hint', scope: 'world', config: true, type: Boolean, default: true });
    reg('sheetButton', { name: 'WONDER.Settings.sheetButton.name', hint: 'WONDER.Settings.sheetButton.hint', scope: 'client', config: true, type: Boolean, default: true });
}

const TEMPLATES = ['star-chart', 'workshop', 'tinkering', 'glimpse', 'hub'];

function registerApi() {
    game.modules.get(MOD).api = {
        DATA,
        openHub: Misc.openHub,
        openStarChart: Stars.openStarChart,
        toggleConstellation: Stars.toggleConstellation,
        empyreanCall: Stars.empyreanCall,
        adjustAstral: (a, d) => Stars.adjustAstral(resolveActor(a), d),
        openWorkshop: Ench.openWorkshop,
        placeEnchantment: Ench.placeEnchantment,
        endEnchantment: Ench.endEnchantment,
        openTinkering: Misc.openTinkering,
        openGlimpse: Misc.openGlimpse,
        rollGlimpse: a => Misc.rollGlimpse(resolveActor(a)),
        appraise: Ench.appraise,
        syncBinaryStar: a => Auto.syncBinaryStar(resolveActor(a)),
        installArt: Misc.installArt,
        hubContext,
        _hooks: registered
    };
}

export function initialize() {
    registerDomain();
    registerSettings();
    foundry.applications.handlebars.loadTemplates(TEMPLATES.map(t => path(`templates/${t}.hbs`)));
    Handlebars.registerHelper('wonderEq', (a, b) => a === b);
    registerApi();
    registerHooks();
}

export async function ready() {
    await loadData();
    registerSocket();
    console.log(`${MOD} | Wonder Domain ready`);
}

/** Development: load this build from another URL over an installed copy. */
export async function devBoot(base) {
    BASE.url = base;
    const old = game.modules.get(MOD).api?._hooks;
    if (old) for (const [hook, id] of old) Hooks.off(hook, id);
    else {
        // Older builds did not record their hooks: find them by their source
        const names = ['daggerheart.preUseAction', 'daggerheart.postUseAction', 'daggerheart.postRollDuality', 'daggerheart.postTakeDamage',
            'updateActor', 'updateItem', 'createItem', 'deleteItem', 'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect',
            'updateToken', 'targetToken', 'createChatMessage', 'renderChatMessageHTML', 'renderCharacterSheet'];
        const marker = /Stars\.|Ench\.|Misc\.|HANDLERS|wonder|rerender/;
        for (const n of names) for (const h of [...(Hooks.events[n] ?? [])]) if (marker.test(h.fn.toString())) Hooks.off(n, h.id);
    }
    initialize();
    await loadData();
    const lang = await fetch(path(`lang/${game.i18n.lang === 'pt-BR' ? 'pt-BR' : 'en'}.json`)).then(r => r.json());
    foundry.utils.mergeObject(game.i18n.translations, lang);
    return 'dev build loaded';
}

Hooks.once('init', initialize);
Hooks.once('ready', ready);

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/** Actions that open a module interface instead of running a system action. */
const OPEN = {
    [SPECIAL.starChart]: actor => Stars.openStarChart(actor),
    [SPECIAL.constellation]: actor => Stars.toggleConstellation(actor),
    [SPECIAL.empyrean]: actor => Stars.empyreanCall(actor),
    [SPECIAL.workshop]: actor => Ench.openWorkshop(actor),
    [SPECIAL.surge]: actor => Ench.openWorkshop(actor, { surge: true }),
    [SPECIAL.tinkering]: actor => Misc.openTinkering(actor),
    [SPECIAL.glimpse]: actor => Misc.openGlimpse(actor),
    [SPECIAL.moonReduce]: (actor, item) => Misc.moonShieldReduce(actor, item),
    [SPECIAL.masterpiece]: (actor, item) => Misc.workOnMasterpiece(actor, item),
    [SPECIAL.appraisal]: actor => Ench.appraise(actor)
};

const report = err => {
    console.error(`${MOD} |`, err);
    ui.notifications.error(`Wonder Domain: ${err.message}`);
};

function registerHooks() {
    on('daggerheart.preUseAction', (action, config) => {
        const id = action?.id ?? action?._id;
        const handler = OPEN[id];
        if (handler) {
            if (!DATA.starChart) {
                ui.notifications.warn('Wonder Domain is still loading…');
                return false;
            }
            Promise.resolve(handler(action.actor, action.item)).catch(report);
            return false;
        }
        Auto.wonderTouchedCosts(action, config);
    });

    on('daggerheart.postUseAction', (action, config) => {
        Auto.afterAction(action, config).catch(report);
    });

    on('daggerheart.postRollDuality', config => {
        const actor = config?.actor;
        if (game.settings.get(MOD, 'autoAstral') && actor && Stars.inForm(actor))
            Stars.onDualityRoll(config, { binaryFree: Auto.skipAstralForBinary(actor, config) }).catch(report);
        Ench.onFearlessAttack(config).catch(report);
        Auto.consumeNextRoll(config).catch(report);
    });

    on('daggerheart.postTakeDamage', (actor, updates) => {
        if (game.user.isActiveGM || (!game.users.activeGM && actor.isOwner)) Auto.onDamageTaken(actor, updates).catch(report);
    });

    on('updateActor', (actor, changes) => {
        Stars.onActorUpdate(actor, changes).catch(report);
        if (isResponsible(actor)) Auto.wonderTouchedLastStress(actor, changes).catch(report);
        if (foundry.utils.hasProperty(changes, `flags.${MOD}.stars`) && isResponsible(actor)) Auto.syncBinaryStar(actor).catch(report);
        if (foundry.utils.hasProperty(changes, `flags.${MOD}.enchantments`) && isResponsible(actor)) Auto.syncHarmonious(actor).catch(report);
        rerender(actor);
    });

    on('updateItem', (item, changes) => {
        Stars.onItemUpdate(item, changes).catch(report);
    });

    for (const hook of ['createItem', 'deleteItem']) {
        on(hook, item => {
            const actor = item.parent;
            if (!(actor instanceof Actor) || !isResponsible(actor)) return;
            if (item.id === FORM_ITEM_ID) Auto.syncBinaryStar(actor).catch(report);
            if (item.type === 'domainCard' || item.getFlag(MOD, 'smallAppreciation')) Auto.syncRecall(actor).catch(report);
        });
    }

    for (const hook of ['createItem', 'updateItem', 'deleteItem', 'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']) {
        on(hook, doc => {
            const actor = doc.actor ?? (doc.parent instanceof Actor ? doc.parent : doc.parent?.parent);
            if (actor instanceof Actor) rerender(actor);
        });
    }

    // Token movement: Binary Star range and Harmonious Magic proximity
    on('updateToken', (_tokenDoc, changes) => {
        if (!('x' in changes) && !('y' in changes) && !('elevation' in changes)) return;
        setTimeout(() => {
            for (const a of game.actors.filter(x => x.type === 'character' && isResponsible(x))) {
                if (Stars.inForm(a) && hasFlag(a, 'binaryStars')) Auto.syncBinaryStar(a).catch(report);
                if (Ench.enchantmentsOf(a).length) Auto.syncHarmonious(a).catch(report);
            }
        }, 350);
    });

    on('targetToken', () => {
        for (const app of foundry.applications.instances.values())
            if (app.options?.classes?.includes('wonder-workshop') || app.options?.classes?.includes('wonder-glimpse')) app.render();
    });

    on('createChatMessage', message => {
        if (game.settings.get(MOD, 'autoExplosion')) Ench.onChatRoll(message).catch(report);
    });

    on('renderChatMessageHTML', (_message, html) => {
        html.querySelectorAll('[data-wonder-action]').forEach(btn =>
            btn.addEventListener('click', async ev => {
                ev.preventDefault();
                const actor = await fromUuid(btn.dataset.actor);
                if (!actor?.isOwner) return ui.notifications.warn(loc('Notify.NotYours'));
                btn.disabled = true;
                if (btn.dataset.wonderAction === 'refundAstral') await Stars.adjustAstral(actor, 1);
                if (btn.dataset.wonderAction === 'gravityPull') await Auto.gravityPull(actor, await fromUuid(btn.dataset.target));
            })
        );
    });

    on('renderCharacterSheet', (app, element) => {
        const actor = app.document ?? app.actor;
        if (!actor || !game.settings.get(MOD, 'sheetButton') || !hasWonder(actor)) return;
        const root = element instanceof HTMLElement ? element : element?.[0];
        if (!root) return;
        root.classList.toggle('wonder-constellation-active', Stars.inForm(actor));
        const header = root.querySelector('.window-header');
        if (header && !header.querySelector('.wonder-hub-button')) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'header-control wonder-hub-button';
            btn.dataset.tooltip = loc('Hub.Title');
            btn.setAttribute('aria-label', loc('Hub.Title'));
            btn.innerHTML = `<img src="${art('wonder-emblem.png')}" alt=""><span>Wonder</span>`;
            btn.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                Misc.openHub(actor);
            });
            const anchor = header.querySelector('[data-action="close"]') ?? header.lastElementChild;
            header.insertBefore(btn, anchor);
        }
    });
}

/** One client handles automation for an actor: an active owning player, else the active GM. */
function isResponsible(actor) {
    return Stars.firstOwner(actor)?.id === game.user.id;
}

const pending = new Map();
function rerender(actor) {
    clearTimeout(pending.get(actor.id));
    pending.set(
        actor.id,
        setTimeout(() => {
            for (const app of foundry.applications.instances.values()) {
                if (app.actor?.id === actor.id && app.options?.classes?.includes('wonder-app') && app.rendered) app.render();
            }
        }, 60)
    );
}

/* -------------------------------------------- */
/*  Hub context                                 */
/* -------------------------------------------- */

function hubContext(actor) {
    const classes = wonderClasses(actor);
    const st = Stars.chartState(actor);
    const stats = DATA.starChart ? Stars.constellationStats(st.marked) : null;
    const budget = DATA.starChart ? Stars.starBudget(actor) : null;
    const form = Stars.formItem(actor);
    const records = Ench.enchantmentsOf(actor);
    const cards = wonderLoadout(actor);
    const glimpse = Misc.glimpseItem(actor);
    const binary = Auto.binaryOf(actor);
    return {
        actor,
        emblem: art('wonder-emblem.png'),
        spellcast: spellcast(actor),
        tier: tier(actor),
        isStargazer: classes.has('stargazer'),
        isEnchanter: classes.has('enchanter'),
        stars: {
            name: st.name,
            used: st.marked.length,
            total: budget?.total ?? 0,
            inForm: Boolean(form),
            tokens: form?.system.resource?.value ?? 0,
            pips: Array.from({ length: 6 }, (_, i) => ({ on: i < (form?.system.resource?.value ?? 0) })),
            stats,
            binary: binary?.name ?? null,
            binaryInRange: binary ? Auto.binaryInRange(actor) : false
        },
        enchant: {
            records,
            slots: Ench.slots(actor),
            used: records.filter(r => !r.surge).length,
            explosion: actor.getFlag(MOD, 'explosion'),
            tinkering: actor.items.some(i => i.system?.actions?.get?.(SPECIAL.tinkering))
        },
        glimpse: glimpse ? { dice: Misc.glimpseDice(actor) } : null,
        wonder: {
            count: cards.length,
            touched: wonderTouchedActive(actor),
            cards: cards.map(c => ({ name: c.name, level: c.system.level, type: c.system.type, img: c.img }))
        }
    };
}
