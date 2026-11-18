/**
 * Wonder Domain for Daggerheart (Foundryborne system).
 * Registers the Wonder domain and provides the interfaces for the Enchanter and Stargazer classes.
 */
import { MOD, DOMAIN_ID, DOMAIN_COLOR, SPECIAL, path, loc } from './constants.mjs';
import { DATA, loadData, registerSocket, hasWonder, wonderClasses, wonderLoadout, wonderTouchedActive, resolveActor, hasFlag, spellcast, tier } from './util.mjs';
import * as Stars from './star-chart.mjs';
import * as Ench from './enchanting.mjs';
import * as Misc from './misc.mjs';

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

Hooks.once('init', () => {
    // Register the Wonder domain alongside the core domains
    const domains = CONFIG.DH?.DOMAIN?.domains;
    if (domains) {
        domains[DOMAIN_ID] = {
            id: DOMAIN_ID,
            label: 'WONDER.Domain.label',
            src: path('assets/wonder.svg'),
            description: 'WONDER.Domain.description',
            color: DOMAIN_COLOR
        };
    } else {
        console.error(`${MOD} | CONFIG.DH.DOMAIN not found — is the Daggerheart system active?`);
    }

    game.settings.register(MOD, 'autoAstral', {
        name: 'WONDER.Settings.autoAstral.name',
        hint: 'WONDER.Settings.autoAstral.hint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });
    game.settings.register(MOD, 'autoExplosion', {
        name: 'WONDER.Settings.autoExplosion.name',
        hint: 'WONDER.Settings.autoExplosion.hint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });
    game.settings.register(MOD, 'sheetButton', {
        name: 'WONDER.Settings.sheetButton.name',
        hint: 'WONDER.Settings.sheetButton.hint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });

    foundry.applications.handlebars.loadTemplates([
        path('templates/star-chart.hbs'),
        path('templates/workshop.hbs'),
        path('templates/tinkering.hbs'),
        path('templates/glimpse.hbs'),
        path('templates/hub.hbs')
    ]);

    Handlebars.registerHelper('wonderEq', (a, b) => a === b);

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
        hubContext
    };
});

Hooks.once('ready', async () => {
    await loadData();
    registerSocket();
    console.log(`${MOD} | Wonder Domain ready`);
});

/* -------------------------------------------- */
/*  Action routing                              */
/* -------------------------------------------- */

const HANDLERS = {
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

Hooks.on('daggerheart.preUseAction', (action, _config) => {
    const id = action?.id ?? action?._id;
    const handler = HANDLERS[id];
    if (!handler) return;
    const actor = action.actor;
    const item = action.item;
    if (!DATA.starChart) return ui.notifications.warn('Wonder Domain is still loading…'), false;
    Promise.resolve(handler(actor, item)).catch(err => {
        console.error(err);
        ui.notifications.error(err.message);
    });
    return false;
});

Hooks.on('daggerheart.postRollDuality', (config, _message) => {
    if (game.settings.get(MOD, 'autoAstral')) Stars.onDualityRoll(config).catch(console.error);
    Ench.onFearlessAttack(config).catch(console.error);
});

Hooks.on('updateActor', (actor, changes) => {
    Stars.onActorUpdate(actor, changes).catch(console.error);
    rerender(actor);
});

Hooks.on('updateItem', (item, changes) => {
    Stars.onItemUpdate(item, changes).catch(console.error);
});

for (const hook of ['createItem', 'updateItem', 'deleteItem', 'createActiveEffect', 'deleteActiveEffect']) {
    Hooks.on(hook, doc => {
        const actor = doc.actor ?? (doc.parent instanceof Actor ? doc.parent : doc.parent?.parent);
        if (actor instanceof Actor) rerender(actor);
    });
}

Hooks.on('targetToken', () => {
    for (const app of foundry.applications.instances.values())
        if (app.options?.classes?.includes('wonder-workshop') || app.options?.classes?.includes('wonder-glimpse')) app.render();
});

Hooks.on('createChatMessage', message => {
    if (game.settings.get(MOD, 'autoExplosion')) Ench.onChatRoll(message).catch(console.error);
});

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
/*  Chat buttons                                */
/* -------------------------------------------- */

Hooks.on('renderChatMessageHTML', (_message, html) => {
    html.querySelectorAll('[data-wonder-action]').forEach(btn =>
        btn.addEventListener('click', async ev => {
            ev.preventDefault();
            const actor = await fromUuid(btn.dataset.actor);
            if (!actor?.isOwner) return;
            if (btn.dataset.wonderAction === 'refundAstral') {
                await Stars.adjustAstral(actor, 1);
                btn.disabled = true;
            }
        })
    );
});

/* -------------------------------------------- */
/*  Character sheet integration                 */
/* -------------------------------------------- */

Hooks.on('renderCharacterSheet', (app, element) => {
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
        btn.innerHTML = `<img src="${path('assets/wonder.svg')}" alt=""><span>Wonder</span>`;
        btn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            Misc.openHub(actor);
        });
        const anchor = header.querySelector('[data-action="close"]') ?? header.lastElementChild;
        header.insertBefore(btn, anchor);
    }
});

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
    return {
        actor,
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
            stats
        },
        enchant: {
            records,
            slots: Ench.slots(actor),
            used: records.filter(r => !r.surge).length,
            explosion: actor.getFlag(MOD, 'explosion'),
            tinkering: hasFlag(actor, 'tinkerExtraDie') || actor.items.some(i => i.name === 'Creative Tinkering')
        },
        glimpse: glimpse ? { dice: Misc.glimpseDice(actor) } : null,
        wonder: {
            count: cards.length,
            touched: wonderTouchedActive(actor),
            cards: cards.map(c => ({ name: c.name, level: c.system.level, type: c.system.type }))
        }
    };
}
